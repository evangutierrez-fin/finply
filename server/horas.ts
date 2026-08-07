// Horas facturables: lo trabajado, y sobre todo lo trabajado **sin cobrar**.
//
// El modelo:
//
//   · La **tarifa vive en cada renglón**, no en el cliente. Se sube a mitad de
//     un proyecto, y una tarifa guardada aparte reescribiría el precio de las
//     horas de hace tres meses. Es el mismo criterio con el que una
//     recurrencia asentada no cambia al editar su plantilla.
//   · Una hora está facturada si tiene `invoice_id`, y punto. Es derivado:
//     borrar la factura devuelve sus horas a "por cobrar" solas, sin que nadie
//     tenga que recalcular una bandera.
//   · Facturarlas **no asienta un peso**: crea la factura, y el ingreso nace
//     al cobrarla (D14). Y solo pasa si el usuario lo pide (R4).
//
// Los minutos son enteros; el importe se redondea **una sola vez**, al
// convertir minutos por tarifa. Cobrar por minuto y sumar dejaría un centavo
// de diferencia contra la factura en cada renglón.

import { db, httpError, inTransaction } from './db.ts'
import { facturaPorId } from './facturas.ts'
import { finDeMes, hoyISO, sumarDias } from '../shared/fechas.ts'
import { importeDeMinutos } from '../shared/giro.ts'
import type { Factura, Hora, HorasPorCobrar, ResumenHoras } from '../shared/types.ts'

const SELECT = `
  SELECT h.*, cp.name AS counterparty_name, cc.name AS cost_center_name,
    f.folio AS invoice_folio
  FROM time_entries h
  LEFT JOIN counterparties cp ON cp.id = h.counterparty_id
  LEFT JOIN cost_centers cc ON cc.id = h.cost_center_id
  LEFT JOIN invoices f ON f.id = h.invoice_id
`

/**
 * El importe de **un renglón**, en SQL: los mismos minutos por tarifa entre 60
 * que calcula `importeDeMinutos`, redondeados una vez por renglón.
 *
 * Que exista es el punto. Sumar `minutes * rate_cents` de todos los renglones y
 * dividir entre 60 al final **no** da lo mismo que sumar los renglones ya
 * redondeados, y las dos cifras estaban en pantallas distintas: el panel decía
 * $3.33 por cobrar de dos renglones de un minuto a $100 la hora, y la factura
 * que salía de esos mismos dos renglones era de $3.34. Un centavo, siempre del
 * lado de prometer menos de lo que se va a cobrar, y creciendo con el número de
 * renglones.
 *
 * Manda el renglón, no el agregado: es lo que respalda la factura y es lo que el
 * usuario ve en la lista. Se redondea aquí igual que allá —hacia arriba en el
 * medio, y todos los valores son positivos, así que `round` de SQLite y
 * `Math.round` coinciden—, con `h` como alias de `time_entries`.
 */
const IMPORTE_RENGLON = `CAST(ROUND(h.minutes * h.rate_cents / 60.0) AS INTEGER)`

function mapHora(row: any): Hora {
  return {
    id: row.id,
    profileId: row.profile_id,
    date: row.date,
    minutes: row.minutes,
    rateCents: row.rate_cents,
    importeCents: importeDeMinutos(row.minutes, row.rate_cents),
    counterpartyId: row.counterparty_id ?? null,
    counterpartyName: row.counterparty_name ?? null,
    costCenterId: row.cost_center_id ?? null,
    costCenterName: row.cost_center_name ?? null,
    note: row.note,
    invoiceId: row.invoice_id ?? null,
    invoiceFolio: row.invoice_folio ?? null,
  }
}

export interface FiltroHoras {
  profileId: number
  desde?: string
  hasta?: string
  counterpartyId?: number
  /** Solo las que todavía no tienen factura. */
  sinFacturar?: boolean
}

export function listar(filtro: FiltroHoras): Hora[] {
  const condiciones = ['h.profile_id = ?']
  const args: (string | number)[] = [filtro.profileId]
  if (filtro.desde) {
    condiciones.push('h.date >= ?')
    args.push(filtro.desde)
  }
  if (filtro.hasta) {
    condiciones.push('h.date <= ?')
    args.push(filtro.hasta)
  }
  if (filtro.counterpartyId) {
    condiciones.push('h.counterparty_id = ?')
    args.push(filtro.counterpartyId)
  }
  if (filtro.sinFacturar) condiciones.push('h.invoice_id IS NULL')
  const filas: any[] = db
    .prepare(
      `${SELECT} WHERE ${condiciones.join(' AND ')} ORDER BY h.date DESC, h.id DESC LIMIT 500`,
    )
    .all(...args)
  return filas.map(mapHora)
}

/**
 * El panel: cuánto trabajaste en la ventana y **cuánto de eso no has cobrado**,
 * agrupado por cliente.
 *
 * Dos consultas agregadas y ninguna por cliente (R11). Ojo con lo que mide
 * cada una: los totales del periodo miran la ventana, y lo por cobrar mira
 * **todo el historial** — una hora de hace seis meses sin facturar sigue sin
 * cobrarse, y esconderla porque no cae en la ventana sería perderla.
 *
 * Todos los importes se suman **renglón por renglón ya redondeado**
 * (`IMPORTE_RENGLON`), que es la misma aritmética de `mapHora` y de `facturar`.
 * Es lo único que hace que la cifra grande, la lista de abajo y la factura que
 * sale de esas horas no puedan separarse por centavos.
 */
export function resumen(profileId: number, desde: string, hasta: string): ResumenHoras {
  const totales: any = db
    .prepare(
      `SELECT
        COALESCE(SUM(h.minutes), 0) AS minutos,
        COALESCE(SUM(${IMPORTE_RENGLON}), 0) AS importe,
        COALESCE(SUM(CASE WHEN h.invoice_id IS NULL THEN h.minutes END), 0) AS minutos_libres,
        COALESCE(SUM(CASE WHEN h.invoice_id IS NULL THEN ${IMPORTE_RENGLON} END), 0) AS libre
       FROM time_entries h
       WHERE h.profile_id = ? AND h.date BETWEEN ? AND ?`,
    )
    .get(profileId, desde, hasta)

  const porCobrar = db
    .prepare(
      `SELECT h.counterparty_id AS id, cp.name AS name,
        COUNT(*) AS entradas,
        COALESCE(SUM(h.minutes), 0) AS minutos,
        COALESCE(SUM(${IMPORTE_RENGLON}), 0) AS importe,
        MIN(h.date) AS desde, MAX(h.date) AS hasta
       FROM time_entries h
       LEFT JOIN counterparties cp ON cp.id = h.counterparty_id
       WHERE h.profile_id = ? AND h.invoice_id IS NULL
       GROUP BY h.counterparty_id
       ORDER BY importe DESC`,
    )
    .all(profileId) as any[]

  const minutosTotal = totales.minutos as number
  const importeTotalCents = totales.importe as number
  const filas = porCobrar.map(
    (c): HorasPorCobrar => ({
      counterpartyId: c.id ?? null,
      // Sin cliente no se puede facturar, y hay que decirlo con su nombre.
      counterpartyName: c.name ?? 'Sin cliente',
      minutos: c.minutos,
      importeCents: c.importe,
      entradas: c.entradas,
      desde: c.desde,
      hasta: c.hasta,
    }),
  )
  return {
    desde,
    hasta,
    minutosTotal,
    importeTotalCents,
    minutosSinFacturarDelPeriodo: totales.minutos_libres as number,
    importeSinFacturarDelPeriodoCents: totales.libre as number,
    // Sin horas no hay tarifa media que decir: dividir entre cero no da cero.
    tarifaMediaCents:
      minutosTotal > 0 ? Math.round((importeTotalCents * 60) / minutosTotal) : null,
    porCobrar: filas,
    // El total sale de **sumar los renglones**, no de un agregado paralelo: es
    // la única forma de que la cifra grande y la tabla que está debajo no
    // puedan separarse por el redondeo de cada cliente.
    porCobrarMinutos: filas.reduce((s, c) => s + c.minutos, 0),
    porCobrarCents: filas.reduce((s, c) => s + c.importeCents, 0),
  }
}

export interface EntradaHora {
  profileId: number
  date: string
  minutes: number
  rateCents: number
  counterpartyId?: number | null
  costCenterId?: number | null
  note: string
}

function validar(input: EntradaHora): void {
  if (input.counterpartyId) {
    const cp = db
      .prepare('SELECT id FROM counterparties WHERE id = ? AND profile_id = ?')
      .get(input.counterpartyId, input.profileId)
    if (!cp) throw httpError(400, 'Ese cliente no es de este perfil')
  }
  if (input.costCenterId) {
    const cc = db
      .prepare('SELECT id FROM cost_centers WHERE id = ? AND profile_id = ?')
      .get(input.costCenterId, input.profileId)
    if (!cc) throw httpError(400, 'Ese centro no es de este perfil')
  }
}

export function crear(input: EntradaHora): Hora {
  validar(input)
  const result = db
    .prepare(
      `INSERT INTO time_entries
        (profile_id, date, minutes, rate_cents, counterparty_id, cost_center_id, note)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.profileId,
      input.date,
      input.minutes,
      input.rateCents,
      input.counterpartyId ?? null,
      input.costCenterId ?? null,
      input.note,
    )
  return mapHora(db.prepare(`${SELECT} WHERE h.id = ?`).get(Number(result.lastInsertRowid)))
}

/** Editar una hora ya facturada cambiaría el respaldo de una factura emitida. */
function fila(profileId: number, id: number): any {
  const row: any = db
    .prepare('SELECT * FROM time_entries WHERE id = ? AND profile_id = ?')
    .get(id, profileId)
  if (!row) throw httpError(404, 'Ese renglón de horas no existe')
  return row
}

export function actualizar(profileId: number, id: number, input: EntradaHora): Hora {
  const row = fila(profileId, id)
  if (row.invoice_id !== null) {
    throw httpError(409, 'Esas horas ya se facturaron. Borra la factura si quieres corregirlas.')
  }
  validar(input)
  db.prepare(
    `UPDATE time_entries SET date = ?, minutes = ?, rate_cents = ?, counterparty_id = ?,
       cost_center_id = ?, note = ? WHERE id = ?`,
  ).run(
    input.date,
    input.minutes,
    input.rateCents,
    input.counterpartyId ?? null,
    input.costCenterId ?? null,
    input.note,
    id,
  )
  return mapHora(db.prepare(`${SELECT} WHERE h.id = ?`).get(id))
}

export function borrar(profileId: number, id: number): void {
  const row = fila(profileId, id)
  if (row.invoice_id !== null) {
    throw httpError(409, 'Esas horas ya se facturaron. Borra la factura si quieres quitarlas.')
  }
  db.prepare('DELETE FROM time_entries WHERE id = ?').run(id)
}

/**
 * Convierte en **una** factura todas las horas sin facturar de un cliente.
 *
 * No asienta un peso: emitir una factura nunca lo hace (D14). Lo que sí hace
 * es marcar esas horas como facturadas, y las dos cosas ocurren en la misma
 * transacción — si algo falla no queda ni la factura ni el marcado, y las
 * horas siguen esperando.
 *
 * El impuesto lo escribe el usuario en monto, como en cualquier factura (R15):
 * Finply no conoce el porcentaje de su país.
 */
export function facturar(
  profileId: number,
  counterpartyId: number,
  opciones: { issueDate: string; dueDate?: string | null; folio: string; concept: string; taxCents: number },
): Factura {
  const cp: any = db
    .prepare('SELECT id, name, credit_days FROM counterparties WHERE id = ? AND profile_id = ?')
    .get(counterpartyId, profileId)
  if (!cp) throw httpError(400, 'Ese cliente no es de este perfil')

  const pendientes: any[] = db
    .prepare(
      `SELECT id, minutes, rate_cents FROM time_entries
       WHERE profile_id = ? AND counterparty_id = ? AND invoice_id IS NULL
       ORDER BY date ASC, id ASC`,
    )
    .all(profileId, counterpartyId)
  if (pendientes.length === 0) {
    throw httpError(400, `No hay horas sin facturar de ${cp.name}`)
  }

  // El subtotal se suma **renglón por renglón**, cada uno redondeado una vez,
  // para que la factura valga exactamente lo que suman las horas que la
  // respaldan. Sumar minutos y multiplicar al final daría otro centavo.
  const subtotal = pendientes.reduce((s, h) => s + importeDeMinutos(h.minutes, h.rate_cents), 0)
  if (subtotal <= 0) {
    throw httpError(400, 'Esas horas no tienen tarifa: ponles uno antes de facturarlas')
  }

  const dueDate =
    opciones.dueDate !== undefined
      ? opciones.dueDate
      : cp.credit_days === null
        ? null
        : sumarDias(opciones.issueDate, cp.credit_days)

  const facturaId = inTransaction(() => {
    const result = db
      .prepare(
        `INSERT INTO invoices
          (profile_id, counterparty_id, direction, folio, concept, issue_date, due_date,
           subtotal_cents, tax_cents)
         VALUES (?, ?, 'emitida', ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        profileId,
        counterpartyId,
        opciones.folio,
        opciones.concept,
        opciones.issueDate,
        dueDate,
        subtotal,
        opciones.taxCents,
      )
    const nueva = Number(result.lastInsertRowid)
    const marcar = db.prepare('UPDATE time_entries SET invoice_id = ? WHERE id = ?')
    for (const h of pendientes) marcar.run(nueva, h.id)
    return nueva
  })

  return facturaPorId(facturaId)!
}

/** El mes en curso, que es la ventana por omisión del panel. */
export function mesDe(hoy = hoyISO()): { desde: string; hasta: string } {
  return { desde: `${hoy.slice(0, 7)}-01`, hasta: finDeMes(hoy) }
}
