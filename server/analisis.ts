// Panel de análisis: cuatro números sobre los últimos meses cerrados.
//
// Todo aquí es de solo lectura y **reusa** lo que ya calculan los reportes: la
// regla de D6 (`MONTO_OPERATIVO`), la tasa de ahorro y el gasto por categoría
// salen del mismo código, no de una segunda versión. Es el mismo argumento por
// el que el patrimonio de la Fase 4 usa la fórmula del Resumen: dos
// aritméticas que deben coincidir son dos aritméticas que se separan, y el
// usuario acaba viendo dos verdades de lo mismo.
//
// Los supuestos —que hay tres— van escritos en la vista (R9):
//
//   1. Se miran **meses cerrados**. El mes en curso va a medias y arrastraría
//      cualquier promedio hacia abajo.
//   2. Gasto recurrente es el que **nació de una recurrencia** (D11), por la
//      liga que dejó la Fase 5. Lo que se registró a mano cae en discrecional
//      aunque se repita cada mes.
//   3. Colchón es el saldo **líquido** —efectivo, banco y ahorro— entre el
//      gasto operativo promedio del periodo. Una tarjeta no es colchón: es
//      crédito de alguien más.

import { accountsWithBalance, db } from './db.ts'
import {
  DESDE_MOVIMIENTOS,
  MONTO_OPERATIVO,
  TIPO_OPERATIVO,
  gastoPorCategoria,
  ingresoGastoPorMes,
  tasaDeAhorro,
} from './reportes.ts'
import { hoyISO } from '../shared/fechas.ts'
import type { Analisis } from '../shared/types.ts'

/** Cuentas cuyo saldo se puede gastar mañana. La tarjeta no es una de ellas. */
const TIPOS_LIQUIDOS = new Set(['efectivo', 'banco', 'ahorro'])

/** Mueve un 'AAAA-MM' N meses. */
function correrMes(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const total = y! * 12 + (m! - 1) + delta
  return `${Math.floor(total / 12)}-${String((((total % 12) + 12) % 12) + 1).padStart(2, '0')}`
}

/** Meses entre dos 'AAAA-MM', contando los dos extremos. */
function mesesEntre(desde: string, hasta: string): number {
  const [ya, ma] = desde.split('-').map(Number)
  const [yb, mb] = hasta.split('-').map(Number)
  return (yb! * 12 + mb!) - (ya! * 12 + ma!) + 1
}

/**
 * Gasto operativo partido por origen: el que nació de una recurrencia contra
 * todo lo demás. La liga es `recurrence_runs.tx_id`, así que un LEFT JOIN
 * basta y las dos mitades suman exactamente el gasto del periodo — hay prueba
 * de esa igualdad, que es lo que impide que la gráfica mienta.
 */
function gastoPorOrigen(profileId: number, desde: string, hasta: string) {
  const fila: any = db
    .prepare(
      `SELECT
        COALESCE(SUM(CASE WHEN rr.tx_id IS NOT NULL THEN ${MONTO_OPERATIVO} END), 0) AS recurrente,
        COALESCE(SUM(CASE WHEN rr.tx_id IS NULL THEN ${MONTO_OPERATIVO} END), 0) AS discrecional
       ${DESDE_MOVIMIENTOS}
       LEFT JOIN recurrence_runs rr ON rr.tx_id = t.id
       WHERE t.profile_id = ? AND ${TIPO_OPERATIVO} = 'gasto'
         AND substr(t.date, 1, 7) BETWEEN ? AND ?`,
    )
    .get(profileId, desde, hasta)
  return { recurrente: fila.recurrente as number, discrecional: fila.discrecional as number }
}

/**
 * Saldo que se puede gastar mañana. Se exporta porque el simulador parte de
 * la misma cifra: dos definiciones de "líquido" son dos patrimonios de hoy.
 */
export function liquidoDe(profileId: number): number {
  return (accountsWithBalance(profileId) as any[])
    .filter((a) => a.archived === 0 && TIPOS_LIQUIDOS.has(a.type))
    .reduce((s, a) => s + a.balance_cents, 0)
}

/** El mes del primer movimiento del libro. `null` si el libro está en blanco. */
function primerMes(profileId: number): string | null {
  const fila: any = db
    .prepare('SELECT MIN(substr(date, 1, 7)) AS mes FROM transactions WHERE profile_id = ?')
    .get(profileId)
  return fila?.mes ?? null
}

/**
 * El panel completo. `meses` es cuántos meses cerrados se piden; los que de
 * verdad entran pueden ser menos, porque un libro de dos meses no tiene seis.
 * Dividir entre seis lo que se gastó en dos inventaría un colchón que no
 * existe, así que el divisor es siempre el número de meses reales.
 */
export function analisis(profileId: number, meses = 6, hoy = hoyISO()): Analisis {
  const hasta = correrMes(hoy.slice(0, 7), -1)
  const pedido = correrMes(hasta, -(meses - 1))
  const primero = primerMes(profileId)

  const liquidoCents = liquidoDe(profileId)

  // Un libro sin movimientos, o que solo tiene el mes en curso, no da un solo
  // mes cerrado que medir. Se dice que no se puede decir, en vez de inventar
  // ceros que parecerían datos.
  if (primero === null || primero > hasta) {
    return {
      desde: hasta,
      hasta,
      meses: 0,
      incomeCents: 0,
      expenseCents: 0,
      tasaAhorro: null,
      recurrenteCents: 0,
      discrecionalCents: 0,
      gastoPromedioCents: null,
      liquidoCents,
      mesesColchon: null,
      concentracion: [],
    }
  }

  const desde = primero > pedido ? primero : pedido
  const cerrados = mesesEntre(desde, hasta)

  const porMes = ingresoGastoPorMes(profileId, desde, hasta)
  let incomeCents = 0
  let expenseCents = 0
  for (const { ingreso, gasto } of porMes.values()) {
    incomeCents += ingreso
    expenseCents += gasto
  }

  const { recurrente, discrecional } = gastoPorOrigen(profileId, desde, hasta)
  const categorias = gastoPorCategoria(profileId, desde, hasta)
  const totalCategorias = categorias.reduce((s, c) => s + c.gasto, 0)
  const gastoPromedioCents = Math.round(expenseCents / cerrados)

  return {
    desde,
    hasta,
    meses: cerrados,
    incomeCents,
    expenseCents,
    tasaAhorro: tasaDeAhorro(incomeCents, expenseCents),
    recurrenteCents: recurrente,
    discrecionalCents: discrecional,
    gastoPromedioCents,
    liquidoCents,
    // Dividir entre cero no da infinito, da "no se puede decir" — el mismo
    // trato que recibe la tasa de ahorro sin ingresos.
    mesesColchon: gastoPromedioCents > 0 ? liquidoCents / gastoPromedioCents : null,
    concentracion: categorias.map((c) => ({
      name: c.name,
      expenseCents: c.gasto,
      parte: totalCategorias > 0 ? c.gasto / totalCategorias : 0,
    })),
  }
}
