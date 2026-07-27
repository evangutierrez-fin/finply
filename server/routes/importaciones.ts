import { Router } from 'express'
import { analizar, deshacer, ejecutar, lotes } from '../importar.ts'
import { importInput } from '../validators.ts'

const router = Router()

// Analiza el archivo y devuelve el informe. NO escribe nada.
router.post('/previsualizar', (req, res) => {
  const input = importInput.parse(req.body)
  res.json(analizar(input))
})

// Escribe el lote. `huella` obliga a que sea lo mismo que se previsualizó.
router.post('/', (req, res) => {
  const input = importInput.parse(req.body)
  res.status(201).json(ejecutar(input, input.huella))
})

router.get('/', (req, res) => {
  const profileId = Number(req.query.profileId)
  if (!Number.isInteger(profileId) || profileId <= 0) {
    return res.status(400).json({ error: 'Falta profileId' })
  }
  res.json(lotes(profileId))
})

// Deshacer: borra las partidas del lote y el lote.
router.delete('/:id', (req, res) => {
  const profileId = Number(req.query.profileId)
  if (!Number.isInteger(profileId) || profileId <= 0) {
    return res.status(400).json({ error: 'Falta profileId' })
  }
  res.json(deshacer(profileId, Number(req.params.id)))
})

export default router
