import { Router } from 'express'
import { db, inTransaction, investmentsWithTotals } from '../db.ts'
import { investmentInput, investmentPatch, investmentEntryInput } from '../validators.ts'

const router = Router()

function one(profileId: number, id: number) {
  return investmentsWithTotals(profileId).find((i) => i.id === id) ?? null
}

router.get('/', (req, res) => {
  const profileId = Number(req.query.profileId)
  if (!Number.isInteger(profileId) || profileId <= 0) {
    return res.status(400).json({ error: 'Falta profileId' })
  }
  res.json(investmentsWithTotals(profileId))
})

router.post('/', (req, res) => {
  const input = investmentInput.parse(req.body)
  const result = db
    .prepare('INSERT INTO investments (profile_id, name, kind, note) VALUES (?, ?, ?, ?)')
    .run(input.profileId, input.name, input.kind, input.note)
  res.status(201).json(one(input.profileId, Number(result.lastInsertRowid)))
})

router.patch('/:id', (req, res) => {
  const id = Number(req.params.id)
  const existing: any = db.prepare('SELECT * FROM investments WHERE id = ?').get(id)
  if (!existing) return res.status(404).json({ error: 'Inversión no encontrada' })
  const input = investmentPatch.parse(req.body)
  db.prepare('UPDATE investments SET name = ?, kind = ?, note = ?, archived = ? WHERE id = ?').run(
    input.name ?? existing.name,
    input.kind ?? existing.kind,
    input.note ?? existing.note,
    input.archived === undefined ? existing.archived : input.archived ? 1 : 0,
    id,
  )
  res.json(one(existing.profile_id, id))
})

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id)
  const existing: any = db.prepare('SELECT * FROM investments WHERE id = ?').get(id)
  if (!existing) return res.status(404).json({ error: 'Inversión no encontrada' })
  inTransaction(() => {
    // Los movimientos ligados a sus entradas quedan como registros normales.
    db.prepare(
      `UPDATE transactions SET investment_entry_id = NULL
       WHERE investment_entry_id IN (SELECT id FROM investment_entries WHERE investment_id = ?)`,
    ).run(id)
    db.prepare('DELETE FROM investments WHERE id = ?').run(id)
  })
  res.json({ ok: true })
})

// Registrar aporte, retiro o valuación. Aportes y retiros con cuenta
// asientan el movimiento correspondiente (gasto al aportar, ingreso al retirar).
router.post('/:id/entries', (req, res) => {
  const id = Number(req.params.id)
  const investment: any = db.prepare('SELECT * FROM investments WHERE id = ?').get(id)
  if (!investment) return res.status(404).json({ error: 'Inversión no encontrada' })
  const input = investmentEntryInput.parse(req.body)
  const porPrecio = input.type === 'valuacion' && input.unitPriceCents != null
  if (input.type !== 'valuacion' && input.amountCents === 0) {
    return res.status(400).json({ error: 'El monto debe ser mayor a cero' })
  }
  // Valuar por precio sin unidades registradas dejaría el valor en cero: el
  // precio de nada es nada. Se dice en vez de borrarle la cifra al usuario.
  if (porPrecio && (one(investment.profile_id, id)?.unitsE8 ?? 0) <= 0) {
    return res.status(400).json({
      error:
        'Esta inversión no tiene unidades registradas todavía. Valúa por monto, ' +
        'o apunta las unidades al aportar para poder valuarla por precio.',
    })
  }
  if (input.accountId && input.type !== 'valuacion') {
    const account = db
      .prepare('SELECT id FROM accounts WHERE id = ? AND profile_id = ?')
      .get(input.accountId, investment.profile_id)
    if (!account) return res.status(400).json({ error: 'La cuenta no pertenece a este perfil' })
  }
  inTransaction(() => {
    // Una valuación por precio guarda monto cero a propósito: el valor es
    // consecuencia del precio y de las unidades que haya en esa fecha, y se
    // recalcula al leer. Guardar además el resultado sería una segunda verdad
    // que envejece en cuanto aparezca un aporte con fecha anterior.
    const entry = db
      .prepare(
        `INSERT INTO investment_entries
           (investment_id, type, amount_cents, date, note, units_e8, unit_price_cents)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.type,
        porPrecio ? 0 : input.amountCents,
        input.date,
        input.note,
        input.unitsE8 ?? null,
        input.unitPriceCents ?? null,
      )
    if (input.accountId && input.type !== 'valuacion') {
      const txType = input.type === 'aporte' ? 'gasto' : 'ingreso'
      db.prepare('INSERT OR IGNORE INTO categories (profile_id, name, kind) VALUES (?, ?, ?)').run(
        investment.profile_id,
        'Inversiones',
        txType,
      )
      const category: any = db
        .prepare('SELECT id FROM categories WHERE profile_id = ? AND name = ? AND kind = ?')
        .get(investment.profile_id, 'Inversiones', txType)
      const note =
        input.note ||
        (input.type === 'aporte' ? `Aporte · ${investment.name}` : `Retiro · ${investment.name}`)
      db.prepare(
        `INSERT INTO transactions (profile_id, account_id, type, amount_cents, date, category_id, note, investment_entry_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        investment.profile_id,
        input.accountId,
        txType,
        input.amountCents,
        input.date,
        category?.id ?? null,
        note,
        Number(entry.lastInsertRowid),
      )
    }
  })
  res.status(201).json(one(investment.profile_id, id))
})

router.delete('/entries/:entryId', (req, res) => {
  const entryId = Number(req.params.entryId)
  const entry: any = db.prepare('SELECT * FROM investment_entries WHERE id = ?').get(entryId)
  if (!entry) return res.status(404).json({ error: 'Registro no encontrado' })
  const investment: any = db
    .prepare('SELECT * FROM investments WHERE id = ?')
    .get(entry.investment_id)
  inTransaction(() => {
    db.prepare('DELETE FROM transactions WHERE investment_entry_id = ?').run(entryId)
    db.prepare('DELETE FROM investment_entries WHERE id = ?').run(entryId)
  })
  res.json(one(investment.profile_id, investment.id))
})

export default router
