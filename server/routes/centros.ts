import { Router } from 'express'
import { db, inTransaction } from '../db.ts'
import { centroInput, centroPatch } from '../validators.ts'

const router = Router()

// La dimensión libre del perfil: proyecto, sucursal, obra o como la llame el
// usuario. Es **exclusiva** por movimiento, a diferencia de las etiquetas, que
// son varias: por eso sumar por centro no cuenta el mismo peso dos veces.
const SELECT = `
  SELECT c.*, (SELECT COUNT(*) FROM transactions t WHERE t.cost_center_id = c.id) AS tx_count
  FROM cost_centers c
`

function mapCentro(row: any) {
  return {
    id: row.id,
    profileId: row.profile_id,
    name: row.name,
    archived: row.archived === 1,
    txCount: row.tx_count ?? 0,
  }
}

router.get('/', (req, res) => {
  const profileId = Number(req.query.profileId)
  if (!Number.isInteger(profileId) || profileId <= 0) {
    return res.status(400).json({ error: 'Falta profileId' })
  }
  const rows = db
    .prepare(`${SELECT} WHERE c.profile_id = ? ORDER BY c.archived ASC, c.name ASC`)
    .all(profileId)
  res.json(rows.map(mapCentro))
})

router.post('/', (req, res) => {
  const input = centroInput.parse(req.body)
  const existe = db
    .prepare('SELECT id FROM cost_centers WHERE profile_id = ? AND name = ?')
    .get(input.profileId, input.name)
  if (existe) return res.status(409).json({ error: 'Ya hay uno con ese nombre' })
  const result = db
    .prepare('INSERT INTO cost_centers (profile_id, name) VALUES (?, ?)')
    .run(input.profileId, input.name)
  res.status(201).json(mapCentro(db.prepare(`${SELECT} WHERE c.id = ?`).get(result.lastInsertRowid)))
})

router.patch('/:id', (req, res) => {
  const id = Number(req.params.id)
  const existing: any = db.prepare('SELECT * FROM cost_centers WHERE id = ?').get(id)
  if (!existing) return res.status(404).json({ error: 'No encontrado' })
  const input = centroPatch.parse(req.body)
  if (input.name && input.name !== existing.name) {
    const choque = db
      .prepare('SELECT id FROM cost_centers WHERE profile_id = ? AND name = ? AND id != ?')
      .get(existing.profile_id, input.name, id)
    if (choque) return res.status(409).json({ error: 'Ya hay uno con ese nombre' })
  }
  db.prepare('UPDATE cost_centers SET name = ?, archived = ? WHERE id = ?').run(
    input.name ?? existing.name,
    input.archived === undefined ? existing.archived : input.archived ? 1 : 0,
    id,
  )
  res.json(mapCentro(db.prepare(`${SELECT} WHERE c.id = ?`).get(id)))
})

// Borrarlo no borra movimientos: los deja sin asignar, que es exactamente lo
// que pasa con una categoría borrada con `force`.
router.delete('/:id', (req, res) => {
  const id = Number(req.params.id)
  const existing: any = db.prepare('SELECT * FROM cost_centers WHERE id = ?').get(id)
  if (!existing) return res.status(404).json({ error: 'No encontrado' })
  inTransaction(() => {
    db.prepare('UPDATE transactions SET cost_center_id = NULL WHERE cost_center_id = ?').run(id)
    db.prepare('UPDATE invoices SET cost_center_id = NULL WHERE cost_center_id = ?').run(id)
    db.prepare('DELETE FROM cost_centers WHERE id = ?').run(id)
  })
  res.json({ ok: true })
})

export default router
