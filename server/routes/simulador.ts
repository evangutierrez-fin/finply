import { Router } from 'express'
import { simular } from '../simulacion.ts'
import { simuladorQuery } from '../validators.ts'

const router = Router()

// Solo lectura: el simulador no escribe una fila. Es un GET porque es una
// pregunta, y porque así el usuario puede volver a la misma proyección con la
// misma liga.
router.get('/', (req, res) => {
  const q = simuladorQuery.parse(req.query)
  res.json(
    simular(q.profileId, {
      meses: q.meses,
      ahorroMensualCents: q.ahorroMensualCents,
      rendimientoAnualBp: q.rendimientoAnualBp,
    }),
  )
})

export default router
