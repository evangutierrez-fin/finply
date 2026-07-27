import { Router } from 'express'
import { comparativa, reporteAnual } from '../reportes.ts'
import { comparativaQuery, reporteQuery } from '../validators.ts'

const router = Router()

// Todo aquí es de solo lectura: el libro no se toca.
router.get('/', (req, res) => {
  const { profileId, year } = reporteQuery.parse(req.query)
  res.json(reporteAnual(profileId, year))
})

router.get('/comparativa', (req, res) => {
  const { profileId, month } = comparativaQuery.parse(req.query)
  res.json(comparativa(profileId, month))
})

export default router
