import { Router } from 'express'
import { db, inTransaction } from '../db.ts'
import { SALDO_FACTURA } from '../facturas.ts'
import { tableroDe } from '../tablero.ts'
import { contraparteInput, contrapartePatch } from '../validators.ts'
import type { Contraparte } from '../../shared/types.ts'

const router = Router()

// Los saldos salen del mismo SQL que las facturas —`SALDO_FACTURA`, importado
// y no copiado— contra los movimientos ligados. Una columna `saldo` guardada
// aquí envejecería en cuanto alguien anule un cobro, y una copia del SQL
// envejecería en cuanto lo cobrable cambie de definición, que es justo lo que
// pasó con las retenciones.
const SELECT = `
  SELECT c.*,
    (SELECT COUNT(*) FROM transactions t WHERE t.counterparty_id = c.id) AS tx_count,
    (SELECT COUNT(*) FROM invoices f WHERE f.counterparty_id = c.id) AS invoice_count,
    COALESCE((SELECT SUM(${SALDO_FACTURA})
      FROM invoices f
      WHERE f.counterparty_id = c.id AND f.status = 'abierta' AND f.direction = 'emitida'), 0)
      AS por_cobrar,
    COALESCE((SELECT SUM(${SALDO_FACTURA})
      FROM invoices f
      WHERE f.counterparty_id = c.id AND f.status = 'abierta' AND f.direction = 'recibida'), 0)
      AS por_pagar,
    COALESCE((SELECT SUM(t.amount_cents) FROM transactions t
      WHERE t.counterparty_id = c.id AND t.type = 'ingreso' AND t.invoice_id IS NULL
        AND t.debt_id IS NULL AND t.investment_entry_id IS NULL AND t.goal_entry_id IS NULL), 0)
      AS anticipos
  FROM counterparties c
`

function mapContraparte(row: any): Contraparte {
  const porCobrarCents = row.por_cobrar ?? 0
  const creditLimitCents = row.credit_limit_cents ?? null
  return {
    id: row.id,
    profileId: row.profile_id,
    name: row.name,
    role: row.role,
    taxId: row.tax_id,
    note: row.note,
    contact: row.contact ?? '',
    creditDays: row.credit_days ?? null,
    creditLimitCents,
    archived: row.archived === 1,
    txCount: row.tx_count ?? 0,
    invoiceCount: row.invoice_count ?? 0,
    porCobrarCents,
    porPagarCents: row.por_pagar ?? 0,
    anticiposCents: row.anticipos ?? 0,
    // Derivado, como todo lo demás de aquí: subir el límite deja de avisar sin
    // que nadie tenga que recalcular una bandera.
    sobreLimite: creditLimitCents !== null && porCobrarCents > creditLimitCents,
  }
}

/**
 * Todo de una contraparte en una hoja (Fase 19). Va antes que `/:id` de
 * escritura por orden de lectura, y es de solo lectura: no guarda nada.
 */
router.get('/:id/tablero', (req, res) => {
  const profileId = Number(req.query.profileId)
  if (!Number.isInteger(profileId) || profileId <= 0) {
    return res.status(400).json({ error: 'Falta profileId' })
  }
  const hoy = typeof req.query.hoy === 'string' ? req.query.hoy : undefined
  res.json(tableroDe(profileId, Number(req.params.id), hoy))
})

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
      `INSERT INTO counterparties
        (profile_id, name, role, tax_id, note, contact, credit_days, credit_limit_cents)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.profileId,
      input.name,
      input.role,
      input.taxId,
      input.note,
      input.contact,
      input.creditDays ?? null,
      input.creditLimitCents ?? null,
    )
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
  // `null` explícito borra el dato; ausente lo deja como estaba. Es el mismo
  // trato que reciben el corte y el límite de una tarjeta.
  db.prepare(
    `UPDATE counterparties SET name = ?, role = ?, tax_id = ?, note = ?, contact = ?,
       credit_days = ?, credit_limit_cents = ?, archived = ?
     WHERE id = ?`,
  ).run(
    input.name ?? existing.name,
    input.role ?? existing.role,
    input.taxId ?? existing.tax_id,
    input.note ?? existing.note,
    input.contact ?? existing.contact,
    input.creditDays === undefined ? existing.credit_days : input.creditDays,
    input.creditLimitCents === undefined ? existing.credit_limit_cents : input.creditLimitCents,
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
