import { Router } from 'express'
import { flujoProyectado } from '../flujo.ts'
import { flujoQuery } from '../validators.ts'

const router = Router()

// De solo lectura, como el calendario del que sale: aquí no se escribe nada.
// `hoy` existe para que las pruebas puedan pararse en una fecha concreta; sin
// él, una prueba de proyección diría algo distinto cada día del mes.
router.get('/', (req, res) => {
  const q = flujoQuery.parse(req.query)
  res.json(flujoProyectado(q.profileId, q.hoy, q.dias))
})

export default router
