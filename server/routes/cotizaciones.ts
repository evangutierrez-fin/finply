// Cotizaciones y órdenes de compra.
//
// Solo documentos: aquí no se asienta un peso. La única escritura que sale de
// esta ruta hacia otra tabla es **convertir en factura**, y una factura tampoco
// mueve el libro hasta que se cobra (D14). El dinero sigue naciendo donde
// siempre: cuando el usuario registra el cobro.

import { Router } from 'express'
import { db, httpError, inTransaction } from '../db.ts'
import {
  cotizacionPorId,
  exigirCotizacion,
  listarCotizaciones,
  resumenCotizaciones,
} from '../cotizaciones.ts'
import { facturaPorId } from '../facturas.ts'
import {
  cotizacionEstado,
  cotizacionFacturar,
  cotizacionInput,
  cotizacionQuery,
} from '../validators.ts'

const router = Router()

/** Las dos referencias que un documento puede traer, comprobadas de una vez. */
function exigirReferencias(profileId: number, counterpartyId: number, costCenterId?: number | null) {
  const contraparte = db
    .prepare('SELECT id FROM counterparties WHERE id = ? AND profile_id = ?')
    .get(counterpartyId, profileId)
  if (!contraparte) throw httpError(400, 'La contraparte no pertenece a este perfil')
  if (costCenterId) {
    const centro = db
      .prepare('SELECT id FROM cost_centers WHERE id = ? AND profile_id = ?')
      .get(costCenterId, profileId)
    if (!centro) throw httpError(400, 'Ese centro no pertenece a este perfil')
  }
}

router.get('/', (req, res) => {
  const q = cotizacionQuery.parse(req.query)
  res.json(listarCotizaciones(q))
})

router.get('/resumen', (req, res) => {
  const q = cotizacionQuery.parse(req.query)
  res.json({
    emitida: resumenCotizaciones(q.profileId, 'emitida', q.hoy),
    recibida: resumenCotizaciones(q.profileId, 'recibida', q.hoy),
  })
})

router.post('/', (req, res) => {
  const input = cotizacionInput.parse(req.body)
  exigirReferencias(input.profileId, input.counterpartyId, input.costCenterId)
  // El mismo tope que las facturas: un impuesto diez veces el subtotal es un
  // dedazo, no una jurisdicción rara.
  if (input.taxCents > input.subtotalCents * 10) {
    throw httpError(400, 'Ese impuesto no puede ser de este subtotal')
  }
  const result = db
    .prepare(
      `INSERT INTO quotes
        (profile_id, counterparty_id, direction, folio, concept, issue_date, valid_until,
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
      input.validUntil ?? null,
      input.subtotalCents,
      input.taxCents,
      input.costCenterId ?? null,
    )
  res.status(201).json(cotizacionPorId(Number(result.lastInsertRowid)))
})

/**
 * Corregir el contenido. Una cotización **ya convertida no se edita**: lo que
 * vale de ahí en adelante es la factura, y cambiarle el monto al documento del
 * que salió dejaría dos cifras distintas de lo mismo sin decir cuál manda.
 */
router.patch('/:id', (req, res) => {
  const input = cotizacionInput.parse(req.body)
  const actual = exigirCotizacion(input.profileId, Number(req.params.id))
  if (actual.invoice_id !== null) {
    throw httpError(409, 'Esta cotización ya se convirtió en factura: corrige la factura')
  }
  exigirReferencias(input.profileId, input.counterpartyId, input.costCenterId)
  if (input.taxCents > input.subtotalCents * 10) {
    throw httpError(400, 'Ese impuesto no puede ser de este subtotal')
  }
  db.prepare(
    `UPDATE quotes SET counterparty_id = ?, direction = ?, folio = ?, concept = ?,
       issue_date = ?, valid_until = ?, subtotal_cents = ?, tax_cents = ?, cost_center_id = ?
     WHERE id = ?`,
  ).run(
    input.counterpartyId,
    input.direction,
    input.folio,
    input.concept,
    input.issueDate,
    input.validUntil ?? null,
    input.subtotalCents,
    input.taxCents,
    input.costCenterId ?? null,
    actual.id,
  )
  res.json(cotizacionPorId(actual.id))
})

/**
 * Darla por perdida, o revivirla. 'aceptada' no se pone por aquí: se llega
 * convirtiéndola, porque aceptar sin factura no cambia nada en el libro y
 * dejaría una cotización marcada como ganada sin nada que cobrar.
 */
router.patch('/:id/estado', (req, res) => {
  const q = cotizacionQuery.parse(req.query)
  const { status } = cotizacionEstado.parse(req.body)
  const actual = exigirCotizacion(q.profileId, Number(req.params.id))
  if (actual.invoice_id !== null) {
    throw httpError(409, 'Esta cotización ya se convirtió en factura')
  }
  db.prepare('UPDATE quotes SET status = ? WHERE id = ?').run(status, actual.id)
  res.json(cotizacionPorId(actual.id, q.hoy))
})

/**
 * Convertirla en factura de un clic, que es todo el punto de la sección.
 *
 * Las dos escrituras van en **una transacción**: una factura creada sin quedar
 * ligada dejaría a la cotización esperando para siempre una respuesta que ya
 * llegó, y el usuario la convertiría dos veces.
 *
 * Lo que no se manda se hereda —concepto, montos, contraparte, centro— porque
 * Finply ya lo tiene enfrente y volver a teclearlo es donde se cuelan los
 * dedazos. La fecha de vencimiento ausente **no es la misma que vacía**: sin
 * ella manda el crédito pactado con la contraparte.
 */
router.post('/:id/facturar', (req, res) => {
  const q = cotizacionQuery.parse(req.query)
  const input = cotizacionFacturar.parse(req.body)
  const cot = exigirCotizacion(q.profileId, Number(req.params.id))
  if (cot.invoice_id !== null) {
    throw httpError(409, 'Esta cotización ya tiene su factura')
  }
  if (cot.status === 'perdida') {
    throw httpError(409, 'Esta cotización está dada por perdida: revívela antes de facturarla')
  }

  const contraparte: any = db
    .prepare('SELECT credit_days FROM counterparties WHERE id = ?')
    .get(cot.counterparty_id)
  const dueDate =
    input.dueDate !== undefined && input.dueDate !== null
      ? input.dueDate
      : contraparte?.credit_days
        ? new Date(Date.parse(`${input.issueDate}T00:00:00Z`) + contraparte.credit_days * 86_400_000)
            .toISOString()
            .slice(0, 10)
        : null

  const facturaId = inTransaction(() => {
    const result = db
      .prepare(
        `INSERT INTO invoices
          (profile_id, counterparty_id, direction, folio, concept, issue_date, due_date,
           subtotal_cents, tax_cents, cost_center_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        cot.profile_id,
        cot.counterparty_id,
        cot.direction,
        input.folio,
        cot.concept,
        input.issueDate,
        dueDate,
        cot.subtotal_cents,
        cot.tax_cents,
        cot.cost_center_id,
      )
    const id = Number(result.lastInsertRowid)
    db.prepare("UPDATE quotes SET status = 'aceptada', invoice_id = ? WHERE id = ?").run(id, cot.id)
    return id
  })

  res.status(201).json({
    cotizacion: cotizacionPorId(cot.id, q.hoy),
    factura: facturaPorId(facturaId),
  })
})

/**
 * Borrarla **no borra la factura** que salió de ella: ese documento ya existe
 * por su cuenta y puede tener cobros encima. Es el mismo trato que el
 * desembolso de una deuda: se pierde la liga, no el hecho.
 */
router.delete('/:id', (req, res) => {
  const q = cotizacionQuery.parse(req.query)
  const cot = exigirCotizacion(q.profileId, Number(req.params.id))
  db.prepare('DELETE FROM quotes WHERE id = ?').run(cot.id)
  res.json({ ok: true, facturaViva: cot.invoice_id !== null })
})

export default router
