import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, renameSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ProfileKind } from '../shared/types.ts'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const dataDir = path.join(root, 'data')
mkdirSync(dataDir, { recursive: true })

const dbPath = path.join(dataDir, 'finply.db')

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

db.exec(`
CREATE TABLE IF NOT EXISTS profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'personal' CHECK (kind IN ('personal', 'negocio')),
  accent TEXT NOT NULL DEFAULT 'verde' CHECK (accent IN ('verde', 'laton', 'cobalto', 'vino')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'efectivo' CHECK (type IN ('efectivo', 'banco', 'tarjeta', 'ahorro', 'otro')),
  currency TEXT NOT NULL DEFAULT 'MXN',
  opening_cents INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('ingreso', 'gasto')),
  UNIQUE (profile_id, name, kind)
);

CREATE TABLE IF NOT EXISTS debts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('por_cobrar', 'por_pagar')),
  counterparty TEXT NOT NULL,
  concept TEXT NOT NULL DEFAULT '',
  principal_cents INTEGER NOT NULL CHECK (principal_cents > 0),
  start_date TEXT NOT NULL,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'abierta' CHECK (status IN ('abierta', 'saldada')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS debt_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  debt_id INTEGER NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  date TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  type TEXT NOT NULL CHECK (type IN ('ingreso', 'gasto', 'transferencia')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  date TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  note TEXT NOT NULL DEFAULT '',
  transfer_account_id INTEGER REFERENCES accounts(id),
  debt_payment_id INTEGER REFERENCES debt_payments(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS investments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'otro' CHECK (kind IN ('cetes', 'acciones', 'cripto', 'fondo', 'inmueble', 'otro')),
  note TEXT NOT NULL DEFAULT '',
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS investment_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  investment_id INTEGER NOT NULL REFERENCES investments(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('aporte', 'retiro', 'valuacion')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  date TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS budgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  UNIQUE (profile_id, category_id)
);

CREATE TABLE IF NOT EXISTS goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  target_cents INTEGER NOT NULL CHECK (target_cents > 0),
  due_date TEXT,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'activa' CHECK (status IN ('activa', 'cumplida')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS goal_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  goal_id INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  date TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tx_profile_date ON transactions(profile_id, date);
CREATE INDEX IF NOT EXISTS idx_tx_account ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_accounts_profile ON accounts(profile_id);
CREATE INDEX IF NOT EXISTS idx_debts_profile ON debts(profile_id);
`)

// Migración: bases creadas antes de Inversiones no tienen esta columna.
const txColumns = db.prepare('PRAGMA table_info(transactions)').all() as { name: string }[]
if (!txColumns.some((c) => c.name === 'investment_entry_id')) {
  db.exec(
    'ALTER TABLE transactions ADD COLUMN investment_entry_id INTEGER REFERENCES investment_entries(id) ON DELETE SET NULL',
  )
}

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
  }
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
