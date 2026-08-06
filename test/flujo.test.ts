// Fase 16 · Flujo: ¿llego a fin de mes?
//
// La proyección es de solo lectura y no inventa una fecha, así que lo que hay
// que probar no es "sale un número": es que ese número **cuadre** y que se
// pueda seguir con el dedo.
//
// Tres invariantes gobiernan el archivo:
//
//   1. Saldo inicial + entradas − salidas = saldo final, y los eventos
//      listados son exactamente esos sumandos. Sin eso, la vista enseña una
//      cifra que nadie puede auditar.
//   2. La caja de hoy es **a hoy**: una partida que el usuario ya asentó para
//      el viernes no puede estar descontada del lunes y además no aparecer.
//   3. Lo que no se sabe no se supone: un pago de tarjeta sin corte todavía no
//      entra en la cuenta, y se dice cuántos son.
//
// `shared/fechas.ts` se importa estáticamente: es puro y no toca la base (R16).

import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { finDeMes, sumarDias } from '../shared/fechas.ts'
import { levantar, libroBase, type Cliente } from './ayuda.ts'
import type { FlujoProyectado } from '../shared/types.ts'

let c: Cliente
before(async () => {
  c = await levantar()
})
after(() => c.cerrar())

const HOY = '2026-07-15'

const flujoDe = (perfil: number, dias = 30, hoy = HOY): Promise<FlujoProyectado> =>
  c.get(`/api/flujo?profileId=${perfil}&dias=${dias}&hoy=${hoy}`).then((r) => r.body)

/** Suma de los eventos listados, por lado. Es la auditoría hecha a mano. */
function sumaEventos(f: FlujoProyectado) {
  let entra = 0
  let sale = 0
  for (const e of f.eventos) {
    if (e.direccion === 'entra') entra += e.montoCents ?? 0
    else sale += e.montoCents ?? 0
  }
  return { entra, sale }
}

describe('el fin de mes (aritmética pura)', () => {
  test('el horizonte de la pregunta es el último día del mes', () => {
    assert.equal(finDeMes('2026-07-15'), '2026-07-31')
    assert.equal(finDeMes('2026-07-31'), '2026-07-31', 'el día 31 ya es fin de mes')
    assert.equal(finDeMes('2026-02-01'), '2026-02-28')
    assert.equal(finDeMes('2024-02-10'), '2024-02-29', 'bisiesto')
    assert.equal(finDeMes('2026-04-30'), '2026-04-30')
  })
})

describe('la cuenta cuadra', () => {
  test('sin nada comprometido, la caja no se mueve y se dice', async () => {
    const { perfil } = await libroBase(c, 'Flujo en calma')
    const f = await flujoDe(perfil.id)

    assert.equal(f.saldoInicialCents, 100000, 'la apertura de la cuenta')
    assert.equal(f.saldoFinalCents, 100000)
    assert.equal(f.entradasCents, 0)
    assert.equal(f.salidasCents, 0)
    assert.equal(f.eventos.length, 0)
    assert.equal(f.primerDiaEnRojo, null, 'no hay día en rojo que anunciar')
    assert.deepEqual(f.minimo, { fecha: HOY, saldoCents: 100000 })
  })

  test('saldo inicial + entradas − salidas = saldo final, y los eventos son los sumandos', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Flujo que cuadra')
    // Una quincena que entra y una renta que sale, las dos por recurrencia.
    await c.post('/api/recurrencias', {
      profileId: perfil.id,
      accountId: cuenta.id,
      type: 'ingreso',
      amountCents: 800000,
      note: 'Sueldo',
      frequency: 'mensual',
      dayOfMonth: 20,
      startDate: '2026-07-20',
    })
    await c.post('/api/recurrencias', {
      profileId: perfil.id,
      accountId: cuenta.id,
      type: 'gasto',
      amountCents: 650000,
      note: 'Renta',
      frequency: 'mensual',
      dayOfMonth: 25,
      startDate: '2026-07-25',
    })

    const f = await flujoDe(perfil.id)
    assert.equal(f.entradasCents, 800000)
    assert.equal(f.salidasCents, 650000)
    assert.equal(
      f.saldoFinalCents,
      f.saldoInicialCents + f.entradasCents - f.salidasCents,
      'la identidad que vuelve auditable la proyección',
    )
    const suma = sumaEventos(f)
    assert.equal(suma.entra, f.entradasCents, 'los renglones suman lo que dice el total')
    assert.equal(suma.sale, f.salidasCents)
  })

  test('la serie es continua: un punto por día, incluidos los días sin nada', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Serie continua')
    await c.post('/api/transactions', {
      profileId: perfil.id,
      accountId: cuenta.id,
      type: 'gasto',
      amountCents: 30000,
      date: '2026-07-20',
      note: 'Cheque firmado',
    })

    const f = await flujoDe(perfil.id, 30)
    assert.equal(f.puntos.length, 31, '30 días son 31 puntos, contando hoy')
    assert.equal(f.puntos[0]!.fecha, HOY)
    assert.equal(f.puntos[0]!.saldoCents, f.saldoInicialCents)
    assert.equal(f.puntos.at(-1)!.fecha, f.hasta)
    assert.equal(f.puntos.at(-1)!.saldoCents, f.saldoFinalCents)
    // El día del gasto baja de golpe y el siguiente se queda ahí: con solo los
    // días con evento, la recta entre dos puntos lejanos dibujaría un descenso
    // gradual que no ocurre.
    const dia20 = f.puntos.find((p) => p.fecha === '2026-07-20')!
    const dia21 = f.puntos.find((p) => p.fecha === '2026-07-21')!
    assert.equal(dia20.salidasCents, 30000)
    assert.equal(dia21.salidasCents, 0)
    assert.equal(dia21.saldoCents, dia20.saldoCents)
    for (let i = 1; i < f.puntos.length; i++) {
      assert.equal(f.puntos[i]!.fecha, sumarDias(f.puntos[i - 1]!.fecha, 1), 'sin huecos')
    }
  })

  test('lo que vence hoy cuenta hoy, no se pierde entre los renglones', async () => {
    // Salió mirando el Resumen en el navegador: la vista listaba la quincena de
    // hoy y a la vez decía "$0.00 que entran". La serie arrancaba en mañana,
    // así que el día de hoy quedaba fuera de la cuenta aunque su renglón se
    // viera. Un evento que se lista y no suma es justo lo que vuelve
    // increíble a una proyección.
    const { perfil, cuenta } = await libroBase(c, 'Vence hoy')
    await c.post('/api/recurrencias', {
      profileId: perfil.id,
      accountId: cuenta.id,
      type: 'ingreso',
      amountCents: 500000,
      note: 'Quincena de hoy',
      frequency: 'mensual',
      dayOfMonth: 15,
      startDate: HOY,
    })
    const f = await flujoDe(perfil.id, 30)
    assert.equal(f.eventos.length, 1)
    assert.equal(f.eventos[0]!.fecha, HOY)
    assert.equal(f.entradasCents, 500000, 'lo de hoy entra en la cuenta')
    assert.equal(f.saldoFinalCents, f.saldoInicialCents + 500000)
    assert.equal(f.puntos[0]!.fecha, HOY)
    assert.equal(f.puntos[0]!.entradasCents, 500000)
    assert.equal(
      f.puntos[0]!.saldoCents,
      f.saldoInicialCents + 500000,
      'el primer punto es el **cierre** de hoy',
    )
    const suma = sumaEventos(f)
    assert.equal(suma.entra, f.entradasCents, 'y los renglones siguen cuadrando con el total')
  })

  test('una ventana de cero días es el resto de hoy, no un error', async () => {
    // El día 31 la pregunta del Resumen sigue siendo legítima.
    const { perfil } = await libroBase(c, 'Ventana cero')
    const r = await c.get(`/api/flujo?profileId=${perfil.id}&dias=0&hoy=2026-07-31`)
    assert.equal(r.status, 200)
    assert.equal(r.body.puntos.length, 1)
    assert.equal(r.body.hasta, '2026-07-31')
  })
})

describe('lo que ya asentaste con fecha futura', () => {
  test('no está en la caja de hoy: se ve salir el día que le toca', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Cheque del viernes')
    await c.post('/api/transactions', {
      profileId: perfil.id,
      accountId: cuenta.id,
      type: 'gasto',
      amountCents: 40000,
      date: '2026-07-24',
      note: 'Cheque a Juan',
    })

    const f = await flujoDe(perfil.id)
    assert.equal(f.saldoInicialCents, 100000, 'la caja de hoy no lo tiene descontado todavía')
    assert.equal(f.salidasCents, 40000)
    assert.equal(f.saldoFinalCents, 60000)
    const evento = f.eventos.find((e) => e.tipo === 'movimiento')
    assert.ok(evento, 'y aparece como renglón auditable, no escondido en el saldo')
    assert.equal(evento.fecha, '2026-07-24')
    assert.equal(evento.montoCents, 40000)
    assert.equal(evento.direccion, 'sale')

    // El saldo de la cuenta sí lo trae descontado, y está bien: es otra
    // pregunta. Lo que no puede pasar es que la proyección lo cuente dos veces.
    const cuentas = (await c.get(`/api/accounts?profileId=${perfil.id}`)).body
    assert.equal(cuentas[0].balanceCents, 60000)
  })

  test('lo de hoy y lo de ayer ya está en la caja: no se cuenta otra vez', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Hoy ya pasó')
    for (const date of ['2026-07-14', HOY]) {
      await c.post('/api/transactions', {
        profileId: perfil.id,
        accountId: cuenta.id,
        type: 'gasto',
        amountCents: 10000,
        date,
      })
    }
    const f = await flujoDe(perfil.id)
    assert.equal(f.saldoInicialCents, 80000, 'los dos ya bajaron la caja')
    assert.equal(f.salidasCents, 0, 'y ninguno vuelve a salir en la proyección')
    assert.equal(f.eventos.length, 0)
  })

  test('un traspaso entre cuentas tuyas no mueve la caja; pagar la tarjeta sí', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Traspasos')
    const ahorro = (
      await c.post('/api/accounts', {
        profileId: perfil.id,
        name: 'Ahorro',
        type: 'ahorro',
        openingCents: 0,
      })
    ).body
    const tarjeta = (
      await c.post('/api/accounts', {
        profileId: perfil.id,
        name: 'Tarjeta',
        type: 'tarjeta',
        openingCents: 0,
      })
    ).body

    await c.post('/api/transactions', {
      profileId: perfil.id,
      accountId: cuenta.id,
      type: 'transferencia',
      amountCents: 25000,
      date: '2026-07-22',
      transferAccountId: ahorro.id,
      note: 'Al ahorro',
    })
    const soloEntreTuyas = await flujoDe(perfil.id)
    assert.equal(soloEntreTuyas.saldoFinalCents, soloEntreTuyas.saldoInicialCents)
    assert.equal(
      soloEntreTuyas.eventos.length,
      0,
      'cambiar de bolsillo no es un renglón del flujo',
    )

    await c.post('/api/transactions', {
      profileId: perfil.id,
      accountId: cuenta.id,
      type: 'transferencia',
      amountCents: 35000,
      date: '2026-07-23',
      transferAccountId: tarjeta.id,
      note: 'Pago tarjeta',
    })
    const conTarjeta = await flujoDe(perfil.id)
    assert.equal(conTarjeta.salidasCents, 35000, 'la tarjeta no es caja: ese dinero se va')
    assert.equal(conTarjeta.eventos.length, 1)
  })
})

describe('el primer día en rojo', () => {
  test('es el día exacto del cruce, y quedarse en cero no es rojo', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Cruce exacto')
    // La cuenta abre con $1,000.00. Un gasto de $1,000.00 la deja en cero.
    await c.post('/api/transactions', {
      profileId: perfil.id,
      accountId: cuenta.id,
      type: 'gasto',
      amountCents: 100000,
      date: '2026-07-20',
      note: 'Justo lo que hay',
    })
    const justo = await flujoDe(perfil.id)
    assert.equal(justo.saldoFinalCents, 0)
    assert.equal(justo.primerDiaEnRojo, null, 'llegar justo es llegar')

    await c.post('/api/transactions', {
      profileId: perfil.id,
      accountId: cuenta.id,
      type: 'gasto',
      amountCents: 1,
      date: '2026-07-22',
      note: 'Un centavo más',
    })
    const rojo = await flujoDe(perfil.id)
    assert.equal(rojo.primerDiaEnRojo, '2026-07-22', 'un centavo abajo sí')
    assert.equal(rojo.minimo.saldoCents, -1)
    assert.equal(rojo.minimo.fecha, '2026-07-22')
  })

  test('el mínimo no es el final: un mes puede apretarse y recuperarse', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Aprieta y afloja')
    await c.post('/api/transactions', {
      profileId: perfil.id,
      accountId: cuenta.id,
      type: 'gasto',
      amountCents: 95000,
      date: '2026-07-18',
      note: 'La renta',
    })
    await c.post('/api/transactions', {
      profileId: perfil.id,
      accountId: cuenta.id,
      type: 'ingreso',
      amountCents: 200000,
      date: '2026-07-30',
      note: 'La quincena',
    })

    const f = await flujoDe(perfil.id)
    assert.equal(f.saldoFinalCents, 205000, 'el mes termina holgado')
    assert.deepEqual(f.minimo, { fecha: '2026-07-18', saldoCents: 5000 }, 'y aun así se apretó')
    assert.equal(f.primerDiaEnRojo, null)
  })

  test('empezar en rojo se anuncia hoy mismo', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Ya en rojo')
    await c.post('/api/transactions', {
      profileId: perfil.id,
      accountId: cuenta.id,
      type: 'gasto',
      amountCents: 150000,
      date: '2026-07-10',
      note: 'Sobregiro',
    })
    const f = await flujoDe(perfil.id)
    assert.equal(f.saldoInicialCents, -50000)
    assert.equal(f.primerDiaEnRojo, HOY, 'no se espera a que pase algo para decirlo')
  })
})

describe('lo que no se sabe se dice, no se supone', () => {
  test('un corte no mueve la caja y un pago sin monto no entra, pero se cuenta', async () => {
    const { perfil } = await libroBase(c, 'Tarjeta sin corte')
    const tarjeta = (
      await c.post('/api/accounts', {
        profileId: perfil.id,
        name: 'Oro',
        type: 'tarjeta',
        openingCents: 0,
        creditLimitCents: 5000000,
        cutDay: 20,
        dueDay: 5,
      })
    ).body
    // Un cargo posterior al último corte: el corte del 20 aún no ocurre, así
    // que la fecha límite del 5 de agosto todavía no tiene monto.
    await c.post('/api/transactions', {
      profileId: perfil.id,
      accountId: tarjeta.id,
      type: 'gasto',
      amountCents: 120000,
      date: '2026-07-14',
      note: 'Compra',
    })

    const f = await flujoDe(perfil.id)
    assert.ok(f.sinMonto >= 1, 'hay un pago de tarjeta cuyo monto todavía no se sabe')
    assert.ok(
      f.eventos.every((e) => e.tipo !== 'corte' && e.montoCents !== null),
      'ni los cortes ni lo indefinido entran en la cuenta',
    )
    assert.equal(f.salidasCents, 0, 'y por eso la caja no se movió')
  })

  test('el módulo apagado calla su parte de la proyección', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Sin recurrencias')
    await c.post('/api/recurrencias', {
      profileId: perfil.id,
      accountId: cuenta.id,
      type: 'gasto',
      amountCents: 50000,
      note: 'Suscripciones',
      frequency: 'mensual',
      dayOfMonth: 22,
      startDate: '2026-07-22',
    })
    const con = await flujoDe(perfil.id)
    assert.equal(con.salidasCents, 50000)

    await c.patch(`/api/profiles/${perfil.id}`, {
      modules: ['tarjetas', 'deudas', 'bienes', 'inversiones', 'presupuestos', 'metas', 'notas'],
    })
    const sin = await flujoDe(perfil.id)
    assert.equal(sin.salidasCents, 0, 'apagar el módulo calla sus eventos')
    assert.equal(
      sin.saldoFinalCents,
      sin.saldoInicialCents,
      'la proyección se queda sin de qué proyectar, y la vista lo dice',
    )
    // R17: apagar oculta, nunca borra. La plantilla sigue ahí.
    const plantillas = (await c.get(`/api/recurrencias?profileId=${perfil.id}`)).body
    assert.equal(plantillas.length, 1)
  })
})

describe('la proyección es de cualquiera, no solo del negocio', () => {
  test('un libro personal la contesta, con facturas o sin ellas', async () => {
    const { perfil } = await libroBase(c, 'Personal proyecta')
    const r = await c.get(`/api/flujo?profileId=${perfil.id}&dias=90&hoy=${HOY}`)
    assert.equal(r.status, 200)
    assert.equal(r.body.puntos.length, 91)
    assert.equal(r.body.hasta, sumarDias(HOY, 90))
  })

  test('leerla tres veces da lo mismo y no deja una fila', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Solo lectura')
    await c.post('/api/recurrencias', {
      profileId: perfil.id,
      accountId: cuenta.id,
      type: 'gasto',
      amountCents: 12345,
      note: 'Gimnasio',
      frequency: 'mensual',
      dayOfMonth: 28,
      startDate: '2026-07-28',
    })
    const antes = (await c.get(`/api/transactions?profileId=${perfil.id}`)).body.length
    const uno = await flujoDe(perfil.id)
    const dos = await flujoDe(perfil.id)
    const tres = await flujoDe(perfil.id)
    assert.deepEqual(uno, dos)
    assert.deepEqual(dos, tres)
    const despues = (await c.get(`/api/transactions?profileId=${perfil.id}`)).body.length
    assert.equal(despues, antes, 'ningún GET escribió nada (R4)')
  })
})

// Estas tres vivían en `negocio.test.ts` hasta la Fase 16, cuando el flujo
// dejó de ser una sección del perfil de negocio. Se mudan enteras: una factura
// con fecha de pago sigue siendo de lo mejor que alimenta la proyección.
describe('las facturas también son flujo', () => {
  test('parte de la caja de hoy y la mueve con lo que ya vence', async () => {
    const { perfil } = await libroBase(c, 'Flujo con facturas', 'negocio')
    const cliente = (
      await c.post('/api/contrapartes', { profileId: perfil.id, name: 'Cliente', role: 'cliente' })
    ).body
    const proveedor = (
      await c.post('/api/contrapartes', { profileId: perfil.id, name: 'Proveedor', role: 'proveedor' })
    ).body
    await c.post('/api/facturas', {
      profileId: perfil.id, counterpartyId: cliente.id, direction: 'emitida',
      issueDate: '2026-07-01', dueDate: '2026-08-05', subtotalCents: 200000,
    })
    await c.post('/api/facturas', {
      profileId: perfil.id, counterpartyId: proveedor.id, direction: 'recibida',
      issueDate: '2026-07-01', dueDate: '2026-08-10', subtotalCents: 50000,
    })

    const f = await flujoDe(perfil.id, 30, '2026-07-28')
    assert.equal(f.saldoInicialCents, 100000, 'la cuenta del libro base')
    assert.equal(f.entradasCents, 200000)
    assert.equal(f.salidasCents, 50000)
    assert.equal(f.saldoFinalCents, 250000)
    assert.equal(f.primerDiaEnRojo, null)
    // El primer punto es hoy, con la caja tal cual: la gráfica arranca en una
    // cifra que el usuario ya conoce.
    assert.equal(f.puntos[0]!.fecha, '2026-07-28')
    assert.equal(f.puntos[0]!.saldoCents, 100000)
  })

  test('avisa el día en que la caja se pondría en rojo', async () => {
    const { perfil } = await libroBase(c, 'Flujo rojo', 'negocio')
    const proveedor = (
      await c.post('/api/contrapartes', { profileId: perfil.id, name: 'Caro', role: 'proveedor' })
    ).body
    await c.post('/api/facturas', {
      profileId: perfil.id, counterpartyId: proveedor.id, direction: 'recibida',
      issueDate: '2026-07-01', dueDate: '2026-08-02', subtotalCents: 150000,
    })
    const f = await flujoDe(perfil.id, 30, '2026-07-28')
    assert.equal(f.saldoFinalCents, -50000)
    assert.equal(f.primerDiaEnRojo, '2026-08-02')
  })

  test('una factura ya cobrada deja de proyectarse', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Flujo cobrado', 'negocio')
    const cliente = (
      await c.post('/api/contrapartes', { profileId: perfil.id, name: 'Cliente', role: 'cliente' })
    ).body
    const factura = (
      await c.post('/api/facturas', {
        profileId: perfil.id, counterpartyId: cliente.id, direction: 'emitida',
        issueDate: '2026-07-01', dueDate: '2026-08-05', subtotalCents: 200000,
      })
    ).body
    await c.post(`/api/facturas/${factura.id}/cobros`, {
      accountId: cuenta.id, amountCents: 200000, date: '2026-07-28',
    })
    const f = await flujoDe(perfil.id, 30, '2026-07-28')
    assert.equal(f.entradasCents, 0, 'ya entró: no se proyecta dos veces')
    assert.equal(f.saldoInicialCents, 300000, 'y ya está en la caja')
  })
})

describe('R11 · el costo no crece con el libro', () => {
  async function sembrar(nombre: string, cosas: number, movs: number) {
    const { perfil, cuenta, categorias } = await libroBase(c, nombre)
    const gasto = categorias.find((k: any) => k.kind === 'gasto')
    for (let i = 0; i < cosas; i++) {
      await c.post('/api/recurrencias', {
        profileId: perfil.id,
        accountId: cuenta.id,
        type: 'gasto',
        amountCents: 30000 + i,
        note: `Servicio ${i}`,
        frequency: 'mensual',
        dayOfMonth: (i % 27) + 1,
        startDate: '2026-01-05',
      })
      await c.post('/api/debts', {
        profileId: perfil.id,
        direction: 'por_pagar',
        counterparty: `Banco ${i}`,
        principalCents: 500000,
        startDate: '2026-01-10',
        termMonths: 24,
        annualRateBp: 1200,
      })
    }
    for (let i = 0; i < movs; i++) {
      await c.post('/api/transactions', {
        profileId: perfil.id,
        accountId: cuenta.id,
        type: 'gasto',
        amountCents: 100 + i,
        // La mitad hacia adelante: los movimientos futuros son renglones del
        // flujo, y si costaran una consulta cada uno se vería justo aquí.
        date: `2026-0${i % 2 === 0 ? 7 : 8}-${String((i % 28) + 1).padStart(2, '0')}`,
        categoryId: gasto.id,
      })
    }
    return perfil
  }

  test('las mismas consultas con uno de cada cosa que con veinte', async () => {
    const chico = await sembrar('Flujo chico', 1, 6)
    const grande = await sembrar('Flujo grande', 20, 200)

    const { db } = await import('../server/db.ts')
    const original = db.prepare.bind(db)
    let consultas = 0
    ;(db as any).prepare = (sql: string) => {
      consultas++
      return original(sql)
    }

    try {
      consultas = 0
      const uno = await flujoDe(chico.id, 90)
      const nChico = consultas

      consultas = 0
      const veinte = await flujoDe(grande.id, 90)
      const nGrande = consultas

      assert.ok(uno.eventos.length >= 2, 'los dos libros tenían de qué proyectar')
      assert.ok(
        veinte.eventos.length > uno.eventos.length * 3,
        'y el grande muchísimos más eventos',
      )
      assert.equal(nGrande, nChico, 'mismo costo: ninguna consulta es por evento ni por día')
      assert.ok(nGrande < 10, `son ${nGrande} consultas para 90 días de proyección`)
    } finally {
      ;(db as any).prepare = original
    }
  })
})
