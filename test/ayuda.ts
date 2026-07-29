// Arranca una instancia de Finply contra una base temporal y devuelve un
// cliente HTTP mínimo. Cada archivo de prueba corre en su propio proceso
// (así funciona `node --test`), así que cada uno tiene su libro aislado.
//
// FINPLY_DB se fija ANTES de importar el servidor: db.ts abre la base al
// cargarse, por eso el import es dinámico.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'

export interface Respuesta<T> {
  status: number
  body: T
  headers: Record<string, string>
}

export interface Cliente {
  get: <T = any>(ruta: string) => Promise<Respuesta<T>>
  post: <T = any>(ruta: string, body?: unknown) => Promise<Respuesta<T>>
  patch: <T = any>(ruta: string, body?: unknown) => Promise<Respuesta<T>>
  del: <T = any>(ruta: string) => Promise<Respuesta<T>>
  /** Para respuestas que no son JSON (CSV). Ojo: decodificar como texto se
   *  come el BOM inicial (lo dice el estándar de fetch); para verlo hay que
   *  usar `getBytes`. */
  getText: (ruta: string) => Promise<Respuesta<string>>
  getBytes: (ruta: string) => Promise<Respuesta<Uint8Array>>
  cerrar: () => Promise<void>
}

export async function levantar(): Promise<Cliente> {
  const dir = mkdtempSync(path.join(tmpdir(), 'finply-test-'))
  process.env.FINPLY_DB = path.join(dir, 'prueba.db')

  const { createApp } = await import('../server/app.ts')
  const server: Server = await new Promise((resolve) => {
    const s = createApp().listen(0, '127.0.0.1', () => resolve(s))
  })
  const { port } = server.address() as AddressInfo
  const base = `http://127.0.0.1:${port}`

  const crudo = async (metodo: string, ruta: string, body?: unknown) => {
    const res = await fetch(base + ruta, {
      method: metodo,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { res, texto: await res.text() }
  }

  const cabeceras = (res: Response): Record<string, string> =>
    Object.fromEntries([...res.headers.entries()])

  const pedir = async (metodo: string, ruta: string, body?: unknown) => {
    const { res, texto } = await crudo(metodo, ruta, body)
    return { status: res.status, body: texto ? JSON.parse(texto) : null, headers: cabeceras(res) }
  }

  return {
    get: (ruta) => pedir('GET', ruta),
    post: (ruta, body) => pedir('POST', ruta, body ?? {}),
    patch: (ruta, body) => pedir('PATCH', ruta, body ?? {}),
    del: (ruta) => pedir('DELETE', ruta),
    getText: async (ruta) => {
      const { res, texto } = await crudo('GET', ruta)
      return { status: res.status, body: texto, headers: cabeceras(res) }
    },
    getBytes: async (ruta) => {
      const res = await fetch(base + ruta)
      const bytes = new Uint8Array(await res.arrayBuffer())
      return { status: res.status, body: bytes, headers: cabeceras(res) }
    },
    cerrar: () =>
      new Promise((resolve) => {
        server.close(() => {
          rmSync(dir, { recursive: true, force: true })
          resolve()
        })
      }),
  }
}

/** Perfil + cuenta listos para usar, que es el punto de partida de casi todo. */
/**
 * Un libro con una cuenta y las categorías del alta.
 *
 * El `kind` importa desde la Fase 9: decide el juego de módulos por omisión, y
 * un módulo apagado calla sus alertas y sus eventos de calendario. Las pruebas
 * de negocio piden `'negocio'` porque un libro personal no lleva facturas.
 */
export async function libroBase(c: Cliente, nombre = 'Prueba', kind = 'personal') {
  const perfil = (await c.post('/api/profiles', { name: nombre, kind })).body
  const cuenta = (
    await c.post('/api/accounts', {
      profileId: perfil.id,
      name: 'Banco',
      type: 'banco',
      openingCents: 100000,
    })
  ).body
  const categorias = (await c.get(`/api/categories?profileId=${perfil.id}`)).body
  return { perfil, cuenta, categorias }
}
