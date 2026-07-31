// Los tres módulos de giro por HTTP (Fase 15).
//
// Cada uno tiene una afirmación que es la razón de existir, y esas son las que
// se prueban primero:
//
//   · Inmuebles: **el depósito no es tuyo**. Sube tu saldo y no tu ingreso, y
//     esa regla vive en el movimiento —no en el módulo—, así que apagarlo no
//     convierte un depósito viejo en ingreso (D6, R18).
//   · Horas: facturar **no asienta un peso**. El libro queda igual, con una
//     factura más y las horas marcadas (D14, R4).
//   · Inventario: el costo de ventas **no cambia el estado de resultados** ni
//     el patrimonio. Es la otra verdad sobre el mismo peso (R18).
//
// Y los tres, R11: el costo no crece con el tamaño del libro.

import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { levantar, libroBase, type Cliente } from './ayuda.ts'
// Puros, sin base detrás (R16).
import { importeDeMinutos } from '../shared/giro.ts'

let c: Cliente
before(async () => {
  c = await levantar()
})
after(() => c?.cerrar())

const HOY = '2026-07-15'

/** Un libro con los tres módulos encendidos: nacen apagados para todos. */
async function libroGiro(nombre: string) {
  const base = await libroBase(c, nombre, 'negocio')
  await c.patch(`/api/profiles/${base.perfil.id}`, {
    modules: ['negocio', 'bienes', 'recurrencias', 'inmuebles', 'horas', 'inventario'],
  })
  return base
}

/** Un bien rentado y su contrato, que es el punto de partida de Inmuebles. */
async function conCasa(
  nombre: string,
  opciones: { costCents?: number; rentCents?: number; endDate?: string | null } = {},
) {
  const libro = await libroGiro(nombre)
  const bien = (
    await c.post('/api/bienes', {
      profileId: libro.perfil.id,
      name: 'Casa de Coyoacán',
      kind: 'inmueble',
      costCents: opciones.costCents ?? 2_000_000_00,
      acquiredDate: '2020-01-01',
    })
  ).body
  const renta = (
    await c.post('/api/inmuebles', {
      profileId: libro.perfil.id,
      assetId: bien.id,
      tenant: 'Familia Pérez',
      rentCents: opciones.rentCents ?? 15_000_00,
      depositCents: 15_000_00,
      paymentDay: 5,
      startDate: '2026-01-01',
      endDate: opciones.endDate ?? null,
    })
  ).body
  return { ...libro, bien, renta }
}

/** Un movimiento ligado al contrato con su papel. */
function movRenta(
  libro: { perfil: any; cuenta: any },
  rentalId: number,
  rentalRole: string,
  amountCents: number,
  date = '2026-07-05',
  type = 'ingreso',
) {
  return c.post('/api/transactions', {
    profileId: libro.perfil.id,
    accountId: libro.cuenta.id,
    type,
    amountCents,
    date,
    rentalId,
    rentalRole,
  })
}

// ── Inmuebles ─────────────────────────────────────────────────────────────

describe('inmuebles · el contrato de un bien que ya existe', () => {
  test('el inmueble no se duplica: el contrato apunta al bien', async () => {
    const { perfil, renta, bien } = await conCasa('Contrato con bien')
    assert.equal(renta.assetId, bien.id)
    assert.equal(renta.assetName, 'Casa de Coyoacán')
    assert.equal(renta.assetCostCents, 2_000_000_00, 'lo que costó lo sabe el bien, no el contrato')

    // Y el patrimonio lo sigue contando **una** vez: el que ya contaba antes.
    const s = (await c.get(`/api/summary?profileId=${perfil.id}&month=2026-07`)).body
    assert.equal(s.bienes.count, 1)
    assert.equal(s.bienes.valueCents, 2_000_000_00)
  })

  test('un bien de otro perfil, o archivado, no se puede rentar', async () => {
    const mio = await libroGiro('Dueño')
    const ajeno = await libroGiro('Ajeno')
    const suyo = (
      await c.post('/api/bienes', {
        profileId: ajeno.perfil.id,
        name: 'Local ajeno',
        kind: 'inmueble',
        costCents: 100_000_00,
        acquiredDate: '2020-01-01',
      })
    ).body
    const cruzado = await c.post('/api/inmuebles', {
      profileId: mio.perfil.id,
      assetId: suyo.id,
      tenant: 'X',
      rentCents: 1000,
      depositCents: 0,
      paymentDay: 1,
      startDate: '2026-01-01',
    })
    assert.equal(cruzado.status, 400)

    const propio = (
      await c.post('/api/bienes', {
        profileId: mio.perfil.id,
        name: 'Bodega vieja',
        kind: 'inmueble',
        costCents: 100_000_00,
        acquiredDate: '2020-01-01',
      })
    ).body
    await c.patch(`/api/bienes/${propio.id}`, { archived: true })
    const archivado = await c.post('/api/inmuebles', {
      profileId: mio.perfil.id,
      assetId: propio.id,
      tenant: 'X',
      rentCents: 1000,
      depositCents: 0,
      paymentDay: 1,
      startDate: '2026-01-01',
    })
    assert.equal(archivado.status, 400, 'recupéralo antes de rentarlo')
  })

  test('un contrato no puede terminar antes de empezar', async () => {
    const { perfil, bien } = await conCasa('Fechas al revés')
    const r = await c.post('/api/inmuebles', {
      profileId: perfil.id,
      assetId: bien.id,
      tenant: 'X',
      rentCents: 1000,
      depositCents: 0,
      paymentDay: 1,
      startDate: '2026-06-01',
      endDate: '2026-01-01',
    })
    assert.equal(r.status, 400)
  })
})

/** El estado de resultados del mes, que es donde vive la regla de D6. */
async function resultados(profileId: number) {
  return (
    await c.get(`/api/negocio/resultados?profileId=${profileId}&desde=2026-07-01&hasta=2026-07-31`)
  ).body
}

describe('inmuebles · D6: el depósito no es tuyo', () => {
  test('sube tu saldo y no tu ingreso', async () => {
    const libro = await conCasa('Depósito y renta')
    await movRenta(libro, libro.renta.id, 'renta', 15_000_00, '2026-07-05')
    await movRenta(libro, libro.renta.id, 'deposito', 15_000_00, '2026-07-06')

    const r = await resultados(libro.perfil.id)
    assert.equal(r.ingresosCents, 15_000_00, 'solo la renta es ingreso')

    const anual = (await c.get(`/api/reportes?profileId=${libro.perfil.id}&year=2026`)).body
    assert.equal(anual.totales.incomeCents, 15_000_00, 'y el año lo cuenta igual')

    // Pero el dinero sí está en la cuenta: los dos entraron. Que no sea tuyo no
    // significa que no esté — es exactamente la diferencia que el módulo marca.
    const s = (await c.get(`/api/summary?profileId=${libro.perfil.id}&month=2026-07`)).body
    assert.equal(s.totalCents, 100000 + 30_000_00)
  })

  test('devolverlo tampoco es un gasto', async () => {
    const libro = await conCasa('Devolución')
    await movRenta(libro, libro.renta.id, 'deposito', 15_000_00, '2026-07-06')
    await movRenta(libro, libro.renta.id, 'devolucion_deposito', 15_000_00, '2026-07-20', 'gasto')

    const r = await resultados(libro.perfil.id)
    assert.equal(r.ingresosCents, 0)
    assert.equal(
      r.gastoFijoCents + r.gastoVariableCents + r.sinClasificarCents + r.costoVentaCents,
      0,
      'entró y salió dinero que nunca fue tuyo',
    )

    const s = (await c.get(`/api/summary?profileId=${libro.perfil.id}&month=2026-07`)).body
    assert.equal(s.totalCents, 100000, 'y la cuenta quedó como estaba')
  })

  test('el depósito en mano es lo recibido menos lo devuelto', async () => {
    const libro = await conCasa('En mano')
    await movRenta(libro, libro.renta.id, 'deposito', 15_000_00, '2026-07-06')
    const uno = (await c.get(`/api/inmuebles?profileId=${libro.perfil.id}&hoy=${HOY}`)).body[0]
    assert.equal(uno.depositoEnManoCents, 15_000_00, 'lo tienes y lo debes')

    await movRenta(libro, libro.renta.id, 'devolucion_deposito', 10_000_00, '2026-07-20', 'gasto')
    const dos = (await c.get(`/api/inmuebles?profileId=${libro.perfil.id}&hoy=${HOY}`)).body[0]
    assert.equal(dos.depositoEnManoCents, 5_000_00)

    // Devolver de más no significa que el inquilino te deba un depósito.
    await movRenta(libro, libro.renta.id, 'devolucion_deposito', 90_000_00, '2026-07-21', 'gasto')
    const tres = (await c.get(`/api/inmuebles?profileId=${libro.perfil.id}&hoy=${HOY}`)).body[0]
    assert.equal(tres.depositoEnManoCents, 0, 'nunca negativo')
  })

  test('R18 · apagar Inmuebles no convierte un depósito viejo en ingreso', async () => {
    const libro = await conCasa('Apagable')
    await movRenta(libro, libro.renta.id, 'renta', 15_000_00, '2026-07-05')
    await movRenta(libro, libro.renta.id, 'deposito', 15_000_00, '2026-07-06')
    const antes = await resultados(libro.perfil.id)

    await c.patch(`/api/profiles/${libro.perfil.id}`, { modules: ['negocio'] })
    const despues = await resultados(libro.perfil.id)

    assert.equal(despues.ingresosCents, antes.ingresosCents, 'la regla vive en el movimiento')
    assert.equal(despues.ingresosCents, 15_000_00, 'y sigue sin ser ingreso con el módulo apagado')
    assert.equal(despues.utilidadCents, antes.utilidadCents)
  })

  test('el papel no se puede poner sin decir de qué contrato, ni al revés', async () => {
    const libro = await conCasa('Papel suelto')
    const sinContrato = await c.post('/api/transactions', {
      profileId: libro.perfil.id,
      accountId: libro.cuenta.id,
      type: 'ingreso',
      amountCents: 1000,
      date: '2026-07-05',
      rentalRole: 'deposito',
    })
    assert.equal(sinContrato.status, 400)

    const sinPapel = await c.post('/api/transactions', {
      profileId: libro.perfil.id,
      accountId: libro.cuenta.id,
      type: 'ingreso',
      amountCents: 1000,
      date: '2026-07-05',
      rentalId: libro.renta.id,
    })
    assert.equal(sinPapel.status, 400)
  })

  test('un contrato de otro perfil no se puede ligar', async () => {
    const mio = await conCasa('Mío')
    const otro = await conCasa('Otro')
    const r = await c.post('/api/transactions', {
      profileId: mio.perfil.id,
      accountId: mio.cuenta.id,
      type: 'ingreso',
      amountCents: 1000,
      date: '2026-07-05',
      rentalId: otro.renta.id,
      rentalRole: 'renta',
    })
    assert.equal(r.status, 400)
  })
})

describe('inmuebles · qué deja la propiedad', () => {
  test('lo cobrado menos el mantenimiento, sobre lo que vale hoy', async () => {
    const libro = await conCasa('Rendimiento', { costCents: 2_000_000_00 })
    // Doce rentas de $15,000 y un mantenimiento de $30,000 en la ventana.
    for (let m = 8; m <= 12; m++) {
      await movRenta(libro, libro.renta.id, 'renta', 15_000_00, `2025-${String(m).padStart(2, '0')}-05`)
    }
    for (let m = 1; m <= 7; m++) {
      await movRenta(libro, libro.renta.id, 'renta', 15_000_00, `2026-${String(m).padStart(2, '0')}-05`)
    }
    await movRenta(libro, libro.renta.id, 'mantenimiento', 30_000_00, '2026-03-10', 'gasto')
    // Y un depósito, que no debe entrar al rendimiento.
    await movRenta(libro, libro.renta.id, 'deposito', 15_000_00, '2026-01-06')

    const r = (await c.get(`/api/inmuebles?profileId=${libro.perfil.id}&hoy=${HOY}`)).body[0]
    assert.equal(r.cobradoCents, 12 * 15_000_00, 'doce rentas, sin el depósito')
    assert.equal(r.gastoCents, 30_000_00)
    assert.equal(r.rendimiento.netoCents, 150_000_00)
    assert.equal(r.meses, 12)
    assert.equal(r.rendimiento.anualizadoCents, 150_000_00)
    assert.equal(r.rendimiento.tasaAnualBp, 750, '7.5 % sobre los dos millones que costó')
  })

  test('la valuación del bien manda sobre el costo', async () => {
    const libro = await conCasa('Revaluada', { costCents: 1_000_000_00 })
    await c.post(`/api/bienes/${libro.bien.id}/valuaciones`, {
      date: '2026-01-01',
      valueCents: 2_000_000_00,
    })
    await movRenta(libro, libro.renta.id, 'renta', 10_000_00, '2026-07-05')

    const r = (await c.get(`/api/inmuebles?profileId=${libro.perfil.id}&hoy=${HOY}`)).body[0]
    assert.equal(r.assetValueCents, 2_000_000_00, 'vale lo que declaraste, no lo que costó')
    assert.equal(r.assetCostCents, 1_000_000_00)
    assert.equal(r.rendimiento.tasaAnualBp, 50, 'sobre lo que vale hoy')
    assert.equal(r.rendimiento.tasaSobreCostoBp, 100, 'y el doble sobre lo que costó')
  })

  test('el próximo cobro cae dentro del contrato, y no después', async () => {
    const vivo = await conCasa('Vigente', { endDate: '2027-01-01' })
    const uno = (await c.get(`/api/inmuebles?profileId=${vivo.perfil.id}&hoy=${HOY}`)).body[0]
    assert.equal(uno.proximoCobro, '2026-08-05', 'el 5 ya pasó este mes')

    const terminado = await conCasa('Terminado', { endDate: '2026-07-10' })
    const dos = (await c.get(`/api/inmuebles?profileId=${terminado.perfil.id}&hoy=${HOY}`)).body[0]
    assert.equal(dos.proximoCobro, null, 'un contrato que ya terminó no vuelve a cobrar')
  })

  test('borrar el contrato deja los movimientos, y avisa cuántos depósitos', async () => {
    const libro = await conCasa('Borrable')
    await movRenta(libro, libro.renta.id, 'renta', 15_000_00, '2026-07-05')
    await movRenta(libro, libro.renta.id, 'deposito', 15_000_00, '2026-07-06')

    const r = await c.del(`/api/inmuebles/${libro.renta.id}?profileId=${libro.perfil.id}`)
    assert.equal(r.status, 200)
    assert.equal(r.body.movimientos, 2, 'ese dinero se movió y se queda en el libro')
    assert.equal(r.body.depositos, 1, 'y este vuelve a contar como ingreso: hay que decirlo')

    const movs = (await c.get(`/api/transactions?profileId=${libro.perfil.id}&month=2026-07`)).body
    assert.equal(movs.length, 2)
    // Al perder la liga pierde el papel, y el aviso no mintió.
    const s = (await c.get(`/api/summary?profileId=${libro.perfil.id}&month=2026-07`)).body
    assert.equal(s.incomeCents, 30_000_00)
  })
})

describe('inmuebles · el calendario y la alerta', () => {
  test('la renta aparece como evento, y calla con el módulo apagado', async () => {
    const libro = await conCasa('Calendario')
    const con = (await c.get(`/api/calendario?profileId=${libro.perfil.id}&dias=60&hoy=${HOY}`)).body
    const rentas = con.eventos.filter((e: any) => e.tipo === 'renta')
    assert.ok(rentas.length >= 1, 'toca cobrar el 5 de agosto')
    assert.equal(rentas[0].montoCents, 15_000_00)
    assert.equal(rentas[0].direccion, 'entra')

    await c.patch(`/api/profiles/${libro.perfil.id}`, { modules: ['bienes'] })
    const sin = (await c.get(`/api/calendario?profileId=${libro.perfil.id}&dias=60&hoy=${HOY}`)).body
    assert.equal(
      sin.eventos.filter((e: any) => e.tipo === 'renta').length,
      0,
      'apagado no manda a una sección que no está en el lomo',
    )
  })

  test('el contrato que se acaba avisa, y solo ese', async () => {
    const pronto = await conCasa('Vence pronto', { endDate: '2026-08-05' })
    const alertas = (await c.get(`/api/alertas?profileId=${pronto.perfil.id}&hoy=${HOY}`)).body
    const suya = alertas.find((a: any) => a.tipo === 'arrendamiento')
    assert.ok(suya, 'un contrato que vence en un mes no aparece en ningún otro lado')
    assert.equal(suya.vista, 'inmuebles')
    assert.equal(suya.severidad, 'alta', 'a 21 días, urge')

    // A 36 días avisa igual, pero sin urgencia: todavía hay tiempo de renovar.
    const medio = await conCasa('Vence en mes y medio', { endDate: '2026-08-20' })
    const suyas = (await c.get(`/api/alertas?profileId=${medio.perfil.id}&hoy=${HOY}`)).body
    assert.equal(suyas.find((a: any) => a.tipo === 'arrendamiento').severidad, 'media')

    const lejos = await conCasa('Vence lejos', { endDate: '2028-01-01' })
    const otras = (await c.get(`/api/alertas?profileId=${lejos.perfil.id}&hoy=${HOY}`)).body
    assert.equal(otras.filter((a: any) => a.tipo === 'arrendamiento').length, 0)

    await c.patch(`/api/profiles/${pronto.perfil.id}`, { modules: [] })
    const calladas = (await c.get(`/api/alertas?profileId=${pronto.perfil.id}&hoy=${HOY}`)).body
    assert.equal(calladas.filter((a: any) => a.tipo === 'arrendamiento').length, 0)
  })
})

// ── Horas ─────────────────────────────────────────────────────────────────

async function libroHoras(nombre: string) {
  const libro = await libroGiro(nombre)
  const cliente = (
    await c.post('/api/contrapartes', {
      profileId: libro.perfil.id,
      name: 'Despacho Ruiz',
      role: 'cliente',
      creditDays: 15,
    })
  ).body
  return { ...libro, cliente }
}

function apuntar(
  libro: { perfil: any },
  counterpartyId: number | null,
  minutes: number,
  rateCents: number,
  date = '2026-07-10',
) {
  return c.post('/api/horas', {
    profileId: libro.perfil.id,
    date,
    minutes,
    rateCents,
    counterpartyId,
    note: 'Trabajo',
  })
}

describe('horas · lo trabajado sin cobrar', () => {
  test('el importe sale de minutos por tarifa, redondeado una vez', async () => {
    const libro = await libroHoras('Importe')
    const h = (await apuntar(libro, libro.cliente.id, 90, 999_00)).body
    assert.equal(h.importeCents, importeDeMinutos(90, 999_00))
    assert.equal(h.importeCents, 1_498_50)
    assert.equal(h.counterpartyName, 'Despacho Ruiz')
    assert.equal(h.invoiceId, null, 'nace sin facturar')
  })

  test('el resumen mira la ventana; lo por cobrar mira todo el historial', async () => {
    const libro = await libroHoras('Ventana')
    await apuntar(libro, libro.cliente.id, 60, 100_00, '2026-01-10')
    await apuntar(libro, libro.cliente.id, 120, 100_00, '2026-07-10')

    const r = (
      await c.get(`/api/horas/resumen?profileId=${libro.perfil.id}&desde=2026-07-01&hasta=2026-07-31`)
    ).body
    assert.equal(r.minutosTotal, 120, 'el mes trae dos horas')
    assert.equal(r.importeTotalCents, 200_00)
    assert.equal(r.tarifaMediaCents, 100_00)
    assert.equal(
      r.porCobrar[0].minutos,
      180,
      'pero sin cobrar hay tres: la de enero sigue sin cobrarse',
    )
    assert.equal(r.porCobrar[0].importeCents, 300_00)
    assert.equal(r.porCobrar[0].entradas, 2)
    assert.equal(r.porCobrar[0].desde, '2026-01-10')
  })

  test('sin horas no se inventa una tarifa media', async () => {
    const libro = await libroHoras('Vacío')
    const r = (
      await c.get(`/api/horas/resumen?profileId=${libro.perfil.id}&desde=2026-07-01&hasta=2026-07-31`)
    ).body
    assert.equal(r.minutosTotal, 0)
    assert.equal(r.tarifaMediaCents, null, 'dividir entre cero no da cero')
  })

  test('las horas sin cliente se agrupan aparte, con su nombre', async () => {
    const libro = await libroHoras('Sin cliente')
    await apuntar(libro, null, 60, 100_00)
    const r = (
      await c.get(`/api/horas/resumen?profileId=${libro.perfil.id}&desde=2026-07-01&hasta=2026-07-31`)
    ).body
    assert.equal(r.porCobrar[0].counterpartyId, null)
    assert.equal(r.porCobrar[0].counterpartyName, 'Sin cliente')
  })

  test('el filtro `sinFacturar` deja solo lo que falta cobrar', async () => {
    const libro = await libroHoras('Filtro')
    await apuntar(libro, libro.cliente.id, 60, 100_00)
    await c.post(`/api/horas/facturar?profileId=${libro.perfil.id}`, {
      counterpartyId: libro.cliente.id,
      issueDate: '2026-07-15',
      folio: 'A-1',
    })
    await apuntar(libro, libro.cliente.id, 30, 100_00, '2026-07-20')

    const todas = (await c.get(`/api/horas?profileId=${libro.perfil.id}`)).body
    assert.equal(todas.length, 2)
    const libres = (await c.get(`/api/horas?profileId=${libro.perfil.id}&sinFacturar=true`)).body
    assert.equal(libres.length, 1)
    assert.equal(libres[0].minutes, 30)
  })
})

describe('horas · D14: facturar no asienta un peso', () => {
  test('nace la factura, se marcan las horas y el libro queda igual', async () => {
    const libro = await libroHoras('Facturar')
    await apuntar(libro, libro.cliente.id, 60, 100_00, '2026-07-01')
    await apuntar(libro, libro.cliente.id, 90, 200_00, '2026-07-02')

    const antesMovs = (await c.get(`/api/transactions?profileId=${libro.perfil.id}`)).body.length
    const antes = (await c.get(`/api/summary?profileId=${libro.perfil.id}&month=2026-07`)).body

    const r = await c.post(`/api/horas/facturar?profileId=${libro.perfil.id}`, {
      counterpartyId: libro.cliente.id,
      issueDate: '2026-07-15',
      folio: 'A-100',
      concept: 'Servicios de julio',
      taxCents: 64_00,
    })
    assert.equal(r.status, 201)
    // $100 + $300 = $400 de subtotal, sumado renglón por renglón.
    assert.equal(r.body.subtotalCents, 400_00)
    assert.equal(r.body.taxCents, 64_00)
    assert.equal(r.body.saldoCents, 464_00)
    assert.equal(r.body.dueDate, '2026-07-30', 'los 15 días de crédito del cliente')

    const despuesMovs = (await c.get(`/api/transactions?profileId=${libro.perfil.id}`)).body
    assert.equal(despuesMovs.length, antesMovs, 'ni un movimiento nuevo')
    const despues = (await c.get(`/api/summary?profileId=${libro.perfil.id}&month=2026-07`)).body
    assert.equal(despues.incomeCents, antes.incomeCents, 'el ingreso nace al cobrarla')
    assert.equal(despues.totalCents, antes.totalCents)

    const horas = (await c.get(`/api/horas?profileId=${libro.perfil.id}`)).body
    assert.ok(horas.every((h: any) => h.invoiceId === r.body.id), 'las dos quedaron marcadas')
    assert.equal(horas[0].invoiceFolio, 'A-100')
  })

  test('van todas las del cliente y ninguna de otro', async () => {
    const libro = await libroHoras('Dos clientes')
    const otro = (
      await c.post('/api/contrapartes', { profileId: libro.perfil.id, name: 'Otro cliente' })
    ).body
    await apuntar(libro, libro.cliente.id, 60, 100_00)
    await apuntar(libro, otro.id, 60, 100_00)

    const r = await c.post(`/api/horas/facturar?profileId=${libro.perfil.id}`, {
      counterpartyId: libro.cliente.id,
      issueDate: '2026-07-15',
      folio: 'A-2',
    })
    assert.equal(r.body.subtotalCents, 100_00, 'solo lo suyo')
    const libres = (await c.get(`/api/horas?profileId=${libro.perfil.id}&sinFacturar=true`)).body
    assert.equal(libres.length, 1)
    assert.equal(libres[0].counterpartyId, otro.id)
  })

  test('sin horas pendientes no hay factura que emitir', async () => {
    const libro = await libroHoras('Nada que facturar')
    const r = await c.post(`/api/horas/facturar?profileId=${libro.perfil.id}`, {
      counterpartyId: libro.cliente.id,
      issueDate: '2026-07-15',
    })
    assert.equal(r.status, 400)
    assert.match(r.body.error, /Despacho Ruiz/)
  })

  test('unas horas sin tarifa no se facturan por cero', async () => {
    const libro = await libroHoras('Sin tarifa')
    await apuntar(libro, libro.cliente.id, 60, 0)
    const r = await c.post(`/api/horas/facturar?profileId=${libro.perfil.id}`, {
      counterpartyId: libro.cliente.id,
      issueDate: '2026-07-15',
    })
    assert.equal(r.status, 400)
    assert.match(r.body.error, /tarifa/)
  })

  test('borrar la factura devuelve las horas: la marca es derivada', async () => {
    const libro = await libroHoras('Deshacer')
    await apuntar(libro, libro.cliente.id, 60, 100_00)
    const factura = (
      await c.post(`/api/horas/facturar?profileId=${libro.perfil.id}`, {
        counterpartyId: libro.cliente.id,
        issueDate: '2026-07-15',
        folio: 'A-3',
      })
    ).body

    await c.del(`/api/facturas/${factura.id}`)
    const libres = (await c.get(`/api/horas?profileId=${libro.perfil.id}&sinFacturar=true`)).body
    assert.equal(libres.length, 1, 'vuelven a estar por cobrar solas')
    assert.equal(libres[0].invoiceId, null)
  })

  test('unas horas ya facturadas no se corrigen ni se borran', async () => {
    const libro = await libroHoras('Congeladas')
    const hora = (await apuntar(libro, libro.cliente.id, 60, 100_00)).body
    await c.post(`/api/horas/facturar?profileId=${libro.perfil.id}`, {
      counterpartyId: libro.cliente.id,
      issueDate: '2026-07-15',
      folio: 'A-4',
    })

    const editar = await c.patch(`/api/horas/${hora.id}`, {
      profileId: libro.perfil.id,
      date: '2026-07-11',
      minutes: 600,
      rateCents: 100_00,
      counterpartyId: libro.cliente.id,
    })
    assert.equal(editar.status, 409, 'cambiaría el respaldo de una factura emitida')
    const borrar = await c.del(`/api/horas/${hora.id}?profileId=${libro.perfil.id}`)
    assert.equal(borrar.status, 409)
  })

  test('un cliente de otro perfil no recibe factura', async () => {
    const mio = await libroHoras('Mío')
    const otro = await libroHoras('Otro')
    await apuntar(mio, mio.cliente.id, 60, 100_00)
    const r = await c.post(`/api/horas/facturar?profileId=${mio.perfil.id}`, {
      counterpartyId: otro.cliente.id,
      issueDate: '2026-07-15',
    })
    assert.equal(r.status, 400)
  })
})

// ── Inventario ────────────────────────────────────────────────────────────

async function libroAlmacen(nombre: string, minQtyMilli: number | null = null) {
  const libro = await libroGiro(nombre)
  const producto = (
    await c.post('/api/inventario', {
      profileId: libro.perfil.id,
      sku: 'CAF-1',
      name: 'Café en grano',
      unit: 'kg',
      minQtyMilli,
    })
  ).body
  return { ...libro, producto }
}

function mover(
  libro: { perfil: any; producto: any },
  kind: string,
  qtyMilli: number,
  unitCostCents = 0,
  date = '2026-07-10',
) {
  return c.post('/api/inventario/movimientos', {
    profileId: libro.perfil.id,
    productId: libro.producto.id,
    date,
    kind,
    qtyMilli,
    unitCostCents,
    note: '',
  })
}

describe('inventario · qué tienes y cuánto costó lo que salió', () => {
  test('el promedio se mezcla y la salida se valúa con él', async () => {
    const libro = await libroAlmacen('Promedio')
    await mover(libro, 'entrada', 10_000, 200_00, '2026-07-01')
    await mover(libro, 'entrada', 10_000, 300_00, '2026-07-02')
    const r = (await mover(libro, 'salida', 5_000, 0, '2026-07-05')).body

    assert.equal(r.cantidadMilli, 15_000, 'quedan quince kilos')
    assert.equal(r.costoUnitarioCents, 250_00, 'a doscientos cincuenta el kilo')
    assert.equal(r.valorCents, 3_750_00)
    assert.equal(r.costoVendidoCents, 1_250_00, 'cinco kilos al promedio del momento')
  })

  test('sacar más de lo que hay se rechaza diciendo cuánto hay', async () => {
    const libro = await libroAlmacen('Negativo')
    await mover(libro, 'entrada', 2_000, 100_00, '2026-07-01')
    const r = await mover(libro, 'salida', 3_000, 0, '2026-07-02')
    assert.equal(r.status, 400)
    assert.match(r.body.error, /2 kg/, 'dice la existencia exacta')

    const ajusteAbajo = await mover(libro, 'ajuste', -3_000, 0, '2026-07-02')
    assert.equal(ajusteAbajo.status, 400, 'un ajuste tampoco puede dejarlo en negativo')
  })

  test('la ventana solo mueve el costo de ventas, nunca la existencia', async () => {
    const libro = await libroAlmacen('Ventana')
    await mover(libro, 'entrada', 10_000, 100_00, '2026-06-01')
    await mover(libro, 'salida', 3_000, 0, '2026-06-10')
    await mover(libro, 'salida', 2_000, 0, '2026-07-10')

    const julio = (
      await c.get(`/api/inventario?profileId=${libro.perfil.id}&desde=2026-07-01&hasta=2026-07-31`)
    ).body
    assert.equal(julio.productos[0].cantidadMilli, 5_000, 'lo que tienes es de todo el historial')
    assert.equal(julio.valorCents, 500_00)
    assert.equal(julio.costoVendidoCents, 200_00, 'y el costo de ventas es solo el de julio')

    const junio = (
      await c.get(`/api/inventario?profileId=${libro.perfil.id}&desde=2026-06-01&hasta=2026-06-30`)
    ).body
    assert.equal(junio.productos[0].cantidadMilli, 5_000, 'la existencia no cambia con la ventana')
    assert.equal(junio.costoVendidoCents, 300_00)
  })

  test('la primera salida del mes se valúa al promedio que ya venía', async () => {
    // Entra caro en junio, barato en julio. Si la ventana arrancara de cero, la
    // salida de julio se valuaría solo con lo barato y el costo mentiría.
    const libro = await libroAlmacen('Arranque')
    await mover(libro, 'entrada', 10_000, 300_00, '2026-06-01')
    await mover(libro, 'entrada', 10_000, 100_00, '2026-07-01')
    await mover(libro, 'salida', 10_000, 0, '2026-07-10')

    const julio = (
      await c.get(`/api/inventario?profileId=${libro.perfil.id}&desde=2026-07-01&hasta=2026-07-31`)
    ).body
    assert.equal(julio.costoVendidoCents, 2_000_00, 'diez kilos al promedio de $200')
  })

  test('un ajuste se reporta aparte del costo de ventas', async () => {
    const libro = await libroAlmacen('Merma')
    await mover(libro, 'entrada', 10_000, 100_00, '2026-07-01')
    await mover(libro, 'ajuste', -1_000, 0, '2026-07-05')

    const r = (
      await c.get(`/api/inventario?profileId=${libro.perfil.id}&desde=2026-07-01&hasta=2026-07-31`)
    ).body
    assert.equal(r.costoVendidoCents, 0, 'no lo vendiste')
    assert.equal(r.ajusteCents, -100_00)
    assert.equal(r.productos[0].cantidadMilli, 9_000)
  })

  test('R18 · el almacén no toca el patrimonio ni el estado de resultados', async () => {
    const libro = await libroAlmacen('Aparte')
    const antes = (await c.get(`/api/summary?profileId=${libro.perfil.id}&month=2026-07`)).body
    const antesR = (
      await c.get(
        `/api/negocio/resultados?profileId=${libro.perfil.id}&desde=2026-07-01&hasta=2026-07-31`,
      )
    ).body

    await mover(libro, 'entrada', 10_000, 100_00, '2026-07-01')
    await mover(libro, 'salida', 4_000, 0, '2026-07-10')

    const despues = (await c.get(`/api/summary?profileId=${libro.perfil.id}&month=2026-07`)).body
    assert.equal(despues.totalCents, antes.totalCents, 'registrar mercancía no mueve una cuenta')
    assert.equal(despues.bienes.valueCents, antes.bienes.valueCents, 'ni el patrimonio')
    assert.equal(despues.expenseCents, antes.expenseCents)

    const despuesR = (
      await c.get(
        `/api/negocio/resultados?profileId=${libro.perfil.id}&desde=2026-07-01&hasta=2026-07-31`,
      )
    ).body
    assert.equal(
      despuesR.costoVentaCents,
      antesR.costoVentaCents,
      'el costo de ventas del libro es el día que la pagaste (D14)',
    )
    assert.equal(despuesR.utilidadCents, antesR.utilidadCents)
  })

  test('el anaquel vacío avisa, y calla con el módulo apagado', async () => {
    const libro = await libroAlmacen('Mínimo', 5_000)
    await mover(libro, 'entrada', 10_000, 100_00, '2026-07-01')
    const llenas = (await c.get(`/api/alertas?profileId=${libro.perfil.id}&hoy=${HOY}`)).body
    assert.equal(llenas.filter((a: any) => a.tipo === 'existencias').length, 0, 'diez sobre cinco')

    await mover(libro, 'salida', 8_000, 0, '2026-07-05')
    const bajas = (await c.get(`/api/alertas?profileId=${libro.perfil.id}&hoy=${HOY}`)).body
    const aviso = bajas.find((a: any) => a.tipo === 'existencias')
    assert.ok(aviso, 'quedan dos contra un mínimo de cinco')
    assert.equal(aviso.vista, 'inventario')
    assert.match(aviso.detalle, /2 kg/)

    await c.patch(`/api/profiles/${libro.perfil.id}`, { modules: [] })
    const calladas = (await c.get(`/api/alertas?profileId=${libro.perfil.id}&hoy=${HOY}`)).body
    assert.equal(calladas.filter((a: any) => a.tipo === 'existencias').length, 0)
  })

  test('sin mínimo puesto no hay aviso: Finply no sabe cuánto es poco', async () => {
    const libro = await libroAlmacen('Sin mínimo')
    await mover(libro, 'entrada', 1_000, 100_00, '2026-07-01')
    await mover(libro, 'salida', 1_000, 0, '2026-07-05')
    const alertas = (await c.get(`/api/alertas?profileId=${libro.perfil.id}&hoy=${HOY}`)).body
    assert.equal(alertas.filter((a: any) => a.tipo === 'existencias').length, 0)
  })

  test('un producto con historial se archiva, no se borra', async () => {
    const libro = await libroAlmacen('Con historial')
    await mover(libro, 'entrada', 1_000, 100_00, '2026-07-01')
    const r = await c.del(`/api/inventario/${libro.producto.id}?profileId=${libro.perfil.id}`)
    assert.equal(r.status, 409)
    assert.match(r.body.error, /Archívalo/)

    await c.patch(`/api/inventario/${libro.producto.id}`, {
      profileId: libro.perfil.id,
      name: 'Café en grano',
      unit: 'kg',
      archived: true,
    })
    const almacen = (await c.get(`/api/inventario?profileId=${libro.perfil.id}`)).body
    assert.equal(almacen.productos.length, 1, 'sigue estando')
    assert.equal(almacen.productos[0].archived, true)
    assert.equal(almacen.valorCents, 0, 'pero ya no cuenta en el total')
  })

  test('dos productos no pueden llamarse igual', async () => {
    const libro = await libroAlmacen('Nombres')
    const r = await c.post('/api/inventario', {
      profileId: libro.perfil.id,
      name: 'Café en grano',
      unit: 'kg',
    })
    assert.equal(r.status, 409)
  })

  test('borrar un movimiento recalcula el promedio', async () => {
    const libro = await libroAlmacen('Recalcula')
    await mover(libro, 'entrada', 10_000, 100_00, '2026-07-01')
    const caro = (await mover(libro, 'entrada', 10_000, 300_00, '2026-07-02')).body
    assert.equal(caro.costoUnitarioCents, 200_00)

    const movs = (
      await c.get(`/api/inventario/${libro.producto.id}/movimientos?profileId=${libro.perfil.id}`)
    ).body
    const segunda = movs.find((m: any) => m.unitCostCents === 300_00)
    await c.del(`/api/inventario/movimientos/${segunda.id}?profileId=${libro.perfil.id}`)

    const almacen = (await c.get(`/api/inventario?profileId=${libro.perfil.id}`)).body
    assert.equal(almacen.productos[0].costoUnitarioCents, 100_00, 'nada quedó guardado en piedra')
    assert.equal(almacen.productos[0].cantidadMilli, 10_000)
  })
})

// ── R11 · el costo no crece con el libro ──────────────────────────────────

describe('R11 · nada de esto cuesta una consulta por renglón', () => {
  async function contar(fn: () => Promise<unknown>): Promise<number> {
    const { db } = await import('../server/db.ts')
    const original = db.prepare.bind(db)
    let consultas = 0
    ;(db as any).prepare = (sql: string) => {
      consultas++
      return original(sql)
    }
    try {
      await fn()
      return consultas
    } finally {
      ;(db as any).prepare = original
    }
  }

  test('los inmuebles: uno y diez cuestan lo mismo', async () => {
    const chico = await conCasa('R11 casa chica')
    const grande = await libroGiro('R11 casas grande')
    for (let i = 0; i < 10; i++) {
      const bien = (
        await c.post('/api/bienes', {
          profileId: grande.perfil.id,
          name: `Local ${i}`,
          kind: 'inmueble',
          costCents: 100_000_00,
          acquiredDate: '2020-01-01',
        })
      ).body
      await c.post('/api/inmuebles', {
        profileId: grande.perfil.id,
        assetId: bien.id,
        tenant: `Inquilino ${i}`,
        rentCents: 10_000_00,
        depositCents: 0,
        paymentDay: 1,
        startDate: '2026-01-01',
      })
    }

    const nChico = await contar(() =>
      c.get(`/api/inmuebles?profileId=${chico.perfil.id}&hoy=${HOY}`),
    )
    let cuantos = 0
    const nGrande = await contar(async () => {
      const r = await c.get(`/api/inmuebles?profileId=${grande.perfil.id}&hoy=${HOY}`)
      cuantos = r.body.length
    })
    assert.equal(cuantos, 10)
    assert.equal(nGrande, nChico, 'ni una consulta por contrato')
    assert.ok(nGrande <= 3, `son ${nGrande} consultas: la lista y el agregado de movimientos`)
  })

  test('el resumen de horas: un cliente y veinte cuestan lo mismo', async () => {
    const chico = await libroHoras('R11 horas chico')
    await apuntar(chico, chico.cliente.id, 60, 100_00)
    const grande = await libroGiro('R11 horas grande')
    for (let i = 0; i < 20; i++) {
      const cp = (
        await c.post('/api/contrapartes', { profileId: grande.perfil.id, name: `Cliente ${i}` })
      ).body
      await c.post('/api/horas', {
        profileId: grande.perfil.id,
        date: '2026-07-10',
        minutes: 60,
        rateCents: 100_00,
        counterpartyId: cp.id,
      })
    }

    const ruta = (id: number) =>
      `/api/horas/resumen?profileId=${id}&desde=2026-07-01&hasta=2026-07-31`
    const nChico = await contar(() => c.get(ruta(chico.perfil.id)))
    let renglones = 0
    const nGrande = await contar(async () => {
      const r = await c.get(ruta(grande.perfil.id))
      renglones = r.body.porCobrar.length
    })
    assert.equal(renglones, 20)
    assert.equal(nGrande, nChico)
    assert.ok(nGrande <= 3, `son ${nGrande} consultas: los totales y lo por cobrar`)
  })

  test('el almacén: un producto y veinte cuestan lo mismo', async () => {
    const chico = await libroAlmacen('R11 almacén chico')
    await c.post('/api/inventario/movimientos', {
      profileId: chico.perfil.id,
      productId: chico.producto.id,
      date: '2026-07-01',
      kind: 'entrada',
      qtyMilli: 1_000,
      unitCostCents: 100_00,
    })
    const grande = await libroGiro('R11 almacén grande')
    for (let i = 0; i < 20; i++) {
      const p = (
        await c.post('/api/inventario', {
          profileId: grande.perfil.id,
          name: `Producto ${i}`,
          unit: 'pieza',
        })
      ).body
      await c.post('/api/inventario/movimientos', {
        profileId: grande.perfil.id,
        productId: p.id,
        date: '2026-07-01',
        kind: 'entrada',
        qtyMilli: 1_000,
        unitCostCents: 100_00,
      })
    }

    const nChico = await contar(() => c.get(`/api/inventario?profileId=${chico.perfil.id}`))
    let productos = 0
    const nGrande = await contar(async () => {
      const r = await c.get(`/api/inventario?profileId=${grande.perfil.id}`)
      productos = r.body.productos.length
    })
    assert.equal(productos, 20)
    assert.equal(nGrande, nChico, 'el recorrido del promedio es JS, no una consulta por producto')
    assert.ok(nGrande <= 3, `son ${nGrande} consultas: el catálogo y todos los movimientos`)
  })
})
