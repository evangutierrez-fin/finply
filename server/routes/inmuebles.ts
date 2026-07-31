import { Router } from 'express'
import { actualizar, borrar, crear, listar } from '../inmuebles.ts'
import { arrendamientoInput, giroQuery } from '../validators.ts'

const router = Router()

router.get('/', (req, res) => {
  const { profileId, hoy } = giroQuery.parse(req.query)
  res.json(listar(profileId, hoy))
})

router.post('/', (req, res) => {
  res.status(201).json(crear(arrendamientoInput.parse(req.body)))
})

router.patch('/:id', (req, res) => {
  res.json(actualizar(Number(req.params.id), arrendamientoInput.parse(req.body)))
})

/**
 * Borrar el contrato deja en el libro sus movimientos: ese dinero se movió.
 * La respuesta dice cuántos toca —y cuántos de ellos eran depósitos, que al
 * perder su papel vuelven a contar como ingreso— para que el aviso no mienta.
 */
router.delete('/:id', (req, res) => {
  const { profileId } = giroQuery.parse(req.query)
  res.json({ ok: true, ...borrar(profileId, Number(req.params.id)) })
})

export default router
