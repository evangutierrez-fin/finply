import { Router } from 'express'
import { actualizar, borrar, crear, facturar, listar, mesDe, resumen } from '../horas.ts'
import { facturarHorasInput, horaInput, horasQuery } from '../validators.ts'

const router = Router()

// Ojo con el orden: '/resumen' va antes que cualquier '/:id'.
router.get('/resumen', (req, res) => {
  const q = horasQuery.parse(req.query)
  const mes = mesDe()
  res.json(resumen(q.profileId, q.desde ?? mes.desde, q.hasta ?? mes.hasta))
})

router.get('/', (req, res) => {
  res.json(listar(horasQuery.parse(req.query)))
})

router.post('/', (req, res) => {
  res.status(201).json(crear(horaInput.parse(req.body)))
})

router.patch('/:id', (req, res) => {
  const input = horaInput.parse(req.body)
  res.json(actualizar(input.profileId, Number(req.params.id), input))
})

router.delete('/:id', (req, res) => {
  const { profileId } = horasQuery.parse(req.query)
  borrar(profileId, Number(req.params.id))
  res.json({ ok: true })
})

/**
 * Todas las horas sin facturar de un cliente, en **una** factura. No asienta un
 * peso —emitir nunca lo hace (D14)— y solo pasa porque el usuario lo pidió
 * (R4). La factura y el marcado de las horas van en la misma transacción.
 */
router.post('/facturar', (req, res) => {
  const { profileId } = horasQuery.parse(req.query)
  const { counterpartyId, ...opciones } = facturarHorasInput.parse(req.body)
  res.status(201).json(facturar(profileId, counterpartyId, opciones))
})

export default router
