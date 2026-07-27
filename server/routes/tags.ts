import { Router } from 'express'
import { db } from '../db.ts'
import { tagInput, tagPatch } from '../validators.ts'

const router = Router()

function mapTag(row: any) {
  return {
    id: row.id,
    profileId: row.profile_id,
    name: row.name,
    txCount: row.tx_count ?? 0,
  }
}

const TAG_SELECT = `
  SELECT t.*, (SELECT COUNT(*) FROM transaction_tags tt WHERE tt.tag_id = t.id) AS tx_count
  FROM tags t
`

router.get('/', (req, res) => {
  const profileId = Number(req.query.profileId)
  if (!Number.isInteger(profileId) || profileId <= 0) {
    return res.status(400).json({ error: 'Falta profileId' })
  }
  const rows = db.prepare(`${TAG_SELECT} WHERE t.profile_id = ? ORDER BY t.name ASC`).all(profileId)
  res.json(rows.map(mapTag))
})

router.post('/', (req, res) => {
  const input = tagInput.parse(req.body)
  db.prepare('INSERT OR IGNORE INTO tags (profile_id, name) VALUES (?, ?)').run(
    input.profileId,
    input.name,
  )
  const row = db
    .prepare(`${TAG_SELECT} WHERE t.profile_id = ? AND t.name = ?`)
    .get(input.profileId, input.name)
  res.status(201).json(mapTag(row))
})

router.patch('/:id', (req, res) => {
  const id = Number(req.params.id)
  const existing: any = db.prepare('SELECT * FROM tags WHERE id = ?').get(id)
  if (!existing) return res.status(404).json({ error: 'Etiqueta no encontrada' })
  const input = tagPatch.parse(req.body)

  const choque = db
    .prepare('SELECT id FROM tags WHERE profile_id = ? AND name = ? AND id != ?')
    .get(existing.profile_id, input.name, id)
  if (choque) return res.status(409).json({ error: 'Ya existe una etiqueta con ese nombre' })

  db.prepare('UPDATE tags SET name = ? WHERE id = ?').run(input.name, id)
  res.json(mapTag(db.prepare(`${TAG_SELECT} WHERE t.id = ?`).get(id)))
})

// Borrar una etiqueta solo la despega de sus movimientos (cascada en
// transaction_tags). Ninguna partida se pierde ni cambia de monto.
router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM tags WHERE id = ?').run(Number(req.params.id))
  if (result.changes === 0) return res.status(404).json({ error: 'Etiqueta no encontrada' })
  res.json({ ok: true })
})

export default router
