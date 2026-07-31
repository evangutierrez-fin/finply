// Módulos por perfil (Fase 9).
//
// La invariante que gobierna el archivo es R17: **apagar oculta, nunca borra**.
// Si eso se rompe, alguien pierde datos por haber desmarcado una casilla, que
// es exactamente el miedo que vuelve inútil una función de personalización.
//
// La segunda es R2 aplicada a la migración más pequeña del proyecto: la 13 no
// rellena una sola fila, así que hay que demostrar que aun así nadie ve algo
// distinto después de migrar.

import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { levantar, libroBase, type Cliente } from './ayuda.ts'
// Módulos puros: no tocan la base, así que el import estático es seguro (R16).
import {
  MODULOS,
  moduloDeVista,
  porOmision,
  resolverModulos,
  vistaVisible,
  type ModuloId,
} from '../shared/modulos.ts'

let c: Cliente
before(async () => {
  c = await levantar()
})
after(() => c?.cerrar())

const dirs: string[] = []
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

/**
 * Los tres de la Fase 15. Nacen apagados **para todo el mundo**: cada uno es
 * inútil para casi cualquiera y decisivo para algunos, y un despacho y una
 * panadería son los dos de negocio sin querer los módulos del otro.
 */
const GIRO: ModuloId[] = ['inmuebles', 'horas', 'inventario']

describe('el catálogo (aritmética pura)', () => {
  test('sin overrides manda el tipo de perfil', () => {
    const personal = resolverModulos('personal', {})
    const negocio = resolverModulos('negocio', {})
    assert.deepEqual(personal, porOmision('personal'))
    assert.ok(!personal.includes('negocio'), 'un libro personal no nace con facturas')
    assert.ok(negocio.includes('negocio'))
    assert.deepEqual(
      negocio,
      MODULOS.filter((m) => !GIRO.includes(m.id)).map((m) => m.id),
      'uno de negocio nace con todo lo que no es de giro',
    )
  })

  test('los de giro nacen apagados para los dos tipos, y se encienden a mano', () => {
    for (const kind of ['personal', 'negocio'] as const) {
      const nace = resolverModulos(kind, {})
      for (const id of GIRO) {
        assert.ok(!nace.includes(id), `un libro ${kind} no nace con ${id}`)
      }
    }
    // Apagado no es escondido: siguen en el catálogo, con su descripción, y una
    // fila explícita los enciende sin migración — las tablas ya existen (D16).
    assert.ok(resolverModulos('personal', { inmuebles: true }).includes('inmuebles'))
    assert.ok(resolverModulos('negocio', { inventario: true }).includes('inventario'))
    for (const id of GIRO) {
      assert.ok(MODULOS.some((m) => m.id === id && m.descripcion.length > 0), `${id} se describe`)
    }
  })

  test('una fila explícita gana, en los dos sentidos', () => {
    assert.ok(
      resolverModulos('personal', { negocio: true }).includes('negocio'),
      'un personal puede encender Negocio',
    )
    assert.ok(
      !resolverModulos('negocio', { negocio: false }).includes('negocio'),
      'y uno de negocio puede apagarlo',
    )
  })

  test('el núcleo no se apaga ni quedándose sin módulos', () => {
    for (const vista of ['resumen', 'movimientos', 'cuentas', 'reportes', 'ajustes']) {
      assert.equal(moduloDeVista(vista), null, `${vista} no es de ningún módulo`)
      assert.ok(vistaVisible(vista, []), `${vista} se ve con cero módulos`)
    }
    // Y Ajustes en particular: es la puerta para volver a encender lo demás.
    assert.ok(vistaVisible('ajustes', []), 'sin Ajustes el usuario queda encerrado')
  })

  test('cada vista de módulo pertenece a uno solo', () => {
    const vistas = MODULOS.flatMap((m) => m.vistas)
    assert.equal(new Set(vistas).size, vistas.length, 'ninguna vista está en dos módulos')
    assert.equal(moduloDeVista('simulador'), 'inversiones', 'el simulador va con inversiones')
    assert.equal(moduloDeVista('calendario'), 'recurrencias')
  })
})

describe('el perfil y su elección', () => {
  test('nace con el juego de su tipo si nadie opina', async () => {
    const p = (await c.post('/api/profiles', { name: 'Sin opinar', kind: 'personal' })).body
    assert.deepEqual(p.modules, porOmision('personal'))
    const n = (await c.post('/api/profiles', { name: 'Negocio pleno', kind: 'negocio' })).body
    assert.deepEqual(n.modules, porOmision('negocio'))
  })

  test('el alta guarda lo que el usuario marcó', async () => {
    const p = (
      await c.post('/api/profiles', {
        name: 'A la medida',
        kind: 'personal',
        modules: ['metas', 'notas'],
      })
    ).body
    assert.deepEqual(p.modules, ['metas', 'notas'])
    // Y sobrevive a la relectura: no es una respuesta bonita del POST.
    const lista = (await c.get('/api/profiles')).body
    assert.deepEqual(lista.find((x: any) => x.id === p.id).modules, ['metas', 'notas'])
  })

  test('un arreglo vacío es una elección, no un olvido', async () => {
    const p = (
      await c.post('/api/profiles', { name: 'Solo el libro', kind: 'personal', modules: [] })
    ).body
    assert.deepEqual(p.modules, [], 'nadie le devuelve las secciones "porque sí"')
    assert.ok(vistaVisible('movimientos', p.modules), 'pero el libro sigue ahí')
  })

  test('cambiar de tipo no le devuelve lo que apagó', async () => {
    const p = (
      await c.post('/api/profiles', {
        name: 'Cambia de tipo',
        kind: 'personal',
        modules: ['tarjetas'],
      })
    ).body
    const cambiado = (await c.patch(`/api/profiles/${p.id}`, { kind: 'negocio' })).body
    assert.deepEqual(
      cambiado.modules,
      ['tarjetas'],
      'la elección explícita manda sobre el juego del tipo nuevo',
    )
  })

  test('el PATCH sin `modules` no opina', async () => {
    const p = (
      await c.post('/api/profiles', { name: 'Solo el nombre', kind: 'personal', modules: ['metas'] })
    ).body
    const renombrado = (await c.patch(`/api/profiles/${p.id}`, { name: 'Otro nombre' })).body
    assert.deepEqual(renombrado.modules, ['metas'])
  })
})

describe('R17 · apagar oculta, nunca borra', () => {
  test('apagar Negocio no borra una sola factura, y encenderlo la devuelve', async () => {
    const { perfil } = await libroBase(c, 'Guarda sus facturas', 'negocio')
    const cliente = (
      await c.post('/api/contrapartes', { profileId: perfil.id, name: 'Cliente', role: 'cliente' })
    ).body
    await c.post('/api/facturas', {
      profileId: perfil.id,
      counterpartyId: cliente.id,
      direction: 'emitida',
      issueDate: '2026-07-01',
      dueDate: '2026-08-01',
      subtotalCents: 500000,
    })

    const apagado = (await c.patch(`/api/profiles/${perfil.id}`, { modules: [] })).body
    assert.deepEqual(apagado.modules, [])

    // Con el módulo apagado la vista no está en el lomo, pero el dato sí está.
    const conModuloApagado = (await c.get(`/api/facturas?profileId=${perfil.id}`)).body
    assert.equal(conModuloApagado.length, 1, 'la factura sigue en la base')
    assert.equal(conModuloApagado[0].subtotalCents, 500000)

    const encendido = (
      await c.patch(`/api/profiles/${perfil.id}`, { modules: porOmision('negocio') })
    ).body
    assert.ok(encendido.modules.includes('negocio'))
    const devuelta = (await c.get(`/api/facturas?profileId=${perfil.id}`)).body
    assert.equal(devuelta.length, 1)
    assert.equal(devuelta[0].saldoCents, 500000, 'con su saldo intacto')
  })

  test('apagar Deudas no cambia el patrimonio del Resumen (R18)', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Patrimonio con deuda')
    await c.post('/api/debts', {
      profileId: perfil.id,
      direction: 'por_pagar',
      counterparty: 'Banco',
      principalCents: 300000,
      startDate: '2026-01-01',
    })
    const antes = (await c.get(`/api/summary?profileId=${perfil.id}&month=2026-07`)).body
    await c.patch(`/api/profiles/${perfil.id}`, { modules: ['metas'] })
    const despues = (await c.get(`/api/summary?profileId=${perfil.id}&month=2026-07`)).body

    assert.equal(despues.debts.porPagarCents, antes.debts.porPagarCents)
    assert.equal(
      despues.debts.porPagarCents,
      300000,
      'lo que debes sigue debiéndose aunque no veas la sección',
    )
    assert.equal(despues.totalCents, antes.totalCents)
  })
})

describe('las alertas y el calendario callan lo apagado', () => {
  test('una tarjeta vencida deja de alertar con el módulo apagado, y vuelve', async () => {
    const { perfil } = await libroBase(c, 'Tarjeta apagable')
    const tarjeta = (
      await c.post('/api/accounts', {
        profileId: perfil.id,
        name: 'Oro',
        type: 'tarjeta',
        openingCents: 0,
        creditLimitCents: 5000000,
        cutDay: 5,
        dueDay: 20,
      })
    ).body
    await c.post('/api/transactions', {
      profileId: perfil.id,
      accountId: tarjeta.id,
      type: 'gasto',
      amountCents: 120000,
      date: '2026-07-02',
    })

    const con = (await c.get(`/api/alertas?profileId=${perfil.id}&hoy=2026-07-25`)).body
    assert.ok(
      con.some((a: any) => a.tipo === 'tarjeta'),
      'con el módulo encendido, la fecha límite avisa',
    )

    await c.patch(`/api/profiles/${perfil.id}`, { modules: [] })
    const sin = (await c.get(`/api/alertas?profileId=${perfil.id}&hoy=2026-07-25`)).body
    assert.equal(
      sin.filter((a: any) => a.tipo === 'tarjeta').length,
      0,
      'apagado no manda al usuario a una sección que no está en su lomo',
    )

    await c.patch(`/api/profiles/${perfil.id}`, { modules: ['tarjetas'] })
    const otraVez = (await c.get(`/api/alertas?profileId=${perfil.id}&hoy=2026-07-25`)).body
    assert.ok(
      otraVez.some((a: any) => a.tipo === 'tarjeta'),
      'y vuelve entera al encenderlo: la alerta es derivada, no guardada (D10)',
    )
  })

  test('el calendario pierde los eventos del módulo apagado y nada más', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Calendario apagable')
    await c.post('/api/recurrencias', {
      profileId: perfil.id,
      accountId: cuenta.id,
      type: 'gasto',
      amountCents: 50000,
      note: 'Renta',
      frequency: 'mensual',
      dayOfMonth: 5,
      startDate: '2026-07-05',
    })
    await c.post('/api/debts', {
      profileId: perfil.id,
      direction: 'por_pagar',
      counterparty: 'Prima',
      principalCents: 100000,
      startDate: '2026-07-01',
      dueDate: '2026-08-10',
    })

    const todo = (await c.get(`/api/calendario?profileId=${perfil.id}&hoy=2026-07-28&dias=30`)).body
    assert.ok(todo.eventos.some((e: any) => e.tipo === 'recurrencia'))
    assert.ok(todo.eventos.some((e: any) => e.tipo === 'deuda'))

    await c.patch(`/api/profiles/${perfil.id}`, { modules: ['deudas'] })
    const soloDeudas = (
      await c.get(`/api/calendario?profileId=${perfil.id}&hoy=2026-07-28&dias=30`)
    ).body
    assert.equal(soloDeudas.eventos.filter((e: any) => e.tipo === 'recurrencia').length, 0)
    assert.ok(
      soloDeudas.eventos.some((e: any) => e.tipo === 'deuda'),
      'apagar uno no se lleva a los demás por delante',
    )
  })
})

describe('R2 · la migración 13 no le cambia la vista a nadie', () => {
  test('un libro en la 12 ve exactamente lo mismo en la 13', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'finply-mod-'))
    dirs.push(dir)
    const ruta = path.join(dir, 'v12.db')
    const db = new DatabaseSync(ruta)
    db.exec('PRAGMA foreign_keys = ON')

    // Se llega a la 12 corriendo las migraciones reales y parando ahí: así la
    // base de la prueba es la de verdad, no una copia a mano que envejece.
    const { MIGRATIONS, migrate, SCHEMA_VERSION } = await import('../server/migrations.ts')
    for (const m of MIGRATIONS) {
      if (m.id > 12) break
      m.up(db)
      db.exec(`PRAGMA user_version = ${m.id}`)
    }
    db.prepare("INSERT INTO profiles (name, kind) VALUES ('Ana', 'personal')").run()
    db.prepare("INSERT INTO profiles (name, kind) VALUES ('Taller', 'negocio')").run()
    const antes = db.prepare('SELECT id, name, kind FROM profiles ORDER BY id').all() as any[]
    assert.equal((db.prepare('PRAGMA user_version').get() as any).user_version, 12)

    migrate(db)
    assert.equal((db.prepare('PRAGMA user_version').get() as any).user_version, SCHEMA_VERSION)

    // La migración no rellenó una sola fila…
    const filas = db.prepare('SELECT COUNT(*) AS n FROM profile_modules').get() as any
    assert.equal(filas.n, 0, 'la 13 crea la tabla y nada más')

    // …y aun así cada perfil resuelve justo lo que veía antes de la fase: el
    // personal, todo menos negocio; el de negocio, todo. Eso es lo que R2 pide
    // demostrar, y sale de la regla de "sin fila manda el tipo", no de un
    // relleno que podría equivocarse.
    const despues = db.prepare('SELECT id, name, kind FROM profiles ORDER BY id').all() as any[]
    assert.deepEqual(despues, antes, 'ni un perfil cambió')
    for (const p of despues) {
      const modulos = resolverModulos(p.kind, {})
      assert.deepEqual(modulos, porOmision(p.kind))
      assert.equal(
        modulos.includes('negocio'),
        p.kind === 'negocio',
        `${p.name} ve lo de siempre`,
      )
    }
    db.close()
  })

  test('un respaldo anterior a la fase no deja a nadie sin secciones', async () => {
    const { perfil } = await libroBase(c, 'Respaldo viejo', 'negocio')
    // Se simula el JSON de antes: el respaldo se restaura sin la tabla nueva,
    // que es lo que trae un archivo generado con la versión anterior.
    const snapshot = (await c.get('/api/respaldo')).body
    delete snapshot.tables.profile_modules

    const restaurado = (await c.post('/api/respaldo/restaurar', snapshot)).body
    assert.ok(restaurado.restaurados, 'la restauración no truena por la tabla faltante')

    const perfiles = (await c.get('/api/profiles')).body
    const vuelto = perfiles.find((p: any) => p.name === 'Respaldo viejo')
    assert.ok(vuelto, 'el perfil volvió')
    assert.deepEqual(
      vuelto.modules,
      porOmision('negocio'),
      'sin filas, cada perfil cae en el juego de su tipo en vez de quedarse en blanco',
    )
    assert.equal(perfil.kind, 'negocio')
  })
})
