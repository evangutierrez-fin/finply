// El libro de un perfil, en hojas que abre cualquiera.
//
// Todo aquí es de solo lectura: no se escribe una fila, no se toca una cifra.
// Y es **de un perfil**, no de la máquina: el respaldo JSON de `/api/respaldo`
// se lleva todos los libros y sirve para restaurar; esto sirve para salir.

import { Router } from 'express'
import { httpError } from '../db.ts'
import { exportarPerfil } from '../exportar.ts'

const router = Router()

function perfilDe(req: any): number {
  const profileId = Number(req.query.profileId)
  if (!Number.isInteger(profileId) || profileId <= 0) throw httpError(400, 'Falta profileId')
  return profileId
}

router.get('/libro.zip', (req, res) => {
  const fecha = new Date()
  const zip = exportarPerfil(perfilDe(req), fecha)
  res.setHeader('Content-Type', 'application/zip')
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="finply-datos-${fecha.toISOString().slice(0, 10)}.zip"`,
  )
  res.send(zip)
})

export default router
