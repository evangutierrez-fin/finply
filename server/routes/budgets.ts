import { Router } from 'express'
import { db } from '../db.ts'
import { budgetInput } from '../validators.ts'

const router = Router()

router.get('/', (req, res) => {
  const profileId = Number(req.query.profileId)
  const month = String(req.query.month ?? '')
  if (!Number.isInteger(profileId) || profileId <= 0) {
    return res.status(400).json({ error: 'Falta profileId' })
  }
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: 'Mes inválido (AAAA-MM)' })
  }
  const rows: any[] = db
    .prepare(
      `SELECT b.id, b.profile_id, b.category_id, c.name AS category_name, b.amount_cents,
        COALESCE((SELECT SUM(t.amount_cents) FROM transactions t
          WHERE t.profile_id = b.profile_id AND t.category_id = b.category_id
            AND t.type = 'gasto' AND substr(t.date, 1, 7) = ?), 0) AS spent_cents
      FROM budgets b
      JOIN categories c ON c.id = b.category_id
      WHERE b.profile_id = ?
      ORDER BY c.name ASC`,
    )
    .all(month, profileId)
  res.json(
    rows.map((r) => ({
      id: r.id,
      profileId: r.profile_id,
      categoryId: r.category_id,
      categoryName: r.category_name,
      amountCents: r.amount_cents,
      spentCents: r.spent_cents,
    })),
  )
})

// Fijar o actualizar el presupuesto de una categoría (upsert).
router.post('/', (req, res) => {
  const input = budgetInput.parse(req.body)
  const category = db
    .prepare("SELECT id FROM categories WHERE id = ? AND profile_id = ? AND kind = 'gasto'")
    .get(input.categoryId, input.profileId)
  if (!category) {
    return res.status(400).json({ error: 'La categoría no es de gasto o no pertenece al perfil' })
  }
  db.prepare(
    `INSERT INTO budgets (profile_id, category_id, amount_cents) VALUES (?, ?, ?)
     ON CONFLICT (profile_id, category_id) DO UPDATE SET amount_cents = excluded.amount_cents`,
  ).run(input.profileId, input.categoryId, input.amountCents)
  res.status(201).json({ ok: true })
})

router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM budgets WHERE id = ?').run(Number(req.params.id))
  if (result.changes === 0) return res.status(404).json({ error: 'Presupuesto no encontrado' })
  res.json({ ok: true })
})

export default router
