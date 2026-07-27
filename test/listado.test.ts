// Fase 1: filtros, paginación y export CSV.

import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { levantar, libroBase, type Cliente } from './ayuda.ts'

let c: Cliente
before(async () => {
  c = await levantar()
})
after(() => c.cerrar())

/** 12 gastos: día 1..12 de julio, montos 1000..12000. */
async function libroConDoce(nombre: string) {
  const base = await libroBase(c, nombre)
  for (let i = 1; i <= 12; i++) {
    await c.post('/api/transactions', {
      profileId: base.perfil.id,
      accountId: base.cuenta.id,
      type: 'gasto',
      amountCents: i * 1000,
      date: `2026-07-${String(i).padStart(2, '0')}`,
      note: `Gasto ${i}`,
    })
  }
  return base
}

describe('paginación', () => {
  test('las páginas no pierden ni repiten filas, y el total es del filtro', async () => {
    const { perfil } = await libroConDoce('Paginar')

    const p1 = await c.get(`/api/transactions?profileId=${perfil.id}&limit=5&offset=0`)
    const p2 = await c.get(`/api/transactions?profileId=${perfil.id}&limit=5&offset=5`)
    const p3 = await c.get(`/api/transactions?profileId=${perfil.id}&limit=5&offset=10`)

    assert.equal(p1.body.length, 5)
    assert.equal(p2.body.length, 5)
    assert.equal(p3.body.length, 2)
    assert.equal(p1.headers['x-total-count'], '12')
    assert.equal(p3.headers['x-total-count'], '12')

    const ids = [...p1.body, ...p2.body, ...p3.body].map((t: any) => t.id)
    assert.equal(new Set(ids).size, 12, 'ninguna fila repetida entre páginas')
  })

  test('sin offset se comporta como antes de existir la paginación', async () => {
    const { perfil } = await libroConDoce('Compatible')
    const res = await c.get(`/api/transactions?profileId=${perfil.id}`)
    assert.ok(Array.isArray(res.body), 'la respuesta sigue siendo un arreglo')
    assert.equal(res.body.length, 12)
  })
})

describe('filtros', () => {
  test('rango de fechas inclusivo', async () => {
    const { perfil } = await libroConDoce('Rango fechas')
    const res = await c.get(
      `/api/transactions?profileId=${perfil.id}&from=2026-07-03&to=2026-07-05`,
    )
    assert.equal(res.body.length, 3)
    assert.deepEqual(res.body.map((t: any) => t.date).sort(), [
      '2026-07-03', '2026-07-04', '2026-07-05',
    ])
  })

  test('rango de montos inclusivo', async () => {
    const { perfil } = await libroConDoce('Rango montos')
    const res = await c.get(
      `/api/transactions?profileId=${perfil.id}&minCents=3000&maxCents=5000`,
    )
    assert.deepEqual(res.body.map((t: any) => t.amountCents).sort((a: number, b: number) => a - b), [
      3000, 4000, 5000,
    ])
  })

  test('un rango invertido se rechaza en vez de devolver vacío', async () => {
    const { perfil } = await libroConDoce('Invertido')
    assert.equal(
      (await c.get(`/api/transactions?profileId=${perfil.id}&from=2026-07-10&to=2026-07-01`)).status,
      400,
    )
    assert.equal(
      (await c.get(`/api/transactions?profileId=${perfil.id}&minCents=900&maxCents=100`)).status,
      400,
    )
  })

  test('el rango de fechas manda sobre el mes', async () => {
    const { perfil, cuenta } = await libroConDoce('Precedencia')
    await c.post('/api/transactions', {
      profileId: perfil.id, accountId: cuenta.id, type: 'gasto',
      amountCents: 999, date: '2026-08-15', note: 'Agosto',
    })
    const res = await c.get(
      `/api/transactions?profileId=${perfil.id}&month=2026-07&from=2026-08-01&to=2026-08-31`,
    )
    assert.equal(res.body.length, 1)
    assert.equal(res.body[0].note, 'Agosto')
  })

  test('filtrar por etiqueta', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Por etiqueta')
    const tag = (await c.post('/api/tags', { profileId: perfil.id, name: 'viaje' })).body
    await c.post('/api/transactions', {
      profileId: perfil.id, accountId: cuenta.id, type: 'gasto',
      amountCents: 1000, date: '2026-07-01', tagIds: [tag.id],
    })
    await c.post('/api/transactions', {
      profileId: perfil.id, accountId: cuenta.id, type: 'gasto',
      amountCents: 2000, date: '2026-07-02',
    })

    const res = await c.get(`/api/transactions?profileId=${perfil.id}&tagId=${tag.id}`)
    assert.equal(res.body.length, 1)
    assert.equal(res.body[0].amountCents, 1000)
    assert.equal(res.headers['x-total-count'], '1')
  })
})

describe('export CSV', () => {
  test('exporta el mismo conjunto del filtro, sin paginar', async () => {
    const { perfil } = await libroConDoce('CSV')
    const res = await c.getText(
      `/api/transactions/export.csv?profileId=${perfil.id}&limit=2`,
    )
    const lineas = res.body.trim().split('\r\n')
    // 12 movimientos + encabezado: el límite de la página no aplica al export.
    assert.equal(lineas.length, 13)
    assert.match(res.headers['content-type'], /text\/csv/)
    assert.match(res.headers['content-disposition'], /attachment; filename="finply-movimientos-/)
  })

  test('neutraliza fórmulas en los campos que escribió el usuario', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Inyección')
    const tag = (await c.post('/api/tags', { profileId: perfil.id, name: '=SUM(A1)' })).body
    await c.post('/api/transactions', {
      profileId: perfil.id, accountId: cuenta.id, type: 'gasto',
      amountCents: 5000, date: '2026-07-01',
      note: '=HYPERLINK("http://malo","clic")', tagIds: [tag.id],
    })

    const csv = (await c.getText(`/api/transactions/export.csv?profileId=${perfil.id}`)).body

    // Ninguna celda arranca con = ; el prefijo ' la vuelve texto en Excel.
    assert.ok(csv.includes(`"'=HYPERLINK(""http://malo"",""clic"")"`), csv)
    assert.ok(csv.includes(`'=SUM(A1)`), csv)
    for (const linea of csv.trim().split('\r\n').slice(1)) {
      for (const celda of linea.split(',')) {
        assert.ok(!/^"?=/.test(celda), `celda ejecutable: ${celda}`)
      }
    }
  })

  test('el monto conserva su signo y no se saneó por error', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Signo')
    await c.post('/api/transactions', {
      profileId: perfil.id, accountId: cuenta.id, type: 'gasto',
      amountCents: 123456, date: '2026-07-01', note: 'Gasto',
    })
    await c.post('/api/transactions', {
      profileId: perfil.id, accountId: cuenta.id, type: 'ingreso',
      amountCents: 5000, date: '2026-07-02', note: 'Ingreso',
    })

    const csv = (await c.getText(`/api/transactions/export.csv?profileId=${perfil.id}`)).body
    assert.ok(csv.includes('-1234.56'), 'el gasto va negativo y sin prefijo')
    assert.ok(csv.includes('50.00'), 'el ingreso va positivo')
    assert.ok(!csv.includes("'-1234.56"), 'el monto no debe llevar prefijo de saneo')
  })

  test('lleva BOM para que Excel no destroce los acentos', async () => {
    const { perfil } = await libroBase(c, 'Acentos')
    // Hay que mirar los bytes: decodificar como texto se come el BOM.
    const bytes = (await c.getBytes(`/api/transactions/export.csv?profileId=${perfil.id}`)).body
    assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf])
  })
})
