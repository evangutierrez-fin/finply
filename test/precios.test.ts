// Inversiones por unidades, import de precios y simulador, sobre la API.
//
// Lo que más importa aquí no es una cifra suelta: es que **el valor de una
// inversión sea el mismo número en los tres lugares que lo enseñan** —la lista
// de inversiones, el patrimonio del Resumen y la serie anual de Reportes—
// ahora que los tres comparten el recorrido de `shared/inversiones.ts`. Si se
// separan, el usuario ve dos verdades del mismo libro.

import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { levantar, libroBase, type Cliente } from './ayuda.ts'
import { UNIDAD } from '../shared/inversiones.ts'

let c: Cliente
before(async () => {
  c = await levantar()
})
after(() => c?.cerrar())

async function inversionCon(nombre: string, entradas: any[] = []) {
  const { perfil, cuenta } = await libroBase(c, nombre)
  const inv = (
    await c.post('/api/investments', { profileId: perfil.id, name: nombre, kind: 'cripto' })
  ).body
  let ultima = inv
  for (const e of entradas) {
    const res = await c.post(`/api/investments/${inv.id}/entries`, e)
    assert.equal(res.status, 201, JSON.stringify(res.body))
    ultima = res.body
  }
  return { perfil, cuenta, inv: ultima }
}

describe('unidades y precio por unidad', () => {
  test('un aporte guarda sus unidades y el precio al que se compró', async () => {
    const { inv } = await inversionCon('Con unidades', [
      {
        type: 'aporte',
        amountCents: 100000,
        date: '2026-01-10',
        unitsE8: 2 * UNIDAD,
        unitPriceCents: 50000,
      },
    ])
    assert.equal(inv.unitsE8, 2 * UNIDAD)
    assert.equal(inv.valueCents, 100000)
    assert.equal(inv.entries[0].unitsE8, 2 * UNIDAD)
    assert.equal(inv.entries[0].unitPriceCents, 50000)
  })

  test('valuar por precio multiplica por las unidades en mano', async () => {
    const { inv } = await inversionCon('Por precio', [
      { type: 'aporte', amountCents: 100000, date: '2026-01-10', unitsE8: 2 * UNIDAD },
      { type: 'valuacion', amountCents: 0, date: '2026-06-01', unitPriceCents: 75000 },
    ])
    assert.equal(inv.valueCents, 150000)
    assert.equal(inv.gananciaCents, 50000)
  })

  test('un aporte con fecha vieja recalcula la valuación por precio', async () => {
    // La valuación guarda el precio, no el resultado. Por eso al aparecer una
    // unidad más de una fecha anterior, el valor sube solo en vez de quedarse
    // con el número que se calculó aquel día.
    const { inv } = await inversionCon('Retroactiva', [
      { type: 'aporte', amountCents: 100000, date: '2026-01-10', unitsE8: 2 * UNIDAD },
      { type: 'valuacion', amountCents: 0, date: '2026-06-01', unitPriceCents: 75000 },
    ])
    assert.equal(inv.valueCents, 150000)

    const despues = (
      await c.post(`/api/investments/${inv.id}/entries`, {
        type: 'aporte',
        amountCents: 40000,
        date: '2026-02-01',
        unitsE8: 1 * UNIDAD,
      })
    ).body
    assert.equal(despues.unitsE8, 3 * UNIDAD)
    assert.equal(despues.valueCents, 225000, '3 unidades × $750')
  })

  test('valuar por precio sin unidades se rechaza con su razón', async () => {
    const { inv } = await inversionCon('Sin unidades', [
      { type: 'aporte', amountCents: 100000, date: '2026-01-10' },
    ])
    const res = await c.post(`/api/investments/${inv.id}/entries`, {
      type: 'valuacion',
      amountCents: 0,
      date: '2026-06-01',
      unitPriceCents: 75000,
    })
    assert.equal(res.status, 400)
    assert.match(res.body.error, /no tiene unidades registradas/)
  })

  test('unas unidades con más de ocho decimales no entran', async () => {
    const { inv } = await inversionCon('Decimales', [])
    const res = await c.post(`/api/investments/${inv.id}/entries`, {
      type: 'aporte',
      amountCents: 100000,
      date: '2026-01-10',
      unitsE8: 1.5,
    })
    assert.equal(res.status, 400)
    assert.match(res.body.error, /8 decimales/)
  })

  test('retirar más de lo aportado deja el aportado en cero, no en negativo', async () => {
    const { inv } = await inversionCon('Retiro grande', [
      { type: 'aporte', amountCents: 100000, date: '2026-01-01' },
      { type: 'valuacion', amountCents: 300000, date: '2026-06-01' },
      { type: 'retiro', amountCents: 250000, date: '2026-07-01' },
    ])
    assert.equal(inv.investedCents, 0)
    assert.equal(inv.aportadoCents, 100000)
    assert.equal(inv.retiradoCents, 250000)
    assert.equal(inv.valueCents, 50000)
    assert.equal(inv.gananciaCents, 200000, 'la ganancia no depende del piso')
  })

  test('el rendimiento anualizado sale de los flujos, no de la resta', async () => {
    const { inv } = await inversionCon('Rendimiento', [
      { type: 'aporte', amountCents: 100000, date: '2020-01-01' },
      { type: 'valuacion', amountCents: 200000, date: '2026-01-01' },
    ])
    // Duplicar en seis años no es "+100 %": son unos 12 % anuales. La cifra
    // exacta depende de hoy, así que se comprueba el rango que la separa de la
    // respuesta ingenua.
    assert.ok(inv.rendimientoAnual !== null)
    assert.ok(
      inv.rendimientoAnual > 0.05 && inv.rendimientoAnual < 0.2,
      `esperaba algo cercano al 12 % anual y dio ${inv.rendimientoAnual}`,
    )
  })

  test('una inversión recién abierta no inventa un rendimiento', async () => {
    const hoy = new Date().toLocaleDateString('sv-SE')
    const { inv } = await inversionCon('Recién', [
      { type: 'aporte', amountCents: 100000, date: hoy },
    ])
    assert.equal(inv.rendimientoAnual, null)
  })
})

describe('el valor es el mismo en toda la app', () => {
  test('lista, Resumen y Reportes coinciden al centavo con valuación por precio', async () => {
    const { perfil } = await libroBase(c, 'Tres verdades')
    const inv = (
      await c.post('/api/investments', { profileId: perfil.id, name: 'Fondo', kind: 'fondo' })
    ).body
    await c.post(`/api/investments/${inv.id}/entries`, {
      type: 'aporte',
      amountCents: 123456,
      date: '2026-02-10',
      unitsE8: 3 * UNIDAD,
    })
    await c.post(`/api/investments/${inv.id}/entries`, {
      type: 'valuacion',
      amountCents: 0,
      date: '2026-03-01',
      unitPriceCents: 66666,
    })

    const lista = (await c.get(`/api/investments?profileId=${perfil.id}`)).body
    const valorLista = lista.reduce((s: number, i: any) => s + i.valueCents, 0)
    assert.equal(valorLista, 199998, '3 unidades × $666.66')

    const resumen = (await c.get(`/api/summary?profileId=${perfil.id}&month=2026-03`)).body
    assert.equal(resumen.investments.valueCents, valorLista)

    const anual = (await c.get(`/api/reportes?profileId=${perfil.id}&year=2026`)).body
    const marzo = anual.patrimonio.find((p: any) => p.month === '2026-03')
    assert.equal(marzo.inversionesCents, valorLista)
    // Y en febrero valía lo aportado: la valuación de marzo no viaja al pasado.
    const febrero = anual.patrimonio.find((p: any) => p.month === '2026-02')
    assert.equal(febrero.inversionesCents, 123456)
  })
})

describe('import de precios', () => {
  async function libroConDos(nombre: string) {
    const { perfil } = await libroBase(c, nombre)
    const btc = (
      await c.post('/api/investments', { profileId: perfil.id, name: 'Bitcoin', kind: 'cripto' })
    ).body
    const fondo = (
      await c.post('/api/investments', { profileId: perfil.id, name: 'Fondo indexado', kind: 'fondo' })
    ).body
    await c.post(`/api/investments/${btc.id}/entries`, {
      type: 'aporte',
      amountCents: 100000,
      date: '2026-01-10',
      unitsE8: UNIDAD / 10,
    })
    await c.post(`/api/investments/${fondo.id}/entries`, {
      type: 'aporte',
      amountCents: 500000,
      date: '2026-01-10',
      unitsE8: 200 * UNIDAD,
    })
    return { perfil, btc, fondo }
  }

  test('analizar no escribe nada y dice qué pasaría', async () => {
    const { perfil, btc } = await libroConDos('Vista previa')
    const antes = (await c.get(`/api/investments?profileId=${perfil.id}`)).body
    const total = (l: any[]) => l.reduce((s, i) => s + i.entries.length, 0)

    const informe = (
      await c.post('/api/precios/analizar', {
        profileId: perfil.id,
        texto: 'inversion,precio\nBitcoin,2000000\nFondo indexado,30.00\n',
        fecha: '2026-06-01',
      })
    ).body
    assert.equal(informe.listas, 2)
    assert.equal(informe.descartadas, 0)
    const fila = informe.filas.find((f: any) => f.investmentId === btc.id)
    assert.equal(fila.precioCents, 200000000)
    assert.equal(fila.valorCents, 20000000, '0.1 bitcoin a $2,000,000')

    const despues = (await c.get(`/api/investments?profileId=${perfil.id}`)).body
    assert.equal(total(despues), total(antes), 'la vista previa no asienta nada (R4)')
  })

  test('solo se asientan las filas marcadas', async () => {
    const { perfil, btc, fondo } = await libroConDos('Selección')
    const texto = 'inversion,precio\nBitcoin,2000000\nFondo indexado,30.00\n'
    const informe = (
      await c.post('/api/precios/analizar', { profileId: perfil.id, texto, fecha: '2026-06-01' })
    ).body
    const soloBtc = informe.filas.find((f: any) => f.investmentId === btc.id).fila

    const res = (
      await c.post('/api/precios/aplicar', {
        profileId: perfil.id,
        texto,
        fecha: '2026-06-01',
        filas: [soloBtc],
      })
    ).body
    assert.equal(res.creadas, 1)

    const lista = (await c.get(`/api/investments?profileId=${perfil.id}`)).body
    const bitcoin = lista.find((i: any) => i.id === btc.id)
    const indexado = lista.find((i: any) => i.id === fondo.id)
    assert.equal(bitcoin.valueCents, 20000000)
    assert.equal(indexado.valueCents, 500000, 'no se marcó: sigue con su aporte')
  })

  test('un nombre que no existe se reporta, no se inventa una inversión', async () => {
    const { perfil } = await libroConDos('Nombre ajeno')
    const informe = (
      await c.post('/api/precios/analizar', {
        profileId: perfil.id,
        texto: 'inversion,precio\nEthereum,50000\n',
        fecha: '2026-06-01',
      })
    ).body
    assert.equal(informe.listas, 0)
    assert.equal(informe.filas[0].estado, 'sin_inversion')

    const antes = (await c.get(`/api/investments?profileId=${perfil.id}`)).body.length
    await c.post('/api/precios/aplicar', {
      profileId: perfil.id,
      texto: 'inversion,precio\nEthereum,50000\n',
      fecha: '2026-06-01',
      filas: [0],
    })
    const despues = (await c.get(`/api/investments?profileId=${perfil.id}`)).body.length
    assert.equal(despues, antes, 'no se creó ninguna inversión nueva')
  })

  test('el nombre se reconoce sin acentos ni mayúsculas', async () => {
    const { perfil } = await libroBase(c, 'Acentos')
    const inv = (
      await c.post('/api/investments', { profileId: perfil.id, name: 'Acción América', kind: 'acciones' })
    ).body
    await c.post(`/api/investments/${inv.id}/entries`, {
      type: 'aporte',
      amountCents: 100000,
      date: '2026-01-10',
      unitsE8: 10 * UNIDAD,
    })
    const informe = (
      await c.post('/api/precios/analizar', {
        profileId: perfil.id,
        texto: 'ACCION AMERICA;150.50',
        fecha: '2026-06-01',
      })
    ).body
    assert.equal(informe.listas, 1, 'sin encabezado y con punto y coma')
    assert.equal(informe.filas[0].valorCents, 150500)
  })

  test('una fila con precio ilegible se descarta con su motivo', async () => {
    const { perfil } = await libroConDos('Ilegible')
    const informe = (
      await c.post('/api/precios/analizar', {
        profileId: perfil.id,
        texto: 'inversion,precio\nBitcoin,n/d\n',
        fecha: '2026-06-01',
      })
    ).body
    assert.equal(informe.listas, 0)
    assert.equal(informe.filas[0].estado, 'invalida')
    assert.match(informe.filas[0].motivo, /precio/)
  })

  test('una inversión sin unidades no se puede valuar por precio', async () => {
    const { perfil } = await libroBase(c, 'Sin unidades import')
    const inv = (
      await c.post('/api/investments', { profileId: perfil.id, name: 'Pagaré', kind: 'otro' })
    ).body
    await c.post(`/api/investments/${inv.id}/entries`, {
      type: 'aporte',
      amountCents: 100000,
      date: '2026-01-10',
    })
    const informe = (
      await c.post('/api/precios/analizar', {
        profileId: perfil.id,
        texto: 'inversion,precio\nPagaré,105\n',
        fecha: '2026-06-01',
      })
    ).body
    assert.equal(informe.filas[0].estado, 'sin_unidades')
  })

  test('la fecha de la propia fila gana sobre la fecha por omisión', async () => {
    const { perfil, btc } = await libroConDos('Fecha propia')
    const texto = 'fecha,inversion,precio\n15/03/2026,Bitcoin,1000000\n'
    const informe = (
      await c.post('/api/precios/analizar', { profileId: perfil.id, texto, fecha: '2026-06-01' })
    ).body
    assert.equal(informe.filas[0].fecha, '2026-03-15', 'día primero, como en México')

    await c.post('/api/precios/aplicar', {
      profileId: perfil.id,
      texto,
      fecha: '2026-06-01',
      filas: [0],
    })
    const lista = (await c.get(`/api/investments?profileId=${perfil.id}`)).body
    const bitcoin = lista.find((i: any) => i.id === btc.id)
    const valuacion = bitcoin.entries.find((e: any) => e.type === 'valuacion')
    assert.equal(valuacion.date, '2026-03-15')
  })
})

describe('el rendimiento no se come el tablero (R11)', () => {
  test('un libro con treinta inversiones y sus historiales sigue siendo instantáneo', async () => {
    // El XIRR es lo único de esta fase que se calcula recorriendo en JS. La
    // primera versión convertía la fecha de cada flujo **dentro** de cada
    // iteración de la búsqueda: 30 inversiones de 60 entradas tardaban 166 ms
    // por petición, y `/api/summary` lo llama en cada carga del Resumen.
    // Preparando las fechas una sola vez baja a ~6 ms. El límite de abajo es
    // una alarma contra esa regresión, no una medida de rendimiento: solo
    // salta si alguien vuelve a meter el trabajo dentro del bucle.
    const { db, investmentsWithTotals } = await import('../server/db.ts')
    const perfil = (await c.post('/api/profiles', { name: 'Carga', kind: 'personal' })).body
    const inv = db.prepare("INSERT INTO investments (profile_id, name, kind) VALUES (?, ?, 'otro')")
    const ent = db.prepare(
      'INSERT INTO investment_entries (investment_id, type, amount_cents, date) VALUES (?, ?, ?, ?)',
    )
    for (let i = 0; i < 30; i++) {
      const id = Number(inv.run(perfil.id, `Inversión ${i}`).lastInsertRowid)
      for (let m = 0; m < 60; m++) {
        const fecha = `20${20 + Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, '0')}-15`
        ent.run(id, m % 5 === 4 ? 'valuacion' : 'aporte', 100000 + m * 137, fecha)
      }
    }

    const t0 = performance.now()
    const lista = investmentsWithTotals(perfil.id) as any[]
    const ms = performance.now() - t0

    assert.equal(lista.length, 30)
    assert.ok(
      lista.every((i) => i.rendimientoAnual !== null),
      'las treinta traen su rendimiento calculado',
    )
    assert.ok(ms < 100, `tardó ${ms.toFixed(0)} ms; con las fechas preparadas anda en ~6`)
  })
})

describe('simulador', () => {
  test('parte de las mismas cifras que el tablero', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Simulación')
    const inv = (
      await c.post('/api/investments', { profileId: perfil.id, name: 'Fondo', kind: 'fondo' })
    ).body
    await c.post(`/api/investments/${inv.id}/entries`, {
      type: 'aporte',
      amountCents: 50000,
      date: '2026-01-10',
    })
    await c.post('/api/debts', {
      profileId: perfil.id,
      direction: 'por_pagar',
      counterparty: 'Banco',
      principalCents: 200000,
      startDate: '2026-01-01',
      annualRateBp: 2400,
      termMonths: 12,
      accountId: cuenta.id,
    })

    const sim = (
      await c.get(
        `/api/simulador?profileId=${perfil.id}&meses=12&ahorroMensualCents=100000&rendimientoAnualBp=700`,
      )
    ).body
    const resumen = (await c.get(`/api/summary?profileId=${perfil.id}&month=2026-07`)).body

    assert.equal(sim.inicio.inversionesCents, resumen.investments.valueCents)
    assert.equal(sim.inicio.deudaCents, resumen.debts.porPagarCents)
    assert.equal(
      sim.inicio.patrimonioCents,
      sim.inicio.liquidoCents + sim.inicio.inversionesCents - sim.inicio.deudaCents,
    )
    assert.equal(sim.invertir.puntos.length, 13)
    assert.equal(sim.deuda.puntos.length, 13)
    // La cuota del plan sale de la tabla de amortización, no de la nada.
    assert.ok(sim.inicio.deudas[0].pagoMensualCents > 0)
  })

  test('no escribe una sola fila', async () => {
    const { perfil } = await libroBase(c, 'Simulación limpia')
    const antes = (await c.get(`/api/transactions?profileId=${perfil.id}`)).body.length
    await c.get(`/api/simulador?profileId=${perfil.id}&meses=240&ahorroMensualCents=500000&rendimientoAnualBp=1200`)
    await c.get(`/api/simulador?profileId=${perfil.id}&meses=12&ahorroMensualCents=1&rendimientoAnualBp=0`)
    const despues = (await c.get(`/api/transactions?profileId=${perfil.id}`)).body.length
    assert.equal(despues, antes)
  })

  test('sin deuda, las dos rutas son la misma', async () => {
    const { perfil } = await libroBase(c, 'Sin deuda')
    const sim = (
      await c.get(
        `/api/simulador?profileId=${perfil.id}&meses=60&ahorroMensualCents=100000&rendimientoAnualBp=700`,
      )
    ).body
    assert.equal(sim.invertir.patrimonioFinalCents, sim.deuda.patrimonioFinalCents)
    assert.equal(sim.inicio.deudaCents, 0)
  })

  test('una tasa fuera de rango se rechaza en vez de proyectar un absurdo', async () => {
    const { perfil } = await libroBase(c, 'Tasa absurda')
    const res = await c.get(
      `/api/simulador?profileId=${perfil.id}&meses=12&ahorroMensualCents=0&rendimientoAnualBp=999999`,
    )
    assert.equal(res.status, 400)
  })
})
