// Aritmética de inversiones: el recorrido, las unidades y el XIRR.
//
// Import estático a propósito y sin riesgo: `shared/inversiones.ts`,
// `shared/rendimiento.ts` y `shared/simulador.ts` son puros y no llegan a
// `db.ts` (R16). Aquí no se abre ninguna base.
//
// El XIRR se comprueba **contra casos calculados a mano**: un flujo que se
// duplica en un año exacto tiene que dar 100 %, y uno que crece 21 % en dos
// años tiene que dar 10 %, porque 1.1² = 1.21. Con los flujos irregulares, que
// no tienen forma cerrada, se comprueba la propiedad que define la respuesta:
// el valor presente a esa tasa es cero.

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  UNIDAD,
  fmtUnidades,
  parseUnidades,
  precioImplicito,
  recorrer,
  valorDeUnidades,
  type EntradaInversion,
} from '../shared/inversiones.ts'
import { MINIMO_DIAS, xirr } from '../shared/rendimiento.ts'
import { mensualEfectiva, proyectar } from '../shared/simulador.ts'

let siguienteId = 1
function entrada(e: Partial<EntradaInversion> & { type: EntradaInversion['type']; date: string }): EntradaInversion {
  return {
    id: e.id ?? siguienteId++,
    type: e.type,
    amountCents: e.amountCents ?? 0,
    date: e.date,
    unitsE8: e.unitsE8 ?? null,
    unitPriceCents: e.unitPriceCents ?? null,
  }
}

describe('el recorrido del historial', () => {
  test('una valuación fija el valor y lo posterior lo ajusta', () => {
    const paso = recorrer([
      entrada({ type: 'aporte', amountCents: 100000, date: '2026-01-10' }),
      entrada({ type: 'valuacion', amountCents: 130000, date: '2026-03-01' }),
      entrada({ type: 'aporte', amountCents: 20000, date: '2026-04-01' }),
    ])
    // No es una suma: la valuación borra lo anterior y el aporte se le suma.
    assert.equal(paso.valueCents, 150000)
    assert.equal(paso.aportadoCents, 120000)
    assert.equal(paso.gananciaCents, 30000)
  })

  test('el orden manda aunque las entradas lleguen revueltas', () => {
    const desordenadas = recorrer([
      entrada({ id: 3, type: 'aporte', amountCents: 20000, date: '2026-04-01' }),
      entrada({ id: 1, type: 'aporte', amountCents: 100000, date: '2026-01-10' }),
      entrada({ id: 2, type: 'valuacion', amountCents: 130000, date: '2026-03-01' }),
    ])
    assert.equal(desordenadas.valueCents, 150000)
    assert.deepEqual(
      desordenadas.puntos.map((p) => p.date),
      ['2026-01-10', '2026-03-01', '2026-04-01'],
    )
  })

  test('retirar más de lo aportado no deja el aportado en negativo', () => {
    // El caso que motivó la corrección: metiste 1 000, creció a 3 000 y sacaste
    // 2 500. "Aportado" no puede volverse −1 500, que no significa nada, y la
    // ganancia tiene que seguir siendo correcta a pesar del piso.
    const paso = recorrer([
      entrada({ type: 'aporte', amountCents: 100000, date: '2026-01-01' }),
      entrada({ type: 'valuacion', amountCents: 300000, date: '2026-06-01' }),
      entrada({ type: 'retiro', amountCents: 250000, date: '2026-07-01' }),
    ])
    assert.equal(paso.aportadoCents, 100000)
    assert.equal(paso.retiradoCents, 250000)
    assert.equal(paso.investedCents, 0, 'con piso en cero, no negativo')
    assert.equal(paso.valueCents, 50000)
    // 50 000 que quedan + 250 000 que sacó − 100 000 que puso = 200 000.
    assert.equal(paso.gananciaCents, 200000)
  })

  test('un retiro no deja el valor negativo', () => {
    const paso = recorrer([
      entrada({ type: 'aporte', amountCents: 10000, date: '2026-01-01' }),
      entrada({ type: 'retiro', amountCents: 50000, date: '2026-02-01' }),
    ])
    assert.equal(paso.valueCents, 0)
    assert.equal(paso.unitsE8, 0)
  })
})

describe('unidades y precio', () => {
  test('la valuación por precio se calcula contra las unidades de esa fecha', () => {
    const paso = recorrer([
      entrada({ type: 'aporte', amountCents: 100000, date: '2026-01-01', unitsE8: 2 * UNIDAD, unitPriceCents: 50000 }),
      entrada({ type: 'valuacion', date: '2026-06-01', unitPriceCents: 75000 }),
    ])
    assert.equal(paso.unitsE8, 2 * UNIDAD)
    assert.equal(paso.valueCents, 150000, '2 unidades × $750')
  })

  test('un aporte con fecha vieja registrado después recalcula la valuación', () => {
    // Es la razón de guardar el precio y no el resultado: si se hubiera
    // guardado el valor de aquel día, esta inversión seguiría valiendo 150 000
    // después de descubrir que había una unidad más.
    const paso = recorrer([
      entrada({ id: 1, type: 'aporte', amountCents: 100000, date: '2026-01-01', unitsE8: 2 * UNIDAD }),
      entrada({ id: 2, type: 'valuacion', date: '2026-06-01', unitPriceCents: 75000 }),
      entrada({ id: 3, type: 'aporte', amountCents: 40000, date: '2026-02-01', unitsE8: 1 * UNIDAD }),
    ])
    assert.equal(paso.unitsE8, 3 * UNIDAD)
    assert.equal(paso.valueCents, 225000, '3 unidades × $750, no las 2 de antes')
  })

  test('una valuación sin precio sigue siendo el valor total', () => {
    const paso = recorrer([
      entrada({ type: 'aporte', amountCents: 100000, date: '2026-01-01', unitsE8: 2 * UNIDAD }),
      entrada({ type: 'valuacion', amountCents: 111111, date: '2026-06-01' }),
    ])
    assert.equal(paso.valueCents, 111111)
  })

  test('valorDeUnidades es exacto donde el flotante ya no lo es', () => {
    // 10 000 unidades a $10 000 son 10^19 en la multiplicación intermedia:
    // por encima del entero seguro de JavaScript. Va en BigInt por eso.
    const valor = valorDeUnidades(10_000 * UNIDAD, 1_000_000)
    assert.equal(valor, 10_000 * 1_000_000)
    assert.ok(Number.isSafeInteger(valor))
    // Un satoshi de Bitcoin a $2 000 000 el bitcoin: 2 centavos.
    assert.equal(valorDeUnidades(1, 200_000_000), 2)
    // Y el redondeo es al centavo más cercano, no hacia abajo.
    assert.equal(valorDeUnidades(UNIDAD / 2, 101), 51)
  })

  test('parseUnidades acepta ocho decimales y rechaza el noveno', () => {
    assert.equal(parseUnidades('1'), UNIDAD)
    assert.equal(parseUnidades('0.00000001'), 1)
    assert.equal(parseUnidades('1,234'), 1234 * UNIDAD, 'tres dígitos detrás son miles')
    assert.equal(parseUnidades('1,23'), 1.23 * UNIDAD)
    assert.equal(parseUnidades('1.234,5678'), 1234.5678 * UNIDAD)
    // Nueve decimales se rechazan en vez de redondearse: cambiarle la cifra al
    // usuario en silencio es peor que decirle que no cabe.
    assert.equal(parseUnidades('0.000000001'), null)
    assert.equal(parseUnidades('abc'), null)
    assert.equal(parseUnidades(''), null)
    assert.equal(parseUnidades('-1'), null)
  })

  test('fmtUnidades no inventa precisión', () => {
    assert.equal(fmtUnidades(UNIDAD), '1')
    assert.equal(fmtUnidades(1.5 * UNIDAD), '1.5')
    assert.equal(fmtUnidades(1), '0.00000001')
    assert.equal(fmtUnidades(1234 * UNIDAD), '1,234')
  })

  test('precioImplicito es el inverso de valorDeUnidades', () => {
    assert.equal(precioImplicito(150000, 2 * UNIDAD), 75000)
    assert.equal(precioImplicito(100, 0), null)
  })
})

describe('rendimiento anualizado', () => {
  test('duplicar en un año exacto es 100 %', () => {
    const r = xirr([
      { date: '2025-01-01', amountCents: -100000 },
      { date: '2026-01-01', amountCents: 200000 },
    ])
    assert.ok(r !== null)
    assert.ok(Math.abs(r - 1) < 1e-6, `esperaba 1.0, dio ${r}`)
  })

  test('crecer 21 % en dos años es 10 % anual, porque 1.1² = 1.21', () => {
    const r = xirr([
      { date: '2025-01-01', amountCents: -100000 },
      { date: '2027-01-01', amountCents: 121000 },
    ])
    assert.ok(r !== null)
    // Ni 2025 ni 2026 son bisiestos, así que de 2025-01-01 a 2027-01-01 hay
    // 730 días justos y el exponente es exactamente 2. Con 2026-12-31 serían
    // 729 y la tasa saldría 0.1001: la convención actual/365 no perdona.
    assert.ok(Math.abs(r - 0.1) < 1e-6, `esperaba 0.10, dio ${r}`)
  })

  test('no ganar nada es cero, y perder la mitad en un año es −50 %', () => {
    const plano = xirr([
      { date: '2025-01-01', amountCents: -100000 },
      { date: '2026-01-01', amountCents: 100000 },
    ])
    assert.ok(plano !== null && Math.abs(plano) < 1e-6)

    const perdida = xirr([
      { date: '2025-01-01', amountCents: -100000 },
      { date: '2026-01-01', amountCents: 50000 },
    ])
    assert.ok(perdida !== null)
    assert.ok(Math.abs(perdida + 0.5) < 1e-6, `esperaba −0.5, dio ${perdida}`)
  })

  test('con flujos irregulares, el valor presente a esa tasa es cero', () => {
    // Sin forma cerrada que comparar, se comprueba la propiedad que define la
    // respuesta. Es más fuerte que un número copiado de otra herramienta.
    const flujos = [
      { date: '2024-03-15', amountCents: -50000 },
      { date: '2024-09-02', amountCents: -30000 },
      { date: '2025-05-20', amountCents: 12000 },
      { date: '2026-07-01', amountCents: 95000 },
    ]
    const r = xirr(flujos)
    assert.ok(r !== null)
    const base = '2024-03-15'
    const dias = (a: string, b: string) =>
      (Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8)) -
        Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8))) /
      86_400_000
    const vpn = flujos.reduce(
      (s, f) => s + f.amountCents / Math.pow(1 + r, dias(base, f.date) / 365),
      0,
    )
    assert.ok(Math.abs(vpn) < 0.01, `el VPN debería ser cero y dio ${vpn}`)
  })

  test('un periodo corto no se anualiza: sería ruido con cara de dato', () => {
    // +2 % en tres días anualizado son +900 %. Se dice que no se puede decir.
    const corto = xirr([
      { date: '2026-07-01', amountCents: -100000 },
      { date: '2026-07-04', amountCents: 102000 },
    ])
    assert.equal(corto, null)

    // Justo en el límite sí se calcula.
    const limite = xirr([
      { date: '2026-07-01', amountCents: -100000 },
      { date: '2026-07-31', amountCents: 102000 },
    ])
    assert.equal(MINIMO_DIAS, 30)
    assert.ok(limite !== null)
  })

  test('sin flujos de los dos signos no hay nada que medir', () => {
    assert.equal(
      xirr([
        { date: '2025-01-01', amountCents: -100000 },
        { date: '2026-01-01', amountCents: -50000 },
      ]),
      null,
    )
    assert.equal(xirr([{ date: '2025-01-01', amountCents: -100000 }]), null)
    assert.equal(xirr([]), null)
  })

  test('perderlo todo no revienta: devuelve null en vez de un número inventado', () => {
    const r = xirr([
      { date: '2025-01-01', amountCents: -100000 },
      { date: '2026-01-01', amountCents: 0 },
    ])
    assert.equal(r, null)
  })
})

describe('simulador', () => {
  const vacio = { liquidoCents: 0, inversionesCents: 0, deudas: [] }

  test('sin rendimiento y sin deuda, es una suma que se puede hacer de cabeza', () => {
    const p = proyectar(
      { ...vacio, liquidoCents: 50000 },
      { meses: 12, ahorroMensualCents: 100000, rendimientoAnualBp: 0, estrategia: 'invertir' },
    )
    assert.equal(p.puntos.length, 13, 'hoy más doce meses')
    assert.equal(p.puntos[0]!.patrimonioCents, 50000)
    assert.equal(p.patrimonioFinalCents, 50000 + 12 * 100000)
    assert.equal(p.aportadoCents, 12 * 100000)
    assert.equal(p.rendimientoCents, 0)
  })

  test('doce meses a la tasa anual dan la tasa anual, no un poco más', () => {
    // Con r/12 nominal, 7 % anual daría 7.23 % al año por capitalizar. Se usa
    // la conversión efectiva justo para que el número escrito sea el número.
    const p = proyectar(
      { ...vacio, inversionesCents: 1_000_000 },
      { meses: 12, ahorroMensualCents: 0, rendimientoAnualBp: 700, estrategia: 'invertir' },
    )
    const esperado = 1_070_000
    assert.ok(
      Math.abs(p.patrimonioFinalCents - esperado) <= 12,
      `esperaba ~${esperado} y dio ${p.patrimonioFinalCents}`,
    )
    assert.ok(Math.abs(mensualEfectiva(700) - (Math.pow(1.07, 1 / 12) - 1)) < 1e-12)
  })

  test('la estrategia de deuda ataca primero la más cara', () => {
    const inicio = {
      liquidoCents: 0,
      inversionesCents: 0,
      deudas: [
        { id: 1, nombre: 'Barata', saldoCents: 100000, annualRateBp: 500, pagoMensualCents: 0 },
        { id: 2, nombre: 'Cara', saldoCents: 100000, annualRateBp: 4500, pagoMensualCents: 0 },
      ],
    }
    const p = proyectar(inicio, {
      meses: 1,
      ahorroMensualCents: 50000,
      rendimientoAnualBp: 0,
      estrategia: 'deuda',
    })
    // Un mes de intereses sobre las dos, y el abono completo a la del 45 %.
    const interesCara = Math.round((100000 * 4500) / 10_000 / 12)
    const interesBarata = Math.round((100000 * 500) / 10_000 / 12)
    assert.equal(p.interesPagadoCents, interesCara + interesBarata)
    assert.equal(p.puntos[1]!.deudaCents, 200000 + interesCara + interesBarata - 50000)
    assert.equal(p.puntos[1]!.inversionesCents, 0, 'nada se invirtió: todo fue a la deuda')
  })

  test('lo que sobra después de liquidar la deuda se invierte', () => {
    const inicio = {
      liquidoCents: 0,
      inversionesCents: 0,
      deudas: [{ id: 1, nombre: 'Chica', saldoCents: 30000, annualRateBp: 0, pagoMensualCents: 0 }],
    }
    const p = proyectar(inicio, {
      meses: 2,
      ahorroMensualCents: 50000,
      rendimientoAnualBp: 0,
      estrategia: 'deuda',
    })
    assert.equal(p.mesSinDeuda, 1)
    assert.equal(p.puntos[1]!.inversionesCents, 20000, 'los 20 000 que sobraron del primer mes')
    assert.equal(p.puntos[2]!.inversionesCents, 70000)
  })

  test('una deuda sin plazo se queda quieta: no se le inventa una cuota', () => {
    const inicio = {
      liquidoCents: 0,
      inversionesCents: 0,
      deudas: [{ id: 1, nombre: 'Sin plan', saldoCents: 100000, annualRateBp: 0, pagoMensualCents: 0 }],
    }
    const p = proyectar(inicio, {
      meses: 6,
      ahorroMensualCents: 0,
      rendimientoAnualBp: 0,
      estrategia: 'invertir',
    })
    assert.equal(p.puntos.at(-1)!.deudaCents, 100000)
    assert.equal(p.mesSinDeuda, null)
    assert.equal(p.interesPagadoCents, 0)
  })

  test('una deuda con cuota se acaba pagando y deja de devengar', () => {
    const inicio = {
      liquidoCents: 0,
      inversionesCents: 0,
      deudas: [{ id: 1, nombre: 'Con plan', saldoCents: 120000, annualRateBp: 1200, pagoMensualCents: 60000 }],
    }
    const p = proyectar(inicio, {
      meses: 6,
      ahorroMensualCents: 0,
      rendimientoAnualBp: 0,
      estrategia: 'invertir',
    })
    assert.ok(p.mesSinDeuda !== null && p.mesSinDeuda <= 3)
    assert.equal(p.puntos.at(-1)!.deudaCents, 0)
    // Pagar la deuda sube el patrimonio en exactamente lo que se abonó de
    // capital, y el interés es lo único que se pierde por el camino.
    assert.ok(p.interesPagadoCents > 0)
  })
})
