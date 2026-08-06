import { Router } from 'express'
import { db, httpError, inTransaction } from '../db.ts'
import { bienPorId, listarBienes } from '../bienes.ts'
import { bienInput, bienPatch, valuacionInput, bienQuery } from '../validators.ts'

const router = Router()

/** La deuda que financia el bien tiene que ser del mismo perfil. */
function ensureDeuda(profileId: number, debtId: number | null | undefined): void {
  if (!debtId) return
  const row = db
    .prepare('SELECT id FROM debts WHERE id = ? AND profile_id = ?')
    .get(debtId, profileId)
  if (!row) throw httpError(400, 'Esa deuda no pertenece a este perfil')
}

router.get('/', (req, res) => {
  const { profileId, hoy } = bienQuery.parse(req.query)
  res.json(listarBienes(profileId, hoy))
})

router.post('/', (req, res) => {
  const input = bienInput.parse(req.body)
  ensureDeuda(input.profileId, input.debtId)
  const result = db
    .prepare(
      `INSERT INTO assets (profile_id, name, kind, cost_cents, acquired_date, debt_id, note)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.profileId,
      input.name,
      input.kind,
      input.costCents,
      input.acquiredDate,
      input.debtId ?? null,
      input.note,
    )
  res.status(201).json(bienPorId(Number(result.lastInsertRowid)))
})

router.patch('/:id', (req, res) => {
  const id = Number(req.params.id)
  const existing: any = db.prepare('SELECT * FROM assets WHERE id = ?').get(id)
  if (!existing) return res.status(404).json({ error: 'Bien no encontrado' })
  const input = bienPatch.parse(req.body)
  if (input.debtId !== undefined) ensureDeuda(existing.profile_id, input.debtId)
  db.prepare(
    `UPDATE assets SET name = ?, kind = ?, cost_cents = ?, acquired_date = ?,
      debt_id = ?, note = ?, archived = ? WHERE id = ?`,
  ).run(
    input.name ?? existing.name,
    input.kind ?? existing.kind,
    input.costCents ?? existing.cost_cents,
    input.acquiredDate ?? existing.acquired_date,
    // `null` explícito desliga la deuda; ausente la deja como estaba.
    input.debtId === undefined ? existing.debt_id : input.debtId,
    input.note ?? existing.note,
    input.archived === undefined ? existing.archived : input.archived ? 1 : 0,
    id,
  )
  res.json(bienPorId(id))
})

router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM assets WHERE id = ?').run(Number(req.params.id))
  if (Number(result.changes) === 0) return res.status(404).json({ error: 'Bien no encontrado' })
  res.json({ ok: true })
})

/**
 * Declarar cuánto vale hoy. Repetir la misma fecha **corrige** en vez de
 * apilar: quien vuelve a escribir el valor del mismo día está arreglando un
 * dedazo, no declarando dos valores del mismo bien.
 */
router.post('/:id/valuaciones', (req, res) => {
  const id = Number(req.params.id)
  const bien: any = db.prepare('SELECT * FROM assets WHERE id = ?').get(id)
  if (!bien) return res.status(404).json({ error: 'Bien no encontrado' })
  const input = valuacionInput.parse(req.body)
  inTransaction(() => {
    db.prepare('DELETE FROM asset_valuations WHERE asset_id = ? AND date = ?').run(id, input.date)
    db.prepare(
      'INSERT INTO asset_valuations (asset_id, date, value_cents, note) VALUES (?, ?, ?, ?)',
    ).run(id, input.date, input.valueCents, input.note)
  })
  res.status(201).json(bienPorId(id))
})

router.delete('/valuaciones/:valuacionId', (req, res) => {
  const fila: any = db
    .prepare('SELECT * FROM asset_valuations WHERE id = ?')
    .get(Number(req.params.valuacionId))
  if (!fila) return res.status(404).json({ error: 'Valuación no encontrada' })
  db.prepare('DELETE FROM asset_valuations WHERE id = ?').run(fila.id)
  res.json(bienPorId(fila.asset_id))
})

export default router
