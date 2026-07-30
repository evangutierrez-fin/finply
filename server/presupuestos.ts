// El presupuesto, calculado entero en un solo lugar.
//
// Lo que la vista pinta y lo que la alerta grita salen de aquí, de la misma
// llamada: mientras el tope fue un número suelto bastaba compartir la
// expresión SQL, pero ahora el techo de verdad es `tope + arrastre` y eso se
// doblega en JavaScript. Dos implementaciones acabarían diciendo dos cifras
// distintas del mismo mes, que es exactamente lo que un presupuesto no puede
// permitirse.

import { db } from './db.ts'
import { GASTO_DE_PRESUPUESTO, GASTO_DE_TOPE_TOTAL } from './reportes.ts'
import { avanceDelPeriodo, correrMesTexto } from '../shared/fechas.ts'
import type { Budget, PresupuestoMes, TopeTotal } from '../shared/types.ts'

const BUDGET_SELECT = `
  SELECT b.id, b.profile_id, b.category_id, b.period, b.period_kind, b.amount_cents,
    b.rollover, c.name AS category_name,
    ${GASTO_DE_PRESUPUESTO} AS spent_cents
  FROM budgets b
  JOIN categories c ON c.id = b.category_id
`

const TOTAL_SELECT = `
  SELECT bt.id, bt.profile_id, bt.month, bt.amount_cents,
    ${GASTO_DE_TOPE_TOTAL} AS spent_cents
  FROM budget_totals bt
`

/** Lo que llevarías gastado si el gasto fuera parejo a lo largo del periodo. */
function esperado(topeCents: number, avance: number): number {
  return Math.round(Math.max(topeCents, 0) * avance)
}

function mapBudget(row: any, arrastreCents: number, avance: number): Budget {
  const topeCents = row.amount_cents + arrastreCents
  return {
    id: row.id,
    profileId: row.profile_id,
    categoryId: row.category_id,
    categoryName: row.category_name,
    period: row.period,
    periodKind: row.period_kind,
    amountCents: row.amount_cents,
    spentCents: row.spent_cents,
    rollover: row.rollover === 1,
    arrastreCents,
    topeCents,
    esperadoCents: esperado(topeCents, avance),
  }
}

/**
 * Lo que cada categoría trae del mes anterior.
 *
 * Tres reglas, y las tres se ven en la vista:
 *
 * 1. **Decide el mes que recibe.** El arrastre es una casilla del renglón de
 *    este mes, no una propiedad eterna de la categoría: apagarla en agosto no
 *    reescribe lo que julio ya hizo.
 * 2. **Rueda en los dos sentidos.** Si sobró, suma; si te pasaste, resta. Un
 *    arrastre que solo ayudara sería un techo que sube solo, y entonces no es
 *    un techo. La cifra se muestra siempre con su signo.
 * 3. **Se corta en el primer hueco.** Un mes sin tope no tiene sobrante que
 *    heredar, y un mes que no arrastra empezó de cero: ahí nace la cadena.
 *    Por eso esto termina, y termina pronto.
 *
 * Todo en una consulta para todas las categorías que arrastran (R11).
 */
function arrastresDe(profileId: number, mes: string, categorias: number[]): Map<number, number> {
  const arrastres = new Map<number, number>()
  if (categorias.length === 0) return arrastres

  const marcas = categorias.map(() => '?').join(', ')
  const filas: any[] = db
    .prepare(
      `${BUDGET_SELECT}
       WHERE b.profile_id = ? AND b.period_kind = 'mes' AND b.period < ?
         AND b.category_id IN (${marcas})`,
    )
    .all(profileId, mes, ...categorias)

  const porCategoria = new Map<number, Map<string, any>>()
  for (const f of filas) {
    if (!porCategoria.has(f.category_id)) porCategoria.set(f.category_id, new Map())
    porCategoria.get(f.category_id)!.set(f.period, f)
  }

  for (const categoria of categorias) {
    const porPeriodo = porCategoria.get(categoria)
    const cadena: any[] = []
    let periodo = correrMesTexto(mes, -1)
    while (porPeriodo) {
      const fila = porPeriodo.get(periodo)
      if (!fila) break
      cadena.push(fila)
      if (fila.rollover !== 1) break
      periodo = correrMesTexto(periodo, -1)
    }
    // Cada mes de la cadena aporta lo que le quedó, o lo que le faltó. Sumar
    // la cadena entera es lo mismo que ir pasando el saldo de mes en mes, y no
    // depende del orden.
    let arrastre = 0
    for (const fila of cadena) arrastre += fila.amount_cents - fila.spent_cents
    arrastres.set(categoria, arrastre)
  }
  return arrastres
}

/**
 * El presupuesto de un mes: sus topes por categoría, los anuales del año al
 * que pertenece y el tope de todo el mes.
 *
 * Los anuales viajan con cada mes a propósito: la tenencia se paga en marzo y
 * en septiembre sigue importando cuánto quedó de ese tope. Un tope anual que
 * solo se viera en su mes de pago no serviría para lo único que sirve, que es
 * no llegar a diciembre sin dinero para lo de diciembre.
 */
export function presupuestosDelMes(profileId: number, mes: string, hoy: string): PresupuestoMes {
  const avance = avanceDelPeriodo(mes, hoy)
  const anio = mes.slice(0, 4)
  const avanceAnual = avanceDelPeriodo(anio, hoy)

  // Los del mes y los del año en una sola consulta: son la misma tabla y el
  // mismo cálculo, y esto lo carga también el Resumen para las alertas, donde
  // cada consulta de más se paga en cada visita (R11).
  const filas: any[] = db
    .prepare(`${BUDGET_SELECT} WHERE b.profile_id = ? AND b.period IN (?, ?) ORDER BY c.name ASC`)
    .all(profileId, mes, anio)
  const mensuales = filas.filter((f) => f.period_kind === 'mes')
  const anuales = filas.filter((f) => f.period_kind === 'anio')

  // Sin una sola categoría que arrastre no se consulta nada: quien no usa el
  // arrastre no paga por él.
  const arrastres = arrastresDe(
    profileId,
    mes,
    mensuales.filter((f) => f.rollover === 1).map((f) => f.category_id),
  )

  const total: any = db
    .prepare(`${TOTAL_SELECT} WHERE bt.profile_id = ? AND bt.month = ?`)
    .get(profileId, mes)

  return {
    avance,
    avanceAnual,
    mensuales: mensuales.map((f) => mapBudget(f, arrastres.get(f.category_id) ?? 0, avance)),
    anuales: anuales.map((f) => mapBudget(f, 0, avanceAnual)),
    total: total ? mapTotal(total, avance) : null,
  }
}

export function mapTotal(row: any, avance: number): TopeTotal {
  return {
    id: row.id,
    profileId: row.profile_id,
    month: row.month,
    amountCents: row.amount_cents,
    spentCents: row.spent_cents,
    esperadoCents: esperado(row.amount_cents, avance),
  }
}

export { BUDGET_SELECT, TOTAL_SELECT, mapBudget }
