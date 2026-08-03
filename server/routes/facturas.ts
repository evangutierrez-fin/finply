import { Router } from 'express'
import { db, ensureAccount, ensureCategory, httpError, inTransaction } from '../db.ts'
import { aging, anticiposDe, cobranza, facturaPorId, listarFacturas } from '../facturas.ts'
import {
  agingQuery,
  anticipoInput,
  cobroInput,
  facturaInput,
  facturaPatch,
  facturaQuery,
  notaCreditoInput,
} from '../validators.ts'

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

router.get('/cobranza', (req, res) => {
  const q = agingQuery.parse(req.query)
  res.json(cobranza(q.profileId, q.hoy))
})

router.post('/', (req, res) => {
  const input = facturaInput.parse(req.body)
  contraparteDe(input.profileId, input.counterpartyId)
  if (input.taxCents > input.subtotalCents * 10) {
    return res.status(400).json({ error: 'Ese impuesto no puede ser de este subtotal' })
  }
  // Retener más de lo que vale la factura dejaría un cobrable negativo, es
  // decir una factura que te debe a ti. Vale más un error claro.
  const retenido = input.withheldTaxCents + input.withheldIncomeCents
  if (retenido > input.subtotalCents + input.taxCents) {
    return res.status(400).json({ error: 'Lo retenido no puede ser más que la factura entera' })
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
         subtotal_cents, tax_cents, withheld_tax_cents, withheld_income_cents, cost_center_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      input.withheldTaxCents,
      input.withheldIncomeCents,
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
  const subtotal = input.subtotalCents ?? existing.subtotal_cents
  const impuesto = input.taxCents ?? existing.tax_cents
  const retenido =
    (input.withheldTaxCents ?? existing.withheld_tax_cents) +
    (input.withheldIncomeCents ?? existing.withheld_income_cents)
  if (retenido > subtotal + impuesto) {
    return res.status(400).json({ error: 'Lo retenido no puede ser más que la factura entera' })
  }
  db.prepare(
    `UPDATE invoices SET counterparty_id = ?, folio = ?, concept = ?, issue_date = ?,
       due_date = ?, subtotal_cents = ?, tax_cents = ?, withheld_tax_cents = ?,
       withheld_income_cents = ?, status = ?, cost_center_id = ?
     WHERE id = ?`,
  ).run(
    input.counterpartyId ?? existing.counterparty_id,
    input.folio ?? existing.folio,
    input.concept ?? existing.concept,
    input.issueDate ?? existing.issue_date,
    input.dueDate === undefined ? existing.due_date : input.dueDate,
    subtotal,
    impuesto,
    input.withheldTaxCents ?? existing.withheld_tax_cents,
    input.withheldIncomeCents ?? existing.withheld_income_cents,
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
  //
  // ⚠ La proporción se mide contra lo **cobrable**, no contra el total: si te
  // retienen, cobrar todo lo que va a llegar es el 100 % de la operación. Con
  // el total en el denominador, el último cobro nunca alcanzaría la proporción
  // completa y el ajuste tendría que tapar la diferencia entera.
  //
  // Y el impuesto trasladado sigue siendo el de la factura completa aunque
  // parte se haya retenido: ese IVA se causó, lo entera el cliente en tu
  // nombre y tú lo declaras igual.
  //
  // ⚠ El techo del `Math.min` no es una precaución teórica: lo encontró la
  // auditoría de la Fase 22. Cada cobro parcial redondea su parte, y varios
  // que redondeen hacia arriba dejan trasladado **más** impuesto del que la
  // factura tiene antes de llegar al final. Ahí el ajuste del último cobro
  // sale negativo, el piso lo vuelve cero y la suma se queda un centavo
  // arriba. Pasa con cinco cobros de una factura de $11,600 al 16 % y un
  // residuo de un centavo — nada exótico. Con el techo, ningún cobro puede
  // trasladar lo que ya no queda por trasladar, y el último siempre cierra
  // en la cifra exacta.
  const esElUltimo = input.amountCents === factura.saldoCents
  const yaTrasladado: any = db
    .prepare('SELECT COALESCE(SUM(tax_cents), 0) AS n FROM transactions WHERE invoice_id = ?')
    .get(id)
  const porTrasladar = factura.taxCents - yaTrasladado.n
  const impuesto = esElUltimo
    ? porTrasladar
    : Math.min(
        Math.round((factura.taxCents * input.amountCents) / factura.cobrableCents),
        porTrasladar,
      )

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

// ── Notas de crédito ──────────────────────────────────────────────────────

/**
 * Cancelar parte de una factura ya emitida.
 *
 * **No mueve un peso**, y por eso no crea ningún movimiento: el dinero nunca
 * llegó, así que no hay nada que devolver. Lo único que cambia es lo cobrable,
 * y con ello el saldo, el aging y el flujo proyectado — todos derivados del
 * mismo SQL, así que ninguno puede quedarse viejo.
 *
 * Si te devolvieron dinero que **sí** habías cobrado, eso no es una nota de
 * crédito: es una devolución, y para eso está el reembolso ligado al gasto
 * original de la Fase 10.
 */
router.post('/:id/notas', (req, res) => {
  const id = Number(req.params.id)
  const factura = facturaPorId(id)
  if (!factura) return res.status(404).json({ error: 'Factura no encontrada' })
  const input = notaCreditoInput.parse(req.body)

  // No se puede cancelar más de lo que queda: lo ya cobrado ya se cobró, y
  // cancelarlo dejaría una factura pagada de más sin decir dónde está ese
  // dinero.
  const cancelable = factura.cobrableCents - factura.pagadoCents
  if (input.amountCents > cancelable) {
    return res.status(400).json({
      error:
        `De esta factura solo quedan ${(cancelable / 100).toFixed(2)} sin cobrar. ` +
        'Si te devolvieron dinero ya cobrado, regístralo como una devolución del movimiento.',
    })
  }

  db.prepare(
    `INSERT INTO invoice_credit_notes (invoice_id, date, folio, concept, amount_cents)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, input.date, input.folio, input.concept, input.amountCents)
  res.status(201).json(facturaPorId(id))
})

/** Deshacer una nota de crédito: la factura vuelve a deber lo que cancelaba. */
router.delete('/:id/notas/:notaId', (req, res) => {
  const id = Number(req.params.id)
  const notaId = Number(req.params.notaId)
  const nota = db
    .prepare('SELECT id FROM invoice_credit_notes WHERE id = ? AND invoice_id = ?')
    .get(notaId, id)
  if (!nota) return res.status(404).json({ error: 'Nota de crédito no encontrada' })
  db.prepare('DELETE FROM invoice_credit_notes WHERE id = ?').run(notaId)
  res.json(facturaPorId(id))
})

// ── Anticipos ─────────────────────────────────────────────────────────────

/** Lo ya cobrado a esa contraparte que todavía no tiene factura. */
router.get('/:id/anticipos', (req, res) => {
  const id = Number(req.params.id)
  const factura = facturaPorId(id)
  if (!factura) return res.status(404).json({ error: 'Factura no encontrada' })
  res.json(anticiposDe(factura.profileId, factura.counterpartyId, factura.direction))
})

/**
 * Aplica un anticipo a la factura: **liga un movimiento que ya existe**.
 *
 * Aquí no nace un peso, y ese es el punto. Cobraste antes de facturar: en un
 * libro de flujo de efectivo ese ingreso ya entró el día que lo cobraste (D14)
 * y ya cuenta en su mes. Registrar el cobro otra vez al llegar la factura
 * contaría el mismo peso dos veces — el error que toda la Fase 8 existe para
 * evitar. Lo único que faltaba era poder decir a qué correspondía.
 */
router.post('/:id/anticipos', (req, res) => {
  const id = Number(req.params.id)
  const factura = facturaPorId(id)
  if (!factura) return res.status(404).json({ error: 'Factura no encontrada' })
  if (factura.status === 'cancelada') {
    return res.status(400).json({ error: 'Esa factura está cancelada' })
  }
  const input = anticipoInput.parse(req.body)

  const candidatos = anticiposDe(factura.profileId, factura.counterpartyId, factura.direction)
  const anticipo = candidatos.find((a) => a.txId === input.txId)
  if (!anticipo) {
    return res.status(400).json({
      error: 'Ese movimiento no es un anticipo aplicable: ya tiene factura, o es de otra contraparte.',
    })
  }
  // Un anticipo mayor que lo que falta no se puede partir sin partir el
  // movimiento, y partir un movimiento del pasado es reescribir el libro. Se
  // dice con las dos cifras enfrente para que el usuario decida.
  if (anticipo.amountCents > factura.saldoCents) {
    return res.status(400).json({
      error:
        `Ese anticipo es de ${(anticipo.amountCents / 100).toFixed(2)} y a la factura le ` +
        `faltan ${(factura.saldoCents / 100).toFixed(2)}. Aplica uno más chico, o divide el ` +
        'movimiento antes.',
    })
  }

  db.prepare('UPDATE transactions SET invoice_id = ?, cost_center_id = ? WHERE id = ?').run(
    id,
    factura.costCenterId,
    input.txId,
  )
  res.json(facturaPorId(id))
})

export default router
