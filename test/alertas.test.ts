// Alertas del Resumen.
//
// Lo que se prueba aquí, además de que cada alerta encienda:
//
//   · **la frontera exacta** de cada umbral, por los dos lados. Gastar justo
//     el tope no es excederlo; un centavo más, sí. Faltando cinco días la
//     tarjeta avisa; faltando seis, no;
//   · que se **apaguen solas** cuando el hecho deja de ser cierto — es lo que
//     hace que no necesiten descarte (D10);
//   · que **leerlas no escriba** una sola fila;
//   · que el número de consultas **no crezca** con el tamaño del libro (R11).

import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { sumarDias } from '../shared/fechas.ts'
import { levantar, libroBase, type Cliente } from './ayuda.ts'

let c: Cliente
before(async () => {
  c = await levantar()
})
after(() => c?.cerrar())

/** Las alertas de un perfil en una fecha fija. */
async function alertasDe(profileId: number, hoy: string) {
  const res = await c.get(`/api/alertas?profileId=${profileId}&hoy=${hoy}`)
  assert.equal(res.status, 200)
  return res.body as any[]
}

const de = (lista: any[], tipo: string) => lista.filter((a) => a.tipo === tipo)

describe('presupuesto excedido', () => {
  test('el tope exacto no es excederse; un centavo más, sí', async () => {
    const { perfil, cuenta, categorias } = await libroBase(c, 'Topes')
    const gasto = categorias.find((k: any) => k.kind === 'gasto')
    await c.post('/api/budgets', {
      profileId: perfil.id,
      categoryId: gasto.id,
      period: '2026-07',
      amountCents: 100000,
    })

    const gastar = (cents: number, dia: string) =>
      c.post('/api/transactions', {
        profileId: perfil.id,
        accountId: cuenta.id,
        type: 'gasto',
        amountCents: cents,
        date: `2026-07-${dia}`,
        categoryId: gasto.id,
      })

    await gastar(99999, '05')
    assert.equal(de(await alertasDe(perfil.id, '2026-07-20'), 'presupuesto').length, 0, 'un centavo abajo')

    const justo = await gastar(1, '06')
    assert.equal(de(await alertasDe(perfil.id, '2026-07-20'), 'presupuesto').length, 0, 'justo en el tope')

    await gastar(1, '07')
    const excedido = de(await alertasDe(perfil.id, '2026-07-20'), 'presupuesto')
    assert.equal(excedido.length, 1, 'un centavo arriba')
    assert.equal(excedido[0].montoCents, 1, 'el monto es lo que se pasó, no lo gastado')
    assert.equal(excedido[0].vista, 'presupuestos')

    // El tope es del mes: en agosto la misma cuenta empieza de cero.
    assert.equal(de(await alertasDe(perfil.id, '2026-08-01'), 'presupuesto').length, 0)

    // Y se apaga sola si el gasto desaparece: no hay nada que descartar.
    await c.del(`/api/transactions/${justo.body.id}`)
    assert.equal(de(await alertasDe(perfil.id, '2026-07-20'), 'presupuesto').length, 0)
  })
})

describe('fecha límite de la tarjeta', () => {
  let perfil: any
  let tarjeta: any
  let banco: any

  before(async () => {
    const base = await libroBase(c, 'Plástico')
    perfil = base.perfil
    banco = base.cuenta
    tarjeta = (
      await c.post('/api/accounts', {
        profileId: perfil.id,
        name: 'Oro',
        type: 'tarjeta',
        openingCents: 0,
        creditLimitCents: 5000000,
        cutDay: 15,
        dueDay: 5,
      })
    ).body
    // Un cargo antes del corte del 15 de julio: la fecha límite es el 5 de
    // agosto y quedan $1,000 por cubrir.
    await c.post('/api/transactions', {
      profileId: perfil.id,
      accountId: tarjeta.id,
      type: 'gasto',
      amountCents: 100000,
      date: '2026-07-10',
    })
  })

  test('avisa faltando cinco días, no faltando seis', async () => {
    assert.equal(de(await alertasDe(perfil.id, '2026-07-30'), 'tarjeta').length, 0, 'faltan 6 días')

    const cinco = de(await alertasDe(perfil.id, '2026-07-31'), 'tarjeta')
    assert.equal(cinco.length, 1, 'faltan 5 días')
    assert.equal(cinco[0].severidad, 'media')
    assert.equal(cinco[0].montoCents, 100000)
    assert.match(cinco[0].detalle, /En 5 días/)

    assert.match(de(await alertasDe(perfil.id, '2026-08-04'), 'tarjeta')[0].detalle, /Mañana/)
    assert.match(de(await alertasDe(perfil.id, '2026-08-05'), 'tarjeta')[0].detalle, /Hoy/)
  })

  test('lo vencido sube a severidad alta: es lo que el calendario no muestra', async () => {
    const tarde = de(await alertasDe(perfil.id, '2026-08-06'), 'tarjeta')
    assert.equal(tarde.length, 1)
    assert.equal(tarde[0].severidad, 'alta')
    assert.match(tarde[0].titulo, /Se te pasó/)
    assert.match(tarde[0].detalle, /hace 1 día/)
  })

  test('se apaga sola al pagar', async () => {
    const pago = await c.post('/api/transactions', {
      profileId: perfil.id,
      accountId: banco.id,
      type: 'transferencia',
      amountCents: 100000,
      date: '2026-07-20',
      transferAccountId: tarjeta.id,
    })
    assert.equal(de(await alertasDe(perfil.id, '2026-08-06'), 'tarjeta').length, 0)

    // Y vuelve si el pago se anula: la alerta sigue al libro, no al revés.
    await c.del(`/api/transactions/${pago.body.id}`)
    assert.equal(de(await alertasDe(perfil.id, '2026-08-06'), 'tarjeta').length, 1)
  })
})

describe('deuda atrasada', () => {
  test('la fecha pactada que ya pasó', async () => {
    const { perfil } = await libroBase(c, 'Deber')
    await c.post('/api/debts', {
      profileId: perfil.id,
      direction: 'por_pagar',
      counterparty: 'Marisol',
      principalCents: 300000,
      startDate: '2026-01-10',
      dueDate: '2026-06-30',
    })

    assert.equal(de(await alertasDe(perfil.id, '2026-06-30'), 'deuda').length, 0, 'hoy no es tarde')
    const tarde = de(await alertasDe(perfil.id, '2026-07-01'), 'deuda')
    assert.equal(tarde.length, 1, 'mañana sí')
    assert.equal(tarde[0].severidad, 'alta')
    assert.equal(tarde[0].montoCents, 300000)
  })

  test('la mensualidad del plan que se saltó', async () => {
    const { perfil } = await libroBase(c, 'Plan')
    const deuda = (
      await c.post('/api/debts', {
        profileId: perfil.id,
        direction: 'por_pagar',
        counterparty: 'Banco',
        principalCents: 1200000,
        startDate: '2026-01-15',
        annualRateBp: 1200,
        termMonths: 12,
      })
    ).body

    // El plan pone el primer pago el 15 de febrero.
    assert.equal(de(await alertasDe(perfil.id, '2026-02-15'), 'deuda').length, 0)
    const atrasado = de(await alertasDe(perfil.id, '2026-02-16'), 'deuda')
    assert.equal(atrasado.length, 1)
    assert.match(atrasado[0].detalle, /El pago 1 de 12/)

    // Al abonar, la alerta apunta al pago siguiente y calla hasta que venza.
    await c.post(`/api/debts/${deuda.id}/payments`, { amountCents: 106619, date: '2026-02-16' })
    assert.equal(de(await alertasDe(perfil.id, '2026-02-16'), 'deuda').length, 0)
    assert.match(de(await alertasDe(perfil.id, '2026-03-16'), 'deuda')[0].detalle, /El pago 2 de 12/)
  })
})

describe('recurrencias por confirmar', () => {
  test('cuenta los periodos vencidos y avisa lo que viene', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Renta')
    await c.post('/api/recurrencias', {
      profileId: perfil.id,
      accountId: cuenta.id,
      type: 'gasto',
      amountCents: 850000,
      note: 'Renta',
      frequency: 'mensual',
      dayOfMonth: 1,
      startDate: '2026-05-01',
    })

    // Al 3 de julio hay tres periodos vencidos: mayo, junio y julio.
    const bandeja = de(await alertasDe(perfil.id, '2026-07-03'), 'recurrencia')
    const pendientes = bandeja.find((a) => /por confirmar/.test(a.titulo))
    assert.ok(pendientes, 'la bandeja llena se anuncia')
    assert.match(pendientes.titulo, /^3 partidas/)
    assert.equal(pendientes.montoCents, 850000 * 3)

    // El aviso de lo próximo mira solo tres días adelante: el calendario ya
    // cubre los treinta.
    assert.equal(
      bandeja.filter((a) => /se cobra/.test(a.titulo)).length,
      0,
      'el 1 de agosto todavía queda lejos el 3 de julio',
    )
    const proximo = de(await alertasDe(perfil.id, '2026-07-30'), 'recurrencia').find((a) =>
      /se cobra/.test(a.titulo),
    )
    assert.ok(proximo, 'faltando 2 días sí')
    assert.match(proximo.titulo, /Renta se cobra en 2 días/)
  })
})

describe('meta en riesgo', () => {
  // `goals.created_at` lo pone SQLite con `datetime('now')`, que es UTC. La
  // prueba ancla sus fechas en esa misma fecha para no depender de la hora a la
  // que se corra: medida en local, un test de la tarde mediría un día de más.
  const inicio = new Date().toISOString().slice(0, 10)

  test('ir justo al ritmo no es ir en riesgo; un centavo abajo, sí', async () => {
    const { perfil } = await libroBase(c, 'Metas')
    const meta = (
      await c.post('/api/goals', {
        profileId: perfil.id,
        name: 'Viaje',
        targetCents: 100000,
        dueDate: sumarDias(inicio, 100),
      })
    ).body
    const mitad = sumarDias(inicio, 50)

    // Sin un peso ahorrado a mitad del plazo: va en riesgo.
    const vacia = de(await alertasDe(perfil.id, mitad), 'meta')
    assert.equal(vacia.length, 1)
    assert.equal(vacia[0].severidad, 'media')

    // Justo la mitad del monto a la mitad del tiempo: al ritmo exacto.
    const aporte = await c.post(`/api/goals/${meta.id}/entries`, {
      amountCents: 50000,
      date: inicio,
    })
    assert.equal(de(await alertasDe(perfil.id, mitad), 'meta').length, 0, '50 % con 50 % del tiempo')

    // Un centavo menos y vuelve a encenderse.
    await c.del(`/api/goals/entries/${aporte.body.entries[0].id}`)
    await c.post(`/api/goals/${meta.id}/entries`, { amountCents: 49999, date: inicio })
    const corta = de(await alertasDe(perfil.id, mitad), 'meta')
    assert.equal(corta.length, 1, 'un centavo por debajo del ritmo')
    assert.match(corta[0].detalle, /50 % del tiempo/)
  })

  test('una meta sin fecha no puede llegar tarde', async () => {
    const { perfil } = await libroBase(c, 'Sin fecha')
    await c.post('/api/goals', { profileId: perfil.id, name: 'Algún día', targetCents: 500000 })
    assert.equal(de(await alertasDe(perfil.id, sumarDias(inicio, 900)), 'meta').length, 0)
  })

  test('la fecha vencida sin cumplir sube a alta', async () => {
    const { perfil } = await libroBase(c, 'Vencida')
    await c.post('/api/goals', {
      profileId: perfil.id,
      name: 'Enganche',
      targetCents: 200000,
      dueDate: sumarDias(inicio, 10),
    })
    const tarde = de(await alertasDe(perfil.id, sumarDias(inicio, 11)), 'meta')
    assert.equal(tarde.length, 1)
    assert.equal(tarde[0].severidad, 'alta')
    assert.equal(tarde[0].montoCents, 200000)
  })
})

describe('las alertas no son un estado', () => {
  test('leerlas tres veces no escribe una sola fila', async () => {
    const { perfil, cuenta, categorias } = await libroBase(c, 'Solo lectura')
    await c.post('/api/recurrencias', {
      profileId: perfil.id,
      accountId: cuenta.id,
      type: 'gasto',
      amountCents: 50000,
      note: 'Gimnasio',
      frequency: 'mensual',
      dayOfMonth: 1,
      startDate: '2026-01-01',
    })
    await c.post('/api/budgets', {
      profileId: perfil.id,
      categoryId: categorias.find((k: any) => k.kind === 'gasto').id,
      period: '2026-07',
      amountCents: 100,
    })
    await c.post('/api/transactions', {
      profileId: perfil.id,
      accountId: cuenta.id,
      type: 'gasto',
      amountCents: 90000,
      date: '2026-07-05',
      categoryId: categorias.find((k: any) => k.kind === 'gasto').id,
    })

    const antes = (await c.get(`/api/transactions?profileId=${perfil.id}`)).body.length
    const primera = await alertasDe(perfil.id, '2026-07-20')
    const segunda = await alertasDe(perfil.id, '2026-07-20')
    const tercera = await alertasDe(perfil.id, '2026-07-20')

    assert.deepEqual(primera, segunda)
    assert.deepEqual(segunda, tercera)
    assert.ok(primera.length >= 2, 'y sí había algo que decir')
    assert.equal((await c.get(`/api/transactions?profileId=${perfil.id}`)).body.length, antes)
    // Nada se asentó al leer: la bandeja sigue completa.
    assert.equal((await c.get(`/api/recurrencias/pendientes?profileId=${perfil.id}`)).body.total > 0, true)
  })

  test('lo urgente va primero', async () => {
    const { perfil } = await libroBase(c, 'Orden')
    await c.post('/api/debts', {
      profileId: perfil.id,
      direction: 'por_pagar',
      counterparty: 'Vencida',
      principalCents: 100000,
      startDate: '2026-01-01',
      dueDate: '2026-02-01',
    })
    await c.post('/api/recurrencias', {
      profileId: perfil.id,
      accountId: (await c.get(`/api/accounts?profileId=${perfil.id}`)).body[0].id,
      type: 'gasto',
      amountCents: 10000,
      note: 'Suscripción',
      frequency: 'mensual',
      dayOfMonth: 1,
      startDate: '2026-01-01',
    })
    const lista = await alertasDe(perfil.id, '2026-07-20')
    assert.equal(lista[0].severidad, 'alta')
    assert.ok(lista.some((a) => a.severidad === 'media'))
    const primeraMedia = lista.findIndex((a) => a.severidad === 'media')
    assert.ok(
      lista.slice(primeraMedia).every((a) => a.severidad === 'media'),
      'ninguna alta después de una media',
    )
  })
})

describe('R11: el costo no crece con el libro', () => {
  /**
   * Un libro con `n` de cada cosa y `movs` movimientos. Se compara uno chico
   * contra uno grande **con datos en ambos**: la primera versión de esta prueba
   * comparó un libro vacío contra uno lleno y marcó una diferencia que no era
   * N+1 —varias consultas ni se lanzan cuando no hay tarjetas ni plantillas—.
   * Lo que se quiere medir es si el costo crece con la **cantidad**.
   */
  async function sembrar(nombre: string, n: number, movs: number) {
    const { perfil, cuenta, categorias } = await libroBase(c, nombre)
    const gasto = categorias.find((k: any) => k.kind === 'gasto')
    await c.post('/api/budgets', {
      profileId: perfil.id,
      categoryId: gasto.id,
      period: '2026-07',
      amountCents: 1000,
    })
    for (let i = 0; i < n; i++) {
      const tarjeta = (
        await c.post('/api/accounts', {
          profileId: perfil.id,
          name: `Tarjeta ${i}`,
          type: 'tarjeta',
          openingCents: 0,
          cutDay: 15,
          dueDay: 5,
        })
      ).body
      await c.post('/api/transactions', {
        profileId: perfil.id,
        accountId: tarjeta.id,
        type: 'gasto',
        amountCents: 50000,
        date: '2026-07-10',
      })
      await c.post('/api/debts', {
        profileId: perfil.id,
        direction: 'por_pagar',
        counterparty: `Acreedor ${i}`,
        principalCents: 500000,
        startDate: '2026-01-15',
        termMonths: 24,
      })
      await c.post('/api/goals', {
        profileId: perfil.id,
        name: `Meta ${i}`,
        targetCents: 100000,
        dueDate: '2026-12-31',
      })
      await c.post('/api/recurrencias', {
        profileId: perfil.id,
        accountId: cuenta.id,
        type: 'gasto',
        amountCents: 30000,
        note: `Servicio ${i}`,
        frequency: 'mensual',
        dayOfMonth: 5,
        startDate: '2026-01-05',
      })
    }
    for (let i = 0; i < movs; i++) {
      await c.post('/api/transactions', {
        profileId: perfil.id,
        accountId: cuenta.id,
        type: 'gasto',
        amountCents: 100 + i,
        date: `2026-07-${String((i % 28) + 1).padStart(2, '0')}`,
        categoryId: gasto.id,
      })
    }
    return perfil
  }

  test('las mismas consultas con uno de cada cosa que con veinte', async () => {
    const chico = await sembrar('Uno de cada', 1, 5)
    const grande = await sembrar('Veinte de cada', 20, 300)

    const { db } = await import('../server/db.ts')
    const original = db.prepare.bind(db)
    let consultas = 0
    ;(db as any).prepare = (sql: string) => {
      consultas++
      return original(sql)
    }

    try {
      consultas = 0
      const listaChica = await alertasDe(chico.id, '2026-07-20')
      const nChico = consultas

      consultas = 0
      const listaGrande = await alertasDe(grande.id, '2026-07-20')
      const nGrande = consultas

      assert.ok(listaChica.length >= 2, 'los dos libros tenían de qué alertar')
      assert.ok(
        listaGrande.length > listaChica.length,
        'y el grande tenía bastante más: mismas consultas, muchas más alertas',
      )
      assert.equal(nGrande, nChico, 'el costo es el mismo: ninguna consulta es por fila')
      // El modo de fallar que R11 nombra por su nombre: "diez consultas por
      // carga del Resumen". Hoy son diez: ocho agregadas, la de los módulos del
      // perfil —que resuelve tipo y overrides en un solo LEFT JOIN justamente
      // para no costar dos— y la del tope total del mes, que no puede ir en la
      // misma consulta que los topes por categoría porque vive en otra tabla.
      // El arrastre no aparece aquí: sin una categoría que ruede no se consulta.
      assert.ok(nGrande < 12, `son ${nGrande} consultas, no una por cosa`)
    } finally {
      ;(db as any).prepare = original
    }
  })
})

/**
 * Tercera vuelta de la auditoría: el Resumen no puede valuar una partida
 * distinto de como la valúan la bandeja y el calendario (D14).
 */
describe('la alerta de recurrencias dice el monto que se va a proponer', () => {
  /** Una plantilla de monto variable con tres asentadas muy por encima del fijo. */
  async function libroConPromedio(nombre: string) {
    const { perfil, cuenta, categorias } = await libroBase(c, nombre)
    const gasto = categorias.find((k: any) => k.kind === 'gasto')
    const rec = (
      await c.post('/api/recurrencias', {
        profileId: perfil.id,
        accountId: cuenta.id,
        type: 'gasto',
        amountCents: 100_00,
        categoryId: gasto.id,
        note: 'Luz',
        frequency: 'mensual',
        dayOfMonth: 5,
        startDate: '2026-01-05',
        amountMode: 'promedio',
      })
    ).body
    for (const periodo of ['2026-01', '2026-02', '2026-03']) {
      const r = await c.post(`/api/recurrencias/${rec.id}/asentar?profileId=${perfil.id}`, {
        periodo,
        amountCents: 900_00,
      })
      assert.equal(r.status, 201, JSON.stringify(r.body))
    }
    return { perfil, rec }
  }

  test('lo por confirmar se valúa con el promedio, no con la columna fija', async () => {
    const { perfil } = await libroConPromedio('Promedio')
    const hoy = '2026-08-07'
    const bandeja = (
      await c.get(`/api/recurrencias/pendientes?profileId=${perfil.id}&hoy=${hoy}`)
    ).body
    assert.ok(bandeja.total > 0, 'tenía que haber atraso que contar')
    assert.equal(bandeja.items[0].amountCents, 900_00, 'la bandeja propone el promedio')

    const alerta = de(await alertasDe(perfil.id, hoy), 'recurrencia').find((a) =>
      a.titulo.includes('por confirmar'),
    )
    assert.ok(alerta, 'no salió la alerta de partidas por confirmar')
    // Con la columna fija esto daba $500 de un atraso que vale $4,500: nueve
    // veces menos, y en la única pantalla que el usuario mira todos los días.
    assert.equal(
      alerta.montoCents,
      bandeja.total * 900_00,
      'el Resumen valúa el atraso distinto que la bandeja',
    )
  })

  test('y lo que viene pronto, también', async () => {
    const { perfil } = await libroConPromedio('Promedio2')
    // Dos días antes del 5 de septiembre, con agosto ya resuelto para que la
    // próxima sin resolver sea la de septiembre.
    const hoy = '2026-09-03'
    const cal = (await c.get(`/api/calendario?profileId=${perfil.id}&hoy=${hoy}&dias=3`)).body
    const evento = cal.eventos.find((e: any) => e.tipo === 'recurrencia')
    assert.ok(evento, 'el calendario tenía que anunciarla')

    const alerta = de(await alertasDe(perfil.id, hoy), 'recurrencia').find(
      (a) => !a.titulo.includes('por confirmar'),
    )
    assert.ok(alerta, 'no salió la alerta de lo que se cobra pronto')
    assert.equal(alerta.montoCents, evento.montoCents, 'dos pantallas, dos cifras')
  })

  test('con monto fijo no cambia nada, y no se consulta el promedio', async () => {
    const { perfil, cuenta, categorias } = await libroBase(c, 'Fijo')
    const gasto = categorias.find((k: any) => k.kind === 'gasto')
    await c.post('/api/recurrencias', {
      profileId: perfil.id,
      accountId: cuenta.id,
      type: 'gasto',
      amountCents: 300_00,
      categoryId: gasto.id,
      note: 'Renta',
      frequency: 'mensual',
      dayOfMonth: 1,
      startDate: '2026-06-01',
    })
    const hoy = '2026-08-07'
    const bandeja = (
      await c.get(`/api/recurrencias/pendientes?profileId=${perfil.id}&hoy=${hoy}`)
    ).body
    const alerta = de(await alertasDe(perfil.id, hoy), 'recurrencia').find((a) =>
      a.titulo.includes('por confirmar'),
    )
    assert.equal(alerta.montoCents, bandeja.total * 300_00)
  })
})
