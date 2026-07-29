import express from 'express'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ZodError } from 'zod'
import profiles from './routes/profiles.ts'
import accounts from './routes/accounts.ts'
import categories from './routes/categories.ts'
import tags from './routes/tags.ts'
import importaciones from './routes/importaciones.ts'
import transactions from './routes/transactions.ts'
import debts from './routes/debts.ts'
import tarjetas from './routes/tarjetas.ts'
import investments from './routes/investments.ts'
import precios from './routes/precios.ts'
import contrapartes from './routes/contrapartes.ts'
import centros from './routes/centros.ts'
import facturas from './routes/facturas.ts'
import negocio from './routes/negocio.ts'
import simulador from './routes/simulador.ts'
import budgets from './routes/budgets.ts'
import goals from './routes/goals.ts'
import notes from './routes/notes.ts'
import summary from './routes/summary.ts'
import reportes from './routes/reportes.ts'
import alertas from './routes/alertas.ts'
import analisis from './routes/analisis.ts'
import recurrencias from './routes/recurrencias.ts'
import bienes from './routes/bienes.ts'
import calendario from './routes/calendario.ts'
import conciliacion from './routes/conciliacion.ts'
import backup from './routes/backup.ts'

/**
 * Arma la app de Express sin ponerla a escuchar, para que las pruebas puedan
 * levantarla en un puerto efímero.
 */
export function createApp(): express.Express {
  const app = express()

  // Un libro de varios años pesa bastante más que el límite de 100 kB que trae
  // Express por omisión, y por aquí entra la restauración de respaldos.
  app.use(express.json({ limit: '64mb' }))

  app.use('/api/profiles', profiles)
  app.use('/api/accounts', accounts)
  app.use('/api/categories', categories)
  app.use('/api/tags', tags)
  app.use('/api/importaciones', importaciones)
  app.use('/api/transactions', transactions)
  app.use('/api/debts', debts)
  app.use('/api/tarjetas', tarjetas)
  app.use('/api/investments', investments)
  app.use('/api/precios', precios)
  app.use('/api/contrapartes', contrapartes)
  app.use('/api/centros', centros)
  app.use('/api/facturas', facturas)
  app.use('/api/negocio', negocio)
  app.use('/api/simulador', simulador)
  app.use('/api/budgets', budgets)
  app.use('/api/goals', goals)
  app.use('/api/notes', notes)
  app.use('/api/summary', summary)
  app.use('/api/reportes', reportes)
  app.use('/api/alertas', alertas)
  app.use('/api/analisis', analisis)
  app.use('/api/recurrencias', recurrencias)
  app.use('/api/bienes', bienes)
  app.use('/api/calendario', calendario)
  app.use('/api/conciliacion', conciliacion)
  app.use('/api/respaldo', backup)

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Ruta no encontrada' })
  })

  // Si existe el frontend compilado (npm run build), este mismo servidor lo
  // sirve. Sin variables de entorno: funciona igual en Windows, Mac y Linux.
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
  const dist = path.join(root, 'dist')
  if (existsSync(path.join(dist, 'index.html'))) {
    app.use(express.static(dist))
    app.use((_req, res) => {
      res.sendFile(path.join(dist, 'index.html'))
    })
  }

  app.use(
    (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      if (err instanceof ZodError) {
        return res.status(400).json({ error: err.issues[0]?.message ?? 'Datos inválidos' })
      }
      if (err instanceof SyntaxError && (err as { status?: number }).status === 400) {
        return res.status(400).json({ error: 'El cuerpo de la petición no es JSON válido' })
      }
      const anyErr = err as { status?: number; message?: string }
      const status = anyErr.status ?? 500
      if (status >= 500) console.error(err)
      res.status(status).json({ error: anyErr.message ?? 'Error interno' })
    },
  )

  return app
}
