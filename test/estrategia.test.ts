// Fase 24 · Estrategia de deuda e inversión.
//
// Lo que estas pruebas cuidan es que **la comparación signifique algo**. Un
// simulador de deuda es fácil de escribir y fácil de escribir mal: basta que
// una de las dos rutas no ruede la cuota liberada para que la otra gane
// siempre, y el número saldría convincente igual.
//
// Por eso las invariantes que se prueban no son "corre sin tronar", son:
//
//   · las dos rutas mueven **exactamente el mismo dinero al mes**,
//   · la avalancha nunca paga más intereses que la bola de nieve,
//   · con una sola deuda las dos son idénticas —no hay orden que elegir—,
//   · abonar de más nunca alarga el plazo,
//   · las dos mitades de la ganancia suman la de siempre, al centavo,
//   · y la comisión de apertura no cambia lo que debes, solo lo que recibes.
//
// La aritmética de una deuda ya la auditó la Fase 22 contra fórmulas cerradas
// (`test/auditoria.test.ts`); aquí se prueba lo que se construyó encima.

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { levantar, libroBase, type Cliente } from './ayuda.ts'
import {
  conAbonoExtra, correrEstrategia, tasaEfectivaCredito, type DeudaEnJuego,
} from '../shared/estrategia.ts'
import { recorrer, repartoPorTipo } from '../shared/inversiones.ts'

const suma = (xs: number[]) => xs.reduce((s, x) => s + x, 0)

/** Tres deudas de las que se ven de verdad: la chica es la más cara. */
const TRES: DeudaEnJuego[] = [
  // Tarjeta: saldo mediano, tasa altísima, cuota chica.
  { id: 1, nombre: 'Tarjeta', saldoCents: 4_500_00, annualRateBp: 4500, pagoMensualCents: 300_00 },
  // Auto: el saldo grande, tasa moderada.
  { id: 2, nombre: 'Auto', saldoCents: 18_000_00, annualRateBp: 1350, pagoMensualCents: 600_00 },
  // Un préstamo familiar chico y sin intereses.
  { id: 3, nombre: 'Cuñado', saldoCents: 1_200_00, annualRateBp: 0, pagoMensualCents: 100_00 },
]

// ── Los dos métodos, sin base de datos de por medio ───────────────────────

describe('bola de nieve contra avalancha', () => {
  test('las dos liquidan todo y ninguna deja una deuda viva', () => {
    for (const orden of ['bola_de_nieve', 'avalancha'] as const) {
      const plan = correrEstrategia(TRES, 200_00, orden)
      assert.equal(plan.nuncaTermina, false)
      assert.ok(plan.meses !== null && plan.meses > 0)
      assert.equal(plan.saldos[plan.saldos.length - 1], 0)
      for (const d of plan.deudas) assert.ok(d.mes !== null, `${d.nombre} se quedó viva`)
    }
  })

  test('⚠ las dos mueven el mismo dinero: lo pagado difiere solo en intereses', () => {
    // Es la prueba que hace honesta la comparación. Si una ruta gastara más al
    // mes que la otra, ganaría por eso y no por el orden — y el número que se
    // le enseña al usuario no significaría nada.
    const nieve = correrEstrategia(TRES, 200_00, 'bola_de_nieve')
    const avalancha = correrEstrategia(TRES, 200_00, 'avalancha')
    const capital = suma(TRES.map((d) => d.saldoCents))
    assert.equal(nieve.totalPagadoCents - nieve.totalInteresCents, capital)
    assert.equal(avalancha.totalPagadoCents - avalancha.totalInteresCents, capital)
  })

  test('la avalancha nunca paga más intereses que la bola de nieve', () => {
    // No es una opinión: atacar primero la tasa más alta minimiza el interés.
    // Se prueba sobre varios extras porque el orden de liquidación cambia con
    // el dinero disponible, y con él la diferencia.
    for (const extra of [0, 50_00, 200_00, 1_000_00, 5_000_00]) {
      const nieve = correrEstrategia(TRES, extra, 'bola_de_nieve')
      const avalancha = correrEstrategia(TRES, extra, 'avalancha')
      assert.ok(
        avalancha.totalInteresCents <= nieve.totalInteresCents,
        `con extra ${extra} la avalancha pagó más intereses`,
      )
    }
  })

  test('la bola de nieve tacha una deuda antes, y por eso existe', () => {
    const nieve = correrEstrategia(TRES, 200_00, 'bola_de_nieve')
    const avalancha = correrEstrategia(TRES, 200_00, 'avalancha')
    // La primera en caer de cada ruta: la del saldo más chico contra la de la
    // tasa más alta.
    assert.equal(nieve.deudas[0]!.nombre, 'Cuñado')
    assert.equal(avalancha.deudas[0]!.nombre, 'Tarjeta')
    const primeraNieve = Math.min(...nieve.deudas.map((d) => d.mes!))
    const primeraAvalancha = Math.min(...avalancha.deudas.map((d) => d.mes!))
    assert.ok(primeraNieve <= primeraAvalancha)
  })

  test('⚠ la cuota liberada rueda: sin eso, esto no sería bola de nieve', () => {
    // Cuando la deuda del cuñado se acaba, sus $100 al mes tienen que pasar a
    // la siguiente. Se comprueba por sus consecuencias: liquidar las tres con
    // la cuota rodando cuesta menos meses que la suma de los plazos de cada
    // una por separado.
    const plan = correrEstrategia(TRES, 0, 'avalancha')
    const sueltas = TRES.map(
      (d) =>
        conAbonoExtra({
          saldoCents: d.saldoCents,
          annualRateBp: d.annualRateBp,
          pagoMensualCents: d.pagoMensualCents,
          extraCents: 0,
        }).base.meses!,
    )
    assert.ok(plan.meses !== null)
    // La más larga por su cuenta es el piso: rodando no puede tardar más.
    assert.ok(plan.meses! <= Math.max(...sueltas))
    // Y sí tarda menos que la más larga, porque las otras dos le heredan cuota.
    assert.ok(plan.meses! < Math.max(...sueltas))
  })

  test('con una sola deuda las dos rutas son la misma', () => {
    const una = [TRES[1]!]
    const nieve = correrEstrategia(una, 300_00, 'bola_de_nieve')
    const avalancha = correrEstrategia(una, 300_00, 'avalancha')
    assert.equal(nieve.meses, avalancha.meses)
    assert.equal(nieve.totalInteresCents, avalancha.totalInteresCents)
    assert.equal(nieve.totalPagadoCents, avalancha.totalPagadoCents)
  })

  test('más dinero extra nunca tarda más ni cuesta más', () => {
    let mesesPrevio = Infinity
    let interesPrevio = Infinity
    for (const extra of [0, 100_00, 500_00, 2_000_00]) {
      const plan = correrEstrategia(TRES, extra, 'avalancha')
      assert.ok(plan.meses! <= mesesPrevio)
      assert.ok(plan.totalInteresCents <= interesPrevio)
      mesesPrevio = plan.meses!
      interesPrevio = plan.totalInteresCents
    }
  })

  test('sin deudas no hay nada que comparar y se dice en cero, no en nunca', () => {
    const plan = correrEstrategia([], 500_00, 'avalancha')
    assert.equal(plan.meses, 0)
    assert.equal(plan.nuncaTermina, false)
    assert.deepEqual(plan.saldos, [0])
  })

  test('⚠ una cuota que no cubre el interés no termina, y se dice', () => {
    // $50 al mes contra el 45 % anual de $4,500: el interés del primer mes son
    // $168.75. La respuesta honesta es "esto no se acaba", no un número.
    const plan = correrEstrategia(
      [{ id: 1, nombre: 'Tarjeta', saldoCents: 4_500_00, annualRateBp: 4500, pagoMensualCents: 50_00 }],
      0,
      'avalancha',
    )
    assert.equal(plan.meses, null)
    assert.equal(plan.nuncaTermina, true)
  })

  test('una deuda sin plan ni tasa se mueve solo con lo que apartes', () => {
    const sinPlan: DeudaEnJuego[] = [
      { id: 1, nombre: 'Sin plan', saldoCents: 3_000_00, annualRateBp: 0, pagoMensualCents: 0 },
    ]
    assert.equal(correrEstrategia(sinPlan, 0, 'avalancha').nuncaTermina, true)
    // Con $1,000 al mes y sin intereses: tres meses exactos.
    const con = correrEstrategia(sinPlan, 1_000_00, 'avalancha')
    assert.equal(con.meses, 3)
    assert.equal(con.totalInteresCents, 0)
  })

  test('el orden se decide una vez y el resultado es el mismo dos veces', () => {
    const a = correrEstrategia(TRES, 300_00, 'bola_de_nieve')
    const b = correrEstrategia(TRES, 300_00, 'bola_de_nieve')
    assert.deepEqual(a, b)
  })
})

// ── "Si abono $X extra" ───────────────────────────────────────────────────

describe('abonar de más', () => {
  const deuda = { saldoCents: 240_000_00, annualRateBp: 1350, pagoMensualCents: 6_498_32 }

  test('acorta el plazo y ahorra intereses', () => {
    const r = conAbonoExtra({ ...deuda, extraCents: 1_000_00 })
    assert.ok(r.base.meses !== null && r.con.meses !== null)
    assert.ok(r.con.meses! < r.base.meses!)
    assert.equal(r.mesesAhorrados, r.base.meses! - r.con.meses!)
    assert.ok(r.interesAhorradoCents! > 0)
    assert.equal(
      r.interesAhorradoCents,
      r.base.totalInteresCents - r.con.totalInteresCents,
    )
  })

  test('⚠ abonar de más nunca alarga el plazo, para ningún extra', () => {
    const base = conAbonoExtra({ ...deuda, extraCents: 0 }).base.meses!
    let previo = base
    for (const extra of [1_00, 100_00, 1_000_00, 5_000_00, 50_000_00]) {
      const r = conAbonoExtra({ ...deuda, extraCents: extra })
      assert.ok(r.con.meses! <= previo, `con ${extra} el plazo creció`)
      previo = r.con.meses!
    }
  })

  test('con extra cero no cambia nada, y eso es lo que debe decir', () => {
    const r = conAbonoExtra({ ...deuda, extraCents: 0 })
    assert.equal(r.mesesAhorrados, 0)
    assert.equal(r.interesAhorradoCents, 0)
  })

  test('un abono que liquida la deuda de un jalón la termina en un mes', () => {
    const r = conAbonoExtra({ ...deuda, extraCents: 300_000_00 })
    assert.equal(r.con.meses, 1)
  })

  test('sin tasa, el ahorro es puro plazo y cero intereses', () => {
    const r = conAbonoExtra({
      saldoCents: 12_000_00,
      annualRateBp: 0,
      pagoMensualCents: 1_000_00,
      extraCents: 1_000_00,
    })
    assert.equal(r.base.meses, 12)
    assert.equal(r.con.meses, 6)
    assert.equal(r.interesAhorradoCents, 0)
  })

  test('si ni la cuota ni la cuota con extra alcanzan, no hay ahorro que decir', () => {
    const r = conAbonoExtra({
      saldoCents: 100_000_00,
      annualRateBp: 6000,
      pagoMensualCents: 100_00,
      extraCents: 100_00,
    })
    assert.equal(r.base.meses, null)
    assert.equal(r.con.meses, null)
    assert.equal(r.mesesAhorrados, null)
    assert.equal(r.interesAhorradoCents, null)
  })
})

// ── La tasa que de verdad cuesta ──────────────────────────────────────────

describe('tasa efectiva del crédito', () => {
  test('sin comisión sale arriba de la nominal, porque esta capitaliza', () => {
    // $240,000 a 48 meses al 13.5 % nominal: cuota $6,498.32. La efectiva
    // anual de una mensual del 1.125 % es (1.01125)^12 − 1 = 14.37 %.
    const pagos = Array.from({ length: 48 }, (_, i) => ({ n: i + 1, pagoCents: 6_498_32 }))
    const tasa = tasaEfectivaCredito({ recibidoCents: 240_000_00, pagos })
    assert.ok(tasa !== null)
    assert.ok(Math.abs(tasa! - 0.1437) < 0.001, `salió ${tasa}`)
  })

  test('⚠ la comisión sube la tasa efectiva y no aparece en la del contrato', () => {
    const pagos = Array.from({ length: 48 }, (_, i) => ({ n: i + 1, pagoCents: 6_498_32 }))
    const sin = tasaEfectivaCredito({ recibidoCents: 240_000_00, pagos })!
    // Comisión del 2 %: debes 240,000 y te depositan 235,200.
    const con = tasaEfectivaCredito({ recibidoCents: 235_200_00, pagos })!
    assert.ok(con > sin)
    // Y no es un detalle: son más de un punto porcentual.
    assert.ok(con - sin > 0.01, `subió solo ${con - sin}`)
  })

  test('cuanto más corto el plazo, más pesa la misma comisión', () => {
    const cuota = (meses: number) =>
      Array.from({ length: meses }, (_, i) => ({ n: i + 1, pagoCents: Math.round(102_000_00 / meses) }))
    const corto = tasaEfectivaCredito({ recibidoCents: 98_000_00, pagos: cuota(6) })!
    const largo = tasaEfectivaCredito({ recibidoCents: 98_000_00, pagos: cuota(36) })!
    assert.ok(corto > largo)
  })

  test('sin pagos o sin nada recibido no se afirma una tasa', () => {
    assert.equal(tasaEfectivaCredito({ recibidoCents: 100_00, pagos: [] }), null)
    assert.equal(
      tasaEfectivaCredito({ recibidoCents: 0, pagos: [{ n: 1, pagoCents: 100_00 }] }),
      null,
    )
  })
})

// ── Ganancia realizada contra ganancia en papel ───────────────────────────

describe('las dos mitades de la ganancia', () => {
  test('sin retiros, todo es ganancia en papel', () => {
    const r = recorrer([
      { id: 1, type: 'aporte', amountCents: 10_000_00, date: '2026-01-10', unitsE8: null, unitPriceCents: null },
      { id: 2, type: 'valuacion', amountCents: 12_000_00, date: '2026-06-10', unitsE8: null, unitPriceCents: null },
    ])
    assert.equal(r.gananciaCents, 2_000_00)
    assert.equal(r.gananciaRealizadaCents, 0)
    assert.equal(r.gananciaEnPapelCents, 2_000_00)
    assert.equal(r.costoCents, 10_000_00)
  })

  test('retirar con ganancia cobra su parte y deja el resto en papel', () => {
    // Pones $10,000, vale $12,000 (20 % de ganancia sobre el valor) y sacas
    // $6,000: la mitad. Te llevas la mitad del costo ($5,000) y realizas
    // $1,000 de ganancia; queda $6,000 de valor con $5,000 de costo.
    const r = recorrer([
      { id: 1, type: 'aporte', amountCents: 10_000_00, date: '2026-01-10', unitsE8: null, unitPriceCents: null },
      { id: 2, type: 'valuacion', amountCents: 12_000_00, date: '2026-06-10', unitsE8: null, unitPriceCents: null },
      { id: 3, type: 'retiro', amountCents: 6_000_00, date: '2026-06-11', unitsE8: null, unitPriceCents: null },
    ])
    assert.equal(r.costoCents, 5_000_00)
    assert.equal(r.gananciaRealizadaCents, 1_000_00)
    assert.equal(r.gananciaEnPapelCents, 1_000_00)
    assert.equal(r.gananciaCents, 2_000_00)
  })

  test('⚠ las dos mitades suman la ganancia de siempre, al centavo', () => {
    // La invariante que sostiene todo lo demás: partir una cifra en dos no
    // puede cambiarla. Se prueba con montos que redondean feo a propósito.
    const historias = [
      [
        { id: 1, type: 'aporte' as const, amountCents: 3_333_33, date: '2026-01-01', unitsE8: null, unitPriceCents: null },
        { id: 2, type: 'valuacion' as const, amountCents: 4_444_47, date: '2026-02-01', unitsE8: null, unitPriceCents: null },
        { id: 3, type: 'retiro' as const, amountCents: 1_111_11, date: '2026-03-01', unitsE8: null, unitPriceCents: null },
        { id: 4, type: 'aporte' as const, amountCents: 777_77, date: '2026-04-01', unitsE8: null, unitPriceCents: null },
        { id: 5, type: 'retiro' as const, amountCents: 999_99, date: '2026-05-01', unitsE8: null, unitPriceCents: null },
        { id: 6, type: 'valuacion' as const, amountCents: 3_141_59, date: '2026-06-01', unitsE8: null, unitPriceCents: null },
      ],
      [
        { id: 1, type: 'aporte' as const, amountCents: 1, date: '2026-01-01', unitsE8: null, unitPriceCents: null },
        { id: 2, type: 'retiro' as const, amountCents: 1, date: '2026-02-01', unitsE8: null, unitPriceCents: null },
      ],
      [
        { id: 1, type: 'aporte' as const, amountCents: 100_00, date: '2026-01-01', unitsE8: null, unitPriceCents: null },
        { id: 2, type: 'valuacion' as const, amountCents: 0, date: '2026-02-01', unitsE8: null, unitPriceCents: null },
        { id: 3, type: 'aporte' as const, amountCents: 50_00, date: '2026-03-01', unitsE8: null, unitPriceCents: null },
        { id: 4, type: 'retiro' as const, amountCents: 50_00, date: '2026-04-01', unitsE8: null, unitPriceCents: null },
      ],
    ]
    for (const historia of historias) {
      const r = recorrer(historia)
      assert.equal(
        r.gananciaRealizadaCents + r.gananciaEnPapelCents,
        r.gananciaCents,
        `no cuadró en ${JSON.stringify(historia.map((e) => e.amountCents))}`,
      )
    }
  })

  test('retirar más de lo aportado deja la ganancia cobrada y el papel en cero', () => {
    const r = recorrer([
      { id: 1, type: 'aporte', amountCents: 1_000_00, date: '2026-01-01', unitsE8: null, unitPriceCents: null },
      { id: 2, type: 'valuacion', amountCents: 1_500_00, date: '2026-02-01', unitsE8: null, unitPriceCents: null },
      { id: 3, type: 'retiro', amountCents: 1_500_00, date: '2026-03-01', unitsE8: null, unitPriceCents: null },
    ])
    assert.equal(r.valueCents, 0)
    assert.equal(r.costoCents, 0)
    assert.equal(r.gananciaRealizadaCents, 500_00)
    assert.equal(r.gananciaEnPapelCents, 0)
    assert.equal(r.gananciaCents, 500_00)
  })

  test('retirar en pérdida realiza la pérdida, con signo', () => {
    const r = recorrer([
      { id: 1, type: 'aporte', amountCents: 1_000_00, date: '2026-01-01', unitsE8: null, unitPriceCents: null },
      { id: 2, type: 'valuacion', amountCents: 500_00, date: '2026-02-01', unitsE8: null, unitPriceCents: null },
      { id: 3, type: 'retiro', amountCents: 500_00, date: '2026-03-01', unitsE8: null, unitPriceCents: null },
    ])
    assert.equal(r.gananciaRealizadaCents, -500_00)
    assert.equal(r.gananciaEnPapelCents, 0)
    assert.equal(r.gananciaCents, -500_00)
  })
})

// ── El reparto de la cartera ──────────────────────────────────────────────

describe('reparto por tipo', () => {
  test('agrupa, ordena de mayor a menor y las partes suman 100 %', () => {
    const filas = repartoPorTipo([
      { kind: 'cetes', valueCents: 1_000_00 },
      { kind: 'cripto', valueCents: 500_00 },
      { kind: 'cetes', valueCents: 2_000_00 },
      { kind: 'fondo', valueCents: 500_00 },
    ])
    assert.deepEqual(filas.map((f) => f.kind), ['cetes', 'cripto', 'fondo'])
    assert.equal(filas[0]!.valueCents, 3_000_00)
    assert.equal(suma(filas.map((f) => f.parteBp)), 10_000)
  })

  test('⚠ tres tercios suman 10 000 puntos base, no 9 999', () => {
    // Es el defecto clásico del reparto en porcentajes: cada uno redondea a
    // 33 % y la vista enseña un total del 99 %. La mayor absorbe el residuo.
    const filas = repartoPorTipo([
      { kind: 'a', valueCents: 100 },
      { kind: 'b', valueCents: 100 },
      { kind: 'c', valueCents: 100 },
    ])
    assert.equal(suma(filas.map((f) => f.parteBp)), 10_000)
    assert.equal(filas[0]!.parteBp, 3_334)
  })

  test('lo que no vale nada no aparece: un renglón en cero no es información', () => {
    const filas = repartoPorTipo([
      { kind: 'cetes', valueCents: 1_000_00 },
      { kind: 'cripto', valueCents: 0 },
    ])
    assert.equal(filas.length, 1)
    assert.equal(filas[0]!.parteBp, 10_000)
  })

  test('sin nada que repartir devuelve una lista vacía', () => {
    assert.deepEqual(repartoPorTipo([]), [])
    assert.deepEqual(repartoPorTipo([{ kind: 'otro', valueCents: 0 }]), [])
  })
})

// ── Contra la API ─────────────────────────────────────────────────────────

describe('la estrategia contra el libro', () => {
  let c: Cliente
  let perfil: any
  let cuenta: any

  before(async () => {
    c = await levantar()
    const base = await libroBase(c)
    perfil = base.perfil
    cuenta = base.cuenta
  })
  after(async () => c.cerrar())

  const apuntar = (datos: Record<string, unknown>) =>
    c.post('/api/debts', {
      profileId: perfil.id,
      direction: 'por_pagar',
      counterparty: 'Banco',
      principalCents: 100_000_00,
      startDate: '2026-01-15',
      annualRateBp: 2000,
      termMonths: 24,
      ...datos,
    })

  test('sin deudas devuelve las dos rutas vacías, no un error', async () => {
    const res = await c.get(`/api/debts/estrategia?profileId=${perfil.id}&extraCents=0`)
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.deudas, [])
    assert.equal(res.body.bolaDeNieve.meses, 0)
    assert.equal(res.body.avalancha.meses, 0)
    assert.equal(res.body.saldoTotalCents, 0)
  })

  test('con dos deudas devuelve las dos rutas y la diferencia', async () => {
    await apuntar({ counterparty: 'Tarjeta', principalCents: 5_000_00, annualRateBp: 4500, termMonths: 24 })
    await apuntar({ counterparty: 'Auto', principalCents: 200_000_00, annualRateBp: 1200, termMonths: 48 })
    const res = await c.get(`/api/debts/estrategia?profileId=${perfil.id}&extraCents=200000`)
    assert.equal(res.status, 200)
    assert.equal(res.body.deudas.length, 2)
    assert.equal(res.body.extraMensualCents, 200000)
    assert.ok(res.body.bolaDeNieve.meses > 0)
    assert.ok(res.body.avalancha.meses > 0)
    // La avalancha ataca la tarjeta al 45 %; la bola de nieve también, porque
    // aquí la chica **es** la cara. Aun así las dos cifras tienen que estar.
    assert.ok(res.body.interesAhorradoCents !== null)
    assert.ok(res.body.interesAhorradoCents >= 0)
  })

  test('lo que te deben no entra: no es una deuda que pagar', async () => {
    await apuntar({ direction: 'por_cobrar', counterparty: 'Luis', principalCents: 50_000_00 })
    const res = await c.get(`/api/debts/estrategia?profileId=${perfil.id}&extraCents=0`)
    assert.ok(!res.body.deudas.some((d: any) => d.nombre.includes('Luis')))
  })

  test('un extra negativo se rechaza en vez de simular al revés', async () => {
    const res = await c.get(`/api/debts/estrategia?profileId=${perfil.id}&extraCents=-100`)
    assert.equal(res.status, 400)
  })

  test('una deuda saldada sale de la comparación sola', async () => {
    const deuda = (await apuntar({ counterparty: 'Chica', principalCents: 1_000_00, termMonths: 12 })).body
    const antes = await c.get(`/api/debts/estrategia?profileId=${perfil.id}&extraCents=0`)
    assert.ok(antes.body.deudas.some((d: any) => d.nombre === 'Chica'))
    await c.post(`/api/debts/${deuda.id}/payments`, {
      amountCents: 1_000_00,
      date: '2026-01-16',
      interestCents: 0,
    })
    const despues = await c.get(`/api/debts/estrategia?profileId=${perfil.id}&extraCents=0`)
    assert.ok(!despues.body.deudas.some((d: any) => d.nombre === 'Chica'))
  })
})

// ── La comisión de apertura ───────────────────────────────────────────────

describe('comisión de apertura', () => {
  let c: Cliente
  let perfil: any
  let cuenta: any

  before(async () => {
    c = await levantar()
    const base = await libroBase(c)
    perfil = base.perfil
    cuenta = base.cuenta
  })
  after(async () => c.cerrar())

  test('⚠ debes el principal completo, pero el libro asienta lo que te llegó', async () => {
    const res = await c.post('/api/debts', {
      profileId: perfil.id,
      direction: 'por_pagar',
      counterparty: 'Banco',
      concept: 'Crédito de auto',
      principalCents: 240_000_00,
      startDate: '2026-02-01',
      annualRateBp: 1350,
      termMonths: 48,
      accountId: cuenta.id,
      originationFeeCents: 4_800_00,
    })
    assert.equal(res.status, 201)
    assert.equal(res.body.principalCents, 240_000_00)
    assert.equal(res.body.originationFeeCents, 4_800_00)
    assert.equal(res.body.balanceCents, 240_000_00)

    const movs = (await c.get(`/api/transactions?profileId=${perfil.id}`)).body
    const desembolso = movs.find((t: any) => t.note === 'Crédito de auto')
    assert.ok(desembolso, 'no se asentó el desembolso')
    // Lo que de verdad entró a la cuenta: el principal menos la comisión.
    assert.equal(desembolso.amountCents, 235_200_00)
    assert.equal(desembolso.type, 'ingreso')
  })

  test('la tasa efectiva del plan la incluye; el saldo de la cuenta también', async () => {
    const deudas = (await c.get(`/api/debts?profileId=${perfil.id}`)).body
    const auto = deudas.find((d: any) => d.concept === 'Crédito de auto')
    const plan = (await c.get(`/api/debts/${auto.id}/amortizacion`)).body
    assert.equal(plan.recibidoCents, 235_200_00)
    assert.ok(plan.tasaEfectivaBp > 1350, `salió ${plan.tasaEfectivaBp}`)

    const cuentas = (await c.get(`/api/accounts?profileId=${perfil.id}`)).body
    const banco = cuentas.find((a: any) => a.id === cuenta.id)
    // El saldo de apertura más lo que de verdad depositaron.
    assert.equal(banco.balanceCents, 1_000_00 + 235_200_00)
  })

  test('⚠ corregir el desembolso devuelve el principal con su comisión adentro', async () => {
    // La trampa: el movimiento vale `principal − comisión`, así que leerlo de
    // vuelta como principal a secas dejaría la deuda $4,800 corta cada vez que
    // el usuario corrigiera una fecha.
    const deudas = (await c.get(`/api/debts?profileId=${perfil.id}`)).body
    const auto = deudas.find((d: any) => d.concept === 'Crédito de auto')
    const movs = (await c.get(`/api/transactions?profileId=${perfil.id}`)).body
    const desembolso = movs.find((t: any) => t.note === 'Crédito de auto')

    const res = await c.patch(`/api/transactions/${desembolso.id}`, {
      profileId: perfil.id,
      accountId: desembolso.accountId,
      type: 'ingreso',
      amountCents: 235_200_00,
      date: '2026-02-03',
      note: 'Crédito de auto',
    })
    assert.equal(res.status, 200)
    const despues = (await c.get(`/api/debts?profileId=${perfil.id}`)).body.find(
      (d: any) => d.id === auto.id,
    )
    assert.equal(despues.principalCents, 240_000_00)
    assert.equal(despues.startDate, '2026-02-03')
  })

  test('una comisión que se come el crédito entero se rechaza', async () => {
    const res = await c.post('/api/debts', {
      profileId: perfil.id,
      direction: 'por_pagar',
      counterparty: 'Usura',
      principalCents: 10_000_00,
      startDate: '2026-03-01',
      originationFeeCents: 10_000_00,
    })
    assert.equal(res.status, 400)
  })

  test('sin comisión, todo se comporta como antes de esta fase', async () => {
    const res = await c.post('/api/debts', {
      profileId: perfil.id,
      direction: 'por_pagar',
      counterparty: 'Sin comisión',
      concept: 'Préstamo liso',
      principalCents: 30_000_00,
      startDate: '2026-04-01',
      accountId: cuenta.id,
    })
    assert.equal(res.body.originationFeeCents, 0)
    const movs = (await c.get(`/api/transactions?profileId=${perfil.id}`)).body
    const desembolso = movs.find((t: any) => t.note === 'Préstamo liso')
    assert.equal(desembolso.amountCents, 30_000_00)
  })
})

// ── El aporte recurrente ──────────────────────────────────────────────────

describe('una plantilla que aporta a una inversión', () => {
  let c: Cliente
  let perfil: any
  let cuenta: any
  let inversion: any
  let plantilla: any

  before(async () => {
    c = await levantar()
    const base = await libroBase(c)
    perfil = base.perfil
    cuenta = base.cuenta
    inversion = (
      await c.post('/api/investments', { profileId: perfil.id, name: 'Fondo', kind: 'fondo' })
    ).body
    plantilla = (
      await c.post('/api/recurrencias', {
        profileId: perfil.id,
        accountId: cuenta.id,
        type: 'gasto',
        amountCents: 2_000_00,
        note: 'Aporte al fondo',
        frequency: 'mensual',
        dayOfMonth: 5,
        startDate: '2026-01-05',
        investmentId: inversion.id,
      })
    ).body
  })
  after(async () => c.cerrar())

  test('la plantilla guarda su inversión y la enseña por nombre', () => {
    assert.equal(plantilla.investmentId, inversion.id)
    assert.equal(plantilla.investmentName, 'Fondo')
  })

  test('crearla no aportó nada: proponer no es asentar (R4)', async () => {
    const inv = (await c.get(`/api/investments?profileId=${perfil.id}`)).body[0]
    assert.equal(inv.entries.length, 0)
    assert.equal(inv.aportadoCents, 0)
  })

  test('⚠ la propuesta viaja marcada, para que la bandeja no la sume como gasto', async () => {
    // Sin esto la bandeja anunciaría "$2,000 de gasto" por algo que el Resumen
    // nunca va a contar como gasto: dos verdades sobre el mismo peso, que es
    // justo lo que D14 prohíbe.
    const bandeja = (await c.get(
      `/api/recurrencias/pendientes?profileId=${perfil.id}&limit=100&offset=0`,
    )).body
    const propuesta = bandeja.items.find((p: any) => p.recurrenceId === plantilla.id)
    assert.ok(propuesta)
    assert.equal(propuesta.investmentId, inversion.id)
    assert.equal(propuesta.investmentName, 'Fondo')
    assert.equal(propuesta.type, 'gasto')
  })

  test('⚠ asentar registra el aporte y lo liga al movimiento', async () => {
    const res = await c.post(
      `/api/recurrencias/${plantilla.id}/asentar?profileId=${perfil.id}`,
      { periodo: '2026-01' },
    )
    assert.equal(res.status, 201)
    const inv = (await c.get(`/api/investments?profileId=${perfil.id}`)).body[0]
    assert.equal(inv.entries.length, 1)
    assert.equal(inv.entries[0].type, 'aporte')
    assert.equal(inv.entries[0].amountCents, 2_000_00)
    assert.equal(inv.entries[0].date, '2026-01-05')
    assert.equal(inv.aportadoCents, 2_000_00)
    assert.equal(inv.valueCents, 2_000_00)
  })

  test('⚠ y por estar ligado, D6 lo saca del gasto del mes', async () => {
    // Es la razón de que la liga exista. Pasar dinero de tu cuenta a tu
    // inversión no es gastarlo: si contara, la tasa de ahorro de quien invierte
    // cada mes se desplomaría por invertir.
    const rep = (await c.get(`/api/reportes?profileId=${perfil.id}&year=2026`)).body
    const enero = rep.meses.find((m: any) => m.month === '2026-01')
    assert.equal(enero.expenseCents, 0)
    // Y el saldo de la cuenta sí bajó: el dinero se movió de verdad.
    const cuentas = (await c.get(`/api/accounts?profileId=${perfil.id}`)).body
    assert.equal(cuentas[0].balanceCents, 1_000_00 - 2_000_00)
  })

  test('ajustar el monto al asentar ajusta también el aporte', async () => {
    await c.post(`/api/recurrencias/${plantilla.id}/asentar?profileId=${perfil.id}`, {
      periodo: '2026-02',
      amountCents: 2_500_00,
    })
    const inv = (await c.get(`/api/investments?profileId=${perfil.id}`)).body[0]
    const febrero = inv.entries.find((e: any) => e.date === '2026-02-05')
    assert.equal(febrero.amountCents, 2_500_00)
    assert.equal(inv.aportadoCents, 4_500_00)
  })

  test('⚠ anular el movimiento se lleva el aporte y devuelve el periodo', async () => {
    const movs = (await c.get(`/api/transactions?profileId=${perfil.id}`)).body
    const enero = movs.find((t: any) => t.date === '2026-01-05')
    await c.del(`/api/transactions/${enero.id}`)

    const inv = (await c.get(`/api/investments?profileId=${perfil.id}`)).body[0]
    assert.ok(!inv.entries.some((e: any) => e.date === '2026-01-05'))
    assert.equal(inv.aportadoCents, 2_500_00)

    const bandeja = (await c.get(
      `/api/recurrencias/pendientes?profileId=${perfil.id}&limit=100&offset=0`,
    )).body
    assert.ok(bandeja.items.some((p: any) => p.periodo === '2026-01'))
  })

  test('un ingreso no puede aportar a una inversión', async () => {
    const res = await c.post('/api/recurrencias', {
      profileId: perfil.id,
      accountId: cuenta.id,
      type: 'ingreso',
      amountCents: 1_000_00,
      frequency: 'mensual',
      dayOfMonth: 1,
      startDate: '2026-01-01',
      investmentId: inversion.id,
    })
    assert.equal(res.status, 400)
  })

  test('una inversión de otro perfil se rechaza', async () => {
    const otro = (await c.post('/api/profiles', { name: 'Otro', kind: 'personal' })).body
    const ajena = (
      await c.post('/api/investments', { profileId: otro.id, name: 'Ajena', kind: 'otro' })
    ).body
    const res = await c.post('/api/recurrencias', {
      profileId: perfil.id,
      accountId: cuenta.id,
      type: 'gasto',
      amountCents: 100_00,
      frequency: 'mensual',
      dayOfMonth: 1,
      startDate: '2026-01-01',
      investmentId: ajena.id,
    })
    assert.equal(res.status, 400)
  })

  test('cambiar la plantilla a transferencia suelta la liga en vez de dejarla colgando', async () => {
    const res = await c.patch(`/api/recurrencias/${plantilla.id}`, {
      profileId: perfil.id,
      accountId: cuenta.id,
      type: 'gasto',
      amountCents: 2_000_00,
      note: 'Aporte al fondo',
      frequency: 'mensual',
      dayOfMonth: 5,
      startDate: '2026-01-05',
      investmentId: null,
    })
    assert.equal(res.status, 200)
    assert.equal(res.body.investmentId, null)
  })
})
