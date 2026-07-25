import { Router } from 'express'
import { db, accountsWithBalance, mapAccount } from '../db.ts'
import { accountInput, accountPatch } from '../validators.ts'

const router = Router()

router.get('/', (req, res) => {
  const profileId = Number(req.query.profileId)
  if (!Number.isInteger(profileId) || profileId <= 0) {
    return res.status(400).json({ error: 'Falta profileId' })
  }
  res.json(accountsWithBalance(profileId).map(mapAccount))
})

router.post('/', (req, res) => {
  const input = accountInput.parse(req.body)
  const result = db
    .prepare(
      'INSERT INTO accounts (profile_id, name, type, currency, opening_cents) VALUES (?, ?, ?, ?, ?)',
    )
    .run(input.profileId, input.name, input.type, input.currency, input.openingCents)
  const rows = accountsWithBalance(input.profileId).map(mapAccount)
  const created = rows.find((a) => a.id === Number(result.lastInsertRowid))
  res.status(201).json(created)
})

router.patch('/:id', (req, res) => {
  const id = Number(req.params.id)
  const input = accountPatch.parse(req.body)
  const existing: any = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id)
  if (!existing) return res.status(404).json({ error: 'Cuenta no encontrada' })
  db.prepare(
    'UPDATE accounts SET name = ?, type = ?, currency = ?, opening_cents = ?, archived = ? WHERE id = ?',
  ).run(
    input.name ?? existing.name,
    input.type ?? existing.type,
    input.currency ?? existing.currency,
    input.openingCents ?? existing.opening_cents,
    input.archived === undefined ? existing.archived : input.archived ? 1 : 0,
    id,
  )
  const rows = accountsWithBalance(existing.profile_id).map(mapAccount)
  res.json(rows.find((a) => a.id === id))
})

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id)
  const existing: any = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id)
  if (!existing) return res.status(404).json({ error: 'Cuenta no encontrada' })
  const usage: any = db
    .prepare(
      'SELECT COUNT(*) AS n FROM transactions WHERE account_id = ? OR transfer_account_id = ?',
    )
    .get(id, id)
  if (usage.n > 0) {
    return res.status(409).json({
      error: 'La cuenta tiene movimientos registrados. Archívala en su lugar.',
    })
  }
  db.prepare('DELETE FROM accounts WHERE id = ?').run(id)
  res.json({ ok: true })
})

export default router
