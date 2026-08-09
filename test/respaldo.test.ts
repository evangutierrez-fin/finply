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

  // ── El respaldo que no se podía restaurar ───────────────────────────────
  //
  // Hallazgo de la Fase 26. Los recibos viajan en base64 dentro del JSON, así
  // que un libro con dos docenas de recibos grandes producía un archivo por
  // encima del tope del cuerpo: Finply exportaba un respaldo y luego se negaba
  // a restaurarlo, con un 413 en inglés que no decía por qué.

  test('el tope del cuerpo cabe lo que Finply mismo puede generar', async () => {
    const { LIMITE_CUERPO_BYTES } = await import('../server/app.ts')
    const { MAX_ADJUNTO_BYTES } = await import('../server/validators.ts')
    // Un libro con cien recibos del tamaño máximo no es un caso raro, y su
    // respaldo tiene que poder volver. El 4/3 es lo que engorda el base64.
    const libroReal = MAX_ADJUNTO_BYTES * 100 * (4 / 3)
    assert.ok(
      LIMITE_CUERPO_BYTES >= libroReal,
      `el tope (${LIMITE_CUERPO_BYTES}) no cabe un libro de cien recibos (${libroReal})`,
    )
  })

  test('y si aun así no cabe, lo dice en español y enseña la otra puerta', async () => {
    // Se prueba la traducción y no la petición: para provocar el 413 de verdad
    // hay que mandar cientos de megabytes —Node no contesta a un cuerpo
    // anunciado y no enviado— y eso no cabe en una suite.
    const { traducirError, LIMITE_CUERPO_BYTES } = await import('../server/app.ts')
    const grande = Object.assign(new Error('request entity too large'), {
      type: 'entity.too.large',
      status: 413,
    })

    const r = traducirError(grande)
    assert.equal(r.status, 413)
    assert.ok(!/entity/.test(r.error), 'el mensaje sigue llegando en inglés')
    assert.match(r.error, new RegExp(`tope de ${Math.round(LIMITE_CUERPO_BYTES / 1024 / 1024)} MB`))
    assert.match(r.error, /recibos/)
    assert.match(r.error, /data\/respaldos\//)
  })

  test('los demás errores siguen traduciéndose como siempre', async () => {
    const { traducirError } = await import('../server/app.ts')
    const roto = Object.assign(new SyntaxError('Unexpected token'), { status: 400 })
    assert.deepEqual(traducirError(roto), {
      status: 400,
      error: 'El cuerpo de la petición no es JSON válido',
    })
    // Lo que no se reconoce sigue saliendo como 500 con su mensaje.
    assert.deepEqual(traducirError(new Error('tronó')), { status: 500, error: 'tronó' })
  })
})

/**
 * Lo que el respaldo trae dentro y la base sí acepta.
 *
 * La segunda vuelta de la auditoría dejó esto escrito como hueco conocido, y la
 * decisión de fondo no cambió: **se restaura**. Negarse a restaurar el respaldo
 * de alguien es peor que restaurarlo con un renglón torcido — ese archivo puede
 * ser lo único que le queda. Lo que cambió es que deja de ser un hueco callado,
 * y que lo único que no entra tal cual es lo que dejaría el libro sin abrir.
 *
 * ⚠ Cada prueba arranca su propio libro: el respaldo se lleva **todos** los
 * perfiles, así que un archivo exportado aquí trae también lo que dejaron las
 * pruebas de arriba. Por eso el renglón que se tuerce se busca por su concepto
 * y no por su posición.
 */
describe('el respaldo dice qué traía dentro', () => {
  const CONCEPTO = 'Renglón a torcer'
  const VENENO = 'Renglón envenenado'

  /** Un respaldo real con un renglón conocido, torcido a mano como uno viejo. */
  async function respaldoCon(nombre: string, torcer: (fila: any) => void) {
    const { perfil, cuenta, categorias } = await libroBase(c, nombre)
    const gasto = categorias.find((cat: any) => cat.kind === 'gasto')
    await c.post('/api/transactions', {
      profileId: perfil.id, accountId: cuenta.id, type: 'gasto',
      amountCents: 12_345, date: '2026-07-10', categoryId: gasto.id, note: CONCEPTO,
    })
    const respaldo = (await c.get('/api/respaldo')).body
    const fila = respaldo.tables.transactions.find(
      (t: any) => t.profile_id === perfil.id && t.note === CONCEPTO,
    )
    assert.ok(fila, 'no se encontró el renglón recién creado en el respaldo')
    torcer(fila)
    return { respaldo, perfil }
  }

  /** El renglón conocido, ya restaurado. */
  async function elRenglon(perfilId: number) {
    const movs = (await c.get(`/api/transactions?profileId=${perfilId}`)).body
    return movs.find((t: any) => t.note === CONCEPTO)
  }

  test('un respaldo sano no inventa hallazgos', async () => {
    const { respaldo } = await respaldoCon('Sano', () => {})
    const res = await c.post('/api/respaldo/restaurar', respaldo)
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.revision, { fechas: 0, montos: 0, cifras: 0, ejemplos: [] })
  })
  test('las marcas de tiempo no cuentan como fecha torcida', async () => {
    // `created_at` lleva hora y no es un día del calendario: contarlo habría
    // marcado como sospechoso cada renglón de todo respaldo sano.
    const { respaldo } = await respaldoCon('Marcas', () => {})
    assert.ok(String(respaldo.tables.profiles[0].created_at).includes(':'))
    assert.equal((await c.post('/api/respaldo/restaurar', respaldo)).body.revision.fechas, 0)
  })
  test('una fecha que no existe se restaura tal cual, se cuenta y se señala', async () => {
    // El 30 de febrero: cumple la forma, ordena como texto y se vuelve el 2 de
    // marzo en cuanto algo cuenta días con ella. Entraba a los libros antes del
    // hallazgo 4 y el validador de hoy ya no la deja pasar.
    const { respaldo, perfil } = await respaldoCon('FechaVieja', (f) => {
      f.date = '2026-02-30'
    })
    const res = await c.post('/api/respaldo/restaurar', respaldo)
    assert.equal(res.status, 200, 'se negó a restaurar, que es lo que no debe hacer')

    const suyo = res.body.revision.ejemplos.filter(
      (h: any) => h.motivo === 'fecha' && h.valor === '2026-02-30',
    )
    assert.equal(suyo.length, 1)
    assert.equal(suyo[0].tabla, 'transactions')
    assert.equal(suyo[0].columna, 'date')
    assert.ok(res.body.revision.fechas >= 1)

    // Y se restauró **tal cual**: la fecha de verdad solo la sabe el usuario.
    const renglon = await elRenglon(perfil.id)
    assert.ok(renglon, 'el movimiento no sobrevivió a la restauración')
    assert.equal(renglon.date, '2026-02-30')
    assert.equal(renglon.amountCents, 12_345, 'el monto no se tocó')
  })
  test('una cifra que el libro no puede releer entra en un centavo', async () => {
    const { respaldo, perfil } = await respaldoCon('MontoViejo', (f) => {
      f.amount_cents = Number.MAX_SAFE_INTEGER + 2
    })
    const res = await c.post('/api/respaldo/restaurar', respaldo)
    assert.equal(res.status, 200)

    const suyo = res.body.revision.ejemplos.filter((h: any) => h.motivo === 'monto')
    assert.equal(suyo.length, 1)
    assert.equal(suyo[0].tabla, 'transactions')
    assert.equal(suyo[0].columna, 'amount_cents')
    assert.equal(suyo[0].valor, String(Number.MAX_SAFE_INTEGER + 2), 'no dice lo que decía')

    // La fila entera se conserva; solo el monto se aparta.
    const renglon = await elRenglon(perfil.id)
    assert.ok(renglon, 'la fila se perdió, que es lo que no debe pasar')
    assert.equal(renglon.amountCents, 1, 'no quedó en un centavo')
    assert.equal(renglon.date, '2026-07-10', 'lo demás del renglón sigue ahí')
    assert.equal(renglon.note, CONCEPTO)
  })

  /**
   * La razón de fondo del centavo, y la única que importa: con la cifra tal
   * cual, `exportSnapshot` tronaba y el usuario se quedaba **sin puerta de
   * salida** — un libro que no abre y del que ya no se puede sacar nada.
   */
  test('el libro restaurado se puede volver a respaldar', async () => {
    const { respaldo } = await respaldoCon('SigueAbriendo', (f) => {
      f.amount_cents = Number.MAX_SAFE_INTEGER + 2
    })
    assert.equal((await c.post('/api/respaldo/restaurar', respaldo)).status, 200)
    assert.equal((await c.get('/api/respaldo')).status, 200, 'ya no se puede respaldar')
  })
  /**
   * El otro lado de la misma moneda, y el que quedó abierto en la tercera
   * vuelta: **el libro que ya está envenenado**. El techo protege a los libros
   * nuevos y la revisión protege a los restaurados, pero quien escribió la
   * cifra con una versión anterior seguía encerrado — y encerrado del peor
   * modo, porque la única puerta que le quedaba era la que tronaba.
   *
   * Se escribe por SQL a propósito: por HTTP ya no se puede, que es justo lo
   * que arregló el hallazgo 8. Así se reproduce el libro viejo tal como es.
   */
  test('un libro que ya trae la cifra ilegible se puede exportar', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Envenenado')
    const { db } = await import('../server/db.ts')
    db.prepare(
      `INSERT INTO transactions (profile_id, account_id, type, amount_cents, date, note)
       VALUES (?, ?, 'gasto', 99999999999999999, '2026-07-11', ?)`,
    ).run(perfil.id, cuenta.id, VENENO)

    const res = await c.get('/api/respaldo')
    assert.equal(res.status, 200, 'el libro envenenado sigue sin poder salir')

    const fila = res.body.tables.transactions.find((t: any) => t.note === VENENO)
    assert.ok(fila, 'la fila envenenada no salió en el respaldo')
    assert.equal(
      fila.amount_cents,
      '99999999999999999',
      'la cifra tiene que salir como texto: es lo único que la conserva entera',
    )
    // Lo demás del respaldo sale como siempre: números, no texto.
    assert.equal(typeof fila.id, 'number')
    assert.equal(typeof fila.profile_id, 'number')
  })

  /**
   * Y el ciclo completo: el respaldo del libro envenenado se puede volver a
   * restaurar, y al restaurarlo el libro queda sano. Esa es la salida —
   * exportar y restaurar el mismo archivo— y no existía.
   */
  test('exportar y restaurar el mismo archivo saca al libro del pozo', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Rescatable')
    const { db } = await import('../server/db.ts')
    db.prepare(
      `INSERT INTO transactions (profile_id, account_id, type, amount_cents, date, note)
       VALUES (?, ?, 'gasto', 99999999999999999, '2026-07-11', ?)`,
    ).run(perfil.id, cuenta.id, VENENO)

    const respaldo = (await c.get('/api/respaldo')).body
    const res = await c.post('/api/respaldo/restaurar', respaldo)
    assert.equal(res.status, 200)

    // ⚠ El respaldo se lleva **todos** los perfiles, incluido el que envenenó
    // la prueba de arriba: lo que se comprueba es que la suya esté, no que sea
    // la única.
    const suyo = res.body.revision.ejemplos.filter(
      (h: any) => h.motivo === 'monto' && h.valor === '99999999999999999',
    )
    assert.ok(suyo.length >= 1, 'no se dijo qué cifra se apartó')

    const movs = (await c.get(`/api/transactions?profileId=${perfil.id}`)).body
    const renglon = movs.find((t: any) => t.note === VENENO)
    assert.ok(renglon, 'la fila se perdió en el rescate')
    assert.equal(renglon.amountCents, 1)
  })

  /**
   * Y la magnitud que **no** es dinero. Una cantidad de existencias cae en la
   * misma trampa —es una columna INTEGER como cualquier otra— y el techo del
   * dinero no la cubría, así que el rescate tampoco la sacaba: el respaldo la
   * volvía a escribir tal cual y el libro volvía a cerrarse.
   */
  test('una cantidad ilegible que no es dinero también se aparta', async () => {
    const { perfil } = await libroBase(c, 'Almacén', 'negocio')
    const { db } = await import('../server/db.ts')
    const prod = (
      await c.post('/api/inventario', { profileId: perfil.id, name: 'Cemento', unit: 'kg' })
    ).body
    db.prepare(
      `INSERT INTO stock_moves (product_id, date, kind, qty_milli, unit_cost_cents)
       VALUES (?, '2026-07-12', 'entrada', 99999999999999999, 100)`,
    ).run(prod.id)

    const respaldo = (await c.get('/api/respaldo')).body
    assert.ok(respaldo.tables, 'el libro con existencias ilegibles no se pudo exportar')

    const res = await c.post('/api/respaldo/restaurar', respaldo)
    assert.equal(res.status, 200)
    const suyo = res.body.revision.ejemplos.filter((h: any) => h.motivo === 'cifra')
    assert.equal(suyo.length, 1)
    assert.equal(suyo[0].tabla, 'stock_moves')
    assert.equal(suyo[0].columna, 'qty_milli')
    assert.equal(res.body.revision.cifras, 1)
    assert.equal(res.body.revision.montos, 0, 'una cantidad no es un monto')

    // Y el almacén vuelve a abrir.
    const almacen = await c.get(`/api/inventario?profileId=${perfil.id}`)
    assert.equal(almacen.status, 200)
    assert.equal(almacen.body.productos[0].cantidadMilli, 1)
  })

  test('los enteros que sí caben no se tocan al restaurar', async () => {
    // La red de la revisión se amplió de `_cents` a toda columna INTEGER, y lo
    // que no puede pasar es que empiece a apartar lo que siempre estuvo bien.
    const { perfil } = await libroBase(c, 'Enteros', 'negocio')
    const prod = (
      await c.post('/api/inventario', {
        profileId: perfil.id, name: 'Arena', unit: 'kg', minQtyMilli: 5_000,
      })
    ).body
    await c.post('/api/inventario/movimientos', {
      profileId: perfil.id, productId: prod.id, date: '2026-07-12',
      kind: 'entrada', qtyMilli: 12_500, unitCostCents: 350,
    })
    const respaldo = (await c.get('/api/respaldo')).body
    const res = await c.post('/api/respaldo/restaurar', respaldo)
    assert.equal(res.body.revision.cifras, 0, 'apartó una cantidad que sí cabía')

    const almacen = (await c.get(`/api/inventario?profileId=${perfil.id}`)).body
    const suyo = almacen.productos.find((p: any) => p.name === 'Arena')
    assert.equal(suyo.cantidadMilli, 12_500)
    assert.equal(suyo.minQtyMilli, 5_000)
  })

  /**
   * La primera fila decidía por todas. Un archivo donde el primer renglón no
   * trae el concepto —editado a mano, unido de dos respaldos, escrito por otra
   * herramienta— hacía que la columna se cayera del INSERT y **todos** los
   * conceptos de la tabla se perdieran, con un 200 y sin un solo aviso.
   */
  test('una fila a la que le falta una columna no se lleva la de las demás', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Desparejo')
    for (const [monto, nota] of [[1_000, 'Primero'], [2_000, 'Segundo']] as const) {
      await c.post('/api/transactions', {
        profileId: perfil.id, accountId: cuenta.id, type: 'gasto',
        amountCents: monto, date: '2026-07-10', note: nota,
      })
    }
    const respaldo = (await c.get('/api/respaldo')).body
    const primera = respaldo.tables.transactions.find((t: any) => t.note === 'Primero')
    assert.ok(primera)
    delete primera.note

    const res = await c.post('/api/respaldo/restaurar', respaldo)
    assert.equal(res.status, 200)

    const movs = (await c.get(`/api/transactions?profileId=${perfil.id}`)).body
    const conceptos = movs.map((t: any) => t.note).sort()
    assert.deepEqual(conceptos, ['', 'Segundo'], 'la fila completa perdió su concepto')
  })

  test('los ejemplos se recortan y el total no', async () => {
    const { respaldo } = await respaldoCon('Muchos', () => {})
    // Doce fechas imposibles en el mismo libro: más que los ejemplos que se
    // devuelven, para ver que la cuenta grande no se recorta con ellos.
    for (const t of respaldo.tables.transactions) t.date = '2026-13-01'
    const total = respaldo.tables.transactions.length
    assert.ok(total >= 12, `hacían falta doce renglones y hay ${total}`)

    const res = await c.post('/api/respaldo/restaurar', respaldo)
    assert.equal(res.status, 200)
    assert.equal(res.body.revision.fechas, total, 'la cuenta grande se recortó')
    assert.equal(res.body.revision.ejemplos.length, 8, 'un aviso no es un volcado')
  })
})
