// El camino que recorre la base de alguien que ya usaba Finply. Es el que
// nadie prueba a mano y el que, si falla, se lleva datos por delante.

import { after, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { migrate, SCHEMA_VERSION } from '../server/migrations.ts'

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

  test('una base de una versión más nueva no se toca', () => {
    const db = baseVieja()
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`)
    assert.throws(() => migrate(db), /más nueva/)
    db.close()
  })
})
