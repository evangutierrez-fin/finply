// La aritmética que se equivoca sin que se note.
//
// Vive aquí y no dentro de un componente por la misma razón que `escalas.ts`:
// una recta de tendencia mal ajustada o una mediana mal calculada se ven
// perfectamente bien en pantalla, y en un `.tsx` no se pueden probar. Módulo
// PURO (R16): no importa nada que abra la base.

/**
 * El valor de en medio. Con un número par de datos, el promedio de los dos
 * centrales.
 *
 * Existe porque el promedio miente cuando un mes trae una compra grande: si
 * cambiaste el refri en marzo, el promedio dice que gastas más de lo que
 * gastas todos los meses. La mediana no se mueve por un solo mes raro, y por
 * eso las dos van juntas — nunca una sola sin decir cuál es (R9).
 */
export function mediana(valores: number[]): number | null {
  if (valores.length === 0) return null
  return Math.round(medianaCruda(valores))
}

/** La misma mediana sin redondear, para cuando el resultado es una pendiente. */
function medianaCruda(valores: number[]): number {
  const orden = [...valores].sort((a, b) => a - b)
  const medio = Math.floor(orden.length / 2)
  if (orden.length % 2 === 1) return orden[medio]!
  return (orden[medio - 1]! + orden[medio]!) / 2
}

export interface Tendencia {
  /** Cuánto cambia por periodo. Negativo si va bajando. */
  pendienteCents: number
  /** Lo que la recta dice del primer periodo y del último. */
  primeroCents: number
  ultimoCents: number
  /**
   * De todos los pares de meses, qué fracción va en el mismo sentido que la
   * pendiente. 0.5 es una moneda al aire; 1 es que nunca se contradice. Es lo
   * que permite decir "no hay dirección" en vez de dibujar una flecha.
   */
  consistencia: number
}

/**
 * Tendencia de una serie de periodos consecutivos, por el método de Theil–Sen:
 * la **pendiente de en medio** entre todos los pares de meses.
 *
 * No son mínimos cuadrados, y la razón es concreta. Con cinco meses parejos y
 * un viaje en el sexto, la recta de mínimos cuadrados declaraba que el gasto
 * subía $2,000 al mes: un solo mes le torcía el brazo y el resultado era una
 * flecha hacia arriba que ningún mes normal respaldaba. Una mediana no se deja
 * mover por un dato raro — es la misma razón por la que la mediana acompaña al
 * promedio en el reporte anual, aplicada a la pendiente.
 *
 * **Menos de tres puntos no son una tendencia.** Por dos puntos pasa siempre
 * una recta exacta, así que llamarle tendencia a la diferencia entre dos meses
 * afirma más de lo que los datos dicen. Con menos de tres, `null`.
 */
export function tendencia(valores: number[]): Tendencia | null {
  const n = valores.length
  if (n < 3) return null

  const pendientes: number[] = []
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) pendientes.push((valores[j]! - valores[i]!) / (j - i))
  }
  const pendiente = medianaCruda(pendientes)
  // La recta pasa por el punto de en medio, no por el promedio: si la
  // pendiente es robusta y la altura no, el dato raro vuelve por la ventana.
  const ordenada = medianaCruda(valores.map((v, i) => v - pendiente * i))

  const acuerdan = pendientes.filter((p) => p !== 0 && Math.sign(p) === Math.sign(pendiente)).length

  return {
    pendienteCents: Math.round(pendiente),
    primeroCents: Math.round(ordenada),
    ultimoCents: Math.round(ordenada + pendiente * (n - 1)),
    // Una serie plana no se contradice consigo misma: ahí la consistencia es
    // total por definición, y lo que se afirma es justamente que no se mueve.
    consistencia: pendiente === 0 ? 1 : acuerdan / pendientes.length,
  }
}

/**
 * Dos de cada tres pares de meses tienen que ir en el mismo sentido para que
 * Finply diga que hay una dirección. Por debajo lo dice con palabras en vez de
 * dibujar una flecha. El umbral está escrito, no escondido (R9).
 */
export const CONSISTENCIA_MINIMA = 2 / 3
