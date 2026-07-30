// Fase 12 · El presupuesto que se adelanta.
//
// Cuatro cosas que un tope suelto no puede decir: en qué día del mes vas, cuál
// es el techo de **todo** el mes, qué se mide por año y qué se trae del mes
// pasado. Las cuatro se prueban por su lado difícil, que es siempre el mismo:
// la cifra que cambia sola.
//
// `shared/fechas.ts` se importa de forma estática a propósito: es un módulo
// puro y no toca la base, así que no cae en R16.

import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { avanceDelPeriodo, hoyISO } from '../shared/fechas.ts'
import { levantar, libroBase, type Cliente } from './ayuda.ts'

let c: Cliente
before(async () => {
  c = await levantar()
})
after(() => c.cerrar())

const mes = (perfil: number, m: string) =>
  c.get(`/api/budgets?profileId=${perfil}&month=${m}`).then((r) => r.body)

const alertasDe = (perfil: number, hoy: string) =>
  c.get(`/api/alertas?profileId=${perfil}&hoy=${hoy}`).then((r) => r.body as any[])

describe('el avance del periodo (aritmética pura)', () => {
  test('un periodo cerrado vale 1 y uno que no empieza vale 0', () => {
    assert.equal(avanceDelPeriodo('2026-06', '2026-07-15'), 1)
    assert.equal(avanceDelPeriodo('2026-08', '2026-07-15'), 0)
    assert.equal(avanceDelPeriodo('2025', '2026-07-15'), 1)
    assert.equal(avanceDelPeriodo('2027', '2026-07-15'), 0)
  })

  test('el día 1 no vale cero: el gasto de hoy ya está hecho', () => {
    // Si el primero valiera 0, cualquier gasto de ese día saldría "arriba del
    // ritmo" por definición, y el aviso más ruidoso sería el más inútil.
    assert.equal(avanceDelPeriodo('2026-07', '2026-07-01'), 1 / 31)
    assert.equal(avanceDelPeriodo('2026-02', '2026-02-01'), 1 / 28)
  })

  test('el último día del mes cierra en 1', () => {
    assert.equal(avanceDelPeriodo('2026-07', '2026-07-31'), 1)
    assert.equal(avanceDelPeriodo('2026-04', '2026-04-30'), 1)
    assert.equal(avanceDelPeriodo('2024-02', '2024-02-29'), 1, 'bisiesto')
  })

  test('el año se mide por días, no por meses', () => {
    // A mitad de año no vas al 50 %: julio empieza en el día 182 de 365.
    assert.equal(avanceDelPeriodo('2026', '2026-01-01'), 1 / 365)
    assert.equal(avanceDelPeriodo('2026', '2026-12-31'), 1)
    assert.equal(avanceDelPeriodo('2024', '2024-12-31'), 1, 'bisiesto: 366 de 366')
    assert.equal(avanceDelPeriodo('2024', '2024-01-01'), 1 / 366)
  })
})

describe('el ritmo del mes', () => {
  test('lo esperado es el techo por lo que va del periodo', async () => {
    const { perfil, categorias } = await libroBase(c, 'Ritmo')
    const gasto = categorias.find((k: any) => k.kind === 'gasto')
    const hoy = hoyISO()
    const enCurso = hoy.slice(0, 7)

    await c.post('/api/budgets', {
      profileId: perfil.id, categoryId: gasto.id, period: enCurso, amountCents: 310000,
    })

    const p = await mes(perfil.id, enCurso)
    assert.equal(p.avance, avanceDelPeriodo(enCurso, hoy))
    assert.ok(p.avance > 0 && p.avance <= 1)
    assert.equal(p.mensuales[0].esperadoCents, Math.round(310000 * p.avance))
  })

  test('un mes cerrado espera el tope entero y uno futuro no espera nada', async () => {
    const { perfil, categorias } = await libroBase(c, 'Ritmo cerrado')
    const gasto = categorias.find((k: any) => k.kind === 'gasto')

    await c.post('/api/budgets', {
      profileId: perfil.id, categoryId: gasto.id, period: '2020-01', amountCents: 100000,
    })
    await c.post('/api/budgets', {
      profileId: perfil.id, categoryId: gasto.id, period: '2099-01', amountCents: 100000,
    })

    const viejo = await mes(perfil.id, '2020-01')
    assert.equal(viejo.avance, 1)
    assert.equal(viejo.mensuales[0].esperadoCents, 100000)

    const futuro = await mes(perfil.id, '2099-01')
    assert.equal(futuro.avance, 0)
    assert.equal(futuro.mensuales[0].esperadoCents, 0)
  })

  test('el ritmo se mide contra el techo con arrastre, no contra lo escrito', async () => {
    const { perfil, cuenta, categorias } = await libroBase(c, 'Ritmo con arrastre')
    const gasto = categorias.find((k: any) => k.kind === 'gasto')

    // Mayo dejó $600 de sobrante; junio arrastra. Su techo son $1,600 y lo que
    // se espera a mitad de camino sale de ahí, no de los $1,000 escritos.
    await c.post('/api/budgets', {
      profileId: perfil.id, categoryId: gasto.id, period: '2026-05', amountCents: 100000,
    })
    await c.post('/api/transactions', {
      profileId: perfil.id, accountId: cuenta.id, type: 'gasto',
      amountCents: 40000, date: '2026-05-10', categoryId: gasto.id,
    })
    await c.post('/api/budgets', {
      profileId: perfil.id, categoryId: gasto.id, period: '2026-06',
      amountCents: 100000, rollover: true,
    })

    const junio = (await mes(perfil.id, '2026-06')).mensuales[0]
    assert.equal(junio.arrastreCents, 60000)
    assert.equal(junio.topeCents, 160000)
    assert.equal(junio.esperadoCents, Math.round(160000 * avanceDelPeriodo('2026-06', hoyISO())))
  })
})

describe('el tope de todo el mes', () => {
  test('cuenta el gasto de las categorías sin tope', async () => {
    const { perfil, cuenta, categorias } = await libroBase(c, 'Tope total')
    const gastos = categorias.filter((k: any) => k.kind === 'gasto').slice(0, 2)

    await c.post('/api/budgets', {
      profileId: perfil.id, categoryId: gastos[0].id, period: '2026-06', amountCents: 100000,
    })
    for (const [categoryId, cents] of [[gastos[0].id, 30000], [gastos[1].id, 90000]] as const) {
      await c.post('/api/transactions', {
        profileId: perfil.id, accountId: cuenta.id, type: 'gasto',
        amountCents: cents, date: '2026-06-05', categoryId,
      })
    }
    const res = await c.put('/api/budgets/total', {
      profileId: perfil.id, month: '2026-06', amountCents: 200000,
    })
    assert.equal(res.status, 200)

    const p = await mes(perfil.id, '2026-06')
    // Un techo que ignorara lo no presupuestado no sería un techo: son $1,200,
    // no los $300 que caen bajo un tope por categoría.
    assert.equal(p.total.spentCents, 120000)
    assert.equal(p.mensuales[0].spentCents, 30000)
  })

  test('fijarlo dos veces actualiza en vez de duplicar', async () => {
    const { perfil } = await libroBase(c, 'Tope total upsert')
    await c.put('/api/budgets/total', { profileId: perfil.id, month: '2026-06', amountCents: 100000 })
    await c.put('/api/budgets/total', { profileId: perfil.id, month: '2026-06', amountCents: 250000 })
    assert.equal((await mes(perfil.id, '2026-06')).total.amountCents, 250000)
  })

  test('avisa aunque ninguna categoría se haya pasado', async () => {
    const { perfil, cuenta, categorias } = await libroBase(c, 'Alerta total')
    const gasto = categorias.find((k: any) => k.kind === 'gasto')
    const enCurso = hoyISO().slice(0, 7)

    await c.post('/api/budgets', {
      profileId: perfil.id, categoryId: gasto.id, period: enCurso, amountCents: 500000,
    })
    await c.put('/api/budgets/total', {
      profileId: perfil.id, month: enCurso, amountCents: 100000,
    })
    await c.post('/api/transactions', {
      profileId: perfil.id, accountId: cuenta.id, type: 'gasto',
      amountCents: 150000, date: `${enCurso}-05`, categoryId: gasto.id,
    })

    const lista = await alertasDe(perfil.id, `${enCurso}-15`)
    assert.equal(lista.filter((a) => a.tipo === 'presupuesto').length, 0, 'la categoría va holgada')
    const total = lista.filter((a) => a.tipo === 'presupuesto_total')
    assert.equal(total.length, 1)
    assert.equal(total[0].montoCents, 50000, 'el monto es lo que se pasó')
    assert.equal(total[0].vista, 'presupuestos')
  })

  test('quitarlo lo deja en nulo, no en cero', async () => {
    const { perfil } = await libroBase(c, 'Quitar total')
    await c.put('/api/budgets/total', { profileId: perfil.id, month: '2026-06', amountCents: 100000 })
    const { total } = await mes(perfil.id, '2026-06')
    assert.equal((await c.del(`/api/budgets/total/${total.id}`)).status, 200)
    assert.equal((await mes(perfil.id, '2026-06')).total, null)
  })

  test('viaja al copiar el mes', async () => {
    const { perfil, categorias } = await libroBase(c, 'Copiar total')
    const gasto = categorias.find((k: any) => k.kind === 'gasto')
    await c.post('/api/budgets', {
      profileId: perfil.id, categoryId: gasto.id, period: '2026-06', amountCents: 100000,
    })
    await c.put('/api/budgets/total', { profileId: perfil.id, month: '2026-06', amountCents: 400000 })

    const res = await c.post('/api/budgets/copiar', {
      profileId: perfil.id, from: '2026-06', to: '2026-07',
    })
    assert.equal(res.body.copiados, 2, 'el tope de la categoría y el del mes')
    assert.equal((await mes(perfil.id, '2026-07')).total.amountCents, 400000)
  })
})

describe('el presupuesto anual', () => {
  test('mide el año entero, no el mes', async () => {
    const { perfil, cuenta, categorias } = await libroBase(c, 'Anual')
    const gasto = categorias.find((k: any) => k.kind === 'gasto')

    await c.post('/api/budgets', {
      profileId: perfil.id, categoryId: gasto.id,
      period: '2026', periodKind: 'anio', amountCents: 1400000,
    })
    for (const date of ['2026-03-10', '2026-09-04']) {
      await c.post('/api/transactions', {
        profileId: perfil.id, accountId: cuenta.id, type: 'gasto',
        amountCents: 500000, date, categoryId: gasto.id,
      })
    }
    // Y uno de otro año, que no debe contar.
    await c.post('/api/transactions', {
      profileId: perfil.id, accountId: cuenta.id, type: 'gasto',
      amountCents: 900000, date: '2025-03-10', categoryId: gasto.id,
    })

    const anual = (await mes(perfil.id, '2026-03')).anuales[0]
    assert.equal(anual.periodKind, 'anio')
    assert.equal(anual.period, '2026')
    assert.equal(anual.spentCents, 1000000, 'marzo y septiembre, no 2025')
  })

  test('viaja con todos los meses de su año y con ninguno de otro', async () => {
    const { perfil, categorias } = await libroBase(c, 'Anual viaja')
    const gasto = categorias.find((k: any) => k.kind === 'gasto')
    await c.post('/api/budgets', {
      profileId: perfil.id, categoryId: gasto.id,
      period: '2026', periodKind: 'anio', amountCents: 1000000,
    })

    // La tenencia se paga en marzo y en septiembre sigue importando cuánto
    // quedó: si solo se viera en su mes de pago no serviría para nada.
    for (const m of ['2026-01', '2026-06', '2026-12']) {
      assert.equal((await mes(perfil.id, m)).anuales.length, 1, m)
    }
    assert.equal((await mes(perfil.id, '2027-01')).anuales.length, 0)
  })

  test('convive con el tope mensual de la misma categoría', async () => {
    const { perfil, categorias } = await libroBase(c, 'Anual y mensual')
    const gasto = categorias.find((k: any) => k.kind === 'gasto')
    await c.post('/api/budgets', {
      profileId: perfil.id, categoryId: gasto.id, period: '2026-06', amountCents: 90000,
    })
    await c.post('/api/budgets', {
      profileId: perfil.id, categoryId: gasto.id,
      period: '2026', periodKind: 'anio', amountCents: 1400000,
    })

    const p = await mes(perfil.id, '2026-06')
    assert.equal(p.mensuales.length, 1)
    assert.equal(p.anuales.length, 1)
    assert.notEqual(p.mensuales[0].id, p.anuales[0].id)
  })

  test('no se copia al copiar un mes', async () => {
    const { perfil, categorias } = await libroBase(c, 'Anual no se copia')
    const gasto = categorias.find((k: any) => k.kind === 'gasto')
    await c.post('/api/budgets', {
      profileId: perfil.id, categoryId: gasto.id,
      period: '2026', periodKind: 'anio', amountCents: 1000000,
    })
    const res = await c.post('/api/budgets/copiar', {
      profileId: perfil.id, from: '2026-06', to: '2026-07',
    })
    assert.equal(res.body.copiados, 0, 'un tope anual no pertenece a un mes')
  })

  test('un tope anual no arrastra y el texto tiene que concordar', async () => {
    const { perfil, categorias } = await libroBase(c, 'Anual rechaza')
    const gasto = categorias.find((k: any) => k.kind === 'gasto')
    const base = { profileId: perfil.id, categoryId: gasto.id, amountCents: 1000 }

    assert.equal(
      (await c.post('/api/budgets', { ...base, period: '2026', periodKind: 'anio', rollover: true })).status,
      400,
      'no hay mes anterior del cual traer',
    )
    assert.equal(
      (await c.post('/api/budgets', { ...base, period: '2026-06', periodKind: 'anio' })).status,
      400,
      'un tope anual lleva AAAA',
    )
    assert.equal(
      (await c.post('/api/budgets', { ...base, period: '2026', periodKind: 'mes' })).status,
      400,
      'un tope mensual lleva AAAA-MM',
    )
  })
})

describe('el sobrante que rueda', () => {
  /** Fija el tope de un mes y gasta de golpe lo que le toque. */
  async function planta(
    perfil: number,
    cuenta: number,
    categoryId: number,
    plan: { mes: string; tope: number; gasto: number; rueda?: boolean }[],
  ) {
    for (const { mes: m, tope, gasto, rueda } of plan) {
      await c.post('/api/budgets', {
        profileId: perfil, categoryId, period: m, amountCents: tope, rollover: rueda ?? false,
      })
      if (gasto > 0) {
        await c.post('/api/transactions', {
          profileId: perfil, accountId: cuenta, type: 'gasto',
          amountCents: gasto, date: `${m}-05`, categoryId,
        })
      }
    }
  }

  test('lo que sobró sube el techo y lo que te pasaste lo baja', async () => {
    const { perfil, cuenta, categorias } = await libroBase(c, 'Rueda')
    const [holgada, apretada] = categorias.filter((k: any) => k.kind === 'gasto')

    await planta(perfil.id, cuenta.id, holgada.id, [
      { mes: '2026-05', tope: 100000, gasto: 30000 },
      { mes: '2026-06', tope: 100000, gasto: 0, rueda: true },
    ])
    await planta(perfil.id, cuenta.id, apretada.id, [
      { mes: '2026-05', tope: 100000, gasto: 130000 },
      { mes: '2026-06', tope: 100000, gasto: 0, rueda: true },
    ])

    const junio = (await mes(perfil.id, '2026-06')).mensuales
    const arriba = junio.find((b: any) => b.categoryId === holgada.id)
    const abajo = junio.find((b: any) => b.categoryId === apretada.id)

    assert.equal(arriba.arrastreCents, 70000, 'sobró y sube')
    assert.equal(arriba.topeCents, 170000)
    // El lado que un arrastre "solo bueno" escondería: si el exceso no rodara,
    // el techo subiría solo y dejaría de ser un techo.
    assert.equal(abajo.arrastreCents, -30000, 'te pasaste y baja')
    assert.equal(abajo.topeCents, 70000)
  })

  test('sin la casilla no arrastra nada', async () => {
    const { perfil, cuenta, categorias } = await libroBase(c, 'No rueda')
    const gasto = categorias.find((k: any) => k.kind === 'gasto')
    await planta(perfil.id, cuenta.id, gasto.id, [
      { mes: '2026-05', tope: 100000, gasto: 20000 },
      { mes: '2026-06', tope: 100000, gasto: 0 },
    ])
    const junio = (await mes(perfil.id, '2026-06')).mensuales[0]
    assert.equal(junio.arrastreCents, 0)
    assert.equal(junio.topeCents, junio.amountCents)
  })

  test('decide el mes que recibe, no la categoría', async () => {
    const { perfil, cuenta, categorias } = await libroBase(c, 'Decide quien recibe')
    const gasto = categorias.find((k: any) => k.kind === 'gasto')
    await planta(perfil.id, cuenta.id, gasto.id, [
      { mes: '2026-05', tope: 100000, gasto: 20000 },
      { mes: '2026-06', tope: 100000, gasto: 20000, rueda: true },
      { mes: '2026-07', tope: 100000, gasto: 0 },
    ])
    // Julio no arrastra aunque junio sí lo hiciera: apagar la casilla de un mes
    // no reescribe lo que el mes anterior ya hizo.
    assert.equal((await mes(perfil.id, '2026-06')).mensuales[0].arrastreCents, 80000)
    assert.equal((await mes(perfil.id, '2026-07')).mensuales[0].arrastreCents, 0)
  })

  test('la cadena suma varios meses seguidos', async () => {
    const { perfil, cuenta, categorias } = await libroBase(c, 'Cadena')
    const gasto = categorias.find((k: any) => k.kind === 'gasto')
    await planta(perfil.id, cuenta.id, gasto.id, [
      { mes: '2026-03', tope: 100000, gasto: 90000 },
      { mes: '2026-04', tope: 100000, gasto: 50000, rueda: true },
      { mes: '2026-05', tope: 100000, gasto: 40000, rueda: true },
      { mes: '2026-06', tope: 100000, gasto: 0, rueda: true },
    ])
    // Marzo dejó $100, abril $500 y mayo $600: $1,200 que junio hereda de
    // corrido. Es lo mismo que ir pasando el saldo mes a mes —abril tuvo un
    // techo de $1,100 y mayo de $1,600—, y por eso la suma basta.
    assert.equal((await mes(perfil.id, '2026-06')).mensuales[0].arrastreCents, 120000)
  })

  test('se corta en el primer hueco y en el primer mes que no arrastra', async () => {
    const { perfil, cuenta, categorias } = await libroBase(c, 'Corte')
    const gasto = categorias.find((k: any) => k.kind === 'gasto')
    // Marzo dejó mucho, pero abril no tuvo tope: sin tope no hay sobrante que
    // heredar, y la cadena de mayo nace en su propio hueco.
    await planta(perfil.id, cuenta.id, gasto.id, [
      { mes: '2026-03', tope: 500000, gasto: 0 },
      { mes: '2026-05', tope: 100000, gasto: 60000, rueda: true },
      { mes: '2026-06', tope: 100000, gasto: 0, rueda: true },
    ])
    assert.equal((await mes(perfil.id, '2026-05')).mensuales[0].arrastreCents, 0, 'abril no existe')
    assert.equal((await mes(perfil.id, '2026-06')).mensuales[0].arrastreCents, 40000, 'solo mayo')
  })

  test('la alerta se calla si el arrastre alcanza', async () => {
    const { perfil, cuenta, categorias } = await libroBase(c, 'Alerta con arrastre')
    const gasto = categorias.find((k: any) => k.kind === 'gasto')
    const hoy = hoyISO()
    const enCurso = hoy.slice(0, 7)
    const anterior = (() => {
      const [a, m] = enCurso.split('-').map(Number)
      const previo = m === 1 ? [a! - 1, 12] : [a!, m! - 1]
      return `${previo[0]}-${String(previo[1]).padStart(2, '0')}`
    })()

    await planta(perfil.id, cuenta.id, gasto.id, [
      { mes: anterior, tope: 100000, gasto: 50000 },
      { mes: enCurso, tope: 100000, gasto: 130000, rueda: true },
    ])

    // Se pasó de los $1,000 escritos, pero no de los $1,500 que trae. Gritarlo
    // sería mentir con la cifra correcta.
    const p = (await mes(perfil.id, enCurso)).mensuales[0]
    assert.equal(p.topeCents, 150000)
    assert.equal(p.spentCents, 130000)
    assert.equal(
      (await alertasDe(perfil.id, `${enCurso}-15`)).filter((a) => a.tipo === 'presupuesto').length,
      0,
    )
  })
})
