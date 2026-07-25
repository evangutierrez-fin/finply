import { Router } from 'express'
import { db } from '../db.ts'
import { categoryInput } from '../validators.ts'

const router = Router()

function mapCategory(row: any) {
  return { id: row.id, profileId: row.profile_id, name: row.name, kind: row.kind }
}

router.get('/', (req, res) => {
  const profileId = Number(req.query.profileId)
  if (!Number.isInteger(profileId) || profileId <= 0) {
    return res.status(400).json({ error: 'Falta profileId' })
  }
  const rows = db
    .prepare('SELECT * FROM categories WHERE profile_id = ? ORDER BY kind, name')
    .all(profileId)
  res.json(rows.map(mapCategory))
})

router.post('/', (req, res) => {
  const input = categoryInput.parse(req.body)
  db.prepare('INSERT OR IGNORE INTO categories (profile_id, name, kind) VALUES (?, ?, ?)').run(
    input.profileId,
    input.name,
    input.kind,
  )
  const row = db
    .prepare('SELECT * FROM categories WHERE profile_id = ? AND name = ? AND kind = ?')
    .get(input.profileId, input.name, input.kind)
  res.status(201).json(mapCategory(row))
})

export default router
