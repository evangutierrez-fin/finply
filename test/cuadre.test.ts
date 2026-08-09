// Fase 10 · el libro que cuadra.
//
// Las tres invariantes que estas pruebas defienden, y que son la fase entera:
//
//  1. **Dividir no mueve una cifra.** El movimiento sigue siendo uno solo y
//     vale lo mismo; lo único que cambia es a qué categorías se reparte. Si un
//     saldo o un patrimonio se mueve al dividir, D17 está mal implementada.
//  2. **Una devolución no es un ingreso.** Baja el gasto del mes y la categoría
//     donde se gastó. Es lo que evita que devolver una camisa suba la tasa de
//     ahorro, que es exactamente lo que pasaba antes.
//  3. **Conciliar no cambia nada.** La bandera y el corte comprueban; no
//     corrigen. Un corte que cuadra hoy vuelve a descuadrar solo si se desmarca
//     una partida, porque todo lo derivado se calcula al leer.

import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { levantar, libroBase, type Cliente } from './ayuda.ts'

let c: Cliente
let perfil: any
let cuenta: any
let categorias: any[]

before(async () => {
  c = await levantar()
  const base = await libroBase(c)
  perfil = base.perfil
  cuenta = base.cuenta
  categorias = base.categorias
})
after(async () => c.cerrar())

const gastoDe = (nombre: string) =>
  categorias.find((x) => x.kind === 'gasto' && x.name === nombre)!
const ingresoDe = (nombre: string) =>
  categorias.find((x) => x.kind === 'ingreso' && x.name === nombre)!

/** Un gasto sencillo, que es el punto de partida de casi todo lo de abajo. */
async function gasto(amountCents: number, date: string, extra: Record<string, unknown> = {}) {
  const res = await c.post('/api/transactions', {
    profileId: perfil.id,
    accountId: cuenta.id,
    type: 'gasto',
    amountCents,
    date,
    categoryId: gastoDe('Comida').id,
    note: 'Ticket',
    ...extra,
  })
  return res
}

async function saldoCuenta(): Promise<number> {
  const cuentas = (await c.get(`/api/accounts?profileId=${perfil.id}`)).body as any[]
  return cuentas.find((x) => x.id === cuenta.id)!.balanceCents
}

describe('partida dividida', () => {
  test('los renglones tienen que sumar exactamente el movimiento', async () => {
    const res = await gasto(100000, '2026-03-02', {
      splits: [
        { categoryId: gastoDe('Súper').id, amountCents: 60000 },
        { categoryId: gastoDe('Salud').id, amountCents: 30000 },
      ],
    })
    assert.equal(res.status, 400)
    assert.match(JSON.stringify(res.body), /suman 900 y el movimiento es 1000/)
  })

  test('un solo renglón no es dividir, y una transferencia no se divide', async () => {
    const uno = await gasto(50000, '2026-03-03', {
      splits: [{ categoryId: gastoDe('Súper').id, amountCents: 50000 }],
    })
    assert.equal(uno.status, 400)
    assert.match(JSON.stringify(uno.body), /al menos dos renglones/)

    const otra = (
      await c.post('/api/accounts', { profileId: perfil.id, name: 'Efectivo', type: 'efectivo' })
    ).body
    const transferencia = await c.post('/api/transactions', {
      profileId: perfil.id,
      accountId: cuenta.id,
      type: 'transferencia',
      transferAccountId: otra.id,
      amountCents: 20000,
      date: '2026-03-03',
      splits: [
        { categoryId: gastoDe('Súper').id, amountCents: 10000 },
        { categoryId: gastoDe('Salud').id, amountCents: 10000 },
      ],
    })
    assert.equal(transferencia.status, 400)
    assert.match(JSON.stringify(transferencia.body), /no se divide/)
  })

  test('un renglón no puede apuntar a una categoría de otro tipo', async () => {
    const res = await gasto(30000, '2026-03-04', {
      splits: [
        { categoryId: gastoDe('Súper').id, amountCents: 20000 },
        { categoryId: ingresoDe('Sueldo').id, amountCents: 10000 },
      ],
    })
    assert.equal(res.status, 400)
    assert.match(JSON.stringify(res.body), /categoría es de ingreso/)
  })

  test('dividir no mueve el saldo ni el patrimonio, y el ticket sigue siendo uno', async () => {
    const antes = await saldoCuenta()
    const res = await gasto(120000, '2026-04-05', {
      splits: [
        { categoryId: gastoDe('Súper').id, amountCents: 70000, note: 'despensa' },
        { categoryId: gastoDe('Salud').id, amountCents: 35000, note: 'farmacia' },
        { categoryId: gastoDe('Ocio').id, amountCents: 15000 },
      ],
    })
    assert.equal(res.status, 201)
    const tx = res.body

    // Un movimiento, no tres: el ticket se parece al ticket.
    const listado = (
      await c.get(`/api/transactions?profileId=${perfil.id}&from=2026-04-05&to=2026-04-05`)
    ).body as any[]
    assert.equal(listado.length, 1)
    assert.equal(listado[0]!.amountCents, 120000)
    assert.equal(listado[0]!.splits.length, 3)

    // Y no tiene categoría propia: la tienen sus renglones. Dos verdades sobre
    // el mismo ticket serían dos gastos por categoría distintos.
    assert.equal(tx.categoryId, null)
    assert.deepEqual(
      tx.splits.map((r: any) => [r.categoryName, r.amountCents]),
      [['Súper', 70000], ['Salud', 35000], ['Ocio', 15000]],
    )

    assert.equal(await saldoCuenta(), antes - 120000, 'el saldo baja el total, ni más ni menos')
  })

  test('el gasto por categoría reparte el ticket y sigue sumando el total', async () => {
    const reporte = (await c.get(`/api/reportes?profileId=${perfil.id}&year=2026`)).body
    const porCategoria = new Map<string, number>(
      reporte.porCategoria.map((x: any) => [x.name, x.expenseCents]),
    )
    // El ticket de $1,200 se repartió en tres, y cada categoría trae lo suyo.
    assert.equal(porCategoria.get('Súper'), 70000)
    assert.equal(porCategoria.get('Salud'), 35000)
    assert.equal(porCategoria.get('Ocio'), 15000)

    // La invariante que de verdad importa: la suma de las categorías es el
    // gasto del año. Si el reparto se contara mal, aquí saldría el doble.
    const suma = reporte.porCategoria.reduce((s: number, x: any) => s + x.expenseCents, 0)
    assert.equal(suma, reporte.totales.expenseCents)
  })

  test('cambiar el monto sin mandar renglones descarta el reparto en vez de descuadrarlo', async () => {
    const tx = (
      await gasto(80000, '2026-05-10', {
        splits: [
          { categoryId: gastoDe('Súper').id, amountCents: 50000 },
          { categoryId: gastoDe('Salud').id, amountCents: 30000 },
        ],
      })
    ).body

    const res = await c.patch(`/api/transactions/${tx.id}`, {
      profileId: perfil.id,
      accountId: cuenta.id,
      type: 'gasto',
      amountCents: 95000,
      date: '2026-05-10',
      categoryId: gastoDe('Comida').id,
      note: 'Ticket corregido',
    })
    assert.equal(res.status, 200)
    assert.equal(res.body.splits.length, 0, 'un reparto que ya no suma el total no se conserva')
    assert.equal(res.body.categoryId, gastoDe('Comida').id)
  })

  test('el presupuesto cuenta el renglón, no el ticket entero', async () => {
    await c.post('/api/budgets', {
      profileId: perfil.id,
      categoryId: gastoDe('Súper').id,
      period: '2026-06',
      amountCents: 100000,
    })
    await gasto(90000, '2026-06-03', {
      splits: [
        { categoryId: gastoDe('Súper').id, amountCents: 30000 },
        { categoryId: gastoDe('Ocio').id, amountCents: 60000 },
      ],
    })
    const presupuestos = (
      await c.get(`/api/budgets?profileId=${perfil.id}&month=2026-06`)
    ).body.mensuales as any[]
    const superr = presupuestos.find((b) => b.categoryId === gastoDe('Súper').id)!
    assert.equal(superr.spentCents, 30000, 'solo el renglón de Súper, no los $900 del ticket')
  })

  test('una categoría usada solo en un renglón sigue estando en uso', async () => {
    const nueva = (
      await c.post('/api/categories', { profileId: perfil.id, name: 'Ferretería', kind: 'gasto' })
    ).body
    const destino = (
      await c.post('/api/categories', { profileId: perfil.id, name: 'Hogar', kind: 'gasto' })
    ).body
    const tx = (
      await gasto(40000, '2026-07-02', {
        splits: [
          { categoryId: nueva.id, amountCents: 25000 },
          { categoryId: gastoDe('Ocio').id, amountCents: 15000 },
        ],
      })
    ).body

    const conflicto = await c.del(`/api/categories/${nueva.id}`)
    assert.equal(conflicto.status, 409, 'está en uso aunque ninguna partida la lleve arriba')
    assert.equal(conflicto.body.txCount, 1)

    const borrado = await c.del(`/api/categories/${nueva.id}?reassignTo=${destino.id}`)
    assert.equal(borrado.status, 200)
    const despues = (await c.get(`/api/transactions?profileId=${perfil.id}`)).body as any[]
    const ticket = despues.find((t) => t.id === tx.id)!
    assert.equal(ticket.splits[0]!.categoryName, 'Hogar', 'el renglón se movió, no se quedó en nulo')
  })
})

describe('reembolso ligado', () => {
  let compra: any

  test('una devolución entra al libro pero no cuenta como ingreso del mes', async () => {
    const ropa = (
      await c.post('/api/categories', { profileId: perfil.id, name: 'Ropa', kind: 'gasto' })
    ).body
    compra = (
      await c.post('/api/transactions', {
        profileId: perfil.id,
        accountId: cuenta.id,
        type: 'gasto',
        amountCents: 200000,
        date: '2026-09-03',
        categoryId: ropa.id,
        note: 'Tres camisas',
      })
    ).body

    const antes = (await c.get(`/api/reportes?profileId=${perfil.id}&year=2026`)).body
    const saldoAntes = await saldoCuenta()

    const devolucion = await c.post('/api/transactions', {
      profileId: perfil.id,
      accountId: cuenta.id,
      type: 'ingreso',
      amountCents: 70000,
      date: '2026-09-20',
      note: 'Devolví una',
      refundOfId: compra.id,
    })
    assert.equal(devolucion.status, 201)

    // El dinero sí entró a la cuenta: eso no se discute.
    assert.equal(await saldoCuenta(), saldoAntes + 70000)

    const despues = (await c.get(`/api/reportes?profileId=${perfil.id}&year=2026`)).body
    const mes = (r: any) => r.meses.find((m: any) => m.month === '2026-09')
    assert.equal(mes(despues).incomeCents, mes(antes).incomeCents, 'el ingreso del mes no se mueve')
    assert.equal(
      mes(despues).expenseCents,
      mes(antes).expenseCents - 70000,
      'lo que baja es el gasto: no ganaste $700, dejaste de gastarlos',
    )
  })

  test('la devolución baja la categoría donde se gastó', async () => {
    const reporte = (await c.get(`/api/reportes?profileId=${perfil.id}&year=2026`)).body
    const ropa = reporte.porCategoria.find((x: any) => x.name === 'Ropa')
    assert.equal(ropa.expenseCents, 130000, '$2,000 menos los $700 devueltos')
    assert.ok(
      !reporte.porCategoria.some((x: any) => x.name === 'Otros' && x.expenseCents < 0),
      'la devolución no aparece como su propia categoría',
    )
  })

  test('no se puede devolver más de lo que costó', async () => {
    const res = await c.post('/api/transactions', {
      profileId: perfil.id,
      accountId: cuenta.id,
      type: 'ingreso',
      amountCents: 140000,
      date: '2026-09-25',
      refundOfId: compra.id,
    })
    assert.equal(res.status, 400)
    assert.match(JSON.stringify(res.body), /no se puede devolver de más/)
  })

  test('solo se devuelve un gasto, y no una devolución', async () => {
    const sueldo = (
      await c.post('/api/transactions', {
        profileId: perfil.id,
        accountId: cuenta.id,
        type: 'ingreso',
        amountCents: 500000,
        date: '2026-09-01',
        categoryId: ingresoDe('Sueldo').id,
      })
    ).body
    const deUnIngreso = await c.post('/api/transactions', {
      profileId: perfil.id,
      accountId: cuenta.id,
      type: 'ingreso',
      amountCents: 1000,
      date: '2026-09-26',
      refundOfId: sueldo.id,
    })
    assert.equal(deUnIngreso.status, 400)
    assert.match(JSON.stringify(deUnIngreso.body), /Solo se devuelve un gasto/)

    // Una devolución tiene que ir como ingreso: es dinero que entra.
    const comoGasto = await c.post('/api/transactions', {
      profileId: perfil.id,
      accountId: cuenta.id,
      type: 'gasto',
      amountCents: 1000,
      date: '2026-09-26',
      categoryId: gastoDe('Comida').id,
      refundOfId: compra.id,
    })
    assert.equal(comoGasto.status, 400)
  })

  test('anular el gasto original deja la devolución en el libro y vuelve a ser ingreso', async () => {
    const suelta = (
      await c.post('/api/transactions', {
        profileId: perfil.id,
        accountId: cuenta.id,
        type: 'gasto',
        amountCents: 50000,
        date: '2026-11-05',
        categoryId: gastoDe('Ocio').id,
      })
    ).body
    const devolucion = (
      await c.post('/api/transactions', {
        profileId: perfil.id,
        accountId: cuenta.id,
        type: 'ingreso',
        amountCents: 20000,
        date: '2026-11-08',
        categoryId: ingresoDe('Otros').id,
        refundOfId: suelta.id,
      })
    ).body

    const conLiga = (await c.get(`/api/reportes?profileId=${perfil.id}&year=2026`)).body
    const nov = (r: any) => r.meses.find((m: any) => m.month === '2026-11')
    assert.equal(nov(conLiga).incomeCents, 0)
    assert.equal(nov(conLiga).expenseCents, 30000, '$500 de gasto menos $200 devueltos')

    assert.equal((await c.del(`/api/transactions/${suelta.id}`)).status, 200)

    const listado = (await c.get(`/api/transactions?profileId=${perfil.id}`)).body as any[]
    const sigue = listado.find((t) => t.id === devolucion.id)
    assert.ok(sigue, 'ese dinero entró a la cuenta: el movimiento no se evapora')
    assert.equal(sigue.refundOfId, null, 'solo se pierde la liga')

    const sinLiga = (await c.get(`/api/reportes?profileId=${perfil.id}&year=2026`)).body
    assert.equal(nov(sinLiga).incomeCents, 20000, 'sin gasto que bajar, vuelve a ser ingreso')
    assert.equal(nov(sinLiga).expenseCents, 0)
  })
})

describe('conciliación', () => {
  let cuentaC: any
  let movs: any[]

  before(async () => {
    cuentaC = (
      await c.post('/api/accounts', {
        profileId: perfil.id,
        name: 'Nómina',
        type: 'banco',
        openingCents: 500000,
      })
    ).body
    movs = []
    for (const [monto, dia] of [[120000, '01'], [80000, '05'], [45000, '09']] as const) {
      movs.push(
        (
          await c.post('/api/transactions', {
            profileId: perfil.id,
            accountId: cuentaC.id,
            type: 'gasto',
            amountCents: monto,
            date: `2026-10-${dia}`,
            categoryId: gastoDe('Comida').id,
          })
        ).body,
      )
    }
  })

  test('marcar no mueve una sola cifra', async () => {
    const antes = (await c.get(`/api/summary?profileId=${perfil.id}`)).body
    const res = await c.post('/api/transactions/conciliar', {
      profileId: perfil.id,
      txIds: [movs[0]!.id, movs[1]!.id],
      reconciled: true,
    })
    assert.equal(res.status, 200)
    assert.equal(res.body.cambiados, 2)
    const despues = (await c.get(`/api/summary?profileId=${perfil.id}`)).body
    assert.deepEqual(despues, antes, 'conciliar comprueba; no corrige')
  })

  test('el corte dice cuánto falta y cuántas partidas lo explican', async () => {
    // El banco dice que al 9 de octubre quedaban $3,000: apertura $5,000
    // menos los tres cargos. Pero solo dos están palomeados.
    const corte = await c.post('/api/conciliacion', {
      profileId: perfil.id,
      accountId: cuentaC.id,
      date: '2026-10-09',
      balanceCents: 255000,
      note: 'Estado de cuenta de octubre',
    })
    assert.equal(corte.status, 201)
    assert.equal(corte.body.libroCents, 255000, 'el libro entero sí cuadra')
    assert.equal(corte.body.conciliadoCents, 300000, 'lo palomeado va $450 arriba')
    assert.equal(corte.body.diferenciaCents, -45000)
    assert.equal(corte.body.pendientes, 1, 'y hay exactamente una partida sin marcar')
    assert.equal(corte.body.pendientesCents, -45000, 'que explica la diferencia entera')
  })

  test('palomear la que faltaba deja el corte en cero, y desmarcarla lo descuadra otra vez', async () => {
    await c.post('/api/transactions/conciliar', {
      profileId: perfil.id,
      txIds: [movs[2]!.id],
      reconciled: true,
    })
    const cuadra = (await c.get(`/api/conciliacion?profileId=${perfil.id}`)).body as any[]
    assert.equal(cuadra[0]!.diferenciaCents, 0)
    assert.equal(cuadra[0]!.pendientes, 0)

    await c.post('/api/transactions/conciliar', {
      profileId: perfil.id,
      txIds: [movs[2]!.id],
      reconciled: false,
    })
    const otraVez = (await c.get(`/api/conciliacion?profileId=${perfil.id}`)).body as any[]
    assert.equal(otraVez[0]!.diferenciaCents, -45000, 'todo es derivado: nada se quedó guardado')
  })

  test('volver a declarar el mismo corte lo corrige en vez de duplicarlo', async () => {
    await c.post('/api/conciliacion', {
      profileId: perfil.id,
      accountId: cuentaC.id,
      date: '2026-10-09',
      balanceCents: 300000,
    })
    const cortes = (
      await c.get(`/api/conciliacion?profileId=${perfil.id}&accountId=${cuentaC.id}`)
    ).body as any[]
    assert.equal(cortes.length, 1, 'un día, un corte')
    assert.equal(cortes[0]!.balanceCents, 300000)
  })

  test('el filtro separa lo palomeado de lo pendiente', async () => {
    const pendientes = (
      await c.get(`/api/transactions?profileId=${perfil.id}&accountId=${cuentaC.id}&conciliado=no`)
    ).body as any[]
    assert.equal(pendientes.length, 1)
    assert.equal(pendientes[0]!.id, movs[2]!.id)
  })
})

describe('duplicar y adjuntar', () => {
  test('duplicar copia lo que se volvería a teclear y nada más', async () => {
    const etiqueta = (await c.post('/api/tags', { profileId: perfil.id, name: 'quincenal' })).body
    const original = (
      await gasto(60000, '2026-12-01', {
        tagIds: [etiqueta.id],
        splits: [
          { categoryId: gastoDe('Súper').id, amountCents: 40000 },
          { categoryId: gastoDe('Ocio').id, amountCents: 20000 },
        ],
      })
    ).body

    const copia = await c.post(`/api/transactions/${original.id}/duplicar`, { date: '2026-12-15' })
    assert.equal(copia.status, 201)
    assert.notEqual(copia.body.id, original.id)
    assert.equal(copia.body.amountCents, 60000)
    assert.equal(copia.body.date, '2026-12-15')
    assert.equal(copia.body.splits.length, 2, 'el reparto se copia: es lo más caro de teclear')
    assert.deepEqual(copia.body.tags.map((t: any) => t.name), ['quincenal'])
    assert.equal(copia.body.reconciledAt, null, 'una copia nace sin palomear')
    assert.equal(copia.body.refundOfId, null)
  })

  test('el recibo se adjunta, se lista sin bytes y se descarga igual', async () => {
    const tx = (await gasto(15000, '2026-12-20')).body
    const bytes = Buffer.from('finply-recibo-de-prueba')
    const subida = await c.post(`/api/transactions/${tx.id}/adjuntos`, {
      filename: 'ticket.png',
      mime: 'image/png',
      dataB64: bytes.toString('base64'),
    })
    assert.equal(subida.status, 201)
    assert.equal(subida.body.sizeBytes, bytes.length)

    // El listado trae la ficha, nunca el archivo: un mes de tickets serían
    // decenas de megas en cada carga de Movimientos.
    const listado = (
      await c.get(`/api/transactions?profileId=${perfil.id}&from=2026-12-20&to=2026-12-20`)
    ).body as any[]
    assert.equal(listado[0]!.attachments.length, 1)
    assert.equal(listado[0]!.attachments[0]!.filename, 'ticket.png')
    assert.ok(!('dataB64' in listado[0]!.attachments[0]!))

    const bajada = await c.getBytes(`/api/transactions/${tx.id}/adjuntos/${subida.body.id}`)
    assert.equal(bajada.status, 200)
    assert.deepEqual(Buffer.from(bajada.body), bytes, 'los bytes vuelven idénticos')
    // Se descarga, no se abre en la pestaña: el archivo lo subió el usuario.
    assert.match(bajada.headers['content-disposition']!, /^attachment/)
  })

  test('lo que no es un recibo no entra', async () => {
    const tx = (await gasto(1000, '2026-12-21')).body
    const tipo = await c.post(`/api/transactions/${tx.id}/adjuntos`, {
      filename: 'raro.exe',
      mime: 'application/x-msdownload',
      dataB64: Buffer.from('MZ').toString('base64'),
    })
    assert.equal(tipo.status, 400)

    const grande = await c.post(`/api/transactions/${tx.id}/adjuntos`, {
      filename: 'enorme.png',
      mime: 'image/png',
      dataB64: 'A'.repeat(4 * 1024 * 1024),
    })
    assert.equal(grande.status, 400)
    assert.match(JSON.stringify(grande.body), /tope/)
  })

  /**
   * El nombre de un recibo acaba en tres sitios: una cabecera HTTP, una ruta
   * dentro del .zip y el respaldo. Solo el .zip lo cortaba.
   *
   * Un salto de línea es el separador entre dos cabeceras, así que Node se
   * niega a mandar la respuesta: el recibo se subía con un 201 y después
   * **contestaba 500 para siempre**. Entró al libro y ya no salía, que es el
   * mismo modo de fallar de una cifra ilegible.
   */
  test('un recibo con un nombre imposible se sube saneado y se puede bajar', async () => {
    const tx = (await gasto(3000, '2026-12-23')).body
    const subida = await c.post(`/api/transactions/${tx.id}/adjuntos`, {
      filename: 'recibo\r\nX-Inyectado: si.pdf',
      mime: 'application/pdf',
      dataB64: Buffer.from('%PDF-1.4').toString('base64'),
    })
    assert.equal(subida.status, 201)
    assert.ok(!/[\r\n]/.test(subida.body.filename), 'el salto de línea entró al libro')

    const bajada = await c.getBytes(`/api/transactions/${tx.id}/adjuntos/${subida.body.id}`)
    assert.equal(bajada.status, 200, 'el recibo entró y ya no podía salir')
    assert.match(bajada.headers['content-disposition']!, /^attachment/)
  })

  test('y un nombre que es una ruta sale como nombre, no como ruta', async () => {
    const tx = (await gasto(3100, '2026-12-24')).body
    const subida = await c.post(`/api/transactions/${tx.id}/adjuntos`, {
      filename: '../../../.ssh/authorized_keys',
      mime: 'application/pdf',
      dataB64: Buffer.from('%PDF-1.4').toString('base64'),
    })
    assert.equal(subida.status, 201)
    assert.ok(!subida.body.filename.includes('/'), 'la ruta se guardó tal cual')
    assert.ok(!subida.body.filename.startsWith('.'))

    const bajada = await c.getBytes(`/api/transactions/${tx.id}/adjuntos/${subida.body.id}`)
    assert.ok(
      !bajada.headers['content-disposition']!.includes('../'),
      'la cabecera de bajada seguía mandando la ruta entera',
    )
  })

  test('borrar el movimiento se lleva su recibo', async () => {
    const tx = (await gasto(2000, '2026-12-22')).body
    const subida = await c.post(`/api/transactions/${tx.id}/adjuntos`, {
      filename: 'nota.pdf',
      mime: 'application/pdf',
      dataB64: Buffer.from('%PDF-1.4').toString('base64'),
    })
    await c.del(`/api/transactions/${tx.id}`)
    const huerfano = await c.get(`/api/transactions/${tx.id}/adjuntos/${subida.body.id}`)
    assert.equal(huerfano.status, 404)
  })
})

describe('el respaldo se lleva todo lo de esta fase', () => {
  test('reparto, corte y recibo sobreviven a exportar y restaurar', async () => {
    const antes = (await c.get('/api/respaldo')).body
    assert.ok(antes.tables.tx_splits.length > 0, 'el reparto viaja en el respaldo')
    assert.ok(antes.tables.account_statements.length > 0)
    assert.ok(antes.tables.tx_attachments.length > 0)

    const movsAntes = (await c.get(`/api/transactions?profileId=${perfil.id}`)).body as any[]
    const cortesAntes = (await c.get(`/api/conciliacion?profileId=${perfil.id}`)).body as any[]

    const restaurado = await c.post('/api/respaldo/restaurar', antes)
    assert.equal(restaurado.status, 200)

    const movsDespues = (await c.get(`/api/transactions?profileId=${perfil.id}`)).body as any[]
    assert.deepEqual(movsDespues, movsAntes, 'el libro vuelve idéntico, renglón por renglón')
    const cortesDespues = (await c.get(`/api/conciliacion?profileId=${perfil.id}`)).body as any[]
    assert.deepEqual(cortesDespues, cortesAntes)
  })
})
