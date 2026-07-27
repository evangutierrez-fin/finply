// Reportes históricos. Lo que se prueba aquí no es que las gráficas se vean:
// es que las cifras cuadren con el libro y que la serie de patrimonio no
// contradiga al Resumen.

import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { levantar, libroBase, type Cliente } from './ayuda.ts'

let c: Cliente
before(async () => {
  c = await levantar()
})
after(() => c.cerrar())

const reporte = async (perfilId: number, year = 2026) =>
  (await c.get(`/api/reportes?profileId=${perfilId}&year=${year}`)).body

const mov = (perfilId: number, cuentaId: number, extra: Record<string, unknown>) =>
  c.post('/api/transactions', { profileId: perfilId, accountId: cuentaId, ...extra })

describe('agregados del año', () => {
  test('los totales coinciden con la suma de los movimientos', async () => {
    const { perfil, cuenta, categorias } = await libroBase(c, 'Agregados')
    const sueldo = categorias.find((k: any) => k.kind === 'ingreso')
    const gasto = categorias.find((k: any) => k.kind === 'gasto')
    await mov(perfil.id, cuenta.id, { type: 'ingreso', amountCents: 3000000, date: '2026-01-15', categoryId: sueldo.id })
    await mov(perfil.id, cuenta.id, { type: 'ingreso', amountCents: 3000000, date: '2026-02-15', categoryId: sueldo.id })
    await mov(perfil.id, cuenta.id, { type: 'gasto', amountCents: 800000, date: '2026-01-20', categoryId: gasto.id })
    await mov(perfil.id, cuenta.id, { type: 'gasto', amountCents: 1200000, date: '2026-02-20', categoryId: gasto.id })

    const r = await reporte(perfil.id)
    assert.equal(r.totales.incomeCents, 6000000)
    assert.equal(r.totales.expenseCents, 2000000)
    assert.equal(r.totales.netCents, 4000000)
    assert.equal(
      r.totales.incomeCents,
      r.meses.reduce((s: number, m: any) => s + m.incomeCents, 0),
      'el total es la suma de los meses',
    )
    assert.equal(r.meses.find((m: any) => m.month === '2026-01').expenseCents, 800000)
    assert.equal(r.meses.find((m: any) => m.month === '2026-02').netCents, 1800000)
  })

  test('un año siempre trae doce meses, con o sin datos', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Meses vacíos')
    await mov(perfil.id, cuenta.id, { type: 'gasto', amountCents: 5000, date: '2026-07-10' })

    const r = await reporte(perfil.id)
    assert.equal(r.meses.length, 12)
    assert.equal(r.patrimonio.length, 12)
    assert.deepEqual(
      r.meses.map((m: any) => m.month),
      Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}`),
    )
    const marzo = r.meses.find((m: any) => m.month === '2026-03')
    assert.equal(marzo.incomeCents, 0)
    assert.equal(marzo.expenseCents, 0)
  })

  test('un año sin nada no truena y deja la tasa en blanco', async () => {
    const { perfil } = await libroBase(c, 'Año vacío')
    const r = await reporte(perfil.id, 2019)
    assert.equal(r.meses.length, 12)
    assert.equal(r.totales.incomeCents, 0)
    assert.equal(r.totales.tasaAhorro, null, 'sin ingresos no hay tasa que calcular')
  })

  test('las transferencias no son ingreso ni gasto', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Transferencias')
    const destino = (
      await c.post('/api/accounts', { profileId: perfil.id, name: 'Ahorro', type: 'ahorro' })
    ).body
    await mov(perfil.id, cuenta.id, {
      type: 'transferencia', amountCents: 5000000, date: '2026-03-10', transferAccountId: destino.id,
    })

    const r = await reporte(perfil.id)
    assert.equal(r.totales.incomeCents, 0)
    assert.equal(r.totales.expenseCents, 0)
  })

  test('la tasa de ahorro es lo que no se gastó de lo que entró', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Tasa')
    await mov(perfil.id, cuenta.id, { type: 'ingreso', amountCents: 4000000, date: '2026-01-15' })
    await mov(perfil.id, cuenta.id, { type: 'gasto', amountCents: 1000000, date: '2026-01-20' })

    const r = await reporte(perfil.id)
    assert.equal(r.totales.tasaAhorro, 0.75)
  })

  test('un reporte no ve el libro de otro perfil', async () => {
    const a = await libroBase(c, 'Reporte A')
    const b = await libroBase(c, 'Reporte B')
    await mov(b.perfil.id, b.cuenta.id, { type: 'ingreso', amountCents: 9999900, date: '2026-05-01' })

    const r = await reporte(a.perfil.id)
    assert.equal(r.totales.incomeCents, 0)
  })
})

describe('lo que solo mueve patrimonio no cuenta (D6)', () => {
  test('un préstamo recibido no es ingreso ni el enganche es gasto', async () => {
    // El caso que motivó la decisión: sin esto, endeudarse duplicaba la tasa
    // de ahorro del mes.
    const { perfil, cuenta } = await libroBase(c, 'Crédito no es ingreso')
    await mov(perfil.id, cuenta.id, { type: 'ingreso', amountCents: 3000000, date: '2026-07-01' })
    await mov(perfil.id, cuenta.id, { type: 'gasto', amountCents: 2000000, date: '2026-07-05' })
    await c.post('/api/debts', {
      profileId: perfil.id, direction: 'por_pagar', counterparty: 'Financiera', concept: 'Auto',
      principalCents: 24000000, startDate: '2026-07-10', annualRateBp: 1350, termMonths: 48,
      accountId: cuenta.id, downPaymentCents: 6000000, downPaymentAccountId: cuenta.id,
    })

    const r = await reporte(perfil.id)
    assert.equal(r.totales.incomeCents, 3000000, 'el desembolso no es ingreso')
    assert.equal(r.totales.expenseCents, 2000000, 'el enganche no es gasto')
    assert.equal(r.totales.tasaAhorro, 1 / 3)
    // El gasto sin categoría del mes son los 20,000 de vivir, no los 80,000
    // que saldrían si el enganche se colara.
    assert.deepEqual(r.porCategoria, [{ name: 'Sin categoría', expenseCents: 2000000 }])
  })

  test('aportar y retirar de una inversión no mueve ingresos ni gastos', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Inversión neutra')
    await mov(perfil.id, cuenta.id, { type: 'ingreso', amountCents: 5000000, date: '2026-04-01' })
    const inv = (
      await c.post('/api/investments', { profileId: perfil.id, name: 'CETES', kind: 'cetes' })
    ).body
    await c.post(`/api/investments/${inv.id}/entries`, {
      type: 'aporte', amountCents: 1000000, date: '2026-04-10', accountId: cuenta.id,
    })
    await c.post(`/api/investments/${inv.id}/entries`, {
      type: 'retiro', amountCents: 300000, date: '2026-05-10', accountId: cuenta.id,
    })

    const r = await reporte(perfil.id)
    assert.equal(r.totales.incomeCents, 5000000, 'el retiro no es ingreso')
    assert.equal(r.totales.expenseCents, 0, 'el aporte no es gasto')
  })

  test('de un abono a deuda cuenta solo el interés', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Abono interés')
    const deuda = (
      await c.post('/api/debts', {
        profileId: perfil.id, direction: 'por_pagar', counterparty: 'Banco',
        principalCents: 1000000, startDate: '2026-01-10', annualRateBp: 1200, termMonths: 12,
      })
    ).body
    const tras = (
      await c.post(`/api/debts/${deuda.id}/payments`, {
        amountCents: 88849, date: '2026-02-10', accountId: cuenta.id,
      })
    ).body
    const interes = tras.payments[0].interestCents
    assert.ok(interes > 0)

    const r = await reporte(perfil.id)
    assert.equal(r.totales.expenseCents, interes, 'el capital que abonaste es ahorro, no gasto')
  })

  test('una compra a meses sí es gasto: te compraste algo', async () => {
    const { perfil } = await libroBase(c, 'MSI es gasto')
    const tarjeta = (
      await c.post('/api/accounts', {
        profileId: perfil.id, name: 'Tarjeta', type: 'tarjeta', cutDay: 5, dueDay: 25,
      })
    ).body
    await c.post('/api/tarjetas/msi', {
      profileId: perfil.id, accountId: tarjeta.id, concept: 'Refrigerador',
      totalCents: 1200000, months: 12, purchaseDate: '2026-06-20',
    })

    const r = await reporte(perfil.id)
    assert.equal(r.totales.expenseCents, 1200000)
  })

  test('las etiquetas heredan la misma regla', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Etiquetas reporte')
    const etiqueta = (await c.post('/api/tags', { profileId: perfil.id, name: 'Viaje' })).body
    await mov(perfil.id, cuenta.id, {
      type: 'gasto', amountCents: 700000, date: '2026-08-10', tagIds: [etiqueta.id],
    })

    const r = await reporte(perfil.id)
    assert.deepEqual(r.porEtiqueta, [{ name: 'Viaje', expenseCents: 700000 }])
  })
})

describe('serie de patrimonio', () => {
  test('el último punto es el patrimonio que muestra el Resumen', async () => {
    // Si estas dos cifras se separan, el usuario ve dos verdades distintas
    // de lo mismo en dos pantallas.
    const { perfil, cuenta } = await libroBase(c, 'Patrimonio')
    await mov(perfil.id, cuenta.id, { type: 'ingreso', amountCents: 5000000, date: '2026-02-01' })
    await mov(perfil.id, cuenta.id, { type: 'gasto', amountCents: 1500000, date: '2026-03-01' })
    const inv = (
      await c.post('/api/investments', { profileId: perfil.id, name: 'CETES', kind: 'cetes' })
    ).body
    await c.post(`/api/investments/${inv.id}/entries`, {
      type: 'aporte', amountCents: 2000000, date: '2026-04-10', accountId: cuenta.id,
    })
    await c.post('/api/debts', {
      profileId: perfil.id, direction: 'por_pagar', counterparty: 'Nu',
      principalCents: 800000, startDate: '2026-05-01',
    })
    await c.post('/api/debts', {
      profileId: perfil.id, direction: 'por_cobrar', counterparty: 'Luis',
      principalCents: 300000, startDate: '2026-05-01',
    })

    const resumen = (await c.get(`/api/summary?profileId=${perfil.id}&month=2026-12`)).body
    const patrimonioResumen =
      resumen.totalCents +
      resumen.investments.valueCents +
      resumen.debts.porCobrarCents -
      resumen.debts.porPagarCents

    const r = await reporte(perfil.id)
    const diciembre = r.patrimonio.at(-1)
    assert.equal(diciembre.month, '2026-12')
    assert.equal(diciembre.cuentasCents, resumen.totalCents)
    assert.equal(diciembre.inversionesCents, resumen.investments.valueCents)
    assert.equal(diciembre.porPagarCents, resumen.debts.porPagarCents)
    assert.equal(diciembre.porCobrarCents, resumen.debts.porCobrarCents)
    assert.equal(diciembre.totalCents, patrimonioResumen)
  })

  test('la serie sube y baja con el libro, mes a mes', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Serie')
    await mov(perfil.id, cuenta.id, { type: 'ingreso', amountCents: 1000000, date: '2026-03-15' })
    await mov(perfil.id, cuenta.id, { type: 'gasto', amountCents: 400000, date: '2026-06-15' })

    const r = await reporte(perfil.id)
    const en = (m: string) => r.patrimonio.find((p: any) => p.month === m).totalCents
    assert.equal(en('2026-01'), 100000, 'solo la apertura de la cuenta')
    assert.equal(en('2026-02'), 100000, 'un mes sin movimientos conserva el saldo')
    assert.equal(en('2026-03'), 1100000)
    assert.equal(en('2026-05'), 1100000, 'se arrastra hasta que algo pasa')
    assert.equal(en('2026-06'), 700000)
    assert.equal(en('2026-12'), 700000)
  })

  test('una deuda no cuenta antes de existir', async () => {
    const { perfil } = await libroBase(c, 'Deuda futura')
    await c.post('/api/debts', {
      profileId: perfil.id, direction: 'por_pagar', counterparty: 'Nu',
      principalCents: 500000, startDate: '2026-09-01',
    })

    const r = await reporte(perfil.id)
    const en = (m: string) => r.patrimonio.find((p: any) => p.month === m)
    assert.equal(en('2026-08').porPagarCents, 0)
    assert.equal(en('2026-09').porPagarCents, 500000)
    assert.equal(en('2026-08').totalCents - en('2026-09').totalCents, 500000)
  })

  test('abonar capital sube el patrimonio; pagar intereses no', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Patrimonio abonos')
    const deuda = (
      await c.post('/api/debts', {
        profileId: perfil.id, direction: 'por_pagar', counterparty: 'Banco',
        principalCents: 1000000, startDate: '2026-01-10',
      })
    ).body
    await c.post(`/api/debts/${deuda.id}/payments`, {
      amountCents: 400000, date: '2026-06-10', accountId: cuenta.id,
    })

    const r = await reporte(perfil.id)
    const mayo = r.patrimonio.find((p: any) => p.month === '2026-05')
    const junio = r.patrimonio.find((p: any) => p.month === '2026-06')
    // Salieron 400,000 de la cuenta y bajó 400,000 la deuda: el patrimonio
    // no se movió, solo cambió de forma.
    assert.equal(junio.porPagarCents, 600000)
    assert.equal(junio.cuentasCents, mayo.cuentasCents - 400000)
    assert.equal(junio.totalCents, mayo.totalCents)
  })
})

describe('comparativa mes contra mes', () => {
  test('mide la diferencia por categoría', async () => {
    const { perfil, cuenta, categorias } = await libroBase(c, 'Comparativa')
    const comida = categorias.find((k: any) => k.name === 'Comida')
    const super_ = categorias.find((k: any) => k.name === 'Súper')
    await mov(perfil.id, cuenta.id, { type: 'gasto', amountCents: 100000, date: '2026-06-10', categoryId: comida.id })
    await mov(perfil.id, cuenta.id, { type: 'gasto', amountCents: 250000, date: '2026-07-10', categoryId: comida.id })
    await mov(perfil.id, cuenta.id, { type: 'gasto', amountCents: 300000, date: '2026-06-12', categoryId: super_.id })

    const comp = (await c.get(`/api/reportes/comparativa?profileId=${perfil.id}&month=2026-07`)).body
    assert.equal(comp.anterior, '2026-06')
    assert.equal(comp.actual.expenseCents, 250000)
    assert.equal(comp.previo.expenseCents, 400000)

    const cComida = comp.categorias.find((k: any) => k.name === 'Comida')
    assert.equal(cComida.deltaCents, 150000, 'gastaste 1,500 más en comida')
    const cSuper = comp.categorias.find((k: any) => k.name === 'Súper')
    assert.equal(cSuper.actualCents, 0)
    assert.equal(cSuper.deltaCents, -300000, 'la categoría que desapareció también sale')
  })

  test('enero se compara contra diciembre del año anterior', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Cruce de año')
    await mov(perfil.id, cuenta.id, { type: 'gasto', amountCents: 50000, date: '2025-12-20' })

    const comp = (await c.get(`/api/reportes/comparativa?profileId=${perfil.id}&month=2026-01`)).body
    assert.equal(comp.anterior, '2025-12')
    assert.equal(comp.previo.expenseCents, 50000)
  })
})
