// Fase 20 · Registrar rápido y secciones que se hablan.
//
// Es la fase con más riesgo de vender humo: todo lo que trae *parece*
// automatización y no debe serlo. Por eso lo que se prueba aquí no es que un
// botón exista, sino las tres promesas que lo separan de automatizar:
//
//   · **la sugerencia no escribe** — pedirla cien veces deja el libro igual,
//     como la bandeja de recurrencias (D7) y las alertas (D10);
//   · **lo que propone es lo último que registraste**, no lo de fecha más
//     reciente, y por tipo: la cuenta del sueldo no es la del súper;
//   · **rellenar no es registrar** (R4) — no hay endpoint que asiente sin que
//     el usuario mande el movimiento entero.
//
// Y de las notas atadas, la regla que las hace de fiar: anular un movimiento
// **no borra lo que el usuario escribió**. Se pierde la liga, nunca el dato —
// el mismo trato del desembolso de una deuda y de la devolución.
//
// `shared/*` se importa estáticamente: son puros y no tocan la base (R16).

import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { camposDelMovimiento, camposQueFaltan, libroPide } from '../shared/campos.ts'
import { ATAJOS, resolverAtajo } from '../shared/atajos.ts'
import { levantar, libroBase, type Cliente } from './ayuda.ts'
import type { Note, SugerenciaTx, Tx } from '../shared/types.ts'

let c: Cliente
before(async () => {
  c = await levantar()
})
after(async () => {
  await c.cerrar()
})

async function libro(nombre: string, kind = 'personal') {
  const { perfil, cuenta, categorias } = await libroBase(c, nombre, kind)
  const gasto = categorias.find((x: any) => x.kind === 'gasto')
  const ingreso = categorias.find((x: any) => x.kind === 'ingreso')
  return { perfil, cuenta, gasto, ingreso }
}

function movimiento(perfilId: number, cuentaId: number, extra: Record<string, unknown> = {}) {
  return {
    profileId: perfilId,
    accountId: cuentaId,
    type: 'gasto',
    amountCents: 10000,
    date: '2026-03-10',
    note: 'Café',
    ...extra,
  }
}

// ── Lo que la barra propone ───────────────────────────────────────────────

describe('la sugerencia de la barra rápida', () => {
  test('en un libro en blanco no propone nada, y no truena', async () => {
    const { perfil } = await libro('Vacío')
    const res = await c.get<SugerenciaTx>(`/api/transactions/sugerencia?profileId=${perfil.id}`)
    assert.equal(res.status, 200)
    assert.equal(res.body.ultima, null)
    assert.deepEqual(res.body.porTipo, {})
  })

  test('propone la cuenta y la categoría de la última vez, por tipo', async () => {
    const { perfil, cuenta, gasto, ingreso } = await libro('Por tipo')
    const otra = (
      await c.post('/api/accounts', { profileId: perfil.id, name: 'Nómina', type: 'banco' })
    ).body

    await c.post('/api/transactions', movimiento(perfil.id, cuenta.id, { categoryId: gasto.id }))
    await c.post(
      '/api/transactions',
      movimiento(perfil.id, otra.id, {
        type: 'ingreso',
        categoryId: ingreso.id,
        note: 'Quincena',
      }),
    )

    const { body } = await c.get<SugerenciaTx>(
      `/api/transactions/sugerencia?profileId=${perfil.id}`,
    )
    // Cada tipo trae lo suyo: proponerle al gasto la cuenta del sueldo sería
    // exactamente el tipo de "ayuda" que hace registrar mal.
    assert.deepEqual(body.porTipo.gasto, { accountId: cuenta.id, categoryId: gasto.id })
    assert.deepEqual(body.porTipo.ingreso, { accountId: otra.id, categoryId: ingreso.id })
  })

  test('"la última" es la última registrada, no la de fecha más reciente', async () => {
    const { perfil, cuenta } = await libro('Orden')
    // Primero se apunta algo de hoy y después se corrige una partida de enero:
    // la que uno quiere repetir es la de enero, que es la que acaba de teclear.
    await c.post('/api/transactions', movimiento(perfil.id, cuenta.id, { date: '2026-06-01', note: 'Reciente' }))
    await c.post('/api/transactions', movimiento(perfil.id, cuenta.id, { date: '2026-01-05', note: 'Vieja pero última' }))

    const { body } = await c.get<SugerenciaTx>(
      `/api/transactions/sugerencia?profileId=${perfil.id}`,
    )
    assert.equal(body.ultima?.note, 'Vieja pero última')
  })

  test('la última viene hidratada, con sus etiquetas y su reparto', async () => {
    const { perfil, cuenta, gasto } = await libro('Hidratada')
    const etiqueta = (await c.post('/api/tags', { profileId: perfil.id, name: 'súper' })).body
    await c.post(
      '/api/transactions',
      movimiento(perfil.id, cuenta.id, {
        amountCents: 30000,
        tagIds: [etiqueta.id],
        splits: [
          { categoryId: gasto.id, amountCents: 20000, note: 'despensa' },
          { categoryId: gasto.id, amountCents: 10000, note: 'farmacia' },
        ],
      }),
    )
    const { body } = await c.get<SugerenciaTx>(
      `/api/transactions/sugerencia?profileId=${perfil.id}`,
    )
    assert.equal(body.ultima?.tags.length, 1)
    assert.equal(body.ultima?.splits.length, 2)
  })

  test('pedirla no escribe una sola fila (R4 y D7)', async () => {
    const { perfil, cuenta } = await libro('Sin efectos')
    await c.post('/api/transactions', movimiento(perfil.id, cuenta.id))
    const antes = (await c.get(`/api/transactions?profileId=${perfil.id}`)).body.length

    for (let i = 0; i < 5; i += 1) {
      await c.get(`/api/transactions/sugerencia?profileId=${perfil.id}`)
    }

    const despues = (await c.get(`/api/transactions?profileId=${perfil.id}`)).body
    assert.equal(despues.length, antes)
    // Y el saldo tampoco se movió: no hay lectura con efectos.
    const cuentas = (await c.get(`/api/accounts?profileId=${perfil.id}`)).body
    assert.equal(cuentas[0].balanceCents, 100000 - 10000)
  })

  test('no se asoma al libro de al lado', async () => {
    const a = await libro('Libro A')
    const b = await libro('Libro B')
    await c.post('/api/transactions', movimiento(a.perfil.id, a.cuenta.id, { note: 'De A' }))

    const { body } = await c.get<SugerenciaTx>(
      `/api/transactions/sugerencia?profileId=${b.perfil.id}`,
    )
    assert.equal(body.ultima, null)
  })
})

// ── Repetir: el atajo sigue siendo un registro consciente ──────────────────

describe('repetir la última partida', () => {
  test('duplicar copia lo que se volvería a teclear y lo fecha hoy', async () => {
    const { perfil, cuenta, gasto } = await libro('Duplicar')
    const original: Tx = (
      await c.post(
        '/api/transactions',
        movimiento(perfil.id, cuenta.id, { categoryId: gasto.id, amountCents: 45050 }),
      )
    ).body

    const copia = await c.post<Tx>(`/api/transactions/${original.id}/duplicar`, {
      date: '2026-08-02',
    })
    assert.equal(copia.status, 201)
    assert.equal(copia.body.amountCents, 45050)
    assert.equal(copia.body.categoryId, gasto.id)
    assert.equal(copia.body.date, '2026-08-02')
    assert.notEqual(copia.body.id, original.id)
  })
})

// ── Las notas que se hablan con el libro ──────────────────────────────────

describe('una nota atada a un movimiento', () => {
  test('nace con su liga y la respuesta ya sabe nombrar la partida', async () => {
    const { perfil, cuenta } = await libro('Nota de partida')
    const tx: Tx = (
      await c.post('/api/transactions', movimiento(perfil.id, cuenta.id, { note: 'Súper' }))
    ).body

    const res = await c.post<Note>('/api/notes', {
      profileId: perfil.id,
      title: 'Por qué tan caro',
      body: 'Llevé a los niños.',
      txId: tx.id,
    })
    assert.equal(res.status, 201)
    assert.equal(res.body.txId, tx.id)
    // Sin esto la libreta enseñaría "nota de #418", que no le dice nada a nadie.
    assert.equal(res.body.tx?.note, 'Súper')
    assert.equal(res.body.tx?.amountCents, 10000)
  })

  test('el movimiento la trae en su renglón, con el título', async () => {
    const { perfil, cuenta } = await libro('Chip')
    const tx: Tx = (await c.post('/api/transactions', movimiento(perfil.id, cuenta.id))).body
    await c.post('/api/notes', {
      profileId: perfil.id,
      title: 'Ojo con esta',
      body: 'Va a repetirse en septiembre.',
      txId: tx.id,
    })

    const lista: Tx[] = (await c.get(`/api/transactions?profileId=${perfil.id}`)).body
    assert.equal(lista[0]!.notes.length, 1)
    assert.equal(lista[0]!.notes[0]!.title, 'Ojo con esta')
  })

  test('una nota sin título se nombra con su primer renglón', async () => {
    const { perfil, cuenta } = await libro('Sin título')
    const tx: Tx = (await c.post('/api/transactions', movimiento(perfil.id, cuenta.id))).body
    await c.post('/api/notes', {
      profileId: perfil.id,
      title: '',
      body: 'Pagado a medias con Ana.\nEl resto lo pone ella en agosto.',
      txId: tx.id,
    })
    const lista: Tx[] = (await c.get(`/api/transactions?profileId=${perfil.id}`)).body
    assert.equal(lista[0]!.notes[0]!.title, 'Pagado a medias con Ana.')
  })

  test('⚠ anular el movimiento NO borra la nota: se pierde la liga', async () => {
    const { perfil, cuenta } = await libro('Anular')
    const tx: Tx = (await c.post('/api/transactions', movimiento(perfil.id, cuenta.id))).body
    const nota: Note = (
      await c.post('/api/notes', {
        profileId: perfil.id,
        title: 'Lo que no quiero olvidar',
        body: 'Aunque anule la partida.',
        txId: tx.id,
      })
    ).body

    await c.del(`/api/transactions/${tx.id}`)

    const notas: Note[] = (await c.get(`/api/notes?profileId=${perfil.id}`)).body
    const viva = notas.find((n) => n.id === nota.id)
    assert.ok(viva, 'la nota tiene que sobrevivir al movimiento')
    assert.equal(viva!.txId, null)
    assert.equal(viva!.body, 'Aunque anule la partida.')
  })

  test('no se puede atar a una partida de otro libro', async () => {
    const a = await libro('Dueño')
    const b = await libro('Ajeno')
    const tx: Tx = (await c.post('/api/transactions', movimiento(a.perfil.id, a.cuenta.id))).body

    const res = await c.post('/api/notes', {
      profileId: b.perfil.id,
      title: 'Cruzada',
      body: 'No debería entrar',
      txId: tx.id,
    })
    assert.equal(res.status, 400)
  })

  test('a un movimiento o a un mes, nunca a los dos', async () => {
    const { perfil, cuenta } = await libro('Excluyentes')
    const tx: Tx = (await c.post('/api/transactions', movimiento(perfil.id, cuenta.id))).body
    const res = await c.post('/api/notes', {
      profileId: perfil.id,
      title: 'Dos verdades',
      body: 'De qué habla',
      txId: tx.id,
      period: '2026-03',
    })
    assert.equal(res.status, 400)
  })
})

describe('una nota atada a un mes', () => {
  test('se filtra por su mes y el Resumen puede pedir solo los suyos', async () => {
    const { perfil } = await libro('Meses')
    await c.post('/api/notes', {
      profileId: perfil.id,
      title: 'Marzo',
      body: 'Mes de la tenencia.',
      period: '2026-03',
    })
    await c.post('/api/notes', {
      profileId: perfil.id,
      title: 'Abril',
      body: 'Sin sobresaltos.',
      period: '2026-04',
    })
    await c.post('/api/notes', { profileId: perfil.id, title: 'Suelta', body: 'De nada.' })

    const marzo: Note[] = (
      await c.get(`/api/notes?profileId=${perfil.id}&period=2026-03`)
    ).body
    assert.equal(marzo.length, 1)
    assert.equal(marzo[0]!.title, 'Marzo')

    const todas: Note[] = (await c.get(`/api/notes?profileId=${perfil.id}`)).body
    assert.equal(todas.length, 3)
  })

  test('un mes con forma rara se rechaza en vez de guardarse', async () => {
    const { perfil } = await libro('Mes inválido')
    for (const period of ['2026-13', 'marzo', '2026-3', '2026-03-01']) {
      const res = await c.post('/api/notes', {
        profileId: perfil.id,
        title: 'Mala',
        body: 'x',
        period,
      })
      assert.equal(res.status, 400, `"${period}" no debería entrar`)
    }
  })

  test('el PATCH suelta la liga con un null explícito y la conserva si no opina', async () => {
    const { perfil, cuenta } = await libro('Soltar')
    const tx: Tx = (await c.post('/api/transactions', movimiento(perfil.id, cuenta.id))).body
    const nota: Note = (
      await c.post('/api/notes', {
        profileId: perfil.id,
        title: 'Atada',
        body: 'Al principio',
        txId: tx.id,
      })
    ).body

    // Fijarla no dice nada de la liga: se queda como estaba.
    const fijada = await c.patch<Note>(`/api/notes/${nota.id}`, { pinned: true })
    assert.equal(fijada.body.txId, tx.id)

    // Un null explícito sí la suelta: es la diferencia entre "no opiné" y
    // "quítala", la misma de las etiquetas de un movimiento.
    const suelta = await c.patch<Note>(`/api/notes/${nota.id}`, { txId: null })
    assert.equal(suelta.body.txId, null)
    assert.equal(suelta.body.tx, null)
  })
})

// ── R11: el costo no crece con el libro ───────────────────────────────────

describe('R11: las notas del renglón no cuestan una consulta por partida', () => {
  test('cinco movimientos con nota gastan lo mismo que uno', async () => {
    const pocos = await libro('Pocos')
    const muchos = await libro('Muchos')

    for (const [l, n] of [
      [pocos, 1],
      [muchos, 12],
    ] as const) {
      for (let i = 0; i < n; i += 1) {
        const tx: Tx = (
          await c.post(
            '/api/transactions',
            movimiento(l.perfil.id, l.cuenta.id, { note: `Partida ${i}` }),
          )
        ).body
        await c.post('/api/notes', {
          profileId: l.perfil.id,
          title: `Nota ${i}`,
          body: 'x',
          txId: tx.id,
        })
      }
    }

    const { db } = await import('../server/db.ts')
    const original = db.prepare.bind(db)
    let consultas = 0
    ;(db as any).prepare = (sql: string) => {
      consultas++
      return original(sql)
    }

    try {
      consultas = 0
      await c.get(`/api/transactions?profileId=${pocos.perfil.id}`)
      const nPocos = consultas

      consultas = 0
      await c.get(`/api/transactions?profileId=${muchos.perfil.id}`)
      const nMuchos = consultas

      assert.equal(
        nPocos,
        nMuchos,
        `el listado gastó ${nPocos} consultas con 1 partida y ${nMuchos} con 12`,
      )
    } finally {
      ;(db as any).prepare = original
    }
  })
})

// ── Los campos del formulario, en un solo lugar ───────────────────────────

describe('qué campos pide un movimiento (shared/campos.ts)', () => {
  const personal = ['cuentas', 'presupuestos', 'metas'] as any

  test('una transferencia no pregunta categoría, ni reparto, ni impuesto', () => {
    const campos = camposDelMovimiento({ modules: personal, type: 'transferencia' })
    assert.deepEqual(campos, ['cuentaDestino', 'etiquetas'])
  })

  test('un libro personal nunca pide los campos de negocio', () => {
    assert.equal(libroPide(personal, 'negocio'), false)
    assert.equal(libroPide(personal, 'inmueble'), false)
  })

  test('los trae el módulo, no el tipo de perfil', () => {
    // Desde la Fase 9 el tipo solo elige el juego por omisión: un libro
    // personal que encienda Negocio tiene que ver sus campos igual.
    const conNegocio = [...personal, 'negocio'] as any
    assert.ok(camposDelMovimiento({ modules: conNegocio, type: 'gasto' }).includes('negocio'))
    // Pero no en una transferencia: mover dinero entre bolsillos tuyos no
    // tiene contraparte ni impuesto (D6).
    assert.ok(
      !camposDelMovimiento({ modules: conNegocio, type: 'transferencia' }).includes('negocio'),
    )
  })

  test('sin contratos, el inmueble no se pregunta', () => {
    const conInmuebles = [...personal, 'inmuebles'] as any
    const sin = camposDelMovimiento({ modules: conInmuebles, type: 'gasto' })
    const con = camposDelMovimiento({
      modules: conInmuebles,
      type: 'gasto',
      hayArrendamientos: true,
    })
    assert.ok(!sin.includes('inmueble'))
    assert.ok(con.includes('inmueble'))
  })

  test('el ticket dividido se queda sin la categoría de arriba (D17)', () => {
    const entera = camposDelMovimiento({ modules: personal, type: 'gasto' })
    const dividida = camposDelMovimiento({ modules: personal, type: 'gasto', dividida: true })
    assert.ok(entera.includes('categoria'))
    assert.ok(!dividida.includes('categoria'))
    // El reparto sigue ahí: es lo que la reemplaza.
    assert.ok(dividida.includes('reparto'))
  })

  test('el recibo exige que el movimiento exista', () => {
    assert.ok(!camposDelMovimiento({ modules: personal, type: 'gasto' }).includes('recibo'))
    assert.ok(
      camposDelMovimiento({ modules: personal, type: 'gasto', existe: true }).includes('recibo'),
    )
  })

  test('la barra dice qué campos de este libro se está saltando', () => {
    const conNegocio = [...personal, 'negocio'] as any
    assert.deepEqual(camposQueFaltan({ modules: personal, type: 'gasto' }), [])
    assert.deepEqual(camposQueFaltan({ modules: conNegocio, type: 'gasto' }), ['negocio'])
  })
})

// ── Los atajos ────────────────────────────────────────────────────────────

describe('los atajos de teclado (shared/atajos.ts)', () => {
  test('dentro de un campo de texto no hay atajos', () => {
    // Escribir "notas" en el buscador no puede abrir media aplicación.
    for (const tecla of ['n', 'b', 'r', '/', '?', 'g']) {
      assert.equal(resolverAtajo({ tecla, enCampo: true }), null, `"${tecla}" no debe disparar`)
    }
  })

  test('Escape sí, incluso dentro de un campo: es la salida', () => {
    assert.deepEqual(resolverAtajo({ tecla: 'Escape', enCampo: true }), {
      tipo: 'atajo',
      id: 'cerrar',
    })
  })

  test('con Ctrl, Cmd o Alt la combinación es del navegador', () => {
    assert.equal(resolverAtajo({ tecla: 'n', conModificador: true }), null)
  })

  test('la `g` abre secuencia y la segunda tecla decide el destino', () => {
    assert.deepEqual(resolverAtajo({ tecla: 'g' }), { tipo: 'prefijo' })
    assert.deepEqual(resolverAtajo({ tecla: 'm', prefijoActivo: true }), {
      tipo: 'atajo',
      id: 'ir-movimientos',
    })
    // La misma tecla significa cosas distintas con y sin prefijo, que es la
    // gracia de la secuencia: `n` registra, `g n` va a Notas.
    assert.deepEqual(resolverAtajo({ tecla: 'n' }), { tipo: 'atajo', id: 'nuevo' })
    assert.deepEqual(resolverAtajo({ tecla: 'n', prefijoActivo: true }), {
      tipo: 'atajo',
      id: 'ir-notas',
    })
  })

  test('una segunda tecla que no lleva a ningún lado no hace nada', () => {
    assert.equal(resolverAtajo({ tecla: 'z', prefijoActivo: true }), null)
  })

  test('mayúsculas y minúsculas son la misma tecla', () => {
    assert.deepEqual(resolverAtajo({ tecla: 'N' }), { tipo: 'atajo', id: 'nuevo' })
  })

  test('la ayuda enseña exactamente los atajos que existen', () => {
    // Dos listas que deben coincidir son dos listas que se separan: la ayuda
    // sale del mismo catálogo que resuelve las teclas, y aquí se comprueba
    // que ninguno se quede sin documentar.
    const ids = new Set(ATAJOS.map((a) => a.id))
    for (const tecla of ['n', 'b', 'r', '/', '?']) {
      const r = resolverAtajo({ tecla })
      assert.ok(r?.tipo === 'atajo' && ids.has(r.id), `"${tecla}" resuelve a algo sin documentar`)
    }
    for (const tecla of ['r', 'm', 'c', 'f', 'p', 'n']) {
      const r = resolverAtajo({ tecla, prefijoActivo: true })
      assert.ok(r?.tipo === 'atajo' && ids.has(r.id), `"g ${tecla}" resuelve a algo sin documentar`)
    }
    // Y al revés: ningún atajo documentado sin tecla que lo alcance.
    assert.equal(ATAJOS.length, ids.size)
  })

  test('ningún atajo escribe en el libro (R4)', () => {
    // La lista entera abre formularios, llena la barra o navega. El día que
    // alguien agregue uno que asiente, esta prueba tiene que caerse.
    const permitidos = new Set([
      'nuevo', 'barra', 'repetir', 'buscar', 'ayuda', 'cerrar',
      'ir-resumen', 'ir-movimientos', 'ir-cuentas', 'ir-flujo', 'ir-presupuestos', 'ir-notas',
    ])
    for (const a of ATAJOS) assert.ok(permitidos.has(a.id), `atajo nuevo sin revisar: ${a.id}`)
  })
})
