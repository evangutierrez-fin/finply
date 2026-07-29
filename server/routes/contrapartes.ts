import { Router } from 'express'
import { db, inTransaction } from '../db.ts'
import { contraparteInput, contrapartePatch } from '../validators.ts'

const router = Router()

// Los saldos salen del mismo SQL que las facturas: total menos lo cobrado,
// contado contra los movimientos ligados. Una columna `saldo` guardada aquí
// envejecería en cuanto alguien anule un cobro.
const SELECT = `
  SELECT c.*,
    (SELECT COUNT(*) FROM transactions t WHERE t.counterparty_id = c.id) AS tx_count,
    (SELECT COUNT(*) FROM invoices f WHERE f.counterparty_id = c.id) AS invoice_count,
    COALESCE((SELECT SUM(MAX(0, f.subtotal_cents + f.tax_cents
      - COALESCE((SELECT SUM(t.amount_cents) FROM transactions t WHERE t.invoice_id = f.id), 0)))
      FROM invoices f
      WHERE f.counterparty_id = c.id AND f.status = 'abierta' AND f.direction = 'emitida'), 0)
      AS por_cobrar,
    COALESCE((SELECT SUM(MAX(0, f.subtotal_cents + f.tax_cents
      - COALESCE((SELECT SUM(t.amount_cents) FROM transactions t WHERE t.invoice_id = f.id), 0)))
      FROM invoices f
      WHERE f.counterparty_id = c.id AND f.status = 'abierta' AND f.direction = 'recibida'), 0)
      AS por_pagar
  FROM counterparties c
`

function mapContraparte(row: any) {
  return {
    id: row.id,
    profileId: row.profile_id,
    name: row.name,
    role: row.role,
    taxId: row.tax_id,
    note: row.note,
    archived: row.archived === 1,
    txCount: row.tx_count ?? 0,
    invoiceCount: row.invoice_count ?? 0,
    porCobrarCents: row.por_cobrar ?? 0,
    porPagarCents: row.por_pagar ?? 0,
  }
}

router.get('/', (req, res) => {
  const profileId = Number(req.query.profileId)
  if (!Number.isInteger(profileId) || profileId <= 0) {
    return res.status(400).json({ error: 'Falta profileId' })
  }
  const rows = db
    .prepare(`${SELECT} WHERE c.profile_id = ? ORDER BY c.archived ASC, c.name ASC`)
    .all(profileId)
  res.json(rows.map(mapContraparte))
})

router.post('/', (req, res) => {
  const input = contraparteInput.parse(req.body)
  const existe = db
    .prepare('SELECT id FROM counterparties WHERE profile_id = ? AND name = ?')
    .get(input.profileId, input.name)
  if (existe) return res.status(409).json({ error: 'Ya hay una contraparte con ese nombre' })
  const result = db
    .prepare(
      'INSERT INTO counterparties (profile_id, name, role, tax_id, note) VALUES (?, ?, ?, ?, ?)',
    )
    .run(input.profileId, input.name, input.role, input.taxId, input.note)
  res.status(201).json(mapContraparte(db.prepare(`${SELECT} WHERE c.id = ?`).get(result.lastInsertRowid)))
})

router.patch('/:id', (req, res) => {
  const id = Number(req.params.id)
  const existing: any = db.prepare('SELECT * FROM counterparties WHERE id = ?').get(id)
  if (!existing) return res.status(404).json({ error: 'Contraparte no encontrada' })
  const input = contrapartePatch.parse(req.body)
  if (input.name && input.name !== existing.name) {
    const choque = db
      .prepare('SELECT id FROM counterparties WHERE profile_id = ? AND name = ? AND id != ?')
      .get(existing.profile_id, input.name, id)
    if (choque) return res.status(409).json({ error: 'Ya hay una contraparte con ese nombre' })
  }
  db.prepare(
    'UPDATE counterparties SET name = ?, role = ?, tax_id = ?, note = ?, archived = ? WHERE id = ?',
  ).run(
    input.name ?? existing.name,
    input.role ?? existing.role,
    input.taxId ?? existing.tax_id,
    input.note ?? existing.note,
    input.archived === undefined ? existing.archived : input.archived ? 1 : 0,
    id,
  )
  res.json(mapContraparte(db.prepare(`${SELECT} WHERE c.id = ?`).get(id)))
})

/**
 * Borrar arrastra sus facturas, así que solo se permite cuando no tiene
 * ninguna. Con facturas, lo que corresponde es archivarla: el mismo trato que
 * recibe una cuenta con movimientos, y por la misma razón — el libro no se
 * reescribe hacia atrás.
 */
router.delete('/:id', (req, res) => {
  const id = Number(req.params.id)
  const existing: any = db.prepare('SELECT * FROM counterparties WHERE id = ?').get(id)
  if (!existing) return res.status(404).json({ error: 'Contraparte no encontrada' })
  const facturas: any = db
    .prepare('SELECT COUNT(*) AS n FROM invoices WHERE counterparty_id = ?')
    .get(id)
  if (facturas.n > 0) {
    return res.status(409).json({
      error: `Tiene ${facturas.n} factura(s). Archívala en vez de borrarla para no perder su historial.`,
    })
  }
  inTransaction(() => {
    // Los movimientos que la mencionaban se quedan; solo pierden la referencia.
    db.prepare('UPDATE transactions SET counterparty_id = NULL WHERE counterparty_id = ?').run(id)
    db.prepare('DELETE FROM counterparties WHERE id = ?').run(id)
  })
  res.json({ ok: true })
})

export default router
