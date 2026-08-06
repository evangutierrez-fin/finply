// Perfil de negocio: contrapartes, facturas, antigüedad de saldos, estado de
// resultados, punto de equilibrio y flujo proyectado.
//
// La prueba que gobierna toda la fase es la primera: **emitir una factura no
// mueve el libro**. Finply lleva flujo de efectivo, así que el ingreso nace
// cuando se cobra. Si esa prueba se cae, el mes cuenta dos veces el mismo peso
// —una al emitir y otra al cobrar— y todos los reportes anteriores mienten.
//
// El import de `shared/negocio.ts` es estático y sin riesgo: es puro (R16).

import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { levantar, libroBase, type Cliente } from './ayuda.ts'
import { margenContribucion, puntoDeEquilibrio, tramoDe } from '../shared/negocio.ts'

let c: Cliente
before(async () => {
  c = await levantar()
})
after(() => c?.cerrar())

async function negocio(nombre: string) {
  const { perfil, cuenta, categorias } = await libroBase(c, nombre, 'negocio')
  const cliente = (
    await c.post('/api/contrapartes', { profileId: perfil.id, name: 'Cliente A', role: 'cliente' })
  ).body
  return { perfil, cuenta, categorias, cliente }
}

describe('tramos y punto de equilibrio (aritmética pura)', () => {
  test('el día del vencimiento todavía no es atraso', () => {
    assert.equal(tramoDe('2026-07-28', null), 'corriente', 'sin fecha pactada no hay atraso')
    assert.equal(tramoDe('2026-07-28', '2026-07-28'), 'corriente', 'vence al final del día')
    assert.equal(tramoDe('2026-07-28', '2026-08-15'), 'corriente')
    assert.equal(tramoDe('2026-07-28', '2026-07-27'), 'd1_30')
    assert.equal(tramoDe('2026-07-28', '2026-06-28'), 'd1_30', '30 días justos')
    assert.equal(tramoDe('2026-07-28', '2026-06-27'), 'd31_60')
    assert.equal(tramoDe('2026-07-28', '2026-05-29'), 'd31_60', '60 días justos')
    assert.equal(tramoDe('2026-07-28', '2026-05-28'), 'd61_90')
    assert.equal(tramoDe('2026-07-28', '2026-04-29'), 'd61_90', '90 días justos')
    assert.equal(tramoDe('2026-07-28', '2026-04-28'), 'd90_mas')
  })

  test('el punto de equilibrio es lo fijo entre el margen', () => {
    // A mano: de $1 000 de venta, $400 de costo y $100 variable dejan $500 de
    // contribución, o sea 50 %. Con $300 fijos hay que vender $600.
    assert.equal(margenContribucion(100000, 40000, 10000), 0.5)
    assert.equal(puntoDeEquilibrio(100000, 40000, 10000, 30000), 60000)
  })

  test('sin margen no hay punto de equilibrio, y se dice', () => {
    // Vender más no acerca a cubrir lo fijo si cada venta ya pierde dinero.
    assert.equal(puntoDeEquilibrio(100000, 90000, 20000, 30000), null)
    assert.equal(margenContribucion(0, 0, 0), null, 'sin ventas no se puede decir')
    assert.equal(puntoDeEquilibrio(0, 0, 0, 30000), null)
  })
})

describe('una factura no asienta nada', () => {
  test('emitirla no crea ingreso: el libro es de flujo de efectivo', async () => {
    const { perfil, cliente } = await negocio('Devengado no')
    const antes = (await c.get(`/api/summary?profileId=${perfil.id}&month=2026-07`)).body

    const factura = (
      await c.post('/api/facturas', {
        profileId: perfil.id,
        counterpartyId: cliente.id,
        direction: 'emitida',
        folio: 'A-100',
        issueDate: '2026-07-01',
        dueDate: '2026-07-31',
        subtotalCents: 100000,
        taxCents: 16000,
      })
    ).body
    assert.equal(factura.totalCents, 116000)
    assert.equal(factura.saldoCents, 116000)
    assert.equal(factura.pagadoCents, 0)

    const despues = (await c.get(`/api/summary?profileId=${perfil.id}&month=2026-07`)).body
    assert.equal(despues.incomeCents, antes.incomeCents, 'el ingreso del mes no se movió')
    assert.equal(despues.totalCents, antes.totalCents, 'ni el patrimonio')
  })

  test('cobrarla sí, y con su parte del impuesto', async () => {
    const { perfil, cuenta, cliente } = await negocio('Cobro')
    const factura = (
      await c.post('/api/facturas', {
        profileId: perfil.id,
        counterpartyId: cliente.id,
        direction: 'emitida',
        issueDate: '2026-07-01',
        subtotalCents: 100000,
        taxCents: 16000,
      })
    ).body

    const cobrada = (
      await c.post(`/api/facturas/${factura.id}/cobros`, {
        accountId: cuenta.id,
        amountCents: 116000,
        date: '2026-07-20',
      })
    ).body
    assert.equal(cobrada.saldoCents, 0)
    assert.equal(cobrada.cobrada, true)

    const resumen = (await c.get(`/api/summary?profileId=${perfil.id}&month=2026-07`)).body
    assert.equal(resumen.incomeCents, 116000, 'ahora sí entró')

    const movs = (await c.get(`/api/transactions?profileId=${perfil.id}`)).body
    const cobro = movs.find((t: any) => t.invoiceId === factura.id)
    assert.equal(cobro.type, 'ingreso')
    assert.equal(cobro.taxCents, 16000)
    assert.equal(cobro.counterpartyId, cliente.id)
  })

  test('dos cobros parciales dejan exactamente el impuesto de la factura', async () => {
    // El reparto proporcional redondea, así que el último cobro ajusta contra
    // lo ya trasladado. Sin eso, la suma queda un centavo arriba o abajo.
    const { perfil, cuenta, cliente } = await negocio('Parciales')
    const factura = (
      await c.post('/api/facturas', {
        profileId: perfil.id,
        counterpartyId: cliente.id,
        direction: 'emitida',
        issueDate: '2026-07-01',
        subtotalCents: 33333,
        taxCents: 5333,
      })
    ).body
    await c.post(`/api/facturas/${factura.id}/cobros`, {
      accountId: cuenta.id,
      amountCents: 20000,
      date: '2026-07-10',
    })
    const final = (
      await c.post(`/api/facturas/${factura.id}/cobros`, {
        accountId: cuenta.id,
        amountCents: 18666,
        date: '2026-07-20',
      })
    ).body
    assert.equal(final.saldoCents, 0)

    const movs = (await c.get(`/api/transactions?profileId=${perfil.id}`)).body
    const cobros = movs.filter((t: any) => t.invoiceId === factura.id)
    assert.equal(cobros.length, 2)
    assert.equal(
      cobros.reduce((s: number, t: any) => s + t.taxCents, 0),
      5333,
      'la suma de los impuestos es el de la factura, al centavo',
    )
  })

  test('cobrar más de lo que falta se rechaza con su razón', async () => {
    const { perfil, cuenta, cliente } = await negocio('De más')
    const factura = (
      await c.post('/api/facturas', {
        profileId: perfil.id,
        counterpartyId: cliente.id,
        direction: 'emitida',
        issueDate: '2026-07-01',
        subtotalCents: 10000,
      })
    ).body
    const res = await c.post(`/api/facturas/${factura.id}/cobros`, {
      accountId: cuenta.id,
      amountCents: 12000,
      date: '2026-07-20',
    })
    assert.equal(res.status, 400)
    assert.match(res.body.error, /más de lo que falta/)
  })

  test('anular el cobro reabre la factura sola', async () => {
    // El saldo es derivado, no una columna: por eso no hay nada que "volver a
    // poner en abierta" cuando el movimiento desaparece.
    const { perfil, cuenta, cliente } = await negocio('Anular')
    const factura = (
      await c.post('/api/facturas', {
        profileId: perfil.id,
        counterpartyId: cliente.id,
        direction: 'emitida',
        issueDate: '2026-07-01',
        subtotalCents: 50000,
      })
    ).body
    await c.post(`/api/facturas/${factura.id}/cobros`, {
      accountId: cuenta.id,
      amountCents: 50000,
      date: '2026-07-20',
    })
    const movs = (await c.get(`/api/transactions?profileId=${perfil.id}`)).body
    const cobro = movs.find((t: any) => t.invoiceId === factura.id)
    await c.del(`/api/transactions/${cobro.id}`)

    const lista = (await c.get(`/api/facturas?profileId=${perfil.id}`)).body
    const vuelta = lista.find((f: any) => f.id === factura.id)
    assert.equal(vuelta.saldoCents, 50000)
    assert.equal(vuelta.cobrada, false)
  })
})

describe('antigüedad de saldos', () => {
  test('reparte por lo vencido que está, en los dos sentidos', async () => {
    const { perfil, cliente } = await negocio('Aging')
    const proveedor = (
      await c.post('/api/contrapartes', {
        profileId: perfil.id,
        name: 'Proveedor B',
        role: 'proveedor',
      })
    ).body
    const emitir = (dueDate: string | null, subtotalCents: number) =>
      c.post('/api/facturas', {
        profileId: perfil.id,
        counterpartyId: cliente.id,
        direction: 'emitida',
        issueDate: '2026-01-01',
        dueDate,
        subtotalCents,
      })

    await emitir('2026-08-30', 10000) // al corriente
    await emitir('2026-07-20', 20000) // 8 días
    await emitir('2026-06-01', 30000) // 57 días
    await emitir(null, 40000) // sin fecha pactada: corriente
    await c.post('/api/facturas', {
      profileId: perfil.id,
      counterpartyId: proveedor.id,
      direction: 'recibida',
      issueDate: '2026-01-01',
      dueDate: '2026-03-01',
      subtotalCents: 70000,
    })

    const aging = (await c.get(`/api/facturas/aging?profileId=${perfil.id}&hoy=2026-07-28`)).body
    const tramo = (lista: any[], t: string) => lista.find((x) => x.tramo === t)
    assert.equal(tramo(aging.porCobrar, 'corriente').montoCents, 50000)
    assert.equal(tramo(aging.porCobrar, 'corriente').facturas, 2)
    assert.equal(tramo(aging.porCobrar, 'd1_30').montoCents, 20000)
    assert.equal(tramo(aging.porCobrar, 'd31_60').montoCents, 30000)
    assert.equal(aging.porCobrarCents, 100000)
    assert.equal(tramo(aging.porPagar, 'd90_mas').montoCents, 70000)
    assert.equal(aging.porPagarCents, 70000)

    // Y la lista de quién debe qué, de mayor a menor.
    assert.equal(aging.vencidoPorContraparte[0].name, 'Proveedor B')
    assert.equal(aging.vencidoPorContraparte[0].montoCents, 70000)
  })

  test('una factura cobrada sale del aging sin que nadie la cierre', async () => {
    const { perfil, cuenta, cliente } = await negocio('Aging cobrada')
    const factura = (
      await c.post('/api/facturas', {
        profileId: perfil.id,
        counterpartyId: cliente.id,
        direction: 'emitida',
        issueDate: '2026-01-01',
        dueDate: '2026-02-01',
        subtotalCents: 90000,
      })
    ).body
    const antes = (await c.get(`/api/facturas/aging?profileId=${perfil.id}&hoy=2026-07-28`)).body
    assert.equal(antes.porCobrarCents, 90000)

    await c.post(`/api/facturas/${factura.id}/cobros`, {
      accountId: cuenta.id,
      amountCents: 90000,
      date: '2026-07-01',
    })
    const despues = (await c.get(`/api/facturas/aging?profileId=${perfil.id}&hoy=2026-07-28`)).body
    assert.equal(despues.porCobrarCents, 0)
  })
})

describe('estado de resultados', () => {
  async function libroConVentas(nombre: string) {
    const { perfil, cuenta, categorias } = await libroBase(c, nombre, 'negocio')
    const ventas = categorias.find((k: any) => k.kind === 'ingreso')
    const gastos = categorias.filter((k: any) => k.kind === 'gasto')
    const insumos = gastos[0]
    const renta = gastos[1]
    const comisiones = gastos[2]
    await c.patch(`/api/categories/${insumos.id}`, { name: insumos.name, role: 'costo_venta' })
    await c.patch(`/api/categories/${renta.id}`, { name: renta.name, role: 'gasto_fijo' })
    await c.patch(`/api/categories/${comisiones.id}`, { name: comisiones.name, role: 'gasto_variable' })

    const mover = (tipo: string, cents: number, cat: any, extra: any = {}) =>
      c.post('/api/transactions', {
        profileId: perfil.id,
        accountId: cuenta.id,
        type: tipo,
        amountCents: cents,
        date: '2026-07-10',
        categoryId: cat.id,
        ...extra,
      })
    await mover('ingreso', 100000, ventas, { taxCents: 13793 })
    await mover('gasto', 40000, insumos, { taxCents: 5517, deductible: true })
    await mover('gasto', 30000, renta)
    await mover('gasto', 10000, comisiones)
    // Una categoría que nadie clasificó: no se reparte a ojo.
    await mover('gasto', 5000, gastos[3])
    return { perfil, cuenta, categorias }
  }

  test('cuadra, y lo sin clasificar va aparte', async () => {
    const { perfil } = await libroConVentas('Resultados')
    const r = (
      await c.get(`/api/negocio/resultados?profileId=${perfil.id}&desde=2026-07-01&hasta=2026-07-31`)
    ).body
    assert.equal(r.ingresosCents, 100000)
    assert.equal(r.costoVentaCents, 40000)
    assert.equal(r.margenBrutoCents, 60000)
    assert.equal(r.margenBrutoPct, 0.6)
    assert.equal(r.gastoFijoCents, 30000)
    assert.equal(r.gastoVariableCents, 10000)
    assert.equal(r.sinClasificarCents, 5000)
    assert.equal(r.utilidadCents, 15000, '100 − 40 − 30 − 10 − 5')
    assert.equal(r.impuestoTrasladadoCents, 13793)
    assert.equal(r.impuestoAcreditableCents, 5517)
    assert.equal(r.deducibleCents, 40000)
  })

  test('el punto de equilibrio sale de esos mismos números', async () => {
    const { perfil } = await libroConVentas('Equilibrio')
    const r = (
      await c.get(`/api/negocio/resultados?profileId=${perfil.id}&desde=2026-07-01&hasta=2026-07-31`)
    ).body
    // Margen de contribución: (100 − 40 − 10) / 100 = 0.5. Fijos 30 → 60.
    assert.equal(r.margenContribucion, 0.5)
    assert.equal(r.puntoEquilibrioCents, 60000)
    assert.equal(
      r.puntoEquilibrioCents,
      puntoDeEquilibrio(r.ingresosCents, r.costoVentaCents, r.gastoVariableCents, r.gastoFijoCents),
      'la vista y el servidor usan la misma función',
    )
  })

  test('recibir un préstamo no es venta (D6 también manda aquí)', async () => {
    const { perfil, cuenta } = await libroBase(c, 'D6 en resultados', 'negocio')
    await c.post('/api/debts', {
      profileId: perfil.id,
      direction: 'por_pagar',
      counterparty: 'Banco',
      principalCents: 500000,
      startDate: '2026-07-05',
      accountId: cuenta.id,
    })
    const r = (
      await c.get(`/api/negocio/resultados?profileId=${perfil.id}&desde=2026-07-01&hasta=2026-07-31`)
    ).body
    assert.equal(r.ingresosCents, 0, 'el desembolso entró a la cuenta pero no es ingreso')
  })

  test('agrupa por la dimensión libre sin contar dos veces', async () => {
    const { perfil, cuenta, categorias } = await libroBase(c, 'Centros', 'negocio')
    const centro = (await c.post('/api/centros', { profileId: perfil.id, name: 'Obra Norte' })).body
    const gasto = categorias.find((k: any) => k.kind === 'gasto')
    const ingreso = categorias.find((k: any) => k.kind === 'ingreso')
    await c.post('/api/transactions', {
      profileId: perfil.id, accountId: cuenta.id, type: 'ingreso', amountCents: 80000,
      date: '2026-07-05', categoryId: ingreso.id, costCenterId: centro.id,
    })
    await c.post('/api/transactions', {
      profileId: perfil.id, accountId: cuenta.id, type: 'gasto', amountCents: 30000,
      date: '2026-07-06', categoryId: gasto.id, costCenterId: centro.id,
    })
    await c.post('/api/transactions', {
      profileId: perfil.id, accountId: cuenta.id, type: 'gasto', amountCents: 7000,
      date: '2026-07-07', categoryId: gasto.id,
    })

    const r = (
      await c.get(`/api/negocio/resultados?profileId=${perfil.id}&desde=2026-07-01&hasta=2026-07-31`)
    ).body
    const obra = r.porCentro.find((x: any) => x.id === centro.id)
    const sin = r.porCentro.find((x: any) => x.id === null)
    assert.equal(obra.ingresosCents, 80000)
    assert.equal(obra.gastoCents, 30000)
    assert.equal(sin.gastoCents, 7000)
    assert.equal(
      r.porCentro.reduce((s: number, x: any) => s + x.gastoCents, 0),
      37000,
      'los centros suman el gasto del periodo, sin repetir ninguno',
    )
  })
})

describe('integridad del perfil de negocio', () => {
  test('una contraparte con facturas se archiva, no se borra', async () => {
    const { perfil, cliente } = await negocio('Contraparte con facturas')
    await c.post('/api/facturas', {
      profileId: perfil.id, counterpartyId: cliente.id, direction: 'emitida',
      issueDate: '2026-07-01', subtotalCents: 10000,
    })
    const res = await c.del(`/api/contrapartes/${cliente.id}`)
    assert.equal(res.status, 409)
    assert.match(res.body.error, /Archívala/)

    const archivada = await c.patch(`/api/contrapartes/${cliente.id}`, { archived: true })
    assert.equal(archivada.body.archived, true)
    assert.equal(archivada.body.invoiceCount, 1)
    assert.equal(archivada.body.porCobrarCents, 10000)
  })

  test('borrar un centro no borra movimientos: los deja sin asignar', async () => {
    const { perfil, cuenta, categorias } = await libroBase(c, 'Centro borrado', 'negocio')
    const centro = (await c.post('/api/centros', { profileId: perfil.id, name: 'Temporal' })).body
    const gasto = categorias.find((k: any) => k.kind === 'gasto')
    await c.post('/api/transactions', {
      profileId: perfil.id, accountId: cuenta.id, type: 'gasto', amountCents: 12345,
      date: '2026-07-10', categoryId: gasto.id, costCenterId: centro.id,
    })
    await c.del(`/api/centros/${centro.id}`)
    const movs = (await c.get(`/api/transactions?profileId=${perfil.id}`)).body
    assert.equal(movs.length, 1)
    assert.equal(movs[0].amountCents, 12345)
    assert.equal(movs[0].costCenterId, null)
  })

  test('no se puede usar la contraparte de otro perfil', async () => {
    const { perfil } = await negocio('Perfil uno')
    const otro = await negocio('Perfil dos')
    const res = await c.post('/api/transactions', {
      profileId: perfil.id,
      accountId: (await c.get(`/api/accounts?profileId=${perfil.id}`)).body[0].id,
      type: 'gasto',
      amountCents: 1000,
      date: '2026-07-10',
      counterpartyId: otro.cliente.id,
    })
    assert.equal(res.status, 400)
    assert.match(res.body.error, /no pertenece a este perfil/)
  })

  test('el impuesto no puede ser mayor que el monto que lo contiene', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Impuesto imposible', 'negocio')
    const res = await c.post('/api/transactions', {
      profileId: perfil.id, accountId: cuenta.id, type: 'gasto',
      amountCents: 10000, date: '2026-07-10', taxCents: 12000,
    })
    assert.equal(res.status, 400)
    assert.match(res.body.error, /incluido en el monto/)
  })

  test('el respaldo se lleva contrapartes, centros y facturas', async () => {
    const { perfil, cuenta, cliente } = await negocio('Respaldo negocio')
    const factura = (
      await c.post('/api/facturas', {
        profileId: perfil.id, counterpartyId: cliente.id, direction: 'emitida',
        folio: 'R-1', issueDate: '2026-07-01', subtotalCents: 70000, taxCents: 11200,
      })
    ).body
    await c.post(`/api/facturas/${factura.id}/cobros`, {
      accountId: cuenta.id, amountCents: 30000, date: '2026-07-15',
    })

    const respaldo = (await c.get('/api/respaldo')).body
    assert.ok(respaldo.tables.counterparties.length > 0)
    assert.ok(respaldo.tables.invoices.length > 0)
    assert.ok(respaldo.tables.cost_centers)

    const restaurado = await c.post('/api/respaldo/restaurar', respaldo)
    assert.equal(restaurado.status, 200)
    const lista = (await c.get(`/api/facturas?profileId=${perfil.id}`)).body
    const vuelta = lista.find((f: any) => f.folio === 'R-1')
    assert.equal(vuelta.totalCents, 81200)
    assert.equal(vuelta.pagadoCents, 30000, 'el cobro siguió ligado a su factura')
  })

  test('la lista de tablas del respaldo cubre todas las que existen', async () => {
    // Una tabla que se olvide en `TABLES` se pierde en cada respaldo sin
    // avisar. Esto lo descubre en la primera prueba, no en la primera
    // restauración de alguien.
    const { db } = await import('../server/db.ts')
    const { TABLES } = await import('../server/backup.ts')
    const reales = (
      db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'table'
             AND name NOT LIKE 'sqlite_%' ORDER BY name`,
        )
        .all() as { name: string }[]
    ).map((r) => r.name)
    const faltantes = reales.filter((t) => !(TABLES as readonly string[]).includes(t))
    assert.deepEqual(faltantes, [], `faltan en el respaldo: ${faltantes.join(', ')}`)
  })
})
