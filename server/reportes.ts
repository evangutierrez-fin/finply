// Reportes históricos. Todo de solo lectura: aquí no se escribe una sola fila.
//
// La regla que gobierna estos números, decidida en D6: **mover dinero entre
// bolsillos tuyos no es ingreso ni gasto**. Un préstamo que recibes no lo
// ganaste, un enganche o un aporte a una inversión no te lo gastaste, y un
// retiro de inversión no es un ingreso. De un abono a una deuda cuenta solo el
// interés —eso sí es el costo de deber—; el capital baja tu deuda, que es la
// definición misma de ahorrar.
//
// Sin esto, sacar un crédito de $240,000 duplicaba la tasa de ahorro del mes.

import { db } from './db.ts'
import type { Comparativa, ReporteAnual } from '../shared/types.ts'

/** Mueve un 'AAAA-MM' N meses. */
function correrMes(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const total = y! * 12 + (m! - 1) + delta
  return `${Math.floor(total / 12)}-${String((((total % 12) + 12) % 12) + 1).padStart(2, '0')}`
}

/**
 * Cuánto de un movimiento cuenta como ingreso o gasto. Los que solo mueven
 * patrimonio valen cero; de un abono a deuda, solo su parte de interés.
 *
 * Se exporta porque el panel de análisis mide lo mismo: si tuviera su propia
 * versión de la regla, el usuario acabaría viendo dos tasas de ahorro
 * distintas de los mismos movimientos.
 */
export const MONTO_OPERATIVO = `
  CASE
    WHEN t.debt_id IS NOT NULL THEN 0
    WHEN t.investment_entry_id IS NOT NULL THEN 0
    WHEN t.debt_payment_id IS NOT NULL THEN COALESCE(dp.interest_cents, 0)
    ELSE t.amount_cents
  END`

/** El JOIN que `MONTO_OPERATIVO` necesita para ver el desglose del abono. */
export const DESDE_MOVIMIENTOS = `
  FROM transactions t
  LEFT JOIN debt_payments dp ON dp.id = t.debt_payment_id
`

/** Los doce meses de un año, en orden, como 'AAAA-MM'. */
function mesesDelAnio(year: number): string[] {
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`)
}

/**
 * Ingresos y gastos operativos por mes. Devuelve solo los meses con datos: el
 * relleno de los vacíos se hace arriba, contra la lista completa de meses.
 */
export function ingresoGastoPorMes(profileId: number, desde: string, hasta: string) {
  const filas: any[] = db
    .prepare(
      `SELECT substr(t.date, 1, 7) AS mes,
        COALESCE(SUM(CASE WHEN t.type = 'ingreso' THEN ${MONTO_OPERATIVO} END), 0) AS ingreso,
        COALESCE(SUM(CASE WHEN t.type = 'gasto' THEN ${MONTO_OPERATIVO} END), 0) AS gasto
       ${DESDE_MOVIMIENTOS}
       WHERE t.profile_id = ? AND t.type IN ('ingreso', 'gasto')
         AND substr(t.date, 1, 7) BETWEEN ? AND ?
       GROUP BY mes`,
    )
    .all(profileId, desde, hasta)
  const porMes = new Map<string, { ingreso: number; gasto: number }>()
  for (const f of filas) porMes.set(f.mes, { ingreso: f.ingreso, gasto: f.gasto })
  return porMes
}

/** Gasto operativo por categoría en un rango de meses. */
export function gastoPorCategoria(profileId: number, desde: string, hasta: string) {
  return db
    .prepare(
      `SELECT COALESCE(c.name, 'Sin categoría') AS name,
        SUM(${MONTO_OPERATIVO}) AS gasto
       ${DESDE_MOVIMIENTOS}
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.profile_id = ? AND t.type = 'gasto'
         AND substr(t.date, 1, 7) BETWEEN ? AND ?
       GROUP BY name
       HAVING gasto > 0
       ORDER BY gasto DESC`,
    )
    .all(profileId, desde, hasta) as { name: string; gasto: number }[]
}

/** Gasto operativo por etiqueta. Una partida con dos etiquetas cuenta en las dos. */
function gastoPorEtiqueta(profileId: number, desde: string, hasta: string) {
  return db
    .prepare(
      `SELECT tg.name AS name, SUM(${MONTO_OPERATIVO}) AS gasto
       ${DESDE_MOVIMIENTOS}
       JOIN transaction_tags tt ON tt.transaction_id = t.id
       JOIN tags tg ON tg.id = tt.tag_id
       WHERE t.profile_id = ? AND t.type = 'gasto'
         AND substr(t.date, 1, 7) BETWEEN ? AND ?
       GROUP BY tg.id
       HAVING gasto > 0
       ORDER BY gasto DESC
       LIMIT 12`,
    )
    .all(profileId, desde, hasta) as { name: string; gasto: number }[]
}

/**
 * Movimiento neto de las cuentas activas, mes a mes, desde siempre. Son unas
 * decenas de filas —una por mes con actividad—, no la tabla entera: el
 * acumulado se hace sobre eso (R11).
 */
function deltaCuentasPorMes(profileId: number) {
  return db
    .prepare(
      `SELECT mes, SUM(delta) AS delta FROM (
         SELECT substr(t.date, 1, 7) AS mes,
           CASE WHEN t.type = 'ingreso' THEN t.amount_cents ELSE -t.amount_cents END AS delta
         FROM transactions t
         JOIN accounts a ON a.id = t.account_id
         WHERE a.profile_id = ? AND a.archived = 0
         UNION ALL
         -- La pata que entra de una transferencia: suma en la cuenta destino.
         SELECT substr(t.date, 1, 7), t.amount_cents
         FROM transactions t
         JOIN accounts a ON a.id = t.transfer_account_id
         WHERE a.profile_id = ? AND a.archived = 0
       )
       GROUP BY mes ORDER BY mes ASC`,
    )
    .all(profileId, profileId) as { mes: string; delta: number }[]
}

/**
 * Valor de las inversiones al cierre de cada mes pedido. Se recorren las
 * entradas una sola vez —son pocas y manuales— porque una valuación *fija* el
 * valor y los aportes y retiros posteriores lo ajustan: no es una suma.
 */
function inversionesPorMes(profileId: number, meses: string[]): Map<string, number> {
  const entradas: any[] = db
    .prepare(
      `SELECT e.investment_id, e.type, e.amount_cents, e.date
       FROM investment_entries e
       JOIN investments i ON i.id = e.investment_id
       WHERE i.profile_id = ? AND i.archived = 0
       ORDER BY e.date ASC, e.id ASC`,
    )
    .all(profileId)

  const valorPorInversion = new Map<number, number>()
  const resultado = new Map<string, number>()
  let indice = 0
  for (const mes of meses) {
    while (indice < entradas.length && entradas[indice]!.date.slice(0, 7) <= mes) {
      const e = entradas[indice]!
      const actual = valorPorInversion.get(e.investment_id) ?? 0
      if (e.type === 'aporte') valorPorInversion.set(e.investment_id, actual + e.amount_cents)
      else if (e.type === 'retiro') {
        valorPorInversion.set(e.investment_id, Math.max(0, actual - e.amount_cents))
      } else valorPorInversion.set(e.investment_id, e.amount_cents)
      indice++
    }
    let total = 0
    for (const v of valorPorInversion.values()) total += v
    resultado.set(mes, total)
  }
  return resultado
}

/**
 * Saldo insoluto de las deudas al cierre de cada mes, por dirección. El piso
 * en cero es por deuda, no sobre el total: una pagada de más no puede tapar
 * lo que se debe en otra.
 */
function deudasPorMes(profileId: number, meses: string[]) {
  const deudas: any[] = db
    .prepare('SELECT id, direction, principal_cents, start_date FROM debts WHERE profile_id = ?')
    .all(profileId)
  const abonos: any[] = db
    .prepare(
      `SELECT p.debt_id, substr(p.date, 1, 7) AS mes,
        SUM(p.amount_cents - p.interest_cents) AS capital
       FROM debt_payments p
       JOIN debts d ON d.id = p.debt_id
       WHERE d.profile_id = ?
       GROUP BY p.debt_id, mes`,
    )
    .all(profileId)

  const resultado = new Map<string, { porCobrar: number; porPagar: number }>()
  for (const mes of meses) {
    let porCobrar = 0
    let porPagar = 0
    for (const d of deudas) {
      if (d.start_date.slice(0, 7) > mes) continue
      const capital = abonos
        .filter((a) => a.debt_id === d.id && a.mes <= mes)
        .reduce((s, a) => s + a.capital, 0)
      const saldo = Math.max(0, d.principal_cents - capital)
      if (d.direction === 'por_cobrar') porCobrar += saldo
      else porPagar += saldo
    }
    resultado.set(mes, { porCobrar, porPagar })
  }
  return resultado
}

/**
 * Patrimonio al cierre de cada mes, con la **misma fórmula que el Resumen**:
 * cuentas activas + inversiones + lo que te deben − lo que debes. Si las dos
 * dejaran de coincidir, el usuario vería dos cifras distintas de lo mismo.
 */
function patrimonioPorMes(profileId: number, meses: string[]) {
  const apertura: any = db
    .prepare(
      'SELECT COALESCE(SUM(opening_cents), 0) AS n FROM accounts WHERE profile_id = ? AND archived = 0',
    )
    .get(profileId)
  const deltas = deltaCuentasPorMes(profileId)
  const inversiones = inversionesPorMes(profileId, meses)
  const deudas = deudasPorMes(profileId, meses)

  return meses.map((mes) => {
    const cuentas =
      apertura.n + deltas.filter((d) => d.mes <= mes).reduce((s, d) => s + d.delta, 0)
    const inv = inversiones.get(mes) ?? 0
    const { porCobrar, porPagar } = deudas.get(mes) ?? { porCobrar: 0, porPagar: 0 }
    return {
      month: mes,
      cuentasCents: cuentas,
      inversionesCents: inv,
      porCobrarCents: porCobrar,
      porPagarCents: porPagar,
      totalCents: cuentas + inv + porCobrar - porPagar,
    }
  })
}

/**
 * Tasa de ahorro: de cada peso que entró, cuánto no salió. `null` sin
 * ingresos, porque dividir entre cero no es cero, es "no se puede decir".
 */
export function tasaDeAhorro(incomeCents: number, expenseCents: number): number | null {
  if (incomeCents <= 0) return null
  return (incomeCents - expenseCents) / incomeCents
}

export function reporteAnual(profileId: number, year: number): ReporteAnual {
  const meses = mesesDelAnio(year)
  const desde = meses[0]!
  const hasta = meses[11]!
  const porMes = ingresoGastoPorMes(profileId, desde, hasta)

  // Los meses sin datos existen igual, en cero: una serie con huecos rompe la
  // gráfica y hace creer que el año tuvo menos meses.
  const mesesLlenos = meses.map((month) => {
    const { ingreso, gasto } = porMes.get(month) ?? { ingreso: 0, gasto: 0 }
    return { month, incomeCents: ingreso, expenseCents: gasto, netCents: ingreso - gasto }
  })

  const incomeCents = mesesLlenos.reduce((s, m) => s + m.incomeCents, 0)
  const expenseCents = mesesLlenos.reduce((s, m) => s + m.expenseCents, 0)

  return {
    year,
    meses: mesesLlenos,
    patrimonio: patrimonioPorMes(profileId, meses),
    porCategoria: gastoPorCategoria(profileId, desde, hasta).map((c) => ({
      name: c.name,
      expenseCents: c.gasto,
    })),
    porEtiqueta: gastoPorEtiqueta(profileId, desde, hasta).map((e) => ({
      name: e.name,
      expenseCents: e.gasto,
    })),
    totales: {
      incomeCents,
      expenseCents,
      netCents: incomeCents - expenseCents,
      tasaAhorro: tasaDeAhorro(incomeCents, expenseCents),
    },
  }
}

/** Un mes contra el anterior, categoría por categoría. */
export function comparativa(profileId: number, month: string): Comparativa {
  const anterior = correrMes(month, -1)
  const porMes = ingresoGastoPorMes(profileId, anterior, month)
  const actual = porMes.get(month) ?? { ingreso: 0, gasto: 0 }
  const previo = porMes.get(anterior) ?? { ingreso: 0, gasto: 0 }

  const catsActual = gastoPorCategoria(profileId, month, month)
  const catsPrevio = gastoPorCategoria(profileId, anterior, anterior)
  const nombres = new Set([...catsActual, ...catsPrevio].map((c) => c.name))
  const categorias = [...nombres]
    .map((name) => {
      const a = catsActual.find((c) => c.name === name)?.gasto ?? 0
      const p = catsPrevio.find((c) => c.name === name)?.gasto ?? 0
      return { name, actualCents: a, previoCents: p, deltaCents: a - p }
    })
    .sort((x, y) => Math.abs(y.deltaCents) - Math.abs(x.deltaCents))

  return {
    month,
    anterior,
    actual: { incomeCents: actual.ingreso, expenseCents: actual.gasto },
    previo: { incomeCents: previo.ingreso, expenseCents: previo.gasto },
    categorias,
  }
}
