import { Router } from 'express'
import { estadoDeResultados, flujoProyectado } from '../negocio.ts'
import { flujoQuery, periodoQuery } from '../validators.ts'

const router = Router()

// Las dos son de solo lectura y ninguna escribe una fila.
router.get('/resultados', (req, res) => {
  const q = periodoQuery.parse(req.query)
  if (q.desde > q.hasta) {
    return res.status(400).json({ error: 'El periodo empieza después de terminar' })
  }
  res.json(estadoDeResultados(q.profileId, q.desde, q.hasta))
})

router.get('/flujo', (req, res) => {
  const q = flujoQuery.parse(req.query)
  res.json(flujoProyectado(q.profileId, q.hoy, q.dias))
})

export default router
