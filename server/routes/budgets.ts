import { Router } from 'express'
import { db, httpError } from '../db.ts'
import { mapTotal, presupuestosDelMes, TOTAL_SELECT } from '../presupuestos.ts'
import { avanceDelPeriodo, hoyISO } from '../../shared/fechas.ts'
import {
  budgetCopyInput,
  budgetInput,
  budgetQuery,
  budgetTotalInput,
} from '../validators.ts'

const router = Router()

/** La categoría debe existir, ser del perfil y ser de gasto. */
function ensureExpenseCategory(profileId: number, categoryId: number): void {
  const category = db
    .prepare("SELECT id FROM categories WHERE id = ? AND profile_id = ? AND kind = 'gasto'")
    .get(categoryId, profileId)
  if (!category) {
    throw httpError(400, 'La categoría no es de gasto o no pertenece al perfil')
  }
}

// Todo el presupuesto de un mes en una sola respuesta: sus topes por
// categoría, los anuales de ese año, el tope total y cuánto lleva corrido el
// mes. Van juntos porque la vista los pinta juntos y porque el arrastre de uno
// depende de los meses anteriores del mismo perfil: partirlo en cuatro
// llamadas solo serviría para que se contradijeran.
router.get('/', (req, res) => {
  const { profileId, month } = budgetQuery.parse(req.query)
  res.json(presupuestosDelMes(profileId, month, hoyISO()))
})

// Fijar o actualizar un tope (upsert). El periodo y su tipo forman parte de la
// llave, así que el tope anual de una categoría y su tope de marzo conviven.
router.post('/', (req, res) => {
  const input = budgetInput.parse(req.body)
  ensureExpenseCategory(input.profileId, input.categoryId)
  db.prepare(
    `INSERT INTO budgets (profile_id, category_id, period, period_kind, amount_cents, rollover)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (profile_id, category_id, period) DO UPDATE SET
       amount_cents = excluded.amount_cents,
       period_kind = excluded.period_kind,
       rollover = excluded.rollover`,
  ).run(
    input.profileId,
    input.categoryId,
    input.period,
    input.periodKind,
    input.amountCents,
    input.rollover ? 1 : 0,
  )
  // Se devuelve el mes entero y no el renglón suelto: encender el arrastre de
  // una categoría le cambia el techo a esa, y el gasto nuevo le mueve el
  // sobrante al tope total. Un renglón aislado dejaría la vista a medias.
  const mes = input.periodKind === 'anio' ? `${input.period}-01` : input.period
  res.status(201).json(presupuestosDelMes(input.profileId, mes, hoyISO()))
})

// Copiar los topes de un mes a otro. No pisa los que el mes destino ya tenga:
// arrastrar el plan del mes pasado nunca debe borrar lo que ya ajustaste.
// Se copian solo los mensuales —un tope anual no pertenece a un mes— y viaja
// también el tope total, que es parte del mismo plan.
router.post('/copiar', (req, res) => {
  const { profileId, from, to } = budgetCopyInput.parse(req.body)
  if (from === to) return res.status(400).json({ error: 'El mes origen y el destino son el mismo' })
  const result = db
    .prepare(
      `INSERT INTO budgets (profile_id, category_id, period, period_kind, amount_cents, rollover)
       SELECT profile_id, category_id, ?, 'mes', amount_cents, rollover FROM budgets
       WHERE profile_id = ? AND period = ? AND period_kind = 'mes'
       ON CONFLICT (profile_id, category_id, period) DO NOTHING`,
    )
    .run(to, profileId, from)
  const total = db
    .prepare(
      `INSERT INTO budget_totals (profile_id, month, amount_cents)
       SELECT profile_id, ?, amount_cents FROM budget_totals
       WHERE profile_id = ? AND month = ?
       ON CONFLICT (profile_id, month) DO NOTHING`,
    )
    .run(to, profileId, from)
  res.json({
    copiados: Number(result.changes) + Number(total.changes),
    presupuesto: presupuestosDelMes(profileId, to, hoyISO()),
  })
})

router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM budgets WHERE id = ?').run(Number(req.params.id))
  if (result.changes === 0) return res.status(404).json({ error: 'Presupuesto no encontrado' })
  res.json({ ok: true })
})

// El tope de todo el mes vive en su propia ruta porque no tiene categoría.
router.put('/total', (req, res) => {
  const input = budgetTotalInput.parse(req.body)
  db.prepare(
    `INSERT INTO budget_totals (profile_id, month, amount_cents) VALUES (?, ?, ?)
     ON CONFLICT (profile_id, month) DO UPDATE SET amount_cents = excluded.amount_cents`,
  ).run(input.profileId, input.month, input.amountCents)
  const row: any = db
    .prepare(`${TOTAL_SELECT} WHERE bt.profile_id = ? AND bt.month = ?`)
    .get(input.profileId, input.month)
  res.json(mapTotal(row, avanceDelPeriodo(input.month, hoyISO())))
})

router.delete('/total/:id', (req, res) => {
  const result = db.prepare('DELETE FROM budget_totals WHERE id = ?').run(Number(req.params.id))
  if (result.changes === 0) return res.status(404).json({ error: 'Tope total no encontrado' })
  res.json({ ok: true })
})

export default router
