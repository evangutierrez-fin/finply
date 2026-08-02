// Inmuebles en renta: el arrendamiento de un bien que ya existe.
//
// El modelo, que es lo que hay que entender antes de tocar nada:
//
//   · El **inmueble no vive aquí**. Es un `asset` de la Fase 11, con su costo,
//     su valuación y su deuda ligada. Esto es el contrato que lo renta.
//     Duplicarlo habría metido la misma casa dos veces en el patrimonio, que
//     es justo la mentira que la Fase 11 vino a cerrar (H3).
//   · El **depósito no es ingreso** (D6). Lo recibes, lo tienes en la cuenta y
//     lo debes: no lo ganaste. Devolverlo tampoco es gasto. Esa regla vive en
//     `MONTO_OPERATIVO`, es decir en el movimiento y no en el módulo, así que
//     apagar Inmuebles no convierte un depósito viejo en ingreso (R18).
//   · Todo lo demás **se deriva** de los movimientos ligados: lo cobrado, el
//     gasto, el depósito en mano y el rendimiento. No hay una columna
//     `cobrado` que pueda quedar vieja al anular un cobro.
//
// De solo lectura salvo el alta y la edición del contrato: registrar la renta
// es registrar un movimiento, y eso lo hace el usuario (R4).

import { db, httpError, inTransaction } from './db.ts'
import { finDeMes, hoyISO, proximoDiaDelMes } from '../shared/fechas.ts'
import { rendimientoInmueble } from '../shared/giro.ts'
import type { Arrendamiento } from '../shared/types.ts'

/** Meses que mira el rendimiento por omisión: un año redondo. */
export const VENTANA_MESES = 12

const SELECT = `
  SELECT r.*, a.name AS asset_name, a.cost_cents AS asset_cost,
    COALESCE(
      (SELECT v.value_cents FROM asset_valuations v
        WHERE v.asset_id = a.id AND v.date <= ?
        ORDER BY v.date DESC, v.id DESC LIMIT 1),
      a.cost_cents
    ) AS asset_value
  FROM rentals r
  JOIN assets a ON a.id = r.asset_id
`

/**
 * Lo cobrado, lo gastado y el depósito en mano de **todos** los arrendamientos
 * del perfil, en una sola consulta agregada (R11): con una por contrato, diez
 * inmuebles serían diez consultas.
 *
 * El depósito se suma aparte del resto justo porque no es ingreso: mezclarlo
 * inflaría el rendimiento con dinero que hay que devolver.
 */
function movimientosDe(profileId: number, desde: string, hasta: string) {
  const filas = db
    .prepare(
      `SELECT t.rental_id AS id,
        COALESCE(SUM(CASE WHEN t.rental_role = 'renta' AND t.date BETWEEN ? AND ?
          THEN t.amount_cents END), 0) AS cobrado,
        COALESCE(SUM(CASE WHEN t.rental_role = 'mantenimiento' AND t.date BETWEEN ? AND ?
          THEN t.amount_cents END), 0) AS gasto,
        COALESCE(SUM(CASE WHEN t.rental_role = 'deposito' THEN t.amount_cents
          WHEN t.rental_role = 'devolucion_deposito' THEN -t.amount_cents END), 0) AS deposito
       FROM transactions t
       WHERE t.profile_id = ? AND t.rental_id IS NOT NULL
       GROUP BY t.rental_id`,
    )
    .all(desde, hasta, desde, hasta, profileId) as any[]
  const mapa = new Map<number, { cobrado: number; gasto: number; deposito: number }>()
  for (const f of filas) {
    mapa.set(f.id, { cobrado: f.cobrado, gasto: f.gasto, deposito: f.deposito })
  }
  return mapa
}

function mapArrendamiento(
  row: any,
  movs: { cobrado: number; gasto: number; deposito: number },
  desde: string,
  hoy: string,
): Arrendamiento {
  const endDate = row.end_date ?? null
  // El próximo cobro solo existe dentro del contrato: uno que ya terminó no
  // vuelve a cobrar, y uno que aún no empieza cobra desde su fecha de inicio.
  const base = row.start_date > hoy ? row.start_date : hoy
  const proximo = proximoDiaDelMes(base, row.payment_day)
  return {
    id: row.id,
    profileId: row.profile_id,
    assetId: row.asset_id,
    assetName: row.asset_name ?? '',
    assetValueCents: row.asset_value ?? 0,
    assetCostCents: row.asset_cost ?? 0,
    tenant: row.tenant,
    rentCents: row.rent_cents,
    depositCents: row.deposit_cents,
    paymentDay: row.payment_day,
    startDate: row.start_date,
    endDate,
    note: row.note,
    archived: row.archived === 1,
    cobradoCents: movs.cobrado,
    gastoCents: movs.gasto,
    // Nunca negativo: devolver de más no significa que el inquilino te deba un
    // depósito, significa que alguien se equivocó al capturar.
    depositoEnManoCents: Math.max(0, movs.deposito),
    meses: VENTANA_MESES,
    rendimiento: rendimientoInmueble({
      cobradoCents: movs.cobrado,
      gastoCents: movs.gasto,
      valorCents: row.asset_value ?? 0,
      costoCents: row.asset_cost ?? 0,
      meses: VENTANA_MESES,
    }),
    proximoCobro: row.archived === 1 || (endDate !== null && proximo > endDate) ? null : proximo,
  }
}

/** La ventana de doce meses que termina hoy, en fechas. */
function ventana(hoy: string): { desde: string; hasta: string } {
  const [anio, mes] = hoy.split('-').map(Number)
  // Doce meses cerrados hacia atrás contando el actual: julio 2026 mira desde
  // agosto 2025. Es la misma convención que el reporte anual.
  const total = anio! * 12 + (mes! - 1) - (VENTANA_MESES - 1)
  const desde = `${Math.floor(total / 12)}-${String((((total % 12) + 12) % 12) + 1).padStart(2, '0')}-01`
  return { desde, hasta: finDeMes(hoy) }
}

export function listar(profileId: number, hoy = hoyISO()): Arrendamiento[] {
  const { desde, hasta } = ventana(hoy)
  const filas: any[] = db
    .prepare(`${SELECT} WHERE r.profile_id = ? ORDER BY r.archived ASC, a.name ASC, r.id ASC`)
    .all(hoy, profileId)
  const movs = movimientosDe(profileId, desde, hasta)
  const vacio = { cobrado: 0, gasto: 0, deposito: 0 }
  return filas.map((f) => mapArrendamiento(f, movs.get(f.id) ?? vacio, desde, hoy))
}

export function obtener(profileId: number, id: number, hoy = hoyISO()): Arrendamiento | null {
  return listar(profileId, hoy).find((r) => r.id === id) ?? null
}

export interface EntradaArrendamiento {
  profileId: number
  assetId: number
  tenant: string
  rentCents: number
  depositCents: number
  paymentDay: number
  startDate: string
  endDate?: string | null
  note: string
  archived?: boolean
}

/** El bien tiene que existir, ser de este perfil y no estar archivado. */
function validar(input: EntradaArrendamiento): void {
  const bien: any = db
    .prepare('SELECT id, archived FROM assets WHERE id = ? AND profile_id = ?')
    .get(input.assetId, input.profileId)
  if (!bien) throw httpError(400, 'Ese bien no es de este perfil')
  if (bien.archived === 1) {
    throw httpError(400, 'Ese bien está archivado: recupéralo antes de rentarlo')
  }
  if (input.endDate && input.endDate < input.startDate) {
    throw httpError(400, 'El contrato no puede terminar antes de empezar')
  }
}

export function crear(input: EntradaArrendamiento): Arrendamiento {
  validar(input)
  const result = db
    .prepare(
      `INSERT INTO rentals
        (profile_id, asset_id, tenant, rent_cents, deposit_cents, payment_day,
         start_date, end_date, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.profileId,
      input.assetId,
      input.tenant,
      input.rentCents,
      input.depositCents,
      input.paymentDay,
      input.startDate,
      input.endDate ?? null,
      input.note,
    )
  return obtener(input.profileId, Number(result.lastInsertRowid))!
}

export function actualizar(id: number, input: EntradaArrendamiento): Arrendamiento {
  const existe = db
    .prepare('SELECT id FROM rentals WHERE id = ? AND profile_id = ?')
    .get(id, input.profileId)
  if (!existe) throw httpError(404, 'Arrendamiento no encontrado')
  validar(input)
  db.prepare(
    `UPDATE rentals SET asset_id = ?, tenant = ?, rent_cents = ?, deposit_cents = ?,
       payment_day = ?, start_date = ?, end_date = ?, note = ?, archived = ?
     WHERE id = ?`,
  ).run(
    input.assetId,
    input.tenant,
    input.rentCents,
    input.depositCents,
    input.paymentDay,
    input.startDate,
    input.endDate ?? null,
    input.note,
    input.archived ? 1 : 0,
    id,
  )
  return obtener(input.profileId, id)!
}

/**
 * Borrar el contrato **deja en el libro sus movimientos**: ese dinero se
 * movió. Solo pierden la liga, igual que al borrar una factura o una deuda.
 *
 * ⚠ Y por eso pierden también su papel: un depósito sin `rental_role` vuelve a
 * contar como ingreso. La respuesta dice cuántos movimientos toca para que el
 * aviso no mienta.
 *
 * El papel se borra **a mano**, aquí. La llave foránea es `ON DELETE SET NULL`
 * y solo alcanza a `rental_id`; `rental_role` sobrevivía sola, y un papel sin
 * contrato es un estado que el propio validador rechaza al escribir (400: "Di
 * de qué arrendamiento es ese cobro"). Esos renglones quedaban donde ni podían
 * editarse ni contaban como ingreso, y nadie lo veía porque hasta la Fase 18 el
 * Resumen sumaba en crudo y no miraba el papel.
 */
export function borrar(profileId: number, id: number): { movimientos: number; depositos: number } {
  const existe = db
    .prepare('SELECT id FROM rentals WHERE id = ? AND profile_id = ?')
    .get(id, profileId)
  if (!existe) throw httpError(404, 'Arrendamiento no encontrado')
  const cuenta: any = db
    .prepare(
      `SELECT COUNT(*) AS n,
        COALESCE(SUM(CASE WHEN rental_role IN ('deposito', 'devolucion_deposito')
          THEN 1 END), 0) AS depositos
       FROM transactions WHERE rental_id = ?`,
    )
    .get(id)
  inTransaction(() => {
    db.prepare('UPDATE transactions SET rental_role = NULL WHERE rental_id = ?').run(id)
    db.prepare('DELETE FROM rentals WHERE id = ?').run(id)
  })
  return { movimientos: cuenta.n, depositos: cuenta.depositos }
}
