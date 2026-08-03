// El camino que recorre la base de alguien que ya usaba Finply. Es el que
// nadie prueba a mano y el que, si falla, se lleva datos por delante.

import { after, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { MIGRATIONS, migrate, SCHEMA_VERSION } from '../server/migrations.ts'

const dirs: string[] = []
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

function baseVieja(): DatabaseSync {
  const dir = mkdtempSync(path.join(tmpdir(), 'finply-migra-'))
  dirs.push(dir)
  const db = new DatabaseSync(path.join(dir, 'vieja.db'))
  db.exec('PRAGMA foreign_keys = ON')
  // Esquema tal como era antes de estas migraciones: sin user_version, sin
  // investment_entry_id y con los presupuestos sin mes.
  db.exec(`
    CREATE TABLE profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'personal' CHECK (kind IN ('personal', 'negocio')),
      accent TEXT NOT NULL DEFAULT 'verde' CHECK (accent IN ('verde', 'laton', 'cobalto', 'vino')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('ingreso', 'gasto')),
      UNIQUE (profile_id, name, kind)
    );
    CREATE TABLE accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'efectivo' CHECK (type IN ('efectivo', 'banco', 'tarjeta', 'ahorro', 'otro')),
      currency TEXT NOT NULL DEFAULT 'MXN',
      opening_cents INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      account_id INTEGER NOT NULL REFERENCES accounts(id),
      type TEXT NOT NULL CHECK (type IN ('ingreso', 'gasto', 'transferencia')),
      amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
      date TEXT NOT NULL,
      category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
      note TEXT NOT NULL DEFAULT '',
      transfer_account_id INTEGER REFERENCES accounts(id),
      debt_payment_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE budgets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
      UNIQUE (profile_id, category_id)
    );

    INSERT INTO profiles (id, name, kind) VALUES (1, 'Ana', 'personal');
    INSERT INTO categories (id, profile_id, name, kind) VALUES (1, 1, 'Súper', 'gasto');
    INSERT INTO accounts (id, profile_id, name, opening_cents) VALUES (1, 1, 'Banco', 100000);
    INSERT INTO transactions (id, profile_id, account_id, type, amount_cents, date, category_id, note)
      VALUES (1, 1, 1, 'gasto', 25000, '2026-07-10', 1, 'Despensa');
    INSERT INTO budgets (id, profile_id, category_id, amount_cents) VALUES (1, 1, 1, 350000);
  `)
  return db
}

/**
 * Una base parada en la versión anterior, armada corriendo las migraciones
 * publicadas hasta ahí. Es el estado real desde el que actualiza quien ya
 * venía usando Finply, sin tener que pegar el esquema viejo a mano.
 */
function baseEnVersion(version: number): DatabaseSync {
  const db = baseVieja()
  db.exec('PRAGMA foreign_keys = OFF')
  for (const m of MIGRATIONS.filter((m) => m.id <= version)) m.up(db)
  db.exec(`PRAGMA user_version = ${version}`)
  db.exec('PRAGMA foreign_keys = ON')
  return db
}

describe('migraciones', () => {
  test('una base anterior se actualiza sin perder datos', () => {
    const db = baseVieja()
    const antes: any = db.prepare('PRAGMA user_version').get()
    assert.equal(antes.user_version, 0)

    migrate(db)

    const despues: any = db.prepare('PRAGMA user_version').get()
    assert.equal(despues.user_version, SCHEMA_VERSION)

    // Los movimientos ya pueden ligarse a inversiones.
    const columnasTx = (db.prepare('PRAGMA table_info(transactions)').all() as any[]).map((c) => c.name)
    assert.ok(columnasTx.includes('investment_entry_id'))

    // El presupuesto que existía conserva su monto y cae en el mes en curso.
    // Desde la 16 la columna se llama `period` y sigue siendo un mes: el tope
    // de siempre es mensual y no arrastra nada.
    const presupuestos = db.prepare('SELECT * FROM budgets').all() as any[]
    const mesEnCurso = new Date().toLocaleDateString('sv-SE').slice(0, 7)
    assert.equal(presupuestos.length, 1)
    assert.equal(presupuestos[0].amount_cents, 350000)
    assert.equal(presupuestos[0].period, mesEnCurso)
    assert.equal(presupuestos[0].period_kind, 'mes')
    assert.equal(presupuestos[0].rollover, 0)

    // Y nada más se movió.
    const movimiento = db.prepare('SELECT * FROM transactions WHERE id = 1').get() as any
    assert.equal(movimiento.note, 'Despensa')
    assert.equal(movimiento.amount_cents, 25000)
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0)

    // Las tablas que aún no existían quedaron creadas.
    for (const tabla of ['investments', 'investment_entries', 'goals', 'goal_entries', 'notes', 'debts']) {
      assert.doesNotThrow(() => db.prepare(`SELECT COUNT(*) FROM ${tabla}`).get(), `falta ${tabla}`)
    }
    db.close()
  })

  test('migrar dos veces no hace nada la segunda', () => {
    const db = baseVieja()
    migrate(db)
    const primera = db.prepare('SELECT * FROM budgets').all()
    migrate(db)
    assert.deepEqual(db.prepare('SELECT * FROM budgets').all(), primera)
    db.close()
  })

  test('deja una copia antes de migrar una base con datos', () => {
    const db = baseVieja()
    const backupDir = mkdtempSync(path.join(tmpdir(), 'finply-copias-'))
    dirs.push(backupDir)

    migrate(db, { backupDir })

    const copias = readdirSync(backupDir).filter((f) => f.endsWith('.db'))
    assert.equal(copias.length, 1, 'debió dejar exactamente una copia previa')

    // Y la copia conserva el esquema anterior, con los datos intactos.
    const copia = new DatabaseSync(path.join(backupDir, copias[0]!))
    const version: any = copia.prepare('PRAGMA user_version').get()
    const columnas = (copia.prepare('PRAGMA table_info(budgets)').all() as any[]).map((c) => c.name)
    assert.equal(version.user_version, 0)
    assert.ok(!columnas.includes('month'), 'la copia debe ser previa a la migración')
    assert.equal((copia.prepare('SELECT COUNT(*) n FROM budgets').get() as any).n, 1)
    copia.close()
    db.close()
  })

  test('una base vacía no genera copia', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'finply-vacia-'))
    dirs.push(dir)
    const backupDir = path.join(dir, 'respaldos')
    const db = new DatabaseSync(path.join(dir, 'nueva.db'))

    migrate(db, { backupDir })

    assert.ok(!existsSync(backupDir) || readdirSync(backupDir).length === 0)
    db.close()
  })

  test('un libro en la versión 5 llega a crédito sin perder nada', () => {
    const db = baseEnVersion(5)
    // Lo que ese libro ya tenía: una tarjeta y una deuda sin tasa.
    db.exec(`
      INSERT INTO accounts (id, profile_id, name, type, opening_cents)
        VALUES (2, 1, 'Tarjeta', 'tarjeta', -50000);
      INSERT INTO debts (id, profile_id, direction, counterparty, principal_cents, start_date)
        VALUES (1, 1, 'por_pagar', 'Nu', 330000, '2026-06-01');
      INSERT INTO transactions (id, profile_id, account_id, type, amount_cents, date, note)
        VALUES (2, 1, 2, 'gasto', 12000, '2026-07-02', 'Gasolina');
    `)

    migrate(db)

    assert.equal((db.prepare('PRAGMA user_version').get() as any).user_version, SCHEMA_VERSION)

    // Las columnas nuevas nacen vacías: una cuenta sin configurar se comporta
    // igual que antes de migrar.
    const tarjeta = db.prepare('SELECT * FROM accounts WHERE id = 2').get() as any
    assert.equal(tarjeta.opening_cents, -50000)
    assert.equal(tarjeta.credit_limit_cents, null)
    assert.equal(tarjeta.cut_day, null)
    assert.equal(tarjeta.due_day, null)

    // Las deudas de antes son deudas sin intereses, que es lo que eran.
    const deuda = db.prepare('SELECT * FROM debts WHERE id = 1').get() as any
    assert.equal(deuda.principal_cents, 330000)
    assert.equal(deuda.annual_rate_bp, 0)
    assert.equal(deuda.term_months, null)

    // Y los movimientos siguen intactos, ahora con la columna de MSI en nulo.
    const movimiento = db.prepare('SELECT * FROM transactions WHERE id = 2').get() as any
    assert.equal(movimiento.note, 'Gasolina')
    assert.equal(movimiento.amount_cents, 12000)
    assert.equal(movimiento.msi_purchase_id, null)
    assert.equal(movimiento.debt_id, null)

    for (const tabla of ['msi_purchases', 'msi_installments']) {
      assert.doesNotThrow(() => db.prepare(`SELECT COUNT(*) FROM ${tabla}`).get(), `falta ${tabla}`)
    }
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0)
    db.close()
  })

  test('un libro en la versión 6 gana el desembolso sin tocar lo que ya había', () => {
    const db = baseEnVersion(6)
    db.exec(`
      INSERT INTO debts (id, profile_id, direction, counterparty, principal_cents, start_date)
        VALUES (1, 1, 'por_pagar', 'Gustavo', 330000, '2026-06-01');
    `)

    migrate(db)

    assert.equal((db.prepare('PRAGMA user_version').get() as any).user_version, SCHEMA_VERSION)
    // Las deudas de antes no estrenan movimiento: no hay forma de saber si el
    // usuario ya registró ese dinero a mano.
    const movimientos = db.prepare('SELECT * FROM transactions').all() as any[]
    assert.equal(movimientos.length, 1)
    assert.equal(movimientos[0].debt_id, null)
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0)
    db.close()
  })

  test('un libro en la versión 7 estrena saldo insoluto sin cambiar cuentas', () => {
    const db = baseEnVersion(7)
    db.exec(`
      INSERT INTO debts (id, profile_id, direction, counterparty, principal_cents, start_date)
        VALUES (1, 1, 'por_pagar', 'Gustavo', 330000, '2026-06-01');
      INSERT INTO debt_payments (id, debt_id, amount_cents, date, note)
        VALUES (1, 1, 130000, '2026-07-01', 'Primer abono');
      INSERT INTO transactions (id, profile_id, account_id, type, amount_cents, date, note, debt_id)
        VALUES (2, 1, 1, 'ingreso', 330000, '2026-06-01', 'Préstamo', 1);
    `)

    migrate(db)

    // Los abonos viejos son 100 % capital: la deuda sigue valiendo lo mismo
    // que antes de migrar, al centavo.
    const abono = db.prepare('SELECT * FROM debt_payments WHERE id = 1').get() as any
    assert.equal(abono.amount_cents, 130000)
    assert.equal(abono.interest_cents, 0)

    const deuda = db.prepare('SELECT * FROM debts WHERE id = 1').get() as any
    assert.equal(deuda.down_payment_cents, 0)
    const insoluto = db
      .prepare(
        `SELECT principal_cents - COALESCE((SELECT SUM(amount_cents - interest_cents)
          FROM debt_payments WHERE debt_id = 1), 0) AS saldo FROM debts WHERE id = 1`,
      )
      .get() as any
    assert.equal(insoluto.saldo, 200000)

    // Y el movimiento que ya estaba ligado queda marcado como desembolso: es
    // lo único que podía ser antes de que existiera el enganche.
    const movimiento = db.prepare('SELECT * FROM transactions WHERE id = 2').get() as any
    assert.equal(movimiento.debt_role, 'desembolso')
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0)
    db.close()
  })

  test('un libro en la versión 8 estrena recurrencias sin estrenar propuestas', () => {
    const db = baseEnVersion(8)
    db.exec(`
      INSERT INTO transactions (id, profile_id, account_id, type, amount_cents, date, note)
        VALUES (2, 1, 1, 'gasto', 850000, '2026-07-01', 'Renta');
    `)

    migrate(db)

    assert.equal((db.prepare('PRAGMA user_version').get() as any).user_version, SCHEMA_VERSION)

    // La migración es puramente aditiva: nadie estrena plantillas ni
    // propuestas, y nada del libro se movió.
    for (const tabla of ['recurrences', 'recurrence_tags', 'recurrence_runs']) {
      assert.equal(
        (db.prepare(`SELECT COUNT(*) AS n FROM ${tabla}`).get() as any).n,
        0,
        `${tabla} debió nacer vacía`,
      )
    }
    const movimiento = db.prepare('SELECT * FROM transactions WHERE id = 2').get() as any
    assert.equal(movimiento.note, 'Renta')
    assert.equal(movimiento.amount_cents, 850000)
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM transactions').get() as any).n, 2)
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0)
    db.close()
  })

  test('anular un movimiento se lleva el periodo que asentó', () => {
    // Es la cascada que devuelve una propuesta a la bandeja cuando el usuario
    // anula lo que había asentado. Vive en la base, no en la ruta.
    const db = baseEnVersion(8)
    migrate(db)
    db.exec(`
      INSERT INTO recurrences (id, profile_id, account_id, type, amount_cents, frequency,
        day_of_month, start_date)
        VALUES (1, 1, 1, 'gasto', 850000, 'mensual', 1, '2026-04-01');
      INSERT INTO transactions (id, profile_id, account_id, type, amount_cents, date, note)
        VALUES (2, 1, 1, 'gasto', 850000, '2026-07-01', 'Renta');
      INSERT INTO recurrence_runs (recurrence_id, period, status, tx_id)
        VALUES (1, '2026-07', 'asentado', 2);
      INSERT INTO recurrence_runs (recurrence_id, period, status)
        VALUES (1, '2026-06', 'descartado');
    `)

    // Y el mismo periodo no cabe dos veces: es la red de R5.
    assert.throws(
      () =>
        db.exec(
          `INSERT INTO recurrence_runs (recurrence_id, period, status)
           VALUES (1, '2026-07', 'descartado')`,
        ),
      /UNIQUE/,
    )

    db.exec('DELETE FROM transactions WHERE id = 2')
    const runs = db.prepare('SELECT * FROM recurrence_runs').all() as any[]
    assert.equal(runs.length, 1, 'el asentado se fue con su movimiento')
    assert.equal(runs[0].period, '2026-06', 'el descartado no tiene movimiento y se queda')
    db.close()
  })

  test('un libro en la versión 9 estrena tinta propia sin estrenar color', () => {
    const db = baseEnVersion(9)
    db.exec(`
      INSERT INTO profiles (id, name, kind, accent) VALUES (2, 'Negocio', 'negocio', 'vino');
      INSERT INTO transactions (id, profile_id, account_id, type, amount_cents, date, note)
        VALUES (2, 1, 1, 'gasto', 850000, '2026-07-01', 'Renta');
    `)

    migrate(db)

    assert.equal((db.prepare('PRAGMA user_version').get() as any).user_version, SCHEMA_VERSION)

    // Aditiva de verdad: los perfiles que ya existían siguen con su preset y
    // las columnas nuevas nacen nulas, así que nadie cambia de color al
    // actualizar.
    const perfiles = db.prepare('SELECT * FROM profiles ORDER BY id').all() as any[]
    assert.equal(perfiles.length, 2)
    assert.equal(perfiles[0].accent, 'verde')
    assert.equal(perfiles[1].accent, 'vino')
    for (const p of perfiles) {
      assert.equal(p.accent_hex, null, 'la tinta propia nace vacía')
      assert.equal(p.accent_hex_dark, null)
    }
    const movimiento = db.prepare('SELECT * FROM transactions WHERE id = 2').get() as any
    assert.equal(movimiento.amount_cents, 850000, 'y el libro no se movió')
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0)
    db.close()
  })

  test('un libro en la versión 10 estrena unidades sin tocar sus inversiones', () => {
    const db = baseEnVersion(10)
    db.exec(`
      INSERT INTO investments (id, profile_id, name, kind) VALUES (1, 1, 'CETES', 'cetes');
      INSERT INTO investment_entries (id, investment_id, type, amount_cents, date)
        VALUES (1, 1, 'aporte', 500000, '2026-01-10');
      INSERT INTO investment_entries (id, investment_id, type, amount_cents, date)
        VALUES (2, 1, 'valuacion', 512500, '2026-06-01');
    `)

    migrate(db)

    assert.equal((db.prepare('PRAGMA user_version').get() as any).user_version, SCHEMA_VERSION)

    // Las dos columnas nuevas nacen nulas: una inversión que solo llevaba
    // montos vale exactamente lo mismo después de migrar que antes.
    const entradas = db.prepare('SELECT * FROM investment_entries ORDER BY id').all() as any[]
    assert.equal(entradas.length, 2)
    for (const e of entradas) {
      assert.equal(e.units_e8, null, 'las unidades nacen vacías')
      assert.equal(e.unit_price_cents, null)
    }
    assert.equal(entradas[0].amount_cents, 500000)
    assert.equal(entradas[1].amount_cents, 512500, 'la valuación sigue siendo su monto')
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0)
    db.close()
  })

  test('un libro en la versión 11 estrena el perfil de negocio sin estrenarlo', () => {
    const db = baseEnVersion(11)
    db.exec(`
      INSERT INTO categories (id, profile_id, name, kind) VALUES (99, 1, 'Insumos', 'gasto');
      INSERT INTO transactions (id, profile_id, account_id, type, amount_cents, date, category_id, note)
        VALUES (2, 1, 1, 'gasto', 850000, '2026-07-01', 99, 'Renta');
    `)

    migrate(db)

    assert.equal((db.prepare('PRAGMA user_version').get() as any).user_version, SCHEMA_VERSION)

    // Las tablas nuevas existen y están vacías: nadie hereda contrapartes.
    for (const tabla of ['counterparties', 'invoices', 'cost_centers']) {
      const fila = db.prepare(`SELECT COUNT(*) AS n FROM ${tabla}`).get() as any
      assert.equal(fila.n, 0, `${tabla} nace vacía`)
    }

    // Y el movimiento que ya existía no cambia de significado: sin contraparte,
    // sin centro, sin impuesto y no deducible.
    const mov = db.prepare('SELECT * FROM transactions WHERE id = 2').get() as any
    assert.equal(mov.amount_cents, 850000)
    assert.equal(mov.counterparty_id, null)
    assert.equal(mov.cost_center_id, null)
    assert.equal(mov.invoice_id, null)
    assert.equal(mov.tax_cents, 0, 'sin impuesto declarado, cero')
    assert.equal(mov.deductible, 0)

    const cat = db.prepare('SELECT * FROM categories WHERE id = 99').get() as any
    assert.equal(cat.role, null, 'sin clasificar, que no es lo mismo que fijo')
    const perfil = db.prepare('SELECT * FROM profiles WHERE id = 1').get() as any
    assert.equal(perfil.dimension_label, 'Proyecto')
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0)
    db.close()
  })

  test('un libro en la versión 13 estrena el reparto y la conciliación sin estrenarlos', () => {
    const db = baseEnVersion(13)
    db.exec(`
      INSERT INTO categories (id, profile_id, name, kind) VALUES (77, 1, 'Despensa quincenal', 'gasto');
      INSERT INTO transactions (id, profile_id, account_id, type, amount_cents, date, category_id, note)
        VALUES (3, 1, 1, 'gasto', 123456, '2026-07-15', 77, 'Despensa');
    `)

    migrate(db)

    assert.equal((db.prepare('PRAGMA user_version').get() as any).user_version, SCHEMA_VERSION)

    // Las tres tablas nuevas existen y nacen vacías: nadie hereda un reparto,
    // un corte ni un recibo que no pidió.
    for (const tabla of ['tx_splits', 'account_statements', 'tx_attachments']) {
      const fila = db.prepare(`SELECT COUNT(*) AS n FROM ${tabla}`).get() as any
      assert.equal(fila.n, 0, `${tabla} nace vacía`)
    }

    // Y el movimiento que ya existía significa exactamente lo mismo que antes:
    // su categoría manda porque no tiene reparto, no está conciliado y no
    // devuelve nada. Es lo que hace inofensiva a esta migración.
    const mov = db.prepare('SELECT * FROM transactions WHERE id = 3').get() as any
    assert.equal(mov.amount_cents, 123456)
    assert.equal(mov.category_id, 77)
    assert.equal(mov.reconciled_at, null, 'sin conciliar, que es como estaba')
    assert.equal(mov.refund_of_id, null)
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0)
    db.close()
  })

  test('un libro en la versión 15 estrena el ritmo sin estrenar un solo tope', () => {
    const db = baseEnVersion(15)
    db.exec(`
      INSERT INTO categories (id, profile_id, name, kind) VALUES (88, 1, 'Gasolina', 'gasto');
      INSERT INTO budgets (id, profile_id, category_id, month, amount_cents)
        VALUES (7, 1, 88, '2026-07', 240000);
    `)

    migrate(db)

    assert.equal((db.prepare('PRAGMA user_version').get() as any).user_version, SCHEMA_VERSION)

    // El renombre es de metadatos: la fila es la misma, con el mismo id y el
    // mismo monto, y su periodo sigue siendo el mes que el usuario escribió.
    const tope = db.prepare('SELECT * FROM budgets WHERE id = 7').get() as any
    assert.equal(tope.amount_cents, 240000)
    assert.equal(tope.period, '2026-07')
    // Y significa exactamente lo que significaba: mensual y sin arrastre. Los
    // valores por omisión son los que dejan el libro igual que ayer (R2).
    assert.equal(tope.period_kind, 'mes')
    assert.equal(tope.rollover, 0)

    // La columna vieja ya no existe y el índice sobrevivió al renombre.
    const columnas = (db.prepare('PRAGMA table_info(budgets)').all() as any[]).map((c) => c.name)
    assert.ok(!columnas.includes('month'))
    const indice = db
      .prepare("SELECT sql FROM sqlite_master WHERE name = 'idx_budgets_profile_month'")
      .get() as any
    assert.match(indice.sql, /period/)

    // Y nadie hereda un tope total que no pidió.
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM budget_totals').get() as any).n, 0)
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0)
    db.close()
  })

  test('borrar el movimiento se lleva su reparto y su recibo, pero no su devolución', () => {
    const db = baseEnVersion(13)
    migrate(db)
    db.exec(`
      INSERT INTO categories (id, profile_id, name, kind) VALUES (77, 1, 'Ropa de trabajo', 'gasto');
      INSERT INTO categories (id, profile_id, name, kind) VALUES (78, 1, 'Devoluciones', 'ingreso');
      INSERT INTO transactions (id, profile_id, account_id, type, amount_cents, date, category_id)
        VALUES (10, 1, 1, 'gasto', 100000, '2026-07-01', 77);
      INSERT INTO tx_splits (tx_id, category_id, amount_cents) VALUES (10, 77, 100000);
      INSERT INTO tx_attachments (tx_id, filename, size_bytes, data_b64)
        VALUES (10, 'ticket.png', 4, 'AAAA');
      INSERT INTO transactions (id, profile_id, account_id, type, amount_cents, date, category_id, refund_of_id)
        VALUES (11, 1, 1, 'ingreso', 30000, '2026-07-09', 78, 10);
    `)

    db.exec('DELETE FROM transactions WHERE id = 10')

    // El reparto y el recibo son del movimiento: se van con él.
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM tx_splits').get() as any).n, 0)
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM tx_attachments').get() as any).n, 0)
    // La devolución no: ese dinero sí entró a la cuenta. Solo pierde la liga,
    // igual que el desembolso de una deuda cuando se borra la deuda.
    const devolucion = db.prepare('SELECT * FROM transactions WHERE id = 11').get() as any
    assert.equal(devolucion.amount_cents, 30000)
    assert.equal(devolucion.refund_of_id, null)
    db.close()
  })

  test('los CHECK de crédito rechazan datos imposibles', () => {
    const db = baseEnVersion(5)
    migrate(db)
    assert.throws(() => db.exec('UPDATE accounts SET cut_day = 45 WHERE id = 1'), /CHECK/)
    assert.throws(() => db.exec('UPDATE accounts SET credit_limit_cents = -1 WHERE id = 1'), /CHECK/)
    db.close()
  })

  test('un libro con facturas llega a la 17 sin que cambie una sola cifra', () => {
    const db = baseEnVersion(16)
    // Lo que ese libro ya tenía: un cliente, una factura y su cobro parcial.
    db.exec(`
      INSERT INTO counterparties (id, profile_id, name) VALUES (1, 1, 'Oficinas Mérida');
      INSERT INTO invoices (id, profile_id, counterparty_id, direction, folio, issue_date,
        subtotal_cents, tax_cents)
        VALUES (1, 1, 1, 'emitida', 'A-1', '2026-07-01', 100000, 16000);
      INSERT INTO transactions (id, profile_id, account_id, type, amount_cents, date, invoice_id)
        VALUES (5, 1, 1, 'ingreso', 40000, '2026-07-15', 1);
    `)

    migrate(db)

    assert.equal((db.prepare('PRAGMA user_version').get() as any).user_version, SCHEMA_VERSION)

    // Las retenciones nacen en cero, así que lo cobrable sigue siendo el total
    // y esa factura debe exactamente lo mismo que ayer: $760.00 de $1,160.00.
    const factura = db.prepare('SELECT * FROM invoices WHERE id = 1').get() as any
    assert.equal(factura.withheld_tax_cents, 0)
    assert.equal(factura.withheld_income_cents, 0)
    assert.equal(
      factura.subtotal_cents + factura.tax_cents - factura.withheld_tax_cents - factura.withheld_income_cents - 40000,
      76000,
    )

    // Nadie hereda notas de crédito ni plantillas que no pidió.
    for (const tabla of ['invoice_credit_notes', 'invoice_recurrences', 'invoice_recurrence_runs']) {
      assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM ${tabla}`).get() as any).n, 0, tabla)
    }
    // Y la tarjeta sigue sin tasa: sin ella Finply calla en vez de suponerla.
    const cuenta = db.prepare('SELECT * FROM accounts WHERE id = 1').get() as any
    assert.equal(cuenta.annual_rate_bp, null)
    assert.equal(cuenta.min_payment_bp, null)
    assert.equal(cuenta.min_payment_floor_cents, null)
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0)
    db.close()
  })

  test('una nota de crédito no puede existir sin su factura', () => {
    const db = baseEnVersion(16)
    migrate(db)
    db.exec(`
      INSERT INTO counterparties (id, profile_id, name) VALUES (1, 1, 'Cliente');
      INSERT INTO invoices (id, profile_id, counterparty_id, direction, issue_date, subtotal_cents)
        VALUES (1, 1, 1, 'emitida', '2026-07-01', 100000);
      INSERT INTO invoice_credit_notes (invoice_id, date, amount_cents) VALUES (1, '2026-07-05', 20000);
    `)
    // Cancelar en negativo sería subir la factura por la puerta de atrás.
    assert.throws(
      () => db.exec("INSERT INTO invoice_credit_notes (invoice_id, date, amount_cents) VALUES (1, '2026-07-06', -1)"),
      /CHECK/,
    )
    // Y la nota se va con su factura: no es un documento independiente.
    db.exec('DELETE FROM invoices WHERE id = 1')
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM invoice_credit_notes').get() as any).n, 0)
    db.close()
  })

  test('un libro llega a la 18 sin que cambie una sola cifra, y sin módulos que no pidió', () => {
    const db = baseEnVersion(17)
    // Lo que ese libro ya tenía: un bien, un movimiento y su saldo.
    db.exec(`
      INSERT INTO assets (id, profile_id, name, kind, cost_cents, acquired_date)
        VALUES (1, 1, 'Casa de Coyoacán', 'inmueble', 200000000, '2020-01-01');
      INSERT INTO transactions (id, profile_id, account_id, type, amount_cents, date)
        VALUES (7, 1, 1, 'ingreso', 1500000, '2026-07-05');
    `)

    migrate(db)

    assert.equal((db.prepare('PRAGMA user_version').get() as any).user_version, SCHEMA_VERSION)

    // D16: las tablas existen aunque nadie tenga el módulo encendido, para que
    // prenderlo a media vida del libro no exija una migración (R1).
    for (const tabla of ['rentals', 'time_entries', 'products', 'stock_moves']) {
      assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM ${tabla}`).get() as any).n, 0, tabla)
    }

    // Y el movimiento que ya estaba sigue siendo lo que era: sin papel de
    // arrendamiento, así que ningún ingreso viejo se vuelve depósito.
    const tx = db.prepare('SELECT * FROM transactions WHERE id = 7').get() as any
    assert.equal(tx.amount_cents, 1500000)
    assert.equal(tx.rental_id, null)
    assert.equal(tx.rental_role, null)
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0)
    db.close()
  })

  test('un papel de arrendamiento inventado no entra a la base', () => {
    const db = baseEnVersion(17)
    migrate(db)
    db.exec(`
      INSERT INTO assets (id, profile_id, name, kind, cost_cents, acquired_date)
        VALUES (1, 1, 'Local', 'inmueble', 100000, '2020-01-01');
      INSERT INTO rentals (id, profile_id, asset_id, tenant, rent_cents, deposit_cents,
        payment_day, start_date) VALUES (1, 1, 1, 'Inquilino', 1000, 0, 5, '2026-01-01');
    `)
    // Solo los cuatro papeles que el rendimiento sabe interpretar: uno de más y
    // el depósito dejaría de ser reconocible como tal.
    assert.throws(
      () =>
        db.exec(
          `INSERT INTO transactions (id, profile_id, account_id, type, amount_cents, date,
             rental_id, rental_role) VALUES (9, 1, 1, 'ingreso', 1000, '2026-07-05', 1, 'renta_atrasada')`,
        ),
      /CHECK/,
    )
    // Y el contrato se puede borrar dejando el movimiento: ese dinero se movió.
    db.exec(
      `INSERT INTO transactions (id, profile_id, account_id, type, amount_cents, date,
         rental_id, rental_role) VALUES (10, 1, 1, 'ingreso', 1000, '2026-07-05', 1, 'deposito')`,
    )
    db.exec('DELETE FROM rentals WHERE id = 1')
    const tx = db.prepare('SELECT * FROM transactions WHERE id = 10').get() as any
    assert.equal(tx.amount_cents, 1000, 'el movimiento se queda')
    assert.equal(tx.rental_id, null, 'solo pierde la liga')
    db.close()
  })

  test('un libro en la versión 19 estrena las ligas de la libreta sin atar una sola nota', () => {
    const db = baseEnVersion(19)
    db.exec(`
      INSERT INTO notes (id, profile_id, title, body, pinned)
        VALUES (1, 1, 'Pendientes', 'Cobrarle a Luis.', 1);
    `)

    migrate(db)

    assert.equal((db.prepare('PRAGMA user_version').get() as any).user_version, SCHEMA_VERSION)
    // Lo que falta significa "lo de antes": la nota que ya existía sigue
    // siendo una nota suelta, que es exactamente lo que era.
    const nota = db.prepare('SELECT * FROM notes WHERE id = 1').get() as any
    assert.equal(nota.body, 'Cobrarle a Luis.')
    assert.equal(nota.pinned, 1)
    assert.equal(nota.tx_id, null)
    assert.equal(nota.period, null)
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0)
    db.close()
  })

  test('anular el movimiento deja la nota en la libreta y solo le quita la liga', () => {
    const db = baseEnVersion(19)
    migrate(db)
    db.exec(`
      INSERT INTO transactions (id, profile_id, account_id, type, amount_cents, date)
        VALUES (40, 1, 1, 'gasto', 180000, '2026-07-12');
      INSERT INTO notes (id, profile_id, title, body, tx_id)
        VALUES (2, 1, 'Por qué tan caro', 'Llevé a los niños.', 40);
    `)

    db.exec('DELETE FROM transactions WHERE id = 40')

    // ON DELETE SET NULL y no CASCADE: ese dinero se fue, pero lo que el
    // usuario escribió es suyo. Mismo trato que el desembolso de una deuda.
    const nota = db.prepare('SELECT * FROM notes WHERE id = 2').get() as any
    assert.equal(nota.body, 'Llevé a los niños.')
    assert.equal(nota.tx_id, null)
    db.close()
  })

  test('un libro en la versión 20 estrena la personalización sin estrenar una sola preferencia', () => {
    const db = baseEnVersion(20)
    db.exec(`
      INSERT INTO transactions (id, profile_id, account_id, type, amount_cents, date)
        VALUES (50, 1, 1, 'gasto', 42000, '2026-07-12');
    `)

    migrate(db)

    assert.equal((db.prepare('PRAGMA user_version').get() as any).user_version, SCHEMA_VERSION)

    // D16 otra vez: las tablas existen aunque nadie tenga un campo propio, para
    // que crearlo a media vida del libro no exija una migración (R1).
    for (const tabla of ['profile_fields', 'tx_field_values', 'tx_templates']) {
      assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM ${tabla}`).get() as any).n, 0, tabla)
    }

    // Y el perfil que ya existía se ve exactamente igual que ayer: lo que falta
    // significa "lo de antes", así que nadie estrena un formato ni un orden.
    const perfil = db.prepare('SELECT * FROM profiles WHERE id = 1').get() as any
    assert.equal(perfil.nav_order, null)
    assert.equal(perfil.home_view, null)
    assert.equal(perfil.date_format, null)
    assert.equal(perfil.week_start, null)
    assert.equal(perfil.hide_cents, 0)

    const tx = db.prepare('SELECT * FROM transactions WHERE id = 50').get() as any
    assert.equal(tx.amount_cents, 42000)
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0)
    db.close()
  })

  test('borrar el campo se lleva sus respuestas; borrar el movimiento también', () => {
    const db = baseEnVersion(20)
    migrate(db)
    db.exec(`
      INSERT INTO profile_fields (id, profile_id, label, kind) VALUES (1, 1, 'Placa', 'texto');
      INSERT INTO transactions (id, profile_id, account_id, type, amount_cents, date)
        VALUES (60, 1, 1, 'gasto', 1000, '2026-07-12');
      INSERT INTO tx_field_values (tx_id, field_id, value) VALUES (60, 1, 'ABC-123');
    `)

    // Una respuesta sin su campo o sin su movimiento no significa nada: aquí
    // sí es CASCADE, al revés que la nota de la Fase 20 —esa es texto que el
    // usuario escribió por su cuenta; esto es la respuesta a una pregunta que
    // ya no existe—.
    db.exec('DELETE FROM transactions WHERE id = 60')
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM tx_field_values').get() as any).n, 0)

    db.exec(`
      INSERT INTO transactions (id, profile_id, account_id, type, amount_cents, date)
        VALUES (61, 1, 1, 'gasto', 1000, '2026-07-12');
      INSERT INTO tx_field_values (tx_id, field_id, value) VALUES (61, 1, 'XYZ-789');
    `)
    db.exec('DELETE FROM profile_fields WHERE id = 1')
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM tx_field_values').get() as any).n, 0)
    // El movimiento se queda: ese dinero se movió, y lo que se fue con el campo
    // es solo la respuesta a una pregunta que ya no existe.
    const vivo = db.prepare('SELECT * FROM transactions WHERE id = 61').get() as any
    assert.equal(vivo.amount_cents, 1000)
    db.close()
  })

  test('una plantilla sobrevive a que archiven su cuenta o borren su categoría', () => {
    const db = baseEnVersion(20)
    migrate(db)
    db.exec(`
      INSERT INTO tx_templates (id, profile_id, name, type, account_id, category_id)
        VALUES (1, 1, 'Gasolina', 'gasto', 1, 1);
      DELETE FROM categories WHERE id = 1;
    `)
    // Coja pero viva: borrarla tiraría el nombre y el concepto que ya se
    // habían escrito, y eso es más de lo que el usuario pidió.
    const plantilla = db.prepare('SELECT * FROM tx_templates WHERE id = 1').get() as any
    assert.equal(plantilla.name, 'Gasolina')
    assert.equal(plantilla.category_id, null)
    db.close()
  })

  test('una base de una versión más nueva no se toca', () => {
    const db = baseVieja()
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`)
    assert.throws(() => migrate(db), /más nueva/)
    db.close()
  })
})
