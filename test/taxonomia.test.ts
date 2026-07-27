// Fase 1: categorías editables/borrables y etiquetas.
// Lo que se cuida aquí es que reclasificar nunca pierda ni mueva dinero.

import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { levantar, libroBase, type Cliente } from './ayuda.ts'

let c: Cliente
before(async () => {
  c = await levantar()
})
after(() => c.cerrar())

describe('categorías', () => {
  test('renombrar conserva los movimientos', async () => {
    const { perfil, cuenta, categorias } = await libroBase(c, 'Renombrar')
    const gasto = categorias.find((x: any) => x.kind === 'gasto')
    await c.post('/api/transactions', {
      profileId: perfil.id, accountId: cuenta.id, type: 'gasto',
      amountCents: 5000, date: '2026-07-01', categoryId: gasto.id,
    })

    const res = await c.patch(`/api/categories/${gasto.id}`, { name: 'Despensa' })
    assert.equal(res.status, 200)
    assert.equal(res.body.name, 'Despensa')
    assert.equal(res.body.txCount, 1)

    const movs = (await c.get(`/api/transactions?profileId=${perfil.id}`)).body
    assert.equal(movs[0].categoryName, 'Despensa')
    assert.equal(movs[0].categoryId, gasto.id)
  })

  test('renombrar a un nombre ya usado del mismo tipo se rechaza', async () => {
    const { categorias } = await libroBase(c, 'Choque')
    const gastos = categorias.filter((x: any) => x.kind === 'gasto')
    const res = await c.patch(`/api/categories/${gastos[0].id}`, { name: gastos[1].name })
    assert.equal(res.status, 409)
  })

  test('una categoría en uso no se borra sin decir qué hacer con sus movimientos', async () => {
    const { perfil, cuenta, categorias } = await libroBase(c, 'Sin decidir')
    const gasto = categorias.find((x: any) => x.kind === 'gasto')
    await c.post('/api/transactions', {
      profileId: perfil.id, accountId: cuenta.id, type: 'gasto',
      amountCents: 5000, date: '2026-07-01', categoryId: gasto.id,
    })

    const res = await c.del(`/api/categories/${gasto.id}`)
    assert.equal(res.status, 409)
    assert.equal(res.body.txCount, 1)
    // Y sigue ahí.
    const cats = (await c.get(`/api/categories?profileId=${perfil.id}`)).body
    assert.ok(cats.some((x: any) => x.id === gasto.id))
  })

  test('borrar reasignando mueve los movimientos sin tocar montos', async () => {
    const { perfil, cuenta, categorias } = await libroBase(c, 'Reasignar')
    const [origen, destino] = categorias.filter((x: any) => x.kind === 'gasto')
    for (const cents of [5000, 7000]) {
      await c.post('/api/transactions', {
        profileId: perfil.id, accountId: cuenta.id, type: 'gasto',
        amountCents: cents, date: '2026-07-01', categoryId: origen.id,
      })
    }
    const saldoAntes = (await c.get(`/api/accounts?profileId=${perfil.id}`)).body[0].balanceCents

    const res = await c.del(`/api/categories/${origen.id}?reassignTo=${destino.id}`)
    assert.equal(res.status, 200)
    assert.equal(res.body.movimientosReasignados, 2)

    const movs = (await c.get(`/api/transactions?profileId=${perfil.id}`)).body
    assert.equal(movs.length, 2)
    assert.ok(movs.every((m: any) => m.categoryId === destino.id))
    // El dinero es lo que no se puede mover al reclasificar.
    const saldoDespues = (await c.get(`/api/accounts?profileId=${perfil.id}`)).body[0].balanceCents
    assert.equal(saldoDespues, saldoAntes)
  })

  test('no se puede reasignar a una categoría de otro tipo ni de otro perfil', async () => {
    const a = await libroBase(c, 'Tipos A')
    const b = await libroBase(c, 'Tipos B')
    const gasto = a.categorias.find((x: any) => x.kind === 'gasto')
    const ingreso = a.categorias.find((x: any) => x.kind === 'ingreso')
    const ajena = b.categorias.find((x: any) => x.kind === 'gasto')

    assert.equal((await c.del(`/api/categories/${gasto.id}?reassignTo=${ingreso.id}`)).status, 400)
    assert.equal((await c.del(`/api/categories/${gasto.id}?reassignTo=${ajena.id}`)).status, 400)
  })

  test('borrar con force deja los movimientos sin categoría', async () => {
    const { perfil, cuenta, categorias } = await libroBase(c, 'Forzado')
    const gasto = categorias.find((x: any) => x.kind === 'gasto')
    await c.post('/api/transactions', {
      profileId: perfil.id, accountId: cuenta.id, type: 'gasto',
      amountCents: 5000, date: '2026-07-01', categoryId: gasto.id,
    })

    const res = await c.del(`/api/categories/${gasto.id}?force=true`)
    assert.equal(res.status, 200)
    assert.equal(res.body.movimientosSinCategoria, 1)

    const movs = (await c.get(`/api/transactions?profileId=${perfil.id}`)).body
    assert.equal(movs[0].categoryId, null)
    assert.equal(movs[0].amountCents, 5000)
  })

  test('borrar una categoría se lleva sus presupuestos y lo informa', async () => {
    const { perfil, categorias } = await libroBase(c, 'Con tope')
    const gasto = categorias.find((x: any) => x.kind === 'gasto')
    await c.post('/api/budgets', {
      profileId: perfil.id, categoryId: gasto.id, month: '2026-07', amountCents: 100000,
    })

    const res = await c.del(`/api/categories/${gasto.id}`)
    assert.equal(res.status, 200)
    assert.equal(res.body.presupuestosBorrados, 1)
    assert.deepEqual((await c.get(`/api/budgets?profileId=${perfil.id}&month=2026-07`)).body, [])
  })
})

describe('etiquetas', () => {
  test('se ponen, se quitan y viajan en el movimiento', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Etiquetar')
    const viaje = (await c.post('/api/tags', { profileId: perfil.id, name: 'viaje CDMX' })).body
    const deducible = (await c.post('/api/tags', { profileId: perfil.id, name: 'deducible' })).body

    const mov = (
      await c.post('/api/transactions', {
        profileId: perfil.id, accountId: cuenta.id, type: 'gasto',
        amountCents: 5000, date: '2026-07-01', tagIds: [viaje.id, deducible.id],
      })
    ).body
    assert.deepEqual(mov.tags.map((t: any) => t.name), ['deducible', 'viaje CDMX'])

    // Un arreglo vacío las quita; omitirlo las deja.
    const sinCambio = (
      await c.patch(`/api/transactions/${mov.id}`, {
        profileId: perfil.id, accountId: cuenta.id, type: 'gasto',
        amountCents: 5000, date: '2026-07-01',
      })
    ).body
    assert.equal(sinCambio.tags.length, 2)

    const vaciado = (
      await c.patch(`/api/transactions/${mov.id}`, {
        profileId: perfil.id, accountId: cuenta.id, type: 'gasto',
        amountCents: 5000, date: '2026-07-01', tagIds: [],
      })
    ).body
    assert.equal(vaciado.tags.length, 0)
  })

  test('etiquetar no altera el tipo, el monto ni la categoría', async () => {
    const { perfil, cuenta, categorias } = await libroBase(c, 'No contamina')
    const gasto = categorias.find((x: any) => x.kind === 'gasto')
    const tag = (await c.post('/api/tags', { profileId: perfil.id, name: 'etiqueta' })).body

    const creado = (
      await c.post('/api/transactions', {
        profileId: perfil.id, accountId: cuenta.id, type: 'gasto',
        amountCents: 12345, date: '2026-07-01', categoryId: gasto.id, tagIds: [tag.id],
      })
    ).body
    assert.equal(creado.type, 'gasto')
    assert.equal(creado.amountCents, 12345)
    assert.equal(creado.categoryId, gasto.id)

    // Y al reetiquetar tampoco.
    const reetiquetado = (
      await c.patch(`/api/transactions/${creado.id}`, {
        profileId: perfil.id, accountId: cuenta.id, type: 'gasto',
        amountCents: 12345, date: '2026-07-01', categoryId: gasto.id, tagIds: [],
      })
    ).body
    assert.equal(reetiquetado.type, 'gasto')
    assert.equal(reetiquetado.amountCents, 12345)
    assert.equal(reetiquetado.categoryId, gasto.id)
  })

  test('no se puede usar una etiqueta de otro perfil', async () => {
    const a = await libroBase(c, 'Etiqueta A')
    const b = await libroBase(c, 'Etiqueta B')
    const ajena = (await c.post('/api/tags', { profileId: b.perfil.id, name: 'ajena' })).body

    const res = await c.post('/api/transactions', {
      profileId: a.perfil.id, accountId: a.cuenta.id, type: 'gasto',
      amountCents: 1000, date: '2026-07-01', tagIds: [ajena.id],
    })
    assert.equal(res.status, 400)
  })

  test('borrar una etiqueta no borra el movimiento', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Despegar')
    const tag = (await c.post('/api/tags', { profileId: perfil.id, name: 'temporal' })).body
    await c.post('/api/transactions', {
      profileId: perfil.id, accountId: cuenta.id, type: 'gasto',
      amountCents: 5000, date: '2026-07-01', tagIds: [tag.id],
    })

    assert.equal((await c.del(`/api/tags/${tag.id}`)).status, 200)

    const movs = (await c.get(`/api/transactions?profileId=${perfil.id}`)).body
    assert.equal(movs.length, 1)
    assert.equal(movs[0].amountCents, 5000)
    assert.deepEqual(movs[0].tags, [])
  })

  test('un nombre repetido no crea una etiqueta duplicada', async () => {
    const { perfil } = await libroBase(c, 'Duplicada')
    const primera = (await c.post('/api/tags', { profileId: perfil.id, name: 'renta' })).body
    const segunda = (await c.post('/api/tags', { profileId: perfil.id, name: 'renta' })).body
    assert.equal(primera.id, segunda.id)
    assert.equal((await c.get(`/api/tags?profileId=${perfil.id}`)).body.length, 1)
  })

  test('el respaldo conserva las etiquetas', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Respaldo etiquetas')
    const tag = (await c.post('/api/tags', { profileId: perfil.id, name: 'reembolsable' })).body
    await c.post('/api/transactions', {
      profileId: perfil.id, accountId: cuenta.id, type: 'gasto',
      amountCents: 5000, date: '2026-07-01', tagIds: [tag.id],
    })

    const respaldo = (await c.get('/api/respaldo')).body
    await c.del(`/api/profiles/${perfil.id}`)
    assert.equal((await c.post('/api/respaldo/restaurar', respaldo)).status, 200)

    const movs = (await c.get(`/api/transactions?profileId=${perfil.id}`)).body
    assert.deepEqual(movs[0].tags.map((t: any) => t.name), ['reembolsable'])
  })
})
