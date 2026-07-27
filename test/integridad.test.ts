// Las reglas que el README promete: si una de estas se rompe, el libro
// deja de cuadrar y el usuario no se entera hasta que es tarde.

import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { levantar, libroBase, type Cliente } from './ayuda.ts'

let c: Cliente
before(async () => {
  c = await levantar()
})
after(() => c.cerrar())

describe('cuentas', () => {
  test('una cuenta con movimientos no se borra, se archiva', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Cuentas')
    await c.post('/api/transactions', {
      profileId: perfil.id,
      accountId: cuenta.id,
      type: 'gasto',
      amountCents: 5000,
      date: '2026-07-10',
    })

    const borrada = await c.del(`/api/accounts/${cuenta.id}`)
    assert.equal(borrada.status, 409)

    const archivada = await c.patch(`/api/accounts/${cuenta.id}`, { archived: true })
    assert.equal(archivada.status, 200)
    assert.equal(archivada.body.archived, true)
  })

  test('el saldo refleja apertura, ingresos, gastos y transferencias', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Saldos')
    const destino = (
      await c.post('/api/accounts', {
        profileId: perfil.id,
        name: 'Efectivo',
        type: 'efectivo',
        openingCents: 0,
      })
    ).body

    await c.post('/api/transactions', {
      profileId: perfil.id, accountId: cuenta.id, type: 'ingreso',
      amountCents: 50000, date: '2026-07-01',
    })
    await c.post('/api/transactions', {
      profileId: perfil.id, accountId: cuenta.id, type: 'gasto',
      amountCents: 20000, date: '2026-07-02',
    })
    await c.post('/api/transactions', {
      profileId: perfil.id, accountId: cuenta.id, type: 'transferencia',
      amountCents: 30000, date: '2026-07-03', transferAccountId: destino.id,
    })

    const cuentas = (await c.get(`/api/accounts?profileId=${perfil.id}`)).body
    const origen = cuentas.find((a: any) => a.id === cuenta.id)
    const llegada = cuentas.find((a: any) => a.id === destino.id)
    // 100000 apertura + 50000 − 20000 − 30000 transferido
    assert.equal(origen.balanceCents, 100000)
    assert.equal(llegada.balanceCents, 30000)
  })

  test('una transferencia a la misma cuenta se rechaza', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Transferencia')
    const res = await c.post('/api/transactions', {
      profileId: perfil.id, accountId: cuenta.id, type: 'transferencia',
      amountCents: 1000, date: '2026-07-01', transferAccountId: cuenta.id,
    })
    assert.equal(res.status, 400)
  })
})

describe('movimientos ligados a deudas', () => {
  test('anular el movimiento anula el abono y reabre la deuda', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Deuda anular')
    const deuda = (
      await c.post('/api/debts', {
        profileId: perfil.id, direction: 'por_cobrar', counterparty: 'Luis',
        principalCents: 100000, startDate: '2026-07-01',
      })
    ).body

    const conAbono = (
      await c.post(`/api/debts/${deuda.id}/payments`, {
        amountCents: 100000, date: '2026-07-05', accountId: cuenta.id,
      })
    ).body
    assert.equal(conAbono.status, 'saldada')

    const movimientos = (await c.get(`/api/transactions?profileId=${perfil.id}`)).body
    const ligado = movimientos.find((t: any) => t.debtPaymentId !== null)
    assert.ok(ligado, 'el abono debió asentar un movimiento')

    await c.del(`/api/transactions/${ligado.id}`)

    const despues = (await c.get(`/api/debts?profileId=${perfil.id}`)).body[0]
    assert.equal(despues.payments.length, 0)
    assert.equal(despues.paidCents, 0)
    assert.equal(despues.status, 'abierta')
  })

  test('editar el movimiento sincroniza monto y fecha del abono', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Deuda editar')
    const deuda = (
      await c.post('/api/debts', {
        profileId: perfil.id, direction: 'por_pagar', counterparty: 'Nu',
        principalCents: 200000, startDate: '2026-07-01',
      })
    ).body
    await c.post(`/api/debts/${deuda.id}/payments`, {
      amountCents: 50000, date: '2026-07-05', accountId: cuenta.id,
    })

    const movimientos = (await c.get(`/api/transactions?profileId=${perfil.id}`)).body
    const ligado = movimientos.find((t: any) => t.debtPaymentId !== null)

    await c.patch(`/api/transactions/${ligado.id}`, {
      profileId: perfil.id, accountId: cuenta.id, type: 'gasto',
      amountCents: 75000, date: '2026-07-09',
    })

    const despues = (await c.get(`/api/debts?profileId=${perfil.id}`)).body[0]
    assert.equal(despues.paidCents, 75000)
    assert.equal(despues.payments[0].amountCents, 75000)
    assert.equal(despues.payments[0].date, '2026-07-09')
  })

  test('el tipo de un movimiento ligado no puede cambiar', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Deuda tipo')
    const deuda = (
      await c.post('/api/debts', {
        profileId: perfil.id, direction: 'por_pagar', counterparty: 'Nu',
        principalCents: 200000, startDate: '2026-07-01',
      })
    ).body
    await c.post(`/api/debts/${deuda.id}/payments`, {
      amountCents: 50000, date: '2026-07-05', accountId: cuenta.id,
    })
    const ligado = (await c.get(`/api/transactions?profileId=${perfil.id}`)).body
      .find((t: any) => t.debtPaymentId !== null)

    const res = await c.patch(`/api/transactions/${ligado.id}`, {
      profileId: perfil.id, accountId: cuenta.id, type: 'ingreso',
      amountCents: 50000, date: '2026-07-05',
    })
    assert.equal(res.status, 400)
  })

  test('bajar el principal por debajo de lo abonado salda la deuda', async () => {
    const { perfil } = await libroBase(c, 'Deuda principal')
    const deuda = (
      await c.post('/api/debts', {
        profileId: perfil.id, direction: 'por_cobrar', counterparty: 'Ana',
        principalCents: 100000, startDate: '2026-07-01',
      })
    ).body
    await c.post(`/api/debts/${deuda.id}/payments`, { amountCents: 60000, date: '2026-07-05' })

    const bajada = (await c.patch(`/api/debts/${deuda.id}`, { principalCents: 50000 })).body
    assert.equal(bajada.status, 'saldada')

    const subida = (await c.patch(`/api/debts/${deuda.id}`, { principalCents: 90000 })).body
    assert.equal(subida.status, 'abierta')
  })
})

describe('movimientos ligados a inversiones', () => {
  test('anular el movimiento anula el aporte', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Inversión')
    const inv = (
      await c.post('/api/investments', { profileId: perfil.id, name: 'CETES', kind: 'cetes' })
    ).body
    await c.post(`/api/investments/${inv.id}/entries`, {
      type: 'aporte', amountCents: 40000, date: '2026-07-05', accountId: cuenta.id,
    })

    const ligado = (await c.get(`/api/transactions?profileId=${perfil.id}`)).body
      .find((t: any) => t.investmentEntryId !== null)
    assert.ok(ligado, 'el aporte debió asentar un movimiento')

    await c.del(`/api/transactions/${ligado.id}`)

    const despues = (await c.get(`/api/investments?profileId=${perfil.id}`)).body[0]
    assert.equal(despues.entries.length, 0)
    assert.equal(despues.investedCents, 0)
  })
})

describe('aislamiento entre perfiles', () => {
  test('un movimiento no puede usar la cuenta de otro perfil', async () => {
    const a = await libroBase(c, 'Perfil A')
    const b = await libroBase(c, 'Perfil B')
    const res = await c.post('/api/transactions', {
      profileId: a.perfil.id, accountId: b.cuenta.id, type: 'gasto',
      amountCents: 1000, date: '2026-07-01',
    })
    assert.equal(res.status, 400)
  })

  test('un movimiento no puede usar la categoría de otro perfil', async () => {
    const a = await libroBase(c, 'Categoría A')
    const b = await libroBase(c, 'Categoría B')
    const ajena = b.categorias.find((cat: any) => cat.kind === 'gasto')
    const res = await c.post('/api/transactions', {
      profileId: a.perfil.id, accountId: a.cuenta.id, type: 'gasto',
      amountCents: 1000, date: '2026-07-01', categoryId: ajena.id,
    })
    assert.equal(res.status, 400)
  })

  test('un gasto no puede llevar categoría de ingreso', async () => {
    const { perfil, cuenta, categorias } = await libroBase(c, 'Tipo categoría')
    const deIngreso = categorias.find((cat: any) => cat.kind === 'ingreso')
    const res = await c.post('/api/transactions', {
      profileId: perfil.id, accountId: cuenta.id, type: 'gasto',
      amountCents: 1000, date: '2026-07-01', categoryId: deIngreso.id,
    })
    assert.equal(res.status, 400)
  })

  test('un movimiento no puede cambiar de perfil', async () => {
    const a = await libroBase(c, 'Mover A')
    const b = await libroBase(c, 'Mover B')
    const mov = (
      await c.post('/api/transactions', {
        profileId: a.perfil.id, accountId: a.cuenta.id, type: 'gasto',
        amountCents: 1000, date: '2026-07-01',
      })
    ).body

    const res = await c.patch(`/api/transactions/${mov.id}`, {
      profileId: b.perfil.id, accountId: b.cuenta.id, type: 'gasto',
      amountCents: 1000, date: '2026-07-01',
    })
    assert.equal(res.status, 400)
  })

  test('borrar un perfil no deja registros huérfanos', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Efímero')
    await c.post('/api/transactions', {
      profileId: perfil.id, accountId: cuenta.id, type: 'gasto',
      amountCents: 1000, date: '2026-07-01',
    })
    await c.post('/api/goals', { profileId: perfil.id, name: 'Meta', targetCents: 10000 })
    await c.post('/api/notes', { profileId: perfil.id, title: 'Nota', body: 'x' })

    assert.equal((await c.del(`/api/profiles/${perfil.id}`)).status, 200)

    assert.deepEqual((await c.get(`/api/transactions?profileId=${perfil.id}`)).body, [])
    assert.deepEqual((await c.get(`/api/accounts?profileId=${perfil.id}`)).body, [])
    assert.deepEqual((await c.get(`/api/goals?profileId=${perfil.id}`)).body, [])
    assert.deepEqual((await c.get(`/api/notes?profileId=${perfil.id}`)).body, [])
  })
})
