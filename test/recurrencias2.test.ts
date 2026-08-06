// Fase 25 · Recurrencias y calendario, segunda vuelta.
//
// Las tres cosas nuevas tocan el mismo punto delicado: **qué propone una
// plantilla**. Y lo que hay que cuidar no es que propongan de más, sino que
// nada de esto reabra el histórico ni duplique lo ya asentado (R5).
//
//   · El **monto variable** no puede volverse una segunda verdad: lo que la
//     bandeja enseña, lo que el calendario anuncia y lo que `asentar` escribe
//     tienen que ser el mismo número.
//   · La **pausa** no es un atraso: lo que cae dentro no propone nunca, ni
//     ahora ni cuando la pausa termine. Ahí está toda su diferencia con
//     archivar, que es lo que se venía usando para esto.
//   · El **tope** cuenta las que de verdad caen: una pausa en medio corre el
//     final en vez de comerse dos mensualidades.
//
// Y lo de siempre (D7): leer no escribe. Ninguna de estas pruebas puede
// encontrar una fila nueva por haber pedido la bandeja.

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { levantar, libroBase, type Cliente } from './ayuda.ts'
import {
  finEfectivo,
  ocurrencias,
  type ReglaRecurrencia,
} from '../shared/recurrencias.ts'

/** Una mensual del día 10, para no repetirla en cada prueba. */
function mensual(extra: Partial<ReglaRecurrencia> = {}): ReglaRecurrencia {
  return {
    frequency: 'mensual',
    dayOfMonth: 10,
    dayOfMonth2: null,
    monthOfYear: null,
    weekday: null,
    startDate: '2026-01-10',
    endDate: null,
    ...extra,
  }
}

const fechas = (r: ReglaRecurrencia, hasta: string) =>
  ocurrencias(r, { hasta }).lista.map((o) => o.fecha)

// ── La pausa, sin base de datos de por medio ──────────────────────────────

describe('pausar sin archivar', () => {
  test('lo que cae dentro de la ventana no aparece', () => {
    const r = mensual({ pausadaDesde: '2026-03-01', pausadaHasta: '2026-04-30' })
    assert.deepEqual(fechas(r, '2026-06-30'), [
      '2026-01-10', '2026-02-10', '2026-05-10', '2026-06-10',
    ])
  })

  test('⚠ y no vuelve después: la pausa es un hueco, no un atraso', () => {
    // Es la diferencia entera con archivar. Si al pasar la pausa reapareciera
    // marzo y abril, esto sería exactamente lo que ya hacía archivar y
    // desarchivar, y la función no serviría para nada.
    const r = mensual({ pausadaDesde: '2026-03-01', pausadaHasta: '2026-04-30' })
    const desdeDespues = ocurrencias(r, { desde: '2026-05-01', hasta: '2026-12-31' }).lista
    assert.ok(!desdeDespues.some((o) => o.periodo === '2026-03'))
    assert.ok(!desdeDespues.some((o) => o.periodo === '2026-04'))
    // Y pidiendo la ventana completa, tampoco.
    const todo = ocurrencias(r, { hasta: '2026-12-31' }).lista
    assert.equal(todo.filter((o) => o.periodo === '2026-03').length, 0)
  })

  test('la ventana es inclusiva por los dos lados', () => {
    // Pausar "del 10 de marzo al 10 de abril" tiene que llevarse esos dos
    // días: si el borde fuera exclusivo, la ocurrencia del último día
    // aparecería y nadie entendería por qué.
    const r = mensual({ pausadaDesde: '2026-03-10', pausadaHasta: '2026-04-10' })
    const lista = fechas(r, '2026-05-31')
    assert.ok(!lista.includes('2026-03-10'))
    assert.ok(!lista.includes('2026-04-10'))
    assert.ok(lista.includes('2026-05-10'))
  })

  test('una pausa a medias no pausa nada', () => {
    assert.equal(fechas(mensual({ pausadaDesde: '2026-03-01' }), '2026-04-30').length, 4)
    assert.equal(fechas(mensual({ pausadaHasta: '2026-03-31' }), '2026-04-30').length, 4)
  })

  test('la pausa no cambia la clave de periodo de lo que sí cae', () => {
    // Si la moviera, lo ya asentado se reproduciría entero (R5).
    const r = mensual({ pausadaDesde: '2026-03-01', pausadaHasta: '2026-03-31' })
    const periodos = ocurrencias(r, { hasta: '2026-05-31' }).lista.map((o) => o.periodo)
    assert.deepEqual(periodos, ['2026-01', '2026-02', '2026-04', '2026-05'])
  })

  test('pausar una semanal se salta las semanas de en medio', () => {
    const r: ReglaRecurrencia = {
      frequency: 'semanal',
      dayOfMonth: null,
      dayOfMonth2: null,
      monthOfYear: null,
      weekday: 1,
      startDate: '2026-01-05',
      endDate: null,
      pausadaDesde: '2026-01-12',
      pausadaHasta: '2026-01-26',
    }
    assert.deepEqual(fechas(r, '2026-02-09'), ['2026-01-05', '2026-02-02', '2026-02-09'])
  })
})

// ── El tope de ocurrencias ────────────────────────────────────────────────

describe('terminar tras N veces', () => {
  test('doce mensualidades son doce, y la última tiene fecha', () => {
    const r = mensual({ maxOcurrencias: 12 })
    const lista = fechas(r, '2030-12-31')
    assert.equal(lista.length, 12)
    assert.equal(lista[11], '2026-12-10')
    assert.equal(finEfectivo(r), '2026-12-10')
  })

  test('después de la última no propone nada, ni pidiendo el año siguiente', () => {
    const r = mensual({ maxOcurrencias: 12 })
    assert.deepEqual(ocurrencias(r, { desde: '2027-01-01', hasta: '2027-12-31' }).lista, [])
  })

  test('⚠ una pausa en medio corre el final: no te descuenta mensualidades', () => {
    // Doce mensualidades de un curso son doce. Si la pausa se comiera dos, el
    // usuario acabaría pagando diez por un curso de doce y nadie le avisaría.
    const r = mensual({
      maxOcurrencias: 12,
      pausadaDesde: '2026-07-01',
      pausadaHasta: '2026-08-31',
    })
    const lista = fechas(r, '2030-12-31')
    assert.equal(lista.length, 12)
    assert.ok(!lista.includes('2026-07-10'))
    assert.ok(!lista.includes('2026-08-10'))
    // Dos meses de pausa corren el final dos meses: de diciembre a febrero.
    assert.equal(lista[11], '2027-02-10')
    assert.equal(finEfectivo(r), '2027-02-10')
  })

  test('la fecha de fin gana si llega antes que el tope', () => {
    const r = mensual({ maxOcurrencias: 12, endDate: '2026-05-31' })
    assert.equal(fechas(r, '2030-12-31').length, 5)
    assert.equal(finEfectivo(r), '2026-05-31')
  })

  test('y el tope gana si llega antes que la fecha de fin', () => {
    const r = mensual({ maxOcurrencias: 3, endDate: '2026-12-31' })
    assert.deepEqual(fechas(r, '2030-12-31'), ['2026-01-10', '2026-02-10', '2026-03-10'])
    assert.equal(finEfectivo(r), '2026-03-10')
  })

  test('sin tope, `finEfectivo` es la fecha de fin —o nada', () => {
    assert.equal(finEfectivo(mensual()), null)
    assert.equal(finEfectivo(mensual({ endDate: '2027-01-01' })), '2027-01-01')
  })

  test('un tope en una quincenal cuenta quincenas, no meses', () => {
    const r: ReglaRecurrencia = {
      frequency: 'quincenal',
      dayOfMonth: 15,
      dayOfMonth2: 31,
      monthOfYear: null,
      weekday: null,
      startDate: '2026-01-01',
      endDate: null,
      maxOcurrencias: 5,
    }
    const lista = fechas(r, '2030-12-31')
    assert.equal(lista.length, 5)
    assert.equal(lista[4], '2026-03-15')
  })

  test('la ventana sigue mandando: pedir un mes devuelve un mes', () => {
    // El tope acota la vigencia, no la ventana. Lo contrario haría que pedir
    // el calendario de marzo devolviera enero.
    const r = mensual({ maxOcurrencias: 12 })
    assert.deepEqual(fechas(r, '2026-02-28'), ['2026-01-10', '2026-02-10'])
  })
})

// ── Contra la API ─────────────────────────────────────────────────────────

describe('la plantilla, del lado del libro', () => {
  let c: Cliente
  let perfil: any
  let cuenta: any

  before(async () => {
    c = await levantar()
    const base = await libroBase(c)
    perfil = base.perfil
    cuenta = base.cuenta
  })
  after(async () => c.cerrar())

  const crear = (extra: Record<string, unknown> = {}) =>
    c.post('/api/recurrencias', {
      profileId: perfil.id,
      accountId: cuenta.id,
      type: 'gasto',
      amountCents: 50_000,
      note: 'Luz',
      frequency: 'mensual',
      dayOfMonth: 10,
      startDate: '2026-01-10',
      ...extra,
    })

  const bandejaDe = async () =>
    (await c.get(`/api/recurrencias/pendientes?profileId=${perfil.id}&hoy=2026-06-30&limit=100&offset=0`))
      .body

  test('las tres columnas nuevas van y vuelven', async () => {
    const res = await crear({
      amountMode: 'promedio',
      pausedFrom: '2026-03-01',
      pausedUntil: '2026-04-30',
      maxOccurrences: 12,
    })
    assert.equal(res.status, 201)
    assert.equal(res.body.amountMode, 'promedio')
    assert.equal(res.body.pausedFrom, '2026-03-01')
    assert.equal(res.body.pausedUntil, '2026-04-30')
    assert.equal(res.body.maxOccurrences, 12)
  })

  test('una pausa a medias se rechaza en vez de guardarse coja', async () => {
    const res = await crear({ note: 'Coja', pausedFrom: '2026-03-01' })
    assert.equal(res.status, 400)
  })

  test('una pausa al revés se rechaza', async () => {
    const res = await crear({
      note: 'Al revés',
      pausedFrom: '2026-04-30',
      pausedUntil: '2026-03-01',
    })
    assert.equal(res.status, 400)
  })

  test('la bandeja no propone lo que cae en la pausa', async () => {
    const bandeja = await bandejaDe()
    const luz = bandeja.items.filter((p: any) => p.note === 'Luz')
    assert.ok(luz.length > 0)
    assert.ok(!luz.some((p: any) => p.periodo === '2026-03'))
    assert.ok(!luz.some((p: any) => p.periodo === '2026-04'))
    assert.ok(luz.some((p: any) => p.periodo === '2026-02'))
    assert.ok(luz.some((p: any) => p.periodo === '2026-05'))
  })

  test('⚠ asentar un periodo pausado se rechaza: no es una propuesta suya', async () => {
    const plantilla = (await c.get(`/api/recurrencias?profileId=${perfil.id}`)).body.find(
      (r: any) => r.note === 'Luz',
    )
    const res = await c.post(
      `/api/recurrencias/${plantilla.id}/asentar?profileId=${perfil.id}`,
      { periodo: '2026-03' },
    )
    assert.equal(res.status, 400)
  })

  test('la plantilla dice hasta cuándo propone, con fecha', async () => {
    const plantilla = (await c.get(`/api/recurrencias?profileId=${perfil.id}`)).body.find(
      (r: any) => r.note === 'Luz',
    )
    // 12 ocurrencias con dos meses de pausa: de enero de 2026 a febrero de 2027.
    assert.equal(plantilla.ultimaFecha, '2027-02-10')
    assert.equal(plantilla.maxOccurrences, 12)
  })
})

// ── Monto variable ────────────────────────────────────────────────────────

describe('monto variable', () => {
  let c: Cliente
  let perfil: any
  let cuenta: any
  let luz: any

  before(async () => {
    c = await levantar()
    const base = await libroBase(c)
    perfil = base.perfil
    cuenta = base.cuenta
    luz = (
      await c.post('/api/recurrencias', {
        profileId: perfil.id,
        accountId: cuenta.id,
        type: 'gasto',
        amountCents: 50_000,
        note: 'Luz',
        frequency: 'mensual',
        dayOfMonth: 10,
        startDate: '2026-01-10',
        amountMode: 'promedio',
      })
    ).body
  })
  after(async () => c.cerrar())

  const propuesta = async (periodo: string) => {
    const bandeja = (await c.get(
      `/api/recurrencias/pendientes?profileId=${perfil.id}&hoy=2026-06-30&limit=100&offset=0`,
    )).body
    return bandeja.items.find((p: any) => p.recurrenceId === luz.id && p.periodo === periodo)
  }

  test('sin historial propone el monto de arranque, no cero', async () => {
    // El promedio de nada no es cero, es "todavía no sé". Proponer cero sería
    // pedirle al usuario que corrija un dato inventado.
    const p = await propuesta('2026-01')
    assert.equal(p.amountCents, 50_000)
    assert.equal(p.amountMode, 'promedio')
    assert.equal(p.muestrasPromedio, 0)
  })

  test('con una asentada, propone esa', async () => {
    await c.post(`/api/recurrencias/${luz.id}/asentar?profileId=${perfil.id}`, {
      periodo: '2026-01',
      amountCents: 72_000,
    })
    const p = await propuesta('2026-02')
    assert.equal(p.amountCents, 72_000)
    assert.equal(p.muestrasPromedio, 1)
  })

  test('⚠ promedia las últimas tres, no todas', async () => {
    // Cuatro recibos: 72,000 · 30,000 · 40,000 · 50,000. El promedio de las
    // últimas tres es 40,000; el de las cuatro sería 48,000. La diferencia es
    // lo que hace que la ventana corta siga la temporada.
    for (const [periodo, cents] of [
      ['2026-02', 30_000],
      ['2026-03', 40_000],
      ['2026-04', 50_000],
    ] as const) {
      await c.post(`/api/recurrencias/${luz.id}/asentar?profileId=${perfil.id}`, {
        periodo,
        amountCents: cents,
      })
    }
    const p = await propuesta('2026-05')
    assert.equal(p.muestrasPromedio, 3)
    assert.equal(p.amountCents, 40_000)
  })

  test('⚠ asentar sin ajuste escribe lo que la bandeja enseñaba', async () => {
    // La trampa: si `asentar` leyera `amount_cents`, la vista diría $400 y el
    // libro guardaría $500. Dos cifras para la misma partida.
    const antes = await propuesta('2026-05')
    await c.post(`/api/recurrencias/${luz.id}/asentar?profileId=${perfil.id}`, {
      periodo: '2026-05',
    })
    const movs = (await c.get(`/api/transactions?profileId=${perfil.id}`)).body
    const mayo = movs.find((t: any) => t.date === '2026-05-10')
    assert.equal(mayo.amountCents, antes.amountCents)
    assert.equal(mayo.amountCents, 40_000)
  })

  test('el calendario anuncia el mismo monto que la bandeja', async () => {
    // Dos pantallas que enseñan la misma partida no pueden decir dos cifras
    // (D14). El calendario tiene su propia consulta, así que esto se puede
    // separar sin que nadie lo note.
    const cal = (await c.get(`/api/calendario?profileId=${perfil.id}&hoy=2026-06-01&dias=30`)).body
    const evento = cal.eventos.find((e: any) => e.tipo === 'recurrencia' && e.titulo === 'Luz')
    assert.ok(evento)
    const p = await propuesta('2026-06')
    assert.equal(evento.montoCents, p.amountCents)
  })

  test('la plantilla enseña lo que propondría hoy, y de cuántas sale', async () => {
    const plantilla = (await c.get(`/api/recurrencias?profileId=${perfil.id}`)).body.find(
      (r: any) => r.id === luz.id,
    )
    // Las tres últimas asentadas son 40,000 · 50,000 · 40,000.
    assert.equal(plantilla.montoPropuestoCents, Math.round((40_000 + 50_000 + 40_000) / 3))
    assert.equal(plantilla.muestrasPromedio, 3)
    // El monto de arranque no se toca: sigue siendo el que se escribió.
    assert.equal(plantilla.amountCents, 50_000)
  })

  test('un descarte no entra al promedio: no hubo recibo que promediar', async () => {
    const antes = (await c.get(`/api/recurrencias?profileId=${perfil.id}`)).body.find(
      (r: any) => r.id === luz.id,
    )
    await c.post(`/api/recurrencias/${luz.id}/descartar?profileId=${perfil.id}`, {
      periodo: '2026-06',
    })
    const despues = (await c.get(`/api/recurrencias?profileId=${perfil.id}`)).body.find(
      (r: any) => r.id === luz.id,
    )
    assert.equal(despues.montoPropuestoCents, antes.montoPropuestoCents)
    assert.equal(despues.muestrasPromedio, antes.muestrasPromedio)
  })

  test('⚠ anular el movimiento saca esa cifra del promedio', async () => {
    // El promedio sale del movimiento, no de la plantilla: si el movimiento se
    // va, el dato se va con él. Y de paso el periodo vuelve a la bandeja.
    const movs = (await c.get(`/api/transactions?profileId=${perfil.id}`)).body
    const mayo = movs.find((t: any) => t.date === '2026-05-10')
    await c.del(`/api/transactions/${mayo.id}`)
    const plantilla = (await c.get(`/api/recurrencias?profileId=${perfil.id}`)).body.find(
      (r: any) => r.id === luz.id,
    )
    // Quedan 30,000 · 40,000 · 50,000 de febrero, marzo y abril.
    assert.equal(plantilla.montoPropuestoCents, 40_000)
    assert.equal(plantilla.muestrasPromedio, 3)
  })

  test('una plantilla de monto fijo sigue proponiendo el suyo', async () => {
    const fija = (
      await c.post('/api/recurrencias', {
        profileId: perfil.id,
        accountId: cuenta.id,
        type: 'gasto',
        amountCents: 470_000,
        note: 'Renta',
        frequency: 'mensual',
        dayOfMonth: 1,
        startDate: '2026-01-01',
      })
    ).body
    assert.equal(fija.amountMode, 'fijo')
    assert.equal(fija.montoPropuestoCents, 470_000)
    await c.post(`/api/recurrencias/${fija.id}/asentar?profileId=${perfil.id}`, {
      periodo: '2026-01',
      amountCents: 999_999,
    })
    const despues = (await c.get(`/api/recurrencias?profileId=${perfil.id}`)).body.find(
      (r: any) => r.id === fija.id,
    )
    assert.equal(despues.montoPropuestoCents, 470_000)
  })

  test('pedir la bandeja tres veces no escribe una sola fila', async () => {
    const cuantas = async () =>
      (await c.get(`/api/transactions?profileId=${perfil.id}`)).body.length
    const antes = await cuantas()
    for (let i = 0; i < 3; i++) {
      await c.get(`/api/recurrencias/pendientes?profileId=${perfil.id}&limit=100&offset=0`)
      await c.get(`/api/recurrencias?profileId=${perfil.id}`)
    }
    assert.equal(await cuantas(), antes)
  })
})
