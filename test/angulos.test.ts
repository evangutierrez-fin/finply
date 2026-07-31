// Fase 13 · Ángulos de análisis.
//
// Todo lo de aquí es de solo lectura sobre lo que ya está guardado, así que lo
// único que puede fallar es la aritmética — y la aritmética equivocada se ve
// perfectamente bien en pantalla. Por eso lo puro se prueba por su lado y los
// umbrales se prueban **por los dos lados de la frontera**: un umbral que solo
// se prueba por dentro no es un umbral, es una casualidad.
//
// `shared/estadistica.ts` se importa de forma estática: es puro y no toca la
// base, así que no cae en R16.

import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { CONSISTENCIA_MINIMA, mediana, tendencia } from '../shared/estadistica.ts'
import { levantar, libroBase, type Cliente } from './ayuda.ts'

let c: Cliente
before(async () => {
  c = await levantar()
})
after(() => c.cerrar())

/** El análisis de un perfil, fijando el "hoy" para que no dependa del día. */
const analisisDe = (perfil: number, opciones: { meses?: number; hoy: string; umbral?: number }) =>
  c
    .get(
      `/api/analisis?profileId=${perfil}&hoy=${opciones.hoy}&meses=${opciones.meses ?? 6}` +
        (opciones.umbral ? `&umbralHormigaCents=${opciones.umbral}` : ''),
    )
    .then((r) => r.body)

describe('la aritmética de la tendencia y la mediana', () => {
  test('menos de tres puntos no son una tendencia', () => {
    // Por dos puntos pasa siempre una recta exacta: llamarle tendencia a la
    // diferencia entre dos meses afirma más de lo que los datos dicen.
    assert.equal(tendencia([]), null)
    assert.equal(tendencia([100]), null)
    assert.equal(tendencia([100, 200]), null)
    assert.notEqual(tendencia([100, 200, 300]), null)
  })

  test('una recta perfecta se reconoce, y nunca se contradice', () => {
    const t = tendencia([100, 200, 300, 400])!
    assert.equal(t.pendienteCents, 100)
    assert.equal(t.primeroCents, 100)
    assert.equal(t.ultimoCents, 400)
    assert.equal(t.consistencia, 1)
  })

  test('una serie que baja da pendiente negativa', () => {
    const t = tendencia([1000, 800, 600, 400])!
    assert.equal(t.pendienteCents, -200)
    assert.ok(t.ultimoCents < t.primeroCents)
  })

  test('una serie plana se afirma como plana', () => {
    const t = tendencia([500, 500, 500])!
    assert.equal(t.pendienteCents, 0)
    assert.equal(t.consistencia, 1, 'una serie que no se mueve no se contradice')
  })

  test('el vaivén sin dirección se delata en la consistencia', () => {
    // Sierra: sube, baja, sube, baja. La pendiente existe —siempre existe— y no
    // significa nada, que es justo lo que el umbral está para atrapar.
    const t = tendencia([100, 900, 120, 880, 140, 860])!
    assert.ok(
      t.consistencia < CONSISTENCIA_MINIMA,
      `consistencia ${t.consistencia} debería quedar bajo el umbral`,
    )
  })

  test('un solo mes raro no puede inventar una tendencia', () => {
    // Cinco meses parejos y un viaje en el sexto. La recta de mínimos cuadrados
    // decía "+$2,100 al mes"; la pendiente de en medio dice lo que dicen los
    // meses normales, que es la verdad — el mes raro ya se cuenta aparte, en
    // las categorías disparadas.
    const conViaje = tendencia([11458, 12147, 11751, 11806, 11887, 26498])!
    const sinViaje = tendencia([11458, 12147, 11751, 11806, 11887])!
    assert.ok(
      Math.abs(conViaje.pendienteCents - sinViaje.pendienteCents) < 200,
      `con viaje ${conViaje.pendienteCents}, sin viaje ${sinViaje.pendienteCents}`,
    )
    assert.ok(conViaje.pendienteCents < 500, 'y desde luego no son miles al mes')
  })

  test('la mediana no se mueve por un solo mes raro', () => {
    // El mismo mes con y sin el refrigerador: el promedio salta 1,000 y la
    // mediana no se mueve. La distancia entre las dos **es** el dato.
    const normales = [1000, 1100, 900, 1050, 950]
    assert.equal(mediana(normales), 1000)
    assert.equal(mediana([...normales, 6000]), 1025, 'con un sexto mes, el promedio de los centrales')
    assert.equal(mediana([]), null)
    assert.equal(mediana([7]), 7)
  })
})

describe('la tendencia sobre meses cerrados', () => {
  /** Un gasto de `cents` en el día 10 de cada mes de la lista. */
  async function gastarPorMes(
    perfil: number,
    cuenta: number,
    categoria: number,
    porMes: Record<string, number>,
  ) {
    for (const [mes, cents] of Object.entries(porMes)) {
      if (cents === 0) continue
      await c.post('/api/transactions', {
        profileId: perfil, accountId: cuenta, type: 'gasto',
        amountCents: cents, date: `${mes}-10`, categoryId: categoria,
      })
    }
  }

  test('un gasto que sube se ve subiendo, y el mes en curso no entra', async () => {
    const { perfil, cuenta, categorias } = await libroBase(c, 'Sube')
    const gasto = categorias.find((k: any) => k.kind === 'gasto')
    await gastarPorMes(perfil.id, cuenta.id, gasto.id, {
      '2026-01': 100000, '2026-02': 120000, '2026-03': 140000,
      '2026-04': 160000, '2026-05': 180000, '2026-06': 200000,
      // Julio va a medias y quedaría como una caída si entrara.
      '2026-07': 30000,
    })

    const a = await analisisDe(perfil.id, { hoy: '2026-07-20' })
    assert.equal(a.meses, 6)
    assert.equal(a.hasta, '2026-06')
    assert.equal(a.serie.length, 6)
    assert.equal(a.tendenciaGasto.pendienteCents, 20000)
    assert.equal(a.tendenciaGasto.consistencia, 1)
    assert.equal(a.serie.at(-1).expenseCents, 200000, 'el último cerrado es junio, no julio')
  })

  test('con menos de tres meses cerrados no hay tendencia, y se dice', async () => {
    const { perfil, cuenta, categorias } = await libroBase(c, 'Dos meses')
    const gasto = categorias.find((k: any) => k.kind === 'gasto')
    await gastarPorMes(perfil.id, cuenta.id, gasto.id, { '2026-05': 50000, '2026-06': 90000 })

    const a = await analisisDe(perfil.id, { hoy: '2026-07-20' })
    assert.equal(a.meses, 2)
    assert.equal(a.tendenciaGasto, null)
    assert.equal(a.tendenciaIngreso, null)
  })

  test('un mes sin movimiento vale cero, no se salta', async () => {
    const { perfil, cuenta, categorias } = await libroBase(c, 'Con hueco')
    const gasto = categorias.find((k: any) => k.kind === 'gasto')
    await gastarPorMes(perfil.id, cuenta.id, gasto.id, {
      '2026-01': 60000, '2026-03': 60000, '2026-06': 60000,
    })

    // Saltarse los meses vacíos movería la recta como si el tiempo no hubiera
    // pasado: seis puntos, no tres.
    const a = await analisisDe(perfil.id, { hoy: '2026-07-20' })
    assert.equal(a.serie.length, 6)
    assert.deepEqual(
      a.serie.map((m: any) => m.expenseCents),
      [60000, 0, 60000, 0, 0, 60000],
    )
  })
})

describe('la estacionalidad', () => {
  test('el mismo mes contra los años anteriores, mirando todo el libro', async () => {
    const { perfil, cuenta, categorias } = await libroBase(c, 'Estacional')
    const gasto = categorias.find((k: any) => k.kind === 'gasto')
    for (const [date, cents] of [
      ['2024-06-10', 100000], ['2025-06-10', 150000], ['2026-06-10', 240000],
      // Otro mes del mismo año: no debe entrar.
      ['2026-05-10', 999999],
    ] as const) {
      await c.post('/api/transactions', {
        profileId: perfil.id, accountId: cuenta.id, type: 'gasto',
        amountCents: cents, date, categoryId: gasto.id,
      })
    }

    // La ventana de meses cerrados son seis; la estacionalidad mira el libro
    // entero, porque la gracia está justo en los años viejos.
    const a = await analisisDe(perfil.id, { meses: 6, hoy: '2026-07-20' })
    assert.deepEqual(a.estacionalidad, [
      { anio: '2024', expenseCents: 100000 },
      { anio: '2025', expenseCents: 150000 },
      { anio: '2026', expenseCents: 240000 },
    ])
  })

  test('el mes en curso nunca aparece a medias contra uno entero', async () => {
    const { perfil, cuenta, categorias } = await libroBase(c, 'Sin el mes en curso')
    const gasto = categorias.find((k: any) => k.kind === 'gasto')
    for (const date of ['2025-07-10', '2026-07-10']) {
      await c.post('/api/transactions', {
        profileId: perfil.id, accountId: cuenta.id, type: 'gasto',
        amountCents: 100000, date, categoryId: gasto.id,
      })
    }
    // El último cerrado es junio, así que la estacionalidad es de junios.
    // Julio 2026 va a medias y no puede compararse contra julios completos.
    const a = await analisisDe(perfil.id, { hoy: '2026-07-20' })
    assert.equal(a.hasta, '2026-06')
    assert.equal(a.estacionalidad.length, 0, 'no hay junios con gasto')
  })
})

describe('las categorías disparadas', () => {
  /** Cuatro meses de $1,000 y un quinto a la medida, en la misma categoría. */
  async function conHistoria(nombre: string, ultimoCents: number, base = 100000) {
    const { perfil, cuenta, categorias } = await libroBase(c, nombre)
    const gasto = categorias.find((k: any) => k.kind === 'gasto')
    for (const mes of ['2026-02', '2026-03', '2026-04', '2026-05']) {
      await c.post('/api/transactions', {
        profileId: perfil.id, accountId: cuenta.id, type: 'gasto',
        amountCents: base, date: `${mes}-10`, categoryId: gasto.id,
      })
    }
    await c.post('/api/transactions', {
      profileId: perfil.id, accountId: cuenta.id, type: 'gasto',
      amountCents: ultimoCents, date: '2026-06-10', categoryId: gasto.id,
    })
    return { perfil, gasto }
  }

  test('se compara contra su propio promedio, no contra las demás', async () => {
    const { perfil, gasto } = await conHistoria('Disparada', 200000)
    const a = await analisisDe(perfil.id, { hoy: '2026-07-20' })
    assert.equal(a.disparadas.length, 1)
    const d = a.disparadas[0]
    assert.equal(d.name, gasto.name)
    assert.equal(d.promedioCents, 100000)
    assert.equal(d.expenseCents, 200000)
    assert.equal(d.deltaCents, 100000)
    assert.equal(d.salto, 1)
    assert.equal(d.mesesPromediados, 4)
  })

  test('hacen falta los dos umbrales: el relativo y el de pesos', async () => {
    // Sube el 100 %, pero de $80 a $160: en pesos no es nada. Sin el umbral
    // absoluto, cualquier café de más gritaría.
    const chica = await conHistoria('Chica que dobla', 16000, 8000)
    assert.equal((await analisisDe(chica.perfil.id, { hoy: '2026-07-20' })).disparadas.length, 0)

    // Y al revés: sube $600 —de sobra en pesos— pero solo el 6 %. Sin el umbral
    // relativo, la lista sería siempre las categorías grandes.
    const grande = await conHistoria('Grande que apenas se mueve', 1060000, 1000000)
    assert.equal((await analisisDe(grande.perfil.id, { hoy: '2026-07-20' })).disparadas.length, 0)
  })

  test('los dos umbrales, probados por los dos lados', async () => {
    const disparadas = async (p: any) => (await analisisDe(p.id, { hoy: '2026-07-20' })).disparadas

    // El absoluto: con promedio de $1,000, exactamente $500 de diferencia no
    // basta. Quedarse justo en el umbral no es pasarse — la misma regla que
    // "gastar exactamente el tope no es excederlo".
    const justoEnPesos = await conHistoria('Justo $500 arriba', 150000)
    assert.equal((await disparadas(justoEnPesos.perfil)).length, 0)
    const unCentavoMas = await conHistoria('Un centavo más', 150100)
    assert.equal((await disparadas(unCentavoMas.perfil)).length, 1)

    // El relativo: con promedio de $10,000 —donde los $500 nunca estorban—,
    // exactamente 40 % tampoco basta.
    const justoEnPorciento = await conHistoria('Justo 40 % arriba', 1400000, 1000000)
    assert.equal((await disparadas(justoEnPorciento.perfil)).length, 0)
    const apenasArriba = await conHistoria('Apenas arriba del 40 %', 1401000, 1000000)
    assert.equal((await disparadas(apenasArriba.perfil)).length, 1)
  })

  test('con menos de tres meses de referencia no se dice nada', async () => {
    const { perfil, cuenta, categorias } = await libroBase(c, 'Poca historia')
    const gasto = categorias.find((k: any) => k.kind === 'gasto')
    for (const [mes, cents] of [['2026-04', 100000], ['2026-05', 100000], ['2026-06', 900000]] as const) {
      await c.post('/api/transactions', {
        profileId: perfil.id, accountId: cuenta.id, type: 'gasto',
        amountCents: cents, date: `${mes}-10`, categoryId: gasto.id,
      })
    }
    // Nueve veces su promedio y aun así se calla: dos meses no son un
    // promedio, son dos anécdotas.
    const a = await analisisDe(perfil.id, { hoy: '2026-07-20' })
    assert.equal(a.disparadas.length, 0)
  })
})

describe('el gasto hormiga', () => {
  test('cuenta compras, no renglones de un reparto', async () => {
    const { perfil, cuenta, categorias } = await libroBase(c, 'Hormiga y reparto')
    const gastos = categorias.filter((k: any) => k.kind === 'gasto').slice(0, 2)

    // Un ticket de $900 repartido en tres. NO son tres compras de $300: el
    // reparto existe justamente porque fue una sola compra.
    await c.post('/api/transactions', {
      profileId: perfil.id, accountId: cuenta.id, type: 'gasto',
      amountCents: 90000, date: '2026-06-03', categoryId: gastos[0].id,
      splits: [
        { categoryId: gastos[0].id, amountCents: 30000 },
        { categoryId: gastos[1].id, amountCents: 30000 },
        { categoryId: gastos[0].id, amountCents: 30000 },
      ],
    })
    // Y dos compras chicas de verdad.
    for (const cents of [5000, 12000]) {
      await c.post('/api/transactions', {
        profileId: perfil.id, accountId: cuenta.id, type: 'gasto',
        amountCents: cents, date: '2026-06-04', categoryId: gastos[0].id,
      })
    }

    const a = await analisisDe(perfil.id, { hoy: '2026-07-20', umbral: 40000 })
    assert.equal(a.hormiga.partidas, 2, 'el ticket repartido no son tres hormigas')
    assert.equal(a.hormiga.sumaCents, 17000)
  })

  test('el umbral se elige y viaja con el resultado', async () => {
    const { perfil, cuenta, categorias } = await libroBase(c, 'Umbral')
    const gasto = categorias.find((k: any) => k.kind === 'gasto')
    for (const cents of [5000, 15000, 25000, 90000]) {
      await c.post('/api/transactions', {
        profileId: perfil.id, accountId: cuenta.id, type: 'gasto',
        amountCents: cents, date: '2026-06-04', categoryId: gasto.id,
      })
    }

    const cien = await analisisDe(perfil.id, { hoy: '2026-07-20', umbral: 10000 })
    assert.equal(cien.hormiga.partidas, 1)
    assert.equal(cien.hormiga.umbralCents, 10000, 'el umbral usado va escrito en la respuesta')

    // Por los dos lados de la frontera: $250 con umbral $250 sí entra.
    const dosCincuenta = await analisisDe(perfil.id, { hoy: '2026-07-20', umbral: 25000 })
    assert.equal(dosCincuenta.hormiga.partidas, 3)
    assert.equal(dosCincuenta.hormiga.sumaCents, 45000)
    assert.equal(dosCincuenta.hormiga.parte, 45000 / 135000)
  })

  test('una devolución no es una compra chica', async () => {
    const { perfil, cuenta, categorias } = await libroBase(c, 'Hormiga y devolución')
    const gasto = categorias.find((k: any) => k.kind === 'gasto')
    const original = await c.post('/api/transactions', {
      profileId: perfil.id, accountId: cuenta.id, type: 'gasto',
      amountCents: 80000, date: '2026-06-02', categoryId: gasto.id,
    })
    await c.post('/api/transactions', {
      profileId: perfil.id, accountId: cuenta.id, type: 'ingreso',
      amountCents: 9000, date: '2026-06-09', refundOfId: original.body.id,
    })

    // El monto operativo de una devolución es negativo, así que ni siquiera
    // llega a compararse contra el umbral.
    const a = await analisisDe(perfil.id, { hoy: '2026-07-20', umbral: 10000 })
    assert.equal(a.hormiga.partidas, 0)
  })
})

describe('de dónde vino el dinero', () => {
  test('el ingreso se desmenuza igual que el gasto', async () => {
    const { perfil, cuenta, categorias } = await libroBase(c, 'Fuentes')
    const ingresos = categorias.filter((k: any) => k.kind === 'ingreso').slice(0, 2)
    for (const [categoryId, cents] of [[ingresos[0].id, 300000], [ingresos[1].id, 100000]] as const) {
      await c.post('/api/transactions', {
        profileId: perfil.id, accountId: cuenta.id, type: 'ingreso',
        amountCents: cents, date: '2026-06-05', categoryId,
      })
    }

    const a = await analisisDe(perfil.id, { hoy: '2026-07-20' })
    assert.equal(a.fuentes.length, 2)
    assert.equal(a.fuentes[0].incomeCents, 300000, 'de mayor a menor')
    assert.equal(a.fuentes[0].parte, 0.75)
    assert.equal(
      a.fuentes.reduce((s: number, f: any) => s + f.incomeCents, 0),
      a.incomeCents,
      'las fuentes suman exactamente el ingreso del periodo',
    )
  })

  test('un préstamo recibido no es una fuente de ingreso (D6)', async () => {
    const { perfil, cuenta, categorias } = await libroBase(c, 'Préstamo no es fuente')
    const ingreso = categorias.find((k: any) => k.kind === 'ingreso')
    await c.post('/api/transactions', {
      profileId: perfil.id, accountId: cuenta.id, type: 'ingreso',
      amountCents: 100000, date: '2026-06-05', categoryId: ingreso.id,
    })
    await c.post('/api/debts', {
      profileId: perfil.id, direction: 'debo', counterparty: 'Banco',
      concept: 'Préstamo', principalCents: 5000000, startDate: '2026-06-01',
      accountId: cuenta.id,
    })

    // Recibir un préstamo mueve tu patrimonio de lugar; no lo crea. Si contara,
    // endeudarte se vería como una fuente de ingreso.
    const a = await analisisDe(perfil.id, { hoy: '2026-07-20' })
    assert.equal(a.incomeCents, 100000)
    assert.equal(a.fuentes.length, 1)
  })
})

describe('dos periodos cualesquiera', () => {
  async function libroDeTresMeses(nombre: string) {
    const { perfil, cuenta, categorias } = await libroBase(c, nombre)
    const gasto = categorias.find((k: any) => k.kind === 'gasto')
    for (const [mes, cents] of [
      ['2026-01', 10000], ['2026-02', 20000], ['2026-03', 30000],
      ['2026-04', 40000], ['2026-05', 50000], ['2026-06', 60000],
    ] as const) {
      await c.post('/api/transactions', {
        profileId: perfil.id, accountId: cuenta.id, type: 'gasto',
        amountCents: cents, date: `${mes}-10`, categoryId: gasto.id,
      })
    }
    return perfil
  }

  const comparar = (perfil: number, q: string) =>
    c.get(`/api/reportes/comparativa?profileId=${perfil}&${q}`)

  test('sin segundo periodo, el bloque anterior del mismo largo', async () => {
    const perfil = await libroDeTresMeses('Trimestre')
    const res = await comparar(perfil.id, 'desde=2026-04&hasta=2026-06')
    assert.equal(res.status, 200)
    assert.equal(res.body.actual.expenseCents, 150000, 'abril a junio')
    assert.deepEqual(
      { desde: res.body.previo.desde, hasta: res.body.previo.hasta },
      { desde: '2026-01', hasta: '2026-03' },
      'el trimestre inmediatamente anterior, sin que nadie lo pida',
    )
    assert.equal(res.body.previo.expenseCents, 60000)
  })

  test('un mes contra el anterior sigue funcionando igual', async () => {
    const perfil = await libroDeTresMeses('Mes contra mes')
    const res = await comparar(perfil.id, 'desde=2026-06&hasta=2026-06')
    assert.equal(res.body.previo.desde, '2026-05')
    assert.equal(res.body.actual.expenseCents, 60000)
    assert.equal(res.body.previo.expenseCents, 50000)
    assert.equal(res.body.categorias[0].deltaCents, 10000)
  })

  test('dos rangos a la medida, aunque no midan lo mismo', async () => {
    const perfil = await libroDeTresMeses('A la medida')
    const res = await comparar(
      perfil.id,
      'desde=2026-06&hasta=2026-06&contraDesde=2026-01&contraHasta=2026-05',
    )
    // Comparar un mes contra cinco es legítimo si es lo que el usuario quiere:
    // la vista escribe qué se compara con qué, y no se le corrige la mano.
    assert.equal(res.body.actual.expenseCents, 60000)
    assert.equal(res.body.previo.expenseCents, 150000)
  })

  test('un rango al revés se rechaza, y medio segundo periodo también', async () => {
    const perfil = await libroDeTresMeses('Rangos malos')
    assert.equal((await comparar(perfil.id, 'desde=2026-06&hasta=2026-01')).status, 400)
    assert.equal((await comparar(perfil.id, 'desde=2026-01&hasta=2026-06&contraDesde=2025-01')).status, 400)
  })
})

describe('la mediana del reporte anual', () => {
  test('los meses que no han llegado no arrastran la mediana', async () => {
    const { perfil, cuenta, categorias } = await libroBase(c, 'Mediana anual')
    const gasto = categorias.find((k: any) => k.kind === 'gasto')
    for (const [mes, cents] of [
      ['2026-01', 100000], ['2026-02', 110000], ['2026-03', 90000],
    ] as const) {
      await c.post('/api/transactions', {
        profileId: perfil.id, accountId: cuenta.id, type: 'gasto',
        amountCents: cents, date: `${mes}-10`, categoryId: gasto.id,
      })
    }

    const r = (await c.get(`/api/reportes?profileId=${perfil.id}&year=2026`)).body
    // Con los doce meses, nueve valdrían cero y la mediana sería cero: diría
    // que la mitad de tus meses no gastan nada.
    assert.equal(r.totales.mesesConMovimiento, 3)
    assert.equal(r.totales.medianaGastoCents, 100000)
  })

  test('el reporte anual también dice de dónde vino', async () => {
    const { perfil, cuenta, categorias } = await libroBase(c, 'Fuentes del año')
    const ingreso = categorias.find((k: any) => k.kind === 'ingreso')
    await c.post('/api/transactions', {
      profileId: perfil.id, accountId: cuenta.id, type: 'ingreso',
      amountCents: 500000, date: '2026-03-01', categoryId: ingreso.id,
    })
    const r = (await c.get(`/api/reportes?profileId=${perfil.id}&year=2026`)).body
    assert.equal(r.porFuente.length, 1)
    assert.equal(r.porFuente[0].incomeCents, 500000)
  })
})
