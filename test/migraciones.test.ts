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
    const presupuestos = db.prepare('SELECT * FROM budgets').all() as any[]
    const mesEnCurso = new Date().toLocaleDateString('sv-SE').slice(0, 7)
    assert.equal(presupuestos.length, 1)
    assert.equal(presupuestos[0].amount_cents, 350000)
    assert.equal(presupuestos[0].month, mesEnCurso)

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

  test('los CHECK de crédito rechazan datos imposibles', () => {
    const db = baseEnVersion(5)
    migrate(db)
    assert.throws(() => db.exec('UPDATE accounts SET cut_day = 45 WHERE id = 1'), /CHECK/)
    assert.throws(() => db.exec('UPDATE accounts SET credit_limit_cents = -1 WHERE id = 1'), /CHECK/)
    db.close()
  })

  test('una base de una versión más nueva no se toca', () => {
    const db = baseVieja()
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`)
    assert.throws(() => migrate(db), /más nueva/)
    db.close()
  })
})
