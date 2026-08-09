// La puerta del servidor: quién puede llamar a Finply y con qué nombre.
//
// Es lo único de la app que no habla de dinero. Está aquí porque la promesa
// que Finply hace en Ajustes —"el servidor solo escucha en 127.0.0.1: nadie
// más en tu red alcanza Finply"— es una promesa de seguridad, y una promesa
// de seguridad sin prueba es una frase.

import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'

let server: Server
let puerto: number
let carpeta: string

before(async () => {
  carpeta = mkdtempSync(path.join(tmpdir(), 'finply-puerta-'))
  process.env.FINPLY_DB = path.join(carpeta, 'prueba.db')
  const { createApp } = await import('../server/app.ts')
  server = await new Promise((resolve) => {
    const s = createApp().listen(0, '127.0.0.1', () => resolve(s))
  })
  puerto = (server.address() as AddressInfo).port
})
after(
  () =>
    new Promise<void>((resolve) => {
      server.close(() => {
        rmSync(carpeta, { recursive: true, force: true })
        resolve()
      })
    }),
)

/**
 * Una petición con la cabecera `Host` que se le diga.
 *
 * No se puede hacer con `fetch`: `Host` es una cabecera prohibida y el cliente
 * la reemplaza en silencio, así que una prueba escrita con `fetch` pasaría
 * igual estuviera el arreglo o no. Va por `node:http`, que sí la manda.
 */
function pedirComo(host: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: puerto,
        path: '/api/profiles',
        method: 'GET',
        headers: { Host: host },
      },
      (res) => {
        let body = ''
        res.on('data', (c) => (body += c))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
      },
    )
    req.on('error', reject)
    req.end()
  })
}

describe('a nombre de quién llega la petición', () => {
  /**
   * Finply no pide contraseña porque escucha solo en la máquina. Eso es cierto
   * para la red y **falso para el navegador**: una página puede resolver su
   * propio dominio a `127.0.0.1` —DNS rebinding— y desde ese momento el
   * navegador la trata como del mismo origen. Sin contraseña y sin CORS que
   * estorbe, esa página lee el libro entero: cuentas, saldos, contrapartes.
   *
   * Lo único que no puede falsear es el nombre, porque para rebotar el DNS
   * necesita un dominio suyo.
   */
  test('un dominio ajeno no pasa, aunque llegue al puerto', async () => {
    const r = await pedirComo('malicioso.example:4321')
    assert.equal(r.status, 403, 'una página cualquiera puede leer el libro entero')
    assert.match(r.body, /localhost/)
  })

  test('localhost y las IP literales sí, que es como se usa de verdad', async () => {
    for (const host of ['localhost:4321', '127.0.0.1:4321', '[::1]:4321', '192.168.1.7:4321']) {
      const r = await pedirComo(host)
      assert.equal(r.status, 200, `${host} quedó fuera y es un uso legítimo`)
    }
  })

  /**
   * Una IP se deja pasar a propósito: quien puso `API_HOST=0.0.0.0` llega por
   * la IP de su máquina, y contra una IP no hay DNS que rebotar. La regla no
   * es "solo loopback": es "nada que dependa de un DNS ajeno".
   */
  test('la regla mira el nombre, no el puerto ni las mayúsculas', async () => {
    const { hostPermitido } = await import('../server/app.ts')
    assert.equal(hostPermitido('LocalHost:4321'), true)
    assert.equal(hostPermitido('127.0.0.1'), true)
    assert.equal(hostPermitido('[::1]:99'), true)
    assert.equal(hostPermitido('finply.local'), false)
    assert.equal(hostPermitido('finply.local', ['finply.local']), true, 'FINPLY_HOSTS no sirvió')
    assert.equal(hostPermitido(':4321'), false, 'un Host sin nombre no es un nombre')
    // Sin `Host` no hay navegador del otro lado: no es la vía del ataque.
    assert.equal(hostPermitido(undefined), true)
  })
})
