// Contraste y tinta personalizada.
//
// El import de `shared/color.ts` es estático a propósito: es un módulo puro que
// no llega a `db.ts` (R16), así que no puede abrir el libro real ni por
// accidente. Lo que sí toca la base —guardar una tinta— pasa por `levantar()`,
// que fija FINPLY_DB antes de importar nada del servidor.

import { after, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  AA_TEXTO,
  PRESETS,
  SUPERFICIES,
  contraste,
  evaluarTinta,
  normalizarHex,
  parseHex,
} from '../shared/color.ts'
import { levantar, type Cliente } from './ayuda.ts'

describe('aritmética de contraste', () => {
  test('los extremos conocidos de WCAG', () => {
    assert.equal(contraste('#ffffff', '#000000'), 21, 'blanco contra negro es el máximo')
    assert.equal(contraste('#ffffff', '#ffffff'), 1, 'un color contra sí mismo es 1')
    assert.equal(contraste('#000000', '#ffffff'), 21, 'no depende del orden')
  })

  test('lee hex corto, largo y con mayúsculas', () => {
    assert.deepEqual(parseHex('#abc'), parseHex('#aabbcc'))
    assert.deepEqual(parseHex('#1D5C3D'), { r: 29, g: 92, b: 61 })
    assert.equal(normalizarHex('#ABC'), '#aabbcc')
    assert.equal(normalizarHex('  #1D5C3D '), '#1d5c3d')
  })

  test('lo que no es un color no lo es', () => {
    for (const basura of ['', 'rojo', '#12', '#1234567', 'javascript:alert(1)', '#zzzzzz']) {
      assert.equal(parseHex(basura), null, `"${basura}" no es un color`)
      assert.equal(normalizarHex(basura), null)
    }
    assert.equal(contraste('rojo', '#ffffff'), 0, 'sin color no hay contraste que medir')
  })
})

describe('las tintas de Finply cumplen lo que Finply exige', () => {
  // Medido, no supuesto: si algún día alguien cambia un preset por uno más
  // pálido, esta prueba lo detiene antes de que llegue a una vista.
  for (const [nombre, par] of Object.entries(PRESETS)) {
    test(`${nombre} se lee en los dos temas`, () => {
      const claro = evaluarTinta(par.claro, 'claro')
      const oscuro = evaluarTinta(par.oscuro, 'oscuro')
      assert.ok(claro.cumple, `${par.claro} da ${claro.ratio}:1 contra ${claro.contra}`)
      assert.ok(oscuro.cumple, `${par.oscuro} da ${oscuro.ratio}:1 contra ${oscuro.contra}`)
    })
  }

  test('ningún color solo sirve para los dos temas', () => {
    // Es la razón de que la tinta propia sean dos colores y no uno. Malla de
    // 5 en 5 sobre los tres canales: 140,608 colores.
    let ambos = 0
    for (let r = 0; r < 256; r += 5) {
      for (let g = 0; g < 256; g += 5) {
        for (let b = 0; b < 256; b += 5) {
          const hex = `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`
          if (evaluarTinta(hex, 'claro').cumple && evaluarTinta(hex, 'oscuro').cumple) ambos++
        }
      }
    }
    assert.equal(ambos, 0, 'si alguno cumpliera, la tinta propia podría ser un solo color')
  })

  test('manda la peor superficie, no el papel', () => {
    // En el tema oscuro la hoja es más clara que el papel: una tinta que solo
    // se midiera contra el papel podría perderse encima de una tarjeta.
    const casi = '#3e7a58'
    assert.ok(
      contraste(casi, SUPERFICIES.oscuro.papel) > contraste(casi, SUPERFICIES.oscuro.hoja),
      'la hoja oscura es el caso difícil',
    )
    const v = evaluarTinta(casi, 'oscuro')
    assert.equal(v.contra, 'la hoja')
    assert.ok(!v.cumple, `${v.ratio}:1 contra la hoja no alcanza ${AA_TEXTO}:1`)
  })
})

describe('la frontera de AA', () => {
  // El umbral se prueba por los dos lados: lo que da exactamente 4.5 pasa, y
  // un pelo menos no. Se buscan los dos grises vecinos sobre el papel claro.
  test('4.5:1 exacto cumple; menos, no', () => {
    let ultimoQueCumple: string | null = null
    let primeroQueFalla: string | null = null
    for (let g = 0; g < 256; g++) {
      const hex = `#${g.toString(16).padStart(2, '0').repeat(3)}`
      if (evaluarTinta(hex, 'claro').cumple) ultimoQueCumple = hex
      else if (ultimoQueCumple && !primeroQueFalla) primeroQueFalla = hex
    }
    assert.ok(ultimoQueCumple && primeroQueFalla, 'hay una frontera entre los grises')
    assert.ok(evaluarTinta(ultimoQueCumple!, 'claro').ratio >= AA_TEXTO)
    assert.ok(evaluarTinta(primeroQueFalla!, 'claro').ratio < AA_TEXTO)
  })
})

describe('guardar una tinta propia', () => {
  let c: Cliente
  after(() => c?.cerrar())

  test('la que se lee se guarda; la que no, se rechaza', async () => {
    c = await levantar()
    const perfil = (await c.post('/api/profiles', { name: 'Tinta', kind: 'personal' })).body
    assert.equal(perfil.accentHex, null, 'un perfil nace con el preset')
    assert.equal(perfil.accentHexDark, null)

    const ok = await c.patch(`/api/profiles/${perfil.id}`, {
      accentHex: '#2C4A74',
      accentHexDark: '#88ABD8',
    })
    assert.equal(ok.status, 200)
    assert.equal(ok.body.accentHex, '#2c4a74', 'se guarda normalizada')
    assert.equal(ok.body.accentHexDark, '#88abd8')

    // Un amarillo pastel sobre papel claro: bonito e ilegible.
    const pálida = await c.patch(`/api/profiles/${perfil.id}`, { accentHex: '#f0e68c' })
    assert.equal(pálida.status, 400)
    assert.match(pálida.body.error, /4\.5:1/)

    // Y el mismo color por el otro lado: un verde oscuro sobre papel oscuro.
    const oscura = await c.patch(`/api/profiles/${perfil.id}`, { accentHexDark: '#123a24' })
    assert.equal(oscura.status, 400)

    const sigue = (await c.get('/api/profiles')).body[0]
    assert.equal(sigue.accentHex, '#2c4a74', 'un rechazo no pisa la tinta que ya estaba')

    const basura = await c.patch(`/api/profiles/${perfil.id}`, { accentHex: 'rojo bonito' })
    assert.equal(basura.status, 400)
    assert.match(basura.body.error, /hex/)
  })

  test('null vuelve al preset y ausente no opina', async () => {
    const perfil = (await c.post('/api/profiles', { name: 'Otro', kind: 'personal' })).body
    await c.patch(`/api/profiles/${perfil.id}`, {
      accentHex: '#7c2f42',
      accentHexDark: '#cd7f92',
    })

    const soloNombre = await c.patch(`/api/profiles/${perfil.id}`, { name: 'Renombrado' })
    assert.equal(soloNombre.body.accentHex, '#7c2f42', 'no mandar la tinta la deja como estaba')

    const quitada = await c.patch(`/api/profiles/${perfil.id}`, {
      accentHex: null,
      accentHexDark: null,
    })
    assert.equal(quitada.body.accentHex, null)
    assert.equal(quitada.body.accentHexDark, null)
  })

  test('la tinta viaja en el respaldo', async () => {
    const snapshot = (await c.get('/api/respaldo')).body
    const conTinta = snapshot.tables.profiles.find((p: any) => p.accent_hex === '#2c4a74')
    assert.ok(conTinta, 'el respaldo lleva las columnas nuevas')

    const restaurado = await c.post('/api/respaldo/restaurar', snapshot)
    assert.equal(restaurado.status, 200)
    const perfiles = (await c.get('/api/profiles')).body
    assert.ok(
      perfiles.some((p: any) => p.accentHex === '#2c4a74'),
      'y las devuelve al restaurar',
    )
  })
})
