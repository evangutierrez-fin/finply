import { Router } from 'express'
import { comparativa, reporteAnual } from '../reportes.ts'
import { comparativaQuery, reporteQuery } from '../validators.ts'

const router = Router()

// Todo aquí es de solo lectura: el libro no se toca.
router.get('/', (req, res) => {
  const { profileId, year } = reporteQuery.parse(req.query)
  res.json(reporteAnual(profileId, year))
})

// Dos periodos cualesquiera. Sin el segundo, el bloque inmediatamente
// anterior del mismo largo, que es lo que hacía cuando solo sabía comparar un
// mes contra el previo.
router.get('/comparativa', (req, res) => {
  const { profileId, desde, hasta, contraDesde, contraHasta } = comparativaQuery.parse(req.query)
  const contra = contraDesde && contraHasta ? { desde: contraDesde, hasta: contraHasta } : undefined
  res.json(comparativa(profileId, { desde, hasta }, contra))
})

export default router
