// Fase 17 · Resumen más denso.
//
// La vista más visitada era también la más plana: un total sin nada contra qué
// medirlo, cuentas con su cifra sola y un patrimonio en cuatro renglones. Lo
// que se agrega es todo derivado —ni una columna nueva—, así que lo que hay
// que probar es que las cifras **cuadran con las que ya se ven**:
//
//   · el total del mes pasado se resta contra el mismo total de arriba;
//   · el último punto de cada minigráfica es el saldo que la cuenta enseña;
//   · y nada de esto crece en consultas con el tamaño del libro (R11).
//
// `shared/fechas.ts` se importa estáticamente: es puro y no toca la base (R16).

import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { sumarDias } from '../shared/fechas.ts'
import { levantar, libroBase, type Cliente } from './ayuda.ts'
import type { Summary } from '../shared/types.ts'

let c: Cliente
before(async () => {
  c = await levantar()
})
after(() => c.cerrar())

const HOY = '2026-07-15'

const resumenDe = (perfil: number, mes = '2026-07', hoy = HOY): Promise<Summary> =>
  c.get(`/api/summary?profileId=${perfil}&month=${mes}&hoy=${hoy}`).then((r) => r.body)

const gastar = (perfil: number, cuenta: number, amountCents: number, date: string) =>
  c.post('/api/transactions', { profileId: perfil, accountId: cuenta, type: 'gasto', amountCents, date })

describe('el cambio contra el mes pasado', () => {
  test('la resta cuadra contra el total que se ve arriba', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Delta')
    // La cuenta abre con $1,000.00. Junio gastó $200 y julio $50: al cierre de
    // junio había $800, hoy hay $750.
    await gastar(perfil.id, cuenta.id, 20000, '2026-06-20')
    await gastar(perfil.id, cuenta.id, 5000, '2026-07-10')

    const r = await resumenDe(perfil.id)
    assert.equal(r.totalCents, 75000)
    assert.equal(r.totalPrevioCents, 80000, 'el cierre de junio, no el de hoy')
    assert.equal(r.totalCents - r.totalPrevioCents, -5000, 'y la resta es lo del mes')
  })

  test('la apertura de la cuenta no tiene fecha, y por eso el mes uno no miente', async () => {
    // Una cuenta abierta hoy ya "existía" al cierre del mes pasado con su
    // apertura: es la misma convención que la vista de Cuentas y el corte de
    // conciliación. Sin movimientos del mes, el cambio es cero, no el saldo
    // entero.
    const { perfil } = await libroBase(c, 'Recién abierta')
    const r = await resumenDe(perfil.id)
    assert.equal(r.totalPrevioCents, r.totalCents)
  })

  test('las cuentas archivadas quedan fuera de las dos cifras', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Archivada')
    const vieja = (
      await c.post('/api/accounts', {
        profileId: perfil.id,
        name: 'Vieja',
        type: 'banco',
        openingCents: 500000,
      })
    ).body
    await gastar(perfil.id, vieja.id, 100000, '2026-06-05')
    await c.patch(`/api/accounts/${vieja.id}`, { archived: true })

    const r = await resumenDe(perfil.id)
    assert.equal(r.totalCents, 100000, 'solo la cuenta activa')
    assert.equal(r.totalPrevioCents, 100000, 'y el mes pasado se mide igual')
    assert.equal(cuenta.id > 0, true)
  })
})

describe('los treinta días de cada cuenta', () => {
  test('el último punto es el saldo que la cuenta enseña', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Spark')
    await gastar(perfil.id, cuenta.id, 30000, '2026-07-08')

    const r = await resumenDe(perfil.id)
    assert.equal(r.sparks.hasta, HOY)
    assert.equal(r.sparks.desde, sumarDias(HOY, -29), '30 días contando hoy')

    const serie = r.sparks.porCuenta.find((s) => s.accountId === cuenta.id)!
    assert.equal(serie.puntos.length, 30)
    assert.equal(
      serie.puntos.at(-1),
      r.accounts.find((a) => a.id === cuenta.id)!.balanceCents,
      'la minigráfica y la cifra de al lado tienen que decir lo mismo',
    )
    // El escalón cae el día del gasto, no antes ni después.
    const i = 29 - 7 // 2026-07-08 está siete días antes de hoy
    assert.equal(serie.puntos[i - 1], 100000)
    assert.equal(serie.puntos[i], 70000)
  })

  test('un movimiento con fecha futura no corre la serie', async () => {
    // El saldo de una cuenta suma todos sus movimientos sin mirar la fecha, así
    // que armar la serie hacia atrás desde él dejaría los treinta días corridos
    // por lo que todavía no pasa. Es el mismo defecto que costó la Fase 16.
    const { perfil, cuenta } = await libroBase(c, 'Futuro')
    await gastar(perfil.id, cuenta.id, 25000, '2026-07-28')

    const r = await resumenDe(perfil.id)
    const serie = r.sparks.porCuenta.find((s) => s.accountId === cuenta.id)!
    assert.equal(r.accounts.find((a) => a.id === cuenta.id)!.balanceCents, 75000, 'ya está restado')
    assert.ok(
      serie.puntos.every((p) => p === 100000),
      'pero en estos treinta días no pasó nada',
    )
  })

  test('una transferencia mueve las dos cuentas, cada una para su lado', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Traspaso spark')
    const ahorro = (
      await c.post('/api/accounts', {
        profileId: perfil.id,
        name: 'Ahorro',
        type: 'ahorro',
        openingCents: 0,
      })
    ).body
    await c.post('/api/transactions', {
      profileId: perfil.id,
      accountId: cuenta.id,
      type: 'transferencia',
      amountCents: 40000,
      date: '2026-07-05',
      transferAccountId: ahorro.id,
    })

    const r = await resumenDe(perfil.id)
    const origen = r.sparks.porCuenta.find((s) => s.accountId === cuenta.id)!
    const destino = r.sparks.porCuenta.find((s) => s.accountId === ahorro.id)!
    assert.equal(origen.puntos.at(-1), 60000)
    assert.equal(destino.puntos.at(-1), 40000)
    assert.equal(origen.puntos[0], 100000, 'antes del traspaso, cada una donde estaba')
    assert.equal(destino.puntos[0], 0)
  })
})

// Fase 18 · el Resumen aplica D6.
//
// Hasta aquí esta vista sumaba `amount_cents` en crudo mientras Reportes,
// Análisis y el estado de resultados aplicaban la regla: un préstamo recibido
// salía como ingreso en la portada y no en el reporte del mismo mes. Dos
// verdades sobre el mismo peso es justo lo que D14 descartó y lo que R18
// prohíbe, y por eso lo que se prueba aquí no es una cifra suelta: es que las
// dos vistas **digan lo mismo**.
describe('las cifras del mes cuentan con la regla de D6', () => {
  const ingresar = (perfil: number, cuenta: number, amountCents: number, date: string, extra = {}) =>
    c.post('/api/transactions', {
      profileId: perfil, accountId: cuenta, type: 'ingreso', amountCents, date, ...extra,
    })

  test('un préstamo recibido no es ingreso de la portada', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Préstamo')
    await ingresar(perfil.id, cuenta.id, 500000, '2026-07-03')
    const antes = await resumenDe(perfil.id)
    assert.equal(antes.incomeCents, 500000)

    // El desembolso entra a la cuenta —el saldo sube— pero no lo ganaste.
    await c.post('/api/debts', {
      profileId: perfil.id, direction: 'por_pagar', counterparty: 'Nu',
      principalCents: 3000000, startDate: '2026-07-10', accountId: cuenta.id,
    })

    const r = await resumenDe(perfil.id)
    assert.equal(r.incomeCents, 500000, 'el préstamo no lo ganaste, lo debes')
    assert.equal(r.totalCents, antes.totalCents + 3000000, 'pero el dinero sí está ahí')
    const dia10 = r.byDay.find((d) => d.date === '2026-07-10')
    assert.equal(dia10, undefined, 'y el día del desembolso no es un día con actividad')
  })

  test('el Resumen y el reporte del mismo mes dan la misma cifra', async () => {
    const { perfil, cuenta, categorias } = await libroBase(c, 'Cuadre')
    const gasto = categorias.find((k: any) => k.kind === 'gasto')
    await ingresar(perfil.id, cuenta.id, 800000, '2026-07-02')
    await gastar(perfil.id, cuenta.id, 250000, '2026-07-05')
    const inv = (await c.post('/api/investments', { profileId: perfil.id, name: 'CETES', kind: 'cetes' })).body
    await c.post(`/api/investments/${inv.id}/entries`, {
      type: 'aporte', amountCents: 400000, date: '2026-07-08', accountId: cuenta.id,
    })
    await c.post('/api/transactions', {
      profileId: perfil.id, accountId: cuenta.id, type: 'gasto',
      amountCents: 90000, date: '2026-07-09', categoryId: gasto.id,
    })

    const r = await resumenDe(perfil.id)
    const anual = (await c.get(`/api/reportes?profileId=${perfil.id}&year=2026`)).body
    const julio = anual.meses.find((m: any) => m.month === '2026-07')
    assert.equal(r.incomeCents, julio.incomeCents, 'la portada y el reporte, la misma cifra')
    assert.equal(r.expenseCents, julio.expenseCents)
    assert.equal(r.expenseCents, 340000, 'el aporte a la inversión no es gasto')
  })

  test('un ticket dividido se reparte también aquí', async () => {
    // D17 llegó en la Fase 10 a los reportes y no al Resumen: la gráfica de
    // "en qué se fue el gasto" enseñaba el ticket entero en una sola categoría.
    const { perfil, cuenta, categorias } = await libroBase(c, 'Dividido')
    const gastos = categorias.filter((k: any) => k.kind === 'gasto')
    const [uno, dos] = [gastos[0], gastos[1]]
    await c.post('/api/transactions', {
      profileId: perfil.id, accountId: cuenta.id, type: 'gasto', amountCents: 90000,
      date: '2026-07-04', categoryId: uno.id,
      splits: [
        { categoryId: uno.id, amountCents: 60000 },
        { categoryId: dos.id, amountCents: 30000 },
      ],
    })

    const r = await resumenDe(perfil.id)
    assert.equal(r.expenseCents, 90000, 'el total del mes es el del ticket, no el de los renglones')
    const porNombre = new Map(r.byCategory.map((k) => [k.name, k.expenseCents]))
    assert.equal(porNombre.get(uno.name), 60000)
    assert.equal(porNombre.get(dos.name), 30000)
  })

  test('una devolución baja su gasto en vez de inflar el ingreso', async () => {
    const { perfil, cuenta, categorias } = await libroBase(c, 'Devolución')
    const ropa = categorias.filter((k: any) => k.kind === 'gasto')[0]
    const compra = (
      await c.post('/api/transactions', {
        profileId: perfil.id, accountId: cuenta.id, type: 'gasto',
        amountCents: 120000, date: '2026-07-06', categoryId: ropa.id,
      })
    ).body
    await ingresar(perfil.id, cuenta.id, 45000, '2026-07-12', { refundOfId: compra.id })

    const r = await resumenDe(perfil.id)
    assert.equal(r.incomeCents, 0, 'devolver una camisa no es ingreso')
    assert.equal(r.expenseCents, 75000, 'es gasto que no acabaste haciendo')
    const porNombre = new Map(r.byCategory.map((k) => [k.name, k.expenseCents]))
    assert.equal(porNombre.get(ropa.name), 75000, 'y baja la categoría del gasto original')
  })

  test('el depósito de un inquilino no es ingreso de nadie', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Depósito')
    await c.put(`/api/profiles/${perfil.id}/modules`, { modules: ['inmuebles'] })
    const bien = (
      await c.post('/api/bienes', {
        profileId: perfil.id, name: 'Depto', kind: 'inmueble',
        costCents: 100000000, acquiredDate: '2025-01-01',
      })
    ).body
    const renta = (
      await c.post('/api/inmuebles', {
        profileId: perfil.id, assetId: bien.id, tenant: 'Ana',
        rentCents: 1500000, dueDay: 5, startDate: '2026-01-01',
      })
    ).body
    await ingresar(perfil.id, cuenta.id, 1500000, '2026-07-05', {
      rentalId: renta.id, rentalRole: 'renta',
    })
    await ingresar(perfil.id, cuenta.id, 1500000, '2026-07-06', {
      rentalId: renta.id, rentalRole: 'deposito',
    })

    const r = await resumenDe(perfil.id)
    assert.equal(r.incomeCents, 1500000, 'la renta sí, el depósito no: lo tienes y lo debes')

    // Y al borrar el contrato el papel se va con él, que es lo que el aviso
    // promete. Sin eso quedaba un `rental_role` huérfano —un estado que el
    // validador rechaza al escribir— y el depósito no contaba nunca.
    const borrado = await c.del(`/api/inmuebles/${renta.id}?profileId=${perfil.id}`)
    assert.equal(borrado.body.depositos, 1)
    const despues = await resumenDe(perfil.id)
    assert.equal(despues.incomeCents, 3000000, 'sin contrato vuelve a ser ingreso, como avisó')
  })
})

describe('R11 · el Resumen no crece con el libro', () => {
  async function sembrar(nombre: string, cuentas: number, movs: number) {
    const { perfil, cuenta, categorias } = await libroBase(c, nombre)
    const gasto = categorias.find((k: any) => k.kind === 'gasto')
    const ids = [cuenta.id]
    for (let i = 0; i < cuentas; i++) {
      ids.push(
        (
          await c.post('/api/accounts', {
            profileId: perfil.id,
            name: `Cuenta ${i}`,
            type: 'banco',
            openingCents: 100000,
          })
        ).body.id,
      )
    }
    for (let i = 0; i < movs; i++) {
      await c.post('/api/transactions', {
        profileId: perfil.id,
        accountId: ids[i % ids.length],
        type: 'gasto',
        amountCents: 100 + i,
        date: `2026-07-${String((i % 14) + 1).padStart(2, '0')}`,
        categoryId: gasto.id,
      })
    }
    return perfil
  }

  test('las mismas consultas con una cuenta que con diez', async () => {
    const chico = await sembrar('Resumen chico', 1, 6)
    const grande = await sembrar('Resumen grande', 10, 200)

    const { db } = await import('../server/db.ts')
    const original = db.prepare.bind(db)
    let consultas = 0
    ;(db as any).prepare = (sql: string) => {
      consultas++
      return original(sql)
    }

    try {
      consultas = 0
      await resumenDe(chico.id)
      const nChico = consultas

      consultas = 0
      const r = await resumenDe(grande.id)
      const nGrande = consultas

      assert.equal(r.sparks.porCuenta.length, 11, 'once cuentas, once minigráficas')
      assert.equal(nGrande, nChico, 'ni una consulta por cuenta ni por día')
      // Diez: las ocho de siempre —cuentas, totales del mes, por día, por
      // categoría, recientes, deudas, inversiones y bienes— más las dos de esta
      // fase. Y las dos son dos a propósito: los saldos de las dos fechas caben
      // en una consulta (el cierre del mes pasado y el arranque de la ventana)
      // y el movimiento diario de todas las cuentas en otra. Con una por
      // cuenta, once cuentas serían once consultas más.
      assert.ok(nGrande <= 10, `son ${nGrande} consultas por carga del Resumen`)
    } finally {
      ;(db as any).prepare = original
    }
  })
})
