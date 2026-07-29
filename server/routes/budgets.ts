import { Router } from 'express'
import { db, httpError } from '../db.ts'
import { GASTO_DE_PRESUPUESTO } from '../reportes.ts'
import { budgetCopyInput, budgetInput, budgetQuery } from '../validators.ts'

const router = Router()

function mapBudget(row: any) {
  return {
    id: row.id,
    profileId: row.profile_id,
    categoryId: row.category_id,
    categoryName: row.category_name,
    month: row.month,
    amountCents: row.amount_cents,
    spentCents: row.spent_cents,
  }
}

/**
 * El tope y lo gastado son ambos del mes del presupuesto. Lo gastado sale del
 * fragmento compartido con la alerta de tope excedido: si cada uno tuviera el
 * suyo, la barra y la alerta podrían decir cifras distintas del mismo mes.
 */
const BUDGET_SELECT = `
  SELECT b.id, b.profile_id, b.category_id, b.month, b.amount_cents, c.name AS category_name,
    ${GASTO_DE_PRESUPUESTO} AS spent_cents
  FROM budgets b
  JOIN categories c ON c.id = b.category_id
`

/** La categoría debe existir, ser del perfil y ser de gasto. */
function ensureExpenseCategory(profileId: number, categoryId: number): void {
  const category = db
    .prepare("SELECT id FROM categories WHERE id = ? AND profile_id = ? AND kind = 'gasto'")
    .get(categoryId, profileId)
  if (!category) {
    throw httpError(400, 'La categoría no es de gasto o no pertenece al perfil')
  }
}

router.get('/', (req, res) => {
  const { profileId, month } = budgetQuery.parse(req.query)
  const rows: any[] = db
    .prepare(`${BUDGET_SELECT} WHERE b.profile_id = ? AND b.month = ? ORDER BY c.name ASC`)
    .all(profileId, month)
  res.json(rows.map(mapBudget))
})

// Fijar o actualizar el tope de una categoría en un mes (upsert).
router.post('/', (req, res) => {
  const input = budgetInput.parse(req.body)
  ensureExpenseCategory(input.profileId, input.categoryId)
  db.prepare(
    `INSERT INTO budgets (profile_id, category_id, month, amount_cents) VALUES (?, ?, ?, ?)
     ON CONFLICT (profile_id, category_id, month) DO UPDATE SET amount_cents = excluded.amount_cents`,
  ).run(input.profileId, input.categoryId, input.month, input.amountCents)
  const row: any = db
    .prepare(`${BUDGET_SELECT} WHERE b.profile_id = ? AND b.category_id = ? AND b.month = ?`)
    .get(input.profileId, input.categoryId, input.month)
  res.status(201).json(mapBudget(row))
})

// Copiar los topes de un mes a otro. No pisa los que el mes destino ya tenga:
// arrastrar el plan del mes pasado nunca debe borrar lo que ya ajustaste.
router.post('/copiar', (req, res) => {
  const { profileId, from, to } = budgetCopyInput.parse(req.body)
  if (from === to) return res.status(400).json({ error: 'El mes origen y el destino son el mismo' })
  const result = db
    .prepare(
      `INSERT INTO budgets (profile_id, category_id, month, amount_cents)
       SELECT profile_id, category_id, ?, amount_cents FROM budgets
       WHERE profile_id = ? AND month = ?
       ON CONFLICT (profile_id, category_id, month) DO NOTHING`,
    )
    .run(to, profileId, from)
  const rows: any[] = db
    .prepare(`${BUDGET_SELECT} WHERE b.profile_id = ? AND b.month = ? ORDER BY c.name ASC`)
    .all(profileId, to)
  res.json({ copiados: Number(result.changes), budgets: rows.map(mapBudget) })
})

router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM budgets WHERE id = ?').run(Number(req.params.id))
  if (result.changes === 0) return res.status(404).json({ error: 'Presupuesto no encontrado' })
  res.json({ ok: true })
})

export default router
