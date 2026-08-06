// Fase 11 · patrimonio completo. Los tres hallazgos de la auditoría, que no
// eran mejoras: eran cosas que el libro decía mal.
//
//  H3. Financiar un auto creaba una deuda que **bajaba** el patrimonio y el
//      auto nunca lo subía: el Resumen decía que comprar un coche de $240,000
//      te empobrecía $240,000.
//  H1. Apartar dinero para una meta no lo quitaba de ningún lado. Era la única
//      sección donde el dinero aparecía de la nada.
//  H2. `accounts.currency` se podía poner en USD y los saldos se sumaban sin
//      convertir. Nadie lo notaba porque nadie la usaba.

import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { levantar, libroBase, type Cliente } from './ayuda.ts'

let c: Cliente
let perfil: any
let cuenta: any
let categorias: any[]

before(async () => {
  c = await levantar()
  const base = await libroBase(c)
  perfil = base.perfil
  cuenta = base.cuenta
  categorias = base.categorias
})
after(async () => c.cerrar())

const patrimonioDe = async (year: number, month: string) => {
  const reporte = (await c.get(`/api/reportes?profileId=${perfil.id}&year=${year}`)).body
  return reporte.patrimonio.find((p: any) => p.month === month)
}

describe('H3 · bienes', () => {
  let auto: any
  let deuda: any

  test('financiar un auto ya no te empobrece', async () => {
    const antes = (await c.get(`/api/summary?profileId=${perfil.id}&month=2026-03`)).body
    const patrimonioAntes =
      antes.totalCents + antes.investments.valueCents + antes.bienes.valueCents +
      antes.debts.porCobrarCents - antes.debts.porPagarCents

    // El crédito: $240,000 a pagar, con su desembolso en la cuenta.
    deuda = (
      await c.post('/api/debts', {
        profileId: perfil.id,
        direction: 'por_pagar',
        counterparty: 'Financiera',
        concept: 'Crédito automotriz',
        principalCents: 24000000,
        startDate: '2026-03-01',
        annualRateBp: 1350,
        termMonths: 48,
      })
    ).body

    const conDeuda = (await c.get(`/api/summary?profileId=${perfil.id}&month=2026-03`)).body
    const patrimonioConDeuda =
      conDeuda.totalCents + conDeuda.investments.valueCents + conDeuda.bienes.valueCents +
      conDeuda.debts.porCobrarCents - conDeuda.debts.porPagarCents
    assert.equal(
      patrimonioConDeuda,
      patrimonioAntes - 24000000,
      'sin el bien, la deuda sola resta: ese era el defecto',
    )

    // Y ahora el auto, ligado a su crédito.
    auto = (
      await c.post('/api/bienes', {
        profileId: perfil.id,
        name: 'Auto',
        kind: 'vehiculo',
        costCents: 24000000,
        acquiredDate: '2026-03-01',
        debtId: deuda.id,
      })
    ).body
    assert.equal(auto.valueCents, 24000000, 'sin valuación, un bien vale lo que costó')
    assert.equal(auto.depreciacionCents, 0)
    assert.equal(auto.equityCents, 0, 'debes exactamente lo que vale: todavía no es tuyo')

    const conBien = (await c.get(`/api/summary?profileId=${perfil.id}&month=2026-03`)).body
    const patrimonioConBien =
      conBien.totalCents + conBien.investments.valueCents + conBien.bienes.valueCents +
      conBien.debts.porCobrarCents - conBien.debts.porPagarCents
    assert.equal(patrimonioConBien, patrimonioAntes, 'comprar el coche te deja igual, no peor')
  })

  test('la depreciación la declara el usuario, nunca Finply', async () => {
    const valuado = (
      await c.post(`/api/bienes/${auto.id}/valuaciones`, {
        date: '2026-06-15',
        valueCents: 19000000,
        note: 'Guía de precios',
      })
    ).body
    assert.equal(valuado.valueCents, 19000000)
    assert.equal(valuado.depreciacionCents, 5000000, 'perdió $50,000 desde que lo compró')

    // Y es a fecha: al 2026 todavía valía lo que costó.
    const enSuMomento = (
      await c.get(`/api/bienes?profileId=${perfil.id}&hoy=2026-04-01`)
    ).body.find((b: any) => b.id === auto.id)
    assert.equal(enSuMomento.valueCents, 24000000, 'una valuación posterior no vale antes')
  })

  test('repetir la fecha corrige la valuación en vez de apilarla', async () => {
    const otra = (
      await c.post(`/api/bienes/${auto.id}/valuaciones`, {
        date: '2026-06-15',
        valueCents: 18500000,
      })
    ).body
    assert.equal(otra.entries.length, 1, 'un día, un valor')
    assert.equal(otra.valueCents, 18500000)
  })

  test('la deuda del bien no se resta dos veces', async () => {
    // Se abona capital: la deuda baja y el equity del bien sube en la misma
    // cifra. El patrimonio total se mueve solo por el interés, no por el bien.
    const bienAntes = (await c.get(`/api/bienes?profileId=${perfil.id}`)).body[0]
    await c.post(`/api/debts/${deuda.id}/payments`, {
      amountCents: 500000,
      date: '2026-04-01',
      interestCents: 0,
    })
    const bienDespues = (await c.get(`/api/bienes?profileId=${perfil.id}`)).body[0]
    assert.equal(
      bienDespues.equityCents - bienAntes.equityCents,
      500000,
      'lo que abonas de capital es lo que se vuelve tuyo del bien',
    )
    // El renglón del patrimonio sigue siendo el **valor**, no el equity.
    const punto = await patrimonioDe(2026, '2026-04')
    assert.equal(punto.bienesCents, 24000000)
  })

  test('la serie de patrimonio cuadra con el Resumen, con bienes de por medio', async () => {
    const hoy = new Date().toISOString().slice(0, 10)
    const resumen = (await c.get(`/api/summary?profileId=${perfil.id}&month=${hoy.slice(0, 7)}`)).body
    const esperado =
      resumen.totalCents + resumen.investments.valueCents + resumen.bienes.valueCents +
      resumen.debts.porCobrarCents - resumen.debts.porPagarCents
    const reporte = (await c.get(`/api/reportes?profileId=${perfil.id}&year=${hoy.slice(0, 4)}`)).body
    const ultimo = reporte.patrimonio[Number(hoy.slice(5, 7)) - 1]
    assert.equal(ultimo.totalCents, esperado, 'dos vistas del mismo patrimonio dan lo mismo')
  })

  test('un bien archivado deja de contar, y borrarlo se lleva sus valuaciones', async () => {
    await c.patch(`/api/bienes/${auto.id}`, { archived: true })
    const punto = await patrimonioDe(2026, '2026-04')
    assert.equal(punto.bienesCents, 0)

    assert.equal((await c.del(`/api/bienes/${auto.id}`)).status, 200)
    const respaldo = (await c.get('/api/respaldo')).body
    assert.equal(respaldo.tables.asset_valuations.length, 0)
  })
})

describe('H1 · metas ligadas al libro', () => {
  let ahorro: any
  let meta: any

  before(async () => {
    ahorro = (
      await c.post('/api/accounts', { profileId: perfil.id, name: 'Ahorro', type: 'ahorro' })
    ).body
  })

  test('un aporte sin cuenta sigue siendo un apunte, y se dice', async () => {
    meta = (
      await c.post('/api/goals', {
        profileId: perfil.id,
        name: 'Fondo de emergencia',
        targetCents: 5000000,
        dueDate: '2027-12-31',
      })
    ).body
    const conApunte = (await c.post(`/api/goals/${meta.id}/entries`, {
      amountCents: 1000000,
      date: '2026-05-02',
    })).body
    assert.equal(conApunte.savedCents, 1000000)
    assert.equal(conApunte.respaldadoCents, 0, 'ese dinero no salió de ninguna cuenta')
    assert.equal(conApunte.accountId, null)
  })

  test('sin cuenta de la meta, mover el aporte se rechaza en vez de adivinar', async () => {
    const res = await c.post(`/api/goals/${meta.id}/entries`, {
      amountCents: 500000,
      date: '2026-05-10',
      accountId: cuenta.id,
    })
    assert.equal(res.status, 400)
    assert.match(JSON.stringify(res.body), /dónde vive su dinero/)
  })

  test('con cuenta, el aporte mueve dinero de verdad y deja de ser fantasma', async () => {
    await c.patch(`/api/goals/${meta.id}`, { accountId: ahorro.id })
    const saldoAntes = ((await c.get(`/api/accounts?profileId=${perfil.id}`)).body as any[])
      .find((a) => a.id === ahorro.id)!.balanceCents

    const conMovimiento = (await c.post(`/api/goals/${meta.id}/entries`, {
      amountCents: 500000,
      date: '2026-05-10',
      accountId: cuenta.id,
    })).body
    assert.equal(conMovimiento.savedCents, 1500000)
    assert.equal(conMovimiento.respaldadoCents, 500000, 'solo la mitad tiene respaldo')

    const saldoDespues = ((await c.get(`/api/accounts?profileId=${perfil.id}`)).body as any[])
      .find((a) => a.id === ahorro.id)!.balanceCents
    assert.equal(saldoDespues, saldoAntes + 500000, 'el dinero llegó a la cuenta de la meta')

    const entry = conMovimiento.entries.find((e: any) => e.amountCents === 500000)
    assert.ok(entry.txId, 'el aporte trae su movimiento')
  })

  test('apartar para una meta no es gasto ni ingreso (D6)', async () => {
    const reporte = (await c.get(`/api/reportes?profileId=${perfil.id}&year=2026`)).body
    const mayo = reporte.meses.find((m: any) => m.month === '2026-05')
    assert.equal(mayo.expenseCents, 0, 'mover dinero entre bolsillos tuyos no es gasto')
    assert.equal(mayo.incomeCents, 0)
  })

  test('dice cuánto hay que apartar al mes para llegar', async () => {
    const metas = (await c.get(`/api/goals?profileId=${perfil.id}`)).body as any[]
    const m = metas.find((x) => x.id === meta.id)!
    assert.ok(m.porMesCents > 0)
    // Lo que falta, repartido entre los meses que quedan hasta la fecha límite.
    assert.ok(m.porMesCents * 24 >= m.targetCents - m.savedCents)
  })

  test('borrar el aporte se lleva su movimiento', async () => {
    const metas = (await c.get(`/api/goals?profileId=${perfil.id}`)).body as any[]
    const m = metas.find((x) => x.id === meta.id)!
    const conTx = m.entries.find((e: any) => e.txId)!
    const saldoAntes = ((await c.get(`/api/accounts?profileId=${perfil.id}`)).body as any[])
      .find((a) => a.id === ahorro.id)!.balanceCents

    await c.del(`/api/goals/entries/${conTx.id}`)

    const saldoDespues = ((await c.get(`/api/accounts?profileId=${perfil.id}`)).body as any[])
      .find((a) => a.id === ahorro.id)!.balanceCents
    assert.equal(saldoDespues, saldoAntes - 500000, 'ese traspaso nunca ocurrió')
  })
})

describe('H2 · una moneda por perfil (D18)', () => {
  test('el perfil lleva su moneda y las cuentas la heredan', async () => {
    const perfiles = (await c.get('/api/profiles')).body as any[]
    const p = perfiles.find((x) => x.id === perfil.id)!
    assert.equal(p.currency, 'MXN')
  })
})

describe('cuentas', () => {
  test('el saldo mínimo avisa, y quedarse justo en él no', async () => {
    const chica = (
      await c.post('/api/accounts', {
        profileId: perfil.id,
        name: 'Gastos',
        type: 'banco',
        openingCents: 100000,
        minBalanceCents: 100000,
        institution: 'Nu',
      })
    ).body
    assert.equal(chica.institution, 'Nu')

    const sinAlerta = (await c.get(`/api/alertas?profileId=${perfil.id}`)).body as any[]
    assert.ok(
      !sinAlerta.some((a) => a.tipo === 'saldo_minimo'),
      'estar exactamente en el mínimo es cumplirlo',
    )

    await c.post('/api/transactions', {
      profileId: perfil.id,
      accountId: chica.id,
      type: 'gasto',
      amountCents: 1,
      date: '2026-06-01',
      categoryId: categorias.find((x) => x.kind === 'gasto')!.id,
    })
    const conAlerta = (await c.get(`/api/alertas?profileId=${perfil.id}`)).body as any[]
    const alerta = conAlerta.find((a) => a.tipo === 'saldo_minimo')
    assert.ok(alerta, 'un centavo abajo sí avisa')
    assert.equal(alerta.montoCents, 1)
    assert.equal(alerta.vista, 'cuentas')
  })

  test('la serie por cuenta da el saldo al cierre de cada mes', async () => {
    const serie = (await c.get(`/api/accounts/${cuenta.id}/serie?meses=6`)).body
    assert.equal(serie.puntos.length, 6)
    assert.equal(serie.accountId, cuenta.id)
    // El último punto es el saldo de hoy, el mismo que enseña la vista de Cuentas.
    const hoy = ((await c.get(`/api/accounts?profileId=${perfil.id}`)).body as any[])
      .find((a) => a.id === cuenta.id)!.balanceCents
    assert.equal(serie.puntos[5].balanceCents, hoy)
  })

  test('el orden lo decide el usuario', async () => {
    const antes = (await c.get(`/api/accounts?profileId=${perfil.id}`)).body as any[]
    const ultima = antes[antes.length - 1]!
    await c.patch(`/api/accounts/${ultima.id}`, { sortOrder: -10 })
    const despues = (await c.get(`/api/accounts?profileId=${perfil.id}`)).body as any[]
    assert.equal(despues[0]!.id, ultima.id)
  })
})

describe('el respaldo se lleva los bienes', () => {
  test('bienes y valuaciones sobreviven a exportar y restaurar', async () => {
    await c.post('/api/bienes', {
      profileId: perfil.id,
      name: 'Herramienta',
      kind: 'equipo',
      costCents: 800000,
      acquiredDate: '2026-01-15',
    })
    const bien = ((await c.get(`/api/bienes?profileId=${perfil.id}`)).body as any[])[0]!
    await c.post(`/api/bienes/${bien.id}/valuaciones`, { date: '2026-07-01', valueCents: 600000 })

    const antes = (await c.get('/api/respaldo')).body
    assert.ok(antes.tables.assets.length > 0)
    assert.ok(antes.tables.asset_valuations.length > 0)
    const bienesAntes = (await c.get(`/api/bienes?profileId=${perfil.id}`)).body

    assert.equal((await c.post('/api/respaldo/restaurar', antes)).status, 200)
    assert.deepEqual((await c.get(`/api/bienes?profileId=${perfil.id}`)).body, bienesAntes)
  })
})
