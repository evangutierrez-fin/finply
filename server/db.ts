import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, renameSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ProfileKind } from '../shared/types.ts'
import { migrate } from './migrations.ts'

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
      ORDER BY a.archived ASC, a.created_at ASC, a.id ASC`,
    )
    .all(profileId)
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
  }
}

export function mapProfile(row: any) {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    accent: row.accent,
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
    tags: [] as { id: number; name: string }[],
  }
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
    payments: [] as unknown[],
  }
}

export const TX_SELECT = `
  SELECT t.*, a.name AS account_name, c.name AS category_name, ta.name AS transfer_account_name
  FROM transactions t
  JOIN accounts a ON a.id = t.account_id
  LEFT JOIN categories c ON c.id = t.category_id
  LEFT JOIN accounts ta ON ta.id = t.transfer_account_id
`

export function getTx(id: number): any {
  return db.prepare(`${TX_SELECT} WHERE t.id = ?`).get(id)
}

/** Recalcula el estado de una deuda según sus abonos. */
export function refreshDebtStatus(debtId: number): void {
  db.prepare(
    `UPDATE debts SET status = CASE
      WHEN (SELECT COALESCE(SUM(amount_cents), 0) FROM debt_payments WHERE debt_id = ?) >= principal_cents
      THEN 'saldada' ELSE 'abierta' END
    WHERE id = ?`,
  ).run(debtId, debtId)
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
  }
}

/**
 * Inversiones de un perfil con aportado y valor actual calculados.
 * El valor recorre las entradas en orden: una valuación fija el valor,
 * los aportes/retiros posteriores lo ajustan.
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
    const entries = entriesByInv.get(inv.id) ?? []
    let invested = 0
    let value = 0
    for (const e of entries) {
      if (e.type === 'aporte') {
        invested += e.amount_cents
        value += e.amount_cents
      } else if (e.type === 'retiro') {
        invested -= e.amount_cents
        value = Math.max(0, value - e.amount_cents)
      } else {
        value = e.amount_cents
      }
    }
    return {
      id: inv.id,
      profileId: inv.profile_id,
      name: inv.name,
      kind: inv.kind,
      note: inv.note,
      archived: inv.archived === 1,
      createdAt: inv.created_at,
      investedCents: invested,
      valueCents: value,
      entries: entries.map(mapInvestmentEntry),
    }
  })
}
