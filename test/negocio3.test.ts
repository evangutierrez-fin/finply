// Fase 19 · Más secciones de negocio.
//
// El ciclo empezaba a media calle. Finply sabía de la factura —que ya es un
// cobro— y no de lo que la precede. Lo que se prueba aquí no son las cifras de
// una cotización, que son una suma, sino las tres reglas que la hacen honesta:
//
//   · **una cotización no mueve el libro** — ni al crearla, ni al aceptarla, ni
//     al convertirla: la factura tampoco asienta hasta que se cobra (D14), así
//     que el patrimonio y el ingreso del mes tienen que quedar donde estaban;
//   · **'vencida' no se guarda** — se deriva de la vigencia contra hoy, y por
//     eso la misma cotización es vencida o no según la fecha con la que se
//     pregunte, sin que nadie haya escrito nada;
//   · **convertir es una sola transacción** — una factura creada sin quedar
//     ligada dejaría a la cotización esperando para siempre una respuesta que
//     ya llegó, y el usuario la convertiría dos veces.
//
// Y del corte de caja, la que le faltaba: que asentar la diferencia **cuadre el
// corte**, porque hasta ayer un corte podía decir "faltan $340" y el libro se
// quedaba mal para siempre.
//
// `shared/*` se importa estáticamente: son puros y no tocan la base (R16).

import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { sumarDias } from '../shared/fechas.ts'
import { levantar, libroBase, type Cliente } from './ayuda.ts'
import type {
  Alerta,
  Contraparte,
  CorteConciliacion,
  Cotizacion,
  Factura,
  ResumenCotizaciones,
  Summary,
  TableroContraparte,
} from '../shared/types.ts'

let c: Cliente
before(async () => {
  c = await levantar()
})
after(() => c.cerrar())

const HOY = '2026-07-15'

async function libroNegocio(nombre: string) {
  const base = await libroBase(c, nombre, 'negocio')
  const cliente: Contraparte = (
    await c.post('/api/contrapartes', {
      profileId: base.perfil.id,
      name: 'Constructora Poniente',
      role: 'cliente',
    })
  ).body
  return { ...base, cliente }
}

const cotizar = (
  perfil: number,
  cliente: number,
  datos: Record<string, unknown> = {},
): Promise<{ status: number; body: Cotizacion }> =>
  c.post('/api/cotizaciones', {
    profileId: perfil,
    counterpartyId: cliente,
    direction: 'emitida',
    folio: 'COT-1',
    concept: 'Obra chica',
    issueDate: '2026-07-01',
    validUntil: '2026-07-20',
    subtotalCents: 500000,
    taxCents: 80000,
    ...datos,
  })

const listar = (perfil: number, q = '') =>
  c.get<Cotizacion[]>(`/api/cotizaciones?profileId=${perfil}&hoy=${HOY}${q}`).then((r) => r.body)

describe('cotizaciones · el documento que va antes de la factura', () => {
  test('crear una no mueve un peso del libro', async () => {
    const { perfil, cliente } = await libroNegocio('Sin mover')
    const antes: Summary = (await c.get(`/api/summary?profileId=${perfil.id}&month=2026-07`)).body

    const r = await cotizar(perfil.id, cliente.id)
    assert.equal(r.status, 201)
    assert.equal(r.body.totalCents, 580000, 'subtotal más impuesto')
    assert.equal(r.body.status, 'enviada')
    assert.equal(r.body.invoiceId, null)

    const despues: Summary = (await c.get(`/api/summary?profileId=${perfil.id}&month=2026-07`)).body
    assert.equal(despues.incomeCents, antes.incomeCents, 'prometer un precio no es ingreso')
    assert.equal(despues.totalCents, antes.totalCents, 'ni movió una cuenta')
  })

  test('vencida se deriva de la fecha con la que preguntas, no de una columna', async () => {
    const { perfil, cliente } = await libroNegocio('Derivada')
    await cotizar(perfil.id, cliente.id, { validUntil: '2026-07-10' })

    const antes = (await c.get<Cotizacion[]>(
      `/api/cotizaciones?profileId=${perfil.id}&hoy=2026-07-05`,
    )).body
    assert.equal(antes[0]!.vencida, false)
    assert.equal(antes[0]!.status, 'enviada', 'el estado guardado no cambió')

    const despues = (await c.get<Cotizacion[]>(
      `/api/cotizaciones?profileId=${perfil.id}&hoy=2026-07-11`,
    )).body
    assert.equal(despues[0]!.vencida, true, 'la misma fila, otra fecha')
    assert.equal(despues[0]!.status, 'enviada', 'y sigue sin escribirse nada')
  })

  test('una aceptada no se pinta de vencida aunque su vigencia haya pasado', async () => {
    // Ya tiene respuesta: su fecha dejó de importar, y marcarla sería ruido.
    const { perfil, cliente } = await libroNegocio('Ya contestada')
    const cot = (await cotizar(perfil.id, cliente.id, { validUntil: '2026-07-01' })).body
    await c.post(`/api/cotizaciones/${cot.id}/facturar?profileId=${perfil.id}`, {
      folio: 'A-1', issueDate: '2026-07-02',
    })
    const lista = await listar(perfil.id)
    assert.equal(lista[0]!.status, 'aceptada')
    assert.equal(lista[0]!.vencida, false)
  })

  test('la vigencia no puede terminar antes de empezar', async () => {
    const { perfil, cliente } = await libroNegocio('Imposible')
    const r = await cotizar(perfil.id, cliente.id, {
      issueDate: '2026-07-10', validUntil: '2026-07-01',
    })
    assert.equal(r.status, 400)
  })

  test('la contraparte tiene que ser del perfil', async () => {
    const uno = await libroNegocio('Uno')
    const otro = await libroNegocio('Otro')
    const r = await cotizar(uno.perfil.id, otro.cliente.id)
    assert.equal(r.status, 400)
  })
})

describe('cotizaciones · convertirla en factura', () => {
  test('la factura hereda lo que ya decía, y la liga queda de las dos', async () => {
    const { perfil, cliente } = await libroNegocio('Convertir')
    const cot = (await cotizar(perfil.id, cliente.id)).body

    const r = await c.post<{ cotizacion: Cotizacion; factura: Factura }>(
      `/api/cotizaciones/${cot.id}/facturar?profileId=${perfil.id}`,
      { folio: 'A-1042', issueDate: '2026-07-12' },
    )
    assert.equal(r.status, 201)
    assert.equal(r.body.factura.subtotalCents, 500000, 'el monto no se vuelve a teclear')
    assert.equal(r.body.factura.taxCents, 80000)
    assert.equal(r.body.factura.concept, 'Obra chica')
    assert.equal(r.body.factura.folio, 'A-1042', 'el folio sí es el de la factura')
    assert.equal(r.body.cotizacion.status, 'aceptada')
    assert.equal(r.body.cotizacion.invoiceId, r.body.factura.id)
    assert.equal(r.body.cotizacion.invoiceFolio, 'A-1042')
  })

  test('convertirla tampoco asienta dinero: eso pasa al cobrar', async () => {
    const { perfil, cliente } = await libroNegocio('Sigue sin mover')
    const cot = (await cotizar(perfil.id, cliente.id)).body
    const antes: Summary = (await c.get(`/api/summary?profileId=${perfil.id}&month=2026-07`)).body

    await c.post(`/api/cotizaciones/${cot.id}/facturar?profileId=${perfil.id}`, {
      folio: 'A-1', issueDate: '2026-07-12',
    })

    const despues: Summary = (await c.get(`/api/summary?profileId=${perfil.id}&month=2026-07`)).body
    assert.equal(despues.incomeCents, antes.incomeCents, 'D14: emitir no es cobrar')
    assert.equal(despues.totalCents, antes.totalCents)
  })

  test('sin fecha de vencimiento manda el crédito pactado con el cliente', async () => {
    const base = await libroBase(c, 'A crédito', 'negocio')
    const cliente: Contraparte = (
      await c.post('/api/contrapartes', {
        profileId: base.perfil.id, name: 'Paga a 30', role: 'cliente', creditDays: 30,
      })
    ).body
    const cot = (await cotizar(base.perfil.id, cliente.id)).body
    const r = await c.post<{ factura: Factura }>(
      `/api/cotizaciones/${cot.id}/facturar?profileId=${base.perfil.id}`,
      { folio: 'A-1', issueDate: '2026-07-12' },
    )
    assert.equal(r.body.factura.dueDate, '2026-08-11', 'treinta días después')
  })

  test('no se convierte dos veces', async () => {
    const { perfil, cliente } = await libroNegocio('Una sola vez')
    const cot = (await cotizar(perfil.id, cliente.id)).body
    const uno = await c.post(`/api/cotizaciones/${cot.id}/facturar?profileId=${perfil.id}`, {
      folio: 'A-1', issueDate: '2026-07-12',
    })
    assert.equal(uno.status, 201)
    const dos = await c.post(`/api/cotizaciones/${cot.id}/facturar?profileId=${perfil.id}`, {
      folio: 'A-2', issueDate: '2026-07-13',
    })
    assert.equal(dos.status, 409)
    const facturas = (await c.get<Factura[]>(`/api/facturas?profileId=${perfil.id}`)).body
    assert.equal(facturas.length, 1, 'y no quedó una factura suelta del intento')
  })

  test('una ya convertida no se edita: manda la factura', async () => {
    const { perfil, cliente } = await libroNegocio('Congelada')
    const cot = (await cotizar(perfil.id, cliente.id)).body
    await c.post(`/api/cotizaciones/${cot.id}/facturar?profileId=${perfil.id}`, {
      folio: 'A-1', issueDate: '2026-07-12',
    })
    const r = await c.patch(`/api/cotizaciones/${cot.id}`, {
      profileId: perfil.id, counterpartyId: cliente.id, direction: 'emitida',
      issueDate: '2026-07-01', subtotalCents: 999999,
    })
    assert.equal(r.status, 409)
  })

  test('una perdida no se factura hasta que se revive', async () => {
    const { perfil, cliente } = await libroNegocio('Perdida')
    const cot = (await cotizar(perfil.id, cliente.id)).body
    await c.patch(`/api/cotizaciones/${cot.id}/estado?profileId=${perfil.id}`, { status: 'perdida' })

    const no = await c.post(`/api/cotizaciones/${cot.id}/facturar?profileId=${perfil.id}`, {
      folio: 'A-1', issueDate: '2026-07-12',
    })
    assert.equal(no.status, 409)

    await c.patch(`/api/cotizaciones/${cot.id}/estado?profileId=${perfil.id}`, { status: 'enviada' })
    const si = await c.post(`/api/cotizaciones/${cot.id}/facturar?profileId=${perfil.id}`, {
      folio: 'A-1', issueDate: '2026-07-12',
    })
    assert.equal(si.status, 201)
  })

  test('borrar la cotización deja viva su factura, y lo dice', async () => {
    // Ese documento ya existe por su cuenta y puede tener cobros encima. Es el
    // mismo trato que el desembolso de una deuda: se pierde la liga, no el hecho.
    const { perfil, cliente } = await libroNegocio('Borrable')
    const cot = (await cotizar(perfil.id, cliente.id)).body
    await c.post(`/api/cotizaciones/${cot.id}/facturar?profileId=${perfil.id}`, {
      folio: 'A-1', issueDate: '2026-07-12',
    })

    const r = await c.del<{ ok: true; facturaViva: boolean }>(
      `/api/cotizaciones/${cot.id}?profileId=${perfil.id}`,
    )
    assert.equal(r.status, 200)
    assert.equal(r.body.facturaViva, true)
    const facturas = (await c.get<Factura[]>(`/api/facturas?profileId=${perfil.id}`)).body
    assert.equal(facturas.length, 1, 'la factura sigue ahí')
  })
})

describe('cotizaciones · lo que hay en la calle', () => {
  test('la tasa de éxito se mide sobre lo contestado, no sobre todo', async () => {
    // Si lo que sigue esperando entrara al denominador, mandar una cotización
    // nueva bajaría tu tasa de éxito — al revés de lo que pasó.
    const { perfil, cliente } = await libroNegocio('Tasa')
    const ganada = (await cotizar(perfil.id, cliente.id, { subtotalCents: 100000, taxCents: 0 })).body
    await c.post(`/api/cotizaciones/${ganada.id}/facturar?profileId=${perfil.id}`, {
      folio: 'A-1', issueDate: '2026-07-05',
    })
    const perdida = (await cotizar(perfil.id, cliente.id, { subtotalCents: 200000, taxCents: 0 })).body
    await c.patch(`/api/cotizaciones/${perdida.id}/estado?profileId=${perfil.id}`, {
      status: 'perdida',
    })

    const uno = (await c.get<{ emitida: ResumenCotizaciones }>(
      `/api/cotizaciones/resumen?profileId=${perfil.id}&hoy=${HOY}`,
    )).body.emitida
    assert.equal(uno.tasaExitoBp, 5000, 'una de dos contestadas')

    // Una tercera, todavía esperando: la tasa no se mueve.
    await cotizar(perfil.id, cliente.id, { subtotalCents: 300000, taxCents: 0 })
    const dos = (await c.get<{ emitida: ResumenCotizaciones }>(
      `/api/cotizaciones/resumen?profileId=${perfil.id}&hoy=${HOY}`,
    )).body.emitida
    assert.equal(dos.tasaExitoBp, 5000, 'mandar una más no te hace peor')
    assert.equal(dos.esperandoCents, 300000)
    assert.equal(dos.esperando, 1)
  })

  test('sin nada contestado la tasa calla, no dice cero', async () => {
    const { perfil, cliente } = await libroNegocio('Sin respuesta')
    await cotizar(perfil.id, cliente.id)
    const r = (await c.get<{ emitida: ResumenCotizaciones }>(
      `/api/cotizaciones/resumen?profileId=${perfil.id}&hoy=${HOY}`,
    )).body.emitida
    assert.equal(r.tasaExitoBp, null, 'un 0 % diría que pierdes todo, y no se sabe')
  })

  test('lo vencido sale del resumen con la fecha que se pregunte', async () => {
    const { perfil, cliente } = await libroNegocio('Vencido')
    await cotizar(perfil.id, cliente.id, { validUntil: '2026-07-10', subtotalCents: 400000, taxCents: 0 })
    const r = (await c.get<{ emitida: ResumenCotizaciones }>(
      `/api/cotizaciones/resumen?profileId=${perfil.id}&hoy=${HOY}`,
    )).body.emitida
    assert.equal(r.vencidoCents, 400000)
    assert.equal(r.vencidas, 1)
    assert.equal(r.esperandoCents, 400000, 'vencida sigue esperando: nadie contestó')
  })

  test('las emitidas y las recibidas no se mezclan', async () => {
    const { perfil, cliente } = await libroNegocio('Dos lados')
    await cotizar(perfil.id, cliente.id, { subtotalCents: 100000, taxCents: 0 })
    await cotizar(perfil.id, cliente.id, {
      direction: 'recibida', subtotalCents: 700000, taxCents: 0,
    })
    const r = (await c.get<{ emitida: ResumenCotizaciones; recibida: ResumenCotizaciones }>(
      `/api/cotizaciones/resumen?profileId=${perfil.id}&hoy=${HOY}`,
    )).body
    assert.equal(r.emitida.esperandoCents, 100000)
    assert.equal(r.recibida.esperandoCents, 700000)
    assert.equal((await listar(perfil.id, '&direction=recibida')).length, 1)
  })
})

describe('cotizaciones · la alerta', () => {
  const alertas = (perfil: number, hoy = HOY) =>
    c.get<Alerta[]>(`/api/alertas?profileId=${perfil}&hoy=${hoy}`).then((r) => r.body)

  test('la que se venció sin respuesta es alta; la que se vence esta semana, media', async () => {
    const { perfil, cliente } = await libroNegocio('Avisos')
    await cotizar(perfil.id, cliente.id, { validUntil: '2026-07-10' })
    await cotizar(perfil.id, cliente.id, { validUntil: sumarDias(HOY, 3) })

    const lista = (await alertas(perfil.id)).filter((a) => a.tipo === 'cotizacion')
    assert.equal(lista.length, 2)
    assert.equal(lista.filter((a) => a.severidad === 'alta').length, 1)
    assert.equal(lista.filter((a) => a.severidad === 'media').length, 1)
    assert.ok(lista.every((a) => a.vista === 'cotizaciones'))
  })

  test('las órdenes de compra no avisan: esa vigencia es problema del proveedor', async () => {
    const { perfil, cliente } = await libroNegocio('Solo emitidas')
    await cotizar(perfil.id, cliente.id, { direction: 'recibida', validUntil: '2026-07-10' })
    const lista = (await alertas(perfil.id)).filter((a) => a.tipo === 'cotizacion')
    assert.deepEqual(lista, [])
  })

  test('una contestada deja de avisar aunque su fecha pase', async () => {
    const { perfil, cliente } = await libroNegocio('Contestada')
    const cot = (await cotizar(perfil.id, cliente.id, { validUntil: '2026-07-10' })).body
    assert.equal((await alertas(perfil.id)).filter((a) => a.tipo === 'cotizacion').length, 1)
    await c.patch(`/api/cotizaciones/${cot.id}/estado?profileId=${perfil.id}`, { status: 'perdida' })
    assert.equal((await alertas(perfil.id)).filter((a) => a.tipo === 'cotizacion').length, 0)
  })

  test('con el módulo Negocio apagado, calla', async () => {
    const { perfil, cliente } = await libroNegocio('Apagado')
    await cotizar(perfil.id, cliente.id, { validUntil: '2026-07-10' })
    await c.patch(`/api/profiles/${perfil.id}`, { modules: [] })
    const lista = (await alertas(perfil.id)).filter((a) => a.tipo === 'cotizacion')
    assert.deepEqual(lista, [], 'R17: apagar oculta, y la cotización sigue en la base')
    const con = await c.patch(`/api/profiles/${perfil.id}`, { modules: ['negocio'] })
    assert.equal(con.status, 200)
    assert.equal((await listar(perfil.id)).length, 1, 'nada se borró')
  })
})

describe('corte de caja · asentar la diferencia', () => {
  /** Un libro con su cajón de efectivo y un movimiento del día. */
  async function conCajon(nombre: string, gastoCents = 0) {
    const { perfil } = await libroBase(c, nombre)
    const caja = (
      await c.post('/api/accounts', {
        profileId: perfil.id, name: 'Caja', type: 'efectivo', openingCents: 200000,
      })
    ).body
    if (gastoCents > 0) {
      await c.post('/api/transactions', {
        profileId: perfil.id, accountId: caja.id, type: 'gasto',
        amountCents: gastoCents, date: '2026-07-15',
      })
    }
    return { perfil, caja }
  }

  const declarar = (perfil: number, cuenta: number, balanceCents: number) =>
    c.post<CorteConciliacion>('/api/conciliacion', {
      profileId: perfil, accountId: cuenta, date: '2026-07-15', balanceCents,
    })

  /** Palomea todo lo de la cuenta: sin eso, la diferencia no es un faltante. */
  async function palomear(perfil: number, cuenta: number) {
    const movs = (await c.get(`/api/transactions?profileId=${perfil}&accountId=${cuenta}`)).body
    if (movs.length === 0) return
    await c.post('/api/transactions/conciliar', {
      profileId: perfil, txIds: movs.map((t: any) => t.id), reconciled: true,
    })
  }

  test('el faltante se asienta como gasto y el corte queda en cero', async () => {
    // Hasta la Fase 19 el corte señalaba el hueco y no había forma de taparlo.
    const { perfil, caja } = await conCajon('Faltante')
    await palomear(perfil.id, caja.id)
    const corte = (await declarar(perfil.id, caja.id, 165000)).body
    assert.equal(corte.diferenciaCents, -35000, 'el libro dice 2000 y el cajón 1650')

    const r = await c.post<{ txId: number; corte: CorteConciliacion }>(
      `/api/conciliacion/${corte.id}/ajustar`,
      { profileId: perfil.id },
    )
    assert.equal(r.status, 201)
    assert.equal(r.body.corte.diferenciaCents, 0, 'y ahora sí cuadra')

    const movs = (await c.get(`/api/transactions?profileId=${perfil.id}&month=2026-07`)).body
    const ajuste = movs.find((t: any) => t.id === r.body.txId)
    assert.equal(ajuste.type, 'gasto')
    assert.equal(ajuste.amountCents, 35000)
    assert.equal(ajuste.date, '2026-07-15', 'con la fecha del corte, no la de hoy')
    assert.ok(ajuste.reconciledAt !== null, 'nace palomeado: si no, volvería a descuadrar')
  })

  test('el sobrante se asienta como ingreso', async () => {
    const { perfil, caja } = await conCajon('Sobrante')
    await palomear(perfil.id, caja.id)
    const corte = (await declarar(perfil.id, caja.id, 212000)).body
    assert.equal(corte.diferenciaCents, 12000)
    const r = await c.post<{ txId: number; corte: CorteConciliacion }>(
      `/api/conciliacion/${corte.id}/ajustar`,
      { profileId: perfil.id, concept: 'Sobró del cambio' },
    )
    assert.equal(r.body.corte.diferenciaCents, 0)
    const movs = (await c.get(`/api/transactions?profileId=${perfil.id}&month=2026-07`)).body
    const ajuste = movs.find((t: any) => t.id === r.body.txId)
    assert.equal(ajuste.type, 'ingreso')
    assert.equal(ajuste.amountCents, 12000)
    assert.equal(ajuste.note, 'Sobró del cambio')
  })

  test('con partidas sin palomear no se asienta: eso no es un faltante', async () => {
    // Probado en el navegador sobre el libro demo: con 53 partidas sin marcar,
    // la "diferencia" era el saldo entero y el ajuste habría metido $83,045 de
    // ingreso inventado. La regla vive en el servidor, no en el botón.
    const { perfil, caja } = await conCajon('Sin palomear', 30000)
    const corte = (await declarar(perfil.id, caja.id, 165000)).body
    assert.ok(corte.pendientes > 0)
    const r = await c.post<{ error: string }>(`/api/conciliacion/${corte.id}/ajustar`, {
      profileId: perfil.id,
    })
    assert.equal(r.status, 409)
    assert.match(r.body.error, /palomear/)
  })

  test('un corte que ya cuadra no se ajusta: no hay nada que asentar', async () => {
    const { perfil, caja } = await conCajon('Cuadrado')
    const corte = (await declarar(perfil.id, caja.id, 200000)).body
    assert.equal(corte.diferenciaCents, 0)
    const r = await c.post(`/api/conciliacion/${corte.id}/ajustar`, { profileId: perfil.id })
    assert.equal(r.status, 409)
  })

  test('el monto es el que Finply calculó, no uno que se mande', async () => {
    // Aceptar otro convertiría el ajuste en una partida inventada con nombre
    // de ajuste. El validador ni siquiera tiene ese campo.
    const { perfil, caja } = await conCajon('Sin trampa')
    await palomear(perfil.id, caja.id)
    const corte = (await declarar(perfil.id, caja.id, 190000)).body
    const r = await c.post<{ txId: number }>(`/api/conciliacion/${corte.id}/ajustar`, {
      profileId: perfil.id, amountCents: 999999,
    })
    const movs = (await c.get(`/api/transactions?profileId=${perfil.id}&month=2026-07`)).body
    const ajuste = movs.find((t: any) => t.id === r.body.txId)
    assert.equal(ajuste.amountCents, 10000, 'la diferencia real, no la que se mandó')
  })

  test('el corte de otro perfil no se toca', async () => {
    const uno = await conCajon('Mío')
    const otro = await conCajon('Ajeno')
    const corte = (await declarar(uno.perfil.id, uno.caja.id, 190000)).body
    const r = await c.post(`/api/conciliacion/${corte.id}/ajustar`, { profileId: otro.perfil.id })
    assert.equal(r.status, 404)
  })
})

describe('el tablero de una contraparte', () => {
  test('junta lo que vivía en cuatro vistas, y cuadra con cada una', async () => {
    const { perfil, cuenta, cliente } = await libroNegocio('Tablero')
    // Facturada y cobrada completa en 20 días.
    const uno = (await c.post<Factura>('/api/facturas', {
      profileId: perfil.id, counterpartyId: cliente.id, direction: 'emitida',
      folio: 'A-1', issueDate: '2026-06-01', dueDate: '2026-06-30',
      subtotalCents: 300000, taxCents: 0,
    })).body
    await c.post(`/api/facturas/${uno.id}/cobros`, {
      accountId: cuenta.id, amountCents: 300000, date: '2026-06-21',
    })
    // Facturada, vencida y sin cobrar.
    await c.post('/api/facturas', {
      profileId: perfil.id, counterpartyId: cliente.id, direction: 'emitida',
      folio: 'A-2', issueDate: '2026-06-15', dueDate: '2026-07-01',
      subtotalCents: 200000, taxCents: 0,
    })
    // Y una cotización esperando.
    await cotizar(perfil.id, cliente.id, { subtotalCents: 450000, taxCents: 0 })

    const t = (await c.get<TableroContraparte>(
      `/api/contrapartes/${cliente.id}/tablero?profileId=${perfil.id}&hoy=${HOY}`,
    )).body
    assert.equal(t.facturadoCents, 500000, 'lo cobrable de las dos')
    assert.equal(t.saldoCents, 200000, 'lo que falta')
    assert.equal(t.vencidoCents, 200000, 'y ya se pasó')
    assert.equal(t.facturas, 2)
    assert.equal(t.facturasVencidas, 1)
    assert.equal(t.cobradoCents, 300000)
    assert.equal(t.esperandoCents, 450000, 'lo cotizado sin respuesta')
    assert.equal(t.diasDePagoPromedio, 20, 'del 1 al 21 de junio')

    // Y cuadra con la vista de contrapartes, que mide lo mismo por otro lado.
    const cs = (await c.get<Contraparte[]>(`/api/contrapartes?profileId=${perfil.id}`)).body
    const suyo = cs.find((x) => x.id === cliente.id)!
    assert.equal(suyo.porCobrarCents, t.saldoCents)
  })

  test('sin una sola factura saldada no se inventa un plazo de pago', async () => {
    const { perfil, cliente } = await libroNegocio('Sin historial')
    await c.post('/api/facturas', {
      profileId: perfil.id, counterpartyId: cliente.id, direction: 'emitida',
      folio: 'A-1', issueDate: '2026-07-01', subtotalCents: 100000, taxCents: 0,
    })
    const t = (await c.get<TableroContraparte>(
      `/api/contrapartes/${cliente.id}/tablero?profileId=${perfil.id}&hoy=${HOY}`,
    )).body
    assert.equal(t.diasDePagoPromedio, null)
    assert.equal(t.tasaExitoBp, null)
  })

  test('el plazo se cuenta hasta el último cobro, no hasta el primero', async () => {
    // Pagar el 10 % a tiempo y el resto tres meses después no es pagar a tiempo.
    const { perfil, cuenta, cliente } = await libroNegocio('Pago en dos')
    const f = (await c.post<Factura>('/api/facturas', {
      profileId: perfil.id, counterpartyId: cliente.id, direction: 'emitida',
      folio: 'A-1', issueDate: '2026-04-01', subtotalCents: 100000, taxCents: 0,
    })).body
    await c.post(`/api/facturas/${f.id}/cobros`, {
      accountId: cuenta.id, amountCents: 10000, date: '2026-04-06',
    })
    await c.post(`/api/facturas/${f.id}/cobros`, {
      accountId: cuenta.id, amountCents: 90000, date: '2026-07-01',
    })
    const t = (await c.get<TableroContraparte>(
      `/api/contrapartes/${cliente.id}/tablero?profileId=${perfil.id}&hoy=${HOY}`,
    )).body
    assert.equal(t.diasDePagoPromedio, 91, 'del 1 de abril al 1 de julio')
  })

  test('la contraparte de otro perfil no se lee', async () => {
    const uno = await libroNegocio('Propio')
    const otro = await libroNegocio('Ajeno')
    const r = await c.get(
      `/api/contrapartes/${otro.cliente.id}/tablero?profileId=${uno.perfil.id}`,
    )
    assert.equal(r.status, 404)
  })
})

describe('R11 · nada de esto cuesta una consulta por renglón', () => {
  test('el resumen y el tablero: uno y veinte cuestan lo mismo', async () => {
    const { db } = await import('../server/db.ts')
    const original = db.prepare.bind(db)
    let consultas = 0

    async function sembrar(nombre: string, n: number) {
      const { perfil, cliente } = await libroNegocio(nombre)
      for (let i = 0; i < n; i++) {
        await cotizar(perfil.id, cliente.id, {
          folio: `COT-${i}`, subtotalCents: 10000 + i, taxCents: 0,
        })
        await c.post('/api/facturas', {
          profileId: perfil.id, counterpartyId: cliente.id, direction: 'emitida',
          folio: `A-${i}`, issueDate: '2026-06-10', dueDate: '2026-06-30',
          subtotalCents: 20000 + i, taxCents: 0,
        })
      }
      return { perfil, cliente }
    }

    const chico = await sembrar('R11 chico', 1)
    const grande = await sembrar('R11 grande', 20)

    ;(db as any).prepare = (sql: string) => {
      consultas++
      return original(sql)
    }
    try {
      const medir = async (p: number, cliente: number) => {
        consultas = 0
        await c.get(`/api/cotizaciones/resumen?profileId=${p}&hoy=${HOY}`)
        await c.get(`/api/contrapartes/${cliente}/tablero?profileId=${p}&hoy=${HOY}`)
        return consultas
      }
      const nChico = await medir(chico.perfil.id, chico.cliente.id)
      const nGrande = await medir(grande.perfil.id, grande.cliente.id)
      assert.equal(nGrande, nChico, `chico ${nChico}, grande ${nGrande}`)
    } finally {
      ;(db as any).prepare = original
    }
  })
})
