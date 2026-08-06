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
// El saldo **se deriva** (D7 otra vez): lo cobrable menos lo cobrado, calculado
// en SQL contra los movimientos ligados. No hay columna `pagado` que pueda
// quedar vieja cuando alguien anule un cobro.
//
// Y desde la Fase 14, **lo cobrable no es el total**: el total es lo que dice
// el papel, y lo cobrable es eso menos lo que te retienen (D21) y menos lo que
// le cancelaste con notas de crédito. La diferencia no es cosmética — con
// retenciones, medir el saldo contra el total deja la factura eternamente
// abierta por un dinero que nunca va a llegar, y la antigüedad de saldos
// promete cobrarlo.

import { db } from './db.ts'
import { diasEntre, hoyISO } from '../shared/fechas.ts'
import { TRAMOS, TRAMO_LABEL, tramoDe, type Tramo } from '../shared/negocio.ts'
import type {
  Aging,
  Anticipo,
  Cobranza,
  Factura,
  NotaCredito,
  RenglonCobranza,
  TramoAging,
} from '../shared/types.ts'

/**
 * Lo cobrable de una factura, en SQL y en un solo lugar. Lo usan el select de
 * abajo, el calendario, los saldos de la contraparte y la cobranza: si cada
 * uno lo escribiera a su manera, un día dirían cosas distintas del mismo peso.
 *
 * `f` es el alias de `invoices`.
 */
export const COBRABLE = `(f.subtotal_cents + f.tax_cents
  - f.withheld_tax_cents - f.withheld_income_cents
  - COALESCE((SELECT SUM(n.amount_cents) FROM invoice_credit_notes n
      WHERE n.invoice_id = f.id), 0))`

/** Lo que falta de una factura: cobrable menos los movimientos ligados. */
export const SALDO_FACTURA = `MAX(0, ${COBRABLE}
  - COALESCE((SELECT SUM(t.amount_cents) FROM transactions t WHERE t.invoice_id = f.id), 0))`

/** El saldo sale del mismo SQL en todos lados: una sola definición de "falta". */
const FACTURA_SELECT = `
  SELECT f.*, c.name AS counterparty_name, cc.name AS cost_center_name,
    COALESCE((SELECT SUM(t.amount_cents) FROM transactions t WHERE t.invoice_id = f.id), 0)
      AS pagado_cents,
    COALESCE((SELECT SUM(n.amount_cents) FROM invoice_credit_notes n
      WHERE n.invoice_id = f.id), 0) AS notas_cents
  FROM invoices f
  JOIN counterparties c ON c.id = f.counterparty_id
  LEFT JOIN cost_centers cc ON cc.id = f.cost_center_id
`

export function mapFactura(row: any): Factura {
  const totalCents = row.subtotal_cents + row.tax_cents
  const retenidoCents = (row.withheld_tax_cents ?? 0) + (row.withheld_income_cents ?? 0)
  const notasCreditoCents = row.notas_cents ?? 0
  // Con piso en cero: una nota de crédito por más de lo que quedaba cancela la
  // factura, no la vuelve un adeudo al revés.
  const cobrableCents = Math.max(0, totalCents - retenidoCents - notasCreditoCents)
  const pagadoCents = row.pagado_cents ?? 0
  const saldoCents = Math.max(0, cobrableCents - pagadoCents)
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
    withheldTaxCents: row.withheld_tax_cents ?? 0,
    withheldIncomeCents: row.withheld_income_cents ?? 0,
    retenidoCents,
    totalCents,
    notasCreditoCents,
    cobrableCents,
    pagadoCents,
    saldoCents,
    status: row.status,
    // Derivado, no guardado: anular el cobro la vuelve a abrir sola.
    cobrada: row.status === 'abierta' && saldoCents === 0,
    costCenterId: row.cost_center_id ?? null,
    costCenterName: row.cost_center_name ?? null,
    notasCredito: [],
    createdAt: row.created_at,
  }
}

/** Las notas de crédito de varias facturas en una consulta (R11: nada de N+1). */
function adjuntarNotas(facturas: Factura[]): void {
  const conNotas = facturas.filter((f) => f.notasCreditoCents > 0)
  if (conNotas.length === 0) return
  const ids = conNotas.map((f) => f.id)
  const filas: any[] = db
    .prepare(
      `SELECT * FROM invoice_credit_notes
       WHERE invoice_id IN (${ids.map(() => '?').join(',')})
       ORDER BY date ASC, id ASC`,
    )
    .all(...ids)
  const porFactura = new Map<number, NotaCredito[]>()
  for (const f of filas) {
    const lista = porFactura.get(f.invoice_id) ?? []
    lista.push({
      id: f.id,
      invoiceId: f.invoice_id,
      date: f.date,
      folio: f.folio,
      concept: f.concept,
      amountCents: f.amount_cents,
    })
    porFactura.set(f.invoice_id, lista)
  }
  for (const factura of conNotas) factura.notasCredito = porFactura.get(factura.id) ?? []
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
  const resultado = filtro.pendientes
    ? lista.filter((f) => f.status === 'abierta' && f.saldoCents > 0)
    : lista
  adjuntarNotas(resultado)
  return resultado
}

export function facturaPorId(id: number): Factura | null {
  const row: any = db.prepare(`${FACTURA_SELECT} WHERE f.id = ?`).get(id)
  if (!row) return null
  const factura = mapFactura(row)
  adjuntarNotas([factura])
  return factura
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

// ── La lista de cobranza ──────────────────────────────────────────────────

/** Lo que vence dentro de esta ventana cuenta como "ya casi". */
const DIAS_POR_VENCER = 7

/**
 * Qué hay que cobrar hoy, de lo más vencido a lo más nuevo.
 *
 * La antigüedad de saldos contesta *cuánto* te deben y desde cuándo; esto
 * contesta *a quién le hablas primero*, que es la pregunta con la que se
 * levanta quien cobra. Sale de las mismas facturas pendientes —una consulta,
 * no una por renglón (R11)— y lleva el contacto de la contraparte para no
 * tener que ir a buscarlo a otra sección.
 *
 * Una factura **sin fecha de vencimiento** entra al final: no está vencida
 * (nadie pactó cuándo), pero sigue sin cobrarse y esconderla sería perderla.
 */
export function cobranza(profileId: number, hoy = hoyISO()): Cobranza {
  const filas: any[] = db
    .prepare(
      `SELECT f.id, f.folio, f.concept, f.issue_date, f.due_date,
        ${SALDO_FACTURA} AS saldo,
        c.id AS counterparty_id, c.name AS counterparty_name, c.contact
       FROM invoices f
       JOIN counterparties c ON c.id = f.counterparty_id
       WHERE f.profile_id = ? AND f.direction = 'emitida' AND f.status = 'abierta'`,
    )
    .all(profileId)

  const renglones: RenglonCobranza[] = filas
    .filter((f) => f.saldo > 0)
    .map((f) => {
      const tramo = tramoDe(hoy, f.due_date ?? null)
      return {
        facturaId: f.id as number,
        counterpartyId: f.counterparty_id as number,
        counterpartyName: f.counterparty_name as string,
        contact: (f.contact ?? '') as string,
        folio: f.folio as string,
        concept: f.concept as string,
        issueDate: f.issue_date as string,
        dueDate: (f.due_date ?? null) as string | null,
        saldoCents: f.saldo as number,
        diasVencida: f.due_date ? diasEntre(f.due_date, hoy) : 0,
        tramo,
        tramoLabel: TRAMO_LABEL[tramo],
      }
    })

  // Lo más vencido primero; entre iguales, lo más grande. Una factura sin
  // vencimiento tiene cero días de atraso y cae después de cualquier vencida.
  renglones.sort(
    (a, b) =>
      b.diasVencida - a.diasVencida ||
      b.saldoCents - a.saldoCents ||
      a.counterpartyName.localeCompare(b.counterpartyName),
  )

  const porVencerHasta = DIAS_POR_VENCER
  return {
    hoy,
    renglones,
    totalCents: renglones.reduce((s, r) => s + r.saldoCents, 0),
    vencidoCents: renglones.filter((r) => r.diasVencida > 0).reduce((s, r) => s + r.saldoCents, 0),
    porVencerCents: renglones
      .filter((r) => r.dueDate !== null && r.diasVencida <= 0 && -r.diasVencida <= porVencerHasta)
      .reduce((s, r) => s + r.saldoCents, 0),
  }
}

// ── Anticipos ─────────────────────────────────────────────────────────────

/**
 * El dinero que ya entró de esa contraparte y todavía no tiene factura.
 *
 * No hace falta una tabla ni una bandera: en un libro de flujo de efectivo un
 * anticipo **ya es un movimiento normal** —se cobró, es ingreso de ese día
 * (D14)— y lo único que lo distingue es que ninguna factura lo reclama. Por
 * eso aplicarlo después no crea nada: liga el movimiento que ya existe.
 *
 * Se excluye lo que nació de una deuda, una inversión o una meta: eso ya tiene
 * dueño y no es un anticipo de nadie.
 */
export function anticiposDe(
  profileId: number,
  counterpartyId: number,
  direction: 'emitida' | 'recibida',
): Anticipo[] {
  const tipo = direction === 'emitida' ? 'ingreso' : 'gasto'
  const filas: any[] = db
    .prepare(
      `SELECT t.id, t.date, t.amount_cents, t.note, a.name AS account_name
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       WHERE t.profile_id = ? AND t.counterparty_id = ? AND t.type = ?
         AND t.invoice_id IS NULL AND t.debt_id IS NULL
         AND t.investment_entry_id IS NULL AND t.goal_entry_id IS NULL
       ORDER BY t.date ASC, t.id ASC`,
    )
    .all(profileId, counterpartyId, tipo)
  return filas.map((f) => ({
    txId: f.id as number,
    date: f.date as string,
    amountCents: f.amount_cents as number,
    note: f.note as string,
    accountName: f.account_name as string,
  }))
}
