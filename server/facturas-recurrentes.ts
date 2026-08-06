// Facturas que se repiten: la iguala del mes, la renta del local, la
// suscripción que le cobras a un cliente.
//
// **D28: tabla propia, motor compartido.** Se evaluó meterlas en
// `recurrences`, que es donde vive lo que se repite. No cabe: esa tabla exige
// `account_id` y un tipo ingreso/gasto/transferencia porque su trabajo es
// asentar dinero, y una factura recurrente no asienta nada — emite un
// documento, y el dinero nace después, al cobrarlo (D14). Compartir la tabla
// obligaría a la bandeja, al calendario, a las alertas y al flujo a preguntar
// en cada consulta cuál de las dos están mirando; es el mismo argumento con el
// que ya se separaron las facturas de las deudas (D15).
//
// Lo que sí se comparte es el **motor**, que es donde estaba el trabajo:
//
//   · la regla de fechas de `shared/recurrencias.ts`, entera y sin copiar;
//   · la bandeja derivada, que nunca se guarda (D7);
//   · la idempotencia por `(plantilla, periodo)` en un UNIQUE, que es lo que
//     hace imposible emitir dos veces la factura del mismo mes (R5);
//   · y R4: aquí no hay motor que corra solo. La bandeja propone; el usuario
//     emite.

import { db, httpError, inTransaction } from './db.ts'
import { facturaPorId } from './facturas.ts'
import { diasEntre, hoyISO, sumarDias } from '../shared/fechas.ts'
import {
  describirRecurrencia,
  fechaDeOcurrencia,
  ocurrencias,
  type ReglaRecurrencia,
} from '../shared/recurrencias.ts'
import type {
  BandejaFacturas,
  Factura,
  FacturaRecurrente,
  PropuestaFactura,
} from '../shared/types.ts'

/** Hasta dónde se mira hacia adelante para decir "lo próximo que viene". */
const HORIZONTE_DIAS = 400

const SELECT = `
  SELECT r.*, c.name AS counterparty_name, cc.name AS cost_center_name
  FROM invoice_recurrences r
  JOIN counterparties c ON c.id = r.counterparty_id
  LEFT JOIN cost_centers cc ON cc.id = r.cost_center_id
`

function reglaDe(row: any): ReglaRecurrencia {
  return {
    frequency: row.frequency,
    dayOfMonth: row.day_of_month ?? null,
    dayOfMonth2: row.day_of_month_2 ?? null,
    monthOfYear: row.month_of_year ?? null,
    weekday: row.weekday ?? null,
    startDate: row.start_date,
    endDate: row.end_date ?? null,
  }
}

function mapPlantilla(row: any): FacturaRecurrente {
  return {
    id: row.id,
    profileId: row.profile_id,
    counterpartyId: row.counterparty_id,
    counterpartyName: row.counterparty_name ?? '',
    direction: row.direction,
    concept: row.concept,
    subtotalCents: row.subtotal_cents,
    taxCents: row.tax_cents,
    withheldTaxCents: row.withheld_tax_cents,
    withheldIncomeCents: row.withheld_income_cents,
    totalCents: row.subtotal_cents + row.tax_cents,
    costCenterId: row.cost_center_id ?? null,
    costCenterName: row.cost_center_name ?? null,
    creditDays: row.credit_days ?? null,
    frequency: row.frequency,
    dayOfMonth: row.day_of_month ?? null,
    dayOfMonth2: row.day_of_month_2 ?? null,
    monthOfYear: row.month_of_year ?? null,
    weekday: row.weekday ?? null,
    startDate: row.start_date,
    endDate: row.end_date ?? null,
    archived: row.archived === 1,
    descripcion: describirRecurrencia(reglaDe(row)),
    pendientes: 0,
    proximaFecha: null,
  }
}

/** Los periodos ya resueltos de varias plantillas, en una sola consulta (R11). */
function resueltosDe(ids: number[]): Map<number, Set<string>> {
  const mapa = new Map<number, Set<string>>()
  if (ids.length === 0) return mapa
  const filas = db
    .prepare(
      `SELECT recurrence_id, period FROM invoice_recurrence_runs
       WHERE recurrence_id IN (${ids.map(() => '?').join(',')})`,
    )
    .all(...ids) as { recurrence_id: number; period: string }[]
  for (const f of filas) {
    const set = mapa.get(f.recurrence_id) ?? new Set<string>()
    set.add(f.period)
    mapa.set(f.recurrence_id, set)
  }
  return mapa
}

function filas(profileId: number): any[] {
  return db
    .prepare(`${SELECT} WHERE r.profile_id = ? ORDER BY r.archived ASC, r.id ASC`)
    .all(profileId)
}

export function listar(profileId: number, hoy = hoyISO()): FacturaRecurrente[] {
  const rows = filas(profileId)
  const plantillas = rows.map(mapPlantilla)
  const resueltos = resueltosDe(plantillas.map((p) => p.id))
  const horizonte = sumarDias(hoy, HORIZONTE_DIAS)

  plantillas.forEach((p, i) => {
    if (p.archived) return
    const regla = reglaDe(rows[i]!)
    const hechos = resueltos.get(p.id) ?? new Set<string>()
    p.pendientes = ocurrencias(regla, { hasta: hoy }).lista.filter(
      (o) => !hechos.has(o.periodo),
    ).length
    p.proximaFecha =
      ocurrencias(regla, { desde: hoy, hasta: horizonte }).lista.find(
        (o) => !hechos.has(o.periodo),
      )?.fecha ?? null
  })
  return plantillas
}

export function obtener(profileId: number, id: number): FacturaRecurrente | null {
  const row: any = db.prepare(`${SELECT} WHERE r.id = ? AND r.profile_id = ?`).get(id, profileId)
  return row ? mapPlantilla(row) : null
}

function fila(profileId: number, id: number): any {
  const row: any = db
    .prepare('SELECT * FROM invoice_recurrences WHERE id = ? AND profile_id = ?')
    .get(id, profileId)
  if (!row) throw httpError(404, 'Esa plantilla de factura no existe')
  return row
}

// ── La bandeja: derivada, nunca guardada ──────────────────────────────────

/**
 * Los periodos vencidos que todavía no se han emitido ni descartado, del más
 * viejo al más nuevo. Igual que la bandeja de movimientos: si no abres Finply
 * en tres meses, al volver ves los tres meses de facturas por emitir.
 */
export function bandeja(
  profileId: number,
  hoy = hoyISO(),
  pagina: { limit: number; offset: number } = { limit: 100, offset: 0 },
): BandejaFacturas {
  const rows = filas(profileId).filter((r) => r.archived === 0)
  const plantillas = rows.map(mapPlantilla)
  const resueltos = resueltosDe(plantillas.map((p) => p.id))

  const todas: PropuestaFactura[] = []
  let truncado = false
  rows.forEach((row, i) => {
    const p = plantillas[i]!
    const hechos = resueltos.get(p.id) ?? new Set<string>()
    const { lista, truncado: cortado } = ocurrencias(reglaDe(row), { hasta: hoy })
    if (cortado) truncado = true
    for (const o of lista) {
      if (hechos.has(o.periodo)) continue
      todas.push({
        recurrenceId: p.id,
        periodo: o.periodo,
        fecha: o.fecha,
        counterpartyId: p.counterpartyId,
        counterpartyName: p.counterpartyName,
        direction: p.direction,
        concept: p.concept,
        // Los montos salen de la plantilla **hoy**: una propuesta se deriva y
        // nunca se guardó, así que si subió la iguala la propuesta ya trae el
        // monto nuevo. Lo ya emitido no se toca.
        subtotalCents: p.subtotalCents,
        taxCents: p.taxCents,
        totalCents: p.totalCents,
        dueDate: p.creditDays === null ? null : sumarDias(o.fecha, p.creditDays),
        descripcion: p.descripcion,
        atraso: diasEntre(o.fecha, hoy),
      })
    }
  })

  todas.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.recurrenceId - b.recurrenceId)
  return {
    items: todas.slice(pagina.offset, pagina.offset + pagina.limit),
    total: todas.length,
    truncado,
  }
}

// ── Escrituras: siempre a petición del usuario ────────────────────────────

export interface EntradaFacturaRecurrente {
  profileId: number
  counterpartyId: number
  direction: 'emitida' | 'recibida'
  concept: string
  subtotalCents: number
  taxCents: number
  withheldTaxCents: number
  withheldIncomeCents: number
  costCenterId?: number | null
  creditDays?: number | null
  frequency: 'mensual' | 'quincenal' | 'semanal' | 'anual'
  dayOfMonth?: number | null
  dayOfMonth2?: number | null
  monthOfYear?: number | null
  weekday?: number | null
  startDate: string
  endDate?: string | null
  archived?: boolean
}

function validarReferencias(input: EntradaFacturaRecurrente): void {
  const contraparte = db
    .prepare('SELECT id FROM counterparties WHERE id = ? AND profile_id = ?')
    .get(input.counterpartyId, input.profileId)
  if (!contraparte) throw httpError(400, 'La contraparte no pertenece a este perfil')
  if (input.costCenterId) {
    const centro = db
      .prepare('SELECT id FROM cost_centers WHERE id = ? AND profile_id = ?')
      .get(input.costCenterId, input.profileId)
    if (!centro) throw httpError(400, 'Ese centro no pertenece a este perfil')
  }
  if (input.withheldTaxCents + input.withheldIncomeCents > input.subtotalCents + input.taxCents) {
    throw httpError(400, 'Lo retenido no puede ser más que la factura entera')
  }
}

/** Los campos del calendario que aplican a cada periodicidad; el resto, nulo. */
function camposDeFrecuencia(input: EntradaFacturaRecurrente) {
  return {
    dayOfMonth: input.frequency === 'semanal' ? null : (input.dayOfMonth ?? null),
    dayOfMonth2: input.frequency === 'quincenal' ? (input.dayOfMonth2 ?? 31) : null,
    monthOfYear: input.frequency === 'anual' ? (input.monthOfYear ?? null) : null,
    weekday: input.frequency === 'semanal' ? (input.weekday ?? null) : null,
  }
}

export function crear(input: EntradaFacturaRecurrente): FacturaRecurrente {
  validarReferencias(input)
  const c = camposDeFrecuencia(input)
  const result = db
    .prepare(
      `INSERT INTO invoice_recurrences
        (profile_id, counterparty_id, direction, concept, subtotal_cents, tax_cents,
         withheld_tax_cents, withheld_income_cents, cost_center_id, credit_days,
         frequency, day_of_month, day_of_month_2, month_of_year, weekday, start_date, end_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.profileId,
      input.counterpartyId,
      input.direction,
      input.concept,
      input.subtotalCents,
      input.taxCents,
      input.withheldTaxCents,
      input.withheldIncomeCents,
      input.costCenterId ?? null,
      input.creditDays ?? null,
      input.frequency,
      c.dayOfMonth,
      c.dayOfMonth2,
      c.monthOfYear,
      c.weekday,
      input.startDate,
      input.endDate ?? null,
    )
  return obtener(input.profileId, Number(result.lastInsertRowid))!
}

/**
 * Editar la plantilla **no toca las facturas ya emitidas**: ese documento ya
 * salió y puede estar cobrado. Lo pendiente sí toma los datos nuevos, porque
 * se deriva.
 */
export function actualizar(id: number, input: EntradaFacturaRecurrente): FacturaRecurrente {
  fila(input.profileId, id)
  validarReferencias(input)
  const c = camposDeFrecuencia(input)
  db.prepare(
    `UPDATE invoice_recurrences SET counterparty_id = ?, concept = ?, subtotal_cents = ?,
       tax_cents = ?, withheld_tax_cents = ?, withheld_income_cents = ?, cost_center_id = ?,
       credit_days = ?, frequency = ?, day_of_month = ?, day_of_month_2 = ?, month_of_year = ?,
       weekday = ?, start_date = ?, end_date = ?, archived = ?
     WHERE id = ?`,
  ).run(
    input.counterpartyId,
    input.concept,
    input.subtotalCents,
    input.taxCents,
    input.withheldTaxCents,
    input.withheldIncomeCents,
    input.costCenterId ?? null,
    input.creditDays ?? null,
    input.frequency,
    c.dayOfMonth,
    c.dayOfMonth2,
    c.monthOfYear,
    c.weekday,
    input.startDate,
    input.endDate ?? null,
    input.archived ? 1 : 0,
    id,
  )
  return obtener(input.profileId, id)!
}

/**
 * Borrar la plantilla se lleva su bitácora de periodos, pero **deja las
 * facturas ya emitidas**: son documentos que existen y algunos ya se cobraron.
 * Mismo criterio que las recurrencias de movimiento.
 */
export function borrar(profileId: number, id: number): { emitidas: number } {
  fila(profileId, id)
  const row: any = db
    .prepare(
      `SELECT COUNT(*) AS n FROM invoice_recurrence_runs
       WHERE recurrence_id = ? AND status = 'emitida'`,
    )
    .get(id)
  db.prepare('DELETE FROM invoice_recurrences WHERE id = ?').run(id)
  return { emitidas: row.n }
}

/** Traduce el choque del UNIQUE en un 409 legible en vez de un 500. */
function comoConflicto<T>(fn: () => T): T {
  try {
    return fn()
  } catch (err) {
    const mensaje = (err as Error).message ?? ''
    if (/UNIQUE constraint failed: invoice_recurrence_runs/.test(mensaje)) {
      throw httpError(409, 'Ese periodo ya se había resuelto')
    }
    throw err
  }
}

function periodoResuelto(recurrenceId: number, periodo: string): any {
  return db
    .prepare('SELECT * FROM invoice_recurrence_runs WHERE recurrence_id = ? AND period = ?')
    .get(recurrenceId, periodo)
}

function fechaDelPeriodo(row: any, periodo: string): string {
  const fecha = fechaDeOcurrencia(reglaDe(row), periodo)
  if (!fecha) throw httpError(400, 'Ese periodo no le corresponde a esta plantilla')
  return fecha
}

export interface AjustesFactura {
  issueDate?: string
  dueDate?: string | null
  folio?: string
  concept?: string
  subtotalCents?: number
  taxCents?: number
}

/**
 * Emite la factura de un periodo y marca el periodo, **en una sola
 * transacción**. Si algo falla, no queda ni la factura ni la marca.
 *
 * Ojo con lo que esto **no** hace: no asienta un peso. Emitir sigue sin mover
 * el libro (D14); el ingreso nace cuando el usuario cobre esta factura, igual
 * que si la hubiera capturado a mano.
 */
export function emitir(
  profileId: number,
  id: number,
  periodo: string,
  ajustes: AjustesFactura = {},
): Factura {
  const row = fila(profileId, id)
  const fecha = fechaDelPeriodo(row, periodo)
  if (periodoResuelto(id, periodo)) throw httpError(409, 'Ese periodo ya se había resuelto')

  const issueDate = ajustes.issueDate ?? fecha
  const creditDays = row.credit_days as number | null
  const dueDate =
    ajustes.dueDate !== undefined
      ? ajustes.dueDate
      : creditDays === null
        ? null
        : sumarDias(issueDate, creditDays)

  const facturaId = comoConflicto(() =>
    inTransaction(() => {
      const result = db
        .prepare(
          `INSERT INTO invoices
            (profile_id, counterparty_id, direction, folio, concept, issue_date, due_date,
             subtotal_cents, tax_cents, withheld_tax_cents, withheld_income_cents, cost_center_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          profileId,
          row.counterparty_id,
          row.direction,
          ajustes.folio ?? '',
          ajustes.concept ?? row.concept,
          issueDate,
          dueDate,
          ajustes.subtotalCents ?? row.subtotal_cents,
          ajustes.taxCents ?? row.tax_cents,
          row.withheld_tax_cents,
          row.withheld_income_cents,
          row.cost_center_id,
        )
      const nueva = Number(result.lastInsertRowid)
      db.prepare(
        `INSERT INTO invoice_recurrence_runs (recurrence_id, period, status, invoice_id)
         VALUES (?, ?, 'emitida', ?)`,
      ).run(id, periodo, nueva)
      return nueva
    }),
  )

  return facturaPorId(facturaId)!
}

/** Descartar solo escribe la marca: no se emite ningún documento. */
export function descartar(profileId: number, id: number, periodo: string): void {
  const row = fila(profileId, id)
  fechaDelPeriodo(row, periodo)
  if (periodoResuelto(id, periodo)) throw httpError(409, 'Ese periodo ya se había resuelto')
  comoConflicto(() =>
    db
      .prepare(
        `INSERT INTO invoice_recurrence_runs (recurrence_id, period, status)
         VALUES (?, ?, 'descartada')`,
      )
      .run(id, periodo),
  )
}

/**
 * Deshace un descarte y devuelve el periodo a la bandeja. Un periodo emitido
 * se deshace borrando su factura, que es donde de verdad está el documento.
 */
export function reabrir(profileId: number, id: number, periodo: string): void {
  fila(profileId, id)
  const run: any = periodoResuelto(id, periodo)
  if (!run) throw httpError(404, 'Ese periodo no estaba resuelto')
  if (run.status !== 'descartada') {
    throw httpError(409, 'De ese periodo ya salió una factura. Para deshacerlo, bórrala.')
  }
  db.prepare('DELETE FROM invoice_recurrence_runs WHERE id = ?').run(run.id)
}
