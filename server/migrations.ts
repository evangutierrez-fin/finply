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
  {
    id: 9,
    name: 'recurrencias y su bitácora de periodos resueltos',
    up: (db) => {
      // Puramente aditiva: tres tablas nuevas y ni un ALTER. Un libro que ya
      // existía queda idéntico —sin plantillas, sin propuestas— y esta fase no
      // puede tocarle un solo movimiento al migrar.
      db.exec(`
        CREATE TABLE IF NOT EXISTS recurrences (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
          account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          type TEXT NOT NULL CHECK (type IN ('ingreso', 'gasto', 'transferencia')),
          amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
          category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
          transfer_account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
          note TEXT NOT NULL DEFAULT '',
          frequency TEXT NOT NULL
            CHECK (frequency IN ('mensual', 'quincenal', 'semanal', 'anual')),
          day_of_month INTEGER CHECK (day_of_month IS NULL OR (day_of_month BETWEEN 1 AND 31)),
          day_of_month_2 INTEGER CHECK (day_of_month_2 IS NULL OR (day_of_month_2 BETWEEN 1 AND 31)),
          month_of_year INTEGER CHECK (month_of_year IS NULL OR (month_of_year BETWEEN 1 AND 12)),
          weekday INTEGER CHECK (weekday IS NULL OR (weekday BETWEEN 1 AND 7)),
          start_date TEXT NOT NULL,
          end_date TEXT,
          archived INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS recurrence_tags (
          recurrence_id INTEGER NOT NULL REFERENCES recurrences(id) ON DELETE CASCADE,
          tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
          PRIMARY KEY (recurrence_id, tag_id)
        );

        -- Aquí vive **solo lo resuelto**, nunca lo pendiente (D7): la bandeja
        -- se deriva restando estas filas a los periodos vencidos, así que
        -- ninguna lectura escribe. El UNIQUE es la red de R5: un doble clic o
        -- dos pestañas no pueden asentar dos veces el mismo periodo.
        --
        -- tx_id cae en CASCADE a propósito: si anulas el movimiento que
        -- asentaste, ese periodo vuelve a estar pendiente. El libro manda.
        -- Un descarte no tiene movimiento, así que nunca se borra solo.
        CREATE TABLE IF NOT EXISTS recurrence_runs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          recurrence_id INTEGER NOT NULL REFERENCES recurrences(id) ON DELETE CASCADE,
          period TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('asentado', 'descartado')),
          tx_id INTEGER REFERENCES transactions(id) ON DELETE CASCADE,
          resolved_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
          UNIQUE (recurrence_id, period)
        );

        CREATE INDEX IF NOT EXISTS idx_recurrences_profile ON recurrences(profile_id);
        CREATE INDEX IF NOT EXISTS idx_recurrence_runs_tx ON recurrence_runs(tx_id);
      `)
    },
  },
  {
    id: 10,
    name: 'tinta personalizada por perfil',
    up: (db) => {
      // Aditiva y sin CHECK: dos columnas nulas. NULL significa "usa el preset
      // de `accent`", que es lo que tenían todos los perfiles hasta hoy, así
      // que un libro que ya existía se ve exactamente igual después de migrar.
      //
      // Son **dos** colores porque son dos temas: se midió sobre una malla de
      // 140,608 colores y ni uno solo alcanza AA contra el papel claro y el
      // oscuro a la vez. El contraste se valida en la ruta, no aquí: un CHECK
      // en SQLite no puede calcular una razón de luminancia.
      if (!hasColumn(db, 'profiles', 'accent_hex')) {
        db.exec('ALTER TABLE profiles ADD COLUMN accent_hex TEXT')
      }
      if (!hasColumn(db, 'profiles', 'accent_hex_dark')) {
        db.exec('ALTER TABLE profiles ADD COLUMN accent_hex_dark TEXT')
      }
    },
  },
  {
    id: 11,
    name: 'unidades y precio por unidad en las inversiones',
    up: (db) => {
      // Aditiva y nula, como la 10: una inversión que solo llevaba montos
      // sigue funcionando exactamente igual, porque NULL significa "esta
      // inversión no se lleva por unidades".
      //
      // Las unidades van en **entero escalado por 10⁸**, no en REAL: un
      // satoshi (0.00000001) es exacto y en la base no entra un flotante, por
      // la misma razón por la que el dinero va en centavos. La escala vive en
      // `shared/inversiones.ts` (UNIDAD).
      if (!hasColumn(db, 'investment_entries', 'units_e8')) {
        db.exec('ALTER TABLE investment_entries ADD COLUMN units_e8 INTEGER')
      }
      // Precio por unidad en centavos. En una valuación **manda sobre el
      // monto**: el valor se recalcula contra las unidades que hubiera en esa
      // fecha, así que un aporte con fecha vieja registrado después no deja la
      // valuación con el número de ayer.
      if (!hasColumn(db, 'investment_entries', 'unit_price_cents')) {
        db.exec('ALTER TABLE investment_entries ADD COLUMN unit_price_cents INTEGER')
      }
    },
  },
  {
    id: 12,
    name: 'perfil de negocio: contrapartes, facturas, dimensión libre e impuesto',
    up: (db) => {
      // Todo lo de esta migración es aditivo y opcional: un libro personal que
      // nunca abra una factura queda exactamente igual que antes.
      //
      // Nada aquí es de un giro ni de un país (R15): la contraparte lleva un
      // `tax_id` genérico —RFC, CUIT, VAT number o nada—, el impuesto se
      // guarda en **monto** y no en tasa, y la dimensión libre la nombra el
      // usuario ("Proyecto", "Sucursal", "Obra").
      db.exec(`
        CREATE TABLE IF NOT EXISTS counterparties (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'ambos' CHECK (role IN ('cliente', 'proveedor', 'ambos')),
          tax_id TEXT NOT NULL DEFAULT '',
          note TEXT NOT NULL DEFAULT '',
          archived INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE (profile_id, name)
        );

        -- Una factura es el **documento y el compromiso**, no el asiento: el
        -- libro sigue siendo de flujo de efectivo y el ingreso nace cuando se
        -- cobra, con el movimiento ligado por \`invoice_id\`. Sin esa regla,
        -- emitir y cobrar contarían dos veces el mismo peso.
        CREATE TABLE IF NOT EXISTS invoices (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
          counterparty_id INTEGER NOT NULL REFERENCES counterparties(id) ON DELETE CASCADE,
          direction TEXT NOT NULL CHECK (direction IN ('emitida', 'recibida')),
          folio TEXT NOT NULL DEFAULT '',
          concept TEXT NOT NULL DEFAULT '',
          issue_date TEXT NOT NULL,
          due_date TEXT,
          subtotal_cents INTEGER NOT NULL CHECK (subtotal_cents >= 0),
          tax_cents INTEGER NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
          status TEXT NOT NULL DEFAULT 'abierta' CHECK (status IN ('abierta', 'cancelada')),
          cost_center_id INTEGER,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- La dimensión libre: exclusiva por movimiento, a diferencia de las
        -- etiquetas, que son varias. Un gasto pertenece a un proyecto, no a
        -- tres, y por eso el reporte por centro suma sin contar dos veces.
        CREATE TABLE IF NOT EXISTS cost_centers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          archived INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE (profile_id, name)
        );

        CREATE INDEX IF NOT EXISTS idx_invoices_perfil ON invoices(profile_id, direction, status);
        CREATE INDEX IF NOT EXISTS idx_invoices_contraparte ON invoices(counterparty_id);
      `)

      // Las ligas en el movimiento. Todas nulas: un movimiento de siempre no
      // cambia de significado.
      if (!hasColumn(db, 'transactions', 'invoice_id')) {
        db.exec(
          `ALTER TABLE transactions ADD COLUMN invoice_id INTEGER
           REFERENCES invoices(id) ON DELETE SET NULL`,
        )
      }
      if (!hasColumn(db, 'transactions', 'counterparty_id')) {
        db.exec(
          `ALTER TABLE transactions ADD COLUMN counterparty_id INTEGER
           REFERENCES counterparties(id) ON DELETE SET NULL`,
        )
      }
      if (!hasColumn(db, 'transactions', 'cost_center_id')) {
        db.exec(
          `ALTER TABLE transactions ADD COLUMN cost_center_id INTEGER
           REFERENCES cost_centers(id) ON DELETE SET NULL`,
        )
      }
      // Impuesto **contenido** en el monto, no sumado a él: el movimiento
      // sigue valiendo lo que salió de la cuenta. Y el deducible es una
      // decisión del usuario sobre cada gasto, no algo que Finply adivine.
      if (!hasColumn(db, 'transactions', 'tax_cents')) {
        db.exec('ALTER TABLE transactions ADD COLUMN tax_cents INTEGER NOT NULL DEFAULT 0')
      }
      if (!hasColumn(db, 'transactions', 'deductible')) {
        db.exec('ALTER TABLE transactions ADD COLUMN deductible INTEGER NOT NULL DEFAULT 0')
      }
      db.exec('CREATE INDEX IF NOT EXISTS idx_tx_factura ON transactions(invoice_id)')

      // El papel de cada categoría en el estado de resultados. NULL significa
      // "sin clasificar", que es como nacen todas las que ya existían: el
      // estado de resultados las agrupa aparte en vez de suponerlas.
      if (!hasColumn(db, 'categories', 'role')) {
        db.exec(
          `ALTER TABLE categories ADD COLUMN role TEXT
           CHECK (role IS NULL OR role IN ('costo_venta', 'gasto_fijo', 'gasto_variable'))`,
        )
      }
      // Cómo se llama la dimensión libre en este perfil.
      if (!hasColumn(db, 'profiles', 'dimension_label')) {
        db.exec("ALTER TABLE profiles ADD COLUMN dimension_label TEXT NOT NULL DEFAULT 'Proyecto'")
      }
    },
  },

  {
    id: 13,
    name: 'módulos por perfil: qué secciones lleva cada libro',
    up: (db) => {
      // La migración más pequeña del proyecto, y a propósito: **una tabla
      // vacía y nada más**. No rellena una sola fila.
      //
      // Puede no rellenar porque la resolución de `shared/modulos.ts` trata la
      // ausencia de fila como "usa el juego por omisión de este tipo de
      // perfil", y ese juego es exactamente lo que cada perfil ve hoy: un
      // personal, todo menos negocio; uno de negocio, todo. Así que después de
      // migrar, nadie ve nada distinto — que es lo que R2 pide demostrar, y
      // hay prueba de ello.
      //
      // La misma regla cubre dos casos que un relleno no cubriría: restaurar
      // un respaldo anterior a esta fase, cuyo JSON no trae la tabla, y un
      // módulo que se agregue en el futuro, que nace con su propio valor por
      // omisión en vez de apagado para todos.
      //
      // `module` va sin CHECK de valores: el catálogo vive en el código y una
      // lista cerrada aquí obligaría a reconstruir la tabla —tabla nueva,
      // copia, DROP, RENAME— cada vez que aparezca un módulo. Una fila con un
      // id que ya no existe simplemente no la lee nadie.
      db.exec(`
        CREATE TABLE IF NOT EXISTS profile_modules (
          profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
          module TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
          PRIMARY KEY (profile_id, module)
        );
      `)
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
