import express from 'express'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ZodError } from 'zod'
import { MAX_ADJUNTO_BYTES } from './validators.ts'
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
import facturasRecurrentes from './routes/facturas-recurrentes.ts'
import cotizaciones from './routes/cotizaciones.ts'
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
import flujo from './routes/flujo.ts'
import conciliacion from './routes/conciliacion.ts'
import inmuebles from './routes/inmuebles.ts'
import horas from './routes/horas.ts'
import inventario from './routes/inventario.ts'
import personalizacion from './routes/personalizacion.ts'
import backup from './routes/backup.ts'
import exportar from './routes/exportar.ts'

/**
 * Cuánto cuerpo se acepta. Por aquí entra la restauración de un respaldo, que
 * es lo más grande que Finply maneja, y el límite de 100 kB de Express no le
 * llega ni de lejos.
 *
 * ⚠ La cifra no es redonda por gusto: **sale de lo que Finply mismo puede
 * generar.** Los recibos viajan en base64 dentro del JSON (Fase 10), así que
 * cada uno pesa un tercio más que el archivo, y con el tope viejo de 64 MB un
 * libro con dos docenas de recibos grandes producía un respaldo que la propia
 * app se negaba a restaurar — con un 413 en inglés que no explicaba nada. Es
 * la peor forma de perder datos: la que se descubre el día que hacen falta.
 * Hay prueba de que el tope cabe lo que el catálogo de adjuntos permite.
 */
export const ADJUNTOS_QUE_CABEN = 150
export const LIMITE_CUERPO_BYTES = Math.ceil((MAX_ADJUNTO_BYTES * 4) / 3) * ADJUNTOS_QUE_CABEN

/**
 * De un error a lo que lee el usuario. Está fuera del middleware para poder
 * probarla: el 413 solo se provoca mandando cientos de megabytes de verdad
 * —Node no contesta a un cuerpo anunciado y no enviado—, y una prueba así no
 * cabe en una suite.
 */
export function traducirError(err: unknown): { status: number; error: string } {
  if (err instanceof ZodError) {
    return { status: 400, error: err.issues[0]?.message ?? 'Datos inválidos' }
  }
  if (err instanceof SyntaxError && (err as { status?: number }).status === 400) {
    return { status: 400, error: 'El cuerpo de la petición no es JSON válido' }
  }
  // El 413 de Express llega en inglés y sin explicación. Quien lo ve está
  // restaurando un respaldo enorme, así que lo que necesita saber es por qué
  // pesa tanto y cuál es la otra puerta, que existe y no tiene tope.
  if ((err as { type?: string }).type === 'entity.too.large') {
    return {
      status: 413,
      error:
        `El archivo pasa del tope de ${Math.round(LIMITE_CUERPO_BYTES / 1024 / 1024)} MB. ` +
        'Casi siempre son los recibos adjuntos, que viajan dentro del JSON. ' +
        'Para un libro así, la copia .db de data/respaldos/ se restaura sin ese tope: ' +
        'basta ponerla en el lugar de tu base.',
    }
  }
  const anyErr = err as { status?: number; message?: string }
  return { status: anyErr.status ?? 500, error: anyErr.message ?? 'Error interno' }
}

/**
 * Los nombres con los que se puede llamar a este servidor.
 *
 * Finply no pide contraseña porque escucha solo en `127.0.0.1` y asume que
 * nadie más lo alcanza. Eso es cierto para la red y **falso para el
 * navegador**: una página cualquiera puede resolver su propio dominio a
 * `127.0.0.1` —reasignación de DNS, el ataque se llama *DNS rebinding*— y a
 * partir de ese momento el navegador la considera del mismo origen que
 * `http://sudominio:4321`. La política de mismo origen deja de estorbar, no
 * hay CORS que valga, y esa página lee el libro entero.
 *
 * Lo único que el atacante no puede falsear es el nombre: para rebotar el DNS
 * necesita un **dominio suyo**, así que la cabecera `Host` de esa petición
 * dice `malicioso.example` y no `localhost`. Se comprueba ahí.
 *
 * Una IP literal se acepta —quien puso `API_HOST=0.0.0.0` a propósito llega
 * por la IP de su máquina, y una IP no se rebota: no hay DNS que cambiar—. Y
 * `FINPLY_HOSTS` deja añadir nombres para quien lo ponga detrás de un proxy
 * con su propio dominio, que es una decisión suya y explícita.
 */
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1'])

/** El nombre sin el puerto. `[::1]:4321` → `::1`. */
function soloElNombre(host: string): string {
  const sinPuerto = host.startsWith('[')
    ? host.slice(1, host.indexOf(']'))
    : (host.split(':')[0] ?? '')
  return sinPuerto.toLowerCase()
}

/** Una IP escrita como IP. No hay DNS que rebotar contra ella. */
function esIpLiteral(nombre: string): boolean {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(nombre)) return true
  return nombre.includes(':') && /^[0-9a-f:.]+$/.test(nombre)
}

export function hostPermitido(host: string | undefined, extra: string[] = []): boolean {
  // Sin `Host` no hay HTTP/1.1 válido, y HTTP/1.0 sin cabecera solo lo manda
  // algo que no es un navegador: no es la vía del ataque y se deja pasar.
  if (!host) return true
  const nombre = soloElNombre(host)
  if (nombre === '') return false
  return LOOPBACK.has(nombre) || esIpLiteral(nombre) || extra.includes(nombre)
}

function nombresExtra(): string[] {
  return (process.env.FINPLY_HOSTS ?? '')
    .split(',')
    .map((n) => n.trim().toLowerCase())
    .filter((n) => n !== '')
}

/**
 * Arma la app de Express sin ponerla a escuchar, para que las pruebas puedan
 * levantarla en un puerto efímero.
 */
export function createApp(): express.Express {
  const app = express()

  const extra = nombresExtra()
  app.use((req, res, next) => {
    if (hostPermitido(req.headers.host, extra)) return next()
    res.status(403).json({
      error:
        `Esta petición llegó a nombre de "${req.headers.host}", que no es esta máquina. ` +
        'Finply solo contesta a localhost. Si lo pusiste detrás de un dominio propio, ' +
        'nómbralo en FINPLY_HOSTS.',
    })
  })

  app.use(express.json({ limit: LIMITE_CUERPO_BYTES }))

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
  // El prefijo más específico va primero, o '/recurrentes' caería en la ruta
  // '/:id' de facturas.
  app.use('/api/cotizaciones', cotizaciones)
  app.use('/api/facturas/recurrentes', facturasRecurrentes)
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
  app.use('/api/flujo', flujo)
  app.use('/api/conciliacion', conciliacion)
  // Módulos de giro (Fase 15). Las rutas existen siempre, como las tablas: es
  // el lomo el que decide qué se ve (D16), no el servidor.
  app.use('/api/inmuebles', inmuebles)
  app.use('/api/horas', horas)
  app.use('/api/inventario', inventario)
  // Configuración del perfil (Fase 21): campos propios y plantillas. Aquí no
  // se asienta dinero — lo que se escribe con ellos pasa por /api/transactions.
  app.use('/api/personalizacion', personalizacion)
  app.use('/api/respaldo', backup)
  // Sacar los datos (Fase 26): el libro de un perfil en hojas que abre
  // cualquiera. `/api/respaldo` es lo contrario — sirve para volver a entrar.
  app.use('/api/exportar', exportar)

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
      const { status, error } = traducirError(err)
      if (status >= 500) console.error(err)
      res.status(status).json({ error })
    },
  )

  return app
}
