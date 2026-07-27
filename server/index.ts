import { createApp } from './app.ts'
import { writeRotatingSnapshot } from './backup.ts'

const PORT = Number(process.env.API_PORT ?? 4321)

// Solo la máquina local, siempre. Finply no pide contraseña porque asume que
// nadie más lo alcanza: escuchando en 0.0.0.0, cualquiera en la misma red WiFi
// —un café, un coworking— podría leer y escribir tu libro entero.
// Para exponerlo a propósito: API_HOST=0.0.0.0, sabiendo lo que implica.
const HOST = process.env.API_HOST ?? '127.0.0.1'

const snapshot = writeRotatingSnapshot()

createApp().listen(PORT, HOST, () => {
  console.log(`[finply] API escuchando en http://${HOST}:${PORT}`)
  if (snapshot) console.log(`[finply] respaldo del día en ${snapshot}`)
  if (HOST === '0.0.0.0') {
    console.warn('[finply] ⚠ escuchando en toda la red: cualquiera con tu IP entra sin contraseña')
  }
})
