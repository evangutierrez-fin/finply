// Cómo se lee y cómo se escribe una cifra de dinero.
//
// Módulo puro, así que el import estático es seguro (R16). Lo que se prueba
// aquí no es el formato bonito: es la frontera del **techo del libro** y la
// frase que la explica. Una cifra que no cabe se rechaza igual con o sin este
// mensaje; lo que cambia es si el usuario entiende por qué, y un formulario que
// contesta "escribe un monto" a quien acaba de escribir un monto es una puerta
// cerrada sin letrero.

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  FORMATO_POR_OMISION,
  MAX_CENTAVOS,
  mensajeMonto,
  montoPasaDelTecho,
  pesosCon,
  sinCeroNegativo,
} from '../shared/formato.ts'

const BASE = 'Escribe un monto válido, por ejemplo 250 o 1,250.50'

describe('el techo del dinero, del lado del formulario', () => {
  test('justo en el tope cabe; un centavo más, no', () => {
    const tope = (MAX_CENTAVOS / 100).toFixed(2)
    assert.equal(montoPasaDelTecho(tope), false, 'el tope exacto tiene que caber')
    assert.equal(montoPasaDelTecho(((MAX_CENTAVOS + 1) / 100).toFixed(2)), true)
  })

  test('una cifra normal no pasa del techo', () => {
    for (const monto of ['250', '1,250.50', '$1,000,000.00', '0.01', '999999999.99']) {
      assert.equal(montoPasaDelTecho(monto), false, `${monto} se rechazó y es una cifra real`)
    }
  })

  test('lo que no es una cantidad no es "pasarse del techo"', () => {
    // La diferencia entera: aquí el mensaje de siempre es el correcto.
    for (const basura of ['', 'abc', '12.345', '1..2', '$$', '10 pesos']) {
      assert.equal(montoPasaDelTecho(basura), false, `${basura} se leyó como cifra grande`)
      assert.equal(mensajeMonto(basura, BASE), BASE)
    }
  })

  test('el que sí se pasa recibe la razón, no la guía', () => {
    const mensaje = mensajeMonto('99999999999999999999', BASE)
    assert.notEqual(mensaje, BASE, 'le contestó que escribiera un monto, y escribió uno')
    assert.match(mensaje, /pasa de/)
    assert.match(mensaje, /Revisa los ceros/)
    // Y la frase trae el techo escrito, no un "es muy grande" a secas.
    assert.match(mensaje, /\$1,000,000,000,000/)
  })

  test('el negativo se mide por su magnitud', () => {
    // El saldo de un corte de conciliación puede ser negativo (D19), y un
    // menos delante no vuelve legible una cifra que no lo es.
    assert.equal(montoPasaDelTecho('-99999999999999999999'), true)
    assert.equal(montoPasaDelTecho('-1250.50'), false)
  })

  test('la frase la decide un solo lugar', () => {
    // Dos formularios con su propia voz reciben la misma razón cuando la razón
    // es la misma: es lo que evita nueve frases distintas del mismo techo.
    const a = mensajeMonto('1e30'.replace('e30', '0'.repeat(30)), 'Escribe un monto válido')
    const b = mensajeMonto('1'.padEnd(31, '0'), 'Escribe un monto para el presupuesto')
    assert.equal(a, b)
  })
})

/**
 * El cero no lleva signo. Es el detalle más pequeño de la auditoría y sale en
 * la pantalla más vista: el Resumen enseña la salida del mes negando el gasto
 * —`-expenseCents`—, y en un mes sin gastos eso es `-0`, que `Intl` escribe
 * "−$0.00". Ni siquiera se pinta en rojo, porque `-0 < 0` es falso.
 */
describe('el cero no tiene signo', () => {
  test('el cero negativo se escribe como cero', () => {
    assert.equal(pesosCon(-0, FORMATO_POR_OMISION), pesosCon(0, FORMATO_POR_OMISION))
    assert.ok(!pesosCon(-0, FORMATO_POR_OMISION).includes('-'))
    assert.ok(!pesosCon(-0, { ...FORMATO_POR_OMISION, sinCentavos: true }).includes('-'))
  })

  test('y un negativo de verdad lo conserva', () => {
    assert.ok(pesosCon(-1, FORMATO_POR_OMISION).includes('-'))
    assert.equal(sinCeroNegativo(-1), -1)
    assert.equal(Object.is(sinCeroNegativo(-0), 0), true, 'siguió siendo -0')
  })
})
