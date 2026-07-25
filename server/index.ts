import express from 'express'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ZodError } from 'zod'
import profiles from './routes/profiles.ts'
import accounts from './routes/accounts.ts'
import categories from './routes/categories.ts'
import transactions from './routes/transactions.ts'
import debts from './routes/debts.ts'
import investments from './routes/investments.ts'
import budgets from './routes/budgets.ts'
import goals from './routes/goals.ts'
import notes from './routes/notes.ts'
import summary from './routes/summary.ts'

const app = express()
const PORT = Number(process.env.API_PORT ?? 4321)

app.use(express.json())

app.use('/api/profiles', profiles)
app.use('/api/accounts', accounts)
app.use('/api/categories', categories)
app.use('/api/transactions', transactions)
app.use('/api/debts', debts)
app.use('/api/investments', investments)
app.use('/api/budgets', budgets)
app.use('/api/goals', goals)
app.use('/api/notes', notes)
app.use('/api/summary', summary)

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
    console.error(err)
    res.status(status).json({ error: anyErr.message ?? 'Error interno' })
  },
)

app.listen(PORT, () => {
  console.log(`[finply] API escuchando en http://localhost:${PORT}`)
})
