import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { levantar, libroBase, type Cliente } from './ayuda.ts'

let c: Cliente
before(async () => {
  c = await levantar()
})
after(() => c.cerrar())

describe('respaldo', () => {
  test('exportar y restaurar deja el libro igual', async () => {
    const { perfil, cuenta, categorias } = await libroBase(c, 'Respaldable')
    const gasto = categorias.find((cat: any) => cat.kind === 'gasto')
    await c.post('/api/transactions', {
      profileId: perfil.id, accountId: cuenta.id, type: 'gasto',
      amountCents: 12345, date: '2026-07-10', categoryId: gasto.id, note: 'Tacos',
    })
    const deuda = (
      await c.post('/api/debts', {
        profileId: perfil.id, direction: 'por_cobrar', counterparty: 'Luis',
        principalCents: 100000, startDate: '2026-07-01',
      })
    ).body
    await c.post(`/api/debts/${deuda.id}/payments`, {
      amountCents: 30000, date: '2026-07-05', accountId: cuenta.id,
    })

    const antes = {
      cuentas: (await c.get(`/api/accounts?profileId=${perfil.id}`)).body,
      movimientos: (await c.get(`/api/transactions?profileId=${perfil.id}`)).body,
      deudas: (await c.get(`/api/debts?profileId=${perfil.id}`)).body,
    }

    const respaldo = (await c.get('/api/respaldo')).body

    // Se ensucia el libro a propósito antes de restaurar.
    await c.post('/api/profiles', { name: 'Basura', kind: 'negocio' })
    await c.del(`/api/profiles/${perfil.id}`)
    assert.equal((await c.get(`/api/transactions?profileId=${perfil.id}`)).body.length, 0)

    const res = await c.post('/api/respaldo/restaurar', respaldo)
    assert.equal(res.status, 200)

    const despues = {
      cuentas: (await c.get(`/api/accounts?profileId=${perfil.id}`)).body,
      movimientos: (await c.get(`/api/transactions?profileId=${perfil.id}`)).body,
      deudas: (await c.get(`/api/debts?profileId=${perfil.id}`)).body,
    }
    assert.deepEqual(despues, antes)

    // El perfil creado después del respaldo no sobrevive: restaurar reemplaza.
    const perfiles = (await c.get('/api/profiles')).body
    assert.equal(perfiles.length, 1)
    assert.equal(perfiles[0].name, 'Respaldable')
  })

  test('un archivo que no es respaldo se rechaza sin tocar el libro', async () => {
    await libroBase(c, 'Intacto')
    const antes = (await c.get('/api/profiles')).body

    for (const basura of [{ hola: 'mundo' }, { finply: 99, tables: {} }, []]) {
      const res = await c.post('/api/respaldo/restaurar', basura)
      assert.equal(res.status, 400, `debió rechazar ${JSON.stringify(basura)}`)
    }

    assert.deepEqual((await c.get('/api/profiles')).body, antes)
  })

  test('un respaldo con referencias rotas no se aplica a medias', async () => {
    const { perfil } = await libroBase(c, 'Roto')
    const antes = (await c.get(`/api/accounts?profileId=${perfil.id}`)).body

    const respaldo = (await c.get('/api/respaldo')).body
    respaldo.tables.transactions.push({
      id: 9999, profile_id: perfil.id, account_id: 123456, type: 'gasto',
      amount_cents: 100, date: '2026-07-01', note: 'cuenta inexistente',
    })

    const res = await c.post('/api/respaldo/restaurar', respaldo)
    assert.equal(res.status, 400)
    // El libro sigue como estaba: la transacción entera se revirtió.
    assert.deepEqual((await c.get(`/api/accounts?profileId=${perfil.id}`)).body, antes)
  })

  test('informa dónde vive la base', async () => {
    const res = await c.get('/api/respaldo/info')
    assert.equal(res.status, 200)
    assert.match(res.body.dbPath, /prueba\.db$/)
  })
})
