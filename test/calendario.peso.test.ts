// Lo que pesa una ventana de vencimientos.
//
// El Calendario y el Flujo miran **los mismos eventos en la misma ventana**, y
// hasta la cuarta vuelta decían cosas distintas: el Flujo los partía en "va a
// entrar" y "va a salir", y el Calendario los sumaba todos en una cifra
// —"Compromisos en 30 días"— que juntaba lo que un cliente te va a pagar con
// lo que tú vas a pagar. Nadie tiene un compromiso de cobrar.

import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { levantar, libroBase, type Cliente } from './ayuda.ts'
import { pesoDeEventos } from '../shared/calendario.ts'

describe('el peso de una ventana, en frío', () => {
  test('cada dirección por su lado, y lo que no tiene monto no se supone', () => {
    const peso = pesoDeEventos([
      { montoCents: 21_266_67, direccion: 'entra' },
      { montoCents: 2_400_00, direccion: 'entra' },
      { montoCents: 3_500_00, direccion: 'sale' },
      { montoCents: null, direccion: 'sale' },
    ])
    assert.deepEqual(peso, { entraCents: 23_666_67, saleCents: 3_500_00, sinMonto: 1 })
    assert.notEqual(peso.entraCents + peso.saleCents, peso.saleCents, 'sumarlas no describe nada')
  })

  test('una ventana vacía pesa cero por los dos lados', () => {
    assert.deepEqual(pesoDeEventos([]), { entraCents: 0, saleCents: 0, sinMonto: 0 })
  })
})

describe('el calendario y el flujo pesan la misma ventana igual', () => {
  let c: Cliente
  before(async () => {
    c = await levantar()
  })
  after(() => c.cerrar())

  const HOY = '2026-08-09'

  test('lo que sale y lo que entra son las mismas dos cifras en las dos vistas', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Ventana', 'negocio')
    const cliente = (
      await c.post('/api/contrapartes', { profileId: perfil.id, name: 'ACME', kind: 'cliente' })
    ).body
    const proveedor = (
      await c.post('/api/contrapartes', { profileId: perfil.id, name: 'Molino', kind: 'proveedor' })
    ).body

    // Una que cobras y otra que pagas, las dos dentro de la ventana.
    await c.post('/api/facturas', {
      profileId: perfil.id, direction: 'emitida', counterpartyId: cliente.id,
      issueDate: '2026-08-01', dueDate: '2026-08-20', concept: 'Pedido',
      subtotalCents: 20_000_00, taxCents: 0,
    })
    await c.post('/api/facturas', {
      profileId: perfil.id, direction: 'recibida', counterpartyId: proveedor.id,
      issueDate: '2026-08-01', dueDate: '2026-08-25', concept: 'Harina',
      subtotalCents: 3_000_00, taxCents: 0,
    })
    assert.ok(cuenta.id)

    const cal = (await c.get(`/api/calendario?profileId=${perfil.id}&dias=30&hoy=${HOY}`)).body
    const flujo = (await c.get(`/api/flujo?profileId=${perfil.id}&dias=30&hoy=${HOY}`)).body
    const peso = pesoDeEventos(cal.eventos)

    assert.equal(peso.entraCents, 20_000_00)
    assert.equal(peso.saleCents, 3_000_00)
    // Y es lo mismo que dice el Flujo, que mira la misma ventana.
    assert.equal(peso.entraCents, flujo.entradasCents, 'el calendario y el flujo no coinciden')
    assert.equal(peso.saleCents, flujo.salidasCents, 'el calendario y el flujo no coinciden')

    // La cifra vieja —la suma de las dos— no es ninguna de las dos.
    const sumaVieja = cal.eventos.reduce((s: number, e: any) => s + (e.montoCents ?? 0), 0)
    assert.equal(sumaVieja, 23_000_00)
    assert.notEqual(sumaVieja, peso.saleCents)
    assert.notEqual(sumaVieja, peso.entraCents)
  })
})
