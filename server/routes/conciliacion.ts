// Cortes de conciliación: la segunda mitad de D19.
//
// La bandera por movimiento es el dato; esto es lo que la convierte en una
// comprobación con respuesta sí/no. "Al 31 de julio mi banco decía $84,320.15":
// si lo palomeado suma esa cifra, la cuenta cuadra; si no, la diferencia y las
// partidas sin marcar de esa fecha hacia atrás dicen exactamente qué falta.
//
// Todo lo derivado se calcula al leer —el corte solo guarda la fecha y el saldo
// declarado—, así que marcar o desmarcar una partida vuelve a cuadrar el corte
// solo, sin recalcular nada guardado. Es la misma línea de D7 y D10.

import { Router } from 'express'
import { db, ensureAccount, httpError, saldoAFecha } from '../db.ts'
import { cortInput, cortQuery } from '../validators.ts'

const router = Router()

function mapCorte(row: any) {
  const conciliadoCents = row.conciliado_cents as number
  return {
    id: row.id,
    profileId: row.profile_id,
    accountId: row.account_id,
    accountName: row.account_name,
    date: row.date,
    /** Lo que dice el estado de cuenta. Lo escribe el usuario. */
    balanceCents: row.balance_cents,
    /** Lo que suman las partidas ya palomeadas hasta esa fecha. */
    conciliadoCents,
    /** Lo que suma el libro entero hasta esa fecha, palomeado o no. */
    libroCents: row.libro_cents as number,
    /**
     * La respuesta. Cero es "cuadra"; cualquier otra cosa es lo que falta por
     * explicar, y `pendientes` es dónde buscarlo.
     */
    diferenciaCents: row.balance_cents - conciliadoCents,
    pendientes: row.pendientes as number,
    pendientesCents: row.pendientes_cents as number,
    note: row.note,
    createdAt: row.created_at,
  }
}

/**
 * Todo lo derivado sale en la **misma** consulta, no en tres por corte (R11):
 * el saldo palomeado, el del libro y las partidas que faltan por marcar.
 */
const CORTE_SELECT = `
  SELECT s.*, a.name AS account_name,
    ${saldoAFecha('a', 's.date', true)} AS conciliado_cents,
    ${saldoAFecha('a', 's.date', false)} AS libro_cents,
    (SELECT COUNT(*) FROM transactions t
      WHERE (t.account_id = a.id OR t.transfer_account_id = a.id)
        AND t.date <= s.date AND t.reconciled_at IS NULL) AS pendientes,
    COALESCE((SELECT SUM(CASE
        WHEN t.transfer_account_id = a.id THEN t.amount_cents
        WHEN t.type = 'ingreso' THEN t.amount_cents
        ELSE -t.amount_cents END)
      FROM transactions t
      WHERE (t.account_id = a.id OR t.transfer_account_id = a.id)
        AND t.date <= s.date AND t.reconciled_at IS NULL), 0) AS pendientes_cents
  FROM account_statements s
  JOIN accounts a ON a.id = s.account_id
`

router.get('/', (req, res) => {
  const query = cortQuery.parse(req.query)
  const filtro = query.accountId ? 'AND s.account_id = ?' : ''
  const params: number[] = query.accountId ? [query.profileId, query.accountId] : [query.profileId]
  const rows = db
    .prepare(`${CORTE_SELECT} WHERE s.profile_id = ? ${filtro} ORDER BY s.date DESC, s.id DESC`)
    .all(...params)
  res.json(rows.map(mapCorte))
})

/**
 * Declarar un corte. Repetir cuenta y fecha **corrige** el anterior en vez de
 * duplicarlo: quien vuelve a capturar el mismo corte está arreglando un dedazo,
 * no declarando dos verdades del mismo día.
 */
router.post('/', (req, res) => {
  const input = cortInput.parse(req.body)
  ensureAccount(input.profileId, input.accountId)
  db.prepare(
    `INSERT INTO account_statements (profile_id, account_id, date, balance_cents, note)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (account_id, date) DO UPDATE SET
       balance_cents = excluded.balance_cents, note = excluded.note`,
  ).run(input.profileId, input.accountId, input.date, input.balanceCents, input.note)
  const row = db
    .prepare(`${CORTE_SELECT} WHERE s.account_id = ? AND s.date = ?`)
    .get(input.accountId, input.date)
  res.status(201).json(mapCorte(row))
})

router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM account_statements WHERE id = ?').run(Number(req.params.id))
  if (Number(result.changes) === 0) throw httpError(404, 'Ese corte no existe')
  res.json({ ok: true })
})

export default router
