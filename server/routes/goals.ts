import { Router } from 'express'
import { db, refreshGoalStatus } from '../db.ts'
import { goalInput, goalPatch, goalEntryInput } from '../validators.ts'

const router = Router()

function mapEntry(row: any) {
  return { id: row.id, goalId: row.goal_id, amountCents: row.amount_cents, date: row.date, note: row.note }
}

function mapGoal(row: any) {
  return {
    id: row.id,
    profileId: row.profile_id,
    name: row.name,
    targetCents: row.target_cents,
    dueDate: row.due_date,
    note: row.note,
    status: row.status,
    savedCents: row.saved_cents ?? 0,
    entries: [] as unknown[],
  }
}

const GOAL_SELECT = `
  SELECT g.*, COALESCE((SELECT SUM(e.amount_cents) FROM goal_entries e WHERE e.goal_id = g.id), 0) AS saved_cents
  FROM goals g
`

function goalWithEntries(id: number) {
  const row: any = db.prepare(`${GOAL_SELECT} WHERE g.id = ?`).get(id)
  if (!row) return null
  const goal = mapGoal(row)
  goal.entries = db
    .prepare('SELECT * FROM goal_entries WHERE goal_id = ? ORDER BY date DESC, id DESC')
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
  const goals = rows.map(mapGoal)
  const ids = goals.map((g) => g.id)
  if (ids.length > 0) {
    const entries: any[] = db
      .prepare(
        `SELECT * FROM goal_entries WHERE goal_id IN (${ids.map(() => '?').join(',')})
         ORDER BY date DESC, id DESC`,
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
  const result = db
    .prepare('INSERT INTO goals (profile_id, name, target_cents, due_date, note) VALUES (?, ?, ?, ?, ?)')
    .run(input.profileId, input.name, input.targetCents, input.dueDate ?? null, input.note)
  res.status(201).json(goalWithEntries(Number(result.lastInsertRowid)))
})

router.patch('/:id', (req, res) => {
  const id = Number(req.params.id)
  const existing: any = db.prepare('SELECT * FROM goals WHERE id = ?').get(id)
  if (!existing) return res.status(404).json({ error: 'Meta no encontrada' })
  const input = goalPatch.parse(req.body)
  db.prepare('UPDATE goals SET name = ?, target_cents = ?, due_date = ?, note = ? WHERE id = ?').run(
    input.name ?? existing.name,
    input.targetCents ?? existing.target_cents,
    input.dueDate === undefined ? existing.due_date : input.dueDate,
    input.note ?? existing.note,
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
  db.prepare('INSERT INTO goal_entries (goal_id, amount_cents, date, note) VALUES (?, ?, ?, ?)').run(
    id,
    input.amountCents,
    input.date,
    input.note,
  )
  refreshGoalStatus(id)
  res.status(201).json(goalWithEntries(id))
})

router.delete('/entries/:entryId', (req, res) => {
  const entry: any = db.prepare('SELECT * FROM goal_entries WHERE id = ?').get(Number(req.params.entryId))
  if (!entry) return res.status(404).json({ error: 'Aporte no encontrado' })
  db.prepare('DELETE FROM goal_entries WHERE id = ?').run(entry.id)
  refreshGoalStatus(entry.goal_id)
  res.json(goalWithEntries(entry.goal_id))
})

export default router
