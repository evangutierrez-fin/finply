// Fase 21 · Personalización de verdad.
//
// **D24 se resolvió tomando su recomendación**: los campos propios son
// llave-valor, no columnas. Lo que se prueba aquí es lo que esa decisión deja
// abierto y podría morderse solo:
//
//   · **un campo propio no mueve una cifra** — se ve, se edita y se exporta,
//     pero ningún reporte lo suma. Es el criterio que la propia D24 escribió, y
//     lo que impide que un dato que Finply no entiende cambie uno que sí;
//   · **el tipo valida de verdad** — un 'numero' que acepta "como tres mil" no
//     es un campo, es texto libre con etiqueta;
//   · **archivar no pierde nada y borrar dice cuánto se lleva** (R17);
//   · **las preferencias son de vista** — ninguna toca el libro, y la semana
//     que se elige **no** mueve la clave ISO de una recurrencia (R5).
//
// Y de la configuración exportable, la promesa que la vuelve usable en un libro
// vivo: aplicarla es **aditiva y nunca destructiva**.
//
// `shared/*` se importa estáticamente: son puros y no tocan la base (R16).

import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { camposDelMovimiento, libroPide } from '../shared/campos.ts'
import { diasDesde, fechaCon, fechaConAnio, pesosCon } from '../shared/formato.ts'
import { levantar, libroBase, type Cliente } from './ayuda.ts'
import type { CampoPropio, PlantillaTx, Profile, Summary, Tx } from '../shared/types.ts'

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
  return { perfil, cuenta, gasto }
}

const campo = (profileId: number, label: string, kind = 'texto', options = '') =>
  c.post<CampoPropio>('/api/personalizacion/campos', { profileId, label, kind, options })

// ── Los campos propios (D24) ──────────────────────────────────────────────

describe('un campo propio', () => {
  test('se contesta en el movimiento y vuelve con él', async () => {
    const { perfil, cuenta } = await libro('Campos')
    const placa = (await campo(perfil.id, 'Placa')).body

    const tx: Tx = (
      await c.post('/api/transactions', {
        profileId: perfil.id,
        accountId: cuenta.id,
        type: 'gasto',
        amountCents: 80000,
        date: '2026-03-10',
        note: 'Verificación',
        fields: { [placa.id]: 'ABC-123' },
      })
    ).body
    assert.equal(tx.fields[String(placa.id)], 'ABC-123')

    const lista: Tx[] = (await c.get(`/api/transactions?profileId=${perfil.id}`)).body
    assert.equal(lista[0]!.fields[String(placa.id)], 'ABC-123')
  })

  test('⚠ no mueve una sola cifra del Resumen (D24 y R18)', async () => {
    const { perfil, cuenta, gasto } = await libro('Sin sumar')
    await c.post('/api/transactions', {
      profileId: perfil.id, accountId: cuenta.id, type: 'gasto',
      amountCents: 50000, date: '2026-03-05', categoryId: gasto.id,
    })
    const antes: Summary = (await c.get(`/api/summary?profileId=${perfil.id}&month=2026-03`)).body

    // Un campo propio con un número adentro es justo el caso que tentaría a
    // sumarlo. No se suma: Finply no sabe qué significa ese número.
    const horas = (await campo(perfil.id, 'Horas', 'numero')).body
    const tx: Tx = (
      await c.post('/api/transactions', {
        profileId: perfil.id, accountId: cuenta.id, type: 'gasto',
        amountCents: 30000, date: '2026-03-06', categoryId: gasto.id,
        fields: { [horas.id]: '12.5' },
      })
    ).body

    const despues: Summary = (await c.get(`/api/summary?profileId=${perfil.id}&month=2026-03`)).body
    // El gasto sube exactamente el monto del movimiento, ni un centavo más.
    assert.equal(despues.expenseCents - antes.expenseCents, 30000)
    assert.equal(tx.fields[String(horas.id)], '12.5')
  })

  test('el tipo valida: un número es un número y una lista son sus opciones', async () => {
    const { perfil, cuenta } = await libro('Tipos')
    const numero = (await campo(perfil.id, 'Kilómetros', 'numero')).body
    const lista = (await campo(perfil.id, 'Obra', 'lista', 'Norte\nSur')).body
    const fecha = (await campo(perfil.id, 'Vence', 'fecha')).body

    const base = {
      profileId: perfil.id, accountId: cuenta.id, type: 'gasto',
      amountCents: 1000, date: '2026-03-10',
    }
    for (const [id, valor] of [
      [numero.id, 'como tres mil'],
      [lista.id, 'Poniente'],
      [fecha.id, '10 de marzo'],
    ] as const) {
      const res = await c.post('/api/transactions', { ...base, fields: { [id]: valor } })
      assert.equal(res.status, 400, `"${valor}" no debería entrar`)
    }

    // Y lo válido sí, con las comas quitadas: se guarda como se puede leer.
    const ok = await c.post<Tx>('/api/transactions', {
      ...base,
      fields: { [numero.id]: '1,250.5', [lista.id]: 'Sur', [fecha.id]: '2026-04-01' },
    })
    assert.equal(ok.status, 201)
    assert.equal(ok.body.fields[String(numero.id)], '1250.5')
  })

  test('vacío borra la respuesta en vez de guardar una cadena vacía', async () => {
    const { perfil, cuenta } = await libro('Vacío')
    const quien = (await campo(perfil.id, 'Con quién')).body
    const tx: Tx = (
      await c.post('/api/transactions', {
        profileId: perfil.id, accountId: cuenta.id, type: 'gasto',
        amountCents: 1000, date: '2026-03-10', fields: { [quien.id]: 'Bere' },
      })
    ).body
    assert.equal((await c.get<CampoPropio[]>(`/api/personalizacion/campos?profileId=${perfil.id}`)).body[0]!.usos, 1)

    const corregido = await c.patch<Tx>(`/api/transactions/${tx.id}`, {
      profileId: perfil.id, accountId: cuenta.id, type: 'gasto',
      amountCents: 1000, date: '2026-03-10', fields: { [quien.id]: '' },
    })
    assert.deepEqual(corregido.body.fields, {})
    const campos: CampoPropio[] = (
      await c.get(`/api/personalizacion/campos?profileId=${perfil.id}`)
    ).body
    assert.equal(campos[0]!.usos, 0, '"no contesté" y "contesté nada" son lo mismo')
  })

  test('ausente conserva lo contestado: R17 con otro nombre', async () => {
    const { perfil, cuenta } = await libro('R17')
    const quien = (await campo(perfil.id, 'Con quién')).body
    const tx: Tx = (
      await c.post('/api/transactions', {
        profileId: perfil.id, accountId: cuenta.id, type: 'gasto',
        amountCents: 1000, date: '2026-03-10', fields: { [quien.id]: 'Bere' },
      })
    ).body

    // Corregir la fecha desde un formulario que no manda `fields` —el de un
    // cliente viejo, o el de un libro que no los enseña— no puede vaciarlos.
    const corregido = await c.patch<Tx>(`/api/transactions/${tx.id}`, {
      profileId: perfil.id, accountId: cuenta.id, type: 'gasto',
      amountCents: 1000, date: '2026-03-11',
    })
    assert.equal(corregido.body.fields[String(quien.id)], 'Bere')
  })

  test('no se puede contestar un campo de otro libro', async () => {
    const a = await libro('Dueño')
    const b = await libro('Ajeno')
    const suyo = (await campo(a.perfil.id, 'Placa')).body
    const res = await c.post('/api/transactions', {
      profileId: b.perfil.id, accountId: b.cuenta.id, type: 'gasto',
      amountCents: 1000, date: '2026-03-10', fields: { [suyo.id]: 'X' },
    })
    assert.equal(res.status, 400)
  })

  test('archivar lo calla sin perder lo contestado; borrar dice cuánto se lleva', async () => {
    const { perfil, cuenta } = await libro('Archivar')
    const quien = (await campo(perfil.id, 'Con quién')).body
    for (const d of ['2026-03-01', '2026-03-02']) {
      await c.post('/api/transactions', {
        profileId: perfil.id, accountId: cuenta.id, type: 'gasto',
        amountCents: 1000, date: d, fields: { [quien.id]: 'Bere' },
      })
    }

    const archivado = await c.patch<CampoPropio>(
      `/api/personalizacion/campos/${quien.id}?profileId=${perfil.id}`,
      { archived: true },
    )
    assert.equal(archivado.body.archived, true)
    // Archivado sigue teniendo sus dos respuestas: apagar oculta, nunca borra.
    assert.equal(archivado.body.usos, 2)
    const lista: Tx[] = (await c.get(`/api/transactions?profileId=${perfil.id}`)).body
    assert.equal(lista[0]!.fields[String(quien.id)], 'Bere')

    const borrado = await c.del<{ respuestas: number }>(
      `/api/personalizacion/campos/${quien.id}?profileId=${perfil.id}`,
    )
    assert.equal(borrado.body.respuestas, 2, 'un aviso que no las cuenta miente por omisión')
  })

  test('⚠ el tipo no se cambia debajo de las respuestas que ya existen', async () => {
    const { perfil, cuenta } = await libro('Sin cambiar tipo')
    const libre = (await campo(perfil.id, 'Nota interna')).body
    await c.post('/api/transactions', {
      profileId: perfil.id, accountId: cuenta.id, type: 'gasto',
      amountCents: 1000, date: '2026-03-10', fields: { [libre.id]: 'lo que sea' },
    })
    // Pasarlo a número dejaría "lo que sea" guardado en un campo que el propio
    // validador rechaza al escribir: el estado imposible de la Fase 18.
    const res = await c.patch(`/api/personalizacion/campos/${libre.id}?profileId=${perfil.id}`, {
      kind: 'numero',
    })
    assert.equal(res.status, 409)
    // Sin respuestas sí se puede: ahí no hay nada que contradecir.
    const virgen = (await campo(perfil.id, 'Otro')).body
    const ok = await c.patch(`/api/personalizacion/campos/${virgen.id}?profileId=${perfil.id}`, {
      kind: 'numero',
    })
    assert.equal(ok.status, 200)
  })

  test('sale en el CSV, con su columna y saneado (R7)', async () => {
    const { perfil, cuenta } = await libro('CSV')
    const quien = (await campo(perfil.id, 'Con quién')).body
    await c.post('/api/transactions', {
      profileId: perfil.id, accountId: cuenta.id, type: 'gasto',
      amountCents: 1000, date: '2026-03-10', note: 'Cena',
      fields: { [quien.id]: '=SUM(A1)' },
    })
    const csv = (await c.getText(`/api/transactions/export.csv?profileId=${perfil.id}`)).body
    assert.ok(csv.includes('Con quién'), 'la columna tiene que existir')
    // Una fórmula en un campo propio es exactamente el vector de R7.
    assert.ok(csv.includes("'=SUM(A1)"), 'el valor tiene que ir saneado')
  })
})

// ── Plantillas de movimiento ──────────────────────────────────────────────

describe('una plantilla de movimiento', () => {
  test('guarda el formulario y **no asienta nada**', async () => {
    const { perfil, cuenta, gasto } = await libro('Plantillas')
    const antes = (await c.get(`/api/transactions?profileId=${perfil.id}`)).body.length

    const p = await c.post<PlantillaTx>('/api/personalizacion/plantillas', {
      profileId: perfil.id,
      name: 'Gasolina',
      type: 'gasto',
      accountId: cuenta.id,
      categoryId: gasto.id,
      note: 'Gasolina',
    })
    assert.equal(p.status, 201)
    // Sin monto: "lo pongo yo cada vez", que es el caso de la gasolina.
    assert.equal(p.body.amountCents, null)
    assert.equal(p.body.accountName, 'Banco')

    const despues = (await c.get(`/api/transactions?profileId=${perfil.id}`)).body.length
    assert.equal(despues, antes, 'una plantilla no es una recurrencia: no propone ni asienta')
  })

  test('su categoría tiene que ser del mismo tipo, como en un movimiento', async () => {
    const { perfil, cuenta } = await libro('Tipos plantilla')
    const categorias = (await c.get(`/api/categories?profileId=${perfil.id}`)).body
    const ingreso = categorias.find((x: any) => x.kind === 'ingreso')
    const res = await c.post('/api/personalizacion/plantillas', {
      profileId: perfil.id, name: 'Rara', type: 'gasto',
      accountId: cuenta.id, categoryId: ingreso.id,
    })
    assert.equal(res.status, 400)
  })

  test('borrarla no toca los movimientos que salieron de ella', async () => {
    const { perfil, cuenta } = await libro('Borrar plantilla')
    const p: PlantillaTx = (
      await c.post('/api/personalizacion/plantillas', {
        profileId: perfil.id, name: 'Despensa', type: 'gasto', accountId: cuenta.id,
      })
    ).body
    await c.post('/api/transactions', {
      profileId: perfil.id, accountId: cuenta.id, type: 'gasto',
      amountCents: 90000, date: '2026-03-10', note: 'Despensa',
    })

    await c.del(`/api/personalizacion/plantillas/${p.id}?profileId=${perfil.id}`)
    const lista = (await c.get(`/api/transactions?profileId=${perfil.id}`)).body
    assert.equal(lista.length, 1, 'lo asentado ya es del libro')
  })
})

// ── Las preferencias del perfil ───────────────────────────────────────────

describe('las preferencias del perfil', () => {
  test('nacen en lo de siempre, para que nadie note que existen', async () => {
    const { perfil } = await libro('Por omisión')
    assert.equal(perfil.navOrder, null)
    assert.equal(perfil.homeView, null)
    assert.equal(perfil.dateFormat, 'corto')
    assert.equal(perfil.weekStart, 1)
    assert.equal(perfil.hideCents, false)
  })

  test('se guardan y se sueltan con un null explícito', async () => {
    const { perfil } = await libro('Preferencias')
    const puesto = await c.patch<Profile>(`/api/profiles/${perfil.id}`, {
      navOrder: ['metas', 'movimientos'],
      homeView: 'movimientos',
      dateFormat: 'iso',
      weekStart: 7,
      hideCents: true,
    })
    assert.deepEqual(puesto.body.navOrder, ['metas', 'movimientos'])
    assert.equal(puesto.body.homeView, 'movimientos')
    assert.equal(puesto.body.dateFormat, 'iso')
    assert.equal(puesto.body.hideCents, true)

    // Cambiar el nombre no puede llevarse el orden por delante: ausente no
    // opina, que es la convención de la tinta y de las etiquetas.
    const renombrado = await c.patch<Profile>(`/api/profiles/${perfil.id}`, { name: 'Otro' })
    assert.deepEqual(renombrado.body.navOrder, ['metas', 'movimientos'])

    const suelto = await c.patch<Profile>(`/api/profiles/${perfil.id}`, { navOrder: null })
    assert.equal(suelto.body.navOrder, null)
    assert.equal(suelto.body.homeView, 'movimientos', 'soltar una no suelta las demás')
  })

  test('ninguna toca una cifra del libro', async () => {
    const { perfil, cuenta, gasto } = await libro('Sin efectos')
    await c.post('/api/transactions', {
      profileId: perfil.id, accountId: cuenta.id, type: 'gasto',
      amountCents: 123456, date: '2026-03-10', categoryId: gasto.id,
    })
    const antes: Summary = (await c.get(`/api/summary?profileId=${perfil.id}&month=2026-03`)).body

    await c.patch(`/api/profiles/${perfil.id}`, { hideCents: true, dateFormat: 'iso', weekStart: 7 })

    const despues: Summary = (await c.get(`/api/summary?profileId=${perfil.id}&month=2026-03`)).body
    assert.equal(despues.expenseCents, antes.expenseCents)
    assert.equal(despues.totalCents, antes.totalCents)
  })

  test('⚠ la semana elegida NO mueve la clave de una recurrencia (R5)', async () => {
    const { perfil, cuenta } = await libro('Semana')
    const rec = (
      await c.post('/api/recurrencias', {
        profileId: perfil.id, accountId: cuenta.id, type: 'gasto',
        amountCents: 20000, note: 'Semanal', frequency: 'semanal',
        weekday: 3, startDate: '2026-03-04',
      })
    ).body
    const antes = (
      await c.get(`/api/recurrencias/pendientes?profileId=${perfil.id}&hoy=2026-03-20`)
    ).body

    // Que el usuario prefiera ver la semana empezando en domingo es de vista.
    // La clave de periodo es la semana ISO —de lunes a domingo, por
    // definición— y moverla reproponría el histórico entero.
    await c.patch(`/api/profiles/${perfil.id}`, { weekStart: 7 })

    const despues = (
      await c.get(`/api/recurrencias/pendientes?profileId=${perfil.id}&hoy=2026-03-20`)
    ).body
    assert.deepEqual(
      despues.items.map((p: any) => p.periodo),
      antes.items.map((p: any) => p.periodo),
      'las claves de periodo tienen que ser exactamente las mismas',
    )
    assert.ok(antes.items.length > 0 && rec.id)
  })
})

// ── La configuración exportable ───────────────────────────────────────────

describe('la configuración de un perfil', () => {
  test('sale sin una sola cifra y con las referencias por nombre', async () => {
    const { perfil, cuenta, gasto } = await libro('Origen')
    await campo(perfil.id, 'Placa')
    await c.post('/api/personalizacion/plantillas', {
      profileId: perfil.id, name: 'Gasolina', type: 'gasto',
      accountId: cuenta.id, categoryId: gasto.id, note: 'Gasolina',
    })
    await c.post('/api/transactions', {
      profileId: perfil.id, accountId: cuenta.id, type: 'gasto',
      amountCents: 99999, date: '2026-03-10',
    })
    await c.patch(`/api/profiles/${perfil.id}`, { dateFormat: 'iso', hideCents: true })

    const config = (await c.get(`/api/personalizacion/config?profileId=${perfil.id}`)).body
    const texto = JSON.stringify(config)
    assert.ok(!texto.includes('99999'), 'la configuración no lleva movimientos')
    assert.equal(config.perfil.dateFormat, 'iso')
    assert.equal(config.campos.length, 1)
    // Por **nombre**, no por id: un id no significa nada en otro libro.
    assert.equal(config.plantillas[0].cuenta, 'Banco')
    assert.ok(config.plantillas[0].categoria)
  })

  test('aplicarla a otro libro crea lo que falta y respeta lo que hay', async () => {
    const origen = await libro('Molde')
    await campo(origen.perfil.id, 'Placa')
    await c.post('/api/categories', {
      profileId: origen.perfil.id, name: 'Mascotas', kind: 'gasto',
    })
    await c.post('/api/personalizacion/plantillas', {
      profileId: origen.perfil.id, name: 'Gasolina', type: 'gasto',
      accountId: origen.cuenta.id, categoryId: origen.gasto.id,
    })
    await c.patch(`/api/profiles/${origen.perfil.id}`, { dateFormat: 'numerico' })
    const config = (await c.get(`/api/personalizacion/config?profileId=${origen.perfil.id}`)).body

    const destino = await libro('Destino')
    await c.post('/api/transactions', {
      profileId: destino.perfil.id, accountId: destino.cuenta.id, type: 'gasto',
      amountCents: 55555, date: '2026-03-10', categoryId: destino.gasto.id,
    })
    const movimientosAntes = (
      await c.get(`/api/transactions?profileId=${destino.perfil.id}`)
    ).body.length

    const r = await c.post(`/api/personalizacion/config?profileId=${destino.perfil.id}`, config)
    assert.equal(r.status, 200)
    assert.equal(r.body.camposNuevos, 1)
    assert.equal(r.body.plantillasNuevas, 1)
    // Las categorías del alta son las mismas en los dos: solo entra la que el
    // destino no tenía.
    assert.equal(r.body.categoriasNuevas, 1)
    assert.ok(r.body.respetadas.categorias > 0, 'lo que ya estaba no se toca')

    // Y lo importante: no borró nada.
    const despues = (await c.get(`/api/transactions?profileId=${destino.perfil.id}`)).body
    assert.equal(despues.length, movimientosAntes)
    const perfiles: Profile[] = (await c.get('/api/profiles')).body
    const actualizado = perfiles.find((p) => p.id === destino.perfil.id)!
    assert.equal(actualizado.dateFormat, 'numerico')
    assert.equal(actualizado.name, 'Destino', 'el nombre es identidad, no configuración')
  })

  test('aplicarla dos veces no duplica nada', async () => {
    const origen = await libro('Idempotente')
    await campo(origen.perfil.id, 'Placa')
    const config = (await c.get(`/api/personalizacion/config?profileId=${origen.perfil.id}`)).body

    const destino = await libro('Dos veces')
    await c.post(`/api/personalizacion/config?profileId=${destino.perfil.id}`, config)
    const segunda = await c.post(
      `/api/personalizacion/config?profileId=${destino.perfil.id}`,
      config,
    )
    assert.equal(segunda.body.camposNuevos, 0)
    const campos: CampoPropio[] = (
      await c.get(`/api/personalizacion/campos?profileId=${destino.perfil.id}`)
    ).body
    assert.equal(campos.length, 1)
  })

  test('una plantilla cuya cuenta no existe allá llega coja y se dice', async () => {
    const origen = await libro('Con cuenta rara')
    const rara = (
      await c.post('/api/accounts', {
        profileId: origen.perfil.id, name: 'Cuenta que solo existe aquí', type: 'banco',
      })
    ).body
    await c.post('/api/personalizacion/plantillas', {
      profileId: origen.perfil.id, name: 'Rara', type: 'gasto', accountId: rara.id,
    })
    const config = (await c.get(`/api/personalizacion/config?profileId=${origen.perfil.id}`)).body

    const destino = await libro('Sin esa cuenta')
    const r = await c.post(`/api/personalizacion/config?profileId=${destino.perfil.id}`, config)
    assert.deepEqual(r.body.plantillasCojas, ['Rara'])
    // Coja pero viva: borrarla tiraría el nombre y el concepto que ya se
    // habían escrito.
    const plantillas: PlantillaTx[] = (
      await c.get(`/api/personalizacion/plantillas?profileId=${destino.perfil.id}`)
    ).body
    assert.equal(plantillas.length, 1)
    assert.equal(plantillas[0]!.accountId, null)
  })

  test('un archivo que no es una configuración se rechaza sin tocar nada', async () => {
    const { perfil } = await libro('Intacto')
    const res = await c.post(`/api/personalizacion/config?profileId=${perfil.id}`, {
      hola: 'no soy una config',
    })
    assert.equal(res.status, 400)
  })
})

// ── Los módulos puros ─────────────────────────────────────────────────────

describe('el formato (shared/formato.ts)', () => {
  test('cada convención escribe la misma fecha distinto', () => {
    assert.equal(fechaCon('2026-06-12', 'corto'), '12 jun')
    assert.equal(fechaCon('2026-06-12', 'numerico'), '12/06/2026')
    assert.equal(fechaCon('2026-06-12', 'iso'), '2026-06-12')
    // El corto se come el año a propósito; con año lo lleva corto.
    assert.equal(fechaConAnio('2026-06-12', 'corto'), '12 jun 26')
    assert.equal(fechaConAnio('2026-06-12', 'iso'), '2026-06-12')
  })

  test('sin centavos **redondea**, no trunca', () => {
    // Truncar sesga todo hacia abajo y una columna de gastos acabaría diciendo
    // menos de lo que costaron.
    const sin = { fecha: 'corto' as const, sinCentavos: true, inicioSemana: 1 }
    const con = { fecha: 'corto' as const, sinCentavos: false, inicioSemana: 1 }
    assert.ok(pesosCon(129990, sin).includes('1,300'))
    assert.ok(pesosCon(129940, sin).includes('1,299'))
    assert.ok(pesosCon(129990, con).includes('1,299.90'))
  })

  test('la semana empieza donde diga el perfil, con los siete días', () => {
    assert.equal(diasDesde(1)[0]!.label, 'lunes')
    assert.equal(diasDesde(7)[0]!.label, 'domingo')
    assert.equal(diasDesde(7)[1]!.label, 'lunes')
    // Siempre los siete, y sin repetir ninguno.
    assert.equal(new Set(diasDesde(4).map((d) => d.id)).size, 7)
  })
})

describe('los campos propios en el formulario (shared/campos.ts)', () => {
  const personal = ['cuentas', 'presupuestos'] as any

  test('sin campos propios, el formulario no estrena una sección vacía', () => {
    assert.ok(!camposDelMovimiento({ modules: personal, type: 'gasto' }).includes('propios'))
    assert.ok(
      camposDelMovimiento({ modules: personal, type: 'gasto', hayCamposPropios: true }).includes(
        'propios',
      ),
    )
  })

  test('una transferencia sí los pregunta, a diferencia de los de negocio', () => {
    // Son del usuario, no de Finply: él sabrá si su traspaso lleva número de
    // obra. Los de negocio no, porque mover dinero entre bolsillos tuyos no
    // tiene contraparte (D6).
    const campos = camposDelMovimiento({
      modules: [...personal, 'negocio'] as any,
      type: 'transferencia',
      hayCamposPropios: true,
    })
    assert.ok(campos.includes('propios'))
    assert.ok(!campos.includes('negocio'))
  })

  test('un libro con campos propios los pide alguna vez', () => {
    assert.equal(libroPide(personal, 'propios'), true)
  })
})
