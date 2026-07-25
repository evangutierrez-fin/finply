import { Router } from 'express'
import { db, inTransaction, mapDebt, refreshDebtStatus } from '../db.ts'
import { debtInput, debtPatch, paymentInput } from '../validators.ts'

const router = Router()

const DEBT_SELECT = `
  SELECT d.*, COALESCE((SELECT SUM(p.amount_cents) FROM debt_payments p WHERE p.debt_id = d.id), 0) AS paid_cents
  FROM debts d
`

function mapPayment(row: any) {
  return { id: row.id, debtId: row.debt_id, amountCents: row.amount_cents, date: row.date, note: row.note }
}

function debtWithPayments(id: number) {
  const row: any = db.prepare(`${DEBT_SELECT} WHERE d.id = ?`).get(id)
  if (!row) return null
  const debt = mapDebt(row)
  debt.payments = db
    .prepare('SELECT * FROM debt_payments WHERE debt_id = ? ORDER BY date DESC, id DESC')
    .all(id)
    .map(mapPayment)
  return debt
}

router.get('/', (req, res) => {
  const profileId = Number(req.query.profileId)
  if (!Number.isInteger(profileId) || profileId <= 0) {
    return res.status(400).json({ error: 'Falta profileId' })
  }
  const rows: any[] = db
    .prepare(
      `${DEBT_SELECT} WHERE d.profile_id = ?
       ORDER BY CASE d.status WHEN 'abierta' THEN 0 ELSE 1 END, COALESCE(d.due_date, '9999-12-31') ASC, d.id DESC`,
    )
    .all(profileId)
  const debts = rows.map(mapDebt)
  const ids = debts.map((d) => d.id)
  if (ids.length > 0) {
    const payments: any[] = db
      .prepare(
        `SELECT * FROM debt_payments WHERE debt_id IN (${ids.map(() => '?').join(',')})
         ORDER BY date DESC, id DESC`,
      )
      .all(...ids)
    const byDebt = new Map<number, any[]>()
    for (const p of payments) {
      const list = byDebt.get(p.debt_id) ?? []
      list.push(mapPayment(p))
      byDebt.set(p.debt_id, list)
    }
    for (const d of debts) d.payments = byDebt.get(d.id) ?? []
  }
  res.json(debts)
})

router.post('/', (req, res) => {
  const input = debtInput.parse(req.body)
  const result = db
    .prepare(
      `INSERT INTO debts (profile_id, direction, counterparty, concept, principal_cents, start_date, due_date)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.profileId,
      input.direction,
      input.counterparty,
      input.concept,
      input.principalCents,
      input.startDate,
      input.dueDate ?? null,
    )
  res.status(201).json(debtWithPayments(Number(result.lastInsertRowid)))
})

router.patch('/:id', (req, res) => {
  const id = Number(req.params.id)
  const existing: any = db.prepare('SELECT * FROM debts WHERE id = ?').get(id)
  if (!existing) return res.status(404).json({ error: 'Deuda no encontrada' })
  const input = debtPatch.parse(req.body)
  db.prepare(
    `UPDATE debts SET direction = ?, counterparty = ?, concept = ?, principal_cents = ?,
      start_date = ?, due_date = ?, status = ? WHERE id = ?`,
  ).run(
    input.direction ?? existing.direction,
    input.counterparty ?? existing.counterparty,
    input.concept ?? existing.concept,
    input.principalCents ?? existing.principal_cents,
    input.startDate ?? existing.start_date,
    input.dueDate === undefined ? existing.due_date : input.dueDate,
    input.status ?? existing.status,
    id,
  )
  res.json(debtWithPayments(id))
})

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id)
  const result = db.prepare('DELETE FROM debts WHERE id = ?').run(id)
  if (result.changes === 0) return res.status(404).json({ error: 'Deuda no encontrada' })
  res.json({ ok: true })
})

// Registrar un abono. Si trae cuenta, también se asienta el movimiento en el libro:
// entra dinero si te deben (por_cobrar), sale dinero si debes (por_pagar).
router.post('/:id/payments', (req, res) => {
  const id = Number(req.params.id)
  const debt: any = db.prepare('SELECT * FROM debts WHERE id = ?').get(id)
  if (!debt) return res.status(404).json({ error: 'Deuda no encontrada' })
  const input = paymentInput.parse(req.body)
  if (input.accountId) {
    const account = db
      .prepare('SELECT id FROM accounts WHERE id = ? AND profile_id = ?')
      .get(input.accountId, debt.profile_id)
    if (!account) return res.status(400).json({ error: 'La cuenta no pertenece a este perfil' })
  }
  inTransaction(() => {
    const payment = db
      .prepare('INSERT INTO debt_payments (debt_id, amount_cents, date, note) VALUES (?, ?, ?, ?)')
      .run(id, input.amountCents, input.date, input.note)
    if (input.accountId) {
      const txType = debt.direction === 'por_cobrar' ? 'ingreso' : 'gasto'
      const note = input.note || `Abono · ${debt.counterparty}`
      db.prepare(
        `INSERT INTO transactions (profile_id, account_id, type, amount_cents, date, note, debt_payment_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        debt.profile_id,
        input.accountId,
        txType,
        input.amountCents,
        input.date,
        note,
        Number(payment.lastInsertRowid),
      )
    }
    refreshDebtStatus(id)
  })
  res.status(201).json(debtWithPayments(id))
})

router.delete('/payments/:paymentId', (req, res) => {
  const paymentId = Number(req.params.paymentId)
  const payment: any = db.prepare('SELECT * FROM debt_payments WHERE id = ?').get(paymentId)
  if (!payment) return res.status(404).json({ error: 'Abono no encontrado' })
  inTransaction(() => {
    db.prepare('DELETE FROM transactions WHERE debt_payment_id = ?').run(paymentId)
    db.prepare('DELETE FROM debt_payments WHERE id = ?').run(paymentId)
    refreshDebtStatus(payment.debt_id)
  })
  res.json(debtWithPayments(payment.debt_id))
})

export default router
