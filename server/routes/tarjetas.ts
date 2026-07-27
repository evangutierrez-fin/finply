import { Router } from 'express'
import { borrarCompraMSI, comprasMSI, crearCompraMSI, estadoTarjetas } from '../tarjetas.ts'
import { msiInput, tarjetasQuery } from '../validators.ts'

const router = Router()

// Estado de cuenta de cada tarjeta. `hoy` existe para poder pararse en otra
// fecha —las pruebas lo necesitan— y por omisión es el día de hoy.
router.get('/', (req, res) => {
  const { profileId, hoy } = tarjetasQuery.parse(req.query)
  res.json(estadoTarjetas(profileId, hoy))
})

router.get('/msi', (req, res) => {
  const profileId = Number(req.query.profileId)
  if (!Number.isInteger(profileId) || profileId <= 0) {
    return res.status(400).json({ error: 'Falta profileId' })
  }
  res.json(comprasMSI(profileId))
})

router.post('/msi', (req, res) => {
  const input = msiInput.parse(req.body)
  res.status(201).json(crearCompraMSI(input))
})

router.delete('/msi/:id', (req, res) => {
  const profileId = Number(req.query.profileId)
  if (!Number.isInteger(profileId) || profileId <= 0) {
    return res.status(400).json({ error: 'Falta profileId' })
  }
  borrarCompraMSI(profileId, Number(req.params.id))
  res.json({ ok: true })
})

export default router
