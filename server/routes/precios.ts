import { Router } from 'express'
import { analizarPrecios, aplicarPrecios } from '../precios.ts'
import { preciosConfirmar, preciosInput } from '../validators.ts'

const router = Router()

// Vista previa: lee el archivo y dice qué pasaría. No escribe nada (R4).
router.post('/analizar', (req, res) => {
  const input = preciosInput.parse(req.body)
  res.json(analizarPrecios(input))
})

// El visto bueno: solo las filas marcadas, todas en una transacción (R8).
router.post('/aplicar', (req, res) => {
  const input = preciosConfirmar.parse(req.body)
  res.json(aplicarPrecios(input))
})

export default router
