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
    DELETE FROM budget_totals;
    DELETE FROM goal_entries;
    DELETE FROM goals;
    DELETE FROM notes;
    DELETE FROM invoice_credit_notes;
    DELETE FROM invoice_recurrence_runs;
    DELETE FROM invoice_recurrences;
    DELETE FROM invoices;
    DELETE FROM counterparties;
    DELETE FROM cost_centers;
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
  tarjeta?: {
    limitePesos: number
    corte: number
    pago: number
    /** Tasa anual y pago mínimo en puntos base, como los escribiría el usuario. */
    tasaBp: number
    minimoBp: number
    pisoPesos: number
  },
): number {
  const result = db
    .prepare(
      `INSERT INTO accounts
        (profile_id, name, type, opening_cents, credit_limit_cents, cut_day, due_day,
         annual_rate_bp, min_payment_bp, min_payment_floor_cents)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      profileId,
      name,
      type,
      Math.round(openingPesos * 100),
      tarjeta ? Math.round(tarjeta.limitePesos * 100) : null,
      tarjeta?.corte ?? null,
      tarjeta?.pago ?? null,
      tarjeta?.tasaBp ?? null,
      tarjeta?.minimoBp ?? null,
      tarjeta ? Math.round(tarjeta.pisoPesos * 100) : null,
    )
  return Number(result.lastInsertRowid)
}

function categoryId(profileId: number, name: string, kind: 'ingreso' | 'gasto'): number {
  const row: any = db
    .prepare('SELECT id FROM categories WHERE profile_id = ? AND name = ? AND kind = ?')
    .get(profileId, name, kind)
  return row.id
}

/** Asienta la partida y devuelve su id, para poder ligarla a una plantilla. */
function tx(
  profileId: number,
  accountId: number,
  type: 'ingreso' | 'gasto' | 'transferencia',
  cents: number,
  date: string,
  catId: number | null,
  note: string,
  transferAccountId: number | null = null,
): number {
  const r = db
    .prepare(
      `INSERT INTO transactions (profile_id, account_id, type, amount_cents, date, category_id, note, transfer_account_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(profileId, accountId, type, cents, date, catId, note, transferAccountId)
  return Number(r.lastInsertRowid)
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
  // La tarjeta trae su contrato completo desde la Fase 14: sin tasa ni mínimo,
  // Finply solo podía decir cuánto debes, no cuánto te cuesta deberlo.
  const tarjeta = createAccount(personal, 'Tarjeta Nu', 'tarjeta', 0, {
    limitePesos: 45000,
    corte: 5,
    pago: 25,
    tasaBp: 4590,
    minimoBp: 500,
    pisoPesos: 300,
  })

  const cSuper = categoryId(personal, 'Súper', 'gasto')
  const cComida = categoryId(personal, 'Comida', 'gasto')
  const cTransporte = categoryId(personal, 'Transporte', 'gasto')
  const cRenta = categoryId(personal, 'Renta', 'gasto')
  const cServicios = categoryId(personal, 'Servicios', 'gasto')
  const cOcio = categoryId(personal, 'Ocio', 'gasto')
  const cSueldo = categoryId(personal, 'Sueldo', 'ingreso')
  const cOtrosIn = categoryId(personal, 'Otros', 'ingreso')

  // Catorce meses, no tres. El libro demo tenía un trimestre y con eso no se
  // puede enseñar una tendencia (hacen falta tres meses cerrados), ni la
  // estacionalidad (hace falta el mismo mes del año pasado), ni un promedio
  // por categoría contra el que medir un mes disparado. Julio queda a medias a
  // propósito: es el mes en curso.
  const months: string[] = []
  for (let i = 14; i >= 0; i--) {
    const total = 2026 * 12 + 6 - i
    months.push(`${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`)
  }
  const lastDay = Object.fromEntries(
    months.map((m) => {
      const [y, mo] = m.split('-').map(Number)
      return [m, m === '2026-07' ? 24 : new Date(Date.UTC(y!, mo!, 0)).getUTCDate()]
    }),
  ) as Record<string, number>

  // El gasto sube despacio, como en la vida: un 1.2 % al mes acumulado. Sin
  // esa deriva la tendencia sería plana y la sección de "¿voy subiendo?" no
  // tendría nada que enseñar; con ella, sube sin que se note mes a mes, que es
  // justo el caso que la recta existe para detectar.
  const deriva = (i: number) => 1 + i * 0.012

  // Lo que se repite todos los meses se guarda con su periodo para poder
  // ligarlo después a su plantilla: un libro demo en el que la renta lleva
  // quince meses registrada **a mano** haría creer que nadie usa recurrencias,
  // y dejaría el gasto recurrente del análisis en cero (D11).
  const asentado: { plantilla: string; periodo: string; txId: number }[] = []

  months.forEach((m, i) => {
    const limit = lastDay[m]!
    const sube = (pesos: number) => Math.round(pesos * deriva(i))
    // El sueldo también sube, pero solo una vez al año: el aumento llega en
    // enero, no repartido en doce.
    const sueldo = m >= '2026-01' ? 890000 : 850000

    const renta = tx(personal, banco, 'gasto', m >= '2026-01' ? 470000 : 450000, day(m, 1), cRenta, 'Renta depto')
    asentado.push({ plantilla: 'renta', periodo: m, txId: renta })
    const q1 = tx(personal, banco, 'ingreso', sueldo, day(m, 15), cSueldo, 'Quincena')
    asentado.push({ plantilla: 'quincena', periodo: `${m}-Q1`, txId: q1 })
    if (limit >= 28) {
      const q2 = tx(personal, banco, 'ingreso', sueldo, day(m, limit === 31 ? 30 : 28), cSueldo, 'Quincena')
      asentado.push({ plantilla: 'quincena', periodo: `${m}-Q2`, txId: q2 })
    }
    const internet = tx(personal, banco, 'gasto', 49900, day(m, 8), cServicios, 'Internet')
    asentado.push({ plantilla: 'internet', periodo: m, txId: internet })
    if (m !== '2026-06') tx(personal, banco, 'gasto', sube(between(320, 460)), day(m, 5), cServicios, 'Luz CFE')
    if (limit >= 16) tx(personal, banco, 'transferencia', 150000, day(m, 16), null, 'Apartado mensual', ahorro)
    // retiros de cajero: el efectivo sale del banco, nunca de la nada
    tx(personal, banco, 'transferencia', 200000, day(m, 2), null, 'Retiro de cajero', efectivo)
    if (limit >= 18) tx(personal, banco, 'transferencia', 200000, day(m, 18), null, 'Retiro de cajero', efectivo)
    for (const d of [3, 10, 17, 24]) {
      if (d > limit) continue
      tx(personal, pick([efectivo, banco]), 'gasto', sube(between(420, 980)), day(m, d), cSuper, pick(['Súper semanal', 'Despensa', 'Súper y farmacia']))
    }
    for (let i = 0; i < 7; i++) {
      const d = 1 + Math.floor(rnd() * limit)
      tx(personal, efectivo, 'gasto', sube(between(38, 120)), day(m, d), cTransporte, pick(['Metro', 'Gasolina', 'Uber', 'Estacionamiento']))
    }
    for (let i = 0; i < 5; i++) {
      const d = 1 + Math.floor(rnd() * limit)
      tx(personal, pick([efectivo, banco]), 'gasto', sube(between(95, 420)), day(m, d), cComida, pick(['Tacos', 'Café', 'Comida corrida', 'Cena fuera']))
    }
    for (let i = 0; i < 2; i++) {
      const d = 1 + Math.floor(rnd() * limit)
      tx(personal, banco, 'gasto', between(150, 600), day(m, d), cOcio, pick(['Cine', 'Streaming', 'Salida', 'Libros']))
    }
    // La tarjeta se usa y se abona, pero nunca completa: así es como se junta
    // un saldo revolvente, que es de lo que trata el pago mínimo.
    if (m >= '2026-02') {
      for (let i = 0; i < 3; i++) {
        const d = 1 + Math.floor(rnd() * limit)
        tx(personal, tarjeta, 'gasto', sube(between(380, 1900)), day(m, d), pick([cSuper, cOcio, cComida]), pick(['Compra con tarjeta', 'Farmacia', 'Restaurante', 'Ropa']))
      }
      if (limit >= 25) {
        tx(personal, banco, 'transferencia', between(1500, 2600), day(m, 25), null, 'Pago tarjeta', tarjeta)
      }
    }
    // Diciembre cuesta más. Es el caso que la estacionalidad viene a mostrar y
    // el que un "mes contra el anterior" nunca puede explicar.
    if (m.endsWith('-12')) {
      tx(personal, banco, 'gasto', between(3800, 5200), day(m, 18), cOcio, 'Regalos de diciembre')
      tx(personal, banco, 'gasto', between(1800, 2600), day(m, 24), cComida, 'Cena de Navidad')
      tx(personal, banco, 'ingreso', 1200000, day(m, 12), cOtrosIn, 'Aguinaldo')
    }
  })
  tx(personal, banco, 'ingreso', 240000, '2026-06-20', cOtrosIn, 'Proyecto freelance')
  // El mes disparado: junio se fue de viaje. Sirve a tres secciones a la vez —
  // se sale de su promedio, separa la mediana del promedio y no es hormiga.
  tx(personal, banco, 'gasto', 1450000, '2026-06-12', cOcio, 'Vuelos y hotel Oaxaca')

  // ── Perfil 2: negocio ─────────────────────────────────────────────────
  const negocio = createProfile('Negocio', 'negocio', 'laton')
  const caja = createAccount(negocio, 'Caja', 'efectivo', 3500)
  const bancoNeg = createAccount(negocio, 'Banco Negocio', 'banco', 18300)

  const nVentas = categoryId(negocio, 'Ventas', 'ingreso')
  const nInsumos = categoryId(negocio, 'Insumos', 'gasto')
  const nNomina = categoryId(negocio, 'Nómina', 'gasto')
  const nRenta = categoryId(negocio, 'Renta', 'gasto')
  const nServicios = categoryId(negocio, 'Servicios', 'gasto')

  const asentadoNeg: { plantilla: string; periodo: string; txId: number }[] = []
  for (const m of ['2026-06', '2026-07']) {
    const limit = lastDay[m]!
    const rentaLocal = tx(negocio, bancoNeg, 'gasto', 350000, day(m, 1), nRenta, 'Renta local')
    asentadoNeg.push({ plantilla: 'renta', periodo: m, txId: rentaLocal })
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

  // ── Recurrencias ──────────────────────────────────────────────────────
  // La renta, el sueldo y el internet llevan meses cayendo igual: son
  // plantillas, y lo ya registrado se liga a su periodo (`recurrence_runs`)
  // para que la bandeja no proponga quince meses que el libro ya tiene. La
  // suscripción es la excepción a propósito: nace este mes y sin historial,
  // así que deja una propuesta esperando confirmación —que es lo que la Fase 5
  // viene a enseñar— y su próxima ocurrencia alimenta el flujo proyectado.
  const insertRec = db.prepare(
    `INSERT INTO recurrences
      (profile_id, account_id, type, amount_cents, category_id, note, frequency,
       day_of_month, day_of_month_2, start_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const insertRun = db.prepare(
    `INSERT INTO recurrence_runs (recurrence_id, period, status, tx_id)
     VALUES (?, ?, 'asentado', ?)`,
  )
  const ligar = (
    recId: number,
    plantilla: string,
    filas: { plantilla: string; periodo: string; txId: number }[],
  ) => {
    for (const f of filas) if (f.plantilla === plantilla) insertRun.run(recId, f.periodo, f.txId)
  }

  const recRenta = Number(
    insertRec.run(personal, banco, 'gasto', 470000, cRenta, 'Renta depto', 'mensual', 1, null, `${months[0]}-01`)
      .lastInsertRowid,
  )
  ligar(recRenta, 'renta', asentado)

  const recQuincena = Number(
    insertRec.run(personal, banco, 'ingreso', 890000, cSueldo, 'Quincena', 'quincenal', 15, 30, `${months[0]}-01`)
      .lastInsertRowid,
  )
  ligar(recQuincena, 'quincena', asentado)

  const recInternet = Number(
    insertRec.run(personal, banco, 'gasto', 49900, cServicios, 'Internet', 'mensual', 8, null, `${months[0]}-01`)
      .lastInsertRowid,
  )
  ligar(recInternet, 'internet', asentado)

  insertRec.run(personal, banco, 'gasto', 29900, cOcio, 'Suscripción de música', 'mensual', 20, null, '2026-07-01')

  const recRentaNeg = Number(
    insertRec.run(negocio, bancoNeg, 'gasto', 350000, nRenta, 'Renta local', 'mensual', 1, null, '2026-06-01')
      .lastInsertRowid,
  )
  ligar(recRentaNeg, 'renta', asentadoNeg)

  // ── Contrapartes y facturas ───────────────────────────────────────────
  // Cada una está para enseñar una cosa distinta de la Fase 14:
  //
  //   · Oficinas Mérida factura con **retención**: el documento dice $46,400 y
  //     lo que va a llegar son $41,266.67. Sin esa resta, la antigüedad de
  //     saldos prometía cobrar un dinero que nunca iba a llegar.
  //   · Café del Puerto tiene una **nota de crédito**: se canceló media
  //     factura sin borrar el documento y sin mover un peso.
  //   · Escuela Pitágoras pagó un **anticipo**: el dinero ya entró y todavía
  //     no hay factura que lo reclame.
  //   · La iguala de Oficinas Mérida es una **plantilla**: propone y espera.
  const insertContraparte = db.prepare(
    `INSERT INTO counterparties (profile_id, name, role, tax_id, note, contact, credit_days, credit_limit_cents)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const contraparte = (
    name: string,
    role: string,
    taxId: string,
    contact: string,
    creditDays: number | null,
    limitePesos: number | null,
  ) =>
    Number(
      insertContraparte.run(
        negocio,
        name,
        role,
        taxId,
        '',
        contact,
        creditDays,
        limitePesos === null ? null : Math.round(limitePesos * 100),
      ).lastInsertRowid,
    )

  const merida = contraparte('Oficinas Mérida', 'cliente', 'OME260101AB1', 'compras@oficinasmerida.mx', 30, 60000)
  const puerto = contraparte('Café del Puerto', 'cliente', '', 'Sra. Rangel · 999 123 4567', 15, 20000)
  const pitagoras = contraparte('Escuela Pitágoras', 'cliente', '', 'direccion@pitagoras.edu.mx', 30, null)
  const espiga = contraparte('Proveedor La Espiga', 'proveedor', 'ESP240315QW9', 'ventas@laespiga.mx', 15, null)

  const insertCentro = db.prepare('INSERT INTO cost_centers (profile_id, name) VALUES (?, ?)')
  const mostrador = Number(insertCentro.run(negocio, 'Mostrador').lastInsertRowid)
  const eventos = Number(insertCentro.run(negocio, 'Eventos').lastInsertRowid)

  const insertFactura = db.prepare(
    `INSERT INTO invoices
      (profile_id, counterparty_id, direction, folio, concept, issue_date, due_date,
       subtotal_cents, tax_cents, withheld_tax_cents, withheld_income_cents, cost_center_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const factura = (
    cp: number,
    direction: 'emitida' | 'recibida',
    folio: string,
    concept: string,
    issue: string,
    due: string | null,
    subtotal: number,
    impuesto: number,
    retImpuesto = 0,
    retRenta = 0,
    centro: number | null = null,
  ) =>
    Number(
      insertFactura.run(
        negocio, cp, direction, folio, concept, issue, due,
        subtotal, impuesto, retImpuesto, retRenta, centro,
      ).lastInsertRowid,
    )

  // Con retención: $40,000 + $6,400 de impuesto, de los que retienen
  // $4,266.67 de impuesto y $866.66 de renta. Cobrables: $41,266.67.
  const fMerida = factura(merida, 'emitida', 'A-118', 'Pedido corporativo julio', '2026-07-10', '2026-08-09', 4000000, 640000, 426667, 86666, eventos)
  // Cobrada a medias, para que se vea el saldo y el impuesto proporcional.
  db.prepare(
    `INSERT INTO transactions
      (profile_id, account_id, type, amount_cents, date, category_id, note, invoice_id,
       counterparty_id, cost_center_id, tax_cents)
     VALUES (?, ?, 'ingreso', ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(negocio, bancoNeg, 2000000, '2026-07-22', nVentas, 'Folio A-118 · abono', fMerida, merida, eventos, 310160)

  // Con nota de crédito: se facturaron $12,000 + IVA y se canceló la mitad.
  const fPuerto = factura(puerto, 'emitida', 'A-121', 'Pan para evento', '2026-07-18', '2026-08-02', 1200000, 192000, 0, 0, eventos)
  db.prepare(
    `INSERT INTO invoice_credit_notes (invoice_id, date, folio, concept, amount_cents)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(fPuerto, '2026-07-24', 'NC-7', 'Se canceló la mitad del pedido', 696000)

  factura(pitagoras, 'emitida', 'A-124', 'Desayunos escolares agosto', '2026-07-28', '2026-08-27', 1800000, 288000, 0, 0, mostrador)
  // Una vencida de hace rato: es la que la lista de cobranza pone hasta arriba,
  // y sin ninguna así la sección no enseñaría para qué sirve.
  factura(puerto, 'emitida', 'A-102', 'Pan de mayo', '2026-05-08', '2026-05-23', 300000, 48000, 0, 0, mostrador)
  factura(espiga, 'recibida', 'E-9012', 'Harina y empaques', '2026-07-12', '2026-07-27', 450000, 72000)

  // El anticipo: Escuela Pitágoras adelantó dinero antes de que hubiera
  // factura. Ya es ingreso de julio (D14) y no lo reclama ningún documento.
  db.prepare(
    `INSERT INTO transactions
      (profile_id, account_id, type, amount_cents, date, category_id, note, counterparty_id)
     VALUES (?, ?, 'ingreso', ?, ?, ?, ?, ?)`,
  ).run(negocio, bancoNeg, 500000, '2026-07-20', nVentas, 'Anticipo para el pedido de agosto', pitagoras)

  // La plantilla: una iguala mensual que propone y espera. Nace en junio y
  // nadie ha emitido nada, así que deja dos periodos en la bandeja.
  db.prepare(
    `INSERT INTO invoice_recurrences
      (profile_id, counterparty_id, direction, concept, subtotal_cents, tax_cents,
       withheld_tax_cents, withheld_income_cents, cost_center_id, credit_days,
       frequency, day_of_month, start_date)
     VALUES (?, ?, 'emitida', ?, ?, ?, ?, ?, ?, ?, 'mensual', 1, '2026-06-01')`,
  ).run(negocio, merida, 'Iguala mensual de pan', 800000, 128000, 85333, 17333, eventos, 30)

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
    `INSERT INTO budgets (profile_id, category_id, period, period_kind, amount_cents, rollover)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
  const topeMes = (profileId: number, categoryId: number, mes: string, cents: number, rueda = 0) =>
    insertBudget.run(profileId, categoryId, mes, 'mes', cents, rueda)

  for (const m of months) {
    topeMes(personal, cSuper, m, m === '2026-07' ? 320000 : 350000)
    topeMes(personal, cComida, m, 90000)
    topeMes(personal, cTransporte, m, 90000)
    // Ocio arrastra: es la categoría donde el sobrante de un mes tranquilo
    // paga el concierto del siguiente, que es justo para lo que sirve.
    topeMes(personal, cOcio, m, m === '2026-07' ? 120000 : 80000, 1)
    topeMes(negocio, nInsumos, m, 1500000)
    topeMes(negocio, nServicios, m, 120000)
  }

  // Un tope anual para lo que no es mensual. Transporte carga la tenencia y el
  // seguro: pensarlos por mes no dice nada; pensarlos por año, todo.
  insertBudget.run(personal, cTransporte, '2026', 'anio', 1400000, 0)

  // Y el techo de todo el mes, que incluye lo que no tiene tope.
  const insertTotal = db.prepare(
    'INSERT INTO budget_totals (profile_id, month, amount_cents) VALUES (?, ?, ?)',
  )
  for (const m of months) insertTotal.run(personal, m, 3800000)

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
    '[finply] Libro demo listo: 2 perfiles, 6 cuentas (una tarjeta con su tasa), ' +
      'quince meses de movimientos, deudas, inversiones, presupuestos, metas, notas, ' +
      'y facturas con retención, nota de crédito, anticipo y plantilla.',
  )
})
