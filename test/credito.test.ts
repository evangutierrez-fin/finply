// Aritmética de crédito. Import estático a propósito: `shared/credito.ts` es
// un módulo puro que no llega a `db.ts` (R16), así que no puede abrir el libro
// real ni por accidente.

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  fechasParcialidades,
  interesDevengado,
  pagoMinimo,
  parcialidades,
  simularPagoMinimo,
  tablaAmortizacion,
} from '../shared/credito.ts'
import {
  diasDelMes,
  diasEntre,
  fechaConDia,
  siguienteDiaDelMes,
  sumarMeses,
  ultimoCorte,
} from '../shared/fechas.ts'

describe('fechas de corte', () => {
  test('el día se recorta al último del mes', () => {
    assert.equal(fechaConDia(2026, 2, 31), '2026-02-28')
    assert.equal(fechaConDia(2024, 2, 31), '2024-02-29', 'año bisiesto')
    assert.equal(fechaConDia(2026, 4, 31), '2026-04-30')
    assert.equal(fechaConDia(2026, 7, 5), '2026-07-05')
    assert.equal(diasDelMes(2026, 2), 28)
    assert.equal(diasDelMes(2024, 2), 29)
  })

  test('el último corte es el que ya ocurrió', () => {
    assert.equal(ultimoCorte('2026-07-27', 5), '2026-07-05')
    assert.equal(ultimoCorte('2026-07-03', 5), '2026-06-05', 'antes del corte del mes')
    assert.equal(ultimoCorte('2026-07-05', 5), '2026-07-05', 'hoy es día de corte')
    assert.equal(ultimoCorte('2026-01-03', 15), '2025-12-15', 'cruza el año')
  })

  test('un corte 31 no se queda pegado en febrero', () => {
    // El recorte se aplica mes por mes; si se arrastrara, marzo cortaría el 28.
    assert.equal(ultimoCorte('2026-03-15', 31), '2026-02-28')
    assert.equal(ultimoCorte('2024-03-15', 31), '2024-02-29')
    assert.equal(ultimoCorte('2026-04-10', 31), '2026-03-31')
  })

  test('la fecha límite de pago cae después del corte', () => {
    assert.equal(siguienteDiaDelMes('2026-07-05', 25), '2026-07-25', 'mismo mes')
    assert.equal(siguienteDiaDelMes('2026-07-25', 14), '2026-08-14', 'mes siguiente')
    assert.equal(siguienteDiaDelMes('2026-12-20', 5), '2027-01-05')
    assert.equal(siguienteDiaDelMes('2026-01-31', 31), '2026-02-28')
  })

  test('sumar meses conserva el día salvo que el mes sea más corto', () => {
    assert.equal(sumarMeses('2026-01-31', 1), '2026-02-28')
    assert.equal(sumarMeses('2026-01-31', 2), '2026-03-31')
    assert.equal(sumarMeses('2026-11-15', 3), '2027-02-15')
  })
})

describe('interés devengado', () => {
  test('cuenta los días que de verdad pasaron', () => {
    assert.equal(diasEntre('2026-01-10', '2026-02-10'), 31)
    assert.equal(diasEntre('2026-02-10', '2026-03-10'), 28)
    assert.equal(diasEntre('2024-02-10', '2024-03-10'), 29, 'año bisiesto')
    assert.equal(diasEntre('2026-12-31', '2027-01-01'), 1)
    assert.equal(diasEntre('2026-03-10', '2026-02-10'), -28, 'al revés, negativo')
  })

  test('interés simple actual/365 sobre el saldo', () => {
    // $240,000 al 13.5 % durante 31 días: 240000 × 0.135 × 31/365 = 2,751.78
    assert.equal(interesDevengado(24_000_000, 1350, '2026-01-10', '2026-02-10'), 275_178)
  })

  test('sin tasa, sin saldo o sin días transcurridos no devenga nada', () => {
    assert.equal(interesDevengado(24_000_000, 0, '2026-01-10', '2026-02-10'), 0)
    assert.equal(interesDevengado(0, 1350, '2026-01-10', '2026-02-10'), 0)
    assert.equal(interesDevengado(24_000_000, 1350, '2026-01-10', '2026-01-10'), 0)
    assert.equal(
      interesDevengado(24_000_000, 1350, '2026-02-10', '2026-01-10'),
      0,
      'una fecha anterior no genera interés negativo',
    )
  })
})

describe('parcialidades de meses sin intereses', () => {
  test('suman exactamente el total', () => {
    for (const [total, meses] of [
      [100000, 3],
      [120000, 12],
      [999999, 7],
      [1, 2],
      [1234567, 18],
    ] as const) {
      const filas = parcialidades(total, meses)
      assert.equal(filas.length, meses)
      assert.equal(
        filas.reduce((s, n) => s + n, 0),
        total,
        `${total} en ${meses} meses`,
      )
    }
  })

  test('el residuo va en la última parcialidad', () => {
    assert.deepEqual(parcialidades(100000, 3), [33333, 33333, 33334])
    assert.deepEqual(parcialidades(120000, 12), Array(12).fill(10000))
  })

  test('cada parcialidad cae en un corte de la tarjeta', () => {
    assert.deepEqual(fechasParcialidades('2026-07-20', 3, 5), [
      '2026-08-05',
      '2026-09-05',
      '2026-10-05',
    ])
    assert.deepEqual(
      fechasParcialidades('2026-07-03', 3, 5),
      ['2026-07-05', '2026-08-05', '2026-09-05'],
      'compra antes del corte: la primera se factura este mes',
    )
    assert.deepEqual(
      fechasParcialidades('2026-01-15', 3, 31),
      ['2026-01-31', '2026-02-28', '2026-03-31'],
      'el recorte de febrero no se arrastra a marzo',
    )
  })

  test('sin día de corte, mes a mes desde la compra', () => {
    assert.deepEqual(fechasParcialidades('2026-07-20', 3, null), [
      '2026-08-20',
      '2026-09-20',
      '2026-10-20',
    ])
  })
})

describe('tabla de amortización', () => {
  test('sin intereses reparte el principal en cuotas iguales', () => {
    const tabla = tablaAmortizacion({
      principalCents: 300000,
      annualRateBp: 0,
      termMonths: 3,
      startDate: '2026-07-15',
    })
    assert.equal(tabla.pagoMensualCents, 100000)
    assert.equal(tabla.totalInteresCents, 0)
    assert.equal(tabla.totalPagadoCents, 300000)
    assert.deepEqual(
      tabla.filas.map((f) => f.fecha),
      ['2026-08-15', '2026-09-15', '2026-10-15'],
    )
  })

  test('caso de libro: $10,000 al 12 % anual a 12 meses', () => {
    const tabla = tablaAmortizacion({
      principalCents: 1_000_000,
      annualRateBp: 1200,
      termMonths: 12,
      startDate: '2026-01-10',
    })
    // Cuota conocida de este caso: $888.49 al mes, con $100.00 de interés el
    // primer mes (1 % de $10,000).
    assert.equal(tabla.pagoMensualCents, 88849)
    assert.equal(tabla.filas.length, 12)
    assert.equal(tabla.filas[0]!.interesCents, 10000)
    assert.equal(tabla.filas[0]!.capitalCents, 78849)
    assert.equal(tabla.filas.at(-1)!.saldoCents, 0)
    assert.equal(tabla.totalPagadoCents - tabla.totalInteresCents, 1_000_000)
  })

  test('la columna de capital suma el principal al centavo', () => {
    // El redondeo de cada fila no puede dejar la deuda a unos centavos de
    // cerrarse: la última fila se lleva lo que quede.
    for (const [principal, bp, meses] of [
      [1_000_000, 1200, 12],
      [333_333, 2450, 7],
      [999_999, 9999, 24],
      [123_456, 3600, 5],
      [50_000, 0, 3],
      [1_000_000, 12_000, 60],
    ] as const) {
      const tabla = tablaAmortizacion({
        principalCents: principal,
        annualRateBp: bp,
        termMonths: meses,
        startDate: '2026-03-31',
      })
      const capital = tabla.filas.reduce((s, f) => s + f.capitalCents, 0)
      const etiqueta = `${principal} a ${bp}bp en ${meses} meses`
      assert.equal(capital, principal, `capital de ${etiqueta}`)
      assert.equal(tabla.filas.at(-1)!.saldoCents, 0, `saldo final de ${etiqueta}`)
      assert.equal(
        tabla.totalPagadoCents,
        principal + tabla.totalInteresCents,
        `total pagado de ${etiqueta}`,
      )
      for (const fila of tabla.filas) {
        assert.equal(fila.pagoCents, fila.capitalCents + fila.interesCents, `fila ${fila.n}`)
      }
    }
  })

  test('una tasa absurda no deja la deuda sin amortizar', () => {
    // Con la cuota redondeada al interés del mes, el saldo nunca bajaría.
    const tabla = tablaAmortizacion({
      principalCents: 100,
      annualRateBp: 100_000,
      termMonths: 12,
      startDate: '2026-01-01',
    })
    assert.equal(tabla.filas.at(-1)!.saldoCents, 0)
    assert.equal(
      tabla.filas.reduce((s, f) => s + f.capitalCents, 0),
      100,
    )
  })
})

// ── El pago mínimo de la tarjeta (Fase 14) ────────────────────────────────
//
// Era la única deuda de Finply sin interés modelado, y es la más cara que
// tiene cualquiera. Todo esto es aritmética del usuario con sus supuestos
// escritos (R9): su tasa, su porcentaje y su piso.

describe('pago mínimo', () => {
  test('es un porcentaje del saldo, con piso, y nunca más que el saldo', () => {
    // 5 % de $10,000 son $500, por encima del piso de $300.
    assert.equal(pagoMinimo(1_000_000, 500, 30000), 50000)
    // 5 % de $1,000 son $50: manda el piso.
    assert.equal(pagoMinimo(100_000, 500, 30000), 30000)
    // Y con $100 de saldo no se puede exigir el piso de $300.
    assert.equal(pagoMinimo(10_000, 500, 30000), 10000)
    assert.equal(pagoMinimo(0, 500, 30000), 0, 'sin deuda no hay mínimo')
    assert.equal(pagoMinimo(100_000, 500, null), 5000, 'sin piso manda el porcentaje')
  })

  test('sin tasa, el mínimo liquida y no cuesta un peso de interés', () => {
    const plan = simularPagoMinimo({
      saldoCents: 100_000,
      annualRateBp: 0,
      minPaymentBp: 0,
      floorCents: 25_000,
    })
    assert.equal(plan.totalInteresCents, 0)
    assert.equal(plan.meses, 4, '$1,000 a $250 fijos son cuatro meses')
    assert.equal(plan.totalPagadoCents, 100_000)
    assert.equal(plan.nuncaTermina, false)
  })

  test('pagar el mínimo cuesta años y más intereses que un pago fijo', () => {
    const params = { saldoCents: 3_000_000, annualRateBp: 4590, floorCents: 30_000 }
    const minimo = simularPagoMinimo({ ...params, minPaymentBp: 500 })
    // El plan existe, tarda años y el interés no es una nota al pie.
    assert.equal(minimo.nuncaTermina, false)
    assert.ok(minimo.meses !== null && minimo.meses > 36, `tardó ${minimo.meses} meses`)
    assert.ok(minimo.totalInteresCents > 500_000, 'con esa tasa el interés pesa')
    assert.equal(
      minimo.totalPagadoCents,
      params.saldoCents + minimo.totalInteresCents,
      'lo pagado es el saldo más los intereses, sin sobras',
    )
    // El primer mínimo es el que el usuario reconoce de su estado de cuenta:
    // 5 % del saldo ya con el interés del periodo encima.
    assert.equal(minimo.primerPagoCents, pagoMinimo(3_000_000 + 114_750, 500, 30_000))

    // Y con un pago fijo más grande se acaba antes y cuesta menos. Es la
    // comparación que vuelve útil la cifra.
    const fijo = simularPagoMinimo({ ...params, minPaymentBp: 500, pagoFijoCents: 200_000 })
    assert.ok(fijo.meses !== null && fijo.meses < minimo.meses!)
    assert.ok(fijo.totalInteresCents < minimo.totalInteresCents)
  })

  test('si el mínimo no cubre ni el interés, la deuda no se acaba nunca', () => {
    // 1 % de mínimo contra 60 % anual: cada mes se debe más que el mes pasado.
    const plan = simularPagoMinimo({
      saldoCents: 5_000_000,
      annualRateBp: 6000,
      minPaymentBp: 100,
      floorCents: null,
    })
    assert.equal(plan.nuncaTermina, true)
    assert.equal(plan.meses, null, 'no hay un número de meses que decir')
    assert.ok(plan.totalInteresCents > 0)
  })

  test('sin deuda no hay nada que simular', () => {
    const plan = simularPagoMinimo({
      saldoCents: 0,
      annualRateBp: 4590,
      minPaymentBp: 500,
      floorCents: 30_000,
    })
    assert.equal(plan.meses, 0)
    assert.equal(plan.totalPagadoCents, 0)
    assert.equal(plan.nuncaTermina, false)
  })
})
