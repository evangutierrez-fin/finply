import { Router } from 'express'
import { db } from '../db.ts'
import { noteInput, notePatch } from '../validators.ts'

const router = Router()

function mapNote(row: any) {
  return {
    id: row.id,
    profileId: row.profile_id,
    title: row.title,
    body: row.body,
    pinned: row.pinned === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

router.get('/', (req, res) => {
  const profileId = Number(req.query.profileId)
  if (!Number.isInteger(profileId) || profileId <= 0) {
    return res.status(400).json({ error: 'Falta profileId' })
  }
  const rows = db
    .prepare('SELECT * FROM notes WHERE profile_id = ? ORDER BY pinned DESC, updated_at DESC, id DESC')
    .all(profileId)
  res.json(rows.map(mapNote))
})

router.post('/', (req, res) => {
  const input = noteInput.parse(req.body)
  if (!input.title && !input.body.trim()) {
    return res.status(400).json({ error: 'La nota está vacía' })
  }
  const result = db
    .prepare(
      `INSERT INTO notes (profile_id, title, body, created_at, updated_at)
       VALUES (?, ?, ?, datetime('now', 'localtime'), datetime('now', 'localtime'))`,
    )
    .run(input.profileId, input.title, input.body)
  const row = db.prepare('SELECT * FROM notes WHERE id = ?').get(Number(result.lastInsertRowid))
  res.status(201).json(mapNote(row))
})

router.patch('/:id', (req, res) => {
  const id = Number(req.params.id)
  const existing: any = db.prepare('SELECT * FROM notes WHERE id = ?').get(id)
  if (!existing) return res.status(404).json({ error: 'Nota no encontrada' })
  const input = notePatch.parse(req.body)
  const contentChanged = input.title !== undefined || input.body !== undefined
  db.prepare(
    `UPDATE notes SET title = ?, body = ?, pinned = ?,
      updated_at = CASE WHEN ? THEN datetime('now', 'localtime') ELSE updated_at END
     WHERE id = ?`,
  ).run(
    input.title ?? existing.title,
    input.body ?? existing.body,
    input.pinned === undefined ? existing.pinned : input.pinned ? 1 : 0,
    contentChanged ? 1 : 0,
    id,
  )
  const row = db.prepare('SELECT * FROM notes WHERE id = ?').get(id)
  res.json(mapNote(row))
})

router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM notes WHERE id = ?').run(Number(req.params.id))
  if (result.changes === 0) return res.status(404).json({ error: 'Nota no encontrada' })
  res.json({ ok: true })
})

export default router
