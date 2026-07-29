// Facturas y antigüedad de saldos.
//
// **Una factura no asienta nada.** El libro sigue siendo de flujo de efectivo:
// la factura es el documento y el compromiso —de ahí salen el aging y el flujo
// proyectado—, y el ingreso nace cuando el usuario registra el cobro, con su
// movimiento ligado por `invoice_id`. Si emitir contara como ingreso y cobrar
// también, el mismo peso entraría dos veces al mes.
//
// Tampoco es una deuda con otro nombre, aunque las dos digan "me deben": una
// deuda tiene tasa, plazo y tabla de amortización, y una factura tiene folio,
// impuesto y fecha de pago. Meterlas en la misma tabla obligaría a que cada
// consulta preguntara cuál de las dos está mirando.
//
// El saldo **se deriva** (D7 otra vez): total menos lo cobrado, calculado en
// SQL contra los movimientos ligados. No hay columna `pagado` que pueda quedar
// vieja cuando alguien anule un cobro.

import { db } from './db.ts'
import { hoyISO } from '../shared/fechas.ts'
import { TRAMOS, TRAMO_LABEL, tramoDe, type Tramo } from '../shared/negocio.ts'
import type { Aging, Factura, TramoAging } from '../shared/types.ts'

/** El saldo sale del mismo SQL en todos lados: una sola definición de "falta". */
const FACTURA_SELECT = `
  SELECT f.*, c.name AS counterparty_name, cc.name AS cost_center_name,
    COALESCE((SELECT SUM(t.amount_cents) FROM transactions t WHERE t.invoice_id = f.id), 0)
      AS pagado_cents
  FROM invoices f
  JOIN counterparties c ON c.id = f.counterparty_id
  LEFT JOIN cost_centers cc ON cc.id = f.cost_center_id
`

export function mapFactura(row: any): Factura {
  const totalCents = row.subtotal_cents + row.tax_cents
  const pagadoCents = row.pagado_cents ?? 0
  const saldoCents = Math.max(0, totalCents - pagadoCents)
  return {
    id: row.id,
    profileId: row.profile_id,
    counterpartyId: row.counterparty_id,
    counterpartyName: row.counterparty_name ?? '',
    direction: row.direction,
    folio: row.folio,
    concept: row.concept,
    issueDate: row.issue_date,
    dueDate: row.due_date ?? null,
    subtotalCents: row.subtotal_cents,
    taxCents: row.tax_cents,
    totalCents,
    pagadoCents,
    saldoCents,
    status: row.status,
    // Derivado, no guardado: anular el cobro la vuelve a abrir sola.
    cobrada: row.status === 'abierta' && saldoCents === 0,
    costCenterId: row.cost_center_id ?? null,
    costCenterName: row.cost_center_name ?? null,
    createdAt: row.created_at,
  }
}

export interface FiltroFacturas {
  profileId: number
  direction?: 'emitida' | 'recibida'
  /** Solo las que aún deben algo. */
  pendientes?: boolean
  counterpartyId?: number
}

export function listarFacturas(filtro: FiltroFacturas): Factura[] {
  const condiciones = ['f.profile_id = ?']
  const args: (string | number)[] = [filtro.profileId]
  if (filtro.direction) {
    condiciones.push('f.direction = ?')
    args.push(filtro.direction)
  }
  if (filtro.counterpartyId) {
    condiciones.push('f.counterparty_id = ?')
    args.push(filtro.counterpartyId)
  }
  const filas: any[] = db
    .prepare(
      `${FACTURA_SELECT} WHERE ${condiciones.join(' AND ')}
       ORDER BY f.issue_date DESC, f.id DESC`,
    )
    .all(...args)
  const lista = filas.map(mapFactura)
  return filtro.pendientes
    ? lista.filter((f) => f.status === 'abierta' && f.saldoCents > 0)
    : lista
}

export function facturaPorId(id: number): Factura | null {
  const row: any = db.prepare(`${FACTURA_SELECT} WHERE f.id = ?`).get(id)
  return row ? mapFactura(row) : null
}

function tramosVacios(): Record<Tramo, TramoAging> {
  return Object.fromEntries(
    TRAMOS.map((t) => [t, { tramo: t, label: TRAMO_LABEL[t], montoCents: 0, facturas: 0 }]),
  ) as Record<Tramo, TramoAging>
}

/**
 * Antigüedad de saldos: cuánto te deben y cuánto debes, repartido por lo
 * vencido que está. Es la pregunta que un negocio se hace antes de cualquier
 * otra, porque un saldo de hace noventa días no vale lo mismo que uno de ayer.
 *
 * Se traen solo las facturas **abiertas con saldo** —una consulta agregada, no
 * el libro entero— y el reparto en tramos es aritmética de fechas sobre esa
 * lista corta, no una consulta por tramo (R11).
 */
export function aging(profileId: number, hoy = hoyISO()): Aging {
  const pendientes = listarFacturas({ profileId, pendientes: true })

  const porCobrar = tramosVacios()
  const porPagar = tramosVacios()
  const vencidoPor = new Map<number, { id: number; name: string; montoCents: number; direction: 'emitida' | 'recibida' }>()

  for (const f of pendientes) {
    const tramo = tramoDe(hoy, f.dueDate)
    const destino = f.direction === 'emitida' ? porCobrar : porPagar
    destino[tramo].montoCents += f.saldoCents
    destino[tramo].facturas += 1
    if (tramo !== 'corriente') {
      const clave = f.counterpartyId
      const actual = vencidoPor.get(clave)
      if (actual) actual.montoCents += f.saldoCents
      else {
        vencidoPor.set(clave, {
          id: f.counterpartyId,
          name: f.counterpartyName,
          montoCents: f.saldoCents,
          direction: f.direction,
        })
      }
    }
  }

  const suma = (t: Record<Tramo, TramoAging>) =>
    TRAMOS.reduce((s, k) => s + t[k].montoCents, 0)

  return {
    hoy,
    porCobrar: TRAMOS.map((t) => porCobrar[t]),
    porPagar: TRAMOS.map((t) => porPagar[t]),
    porCobrarCents: suma(porCobrar),
    porPagarCents: suma(porPagar),
    vencidoPorContraparte: [...vencidoPor.values()].sort((a, b) => b.montoCents - a.montoCents),
  }
}
