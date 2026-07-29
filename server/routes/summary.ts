import { Router } from 'express'
import { db, accountsWithBalance, investmentsWithTotals, mapAccount, mapTx, TX_SELECT } from '../db.ts'
import { listarBienes } from '../bienes.ts'
import { summaryQuery } from '../validators.ts'

const router = Router()

router.get('/', (req, res) => {
  const { profileId, month } = summaryQuery.parse(req.query)

  const accounts = accountsWithBalance(profileId).map(mapAccount)
  const active = accounts.filter((a) => !a.archived)
  const totalCents = active.reduce((sum, a) => sum + a.balanceCents, 0)

  const totals: any = db
    .prepare(
      `SELECT
        COALESCE(SUM(CASE WHEN type = 'ingreso' THEN amount_cents END), 0) AS income,
        COALESCE(SUM(CASE WHEN type = 'gasto' THEN amount_cents END), 0) AS expense
      FROM transactions
      WHERE profile_id = ? AND substr(date, 1, 7) = ? AND type IN ('ingreso', 'gasto')`,
    )
    .get(profileId, month)

  const byDay: any[] = db
    .prepare(
      `SELECT date,
        COALESCE(SUM(CASE WHEN type = 'ingreso' THEN amount_cents END), 0) AS income,
        COALESCE(SUM(CASE WHEN type = 'gasto' THEN amount_cents END), 0) AS expense
      FROM transactions
      WHERE profile_id = ? AND substr(date, 1, 7) = ? AND type IN ('ingreso', 'gasto')
      GROUP BY date ORDER BY date ASC`,
    )
    .all(profileId, month)

  const byCategory: any[] = db
    .prepare(
      `SELECT COALESCE(c.name, 'Sin categoría') AS name, SUM(t.amount_cents) AS expense
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id
      WHERE t.profile_id = ? AND substr(t.date, 1, 7) = ? AND t.type = 'gasto'
      GROUP BY COALESCE(c.name, 'Sin categoría')
      ORDER BY expense DESC LIMIT 6`,
    )
    .all(profileId, month)

  const recent: any[] = db
    .prepare(`${TX_SELECT} WHERE t.profile_id = ? ORDER BY t.date DESC, t.id DESC LIMIT 8`)
    .all(profileId)

  const debts: any = db
    .prepare(
      `SELECT
        COALESCE(SUM(CASE WHEN direction = 'por_cobrar' THEN remaining END), 0) AS por_cobrar,
        COALESCE(SUM(CASE WHEN direction = 'por_pagar' THEN remaining END), 0) AS por_pagar,
        COUNT(*) AS abiertas
      FROM (
        SELECT d.direction,
          -- Saldo insoluto: solo el capital abonado baja el principal.
          d.principal_cents - COALESCE((SELECT SUM(p.amount_cents - p.interest_cents)
            FROM debt_payments p WHERE p.debt_id = d.id), 0) AS remaining
        FROM debts d
        WHERE d.profile_id = ? AND d.status = 'abierta'
      )`,
    )
    .get(profileId)

  const investments = investmentsWithTotals(profileId).filter((i) => !i.archived)
  // H3: el auto que financiaste también es tuyo. Entra por su valor declarado
  // —la deuda ya se resta en su propio renglón— y por eso el Resumen dejó de
  // decir que comprar un coche te empobrece.
  const bienes = listarBienes(profileId).filter((b) => !b.archived)

  res.json({
    month,
    accounts,
    totalCents,
    incomeCents: totals.income,
    expenseCents: totals.expense,
    byDay: byDay.map((d) => ({ date: d.date, incomeCents: d.income, expenseCents: d.expense })),
    byCategory: byCategory.map((c) => ({ name: c.name, expenseCents: c.expense })),
    recent: recent.map(mapTx),
    debts: {
      porCobrarCents: debts.por_cobrar,
      porPagarCents: debts.por_pagar,
      abiertas: debts.abiertas,
    },
    investments: {
      investedCents: investments.reduce((s, i) => s + i.investedCents, 0),
      valueCents: investments.reduce((s, i) => s + i.valueCents, 0),
      count: investments.length,
    },
    bienes: {
      costCents: bienes.reduce((s, b) => s + b.costCents, 0),
      valueCents: bienes.reduce((s, b) => s + b.valueCents, 0),
      count: bienes.length,
    },
  })
})

export default router
