// Fase 23 · Taxonomía II: subcategorías, archivar y reglas de import.
//
// Lo que estas pruebas cuidan es **D25 y sus tres consecuencias**. La jerarquía
// en sí es una columna; lo que puede romper un libro es lo otro:
//
//   · un reporte que sume al padre y no deje ver al hijo,
//   · un papel que no se herede y saque un gasto del costo de ventas,
//   · un tope que no cuente lo que cuelga de él,
//   · un archivado que pierda algo.
//
// Las tres herencias existen por el mismo motivo, y por eso se prueban juntas:
// **crear una subcategoría no puede mover una cifra en silencio** (R18).
//
// Y las reglas de import son R4 otra vez: proponen, no asientan. Hay prueba de
// que una regla no escribe una fila por su cuenta y de que el archivo le gana.

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { levantar, libroBase, type Cliente } from './ayuda.ts'
import { agruparPorPadre, rotuloCategoria } from '../shared/taxonomia.ts'

const suma = (xs: number[]) => xs.reduce((s, x) => s + x, 0)

// ── El plegado, sin base de datos de por medio ────────────────────────────

describe('plegar un desglose al padre', () => {
  test('las hojas se suman en su padre y el desglose sobrevive', () => {
    const grupos = agruparPorPadre([
      { name: 'Restaurante', padre: 'Comida', cents: 300 },
      { name: 'Café', padre: 'Comida', cents: 100 },
      { name: 'Renta', padre: null, cents: 1000 },
      { name: 'Comida', padre: null, cents: 50 },
    ])
    assert.equal(grupos.length, 2)
    assert.deepEqual(grupos[0], { name: 'Renta', cents: 1000, hijos: [] })
    assert.equal(grupos[1]!.name, 'Comida')
    // Lo gastado directamente en el padre **más** lo de sus hijas.
    assert.equal(grupos[1]!.cents, 450)
    assert.deepEqual(grupos[1]!.hijos, [
      { name: 'Restaurante', cents: 300 },
      { name: 'Café', cents: 100 },
    ])
  })

  test('un padre en el que nadie gastó directo entra igual, con lo de sus hijas', () => {
    const grupos = agruparPorPadre([{ name: 'Café', padre: 'Comida', cents: 700 }])
    assert.deepEqual(grupos, [{ name: 'Comida', cents: 700, hijos: [{ name: 'Café', cents: 700 }] }])
  })

  test('el total no cambia al plegar: es la invariante entera', () => {
    const hojas = [
      { name: 'A', padre: 'P', cents: 111 },
      { name: 'B', padre: 'P', cents: -50 },
      { name: 'C', padre: null, cents: 999 },
    ]
    assert.equal(
      suma(agruparPorPadre(hojas).map((g) => g.cents)),
      suma(hojas.map((h) => h.cents)),
    )
  })

  test('ordena por magnitud, no por signo: una categoría en negativo no se esconde', () => {
    const grupos = agruparPorPadre([
      { name: 'Chica', padre: null, cents: 100 },
      { name: 'Devuelta', padre: null, cents: -9000 },
    ])
    assert.equal(grupos[0]!.name, 'Devuelta')
  })

  test('el rótulo usa el separador que la gente ya escribía a mano', () => {
    assert.equal(rotuloCategoria({ name: 'Restaurante', parentName: 'Comida' }), 'Comida · Restaurante')
    assert.equal(rotuloCategoria({ name: 'Renta', parentName: null }), 'Renta')
    assert.equal(rotuloCategoria({ name: 'Renta' }), 'Renta')
  })
})

// ── La jerarquía contra el libro ──────────────────────────────────────────

describe('subcategorías: un solo nivel', () => {
  let c: Cliente
  let perfil: any
  let comida: number
  let restaurante: number

  before(async () => {
    c = await levantar()
    const base = await libroBase(c)
    perfil = base.perfil
    comida = base.categorias.find((x: any) => x.name === 'Comida').id
    restaurante = (
      await c.post('/api/categories', {
        profileId: perfil.id,
        name: 'Restaurante',
        kind: 'gasto',
        parentId: comida,
      })
    ).body.id
  })

  after(() => c.cerrar())

  test('la hija sabe de quién cuelga y el padre sabe cuántas tiene', async () => {
    const lista = (await c.get(`/api/categories?profileId=${perfil.id}`)).body
    const hija = lista.find((x: any) => x.id === restaurante)
    const padre = lista.find((x: any) => x.id === comida)
    assert.equal(hija.parentId, comida)
    assert.equal(hija.parentName, 'Comida')
    assert.equal(padre.hijos, 1)
    assert.equal(padre.parentId, null)
  })

  test('un padre no puede tener padre: ahí se corta el árbol', async () => {
    const nieta = await c.post('/api/categories', {
      profileId: perfil.id,
      name: 'Cena',
      kind: 'gasto',
      parentId: restaurante,
    })
    assert.equal(nieta.status, 400)
    assert.match(nieta.body.error, /un solo nivel/i)
  })

  test('y la que ya tiene hijas tampoco puede volverse hija', async () => {
    const otra = (
      await c.post('/api/categories', { profileId: perfil.id, name: 'Salidas', kind: 'gasto' })
    ).body
    const res = await c.patch(`/api/categories/${comida}`, { parentId: otra.id })
    assert.equal(res.status, 400)
    assert.match(res.body.error, /subcategoría/i)
  })

  test('una subcategoría es del mismo tipo que su padre', async () => {
    const sueldo = (await c.get(`/api/categories?profileId=${perfil.id}`)).body.find(
      (x: any) => x.name === 'Sueldo',
    )
    const res = await c.post('/api/categories', {
      profileId: perfil.id,
      name: 'Bono',
      kind: 'gasto',
      parentId: sueldo.id,
    })
    assert.equal(res.status, 400)
    assert.match(res.body.error, /mismo tipo/i)
  })

  test('no puede colgar de sí misma, ni de una categoría ajena', async () => {
    const sola = await c.patch(`/api/categories/${restaurante}`, { parentId: restaurante })
    assert.equal(sola.status, 400)

    const otroPerfil = (await c.post('/api/profiles', { name: 'Otro', kind: 'personal' })).body
    const ajena = (await c.get(`/api/categories?profileId=${otroPerfil.id}`)).body.find(
      (x: any) => x.name === 'Comida',
    )
    const res = await c.patch(`/api/categories/${restaurante}`, { parentId: ajena.id })
    assert.equal(res.status, 400)
    assert.match(res.body.error, /no pertenece/i)
  })

  test('el PATCH cambia solo lo que se manda', async () => {
    // El hallazgo 3 de la auditoría de la Fase 22: hasta hoy, cambiar el papel
    // exigía mandar el nombre y sin él respondía 400.
    const soloRol = await c.patch(`/api/categories/${restaurante}`, { role: 'gasto_variable' })
    assert.equal(soloRol.status, 200)
    assert.equal(soloRol.body.name, 'Restaurante', 'el nombre no se tocó')
    assert.equal(soloRol.body.role, 'gasto_variable')
    assert.equal(soloRol.body.parentId, comida, 'el padre tampoco')

    const soloNombre = await c.patch(`/api/categories/${restaurante}`, { name: 'Restaurantes' })
    assert.equal(soloNombre.body.role, 'gasto_variable', 'el papel sigue ahí')
    assert.equal(soloNombre.body.parentId, comida)
    await c.patch(`/api/categories/${restaurante}`, { name: 'Restaurante', role: null })

    // Y `null` explícito sí la saca del padre, que es distinto de no opinar.
    const suelta = await c.patch(`/api/categories/${restaurante}`, { parentId: null })
    assert.equal(suelta.body.parentId, null)
    await c.patch(`/api/categories/${restaurante}`, { parentId: comida })
  })
})

// ── Lo que se hereda ──────────────────────────────────────────────────────

describe('lo que una subcategoría hereda de su padre', () => {
  let c: Cliente
  let perfil: any
  let banco: any
  let insumos: number
  let materiales: number

  before(async () => {
    c = await levantar()
    const base = await libroBase(c, 'Taller', 'negocio')
    perfil = base.perfil
    banco = base.cuenta
    insumos = base.categorias.find((x: any) => x.name === 'Insumos').id
    await c.patch(`/api/categories/${insumos}`, { role: 'costo_venta' })
    materiales = (
      await c.post('/api/categories', {
        profileId: perfil.id,
        name: 'Materiales',
        kind: 'gasto',
        parentId: insumos,
      })
    ).body.id
    await c.post('/api/transactions', {
      profileId: perfil.id,
      accountId: banco.id,
      type: 'gasto',
      amountCents: 300_000,
      date: '2026-05-10',
      categoryId: materiales,
      note: 'Madera',
    })
    await c.post('/api/transactions', {
      profileId: perfil.id,
      accountId: banco.id,
      type: 'gasto',
      amountCents: 100_000,
      date: '2026-05-11',
      categoryId: insumos,
      note: 'Tornillos',
    })
  })

  after(() => c.cerrar())

  test('el papel se hereda, y por eso el gasto no se sale del costo de ventas', async () => {
    const lista = (await c.get(`/api/categories?profileId=${perfil.id}`)).body
    const hija = lista.find((x: any) => x.id === materiales)
    assert.equal(hija.role, null, 'no tiene papel propio')
    assert.equal(hija.rolEfectivo, 'costo_venta', 'y toma el de su padre')

    const pl = (
      await c.get(`/api/negocio/resultados?profileId=${perfil.id}&desde=2026-05-01&hasta=2026-05-31`)
    ).body
    // Los $4,000 completos son costo de ventas. Sin la herencia, $3,000 se
    // habrían ido a "sin clasificar" y el punto de equilibrio se habría movido
    // por crear una subcategoría — que es justo lo que R18 prohíbe.
    assert.equal(pl.costoVentaCents, 400_000)
    assert.equal(pl.sinClasificarCents, 0)
  })

  test('pero el papel propio manda sobre el heredado', async () => {
    await c.patch(`/api/categories/${materiales}`, { role: 'gasto_fijo' })
    const pl = (
      await c.get(`/api/negocio/resultados?profileId=${perfil.id}&desde=2026-05-01&hasta=2026-05-31`)
    ).body
    assert.equal(pl.costoVentaCents, 100_000)
    assert.equal(pl.gastoFijoCents, 300_000)
    await c.patch(`/api/categories/${materiales}`, { role: null })
  })

  test('un tope al padre cuenta lo gastado en sus hijas', async () => {
    await c.post('/api/budgets', {
      profileId: perfil.id,
      categoryId: insumos,
      period: '2026-05',
      periodKind: 'mes',
      amountCents: 500_000,
    })
    const p = (await c.get(`/api/budgets?profileId=${perfil.id}&month=2026-05`)).body
    const fila = p.mensuales.find((b: any) => b.categoryId === insumos)
    // Un techo que no cuenta lo que cuelga de él no es un techo.
    assert.equal(fila.spentCents, 400_000)
  })

  test('y el tope de la hija sigue midiendo solo lo suyo', async () => {
    await c.post('/api/budgets', {
      profileId: perfil.id,
      categoryId: materiales,
      period: '2026-05',
      periodKind: 'mes',
      amountCents: 250_000,
    })
    const p = (await c.get(`/api/budgets?profileId=${perfil.id}&month=2026-05`)).body
    assert.equal(p.mensuales.find((b: any) => b.categoryId === materiales).spentCents, 300_000)
    // El del padre no cambió: ese gasto se mide contra los dos topes, que es
    // exactamente lo que un presupuesto anidado significa.
    assert.equal(p.mensuales.find((b: any) => b.categoryId === insumos).spentCents, 400_000)
  })

  test('archivar se hereda: el padre se lleva su grupo, y devolverlo lo devuelve', async () => {
    await c.patch(`/api/categories/${insumos}`, { archived: true })
    const archivadas = (await c.get(`/api/categories?profileId=${perfil.id}`)).body
    const hija = archivadas.find((x: any) => x.id === materiales)
    assert.equal(hija.archived, false, 'la hija no se archivó')
    assert.equal(hija.fueraDelSelector, true, 'pero sale del selector con su padre')

    // Y no se perdió nada: sus movimientos y su tope siguen ahí.
    const p = (await c.get(`/api/budgets?profileId=${perfil.id}&month=2026-05`)).body
    assert.equal(p.mensuales.find((b: any) => b.categoryId === insumos).spentCents, 400_000)

    await c.patch(`/api/categories/${insumos}`, { archived: false })
    const vueltas = (await c.get(`/api/categories?profileId=${perfil.id}`)).body
    assert.equal(vueltas.find((x: any) => x.id === materiales).fueraDelSelector, false)
    assert.equal(vueltas.find((x: any) => x.id === insumos).archived, false)
  })

  test('una categoría archivada sigue aceptándose al corregir un movimiento viejo', async () => {
    // R17 en su forma más concreta: archivar **oculta**, y si el servidor
    // rechazara la categoría archivada, corregirle la fecha a una partida vieja
    // sería imposible. La lista la esconde; la API la acepta.
    await c.patch(`/api/categories/${materiales}`, { archived: true })
    const movimientos = (await c.get(`/api/transactions?profileId=${perfil.id}`)).body
    const madera = movimientos.find((t: any) => t.note === 'Madera')
    const res = await c.patch(`/api/transactions/${madera.id}`, {
      profileId: perfil.id,
      accountId: banco.id,
      type: 'gasto',
      amountCents: 300_000,
      date: '2026-05-12',
      categoryId: materiales,
      note: 'Madera',
    })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(res.body.categoryId, materiales)
    await c.patch(`/api/categories/${materiales}`, { archived: false })
  })

  test('borrar el padre promueve a sus hijas en vez de llevárselas', async () => {
    const res = await c.del(`/api/categories/${insumos}?force=true`)
    assert.equal(res.status, 200)
    assert.equal(res.body.hijosPromovidos, 1)
    const lista = (await c.get(`/api/categories?profileId=${perfil.id}`)).body
    const hija = lista.find((x: any) => x.id === materiales)
    assert.ok(hija, 'la hija sigue existiendo')
    assert.equal(hija.parentId, null, 'y quedó como principal')
    // Su movimiento tampoco se fue.
    const movimientos = (await c.get(`/api/transactions?profileId=${perfil.id}`)).body
    assert.ok(movimientos.some((t: any) => t.categoryId === materiales))
  })
})

// ── Los reportes agregan al padre y dejan ver al hijo ─────────────────────

describe('los reportes suman al padre, con su desglose', () => {
  let c: Cliente
  let perfil: any
  let banco: any
  let comida: number
  let restaurante: number
  let cafe: number

  before(async () => {
    c = await levantar()
    const base = await libroBase(c)
    perfil = base.perfil
    banco = base.cuenta
    comida = base.categorias.find((x: any) => x.name === 'Comida').id
    restaurante = (
      await c.post('/api/categories', {
        profileId: perfil.id, name: 'Restaurante', kind: 'gasto', parentId: comida,
      })
    ).body.id
    cafe = (
      await c.post('/api/categories', {
        profileId: perfil.id, name: 'Café', kind: 'gasto', parentId: comida,
      })
    ).body.id
    const renta = base.categorias.find((x: any) => x.name === 'Renta').id

    const gastar = (cents: number, cat: number, dia: string, note: string) =>
      c.post('/api/transactions', {
        profileId: perfil.id, accountId: banco.id, type: 'gasto',
        amountCents: cents, date: dia, categoryId: cat, note,
      })
    await gastar(50_000, comida, '2026-03-02', 'Tacos')
    await gastar(300_000, restaurante, '2026-03-05', 'Cena')
    await gastar(100_000, cafe, '2026-03-09', 'Café')
    await gastar(1_000_000, renta, '2026-03-01', 'Renta')
  })

  after(() => c.cerrar())

  test('el reporte anual agrega al padre y cuelga el desglose', async () => {
    const r = (await c.get(`/api/reportes?profileId=${perfil.id}&year=2026`)).body
    const grupo = r.porCategoria.find((x: any) => x.name === 'Comida')
    assert.equal(grupo.expenseCents, 450_000, 'lo suyo más lo de sus hijas')
    assert.deepEqual(
      grupo.hijos.map((h: any) => [h.name, h.expenseCents]),
      [['Restaurante', 300_000], ['Café', 100_000]],
    )
    // Y la invariante de siempre: el desglose sigue sumando el total del año.
    assert.equal(
      suma(r.porCategoria.map((x: any) => x.expenseCents)),
      r.totales.expenseCents,
    )
    // Sin la jerarquía habría tres renglones sueltos; con ella, dos.
    assert.equal(r.porCategoria.length, 2)
  })

  test('el Resumen del mes cuenta lo mismo, con el mismo desglose', async () => {
    const s = (await c.get(`/api/summary?profileId=${perfil.id}&month=2026-03&hoy=2026-03-31`)).body
    const grupo = s.byCategory.find((x: any) => x.name === 'Comida')
    assert.equal(grupo.expenseCents, 450_000)
    assert.equal(grupo.hijos.length, 2)
    assert.equal(suma(s.byCategory.map((x: any) => x.expenseCents)), s.expenseCents)
  })

  test('la concentración del análisis mide el grupo, no la hoja', async () => {
    const a = (await c.get(`/api/analisis?profileId=${perfil.id}&meses=12&hoy=2027-01-15`)).body
    const grupo = a.concentracion.find((x: any) => x.name === 'Comida')
    assert.equal(grupo.expenseCents, 450_000)
    // Partir "Comida" en tres es la forma más segura de que ninguna se vea
    // concentrada; plegarla es lo que hace que la cifra siga significando algo.
    assert.ok(Math.abs(suma(a.concentracion.map((x: any) => x.parte)) - 1) < 1e-9)
  })

  test('la comparativa también compara grupos', async () => {
    const q = `profileId=${perfil.id}&desde=2026-03&hasta=2026-03&contraDesde=2026-02&contraHasta=2026-02`
    const comp = (await c.get(`/api/reportes/comparativa?${q}`)).body
    const fila = comp.categorias.find((x: any) => x.name === 'Comida')
    assert.equal(fila.actualCents, 450_000)
    assert.equal(fila.previoCents, 0)
    assert.ok(!comp.categorias.some((x: any) => x.name === 'Restaurante'))
  })
})

// ── Las reglas de import ──────────────────────────────────────────────────

describe('reglas que proponen categoría al importar', () => {
  let c: Cliente
  let perfil: any
  let cuenta: any
  let superId: number
  let transporte: number

  const csv = [
    'fecha,concepto,monto',
    '2026-04-01,PAGO EN OXXO SUC 4412,-120.50',
    '2026-04-02,UBER TRIP HELP.UBER.COM,-89.00',
    '2026-04-03,ALGO QUE NADIE CONOCE,-45.00',
  ].join('\n')

  before(async () => {
    c = await levantar()
    const base = await libroBase(c)
    perfil = base.perfil
    cuenta = base.cuenta
    superId = base.categorias.find((x: any) => x.name === 'Súper').id
    transporte = base.categorias.find((x: any) => x.name === 'Transporte').id
  })

  after(() => c.cerrar())

  const previa = () =>
    c.post('/api/importaciones/previsualizar', {
      profileId: perfil.id,
      csv,
      cuentaPorOmision: cuenta.id,
      crearCategorias: false,
      crearEtiquetas: false,
      omitirDuplicadas: true,
    })

  test('sin reglas, ninguna fila trae categoría', async () => {
    const res = await previa()
    assert.equal(res.status, 200)
    assert.equal(res.body.resumen.propuestasPorRegla, 0)
    assert.ok(res.body.filas.every((f: any) => f.categoryName === ''))
  })

  test('la regla propone, y se ve quién la propuso', async () => {
    await c.post('/api/categories/reglas', {
      profileId: perfil.id, pattern: 'OXXO', categoryId: superId,
    })
    await c.post('/api/categories/reglas', {
      profileId: perfil.id, pattern: 'uber', categoryId: transporte,
    })
    const res = await previa()
    const filas = res.body.filas
    assert.equal(filas[0].categoryName, 'Súper')
    assert.equal(filas[0].reglaPattern, 'OXXO')
    // Sin acentos ni mayúsculas: "uber" casa con "UBER TRIP".
    assert.equal(filas[1].categoryName, 'Transporte')
    assert.equal(filas[2].categoryName, '', 'lo que no casa se queda sin categoría')
    assert.equal(res.body.resumen.propuestasPorRegla, 2)
  })

  test('proponer no es asentar: la vista previa no escribe una fila (R4)', async () => {
    await previa()
    await previa()
    const movimientos = (await c.get(`/api/transactions?profileId=${perfil.id}`)).body
    assert.equal(movimientos.length, 0)
  })

  test('gana la primera que case, y el orden lo pone el usuario', async () => {
    const especifica = (
      await c.post('/api/categories/reglas', {
        profileId: perfil.id, pattern: 'OXXO SUC 4412', categoryId: transporte,
      })
    ).body
    // Nació al final, así que "OXXO" sigue ganando.
    assert.equal((await previa()).body.filas[0].categoryName, 'Súper')

    // Subirla al frente cambia la respuesta, que es para lo que sirve el orden.
    // Se **intercambian** las dos posiciones, como hace la vista: bajarle el
    // número a una sola dejaría dos empatadas, y además la posición no puede
    // ser negativa.
    const oxxo = (await c.get(`/api/categories/reglas?profileId=${perfil.id}`)).body.find(
      (r: any) => r.pattern === 'OXXO',
    )
    const subir = await c.patch(`/api/categories/reglas/${especifica.id}`, {
      position: oxxo.position,
    })
    assert.equal(subir.status, 200)
    assert.equal(
      (await c.patch(`/api/categories/reglas/${oxxo.id}`, { position: especifica.position })).status,
      200,
    )
    const res = await previa()
    assert.equal(res.body.filas[0].categoryName, 'Transporte')
    assert.equal(res.body.filas[0].reglaPattern, 'OXXO SUC 4412')
    await c.del(`/api/categories/reglas/${especifica.id}`)
  })

  test('el archivo manda: una regla no pisa la categoría que ya venía', async () => {
    const conCategoria = [
      'fecha,concepto,categoria,monto',
      '2026-04-01,PAGO EN OXXO SUC 4412,Transporte,-120.50',
    ].join('\n')
    const res = await c.post('/api/importaciones/previsualizar', {
      profileId: perfil.id,
      csv: conCategoria,
      cuentaPorOmision: cuenta.id,
      crearCategorias: false,
      crearEtiquetas: false,
      omitirDuplicadas: true,
    })
    assert.equal(res.body.filas[0].categoryName, 'Transporte')
    assert.equal(res.body.filas[0].reglaPattern, undefined)
    assert.equal(res.body.resumen.propuestasPorRegla, 0)
  })

  test('una regla de gasto no propone nada para un ingreso', async () => {
    const ingresos = ['fecha,concepto,monto', '2026-04-01,DEPOSITO OXXO,500.00'].join('\n')
    const res = await c.post('/api/importaciones/previsualizar', {
      profileId: perfil.id,
      csv: ingresos,
      cuentaPorOmision: cuenta.id,
      crearCategorias: false,
      crearEtiquetas: false,
      omitirDuplicadas: true,
    })
    assert.equal(res.body.filas[0].type, 'ingreso')
    assert.equal(res.body.filas[0].categoryName, '', 'Súper es de gasto')
  })

  test('al importar, la categoría propuesta es la que se asienta', async () => {
    const previo = await previa()
    const res = await c.post('/api/importaciones', {
      profileId: perfil.id,
      csv,
      cuentaPorOmision: cuenta.id,
      crearCategorias: false,
      crearEtiquetas: false,
      omitirDuplicadas: true,
      huella: previo.body.huella,
    })
    assert.equal(res.status, 201, JSON.stringify(res.body))
    const movimientos = (await c.get(`/api/transactions?profileId=${perfil.id}`)).body
    const oxxo = movimientos.find((t: any) => t.note.includes('OXXO'))
    assert.equal(oxxo.categoryId, superId)
    assert.equal(oxxo.amountCents, 12_050)
  })

  test('cambiar una regla entre la previa y el import invalida la huella', async () => {
    const previo = await previa()
    const regla = (await c.get(`/api/categories/reglas?profileId=${perfil.id}`)).body.find(
      (r: any) => r.pattern === 'OXXO',
    )
    await c.patch(`/api/categories/reglas/${regla.id}`, { categoryId: transporte })
    const res = await c.post('/api/importaciones', {
      profileId: perfil.id,
      csv,
      cuentaPorOmision: cuenta.id,
      crearCategorias: false,
      crearEtiquetas: false,
      omitirDuplicadas: false,
      huella: previo.body.huella,
    })
    // Sin esto, se escribiría una clasificación que el usuario no aprobó.
    assert.equal(res.status, 409)
    assert.match(res.body.error, /cambió/i)
  })

  test('borrar la categoría se lleva sus reglas, y lo dice', async () => {
    const otra = (
      await c.post('/api/categories', { profileId: perfil.id, name: 'Mandados', kind: 'gasto' })
    ).body
    await c.post('/api/categories/reglas', {
      profileId: perfil.id, pattern: 'MANDADO', categoryId: otra.id,
    })
    const res = await c.del(`/api/categories/${otra.id}?force=true`)
    assert.equal(res.body.reglasBorradas, 1)
    const reglas = (await c.get(`/api/categories/reglas?profileId=${perfil.id}`)).body
    assert.ok(!reglas.some((r: any) => r.pattern === 'MANDADO'))
  })
})

// ── Respaldo y configuración ──────────────────────────────────────────────

describe('la jerarquía sobrevive al respaldo y a la configuración', () => {
  let c: Cliente

  before(async () => {
    c = await levantar()
  })

  after(() => c.cerrar())

  test('⚠ un hijo con rowid menor que su padre se restaura igual', async () => {
    // El caso que rompe un respaldo volcado por `rowid`: primero se crea la
    // hija, después el padre, y **luego** se cuelga. Sin ordenar el volcado por
    // dependencia, el archivo sale con el hijo delante y la restauración
    // revienta con una llave foránea rota.
    const base = await libroBase(c, 'Orden invertido')
    const hija = (
      await c.post('/api/categories', {
        profileId: base.perfil.id, name: 'Restaurante', kind: 'gasto',
      })
    ).body
    const padre = (
      await c.post('/api/categories', {
        profileId: base.perfil.id, name: 'Salidas', kind: 'gasto',
      })
    ).body
    assert.ok(hija.id < padre.id, 'la hija nació antes que su padre')
    await c.patch(`/api/categories/${hija.id}`, { parentId: padre.id })
    await c.post('/api/categories/reglas', {
      profileId: base.perfil.id, pattern: 'CENA', categoryId: hija.id,
    })

    const respaldo = (await c.get('/api/respaldo')).body
    const restaurado = await c.post('/api/respaldo/restaurar', respaldo)
    assert.equal(restaurado.status, 200, JSON.stringify(restaurado.body))

    const lista = (await c.get(`/api/categories?profileId=${base.perfil.id}`)).body
    const vuelta = lista.find((x: any) => x.name === 'Restaurante')
    assert.equal(vuelta.parentName, 'Salidas', 'volvió colgada de su padre')
    const reglas = (await c.get(`/api/categories/reglas?profileId=${base.perfil.id}`)).body
    assert.equal(reglas.length, 1)
    assert.equal(reglas[0].pattern, 'CENA')
  })

  test('la configuración exportable lleva la jerarquía, por nombre', async () => {
    const origen = (await c.get(`/api/profiles`)).body.find(
      (p: any) => p.name === 'Orden invertido',
    )
    const config = (await c.get(`/api/personalizacion/config?profileId=${origen.id}`)).body
    const hija = config.categorias.find((x: any) => x.name === 'Restaurante')
    assert.equal(hija.padre, 'Salidas')
    // Los padres viajan delante: al aplicar se resuelven por nombre y uno que
    // llegara después dejaría a su hija suelta.
    const iPadre = config.categorias.findIndex((x: any) => x.name === 'Salidas')
    const iHija = config.categorias.findIndex((x: any) => x.name === 'Restaurante')
    assert.ok(iPadre < iHija)

    const destino = (await c.post('/api/profiles', { name: 'Copia', kind: 'personal' })).body
    const res = await c.post(`/api/personalizacion/config?profileId=${destino.id}`, config)
    assert.equal(res.status, 200, JSON.stringify(res.body))
    const lista = (await c.get(`/api/categories?profileId=${destino.id}`)).body
    const copiada = lista.find((x: any) => x.name === 'Restaurante')
    assert.equal(copiada.parentName, 'Salidas', 'llegó colgada de su padre')
  })
})
