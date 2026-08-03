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

  {
    id: 14,
    name: 'el libro que cuadra: partida dividida, conciliación, reembolsos y recibos',
    up: (db) => {
      // Aditiva entera. Un libro que nunca divida una partida, nunca concilie y
      // nunca adjunte nada queda **exactamente** igual que antes de migrar: las
      // tres tablas nacen vacías y las dos columnas nuevas nacen nulas.
      db.exec(`
        -- D17. El movimiento sigue siendo **uno solo**; esto es su reparto por
        -- categoría. Por eso ninguna consulta de saldo, patrimonio o
        -- conciliación cambia: siguen leyendo \`transactions.amount_cents\`.
        -- Lo único que cambia es el gasto por categoría, que deja de leer
        -- \`category_id\` y lee estos renglones cuando existen.
        --
        -- Sin filas para un movimiento = sin dividir, y entonces manda su
        -- \`category_id\` de siempre. Es la misma regla de \`profile_modules\`:
        -- la ausencia significa "lo de antes", y por eso migrar no mueve nada.
        CREATE TABLE IF NOT EXISTS tx_splits (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tx_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
          category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
          amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
          note TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS idx_splits_tx ON tx_splits(tx_id);
        CREATE INDEX IF NOT EXISTS idx_splits_categoria ON tx_splits(category_id);

        -- D19, segunda mitad: el corte. "Al 31 de julio mi banco decía $X".
        -- Sin esto, marcar casillas no demuestra nada; con esto, la resta
        -- contra lo conciliado tiene respuesta sí/no.
        CREATE TABLE IF NOT EXISTS account_statements (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
          account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          date TEXT NOT NULL,
          balance_cents INTEGER NOT NULL,
          note TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE (account_id, date)
        );
        CREATE INDEX IF NOT EXISTS idx_cortes_cuenta ON account_statements(account_id, date);

        -- El recibo. Va **dentro de la base**, en base64, y no en un archivo
        -- suelto de data/: así viaja en el respaldo JSON sin que backup.ts
        -- tenga que saber de archivos, y restaurar en otra máquina devuelve
        -- también los recibos. Cuesta un tercio más de tamaño que el binario;
        -- con el tope de 2 MB por archivo, es un precio que se paga.
        CREATE TABLE IF NOT EXISTS tx_attachments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tx_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
          filename TEXT NOT NULL,
          mime TEXT NOT NULL DEFAULT '',
          size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
          data_b64 TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_adjuntos_tx ON tx_attachments(tx_id);
      `)

      // D19, primera mitad: la bandera. Fecha en que se marcó y no un 0/1,
      // porque cuesta lo mismo y además dice cuándo se comprobó. NULL = sin
      // conciliar, que es como queda todo lo que ya existía.
      if (!hasColumn(db, 'transactions', 'reconciled_at')) {
        db.exec('ALTER TABLE transactions ADD COLUMN reconciled_at TEXT')
      }

      // El reembolso apunta al gasto que devuelve. `ON DELETE SET NULL` y no
      // CASCADE: si borras el gasto original, la devolución **sigue en el
      // libro** porque ese dinero sí entró — es el mismo trato que ya tienen
      // el desembolso de una deuda y el aporte de una inversión.
      if (!hasColumn(db, 'transactions', 'refund_of_id')) {
        db.exec(
          `ALTER TABLE transactions ADD COLUMN refund_of_id INTEGER
           REFERENCES transactions(id) ON DELETE SET NULL`,
        )
      }
      db.exec('CREATE INDEX IF NOT EXISTS idx_tx_reembolso ON transactions(refund_of_id)')
    },
  },

  {
    id: 15,
    name: 'patrimonio completo: bienes, metas ligadas al libro y una moneda por perfil',
    up: (db) => {
      db.exec(`
        -- H3. Financiar un auto creaba una deuda que **bajaba** el patrimonio y
        -- el auto nunca lo subía: el Resumen decía que comprar un coche te
        -- empobrecía $240,000. El bien vive aquí, con su liga opcional a la
        -- deuda que lo financia.
        --
        -- Tabla propia y no una inversión de tipo inmueble (D20): una inversión
        -- tiene aportes, retiros, unidades y XIRR; un bien tiene costo, valor y
        -- depreciación, y no se le calcula rendimiento. Es el argumento de D15
        -- con las facturas, otra vez.
        CREATE TABLE IF NOT EXISTS assets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          kind TEXT NOT NULL DEFAULT 'otro'
            CHECK (kind IN ('inmueble', 'vehiculo', 'equipo', 'otro')),
          cost_cents INTEGER NOT NULL CHECK (cost_cents >= 0),
          acquired_date TEXT NOT NULL,
          debt_id INTEGER REFERENCES debts(id) ON DELETE SET NULL,
          note TEXT NOT NULL DEFAULT '',
          archived INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- El valor de hoy lo **declara el usuario** (R9). Finply no deprecia
        -- por su cuenta: no hay una tasa universal para un coche o una casa, y
        -- suponer una convertiría el patrimonio en una opinión de Finply.
        -- Sin valuaciones, un bien vale lo que costó.
        CREATE TABLE IF NOT EXISTS asset_valuations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
          date TEXT NOT NULL,
          value_cents INTEGER NOT NULL CHECK (value_cents >= 0),
          note TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS idx_bienes_perfil ON assets(profile_id, archived);
        CREATE INDEX IF NOT EXISTS idx_valuaciones_bien ON asset_valuations(asset_id, date);
      `)

      // H1. El aporte a una meta salía de la nada: `goal_entries` no ligaba ni
      // a cuenta ni a movimiento, así que apartar $50,000 no los quitaba de
      // ningún lado y el mismo peso se contaba dos veces entre pantallas.
      // Ahora la meta puede decir **dónde vive su dinero** y cada aporte puede
      // llevar su movimiento, igual que un aporte a inversión.
      if (!hasColumn(db, 'goals', 'account_id')) {
        db.exec(
          'ALTER TABLE goals ADD COLUMN account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL',
        )
      }
      if (!hasColumn(db, 'transactions', 'goal_entry_id')) {
        db.exec(
          `ALTER TABLE transactions ADD COLUMN goal_entry_id INTEGER
           REFERENCES goal_entries(id) ON DELETE SET NULL`,
        )
      }
      db.exec('CREATE INDEX IF NOT EXISTS idx_tx_meta ON transactions(goal_entry_id)')

      // H2/D18. La moneda pasa a ser **del perfil** y las cuentas la heredan.
      // `accounts.currency` existía y se validaba, pero los saldos se sumaban
      // sin convertir: mil dólares sumaban $1,000 al patrimonio en pesos. Se
      // cierra la puerta en vez de dejarla entreabierta.
      //
      // El relleno toma la moneda **más usada** entre las cuentas del perfil,
      // así que un libro de una sola moneda —todos los que existen— no nota
      // nada. Las cuentas que difieran **no se tocan**: cambiarles el texto
      // sería borrar lo que el usuario declaró. La vista de Cuentas las señala
      // y dice que se suman como si fueran de la moneda del libro.
      if (!hasColumn(db, 'profiles', 'currency')) {
        db.exec("ALTER TABLE profiles ADD COLUMN currency TEXT NOT NULL DEFAULT 'MXN'")
        db.exec(`
          UPDATE profiles SET currency = COALESCE((
            SELECT a.currency FROM accounts a
            WHERE a.profile_id = profiles.id
            GROUP BY a.currency
            ORDER BY COUNT(*) DESC, a.id ASC
            LIMIT 1
          ), 'MXN')
        `)
      }

      // Saldo mínimo con aviso, institución y orden. Los tres nulos o en cero:
      // una cuenta de siempre se ve y se ordena exactamente igual que ayer.
      if (!hasColumn(db, 'accounts', 'min_balance_cents')) {
        db.exec('ALTER TABLE accounts ADD COLUMN min_balance_cents INTEGER')
      }
      if (!hasColumn(db, 'accounts', 'institution')) {
        db.exec("ALTER TABLE accounts ADD COLUMN institution TEXT NOT NULL DEFAULT ''")
      }
      if (!hasColumn(db, 'accounts', 'sort_order')) {
        db.exec('ALTER TABLE accounts ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0')
      }
    },
  },
  {
    id: 16,
    name: 'el presupuesto que se adelanta: periodo, tope total y sobrante que rueda',
    up: (db) => {
      // `month` pasa a llamarse `period` porque ya no siempre es un mes: un
      // tope anual guarda 'AAAA' y uno mensual 'AAAA-MM'. Dejar el nombre
      // viejo sería una columna llamada "mes" con un año adentro, y eso se
      // cobra caro el día que alguien la lea de prisa.
      //
      // El renombre es solo metadatos —SQLite reescribe el texto del esquema y
      // arrastra el índice solo—, así que ninguna fila se toca.
      if (hasColumn(db, 'budgets', 'month')) {
        db.exec('ALTER TABLE budgets RENAME COLUMN month TO period')
      }

      // Las dos columnas nuevas nacen con el valor que deja todo igual: los
      // topes que ya existen son mensuales y no arrastran nada. Un libro de
      // ayer se ve idéntico hoy (R2).
      if (!hasColumn(db, 'budgets', 'period_kind')) {
        db.exec(
          `ALTER TABLE budgets ADD COLUMN period_kind TEXT NOT NULL DEFAULT 'mes'
           CHECK (period_kind IN ('mes', 'anio'))`,
        )
      }
      if (!hasColumn(db, 'budgets', 'rollover')) {
        db.exec(
          `ALTER TABLE budgets ADD COLUMN rollover INTEGER NOT NULL DEFAULT 0
           CHECK (rollover IN (0, 1))`,
        )
      }

      // El tope de **todo** el mes vive aparte y no en `budgets` con categoría
      // nula: en SQLite dos NULL no chocan en un UNIQUE, así que la llave
      // `(perfil, categoría, periodo)` dejaría meter dos topes totales del
      // mismo mes sin quejarse. Una tabla propia lo hace imposible.
      db.exec(`
        CREATE TABLE IF NOT EXISTS budget_totals (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
          month TEXT NOT NULL,
          amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
          UNIQUE (profile_id, month)
        );
      `)
    },
  },
  {
    id: 17,
    name: 'negocio II: retenciones, notas de crédito, facturas recurrentes y el costo de la tarjeta',
    up: (db) => {
      // Todo lo de aquí es aditivo y nace con el valor que deja el libro
      // exactamente igual que ayer (R2): retenciones en cero, sin notas de
      // crédito, sin plantillas de factura y sin tasa de tarjeta. Un libro
      // personal que nunca abra una factura no nota nada.

      // ── Retenciones (D21) ────────────────────────────────────────────────
      // **Monto y no tasa**, igual que `tax_cents`, para no amarrar el modelo
      // a ninguna jurisdicción (R15). Son dos y no una porque en la práctica
      // se retienen por dos conceptos distintos y el usuario los ve separados
      // en su factura; sumarlos en un solo campo perdería el desglose que él
      // ya tiene enfrente.
      //
      // Lo que de verdad cambian: el total del documento sigue siendo
      // subtotal + impuesto, pero **lo cobrable** es eso menos lo retenido. Sin
      // esto, la antigüedad de saldos prometía cobrar un dinero que nunca iba
      // a llegar y la factura no se saldaba jamás.
      for (const col of ['withheld_tax_cents', 'withheld_income_cents']) {
        if (!hasColumn(db, 'invoices', col)) {
          db.exec(
            `ALTER TABLE invoices ADD COLUMN ${col} INTEGER NOT NULL DEFAULT 0
             CHECK (${col} >= 0)`,
          )
        }
      }

      // ── Notas de crédito y cancelación parcial ───────────────────────────
      // Una nota de crédito **no es un cobro**: no se movió un peso. Por eso
      // no vive en `transactions` —ahí inventaría un ingreso que nadie
      // recibió— sino en su propia tabla colgada de la factura. Baja lo
      // cobrable, y cuando lo baja a cero, la factura queda cancelada por
      // completo sin borrar nada.
      db.exec(`
        CREATE TABLE IF NOT EXISTS invoice_credit_notes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
          date TEXT NOT NULL,
          folio TEXT NOT NULL DEFAULT '',
          concept TEXT NOT NULL DEFAULT '',
          amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_notas_factura ON invoice_credit_notes(invoice_id);
      `)

      // ── La contraparte que ya sabe cómo te paga ──────────────────────────
      // Los días de crédito ahorran teclear la fecha de vencimiento en cada
      // factura; el límite es del usuario, no de Finply, y por eso avisa en
      // vez de impedir. Nulo significa "no lo uso", que es como nacen todas.
      if (!hasColumn(db, 'counterparties', 'credit_days')) {
        db.exec('ALTER TABLE counterparties ADD COLUMN credit_days INTEGER')
      }
      if (!hasColumn(db, 'counterparties', 'credit_limit_cents')) {
        db.exec('ALTER TABLE counterparties ADD COLUMN credit_limit_cents INTEGER')
      }
      if (!hasColumn(db, 'counterparties', 'contact')) {
        db.exec("ALTER TABLE counterparties ADD COLUMN contact TEXT NOT NULL DEFAULT ''")
      }

      // ── Facturas recurrentes (D28) ───────────────────────────────────────
      // Tabla propia, motor compartido. `recurrences` exige `account_id` y un
      // tipo ingreso/gasto/transferencia porque asienta dinero; una factura
      // recurrente no asienta nada —emite un documento— y no tiene cuenta.
      // Meterlas juntas obligaría a la bandeja, al calendario, a las alertas y
      // al flujo a preguntar en cada consulta cuál de las dos están mirando,
      // que es el argumento con el que ya se separaron facturas y deudas (D15).
      //
      // Lo que sí se reparte es el motor: la regla de fechas de
      // `shared/recurrencias.ts` y la idempotencia por `(plantilla, periodo)`.
      db.exec(`
        CREATE TABLE IF NOT EXISTS invoice_recurrences (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
          counterparty_id INTEGER NOT NULL REFERENCES counterparties(id) ON DELETE CASCADE,
          direction TEXT NOT NULL CHECK (direction IN ('emitida', 'recibida')),
          concept TEXT NOT NULL DEFAULT '',
          subtotal_cents INTEGER NOT NULL CHECK (subtotal_cents > 0),
          tax_cents INTEGER NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
          withheld_tax_cents INTEGER NOT NULL DEFAULT 0 CHECK (withheld_tax_cents >= 0),
          withheld_income_cents INTEGER NOT NULL DEFAULT 0 CHECK (withheld_income_cents >= 0),
          cost_center_id INTEGER REFERENCES cost_centers(id) ON DELETE SET NULL,
          -- Días entre emisión y vencimiento. Nulo: la factura nace sin fecha
          -- de pago, igual que si se capturara a mano.
          credit_days INTEGER,
          frequency TEXT NOT NULL CHECK (frequency IN ('mensual', 'quincenal', 'semanal', 'anual')),
          day_of_month INTEGER,
          day_of_month_2 INTEGER,
          month_of_year INTEGER,
          weekday INTEGER,
          start_date TEXT NOT NULL,
          end_date TEXT,
          archived INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- La misma red que en las recurrencias de movimiento: es el UNIQUE, y
        -- no el código de la ruta, lo que hace imposible emitir dos veces la
        -- factura del mismo periodo (R5).
        CREATE TABLE IF NOT EXISTS invoice_recurrence_runs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          recurrence_id INTEGER NOT NULL REFERENCES invoice_recurrences(id) ON DELETE CASCADE,
          period TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('emitida', 'descartada')),
          invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE (recurrence_id, period)
        );
        CREATE INDEX IF NOT EXISTS idx_facturas_rec_perfil
          ON invoice_recurrences(profile_id, archived);
      `)

      // ── Lo que de verdad cuesta la tarjeta ───────────────────────────────
      // Tasa anual en puntos base, porcentaje de pago mínimo en puntos base y
      // el piso en centavos: los tres los escribe el usuario copiando su
      // contrato. Nulos mientras no los escriba, y con nulo la tarjeta se ve
      // exactamente como ayer.
      for (const col of ['annual_rate_bp', 'min_payment_bp', 'min_payment_floor_cents']) {
        if (!hasColumn(db, 'accounts', col)) {
          db.exec(`ALTER TABLE accounts ADD COLUMN ${col} INTEGER`)
        }
      }
    },
  },
  {
    id: 18,
    name: 'módulos de giro: inmuebles en renta, horas facturables e inventario simple',
    up: (db) => {
      // Tres módulos **opt-in**, que nacen apagados para todo el mundo. Y aun
      // así sus tablas se crean para todos, porque el esquema es siempre el
      // completo (D16): encender un módulo a media vida del libro no puede
      // exigir una migración (R1), y apagarlo no puede perder un dato (R17).
      // Cuatro tablas vacías en SQLite no cuestan nada.

      // ── Inmuebles en renta ───────────────────────────────────────────────
      // El inmueble **no vive aquí**: es un bien de la Fase 11, y esto es su
      // arrendamiento. Duplicarlo habría metido la misma casa dos veces en el
      // patrimonio, que es exactamente la mentira que la Fase 11 vino a
      // cerrar.
      //
      // El inquilino es texto libre, como el de una deuda, y no una
      // contraparte: obligar a `counterparties` haría que encender Inmuebles
      // encendiera Negocio de rebote, y un módulo no manda sobre otro (R17).
      db.exec(`
        CREATE TABLE IF NOT EXISTS rentals (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
          asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
          tenant TEXT NOT NULL DEFAULT '',
          rent_cents INTEGER NOT NULL CHECK (rent_cents >= 0),
          deposit_cents INTEGER NOT NULL DEFAULT 0 CHECK (deposit_cents >= 0),
          -- Día del mes en que toca cobrar. 31 cae el último, como en todo el
          -- resto de Finply.
          payment_day INTEGER NOT NULL DEFAULT 1 CHECK (payment_day BETWEEN 1 AND 31),
          start_date TEXT NOT NULL,
          end_date TEXT,
          note TEXT NOT NULL DEFAULT '',
          archived INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_rentas_perfil ON rentals(profile_id, archived);
        CREATE INDEX IF NOT EXISTS idx_rentas_bien ON rentals(asset_id);
      `)

      // La liga del movimiento con su arrendamiento, y qué papel juega ahí.
      // Es el mismo par que ya llevan las deudas (`debt_id` + `debt_role`), y
      // por la misma razón: sin el papel habría que adivinar si un ingreso de
      // un inquilino es la renta o el depósito, y **no es lo mismo**.
      if (!hasColumn(db, 'transactions', 'rental_id')) {
        db.exec(
          `ALTER TABLE transactions ADD COLUMN rental_id INTEGER
           REFERENCES rentals(id) ON DELETE SET NULL`,
        )
      }
      if (!hasColumn(db, 'transactions', 'rental_role')) {
        db.exec(
          `ALTER TABLE transactions ADD COLUMN rental_role TEXT
           CHECK (rental_role IS NULL OR rental_role IN
             ('renta', 'deposito', 'devolucion_deposito', 'mantenimiento'))`,
        )
      }
      db.exec('CREATE INDEX IF NOT EXISTS idx_tx_renta ON transactions(rental_id)')

      // ── Horas facturables ────────────────────────────────────────────────
      // La tarifa vive en **cada renglón** y no en el cliente: se sube a mitad
      // de un proyecto, y una tarifa guardada aparte reescribiría el precio de
      // las horas de hace tres meses. Es el mismo criterio que ya rige a una
      // recurrencia asentada.
      //
      // `invoice_id` es lo único que marca una hora como facturada, y es
      // derivado: borrar la factura las devuelve a "sin facturar" solas.
      db.exec(`
        CREATE TABLE IF NOT EXISTS time_entries (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
          date TEXT NOT NULL,
          minutes INTEGER NOT NULL CHECK (minutes > 0),
          rate_cents INTEGER NOT NULL DEFAULT 0 CHECK (rate_cents >= 0),
          counterparty_id INTEGER REFERENCES counterparties(id) ON DELETE SET NULL,
          cost_center_id INTEGER REFERENCES cost_centers(id) ON DELETE SET NULL,
          note TEXT NOT NULL DEFAULT '',
          invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_horas_perfil ON time_entries(profile_id, date);
        CREATE INDEX IF NOT EXISTS idx_horas_factura ON time_entries(invoice_id);
      `)

      // ── Inventario simple ────────────────────────────────────────────────
      // Las cantidades van en **milésimas de unidad** para que quepa 1.5 kg
      // sin punto flotante, con el mismo criterio que los centavos.
      //
      // No hay columna de existencia ni de costo promedio: los dos se derivan
      // recorriendo los movimientos, como la bandeja de recurrencias (D7) y el
      // saldo de una factura. Una existencia guardada envejece en cuanto
      // alguien corrige una entrada de hace un mes.
      db.exec(`
        CREATE TABLE IF NOT EXISTS products (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
          sku TEXT NOT NULL DEFAULT '',
          name TEXT NOT NULL,
          unit TEXT NOT NULL DEFAULT 'pieza',
          -- Debajo de esto, Finply avisa. NULL quita el aviso.
          min_qty_milli INTEGER,
          archived INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE (profile_id, name)
        );

        CREATE TABLE IF NOT EXISTS stock_moves (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
          date TEXT NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('entrada', 'salida', 'ajuste')),
          -- En un ajuste puede ser negativa: ahí es un delta, no una cantidad.
          qty_milli INTEGER NOT NULL CHECK (qty_milli <> 0),
          unit_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost_cents >= 0),
          note TEXT NOT NULL DEFAULT '',
          -- Liga opcional al movimiento del libro que pagó esa entrada. El
          -- inventario **no asienta dinero** por su cuenta (R4).
          tx_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_stock_producto ON stock_moves(product_id, date, id);
      `)
    },
  },
  {
    id: 19,
    name: 'cotizaciones y órdenes de compra: el documento antes de la factura',
    up: (db) => {
      // El ciclo empezaba a media calle. Finply sabía de la factura —el
      // documento que ya es un cobro— pero no de lo que la precede: la
      // cotización que mandas y esperas, y la orden que le pones a un
      // proveedor. Sin eso no hay forma de contestar "¿cuánto tengo en la
      // calle esperando respuesta?", que es la pregunta con la que un negocio
      // decide si puede comprometerse a algo más.
      //
      // **Una sola tabla con `direction`**, igual que `invoices`: la
      // cotización y la orden son el mismo documento con la flecha invertida
      // —quién promete y a quién— y partirlas en dos tablas obligaría a cada
      // consulta, cada alerta y cada respaldo a preguntar cuál de las dos está
      // mirando. Es D15 al derecho: dos cosas que sí son la misma.
      //
      // Lo que **no** entra, y por qué: la recepción de mercancía y el cotejo
      // de tres vías (orden/recepción/factura) abren un ciclo nuevo, no cierran
      // el que ya estaba. D23 lo deja fuera con su criterio.
      db.exec(`
        CREATE TABLE IF NOT EXISTS quotes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
          counterparty_id INTEGER NOT NULL REFERENCES counterparties(id) ON DELETE CASCADE,
          -- 'emitida' es la cotización que mandas a un cliente; 'recibida', la
          -- orden que le pones a un proveedor. Mismo documento, flecha al revés.
          direction TEXT NOT NULL CHECK (direction IN ('emitida', 'recibida')),
          folio TEXT NOT NULL DEFAULT '',
          concept TEXT NOT NULL DEFAULT '',
          issue_date TEXT NOT NULL,
          -- Hasta cuándo vale lo que prometiste. Nulo: sin vigencia, que es lo
          -- que pasa con media cotización real.
          valid_until TEXT,
          subtotal_cents INTEGER NOT NULL CHECK (subtotal_cents > 0),
          tax_cents INTEGER NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
          cost_center_id INTEGER REFERENCES cost_centers(id) ON DELETE SET NULL,
          -- Tres estados y **ninguno se llama 'vencida'**: eso se deriva de
          -- \`valid_until\` contra hoy, y guardarlo obligaría a un trabajo
          -- nocturno que le cambiara el estado a las cotizaciones dormidas. Es
          -- D10 otra vez: lo que se puede derivar no se guarda, porque un
          -- estado guardado se queda viejo y nadie se entera.
          status TEXT NOT NULL DEFAULT 'enviada'
            CHECK (status IN ('enviada', 'aceptada', 'perdida')),
          -- La factura que salió de ella. Se llena al convertirla, y si esa
          -- factura se borra la cotización sigue aceptada: la aceptaron.
          invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_cotizaciones_perfil
          ON quotes(profile_id, direction, status);
        CREATE INDEX IF NOT EXISTS idx_cotizaciones_contraparte ON quotes(counterparty_id);
      `)
    },
  },
  {
    id: 20,
    name: 'la nota se ata a lo que habla: un movimiento o un mes',
    up: (db) => {
      // La libreta era la única sección que no se hablaba con ninguna otra:
      // apuntabas "el súper del 12 salió carísimo porque llevé a los niños" y
      // esa frase vivía en una isla, sin forma de llegar desde el movimiento
      // ni de volver a él.
      //
      // Dos ligas y las dos **opcionales**, porque una nota suelta sigue
      // siendo legítima —la libreta es la libreta—:
      //
      //   · `tx_id`   — esta nota explica **ese** movimiento.
      //   · `period`  — esta nota es del mes ('AAAA-MM'), que es donde caen
      //                 los "este mes gasté de más por la mudanza".
      //
      // `ON DELETE SET NULL` y no CASCADE: anular el movimiento no borra lo
      // que el usuario escribió. Es el mismo trato que ya tienen el desembolso
      // de una deuda (Fase 3), la devolución (Fase 10) y el papel de un
      // arrendamiento (Fase 15): se pierde la liga, nunca el dato.
      //
      // Aditiva y por eso inofensiva: sin las dos columnas, una nota es
      // exactamente la nota suelta de siempre.
      if (hasColumn(db, 'notes', 'tx_id')) return
      db.exec(`
        ALTER TABLE notes ADD COLUMN tx_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL;
        ALTER TABLE notes ADD COLUMN period TEXT;
        CREATE INDEX IF NOT EXISTS idx_notes_tx ON notes(tx_id);
        CREATE INDEX IF NOT EXISTS idx_notes_periodo ON notes(profile_id, period);
      `)
    },
  },
  {
    id: 21,
    name: 'personalización: campos propios, plantillas y preferencias del perfil',
    up: (db) => {
      // **D24 resuelta: llave-valor, no columnas.** Un campo propio por perfil
      // no puede ser una columna de `transactions` —cada libro pediría su
      // migración y eso choca de frente con R1—, así que el catálogo vive en
      // su tabla y los valores en otra, uno por (movimiento, campo).
      //
      // El costo conocido y aceptado: filtrar o sumar por un campo propio es
      // más caro que por una columna. Se paga barato porque **no se suma**: un
      // campo propio se ve, se edita y se exporta, pero ningún reporte lo
      // agrega. Es el criterio que la propia D24 dejó escrito —"si entran a los
      // reportes hay que definir su tipo, y ahí empieza otra fase"— y además lo
      // que impide que un dato que Finply no entiende mueva una cifra.
      db.exec(`
        CREATE TABLE IF NOT EXISTS profile_fields (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
          label TEXT NOT NULL,
          -- El tipo decide qué control se dibuja y qué se valida al guardar.
          -- 'lista' trae sus opciones en \`options\`, un renglón cada una.
          kind TEXT NOT NULL DEFAULT 'texto'
            CHECK (kind IN ('texto', 'numero', 'fecha', 'lista', 'casilla')),
          options TEXT NOT NULL DEFAULT '',
          position INTEGER NOT NULL DEFAULT 0,
          -- Archivar y no borrar: un campo que ya no se usa no puede llevarse
          -- por delante lo que se apuntó con él (R17 otra vez, en chico).
          archived INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_campos_perfil ON profile_fields(profile_id, position);

        CREATE TABLE IF NOT EXISTS tx_field_values (
          tx_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
          field_id INTEGER NOT NULL REFERENCES profile_fields(id) ON DELETE CASCADE,
          value TEXT NOT NULL,
          PRIMARY KEY (tx_id, field_id)
        );

        -- Plantillas de movimiento: "gasolina", "despensa quincenal". No es
        -- una recurrencia —no tiene fecha ni periodo y no propone nada sola—:
        -- es el formulario ya llenado, esperando a que alguien lo confirme.
        -- \`amount_cents\` nulo significa "el monto lo pongo yo cada vez", que
        -- es lo normal en la gasolina y lo raro en la colegiatura.
        CREATE TABLE IF NOT EXISTS tx_templates (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          type TEXT NOT NULL DEFAULT 'gasto'
            CHECK (type IN ('ingreso', 'gasto', 'transferencia')),
          account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
          transfer_account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
          category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
          amount_cents INTEGER CHECK (amount_cents IS NULL OR amount_cents > 0),
          note TEXT NOT NULL DEFAULT '',
          position INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_plantillas_perfil ON tx_templates(profile_id, position);
      `)

      // Las preferencias del perfil van en columnas suyas y **no** en una
      // tabla como los módulos, porque nadie las consulta: se leen con el
      // perfil y las aplica el cliente. `profile_modules` es tabla porque
      // `modulosDe` las cruza en un JOIN en cada carga del Resumen.
      //
      // Todas nulas o en cero: lo que falta significa "lo de antes", así que un
      // libro que no toque nada se ve exactamente igual que ayer.
      if (hasColumn(db, 'profiles', 'nav_order')) return
      db.exec(`
        -- Orden propio del lomo, ids de vista separados por coma. Nulo: el
        -- orden agrupado de siempre.
        ALTER TABLE profiles ADD COLUMN nav_order TEXT;
        -- Qué sección abre al entrar. Nulo: el Resumen.
        ALTER TABLE profiles ADD COLUMN home_view TEXT;
        -- Cómo se ven las fechas. Nulo: 'corto' ("12 jun").
        ALTER TABLE profiles ADD COLUMN date_format TEXT;
        -- Qué día empieza la semana (1 = lunes … 7 = domingo). Nulo: lunes.
        -- ⚠ Es **solo de vista**: la clave de periodo de una recurrencia
        -- semanal sigue siendo la semana ISO, que empieza en lunes por
        -- definición. Moverla rompería la idempotencia de R5 y reproponría el
        -- histórico entero.
        ALTER TABLE profiles ADD COLUMN week_start INTEGER;
        -- Redondear las cifras a la vista. Cero: con centavos, como siempre.
        ALTER TABLE profiles ADD COLUMN hide_cents INTEGER NOT NULL DEFAULT 0;
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
