// Fase 14 · Negocio II.
//
// Lo que esta fase cambia de raíz es **qué significa el saldo de una factura**.
// Hasta ayer era el total menos lo cobrado; desde hoy es lo *cobrable* menos lo
// cobrado, y lo cobrable ya descuenta dos cosas que nunca van a llegar a la
// cuenta: lo que te retienen (D21) y lo que cancelaste con una nota de crédito.
// Si esa resta falla, la antigüedad de saldos promete cobrar dinero que no
// existe y las facturas no se saldan jamás.
//
// Lo demás cuelga de ahí: el anticipo no puede crear un peso (D14 otra vez), la
// plantilla no puede emitir sola (R4) ni dos veces (R5), y la rentabilidad por
// cliente no puede repartir a ojo un costo que nadie atribuyó.
//
// `shared/*` se importa estáticamente: son puros y no tocan la base (R16).

import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { sumarDias } from '../shared/fechas.ts'
import { levantar, libroBase, type Cliente } from './ayuda.ts'
import type {
  Anticipo,
  BandejaFacturas,
  Cobranza,
  Contraparte,
  EstadoResultados,
  Factura,
  FacturaRecurrente,
} from '../shared/types.ts'

let c: Cliente
before(async () => {
  c = await levantar()
})
after(() => c.cerrar())

const HOY = '2026-07-31'

/** Un libro de negocio con su cliente listo. */
async function libroNegocio(nombre: string, contraparte: Partial<Contraparte> = {}) {
  const base = await libroBase(c, nombre, 'negocio')
  const cliente: Contraparte = (
    await c.post('/api/contrapartes', {
      profileId: base.perfil.id,
      name: 'Oficinas Mérida',
      role: 'cliente',
      ...contraparte,
    })
  ).body
  return { ...base, cliente }
}

const emitir = (
  perfil: number,
  cliente: number,
  datos: Record<string, unknown> = {},
): Promise<{ status: number; body: Factura }> =>
  c.post('/api/facturas', {
    profileId: perfil,
    counterpartyId: cliente,
    direction: 'emitida',
    issueDate: '2026-07-01',
    dueDate: '2026-07-15',
    subtotalCents: 1_000_000,
    taxCents: 160_000,
    ...datos,
  })

const cobrar = (facturaId: number, cuenta: number, amountCents: number, date = '2026-07-20') =>
  c.post(`/api/facturas/${facturaId}/cobros`, { accountId: cuenta, amountCents, date })

const facturaDe = (id: number, perfil: number): Promise<Factura> =>
  c.get(`/api/facturas?profileId=${perfil}`).then((r) => r.body.find((f: Factura) => f.id === id))

describe('retenciones · lo cobrable no es el total', () => {
  test('el saldo se mide contra lo que de verdad va a llegar', async () => {
    const { perfil, cliente } = await libroNegocio('Retención')
    // $10,000 + $1,600 de impuesto. Retienen $1,066.67 y $1,000.
    const f = (
      await emitir(perfil.id, cliente.id, { withheldTaxCents: 106_667, withheldIncomeCents: 100_000 })
    ).body

    assert.equal(f.totalCents, 1_160_000, 'el documento dice lo que dice')
    assert.equal(f.retenidoCents, 206_667)
    assert.equal(f.cobrableCents, 953_333, 'y esto es lo único que va a llegar')
    assert.equal(f.saldoCents, 953_333, 'el saldo se mide contra lo cobrable, no contra el total')
  })

  test('cobrar lo cobrable la salda, aunque no se haya cobrado el total', async () => {
    // Este es el caso que sin la fase quedaba abierto para siempre: la factura
    // se pagó completa y Finply seguía diciendo que faltaban $206,667.
    const { perfil, cuenta, cliente } = await libroNegocio('Saldada con retención')
    const f = (
      await emitir(perfil.id, cliente.id, { withheldTaxCents: 106_667, withheldIncomeCents: 100_000 })
    ).body

    const r = await cobrar(f.id, cuenta.id, f.cobrableCents)
    assert.equal(r.status, 201)
    assert.equal(r.body.saldoCents, 0)
    assert.equal(r.body.cobrada, true)
    assert.equal(r.body.pagadoCents, 953_333)
  })

  test('el impuesto de los cobros suma exactamente el de la factura', async () => {
    // La proporción se mide contra lo cobrable; el último cobro ajusta el
    // redondeo. El IVA causado es el de la factura entera aunque parte se haya
    // retenido: lo entera el cliente en tu nombre.
    const { perfil, cuenta, cliente } = await libroNegocio('IVA con retención')
    const f = (
      await emitir(perfil.id, cliente.id, { withheldTaxCents: 106_667, withheldIncomeCents: 100_000 })
    ).body

    await cobrar(f.id, cuenta.id, 300_000, '2026-07-10')
    await cobrar(f.id, cuenta.id, 300_000, '2026-07-20')
    await cobrar(f.id, cuenta.id, 353_333, '2026-07-30')

    const movs = (await c.get(`/api/transactions?profileId=${perfil.id}&limit=50`)).body
    const ligados = movs.filter((t: any) => t.invoiceId === f.id)
    assert.equal(ligados.length, 3)
    assert.equal(
      ligados.reduce((s: number, t: any) => s + t.taxCents, 0),
      160_000,
      'ni un centavo de más ni de menos',
    )
  })

  test('la antigüedad de saldos cuenta lo cobrable', async () => {
    const { perfil, cliente } = await libroNegocio('Aging con retención')
    await emitir(perfil.id, cliente.id, { withheldTaxCents: 106_667, withheldIncomeCents: 100_000 })
    const aging = (await c.get(`/api/facturas/aging?profileId=${perfil.id}&hoy=${HOY}`)).body
    assert.equal(aging.porCobrarCents, 953_333)
  })

  test('retener más que la factura entera se rechaza', async () => {
    const { perfil, cliente } = await libroNegocio('Retención imposible')
    const r = await emitir(perfil.id, cliente.id, { withheldTaxCents: 1_200_000 })
    assert.equal(r.status, 400)
    assert.match((r.body as any).error, /retenido/)
  })
})

describe('notas de crédito · cancelar sin borrar y sin mover dinero', () => {
  test('bajan lo cobrable y no asientan nada', async () => {
    const { perfil, cliente } = await libroNegocio('Nota de crédito')
    const f = (await emitir(perfil.id, cliente.id)).body
    const antes = (await c.get(`/api/transactions?profileId=${perfil.id}&limit=50`)).body.length

    const r = await c.post(`/api/facturas/${f.id}/notas`, {
      date: '2026-07-10',
      folio: 'NC-1',
      concept: 'Se canceló la mitad del pedido',
      amountCents: 580_000,
    })

    assert.equal(r.status, 201)
    assert.equal(r.body.notasCreditoCents, 580_000)
    assert.equal(r.body.cobrableCents, 580_000)
    assert.equal(r.body.saldoCents, 580_000)
    assert.equal(r.body.notasCredito.length, 1)
    assert.equal(r.body.notasCredito[0].folio, 'NC-1')

    const despues = (await c.get(`/api/transactions?profileId=${perfil.id}&limit=50`)).body.length
    assert.equal(despues, antes, 'una nota de crédito no es un movimiento: no se movió un peso')
  })

  test('por todo lo pendiente deja la factura saldada', async () => {
    const { perfil, cliente } = await libroNegocio('Cancelación total')
    const f = (await emitir(perfil.id, cliente.id)).body
    const r = await c.post(`/api/facturas/${f.id}/notas`, { date: '2026-07-10', amountCents: f.totalCents })
    assert.equal(r.body.saldoCents, 0)
    assert.equal(r.body.cobrada, true)
    // Y el documento sigue existiendo con su total: cancelar no es borrar.
    assert.equal(r.body.totalCents, 1_160_000)
  })

  test('no se puede cancelar lo que ya se cobró', async () => {
    const { perfil, cuenta, cliente } = await libroNegocio('Cancelar lo cobrado')
    const f = (await emitir(perfil.id, cliente.id)).body
    await cobrar(f.id, cuenta.id, 900_000)

    const r = await c.post(`/api/facturas/${f.id}/notas`, { date: '2026-07-25', amountCents: 300_000 })
    assert.equal(r.status, 400)
    assert.match((r.body as any).error, /2600\.00/, 'dice cuánto queda de verdad')
  })

  test('quitar la nota vuelve a abrir la factura', async () => {
    const { perfil, cliente } = await libroNegocio('Deshacer nota')
    const f = (await emitir(perfil.id, cliente.id)).body
    const conNota = (
      await c.post(`/api/facturas/${f.id}/notas`, { date: '2026-07-10', amountCents: 1_160_000 })
    ).body
    assert.equal(conNota.saldoCents, 0)

    const r = await c.del(`/api/facturas/${f.id}/notas/${conNota.notasCredito[0].id}`)
    assert.equal(r.body.saldoCents, 1_160_000)
    assert.equal(r.body.notasCredito.length, 0)
  })
})

describe('anticipos · cobrar antes de facturar sin contar dos veces', () => {
  /** Un cobro suelto: contraparte puesta, ninguna factura que lo reclame. */
  const anticipar = (perfil: number, cuenta: number, cliente: number, cents: number, date = '2026-07-05') =>
    c.post('/api/transactions', {
      profileId: perfil,
      accountId: cuenta,
      type: 'ingreso',
      amountCents: cents,
      date,
      counterpartyId: cliente,
      note: 'Anticipo del pedido',
    })

  test('un cobro sin factura de esa contraparte es un anticipo aplicable', async () => {
    const { perfil, cuenta, cliente } = await libroNegocio('Anticipo')
    await anticipar(perfil.id, cuenta.id, cliente.id, 400_000)
    const f = (await emitir(perfil.id, cliente.id)).body

    const lista: Anticipo[] = (await c.get(`/api/facturas/${f.id}/anticipos`)).body
    assert.equal(lista.length, 1)
    assert.equal(lista[0]!.amountCents, 400_000)
    assert.equal(lista[0]!.date, '2026-07-05')
  })

  test('aplicarlo salda la factura sin crear un solo movimiento', async () => {
    // Es la mitad de la Fase 8 otra vez: si al llegar la factura se registrara
    // el cobro, el mismo peso entraría dos veces al mes.
    const { perfil, cuenta, cliente } = await libroNegocio('Aplicar anticipo')
    const anticipo = (await anticipar(perfil.id, cuenta.id, cliente.id, 400_000)).body
    const f = (await emitir(perfil.id, cliente.id)).body

    const movsAntes = (await c.get(`/api/transactions?profileId=${perfil.id}&limit=50`)).body
    const r = await c.post(`/api/facturas/${f.id}/anticipos`, { txId: anticipo.id })
    const movsDespues = (await c.get(`/api/transactions?profileId=${perfil.id}&limit=50`)).body

    assert.equal(r.status, 200)
    assert.equal(r.body.pagadoCents, 400_000)
    assert.equal(r.body.saldoCents, 760_000)
    assert.equal(movsDespues.length, movsAntes.length, 'ni un movimiento nuevo')
    // Y sigue siendo ingreso del día que se cobró, no del día que se facturó.
    const ligado = movsDespues.find((t: any) => t.id === anticipo.id)
    assert.equal(ligado.date, '2026-07-05')
    assert.equal(ligado.invoiceId, f.id)
  })

  test('ya aplicado, deja de ofrecerse a la siguiente factura', async () => {
    const { perfil, cuenta, cliente } = await libroNegocio('Anticipo usado')
    const anticipo = (await anticipar(perfil.id, cuenta.id, cliente.id, 400_000)).body
    const primera = (await emitir(perfil.id, cliente.id)).body
    await c.post(`/api/facturas/${primera.id}/anticipos`, { txId: anticipo.id })

    const segunda = (await emitir(perfil.id, cliente.id, { folio: 'A-2' })).body
    const lista: Anticipo[] = (await c.get(`/api/facturas/${segunda.id}/anticipos`)).body
    assert.equal(lista.length, 0)
  })

  test('un anticipo mayor que lo que falta se rechaza con las dos cifras', async () => {
    // Partirlo sería partir un movimiento del pasado, es decir reescribir el
    // libro. Se dice el problema y se deja decidir al usuario.
    const { perfil, cuenta, cliente } = await libroNegocio('Anticipo grande')
    const anticipo = (await anticipar(perfil.id, cuenta.id, cliente.id, 2_000_000)).body
    const f = (await emitir(perfil.id, cliente.id)).body

    const r = await c.post(`/api/facturas/${f.id}/anticipos`, { txId: anticipo.id })
    assert.equal(r.status, 400)
    assert.match((r.body as any).error, /20000\.00/)
    assert.match((r.body as any).error, /11600\.00/)
  })

  test('un movimiento de otra contraparte no es aplicable aquí', async () => {
    const { perfil, cuenta, cliente } = await libroNegocio('Anticipo ajeno')
    const otro = (
      await c.post('/api/contrapartes', { profileId: perfil.id, name: 'Café del Puerto' })
    ).body
    const anticipo = (await anticipar(perfil.id, cuenta.id, otro.id, 100_000)).body
    const f = (await emitir(perfil.id, cliente.id)).body

    const r = await c.post(`/api/facturas/${f.id}/anticipos`, { txId: anticipo.id })
    assert.equal(r.status, 400)
    assert.match((r.body as any).error, /otra contraparte/)
  })
})

describe('facturas recurrentes · el motor de la Fase 5 sin asentar un peso', () => {
  const plantilla = (perfil: number, cliente: number, datos: Record<string, unknown> = {}) =>
    c.post('/api/facturas/recurrentes', {
      profileId: perfil,
      counterpartyId: cliente,
      direction: 'emitida',
      concept: 'Iguala mensual',
      subtotalCents: 800_000,
      taxCents: 128_000,
      creditDays: 30,
      frequency: 'mensual',
      dayOfMonth: 1,
      startDate: '2026-05-01',
      ...datos,
    })

  test('la bandeja propone los periodos vencidos y no guarda nada', async () => {
    const { perfil, cliente } = await libroNegocio('Plantilla')
    await plantilla(perfil.id, cliente.id)

    const bandeja: BandejaFacturas = (
      await c.get(`/api/facturas/recurrentes/pendientes?profileId=${perfil.id}&hoy=${HOY}`)
    ).body
    assert.equal(bandeja.total, 3, 'mayo, junio y julio')
    assert.equal(bandeja.items[0]!.periodo, '2026-05')
    assert.equal(bandeja.items[0]!.totalCents, 928_000)
    assert.equal(bandeja.items[0]!.dueDate, '2026-05-31', 'a 30 días de la emisión')

    // Nada de esto existe todavía: la bandeja se deriva (D7).
    const facturas = (await c.get(`/api/facturas?profileId=${perfil.id}`)).body
    assert.equal(facturas.length, 0)
  })

  test('emitir crea el documento y no mueve el libro', async () => {
    const { perfil, cliente } = await libroNegocio('Emitir')
    const p: FacturaRecurrente = (await plantilla(perfil.id, cliente.id)).body

    const r = await c.post(`/api/facturas/recurrentes/${p.id}/emitir?profileId=${perfil.id}`, {
      periodo: '2026-06',
    })
    assert.equal(r.status, 201)
    assert.equal(r.body.issueDate, '2026-06-01')
    assert.equal(r.body.dueDate, '2026-07-01')
    assert.equal(r.body.totalCents, 928_000)
    assert.equal(r.body.saldoCents, 928_000, 'nace debiéndose entera')

    const movs = (await c.get(`/api/transactions?profileId=${perfil.id}&limit=50`)).body
    assert.equal(movs.length, 0, 'emitir no asienta: el ingreso nace al cobrar (D14)')

    // Y ese periodo sale de la bandeja.
    const bandeja: BandejaFacturas = (
      await c.get(`/api/facturas/recurrentes/pendientes?profileId=${perfil.id}&hoy=${HOY}`)
    ).body
    assert.equal(bandeja.items.some((i) => i.periodo === '2026-06'), false)
  })

  test('la plantilla arrastra sus retenciones a cada factura', async () => {
    const { perfil, cliente } = await libroNegocio('Plantilla con retención')
    const p: FacturaRecurrente = (
      await plantilla(perfil.id, cliente.id, { withheldTaxCents: 85_333, withheldIncomeCents: 17_333 })
    ).body
    const f = (
      await c.post(`/api/facturas/recurrentes/${p.id}/emitir?profileId=${perfil.id}`, { periodo: '2026-06' })
    ).body
    assert.equal(f.retenidoCents, 102_666)
    assert.equal(f.cobrableCents, 928_000 - 102_666)
  })

  test('el mismo periodo dos veces choca contra el UNIQUE, no contra un if', async () => {
    const { perfil, cliente } = await libroNegocio('Doble emisión')
    const p: FacturaRecurrente = (await plantilla(perfil.id, cliente.id)).body
    const ruta = `/api/facturas/recurrentes/${p.id}/emitir?profileId=${perfil.id}`

    assert.equal((await c.post(ruta, { periodo: '2026-06' })).status, 201)
    const segunda = await c.post(ruta, { periodo: '2026-06' })
    assert.equal(segunda.status, 409)

    const facturas = (await c.get(`/api/facturas?profileId=${perfil.id}`)).body
    assert.equal(facturas.length, 1)
  })

  test('descartar saca el periodo sin emitir nada, y reabrir lo devuelve', async () => {
    const { perfil, cliente } = await libroNegocio('Descartar')
    const p: FacturaRecurrente = (await plantilla(perfil.id, cliente.id)).body

    await c.post(`/api/facturas/recurrentes/${p.id}/descartar?profileId=${perfil.id}`, { periodo: '2026-05' })
    let bandeja: BandejaFacturas = (
      await c.get(`/api/facturas/recurrentes/pendientes?profileId=${perfil.id}&hoy=${HOY}`)
    ).body
    assert.equal(bandeja.total, 2)
    assert.equal((await c.get(`/api/facturas?profileId=${perfil.id}`)).body.length, 0)

    await c.post(`/api/facturas/recurrentes/${p.id}/reabrir?profileId=${perfil.id}`, { periodo: '2026-05' })
    bandeja = (await c.get(`/api/facturas/recurrentes/pendientes?profileId=${perfil.id}&hoy=${HOY}`)).body
    assert.equal(bandeja.total, 3)
  })

  test('un periodo ya emitido no se reabre: hay un documento de por medio', async () => {
    const { perfil, cliente } = await libroNegocio('Reabrir emitida')
    const p: FacturaRecurrente = (await plantilla(perfil.id, cliente.id)).body
    await c.post(`/api/facturas/recurrentes/${p.id}/emitir?profileId=${perfil.id}`, { periodo: '2026-06' })

    const r = await c.post(`/api/facturas/recurrentes/${p.id}/reabrir?profileId=${perfil.id}`, {
      periodo: '2026-06',
    })
    assert.equal(r.status, 409)
    assert.match((r.body as any).error, /bórrala/)
  })

  test('subir la iguala no reescribe lo ya emitido, pero sí lo pendiente', async () => {
    const { perfil, cliente } = await libroNegocio('Subir iguala')
    const p: FacturaRecurrente = (await plantilla(perfil.id, cliente.id)).body
    const vieja = (
      await c.post(`/api/facturas/recurrentes/${p.id}/emitir?profileId=${perfil.id}`, { periodo: '2026-05' })
    ).body

    await c.patch(`/api/facturas/recurrentes/${p.id}`, {
      profileId: perfil.id,
      counterpartyId: cliente.id,
      direction: 'emitida',
      concept: 'Iguala mensual',
      subtotalCents: 900_000,
      taxCents: 144_000,
      creditDays: 30,
      frequency: 'mensual',
      dayOfMonth: 1,
      startDate: '2026-05-01',
    })

    assert.equal((await facturaDe(vieja.id, perfil.id)).totalCents, 928_000, 'lo emitido es historia')
    const bandeja: BandejaFacturas = (
      await c.get(`/api/facturas/recurrentes/pendientes?profileId=${perfil.id}&hoy=${HOY}`)
    ).body
    assert.equal(bandeja.items[0]!.totalCents, 1_044_000, 'lo pendiente se deriva del monto de hoy')
  })

  test('borrar la plantilla deja las facturas que ya salieron', async () => {
    const { perfil, cliente } = await libroNegocio('Borrar plantilla')
    const p: FacturaRecurrente = (await plantilla(perfil.id, cliente.id)).body
    await c.post(`/api/facturas/recurrentes/${p.id}/emitir?profileId=${perfil.id}`, { periodo: '2026-05' })

    const r = await c.del(`/api/facturas/recurrentes/${p.id}?profileId=${perfil.id}`)
    assert.equal(r.body.emitidas, 1)
    assert.equal((await c.get(`/api/facturas?profileId=${perfil.id}`)).body.length, 1)
    assert.equal((await c.get(`/api/facturas/recurrentes?profileId=${perfil.id}`)).body.length, 0)
  })
})

describe('la contraparte que ya sabe cómo te paga', () => {
  test('los días de crédito y el límite se guardan, y el aviso se deriva', async () => {
    const { perfil, cliente } = await libroNegocio('Crédito', {
      creditDays: 30,
      creditLimitCents: 1_000_000,
      contact: 'compras@merida.mx',
    } as any)
    assert.equal(cliente.creditDays, 30)
    assert.equal(cliente.contact, 'compras@merida.mx')
    assert.equal(cliente.sobreLimite, false)

    await emitir(perfil.id, cliente.id)
    const lista: Contraparte[] = (await c.get(`/api/contrapartes?profileId=${perfil.id}`)).body
    const actualizada = lista.find((x) => x.id === cliente.id)!
    assert.equal(actualizada.porCobrarCents, 1_160_000)
    assert.equal(actualizada.sobreLimite, true, 'le debe más de lo que le fías')

    // Subir el límite apaga el aviso sin recalcular ninguna bandera.
    await c.patch(`/api/contrapartes/${cliente.id}`, { creditLimitCents: 2_000_000 })
    const despues: Contraparte[] = (await c.get(`/api/contrapartes?profileId=${perfil.id}`)).body
    assert.equal(despues.find((x) => x.id === cliente.id)!.sobreLimite, false)
  })

  test('sin límite no hay aviso que dar', async () => {
    const { perfil, cliente } = await libroNegocio('Sin límite')
    await emitir(perfil.id, cliente.id)
    const lista: Contraparte[] = (await c.get(`/api/contrapartes?profileId=${perfil.id}`)).body
    assert.equal(lista.find((x) => x.id === cliente.id)!.sobreLimite, false)
  })

  test('el anticipo suelto se ve desde la contraparte', async () => {
    const { perfil, cuenta, cliente } = await libroNegocio('Anticipos en contraparte')
    await c.post('/api/transactions', {
      profileId: perfil.id,
      accountId: cuenta.id,
      type: 'ingreso',
      amountCents: 250_000,
      date: '2026-07-05',
      counterpartyId: cliente.id,
    })
    const lista: Contraparte[] = (await c.get(`/api/contrapartes?profileId=${perfil.id}`)).body
    assert.equal(lista.find((x) => x.id === cliente.id)!.anticiposCents, 250_000)
  })
})

describe('la lista de cobranza', () => {
  test('ordena por antigüedad y trae el contacto', async () => {
    const { perfil, cliente } = await libroNegocio('Cobranza', { contact: 'compras@merida.mx' } as any)
    const otro = (
      await c.post('/api/contrapartes', { profileId: perfil.id, name: 'Café del Puerto', contact: '999 123 4567' })
    ).body

    // Una vencida hace mucho, una vencida hace poco y una que no vence aún.
    await emitir(perfil.id, cliente.id, { issueDate: '2026-04-01', dueDate: '2026-04-30', subtotalCents: 100_000, taxCents: 0 })
    await emitir(perfil.id, otro.id, { issueDate: '2026-07-01', dueDate: '2026-07-25', subtotalCents: 200_000, taxCents: 0 })
    await emitir(perfil.id, otro.id, { issueDate: '2026-07-28', dueDate: sumarDias(HOY, 3), subtotalCents: 300_000, taxCents: 0 })

    const cob: Cobranza = (await c.get(`/api/facturas/cobranza?profileId=${perfil.id}&hoy=${HOY}`)).body
    assert.equal(cob.renglones.length, 3)
    assert.equal(cob.renglones[0]!.diasVencida, 92, 'lo más viejo primero')
    assert.equal(cob.renglones[0]!.contact, 'compras@merida.mx')
    assert.equal(cob.renglones[1]!.diasVencida, 6)
    assert.equal(cob.renglones[2]!.diasVencida, -3, 'todavía no vence')

    assert.equal(cob.totalCents, 600_000)
    assert.equal(cob.vencidoCents, 300_000)
    assert.equal(cob.porVencerCents, 300_000, 'vence dentro de la semana')
  })

  test('lo retenido y lo cancelado no aparecen como cobrables', async () => {
    const { perfil, cliente } = await libroNegocio('Cobranza limpia')
    const f = (
      await emitir(perfil.id, cliente.id, { withheldTaxCents: 106_667, withheldIncomeCents: 100_000 })
    ).body
    await c.post(`/api/facturas/${f.id}/notas`, { date: '2026-07-05', amountCents: 153_333 })

    const cob: Cobranza = (await c.get(`/api/facturas/cobranza?profileId=${perfil.id}&hoy=${HOY}`)).body
    assert.equal(cob.totalCents, 800_000, '1,160,000 − 206,667 retenido − 153,333 cancelado')
  })

  test('una factura pagada desaparece de la lista sola', async () => {
    const { perfil, cuenta, cliente } = await libroNegocio('Cobranza saldada')
    const f = (await emitir(perfil.id, cliente.id)).body
    await cobrar(f.id, cuenta.id, f.cobrableCents)
    const cob: Cobranza = (await c.get(`/api/facturas/cobranza?profileId=${perfil.id}&hoy=${HOY}`)).body
    assert.equal(cob.renglones.length, 0)
  })
})

describe('rentabilidad y el periodo anterior', () => {
  const resultados = (perfil: number, desde: string, hasta: string): Promise<EstadoResultados> =>
    c.get(`/api/negocio/resultados?profileId=${perfil}&desde=${desde}&hasta=${hasta}`).then((r) => r.body)

  test('el gasto que nadie atribuyó no se reparte entre los clientes', async () => {
    const { perfil, cuenta, cliente, categorias } = await libroNegocio('Rentabilidad')
    const gasto = categorias.find((k: any) => k.kind === 'gasto')
    const proveedor = (
      await c.post('/api/contrapartes', { profileId: perfil.id, name: 'La Espiga', role: 'proveedor' })
    ).body

    const mov = (datos: Record<string, unknown>) =>
      c.post('/api/transactions', { profileId: perfil.id, accountId: cuenta.id, date: '2026-07-10', ...datos })

    await mov({ type: 'ingreso', amountCents: 500_000, counterpartyId: cliente.id })
    await mov({ type: 'gasto', amountCents: 120_000, categoryId: gasto.id, counterpartyId: cliente.id })
    await mov({ type: 'gasto', amountCents: 300_000, categoryId: gasto.id, counterpartyId: proveedor.id })
    await mov({ type: 'gasto', amountCents: 80_000, categoryId: gasto.id })

    const r = await resultados(perfil.id, '2026-07-01', '2026-07-31')
    const porNombre = new Map(r.porCliente.map((x) => [x.name, x]))

    assert.equal(porNombre.get('Oficinas Mérida')!.ingresosCents, 500_000)
    assert.equal(porNombre.get('Oficinas Mérida')!.gastoCents, 120_000)
    assert.equal(porNombre.get('Oficinas Mérida')!.margenCents, 380_000)
    assert.equal(porNombre.get('Oficinas Mérida')!.margenPct, 0.76)

    // El proveedor aparece con su costo y sin ingresos: no se le inventa un
    // porcentaje que no se puede calcular.
    assert.equal(porNombre.get('La Espiga')!.margenCents, -300_000)
    assert.equal(porNombre.get('La Espiga')!.margenPct, null)

    // Y lo que nadie atribuyó queda fuera de la tabla, con su cifra a la vista.
    assert.equal(r.gastoSinContraparteCents, 80_000)
    assert.equal(r.porCliente.some((x) => x.id === null), false)
    assert.equal(
      r.porCliente.reduce((s, x) => s + x.gastoCents, 0) + r.gastoSinContraparteCents,
      500_000,
      'entre lo atribuido y lo que no, sale el gasto entero del periodo',
    )
  })

  test('el periodo anterior mide lo mismo, corrido hacia atrás su propio largo', async () => {
    const { perfil, cuenta, categorias } = await libroNegocio('Periodo previo')
    const gasto = categorias.find((k: any) => k.kind === 'gasto')
    const mov = (type: string, cents: number, date: string) =>
      c.post('/api/transactions', {
        profileId: perfil.id,
        accountId: cuenta.id,
        type,
        amountCents: cents,
        date,
        categoryId: type === 'gasto' ? gasto.id : undefined,
      })

    await mov('ingreso', 900_000, '2026-07-10')
    await mov('gasto', 200_000, '2026-07-12')
    await mov('ingreso', 600_000, '2026-06-10')
    await mov('gasto', 100_000, '2026-06-12')

    const r = await resultados(perfil.id, '2026-07-01', '2026-07-31')
    // Un mes completo se compara contra el mes completo anterior, aunque junio
    // tenga un día menos. La ventana va escrita, así que nadie tiene que
    // adivinarla.
    assert.equal(r.previo.desde, '2026-06-01')
    assert.equal(r.previo.hasta, '2026-06-30')
    assert.equal(r.previo.ingresosCents, 600_000)
    assert.equal(r.previo.gastoTotalCents, 100_000)
    assert.equal(r.previo.utilidadCents, 500_000)
    assert.equal(r.utilidadCents - r.previo.utilidadCents, 200_000)
  })

  test('una ventana de siete días se compara contra los siete anteriores', async () => {
    // Y no contra "el mes pasado": el periodo lo escoge el usuario y puede no
    // ser un mes.
    const { perfil } = await libroNegocio('Ventana corta')
    const r = await resultados(perfil.id, '2026-07-20', '2026-07-26')
    assert.equal(r.previo.desde, '2026-07-13')
    assert.equal(r.previo.hasta, '2026-07-19')
  })

  test('el margen por centro se calcula igual que el del cliente', async () => {
    const { perfil, cuenta, categorias } = await libroNegocio('Centros')
    const gasto = categorias.find((k: any) => k.kind === 'gasto')
    const centro = (await c.post('/api/centros', { profileId: perfil.id, name: 'Eventos' })).body

    const mov = (type: string, cents: number) =>
      c.post('/api/transactions', {
        profileId: perfil.id,
        accountId: cuenta.id,
        type,
        amountCents: cents,
        date: '2026-07-10',
        costCenterId: centro.id,
        categoryId: type === 'gasto' ? gasto.id : undefined,
      })
    await mov('ingreso', 400_000)
    await mov('gasto', 100_000)

    const r = await resultados(perfil.id, '2026-07-01', '2026-07-31')
    const eventos = r.porCentro.find((x) => x.id === centro.id)!
    assert.equal(eventos.margenCents, 300_000)
    assert.equal(eventos.margenPct, 0.75)
  })
})

describe('R11 · nada de esto crece con el libro', () => {
  test('la cobranza cuesta una consulta, con dos facturas y con veinte', async () => {
    const { perfil, cliente } = await libroNegocio('R11 cobranza')
    for (let i = 0; i < 2; i++) {
      await emitir(perfil.id, cliente.id, { folio: `chica-${i}` })
    }
    const grande = await libroNegocio('R11 cobranza grande')
    for (let i = 0; i < 20; i++) {
      await emitir(grande.perfil.id, grande.cliente.id, { folio: `grande-${i}` })
    }

    const { db } = await import('../server/db.ts')
    const original = db.prepare.bind(db)
    let consultas = 0
    ;(db as any).prepare = (sql: string) => {
      consultas++
      return original(sql)
    }
    try {
      consultas = 0
      await c.get(`/api/facturas/cobranza?profileId=${perfil.id}&hoy=${HOY}`)
      const nChica = consultas

      consultas = 0
      const r = await c.get(`/api/facturas/cobranza?profileId=${grande.perfil.id}&hoy=${HOY}`)
      const nGrande = consultas

      assert.equal(r.body.renglones.length, 20)
      assert.equal(nGrande, nChica, 'ni una consulta por factura')
      assert.equal(nGrande, 1, 'la lista entera sale de un solo agregado')
    } finally {
      ;(db as any).prepare = original
    }
  })

  test('el estado de resultados no cuesta una consulta por cliente', async () => {
    const chico = await libroNegocio('R11 resultados chico')
    const grande = await libroNegocio('R11 resultados grande')
    const gasto = grande.categorias.find((k: any) => k.kind === 'gasto')
    for (let i = 0; i < 10; i++) {
      const cp = (
        await c.post('/api/contrapartes', { profileId: grande.perfil.id, name: `Cliente ${i}` })
      ).body
      await c.post('/api/transactions', {
        profileId: grande.perfil.id,
        accountId: grande.cuenta.id,
        type: 'gasto',
        amountCents: 1000 + i,
        date: '2026-07-10',
        categoryId: gasto.id,
        counterpartyId: cp.id,
      })
    }

    const { db } = await import('../server/db.ts')
    const original = db.prepare.bind(db)
    let consultas = 0
    ;(db as any).prepare = (sql: string) => {
      consultas++
      return original(sql)
    }
    const pedir = (perfil: number) =>
      c.get(`/api/negocio/resultados?profileId=${perfil}&desde=2026-07-01&hasta=2026-07-31`)
    try {
      consultas = 0
      await pedir(chico.perfil.id)
      const nChico = consultas

      consultas = 0
      const r = await pedir(grande.perfil.id)
      const nGrande = consultas

      assert.equal(r.body.porCliente.length, 10)
      assert.equal(nGrande, nChico)
      // Siete: ingresos, gasto deducible, impuestos, gasto por papel, por
      // centro, por cliente y el periodo anterior. Las dos últimas son de esta
      // fase, y son dos y no doce.
      assert.ok(nGrande <= 7, `son ${nGrande} consultas por estado de resultados`)
    } finally {
      ;(db as any).prepare = original
    }
  })
})

/**
 * Tercera vuelta de la auditoría: el impuesto también obedece a D6.
 *
 * El estado de resultados enseña el IVA trasladado y el acreditable en dos
 * renglones separados, y los sumaba por `t.type` en crudo. Una devolución es
 * dinero que **entra** y cuenta del lado del **gasto** —esa es la regla que ya
 * gobierna los montos—, así que su impuesto no es IVA que cobraste: es el
 * acreditable de la compra que se está deshaciendo.
 */
describe('el IVA de una devolución', () => {
  const resultados = (perfil: number, desde: string, hasta: string): Promise<EstadoResultados> =>
    c.get(`/api/negocio/resultados?profileId=${perfil}&desde=${desde}&hasta=${hasta}`).then((r) => r.body)

  /** Una compra con IVA, devuelta entera dentro del mismo periodo. */
  async function compraYDevolucion(nombre: string, devueltoCents: number) {
    const { perfil, cuenta, categorias } = await libroNegocio(nombre)
    const gasto = categorias.find((k: any) => k.kind === 'gasto')
    const compra = (
      await c.post('/api/transactions', {
        profileId: perfil.id,
        accountId: cuenta.id,
        type: 'gasto',
        amountCents: 1_160_00,
        date: '2026-07-03',
        categoryId: gasto.id,
        note: 'Compra con IVA',
        taxCents: 160_00,
        deductible: true,
      })
    ).body
    const iva = Math.round((160_00 * devueltoCents) / 1_160_00)
    const dev = await c.post('/api/transactions', {
      profileId: perfil.id,
      accountId: cuenta.id,
      type: 'ingreso',
      amountCents: devueltoCents,
      date: '2026-07-10',
      note: 'Devolución',
      taxCents: iva,
      refundOfId: compra.id,
    })
    assert.equal(dev.status, 201, JSON.stringify(dev.body))
    return { perfil, iva }
  }

  test('devolver la compra entera deja los dos renglones en cero', async () => {
    const { perfil } = await compraYDevolucion('IvaDevuelto', 1_160_00)
    const r = await resultados(perfil.id, '2026-07-01', '2026-07-31')
    // Antes decía $160 trasladados y $160 acreditables: el neto salía bien y
    // las dos cifras que la vista enseña por separado estaban infladas las dos.
    assert.equal(r.impuestoTrasladadoCents, 0, 'devolver una compra no es cobrar IVA')
    assert.equal(r.impuestoAcreditableCents, 0, 'y cancela el que se había acreditado')
    // Y lo de siempre sigue en pie: el gasto se deshace, no se vuelve ingreso.
    assert.equal(r.ingresosCents, 0)
    assert.equal(r.utilidadCents, 0)
  })

  test('una devolución parcial baja el acreditable en su parte', async () => {
    const { perfil, iva } = await compraYDevolucion('IvaParcial', 580_00)
    const r = await resultados(perfil.id, '2026-07-01', '2026-07-31')
    assert.equal(r.impuestoTrasladadoCents, 0)
    assert.equal(r.impuestoAcreditableCents, 160_00 - iva)
  })

  test('una venta con IVA lo sigue trasladando, que es lo de siempre', async () => {
    const { perfil, cuenta, categorias } = await libroNegocio('IvaVenta')
    const ingreso = categorias.find((k: any) => k.kind === 'ingreso')
    await c.post('/api/transactions', {
      profileId: perfil.id,
      accountId: cuenta.id,
      type: 'ingreso',
      amountCents: 1_160_00,
      date: '2026-07-03',
      categoryId: ingreso.id,
      taxCents: 160_00,
    })
    const r = await resultados(perfil.id, '2026-07-01', '2026-07-31')
    assert.equal(r.impuestoTrasladadoCents, 160_00)
    assert.equal(r.impuestoAcreditableCents, 0)
  })
})

/**
 * La factura que todavía no se emite, en el calendario y en el flujo.
 *
 * La asimetría que cierra: un gasto recurrente sin confirmar salía en los dos
 * y la iguala del mes —la entrada más segura que tiene un negocio— no salía en
 * ninguno hasta que alguien la emitía a mano.
 */
describe('las facturas recurrentes se proyectan sin contarse dos veces', () => {
  const plantillaDe = (perfil: number, cliente: number, datos: Record<string, unknown> = {}) =>
    c.post('/api/facturas/recurrentes', {
      profileId: perfil,
      counterpartyId: cliente,
      direction: 'emitida',
      concept: 'Iguala mensual',
      subtotalCents: 800_000,
      taxCents: 128_000,
      creditDays: 30,
      frequency: 'mensual',
      dayOfMonth: 1,
      startDate: '2026-05-01',
      ...datos,
    })

  const calendario = (perfil: number, hoy: string, dias = 90) =>
    c.get(`/api/calendario?profileId=${perfil}&hoy=${hoy}&dias=${dias}`).then((r) => r.body)
  const flujo = (perfil: number, hoy: string, dias = 90) =>
    c.get(`/api/flujo?profileId=${perfil}&hoy=${hoy}&dias=${dias}`).then((r) => r.body)

  test('el cobro cae a los días de crédito, no el día de la emisión', async () => {
    const { perfil, cliente } = await libroNegocio('ProyectaFR')
    await plantillaDe(perfil.id, cliente.id)

    // Desde el 1 de agosto: la emisión del 1 de septiembre cobra el 1 de
    // octubre. Poner el evento en la emisión metería en la caja de agosto un
    // cobro de octubre, que es el error que el flujo existe para no cometer.
    const cal = await calendario(perfil.id, '2026-08-01', 90)
    const proyectadas = cal.eventos.filter((e: any) => e.tipo === 'factura_recurrente')
    assert.ok(proyectadas.length > 0, 'la plantilla no se proyectó')
    for (const e of proyectadas) {
      assert.match(e.detalle, /sin emitir todavía/)
      assert.equal(e.direccion, 'entra', 'una factura emitida se cobra')
      // Lo cobrable, no el total del documento: aquí no hay retenciones, así
      // que coinciden, y la prueba de abajo separa las dos cifras.
      assert.equal(e.montoCents, 928_000)
    }
    const fechas = proyectadas.map((e: any) => e.fecha)
    assert.ok(fechas.includes('2026-10-01'), `la emisión del 1 sep cobra el 1 oct: ${fechas}`)
    assert.ok(!fechas.includes('2026-09-01'), 'la fecha de emisión no es la de cobro')
  })

  test('lo retenido no se proyecta: no lo va a mandar el cliente', async () => {
    const { perfil, cliente } = await libroNegocio('RetenidoFR')
    await plantillaDe(perfil.id, cliente.id, {
      withheldTaxCents: 85_333,
      withheldIncomeCents: 80_000,
    })
    const cal = await calendario(perfil.id, '2026-08-01', 90)
    const uno = cal.eventos.find((e: any) => e.tipo === 'factura_recurrente')
    assert.ok(uno)
    assert.equal(uno.montoCents, 928_000 - 85_333 - 80_000, 'proyectó el total, no lo cobrable')
  })

  test('emitir el periodo lo saca de la proyección y lo mete como factura', async () => {
    const { perfil, cliente } = await libroNegocio('EmitirFR')
    const p: FacturaRecurrente = (await plantillaDe(perfil.id, cliente.id)).body

    const antes = await calendario(perfil.id, '2026-08-01', 90)
    const proyectada = antes.eventos.find(
      (e: any) => e.tipo === 'factura_recurrente' && e.periodo === '2026-09',
    )
    assert.ok(proyectada, 'septiembre tenía que estar proyectado')

    const emitida = await c.post(
      `/api/facturas/recurrentes/${p.id}/emitir?profileId=${perfil.id}`,
      { periodo: '2026-09' },
    )
    assert.equal(emitida.status, 201, JSON.stringify(emitida.body))

    const despues = await calendario(perfil.id, '2026-08-01', 90)
    assert.equal(
      despues.eventos.filter((e: any) => e.tipo === 'factura_recurrente' && e.periodo === '2026-09')
        .length,
      0,
      'el periodo emitido se sigue proyectando',
    )
    // Y ahora existe como documento, en la misma fecha y por el mismo dinero.
    const documento = despues.eventos.find(
      (e: any) => e.tipo === 'factura' && e.fecha === proyectada.fecha,
    )
    assert.ok(documento, 'la factura emitida no entró al calendario')
    assert.equal(documento.montoCents, proyectada.montoCents, 'el mismo cobro cambió de monto')

    // Lo que importa de verdad: el flujo no cuenta el mismo peso dos veces.
    const f = await flujo(perfil.id, '2026-08-01', 90)
    const enEsaFecha = f.eventos.filter(
      (e: any) => e.fecha === proyectada.fecha && e.montoCents === proyectada.montoCents,
    )
    assert.equal(enEsaFecha.length, 1, 'el mismo cobro aparece dos veces en el flujo')
  })

  test('un periodo descartado tampoco se proyecta', async () => {
    const { perfil, cliente } = await libroNegocio('DescartarFR')
    const p: FacturaRecurrente = (await plantillaDe(perfil.id, cliente.id)).body
    await c.post(`/api/facturas/recurrentes/${p.id}/descartar?profileId=${perfil.id}`, {
      periodo: '2026-09',
    })
    const cal = await calendario(perfil.id, '2026-08-01', 90)
    assert.equal(
      cal.eventos.filter((e: any) => e.tipo === 'factura_recurrente' && e.periodo === '2026-09')
        .length,
      0,
    )
  })

  test('sin días de crédito no se proyecta nada: no hay fecha de cobro que suponer', async () => {
    const { perfil, cliente } = await libroNegocio('SinCreditoFR')
    await plantillaDe(perfil.id, cliente.id, { creditDays: null })
    const cal = await calendario(perfil.id, '2026-08-01', 90)
    assert.equal(
      cal.eventos.filter((e: any) => e.tipo === 'factura_recurrente').length,
      0,
      'suponer que te pagan el mismo día infla la caja',
    )
  })

  test('una plantilla archivada deja de proyectar, y el flujo lo refleja', async () => {
    const { perfil, cliente } = await libroNegocio('ArchivadaFR')
    const p: FacturaRecurrente = (await plantillaDe(perfil.id, cliente.id)).body
    const conEllas = await flujo(perfil.id, '2026-08-01', 90)

    await c.patch(`/api/facturas/recurrentes/${p.id}`, {
      profileId: perfil.id,
      counterpartyId: cliente.id,
      direction: 'emitida',
      concept: 'Iguala mensual',
      subtotalCents: 800_000,
      taxCents: 128_000,
      withheldTaxCents: 0,
      withheldIncomeCents: 0,
      creditDays: 30,
      frequency: 'mensual',
      dayOfMonth: 1,
      startDate: '2026-05-01',
      archived: true,
    })
    const sinEllas = await flujo(perfil.id, '2026-08-01', 90)
    assert.ok(conEllas.entradasCents > sinEllas.entradasCents, 'archivar no la calló')
    assert.equal(
      sinEllas.eventos.filter((e: any) => e.tipo === 'factura_recurrente').length,
      0,
    )
  })

  test('la proyección cuadra con la identidad del flujo', async () => {
    const { perfil, cliente } = await libroNegocio('CuadreFR')
    await plantillaDe(perfil.id, cliente.id)
    const f = await flujo(perfil.id, '2026-08-01', 90)
    assert.equal(
      f.saldoInicialCents + f.entradasCents - f.salidasCents,
      f.saldoFinalCents,
      'el flujo dejó de cuadrar al meter la proyección',
    )
    assert.equal(f.puntos.at(-1).saldoCents, f.saldoFinalCents)
  })

  test('con Negocio apagado no se proyecta ninguna', async () => {
    const { perfil, cliente } = await libroNegocio('ApagadoFR')
    await plantillaDe(perfil.id, cliente.id)
    await c.patch(`/api/profiles/${perfil.id}`, { modules: [] })
    const cal = await calendario(perfil.id, '2026-08-01', 90)
    assert.equal(cal.eventos.filter((e: any) => e.tipo === 'factura_recurrente').length, 0)
  })
})
