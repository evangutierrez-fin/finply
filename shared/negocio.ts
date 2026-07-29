// Aritmética del perfil de negocio: antigüedad de saldos y punto de
// equilibrio.
//
// Módulo PURO a propósito (R16).
//
// Nada aquí es de un giro ni de un país (R15): los tramos de antigüedad son
// los que usa cualquiera —corriente, 1-30, 31-60, 61-90 y más de 90— y el
// punto de equilibrio sale del margen de contribución del propio usuario, no
// de una tabla de referencia de nadie.

import { diasEntre } from './fechas.ts'

export type Tramo = 'corriente' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90_mas'

export const TRAMOS: Tramo[] = ['corriente', 'd1_30', 'd31_60', 'd61_90', 'd90_mas']

export const TRAMO_LABEL: Record<Tramo, string> = {
  corriente: 'Al corriente',
  d1_30: '1 a 30 días',
  d31_60: '31 a 60 días',
  d61_90: '61 a 90 días',
  d90_mas: 'Más de 90 días',
}

/**
 * En qué tramo cae un saldo según su vencimiento.
 *
 * Una factura **sin fecha de vencimiento** es corriente: nadie puede estar
 * atrasado en una fecha que no se pactó. Y el día del vencimiento todavía no
 * es atraso —vence al final del día—, así que el tramo 1-30 empieza al
 * siguiente.
 */
export function tramoDe(hoy: string, dueDate: string | null): Tramo {
  if (!dueDate) return 'corriente'
  const dias = diasEntre(dueDate, hoy)
  if (dias <= 0) return 'corriente'
  if (dias <= 30) return 'd1_30'
  if (dias <= 60) return 'd31_60'
  if (dias <= 90) return 'd61_90'
  return 'd90_mas'
}

/**
 * Margen de contribución como decimal: qué parte de cada peso vendido queda
 * después de lo que costó producirlo y de lo que varía con la venta.
 *
 * `null` sin ingresos —dividir entre cero no da cero, da "no se puede
 * decir"— y también cuando el margen sale negativo o cero: ahí no existe un
 * punto de equilibrio, porque vender más no acerca a cubrir lo fijo. Es el
 * mismo trato que recibe la tasa de ahorro sin ingresos.
 */
export function margenContribucion(
  ingresosCents: number,
  costoVentaCents: number,
  gastoVariableCents: number,
): number | null {
  if (ingresosCents <= 0) return null
  return (ingresosCents - costoVentaCents - gastoVariableCents) / ingresosCents
}

/**
 * Cuánto hay que vender para no perder ni ganar: lo fijo entre el margen.
 *
 * Devuelve centavos, o `null` cuando la pregunta no tiene respuesta con estos
 * números (sin ingresos, o con margen que no cubre nada por más que se venda).
 */
export function puntoDeEquilibrio(
  ingresosCents: number,
  costoVentaCents: number,
  gastoVariableCents: number,
  gastoFijoCents: number,
): number | null {
  const margen = margenContribucion(ingresosCents, costoVentaCents, gastoVariableCents)
  if (margen === null || margen <= 0) return null
  return Math.round(gastoFijoCents / margen)
}
