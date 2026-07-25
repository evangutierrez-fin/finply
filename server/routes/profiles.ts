import { Router } from 'express'
import { db, inTransaction, mapProfile, seedCategories } from '../db.ts'
import { profileInput, profilePatch } from '../validators.ts'

const router = Router()

router.get('/', (_req, res) => {
  const rows = db.prepare('SELECT * FROM profiles ORDER BY created_at ASC, id ASC').all()
  res.json(rows.map(mapProfile))
})

router.post('/', (req, res) => {
  const input = profileInput.parse(req.body)
  const result = db
    .prepare('INSERT INTO profiles (name, kind, accent) VALUES (?, ?, ?)')
    .run(input.name, input.kind, input.accent)
  const id = Number(result.lastInsertRowid)
  seedCategories(id, input.kind)
  const row = db.prepare('SELECT * FROM profiles WHERE id = ?').get(id)
  res.status(201).json(mapProfile(row))
})

router.patch('/:id', (req, res) => {
  const id = Number(req.params.id)
  const input = profilePatch.parse(req.body)
  const existing: any = db.prepare('SELECT * FROM profiles WHERE id = ?').get(id)
  if (!existing) return res.status(404).json({ error: 'Perfil no encontrado' })
  db.prepare('UPDATE profiles SET name = ?, kind = ?, accent = ? WHERE id = ?').run(
    input.name ?? existing.name,
    input.kind ?? existing.kind,
    input.accent ?? existing.accent,
    id,
  )
  const row = db.prepare('SELECT * FROM profiles WHERE id = ?').get(id)
  res.json(mapProfile(row))
})

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id)
  const existing = db.prepare('SELECT id FROM profiles WHERE id = ?').get(id)
  if (!existing) return res.status(404).json({ error: 'Perfil no encontrado' })
  // Borrado en orden explícito (hijos antes que padres): el orden de las
  // cascadas de SQLite no está garantizado entre versiones.
  inTransaction(() => {
    db.prepare('DELETE FROM transactions WHERE profile_id = ?').run(id)
    db.prepare(
      'DELETE FROM debt_payments WHERE debt_id IN (SELECT id FROM debts WHERE profile_id = ?)',
    ).run(id)
    db.prepare('DELETE FROM debts WHERE profile_id = ?').run(id)
    db.prepare(
      'DELETE FROM investment_entries WHERE investment_id IN (SELECT id FROM investments WHERE profile_id = ?)',
    ).run(id)
    db.prepare('DELETE FROM investments WHERE profile_id = ?').run(id)
    db.prepare(
      'DELETE FROM goal_entries WHERE goal_id IN (SELECT id FROM goals WHERE profile_id = ?)',
    ).run(id)
    db.prepare('DELETE FROM goals WHERE profile_id = ?').run(id)
    db.prepare('DELETE FROM budgets WHERE profile_id = ?').run(id)
    db.prepare('DELETE FROM notes WHERE profile_id = ?').run(id)
    db.prepare('DELETE FROM categories WHERE profile_id = ?').run(id)
    db.prepare('DELETE FROM accounts WHERE profile_id = ?').run(id)
    db.prepare('DELETE FROM profiles WHERE id = ?').run(id)
  })
  res.json({ ok: true })
})

export default router
