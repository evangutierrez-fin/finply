// Cotizaciones y órdenes de compra: el documento que va antes de la factura.
//
// El ciclo de Finply empezaba a media calle. Sabía de la factura —que ya es un
// cobro— pero no de lo que la precede: la cotización que mandas y esperas, y la
// orden que le pones a un proveedor. Sin eso no se puede contestar "¿cuánto
// tengo en la calle esperando respuesta?", que es con lo que un negocio decide
// si puede comprometerse a algo más.
//
// **Una cotización no asienta nada, y tampoco es una factura.** Es la misma
// línea de D14 llevada un paso atrás: si emitir una factura no mueve el libro,
// prometer un precio menos todavía. Lo que hace es **convertirse**: aceptarla
// crea la factura, y de ahí en adelante manda la factura.
//
// El estado 'vencida' **no existe en la base**. Se deriva de `valid_until`
// contra hoy, porque un estado guardado necesitaría que algo lo cambiara de
// noche y, sin eso, se queda viejo sin que nadie se entere. Es D10 otra vez.

import { db, httpError } from './db.ts'
import { hoyISO } from '../shared/fechas.ts'
import type { Cotizacion, ResumenCotizaciones } from '../shared/types.ts'

const COTIZACION_SELECT = `
  SELECT q.*, c.name AS counterparty_name, cc.name AS cost_center_name,
    f.folio AS invoice_folio
  FROM quotes q
  JOIN counterparties c ON c.id = q.counterparty_id
  LEFT JOIN cost_centers cc ON cc.id = q.cost_center_id
  LEFT JOIN invoices f ON f.id = q.invoice_id
`

/**
 * Vencida es **enviada y con la vigencia atrás**. Una aceptada o una perdida ya
 * tienen respuesta: que su fecha haya pasado no cambia nada, y pintarlas de
 * rojo sería ruido sobre algo que ya está cerrado.
 */
export function estaVencida(row: { status: string; valid_until: string | null }, hoy: string) {
  return row.status === 'enviada' && row.valid_until !== null && row.valid_until < hoy
}

export function mapCotizacion(row: any, hoy = hoyISO()): Cotizacion {
  return {
    id: row.id,
    profileId: row.profile_id,
    counterpartyId: row.counterparty_id,
    counterpartyName: row.counterparty_name,
    direction: row.direction,
    folio: row.folio,
    concept: row.concept,
    issueDate: row.issue_date,
    validUntil: row.valid_until ?? null,
    subtotalCents: row.subtotal_cents,
    taxCents: row.tax_cents,
    totalCents: row.subtotal_cents + row.tax_cents,
    costCenterId: row.cost_center_id ?? null,
    costCenterName: row.cost_center_name ?? null,
    status: row.status,
    vencida: estaVencida(row, hoy),
    invoiceId: row.invoice_id ?? null,
    invoiceFolio: row.invoice_folio ?? null,
    createdAt: row.created_at,
  }
}

export interface FiltroCotizaciones {
  profileId: number
  direction?: 'emitida' | 'recibida'
  status?: 'enviada' | 'aceptada' | 'perdida'
  hoy?: string
}

export function listarCotizaciones(filtro: FiltroCotizaciones): Cotizacion[] {
  const hoy = filtro.hoy ?? hoyISO()
  const donde = ['q.profile_id = ?']
  const params: (string | number)[] = [filtro.profileId]
  if (filtro.direction) {
    donde.push('q.direction = ?')
    params.push(filtro.direction)
  }
  if (filtro.status) {
    donde.push('q.status = ?')
    params.push(filtro.status)
  }
  const rows = db
    .prepare(
      `${COTIZACION_SELECT} WHERE ${donde.join(' AND ')}
       ORDER BY q.issue_date DESC, q.id DESC`,
    )
    .all(...params) as any[]
  return rows.map((r) => mapCotizacion(r, hoy))
}

export function cotizacionPorId(id: number, hoy = hoyISO()): Cotizacion | null {
  const row: any = db.prepare(`${COTIZACION_SELECT} WHERE q.id = ?`).get(id)
  return row ? mapCotizacion(row, hoy) : null
}

/**
 * Lo que hay en la calle, en **una** consulta (R11).
 *
 * Las tres cifras que importan son cuánto está esperando respuesta, cuánto de
 * eso ya se pasó de vigencia y qué proporción de lo contestado se ganó. La
 * última es la única que mide algo sobre ti y no sobre el mes: se calcula sobre
 * lo **contestado** —aceptado más perdido— porque meter lo que sigue esperando
 * en el denominador haría bajar tu tasa de éxito cada vez que mandas una
 * cotización nueva, que es exactamente al revés de lo que pasó.
 */
export function resumenCotizaciones(
  profileId: number,
  direction: 'emitida' | 'recibida',
  hoy = hoyISO(),
): ResumenCotizaciones {
  const total = `(q.subtotal_cents + q.tax_cents)`
  const fila: any = db
    .prepare(
      `SELECT
        COALESCE(SUM(CASE WHEN q.status = 'enviada' THEN ${total} END), 0) AS esperando,
        COUNT(CASE WHEN q.status = 'enviada' THEN 1 END) AS n_esperando,
        COALESCE(SUM(CASE WHEN q.status = 'enviada'
          AND q.valid_until IS NOT NULL AND q.valid_until < ? THEN ${total} END), 0) AS vencido,
        COUNT(CASE WHEN q.status = 'enviada'
          AND q.valid_until IS NOT NULL AND q.valid_until < ? THEN 1 END) AS n_vencido,
        COALESCE(SUM(CASE WHEN q.status = 'aceptada' THEN ${total} END), 0) AS aceptado,
        COUNT(CASE WHEN q.status = 'aceptada' THEN 1 END) AS n_aceptado,
        COALESCE(SUM(CASE WHEN q.status = 'perdida' THEN ${total} END), 0) AS perdido,
        COUNT(CASE WHEN q.status = 'perdida' THEN 1 END) AS n_perdido
       FROM quotes q
       WHERE q.profile_id = ? AND q.direction = ?`,
    )
    .get(hoy, hoy, profileId, direction)

  const contestadas = fila.n_aceptado + fila.n_perdido
  return {
    direction,
    esperandoCents: fila.esperando,
    esperando: fila.n_esperando,
    vencidoCents: fila.vencido,
    vencidas: fila.n_vencido,
    aceptadoCents: fila.aceptado,
    aceptadas: fila.n_aceptado,
    perdidoCents: fila.perdido,
    perdidas: fila.n_perdido,
    // `null` y no cero cuando nadie ha contestado todavía: un 0 % ahí diría que
    // pierdes todo, y lo cierto es que no se sabe (R9).
    tasaExitoBp: contestadas === 0 ? null : Math.round((fila.n_aceptado / contestadas) * 10_000),
  }
}

/** Lee la cotización asegurando que sea del perfil. */
export function exigirCotizacion(profileId: number, id: number) {
  const row: any = db.prepare('SELECT * FROM quotes WHERE id = ? AND profile_id = ?').get(id, profileId)
  if (!row) throw httpError(404, 'Esa cotización no existe en este perfil')
  return row
}
