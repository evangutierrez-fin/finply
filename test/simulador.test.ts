// El simulador, aritmética pura. Vivía dentro de `inversiones.test.ts` hasta la
// Fase 18, que le dio rendimiento aparte, inflación, retiro y la pregunta al
// revés — y con eso, archivo propio.
//
// Import estático a propósito y sin riesgo: `shared/simulador.ts` es puro y no
// llega a `db.ts` (R16). Lo que sí abre base es el último bloque, el de la
// API, y por eso el servidor se importa dentro de `levantar()`.
//
// Lo que se comprueba no son las cifras que salgan, sino las **identidades**
// que tienen que valer siempre: el patrimonio final es el de hoy más lo que
// pusiste menos lo que sacaste más lo que puso la tasa; sin inflación las dos
// lecturas son la misma; y el aporte que devuelve la meta es el más chico que
// llega. Una proyección que se equivoque en cualquiera de las tres está
// mintiendo aunque su número se vea razonable.

import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ahorroParaMeta,
  enPesosDeHoy,
  mensualEfectiva,
  proyectar,
  type EstadoInicial,
  type Supuestos,
} from '../shared/simulador.ts'
import { levantar, libroBase, type Cliente } from './ayuda.ts'
import type { Simulacion } from '../shared/types.ts'

const vacio: EstadoInicial = { liquidoCents: 0, inversionesCents: 0, deudas: [] }

/**
 * Los supuestos de siempre —sin inflación y aportando todo el horizonte—, que
 * es la simulación anterior a esta fase. Cada prueba escribe solo lo que le
 * importa, y así se lee de un vistazo qué está variando.
 */
function sup(
  base: Pick<Supuestos, 'meses' | 'ahorroMensualCents' | 'rendimientoAnualBp' | 'estrategia'> &
    Partial<Supuestos>,
): Supuestos {
  return {
    inflacionAnualBp: 0,
    mesesAporte: base.meses,
    retiroMensualCents: 0,
    ...base,
  }
}

describe('simulador · lo que ya hacía', () => {
  test('sin rendimiento y sin deuda, es una suma que se puede hacer de cabeza', () => {
    const p = proyectar(
      { ...vacio, liquidoCents: 50000 },
      sup({ meses: 12, ahorroMensualCents: 100000, rendimientoAnualBp: 0, estrategia: 'invertir' }),
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
      sup({ meses: 12, ahorroMensualCents: 0, rendimientoAnualBp: 700, estrategia: 'invertir' }),
    )
    const esperado = 1_070_000
    assert.ok(
      Math.abs(p.patrimonioFinalCents - esperado) <= 12,
      `esperaba ~${esperado} y dio ${p.patrimonioFinalCents}`,
    )
    assert.ok(Math.abs(mensualEfectiva(700) - (Math.pow(1.07, 1 / 12) - 1)) < 1e-12)
  })

  test('la estrategia de deuda ataca primero la más cara', () => {
    const inicio: EstadoInicial = {
      liquidoCents: 0,
      inversionesCents: 0,
      deudas: [
        { id: 1, nombre: 'Barata', saldoCents: 100000, annualRateBp: 500, pagoMensualCents: 0 },
        { id: 2, nombre: 'Cara', saldoCents: 100000, annualRateBp: 4500, pagoMensualCents: 0 },
      ],
    }
    const p = proyectar(
      inicio,
      sup({ meses: 1, ahorroMensualCents: 50000, rendimientoAnualBp: 0, estrategia: 'deuda' }),
    )
    // Un mes de intereses sobre las dos, y el abono completo a la del 45 %.
    const interesCara = Math.round((100000 * 4500) / 10_000 / 12)
    const interesBarata = Math.round((100000 * 500) / 10_000 / 12)
    assert.equal(p.interesPagadoCents, interesCara + interesBarata)
    assert.equal(p.puntos[1]!.deudaCents, 200000 + interesCara + interesBarata - 50000)
    assert.equal(p.puntos[1]!.inversionesCents, 0, 'nada se invirtió: todo fue a la deuda')
  })

  test('lo que sobra después de liquidar la deuda se invierte', () => {
    const inicio: EstadoInicial = {
      liquidoCents: 0,
      inversionesCents: 0,
      deudas: [{ id: 1, nombre: 'Chica', saldoCents: 30000, annualRateBp: 0, pagoMensualCents: 0 }],
    }
    const p = proyectar(
      inicio,
      sup({ meses: 2, ahorroMensualCents: 50000, rendimientoAnualBp: 0, estrategia: 'deuda' }),
    )
    assert.equal(p.mesSinDeuda, 1)
    assert.equal(p.puntos[1]!.inversionesCents, 20000, 'los 20 000 que sobraron del primer mes')
    assert.equal(p.puntos[2]!.inversionesCents, 70000)
  })

  test('una deuda sin plazo se queda quieta: no se le inventa una cuota', () => {
    const inicio: EstadoInicial = {
      liquidoCents: 0,
      inversionesCents: 0,
      deudas: [{ id: 1, nombre: 'Sin plan', saldoCents: 100000, annualRateBp: 0, pagoMensualCents: 0 }],
    }
    const p = proyectar(
      inicio,
      sup({ meses: 6, ahorroMensualCents: 0, rendimientoAnualBp: 0, estrategia: 'invertir' }),
    )
    assert.equal(p.puntos.at(-1)!.deudaCents, 100000)
    assert.equal(p.mesSinDeuda, null)
    assert.equal(p.interesPagadoCents, 0)
  })

  test('una deuda con cuota se acaba pagando y deja de devengar', () => {
    const inicio: EstadoInicial = {
      liquidoCents: 0,
      inversionesCents: 0,
      deudas: [{ id: 1, nombre: 'Con plan', saldoCents: 120000, annualRateBp: 1200, pagoMensualCents: 60000 }],
    }
    const p = proyectar(
      inicio,
      sup({ meses: 6, ahorroMensualCents: 0, rendimientoAnualBp: 0, estrategia: 'invertir' }),
    )
    assert.ok(p.mesSinDeuda !== null && p.mesSinDeuda <= 3)
    assert.equal(p.puntos.at(-1)!.deudaCents, 0)
    // Pagar la deuda sube el patrimonio en exactamente lo que se abonó de
    // capital, y el interés es lo único que se pierde por el camino.
    assert.ok(p.interesPagadoCents > 0)
  })
})

describe('el rendimiento solo, sin el patrimonio encima', () => {
  test('la identidad se cumple en cada punto, no solo al final', () => {
    // patrimonio = el de hoy + lo puesto − lo sacado + lo que puso la tasa.
    // Si esta resta no cuadra, la serie de rendimiento está inventada.
    const inicio: EstadoInicial = {
      liquidoCents: 80_000_00,
      inversionesCents: 20_000_00,
      deudas: [{ id: 1, nombre: 'Auto', saldoCents: 150_000_00, annualRateBp: 1350, pagoMensualCents: 5_000_00 }],
    }
    const p = proyectar(
      inicio,
      sup({ meses: 60, ahorroMensualCents: 5_000_00, rendimientoAnualBp: 700, estrategia: 'invertir' }),
    )
    const hoy = p.puntos[0]!.patrimonioCents
    for (const q of p.puntos) {
      assert.equal(
        q.patrimonioCents,
        hoy + q.aportadoCents + q.pagadoAPlanCents - q.retiradoCents + q.rendimientoCents,
        `el mes ${q.mes} no cuadra`,
      )
    }
    assert.equal(p.puntos[0]!.rendimientoCents, 0, 'hoy no has ganado nada todavía')
    assert.equal(p.rendimientoCents, p.puntos.at(-1)!.rendimientoCents)
  })

  test('la cuota de la deuda no es rendimiento: lo que deja es su interés, en negativo', () => {
    // Sin nada invertido y sin apartar, lo único que pasa en la proyección es
    // que una deuda devenga y se paga con su cuota. El patrimonio sube —la
    // deuda baja— pero eso no lo puso ninguna tasa: lo pagaste tú. Si la cuota
    // no se contara, ese capital abonado se leería como rendimiento, y esa fue
    // exactamente la mentira que esta prueba existe para cerrar.
    const inicio: EstadoInicial = {
      liquidoCents: 0,
      inversionesCents: 0,
      deudas: [{ id: 1, nombre: 'Auto', saldoCents: 240_000_00, annualRateBp: 1350, pagoMensualCents: 6_500_00 }],
    }
    const p = proyectar(
      inicio,
      sup({ meses: 24, ahorroMensualCents: 0, rendimientoAnualBp: 0, estrategia: 'invertir' }),
    )
    assert.ok(p.pagadoAPlanCents > 0, 'la cuota se cuenta')
    assert.equal(p.rendimientoCents, -p.interesPagadoCents, 'lo único que deja deber es su interés')
    assert.ok(p.patrimonioFinalCents > p.puntos[0]!.patrimonioCents, 'y aun así el patrimonio sube')
  })

  test('la última cuota se cuenta como se pagó, no como estaba en el plan', () => {
    // La deuda queda debiendo menos que su cuota: el abono final es más chico y
    // contar la cuota completa habría inventado dinero puesto que nadie puso.
    const inicio: EstadoInicial = {
      liquidoCents: 0,
      inversionesCents: 0,
      deudas: [{ id: 1, nombre: 'Casi nada', saldoCents: 10_000_00, annualRateBp: 0, pagoMensualCents: 6_000_00 }],
    }
    const p = proyectar(
      inicio,
      sup({ meses: 6, ahorroMensualCents: 0, rendimientoAnualBp: 0, estrategia: 'invertir' }),
    )
    assert.equal(p.pagadoAPlanCents, 10_000_00, 'dos abonos: 6 000 y 4 000, y ni un peso más')
    assert.equal(p.rendimientoCents, 0, 'sin tasa no hubo rendimiento de ningún signo')
    assert.equal(p.mesSinDeuda, 2)
  })

  test('la deuda que devenga se come el rendimiento, y por eso se ve', () => {
    // El patrimonio de las dos rutas casi no se separa —arrastra el mismo
    // punto de partida—, pero el rendimiento sí: es exactamente la cifra que
    // esta fase saca a la superficie.
    const inicio: EstadoInicial = {
      liquidoCents: 0,
      inversionesCents: 0,
      deudas: [{ id: 1, nombre: 'Tarjeta', saldoCents: 100_000_00, annualRateBp: 4500, pagoMensualCents: 0 }],
    }
    const comun = { meses: 36, ahorroMensualCents: 4_000_00, rendimientoAnualBp: 700 }
    const invertir = proyectar(inicio, sup({ ...comun, estrategia: 'invertir' }))
    const deuda = proyectar(inicio, sup({ ...comun, estrategia: 'deuda' }))

    assert.ok(
      deuda.interesPagadoCents < invertir.interesPagadoCents,
      'pagar la deuda antes cuesta menos interés',
    )
    assert.ok(
      deuda.rendimientoCents > invertir.rendimientoCents,
      'y por eso la ruta de la deuda rinde más al 45 % contra el 7 %',
    )
    // Al 45 % de tasa, invertir al 7 % pierde: el rendimiento es negativo.
    assert.ok(invertir.rendimientoCents < 0)
  })

  test('el interés acumulado nunca baja, mes a mes', () => {
    const inicio: EstadoInicial = {
      liquidoCents: 0,
      inversionesCents: 0,
      deudas: [{ id: 1, nombre: 'Crédito', saldoCents: 240_000_00, annualRateBp: 1350, pagoMensualCents: 6_500_00 }],
    }
    const p = proyectar(
      inicio,
      sup({ meses: 48, ahorroMensualCents: 0, rendimientoAnualBp: 0, estrategia: 'invertir' }),
    )
    for (let i = 1; i < p.puntos.length; i++) {
      assert.ok(
        p.puntos[i]!.interesPagadoCents >= p.puntos[i - 1]!.interesPagadoCents,
        `el mes ${i} devolvió interés al usuario`,
      )
    }
    assert.equal(p.interesPagadoCents, p.puntos.at(-1)!.interesPagadoCents)
  })

  test('el porcentaje calla cuando su base no es positiva', () => {
    // Empezar debiendo más de lo que tienes: dividir por una base negativa
    // daría un porcentaje con el signo al revés y parecería un dato.
    const inicio: EstadoInicial = {
      liquidoCents: 0,
      inversionesCents: 0,
      deudas: [{ id: 1, nombre: 'Hundido', saldoCents: 100_000_00, annualRateBp: 0, pagoMensualCents: 0 }],
    }
    const p = proyectar(
      inicio,
      sup({ meses: 6, ahorroMensualCents: 0, rendimientoAnualBp: 700, estrategia: 'invertir' }),
    )
    assert.equal(p.puntos.at(-1)!.rendimientoBp, null)
  })

  test('lo que le sacaste a tu dinero es la tasa que supusiste, cuando nada la diluye', () => {
    // Sin líquido quieto y sin deudas, todo el patrimonio rinde la tasa
    // escrita: la tasa equivalente tiene que devolver esa misma cifra. Es la
    // comprobación de que la serie en porcentaje se puede comparar de frente
    // contra el supuesto del usuario.
    const p = proyectar(
      { ...vacio, inversionesCents: 100_000_00 },
      sup({ meses: 120, ahorroMensualCents: 3_000_00, rendimientoAnualBp: 700, estrategia: 'invertir' }),
    )
    assert.ok(p.tasaEquivalenteBp !== null)
    assert.ok(
      Math.abs(p.tasaEquivalenteBp! - 700) <= 3,
      `esperaba ~700 bp y dio ${p.tasaEquivalenteBp}`,
    )
  })

  test('el saldo líquido quieto la baja, y eso es el dato', () => {
    const conLiquido = proyectar(
      { ...vacio, liquidoCents: 300_000_00, inversionesCents: 100_000_00 },
      sup({ meses: 120, ahorroMensualCents: 3_000_00, rendimientoAnualBp: 700, estrategia: 'invertir' }),
    )
    assert.ok(conLiquido.tasaEquivalenteBp !== null)
    assert.ok(
      conLiquido.tasaEquivalenteBp! < 700,
      'el dinero parado no rinde, y la tasa de todo tu dinero lo cuenta',
    )
  })
})

describe('inflación · la misma proyección en pesos de hoy', () => {
  test('sin inflación, nominal y real son idénticas hasta el centavo', () => {
    const p = proyectar(
      { ...vacio, inversionesCents: 500_000_00 },
      sup({ meses: 240, ahorroMensualCents: 2_000_00, rendimientoAnualBp: 700, estrategia: 'invertir' }),
    )
    for (const q of p.puntos) assert.equal(q.patrimonioRealCents, q.patrimonioCents)
    assert.equal(p.patrimonioRealFinalCents, p.patrimonioFinalCents)
  })

  test('descontar un año a la inflación anual quita exactamente esa inflación', () => {
    assert.equal(enPesosDeHoy(110_000, 12, 1000), 100_000)
    assert.equal(enPesosDeHoy(100_000, 0, 1000), 100_000, 'hoy es hoy')
    assert.equal(enPesosDeHoy(100_000, 24, 0), 100_000, 'sin inflación no se toca nada')
  })

  test('la inflación no mueve una sola cifra nominal', () => {
    // Es el supuesto 5, y es lo que separa esto de "ajustar la proyección":
    // la serie real es una segunda lectura, no otra simulación.
    const comun = {
      meses: 120,
      ahorroMensualCents: 4_000_00,
      rendimientoAnualBp: 700,
      estrategia: 'invertir' as const,
    }
    const sinInflacion = proyectar({ ...vacio, inversionesCents: 100_000_00 }, sup(comun))
    const conInflacion = proyectar(
      { ...vacio, inversionesCents: 100_000_00 },
      sup({ ...comun, inflacionAnualBp: 500 }),
    )
    assert.equal(conInflacion.patrimonioFinalCents, sinInflacion.patrimonioFinalCents)
    assert.ok(
      conInflacion.patrimonioRealFinalCents < conInflacion.patrimonioFinalCents,
      'y la lectura real sí baja: son los mismos pesos, valiendo menos',
    )
  })

  test('rendir lo mismo que la inflación deja el patrimonio real donde estaba', () => {
    // Sin aportar nada y con la tasa igual a la inflación, en pesos de hoy no
    // pasó nada — que es justo lo que una proyección nominal esconde.
    const p = proyectar(
      { ...vacio, inversionesCents: 1_000_000_00 },
      sup({
        meses: 120,
        ahorroMensualCents: 0,
        rendimientoAnualBp: 600,
        inflacionAnualBp: 600,
        estrategia: 'invertir',
      }),
    )
    const desvio = Math.abs(p.patrimonioRealFinalCents - 1_000_000_00)
    assert.ok(desvio < 100_00, `el real se movió ${desvio} centavos`)
    assert.ok(p.patrimonioFinalCents > 1_700_000_00, 'aunque el nominal casi se duplicó')
  })
})

describe('retiro · aportar N y después sacar M', () => {
  const veinte: EstadoInicial = { ...vacio, inversionesCents: 0 }

  test('mientras se aporta nada cambia respecto de la simulación de siempre', () => {
    const comun = {
      meses: 120,
      ahorroMensualCents: 5_000_00,
      rendimientoAnualBp: 700,
      estrategia: 'invertir' as const,
    }
    const sinRetiro = proyectar(veinte, sup(comun))
    const conRetiro = proyectar(veinte, sup({ ...comun, mesesAporte: 120, retiroMensualCents: 30_000_00 }))
    // Aportar los 120 meses de un horizonte de 120 no deja mes de retiro: la
    // fase existe pero no llega a correr, y la proyección es la misma.
    assert.equal(conRetiro.patrimonioFinalCents, sinRetiro.patrimonioFinalCents)
    assert.equal(conRetiro.retiradoCents, 0)
    assert.equal(conRetiro.mesSinFondos, null)
  })

  test('el retiro sale de lo invertido y la curva baja', () => {
    const p = proyectar(
      { ...vacio, inversionesCents: 100_000_00 },
      sup({
        meses: 24,
        mesesAporte: 12,
        ahorroMensualCents: 10_000_00,
        retiroMensualCents: 5_000_00,
        rendimientoAnualBp: 0,
        estrategia: 'invertir',
      }),
    )
    assert.equal(p.aportadoCents, 12 * 10_000_00)
    assert.equal(p.retiradoCents, 12 * 5_000_00)
    const cima = p.puntos[12]!
    assert.equal(cima.patrimonioCents, 100_000_00 + 12 * 10_000_00, 'la cima es el último mes de aporte')
    assert.equal(p.patrimonioFinalCents, cima.patrimonioCents - 12 * 5_000_00)
    assert.equal(p.mesSinFondos, null, 'alcanzó de sobra')
  })

  test('cuando ya no alcanza, se dice en qué mes y no se inventa dinero', () => {
    const p = proyectar(
      { ...vacio, inversionesCents: 30_000_00 },
      sup({
        meses: 12,
        mesesAporte: 0,
        ahorroMensualCents: 0,
        retiroMensualCents: 10_000_00,
        rendimientoAnualBp: 0,
        estrategia: 'invertir',
      }),
    )
    assert.equal(p.mesSinFondos, 4, 'aguantó tres meses completos')
    assert.equal(p.retiradoCents, 30_000_00, 'no salió un peso más de los que había')
    assert.equal(p.patrimonioFinalCents, 0, 'y el patrimonio se queda en cero, no en negativo')
  })

  test('el líquido entra al rescate solo cuando lo invertido se acabó', () => {
    const p = proyectar(
      { liquidoCents: 40_000_00, inversionesCents: 20_000_00, deudas: [] },
      sup({
        meses: 3,
        mesesAporte: 0,
        ahorroMensualCents: 0,
        retiroMensualCents: 15_000_00,
        rendimientoAnualBp: 0,
        estrategia: 'invertir',
      }),
    )
    assert.equal(p.puntos[1]!.inversionesCents, 5_000_00, 'el primer mes salió entero de la inversión')
    assert.equal(p.puntos[1]!.liquidoCents, 40_000_00, 'el líquido no se tocó')
    assert.equal(p.puntos[2]!.inversionesCents, 0)
    assert.equal(p.puntos[2]!.liquidoCents, 30_000_00, 'el segundo mes le faltaron 10 000 y los tomó de ahí')
    assert.equal(p.retiradoCents, 45_000_00)
  })
})

describe('la pregunta al revés · cuánto aparto al mes', () => {
  test('el aporte que devuelve llega, y uno menos ya no', () => {
    // Es la definición de "el más chico que llega", y se comprueba corriendo
    // la misma proyección con las dos cifras.
    const inicio: EstadoInicial = { ...vacio, liquidoCents: 50_000_00 }
    const supuestos = {
      meses: 36,
      rendimientoAnualBp: 700,
      inflacionAnualBp: 0,
      mesesAporte: 36,
      retiroMensualCents: 0,
      estrategia: 'invertir' as const,
    }
    const objetivo = 500_000_00
    const cuanto = ahorroParaMeta(inicio, supuestos, objetivo)
    assert.ok(cuanto !== null && cuanto > 0)
    assert.ok(
      proyectar(inicio, { ...supuestos, ahorroMensualCents: cuanto! }).patrimonioFinalCents >= objetivo,
      'con esa cifra sí llega',
    )
    assert.ok(
      proyectar(inicio, { ...supuestos, ahorroMensualCents: cuanto! - 1 }).patrimonioFinalCents < objetivo,
      'y con un centavo menos, no',
    )
  })

  test('si ya llegaste, la respuesta es cero, no una cifra de cortesía', () => {
    const inicio: EstadoInicial = { ...vacio, liquidoCents: 600_000_00 }
    const cuanto = ahorroParaMeta(
      inicio,
      {
        meses: 12,
        rendimientoAnualBp: 0,
        inflacionAnualBp: 0,
        mesesAporte: 12,
        retiroMensualCents: 0,
        estrategia: 'invertir',
      },
      500_000_00,
    )
    assert.equal(cuanto, 0)
  })

  test('lo inalcanzable se dice, no se aproxima', () => {
    const cuanto = ahorroParaMeta(
      vacio,
      {
        meses: 1,
        rendimientoAnualBp: 0,
        inflacionAnualBp: 0,
        mesesAporte: 1,
        retiroMensualCents: 0,
        estrategia: 'invertir',
      },
      // Más de lo que cabe en el tope de un solo aporte mensual.
      99_999_999_999_999,
    )
    assert.equal(cuanto, null)
  })

  test('sin rendimiento la respuesta es la división de toda la vida', () => {
    // Juntar 120 000 en 12 meses partiendo de cero y sin tasa son 10 000 al
    // mes. Si la bisección se desviara, aquí se vería de inmediato.
    const cuanto = ahorroParaMeta(
      vacio,
      {
        meses: 12,
        rendimientoAnualBp: 0,
        inflacionAnualBp: 0,
        mesesAporte: 12,
        retiroMensualCents: 0,
        estrategia: 'invertir',
      },
      120_000_00,
    )
    assert.equal(cuanto, 10_000_00)
  })

  test('con una deuda cara, pagarla primero exige apartar menos', () => {
    const inicio: EstadoInicial = {
      liquidoCents: 0,
      inversionesCents: 0,
      deudas: [{ id: 1, nombre: 'Tarjeta', saldoCents: 80_000_00, annualRateBp: 4500, pagoMensualCents: 0 }],
    }
    const comun = {
      meses: 60,
      rendimientoAnualBp: 700,
      inflacionAnualBp: 0,
      mesesAporte: 60,
      retiroMensualCents: 0,
    }
    const objetivo = 200_000_00
    const porInvertir = ahorroParaMeta(inicio, { ...comun, estrategia: 'invertir' }, objetivo)
    const porDeuda = ahorroParaMeta(inicio, { ...comun, estrategia: 'deuda' }, objetivo)
    assert.ok(porInvertir !== null && porDeuda !== null)
    assert.ok(
      porDeuda! < porInvertir!,
      `pagar el 45 % primero pedía ${porDeuda} y invertir al 7 % pedía ${porInvertir}`,
    )
  })
})

// ── Por la API ────────────────────────────────────────────────────────────

let c: Cliente
before(async () => {
  c = await levantar()
})
after(() => c.cerrar())

describe('el simulador por HTTP', () => {
  const simular = (perfil: number, params: Record<string, number | string> = {}) => {
    const q = Object.entries(params)
      .map(([k, v]) => `&${k}=${v}`)
      .join('')
    return c.get<Simulacion>(`/api/simulador?profileId=${perfil}${q}`)
  }

  test('parte del libro tal como está, no de cifras propias', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Punto de partida')
    await c.post('/api/transactions', {
      profileId: perfil.id, accountId: cuenta.id, type: 'ingreso',
      amountCents: 400000, date: '2026-07-02',
    })

    const r = await simular(perfil.id, { meses: 12, ahorroMensualCents: 0, rendimientoAnualBp: 0 })
    assert.equal(r.status, 200)
    assert.equal(r.body.inicio.liquidoCents, 500000, 'la apertura más el ingreso')
    assert.equal(r.body.inicio.patrimonioCents, 500000)
    assert.equal(r.body.invertir.patrimonioFinalCents, 500000, 'sin aportar ni rendir, se queda igual')
  })

  test('sin objetivo no viene meta: no se responde lo que nadie preguntó', async () => {
    const { perfil } = await libroBase(c, 'Sin meta')
    const r = await simular(perfil.id, { meses: 12, ahorroMensualCents: 100000, rendimientoAnualBp: 700 })
    assert.equal(r.body.meta, null)
    assert.equal(r.body.supuestos.inflacionAnualBp, 0, 'y la proyección nace nominal')
    assert.equal(r.body.supuestos.mesesAporte, 12, 'aportando todo el horizonte')
  })

  test('con objetivo responde por las dos rutas, y la cifra llega', async () => {
    const { perfil } = await libroBase(c, 'Con meta')
    const objetivo = 50_000_00
    const r = await simular(perfil.id, {
      meses: 24, ahorroMensualCents: 0, rendimientoAnualBp: 500, objetivoCents: objetivo,
    })
    const meta = r.body.meta!
    assert.equal(meta.objetivoCents, objetivo)
    assert.ok(meta.invertirCents !== null && meta.invertirCents > 0)
    assert.equal(meta.deudaCents, meta.invertirCents, 'sin deuda las dos rutas piden lo mismo')

    // Y la cifra que devuelve es la que hay que apartar: se comprueba
    // volviendo a pedir la proyección con ella.
    const conEsa = await simular(perfil.id, {
      meses: 24, ahorroMensualCents: meta.invertirCents!, rendimientoAnualBp: 500,
    })
    assert.ok(conEsa.body.invertir.patrimonioFinalCents >= objetivo)
  })

  test('la inflación viaja en los supuestos y en la serie', async () => {
    const { perfil } = await libroBase(c, 'Inflación')
    const r = await simular(perfil.id, {
      meses: 120, ahorroMensualCents: 200000, rendimientoAnualBp: 700, inflacionAnualBp: 500,
    })
    assert.equal(r.body.supuestos.inflacionAnualBp, 500)
    assert.ok(r.body.invertir.patrimonioRealFinalCents < r.body.invertir.patrimonioFinalCents)
    assert.equal(
      r.body.invertir.puntos[0]!.patrimonioRealCents,
      r.body.invertir.puntos[0]!.patrimonioCents,
      'hoy vale lo que vale',
    )
  })

  test('aportar más meses de los que dura la proyección se rechaza', async () => {
    const { perfil } = await libroBase(c, 'Imposible')
    const r = await simular(perfil.id, { meses: 12, mesesAporte: 24, ahorroMensualCents: 100000 })
    assert.equal(r.status, 400)
  })

  test('una inflación fuera de rango se rechaza en vez de proyectar un absurdo', async () => {
    const { perfil } = await libroBase(c, 'Absurda')
    assert.equal((await simular(perfil.id, { inflacionAnualBp: 20001 })).status, 400)
    assert.equal((await simular(perfil.id, { inflacionAnualBp: -100 })).status, 400)
  })

  test('R11 · la meta no cuesta una consulta por iteración', async () => {
    // La bisección corre cuarenta proyecciones por ruta y **ninguna** vuelve a
    // la base: el punto de partida se lee una sola vez. Si alguien mueve una
    // lectura dentro del bucle, esto lo caza.
    const { perfil } = await libroBase(c, 'Meta barata')
    const { db } = await import('../server/db.ts')
    const original = db.prepare.bind(db)
    let consultas = 0
    ;(db as any).prepare = (sql: string) => {
      consultas++
      return original(sql)
    }
    try {
      consultas = 0
      await simular(perfil.id, { meses: 600, ahorroMensualCents: 100000, rendimientoAnualBp: 700 })
      const sinMeta = consultas

      consultas = 0
      const t0 = performance.now()
      await simular(perfil.id, {
        meses: 600, ahorroMensualCents: 100000, rendimientoAnualBp: 700, objetivoCents: 900_000_00,
      })
      const ms = performance.now() - t0
      assert.equal(consultas, sinMeta, 'preguntar por la meta no lee la base otra vez')
      assert.ok(ms < 400, `la meta a 50 años tardó ${ms.toFixed(0)} ms`)
    } finally {
      ;(db as any).prepare = original
    }
  })
})
