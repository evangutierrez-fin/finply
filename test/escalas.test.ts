// La aritmética de los ejes. Es lo único de una gráfica que puede equivocarse
// en silencio: un eje mal repartido o una escala cortada sin avisar se ven
// perfectamente bien y dicen otra cosa.
//
// Módulo puro, así que el import estático es seguro (R16).

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { pasoBonito, ticksBonitos, techoDeEscala } from '../shared/escalas.ts'

describe('pasos y marcas del eje', () => {
  test('solo usa saltos que alguien lee sin pensar', () => {
    // 1, 2, 2.5 y 5 por potencia de diez. Nada de $3,700.
    for (const rango of [10, 97, 1000, 45_000, 1_234_567, 9_999_999]) {
      const paso = pasoBonito(rango, 4)
      const mantisa = paso / 10 ** Math.floor(Math.log10(paso))
      assert.ok(
        [1, 2, 2.5, 5, 10].some((m) => Math.abs(m - mantisa) < 1e-9),
        `${rango} dio un paso de ${paso}, con mantisa ${mantisa}`,
      )
    }
  })

  test('las marcas caen en múltiplos exactos del paso', () => {
    const marcas = ticksBonitos(0, 45_000_00, 4)
    assert.ok(marcas.length >= 3 && marcas.length <= 6, `salieron ${marcas.length} marcas`)
    const paso = marcas[1]! - marcas[0]!
    for (let i = 1; i < marcas.length; i++) {
      assert.equal(marcas[i]! - marcas[i - 1]!, paso, 'el paso es constante')
    }
    // Y sin la basura del flotante: acumular el paso deja 14999.999999998.
    for (const m of marcas) assert.equal(m, Math.round(m), `${m} no es entero`)
  })

  test('el cero siempre entra cuando la serie lo cruza', () => {
    const marcas = ticksBonitos(-30_000_00, 50_000_00, 4)
    assert.ok(marcas.includes(0), 'la única marca que significa algo sola')
    assert.ok(marcas.some((m) => m < 0), 'y el lado negativo se rotula')
  })

  test('una serie toda positiva se mide desde cero, no desde su mínimo', () => {
    // Un eje que arranca en $40,000 convierte un +2 % en una montaña.
    const marcas = ticksBonitos(40_000_00, 42_000_00, 4)
    assert.equal(marcas[0], 0, 'la escala arranca en cero')
  })

  test('no truena con casos degenerados', () => {
    assert.deepEqual(ticksBonitos(0, 0), [0])
    assert.deepEqual(ticksBonitos(NaN, 10), [])
    assert.equal(pasoBonito(0, 4), 1)
    assert.equal(pasoBonito(100, 0), 1)
  })
})

describe('el techo de la escala', () => {
  test('con datos parejos no recorta nada', () => {
    const valores = [100_00, 120_00, 90_00, 110_00, 95_00, 105_00, 130_00, 85_00]
    const { techo, recortados } = techoDeEscala(valores)
    assert.equal(recortados, 0, 'recortar aquí sería mentir sin necesidad')
    assert.equal(techo, 130_00, 'el techo es el máximo real')
  })

  test('una renta grande entre gastos chicos tampoco se recorta', () => {
    // El caso que la regla NO debe atrapar: 4,500 de renta es un gasto
    // legítimo que hay que ver, no un atípico que aplaste la gráfica.
    const valores = [4_500_00, 900_00, 850_00, 620_00, 400_00, 380_00, 210_00, 150_00, 120_00, 90_00]
    const { techo, recortados } = techoDeEscala(valores)
    assert.equal(recortados, 0)
    assert.equal(techo, 4_500_00)
  })

  test('la nómina del mes sí, y se dice cuántas barras', () => {
    // Un ingreso de 45,000 entre gastos de cientos: con el máximo como techo,
    // los otros días miden dos píxeles.
    const gastos = [900_00, 850_00, 620_00, 400_00, 380_00, 210_00, 150_00, 120_00, 90_00]
    const { techo, recortados } = techoDeEscala([45_000_00, ...gastos])
    assert.equal(recortados, 1)
    assert.ok(techo < 45_000_00, 'la escala se corta')
    assert.ok(techo >= 620_00, 'pero deja ver el grueso de la serie')
  })

  test('dos quincenas también, que es donde falla la regla ingenua', () => {
    // Comparar el máximo contra el segundo no sirve: aquí son iguales.
    const gastos = Array.from({ length: 18 }, (_, i) => 100_00 + i * 20_00)
    const { recortados } = techoDeEscala([22_500_00, 22_500_00, ...gastos])
    assert.equal(recortados, 2, 'las dos quincenas se recortan')
  })

  test('con tres valores o menos, el atípico es la serie', () => {
    const { techo, recortados } = techoDeEscala([50_000_00, 100_00, 90_00])
    assert.equal(recortados, 0, 'recortarlo escondería justo lo que hay que ver')
    assert.equal(techo, 50_000_00)
  })

  test('sin valores positivos devuelve un techo usable', () => {
    // Se divide entre el techo al escalar: un cero aquí es una gráfica NaN.
    const { techo, recortados } = techoDeEscala([0, 0, 0])
    assert.ok(techo > 0)
    assert.equal(recortados, 0)
  })

  test('el factor manda: justo en la frontera no recorta', () => {
    const resto = Array.from({ length: 9 }, () => 100_00)
    // El percentil 90 de estos diez valores es 100_00, así que la frontera
    // está en 1,000.00 — diez veces. El operador es estrictamente mayor.
    assert.equal(techoDeEscala([1_000_00, ...resto]).recortados, 0, '10× justo no es atípico')
    assert.equal(techoDeEscala([1_000_01, ...resto]).recortados, 1, 'un centavo más sí')
  })
})
