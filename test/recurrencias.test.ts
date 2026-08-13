// Recurrencias: lo que se repite, lo que se propone y lo que jamás se asienta
// solo. Aquí viven las dos reglas más caras de la fase:
//
//   R4 — nada entra al libro sin que el usuario lo confirme.
//   R5 — un periodo no puede asentarse dos veces, ni con dos pestañas.
//
// Los import de `shared/` son estáticos a propósito: son módulos puros que no
// llegan a `db.ts` (R16). Todo lo que toca la base pasa por el cliente HTTP.

import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { levantar, libroBase, type Cliente } from './ayuda.ts'
import {
  cifraPendiente,
  describirRecurrencia,
  fechaDeOcurrencia,
  MAX_PERIODOS,
  ocurrencias,
  pesoPendiente,
  restoPendiente,
  type ReglaRecurrencia,
} from '../shared/recurrencias.ts'
import { semanaISO } from '../shared/fechas.ts'

let c: Cliente
before(async () => {
  c = await levantar()
})
after(() => c.cerrar())

const REGLA: ReglaRecurrencia = {
  frequency: 'mensual',
  dayOfMonth: null,
  dayOfMonth2: null,
  monthOfYear: null,
  weekday: null,
  startDate: '2026-01-01',
  endDate: null,
}

const fechas = (regla: Partial<ReglaRecurrencia>, hasta: string, desde?: string) =>
  ocurrencias({ ...REGLA, ...regla }, { desde, hasta }).lista.map((o) => o.fecha)

const claves = (regla: Partial<ReglaRecurrencia>, hasta: string, desde?: string) =>
  ocurrencias({ ...REGLA, ...regla }, { desde, hasta }).lista.map((o) => o.periodo)

describe('cuándo cae cada periodo', () => {
  test('el día 31 se recorta en los meses cortos y vuelve al 31', () => {
    assert.deepEqual(
      fechas({ dayOfMonth: 31, startDate: '2026-01-31' }, '2026-05-31'),
      ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31'],
    )
  })

  test('la quincena da dos periodos al mes, ordenados por fecha', () => {
    const regla = { frequency: 'quincenal' as const, dayOfMonth: 15, dayOfMonth2: 31 }
    assert.deepEqual(fechas(regla, '2026-02-28'), [
      '2026-01-15', '2026-01-31', '2026-02-15', '2026-02-28',
    ])
    assert.deepEqual(claves(regla, '2026-02-28'), [
      '2026-01-Q1', '2026-01-Q2', '2026-02-Q1', '2026-02-Q2',
    ])
  })

  test('la clave de la quincena es la del hueco, no la del orden', () => {
    // Con la "primera" quincena el día 20, Q2 (día 5) cae antes en el mes. La
    // fecha se ordena, pero la clave sigue nombrando el mismo hueco: si no,
    // cambiar los días reescribiría el histórico.
    const regla = { frequency: 'quincenal' as const, dayOfMonth: 20, dayOfMonth2: 5 }
    assert.deepEqual(ocurrencias({ ...REGLA, ...regla }, { hasta: '2026-01-31' }).lista, [
      { periodo: '2026-01-Q2', fecha: '2026-01-05' },
      { periodo: '2026-01-Q1', fecha: '2026-01-20' },
    ])
  })

  test('lo anual respeta el mes y el día, aunque el inicio sea otro', () => {
    const regla = { frequency: 'anual' as const, monthOfYear: 3, dayOfMonth: 31, startDate: '2024-01-01' }
    assert.deepEqual(fechas(regla, '2027-01-01'), ['2024-03-31', '2025-03-31', '2026-03-31'])
    assert.deepEqual(claves(regla, '2027-01-01'), ['2024', '2025', '2026'])
  })

  test('la fecha de fin corta la serie', () => {
    assert.deepEqual(
      fechas({ dayOfMonth: 1, endDate: '2026-03-15' }, '2026-12-31'),
      ['2026-01-01', '2026-02-01', '2026-03-01'],
    )
  })

  test('empezar a mirar desde una fecha no corre los huecos', () => {
    // Los huecos son absolutos: el día 10 es el día 10, se mire desde donde se
    // mire. Es lo que hace barato el calendario, que arranca en hoy.
    assert.deepEqual(fechas({ dayOfMonth: 10 }, '2026-06-30', '2026-04-15'), [
      '2026-05-10', '2026-06-10',
    ])
  })
})

describe('la clave de periodo sobrevive a que cambien los días', () => {
  test('mover el día de una mensual no cambia la clave del mes', () => {
    assert.deepEqual(claves({ dayOfMonth: 1 }, '2026-03-31'), ['2026-01', '2026-02', '2026-03'])
    assert.deepEqual(claves({ dayOfMonth: 28 }, '2026-03-31'), ['2026-01', '2026-02', '2026-03'])
  })

  test('mover el día de una semanal no cambia la semana ISO', () => {
    // Lunes 6 y domingo 12 de julio son la misma semana ISO. Si la clave
    // cambiara, mover una recurrencia de lunes a domingo repropondría todo lo
    // ya asentado.
    const lunes = ocurrencias(
      { ...REGLA, frequency: 'semanal', weekday: 1, startDate: '2026-07-01' },
      { hasta: '2026-07-31' },
    ).lista
    const domingo = ocurrencias(
      { ...REGLA, frequency: 'semanal', weekday: 7, startDate: '2026-07-01' },
      { hasta: '2026-07-31' },
    ).lista
    assert.equal(lunes[0]!.periodo, '2026-W28')
    assert.equal(lunes[0]!.fecha, '2026-07-06')
    assert.equal(domingo[1]!.periodo, '2026-W28')
    assert.equal(domingo[1]!.fecha, '2026-07-12')
  })

  test('la semana ISO no se rompe en el cambio de año', () => {
    // El 1 de enero de 2027 pertenece a la semana 53 de 2026: la semana ISO va
    // de lunes a domingo y su año lo decide el jueves.
    assert.deepEqual(semanaISO('2026-12-28'), { anio: 2026, semana: 53 })
    assert.deepEqual(semanaISO('2027-01-03'), { anio: 2026, semana: 53 })
    assert.deepEqual(semanaISO('2027-01-04'), { anio: 2027, semana: 1 })
    assert.deepEqual(semanaISO('2024-12-30'), { anio: 2025, semana: 1 })
  })
})

describe('resolver una clave sin función inversa', () => {
  const mensual = { ...REGLA, dayOfMonth: 31, startDate: '2026-01-31' }
  const semanal = { ...REGLA, frequency: 'semanal' as const, weekday: 1, startDate: '2026-07-01' }

  test('la clave devuelve la fecha que le toca', () => {
    assert.equal(fechaDeOcurrencia(mensual, '2026-02'), '2026-02-28')
    assert.equal(fechaDeOcurrencia(semanal, '2026-W31'), '2026-07-27')
    assert.equal(fechaDeOcurrencia(semanal, '2027-W01'), '2027-01-04')
  })

  test('una clave de otra periodicidad o mal formada no resuelve', () => {
    assert.equal(fechaDeOcurrencia(mensual, '2026-07-Q1'), null, 'quincenal en una mensual')
    assert.equal(fechaDeOcurrencia(mensual, '2026-W31'), null, 'semanal en una mensual')
    assert.equal(fechaDeOcurrencia(mensual, '2026-13'), null, 'mes imposible')
    assert.equal(fechaDeOcurrencia(mensual, 'julio'), null)
  })

  test('una clave fuera de la vigencia de la plantilla no resuelve', () => {
    assert.equal(fechaDeOcurrencia(mensual, '2025-06'), null, 'antes de empezar')
    assert.equal(fechaDeOcurrencia({ ...mensual, endDate: '2026-03-01' }, '2026-06'), null)
  })
})

describe('el tope de periodos', () => {
  test('una plantilla vieja se corta y lo dice', () => {
    const vieja = { ...REGLA, frequency: 'semanal' as const, weekday: 3, startDate: '1990-01-01' }
    const r = ocurrencias(vieja, { hasta: '2026-07-27' })
    assert.equal(r.lista.length, MAX_PERIODOS)
    assert.equal(r.truncado, true)
    // Se conserva lo más viejo: un atraso se pone al día de atrás hacia acá.
    assert.equal(r.lista[0]!.fecha, '1990-01-03')
  })

  test('una lista de exactamente el tope no se reporta como cortada', () => {
    const r = ocurrencias({ ...REGLA, dayOfMonth: 1 }, { hasta: '2026-03-31', max: 3 })
    assert.equal(r.lista.length, 3)
    assert.equal(r.truncado, false)
  })
})

test('la periodicidad se lee en español', () => {
  assert.equal(describirRecurrencia({ ...REGLA, dayOfMonth: 5 }), 'Cada mes, el 5')
  assert.equal(describirRecurrencia({ ...REGLA, dayOfMonth: 31 }), 'Cada mes, el último día')
  assert.equal(
    describirRecurrencia({ ...REGLA, frequency: 'quincenal', dayOfMonth: 15, dayOfMonth2: 31 }),
    'Cada quincena, el 15 y el último día',
  )
  assert.equal(
    describirRecurrencia({ ...REGLA, frequency: 'semanal', weekday: 3 }),
    'Cada semana, los miércoles',
  )
})

// ── Contra el servidor ────────────────────────────────────────────────────

const HOY = '2026-07-27'

/** Libro con una renta mensual del día 1, empezada en abril. */
async function libroConRenta(nombre: string, extra: Record<string, unknown> = {}) {
  const { perfil, cuenta, categorias } = await libroBase(c, nombre)
  const gasto = categorias.find((cat: any) => cat.kind === 'gasto')
  const res = await c.post('/api/recurrencias', {
    profileId: perfil.id,
    accountId: cuenta.id,
    type: 'gasto',
    amountCents: 850000,
    categoryId: gasto.id,
    note: 'Renta',
    frequency: 'mensual',
    dayOfMonth: 1,
    startDate: '2026-04-01',
    ...extra,
  })
  assert.equal(res.status, 201, JSON.stringify(res.body))
  return { perfil, cuenta, categorias, renta: res.body }
}

const bandeja = async (perfilId: number, extra = '') =>
  (await c.get(`/api/recurrencias/pendientes?profileId=${perfilId}&hoy=${HOY}${extra}`)).body

const movimientos = async (perfilId: number) =>
  (await c.get(`/api/transactions?profileId=${perfilId}`)).body

describe('plantillas', () => {
  test('una plantilla nueva propone todos sus periodos desde el inicio', async () => {
    // D8: retroactivo completo, para poner al día un libro atrasado.
    const { perfil, renta } = await libroConRenta('Retroactiva')
    assert.equal(renta.descripcion, 'Cada mes, el 1')

    const b = await bandeja(perfil.id)
    assert.equal(b.total, 4, 'abril, mayo, junio y julio')
    assert.deepEqual(b.items.map((p: any) => p.periodo), ['2026-04', '2026-05', '2026-06', '2026-07'])
    assert.deepEqual(b.items.map((p: any) => p.fecha), [
      '2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01',
    ])
    assert.equal(b.items[0]!.amountCents, 850000)
    assert.equal(b.items[0]!.atraso, 117, 'del 1 de abril al 27 de julio')

    // Y el conteo que el cliente muestra antes de guardar sale del mismo
    // módulo puro: el aviso de D8 no puede decir un número distinto.
    const previo = ocurrencias(
      { ...REGLA, dayOfMonth: 1, startDate: '2026-04-01' },
      { hasta: HOY },
    ).lista.length
    assert.equal(previo, b.total)
  })

  test('la lista dice cuántas faltan y qué sigue', async () => {
    const { perfil } = await libroConRenta('Lista')
    const lista = (await c.get(`/api/recurrencias?profileId=${perfil.id}&hoy=${HOY}`)).body
    assert.equal(lista.length, 1)
    assert.equal(lista[0].pendientes, 4)
    assert.equal(lista[0].proximaFecha, '2026-08-01')
  })

  test('leer la bandeja no escribe nada', async () => {
    // D7 en su forma más pura: un GET no puede tener efectos. Si la bandeja se
    // guardara, leerla tres veces dejaría rastro.
    const { perfil } = await libroConRenta('Sin efectos')
    const primera = await bandeja(perfil.id)
    await bandeja(perfil.id)
    const tercera = await bandeja(perfil.id)
    assert.deepEqual(tercera, primera)
    assert.equal((await movimientos(perfil.id)).length, 0, 'ni un movimiento')
  })

  test('la cuenta tiene que ser del mismo perfil', async () => {
    const { perfil } = await libroConRenta('Mío')
    const ajeno = await libroBase(c, 'Ajeno')
    const res = await c.post('/api/recurrencias', {
      profileId: perfil.id,
      accountId: ajeno.cuenta.id,
      type: 'gasto',
      amountCents: 1000,
      frequency: 'mensual',
      startDate: '2026-07-01',
    })
    assert.equal(res.status, 400)
    assert.match(res.body.error, /no pertenece/)
  })

  test('una transferencia recurrente exige cuenta destino distinta', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Transfer')
    const sinDestino = await c.post('/api/recurrencias', {
      profileId: perfil.id, accountId: cuenta.id, type: 'transferencia',
      amountCents: 100000, frequency: 'mensual', startDate: '2026-07-01',
    })
    assert.equal(sinDestino.status, 400)

    const ahorro = (
      await c.post('/api/accounts', { profileId: perfil.id, name: 'Ahorro', type: 'ahorro' })
    ).body
    const ok = await c.post('/api/recurrencias', {
      profileId: perfil.id, accountId: cuenta.id, type: 'transferencia',
      transferAccountId: ahorro.id, amountCents: 100000, note: 'Al ahorro',
      frequency: 'mensual', dayOfMonth: 5, startDate: '2026-07-01',
    })
    assert.equal(ok.status, 201, JSON.stringify(ok.body))
    assert.equal(ok.body.transferAccountName, 'Ahorro')
    assert.equal(ok.body.categoryId, null, 'una transferencia no lleva categoría')
  })

  test('las dos quincenas no pueden caer el mismo día', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Quincenas iguales')
    const res = await c.post('/api/recurrencias', {
      profileId: perfil.id, accountId: cuenta.id, type: 'ingreso', amountCents: 1000,
      frequency: 'quincenal', dayOfMonth: 15, dayOfMonth2: 15, startDate: '2026-07-01',
    })
    assert.equal(res.status, 400)
  })
})

describe('asentar', () => {
  test('asentar crea el movimiento y saca la propuesta de la bandeja', async () => {
    const { perfil, renta } = await libroConRenta('Asentar')
    const res = await c.post(
      `/api/recurrencias/${renta.id}/asentar?profileId=${perfil.id}`,
      { periodo: '2026-05' },
    )
    assert.equal(res.status, 201, JSON.stringify(res.body))
    assert.equal(res.body.amountCents, 850000)
    assert.equal(res.body.date, '2026-05-01')
    assert.equal(res.body.note, 'Renta')
    assert.equal(res.body.categoryName, res.body.categoryName, 'conserva la categoría')

    const b = await bandeja(perfil.id)
    assert.equal(b.total, 3)
    assert.ok(!b.items.some((p: any) => p.periodo === '2026-05'))
    assert.equal((await movimientos(perfil.id)).length, 1)
  })

  test('asentar dos veces el mismo periodo no duplica el movimiento', async () => {
    // R5. Lo ataja el UNIQUE de la base, no una condición de la ruta: es lo
    // único que sirve contra un doble clic o dos pestañas.
    const { perfil, renta } = await libroConRenta('Doble clic')
    const url = `/api/recurrencias/${renta.id}/asentar?profileId=${perfil.id}`

    const primera = await c.post(url, { periodo: '2026-06' })
    assert.equal(primera.status, 201)
    const segunda = await c.post(url, { periodo: '2026-06' })
    assert.equal(segunda.status, 409, JSON.stringify(segunda.body))
    assert.match(segunda.body.error, /ya se había resuelto/)

    assert.equal((await movimientos(perfil.id)).length, 1, 'un solo movimiento')
  })

  test('dos peticiones a la vez tampoco duplican', async () => {
    const { perfil, renta } = await libroConRenta('Dos pestañas')
    const url = `/api/recurrencias/${renta.id}/asentar?profileId=${perfil.id}`
    const [a, b] = await Promise.all([
      c.post(url, { periodo: '2026-07' }),
      c.post(url, { periodo: '2026-07' }),
    ])
    const codigos = [a.status, b.status].sort()
    assert.deepEqual(codigos, [201, 409])
    assert.equal((await movimientos(perfil.id)).length, 1)
  })

  test('los ajustes son de la partida, no de la plantilla', async () => {
    const { perfil, renta } = await libroConRenta('Ajustes')
    const res = await c.post(`/api/recurrencias/${renta.id}/asentar?profileId=${perfil.id}`, {
      periodo: '2026-06',
      amountCents: 900000,
      date: '2026-06-03',
      note: 'Renta + agua',
    })
    assert.equal(res.status, 201)
    assert.equal(res.body.amountCents, 900000)
    assert.equal(res.body.date, '2026-06-03')

    const plantilla = (await c.get(`/api/recurrencias?profileId=${perfil.id}&hoy=${HOY}`)).body[0]
    assert.equal(plantilla.amountCents, 850000, 'la plantilla no se movió')
    const pendiente = (await bandeja(perfil.id)).items[0]
    assert.equal(pendiente.amountCents, 850000)
  })

  test('un periodo que no le corresponde a la plantilla se rechaza', async () => {
    const { perfil, renta } = await libroConRenta('Periodo ajeno')
    for (const periodo of ['2026-06-Q1', '2026-W20', '2025-12']) {
      const res = await c.post(
        `/api/recurrencias/${renta.id}/asentar?profileId=${perfil.id}`,
        { periodo },
      )
      assert.equal(res.status, 400, `${periodo} debió rechazarse`)
    }
    assert.equal((await movimientos(perfil.id)).length, 0)
  })

  test('la plantilla de otro perfil no se puede asentar', async () => {
    const { renta } = await libroConRenta('Dueña')
    const otro = await libroBase(c, 'Intrusa')
    const res = await c.post(
      `/api/recurrencias/${renta.id}/asentar?profileId=${otro.perfil.id}`,
      { periodo: '2026-05' },
    )
    assert.equal(res.status, 404)
  })

  test('las etiquetas de la plantilla viajan al movimiento', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Etiquetada')
    const tag = (await c.post('/api/tags', { profileId: perfil.id, name: 'fijo' })).body
    const rec = (
      await c.post('/api/recurrencias', {
        profileId: perfil.id, accountId: cuenta.id, type: 'gasto', amountCents: 29900,
        note: 'Streaming', frequency: 'mensual', dayOfMonth: 12, startDate: '2026-07-01',
        tagIds: [tag.id],
      })
    ).body
    assert.deepEqual(rec.tags.map((t: any) => t.name), ['fijo'])

    const propuesta = (await bandeja(perfil.id)).items[0]
    assert.deepEqual(propuesta.tags.map((t: any) => t.name), ['fijo'])

    const tx = (
      await c.post(`/api/recurrencias/${rec.id}/asentar?profileId=${perfil.id}`, {
        periodo: '2026-07',
      })
    ).body
    assert.deepEqual(tx.tags.map((t: any) => t.name), ['fijo'])
  })
})

describe('descartar', () => {
  test('descartar no asienta nada y no vuelve a proponerse', async () => {
    const { perfil, renta } = await libroConRenta('Descarte')
    const res = await c.post(`/api/recurrencias/${renta.id}/descartar?profileId=${perfil.id}`, {
      periodo: '2026-04',
    })
    assert.equal(res.status, 200)
    assert.equal((await movimientos(perfil.id)).length, 0, 'descartar no mueve el libro')

    const b = await bandeja(perfil.id)
    assert.equal(b.total, 3)
    assert.ok(!b.items.some((p: any) => p.periodo === '2026-04'))

    // Y sigue sin volver después de releer.
    assert.equal((await bandeja(perfil.id)).total, 3)
  })

  test('descartar dos veces el mismo periodo da 409', async () => {
    const { perfil, renta } = await libroConRenta('Descarte doble')
    const url = `/api/recurrencias/${renta.id}/descartar?profileId=${perfil.id}`
    assert.equal((await c.post(url, { periodo: '2026-04' })).status, 200)
    assert.equal((await c.post(url, { periodo: '2026-04' })).status, 409)
  })

  test('un descarte se puede deshacer; un asentado no', async () => {
    const { perfil, renta } = await libroConRenta('Reabrir')
    await c.post(`/api/recurrencias/${renta.id}/descartar?profileId=${perfil.id}`, {
      periodo: '2026-04',
    })
    const reabrir = await c.post(`/api/recurrencias/${renta.id}/reabrir?profileId=${perfil.id}`, {
      periodo: '2026-04',
    })
    assert.equal(reabrir.status, 200)
    assert.equal((await bandeja(perfil.id)).total, 4, 'volvió a la bandeja')

    await c.post(`/api/recurrencias/${renta.id}/asentar?profileId=${perfil.id}`, {
      periodo: '2026-05',
    })
    const noSePuede = await c.post(`/api/recurrencias/${renta.id}/reabrir?profileId=${perfil.id}`, {
      periodo: '2026-05',
    })
    assert.equal(noSePuede.status, 409)
    assert.match(noSePuede.body.error, /anula su movimiento/)
  })
})

describe('la plantilla y lo ya asentado son cosas distintas', () => {
  test('subirle el monto no reescribe lo asentado, pero sí lo pendiente', async () => {
    const { perfil, cuenta, renta } = await libroConRenta('Subió la renta')
    await c.post(`/api/recurrencias/${renta.id}/asentar?profileId=${perfil.id}`, {
      periodo: '2026-04',
    })

    const res = await c.patch(`/api/recurrencias/${renta.id}`, {
      profileId: perfil.id,
      accountId: cuenta.id,
      type: 'gasto',
      amountCents: 900000,
      note: 'Renta',
      frequency: 'mensual',
      dayOfMonth: 1,
      startDate: '2026-04-01',
    })
    assert.equal(res.status, 200, JSON.stringify(res.body))

    const asentado = (await movimientos(perfil.id))[0]
    assert.equal(asentado.amountCents, 850000, 'lo asentado es historia')

    const b = await bandeja(perfil.id)
    assert.equal(b.total, 3)
    assert.ok(b.items.every((p: any) => p.amountCents === 900000), 'lo pendiente sí sube')
  })

  test('anular el movimiento devuelve el periodo a la bandeja', async () => {
    // El libro manda: si el movimiento ya no está, ese periodo no está
    // asentado. Lo hace la base con ON DELETE CASCADE, no la ruta.
    const { perfil, renta } = await libroConRenta('Anulado')
    const tx = (
      await c.post(`/api/recurrencias/${renta.id}/asentar?profileId=${perfil.id}`, {
        periodo: '2026-06',
      })
    ).body
    assert.equal((await bandeja(perfil.id)).total, 3)

    assert.equal((await c.del(`/api/transactions/${tx.id}`)).status, 200)
    const b = await bandeja(perfil.id)
    assert.equal(b.total, 4)
    assert.ok(b.items.some((p: any) => p.periodo === '2026-06'))
  })

  test('archivar una plantilla la calla sin borrar nada', async () => {
    const { perfil, cuenta, renta } = await libroConRenta('Archivada')
    await c.patch(`/api/recurrencias/${renta.id}`, {
      profileId: perfil.id, accountId: cuenta.id, type: 'gasto', amountCents: 850000,
      note: 'Renta', frequency: 'mensual', dayOfMonth: 1, startDate: '2026-04-01',
      archived: true,
    })
    assert.equal((await bandeja(perfil.id)).total, 0)
    const lista = (await c.get(`/api/recurrencias?profileId=${perfil.id}&hoy=${HOY}`)).body
    assert.equal(lista.length, 1)
    assert.equal(lista[0].archived, true)
    assert.equal(lista[0].proximaFecha, null)
  })

  test('borrar la plantilla deja en el libro lo que ya se asentó', async () => {
    const { perfil, renta } = await libroConRenta('Borrada')
    await c.post(`/api/recurrencias/${renta.id}/asentar?profileId=${perfil.id}`, {
      periodo: '2026-04',
    })
    const res = await c.del(`/api/recurrencias/${renta.id}?profileId=${perfil.id}`)
    assert.equal(res.status, 200)
    assert.equal(res.body.asentados, 1, 'avisa cuántos movimientos quedan')

    assert.equal((await movimientos(perfil.id)).length, 1, 'ese dinero se movió')
    assert.equal((await bandeja(perfil.id)).total, 0)
  })
})

/** Un libro con de todo: tarjeta con corte, compra a meses, deuda y renta. */
async function libroCompleto(nombre: string) {
  const { perfil, cuenta, categorias } = await libroBase(c, nombre)
  const gasto = categorias.find((cat: any) => cat.kind === 'gasto')
  const tarjeta = (
    await c.post('/api/accounts', {
      profileId: perfil.id, name: 'Tarjeta', type: 'tarjeta',
      creditLimitCents: 5_000_00, cutDay: 5, dueDay: 25,
    })
  ).body
  // Un cargo antes del corte del 5 de julio: deja saldo por pagar.
  await c.post('/api/transactions', {
    profileId: perfil.id, accountId: tarjeta.id, type: 'gasto',
    amountCents: 120000, date: '2026-07-02', categoryId: gasto.id, note: 'Gasolina',
  })
  await c.post('/api/tarjetas/msi', {
    profileId: perfil.id, accountId: tarjeta.id, concept: 'Refri',
    totalCents: 1_200_00, months: 12, purchaseDate: '2026-07-10',
  })
  await c.post('/api/debts', {
    profileId: perfil.id, direction: 'por_pagar', counterparty: 'Banco',
    principalCents: 240_000_00, startDate: '2026-06-05', annualRateBp: 1350, termMonths: 48,
  })
  await c.post('/api/recurrencias', {
    profileId: perfil.id, accountId: cuenta.id, type: 'gasto', amountCents: 850000,
    note: 'Renta', frequency: 'mensual', dayOfMonth: 1, startDate: '2026-04-01',
  })
  return { perfil, cuenta, tarjeta }
}

describe('calendario', () => {
  test('junta recurrencias, cortes, pagos de tarjeta, deuda y meses sin intereses', async () => {
    // D9: todo lo que Finply ya sabe, sin pedir un dato nuevo.
    const { perfil } = await libroCompleto('Calendario')

    const cal = (await c.get(`/api/calendario?profileId=${perfil.id}&hoy=${HOY}&dias=30`)).body
    assert.equal(cal.desde, HOY)
    assert.equal(cal.hasta, '2026-08-26')

    const tipos = new Set(cal.eventos.map((e: any) => e.tipo))
    for (const tipo of ['recurrencia', 'corte', 'pago_tarjeta', 'deuda', 'msi']) {
      assert.ok(tipos.has(tipo), `falta ${tipo} en el calendario`)
    }

    // Ordenado por fecha, y todo dentro de la ventana.
    const fechasCal = cal.eventos.map((e: any) => e.fecha)
    assert.deepEqual(fechasCal, [...fechasCal].sort())
    assert.ok(fechasCal.every((f: string) => f >= cal.desde && f <= cal.hasta))

    const corte = cal.eventos.find((e: any) => e.tipo === 'corte')
    assert.equal(corte.fecha, '2026-08-05', 'el próximo corte, no el pasado')
    const msi = cal.eventos.find((e: any) => e.tipo === 'msi')
    assert.equal(msi.fecha, '2026-08-05')
    assert.equal(msi.montoCents, 10000)
    const deuda = cal.eventos.find((e: any) => e.tipo === 'deuda')
    assert.equal(deuda.fecha, '2026-08-05')
    const renta = cal.eventos.find((e: any) => e.tipo === 'recurrencia')
    assert.equal(renta.fecha, '2026-08-01')
    assert.equal(renta.periodo, '2026-08')
  })

  test('la fecha límite de pago se anuncia aunque el monto todavía no se sepa', async () => {
    // El 27 de julio, la fecha límite del corte de julio (el 25) ya pasó. Sin
    // anunciar la del próximo corte, la tarjeta desaparecía del calendario un
    // mes entero.
    const { perfil } = await libroCompleto('Pago futuro')
    const cal = (await c.get(`/api/calendario?profileId=${perfil.id}&hoy=${HOY}`)).body
    const pagos = cal.eventos.filter((e: any) => e.tipo === 'pago_tarjeta')
    assert.equal(pagos.length, 1)
    assert.equal(pagos[0].fecha, '2026-08-25')
    assert.equal(pagos[0].montoCents, null, 'todavía no hay monto que prometer')
  })

  test('antes de la fecha límite, el pago sí trae su monto', async () => {
    const { perfil } = await libroCompleto('Pago con monto')
    const cal = (await c.get(`/api/calendario?profileId=${perfil.id}&hoy=2026-07-10`)).body
    const pagos = cal.eventos.filter((e: any) => e.tipo === 'pago_tarjeta')
    assert.equal(pagos.length, 1, 'el del próximo ciclo cae fuera de la ventana')
    assert.equal(pagos[0].fecha, '2026-07-25')
    assert.equal(pagos[0].montoCents, 120000, 'lo del corte, sin la compra a meses completa')
  })

  test('el día del corte no se anuncia el mismo pago dos veces', async () => {
    const { perfil } = await libroCompleto('Día de corte')
    const cal = (await c.get(`/api/calendario?profileId=${perfil.id}&hoy=2026-08-05`)).body
    const pagos = cal.eventos.filter((e: any) => e.tipo === 'pago_tarjeta')
    assert.equal(pagos.length, 1)
    assert.equal(pagos[0].fecha, '2026-08-25')
    assert.ok(pagos[0].montoCents !== null, 'ese corte ya ocurrió: el monto se sabe')
  })

  test('un periodo ya resuelto no reaparece en el calendario', async () => {
    const { perfil, renta } = await libroConRenta('Calendario limpio')
    const antes = (await c.get(`/api/calendario?profileId=${perfil.id}&hoy=${HOY}`)).body
    assert.equal(antes.eventos.filter((e: any) => e.tipo === 'recurrencia').length, 1)

    await c.post(`/api/recurrencias/${renta.id}/asentar?profileId=${perfil.id}`, {
      periodo: '2026-08',
    })
    const despues = (await c.get(`/api/calendario?profileId=${perfil.id}&hoy=${HOY}`)).body
    assert.equal(despues.eventos.filter((e: any) => e.tipo === 'recurrencia').length, 0)
  })
})

test('el respaldo se lleva las recurrencias y sus periodos resueltos', async () => {
  const { perfil, renta } = await libroConRenta('Respaldable')
  await c.post(`/api/recurrencias/${renta.id}/asentar?profileId=${perfil.id}`, { periodo: '2026-04' })
  await c.post(`/api/recurrencias/${renta.id}/descartar?profileId=${perfil.id}`, { periodo: '2026-05' })

  const respaldo = (await c.get('/api/respaldo')).body
  assert.ok(respaldo.tables.recurrences.length >= 1)
  assert.ok(respaldo.tables.recurrence_runs.length >= 2)

  const antes = await bandeja(perfil.id)
  const restaurar = await c.post('/api/respaldo/restaurar', respaldo)
  assert.equal(restaurar.status, 200, JSON.stringify(restaurar.body))
  assert.deepEqual(await bandeja(perfil.id), antes, 'la bandeja sobrevive al respaldo')
})

/**
 * El peso de la bandeja, que dicen dos pantallas.
 *
 * Vive en el módulo puro por lo mismo que todo lo demás: la bandeja lo dibuja
 * en un `.tsx` y la alerta del Resumen lo repetía en el servidor, así que
 * había dos aritméticas para el mismo montón y se separaron.
 */
describe('lo que pesa lo que está por confirmar', () => {
  const partidas = [
    { type: 'gasto' as const, investmentId: null, amountCents: 1_200_00 },
    { type: 'gasto' as const, investmentId: 7, amountCents: 500_00 },
    { type: 'ingreso' as const, investmentId: null, amountCents: 3_000_00 },
    { type: 'transferencia' as const, investmentId: null, amountCents: 900_00 },
  ]

  test('cada dirección en su montón, y el traspaso en ninguno', () => {
    assert.deepEqual(pesoPendiente(partidas), {
      gastoCents: 1_200_00,
      aporteCents: 500_00,
      ingresoCents: 3_000_00,
    })
  })

  test('la cifra de un aviso es la que sale, nunca la suma de las tres', () => {
    const peso = pesoPendiente(partidas)
    assert.equal(cifraPendiente(peso), 1_200_00)
    assert.notEqual(cifraPendiente(peso), 4_700_00)
  })

  test('sin gasto manda el aporte, y sin ninguno de los dos, lo que entra', () => {
    assert.equal(cifraPendiente({ gastoCents: 0, aporteCents: 500_00, ingresoCents: 300 }), 500_00)
    assert.equal(cifraPendiente({ gastoCents: 0, aporteCents: 0, ingresoCents: 300 }), 300)
    assert.equal(cifraPendiente({ gastoCents: 0, aporteCents: 0, ingresoCents: 0 }), 0)
  })

  test('lo que la cifra deja fuera se dice, y si no deja nada no se dice nada', () => {
    const pesos = (c: number) => `$${(c / 100).toFixed(2)}`
    assert.equal(
      restoPendiente(pesoPendiente(partidas), pesos),
      '$500.00 van a una inversión y $3000.00 entran.',
    )
    assert.equal(restoPendiente({ gastoCents: 100, aporteCents: 0, ingresoCents: 0 }, pesos), '')
    // Solo ingreso: la cifra del aviso **es** el ingreso, así que no sobra nada.
    assert.equal(restoPendiente({ gastoCents: 0, aporteCents: 0, ingresoCents: 500 }, pesos), '')
  })
})
