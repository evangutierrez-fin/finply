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
import { bienesPorMes } from './bienes.ts'
import { recorrer, type EntradaInversion } from '../shared/inversiones.ts'
import { mediana } from '../shared/estadistica.ts'
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
 *
 * Desde la Fase 10 lee además el **reparto** de una partida dividida (D17) y
 * pone en **negativo** una devolución: un reembolso no es dinero que ganaste,
 * es gasto que no acabaste haciendo.
 *
 * Y desde la Fase 15, el **depósito de un arrendamiento vale cero**: recibirlo
 * no es ingreso y devolverlo no es gasto, porque ese dinero nunca fue tuyo —
 * lo tienes en la mano y lo debes. Es D6 otra vez, con otra ropa. Ojo: la
 * regla vive en el movimiento, no en el módulo, así que apagar Inmuebles no
 * convierte un depósito viejo en ingreso (R18).
 */
export const MONTO_OPERATIVO = `
  CASE
    WHEN t.debt_id IS NOT NULL THEN 0
    WHEN t.investment_entry_id IS NOT NULL THEN 0
    WHEN t.goal_entry_id IS NOT NULL THEN 0
    WHEN t.rental_role IN ('deposito', 'devolucion_deposito') THEN 0
    WHEN t.debt_payment_id IS NOT NULL THEN COALESCE(dp.interest_cents, 0)
    WHEN t.refund_of_id IS NOT NULL THEN -COALESCE(s.amount_cents, t.amount_cents)
    ELSE COALESCE(s.amount_cents, t.amount_cents)
  END`

/**
 * De qué lado cuenta un movimiento. Casi siempre su propio tipo; una
 * devolución cuenta del lado del **gasto** aunque el dinero haya entrado, que
 * es justo lo que arregla la tasa de ahorro inflada.
 *
 * Va junto con `MONTO_OPERATIVO`: uno da el signo y el otro el lado, y usar
 * `t.type` suelto en un agregado de dinero es el error que esto evita.
 */
export const TIPO_OPERATIVO = `
  CASE WHEN t.refund_of_id IS NOT NULL THEN 'gasto' ELSE t.type END`

/**
 * A qué categoría se apunta. Manda el renglón del reparto; si no hay reparto y
 * el movimiento es una devolución, manda la categoría del **gasto original**
 * —devolver una camisa baja Ropa, no sube "Otros ingresos"—; si no, la suya.
 */
export const CATEGORIA_OPERATIVA = `COALESCE(s.category_id, o.category_id, t.category_id)`

/**
 * El FROM que las tres expresiones de arriba necesitan.
 *
 * `s` es el reparto: con el LEFT JOIN, un movimiento sin dividir produce una
 * fila con su monto entero y uno dividido produce una por renglón. Sumar
 * `MONTO_OPERATIVO` da el mismo total en los dos casos —los renglones suman
 * exactamente el monto—, y agrupar por `CATEGORIA_OPERATIVA` reparte. Es lo
 * que permitió dividir partidas sin tocar una sola consulta de saldo.
 */
export const DESDE_MOVIMIENTOS = `
  FROM transactions t
  LEFT JOIN debt_payments dp ON dp.id = t.debt_payment_id
  LEFT JOIN tx_splits s ON s.tx_id = t.id
  LEFT JOIN transactions o ON o.id = t.refund_of_id
`

/**
 * El monto operativo del **movimiento entero**, sin el reparto.
 *
 * Es el gemelo de `MONTO_OPERATIVO` para cuando lo que se mide es la partida,
 * no el renglón: cuántas compras chicas hiciste, no cuántos renglones chicos
 * escribiste. Un ticket de $900 partido en tres no son tres compras de $300.
 *
 * ⚠ Es el mismo cuidado que hubo que tener con `tax_cents` en `negocio.ts`: un
 * `LEFT JOIN` a una tabla hija multiplica todo lo que viva en el padre.
 */
export const MONTO_DEL_MOVIMIENTO = `
  CASE
    WHEN t.debt_id IS NOT NULL THEN 0
    WHEN t.investment_entry_id IS NOT NULL THEN 0
    WHEN t.goal_entry_id IS NOT NULL THEN 0
    WHEN t.rental_role IN ('deposito', 'devolucion_deposito') THEN 0
    WHEN t.debt_payment_id IS NOT NULL THEN COALESCE(dp.interest_cents, 0)
    WHEN t.refund_of_id IS NOT NULL THEN -t.amount_cents
    ELSE t.amount_cents
  END`

/** El FROM de `MONTO_DEL_MOVIMIENTO`: una fila por movimiento, nunca más. */
export const DESDE_MOVIMIENTOS_SIN_REPARTO = `
  FROM transactions t
  LEFT JOIN debt_payments dp ON dp.id = t.debt_payment_id
`

/**
 * Lo gastado contra un presupuesto `b` (su perfil, su categoría y su periodo).
 * Vive aquí, y no escrito dos veces, porque lo miden la vista de Presupuestos
 * y la alerta de tope excedido: dos expresiones separadas acabarían dando dos
 * cifras del mismo tope.
 *
 * El periodo se compara **por su propio largo**: `b.period` es 'AAAA-MM' en un
 * tope mensual y 'AAAA' en uno anual, así que `length` decide sola si el
 * recorte de la fecha son siete caracteres o cuatro. Un solo fragmento sirve a
 * los dos y no hay forma de que uno se actualice sin el otro.
 */
export const GASTO_DE_PRESUPUESTO = `
  COALESCE((SELECT SUM(${MONTO_OPERATIVO})
    ${DESDE_MOVIMIENTOS}
    WHERE t.profile_id = b.profile_id
      AND ${CATEGORIA_OPERATIVA} = b.category_id
      AND ${TIPO_OPERATIVO} = 'gasto'
      AND substr(t.date, 1, length(b.period)) = b.period), 0)`

/**
 * Lo gastado contra el tope **total** de un mes `bt`. No se parece a la suma de
 * los topes por categoría y ese es justo el punto: cuenta todo el gasto del
 * mes, también el de las categorías que nadie presupuestó. Un techo total que
 * ignorara lo no presupuestado no sería un techo.
 */
export const GASTO_DE_TOPE_TOTAL = `
  COALESCE((SELECT SUM(${MONTO_OPERATIVO})
    ${DESDE_MOVIMIENTOS}
    WHERE t.profile_id = bt.profile_id
      AND ${TIPO_OPERATIVO} = 'gasto'
      AND substr(t.date, 1, 7) = bt.month), 0)`

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
        COALESCE(SUM(CASE WHEN ${TIPO_OPERATIVO} = 'ingreso' THEN ${MONTO_OPERATIVO} END), 0) AS ingreso,
        COALESCE(SUM(CASE WHEN ${TIPO_OPERATIVO} = 'gasto' THEN ${MONTO_OPERATIVO} END), 0) AS gasto
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
       LEFT JOIN categories c ON c.id = ${CATEGORIA_OPERATIVA}
       WHERE t.profile_id = ? AND ${TIPO_OPERATIVO} = 'gasto'
         AND substr(t.date, 1, 7) BETWEEN ? AND ?
       GROUP BY name
       HAVING gasto <> 0
       ORDER BY gasto DESC`,
    )
    .all(profileId, desde, hasta) as { name: string; gasto: number }[]
}

/**
 * Ingreso operativo por categoría: **de dónde vino** el dinero.
 *
 * Es el espejo exacto de `gastoPorCategoria` y no existía: el libro sabía
 * desmenuzar en qué se va el dinero pero no de dónde viene, y las dos
 * preguntas pesan lo mismo. Quien vive de un sueldo y quien vive de seis
 * clientes tienen riesgos distintos, y hasta hoy Finply no podía notarlo.
 */
export function ingresoPorCategoria(profileId: number, desde: string, hasta: string) {
  return db
    .prepare(
      `SELECT COALESCE(c.name, 'Sin categoría') AS name,
        SUM(${MONTO_OPERATIVO}) AS monto
       ${DESDE_MOVIMIENTOS}
       LEFT JOIN categories c ON c.id = ${CATEGORIA_OPERATIVA}
       WHERE t.profile_id = ? AND ${TIPO_OPERATIVO} = 'ingreso'
         AND substr(t.date, 1, 7) BETWEEN ? AND ?
       GROUP BY name
       HAVING monto <> 0
       ORDER BY monto DESC`,
    )
    .all(profileId, desde, hasta) as { name: string; monto: number }[]
}

/** Gasto operativo por etiqueta. Una partida con dos etiquetas cuenta en las dos. */
function gastoPorEtiqueta(profileId: number, desde: string, hasta: string) {
  return db
    .prepare(
      `SELECT tg.name AS name, SUM(${MONTO_OPERATIVO}) AS gasto
       ${DESDE_MOVIMIENTOS}
       JOIN transaction_tags tt ON tt.transaction_id = t.id
       JOIN tags tg ON tg.id = tt.tag_id
       WHERE t.profile_id = ? AND ${TIPO_OPERATIVO} = 'gasto'
         AND substr(t.date, 1, 7) BETWEEN ? AND ?
       GROUP BY tg.id
       HAVING gasto <> 0
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
 *
 * El recorrido es el de `shared/inversiones.ts`, el mismo que usa el Resumen.
 * Tener aquí una segunda copia era exactamente lo que rompía la promesa de que
 * el último punto de la serie coincide con la cifra del tablero.
 */
function inversionesPorMes(profileId: number, meses: string[]): Map<string, number> {
  const filas: any[] = db
    .prepare(
      `SELECT e.investment_id, e.id, e.type, e.amount_cents, e.date, e.units_e8, e.unit_price_cents
       FROM investment_entries e
       JOIN investments i ON i.id = e.investment_id
       WHERE i.profile_id = ? AND i.archived = 0
       ORDER BY e.date ASC, e.id ASC`,
    )
    .all(profileId)

  const porInversion = new Map<number, EntradaInversion[]>()
  for (const f of filas) {
    const lista = porInversion.get(f.investment_id) ?? []
    lista.push({
      id: f.id,
      type: f.type,
      amountCents: f.amount_cents,
      date: f.date,
      unitsE8: f.units_e8 ?? null,
      unitPriceCents: f.unit_price_cents ?? null,
    })
    porInversion.set(f.investment_id, lista)
  }

  // Una serie de valores por inversión, con su propio cursor: los meses vienen
  // en orden, así que cada punto se visita una sola vez en todo el reporte.
  const series = [...porInversion.values()].map((entradas) => ({
    puntos: recorrer(entradas).puntos,
    cursor: 0,
    valor: 0,
  }))

  const resultado = new Map<string, number>()
  for (const mes of meses) {
    let total = 0
    for (const s of series) {
      while (s.cursor < s.puntos.length && s.puntos[s.cursor]!.date.slice(0, 7) <= mes) {
        s.valor = s.puntos[s.cursor]!.valueCents
        s.cursor++
      }
      total += s.valor
    }
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
 * cuentas activas + inversiones + bienes + lo que te deben − lo que debes. Si
 * las dos dejaran de coincidir, el usuario vería dos cifras distintas de lo
 * mismo.
 *
 * Los bienes entraron en la Fase 11 (H3): sin ellos, financiar un auto solo
 * restaba. Y entran por su **valor**, no por su equity, porque la deuda que lo
 * financia ya está restada en `porPagar` y contarla dos veces sería el error
 * contrario (R18).
 */
function patrimonioPorMes(profileId: number, meses: string[]) {
  const apertura: any = db
    .prepare(
      'SELECT COALESCE(SUM(opening_cents), 0) AS n FROM accounts WHERE profile_id = ? AND archived = 0',
    )
    .get(profileId)
  const deltas = deltaCuentasPorMes(profileId)
  const inversiones = inversionesPorMes(profileId, meses)
  const bienes = bienesPorMes(profileId, meses)
  const deudas = deudasPorMes(profileId, meses)

  return meses.map((mes) => {
    const cuentas =
      apertura.n + deltas.filter((d) => d.mes <= mes).reduce((s, d) => s + d.delta, 0)
    const inv = inversiones.get(mes) ?? 0
    const bien = bienes.get(mes) ?? 0
    const { porCobrar, porPagar } = deudas.get(mes) ?? { porCobrar: 0, porPagar: 0 }
    return {
      month: mes,
      cuentasCents: cuentas,
      inversionesCents: inv,
      bienesCents: bien,
      porCobrarCents: porCobrar,
      porPagarCents: porPagar,
      totalCents: cuentas + inv + bien + porCobrar - porPagar,
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
    porFuente: ingresoPorCategoria(profileId, desde, hasta).map((c) => ({
      name: c.name,
      incomeCents: c.monto,
    })),
    totales: {
      incomeCents,
      expenseCents,
      netCents: incomeCents - expenseCents,
      tasaAhorro: tasaDeAhorro(incomeCents, expenseCents),
      // La mediana va sobre los meses **con movimiento**, no sobre los doce.
      // En un año en curso los meses que no han llegado valen cero, y contarlos
      // arrastraría la mediana al suelo: en julio diría que la mitad de tus
      // meses no gastan nada. Es el mismo criterio de los meses cerrados.
      ...medianasDe(mesesLlenos.filter((m) => m.incomeCents !== 0 || m.expenseCents !== 0)),
    },
  }
}

/** Mediana del ingreso y del gasto sobre los meses que se le pasen. */
function medianasDe(meses: { incomeCents: number; expenseCents: number }[]) {
  return {
    medianaIngresoCents: mediana(meses.map((m) => m.incomeCents)),
    medianaGastoCents: mediana(meses.map((m) => m.expenseCents)),
    mesesConMovimiento: meses.length,
  }
}

/**
 * Dos periodos cualesquiera, categoría por categoría.
 *
 * Nació comparando un mes con el anterior y se quedó corta: quien quiera ver
 * este trimestre contra el pasado, o el año contra el año, tenía que sumar a
 * mano. Los rangos son de mes a mes, inclusivos por los dos lados, y no tienen
 * que medir lo mismo — comparar un mes contra un año es legítimo si es lo que
 * el usuario quiere, y la vista escribe qué se está comparando con qué.
 */
export function comparativa(
  profileId: number,
  actual: { desde: string; hasta: string },
  previo?: { desde: string; hasta: string },
): Comparativa {
  // Sin segundo periodo, el de antes: el mismo número de meses, justo antes.
  const largo = mesesEntre(actual.desde, actual.hasta)
  const contra = previo ?? {
    desde: correrMes(actual.desde, -largo),
    hasta: correrMes(actual.hasta, -largo),
  }

  const totales = (r: { desde: string; hasta: string }) => {
    let ingreso = 0
    let gasto = 0
    for (const m of ingresoGastoPorMes(profileId, r.desde, r.hasta).values()) {
      ingreso += m.ingreso
      gasto += m.gasto
    }
    return { incomeCents: ingreso, expenseCents: gasto }
  }

  const catsActual = gastoPorCategoria(profileId, actual.desde, actual.hasta)
  const catsPrevio = gastoPorCategoria(profileId, contra.desde, contra.hasta)
  const nombres = new Set([...catsActual, ...catsPrevio].map((c) => c.name))
  const categorias = [...nombres]
    .map((name) => {
      const a = catsActual.find((c) => c.name === name)?.gasto ?? 0
      const p = catsPrevio.find((c) => c.name === name)?.gasto ?? 0
      return { name, actualCents: a, previoCents: p, deltaCents: a - p }
    })
    .sort((x, y) => Math.abs(y.deltaCents) - Math.abs(x.deltaCents))

  return {
    actual: { ...actual, ...totales(actual) },
    previo: { ...contra, ...totales(contra) },
    categorias,
  }
}

/** Meses entre dos 'AAAA-MM', contando los dos extremos. */
function mesesEntre(desde: string, hasta: string): number {
  const [ya, ma] = desde.split('-').map(Number)
  const [yb, mb] = hasta.split('-').map(Number)
  return yb! * 12 + mb! - (ya! * 12 + ma!) + 1
}
