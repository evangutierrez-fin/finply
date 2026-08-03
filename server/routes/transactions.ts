import { Router } from 'express'
import {
  attachAdjuntos, attachNotas, attachSplits, attachTags, db, ensureAccount, ensureCategory,
  ensureTags, getTx, httpError, inTransaction, mapTx, refreshDebtStatus, setTxSplits, setTxTags,
  TX_SELECT,
} from '../db.ts'
import { armarCsv, celdaTexto, montoCsv } from '../csv.ts'
import { attachCampos, listarCampos, setCamposDeTx } from '../personalizacion.ts'
import { sincronizarCompraMSI } from '../tarjetas.ts'
import { adjuntoInput, conciliarInput, txInput, txQuery } from '../validators.ts'
import { hoyISO } from '../../shared/fechas.ts'

const router = Router()

/** Todo lo que cuelga de un movimiento, en cinco consultas y no en 5×N (R11). */
function hidratar(txs: ReturnType<typeof mapTx>[]) {
  attachTags(txs)
  attachSplits(txs)
  attachAdjuntos(txs)
  attachNotas(txs)
  attachCampos(txs)
  return txs
}

/** Valida que cuentas, categoría y etiquetas sean todas del mismo perfil. */
function ensureReferences(input: {
  profileId: number
  accountId: number
  type: 'ingreso' | 'gasto' | 'transferencia'
  categoryId?: number | null
  transferAccountId?: number | null
  tagIds?: number[]
  counterpartyId?: number | null
  costCenterId?: number | null
  invoiceId?: number | null
  rentalId?: number | null
}): void {
  ensureAccount(input.profileId, input.accountId)
  if (input.type === 'transferencia') {
    if (input.transferAccountId) ensureAccount(input.profileId, input.transferAccountId)
  } else if (input.categoryId) {
    ensureCategory(input.profileId, input.categoryId, input.type)
  }
  if (input.tagIds) ensureTags(input.profileId, input.tagIds)
  // Las referencias del perfil de negocio, con la misma regla que las demás:
  // tienen que ser del mismo libro. Sin esto, un movimiento puede acabar
  // ligado a la factura de otro perfil.
  ensurePropio(input.profileId, 'counterparties', input.counterpartyId, 'La contraparte')
  ensurePropio(input.profileId, 'cost_centers', input.costCenterId, 'Ese centro')
  ensurePropio(input.profileId, 'invoices', input.invoiceId, 'La factura')
  ensurePropio(input.profileId, 'rentals', input.rentalId, 'Ese arrendamiento')
}

const TABLAS_PROPIAS = {
  counterparties: 'counterparties',
  cost_centers: 'cost_centers',
  invoices: 'invoices',
  rentals: 'rentals',
} as const

function ensurePropio(
  profileId: number,
  tabla: keyof typeof TABLAS_PROPIAS,
  id: number | null | undefined,
  etiqueta: string,
): void {
  if (!id) return
  const row = db
    .prepare(`SELECT id FROM ${TABLAS_PROPIAS[tabla]} WHERE id = ? AND profile_id = ?`)
    .get(id, profileId)
  if (!row) throw httpError(400, `${etiqueta} no pertenece a este perfil`)
}

/**
 * Cada renglón del reparto tiene que ser del perfil y del mismo tipo que el
 * ticket: si no, un gasto podría acabar repartido en categorías de ingreso y
 * el reporte sumaría de los dos lados.
 */
function ensureSplits(
  profileId: number,
  type: 'ingreso' | 'gasto' | 'transferencia',
  splits: { categoryId?: number | null }[],
): void {
  if (splits.length === 0 || type === 'transferencia') return
  for (const r of splits) {
    if (r.categoryId) ensureCategory(profileId, r.categoryId, type)
  }
}

/**
 * Una devolución apunta al gasto que devuelve. Se comprueba de todo porque es
 * la liga que **cambia una cifra**: un reembolso resta del gasto del mes, así
 * que apuntar mal mueve la tasa de ahorro sin que se note.
 *
 * `id` es el movimiento que se está guardando —nulo al crear—, para que no
 * pueda apuntarse a sí mismo.
 */
function ensureRefund(
  profileId: number,
  refundOfId: number,
  amountCents: number,
  id: number | null,
): void {
  if (id !== null && refundOfId === id) {
    throw httpError(400, 'Un movimiento no puede devolverse a sí mismo')
  }
  const original: any = db
    .prepare('SELECT * FROM transactions WHERE id = ? AND profile_id = ?')
    .get(refundOfId, profileId)
  if (!original) throw httpError(400, 'El gasto original no pertenece a este perfil')
  if (original.type !== 'gasto') {
    throw httpError(400, 'Solo se devuelve un gasto: elige la partida que se te reembolsa')
  }
  if (original.refund_of_id) {
    throw httpError(400, 'Esa partida ya es una devolución; liga la devolución al gasto original')
  }
  // Un desembolso, un abono, un aporte o el cargo de una compra a meses ya
  // tienen su propio significado y su propia sincronización: devolverlos
  // parcialmente dejaría la deuda o la compra diciendo otra cosa.
  if (
    original.debt_id ||
    original.debt_payment_id ||
    original.investment_entry_id ||
    original.msi_purchase_id
  ) {
    throw httpError(400, 'Ese gasto está ligado a una deuda, inversión o compra a meses')
  }
  // Devolver más de lo que costó no es una devolución: es otra cosa, y dejaría
  // la categoría en negativo sin que nadie lo haya dicho.
  const otras: any = db
    .prepare(
      `SELECT COALESCE(SUM(amount_cents), 0) AS n FROM transactions
       WHERE refund_of_id = ? AND id IS NOT ?`,
    )
    .get(refundOfId, id)
  if (otras.n + amountCents > original.amount_cents) {
    throw httpError(
      400,
      `Ese gasto fue de ${original.amount_cents / 100} y ya se devolvieron ${otras.n / 100}: ` +
        'no se puede devolver de más',
    )
  }
}

type Query = ReturnType<typeof txQuery.parse>

/**
 * Arma el WHERE compartido por el listado, el conteo y el export, para que los
 * tres respondan exactamente al mismo conjunto de filtros.
 */
function buildFilter(query: Query): { where: string; params: (string | number)[] } {
  const clauses = ['t.profile_id = ?']
  const params: (string | number)[] = [query.profileId]

  // Un rango explícito manda sobre `month`, que se conserva por compatibilidad.
  if (query.from || query.to) {
    if (query.from) {
      clauses.push('t.date >= ?')
      params.push(query.from)
    }
    if (query.to) {
      clauses.push('t.date <= ?')
      params.push(query.to)
    }
  } else if (query.month) {
    clauses.push('substr(t.date, 1, 7) = ?')
    params.push(query.month)
  }

  if (query.accountId) {
    clauses.push('(t.account_id = ? OR t.transfer_account_id = ?)')
    params.push(query.accountId, query.accountId)
  }
  if (query.type) {
    clauses.push('t.type = ?')
    params.push(query.type)
  }
  if (query.minCents !== undefined) {
    clauses.push('t.amount_cents >= ?')
    params.push(query.minCents)
  }
  if (query.maxCents !== undefined) {
    clauses.push('t.amount_cents <= ?')
    params.push(query.maxCents)
  }
  if (query.tagId) {
    clauses.push('EXISTS (SELECT 1 FROM transaction_tags tt WHERE tt.transaction_id = t.id AND tt.tag_id = ?)')
    params.push(query.tagId)
  }
  if (query.q) {
    clauses.push('(t.note LIKE ? OR c.name LIKE ? OR a.name LIKE ?)')
    const like = `%${query.q}%`
    params.push(like, like, like)
  }
  if (query.conciliado) {
    clauses.push(query.conciliado === 'si' ? 't.reconciled_at IS NOT NULL' : 't.reconciled_at IS NULL')
  }

  return { where: clauses.join(' AND '), params }
}

/**
 * Conteo y sumas de **todo** el filtro, no de la página. Sin esto el pie del
 * libro mentiría en cuanto hay más movimientos que el tamaño de página.
 */
function totalsMatching(where: string, params: (string | number)[]) {
  const row: any = db
    .prepare(
      `SELECT COUNT(*) AS n,
        COALESCE(SUM(CASE WHEN t.type = 'gasto' THEN t.amount_cents END), 0) AS gasto,
        COALESCE(SUM(CASE WHEN t.type = 'ingreso' THEN t.amount_cents END), 0) AS ingreso
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE ${where}`,
    )
    .get(...params)
  return { count: row.n, gasto: row.gasto, ingreso: row.ingreso }
}

/**
 * Lo que la barra de registro rápido propone antes de que el usuario escriba
 * nada: la última partida —para poder repetirla— y, por tipo, la cuenta y la
 * categoría que se usaron la última vez.
 *
 * Es **solo lectura y solo una propuesta**. No asienta nada, no adivina el
 * monto y no rellena el concepto: R4 sigue entero, lo único que se acorta es
 * el camino hasta la confirmación. Quien registra el súper de cada semana no
 * tiene que volver a elegir "Efectivo" y "Despensa" cincuenta veces.
 *
 * Dos consultas, no una por tipo (R11), y la segunda solo mira las últimas
 * filas de cada tipo por su índice `(profile_id, date)`.
 */
router.get('/sugerencia', (req, res) => {
  const profileId = Number(req.query.profileId)
  if (!Number.isInteger(profileId) || profileId <= 0) {
    return res.status(400).json({ error: 'Falta profileId' })
  }
  // Por `id` y no por fecha: "la última" es **la última que registraste**, no
  // la de fecha más reciente. Quien acaba de corregir una partida de enero no
  // quiere repetir la de enero, y quien apunta el café de esta mañana sí. La
  // vista escribe cuál es —fecha, concepto y monto— antes de repetirla, así
  // que la ambigüedad no llega hasta el libro.
  const ultimaRow = db
    .prepare(`${TX_SELECT} WHERE t.profile_id = ? ORDER BY t.id DESC LIMIT 1`)
    .get(profileId)
  const ultima = ultimaRow ? hidratar([mapTx(ultimaRow)])[0] : null

  // La última de **cada** tipo, en una sola consulta: la transferencia no
  // propone categoría y el ingreso no propone la del gasto.
  const porTipo = db
    .prepare(
      `SELECT type, account_id, category_id FROM transactions
       WHERE id IN (
         SELECT MAX(id) FROM transactions WHERE profile_id = ? GROUP BY type
       )`,
    )
    .all(profileId) as any[]

  const propuesta: Record<string, { accountId: number; categoryId: number | null }> = {}
  for (const row of porTipo) {
    propuesta[row.type] = { accountId: row.account_id, categoryId: row.category_id ?? null }
  }
  res.json({ ultima, porTipo: propuesta })
})

router.get('/', (req, res) => {
  const query = txQuery.parse(req.query)
  const { where, params } = buildFilter(query)

  const rows = db
    .prepare(`${TX_SELECT} WHERE ${where} ORDER BY t.date DESC, t.id DESC LIMIT ? OFFSET ?`)
    .all(...params, query.limit, query.offset)

  const txs = hidratar(rows.map(mapTx))

  // Los agregados van en cabeceras para no cambiar la forma de la respuesta:
  // sigue siendo un arreglo, como antes de existir la paginación.
  const totals = totalsMatching(where, params)
  res.setHeader('X-Total-Count', String(totals.count))
  res.setHeader('X-Sum-Gasto-Cents', String(totals.gasto))
  res.setHeader('X-Sum-Ingreso-Cents', String(totals.ingreso))
  res.json(txs)
})

// Export CSV del mismo conjunto que muestra el listado, sin paginar.
router.get('/export.csv', (req, res) => {
  const query = txQuery.parse(req.query)
  const { where, params } = buildFilter(query)

  const rows = db
    .prepare(`${TX_SELECT} WHERE ${where} ORDER BY t.date ASC, t.id ASC`)
    .all(...params) as any[]
  const txs = hidratar(rows.map(mapTx))

  // Los campos propios salen en su propia columna cada uno (Fase 21). Un campo
  // que solo se puede ver dentro de Finply es un dato atrapado, y eso choca con
  // lo que el libro promete. Se ordenan como en el formulario para que el
  // archivo se lea igual que la pantalla; los archivados entran si tienen
  // respuestas, porque esas respuestas existen.
  const campos = listarCampos(query.profileId).filter((c) => !c.archived || c.usos > 0)

  const encabezados = [
    'fecha', 'tipo', 'cuenta', 'cuenta_destino', 'categoria', 'etiquetas', 'monto', 'concepto',
    'conciliado',
    ...campos.map((c) => celdaTexto(c.label)),
  ]
  const filas = txs.map((t) => [
    t.date,
    t.type,
    // Nombres, conceptos y etiquetas los escribió el usuario: se sanean.
    celdaTexto(t.accountName),
    celdaTexto(t.transferAccountName),
    // Un ticket dividido no tiene una categoría, tiene varias: se listan en la
    // misma celda en vez de dejarla vacía, que se leería como "sin clasificar".
    celdaTexto(
      t.splits.length > 0
        ? t.splits.map((r) => r.categoryName ?? 'Sin categoría').join(' · ')
        : t.categoryName,
    ),
    celdaTexto(t.tags.map((tag) => tag.name).join(' · ')),
    // El monto lo genera Finply: signo intacto, sin prefijo.
    montoCsv(t.type === 'gasto' ? -t.amountCents : t.amountCents),
    celdaTexto(t.note),
    t.reconciledAt ? 'sí' : 'no',
    // El valor lo escribió el usuario, así que se sanea como cualquier texto
    // suyo (R7): un campo propio llamado "=cmd" es exactamente el vector.
    ...campos.map((c) => celdaTexto(t.fields[String(c.id)] ?? '')),
  ])

  const dia = new Date().toISOString().slice(0, 10)
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="finply-movimientos-${dia}.csv"`)
  res.send(armarCsv(encabezados, filas))
})

router.post('/', (req, res) => {
  const input = txInput.parse(req.body)
  ensureReferences(input)
  if (input.splits) ensureSplits(input.profileId, input.type, input.splits)
  if (input.refundOfId) {
    ensureRefund(input.profileId, input.refundOfId, input.amountCents, null)
  }
  const id = inTransaction(() => {
    const result = db
      .prepare(
        `INSERT INTO transactions
          (profile_id, account_id, type, amount_cents, date, category_id, note, transfer_account_id,
           counterparty_id, cost_center_id, invoice_id, tax_cents, deductible, refund_of_id,
           rental_id, rental_role)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.profileId,
        input.accountId,
        input.type,
        input.amountCents,
        input.date,
        input.type === 'transferencia' ? null : (input.categoryId ?? null),
        input.note,
        input.type === 'transferencia' ? (input.transferAccountId ?? null) : null,
        input.counterpartyId ?? null,
        input.costCenterId ?? null,
        input.invoiceId ?? null,
        input.taxCents,
        input.deductible ? 1 : 0,
        input.refundOfId ?? null,
        input.rentalId ?? null,
        input.rentalRole ?? null,
      )
    const nuevo = Number(result.lastInsertRowid)
    if (input.tagIds) setTxTags(nuevo, input.tagIds)
    if (input.splits) setTxSplits(nuevo, input.splits)
    if (input.fields) setCamposDeTx(input.profileId, nuevo, input.fields)
    return nuevo
  })
  res.status(201).json(hidratar([mapTx(getTx(id))])[0])
})

router.patch('/:id', (req, res) => {
  const id = Number(req.params.id)
  const existing: any = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id)
  if (!existing) return res.status(404).json({ error: 'Movimiento no encontrado' })
  const input = txInput.parse(req.body)
  // Un movimiento no cambia de libro: si lo hiciera, quedaría apuntando a una
  // cuenta de otro perfil y los saldos de ambos libros dejarían de cuadrar.
  if (input.profileId !== existing.profile_id) {
    return res.status(400).json({ error: 'Un movimiento no puede cambiar de perfil' })
  }
  const linked =
    existing.debt_payment_id ||
    existing.investment_entry_id ||
    existing.msi_purchase_id ||
    existing.debt_id
  if (linked && input.type !== existing.type) {
    return res.status(400).json({
      error:
        'Este movimiento está ligado a una deuda, inversión o compra a meses; su tipo no puede cambiar',
    })
  }
  ensureReferences(input)
  if (input.splits) ensureSplits(input.profileId, input.type, input.splits)
  // `refundOfId` ausente conserva la liga que ya traía —igual que las
  // etiquetas—, y por eso hay que revalidarla contra el monto nuevo: bajar un
  // gasto de $1,000 a $100 con una devolución de $300 encima lo dejaría
  // devuelto de más.
  const refundOfId =
    input.refundOfId === undefined ? (existing.refund_of_id ?? null) : input.refundOfId
  if (refundOfId) ensureRefund(input.profileId, refundOfId, input.amountCents, id)
  // Monto y fecha se sincronizan con el abono o aporte ligado,
  // para que el libro y la deuda/inversión sigan cuadrando.
  inTransaction(() => {
    db.prepare(
      `UPDATE transactions SET account_id = ?, type = ?, amount_cents = ?, date = ?,
        category_id = ?, note = ?, transfer_account_id = ?,
        counterparty_id = ?, cost_center_id = ?, tax_cents = ?, deductible = ?,
        refund_of_id = ?, rental_id = ?, rental_role = ?
       WHERE id = ?`,
    ).run(
      input.accountId,
      input.type,
      input.amountCents,
      input.date,
      input.type === 'transferencia' ? null : (input.categoryId ?? null),
      input.note,
      input.type === 'transferencia' ? (input.transferAccountId ?? null) : null,
      input.counterpartyId ?? null,
      input.costCenterId ?? null,
      input.taxCents,
      input.deductible ? 1 : 0,
      refundOfId,
      input.rentalId ?? null,
      input.rentalRole ?? null,
      id,
    )
    // `tagIds` ausente deja las etiquetas como estaban; un arreglo vacío las quita.
    if (input.tagIds) setTxTags(id, input.tagIds)
    // El reparto sigue la misma regla. Ojo: cambiar el monto de un movimiento
    // dividido **sin** mandar renglones nuevos dejaría un reparto que ya no
    // suma el total, así que en ese caso se descarta y manda la categoría.
    if (input.splits) {
      setTxSplits(id, input.splits)
    } else if (input.amountCents !== existing.amount_cents) {
      db.prepare('DELETE FROM tx_splits WHERE tx_id = ?').run(id)
    }
    // Misma regla de R17 que los campos de negocio: ausente deja lo contestado
    // como estaba. Un libro sin campos propios no manda nada y no pierde nada.
    if (input.fields) setCamposDeTx(input.profileId, id, input.fields)
    if (existing.debt_payment_id) {
      // El interés que el usuario ya fijó se respeta, pero nunca puede pasar
      // del abono: el capital no puede quedar negativo.
      db.prepare(
        `UPDATE debt_payments SET amount_cents = ?, date = ?,
          interest_cents = MIN(interest_cents, ?) WHERE id = ?`,
      ).run(input.amountCents, input.date, input.amountCents, existing.debt_payment_id)
      const payment: any = db
        .prepare('SELECT debt_id FROM debt_payments WHERE id = ?')
        .get(existing.debt_payment_id)
      if (payment) refreshDebtStatus(payment.debt_id)
    }
    if (existing.investment_entry_id) {
      db.prepare('UPDATE investment_entries SET amount_cents = ?, date = ? WHERE id = ?').run(
        input.amountCents,
        input.date,
        existing.investment_entry_id,
      )
    }
    // El desembolso y su deuda son el mismo dinero: corregir el movimiento
    // corrige el principal, o los dos dirían cosas distintas. El enganche
    // corrige el enganche, que no es principal — por eso hacen falta roles.
    if (existing.debt_id && existing.debt_role === 'enganche') {
      db.prepare('UPDATE debts SET down_payment_cents = ? WHERE id = ?').run(
        input.amountCents,
        existing.debt_id,
      )
    } else if (existing.debt_id) {
      db.prepare('UPDATE debts SET principal_cents = ?, start_date = ? WHERE id = ?').run(
        input.amountCents,
        input.date,
        existing.debt_id,
      )
      refreshDebtStatus(existing.debt_id)
    }
    // Cambiar el cargo de una compra a meses rehace su calendario: si no, las
    // parcialidades dejarían de sumar el total de la compra.
    if (existing.msi_purchase_id) {
      sincronizarCompraMSI(existing.msi_purchase_id, {
        totalCents: input.amountCents,
        purchaseDate: input.date,
        accountId: input.accountId,
      })
    }
  })
  res.json(hidratar([mapTx(getTx(id))])[0])
})

/**
 * Marcar (o desmarcar) partidas contra el estado de cuenta. En bloque, porque
 * conciliar es pasar una lista con el dedo, no abrir treinta modales.
 *
 * Es lo único de la Fase 10 que escribe sin pasar por el modal, y aun así no
 * cambia una cifra: la bandera no mueve saldos ni reportes (R4 tranquilo).
 */
router.post('/conciliar', (req, res) => {
  const input = conciliarInput.parse(req.body)
  const marca = input.reconciled ? hoyISO() : null
  const cambiados = inTransaction(() => {
    const stmt = db.prepare(
      'UPDATE transactions SET reconciled_at = ? WHERE id = ? AND profile_id = ?',
    )
    let n = 0
    for (const txId of new Set(input.txIds)) {
      n += Number(stmt.run(marca, txId, input.profileId).changes)
    }
    return n
  })
  res.json({ ok: true, cambiados })
})

/**
 * Duplicar una partida. Copia lo que se vuelve a teclear —cuenta, tipo, monto,
 * categoría o reparto, etiquetas y concepto— y **no** copia las ligas: una
 * copia es un movimiento nuevo, no un segundo abono a la misma deuda ni un
 * segundo cobro de la misma factura. El recibo tampoco: es de aquella compra.
 */
router.post('/:id/duplicar', (req, res) => {
  const original: any = db
    .prepare('SELECT * FROM transactions WHERE id = ?')
    .get(Number(req.params.id))
  if (!original) return res.status(404).json({ error: 'Movimiento no encontrado' })
  const date = typeof req.body?.date === 'string' ? req.body.date : original.date
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Fecha inválida (AAAA-MM-DD)' })
  }

  const id = inTransaction(() => {
    const result = db
      .prepare(
        `INSERT INTO transactions
          (profile_id, account_id, type, amount_cents, date, category_id, note, transfer_account_id,
           counterparty_id, cost_center_id, tax_cents, deductible)
         SELECT profile_id, account_id, type, amount_cents, ?, category_id, note, transfer_account_id,
           counterparty_id, cost_center_id, tax_cents, deductible
         FROM transactions WHERE id = ?`,
      )
      .run(date, original.id)
    const nuevo = Number(result.lastInsertRowid)
    db.prepare(
      `INSERT INTO transaction_tags (transaction_id, tag_id)
       SELECT ?, tag_id FROM transaction_tags WHERE transaction_id = ?`,
    ).run(nuevo, original.id)
    db.prepare(
      `INSERT INTO tx_splits (tx_id, category_id, amount_cents, note)
       SELECT ?, category_id, amount_cents, note FROM tx_splits WHERE tx_id = ?`,
    ).run(nuevo, original.id)
    return nuevo
  })
  res.status(201).json(hidratar([mapTx(getTx(id))])[0])
})

/** Adjuntar el recibo. Los bytes van en base64 dentro del JSON (validators). */
router.post('/:id/adjuntos', (req, res) => {
  const id = Number(req.params.id)
  const tx: any = db.prepare('SELECT id FROM transactions WHERE id = ?').get(id)
  if (!tx) return res.status(404).json({ error: 'Movimiento no encontrado' })
  const input = adjuntoInput.parse(req.body)
  const bytes = Buffer.from(input.dataB64, 'base64')
  const result = db
    .prepare(
      `INSERT INTO tx_attachments (tx_id, filename, mime, size_bytes, data_b64)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(id, input.filename, input.mime, bytes.length, input.dataB64)
  const row: any = db
    .prepare('SELECT id, filename, mime, size_bytes, created_at FROM tx_attachments WHERE id = ?')
    .get(Number(result.lastInsertRowid))
  res.status(201).json({
    id: row.id,
    filename: row.filename,
    mime: row.mime,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
  })
})

/** El archivo, tal cual. Es el único lugar donde salen los bytes. */
router.get('/:id/adjuntos/:adjuntoId', (req, res) => {
  const row: any = db
    .prepare('SELECT * FROM tx_attachments WHERE id = ? AND tx_id = ?')
    .get(Number(req.params.adjuntoId), Number(req.params.id))
  if (!row) return res.status(404).json({ error: 'Recibo no encontrado' })
  res.setHeader('Content-Type', row.mime || 'application/octet-stream')
  // `attachment` y no `inline`: el archivo lo subió el usuario y abrirlo en la
  // misma pestaña convierte un PDF ajeno en código corriendo en el origen.
  res.setHeader('Content-Disposition', `attachment; filename="${row.filename.replace(/"/g, '')}"`)
  res.send(Buffer.from(row.data_b64, 'base64'))
})

router.delete('/:id/adjuntos/:adjuntoId', (req, res) => {
  const result = db
    .prepare('DELETE FROM tx_attachments WHERE id = ? AND tx_id = ?')
    .run(Number(req.params.adjuntoId), Number(req.params.id))
  if (Number(result.changes) === 0) return res.status(404).json({ error: 'Recibo no encontrado' })
  res.json({ ok: true })
})

router.delete('/:id', (req, res) => {
  const existing: any = db
    .prepare('SELECT * FROM transactions WHERE id = ?')
    .get(Number(req.params.id))
  if (!existing) return res.status(404).json({ error: 'Movimiento no encontrado' })
  inTransaction(() => {
    db.prepare('DELETE FROM transactions WHERE id = ?').run(existing.id)
    // Si el movimiento era el registro de un abono o de una inversión, ese
    // registro también se elimina para que el libro siga cuadrando.
    if (existing.debt_payment_id) {
      const payment: any = db
        .prepare('SELECT * FROM debt_payments WHERE id = ?')
        .get(existing.debt_payment_id)
      if (payment) {
        db.prepare('DELETE FROM debt_payments WHERE id = ?').run(payment.id)
        refreshDebtStatus(payment.debt_id)
      }
    }
    if (existing.investment_entry_id) {
      db.prepare('DELETE FROM investment_entries WHERE id = ?').run(existing.investment_entry_id)
    }
    // Sin cargo no hay compra: el calendario de parcialidades se va con él
    // (las parcialidades caen por cascada).
    if (existing.msi_purchase_id) {
      db.prepare('DELETE FROM msi_purchases WHERE id = ?').run(existing.msi_purchase_id)
    }
    // Ojo: el desembolso de una deuda NO se comporta así. Una deuda con su
    // historial de abonos no puede evaporarse porque anules un movimiento;
    // la deuda es el registro principal y aquí solo se pierde la liga.
  })
  res.json({ ok: true })
})

export default router
