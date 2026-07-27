// Datos de ejemplo para probar Finply con el libro lleno.
//   npm run seed   → dos perfiles demo con tres meses de movimientos
//   npm run reset  → borra todo y deja un perfil vacío para empezar de cero
import { db, inTransaction, seedCategories } from './db.ts'

const empty = process.argv.includes('--empty')

// Generador pseudoaleatorio con semilla fija: el demo siempre luce igual.
let state = 42
function rnd(): number {
  state = (state * 1664525 + 1013904223) % 4294967296
  return state / 4294967296
}
function between(minPesos: number, maxPesos: number): number {
  return Math.round((minPesos + rnd() * (maxPesos - minPesos)) * 100)
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(rnd() * arr.length)]!
}

function wipe(): void {
  db.exec(`
    DELETE FROM transactions;
    DELETE FROM debt_payments;
    DELETE FROM debts;
    DELETE FROM investment_entries;
    DELETE FROM investments;
    DELETE FROM budgets;
    DELETE FROM goal_entries;
    DELETE FROM goals;
    DELETE FROM notes;
    DELETE FROM categories;
    DELETE FROM accounts;
    DELETE FROM profiles;
  `)
}

function createProfile(name: string, kind: 'personal' | 'negocio', accent: string): number {
  const result = db
    .prepare('INSERT INTO profiles (name, kind, accent) VALUES (?, ?, ?)')
    .run(name, kind, accent)
  const id = Number(result.lastInsertRowid)
  seedCategories(id, kind)
  return id
}

function createAccount(
  profileId: number,
  name: string,
  type: string,
  openingPesos: number,
): number {
  const result = db
    .prepare('INSERT INTO accounts (profile_id, name, type, opening_cents) VALUES (?, ?, ?, ?)')
    .run(profileId, name, type, Math.round(openingPesos * 100))
  return Number(result.lastInsertRowid)
}

function categoryId(profileId: number, name: string, kind: 'ingreso' | 'gasto'): number {
  const row: any = db
    .prepare('SELECT id FROM categories WHERE profile_id = ? AND name = ? AND kind = ?')
    .get(profileId, name, kind)
  return row.id
}

function tx(
  profileId: number,
  accountId: number,
  type: 'ingreso' | 'gasto' | 'transferencia',
  cents: number,
  date: string,
  catId: number | null,
  note: string,
  transferAccountId: number | null = null,
): void {
  db.prepare(
    `INSERT INTO transactions (profile_id, account_id, type, amount_cents, date, category_id, note, transfer_account_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(profileId, accountId, type, cents, date, catId, note, transferAccountId)
}

function day(month: string, d: number): string {
  return `${month}-${String(d).padStart(2, '0')}`
}

inTransaction(() => {
  wipe()

  if (empty) {
    createProfile('Mi perfil', 'personal', 'verde')
    console.log('[finply] Libro en blanco: un perfil vacío, listo para tus registros.')
    return
  }

  // ── Perfil 1: personal ────────────────────────────────────────────────
  const personal = createProfile('Ana · Personal', 'personal', 'verde')
  const efectivo = createAccount(personal, 'Efectivo', 'efectivo', 1800)
  const banco = createAccount(personal, 'BBVA Nómina', 'banco', 24500)
  const ahorro = createAccount(personal, 'Ahorro', 'ahorro', 52000)

  const cSuper = categoryId(personal, 'Súper', 'gasto')
  const cComida = categoryId(personal, 'Comida', 'gasto')
  const cTransporte = categoryId(personal, 'Transporte', 'gasto')
  const cRenta = categoryId(personal, 'Renta', 'gasto')
  const cServicios = categoryId(personal, 'Servicios', 'gasto')
  const cOcio = categoryId(personal, 'Ocio', 'gasto')
  const cSueldo = categoryId(personal, 'Sueldo', 'ingreso')
  const cOtrosIn = categoryId(personal, 'Otros', 'ingreso')

  const months = ['2026-05', '2026-06', '2026-07']
  const lastDay = { '2026-05': 31, '2026-06': 30, '2026-07': 24 } as Record<string, number>

  for (const m of months) {
    const limit = lastDay[m]!
    tx(personal, banco, 'gasto', 450000, day(m, 1), cRenta, 'Renta depto')
    tx(personal, banco, 'ingreso', 850000, day(m, 15), cSueldo, 'Quincena')
    if (limit >= 28) tx(personal, banco, 'ingreso', 850000, day(m, limit === 31 ? 30 : 28), cSueldo, 'Quincena')
    tx(personal, banco, 'gasto', 49900, day(m, 8), cServicios, 'Internet')
    if (m !== '2026-06') tx(personal, banco, 'gasto', between(320, 460), day(m, 5), cServicios, 'Luz CFE')
    if (limit >= 16) tx(personal, banco, 'transferencia', 150000, day(m, 16), null, 'Apartado mensual', ahorro)
    // retiros de cajero: el efectivo sale del banco, nunca de la nada
    tx(personal, banco, 'transferencia', 200000, day(m, 2), null, 'Retiro de cajero', efectivo)
    if (limit >= 18) tx(personal, banco, 'transferencia', 200000, day(m, 18), null, 'Retiro de cajero', efectivo)
    for (const d of [3, 10, 17, 24]) {
      if (d > limit) continue
      tx(personal, pick([efectivo, banco]), 'gasto', between(420, 980), day(m, d), cSuper, pick(['Súper semanal', 'Despensa', 'Súper y farmacia']))
    }
    for (let i = 0; i < 7; i++) {
      const d = 1 + Math.floor(rnd() * limit)
      tx(personal, efectivo, 'gasto', between(38, 120), day(m, d), cTransporte, pick(['Metro', 'Gasolina', 'Uber', 'Estacionamiento']))
    }
    for (let i = 0; i < 5; i++) {
      const d = 1 + Math.floor(rnd() * limit)
      tx(personal, pick([efectivo, banco]), 'gasto', between(95, 420), day(m, d), cComida, pick(['Tacos', 'Café', 'Comida corrida', 'Cena fuera']))
    }
    for (let i = 0; i < 2; i++) {
      const d = 1 + Math.floor(rnd() * limit)
      tx(personal, banco, 'gasto', between(150, 600), day(m, d), cOcio, pick(['Cine', 'Streaming', 'Salida', 'Libros']))
    }
  }
  tx(personal, banco, 'ingreso', 240000, '2026-06-20', cOtrosIn, 'Proyecto freelance')

  // ── Perfil 2: negocio ─────────────────────────────────────────────────
  const negocio = createProfile('Negocio', 'negocio', 'laton')
  const caja = createAccount(negocio, 'Caja', 'efectivo', 3500)
  const bancoNeg = createAccount(negocio, 'Banco Negocio', 'banco', 18300)

  const nVentas = categoryId(negocio, 'Ventas', 'ingreso')
  const nInsumos = categoryId(negocio, 'Insumos', 'gasto')
  const nNomina = categoryId(negocio, 'Nómina', 'gasto')
  const nRenta = categoryId(negocio, 'Renta', 'gasto')
  const nServicios = categoryId(negocio, 'Servicios', 'gasto')

  for (const m of ['2026-06', '2026-07']) {
    const limit = lastDay[m]!
    tx(negocio, bancoNeg, 'gasto', 350000, day(m, 1), nRenta, 'Renta local')
    tx(negocio, bancoNeg, 'gasto', between(280, 520), day(m, 6), nServicios, 'Luz y agua')
    tx(negocio, bancoNeg, 'gasto', 380000, day(m, 15), nNomina, 'Nómina quincena')
    if (limit >= 30) tx(negocio, bancoNeg, 'gasto', 380000, day(m, 30), nNomina, 'Nómina quincena')
    for (let d = 1; d <= limit; d++) {
      if (rnd() < 0.28) continue // días sin corte
      tx(negocio, caja, 'ingreso', between(900, 4200), day(m, d), nVentas, 'Corte del día')
      if (rnd() < 0.35) {
        tx(negocio, pick([caja, bancoNeg]), 'gasto', between(180, 1400), day(m, d), nInsumos, pick(['Mercado', 'Proveedor', 'Insumos cocina', 'Empaques']))
      }
    }
    for (const d of [7, 14, 21, 28]) {
      if (d > limit) continue
      tx(negocio, caja, 'transferencia', 300000, day(m, d), null, 'Depósito de caja', bancoNeg)
    }
  }

  // ── Deudas y retornos ─────────────────────────────────────────────────
  const insertDebt = db.prepare(
    `INSERT INTO debts (profile_id, direction, counterparty, concept, principal_cents, start_date, due_date)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
  const insertPayment = db.prepare(
    'INSERT INTO debt_payments (debt_id, amount_cents, date, note) VALUES (?, ?, ?, ?)',
  )

  const luis = Number(
    insertDebt.run(personal, 'por_cobrar', 'Luis', 'Préstamo personal', 250000, '2026-05-10', '2026-09-30').lastInsertRowid,
  )
  insertPayment.run(luis, 50000, '2026-06-12', 'Primer abono')
  insertPayment.run(luis, 50000, '2026-07-14', 'Segundo abono')

  const nu = Number(
    insertDebt.run(personal, 'por_pagar', 'Tarjeta Nu', 'Corte de junio', 380000, '2026-07-02', '2026-08-05').lastInsertRowid,
  )
  insertPayment.run(nu, 100000, '2026-07-18', 'Pago parcial')

  insertDebt.run(negocio, 'por_pagar', 'Proveedor La Espiga', 'Harina y empaques', 520000, '2026-07-05', '2026-07-30')
  insertDebt.run(negocio, 'por_cobrar', 'Oficinas Mérida', 'Pedido corporativo', 240000, '2026-07-10', '2026-08-15')

  // ── Inversiones ───────────────────────────────────────────────────────
  const insertInvestment = db.prepare(
    'INSERT INTO investments (profile_id, name, kind, note) VALUES (?, ?, ?, ?)',
  )
  const insertEntry = db.prepare(
    'INSERT INTO investment_entries (investment_id, type, amount_cents, date, note) VALUES (?, ?, ?, ?, ?)',
  )

  const cetes = Number(insertInvestment.run(personal, 'CETES 28 días', 'cetes', 'Cetesdirecto').lastInsertRowid)
  insertEntry.run(cetes, 'aporte', 1000000, '2026-05-05', 'Aporte inicial')
  insertEntry.run(cetes, 'aporte', 500000, '2026-06-05', '')
  insertEntry.run(cetes, 'valuacion', 1518000, '2026-06-28', '')
  insertEntry.run(cetes, 'valuacion', 1539000, '2026-07-20', '')

  const fondo = Number(insertInvestment.run(personal, 'Fondo indexado', 'fondo', 'S&P 500').lastInsertRowid)
  insertEntry.run(fondo, 'aporte', 2000000, '2026-05-12', 'Aporte inicial')
  insertEntry.run(fondo, 'valuacion', 2044000, '2026-06-15', '')
  insertEntry.run(fondo, 'valuacion', 2112000, '2026-07-15', '')

  const btc = Number(insertInvestment.run(personal, 'Bitcoin', 'cripto', '').lastInsertRowid)
  insertEntry.run(btc, 'aporte', 300000, '2026-06-10', '')
  insertEntry.run(btc, 'valuacion', 274500, '2026-07-18', '')

  // ── Presupuestos ──────────────────────────────────────────────────────
  // Un tope por categoría y por mes: julio afloja en Ocio y aprieta en Súper,
  // como pasa de verdad cuando ajustas el plan sobre la marcha.
  const insertBudget = db.prepare(
    'INSERT INTO budgets (profile_id, category_id, month, amount_cents) VALUES (?, ?, ?, ?)',
  )
  for (const m of months) {
    insertBudget.run(personal, cSuper, m, m === '2026-07' ? 320000 : 350000)
    insertBudget.run(personal, cComida, m, 90000)
    insertBudget.run(personal, cTransporte, m, 90000)
    insertBudget.run(personal, cOcio, m, m === '2026-07' ? 120000 : 80000)
    insertBudget.run(negocio, nInsumos, m, 1500000)
    insertBudget.run(negocio, nServicios, m, 120000)
  }

  // ── Etiquetas ─────────────────────────────────────────────────────────
  // Cruzan categorías: el mismo viaje lleva comida, transporte y hospedaje.
  const insertTag = db.prepare('INSERT INTO tags (profile_id, name) VALUES (?, ?)')
  const tagId = (profileId: number, name: string) =>
    Number(insertTag.run(profileId, name).lastInsertRowid)

  const tViaje = tagId(personal, 'viaje Oaxaca')
  const tFijo = tagId(personal, 'gasto fijo')
  const tReembolsable = tagId(personal, 'reembolsable')
  const tDeducible = tagId(negocio, 'deducible')
  const tProveedor = tagId(negocio, 'proveedor clave')

  const etiquetar = db.prepare(
    'INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)',
  )
  /** Etiqueta los movimientos de un perfil cuyo concepto contenga el texto. */
  const etiquetarPor = (profileId: number, like: string, tag: number, limite = 99) => {
    const filas = db
      .prepare(
        'SELECT id FROM transactions WHERE profile_id = ? AND note LIKE ? ORDER BY date DESC LIMIT ?',
      )
      .all(profileId, `%${like}%`, limite) as { id: number }[]
    for (const fila of filas) etiquetar.run(fila.id, tag)
  }

  etiquetarPor(personal, 'Renta', tFijo)
  etiquetarPor(personal, 'Luz CFE', tFijo)
  etiquetarPor(personal, 'Internet', tFijo)
  etiquetarPor(personal, 'Comida corrida', tViaje, 3)
  etiquetarPor(personal, 'Proyecto freelance', tReembolsable)
  etiquetarPor(negocio, 'Proveedor', tProveedor)
  etiquetarPor(negocio, 'Insumos cocina', tProveedor)
  etiquetarPor(negocio, 'Nómina', tDeducible)
  etiquetarPor(negocio, 'Renta local', tDeducible)

  // ── Metas ─────────────────────────────────────────────────────────────
  const insertGoal = db.prepare(
    'INSERT INTO goals (profile_id, name, target_cents, due_date, note) VALUES (?, ?, ?, ?, ?)',
  )
  const insertGoalEntry = db.prepare(
    'INSERT INTO goal_entries (goal_id, amount_cents, date, note) VALUES (?, ?, ?, ?)',
  )
  const emergencia = Number(
    insertGoal.run(personal, 'Fondo de emergencia', 3000000, null, 'Tres meses de gastos').lastInsertRowid,
  )
  insertGoalEntry.run(emergencia, 800000, '2026-05-16', 'Arranque')
  insertGoalEntry.run(emergencia, 400000, '2026-06-16', '')
  insertGoalEntry.run(emergencia, 300000, '2026-07-16', '')
  const viaje = Number(
    insertGoal.run(personal, 'Viaje a Oaxaca', 1200000, '2026-12-15', 'Diciembre').lastInsertRowid,
  )
  insertGoalEntry.run(viaje, 250000, '2026-06-20', '')
  insertGoalEntry.run(viaje, 200000, '2026-07-20', '')
  const horno = Number(
    insertGoal.run(negocio, 'Horno nuevo', 2500000, '2026-10-01', 'Reponer el horno chico').lastInsertRowid,
  )
  insertGoalEntry.run(horno, 600000, '2026-06-30', 'Utilidad de junio')
  insertGoalEntry.run(horno, 500000, '2026-07-15', '')

  // ── Notas ─────────────────────────────────────────────────────────────
  const insertNote = db.prepare(
    'INSERT INTO notes (profile_id, title, body, pinned) VALUES (?, ?, ?, ?)',
  )
  insertNote.run(
    personal,
    'Pendientes de julio',
    'Pasar el corte de la Nu antes del 5 de agosto.\nCobrarle a Luis el siguiente abono.\nRevisar tasa de CETES al vencer el plazo.',
    1,
  )
  insertNote.run(
    personal,
    'Regla 50/30/20',
    '50 % necesidades · 30 % gustos · 20 % ahorro e inversión.\nEste mes el ahorro va en 18 %, casi.',
    0,
  )
  insertNote.run(
    negocio,
    'Proveedores',
    'La Espiga: pedir harina los lunes.\nEmpaques del Centro: mínimo $800 por pedido.\nPreguntar precio de cajas en Casa Torres.',
    1,
  )

  console.log(
    '[finply] Libro demo listo: 2 perfiles, 5 cuentas, ~240 movimientos, deudas, inversiones, presupuestos, metas y notas.',
  )
})
