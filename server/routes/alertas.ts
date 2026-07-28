import { Router } from 'express'
import { alertas } from '../alertas.ts'
import { recurrenceQuery } from '../validators.ts'

const router = Router()

// Derivadas y de solo lectura (D10): pedirlas no escribe ni marca nada, y no
// hay forma de descartar una. Se apagan solas cuando el hecho deja de serlo.
router.get('/', (req, res) => {
  const { profileId, hoy } = recurrenceQuery.parse(req.query)
  res.json(alertas(profileId, hoy))
})

export default router
