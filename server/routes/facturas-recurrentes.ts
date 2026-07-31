import { Router } from 'express'
import {
  actualizar,
  bandeja,
  borrar,
  crear,
  descartar,
  emitir,
  listar,
  obtener,
  reabrir,
} from '../facturas-recurrentes.ts'
import {
  bandejaQuery,
  emitirFacturaInput,
  facturaRecurrenteInput,
  periodoInput,
  recurrenceQuery,
} from '../validators.ts'

const router = Router()

// Mismo cuidado que en las recurrencias de movimiento: '/pendientes' va antes
// que '/:id', o Express lo tomaría por un id.
router.get('/pendientes', (req, res) => {
  const { profileId, hoy, limit, offset } = bandejaQuery.parse(req.query)
  res.json(bandeja(profileId, hoy, { limit, offset }))
})

router.get('/', (req, res) => {
  const { profileId, hoy } = recurrenceQuery.parse(req.query)
  res.json(listar(profileId, hoy))
})

router.get('/:id', (req, res) => {
  const { profileId } = recurrenceQuery.parse(req.query)
  const plantilla = obtener(profileId, Number(req.params.id))
  if (!plantilla) return res.status(404).json({ error: 'Esa plantilla de factura no existe' })
  res.json(plantilla)
})

router.post('/', (req, res) => {
  res.status(201).json(crear(facturaRecurrenteInput.parse(req.body)))
})

router.patch('/:id', (req, res) => {
  const input = facturaRecurrenteInput.parse(req.body)
  res.json(actualizar(Number(req.params.id), input))
})

// Borrar la plantilla deja las facturas ya emitidas: son documentos que
// existen y algunos ya se cobraron. La respuesta dice cuántas son.
router.delete('/:id', (req, res) => {
  const { profileId } = recurrenceQuery.parse(req.query)
  res.json({ ok: true, ...borrar(profileId, Number(req.params.id)) })
})

/**
 * Emitir la factura de un periodo. Solo llega aquí si el usuario lo pidió
 * (R4), y **no asienta un peso**: emitir sigue sin mover el libro (D14). El
 * documento y la marca del periodo se crean en una sola transacción, y el
 * UNIQUE de `invoice_recurrence_runs` ataja el doble clic y las dos pestañas
 * (R5).
 */
router.post('/:id/emitir', (req, res) => {
  const { profileId } = recurrenceQuery.parse(req.query)
  const { periodo, ...ajustes } = emitirFacturaInput.parse(req.body)
  res.status(201).json(emitir(profileId, Number(req.params.id), periodo, ajustes))
})

router.post('/:id/descartar', (req, res) => {
  const { profileId } = recurrenceQuery.parse(req.query)
  const { periodo } = periodoInput.parse(req.body)
  descartar(profileId, Number(req.params.id), periodo)
  res.json({ ok: true })
})

router.post('/:id/reabrir', (req, res) => {
  const { profileId } = recurrenceQuery.parse(req.query)
  const { periodo } = periodoInput.parse(req.body)
  reabrir(profileId, Number(req.params.id), periodo)
  res.json({ ok: true })
})

export default router
