import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, renameSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ProfileKind } from '../shared/types.ts'
import { MODULO_IDS, resolverModulos, type ModuloId } from '../shared/modulos.ts'
import { migrate } from './migrations.ts'
import { recorrer, type EntradaInversion } from '../shared/inversiones.ts'
import { xirr, type Flujo } from '../shared/rendimiento.ts'
import { hoyISO } from '../shared/fechas.ts'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

// FINPLY_DB permite apuntar a otro archivo (las pruebas usan uno temporal
// para no tocar nunca el libro real).
const rutaPorOmision = path.join(root, 'data', 'finply.db')

// Red de seguridad: bajo `node --test`, abrir la base por omisión significa
// que alguien importó este módulo antes de fijar FINPLY_DB — casi siempre un
// `import` estático de un módulo del servidor en un archivo de prueba, que se
// eleva por encima de `levantar()`. Pasó una vez y llenó el libro real de
// datos de prueba; mejor tronar aquí que descubrirlo después.
if (process.env.NODE_TEST_CONTEXT && !process.env.FINPLY_DB) {
  throw new Error(
    'db.ts se cargó en una prueba sin FINPLY_DB. Algún archivo de prueba importa ' +
      'un módulo del servidor de forma estática: usa `await import(...)` después de ' +
      'levantar(), o mueve las funciones puras a un módulo que no toque la base.',
  )
}

export const dbPath = process.env.FINPLY_DB
  ? path.resolve(process.env.FINPLY_DB)
  : rutaPorOmision

export const dataDir = path.dirname(dbPath)
mkdirSync(dataDir, { recursive: true })

// Migración del nombre anterior (tomo.db) sin perder datos.
const legacyPath = path.join(dataDir, 'tomo.db')
if (!existsSync(dbPath) && existsSync(legacyPath)) {
  for (const suffix of ['', '-wal', '-shm']) {
    if (existsSync(legacyPath + suffix)) renameSync(legacyPath + suffix, dbPath + suffix)
  }
}

export const db = new DatabaseSync(dbPath)

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
`)

migrate(db, { backupDir: path.join(dataDir, 'respaldos') })

/** Ejecuta fn dentro de una transacción SQLite; revierte si lanza. */
export function inTransaction<T>(fn: () => T): T {
  db.exec('BEGIN')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

/** Error con código HTTP, para que el middleware de errores lo traduzca. */
export function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status })
}

/** La cuenta debe existir y pertenecer al perfil. */
export function ensureAccount(profileId: number, accountId: number): void {
  const row = db
    .prepare('SELECT id FROM accounts WHERE id = ? AND profile_id = ?')
    .get(accountId, profileId)
  if (!row) throw httpError(400, 'La cuenta no pertenece a este perfil')
}

/**
 * La categoría debe existir, pertenecer al perfil y ser del mismo tipo que el
 * movimiento: sin esto una partida puede acabar clasificada con la categoría
 * de otro libro, o un gasto etiquetado con una categoría de ingreso.
 */
export function ensureCategory(
  profileId: number,
  categoryId: number,
  txType: 'ingreso' | 'gasto',
): void {
  const row: any = db
    .prepare('SELECT kind FROM categories WHERE id = ? AND profile_id = ?')
    .get(categoryId, profileId)
  if (!row) throw httpError(400, 'La categoría no pertenece a este perfil')
  if (row.kind !== txType) {
    throw httpError(
      400,
      `La categoría es de ${row.kind} y el movimiento es de ${txType}`,
    )
  }
}

export const DEFAULT_CATEGORIES: Record<ProfileKind, { kind: 'ingreso' | 'gasto'; name: string }[]> = {
  personal: [
    { kind: 'gasto', name: 'Comida' },
    { kind: 'gasto', name: 'Súper' },
    { kind: 'gasto', name: 'Transporte' },
    { kind: 'gasto', name: 'Renta' },
    { kind: 'gasto', name: 'Servicios' },
    { kind: 'gasto', name: 'Salud' },
    { kind: 'gasto', name: 'Ocio' },
    { kind: 'gasto', name: 'Otros' },
    { kind: 'ingreso', name: 'Sueldo' },
    { kind: 'ingreso', name: 'Intereses' },
    { kind: 'ingreso', name: 'Otros' },
  ],
  negocio: [
    { kind: 'gasto', name: 'Insumos' },
    { kind: 'gasto', name: 'Nómina' },
    { kind: 'gasto', name: 'Renta' },
    { kind: 'gasto', name: 'Servicios' },
    { kind: 'gasto', name: 'Equipo' },
    { kind: 'gasto', name: 'Otros' },
    { kind: 'ingreso', name: 'Ventas' },
    { kind: 'ingreso', name: 'Otros' },
  ],
}

export function seedCategories(profileId: number, kind: ProfileKind): void {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO categories (profile_id, name, kind) VALUES (?, ?, ?)',
  )
  for (const c of DEFAULT_CATEGORIES[kind]) insert.run(profileId, c.name, c.kind)
}

/** Cuentas de un perfil con saldo calculado y conteo de movimientos. */
export function accountsWithBalance(profileId: number): unknown[] {
  return db
    .prepare(
      `SELECT a.*,
        a.opening_cents
          + COALESCE((SELECT SUM(CASE
              WHEN t.type = 'ingreso' THEN t.amount_cents
              ELSE -t.amount_cents END)
            FROM transactions t WHERE t.account_id = a.id), 0)
          + COALESCE((SELECT SUM(t.amount_cents)
            FROM transactions t WHERE t.transfer_account_id = a.id), 0)
          AS balance_cents,
        (SELECT COUNT(*) FROM transactions t
          WHERE t.account_id = a.id OR t.transfer_account_id = a.id) AS tx_count
      FROM accounts a
      WHERE a.profile_id = ?
      ORDER BY a.archived ASC, a.sort_order ASC, a.created_at ASC, a.id ASC`,
    )
    .all(profileId)
}

/**
 * Saldo de una cuenta a una fecha, como expresión SQL. Misma aritmética que
 * `accountsWithBalance`: apertura, más lo que entró y salió, más la pata que
 * recibe de las transferencias. Si las dos se separaran, el corte de
 * conciliación cuadraría contra un saldo que la vista de Cuentas no enseña.
 *
 * Es un fragmento y no una función que consulta para que el listado de cortes
 * lo resuelva **en la misma consulta** en vez de una por corte (R11).
 *
 * @param cuenta alias de la fila de `accounts` en la consulta que lo usa
 * @param fecha  expresión de fecha (una columna o un `?`)
 * @param soloConciliados lo que vuelve útil al corte (D19): compara lo que el
 *   banco dice contra lo que el usuario ya palomeó, no contra el libro entero
 */
export function saldoAFecha(cuenta: string, fecha: string, soloConciliados = false): string {
  const filtro = soloConciliados ? 'AND t.reconciled_at IS NOT NULL' : ''
  return `(${cuenta}.opening_cents
    + COALESCE((SELECT SUM(CASE
        WHEN t.type = 'ingreso' THEN t.amount_cents ELSE -t.amount_cents END)
      FROM transactions t
      WHERE t.account_id = ${cuenta}.id AND t.date <= ${fecha} ${filtro}), 0)
    + COALESCE((SELECT SUM(t.amount_cents) FROM transactions t
      WHERE t.transfer_account_id = ${cuenta}.id AND t.date <= ${fecha} ${filtro}), 0))`
}

export function mapAccount(row: any) {
  return {
    id: row.id,
    profileId: row.profile_id,
    name: row.name,
    type: row.type,
    currency: row.currency,
    openingCents: row.opening_cents,
    archived: row.archived === 1,
    balanceCents: row.balance_cents ?? 0,
    txCount: row.tx_count ?? 0,
    creditLimitCents: row.credit_limit_cents ?? null,
    cutDay: row.cut_day ?? null,
    dueDay: row.due_day ?? null,
    /** Debajo de esto, Finply avisa. `null` = sin aviso. */
    minBalanceCents: row.min_balance_cents ?? null,
    institution: row.institution ?? '',
    sortOrder: row.sort_order ?? 0,
    /** Lo que cuesta la tarjeta, copiado del contrato del usuario (Fase 14). */
    annualRateBp: row.annual_rate_bp ?? null,
    minPaymentBp: row.min_payment_bp ?? null,
    minPaymentFloorCents: row.min_payment_floor_cents ?? null,
  }
}

/** La cuenta existe, es del perfil y es una tarjeta. */
export function ensureTarjeta(profileId: number, accountId: number): any {
  const row: any = db
    .prepare('SELECT * FROM accounts WHERE id = ? AND profile_id = ?')
    .get(accountId, profileId)
  if (!row) throw httpError(400, 'La cuenta no pertenece a este perfil')
  if (row.type !== 'tarjeta') {
    throw httpError(400, 'Las compras a meses se registran en una cuenta de tipo tarjeta')
  }
  return row
}

/**
 * Los módulos activos de un perfil. Lo guardado son **overrides**: sin fila
 * manda el juego por omisión del tipo, que es lo que vuelve inofensiva la
 * migración 13 y lo que hace que un respaldo viejo no deje a nadie sin
 * secciones (ver `shared/modulos.ts`).
 */
export function modulosDe(profileId: number, kind?: ProfileKind): ModuloId[] {
  // Una sola consulta, con `LEFT JOIN`, y no dos: esto lo llaman las alertas y
  // el calendario en cada carga del Resumen, donde R11 cuenta las consultas y
  // hay una prueba con tope. El tipo viaja repetido en cada fila y no importa.
  const filas = db
    .prepare(
      `SELECT p.kind AS kind, m.module AS module, m.enabled AS enabled
         FROM profiles p LEFT JOIN profile_modules m ON m.profile_id = p.id
        WHERE p.id = ?`,
    )
    .all(profileId) as any[]
  // Un perfil que no existe no tiene secciones; quien pregunte se calla.
  if (filas.length === 0) return []
  const overrides = new Map(
    filas.filter((f) => f.module !== null).map((f) => [String(f.module), f.enabled === 1]),
  )
  return resolverModulos(kind ?? (filas[0].kind as ProfileKind), overrides)
}

/**
 * Escribe la elección del usuario. Se guardan las **ocho** filas, no solo las
 * encendidas: así la elección sobrevive a un cambio de tipo de perfil —si
 * apagaste Metas, siguen apagadas aunque el libro pase de personal a negocio—
 * y "lo apagué" no se confunde nunca con "no opiné".
 */
export function guardarModulos(profileId: number, activos: readonly ModuloId[]) {
  const stmt = db.prepare(
    `INSERT INTO profile_modules (profile_id, module, enabled) VALUES (?, ?, ?)
     ON CONFLICT (profile_id, module) DO UPDATE SET enabled = excluded.enabled`,
  )
  for (const id of MODULO_IDS) stmt.run(profileId, id, activos.includes(id) ? 1 : 0)
}

export function mapProfile(row: any, modulos?: ModuloId[]) {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    accent: row.accent,
    // Nulos mientras el perfil use un preset, que es como nacen todos.
    accentHex: row.accent_hex ?? null,
    accentHexDark: row.accent_hex_dark ?? null,
    dimensionLabel: row.dimension_label ?? 'Proyecto',
    // Una moneda por perfil (D18). Las cuentas la heredan; una que difiera se
    // señala en la vista en vez de convertirse en silencio.
    currency: row.currency ?? 'MXN',
    // Quien ya tenga la lista la pasa: el listado de perfiles resuelve los
    // overrides de todos en una consulta, no en una por perfil (R11).
    modules: modulos ?? modulosDe(row.id, row.kind),
    // Las preferencias de la Fase 21. Nulas significan "lo de siempre", y por
    // eso un libro que no toque nada se ve exactamente igual que ayer.
    navOrder: row.nav_order ? String(row.nav_order).split(',') : null,
    homeView: row.home_view ?? null,
    dateFormat: row.date_format ?? 'corto',
    weekStart: row.week_start ?? 1,
    hideCents: row.hide_cents === 1,
    createdAt: row.created_at,
  }
}

export function mapTx(row: any) {
  return {
    id: row.id,
    profileId: row.profile_id,
    accountId: row.account_id,
    accountName: row.account_name ?? '',
    type: row.type,
    amountCents: row.amount_cents,
    date: row.date,
    categoryId: row.category_id,
    categoryName: row.category_name ?? null,
    note: row.note,
    transferAccountId: row.transfer_account_id,
    transferAccountName: row.transfer_account_name ?? null,
    debtPaymentId: row.debt_payment_id,
    investmentEntryId: row.investment_entry_id ?? null,
    msiPurchaseId: row.msi_purchase_id ?? null,
    debtId: row.debt_id ?? null,
    /** Si viene, este movimiento es de un arrendamiento, con su papel (Fase 15). */
    rentalId: row.rental_id ?? null,
    rentalRole: row.rental_role ?? null,
    invoiceId: row.invoice_id ?? null,
    counterpartyId: row.counterparty_id ?? null,
    counterpartyName: row.counterparty_name ?? null,
    costCenterId: row.cost_center_id ?? null,
    costCenterName: row.cost_center_name ?? null,
    taxCents: row.tax_cents ?? 0,
    deductible: row.deductible === 1,
    /** Fecha en que se marcó contra el estado de cuenta; `null` sin conciliar. */
    reconciledAt: row.reconciled_at ?? null,
    /** Si viene, este movimiento devuelve ese gasto (D6: no es ingreso). */
    refundOfId: row.refund_of_id ?? null,
    tags: [] as { id: number; name: string }[],
    /** Vacío = sin dividir, y entonces manda `categoryId`. */
    splits: [] as TxSplit[],
    /** Solo la ficha del recibo; los bytes se piden aparte. */
    attachments: [] as TxAttachment[],
    /** Las notas de la libreta atadas a esta partida (Fase 20), solo el título. */
    notes: [] as { id: number; title: string }[],
    /**
     * Los campos propios del perfil contestados en esta partida (Fase 21),
     * por id de campo. Vacío significa "no contestó ninguno", que es lo que
     * pasa en un libro sin campos propios — es decir, en casi todos.
     */
    fields: {} as Record<string, string>,
  }
}

export interface TxSplit {
  id: number
  categoryId: number | null
  categoryName: string | null
  amountCents: number
  note: string
}

export interface TxAttachment {
  id: number
  filename: string
  mime: string
  sizeBytes: number
  createdAt: string
}

/**
 * Reemplaza el reparto de un movimiento. Llamar dentro de una transacción.
 *
 * Un movimiento dividido **no tiene categoría propia**: la deja en nulo. Si la
 * conservara habría dos verdades sobre el mismo ticket —la categoría de arriba
 * y la de los renglones— y cada consulta tendría que decidir a cuál creerle.
 */
export function setTxSplits(
  txId: number,
  splits: { categoryId?: number | null; amountCents: number; note: string }[],
): void {
  db.prepare('DELETE FROM tx_splits WHERE tx_id = ?').run(txId)
  if (splits.length === 0) return
  const insert = db.prepare(
    'INSERT INTO tx_splits (tx_id, category_id, amount_cents, note) VALUES (?, ?, ?, ?)',
  )
  for (const r of splits) insert.run(txId, r.categoryId ?? null, r.amountCents, r.note)
  db.prepare('UPDATE transactions SET category_id = NULL WHERE id = ?').run(txId)
}

/** Los renglones de varios movimientos en una sola consulta (R11: nada de N+1). */
export function attachSplits(txs: { id: number; splits: TxSplit[] }[]): void {
  if (txs.length === 0) return
  const ids = txs.map((t) => t.id)
  const rows = db
    .prepare(
      `SELECT s.id, s.tx_id, s.category_id, s.amount_cents, s.note, c.name AS category_name
       FROM tx_splits s
       LEFT JOIN categories c ON c.id = s.category_id
       WHERE s.tx_id IN (${ids.map(() => '?').join(',')})
       ORDER BY s.id ASC`,
    )
    .all(...ids) as any[]
  const porTx = new Map<number, TxSplit[]>()
  for (const r of rows) {
    const lista = porTx.get(r.tx_id) ?? []
    lista.push({
      id: r.id,
      categoryId: r.category_id ?? null,
      categoryName: r.category_name ?? null,
      amountCents: r.amount_cents,
      note: r.note,
    })
    porTx.set(r.tx_id, lista)
  }
  for (const tx of txs) tx.splits = porTx.get(tx.id) ?? []
}

/**
 * La ficha de los recibos, **sin los bytes**. `data_b64` nunca sale de aquí en
 * un listado: un mes de tickets serían decenas de megas en cada carga.
 */
export function attachAdjuntos(txs: { id: number; attachments: TxAttachment[] }[]): void {
  if (txs.length === 0) return
  const ids = txs.map((t) => t.id)
  const rows = db
    .prepare(
      `SELECT id, tx_id, filename, mime, size_bytes, created_at FROM tx_attachments
       WHERE tx_id IN (${ids.map(() => '?').join(',')})
       ORDER BY id ASC`,
    )
    .all(...ids) as any[]
  const porTx = new Map<number, TxAttachment[]>()
  for (const r of rows) {
    const lista = porTx.get(r.tx_id) ?? []
    lista.push({
      id: r.id,
      filename: r.filename,
      mime: r.mime,
      sizeBytes: r.size_bytes,
      createdAt: r.created_at,
    })
    porTx.set(r.tx_id, lista)
  }
  for (const tx of txs) tx.attachments = porTx.get(tx.id) ?? []
}

/**
 * Las notas atadas a estos movimientos, en una sola consulta (R11).
 *
 * Solo el título, y sin el cuerpo a propósito: en el libro se enseña que
 * **hay** una nota, no la nota entera. Un mes de apuntes largos serían cientos
 * de kilobytes en cada carga del listado, que es el mismo cuidado que ya se
 * tiene con los bytes de un recibo.
 */
export function attachNotas(txs: { id: number; notes: { id: number; title: string }[] }[]): void {
  if (txs.length === 0) return
  const ids = txs.map((t) => t.id)
  const rows = db
    .prepare(
      `SELECT id, tx_id, title, body FROM notes
       WHERE tx_id IN (${ids.map(() => '?').join(',')})
       ORDER BY id ASC`,
    )
    .all(...ids) as any[]
  const porTx = new Map<number, { id: number; title: string }[]>()
  for (const r of rows) {
    const lista = porTx.get(r.tx_id) ?? []
    // Una nota sin título se nombra con su primer renglón: "nota" a secas no
    // dice nada, y el usuario ya escribió cómo se llama esto.
    const primera = String(r.body ?? '').split('\n')[0]?.trim() ?? ''
    lista.push({ id: r.id, title: r.title || primera.slice(0, 60) || 'Nota' })
    porTx.set(r.tx_id, lista)
  }
  for (const tx of txs) tx.notes = porTx.get(tx.id) ?? []
}

/** Todas las etiquetas deben existir y ser del perfil. */
export function ensureTags(profileId: number, tagIds: number[]): void {
  if (tagIds.length === 0) return
  const rows = db
    .prepare(
      `SELECT id FROM tags WHERE profile_id = ? AND id IN (${tagIds.map(() => '?').join(',')})`,
    )
    .all(profileId, ...tagIds) as { id: number }[]
  if (rows.length !== new Set(tagIds).size) {
    throw httpError(400, 'Alguna etiqueta no pertenece a este perfil')
  }
}

/** Reemplaza las etiquetas de un movimiento. Llamar dentro de una transacción. */
export function setTxTags(txId: number, tagIds: number[]): void {
  db.prepare('DELETE FROM transaction_tags WHERE transaction_id = ?').run(txId)
  if (tagIds.length === 0) return
  const insert = db.prepare(
    'INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)',
  )
  for (const tagId of new Set(tagIds)) insert.run(txId, tagId)
}

/**
 * Etiquetas de varios movimientos en una sola consulta: evita el N+1 al
 * listar (R11 — nada de una consulta por fila).
 */
export function attachTags(txs: { id: number; tags: { id: number; name: string }[] }[]): void {
  if (txs.length === 0) return
  const ids = txs.map((t) => t.id)
  const rows = db
    .prepare(
      `SELECT tt.transaction_id, t.id, t.name FROM transaction_tags tt
       JOIN tags t ON t.id = tt.tag_id
       WHERE tt.transaction_id IN (${ids.map(() => '?').join(',')})
       ORDER BY t.name ASC`,
    )
    .all(...ids) as { transaction_id: number; id: number; name: string }[]
  const byTx = new Map<number, { id: number; name: string }[]>()
  for (const r of rows) {
    const list = byTx.get(r.transaction_id) ?? []
    list.push({ id: r.id, name: r.name })
    byTx.set(r.transaction_id, list)
  }
  for (const tx of txs) tx.tags = byTx.get(tx.id) ?? []
}

export function mapDebt(row: any) {
  return {
    id: row.id,
    profileId: row.profile_id,
    direction: row.direction,
    counterparty: row.counterparty,
    concept: row.concept,
    principalCents: row.principal_cents,
    startDate: row.start_date,
    dueDate: row.due_date,
    status: row.status,
    paidCents: row.paid_cents ?? 0,
    annualRateBp: row.annual_rate_bp ?? 0,
    termMonths: row.term_months ?? null,
    downPaymentCents: row.down_payment_cents ?? 0,
    // Comisión de apertura (D30): la debes, pero nunca te la depositaron. No
    // es principal ni es enganche — es lo que encarece el crédito sin que se
    // vea en la tasa del contrato.
    originationFeeCents: row.origination_fee_cents ?? 0,
    interestPaidCents: row.interest_paid_cents ?? 0,
    capitalPaidCents: row.capital_paid_cents ?? 0,
    // Lo que de verdad debes: solo el capital abonado baja el principal. Con
    // piso en cero, porque pagar de más no vuelve acreedor al deudor.
    balanceCents: Math.max(0, row.principal_cents - (row.capital_paid_cents ?? 0)),
    payments: [] as unknown[],
  }
}

export const TX_SELECT = `
  SELECT t.*, a.name AS account_name, c.name AS category_name, ta.name AS transfer_account_name,
    cp.name AS counterparty_name, cc.name AS cost_center_name
  FROM transactions t
  JOIN accounts a ON a.id = t.account_id
  LEFT JOIN categories c ON c.id = t.category_id
  LEFT JOIN accounts ta ON ta.id = t.transfer_account_id
  LEFT JOIN counterparties cp ON cp.id = t.counterparty_id
  LEFT JOIN cost_centers cc ON cc.id = t.cost_center_id
`

export function getTx(id: number): any {
  return db.prepare(`${TX_SELECT} WHERE t.id = ?`).get(id)
}

/**
 * Recalcula el estado de una deuda según el **capital** abonado, no según el
 * total pagado: la parte de cada abono que fue interés no baja el principal.
 * En una deuda sin tasa `interest_cents` es cero y esto da lo mismo de antes.
 */
export function refreshDebtStatus(debtId: number): void {
  db.prepare(
    `UPDATE debts SET status = CASE
      WHEN (SELECT COALESCE(SUM(amount_cents - interest_cents), 0)
            FROM debt_payments WHERE debt_id = ?) >= principal_cents
      THEN 'saldada' ELSE 'abierta' END
    WHERE id = ?`,
  ).run(debtId, debtId)
}

/**
 * Saldo insoluto de una deuda: principal menos el capital abonado. Es contra
 * esto que se calcula el interés del siguiente abono.
 */
export function debtBalance(debtId: number): number {
  const row: any = db
    .prepare(
      `SELECT d.principal_cents
         - COALESCE((SELECT SUM(p.amount_cents - p.interest_cents)
            FROM debt_payments p WHERE p.debt_id = d.id), 0) AS saldo
       FROM debts d WHERE d.id = ?`,
    )
    .get(debtId)
  return row ? Math.max(0, row.saldo) : 0
}

/** Recalcula el estado de una meta según sus aportes. */
export function refreshGoalStatus(goalId: number): void {
  db.prepare(
    `UPDATE goals SET status = CASE
      WHEN (SELECT COALESCE(SUM(amount_cents), 0) FROM goal_entries WHERE goal_id = ?) >= target_cents
      THEN 'cumplida' ELSE 'activa' END
    WHERE id = ?`,
  ).run(goalId, goalId)
}

export function mapInvestmentEntry(row: any) {
  return {
    id: row.id,
    investmentId: row.investment_id,
    type: row.type,
    amountCents: row.amount_cents,
    date: row.date,
    note: row.note,
    unitsE8: row.units_e8 ?? null,
    unitPriceCents: row.unit_price_cents ?? null,
  }
}

/**
 * Rendimiento anualizado de una inversión: los aportes salen (negativos), los
 * retiros entran, y el valor de hoy entra como si se liquidara todo. Es el
 * único uso: la tasa que hace que esa serie sume cero (`shared/rendimiento.ts`).
 */
function rendimientoDe(entries: EntradaInversion[], valueCents: number, hoy = hoyISO()) {
  const flujos: Flujo[] = entries
    .filter((e) => e.type !== 'valuacion')
    .map((e) => ({
      date: e.date,
      amountCents: e.type === 'aporte' ? -e.amountCents : e.amountCents,
    }))
  if (flujos.length === 0) return null
  // El valor de hoy cierra la serie. Si la última fecha ya es futura —una
  // aportación con fecha adelantada— se respeta, para no meter un flujo
  // anterior al último y volver negativo el plazo.
  const ultima = flujos.reduce((m, f) => (f.date > m ? f.date : m), flujos[0]!.date)
  flujos.push({ date: hoy > ultima ? hoy : ultima, amountCents: valueCents })
  return xirr(flujos)
}

/**
 * Inversiones de un perfil con aportado, valor actual y rendimiento.
 *
 * El recorrido vive en `shared/inversiones.ts` y lo comparten esta función, la
 * serie de patrimonio de los reportes y la gráfica de la vista: son tres
 * lugares que deben dar el mismo número, y por eso es un solo código.
 */
export function investmentsWithTotals(profileId: number) {
  const investments: any[] = db
    .prepare('SELECT * FROM investments WHERE profile_id = ? ORDER BY archived ASC, id ASC')
    .all(profileId)
  const ids = investments.map((i) => i.id)
  const entriesByInv = new Map<number, any[]>()
  if (ids.length > 0) {
    const entries: any[] = db
      .prepare(
        `SELECT * FROM investment_entries WHERE investment_id IN (${ids.map(() => '?').join(',')})
         ORDER BY date ASC, id ASC`,
      )
      .all(...ids)
    for (const e of entries) {
      const list = entriesByInv.get(e.investment_id) ?? []
      list.push(e)
      entriesByInv.set(e.investment_id, list)
    }
  }
  return investments.map((inv) => {
    const entries = (entriesByInv.get(inv.id) ?? []).map(mapInvestmentEntry)
    const paso = recorrer(entries)
    return {
      id: inv.id,
      profileId: inv.profile_id,
      name: inv.name,
      kind: inv.kind,
      note: inv.note,
      archived: inv.archived === 1,
      createdAt: inv.created_at,
      investedCents: paso.investedCents,
      aportadoCents: paso.aportadoCents,
      retiradoCents: paso.retiradoCents,
      gananciaCents: paso.gananciaCents,
      // Las dos mitades de esa misma ganancia (D31): lo ya cobrado y lo que
      // sigue en papel. Suman la de arriba al centavo.
      costoCents: paso.costoCents,
      gananciaRealizadaCents: paso.gananciaRealizadaCents,
      gananciaEnPapelCents: paso.gananciaEnPapelCents,
      valueCents: paso.valueCents,
      unitsE8: paso.unitsE8,
      rendimientoAnual: rendimientoDe(entries, paso.valueCents),
      puntos: paso.puntos,
      entries,
    }
  })
}
