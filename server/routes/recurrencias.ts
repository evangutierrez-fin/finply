import { Router } from 'express'
import {
  actualizar,
  asentar,
  bandeja,
  borrar,
  crear,
  descartar,
  listar,
  reabrir,
} from '../recurrencias.ts'
import {
  asentarInput,
  bandejaQuery,
  periodoInput,
  recurrenceInput,
  recurrenceQuery,
} from '../validators.ts'

const router = Router()

// Ojo con el orden: '/pendientes' tiene que ir antes que '/:id', o Express lo
// tomaría por un id.
router.get('/pendientes', (req, res) => {
  const { profileId, hoy, limit, offset } = bandejaQuery.parse(req.query)
  res.json(bandeja(profileId, hoy, { limit, offset }))
})

router.get('/', (req, res) => {
  const { profileId, hoy } = recurrenceQuery.parse(req.query)
  res.json(listar(profileId, hoy))
})

router.post('/', (req, res) => {
  const input = recurrenceInput.parse(req.body)
  res.status(201).json(crear(input))
})

router.patch('/:id', (req, res) => {
  const input = recurrenceInput.parse(req.body)
  res.json(actualizar(Number(req.params.id), input))
})

// Borrar la plantilla deja en el libro los movimientos ya asentados: ese
// dinero se movió. La respuesta dice cuántos son, para que el aviso no mienta.
router.delete('/:id', (req, res) => {
  const { profileId } = recurrenceQuery.parse(req.query)
  res.json({ ok: true, ...borrar(profileId, Number(req.params.id)) })
})

/**
 * Asentar una propuesta. Es el único punto de toda la fase que escribe en el
 * libro, y solo llega aquí si el usuario lo pidió (R4). El movimiento y la
 * marca del periodo se crean en una sola transacción; el UNIQUE de
 * `recurrence_runs` ataja el doble clic y las dos pestañas (R5).
 */
router.post('/:id/asentar', (req, res) => {
  const { profileId } = recurrenceQuery.parse(req.query)
  const { periodo, ...ajustes } = asentarInput.parse(req.body)
  res.status(201).json(asentar(profileId, Number(req.params.id), periodo, ajustes))
})

router.post('/:id/descartar', (req, res) => {
  const { profileId } = recurrenceQuery.parse(req.query)
  const { periodo } = periodoInput.parse(req.body)
  descartar(profileId, Number(req.params.id), periodo)
  res.json({ ok: true })
})

/** Deshace un descarte: el periodo vuelve a la bandeja. */
router.post('/:id/reabrir', (req, res) => {
  const { profileId } = recurrenceQuery.parse(req.query)
  const { periodo } = periodoInput.parse(req.body)
  reabrir(profileId, Number(req.params.id), periodo)
  res.json({ ok: true })
})

export default router
