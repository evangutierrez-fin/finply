import { Router, type Response } from 'express'
import { comparativa, reporteAnual } from '../reportes.ts'
import { comparativaCsv, reporteAnualCsv } from '../exportar.ts'
import { comparativaQuery, reporteQuery } from '../validators.ts'

const router = Router()

/** Cabeceras de descarga, iguales para los dos reportes. */
function bajar(res: Response, nombre: string, csv: string) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`)
  res.send(csv)
}

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

// Los mismos dos reportes, en CSV. Salen de las mismas funciones de arriba —
// no de una consulta parecida—, así que el archivo no puede decir una cifra
// distinta de la que se está viendo en pantalla.

router.get('/export.csv', (req, res) => {
  const { profileId, year } = reporteQuery.parse(req.query)
  bajar(res, `finply-reporte-${year}.csv`, reporteAnualCsv(profileId, year))
})

router.get('/comparativa.csv', (req, res) => {
  const { profileId, desde, hasta, contraDesde, contraHasta } = comparativaQuery.parse(req.query)
  const contra = contraDesde && contraHasta ? { desde: contraDesde, hasta: contraHasta } : undefined
  bajar(
    res,
    `finply-comparativa-${desde}-${hasta}.csv`,
    comparativaCsv(profileId, { desde, hasta }, contra),
  )
})

export default router
