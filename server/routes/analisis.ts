import { Router } from 'express'
import { analisis } from '../analisis.ts'
import { analisisQuery } from '../validators.ts'

const router = Router()

router.get('/', (req, res) => {
  const { profileId, meses, hoy, umbralHormigaCents } = analisisQuery.parse(req.query)
  res.json(analisis(profileId, meses, hoy, umbralHormigaCents))
})

export default router
