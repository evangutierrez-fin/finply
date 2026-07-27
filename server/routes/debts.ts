import { Router } from 'express'
import {
  db, debtBalance, ensureAccount, inTransaction, mapDebt, refreshDebtStatus,
} from '../db.ts'
import { interesDevengado, tablaAmortizacion } from '../../shared/credito.ts'
import { debtInput, debtPatch, paymentInput } from '../validators.ts'

const router = Router()

const DEBT_SELECT = `
  SELECT d.*,
    COALESCE((SELECT SUM(p.amount_cents) FROM debt_payments p WHERE p.debt_id = d.id), 0)
      AS paid_cents,
    COALESCE((SELECT SUM(p.interest_cents) FROM debt_payments p WHERE p.debt_id = d.id), 0)
      AS interest_paid_cents,
    COALESCE((SELECT SUM(p.amount_cents - p.interest_cents) FROM debt_payments p
      WHERE p.debt_id = d.id), 0) AS capital_paid_cents
  FROM debts d
`

function mapPayment(row: any) {
  return {
    id: row.id,
    debtId: row.debt_id,
    amountCents: row.amount_cents,
    date: row.date,
    note: row.note,
    interestCents: row.interest_cents ?? 0,
    capitalCents: row.amount_cents - (row.interest_cents ?? 0),
  }
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

// Apuntar una deuda. Si trae cuenta, también se asienta el desembolso: entra
// dinero si te prestaron (por_pagar), sale si prestaste tú (por_cobrar). Sin
// cuenta, la deuda queda como pura obligación y el libro no se mueve — que es
// lo correcto cuando el dinero nunca pasó por una de tus cuentas.
router.post('/', (req, res) => {
  const input = debtInput.parse(req.body)
  if (input.accountId) ensureAccount(input.profileId, input.accountId)
  if (input.downPaymentAccountId) ensureAccount(input.profileId, input.downPaymentAccountId)
  if (input.downPaymentAccountId && input.downPaymentCents === 0) {
    return res.status(400).json({ error: 'Elegiste cuenta para el enganche pero no su monto' })
  }

  const id = inTransaction(() => {
    const result = db
      .prepare(
        `INSERT INTO debts (profile_id, direction, counterparty, concept, principal_cents,
          start_date, due_date, annual_rate_bp, term_months, down_payment_cents)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.profileId,
        input.direction,
        input.counterparty,
        input.concept,
        input.principalCents,
        input.startDate,
        input.dueDate ?? null,
        input.annualRateBp,
        input.termMonths ?? null,
        input.downPaymentCents,
      )
    const debtId = Number(result.lastInsertRowid)

    // Sin categoría a propósito: un préstamo no es un gasto ni un ingreso de
    // los que se presupuestan, y forzarle una categoría ensuciaría el reporte
    // por categoría del mes.
    const asentar = (
      accountId: number,
      tipo: 'ingreso' | 'gasto',
      cents: number,
      nota: string,
      rol: 'desembolso' | 'enganche',
    ) =>
      db
        .prepare(
          `INSERT INTO transactions
            (profile_id, account_id, type, amount_cents, date, note, debt_id, debt_role)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(input.profileId, accountId, tipo, cents, input.startDate, nota, debtId, rol)

    const entraElPrestamo = input.direction === 'por_pagar'
    if (input.accountId) {
      asentar(
        input.accountId,
        entraElPrestamo ? 'ingreso' : 'gasto',
        input.principalCents,
        input.concept || `Préstamo · ${input.counterparty}`,
        'desembolso',
      )
    }
    // El enganche va al revés que el desembolso: si te prestaron, lo pones tú.
    if (input.downPaymentAccountId && input.downPaymentCents > 0) {
      asentar(
        input.downPaymentAccountId,
        entraElPrestamo ? 'gasto' : 'ingreso',
        input.downPaymentCents,
        `Enganche · ${input.counterparty}`,
        'enganche',
      )
    }
    return debtId
  })

  res.status(201).json(debtWithPayments(id))
})

/**
 * El plan de pagos: cuánto de cada mensualidad es interés y cuánto capital.
 * Se calcula sobre el principal original desde la fecha de inicio —es el plan,
 * no el historial—; los abonos reales viven en `payments`.
 */
router.get('/:id/amortizacion', (req, res) => {
  const id = Number(req.params.id)
  const debt: any = db.prepare('SELECT * FROM debts WHERE id = ?').get(id)
  if (!debt) return res.status(404).json({ error: 'Deuda no encontrada' })
  if (!debt.term_months) {
    return res.status(400).json({
      error: 'Esta deuda no tiene plazo. Ponle un plazo en meses para ver la tabla de pagos.',
    })
  }
  const tabla = tablaAmortizacion({
    principalCents: debt.principal_cents,
    annualRateBp: debt.annual_rate_bp,
    termMonths: debt.term_months,
    startDate: debt.start_date,
  })
  res.json({ debtId: id, ...tabla })
})

router.patch('/:id', (req, res) => {
  const id = Number(req.params.id)
  const existing: any = db.prepare('SELECT * FROM debts WHERE id = ?').get(id)
  if (!existing) return res.status(404).json({ error: 'Deuda no encontrada' })
  const input = debtPatch.parse(req.body)
  inTransaction(() => {
    db.prepare(
      `UPDATE debts SET direction = ?, counterparty = ?, concept = ?, principal_cents = ?,
        start_date = ?, due_date = ?, annual_rate_bp = ?, term_months = ?,
        down_payment_cents = ? WHERE id = ?`,
    ).run(
      input.direction ?? existing.direction,
      input.counterparty ?? existing.counterparty,
      input.concept ?? existing.concept,
      input.principalCents ?? existing.principal_cents,
      input.startDate ?? existing.start_date,
      input.dueDate === undefined ? existing.due_date : input.dueDate,
      input.annualRateBp ?? existing.annual_rate_bp,
      // Ausente lo deja como estaba; `null` explícito quita el plazo.
      input.termMonths === undefined ? existing.term_months : input.termMonths,
      input.downPaymentCents ?? existing.down_payment_cents,
      id,
    )
    // El estado siempre se deriva de los abonos: cambiar el principal puede
    // saldar la deuda (o reabrirla) sin que se haya tocado un solo abono.
    refreshDebtStatus(id)
  })
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
  // Cuánto del abono se va en intereses. Se propone con el interés devengado
  // desde el abono anterior sobre el saldo insoluto; si el usuario mandó el
  // dato de su estado de cuenta, ese manda. Nunca más que el propio abono:
  // el capital no puede ser negativo.
  const anterior: any = db
    .prepare('SELECT MAX(date) AS fecha FROM debt_payments WHERE debt_id = ? AND date <= ?')
    .get(id, input.date)
  const interes = Math.min(
    input.interestCents ??
      interesDevengado(
        debtBalance(id),
        debt.annual_rate_bp,
        anterior?.fecha ?? debt.start_date,
        input.date,
      ),
    input.amountCents,
  )

  inTransaction(() => {
    const payment = db
      .prepare(
        `INSERT INTO debt_payments (debt_id, amount_cents, date, note, interest_cents)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, input.amountCents, input.date, input.note, interes)
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
