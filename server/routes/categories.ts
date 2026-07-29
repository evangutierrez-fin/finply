import { Router } from 'express'
import { db, httpError, inTransaction } from '../db.ts'
import { categoryDeleteQuery, categoryInput, categoryPatch } from '../validators.ts'

const router = Router()

function mapCategory(row: any) {
  return {
    id: row.id,
    profileId: row.profile_id,
    name: row.name,
    kind: row.kind,
    role: row.role ?? null,
    txCount: row.tx_count ?? 0,
  }
}

const CATEGORY_SELECT = `
  SELECT c.*, (SELECT COUNT(*) FROM transactions t WHERE t.category_id = c.id) AS tx_count
  FROM categories c
`

router.get('/', (req, res) => {
  const profileId = Number(req.query.profileId)
  if (!Number.isInteger(profileId) || profileId <= 0) {
    return res.status(400).json({ error: 'Falta profileId' })
  }
  const rows = db
    .prepare(`${CATEGORY_SELECT} WHERE c.profile_id = ? ORDER BY c.kind, c.name`)
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
    .prepare(`${CATEGORY_SELECT} WHERE c.profile_id = ? AND c.name = ? AND c.kind = ?`)
    .get(input.profileId, input.name, input.kind)
  res.status(201).json(mapCategory(row))
})

router.patch('/:id', (req, res) => {
  const id = Number(req.params.id)
  const existing: any = db.prepare('SELECT * FROM categories WHERE id = ?').get(id)
  if (!existing) return res.status(404).json({ error: 'Categoría no encontrada' })
  const input = categoryPatch.parse(req.body)

  const choque = db
    .prepare('SELECT id FROM categories WHERE profile_id = ? AND name = ? AND kind = ? AND id != ?')
    .get(existing.profile_id, input.name, existing.kind, id)
  if (choque) {
    return res.status(409).json({ error: `Ya existe una categoría de ${existing.kind} con ese nombre` })
  }

  // `role` ausente deja el papel como estaba; `null` explícito lo quita. Es la
  // misma distinción que ya usan la tinta del perfil y el plazo de una deuda.
  db.prepare('UPDATE categories SET name = ?, role = ? WHERE id = ?').run(
    input.name,
    input.role === undefined ? existing.role : input.role,
    id,
  )
  const row = db.prepare(`${CATEGORY_SELECT} WHERE c.id = ?`).get(id)
  res.json(mapCategory(row))
})

/**
 * Borrar una categoría en uso obliga a decidir qué pasa con sus movimientos:
 * o se mueven a otra categoría (`?reassignTo=`) o se aceptan explícitamente
 * como "Sin categoría" (`?force=true`). Sin ninguna de las dos, 409 con la
 * cuenta, para que la interfaz pueda preguntar en vez de perder clasificación.
 */
router.delete('/:id', (req, res) => {
  const id = Number(req.params.id)
  const existing: any = db.prepare('SELECT * FROM categories WHERE id = ?').get(id)
  if (!existing) return res.status(404).json({ error: 'Categoría no encontrada' })
  const { reassignTo, force } = categoryDeleteQuery.parse(req.query)

  const usage: any = db
    .prepare('SELECT COUNT(*) AS n FROM transactions WHERE category_id = ?')
    .get(id)

  if (reassignTo !== undefined) {
    if (reassignTo === id) throw httpError(400, 'La categoría destino es la misma')
    const destino: any = db
      .prepare('SELECT * FROM categories WHERE id = ? AND profile_id = ?')
      .get(reassignTo, existing.profile_id)
    if (!destino) throw httpError(400, 'La categoría destino no pertenece a este perfil')
    if (destino.kind !== existing.kind) {
      throw httpError(400, `La categoría destino es de ${destino.kind} y esta es de ${existing.kind}`)
    }
  } else if (usage.n > 0 && !force) {
    return res.status(409).json({
      error: `"${existing.name}" tiene ${usage.n} movimiento(s). Elige a dónde moverlos o confirma dejarlos sin categoría.`,
      txCount: usage.n,
    })
  }

  const presupuestos: any = db
    .prepare('SELECT COUNT(*) AS n FROM budgets WHERE category_id = ?')
    .get(id)

  inTransaction(() => {
    if (reassignTo !== undefined) {
      db.prepare('UPDATE transactions SET category_id = ? WHERE category_id = ?').run(reassignTo, id)
    }
    // Los presupuestos de la categoría se van con ella: un tope sin categoría
    // no significa nada, y moverlos podría chocar con el tope que el destino ya
    // tenga en ese mes. Se informa cuántos para que la interfaz lo diga.
    db.prepare('DELETE FROM budgets WHERE category_id = ?').run(id)
    db.prepare('DELETE FROM categories WHERE id = ?').run(id)
  })

  res.json({
    ok: true,
    movimientosReasignados: reassignTo !== undefined ? usage.n : 0,
    movimientosSinCategoria: reassignTo === undefined ? usage.n : 0,
    presupuestosBorrados: presupuestos.n,
  })
})

export default router
