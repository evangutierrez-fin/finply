import { Router } from 'express'
import { db, ensureAccount, ensureCategory, httpError, inTransaction } from '../db.ts'
import { aging, facturaPorId, listarFacturas } from '../facturas.ts'
import { agingQuery, cobroInput, facturaInput, facturaPatch, facturaQuery } from '../validators.ts'

const router = Router()

function contraparteDe(profileId: number, counterpartyId: number) {
  const row: any = db
    .prepare('SELECT * FROM counterparties WHERE id = ? AND profile_id = ?')
    .get(counterpartyId, profileId)
  if (!row) throw httpError(400, 'La contraparte no pertenece a este perfil')
  return row
}

router.get('/', (req, res) => {
  const q = facturaQuery.parse(req.query)
  res.json(listarFacturas(q))
})

router.get('/aging', (req, res) => {
  const q = agingQuery.parse(req.query)
  res.json(aging(q.profileId, q.hoy))
})

router.post('/', (req, res) => {
  const input = facturaInput.parse(req.body)
  contraparteDe(input.profileId, input.counterpartyId)
  if (input.taxCents > input.subtotalCents * 10) {
    return res.status(400).json({ error: 'Ese impuesto no puede ser de este subtotal' })
  }
  if (input.costCenterId) {
    const centro = db
      .prepare('SELECT id FROM cost_centers WHERE id = ? AND profile_id = ?')
      .get(input.costCenterId, input.profileId)
    if (!centro) return res.status(400).json({ error: 'Ese centro no pertenece a este perfil' })
  }
  const result = db
    .prepare(
      `INSERT INTO invoices
        (profile_id, counterparty_id, direction, folio, concept, issue_date, due_date,
         subtotal_cents, tax_cents, cost_center_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.profileId,
      input.counterpartyId,
      input.direction,
      input.folio,
      input.concept,
      input.issueDate,
      input.dueDate ?? null,
      input.subtotalCents,
      input.taxCents,
      input.costCenterId ?? null,
    )
  res.status(201).json(facturaPorId(Number(result.lastInsertRowid)))
})

router.patch('/:id', (req, res) => {
  const id = Number(req.params.id)
  const existing: any = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id)
  if (!existing) return res.status(404).json({ error: 'Factura no encontrada' })
  const input = facturaPatch.parse(req.body)
  if (input.counterpartyId) contraparteDe(existing.profile_id, input.counterpartyId)
  db.prepare(
    `UPDATE invoices SET counterparty_id = ?, folio = ?, concept = ?, issue_date = ?,
       due_date = ?, subtotal_cents = ?, tax_cents = ?, status = ?, cost_center_id = ?
     WHERE id = ?`,
  ).run(
    input.counterpartyId ?? existing.counterparty_id,
    input.folio ?? existing.folio,
    input.concept ?? existing.concept,
    input.issueDate ?? existing.issue_date,
    input.dueDate === undefined ? existing.due_date : input.dueDate,
    input.subtotalCents ?? existing.subtotal_cents,
    input.taxCents ?? existing.tax_cents,
    input.status ?? existing.status,
    input.costCenterId === undefined ? existing.cost_center_id : input.costCenterId,
    id,
  )
  res.json(facturaPorId(id))
})

/**
 * Borrar una factura **no borra los cobros**: el dinero sí se movió y el libro
 * no se reescribe hacia atrás. Los movimientos se quedan y solo pierden la
 * liga, igual que pasa al borrar una inversión.
 */
router.delete('/:id', (req, res) => {
  const id = Number(req.params.id)
  const existing: any = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id)
  if (!existing) return res.status(404).json({ error: 'Factura no encontrada' })
  inTransaction(() => {
    db.prepare('UPDATE transactions SET invoice_id = NULL WHERE invoice_id = ?').run(id)
    db.prepare('DELETE FROM invoices WHERE id = ?').run(id)
  })
  res.json({ ok: true })
})

/**
 * El cobro (o el pago) de una factura: **aquí es donde nace el ingreso**.
 *
 * Emitir una factura no asienta nada —el libro es de flujo de efectivo—, así
 * que este movimiento es el único asiento de toda la operación. Se le pasa la
 * parte proporcional del impuesto: si cobras la mitad de la factura, trasladas
 * la mitad del IVA, que es lo que de verdad entró.
 */
router.post('/:id/cobros', (req, res) => {
  const id = Number(req.params.id)
  const factura = facturaPorId(id)
  if (!factura) return res.status(404).json({ error: 'Factura no encontrada' })
  if (factura.status === 'cancelada') {
    return res.status(400).json({ error: 'Esa factura está cancelada' })
  }
  const input = cobroInput.parse(req.body)
  ensureAccount(factura.profileId, input.accountId)

  if (input.amountCents > factura.saldoCents) {
    return res.status(400).json({
      error:
        `Eso es más de lo que falta de la factura (${(factura.saldoCents / 100).toFixed(2)}). ` +
        'Si hubo un recargo o un extra, regístralo como un movimiento aparte.',
    })
  }

  const txType = factura.direction === 'emitida' ? 'ingreso' : 'gasto'
  if (input.categoryId) ensureCategory(factura.profileId, input.categoryId, txType)

  // Impuesto proporcional a lo cobrado. Con el cobro final se ajusta el
  // redondeo contra lo ya trasladado, para que la suma de los cobros deje
  // exactamente el impuesto de la factura y no un centavo de más o de menos.
  const esElUltimo = input.amountCents === factura.saldoCents
  const yaTrasladado: any = db
    .prepare('SELECT COALESCE(SUM(tax_cents), 0) AS n FROM transactions WHERE invoice_id = ?')
    .get(id)
  const impuesto = esElUltimo
    ? factura.taxCents - yaTrasladado.n
    : Math.round((factura.taxCents * input.amountCents) / factura.totalCents)

  const nota =
    input.note ||
    [factura.folio && `Folio ${factura.folio}`, factura.concept, factura.counterpartyName]
      .filter(Boolean)
      .join(' · ')

  inTransaction(() => {
    db.prepare(
      `INSERT INTO transactions
        (profile_id, account_id, type, amount_cents, date, category_id, note,
         invoice_id, counterparty_id, cost_center_id, tax_cents, deductible)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      factura.profileId,
      input.accountId,
      txType,
      input.amountCents,
      input.date,
      input.categoryId ?? null,
      nota,
      id,
      factura.counterpartyId,
      factura.costCenterId,
      Math.max(0, impuesto),
      // Una factura recibida se marca deducible porque para eso se pide una
      // factura. El usuario puede quitarlo desde el movimiento.
      factura.direction === 'recibida' ? 1 : 0,
    )
  })
  res.status(201).json(facturaPorId(id))
})

export default router
