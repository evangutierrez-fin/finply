import { Router } from 'express'
import { db, inTransaction, getTx, mapTx, refreshDebtStatus, TX_SELECT } from '../db.ts'
import { txInput, txQuery } from '../validators.ts'

const router = Router()

function ensureAccount(profileId: number, accountId: number): void {
  const row = db
    .prepare('SELECT id FROM accounts WHERE id = ? AND profile_id = ?')
    .get(accountId, profileId)
  if (!row) throw Object.assign(new Error('La cuenta no pertenece a este perfil'), { status: 400 })
}

router.get('/', (req, res) => {
  const query = txQuery.parse(req.query)
  const clauses = ['t.profile_id = ?']
  const params: (string | number)[] = [query.profileId]
  if (query.month) {
    clauses.push('substr(t.date, 1, 7) = ?')
    params.push(query.month)
  }
  if (query.accountId) {
    clauses.push('(t.account_id = ? OR t.transfer_account_id = ?)')
    params.push(query.accountId, query.accountId)
  }
  if (query.type) {
    clauses.push('t.type = ?')
    params.push(query.type)
  }
  if (query.q) {
    clauses.push('(t.note LIKE ? OR c.name LIKE ? OR a.name LIKE ?)')
    const like = `%${query.q}%`
    params.push(like, like, like)
  }
  const rows = db
    .prepare(
      `${TX_SELECT} WHERE ${clauses.join(' AND ')} ORDER BY t.date DESC, t.id DESC LIMIT ?`,
    )
    .all(...params, query.limit)
  res.json(rows.map(mapTx))
})

router.post('/', (req, res) => {
  const input = txInput.parse(req.body)
  ensureAccount(input.profileId, input.accountId)
  if (input.transferAccountId) ensureAccount(input.profileId, input.transferAccountId)
  const result = db
    .prepare(
      `INSERT INTO transactions
        (profile_id, account_id, type, amount_cents, date, category_id, note, transfer_account_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.profileId,
      input.accountId,
      input.type,
      input.amountCents,
      input.date,
      input.type === 'transferencia' ? null : (input.categoryId ?? null),
      input.note,
      input.type === 'transferencia' ? (input.transferAccountId ?? null) : null,
    )
  res.status(201).json(mapTx(getTx(Number(result.lastInsertRowid))))
})

router.patch('/:id', (req, res) => {
  const id = Number(req.params.id)
  const existing: any = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id)
  if (!existing) return res.status(404).json({ error: 'Movimiento no encontrado' })
  const input = txInput.parse(req.body)
  const linked = existing.debt_payment_id || existing.investment_entry_id
  if (linked && input.type !== existing.type) {
    return res.status(400).json({
      error: 'Este movimiento está ligado a una deuda o inversión; su tipo no puede cambiar',
    })
  }
  ensureAccount(input.profileId, input.accountId)
  if (input.transferAccountId) ensureAccount(input.profileId, input.transferAccountId)
  // Monto y fecha se sincronizan con el abono o aporte ligado,
  // para que el libro y la deuda/inversión sigan cuadrando.
  inTransaction(() => {
    db.prepare(
      `UPDATE transactions SET account_id = ?, type = ?, amount_cents = ?, date = ?,
        category_id = ?, note = ?, transfer_account_id = ? WHERE id = ?`,
    ).run(
      input.accountId,
      input.type,
      input.amountCents,
      input.date,
      input.type === 'transferencia' ? null : (input.categoryId ?? null),
      input.note,
      input.type === 'transferencia' ? (input.transferAccountId ?? null) : null,
      id,
    )
    if (existing.debt_payment_id) {
      db.prepare('UPDATE debt_payments SET amount_cents = ?, date = ? WHERE id = ?').run(
        input.amountCents,
        input.date,
        existing.debt_payment_id,
      )
      const payment: any = db
        .prepare('SELECT debt_id FROM debt_payments WHERE id = ?')
        .get(existing.debt_payment_id)
      if (payment) refreshDebtStatus(payment.debt_id)
    }
    if (existing.investment_entry_id) {
      db.prepare('UPDATE investment_entries SET amount_cents = ?, date = ? WHERE id = ?').run(
        input.amountCents,
        input.date,
        existing.investment_entry_id,
      )
    }
  })
  res.json(mapTx(getTx(id)))
})

router.delete('/:id', (req, res) => {
  const existing: any = db
    .prepare('SELECT * FROM transactions WHERE id = ?')
    .get(Number(req.params.id))
  if (!existing) return res.status(404).json({ error: 'Movimiento no encontrado' })
  inTransaction(() => {
    db.prepare('DELETE FROM transactions WHERE id = ?').run(existing.id)
    // Si el movimiento era el registro de un abono o de una inversión, ese
    // registro también se elimina para que el libro siga cuadrando.
    if (existing.debt_payment_id) {
      const payment: any = db
        .prepare('SELECT * FROM debt_payments WHERE id = ?')
        .get(existing.debt_payment_id)
      if (payment) {
        db.prepare('DELETE FROM debt_payments WHERE id = ?').run(payment.id)
        refreshDebtStatus(payment.debt_id)
      }
    }
    if (existing.investment_entry_id) {
      db.prepare('DELETE FROM investment_entries WHERE id = ?').run(existing.investment_entry_id)
    }
  })
  res.json({ ok: true })
})

export default router
