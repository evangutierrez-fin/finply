import { Router } from 'express'
import { calendario } from '../calendario.ts'
import { calendarioQuery } from '../validators.ts'

const router = Router()

// Solo lectura. `hoy` existe para que las pruebas puedan pararse en una fecha
// concreta, igual que en tarjetas; por omisión es el día de hoy.
router.get('/', (req, res) => {
  const { profileId, hoy, dias } = calendarioQuery.parse(req.query)
  res.json(calendario(profileId, hoy, dias))
})

export default router
