// Panel de análisis.
//
// La prueba que más importa aquí no es ninguna cifra suelta: es que la tasa de
// ahorro del panel sea **la misma** que la de Reportes sobre los mismos meses.
// Si se separan, el usuario ve dos verdades del mismo libro, que es justo lo
// que la Fase 4 evitó haciendo que el patrimonio reusara la fórmula del
// Resumen.

import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { levantar, libroBase, type Cliente } from './ayuda.ts'

let c: Cliente
before(async () => {
  c = await levantar()
})
after(() => c?.cerrar())

async function analisis(profileId: number, meses: number, hoy: string) {
  const res = await c.get(`/api/analisis?profileId=${profileId}&meses=${meses}&hoy=${hoy}`)
  assert.equal(res.status, 200)
  return res.body
}

describe('la ventana son meses cerrados', () => {
  test('el mes en curso no entra: va a medias', async () => {
    const { perfil, cuenta, categorias } = await libroBase(c, 'Ventana')
    const gasto = categorias.find((k: any) => k.kind === 'gasto')
    const ingreso = categorias.find((k: any) => k.kind === 'ingreso')

    const mover = (tipo: string, cents: number, fecha: string, cat: any) =>
      c.post('/api/transactions', {
        profileId: perfil.id,
        accountId: cuenta.id,
        type: tipo,
        amountCents: cents,
        date: fecha,
        categoryId: cat.id,
      })

    await mover('gasto', 100000, '2026-05-10', gasto)
    await mover('gasto', 200000, '2026-06-10', gasto)
    await mover('ingreso', 500000, '2026-06-15', ingreso)
    // Julio es el mes en curso: nada de esto debe contar.
    await mover('gasto', 900000, '2026-07-10', gasto)

    const a = await analisis(perfil.id, 6, '2026-07-20')
    assert.equal(a.hasta, '2026-06', 'el último mes cerrado es junio')
    assert.equal(a.expenseCents, 300000, 'julio queda fuera')
    assert.equal(a.incomeCents, 500000)
  })

  test('un libro de dos meses divide entre dos, no entre seis', async () => {
    const { perfil, cuenta, categorias } = await libroBase(c, 'Corto')
    const gasto = categorias.find((k: any) => k.kind === 'gasto')
    for (const fecha of ['2026-05-10', '2026-06-10']) {
      await c.post('/api/transactions', {
        profileId: perfil.id,
        accountId: cuenta.id,
        type: 'gasto',
        amountCents: 100000,
        date: fecha,
        categoryId: gasto.id,
      })
    }

    const a = await analisis(perfil.id, 6, '2026-07-20')
    assert.equal(a.meses, 2, 'solo hay dos meses cerrados con libro')
    assert.equal(a.desde, '2026-05')
    assert.equal(a.gastoPromedioCents, 100000, 'dividir entre seis inventaría un colchón')
  })

  test('sin un mes cerrado no se dice nada, en vez de decir cero', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Nuevo')
    await c.post('/api/transactions', {
      profileId: perfil.id,
      accountId: cuenta.id,
      type: 'gasto',
      amountCents: 5000,
      date: '2026-07-03',
    })

    const a = await analisis(perfil.id, 6, '2026-07-20')
    assert.equal(a.meses, 0)
    assert.equal(a.gastoPromedioCents, null)
    assert.equal(a.mesesColchon, null, 'dividir entre cero no da infinito, da "no se sabe"')
    assert.equal(a.tasaAhorro, null)
    // El líquido es el de **hoy**, no el de la ventana: el colchón es lo que
    // tienes ahora, y el gasto del mes en curso ya lo bajó.
    assert.equal(a.liquidoCents, 95000, 'el saldo líquido sí se sabe siempre')
  })
})

describe('recurrente contra discrecional', () => {
  test('recurrente es lo que nació de una recurrencia, y las dos mitades cuadran', async () => {
    const { perfil, cuenta, categorias } = await libroBase(c, 'Origen')
    const gasto = categorias.find((k: any) => k.kind === 'gasto')

    const rec = (
      await c.post('/api/recurrencias', {
        profileId: perfil.id,
        accountId: cuenta.id,
        type: 'gasto',
        amountCents: 850000,
        categoryId: gasto.id,
        note: 'Renta',
        frequency: 'mensual',
        dayOfMonth: 1,
        startDate: '2026-05-01',
      })
    ).body
    await c.post(`/api/recurrencias/${rec.id}/asentar?profileId=${perfil.id}`, { periodo: '2026-05' })
    await c.post(`/api/recurrencias/${rec.id}/asentar?profileId=${perfil.id}`, { periodo: '2026-06' })

    // Un gasto igualito pero apuntado a mano: cae en discrecional a propósito,
    // y por eso el supuesto va escrito en la vista (D11).
    await c.post('/api/transactions', {
      profileId: perfil.id,
      accountId: cuenta.id,
      type: 'gasto',
      amountCents: 850000,
      date: '2026-06-02',
      categoryId: gasto.id,
      note: 'Renta de la bodega, apuntada a mano',
    })
    await c.post('/api/transactions', {
      profileId: perfil.id,
      accountId: cuenta.id,
      type: 'gasto',
      amountCents: 45000,
      date: '2026-06-12',
      categoryId: gasto.id,
    })

    const a = await analisis(perfil.id, 6, '2026-07-20')
    assert.equal(a.recurrenteCents, 1700000, 'las dos rentas asentadas desde la bandeja')
    assert.equal(a.discrecionalCents, 895000, 'la apuntada a mano y el gasto suelto')
    assert.equal(
      a.recurrenteCents + a.discrecionalCents,
      a.expenseCents,
      'las dos mitades suman exactamente el gasto del periodo',
    )
  })

  test('anular el movimiento devuelve el gasto a discrecional', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Anular')
    const rec = (
      await c.post('/api/recurrencias', {
        profileId: perfil.id,
        accountId: cuenta.id,
        type: 'gasto',
        amountCents: 30000,
        note: 'Gimnasio',
        frequency: 'mensual',
        dayOfMonth: 1,
        startDate: '2026-06-01',
      })
    ).body
    const tx = (
      await c.post(`/api/recurrencias/${rec.id}/asentar?profileId=${perfil.id}`, {
        periodo: '2026-06',
      })
    ).body

    assert.equal((await analisis(perfil.id, 6, '2026-07-20')).recurrenteCents, 30000)
    await c.del(`/api/transactions/${tx.id}`)
    const despues = await analisis(perfil.id, 6, '2026-07-20')
    assert.equal(despues.recurrenteCents, 0, 'sin movimiento no hay liga')
    assert.equal(despues.expenseCents, 0)
  })
})

describe('meses de colchón', () => {
  test('líquido entre gasto promedio; la tarjeta no es colchón', async () => {
    const { perfil, cuenta, categorias } = await libroBase(c, 'Colchón')
    const gasto = categorias.find((k: any) => k.kind === 'gasto')
    // La cuenta base abre con $1,000. Se agregan $9,000 de ahorro y una
    // tarjeta con saldo a favor que **no** debe contar como colchón.
    await c.post('/api/accounts', {
      profileId: perfil.id,
      name: 'Ahorro',
      type: 'ahorro',
      openingCents: 900000,
    })
    await c.post('/api/accounts', {
      profileId: perfil.id,
      name: 'Tarjeta',
      type: 'tarjeta',
      openingCents: 500000,
    })

    for (const fecha of ['2026-05-10', '2026-06-10']) {
      await c.post('/api/transactions', {
        profileId: perfil.id,
        accountId: cuenta.id,
        type: 'gasto',
        amountCents: 250000,
        date: fecha,
        categoryId: gasto.id,
      })
    }

    const a = await analisis(perfil.id, 6, '2026-07-20')
    // $1,000 iniciales − $5,000 de gastos + $9,000 de ahorro = $5,000.
    assert.equal(a.liquidoCents, 500000, 'la tarjeta queda fuera')
    assert.equal(a.gastoPromedioCents, 250000)
    assert.equal(a.mesesColchon, 2, '$5,000 entre $2,500 al mes')
  })

  test('una cuenta archivada deja de ser colchón', async () => {
    const { perfil } = await libroBase(c, 'Archivada')
    const otra = (
      await c.post('/api/accounts', {
        profileId: perfil.id,
        name: 'Vieja',
        type: 'banco',
        openingCents: 300000,
      })
    ).body
    assert.equal((await analisis(perfil.id, 6, '2026-07-20')).liquidoCents, 400000)
    await c.patch(`/api/accounts/${otra.id}`, { archived: true })
    assert.equal((await analisis(perfil.id, 6, '2026-07-20')).liquidoCents, 100000)
  })
})

describe('una sola verdad', () => {
  test('la tasa de ahorro del panel es la misma que la de Reportes', async () => {
    const { perfil, cuenta, categorias } = await libroBase(c, 'Coherencia')
    const gasto = categorias.find((k: any) => k.kind === 'gasto')
    const ingreso = categorias.find((k: any) => k.kind === 'ingreso')

    // Un año entero de 2026, con un préstamo de por medio: es justo lo que
    // distorsionaba la tasa antes de D6.
    for (let m = 1; m <= 12; m++) {
      const mes = String(m).padStart(2, '0')
      await c.post('/api/transactions', {
        profileId: perfil.id,
        accountId: cuenta.id,
        type: 'ingreso',
        amountCents: 3000000,
        date: `2026-${mes}-05`,
        categoryId: ingreso.id,
      })
      await c.post('/api/transactions', {
        profileId: perfil.id,
        accountId: cuenta.id,
        type: 'gasto',
        amountCents: 2000000,
        date: `2026-${mes}-15`,
        categoryId: gasto.id,
      })
    }
    await c.post('/api/debts', {
      profileId: perfil.id,
      direction: 'por_pagar',
      counterparty: 'Banco',
      principalCents: 24000000,
      startDate: '2026-03-01',
      accountId: cuenta.id,
      annualRateBp: 1350,
      termMonths: 48,
    })

    // El panel de 12 meses cerrados al 1 de enero de 2027 es exactamente 2026.
    const panel = await analisis(perfil.id, 12, '2027-01-15')
    const reporte = (await c.get(`/api/reportes?profileId=${perfil.id}&year=2026`)).body

    assert.equal(panel.desde, '2026-01')
    assert.equal(panel.hasta, '2026-12')
    assert.equal(panel.incomeCents, reporte.totales.incomeCents)
    assert.equal(panel.expenseCents, reporte.totales.expenseCents)
    assert.equal(panel.tasaAhorro, reporte.totales.tasaAhorro, 'la misma cifra, del mismo cálculo')
    assert.ok(panel.tasaAhorro! > 0.32 && panel.tasaAhorro! < 0.34, 'y el préstamo no la infló')
  })

  test('la concentración por categoría reparte todo el gasto', async () => {
    const { perfil, cuenta, categorias } = await libroBase(c, 'Concentración')
    const gastos = categorias.filter((k: any) => k.kind === 'gasto').slice(0, 3)
    const montos = [600000, 300000, 100000]
    for (let i = 0; i < 3; i++) {
      await c.post('/api/transactions', {
        profileId: perfil.id,
        accountId: cuenta.id,
        type: 'gasto',
        amountCents: montos[i]!,
        date: '2026-06-10',
        categoryId: gastos[i]!.id,
      })
    }

    const a = await analisis(perfil.id, 6, '2026-07-20')
    assert.equal(a.concentracion.length, 3)
    assert.equal(a.concentracion[0].parte, 0.6, 'la mayor se lleva 60 %')
    const suma = a.concentracion.reduce((s: number, k: any) => s + k.parte, 0)
    assert.ok(Math.abs(suma - 1) < 1e-9, 'las partes suman uno')
    assert.deepEqual(
      [...a.concentracion].sort((x: any, y: any) => y.expenseCents - x.expenseCents),
      a.concentracion,
      'ya vienen de mayor a menor',
    )
  })
})
