import { Router } from 'express'
import { analisis } from '../analisis.ts'
import { analisisQuery } from '../validators.ts'

const router = Router()

router.get('/', (req, res) => {
  const { profileId, meses, hoy } = analisisQuery.parse(req.query)
  res.json(analisis(profileId, meses, hoy))
})

export default router
