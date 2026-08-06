// Recurrencias: plantillas de lo que se repite y la bandeja de propuestas.
//
// El modelo, que es lo que hay que entender antes de tocar nada:
//
//   · La **plantilla** dice qué se repite y cada cuándo. No es un movimiento.
//   · Las **propuestas no se guardan** (D7). La bandeja se calcula al vuelo:
//     los periodos vencidos de cada plantilla, menos los que ya están
//     resueltos. Ninguna lectura de este archivo escribe una sola fila.
//   · En la base solo queda lo que el usuario resolvió: `recurrence_runs`, con
//     `(recurrence_id, period)` UNIQUE. Esa restricción —no el código de la
//     ruta— es la que hace imposible asentar dos veces el mismo periodo (R5).
//   · Nada se asienta sin que el usuario lo confirme (R4). Aquí no hay motor
//     que corra solo, ni tarea programada, ni modo automático: no existe.
//
// Si no abres Finply en tres meses, al volver ves los tres meses de propuestas.

import {
  attachTags,
  db,
  ensureAccount,
  ensureCategory,
  ensureTags,
  getTx,
  httpError,
  inTransaction,
  mapTx,
  setTxTags,
} from './db.ts'
import { diasEntre, hoyISO, sumarDias } from '../shared/fechas.ts'
import {
  describirRecurrencia,
  fechaDeOcurrencia,
  finEfectivo,
  ocurrencias,
  type ReglaRecurrencia,
} from '../shared/recurrencias.ts'
import type { Bandeja, Propuesta, Recurrencia, Tx } from '../shared/types.ts'

/** Hasta dónde se mira hacia adelante para decir "lo próximo que viene". */
const HORIZONTE_DIAS = 400

const REC_SELECT = `
  SELECT r.*, a.name AS account_name, c.name AS category_name, ta.name AS transfer_account_name,
    inv.name AS investment_name
  FROM recurrences r
  JOIN accounts a ON a.id = r.account_id
  LEFT JOIN categories c ON c.id = r.category_id
  LEFT JOIN accounts ta ON ta.id = r.transfer_account_id
  LEFT JOIN investments inv ON inv.id = r.investment_id
`

export function reglaDe(row: any): ReglaRecurrencia {
  return {
    frequency: row.frequency,
    dayOfMonth: row.day_of_month ?? null,
    dayOfMonth2: row.day_of_month_2 ?? null,
    monthOfYear: row.month_of_year ?? null,
    weekday: row.weekday ?? null,
    startDate: row.start_date,
    endDate: row.end_date ?? null,
    pausadaDesde: row.paused_from ?? null,
    pausadaHasta: row.paused_until ?? null,
    maxOcurrencias: row.max_occurrences ?? null,
  }
}

/**
 * Cuántas asentadas se promedian cuando la plantilla es de monto variable.
 *
 * Tres es lo suficientemente corto para seguir la temporada —el recibo de luz
 * de verano no se parece al de invierno— y lo suficientemente largo para que un
 * mes raro no mande. No es una cifra sagrada: es la que se dice en la vista,
 * para que el número propuesto se pueda reconstruir a mano.
 */
export const MUESTRAS_PROMEDIO = 3

/**
 * El promedio de las últimas asentadas de cada plantilla, en **una sola
 * consulta** para todas (R11). Sale del movimiento, no de la plantilla: lo que
 * se promedia es lo que de verdad se pagó, incluidos los ajustes que el usuario
 * hizo al confirmar.
 */
export function promediosDe(ids: number[]): Map<number, { cents: number; muestras: number }> {
  const mapa = new Map<number, { cents: number; muestras: number }>()
  if (ids.length === 0) return mapa
  const filas = db
    .prepare(
      `SELECT recurrence_id, CAST(ROUND(AVG(amount_cents)) AS INTEGER) AS cents,
              COUNT(*) AS muestras
       FROM (
         SELECT rr.recurrence_id, t.amount_cents,
           ROW_NUMBER() OVER (
             PARTITION BY rr.recurrence_id ORDER BY t.date DESC, t.id DESC
           ) AS n
         FROM recurrence_runs rr
         JOIN transactions t ON t.id = rr.tx_id
         WHERE rr.recurrence_id IN (${ids.map(() => '?').join(',')})
           AND rr.status = 'asentado'
       )
       WHERE n <= ${MUESTRAS_PROMEDIO}
       GROUP BY recurrence_id`,
    )
    .all(...ids) as { recurrence_id: number; cents: number; muestras: number }[]
  for (const f of filas) mapa.set(f.recurrence_id, { cents: f.cents, muestras: f.muestras })
  return mapa
}

/**
 * El monto que esta plantilla va a proponer hoy.
 *
 * Con monto fijo es el de siempre. Con monto variable es el promedio de lo
 * asentado — y mientras no haya nada asentado, **el monto de la plantilla**:
 * el promedio de nada no es cero, es "todavía no sé", y proponer cero sería
 * pedirle al usuario que corrija un dato inventado.
 */
export function montoPropuesto(
  row: any,
  promedio?: { cents: number; muestras: number },
): number {
  if (row.amount_mode !== 'promedio' || !promedio || promedio.muestras === 0) {
    return row.amount_cents
  }
  return promedio.cents
}

function mapRecurrencia(row: any): Recurrencia {
  return {
    id: row.id,
    profileId: row.profile_id,
    accountId: row.account_id,
    accountName: row.account_name ?? '',
    type: row.type,
    amountCents: row.amount_cents,
    categoryId: row.category_id ?? null,
    categoryName: row.category_name ?? null,
    transferAccountId: row.transfer_account_id ?? null,
    transferAccountName: row.transfer_account_name ?? null,
    note: row.note,
    frequency: row.frequency,
    dayOfMonth: row.day_of_month ?? null,
    dayOfMonth2: row.day_of_month_2 ?? null,
    monthOfYear: row.month_of_year ?? null,
    weekday: row.weekday ?? null,
    startDate: row.start_date,
    endDate: row.end_date ?? null,
    archived: row.archived === 1,
    investmentId: row.investment_id ?? null,
    investmentName: row.investment_name ?? null,
    amountMode: row.amount_mode ?? 'fijo',
    pausedFrom: row.paused_from ?? null,
    pausedUntil: row.paused_until ?? null,
    maxOccurrences: row.max_occurrences ?? null,
    // Se rellenan en `listar`, que es donde se sabe el historial y el calendario.
    montoPropuestoCents: row.amount_cents,
    muestrasPromedio: 0,
    ultimaFecha: null,
    tags: [],
    descripcion: describirRecurrencia(reglaDe(row)),
    proximaFecha: null,
    pendientes: 0,
  }
}

/** Etiquetas de varias plantillas en una sola consulta (R11: nada de N+1). */
function adjuntarEtiquetas(recs: { id: number; tags: { id: number; name: string }[] }[]): void {
  if (recs.length === 0) return
  const ids = recs.map((r) => r.id)
  const filas = db
    .prepare(
      `SELECT rt.recurrence_id, t.id, t.name FROM recurrence_tags rt
       JOIN tags t ON t.id = rt.tag_id
       WHERE rt.recurrence_id IN (${ids.map(() => '?').join(',')})
       ORDER BY t.name ASC`,
    )
    .all(...ids) as { recurrence_id: number; id: number; name: string }[]
  const porRec = new Map<number, { id: number; name: string }[]>()
  for (const f of filas) {
    const lista = porRec.get(f.recurrence_id) ?? []
    lista.push({ id: f.id, name: f.name })
    porRec.set(f.recurrence_id, lista)
  }
  for (const rec of recs) rec.tags = porRec.get(rec.id) ?? []
}

/** Los periodos ya resueltos de varias plantillas, en una sola consulta. */
function resueltosDe(ids: number[]): Map<number, Set<string>> {
  const mapa = new Map<number, Set<string>>()
  if (ids.length === 0) return mapa
  const filas = db
    .prepare(
      `SELECT recurrence_id, period FROM recurrence_runs
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
    .prepare(`${REC_SELECT} WHERE r.profile_id = ? ORDER BY r.archived ASC, r.id ASC`)
    .all(profileId)
}

/**
 * Las plantillas del perfil, cada una con lo que le falta por confirmar y con
 * su próxima fecha. Las cuentas de periodos se hacen en JS, no en SQL, por la
 * misma razón que las inversiones en los reportes: no es una suma, es una
 * secuencia de fechas. Y son pocas plantillas, no la tabla grande (R11).
 */
export function listar(
  profileId: number,
  hoy = hoyISO(),
  opciones: { etiquetas?: boolean } = {},
): Recurrencia[] {
  const rows = filas(profileId)
  const recs = rows.map(mapRecurrencia)
  // Las alertas del Resumen no enseñan etiquetas ni montos propuestos, así que
  // no los piden: dos consultas menos por carga, que es de lo que trata R11.
  // La misma bandera cubre las dos porque las dos las pide la misma vista.
  const completo = opciones.etiquetas !== false
  if (completo) adjuntarEtiquetas(recs)
  const ids = recs.map((r) => r.id)
  const resueltos = resueltosDe(ids)
  const promedios = completo ? promediosDe(ids) : new Map()
  const horizonte = sumarDias(hoy, HORIZONTE_DIAS)

  recs.forEach((rec, i) => {
    const row = rows[i]!
    const promedio = promedios.get(rec.id)
    rec.montoPropuestoCents = montoPropuesto(row, promedio)
    rec.muestrasPromedio = promedio?.muestras ?? 0
    // Hasta cuándo propone de verdad: con tope de ocurrencias, el día de la
    // última. Es lo que deja decir "termina el 5 dic 26" en vez de "12 veces",
    // que no dice cuándo.
    rec.ultimaFecha = finEfectivo(reglaDe(row))
    if (rec.archived) return
    const regla = reglaDe(row)
    const hechos = resueltos.get(rec.id) ?? new Set<string>()
    rec.pendientes = ocurrencias(regla, { hasta: hoy }).lista.filter(
      (o) => !hechos.has(o.periodo),
    ).length
    // Lo próximo que viene es lo próximo **sin resolver**: si ya adelantaste
    // el pago de agosto, lo que sigue es septiembre.
    rec.proximaFecha =
      ocurrencias(regla, { desde: hoy, hasta: horizonte }).lista.find(
        (o) => !hechos.has(o.periodo),
      )?.fecha ?? null
  })
  return recs
}

export function obtener(profileId: number, id: number): Recurrencia | null {
  const row: any = db.prepare(`${REC_SELECT} WHERE r.id = ? AND r.profile_id = ?`).get(id, profileId)
  if (!row) return null
  const rec = mapRecurrencia(row)
  adjuntarEtiquetas([rec])
  return rec
}

function fila(profileId: number, id: number): any {
  const row: any = db
    .prepare('SELECT * FROM recurrences WHERE id = ? AND profile_id = ?')
    .get(id, profileId)
  if (!row) throw httpError(404, 'Recurrencia no encontrada')
  return row
}

// ── La bandeja: derivada, nunca guardada ──────────────────────────────────

/**
 * Lo que está vencido y sin resolver, de la propuesta más vieja a la más
 * nueva: un atraso se pone al día empezando por lo de antes.
 *
 * Paginada porque una plantilla vieja puede tener cientos de periodos. Y ojo:
 * `truncado` avisa que alguna plantilla llegó al tope de `MAX_PERIODOS`, es
 * decir que hay más atraso del que cabe en una sola pasada.
 */
export function bandeja(
  profileId: number,
  hoy = hoyISO(),
  pagina: { limit: number; offset: number } = { limit: 100, offset: 0 },
): Bandeja {
  const rows = filas(profileId).filter((r) => r.archived === 0)
  const recs = rows.map(mapRecurrencia)
  adjuntarEtiquetas(recs)
  const ids = recs.map((r) => r.id)
  const resueltos = resueltosDe(ids)
  const promedios = promediosDe(ids)

  const todas: Propuesta[] = []
  let truncado = false
  rows.forEach((row, i) => {
    const rec = recs[i]!
    const promedio = promedios.get(rec.id)
    const propuesto = montoPropuesto(row, promedio)
    const hechos = resueltos.get(rec.id) ?? new Set<string>()
    const { lista, truncado: cortado } = ocurrencias(reglaDe(row), { hasta: hoy })
    if (cortado) truncado = true
    for (const o of lista) {
      if (hechos.has(o.periodo)) continue
      todas.push({
        recurrenceId: rec.id,
        periodo: o.periodo,
        fecha: o.fecha,
        accountId: rec.accountId,
        accountName: rec.accountName,
        type: rec.type,
        // El monto sale de la plantilla **hoy**: una propuesta se deriva, no
        // se guardó nunca, así que si subió la renta la propuesta ya trae el
        // monto nuevo. Lo ya asentado no se toca. Con monto variable el "hoy"
        // incluye el historial: es el promedio de las últimas asentadas.
        amountCents: propuesto,
        amountMode: rec.amountMode,
        muestrasPromedio: promedio?.muestras ?? 0,
        categoryId: rec.categoryId,
        categoryName: rec.categoryName,
        transferAccountId: rec.transferAccountId,
        transferAccountName: rec.transferAccountName,
        note: rec.note,
        tags: rec.tags,
        descripcion: rec.descripcion,
        // Viaja para que la bandeja pueda decir que esto **no** es gasto: un
        // aporte sale de la cuenta pero no consume patrimonio (D6), y sumarlo
        // con los gastos daría un total que la portada nunca va a confirmar.
        investmentId: rec.investmentId,
        investmentName: rec.investmentName,
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

export interface EntradaRecurrencia {
  profileId: number
  accountId: number
  type: 'ingreso' | 'gasto' | 'transferencia'
  amountCents: number
  categoryId?: number | null
  transferAccountId?: number | null
  note: string
  frequency: 'mensual' | 'quincenal' | 'semanal' | 'anual'
  dayOfMonth?: number | null
  dayOfMonth2?: number | null
  monthOfYear?: number | null
  weekday?: number | null
  startDate: string
  endDate?: string | null
  tagIds?: number[]
  archived?: boolean
  /** Inversión a la que aporta. Solo en un gasto. */
  investmentId?: number | null
  /** De dónde sale el monto que propone: el fijo o el promedio de lo asentado. */
  amountMode?: 'fijo' | 'promedio'
  /** Ventana de pausa, inclusiva. Las dos o ninguna. */
  pausedFrom?: string | null
  pausedUntil?: string | null
  /** Termina tras tantas ocurrencias. */
  maxOccurrences?: number | null
}

/** Cuentas, categoría, etiquetas e inversión, todas del mismo perfil. */
function validarReferencias(input: EntradaRecurrencia): void {
  ensureAccount(input.profileId, input.accountId)
  if (input.type === 'transferencia') {
    if (!input.transferAccountId) throw httpError(400, 'Elige la cuenta destino')
    if (input.transferAccountId === input.accountId) {
      throw httpError(400, 'Origen y destino deben ser distintas')
    }
    ensureAccount(input.profileId, input.transferAccountId)
  } else if (input.categoryId) {
    ensureCategory(input.profileId, input.categoryId, input.type)
  }
  if (input.tagIds) ensureTags(input.profileId, input.tagIds)
  // Una pausa a medias no significa nada, y una al revés se comería el
  // histórico entero sin decirlo.
  if ((input.pausedFrom ? 1 : 0) + (input.pausedUntil ? 1 : 0) === 1) {
    throw httpError(400, 'La pausa necesita sus dos fechas: desde cuándo y hasta cuándo')
  }
  if (input.pausedFrom && input.pausedUntil && input.pausedUntil < input.pausedFrom) {
    throw httpError(400, 'La pausa termina antes de empezar')
  }
  if (input.investmentId) {
    if (input.type !== 'gasto') throw httpError(400, 'Solo un gasto puede aportar a una inversión')
    const inv = db
      .prepare('SELECT id FROM investments WHERE id = ? AND profile_id = ?')
      .get(input.investmentId, input.profileId)
    if (!inv) throw httpError(400, 'La inversión no pertenece a este perfil')
  }
}

/** Reemplaza las etiquetas de una plantilla. Llamar dentro de una transacción. */
function fijarEtiquetas(recurrenceId: number, tagIds: number[]): void {
  db.prepare('DELETE FROM recurrence_tags WHERE recurrence_id = ?').run(recurrenceId)
  const insert = db.prepare(
    'INSERT OR IGNORE INTO recurrence_tags (recurrence_id, tag_id) VALUES (?, ?)',
  )
  for (const tagId of new Set(tagIds)) insert.run(recurrenceId, tagId)
}

/** Los campos del calendario que aplican a cada periodicidad; el resto, nulo. */
function camposDeFrecuencia(input: EntradaRecurrencia) {
  const esTransferencia = input.type === 'transferencia'
  return {
    // Aportar es un gasto de la cuenta hacia la inversión: cambiar el tipo de
    // la plantilla suelta la liga en vez de dejar una que ya no aplica.
    investmentId: input.type === 'gasto' ? (input.investmentId ?? null) : null,
    // Las dos fechas de la pausa van juntas o no va ninguna.
    pausedFrom: input.pausedFrom && input.pausedUntil ? input.pausedFrom : null,
    pausedUntil: input.pausedFrom && input.pausedUntil ? input.pausedUntil : null,
    categoryId: esTransferencia ? null : (input.categoryId ?? null),
    transferAccountId: esTransferencia ? (input.transferAccountId ?? null) : null,
    dayOfMonth: input.frequency === 'semanal' ? null : (input.dayOfMonth ?? null),
    dayOfMonth2: input.frequency === 'quincenal' ? (input.dayOfMonth2 ?? 31) : null,
    monthOfYear: input.frequency === 'anual' ? (input.monthOfYear ?? null) : null,
    weekday: input.frequency === 'semanal' ? (input.weekday ?? null) : null,
  }
}

export function crear(input: EntradaRecurrencia): Recurrencia {
  validarReferencias(input)
  const c = camposDeFrecuencia(input)
  const id = inTransaction(() => {
    const result = db
      .prepare(
        `INSERT INTO recurrences
          (profile_id, account_id, type, amount_cents, category_id, transfer_account_id, note,
           frequency, day_of_month, day_of_month_2, month_of_year, weekday, start_date, end_date,
           investment_id, amount_mode, paused_from, paused_until, max_occurrences)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.profileId,
        input.accountId,
        input.type,
        input.amountCents,
        c.categoryId,
        c.transferAccountId,
        input.note,
        input.frequency,
        c.dayOfMonth,
        c.dayOfMonth2,
        c.monthOfYear,
        c.weekday,
        input.startDate,
        input.endDate ?? null,
        c.investmentId,
        input.amountMode ?? 'fijo',
        c.pausedFrom,
        c.pausedUntil,
        input.maxOccurrences ?? null,
      )
    const nuevo = Number(result.lastInsertRowid)
    if (input.tagIds) fijarEtiquetas(nuevo, input.tagIds)
    return nuevo
  })
  return obtener(input.profileId, id)!
}

/**
 * Editar una plantilla **no** toca lo ya asentado: esos movimientos son
 * historia y el dinero se movió. Las propuestas pendientes sí toman los datos
 * nuevos, porque se derivan — si te subieron la renta, lo que falta por
 * confirmar es la renta nueva.
 */
export function actualizar(id: number, input: EntradaRecurrencia): Recurrencia {
  fila(input.profileId, id)
  validarReferencias(input)
  const c = camposDeFrecuencia(input)
  inTransaction(() => {
    db.prepare(
      `UPDATE recurrences SET account_id = ?, type = ?, amount_cents = ?, category_id = ?,
        transfer_account_id = ?, note = ?, frequency = ?, day_of_month = ?, day_of_month_2 = ?,
        month_of_year = ?, weekday = ?, start_date = ?, end_date = ?, archived = ?,
        investment_id = ?, amount_mode = ?, paused_from = ?, paused_until = ?,
        max_occurrences = ?
       WHERE id = ?`,
    ).run(
      input.accountId,
      input.type,
      input.amountCents,
      c.categoryId,
      c.transferAccountId,
      input.note,
      input.frequency,
      c.dayOfMonth,
      c.dayOfMonth2,
      c.monthOfYear,
      c.weekday,
      input.startDate,
      input.endDate ?? null,
      input.archived ? 1 : 0,
      c.investmentId,
      input.amountMode ?? 'fijo',
      c.pausedFrom,
      c.pausedUntil,
      input.maxOccurrences ?? null,
      id,
    )
    if (input.tagIds) fijarEtiquetas(id, input.tagIds)
  })
  return obtener(input.profileId, id)!
}

/**
 * Borrar la plantilla se lleva su bitácora de periodos, pero **deja en el
 * libro los movimientos ya asentados**: ese dinero se movió. Es el mismo
 * criterio que el desembolso de una deuda.
 */
export function borrar(profileId: number, id: number): { asentados: number } {
  fila(profileId, id)
  const row: any = db
    .prepare(
      `SELECT COUNT(*) AS n FROM recurrence_runs WHERE recurrence_id = ? AND status = 'asentado'`,
    )
    .get(id)
  db.prepare('DELETE FROM recurrences WHERE id = ?').run(id)
  return { asentados: row.n }
}

export interface Ajustes {
  date?: string
  amountCents?: number
  categoryId?: number | null
  transferAccountId?: number | null
  accountId?: number
  note?: string
  tagIds?: number[]
}

/** Traduce el choque del UNIQUE en un 409 legible en vez de un 500. */
function comoConflicto<T>(fn: () => T): T {
  try {
    return fn()
  } catch (err) {
    const mensaje = (err as Error).message ?? ''
    if (/UNIQUE constraint failed: recurrence_runs/.test(mensaje)) {
      throw httpError(409, 'Ese periodo ya se había resuelto')
    }
    throw err
  }
}

function periodoResuelto(recurrenceId: number, periodo: string): any {
  return db
    .prepare('SELECT * FROM recurrence_runs WHERE recurrence_id = ? AND period = ?')
    .get(recurrenceId, periodo)
}

/** La fecha que le toca a ese periodo, o un 400 si la clave no es de aquí. */
function fechaDelPeriodo(row: any, periodo: string): string {
  const fecha = fechaDeOcurrencia(reglaDe(row), periodo)
  if (!fecha) throw httpError(400, 'Ese periodo no le corresponde a esta recurrencia')
  return fecha
}

/**
 * Asienta una propuesta: crea el movimiento y marca el periodo, **en una sola
 * transacción**. Si algo falla, no queda ni el movimiento ni la marca.
 *
 * Los ajustes son de esta partida, no de la plantilla: pagar la renta de julio
 * con $200 de más no reescribe la renta de todos los meses.
 *
 * Si la plantilla aporta a una inversión, en la misma transacción se registra
 * el aporte y el movimiento queda ligado a él. Eso es lo que hace que D6 lo
 * saque del gasto del mes —pasar dinero de tu cuenta a tu inversión no es
 * gastar— y que anular el movimiento se lleve también el aporte, dejando el
 * periodo otra vez en la bandeja. El libro manda, aquí como en todo.
 */
export function asentar(
  profileId: number,
  id: number,
  periodo: string,
  ajustes: Ajustes = {},
): Tx {
  const row = fila(profileId, id)
  const fecha = fechaDelPeriodo(row, periodo)
  if (periodoResuelto(id, periodo)) throw httpError(409, 'Ese periodo ya se había resuelto')

  const tipo = row.type as 'ingreso' | 'gasto' | 'transferencia'
  const accountId = ajustes.accountId ?? row.account_id
  const transferAccountId =
    tipo === 'transferencia' ? (ajustes.transferAccountId ?? row.transfer_account_id) : null
  const categoryId = tipo === 'transferencia' ? null : (ajustes.categoryId ?? row.category_id)
  // Sin ajuste manda lo que la bandeja propuso, que con monto variable **no**
  // es `amount_cents`. Si aquí se leyera la columna, la vista enseñaría el
  // promedio y el libro guardaría el fijo: dos cifras para la misma partida.
  const amountCents = ajustes.amountCents ?? montoPropuesto(row, promediosDe([id]).get(id))
  const etiquetas =
    ajustes.tagIds ??
    (
      db
        .prepare('SELECT tag_id FROM recurrence_tags WHERE recurrence_id = ?')
        .all(id) as { tag_id: number }[]
    ).map((t) => t.tag_id)

  validarReferencias({
    profileId,
    accountId,
    type: tipo,
    amountCents,
    categoryId,
    transferAccountId,
    note: '',
    frequency: row.frequency,
    startDate: row.start_date,
    tagIds: etiquetas,
    investmentId: row.investment_id ?? null,
  })

  const fechaMov = ajustes.date ?? fecha
  const nota = ajustes.note ?? row.note

  const txId = comoConflicto(() =>
    inTransaction(() => {
      // El aporte primero: el movimiento necesita su id para quedar ligado, y
      // esa liga es la que saca la partida del gasto del mes (D6).
      let entryId: number | null = null
      if (row.investment_id) {
        const entry = db
          .prepare(
            `INSERT INTO investment_entries (investment_id, type, amount_cents, date, note)
             VALUES (?, 'aporte', ?, ?, ?)`,
          )
          .run(row.investment_id, amountCents, fechaMov, nota)
        entryId = Number(entry.lastInsertRowid)
      }
      const result = db
        .prepare(
          `INSERT INTO transactions
            (profile_id, account_id, type, amount_cents, date, category_id, note,
             transfer_account_id, investment_entry_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          profileId,
          accountId,
          tipo,
          amountCents,
          fechaMov,
          categoryId,
          nota,
          transferAccountId,
          entryId,
        )
      const nuevo = Number(result.lastInsertRowid)
      setTxTags(nuevo, etiquetas)
      db.prepare(
        `INSERT INTO recurrence_runs (recurrence_id, period, status, tx_id)
         VALUES (?, ?, 'asentado', ?)`,
      ).run(id, periodo, nuevo)
      return nuevo
    }),
  )

  const tx = mapTx(getTx(txId))
  attachTags([tx])
  return tx as Tx
}

/** Descartar solo escribe la marca: no se asienta nada en el libro. */
export function descartar(profileId: number, id: number, periodo: string): void {
  const row = fila(profileId, id)
  fechaDelPeriodo(row, periodo)
  if (periodoResuelto(id, periodo)) throw httpError(409, 'Ese periodo ya se había resuelto')
  comoConflicto(() =>
    db
      .prepare(
        `INSERT INTO recurrence_runs (recurrence_id, period, status) VALUES (?, ?, 'descartado')`,
      )
      .run(id, periodo),
  )
}

/**
 * Deshace un descarte y devuelve el periodo a la bandeja. Solo aplica a los
 * descartados: un periodo asentado se deshace anulando su movimiento, que es
 * donde de verdad está el dinero.
 */
export function reabrir(profileId: number, id: number, periodo: string): void {
  fila(profileId, id)
  const run: any = periodoResuelto(id, periodo)
  if (!run) throw httpError(404, 'Ese periodo no estaba resuelto')
  if (run.status !== 'descartado') {
    throw httpError(
      409,
      'Ese periodo se asentó. Para deshacerlo, anula su movimiento en el libro.',
    )
  }
  db.prepare('DELETE FROM recurrence_runs WHERE id = ?').run(run.id)
}
