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

  test('⚠ la libreta vuelve atada a su movimiento y a su mes', async () => {
    // La lista de `backup.ts` está **ordenada por dependencias**, y en la Fase
    // 20 `notes` tuvo que mudarse detrás de `transactions`: una nota que
    // apunta a una partida no se puede restaurar antes que la partida. Es
    // exactamente lo que ya pasó con `rentals` en la Fase 15, y solo se ve
    // haciendo el viaje redondo — la prueba que compara la lista contra el
    // esquema pasa igual, porque la tabla sí está.
    const { perfil, cuenta } = await libroBase(c, 'Libreta')
    const tx = (
      await c.post('/api/transactions', {
        profileId: perfil.id, accountId: cuenta.id, type: 'gasto',
        amountCents: 180000, date: '2026-06-14', note: 'Viaje',
      })
    ).body
    await c.post('/api/notes', {
      profileId: perfil.id, title: 'Por qué tan caro', body: 'Boletos de los cuatro.',
      txId: tx.id,
    })
    await c.post('/api/notes', {
      profileId: perfil.id, title: 'Junio se pasó', body: 'Fue el viaje.', period: '2026-06',
    })
    await c.post('/api/notes', { profileId: perfil.id, title: 'Suelta', body: 'De nada.' })

    const antes = (await c.get(`/api/notes?profileId=${perfil.id}`)).body
    const respaldo = (await c.get('/api/respaldo')).body
    await c.del(`/api/profiles/${perfil.id}`)

    const res = await c.post('/api/respaldo/restaurar', respaldo)
    assert.equal(res.status, 200, JSON.stringify(res.body))

    const despues = (await c.get(`/api/notes?profileId=${perfil.id}`)).body
    assert.deepEqual(despues, antes)
    assert.equal(despues.filter((n: any) => n.txId !== null).length, 1)
    assert.equal(despues.filter((n: any) => n.period !== null).length, 1)
  })

  test('los campos propios y sus respuestas viajan enteros', async () => {
    // `tx_field_values` cuelga del movimiento **y** del campo, así que va
    // después de los dos en la lista de `backup.ts` —el mismo cuidado de
    // `rentals` en la Fase 15 y de `notes` en la 20—. Y es tabla puente sin
    // columna `id`: se vuelca por `rowid`.
    const { perfil, cuenta } = await libroBase(c, 'Personalizado')
    const campo = (
      await c.post('/api/personalizacion/campos', {
        profileId: perfil.id, label: 'Placa', kind: 'texto',
      })
    ).body
    await c.post('/api/personalizacion/plantillas', {
      profileId: perfil.id, name: 'Gasolina', type: 'gasto', accountId: cuenta.id,
    })
    await c.post('/api/transactions', {
      profileId: perfil.id, accountId: cuenta.id, type: 'gasto',
      amountCents: 80000, date: '2026-06-14', note: 'Verificación',
      fields: { [campo.id]: 'ABC-123' },
    })
    await c.patch(`/api/profiles/${perfil.id}`, { dateFormat: 'iso', hideCents: true })

    const antes = {
      campos: (await c.get(`/api/personalizacion/campos?profileId=${perfil.id}`)).body,
      plantillas: (await c.get(`/api/personalizacion/plantillas?profileId=${perfil.id}`)).body,
      movimientos: (await c.get(`/api/transactions?profileId=${perfil.id}`)).body,
      perfiles: (await c.get('/api/profiles')).body,
    }

    const respaldo = (await c.get('/api/respaldo')).body
    await c.del(`/api/profiles/${perfil.id}`)

    const res = await c.post('/api/respaldo/restaurar', respaldo)
    assert.equal(res.status, 200, JSON.stringify(res.body))

    assert.deepEqual(
      (await c.get(`/api/personalizacion/campos?profileId=${perfil.id}`)).body,
      antes.campos,
    )
    assert.deepEqual(
      (await c.get(`/api/personalizacion/plantillas?profileId=${perfil.id}`)).body,
      antes.plantillas,
    )
    // Lo contestado vuelve con su movimiento, y las preferencias con su perfil.
    assert.deepEqual(
      (await c.get(`/api/transactions?profileId=${perfil.id}`)).body,
      antes.movimientos,
    )
    assert.deepEqual((await c.get('/api/profiles')).body, antes.perfiles)
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

  test('las facturas vuelven con sus retenciones, sus notas y sus plantillas', async () => {
    // La lista de tablas del respaldo es a mano, así que una tabla nueva se
    // pierde en silencio si nadie la agrega. Esto lo comprueba de ida y vuelta.
    const { perfil } = await libroBase(c, 'Respaldo de facturas', 'negocio')
    const cliente = (
      await c.post('/api/contrapartes', {
        profileId: perfil.id, name: 'Oficinas Mérida', creditDays: 30, creditLimitCents: 500000,
        contact: 'compras@merida.mx',
      })
    ).body
    const factura = (
      await c.post('/api/facturas', {
        profileId: perfil.id, counterpartyId: cliente.id, direction: 'emitida',
        issueDate: '2026-07-01', dueDate: '2026-07-31',
        subtotalCents: 1000000, taxCents: 160000,
        withheldTaxCents: 106667, withheldIncomeCents: 100000,
      })
    ).body
    await c.post(`/api/facturas/${factura.id}/notas`, { date: '2026-07-05', folio: 'NC-1', amountCents: 53333 })
    const plantilla = (
      await c.post('/api/facturas/recurrentes', {
        profileId: perfil.id, counterpartyId: cliente.id, direction: 'emitida',
        concept: 'Iguala', subtotalCents: 800000, taxCents: 128000, creditDays: 30,
        frequency: 'mensual', dayOfMonth: 1, startDate: '2026-06-01',
      })
    ).body
    await c.post(`/api/facturas/recurrentes/${plantilla.id}/emitir?profileId=${perfil.id}`, {
      periodo: '2026-06',
    })

    const antes = {
      facturas: (await c.get(`/api/facturas?profileId=${perfil.id}`)).body,
      contrapartes: (await c.get(`/api/contrapartes?profileId=${perfil.id}`)).body,
      pendientes: (await c.get(`/api/facturas/recurrentes/pendientes?profileId=${perfil.id}&hoy=2026-07-31`)).body,
    }
    const respaldo = (await c.get('/api/respaldo')).body

    await c.del(`/api/profiles/${perfil.id}`)
    const res = await c.post('/api/respaldo/restaurar', respaldo)
    assert.equal(res.status, 200)

    assert.deepEqual((await c.get(`/api/facturas?profileId=${perfil.id}`)).body, antes.facturas)
    assert.deepEqual((await c.get(`/api/contrapartes?profileId=${perfil.id}`)).body, antes.contrapartes)
    // Y el periodo ya emitido sigue resuelto: la bitácora también viajó.
    assert.deepEqual(
      (await c.get(`/api/facturas/recurrentes/pendientes?profileId=${perfil.id}&hoy=2026-07-31`)).body,
      antes.pendientes,
    )
  })

  test('los tres módulos de giro viajan enteros, con el papel de cada movimiento', async () => {
    // Misma trampa que las facturas: la lista de tablas del respaldo es a mano.
    // Cuatro tablas nuevas y dos columnas, y la que más duele perder es
    // `rental_role` — sin ella el depósito restaurado vuelve a ser ingreso.
    const { perfil, cuenta } = await libroBase(c, 'Respaldo de giro', 'negocio')
    await c.patch(`/api/profiles/${perfil.id}`, {
      modules: ['negocio', 'bienes', 'inmuebles', 'horas', 'inventario'],
    })
    const bien = (
      await c.post('/api/bienes', {
        profileId: perfil.id, name: 'Casa de Coyoacán', kind: 'inmueble',
        costCents: 200000000, acquiredDate: '2020-01-01',
      })
    ).body
    const renta = (
      await c.post('/api/inmuebles', {
        profileId: perfil.id, assetId: bien.id, tenant: 'Familia Pérez',
        rentCents: 1500000, depositCents: 1500000, paymentDay: 5, startDate: '2026-01-01',
      })
    ).body
    for (const [role, type] of [['renta', 'ingreso'], ['deposito', 'ingreso'], ['mantenimiento', 'gasto']]) {
      await c.post('/api/transactions', {
        profileId: perfil.id, accountId: cuenta.id, type, amountCents: 100000,
        date: '2026-07-05', rentalId: renta.id, rentalRole: role,
      })
    }
    const cliente = (await c.post('/api/contrapartes', { profileId: perfil.id, name: 'Despacho' })).body
    await c.post('/api/horas', {
      profileId: perfil.id, date: '2026-07-10', minutes: 90, rateCents: 100000,
      counterpartyId: cliente.id, note: 'Junta',
    })
    const producto = (
      await c.post('/api/inventario', {
        profileId: perfil.id, sku: 'CAF-1', name: 'Café', unit: 'kg', minQtyMilli: 5000,
      })
    ).body
    await c.post('/api/inventario/movimientos', {
      profileId: perfil.id, productId: producto.id, date: '2026-07-01',
      kind: 'entrada', qtyMilli: 10000, unitCostCents: 20000,
    })
    await c.post('/api/inventario/movimientos', {
      profileId: perfil.id, productId: producto.id, date: '2026-07-05',
      kind: 'salida', qtyMilli: 4000,
    })

    const antes = {
      inmuebles: (await c.get(`/api/inmuebles?profileId=${perfil.id}&hoy=2026-07-15`)).body,
      horas: (await c.get(`/api/horas?profileId=${perfil.id}`)).body,
      almacen: (await c.get(`/api/inventario?profileId=${perfil.id}&desde=2026-07-01&hasta=2026-07-31`)).body,
      resultados: (
        await c.get(`/api/negocio/resultados?profileId=${perfil.id}&desde=2026-07-01&hasta=2026-07-31`)
      ).body,
    }
    const respaldo = (await c.get('/api/respaldo')).body

    await c.del(`/api/profiles/${perfil.id}`)
    const res = await c.post('/api/respaldo/restaurar', respaldo)
    assert.equal(res.status, 200)

    assert.deepEqual(
      (await c.get(`/api/inmuebles?profileId=${perfil.id}&hoy=2026-07-15`)).body,
      antes.inmuebles,
      'el contrato vuelve con lo cobrado, el depósito en mano y su rendimiento',
    )
    assert.deepEqual((await c.get(`/api/horas?profileId=${perfil.id}`)).body, antes.horas)
    assert.deepEqual(
      (await c.get(`/api/inventario?profileId=${perfil.id}&desde=2026-07-01&hasta=2026-07-31`)).body,
      antes.almacen,
      'y el almacén con su costo promedio, que se deriva de los movimientos',
    )
    // La que de verdad duele: si `rental_role` no viajara, el depósito
    // restaurado contaría como ingreso y esta cifra subiría sola.
    assert.deepEqual(
      (
        await c.get(`/api/negocio/resultados?profileId=${perfil.id}&desde=2026-07-01&hasta=2026-07-31`)
      ).body,
      antes.resultados,
    )
  })

  test('informa dónde vive la base', async () => {
    const res = await c.get('/api/respaldo/info')
    assert.equal(res.status, 200)
    assert.match(res.body.dbPath, /prueba\.db$/)
  })
})
