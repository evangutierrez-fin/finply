import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { levantar, libroBase, type Cliente } from './ayuda.ts'

let c: Cliente
before(async () => {
  c = await levantar()
})
after(() => c.cerrar())

describe('presupuestos por mes', () => {
  test('el tope de un mes no aplica al siguiente', async () => {
    const { perfil, categorias } = await libroBase(c, 'Topes')
    const gasto = categorias.find((cat: any) => cat.kind === 'gasto')

    await c.post('/api/budgets', {
      profileId: perfil.id, categoryId: gasto.id, month: '2026-07', amountCents: 300000,
    })

    const julio = (await c.get(`/api/budgets?profileId=${perfil.id}&month=2026-07`)).body
    const agosto = (await c.get(`/api/budgets?profileId=${perfil.id}&month=2026-08`)).body
    assert.equal(julio.length, 1)
    assert.equal(julio[0].amountCents, 300000)
    assert.equal(agosto.length, 0)
  })

  test('lo gastado solo cuenta el mes del presupuesto', async () => {
    const { perfil, cuenta, categorias } = await libroBase(c, 'Gastado')
    const gasto = categorias.find((cat: any) => cat.kind === 'gasto')

    for (const [date, cents] of [['2026-07-10', 20000], ['2026-08-10', 90000]] as const) {
      await c.post('/api/transactions', {
        profileId: perfil.id, accountId: cuenta.id, type: 'gasto',
        amountCents: cents, date, categoryId: gasto.id,
      })
    }
    await c.post('/api/budgets', {
      profileId: perfil.id, categoryId: gasto.id, month: '2026-07', amountCents: 100000,
    })
    await c.post('/api/budgets', {
      profileId: perfil.id, categoryId: gasto.id, month: '2026-08', amountCents: 100000,
    })

    const julio = (await c.get(`/api/budgets?profileId=${perfil.id}&month=2026-07`)).body[0]
    const agosto = (await c.get(`/api/budgets?profileId=${perfil.id}&month=2026-08`)).body[0]
    assert.equal(julio.spentCents, 20000)
    assert.equal(agosto.spentCents, 90000)
  })

  test('fijar el mismo mes y categoría actualiza en vez de duplicar', async () => {
    const { perfil, categorias } = await libroBase(c, 'Upsert')
    const gasto = categorias.find((cat: any) => cat.kind === 'gasto')
    const base = { profileId: perfil.id, categoryId: gasto.id, month: '2026-07' }

    await c.post('/api/budgets', { ...base, amountCents: 100000 })
    await c.post('/api/budgets', { ...base, amountCents: 250000 })

    const filas = (await c.get(`/api/budgets?profileId=${perfil.id}&month=2026-07`)).body
    assert.equal(filas.length, 1)
    assert.equal(filas[0].amountCents, 250000)
  })

  test('copiar del mes anterior no pisa lo que ya ajustaste', async () => {
    const { perfil, categorias } = await libroBase(c, 'Copiar')
    const gastos = categorias.filter((cat: any) => cat.kind === 'gasto').slice(0, 2)

    await c.post('/api/budgets', {
      profileId: perfil.id, categoryId: gastos[0].id, month: '2026-07', amountCents: 100000,
    })
    await c.post('/api/budgets', {
      profileId: perfil.id, categoryId: gastos[1].id, month: '2026-07', amountCents: 200000,
    })
    // Agosto ya tiene su propio ajuste en la primera categoría.
    await c.post('/api/budgets', {
      profileId: perfil.id, categoryId: gastos[0].id, month: '2026-08', amountCents: 555000,
    })

    const res = await c.post('/api/budgets/copiar', {
      profileId: perfil.id, from: '2026-07', to: '2026-08',
    })
    assert.equal(res.status, 200)
    assert.equal(res.body.copiados, 1)

    const agosto = (await c.get(`/api/budgets?profileId=${perfil.id}&month=2026-08`)).body
    const ajustado = agosto.find((b: any) => b.categoryId === gastos[0].id)
    const copiado = agosto.find((b: any) => b.categoryId === gastos[1].id)
    assert.equal(ajustado.amountCents, 555000)
    assert.equal(copiado.amountCents, 200000)
  })

  test('un presupuesto no acepta categoría de ingreso', async () => {
    const { perfil, categorias } = await libroBase(c, 'Ingreso')
    const ingreso = categorias.find((cat: any) => cat.kind === 'ingreso')
    const res = await c.post('/api/budgets', {
      profileId: perfil.id, categoryId: ingreso.id, month: '2026-07', amountCents: 1000,
    })
    assert.equal(res.status, 400)
  })
})
