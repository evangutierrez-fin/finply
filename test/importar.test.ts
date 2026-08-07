// Fase 2: import CSV.
// Lo que se cuida: que nada se escriba a medias, que deshacer devuelva el
// libro a como estaba, y que fechas y montos ambiguos se interpreten de una
// forma sola y explicable.

import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { levantar, libroBase, type Cliente } from './ayuda.ts'
// Solo módulos puros pueden importarse estáticamente aquí: `server/importar.ts`
// arrastra `db.ts`, que abre la base al cargarse — antes de que `levantar()`
// fije FINPLY_DB. Hacerlo llenó una vez el libro real de datos de prueba.
import { parseFecha, parseMonto } from '../server/valores.ts'
import { detectarSeparador, parseCsv } from '../server/csv.ts'

let c: Cliente
before(async () => {
  c = await levantar()
})
after(() => c.cerrar())

const CABECERA = 'fecha,tipo,cuenta,cuenta_destino,categoria,etiquetas,monto,concepto'

async function base(nombre: string) {
  const b = await libroBase(c, nombre)
  return { ...b, cuentaId: b.cuenta.id }
}

function previsualizar(perfilId: number, cuentaId: number, csv: string, extra = {}) {
  return c.post('/api/importaciones/previsualizar', {
    profileId: perfilId, cuentaPorOmision: cuentaId, csv, ...extra,
  })
}

function importar(perfilId: number, cuentaId: number, csv: string, extra = {}) {
  return c.post('/api/importaciones', {
    profileId: perfilId, cuentaPorOmision: cuentaId, csv, ...extra,
  })
}

describe('parser CSV', () => {
  test('respeta comillas, comas internas y saltos de línea', () => {
    const csv = 'a,b\r\n"uno, con coma","dos\ncon salto"\r\n"con ""comillas""",x\r\n'
    assert.deepEqual(parseCsv(csv), [
      ['a', 'b'],
      ['uno, con coma', 'dos\ncon salto'],
      ['con "comillas"', 'x'],
    ])
  })

  test('detecta el separador', () => {
    assert.equal(detectarSeparador('a;b;c\n1;2;3'), ';')
    assert.equal(detectarSeparador('a,b,c\n1,2,3'), ',')
    assert.equal(detectarSeparador('a\tb\tc\n1\t2\t3'), '\t')
  })

  test('se come el BOM que escribimos al exportar', () => {
    assert.deepEqual(parseCsv('﻿fecha,monto\n2026-07-01,10'), [
      ['fecha', 'monto'],
      ['2026-07-01', '10'],
    ])
  })

  test('tolera CRLF, LF y filas en blanco al final', () => {
    assert.equal(parseCsv('a,b\r\n1,2\r\n\r\n').length, 2)
    assert.equal(parseCsv('a,b\n1,2\n\n').length, 2)
  })
})

describe('montos', () => {
  test('interpreta las formas comunes', () => {
    assert.equal(parseMonto('1234.56'), 123456)
    assert.equal(parseMonto('$1,234.56'), 123456)
    assert.equal(parseMonto('1.234,56'), 123456) // formato europeo
    assert.equal(parseMonto('-500'), -50000)
    assert.equal(parseMonto('(500)'), -50000) // paréntesis contables
    assert.equal(parseMonto('1,234'), 123400) // miles
    assert.equal(parseMonto('1,23'), 123) // decimales
    assert.equal(parseMonto('0.05'), 5)
    // Misma regla que arriba: tres dígitos detrás de un solo separador son
    // miles. La vista previa muestra el resultado para que se pueda cachar.
    assert.equal(parseMonto('12.345'), 1234500)
  })

  test('rechaza lo que no es un monto', () => {
    for (const basura of ['', 'abc', '1.2.3.4', '1.23.45', 'N/A', '--5', '1,2345']) {
      assert.equal(parseMonto(basura), null, `debió rechazar "${basura}"`)
    }
  })
})

describe('fechas', () => {
  test('ISO y día-primero', () => {
    assert.equal(parseFecha('2026-07-01'), '2026-07-01')
    assert.equal(parseFecha('2026/07/01'), '2026-07-01')
    assert.equal(parseFecha('01/07/2026'), '2026-07-01')
    assert.equal(parseFecha('1-7-2026'), '2026-07-01')
    assert.equal(parseFecha('01/07/26'), '2026-07-01')
  })

  test('ambigua se lee día primero, que es la convención local', () => {
    assert.equal(parseFecha('03/04/2026'), '2026-04-03')
  })

  test('un mes imposible delata el archivo al revés y se corrige', () => {
    assert.equal(parseFecha('07/25/2026'), '2026-07-25')
  })

  test('rechaza fechas que no existen', () => {
    for (const mala of ['31/02/2026', '2026-13-01', 'ayer', '']) {
      assert.equal(parseFecha(mala), null, `debió rechazar "${mala}"`)
    }
  })

  test('un año de cuatro dígitos con ceros no produce una fecha corta', () => {
    // El import escribe en la base sin pasar por el validador de la API, así
    // que lo que salga de aquí es lo que se guarda. Con el año sin rellenar,
    // '0026-03-05' se convertía en '26-03-05': ni es AAAA-MM-DD ni ordena con
    // las demás. Hoy se rechaza, que es lo que hace también la puerta de la API.
    assert.equal(parseFecha('0026-03-05'), null)
    assert.equal(parseFecha('0999-01-01'), null)
    assert.equal(parseFecha('1000-01-01'), '1000-01-01', 'cuatro dígitos de verdad sí entran')
  })

  test('el bisiesto se decide con el año escrito, no con uno inventado', () => {
    assert.equal(parseFecha('29/02/2028'), '2028-02-29', '2028 es bisiesto')
    assert.equal(parseFecha('29/02/2027'), null, '2027 no lo es')
    assert.equal(parseFecha('2100-02-29'), null, 'los siglos no bisiestos también cuentan')
    assert.equal(parseFecha('2000-02-29'), '2000-02-29', 'y 2000 sí lo fue')
  })
})

describe('vista previa', () => {
  test('clasifica filas y no escribe nada', async () => {
    const { perfil, cuentaId } = await base('Previa')
    const csv = [
      CABECERA,
      '2026-07-01,gasto,,,Súper,,-450.00,Despensa',
      'no-es-fecha,gasto,,,,,−1,Basura',
      '2026-07-02,ingreso,,,,,1200.00,Reembolso',
    ].join('\n')

    const res = await previsualizar(perfil.id, cuentaId, csv)
    assert.equal(res.status, 200)
    assert.equal(res.body.resumen.nuevas, 2)
    assert.equal(res.body.resumen.errores, 1)
    assert.equal(res.body.filas[1].estado, 'error')
    assert.match(res.body.filas[1].motivo, /Fecha ilegible/)

    // Y el libro sigue vacío.
    assert.equal((await c.get(`/api/transactions?profileId=${perfil.id}`)).body.length, 0)
  })

  test('anuncia las categorías y etiquetas que se crearían', async () => {
    const { perfil, cuentaId } = await base('Anuncio')
    const csv = [CABECERA, '2026-07-01,gasto,,,Mascotas,perro · urgente,-100,Vet'].join('\n')
    const res = await previsualizar(perfil.id, cuentaId, csv)
    assert.deepEqual(res.body.resumen.categoriasPorCrear, ['Mascotas'])
    assert.deepEqual(res.body.resumen.etiquetasPorCrear.sort(), ['perro', 'urgente'])
  })

  test('muestra la fecha y el monto ya interpretados', async () => {
    const { perfil, cuentaId } = await base('Interpretado')
    const csv = ['fecha,monto,concepto', '03/04/2026,"$1.234,56",Ambiguo'].join('\n')
    const fila = (await previsualizar(perfil.id, cuentaId, csv)).body.filas[0]
    assert.equal(fila.date, '2026-04-03')
    assert.equal(fila.amountCents, 123456)
  })
})

describe('importar', () => {
  test('escribe las filas y las liga a un lote', async () => {
    const { perfil, cuentaId } = await base('Escribe')
    const csv = [
      CABECERA,
      '2026-07-01,gasto,,,Súper,gasto fijo,-450.00,Despensa',
      '2026-07-02,ingreso,,,Sueldo,,1200.00,Reembolso',
    ].join('\n')

    const res = await importar(perfil.id, cuentaId, csv, { filename: 'banco.csv' })
    assert.equal(res.status, 201)
    assert.equal(res.body.importadas, 2)

    const movs = (await c.get(`/api/transactions?profileId=${perfil.id}`)).body
    assert.equal(movs.length, 2)
    const gasto = movs.find((m: any) => m.type === 'gasto')
    assert.equal(gasto.amountCents, 45000)
    assert.equal(gasto.categoryName, 'Súper')
    assert.deepEqual(gasto.tags.map((t: any) => t.name), ['gasto fijo'])

    const lotes = (await c.get(`/api/importaciones?profileId=${perfil.id}`)).body
    assert.equal(lotes.length, 1)
    assert.equal(lotes[0].filename, 'banco.csv')
    assert.equal(lotes[0].vigentes, 2)
  })

  test('una fila que la base rechaza no deja nada escrito', async () => {
    const { perfil, cuentaId } = await base('Atómico')
    // La segunda fila referencia una cuenta destino inexistente: es error de
    // análisis. Para probar el rollback se fuerza un monto que viola el CHECK
    // saltándose la validación previa con cargo/abono ya normalizados.
    const csv = [
      CABECERA,
      '2026-07-01,gasto,,,,,-450.00,Buena',
      '2026-07-02,transferencia,,No existe,,,−100,Mala',
    ].join('\n')

    const previa = await previsualizar(perfil.id, cuentaId, csv)
    assert.equal(previa.body.resumen.errores, 1)

    // Las filas con error nunca entran; la buena sí.
    const res = await importar(perfil.id, cuentaId, csv)
    assert.equal(res.body.importadas, 1)
    assert.equal(res.body.errores, 1)
    assert.equal((await c.get(`/api/transactions?profileId=${perfil.id}`)).body.length, 1)
  })

  test('detecta duplicados contra el libro y dentro del archivo', async () => {
    const { perfil, cuentaId } = await base('Duplicados')
    const fila = '2026-07-01,gasto,,,,,-450.00,Despensa'
    await importar(perfil.id, cuentaId, [CABECERA, fila].join('\n'))

    // Mismo archivo otra vez: todo duplicado.
    const previa = await previsualizar(perfil.id, cuentaId, [CABECERA, fila].join('\n'))
    assert.equal(previa.body.resumen.duplicadas, 1)
    assert.equal(previa.body.resumen.nuevas, 0)

    const res = await importar(perfil.id, cuentaId, [CABECERA, fila].join('\n'))
    assert.equal(res.status, 400)
    assert.equal((await c.get(`/api/transactions?profileId=${perfil.id}`)).body.length, 1)

    // Repetida dentro del propio archivo: la segunda es duplicada.
    const dosVeces = [CABECERA, '2026-08-01,gasto,,,,,-10.00,Nueva', '2026-08-01,gasto,,,,,-10.00,Nueva']
    const previa2 = await previsualizar(perfil.id, cuentaId, dosVeces.join('\n'))
    assert.equal(previa2.body.resumen.nuevas, 1)
    assert.equal(previa2.body.resumen.duplicadas, 1)
  })

  test('con omitirDuplicadas=false sí se importan', async () => {
    const { perfil, cuentaId } = await base('Forzar duplicados')
    const csv = [CABECERA, '2026-07-01,gasto,,,,,-450.00,Despensa'].join('\n')
    await importar(perfil.id, cuentaId, csv)
    const res = await importar(perfil.id, cuentaId, csv, { omitirDuplicadas: false })
    assert.equal(res.body.importadas, 1)
    assert.equal((await c.get(`/api/transactions?profileId=${perfil.id}`)).body.length, 2)
  })

  test('la huella impide importar algo distinto de lo aprobado', async () => {
    const { perfil, cuentaId } = await base('Huella')
    const aprobado = [CABECERA, '2026-07-01,gasto,,,,,-10.00,Chico'].join('\n')
    const otro = [CABECERA, '2026-07-01,gasto,,,,,-99999.00,Enorme'].join('\n')

    const previa = await previsualizar(perfil.id, cuentaId, aprobado)
    const res = await importar(perfil.id, cuentaId, otro, { huella: previa.body.huella })
    assert.equal(res.status, 409)
    assert.equal((await c.get(`/api/transactions?profileId=${perfil.id}`)).body.length, 0)

    // Con el mismo archivo, la huella coincide y entra.
    const ok = await importar(perfil.id, cuentaId, aprobado, { huella: previa.body.huella })
    assert.equal(ok.status, 201)
  })

  test('cae en la cuenta por omisión y avisa de las que no encontró', async () => {
    const { perfil, cuentaId } = await base('Cuentas')
    const csv = [CABECERA, '2026-07-01,gasto,Banco Fantasma,,,,-10.00,X'].join('\n')
    const previa = await previsualizar(perfil.id, cuentaId, csv)
    assert.deepEqual(previa.body.resumen.cuentasNoEncontradas, ['Banco Fantasma'])
    assert.equal(previa.body.filas[0].accountName, 'Banco')
  })

  test('no importa a una cuenta de otro perfil', async () => {
    const a = await base('Aisla A')
    const b = await base('Aisla B')
    const csv = [CABECERA, '2026-07-01,gasto,,,,,-10.00,X'].join('\n')
    const res = await importar(a.perfil.id, b.cuentaId, csv)
    assert.equal(res.status, 400)
  })
})

describe('deshacer', () => {
  test('devuelve el libro a como estaba', async () => {
    const { perfil, cuentaId } = await base('Deshacer')
    // Un movimiento previo que NO debe tocarse.
    await c.post('/api/transactions', {
      profileId: perfil.id, accountId: cuentaId, type: 'gasto',
      amountCents: 999, date: '2026-06-01', note: 'A mano',
    })
    const antes = (await c.get(`/api/accounts?profileId=${perfil.id}`)).body[0].balanceCents

    const csv = [
      CABECERA,
      '2026-07-01,gasto,,,Súper,,-450.00,Despensa',
      '2026-07-02,gasto,,,Súper,,-120.00,Otra',
    ].join('\n')
    const lote = (await importar(perfil.id, cuentaId, csv)).body
    assert.equal((await c.get(`/api/transactions?profileId=${perfil.id}`)).body.length, 3)

    const res = await c.del(`/api/importaciones/${lote.batchId}?profileId=${perfil.id}`)
    assert.equal(res.status, 200)
    assert.equal(res.body.borradas, 2)

    const movs = (await c.get(`/api/transactions?profileId=${perfil.id}`)).body
    assert.equal(movs.length, 1)
    assert.equal(movs[0].note, 'A mano')
    assert.equal((await c.get(`/api/accounts?profileId=${perfil.id}`)).body[0].balanceCents, antes)
    assert.deepEqual((await c.get(`/api/importaciones?profileId=${perfil.id}`)).body, [])
  })

  test('no se puede deshacer el lote de otro perfil', async () => {
    const a = await base('Lote A')
    const b = await base('Lote B')
    const csv = [CABECERA, '2026-07-01,gasto,,,,,-10.00,X'].join('\n')
    const lote = (await importar(a.perfil.id, a.cuentaId, csv)).body
    const res = await c.del(`/api/importaciones/${lote.batchId}?profileId=${b.perfil.id}`)
    assert.equal(res.status, 404)
    assert.equal((await c.get(`/api/transactions?profileId=${a.perfil.id}`)).body.length, 1)
  })

  test('el respaldo conserva los lotes', async () => {
    const { perfil, cuentaId } = await base('Respaldo lotes')
    const csv = [CABECERA, '2026-07-01,gasto,,,,,-10.00,X'].join('\n')
    await importar(perfil.id, cuentaId, csv)

    const respaldo = (await c.get('/api/respaldo')).body
    await c.del(`/api/profiles/${perfil.id}`)
    assert.equal((await c.post('/api/respaldo/restaurar', respaldo)).status, 200)

    const lotes = (await c.get(`/api/importaciones?profileId=${perfil.id}`)).body
    assert.equal(lotes.length, 1, 'el lote debe sobrevivir al respaldo')
    assert.equal(lotes[0].vigentes, 1)
  })
})

describe('ida y vuelta con el export', () => {
  test('lo exportado se puede reimportar tal cual', async () => {
    const origen = await base('Origen')
    const gasto = origen.categorias.find((x: any) => x.kind === 'gasto')
    const tag = (await c.post('/api/tags', { profileId: origen.perfil.id, name: 'viaje' })).body
    const segunda = (
      await c.post('/api/accounts', {
        profileId: origen.perfil.id, name: 'Efectivo', type: 'efectivo', openingCents: 0,
      })
    ).body

    await c.post('/api/transactions', {
      profileId: origen.perfil.id, accountId: origen.cuentaId, type: 'gasto',
      amountCents: 45000, date: '2026-07-01', categoryId: gasto.id, note: 'Despensa',
      tagIds: [tag.id],
    })
    await c.post('/api/transactions', {
      profileId: origen.perfil.id, accountId: origen.cuentaId, type: 'transferencia',
      amountCents: 20000, date: '2026-07-03', transferAccountId: segunda.id, note: 'Retiro',
    })

    const csv = (await c.getText(`/api/transactions/export.csv?profileId=${origen.perfil.id}`)).body

    // Un perfil nuevo con las mismas cuentas recibe el archivo.
    const destino = await base('Destino')
    await c.post('/api/accounts', {
      profileId: destino.perfil.id, name: 'Efectivo', type: 'efectivo', openingCents: 0,
    })

    const res = await importar(destino.perfil.id, destino.cuentaId, csv)
    assert.equal(res.status, 201)
    assert.equal(res.body.importadas, 2)

    const movs = (await c.get(`/api/transactions?profileId=${destino.perfil.id}`)).body
    const reimportado = movs.find((m: any) => m.note === 'Despensa')
    assert.equal(reimportado.type, 'gasto')
    assert.equal(reimportado.amountCents, 45000)
    assert.equal(reimportado.categoryName, gasto.name)
    assert.deepEqual(reimportado.tags.map((t: any) => t.name), ['viaje'])

    const transferencia = movs.find((m: any) => m.note === 'Retiro')
    assert.equal(transferencia.type, 'transferencia')
    assert.equal(transferencia.accountName, 'Banco')
    assert.equal(transferencia.transferAccountName, 'Efectivo')
  })
})
