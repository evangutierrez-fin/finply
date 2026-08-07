// Estado de resultados, punto de equilibrio y flujo de caja proyectado.
//
// Todo de solo lectura, y todo **sobre lo cobrado y lo pagado**: Finply lleva
// el libro por flujo de efectivo, no por devengado. Vendiste en enero y
// cobraste en marzo: el ingreso es de marzo. Eso se dice en la vista con
// todas sus letras (R9), porque un contador espera lo contrario y la cifra
// solo se entiende sabiendo cuál de las dos convenciones está mirando.
//
// La regla de D6 sigue mandando: recibir un préstamo no es ingreso, aportar a
// una inversión no es gasto, y de un abono a deuda cuenta solo el interés. Se
// usa el mismo fragmento SQL que los reportes —`MONTO_OPERATIVO`— para que el
// estado de resultados y el reporte anual no puedan separarse.

import { db } from './db.ts'
import {
  CATEGORIA_OPERATIVA,
  CON_CATEGORIA,
  DESDE_MOVIMIENTOS,
  MONTO_OPERATIVO,
  TIPO_OPERATIVO,
} from './reportes.ts'
import { diasEntre, finDeMes, sumarDias } from '../shared/fechas.ts'
import { margenContribucion, puntoDeEquilibrio } from '../shared/negocio.ts'
import type {
  EstadoResultados,
  PeriodoPrevio,
  RenglonRentabilidad,
  RenglonResultados,
} from '../shared/types.ts'

/** Gasto del periodo por categoría, con el papel que el usuario le asignó. */
function gastoPorRol(profileId: number, desde: string, hasta: string) {
  return db
    .prepare(
      // ⚠ `COALESCE(c.role, cp.role)`: **un hijo sin papel toma el de su padre**
      // (D25). Sin esto, colgar "Restaurante" de "Insumos" sacaría ese gasto
      // del costo de ventas y movería el punto de equilibrio sin que nadie lo
      // pidiera — que es exactamente lo que R18 prohíbe. El hijo puede llevar
      // el suyo y entonces manda el suyo.
      `SELECT c.id AS category_id, c.name, COALESCE(c.role, cp.role) AS role,
        COALESCE(SUM(${MONTO_OPERATIVO}), 0) AS monto
       ${DESDE_MOVIMIENTOS}
       ${CON_CATEGORIA}
       WHERE t.profile_id = ? AND ${TIPO_OPERATIVO} = 'gasto' AND t.date BETWEEN ? AND ?
       GROUP BY c.id
       HAVING monto <> 0
       ORDER BY monto DESC`,
    )
    .all(profileId, desde, hasta) as {
    category_id: number | null
    name: string | null
    role: string | null
    monto: number
  }[]
}

/**
 * Ingresos y gastos de un periodo, en una sola consulta. Sirve para el periodo
 * anterior, donde no hace falta el desglose: lo único que se quiere saber es
 * si este mes fue mejor o peor que el pasado.
 */
function totalesDe(profileId: number, desde: string, hasta: string) {
  const fila: any = db
    .prepare(
      `SELECT
        COALESCE(SUM(CASE WHEN ${TIPO_OPERATIVO} = 'ingreso' THEN ${MONTO_OPERATIVO} END), 0) AS ingresos,
        COALESCE(SUM(CASE WHEN ${TIPO_OPERATIVO} = 'gasto' THEN ${MONTO_OPERATIVO} END), 0) AS gastos
       ${DESDE_MOVIMIENTOS}
       WHERE t.profile_id = ? AND t.type IN ('ingreso', 'gasto') AND t.date BETWEEN ? AND ?`,
    )
    .get(profileId, desde, hasta)
  return { ingresos: fila.ingresos as number, gastos: fila.gastos as number }
}

/**
 * El periodo anterior, con dos reglas y en este orden:
 *
 *   · si el periodo es **un mes completo**, se compara contra el mes anterior
 *     completo, aunque uno tenga treinta y uno y el otro treinta;
 *   · si no, contra los mismos días de antes: una quincena contra la quincena
 *     anterior, siete días contra los siete previos.
 *
 * La primera regla es el caso normal —la vista siempre pide un mes— y el
 * atajo aritmético daría ahí una ventana absurda: los "31 días antes del 1 de
 * julio" empiezan el 31 de mayo, y nadie compara julio contra "31 may – 30
 * jun". La segunda existe porque el periodo lo escoge el usuario y puede no
 * ser un mes.
 *
 * En los dos casos la vista **escribe las fechas que usó**: comparar contra un
 * periodo que el lector no puede nombrar sería una cifra sin respaldo.
 */
function periodoPrevio(profileId: number, desde: string, hasta: string): PeriodoPrevio {
  // El anterior siempre termina la víspera; lo que cambia es dónde empieza.
  const previoHasta = sumarDias(desde, -1)
  const mesCompleto = desde.endsWith('-01') && hasta === finDeMes(desde)
  const previoDesde = mesCompleto
    ? `${previoHasta.slice(0, 7)}-01`
    : sumarDias(desde, -(diasEntre(desde, hasta) + 1))
  const { ingresos, gastos } = totalesDe(profileId, previoDesde, previoHasta)
  return {
    desde: previoDesde,
    hasta: previoHasta,
    ingresosCents: ingresos,
    gastoTotalCents: gastos,
    utilidadCents: ingresos - gastos,
  }
}

/** Ingresos, gasto atribuido y margen. La aritmética es la misma para las dos. */
function rentabilidad(id: number | null, name: string, ingresos: number, gastos: number): RenglonRentabilidad {
  return {
    id,
    name,
    ingresosCents: ingresos,
    gastoCents: gastos,
    margenCents: ingresos - gastos,
    // Sin ingresos no hay porcentaje que expresar: es la misma regla que el
    // margen bruto. Un cliente que solo trajo gastos no tiene "−100 %", tiene
    // una pregunta mal planteada.
    margenPct: ingresos > 0 ? (ingresos - gastos) / ingresos : null,
  }
}

/**
 * Qué deja cada cliente. Ojo con lo que esto **no** puede saber: el costo de
 * un gasto solo se le atribuye a alguien si el usuario le puso contraparte, y
 * la contraparte de un gasto suele ser el proveedor, no el cliente. Lo que
 * quede sin atribuir **no se reparte a ojo** entre los clientes — es la misma
 * regla que ya rige a las categorías sin papel, y por la misma razón: repartir
 * a ojo movería una cifra sin que nadie lo haya dicho.
 */
function porCliente(profileId: number, desde: string, hasta: string) {
  return db
    .prepare(
      `SELECT cp.id AS id, cp.name AS name,
        COALESCE(SUM(CASE WHEN ${TIPO_OPERATIVO} = 'ingreso' THEN ${MONTO_OPERATIVO} END), 0) AS ingresos,
        COALESCE(SUM(CASE WHEN ${TIPO_OPERATIVO} = 'gasto' THEN ${MONTO_OPERATIVO} END), 0) AS gastos
       ${DESDE_MOVIMIENTOS}
       LEFT JOIN counterparties cp ON cp.id = t.counterparty_id
       WHERE t.profile_id = ? AND t.type IN ('ingreso', 'gasto') AND t.date BETWEEN ? AND ?
       GROUP BY cp.id`,
    )
    .all(profileId, desde, hasta) as { id: number | null; name: string | null; ingresos: number; gastos: number }[]
}

/**
 * Estado de resultados del periodo. Los gastos se agrupan por el papel que el
 * usuario le dio a cada categoría; las que nadie clasificó **no se reparten a
 * ojo**, van en su propio renglón. Suponer que un gasto sin clasificar es fijo
 * movería el punto de equilibrio sin que nadie lo haya dicho.
 */
export function estadoDeResultados(
  profileId: number,
  desde: string,
  hasta: string,
): EstadoResultados {
  const ingresos: any = db
    .prepare(
      `SELECT COALESCE(SUM(${MONTO_OPERATIVO}), 0) AS monto
       ${DESDE_MOVIMIENTOS}
       WHERE t.profile_id = ? AND ${TIPO_OPERATIVO} = 'ingreso' AND t.date BETWEEN ? AND ?`,
    )
    .get(profileId, desde, hasta)

  const gastos: any = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN t.deductible = 1 THEN ${MONTO_OPERATIVO} END), 0) AS deducible
       ${DESDE_MOVIMIENTOS}
       WHERE t.profile_id = ? AND ${TIPO_OPERATIVO} = 'gasto' AND t.date BETWEEN ? AND ?`,
    )
    .get(profileId, desde, hasta)

  // ⚠ El impuesto va **sin** el JOIN del reparto. `tax_cents` es del
  // movimiento entero, así que sumarlo sobre las filas del reparto lo
  // multiplicaría por el número de renglones: un ticket dividido en tres
  // trasladaría el triple de IVA. Solo los montos se leen por renglón.
  //
  // ⚠ Y va con la regla de D6, no con `t.type` pelón. Una **devolución** es
  // dinero que entra y cuenta del lado del gasto: su impuesto no es IVA que
  // cobraste, es el IVA acreditable de la compra que se está deshaciendo.
  // Sumándolo por el tipo, devolver una compra de $1,160 con $160 de IVA
  // dejaba $160 trasladados y $160 acreditables donde lo correcto es cero y
  // cero — el neto salía bien y los dos renglones que el estado de resultados
  // enseña por separado estaban inflados los dos. Es el mismo `TIPO_OPERATIVO`
  // que ya decide el lado de los montos, con el signo que le corresponde.
  const IMPUESTO_OPERATIVO = `
    CASE WHEN t.refund_of_id IS NOT NULL THEN -t.tax_cents ELSE t.tax_cents END`
  const impuestos: any = db
    .prepare(
      `SELECT
        COALESCE(SUM(CASE WHEN ${TIPO_OPERATIVO} = 'ingreso' THEN ${IMPUESTO_OPERATIVO} END), 0)
          AS trasladado,
        COALESCE(SUM(CASE WHEN ${TIPO_OPERATIVO} = 'gasto' THEN ${IMPUESTO_OPERATIVO} END), 0)
          AS acreditable
       FROM transactions t
       WHERE t.profile_id = ? AND t.date BETWEEN ? AND ?`,
    )
    .get(profileId, desde, hasta)

  const filas = gastoPorRol(profileId, desde, hasta)
  const renglon = (f: (typeof filas)[number]): RenglonResultados => ({
    categoryId: f.category_id,
    name: f.name ?? 'Sin categoría',
    montoCents: f.monto,
  })
  const detalle = {
    costoVenta: filas.filter((f) => f.role === 'costo_venta').map(renglon),
    fijo: filas.filter((f) => f.role === 'gasto_fijo').map(renglon),
    variable: filas.filter((f) => f.role === 'gasto_variable').map(renglon),
    sinClasificar: filas.filter((f) => f.role === null).map(renglon),
  }
  const suma = (r: RenglonResultados[]) => r.reduce((s, x) => s + x.montoCents, 0)

  const ingresosCents = ingresos.monto as number
  const costoVentaCents = suma(detalle.costoVenta)
  const gastoFijoCents = suma(detalle.fijo)
  const gastoVariableCents = suma(detalle.variable)
  const sinClasificarCents = suma(detalle.sinClasificar)
  const margenBrutoCents = ingresosCents - costoVentaCents

  const porCentro = db
    .prepare(
      `SELECT cc.id, cc.name,
        COALESCE(SUM(CASE WHEN ${TIPO_OPERATIVO} = 'ingreso' THEN ${MONTO_OPERATIVO} END), 0) AS ingresos,
        COALESCE(SUM(CASE WHEN ${TIPO_OPERATIVO} = 'gasto' THEN ${MONTO_OPERATIVO} END), 0) AS gastos
       ${DESDE_MOVIMIENTOS}
       LEFT JOIN cost_centers cc ON cc.id = t.cost_center_id
       WHERE t.profile_id = ? AND t.type IN ('ingreso', 'gasto') AND t.date BETWEEN ? AND ?
       GROUP BY cc.id
       ORDER BY ingresos DESC, gastos DESC`,
    )
    .all(profileId, desde, hasta) as any[]

  const clientes = porCliente(profileId, desde, hasta)
  const sinContraparte = clientes.find((c) => c.id === null)

  return {
    desde,
    hasta,
    ingresosCents,
    costoVentaCents,
    margenBrutoCents,
    // Sin ventas no hay margen que expresar en porcentaje: dividir entre cero
    // no da cero, da "no se puede decir".
    margenBrutoPct: ingresosCents > 0 ? margenBrutoCents / ingresosCents : null,
    gastoFijoCents,
    gastoVariableCents,
    sinClasificarCents,
    utilidadCents:
      ingresosCents - costoVentaCents - gastoFijoCents - gastoVariableCents - sinClasificarCents,
    impuestoTrasladadoCents: impuestos.trasladado as number,
    impuestoAcreditableCents: impuestos.acreditable as number,
    deducibleCents: gastos.deducible as number,
    detalle,
    porCentro: porCentro.map((c) =>
      rentabilidad(c.id ?? null, c.name ?? 'Sin asignar', c.ingresos, c.gastos),
    ),
    // El renglón sin contraparte sale de la lista: no es un cliente, es lo que
    // nadie atribuyó. Va aparte, con su nombre, para que la vista pueda decir
    // cuánto del periodo no cabe en esta tabla.
    porCliente: clientes
      .filter((c) => c.id !== null)
      .map((c) => rentabilidad(c.id, c.name ?? '', c.ingresos, c.gastos))
      .sort((a, b) => b.margenCents - a.margenCents || a.name.localeCompare(b.name)),
    gastoSinContraparteCents: sinContraparte?.gastos ?? 0,
    previo: periodoPrevio(profileId, desde, hasta),
    puntoEquilibrioCents: puntoDeEquilibrio(
      ingresosCents,
      costoVentaCents,
      gastoVariableCents,
      gastoFijoCents,
    ),
    margenContribucion: margenContribucion(ingresosCents, costoVentaCents, gastoVariableCents),
  }
}

// El **flujo de caja proyectado** vivía aquí y desde la Fase 16 vive en
// `server/flujo.ts`: dejó de ser una función del perfil de negocio para
// volverse la pregunta de cualquiera —"¿llego a fin de mes?"—, con su propia
// vista y su cifra en el Resumen.
