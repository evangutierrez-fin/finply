// Rendimiento anualizado de una serie de flujos: XIRR.
//
// Módulo PURO a propósito (R16).
//
// "Valor menos aportado" no es un rendimiento: no dice en cuánto tiempo pasó
// ni cuándo entró cada peso. Meter $10 000 hace cinco años y sacar $12 000 no
// es lo mismo que meterlos el mes pasado, y el porcentaje simple los llama
// igual. XIRR es la tasa anual que hace que todos los flujos, puestos en su
// fecha, sumen cero: es la aritmética del propio usuario con sus fechas (R9).
//
// **No hay TWR.** La rentabilidad ponderada por tiempo exige una valuación en
// cada fecha de flujo, y aquí las valuaciones las escribe el usuario a mano
// cuando se acuerda. Calcularla con los datos que hay sería inventar los
// valores intermedios; se prefiere no darla a darla mal.

import { diasEntre } from './fechas.ts'

export interface Flujo {
  date: string
  /**
   * Con signo desde el punto de vista del usuario: **negativo** lo que sale de
   * su bolsillo (un aporte) y **positivo** lo que entra (un retiro, y el valor
   * de hoy como si se liquidara todo).
   */
  amountCents: number
}

/** Convención de días: actual/365, la misma que el interés devengado. */
const DIAS_ANIO = 365

/**
 * Periodo mínimo para anualizar. Por debajo de un mes, la extrapolación
 * domina el resultado: un +2 % en tres días se anualiza en +900 % y parece un
 * dato cuando es ruido. Se devuelve `null` y la vista lo explica.
 */
export const MINIMO_DIAS = 30

/** Techo de búsqueda: +10 000 % anual. Más allá, no es una tasa, es un error. */
const TASA_MAX = 100

/** Piso de búsqueda: perderlo casi todo. Exactamente −100 % no es evaluable. */
const TASA_MIN = -0.9999

/**
 * Valor presente de unos flujos ya reducidos a (años desde la base, monto).
 *
 * La conversión de fecha a años se hace **una sola vez**, fuera de la
 * búsqueda: hacerla dentro costaba parsear cada fecha en cada iteración y un
 * libro con treinta inversiones tardaba 166 ms por petición, justo lo que R11
 * prohíbe. Medido, no supuesto.
 */
function vpn(flujos: { anios: number; monto: number }[], tasa: number): number {
  const base = 1 + tasa
  let total = 0
  for (const f of flujos) total += f.monto / Math.pow(base, f.anios)
  return total
}

/**
 * Tasa anual efectiva que anula el valor presente de unos flujos **ya
 * reducidos a (años desde el primero, monto)**, como decimal (0.0734 = 7.34 %).
 *
 * Vive aparte de `xirr` porque el simulador mide exactamente lo mismo **sin
 * calendario**: sus flujos caen en meses exactos, no en fechas, y darles
 * fechas para volver a convertirlas a años metería en una proyección el ruido
 * de que febrero tiene 28 días. Un solo buscador de raíz para los dos, que es
 * lo que evita que la tasa de una inversión y la del simulador se calculen con
 * dos aritméticas distintas.
 *
 * `null` cuando no se puede afirmar nada: menos de dos flujos, todos en el
 * mismo instante, todos del mismo signo (sin salida no hay retorno que medir) o
 * sin raíz dentro del rango buscado.
 *
 * Se resuelve por **bisección**, no por Newton: converge siempre que la raíz
 * esté encerrada, y encerrarla es justo lo que se comprueba antes. Newton es
 * más rápido y con flujos irregulares se va a infinito; aquí la velocidad no
 * importa —son unas cuantas fechas— y la respuesta correcta sí.
 */
export function tasaQueAnula(flujos: { anios: number; monto: number }[]): number | null {
  const preparados = flujos.filter((f) => f.monto !== 0)
  if (preparados.length < 2) return null
  if (preparados.every((f) => f.anios === preparados[0]!.anios)) return null

  const hayPositivo = preparados.some((f) => f.monto > 0)
  const hayNegativo = preparados.some((f) => f.monto < 0)
  if (!hayPositivo || !hayNegativo) return null

  let lo = TASA_MIN
  let hi = TASA_MAX
  let vLo = vpn(preparados, lo)
  let vHi = vpn(preparados, hi)
  if (!Number.isFinite(vLo) || !Number.isFinite(vHi)) return null
  if (vLo === 0) return lo
  if (vHi === 0) return hi
  // Sin cambio de signo no hay raíz encerrada: no se inventa una.
  if (vLo > 0 === vHi > 0) return null

  // 80 bisecciones parten el rango de 101 puntos en 101/2⁸⁰: mucho más fino
  // que lo que un `double` puede distinguir. Más iteraciones no dan más
  // precisión, solo más trabajo por petición.
  for (let i = 0; i < 80; i++) {
    const medio = (lo + hi) / 2
    const v = vpn(preparados, medio)
    if (v === 0) return medio
    if (v > 0 === vLo > 0) {
      lo = medio
      vLo = v
    } else {
      hi = medio
      vHi = v
    }
  }
  const tasa = (lo + hi) / 2
  return Number.isFinite(tasa) ? tasa : null
}

/**
 * XIRR: la tasa anual que hace que todos los flujos, **puestos en su fecha**,
 * sumen cero. Es `tasaQueAnula` con las fechas ya convertidas a años, más la
 * única regla que sí es del calendario: por debajo de `MINIMO_DIAS` no se
 * anualiza nada.
 */
export function xirr(flujos: Flujo[]): number | null {
  const utiles = flujos.filter((f) => f.amountCents !== 0)
  if (utiles.length < 2) return null

  const fechas = utiles.map((f) => f.date).sort()
  const primera = fechas[0]!
  const ultima = fechas[fechas.length - 1]!
  if (diasEntre(primera, ultima) < MINIMO_DIAS) return null

  return tasaQueAnula(
    utiles.map((f) => ({ anios: diasEntre(primera, f.date) / DIAS_ANIO, monto: f.amountCents })),
  )
}
