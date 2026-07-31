import { Router } from 'express'
import { estadoDeResultados } from '../negocio.ts'
import { periodoQuery } from '../validators.ts'

const router = Router()

// De solo lectura: no escribe una fila.
router.get('/resultados', (req, res) => {
  const q = periodoQuery.parse(req.query)
  if (q.desde > q.hasta) {
    return res.status(400).json({ error: 'El periodo empieza después de terminar' })
  }
  res.json(estadoDeResultados(q.profileId, q.desde, q.hasta))
})

// El flujo proyectado se mudó a `/api/flujo` en la Fase 16: dejó de ser una
// función de negocio para volverse la pregunta de cualquiera. Un segundo
// endpoint que devolviera lo mismo sería la segunda versión de la misma cifra.

export default router
