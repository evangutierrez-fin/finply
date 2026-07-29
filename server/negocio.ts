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
  DESDE_MOVIMIENTOS,
  MONTO_OPERATIVO,
  TIPO_OPERATIVO,
} from './reportes.ts'
import { liquidoDe } from './analisis.ts'
import { calendario } from './calendario.ts'
import { hoyISO, sumarDias } from '../shared/fechas.ts'
import { margenContribucion, puntoDeEquilibrio } from '../shared/negocio.ts'
import type { EstadoResultados, FlujoProyectado, RenglonResultados } from '../shared/types.ts'

/** Gasto del periodo por categoría, con el papel que el usuario le asignó. */
function gastoPorRol(profileId: number, desde: string, hasta: string) {
  return db
    .prepare(
      `SELECT c.id AS category_id, c.name, c.role,
        COALESCE(SUM(${MONTO_OPERATIVO}), 0) AS monto
       ${DESDE_MOVIMIENTOS}
       LEFT JOIN categories c ON c.id = ${CATEGORIA_OPERATIVA}
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
  const impuestos: any = db
    .prepare(
      `SELECT
        COALESCE(SUM(CASE WHEN t.type = 'ingreso' THEN t.tax_cents END), 0) AS trasladado,
        COALESCE(SUM(CASE WHEN t.type = 'gasto' THEN t.tax_cents END), 0) AS acreditable
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
    porCentro: porCentro.map((c) => ({
      id: c.id ?? null,
      name: c.name ?? 'Sin asignar',
      ingresosCents: c.ingresos,
      gastoCents: c.gastos,
    })),
    puntoEquilibrioCents: puntoDeEquilibrio(
      ingresosCents,
      costoVentaCents,
      gastoVariableCents,
      gastoFijoCents,
    ),
    margenContribucion: margenContribucion(ingresosCents, costoVentaCents, gastoVariableCents),
  }
}

/**
 * Flujo de caja proyectado: el saldo líquido de hoy, movido día a día por todo
 * lo que ya se sabe que vence.
 *
 * No inventa una sola fecha: los eventos son los del **calendario**, que ya
 * junta recurrencias, tarjetas, deudas, parcialidades y ahora facturas. Cada
 * evento trae su dirección puesta por quien lo generó, así que aquí no se
 * vuelve a deducir si algo entra o sale — deducirlo otra vez sería la segunda
 * versión de lo que vence, y las dos versiones acaban discrepando.
 *
 * Los cortes de tarjeta se saltan: un corte no mueve dinero, solo cierra el
 * periodo, y su fecha límite de pago ya viene como evento aparte. Lo que no
 * tiene monto todavía tampoco entra: se dice cuántos son, no se supone cuánto.
 */
export function flujoProyectado(
  profileId: number,
  hoy = hoyISO(),
  dias = 30,
): FlujoProyectado {
  const { eventos } = calendario(profileId, hoy, dias)
  const utiles = eventos.filter((e) => e.tipo !== 'corte' && e.montoCents !== null)

  const saldoInicialCents = liquidoDe(profileId)
  const porDia = new Map<string, { entradas: number; salidas: number }>()
  for (const e of utiles) {
    const dia = porDia.get(e.fecha) ?? { entradas: 0, salidas: 0 }
    if (e.direccion === 'entra') dia.entradas += e.montoCents!
    else dia.salidas += e.montoCents!
    porDia.set(e.fecha, dia)
  }

  let saldo = saldoInicialCents
  let entradasCents = 0
  let salidasCents = 0
  let primerDiaEnRojo: string | null = saldo < 0 ? hoy : null
  const puntos = [{ fecha: hoy, saldoCents: saldo, entradasCents: 0, salidasCents: 0 }]

  for (const fecha of [...porDia.keys()].sort()) {
    const dia = porDia.get(fecha)!
    saldo += dia.entradas - dia.salidas
    entradasCents += dia.entradas
    salidasCents += dia.salidas
    if (primerDiaEnRojo === null && saldo < 0) primerDiaEnRojo = fecha
    puntos.push({
      fecha,
      saldoCents: saldo,
      entradasCents: dia.entradas,
      salidasCents: dia.salidas,
    })
  }

  return {
    desde: hoy,
    hasta: sumarDias(hoy, dias),
    saldoInicialCents,
    saldoFinalCents: saldo,
    entradasCents,
    salidasCents,
    primerDiaEnRojo,
    puntos,
    eventos: utiles,
  }
}
