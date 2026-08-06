// Metas. H1 de la auditoría: hasta la Fase 11, `goal_entries` no ligaba ni a
// cuenta ni a movimiento, así que apartar $50,000 para el fondo de emergencia
// no los quitaba de ningún lado. Era la **única** sección donde el dinero
// aparecía de la nada, y entre la vista de Metas y la de Cuentas el mismo peso
// se contaba dos veces.
//
// Ahora la meta puede decir dónde vive su dinero y cada aporte puede asentar
// su transferencia. Sigue siendo opcional —R4: "solo apuntar" es legítimo—,
// pero la vista dice cuál de las dos cosas estás viendo.

import { Router } from 'express'
import { db, ensureAccount, httpError, inTransaction, refreshGoalStatus, saldoAFecha } from '../db.ts'
import { goalInput, goalPatch, goalEntryInput } from '../validators.ts'
import { hoyISO } from '../../shared/fechas.ts'

const router = Router()

function mapEntry(row: any) {
  return {
    id: row.id,
    goalId: row.goal_id,
    amountCents: row.amount_cents,
    date: row.date,
    note: row.note,
    /** Si viene, este aporte movió dinero de verdad y no es solo un apunte. */
    txId: row.tx_id ?? null,
  }
}

/**
 * Cuánto hay que apartar al mes para llegar. `null` sin fecha límite —no hay
 * plazo que repartir— y cero si ya llegaste. El mes en curso cuenta entero:
 * quedan menos días, pero el aporte de este mes todavía se puede hacer.
 */
function porMesParaLlegar(
  targetCents: number,
  savedCents: number,
  dueDate: string | null,
  hoy: string,
): number | null {
  if (!dueDate) return null
  const falta = Math.max(0, targetCents - savedCents)
  if (falta === 0) return 0
  const [ya, ma] = hoy.split('-').map(Number)
  const [yb, mb] = dueDate.split('-').map(Number)
  const meses = (yb! * 12 + mb!) - (ya! * 12 + ma!) + 1
  // Vencida o de este mes: lo que falta, de un jalón. Repartirlo entre cero o
  // entre un número negativo daría una cifra sin sentido.
  if (meses <= 1) return falta
  return Math.ceil(falta / meses)
}

function mapGoal(row: any, hoy = hoyISO()) {
  const savedCents = row.saved_cents ?? 0
  return {
    id: row.id,
    profileId: row.profile_id,
    name: row.name,
    targetCents: row.target_cents,
    dueDate: row.due_date,
    note: row.note,
    status: row.status,
    savedCents,
    /** Dónde vive el dinero de esta meta. `null` = la meta es solo un apunte. */
    accountId: row.account_id ?? null,
    accountName: row.account_name ?? null,
    /** Saldo de esa cuenta hoy. Es lo que permite decir si la meta está respaldada. */
    accountBalanceCents: row.account_id ? (row.account_balance_cents as number) : null,
    /**
     * H1 en una cifra: **cuánto de lo apartado movió dinero de verdad**. Si es
     * menor que `savedCents`, el resto son apuntes sin respaldo — y la vista lo
     * dice en vez de sumarlo como si estuviera guardado en algún lado.
     */
    respaldadoCents: row.respaldado_cents ?? 0,
    /** Cuánto hay que apartar al mes para llegar a tiempo. */
    porMesCents: porMesParaLlegar(row.target_cents, savedCents, row.due_date ?? null, hoy),
    entries: [] as unknown[],
  }
}

/**
 * El aporte con su movimiento. La liga vive en `transactions.goal_entry_id`
 * —igual que la de un aporte a inversión—, así que se lee, no se guarda: si el
 * movimiento se anula, el aporte vuelve a ser un apunte solo.
 */
const ENTRY_SELECT = `
  SELECT e.*, (SELECT t.id FROM transactions t WHERE t.goal_entry_id = e.id) AS tx_id
  FROM goal_entries e
`

const GOAL_SELECT = `
  SELECT g.*, ac.name AS account_name,
    COALESCE((SELECT SUM(e.amount_cents) FROM goal_entries e WHERE e.goal_id = g.id), 0) AS saved_cents,
    COALESCE((SELECT SUM(e.amount_cents) FROM goal_entries e
      WHERE e.goal_id = g.id
        AND EXISTS (SELECT 1 FROM transactions t WHERE t.goal_entry_id = e.id)), 0) AS respaldado_cents,
    ${saldoAFecha('ac', "date('now', 'localtime')")} AS account_balance_cents
  FROM goals g
  LEFT JOIN accounts ac ON ac.id = g.account_id
`

function goalWithEntries(id: number) {
  const row: any = db.prepare(`${GOAL_SELECT} WHERE g.id = ?`).get(id)
  if (!row) return null
  const goal = mapGoal(row)
  goal.entries = db
    .prepare(`${ENTRY_SELECT} WHERE e.goal_id = ? ORDER BY e.date DESC, e.id DESC`)
    .all(id)
    .map(mapEntry)
  return goal
}

router.get('/', (req, res) => {
  const profileId = Number(req.query.profileId)
  if (!Number.isInteger(profileId) || profileId <= 0) {
    return res.status(400).json({ error: 'Falta profileId' })
  }
  const rows: any[] = db
    .prepare(
      `${GOAL_SELECT} WHERE g.profile_id = ?
       ORDER BY CASE g.status WHEN 'activa' THEN 0 ELSE 1 END, COALESCE(g.due_date, '9999-12-31') ASC, g.id DESC`,
    )
    .all(profileId)
  const goals = rows.map((r) => mapGoal(r))
  const ids = goals.map((g) => g.id)
  if (ids.length > 0) {
    const entries: any[] = db
      .prepare(
        `${ENTRY_SELECT} WHERE e.goal_id IN (${ids.map(() => '?').join(',')})
         ORDER BY e.date DESC, e.id DESC`,
      )
      .all(...ids)
    const byGoal = new Map<number, any[]>()
    for (const e of entries) {
      const list = byGoal.get(e.goal_id) ?? []
      list.push(mapEntry(e))
      byGoal.set(e.goal_id, list)
    }
    for (const g of goals) g.entries = byGoal.get(g.id) ?? []
  }
  res.json(goals)
})

router.post('/', (req, res) => {
  const input = goalInput.parse(req.body)
  if (input.accountId) ensureAccount(input.profileId, input.accountId)
  const result = db
    .prepare(
      `INSERT INTO goals (profile_id, name, target_cents, due_date, note, account_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.profileId,
      input.name,
      input.targetCents,
      input.dueDate ?? null,
      input.note,
      input.accountId ?? null,
    )
  res.status(201).json(goalWithEntries(Number(result.lastInsertRowid)))
})

router.patch('/:id', (req, res) => {
  const id = Number(req.params.id)
  const existing: any = db.prepare('SELECT * FROM goals WHERE id = ?').get(id)
  if (!existing) return res.status(404).json({ error: 'Meta no encontrada' })
  const input = goalPatch.parse(req.body)
  if (input.accountId) ensureAccount(existing.profile_id, input.accountId)
  db.prepare(
    'UPDATE goals SET name = ?, target_cents = ?, due_date = ?, note = ?, account_id = ? WHERE id = ?',
  ).run(
    input.name ?? existing.name,
    input.targetCents ?? existing.target_cents,
    input.dueDate === undefined ? existing.due_date : input.dueDate,
    input.note ?? existing.note,
    // `null` explícito la desliga; ausente la deja como estaba.
    input.accountId === undefined ? existing.account_id : input.accountId,
    id,
  )
  refreshGoalStatus(id)
  res.json(goalWithEntries(id))
})

router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM goals WHERE id = ?').run(Number(req.params.id))
  if (result.changes === 0) return res.status(404).json({ error: 'Meta no encontrada' })
  res.json({ ok: true })
})

router.post('/:id/entries', (req, res) => {
  const id = Number(req.params.id)
  const goal: any = db.prepare('SELECT * FROM goals WHERE id = ?').get(id)
  if (!goal) return res.status(404).json({ error: 'Meta no encontrada' })
  const input = goalEntryInput.parse(req.body)

  // Con cuenta de origen, el aporte **mueve dinero de verdad**: se asienta una
  // transferencia de esa cuenta a la de la meta. Sin cuenta de la meta no hay
  // a dónde transferirlo, y adivinarla sería inventar dónde está tu dinero.
  if (input.accountId) {
    if (!goal.account_id) {
      throw httpError(
        400,
        'Esta meta todavía no dice dónde vive su dinero: elige su cuenta antes de mover el aporte',
      )
    }
    if (input.accountId === goal.account_id) {
      throw httpError(400, 'El dinero ya está en la cuenta de la meta: el aporte sería un apunte')
    }
    ensureAccount(goal.profile_id, input.accountId)
  }

  inTransaction(() => {
    const entry = db
      .prepare('INSERT INTO goal_entries (goal_id, amount_cents, date, note) VALUES (?, ?, ?, ?)')
      .run(id, input.amountCents, input.date, input.note)
    if (input.accountId) {
      db.prepare(
        `INSERT INTO transactions
          (profile_id, account_id, type, amount_cents, date, note, transfer_account_id, goal_entry_id)
         VALUES (?, ?, 'transferencia', ?, ?, ?, ?, ?)`,
      ).run(
        goal.profile_id,
        input.accountId,
        input.amountCents,
        input.date,
        input.note || `Aporte a ${goal.name}`,
        goal.account_id,
        Number(entry.lastInsertRowid),
      )
    }
  })
  refreshGoalStatus(id)
  res.status(201).json(goalWithEntries(id))
})

router.delete('/entries/:entryId', (req, res) => {
  const entry: any = db.prepare('SELECT * FROM goal_entries WHERE id = ?').get(Number(req.params.entryId))
  if (!entry) return res.status(404).json({ error: 'Aporte no encontrado' })
  inTransaction(() => {
    // El movimiento del aporte se va con él, igual que el de un aporte a
    // inversión: si el aporte deja de existir, ese traspaso nunca ocurrió.
    db.prepare('DELETE FROM transactions WHERE goal_entry_id = ?').run(entry.id)
    db.prepare('DELETE FROM goal_entries WHERE id = ?').run(entry.id)
  })
  refreshGoalStatus(entry.goal_id)
  res.json(goalWithEntries(entry.goal_id))
})

export default router
