import { Router } from 'express'
import { dbPath } from '../db.ts'
import { exportSnapshot, importSnapshot } from '../backup.ts'

const router = Router()

// Descarga el libro completo (todos los perfiles) como un JSON legible.
router.get('/', (_req, res) => {
  const snapshot = exportSnapshot()
  const day = snapshot.exportedAt.slice(0, 10)
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="finply-${day}.json"`)
  res.send(JSON.stringify(snapshot, null, 2))
})

// Dónde vive la base, para poder respaldarla también por fuera.
router.get('/info', (_req, res) => {
  res.json({ dbPath })
})

// Reemplaza TODO el contenido por el del respaldo. Operación destructiva:
// la interfaz pide confirmación escrita antes de llamar aquí.
router.post('/restaurar', (req, res) => {
  res.json(importSnapshot(req.body))
})

export default router
