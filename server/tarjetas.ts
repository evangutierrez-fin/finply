// Tarjetas de crédito: saldo al corte, pago para no generar intereses y
// compras a meses sin intereses.
//
// El modelo, que es lo que hay que entender antes de tocar nada:
//
//   · Una compra a N meses se asienta como **un solo cargo** por el total, el
//     día de la compra. Así es como funciona de verdad: el banco te descuenta
//     la línea de crédito completa de un jalón.
//   · Las N parcialidades son el **calendario de facturación**: dicen cuánto
//     de esa compra te exige el banco en cada corte.
//   · Por eso el saldo al corte suma parcialidades vencidas y **excluye** el
//     cargo ancla. Si contara los dos, la tarjeta pediría el doble.

import { db, ensureCategory, ensureTarjeta, httpError, inTransaction } from './db.ts'
import { fechasParcialidades, parcialidades } from '../shared/credito.ts'
import { hoyISO, siguienteDiaDelMes, sumarMeses, ultimoCorte } from '../shared/fechas.ts'
import type { CompraMSI, EstadoTarjeta } from '../shared/types.ts'

/**
 * Cuánta deuda agrega cada movimiento a la tarjeta. Un cargo o una disposición
 * de efectivo suman; un abono o una transferencia que entra restan. Es el
 * signo contrario al del saldo de la cuenta, porque en una tarjeta el saldo
 * negativo es lo que debes.
 */
const DELTA_DEUDA = `
  CASE
    WHEN t.transfer_account_id = c.account_id THEN -t.amount_cents
    WHEN t.type = 'ingreso' THEN -t.amount_cents
    ELSE t.amount_cents
  END`

/** Solo lo que abona a la tarjeta: pagos y devoluciones. */
const DELTA_PAGO = `
  CASE
    WHEN t.transfer_account_id = c.account_id THEN t.amount_cents
    WHEN t.type = 'ingreso' THEN t.amount_cents
    ELSE 0
  END`

interface Referencia {
  accountId: number
  /** Fecha de corte contra la que se mide todo. */
  corte: string
  /** El corte siguiente: sirve para saber qué se facturará. */
  proximo: string
}

/**
 * Cargos y abonos de cada tarjeta hasta su propia fecha de corte, en una sola
 * consulta agregada (R11): el corte cambia de tarjeta a tarjeta, así que las
 * fechas entran como CTE de valores en vez de una consulta por tarjeta.
 */
function movimientosAlCorte(referencias: Referencia[]) {
  const mapa = new Map<number, { deuda: number; pagadoDespues: number }>()
  if (referencias.length === 0) return mapa
  const valores = referencias.map(() => '(?, ?)').join(', ')
  const params = referencias.flatMap((r) => [r.accountId, r.corte])
  const filas: any[] = db
    .prepare(
      `WITH cortes(account_id, corte) AS (VALUES ${valores})
       SELECT c.account_id AS account_id,
         COALESCE(SUM(CASE WHEN t.date <= c.corte AND t.msi_purchase_id IS NULL
           THEN ${DELTA_DEUDA} END), 0) AS deuda,
         COALESCE(SUM(CASE WHEN t.date > c.corte THEN ${DELTA_PAGO} END), 0) AS pagado_despues
       FROM cortes c
       LEFT JOIN transactions t
         ON (t.account_id = c.account_id OR t.transfer_account_id = c.account_id)
       GROUP BY c.account_id`,
    )
    .all(...params)
  for (const f of filas) mapa.set(f.account_id, { deuda: f.deuda, pagadoDespues: f.pagado_despues })
  return mapa
}

/** Parcialidades de MSI ya facturadas, pendientes y las del próximo corte. */
function parcialidadesAlCorte(referencias: Referencia[]) {
  const mapa = new Map<number, { facturado: number; porFacturar: number; proximo: number }>()
  if (referencias.length === 0) return mapa
  const valores = referencias.map(() => '(?, ?, ?)').join(', ')
  const params = referencias.flatMap((r) => [r.accountId, r.corte, r.proximo])
  const filas: any[] = db
    .prepare(
      `WITH cortes(account_id, corte, proximo) AS (VALUES ${valores})
       SELECT c.account_id AS account_id,
         COALESCE(SUM(CASE WHEN i.due_date <= c.corte THEN i.amount_cents END), 0) AS facturado,
         COALESCE(SUM(CASE WHEN i.due_date > c.corte THEN i.amount_cents END), 0) AS por_facturar,
         COALESCE(SUM(CASE WHEN i.due_date > c.corte AND i.due_date <= c.proximo
           THEN i.amount_cents END), 0) AS proximo
       FROM cortes c
       LEFT JOIN msi_purchases p ON p.account_id = c.account_id
       LEFT JOIN msi_installments i ON i.purchase_id = p.id
       GROUP BY c.account_id`,
    )
    .all(...params)
  for (const f of filas) {
    mapa.set(f.account_id, {
      facturado: f.facturado,
      porFacturar: f.por_facturar,
      proximo: f.proximo,
    })
  }
  return mapa
}

/** Estado de cada tarjeta activa del perfil, mirado desde el día `hoy`. */
export function estadoTarjetas(profileId: number, hoy = hoyISO()): EstadoTarjeta[] {
  const tarjetas: any[] = db
    .prepare(
      `SELECT a.*,
        a.opening_cents
          + COALESCE((SELECT SUM(CASE
              WHEN t.type = 'ingreso' THEN t.amount_cents
              ELSE -t.amount_cents END)
            FROM transactions t WHERE t.account_id = a.id), 0)
          + COALESCE((SELECT SUM(t.amount_cents)
            FROM transactions t WHERE t.transfer_account_id = a.id), 0)
          AS balance_cents
      FROM accounts a
      WHERE a.profile_id = ? AND a.type = 'tarjeta' AND a.archived = 0
      ORDER BY a.created_at ASC, a.id ASC`,
    )
    .all(profileId)

  const referencias: Referencia[] = tarjetas.map((t) => {
    // Sin día de corte no hay estado de cuenta que calcular, pero las compras
    // a meses siguen contando: se miden contra hoy.
    const corte = t.cut_day ? ultimoCorte(hoy, t.cut_day) : hoy
    const proximo = t.cut_day ? siguienteDiaDelMes(corte, t.cut_day) : sumarMeses(hoy, 1)
    return { accountId: t.id, corte, proximo }
  })

  const movimientos = movimientosAlCorte(referencias)
  const msi = parcialidadesAlCorte(referencias)

  return tarjetas.map((t, i) => {
    const ref = referencias[i]!
    const mov = movimientos.get(t.id) ?? { deuda: 0, pagadoDespues: 0 }
    const cuotas = msi.get(t.id) ?? { facturado: 0, porFacturar: 0, proximo: 0 }
    const deudaCents = -t.balance_cents

    // Aritmética acumulada: cargos menos abonos hasta el corte. Si el usuario
    // venía pagando completo, los periodos anteriores se cancelan solos y
    // queda justo lo del corte en curso.
    const saldoAlCorte = -t.opening_cents + mov.deuda + cuotas.facturado
    const configurada = t.cut_day !== null

    return {
      accountId: t.id,
      name: t.name,
      creditLimitCents: t.credit_limit_cents ?? null,
      cutDay: t.cut_day ?? null,
      dueDay: t.due_day ?? null,
      deudaCents,
      disponibleCents: t.credit_limit_cents === null ? null : t.credit_limit_cents - deudaCents,
      fechaCorte: configurada ? ref.corte : null,
      fechaLimitePago: configurada && t.due_day ? siguienteDiaDelMes(ref.corte, t.due_day) : null,
      saldoAlCorteCents: configurada ? saldoAlCorte : null,
      pagadoDesdeCorteCents: configurada ? mov.pagadoDespues : null,
      // Lo que falta pagar de ese corte. Nunca negativo: pagar de más no
      // significa que el banco te deba, significa saldo a favor.
      paraNoGenerarInteresesCents: configurada
        ? Math.max(0, saldoAlCorte - mov.pagadoDespues)
        : null,
      msiPorFacturarCents: cuotas.porFacturar,
      msiProximoCorteCents: cuotas.proximo,
    }
  })
}

// ── Compras a meses sin intereses ─────────────────────────────────────────

const COMPRA_SELECT = `
  SELECT p.*, a.name AS account_name, c.name AS category_name,
    (SELECT t.id FROM transactions t WHERE t.msi_purchase_id = p.id) AS tx_id
  FROM msi_purchases p
  JOIN accounts a ON a.id = p.account_id
  LEFT JOIN categories c ON c.id = p.category_id
`

function mapCompra(row: any): CompraMSI {
  return {
    id: row.id,
    profileId: row.profile_id,
    accountId: row.account_id,
    accountName: row.account_name ?? '',
    concept: row.concept,
    totalCents: row.total_cents,
    months: row.months,
    purchaseDate: row.purchase_date,
    categoryId: row.category_id,
    categoryName: row.category_name ?? null,
    txId: row.tx_id ?? null,
    parcialidades: [],
  }
}

function adjuntarParcialidades(compras: CompraMSI[]): void {
  if (compras.length === 0) return
  const ids = compras.map((c) => c.id)
  const filas: any[] = db
    .prepare(
      `SELECT * FROM msi_installments WHERE purchase_id IN (${ids.map(() => '?').join(',')})
       ORDER BY purchase_id ASC, number ASC`,
    )
    .all(...ids)
  const porCompra = new Map<number, CompraMSI['parcialidades']>()
  for (const f of filas) {
    const lista = porCompra.get(f.purchase_id) ?? []
    lista.push({
      id: f.id,
      purchaseId: f.purchase_id,
      number: f.number,
      dueDate: f.due_date,
      amountCents: f.amount_cents,
    })
    porCompra.set(f.purchase_id, lista)
  }
  for (const compra of compras) compra.parcialidades = porCompra.get(compra.id) ?? []
}

export function compraMSI(id: number): CompraMSI | null {
  const row: any = db.prepare(`${COMPRA_SELECT} WHERE p.id = ?`).get(id)
  if (!row) return null
  const compra = mapCompra(row)
  adjuntarParcialidades([compra])
  return compra
}

export function comprasMSI(profileId: number): CompraMSI[] {
  const filas: any[] = db
    .prepare(`${COMPRA_SELECT} WHERE p.profile_id = ? ORDER BY p.purchase_date DESC, p.id DESC`)
    .all(profileId)
  const compras = filas.map(mapCompra)
  adjuntarParcialidades(compras)
  return compras
}

/**
 * Reescribe el calendario de una compra. Llamar dentro de una transacción.
 * Las parcialidades siempre suman exactamente el total: se recalculan enteras
 * en vez de parchearse.
 */
function escribirParcialidades(
  purchaseId: number,
  totalCents: number,
  months: number,
  purchaseDate: string,
  cutDay: number | null,
): void {
  // Repartir menos centavos que meses dejaría parcialidades en cero, que la
  // base rechaza. Vale más un error claro que un 500.
  if (totalCents < months) {
    throw httpError(400, `El monto no alcanza para repartirse en ${months} parcialidades`)
  }
  db.prepare('DELETE FROM msi_installments WHERE purchase_id = ?').run(purchaseId)
  const montos = parcialidades(totalCents, months)
  const fechas = fechasParcialidades(purchaseDate, months, cutDay)
  const insert = db.prepare(
    'INSERT INTO msi_installments (purchase_id, number, due_date, amount_cents) VALUES (?, ?, ?, ?)',
  )
  for (let i = 0; i < months; i++) insert.run(purchaseId, i + 1, fechas[i]!, montos[i]!)
}

export function crearCompraMSI(input: {
  profileId: number
  accountId: number
  concept: string
  totalCents: number
  months: number
  purchaseDate: string
  categoryId?: number | null
}): CompraMSI {
  const tarjeta = ensureTarjeta(input.profileId, input.accountId)
  if (input.categoryId) ensureCategory(input.profileId, input.categoryId, 'gasto')

  const id = inTransaction(() => {
    const compra = db
      .prepare(
        `INSERT INTO msi_purchases
          (profile_id, account_id, concept, total_cents, months, purchase_date, category_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.profileId,
        input.accountId,
        input.concept,
        input.totalCents,
        input.months,
        input.purchaseDate,
        input.categoryId ?? null,
      )
    const purchaseId = Number(compra.lastInsertRowid)

    // El cargo ancla: la compra completa, el día que se hizo.
    db.prepare(
      `INSERT INTO transactions
        (profile_id, account_id, type, amount_cents, date, category_id, note, msi_purchase_id)
       VALUES (?, ?, 'gasto', ?, ?, ?, ?, ?)`,
    ).run(
      input.profileId,
      input.accountId,
      input.totalCents,
      input.purchaseDate,
      input.categoryId ?? null,
      input.concept || `Compra a ${input.months} meses`,
      purchaseId,
    )

    escribirParcialidades(
      purchaseId,
      input.totalCents,
      input.months,
      input.purchaseDate,
      tarjeta.cut_day ?? null,
    )
    return purchaseId
  })

  return compraMSI(id)!
}

/**
 * Sincroniza una compra con su cargo ancla después de editar el movimiento, y
 * rehace el calendario. Es el mismo trato que reciben los abonos de deuda:
 * el libro manda y la compra lo sigue.
 */
export function sincronizarCompraMSI(
  purchaseId: number,
  cambios: { totalCents: number; purchaseDate: string; accountId: number },
): void {
  const compra: any = db.prepare('SELECT * FROM msi_purchases WHERE id = ?').get(purchaseId)
  if (!compra) return
  const sinCambio =
    compra.total_cents === cambios.totalCents &&
    compra.purchase_date === cambios.purchaseDate &&
    compra.account_id === cambios.accountId
  if (sinCambio) return

  const tarjeta: any = db.prepare('SELECT * FROM accounts WHERE id = ?').get(cambios.accountId)
  if (!tarjeta || tarjeta.type !== 'tarjeta') {
    throw httpError(400, 'El cargo de una compra a meses solo puede vivir en una tarjeta')
  }
  db.prepare(
    'UPDATE msi_purchases SET total_cents = ?, purchase_date = ?, account_id = ? WHERE id = ?',
  ).run(cambios.totalCents, cambios.purchaseDate, cambios.accountId, purchaseId)
  escribirParcialidades(
    purchaseId,
    cambios.totalCents,
    compra.months,
    cambios.purchaseDate,
    tarjeta.cut_day ?? null,
  )
}

/** Borra la compra, su calendario y el cargo que la ancla. */
export function borrarCompraMSI(profileId: number, id: number): void {
  const compra: any = db
    .prepare('SELECT * FROM msi_purchases WHERE id = ? AND profile_id = ?')
    .get(id, profileId)
  if (!compra) throw httpError(404, 'Compra a meses no encontrada')
  inTransaction(() => {
    db.prepare('DELETE FROM transactions WHERE msi_purchase_id = ?').run(id)
    // Las parcialidades se van por cascada con la compra.
    db.prepare('DELETE FROM msi_purchases WHERE id = ?').run(id)
  })
}
