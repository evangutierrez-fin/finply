import { Router } from 'express'
import {
  attachTags, db, ensureAccount, ensureCategory, ensureTags, getTx, httpError, inTransaction,
  mapTx, refreshDebtStatus, setTxTags, TX_SELECT,
} from '../db.ts'
import { armarCsv, celdaTexto, montoCsv } from '../csv.ts'
import { sincronizarCompraMSI } from '../tarjetas.ts'
import { txInput, txQuery } from '../validators.ts'

const router = Router()

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
}

const TABLAS_PROPIAS = {
  counterparties: 'counterparties',
  cost_centers: 'cost_centers',
  invoices: 'invoices',
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

router.get('/', (req, res) => {
  const query = txQuery.parse(req.query)
  const { where, params } = buildFilter(query)

  const rows = db
    .prepare(`${TX_SELECT} WHERE ${where} ORDER BY t.date DESC, t.id DESC LIMIT ? OFFSET ?`)
    .all(...params, query.limit, query.offset)

  const txs = rows.map(mapTx)
  attachTags(txs)

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
  const txs = rows.map(mapTx)
  attachTags(txs)

  const encabezados = [
    'fecha', 'tipo', 'cuenta', 'cuenta_destino', 'categoria', 'etiquetas', 'monto', 'concepto',
  ]
  const filas = txs.map((t) => [
    t.date,
    t.type,
    // Nombres, conceptos y etiquetas los escribió el usuario: se sanean.
    celdaTexto(t.accountName),
    celdaTexto(t.transferAccountName),
    celdaTexto(t.categoryName),
    celdaTexto(t.tags.map((tag) => tag.name).join(' · ')),
    // El monto lo genera Finply: signo intacto, sin prefijo.
    montoCsv(t.type === 'gasto' ? -t.amountCents : t.amountCents),
    celdaTexto(t.note),
  ])

  const dia = new Date().toISOString().slice(0, 10)
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="finply-movimientos-${dia}.csv"`)
  res.send(armarCsv(encabezados, filas))
})

router.post('/', (req, res) => {
  const input = txInput.parse(req.body)
  ensureReferences(input)
  const id = inTransaction(() => {
    const result = db
      .prepare(
        `INSERT INTO transactions
          (profile_id, account_id, type, amount_cents, date, category_id, note, transfer_account_id,
           counterparty_id, cost_center_id, invoice_id, tax_cents, deductible)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      )
    const nuevo = Number(result.lastInsertRowid)
    if (input.tagIds) setTxTags(nuevo, input.tagIds)
    return nuevo
  })
  const tx = mapTx(getTx(id))
  attachTags([tx])
  res.status(201).json(tx)
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
  // Monto y fecha se sincronizan con el abono o aporte ligado,
  // para que el libro y la deuda/inversión sigan cuadrando.
  inTransaction(() => {
    db.prepare(
      `UPDATE transactions SET account_id = ?, type = ?, amount_cents = ?, date = ?,
        category_id = ?, note = ?, transfer_account_id = ?,
        counterparty_id = ?, cost_center_id = ?, tax_cents = ?, deductible = ?
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
      id,
    )
    // `tagIds` ausente deja las etiquetas como estaban; un arreglo vacío las quita.
    if (input.tagIds) setTxTags(id, input.tagIds)
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
  const tx = mapTx(getTx(id))
  attachTags([tx])
  res.json(tx)
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
