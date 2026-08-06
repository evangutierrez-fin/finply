// Bienes: la casa, el auto, la herramienta (H3).
//
// El hueco que tapan: financiar un auto creaba una deuda que **bajaba** el
// patrimonio, y el auto nunca lo subía. El Resumen decía que comprar un coche
// te empobrecía $240,000. La Fase 3 ya distinguía "lo que costó el bien" de
// "lo que cuesta el crédito"; lo que faltaba era que el bien existiera.
//
// **El valor lo declara el usuario, siempre** (R9). Finply no deprecia por su
// cuenta: no hay una tasa universal para un coche o una casa, y suponer una
// convertiría el patrimonio en una opinión de Finply. Sin valuaciones, un bien
// vale lo que costó — que es lo más honesto que se puede afirmar de él.

import { db } from './db.ts'
import { hoyISO } from '../shared/fechas.ts'

/**
 * Cuánto vale un bien a una fecha: la **última valuación hasta esa fecha**, y
 * si no hay ninguna, su costo. Es la misma forma de las inversiones —una
 * valuación fija el valor— y por eso vive en SQL, para que el Resumen, la
 * serie anual y la vista den siempre la misma cifra.
 */
export function valorAFecha(bien: string, fecha: string): string {
  return `COALESCE((
    SELECT v.value_cents FROM asset_valuations v
    WHERE v.asset_id = ${bien}.id AND v.date <= ${fecha}
    ORDER BY v.date DESC, v.id DESC LIMIT 1
  ), ${bien}.cost_cents)`
}

const BIEN_SELECT = `
  SELECT a.*, d.concept AS debt_concept, d.direction AS debt_direction,
    ${valorAFecha('a', '?')} AS value_cents,
    (SELECT COUNT(*) FROM asset_valuations v WHERE v.asset_id = a.id) AS valuaciones,
    -- Lo que todavía se debe del crédito que lo financia. Es la mitad que
    -- faltaba: sin ella no se puede decir cuánto del bien es de verdad tuyo.
    COALESCE((SELECT MAX(0, d.principal_cents - COALESCE((
      SELECT SUM(p.amount_cents - p.interest_cents) FROM debt_payments p WHERE p.debt_id = d.id
    ), 0))), 0) AS debt_balance_cents
  FROM assets a
  LEFT JOIN debts d ON d.id = a.debt_id AND d.status = 'abierta'
`

export function mapBien(row: any) {
  const valueCents = row.value_cents as number
  const debtBalanceCents = row.debt_id ? (row.debt_balance_cents as number) : 0
  return {
    id: row.id,
    profileId: row.profile_id,
    name: row.name,
    kind: row.kind,
    costCents: row.cost_cents,
    acquiredDate: row.acquired_date,
    debtId: row.debt_id ?? null,
    debtConcept: row.debt_concept ?? null,
    debtBalanceCents,
    note: row.note,
    archived: row.archived === 1,
    /** Lo que declaró el usuario, o el costo si nunca lo ha valuado. */
    valueCents,
    /** Cuánto se ha ido en valor desde que lo compró. Negativo si subió. */
    depreciacionCents: row.cost_cents - valueCents,
    /**
     * La parte del bien que ya es tuya: su valor menos lo que aún debes del
     * crédito que lo financia. Puede ser negativa —debes más de lo que vale—,
     * y decirlo es justamente el punto.
     */
    equityCents: valueCents - debtBalanceCents,
    valuaciones: row.valuaciones as number,
    entries: [] as unknown[],
  }
}

export function listarBienes(profileId: number, hoy = hoyISO()) {
  const rows: any[] = db
    .prepare(`${BIEN_SELECT} WHERE a.profile_id = ? ORDER BY a.archived ASC, a.id DESC`)
    .all(hoy, profileId)
  const bienes = rows.map(mapBien)
  const ids = bienes.map((b) => b.id)
  if (ids.length > 0) {
    const valuaciones: any[] = db
      .prepare(
        `SELECT * FROM asset_valuations WHERE asset_id IN (${ids.map(() => '?').join(',')})
         ORDER BY date DESC, id DESC`,
      )
      .all(...ids)
    const porBien = new Map<number, any[]>()
    for (const v of valuaciones) {
      const lista = porBien.get(v.asset_id) ?? []
      lista.push({ id: v.id, assetId: v.asset_id, date: v.date, valueCents: v.value_cents, note: v.note })
      porBien.set(v.asset_id, lista)
    }
    for (const b of bienes) b.entries = porBien.get(b.id) ?? []
  }
  return bienes
}

export function bienPorId(id: number, hoy = hoyISO()) {
  const row: any = db.prepare(`${BIEN_SELECT} WHERE a.id = ?`).get(hoy, id)
  if (!row) return null
  const bien = mapBien(row)
  bien.entries = db
    .prepare('SELECT * FROM asset_valuations WHERE asset_id = ? ORDER BY date DESC, id DESC')
    .all(id)
    .map((v: any) => ({ id: v.id, assetId: v.asset_id, date: v.date, valueCents: v.value_cents, note: v.note }))
  return bien
}

/**
 * Lo que suman los bienes activos al cierre de cada mes pedido. **Solo el
 * valor**, no el equity: la deuda que lo financia ya está restada en el
 * renglón de deudas del patrimonio, y restarla aquí también la contaría dos
 * veces (R18).
 *
 * Dos consultas para los doce meses, no una por mes: los bienes y sus
 * valuaciones son pocos y manuales —como las inversiones— y el recorrido se
 * hace una sola vez en JS (R11).
 */
export function bienesPorMes(profileId: number, meses: string[]): Map<string, number> {
  const bienes: any[] = db
    .prepare(
      `SELECT id, cost_cents, acquired_date FROM assets
       WHERE profile_id = ? AND archived = 0 ORDER BY id ASC`,
    )
    .all(profileId)
  const resultado = new Map<string, number>()
  if (bienes.length === 0) {
    for (const mes of meses) resultado.set(mes, 0)
    return resultado
  }
  const valuaciones: any[] = db
    .prepare(
      `SELECT v.asset_id, v.date, v.value_cents FROM asset_valuations v
       JOIN assets a ON a.id = v.asset_id
       WHERE a.profile_id = ? AND a.archived = 0
       ORDER BY v.date ASC, v.id ASC`,
    )
    .all(profileId)
  const porBien = new Map<number, any[]>()
  for (const v of valuaciones) {
    const lista = porBien.get(v.asset_id) ?? []
    lista.push(v)
    porBien.set(v.asset_id, lista)
  }

  for (const mes of meses) {
    // El cierre del mes: cualquier fecha suya es menor a 'AAAA-MM-32'.
    const cierre = `${mes}-32`
    let total = 0
    for (const b of bienes) {
      if (b.acquired_date >= cierre) continue
      const lista = porBien.get(b.id) ?? []
      let valor = b.cost_cents
      for (const v of lista) {
        if (v.date >= cierre) break
        valor = v.value_cents
      }
      total += valor
    }
    resultado.set(mes, total)
  }
  return resultado
}
