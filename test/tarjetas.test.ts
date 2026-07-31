// Crédito de verdad: lo que la tarjeta te exige en el corte, lo que sigue
// siendo tuyo del límite, y una compra a meses que no se cuenta dos veces.

import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { levantar, libroBase, type Cliente } from './ayuda.ts'

let c: Cliente
before(async () => {
  c = await levantar()
})
after(() => c.cerrar())

/** Perfil con cuenta de banco y una tarjeta ya configurada. */
async function libroConTarjeta(
  nombre: string,
  tarjeta: {
    creditLimitCents?: number
    cutDay?: number
    dueDay?: number
    openingCents?: number
    /** Lo que cuesta la tarjeta (Fase 14). Ausente = el usuario no lo escribió. */
    annualRateBp?: number | null
    minPaymentBp?: number | null
    minPaymentFloorCents?: number | null
  } = {},
) {
  const { perfil, cuenta, categorias } = await libroBase(c, nombre)
  const res = await c.post('/api/accounts', {
    profileId: perfil.id,
    name: 'Tarjeta',
    type: 'tarjeta',
    openingCents: tarjeta.openingCents ?? 0,
    creditLimitCents: tarjeta.creditLimitCents ?? 5_000_00,
    cutDay: tarjeta.cutDay ?? 5,
    dueDay: tarjeta.dueDay ?? 25,
    annualRateBp: tarjeta.annualRateBp ?? null,
    minPaymentBp: tarjeta.minPaymentBp ?? null,
    minPaymentFloorCents: tarjeta.minPaymentFloorCents ?? null,
  })
  assert.equal(res.status, 201, JSON.stringify(res.body))
  return { perfil, banco: cuenta, tarjeta: res.body, categorias }
}

const gasto = (perfilId: number, cuentaId: number, cents: number, date: string, note = '') =>
  c.post('/api/transactions', {
    profileId: perfilId,
    accountId: cuentaId,
    type: 'gasto',
    amountCents: cents,
    date,
    note,
  })

const estado = async (perfilId: number, hoy: string) =>
  (await c.get(`/api/tarjetas?profileId=${perfilId}&hoy=${hoy}`)).body

describe('configuración de la tarjeta', () => {
  test('el límite y los días viajan con la cuenta', async () => {
    const { tarjeta } = await libroConTarjeta('Config')
    assert.equal(tarjeta.creditLimitCents, 500000)
    assert.equal(tarjeta.cutDay, 5)
    assert.equal(tarjeta.dueDay, 25)
  })

  test('una cuenta que no es tarjeta no lleva día de corte', async () => {
    const { perfil } = await libroBase(c, 'Sin corte')
    const res = await c.post('/api/accounts', {
      profileId: perfil.id,
      name: 'Efectivo',
      type: 'efectivo',
      cutDay: 5,
    })
    assert.equal(res.status, 400)
  })

  test('dejar de ser tarjeta borra los datos de crédito', async () => {
    const { tarjeta } = await libroConTarjeta('Ya no es tarjeta')
    const res = await c.patch(`/api/accounts/${tarjeta.id}`, { type: 'banco' })
    assert.equal(res.status, 200)
    assert.equal(res.body.cutDay, null)
    assert.equal(res.body.creditLimitCents, null)
  })

  test('un día de corte fuera del mes se rechaza', async () => {
    const { tarjeta } = await libroConTarjeta('Día 45')
    assert.equal((await c.patch(`/api/accounts/${tarjeta.id}`, { cutDay: 45 })).status, 400)
  })
})

describe('saldo al corte', () => {
  test('ignora lo que se gastó después de la fecha de corte', async () => {
    const { perfil, tarjeta } = await libroConTarjeta('Corte')
    await gasto(perfil.id, tarjeta.id, 100000, '2026-07-01', 'Antes del corte')
    await gasto(perfil.id, tarjeta.id, 500000, '2026-07-10', 'Después del corte')

    const [t] = await estado(perfil.id, '2026-07-20')
    assert.equal(t.fechaCorte, '2026-07-05')
    assert.equal(t.fechaLimitePago, '2026-07-25')
    assert.equal(t.saldoAlCorteCents, 100000, 'solo lo de antes del corte')
    assert.equal(t.paraNoGenerarInteresesCents, 100000)
    assert.equal(t.deudaCents, 600000, 'la deuda de hoy sí incluye todo')
  })

  test('un pago posterior al corte baja lo que hay que pagar', async () => {
    const { perfil, banco, tarjeta } = await libroConTarjeta('Pago')
    await gasto(perfil.id, tarjeta.id, 100000, '2026-07-01')
    await c.post('/api/transactions', {
      profileId: perfil.id,
      accountId: banco.id,
      type: 'transferencia',
      amountCents: 60000,
      date: '2026-07-10',
      transferAccountId: tarjeta.id,
    })

    const [t] = await estado(perfil.id, '2026-07-20')
    assert.equal(t.saldoAlCorteCents, 100000)
    assert.equal(t.pagadoDesdeCorteCents, 60000)
    assert.equal(t.paraNoGenerarInteresesCents, 40000)
    assert.equal(t.deudaCents, 40000)
  })

  test('pagar de más deja el corte en cero, nunca en negativo', async () => {
    const { perfil, banco, tarjeta } = await libroConTarjeta('De más')
    await gasto(perfil.id, tarjeta.id, 100000, '2026-07-01')
    await c.post('/api/transactions', {
      profileId: perfil.id,
      accountId: banco.id,
      type: 'transferencia',
      amountCents: 150000,
      date: '2026-07-10',
      transferAccountId: tarjeta.id,
    })

    const [t] = await estado(perfil.id, '2026-07-20')
    assert.equal(t.paraNoGenerarInteresesCents, 0)
    assert.equal(t.deudaCents, -50000, 'saldo a favor')
  })

  test('el saldo inicial de la tarjeta es deuda del corte', async () => {
    const { perfil } = await libroConTarjeta('Apertura', { openingCents: -80000 })
    const [t] = await estado(perfil.id, '2026-07-20')
    assert.equal(t.saldoAlCorteCents, 80000)
    assert.equal(t.deudaCents, 80000)
  })

  test('el disponible descuenta toda la deuda de hoy', async () => {
    const { perfil, tarjeta } = await libroConTarjeta('Disponible', { creditLimitCents: 1_000_00 })
    await gasto(perfil.id, tarjeta.id, 30000, '2026-07-10')
    const [t] = await estado(perfil.id, '2026-07-20')
    assert.equal(t.disponibleCents, 70000)
  })

  test('sin día de corte no se inventa un estado de cuenta', async () => {
    const { perfil } = await libroBase(c, 'Sin configurar')
    const tarjeta = (
      await c.post('/api/accounts', { profileId: perfil.id, name: 'Tarjeta', type: 'tarjeta' })
    ).body
    await gasto(perfil.id, tarjeta.id, 50000, '2026-07-10')

    const [t] = await estado(perfil.id, '2026-07-20')
    assert.equal(t.fechaCorte, null)
    assert.equal(t.saldoAlCorteCents, null)
    assert.equal(t.paraNoGenerarInteresesCents, null)
    assert.equal(t.deudaCents, 50000, 'la deuda se sigue calculando')
  })
})

describe('meses sin intereses', () => {
  const compra = (perfilId: number, cuentaId: number, extra: Record<string, unknown> = {}) =>
    c.post('/api/tarjetas/msi', {
      profileId: perfilId,
      accountId: cuentaId,
      concept: 'Refrigerador',
      totalCents: 1_200_000,
      months: 12,
      purchaseDate: '2026-07-20',
      ...extra,
    })

  test('una compra a N meses genera N parcialidades que suman el total', async () => {
    const { perfil, tarjeta } = await libroConTarjeta('MSI')
    const res = await compra(perfil.id, tarjeta.id)
    assert.equal(res.status, 201, JSON.stringify(res.body))

    const c12 = res.body
    assert.equal(c12.parcialidades.length, 12)
    assert.equal(
      c12.parcialidades.reduce((s: number, p: any) => s + p.amountCents, 0),
      1_200_000,
    )
    assert.deepEqual(
      c12.parcialidades.slice(0, 2).map((p: any) => p.dueDate),
      ['2026-08-05', '2026-09-05'],
      'cada parcialidad cae en un corte',
    )
    assert.equal(c12.parcialidades.at(-1).dueDate, '2027-07-05')
  })

  test('el residuo del redondeo va en la última parcialidad', async () => {
    const { perfil, tarjeta } = await libroConTarjeta('MSI residuo')
    const res = await compra(perfil.id, tarjeta.id, { totalCents: 100000, months: 3 })
    assert.deepEqual(
      res.body.parcialidades.map((p: any) => p.amountCents),
      [33333, 33333, 33334],
    )
  })

  test('la compra consume la línea de crédito completa el día que se hace', async () => {
    const { perfil, tarjeta } = await libroConTarjeta('MSI línea')
    await compra(perfil.id, tarjeta.id)

    const [t] = await estado(perfil.id, '2026-07-25')
    assert.equal(t.deudaCents, 1_200_000, 'el banco te descuenta todo de una vez')
    assert.equal(t.disponibleCents, 500000 - 1_200_000)
    assert.equal(t.saldoAlCorteCents, 0, 'pero el corte del 5 de julio no la alcanza')
    assert.equal(t.msiPorFacturarCents, 1_200_000)
    assert.equal(t.msiProximoCorteCents, 100000, 'en el corte de agosto entra una')
  })

  test('en el corte siguiente se factura una sola parcialidad, no la compra entera', async () => {
    const { perfil, tarjeta } = await libroConTarjeta('MSI corte')
    await compra(perfil.id, tarjeta.id)

    // Este es el invariante que sostiene todo el modelo: si el cargo ancla se
    // contara junto con las parcialidades, aquí saldrían 1,300,000.
    const [t] = await estado(perfil.id, '2026-08-10')
    assert.equal(t.fechaCorte, '2026-08-05')
    assert.equal(t.saldoAlCorteCents, 100000)
    assert.equal(t.paraNoGenerarInteresesCents, 100000)
    assert.equal(t.deudaCents, 1_200_000)
    assert.equal(t.msiPorFacturarCents, 1_100_000)
  })

  test('el cargo de la compra queda en el libro, ligado a ella', async () => {
    const { perfil, tarjeta } = await libroConTarjeta('MSI cargo')
    const compraCreada = (await compra(perfil.id, tarjeta.id)).body

    const movimientos = (await c.get(`/api/transactions?profileId=${perfil.id}`)).body
    const cargo = movimientos.find((t: any) => t.msiPurchaseId !== null)
    assert.ok(cargo, 'la compra debió asentar su cargo')
    assert.equal(cargo.amountCents, 1_200_000)
    assert.equal(cargo.type, 'gasto')
    assert.equal(cargo.accountId, tarjeta.id)
    assert.equal(cargo.msiPurchaseId, compraCreada.id)
    assert.equal(compraCreada.txId, cargo.id)
  })

  test('anular el cargo borra la compra y su calendario', async () => {
    const { perfil, tarjeta } = await libroConTarjeta('MSI anular')
    await compra(perfil.id, tarjeta.id)
    const cargo = (await c.get(`/api/transactions?profileId=${perfil.id}`)).body.find(
      (t: any) => t.msiPurchaseId !== null,
    )

    await c.del(`/api/transactions/${cargo.id}`)

    assert.deepEqual((await c.get(`/api/tarjetas/msi?profileId=${perfil.id}`)).body, [])
    const [t] = await estado(perfil.id, '2026-09-10')
    assert.equal(t.deudaCents, 0)
    assert.equal(t.saldoAlCorteCents, 0)
  })

  test('borrar la compra borra su cargo', async () => {
    const { perfil, tarjeta } = await libroConTarjeta('MSI borrar')
    const creada = (await compra(perfil.id, tarjeta.id)).body

    assert.equal((await c.del(`/api/tarjetas/msi/${creada.id}?profileId=${perfil.id}`)).status, 200)

    const movimientos = (await c.get(`/api/transactions?profileId=${perfil.id}`)).body
    assert.equal(movimientos.length, 0)
  })

  test('editar el cargo rehace el calendario', async () => {
    const { perfil, tarjeta } = await libroConTarjeta('MSI editar')
    const creada = (await compra(perfil.id, tarjeta.id, { totalCents: 300000, months: 3 })).body
    const cargo = (await c.get(`/api/transactions?profileId=${perfil.id}`)).body.find(
      (t: any) => t.msiPurchaseId !== null,
    )

    const res = await c.patch(`/api/transactions/${cargo.id}`, {
      profileId: perfil.id,
      accountId: tarjeta.id,
      type: 'gasto',
      amountCents: 600000,
      date: '2026-07-20',
    })
    assert.equal(res.status, 200)

    const [despues] = (await c.get(`/api/tarjetas/msi?profileId=${perfil.id}`)).body
    assert.equal(despues.id, creada.id)
    assert.equal(despues.totalCents, 600000)
    assert.deepEqual(
      despues.parcialidades.map((p: any) => p.amountCents),
      [200000, 200000, 200000],
    )
  })

  test('el cargo de una compra a meses no cambia de tipo', async () => {
    const { perfil, tarjeta } = await libroConTarjeta('MSI tipo')
    await compra(perfil.id, tarjeta.id)
    const cargo = (await c.get(`/api/transactions?profileId=${perfil.id}`)).body.find(
      (t: any) => t.msiPurchaseId !== null,
    )

    const res = await c.patch(`/api/transactions/${cargo.id}`, {
      profileId: perfil.id,
      accountId: tarjeta.id,
      type: 'ingreso',
      amountCents: 1_200_000,
      date: '2026-07-20',
    })
    assert.equal(res.status, 400)
  })

  test('mover el cargo a una cuenta que no es tarjeta se rechaza', async () => {
    const { perfil, banco, tarjeta } = await libroConTarjeta('MSI mover')
    const creada = (await compra(perfil.id, tarjeta.id)).body
    const cargo = (await c.get(`/api/transactions?profileId=${perfil.id}`)).body.find(
      (t: any) => t.msiPurchaseId !== null,
    )

    const res = await c.patch(`/api/transactions/${cargo.id}`, {
      profileId: perfil.id,
      accountId: banco.id,
      type: 'gasto',
      amountCents: 1_200_000,
      date: '2026-07-20',
    })
    assert.equal(res.status, 400)

    // Y nada se movió: la transacción de la petición se revirtió entera.
    const [sigue] = (await c.get(`/api/tarjetas/msi?profileId=${perfil.id}`)).body
    assert.equal(sigue.id, creada.id)
    assert.equal(sigue.accountId, tarjeta.id)
    assert.equal(sigue.parcialidades.length, 12)
  })

  test('una compra a meses solo vive en una tarjeta', async () => {
    const { perfil, banco } = await libroConTarjeta('MSI banco')
    const res = await compra(perfil.id, banco.id)
    assert.equal(res.status, 400)
  })

  test('un monto que no alcanza a repartirse se rechaza con un mensaje claro', async () => {
    const { perfil, tarjeta } = await libroConTarjeta('MSI centavos')
    const res = await compra(perfil.id, tarjeta.id, { totalCents: 5, months: 12 })
    assert.equal(res.status, 400)
    assert.match(res.body.error, /no alcanza/)
  })

  test('la categoría de la compra tiene que ser de gasto y del perfil', async () => {
    const { perfil, tarjeta, categorias } = await libroConTarjeta('MSI categoría')
    const deIngreso = categorias.find((cat: any) => cat.kind === 'ingreso')
    const res = await compra(perfil.id, tarjeta.id, { categoryId: deIngreso.id })
    assert.equal(res.status, 400)
  })

  test('el respaldo se lleva las compras a meses', async () => {
    const { perfil, tarjeta } = await libroConTarjeta('MSI respaldo')
    await compra(perfil.id, tarjeta.id, { totalCents: 300000, months: 3 })

    // El respaldo se lleva el libro entero, así que hay que mirar solo lo de
    // este perfil: las pruebas anteriores dejaron sus propias compras.
    const snapshot = (await c.get('/api/respaldo')).body
    const mias = snapshot.tables.msi_purchases.filter((p: any) => p.profile_id === perfil.id)
    assert.equal(mias.length, 1)
    assert.equal(
      snapshot.tables.msi_installments.filter((i: any) => i.purchase_id === mias[0].id).length,
      3,
    )

    const restaurado = await c.post('/api/respaldo/restaurar', snapshot)
    assert.equal(restaurado.status, 200, JSON.stringify(restaurado.body))

    const [compraVuelta] = (await c.get(`/api/tarjetas/msi?profileId=${perfil.id}`)).body
    assert.equal(compraVuelta.parcialidades.length, 3)
    assert.equal(compraVuelta.txId !== null, true, 'el cargo volvió ligado a su compra')
  })
})

describe('deuda con tasa y plazo', () => {
  const crearDeuda = async (perfilId: number, extra: Record<string, unknown> = {}) =>
    (
      await c.post('/api/debts', {
        profileId: perfilId,
        direction: 'por_pagar',
        counterparty: 'Banco',
        principalCents: 1_000_000,
        startDate: '2026-01-10',
        annualRateBp: 1200,
        termMonths: 12,
        ...extra,
      })
    ).body

  test('la tasa y el plazo se guardan y regresan', async () => {
    const { perfil } = await libroBase(c, 'Deuda tasa')
    const deuda = await crearDeuda(perfil.id)
    assert.equal(deuda.annualRateBp, 1200)
    assert.equal(deuda.termMonths, 12)
  })

  test('la tabla de amortización cuadra al centavo contra el principal', async () => {
    const { perfil } = await libroBase(c, 'Amortización')
    const deuda = await crearDeuda(perfil.id)

    const res = await c.get(`/api/debts/${deuda.id}/amortizacion`)
    assert.equal(res.status, 200)
    const tabla = res.body
    assert.equal(tabla.filas.length, 12)
    assert.equal(
      tabla.filas.reduce((s: number, f: any) => s + f.capitalCents, 0),
      1_000_000,
    )
    assert.equal(tabla.filas.at(-1).saldoCents, 0)
    assert.equal(tabla.totalPagadoCents - tabla.totalInteresCents, 1_000_000)
  })

  test('una deuda sin plazo no tiene tabla que mostrar', async () => {
    const { perfil } = await libroBase(c, 'Sin plazo')
    const deuda = await crearDeuda(perfil.id, { termMonths: null, annualRateBp: 0 })
    const res = await c.get(`/api/debts/${deuda.id}/amortizacion`)
    assert.equal(res.status, 400)
    assert.match(res.body.error, /plazo/)
  })

  test('quitar el plazo con null lo borra; no mandarlo lo deja', async () => {
    const { perfil } = await libroBase(c, 'Plazo patch')
    const deuda = await crearDeuda(perfil.id)

    const soloNombre = (await c.patch(`/api/debts/${deuda.id}`, { counterparty: 'BBVA' })).body
    assert.equal(soloNombre.termMonths, 12, 'ausente no opina')

    const sinPlazo = (await c.patch(`/api/debts/${deuda.id}`, { termMonths: null })).body
    assert.equal(sinPlazo.termMonths, null)
  })

  test('una tasa negativa se rechaza', async () => {
    const { perfil } = await libroBase(c, 'Tasa negativa')
    const res = await c.post('/api/debts', {
      profileId: perfil.id,
      direction: 'por_pagar',
      counterparty: 'X',
      principalCents: 1000,
      startDate: '2026-01-01',
      annualRateBp: -100,
    })
    assert.equal(res.status, 400)
  })

  test('la amortización es el plan, no el historial de abonos', async () => {
    const { perfil } = await libroBase(c, 'Plan vs abonos')
    const deuda = await crearDeuda(perfil.id)
    await c.post(`/api/debts/${deuda.id}/payments`, { amountCents: 500000, date: '2026-02-10' })

    const tabla = (await c.get(`/api/debts/${deuda.id}/amortizacion`)).body
    assert.equal(
      tabla.filas.reduce((s: number, f: any) => s + f.capitalCents, 0),
      1_000_000,
      'el plan sigue siendo sobre el principal original',
    )
    const despues = (await c.get(`/api/debts?profileId=${perfil.id}`)).body[0]
    assert.equal(despues.paidCents, 500000, 'y los abonos reales van por su lado')
  })
})

// ── Lo que de verdad cuesta la tarjeta (Fase 14) ──────────────────────────
//
// Era la única deuda de Finply sin interés modelado. Lo que se agrega no
// adivina nada: la tasa, el porcentaje del mínimo y el piso los escribe el
// usuario copiando su contrato, y sin ellos Finply calla (R15, R9).

describe('el pago mínimo', () => {
  test('sin tasa ni mínimo, la tarjeta se ve exactamente como antes', async () => {
    const { perfil, tarjeta } = await libroConTarjeta('Sin contrato')
    await gasto(perfil.id, tarjeta.id, 300_000, '2026-07-02')
    const [t] = await estado(perfil.id, '2026-07-20')
    assert.equal(t.annualRateBp, null)
    assert.equal(t.pagoMinimoCents, null, 'sin porcentaje ni piso no hay mínimo que calcular')
    assert.equal(t.siPagasElMinimo, null)
  })

  test('con mínimo pero sin tasa se dice el mínimo y nada más', async () => {
    // La cifra del mínimo es del estado de cuenta y no necesita la tasa; lo que
    // sí la necesita es decir cuánto tardas en liquidar, y eso se calla.
    const { perfil, tarjeta } = await libroConTarjeta('Mínimo sin tasa', {
      minPaymentBp: 500,
      minPaymentFloorCents: 30_000,
    })
    await gasto(perfil.id, tarjeta.id, 1_000_000, '2026-07-02')
    const [t] = await estado(perfil.id, '2026-07-20')
    assert.equal(t.saldoAlCorteCents, 1_000_000, 'el gasto ya pasó por el corte del 5')
    assert.equal(t.pagoMinimoCents, 50_000, '5 % del saldo del corte')
    assert.equal(t.siPagasElMinimo, null, 'sin tasa no hay nada honesto que decir')
  })

  test('con el contrato completo dice en cuánto se liquida y qué cuesta', async () => {
    const { perfil, tarjeta } = await libroConTarjeta('Contrato', {
      creditLimitCents: 5_000_000,
      annualRateBp: 4590,
      minPaymentBp: 500,
      minPaymentFloorCents: 30_000,
    })
    await gasto(perfil.id, tarjeta.id, 3_000_000, '2026-07-02')

    const [t] = await estado(perfil.id, '2026-07-20')
    assert.equal(t.deudaCents, 3_000_000)
    assert.equal(t.annualRateBp, 4590)
    assert.ok(t.siPagasElMinimo !== null)
    assert.equal(t.siPagasElMinimo.nuncaTermina, false)
    assert.ok(t.siPagasElMinimo.meses > 36, `tardó ${t.siPagasElMinimo.meses} meses`)
    assert.equal(
      t.siPagasElMinimo.totalPagadoCents,
      3_000_000 + t.siPagasElMinimo.totalInteresCents,
    )
  })

  test('el piso manda cuando el porcentaje se queda corto', async () => {
    const { perfil, tarjeta } = await libroConTarjeta('Piso', {
      minPaymentBp: 500,
      minPaymentFloorCents: 30_000,
      annualRateBp: 4590,
    })
    await gasto(perfil.id, tarjeta.id, 200_000, '2026-07-02')
    const [t] = await estado(perfil.id, '2026-07-20')
    assert.equal(t.pagoMinimoCents, 30_000, '5 % de $2,000 son $100: manda el piso de $300')
  })

  test('la compra a meses no entra a la simulación de intereses', async () => {
    // Un MSI no genera intereses: ese es todo el trato. Meter sus
    // parcialidades por facturar cobraría un interés que nadie va a pagar.
    const { perfil, tarjeta } = await libroConTarjeta('MSI sin interés', {
      creditLimitCents: 5_000_000,
      annualRateBp: 4590,
      minPaymentBp: 500,
      minPaymentFloorCents: 30_000,
    })
    await c.post('/api/tarjetas/msi', {
      profileId: perfil.id,
      accountId: tarjeta.id,
      concept: 'Refri',
      totalCents: 1_200_000,
      months: 12,
      purchaseDate: '2026-07-02',
    })

    const [t] = await estado(perfil.id, '2026-07-20')
    assert.equal(t.deudaCents, 1_200_000, 'el banco te descontó la línea completa')
    assert.ok(t.msiPorFacturarCents > 0)
    // Lo que se simula es la deuda **menos** lo que aún no se factura a meses.
    const revolvente = t.deudaCents - t.msiPorFacturarCents
    assert.ok(revolvente < t.deudaCents)
    assert.ok(
      t.siPagasElMinimo === null || t.siPagasElMinimo.totalPagadoCents <= t.deudaCents * 2,
      'no se simula interés sobre lo que no lo genera',
    )
  })

  test('sin deuda no hay mínimo ni plan', async () => {
    const { perfil } = await libroConTarjeta('Al corriente', {
      annualRateBp: 4590,
      minPaymentBp: 500,
      minPaymentFloorCents: 30_000,
    })
    const [t] = await estado(perfil.id, '2026-07-20')
    assert.equal(t.pagoMinimoCents, 0)
    assert.equal(t.siPagasElMinimo, null, 'sin saldo no hay nada que simular')
  })

  test('una cuenta que no es tarjeta no admite tasa ni mínimo', async () => {
    const { perfil } = await libroBase(c, 'Ahorro con tasa')
    const r = await c.post('/api/accounts', {
      profileId: perfil.id,
      name: 'Ahorro',
      type: 'ahorro',
      openingCents: 0,
      annualRateBp: 4590,
    })
    assert.equal(r.status, 400)
    assert.match(r.body.error, /tarjeta/)
  })
})
