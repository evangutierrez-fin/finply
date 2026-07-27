// Migraciones del esquema, numeradas y aplicadas una sola vez.
//
// El número de la última migración aplicada vive en `PRAGMA user_version`,
// dentro del propio archivo .db. Para cambiar el esquema se agrega una entrada
// nueva al final de MIGRATIONS — nunca se edita una ya publicada, porque las
// bases de los demás ya la corrieron.

import { mkdirSync } from 'node:fs'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'

export interface Migration {
  id: number
  name: string
  up: (db: DatabaseSync) => void
}

const BASE_SCHEMA = `
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
`

function hasColumn(db: DatabaseSync, table: string, column: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  return columns.some((c) => c.name === column)
}

export const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: 'esquema base',
    up: (db) => db.exec(BASE_SCHEMA),
  },
  {
    id: 2,
    name: 'movimientos ligados a inversiones',
    up: (db) => {
      if (hasColumn(db, 'transactions', 'investment_entry_id')) return
      db.exec(
        `ALTER TABLE transactions ADD COLUMN investment_entry_id INTEGER
         REFERENCES investment_entries(id) ON DELETE SET NULL`,
      )
    },
  },
  {
    id: 3,
    name: 'presupuestos por mes',
    up: (db) => {
      if (hasColumn(db, 'budgets', 'month')) return
      // SQLite no permite cambiar un UNIQUE con ALTER: hay que reconstruir.
      // Los topes que ya existían pasan al mes en curso, que es donde el
      // usuario los estaba usando; los meses anteriores nunca tuvieron tope.
      db.exec(`
        CREATE TABLE budgets_nuevo (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
          category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
          month TEXT NOT NULL,
          amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
          UNIQUE (profile_id, category_id, month)
        );

        INSERT INTO budgets_nuevo (profile_id, category_id, month, amount_cents)
          SELECT profile_id, category_id, strftime('%Y-%m', 'now', 'localtime'), amount_cents
          FROM budgets;

        DROP TABLE budgets;
        ALTER TABLE budgets_nuevo RENAME TO budgets;

        CREATE INDEX IF NOT EXISTS idx_budgets_profile_month ON budgets(profile_id, month);
      `)
    },
  },
  {
    id: 4,
    name: 'etiquetas en movimientos',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS tags (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          UNIQUE (profile_id, name)
        );

        CREATE TABLE IF NOT EXISTS transaction_tags (
          transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
          tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
          PRIMARY KEY (transaction_id, tag_id)
        );

        CREATE INDEX IF NOT EXISTS idx_tx_tags_tag ON transaction_tags(tag_id);
        -- Los filtros por rango de fecha y los reportes por mes salen de aquí.
        CREATE INDEX IF NOT EXISTS idx_tx_profile_type_date
          ON transactions(profile_id, type, date);
      `)
    },
  },
  {
    id: 5,
    name: 'lotes de importación',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS import_batches (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
          filename TEXT NOT NULL DEFAULT '',
          row_count INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        );
      `)
      // Sin esta columna no hay forma de deshacer una importación: es lo que
      // ata cada partida al lote que la trajo.
      if (!hasColumn(db, 'transactions', 'import_batch_id')) {
        db.exec(
          `ALTER TABLE transactions ADD COLUMN import_batch_id INTEGER
           REFERENCES import_batches(id) ON DELETE SET NULL`,
        )
      }
      db.exec('CREATE INDEX IF NOT EXISTS idx_tx_batch ON transactions(import_batch_id)')
    },
  },
  {
    id: 6,
    name: 'crédito: tarjetas, tasa de deuda y meses sin intereses',
    up: (db) => {
      // Tarjetas. Todo nace nulo: una cuenta sin configurar se comporta
      // exactamente igual que antes de esta migración.
      if (!hasColumn(db, 'accounts', 'credit_limit_cents')) {
        db.exec(
          `ALTER TABLE accounts ADD COLUMN credit_limit_cents INTEGER
           CHECK (credit_limit_cents IS NULL OR credit_limit_cents >= 0)`,
        )
      }
      if (!hasColumn(db, 'accounts', 'cut_day')) {
        db.exec(
          `ALTER TABLE accounts ADD COLUMN cut_day INTEGER
           CHECK (cut_day IS NULL OR (cut_day BETWEEN 1 AND 31))`,
        )
      }
      if (!hasColumn(db, 'accounts', 'due_day')) {
        db.exec(
          `ALTER TABLE accounts ADD COLUMN due_day INTEGER
           CHECK (due_day IS NULL OR (due_day BETWEEN 1 AND 31))`,
        )
      }

      // Deudas con tasa y plazo. La tasa va en puntos base (24.5 % = 2450)
      // para no guardar flotantes en la base; 0 es una deuda sin intereses,
      // que es justo lo que eran todas hasta ahora.
      if (!hasColumn(db, 'debts', 'annual_rate_bp')) {
        db.exec(
          `ALTER TABLE debts ADD COLUMN annual_rate_bp INTEGER NOT NULL DEFAULT 0
           CHECK (annual_rate_bp >= 0)`,
        )
      }
      if (!hasColumn(db, 'debts', 'term_months')) {
        db.exec(
          `ALTER TABLE debts ADD COLUMN term_months INTEGER
           CHECK (term_months IS NULL OR (term_months BETWEEN 1 AND 600))`,
        )
      }

      // Meses sin intereses: la compra es un cargo único a la tarjeta —así
      // consume tu línea de crédito— y las parcialidades son el calendario de
      // lo que el banco te factura en cada corte.
      db.exec(`
        CREATE TABLE IF NOT EXISTS msi_purchases (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
          account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          concept TEXT NOT NULL DEFAULT '',
          total_cents INTEGER NOT NULL CHECK (total_cents > 0),
          months INTEGER NOT NULL CHECK (months BETWEEN 2 AND 60),
          purchase_date TEXT NOT NULL,
          category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS msi_installments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          purchase_id INTEGER NOT NULL REFERENCES msi_purchases(id) ON DELETE CASCADE,
          number INTEGER NOT NULL,
          due_date TEXT NOT NULL,
          amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
          UNIQUE (purchase_id, number)
        );

        CREATE INDEX IF NOT EXISTS idx_msi_purchases_account ON msi_purchases(account_id);
        CREATE INDEX IF NOT EXISTS idx_msi_installments_due
          ON msi_installments(purchase_id, due_date);
      `)

      // Ata el cargo de la compra con su calendario: sin esto, el saldo al
      // corte contaría dos veces la misma compra (el cargo completo y además
      // sus parcialidades).
      if (!hasColumn(db, 'transactions', 'msi_purchase_id')) {
        db.exec(
          `ALTER TABLE transactions ADD COLUMN msi_purchase_id INTEGER
           REFERENCES msi_purchases(id) ON DELETE SET NULL`,
        )
      }
      db.exec('CREATE INDEX IF NOT EXISTS idx_tx_msi ON transactions(msi_purchase_id)')
      // Los pagos a una tarjeta llegan como transferencia; sin índice, cada
      // consulta de saldo al corte recorría la tabla entera (R11).
      db.exec(
        'CREATE INDEX IF NOT EXISTS idx_tx_transfer_account ON transactions(transfer_account_id)',
      )
    },
  },
  {
    id: 7,
    name: 'movimiento del desembolso de una deuda',
    up: (db) => {
      // Hasta ahora una deuda solo asentaba movimiento al abonar, nunca al
      // recibir (o entregar) el dinero: el saldo de la cuenta quedaba corto
      // por el principal. Esta columna liga la deuda con el movimiento que
      // trajo —o se llevó— ese dinero.
      if (!hasColumn(db, 'transactions', 'debt_id')) {
        db.exec(
          `ALTER TABLE transactions ADD COLUMN debt_id INTEGER
           REFERENCES debts(id) ON DELETE SET NULL`,
        )
      }
      db.exec('CREATE INDEX IF NOT EXISTS idx_tx_debt ON transactions(debt_id)')
    },
  },
  {
    id: 8,
    name: 'saldo insoluto y enganche',
    up: (db) => {
      // Sin esta columna, cada peso abonado bajaba el principal —también la
      // parte que era interés—, y una deuda con tasa se marcaba saldada mucho
      // antes de estarlo. Cero en lo que ya existe: las deudas sin intereses
      // se comportan exactamente igual que antes.
      if (!hasColumn(db, 'debt_payments', 'interest_cents')) {
        db.exec(
          `ALTER TABLE debt_payments ADD COLUMN interest_cents INTEGER NOT NULL DEFAULT 0
           CHECK (interest_cents >= 0)`,
        )
      }

      // Enganche: lo que pusiste de tu bolsa al contratar. No es principal
      // —no se financia— pero sí es parte de lo que te costó la cosa.
      if (!hasColumn(db, 'debts', 'down_payment_cents')) {
        db.exec(
          `ALTER TABLE debts ADD COLUMN down_payment_cents INTEGER NOT NULL DEFAULT 0
           CHECK (down_payment_cents >= 0)`,
        )
      }

      // Una deuda ya puede tener dos movimientos ligados (el desembolso y el
      // enganche) y hacen cosas distintas al corregirlos: sin distinguirlos,
      // editar el enganche reescribiría el principal.
      if (!hasColumn(db, 'transactions', 'debt_role')) {
        db.exec(
          `ALTER TABLE transactions ADD COLUMN debt_role TEXT
           CHECK (debt_role IS NULL OR debt_role IN ('desembolso', 'enganche'))`,
        )
      }
      db.exec(
        `UPDATE transactions SET debt_role = 'desembolso'
         WHERE debt_id IS NOT NULL AND debt_role IS NULL`,
      )
    },
  },
]

/** Versión de esquema que espera este código. */
export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.id

/** ¿La base ya tiene algo que perder? Una recién creada no. */
function hasContent(db: DatabaseSync): boolean {
  const table = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'profiles'")
    .get()
  if (!table) return false
  const row = db.prepare('SELECT COUNT(*) AS n FROM profiles').get() as { n: number }
  return row.n > 0
}

/**
 * Deja una copia intacta antes de tocar el esquema. Es el momento en que un
 * respaldo más vale: si una migración sale mal, el libro anterior sigue ahí.
 */
function snapshotBeforeMigrating(db: DatabaseSync, backupDir: string, from: number): void {
  mkdirSync(backupDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const target = path.join(backupDir, `antes-de-migrar-v${from}-${stamp}.db`)
  db.prepare('VACUUM INTO ?').run(target)
  console.log(`[finply] copia previa a la migración en ${target}`)
}

/**
 * Aplica las migraciones pendientes. Cada una corre en su propia transacción:
 * si truena, esa migración se revierte entera y `user_version` no avanza.
 */
export function migrate(db: DatabaseSync, options: { backupDir?: string } = {}): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number }
  const current = row.user_version

  if (current > SCHEMA_VERSION) {
    throw new Error(
      `Esta base es de una versión más nueva de Finply (esquema ${current}, ` +
        `este código entiende hasta ${SCHEMA_VERSION}). Actualiza Finply.`,
    )
  }

  // Solo si hay algo que migrar y la base ya tenía contenido. Ojo: no sirve
  // mirar `current`, porque una base heredada —la que más falta hace
  // respaldar— viene justamente en la versión 0.
  if (options.backupDir && current < SCHEMA_VERSION && hasContent(db)) {
    snapshotBeforeMigrating(db, options.backupDir, current)
  }

  // Reconstruir tablas con las llaves foráneas encendidas dispara borrados en
  // cascada indeseados; se apagan durante la migración y se revisan al final.
  db.exec('PRAGMA foreign_keys = OFF')
  try {
    for (const migration of MIGRATIONS) {
      if (migration.id <= current) continue
      db.exec('BEGIN')
      try {
        migration.up(db)
        db.exec(`PRAGMA user_version = ${migration.id}`)
        db.exec('COMMIT')
      } catch (err) {
        db.exec('ROLLBACK')
        throw new Error(
          `Falló la migración ${migration.id} (${migration.name}): ${(err as Error).message}`,
        )
      }
    }
    const broken = db.prepare('PRAGMA foreign_key_check').all()
    if (broken.length > 0) {
      throw new Error(`La base quedó con ${broken.length} referencia(s) rota(s) tras migrar`)
    }
  } finally {
    db.exec('PRAGMA foreign_keys = ON')
  }
}
