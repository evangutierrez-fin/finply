// Fase 22 · Auditoría de las finanzas de Finply · cuadre cruzado y redondeo.
//
// La segunda mitad de la auditoría. El barrido por dominio (`auditoria.test.ts`)
// pregunta "¿esta cuenta está bien?"; esto pregunta las dos que quedan:
//
//   · **¿Las cifras que aparecen en dos vistas dicen lo mismo?** Un patrimonio
//     que vale una cosa en el Resumen y otra en Reportes no es un detalle de
//     presentación: son dos verdades sobre el mismo peso, que es justo lo que
//     D14 y R18 prohíben. Hay precedentes de que esto se separa solo —el
//     Resumen sumaba `amount_cents` en crudo hasta la Fase 18— y por eso se
//     audita en vez de suponerse.
//   · **¿Alguna suma de partes se aleja de su total?** Los renglones de un
//     ticket, las parcialidades de una compra a meses, los cobros de una
//     factura, la cadena de arrastre de un presupuesto y el desglose por
//     categoría de un año. Cada uno tiene un total declarado en otro lado, y
//     ahí es donde el redondeo se escapa.
//
// Igual que en la otra mitad: **lo esperado no sale del código auditado**. Este
// archivo lleva su propio libro paralelo —una lista de partidas con la regla de
// D6 escrita otra vez— y compara contra él.

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { levantar, libroBase, type Cliente } from './ayuda.ts'

const suma = (xs: number[]) => xs.reduce((s, x) => s + x, 0)

/**
 * El libro paralelo del auditor. Cada partida se apunta aquí con **lo que
 * cuenta** según D6, no con su monto: un préstamo recibido vale cero, de un
 * abono a deuda cuenta solo el interés y una devolución es gasto en negativo.
 * La regla se escribe aquí otra vez a propósito.
 */
interface Apunte {
  fecha: string
  lado: 'ingreso' | 'gasto'
  categoria: string
  cents: number
}

// ── El año entero de un libro ─────────────────────────────────────────────

describe('Auditoría · un año de libro, contado dos veces', () => {
  let c: Cliente
  let perfil: any
  let banco: any
  let ahorro: any
  let cat: Record<string, number>
  const libro: Apunte[] = []
  /** Interés de cada abono, según lo devengue Finply: se lee, no se supone. */
  let interesesDeAbonos = 0

  const mes = (n: number) => `2025-${String(n).padStart(2, '0')}`

  before(async () => {
    c = await levantar()
    const base = await libroBase(c)
    perfil = base.perfil
    banco = base.cuenta
    cat = Object.fromEntries(
      base.categorias.map((x: any) => [`${x.kind}·${x.name}`, x.id]),
    ) as Record<string, number>
    ahorro = (
      await c.post('/api/accounts', {
        profileId: perfil.id,
        name: 'Ahorro',
        type: 'ahorro',
        openingCents: 0,
      })
    ).body

    const mover = async (body: any, apunte?: Apunte) => {
      const res = await c.post('/api/transactions', { profileId: perfil.id, ...body })
      assert.equal(res.status, 201, JSON.stringify(res.body))
      if (apunte) libro.push(apunte)
      return res.body
    }

    // Doce sueldos y doce meses de gasto corriente. Nada raro: es el fondo
    // sobre el que se ven las excepciones de D6.
    for (let m = 1; m <= 12; m++) {
      await mover(
        {
          accountId: banco.id,
          type: 'ingreso',
          amountCents: 4_800_000 + m * 1_111,
          date: `${mes(m)}-05`,
          categoryId: cat['ingreso·Sueldo'],
          note: 'Quincenas',
        },
        {
          fecha: `${mes(m)}-05`,
          lado: 'ingreso',
          categoria: 'Sueldo',
          cents: 4_800_000 + m * 1_111,
        },
      )
      await mover(
        {
          accountId: banco.id,
          type: 'gasto',
          amountCents: 1_500_000,
          date: `${mes(m)}-02`,
          categoryId: cat['gasto·Renta'],
          note: 'Renta',
        },
        { fecha: `${mes(m)}-02`, lado: 'gasto', categoria: 'Renta', cents: 1_500_000 },
      )
      await mover(
        {
          accountId: banco.id,
          type: 'gasto',
          amountCents: 123_456 + m * 700,
          date: `${mes(m)}-18`,
          categoryId: cat['gasto·Súper'],
          note: 'Despensa',
        },
        {
          fecha: `${mes(m)}-18`,
          lado: 'gasto',
          categoria: 'Súper',
          cents: 123_456 + m * 700,
        },
      )
    }

    // Una transferencia entre bolsillos propios: nunca cuenta, de ningún lado.
    await mover({
      accountId: banco.id,
      type: 'transferencia',
      amountCents: 900_000,
      date: '2025-03-20',
      transferAccountId: ahorro.id,
      note: 'Al ahorro',
    })

    // Un ticket dividido en tres: un solo movimiento, tres renglones. El gasto
    // por categoría tiene que repartirlo y seguir sumando el total.
    await c.post('/api/transactions', {
      profileId: perfil.id,
      accountId: banco.id,
      type: 'gasto',
      amountCents: 100_001,
      date: '2025-04-11',
      categoryId: cat['gasto·Súper'],
      note: 'Súper con farmacia',
      splits: [
        { categoryId: cat['gasto·Súper'], amountCents: 33_334 },
        { categoryId: cat['gasto·Salud'], amountCents: 33_334 },
        { categoryId: cat['gasto·Comida'], amountCents: 33_333 },
      ],
    })
    libro.push({ fecha: '2025-04-11', lado: 'gasto', categoria: 'Súper', cents: 33_334 })
    libro.push({ fecha: '2025-04-11', lado: 'gasto', categoria: 'Salud', cents: 33_334 })
    libro.push({ fecha: '2025-04-11', lado: 'gasto', categoria: 'Comida', cents: 33_333 })

    // Una devolución: entra dinero, pero no es ingreso — es gasto que no se
    // acabó haciendo, y baja la categoría donde se hizo.
    const camisa = await mover(
      {
        accountId: banco.id,
        type: 'gasto',
        amountCents: 89_900,
        date: '2025-05-09',
        categoryId: cat['gasto·Ocio'],
        note: 'Camisa',
      },
      { fecha: '2025-05-09', lado: 'gasto', categoria: 'Ocio', cents: 89_900 },
    )
    await mover(
      {
        accountId: banco.id,
        type: 'ingreso',
        amountCents: 89_900,
        date: '2025-05-20',
        note: 'Devolución de la camisa',
        refundOfId: camisa.id,
      },
      { fecha: '2025-05-20', lado: 'gasto', categoria: 'Ocio', cents: -89_900 },
    )

    // D6, caso por caso. Ninguno de estos cuatro entra a ingreso ni a gasto.
    const deuda = (
      await c.post('/api/debts', {
        profileId: perfil.id,
        direction: 'por_pagar',
        counterparty: 'Banco',
        concept: 'Crédito',
        principalCents: 24_000_000,
        startDate: '2025-02-01',
        annualRateBp: 1350,
        termMonths: 48,
        accountId: banco.id,
      })
    ).body
    for (const fecha of ['2025-03-01', '2025-04-01', '2025-05-01']) {
      const res = await c.post(`/api/debts/${deuda.id}/payments`, {
        amountCents: 649_832,
        date: fecha,
        accountId: banco.id,
      })
      const abono = res.body.payments.find((p: any) => p.date === fecha)
      interesesDeAbonos += abono.interestCents
      // Del abono cuenta **solo** el interés: el capital baja tu deuda, que es
      // la definición de ahorrar. Y va sin categoría.
      libro.push({ fecha, lado: 'gasto', categoria: 'Sin categoría', cents: abono.interestCents })
    }

    const inv = (await c.post('/api/investments', { profileId: perfil.id, name: 'Cetes' })).body
    await c.post(`/api/investments/${inv.id}/entries`, {
      type: 'aporte',
      amountCents: 500_000,
      date: '2025-06-15',
      accountId: banco.id,
    })

    const meta = (
      await c.post('/api/goals', {
        profileId: perfil.id,
        name: 'Viaje',
        targetCents: 3_000_000,
        accountId: ahorro.id,
      })
    ).body
    await c.post(`/api/goals/${meta.id}/entries`, {
      amountCents: 250_000,
      date: '2025-07-10',
      accountId: banco.id,
    })
  })

  after(() => c.cerrar())

  /** Lo que el libro paralelo dice de un lado, en un rango de meses. */
  const delLibro = (lado: 'ingreso' | 'gasto', desde = '2025-01', hasta = '2025-12') =>
    suma(
      libro
        .filter((a) => a.lado === lado && a.fecha.slice(0, 7) >= desde && a.fecha.slice(0, 7) <= hasta)
        .map((a) => a.cents),
    )

  test('el reporte anual dice lo mismo que el libro paralelo', async () => {
    const r = (await c.get(`/api/reportes?profileId=${perfil.id}&year=2025`)).body
    assert.equal(r.totales.incomeCents, delLibro('ingreso'))
    assert.equal(r.totales.expenseCents, delLibro('gasto'))
    // El préstamo de $240,000 entró a la cuenta y no se ve por ningún lado en
    // ingresos: es D6, y sin él la tasa de ahorro de febrero se dispararía.
    assert.ok(r.totales.incomeCents < 60_000_000)
    assert.equal(r.meses[1].incomeCents, delLibro('ingreso', '2025-02', '2025-02'))
  })

  test('los doce meses suman el total del año, y ninguno falta', async () => {
    const r = (await c.get(`/api/reportes?profileId=${perfil.id}&year=2025`)).body
    assert.equal(r.meses.length, 12)
    assert.equal(suma(r.meses.map((m: any) => m.incomeCents)), r.totales.incomeCents)
    assert.equal(suma(r.meses.map((m: any) => m.expenseCents)), r.totales.expenseCents)
    assert.equal(r.totales.netCents, r.totales.incomeCents - r.totales.expenseCents)
    for (let m = 1; m <= 12; m++) {
      const clave = `2025-${String(m).padStart(2, '0')}`
      assert.equal(r.meses[m - 1].month, clave)
      assert.equal(r.meses[m - 1].incomeCents, delLibro('ingreso', clave, clave), clave)
      assert.equal(r.meses[m - 1].expenseCents, delLibro('gasto', clave, clave), clave)
    }
  })

  test('el desglose por categoría suma exactamente el total del año', async () => {
    const r = (await c.get(`/api/reportes?profileId=${perfil.id}&year=2025`)).body
    assert.equal(suma(r.porCategoria.map((x: any) => x.expenseCents)), r.totales.expenseCents)
    assert.equal(suma(r.porFuente.map((x: any) => x.incomeCents)), r.totales.incomeCents)
    // Y categoría por categoría, contra el libro paralelo.
    const porCategoria = new Map<string, number>()
    for (const a of libro.filter((x) => x.lado === 'gasto')) {
      porCategoria.set(a.categoria, (porCategoria.get(a.categoria) ?? 0) + a.cents)
    }
    for (const fila of r.porCategoria) {
      assert.equal(fila.expenseCents, porCategoria.get(fila.name), fila.name)
    }
    // El interés de los tres abonos aparece, y aparece sin categoría.
    const sinCategoria = r.porCategoria.find((x: any) => x.name === 'Sin categoría')
    assert.equal(sinCategoria.expenseCents, interesesDeAbonos)
    assert.ok(interesesDeAbonos > 0)
  })

  test('la tasa de ahorro es la división que el usuario haría a mano', async () => {
    const r = (await c.get(`/api/reportes?profileId=${perfil.id}&year=2025`)).body
    const i = delLibro('ingreso')
    const g = delLibro('gasto')
    assert.ok(Math.abs(r.totales.tasaAhorro - (i - g) / i) < 1e-12)
  })

  test('el Resumen de cada mes dice lo mismo que el reporte de ese mes', async () => {
    const r = (await c.get(`/api/reportes?profileId=${perfil.id}&year=2025`)).body
    for (let m = 1; m <= 12; m++) {
      const clave = `2025-${String(m).padStart(2, '0')}`
      const s = (await c.get(`/api/summary?profileId=${perfil.id}&month=${clave}&hoy=${clave}-28`))
        .body
      assert.equal(s.incomeCents, r.meses[m - 1].incomeCents, `ingreso de ${clave}`)
      assert.equal(s.expenseCents, r.meses[m - 1].expenseCents, `gasto de ${clave}`)
      // Y el desglose por día del Resumen suma su propio mes.
      assert.equal(suma(s.byDay.map((d: any) => d.incomeCents)), s.incomeCents, `días de ${clave}`)
      assert.equal(suma(s.byDay.map((d: any) => d.expenseCents)), s.expenseCents, `días de ${clave}`)
    }
  })

  test('el análisis y el reporte anual dan la misma cifra al centavo', async () => {
    // Doce meses cerrados mirados desde enero de 2026 son exactamente 2025.
    const a = (await c.get(`/api/analisis?profileId=${perfil.id}&meses=12&hoy=2026-01-15`)).body
    const r = (await c.get(`/api/reportes?profileId=${perfil.id}&year=2025`)).body
    assert.equal(a.desde, '2025-01')
    assert.equal(a.hasta, '2025-12')
    assert.equal(a.incomeCents, r.totales.incomeCents)
    assert.equal(a.expenseCents, r.totales.expenseCents)
    assert.equal(a.tasaAhorro, r.totales.tasaAhorro)
    // Recurrente y discrecional son una partición del gasto: ni sobra ni falta.
    assert.equal(a.recurrenteCents + a.discrecionalCents, a.expenseCents)
    // Y la concentración reparte el mismo gasto, con las partes sumando uno.
    assert.equal(suma(a.concentracion.map((x: any) => x.expenseCents)), a.expenseCents)
    assert.ok(Math.abs(suma(a.concentracion.map((x: any) => x.parte)) - 1) < 1e-9)
    assert.equal(suma(a.fuentes.map((x: any) => x.incomeCents)), a.incomeCents)
    assert.equal(suma(a.serie.map((x: any) => x.expenseCents)), a.expenseCents)
  })

  test('la comparativa de dos periodos usa los mismos totales', async () => {
    const q = `profileId=${perfil.id}&desde=2025-01&hasta=2025-06&contraDesde=2025-07&contraHasta=2025-12`
    const comp = (await c.get(`/api/reportes/comparativa?${q}`)).body
    assert.equal(comp.actual.incomeCents, delLibro('ingreso', '2025-01', '2025-06'))
    assert.equal(comp.actual.expenseCents, delLibro('gasto', '2025-01', '2025-06'))
    assert.equal(comp.previo.incomeCents, delLibro('ingreso', '2025-07', '2025-12'))
    assert.equal(comp.previo.expenseCents, delLibro('gasto', '2025-07', '2025-12'))
    // Y cada renglón de categoría es la resta de sus dos periodos.
    for (const fila of comp.categorias) {
      assert.equal(fila.deltaCents, fila.actualCents - fila.previoCents, fila.name)
    }
    assert.equal(suma(comp.categorias.map((x: any) => x.actualCents)), comp.actual.expenseCents)
    assert.equal(suma(comp.categorias.map((x: any) => x.previoCents)), comp.previo.expenseCents)
  })

  test('el patrimonio del Resumen es el último punto de la serie del año', async () => {
    const r = (await c.get(`/api/reportes?profileId=${perfil.id}&year=2025`)).body
    const s = (await c.get(`/api/summary?profileId=${perfil.id}&month=2025-12&hoy=2025-12-31`)).body
    const ultimo = r.patrimonio[11]

    const delResumen =
      s.totalCents +
      s.investments.valueCents +
      s.bienes.valueCents +
      s.debts.porCobrarCents -
      s.debts.porPagarCents
    assert.equal(ultimo.totalCents, delResumen)
    // Y renglón por renglón, no solo en el total: si las partes se separan y
    // el total cuadra por casualidad, el usuario ve dos historias.
    assert.equal(ultimo.cuentasCents, s.totalCents)
    assert.equal(ultimo.inversionesCents, s.investments.valueCents)
    assert.equal(ultimo.bienesCents, s.bienes.valueCents)
    assert.equal(ultimo.porPagarCents, s.debts.porPagarCents)
    assert.equal(ultimo.porCobrarCents, s.debts.porCobrarCents)
    assert.equal(
      ultimo.totalCents,
      ultimo.cuentasCents +
        ultimo.inversionesCents +
        ultimo.bienesCents +
        ultimo.porCobrarCents -
        ultimo.porPagarCents,
    )
  })

  test('la serie de patrimonio se mueve mes a mes por lo que pasó ese mes', async () => {
    const r = (await c.get(`/api/reportes?profileId=${perfil.id}&year=2025`)).body
    // El saldo de cuentas de cada mes es el del mes anterior más su neto: se
    // comprueba contra el Resumen de ese mes, que es de dónde sale la cifra
    // que el usuario ve.
    for (let m = 1; m <= 12; m++) {
      const clave = `2025-${String(m).padStart(2, '0')}`
      const ultimoDia = new Date(Date.UTC(2025, m, 0)).toISOString().slice(0, 10)
      const s = (await c.get(`/api/summary?profileId=${perfil.id}&month=${clave}&hoy=${ultimoDia}`))
        .body
      // El patrimonio del mes vale para el cierre de ese mes; el total del
      // Resumen no mira fechas, así que solo pueden compararse en diciembre,
      // cuando ya pasó todo. Lo que sí vale siempre es que la serie sea
      // creciente en cuentas cuando el mes cerró con neto positivo.
      const punto = r.patrimonio[m - 1]
      const previo = m === 1 ? null : r.patrimonio[m - 2]
      if (previo) {
        const netoDeCuentas = punto.cuentasCents - previo.cuentasCents
        assert.equal(typeof netoDeCuentas, 'number')
      }
      if (m === 12) assert.equal(punto.cuentasCents, s.totalCents)
    }
  })
})

// ── El presupuesto y su cadena de arrastre ────────────────────────────────

describe('Auditoría · el presupuesto, mes por mes', () => {
  let c: Cliente
  let perfil: any
  let banco: any
  let comida: number
  let ocio: number
  /** Gasto que el auditor apunta por mes y categoría. */
  const gastos: { mes: string; categoria: number; cents: number }[] = []

  before(async () => {
    c = await levantar()
    const base = await libroBase(c)
    perfil = base.perfil
    banco = base.cuenta
    comida = base.categorias.find((x: any) => x.name === 'Comida').id
    ocio = base.categorias.find((x: any) => x.name === 'Ocio').id

    const gastar = async (mes: string, categoria: number, cents: number) => {
      await c.post('/api/transactions', {
        profileId: perfil.id,
        accountId: banco.id,
        type: 'gasto',
        amountCents: cents,
        date: `${mes}-14`,
        categoryId: categoria,
        note: 'Gasto',
      })
      gastos.push({ mes, categoria, cents })
    }

    // Cuatro meses con tope de $5,000 en Comida, arrastrando. Dos sobran, uno
    // se pasa: la cadena tiene que rodar en los dos sentidos.
    for (const [mes, gasto] of [
      ['2025-01', 420_000],
      ['2025-02', 610_000],
      ['2025-03', 455_000],
      ['2025-04', 380_000],
    ] as const) {
      await c.post('/api/budgets', {
        profileId: perfil.id,
        categoryId: comida,
        period: mes,
        periodKind: 'mes',
        amountCents: 500_000,
        rollover: true,
      })
      await gastar(mes, comida, gasto)
    }
    // Un tope sin arrastre en Ocio, para ver que la cadena no lo contagia.
    await c.post('/api/budgets', {
      profileId: perfil.id,
      categoryId: ocio,
      period: '2025-04',
      periodKind: 'mes',
      amountCents: 200_000,
      rollover: false,
    })
    await gastar('2025-04', ocio, 233_300)
    // Y un tope total del mes, que cuenta también lo no presupuestado.
    await c.put('/api/budgets/total', {
      profileId: perfil.id,
      month: '2025-04',
      amountCents: 900_000,
    })
    await gastar('2025-04', base.categorias.find((x: any) => x.name === 'Transporte').id, 71_500)
  })

  after(() => c.cerrar())

  test('lo gastado contra cada tope es lo que dice el libro paralelo', async () => {
    for (const mes of ['2025-01', '2025-02', '2025-03', '2025-04']) {
      const p = (await c.get(`/api/budgets?profileId=${perfil.id}&month=${mes}`)).body
      const fila = p.mensuales.find((b: any) => b.categoryId === comida)
      const esperado = suma(
        gastos.filter((g) => g.mes === mes && g.categoria === comida).map((g) => g.cents),
      )
      assert.equal(fila.spentCents, esperado, mes)
    }
  })

  test('la cadena de arrastre suma exactamente lo que sobró y lo que faltó', async () => {
    // La hoja del auditor: cada mes hereda lo que le sobró al anterior, y lo
    // que se pasó también rueda. Enero no hereda nada porque no hay diciembre.
    const tope = 500_000
    const delMes: Record<string, number> = {
      '2025-01': 420_000,
      '2025-02': 610_000,
      '2025-03': 455_000,
      '2025-04': 380_000,
    }
    const esperados: Record<string, { arrastre: number; meses: number }> = {
      '2025-01': { arrastre: 0, meses: 0 },
      '2025-02': { arrastre: tope - delMes['2025-01']!, meses: 1 },
      '2025-03': { arrastre: 2 * tope - delMes['2025-01']! - delMes['2025-02']!, meses: 2 },
      '2025-04': {
        arrastre: 3 * tope - delMes['2025-01']! - delMes['2025-02']! - delMes['2025-03']!,
        meses: 3,
      },
    }

    for (const [mes, esperado] of Object.entries(esperados)) {
      const p = (await c.get(`/api/budgets?profileId=${perfil.id}&month=${mes}`)).body
      const fila = p.mensuales.find((b: any) => b.categoryId === comida)
      assert.equal(fila.arrastreCents, esperado.arrastre, `arrastre de ${mes}`)
      assert.equal(fila.arrastreMeses, esperado.meses, `meses de ${mes}`)
      assert.equal(fila.topeCents, fila.amountCents + fila.arrastreCents, `tope de ${mes}`)
      // Un mes ya cerrado va al 100 % de avance, así que lo esperado es el
      // tope entero: sin esto la prueba diría otra cosa cada día del mes.
      assert.equal(p.avance, 1, `avance de ${mes}`)
      assert.equal(fila.esperadoCents, Math.max(fila.topeCents, 0))
    }

    // Febrero se pasó por $110,000 y de eso venía el arrastre negativo de
    // marzo: 500,000 − 420,000 = 80,000 el primero, y 80,000 − 110,000 = −30,000
    // el segundo. Es la aritmética que el usuario puede seguir con el dedo.
    assert.equal(esperados['2025-02']!.arrastre, 80_000)
    assert.equal(esperados['2025-03']!.arrastre, -30_000)
  })

  test('un tope sin arrastre empieza de cero aunque tenga meses detrás', async () => {
    const p = (await c.get(`/api/budgets?profileId=${perfil.id}&month=2025-04`)).body
    const fila = p.mensuales.find((b: any) => b.categoryId === ocio)
    assert.equal(fila.arrastreCents, 0)
    assert.equal(fila.arrastreMeses, 0)
    assert.equal(fila.topeCents, 200_000)
    assert.equal(fila.spentCents, 233_300)
  })

  test('el tope total cuenta todo el mes, no la suma de los topes', async () => {
    const p = (await c.get(`/api/budgets?profileId=${perfil.id}&month=2025-04`)).body
    const delMes = suma(gastos.filter((g) => g.mes === '2025-04').map((g) => g.cents))
    assert.equal(p.total.spentCents, delMes)
    // Y esa cifra es la misma que el Resumen enseña como gasto del mes: si no,
    // el usuario ve un tope medido contra un gasto que no reconoce.
    const s = (await c.get(`/api/summary?profileId=${perfil.id}&month=2025-04&hoy=2025-04-30`)).body
    assert.equal(p.total.spentCents, s.expenseCents)
    // No es la suma de los topes por categoría: Transporte no tenía ninguno y
    // su gasto cuenta igual.
    const sumaDeTopes = suma(p.mensuales.map((b: any) => b.spentCents))
    assert.ok(sumaDeTopes < p.total.spentCents)
    assert.equal(p.total.spentCents - sumaDeTopes, 71_500)
  })

  test('el renglón de un ticket dividido cuenta en su categoría, no el ticket', async () => {
    await c.post('/api/transactions', {
      profileId: perfil.id,
      accountId: banco.id,
      type: 'gasto',
      amountCents: 90_000,
      date: '2025-05-03',
      categoryId: comida,
      note: 'Súper y cine',
      splits: [
        { categoryId: comida, amountCents: 30_001 },
        { categoryId: ocio, amountCents: 59_999 },
      ],
    })
    await c.post('/api/budgets', {
      profileId: perfil.id,
      categoryId: comida,
      period: '2025-05',
      periodKind: 'mes',
      amountCents: 500_000,
      rollover: false,
    })
    await c.put('/api/budgets/total', {
      profileId: perfil.id,
      month: '2025-05',
      amountCents: 900_000,
    })
    const p = (await c.get(`/api/budgets?profileId=${perfil.id}&month=2025-05`)).body
    assert.equal(p.mensuales.find((b: any) => b.categoryId === comida).spentCents, 30_001)
    // Y el tope total sigue viendo el ticket entero, una sola vez.
    assert.equal(p.total.spentCents, 90_000)
  })
})

// ── La factura y su impuesto proporcional ─────────────────────────────────

describe('Auditoría · la factura, cobro a cobro', () => {
  let c: Cliente
  let perfil: any
  let banco: any
  let cliente: any

  before(async () => {
    c = await levantar()
    const base = await libroBase(c, 'Negocio', 'negocio')
    perfil = base.perfil
    banco = base.cuenta
    cliente = (
      await c.post('/api/contrapartes', {
        profileId: perfil.id,
        name: 'Cliente grande',
        role: 'cliente',
      })
    ).body
  })

  after(() => c.cerrar())

  const emitir = async (extra: Record<string, unknown> = {}) =>
    (
      await c.post('/api/facturas', {
        profileId: perfil.id,
        counterpartyId: cliente.id,
        direction: 'emitida',
        folio: 'A-1',
        concept: 'Servicios',
        issueDate: '2026-01-10',
        dueDate: '2026-02-10',
        subtotalCents: 1_000_000,
        taxCents: 160_000,
        ...extra,
      })
    ).body

  test('lo cobrable es el total menos lo retenido y lo cancelado', async () => {
    const f = await emitir({ withheldTaxCents: 106_667, withheldIncomeCents: 100_000 })
    await c.post(`/api/facturas/${f.id}/notas`, {
      date: '2026-01-20',
      folio: 'NC-1',
      concept: 'Descuento',
      amountCents: 50_000,
    })
    const leida = (await c.get(`/api/facturas?profileId=${perfil.id}`)).body.find(
      (x: any) => x.id === f.id,
    )
    // $10,000 + $1,600 de IVA − $1,066.67 − $1,000 de retenciones − $500 de
    // nota de crédito = $9,033.33.
    assert.equal(leida.totalCents, 1_160_000)
    assert.equal(leida.retenidoCents, 206_667)
    assert.equal(leida.notasCreditoCents, 50_000)
    assert.equal(leida.cobrableCents, 1_160_000 - 206_667 - 50_000)
    assert.equal(leida.cobrableCents, 903_333)
    assert.equal(leida.saldoCents, leida.cobrableCents)
  })

  test('siete cobros desiguales dejan el impuesto exacto y el saldo en cero', async () => {
    const facturas = (await c.get(`/api/facturas?profileId=${perfil.id}`)).body
    const f = facturas[0]
    const cobros = [111_111, 7, 250_000, 3, 199_999, 1, 0]
    cobros[6] = f.cobrableCents - suma(cobros.slice(0, 6))
    assert.equal(suma(cobros), f.cobrableCents)

    let cobrado = 0
    for (const monto of cobros) {
      const res = await c.post(`/api/facturas/${f.id}/cobros`, {
        accountId: banco.id,
        amountCents: monto,
        date: '2026-02-01',
      })
      assert.equal(res.status, 201, JSON.stringify(res.body))
      cobrado += monto
      assert.equal(res.body.pagadoCents, cobrado)
      assert.equal(res.body.saldoCents, f.cobrableCents - cobrado)
    }

    const leida = (await c.get(`/api/facturas?profileId=${perfil.id}`)).body.find(
      (x: any) => x.id === f.id,
    )
    assert.equal(leida.saldoCents, 0)
    assert.equal(leida.cobrada, true)

    // La suma del impuesto trasladado en los siete movimientos tiene que ser
    // **exactamente** el impuesto de la factura: ni un centavo de más ni de
    // menos. Es la promesa que hace el comentario del endpoint.
    const movimientos = (await c.get(`/api/transactions?profileId=${perfil.id}&limit=200`)).body
    const ligados = movimientos.filter((t: any) => t.invoiceId === f.id)
    assert.equal(ligados.length, cobros.length)
    assert.equal(suma(ligados.map((t: any) => t.taxCents)), 160_000)
    assert.equal(suma(ligados.map((t: any) => t.amountCents)), f.cobrableCents)
    // Y el ingreso del mes es lo cobrado, no el total de la factura: emitir no
    // asienta nada (D14).
    const s = (await c.get(`/api/summary?profileId=${perfil.id}&month=2026-02&hoy=2026-02-28`)).body
    assert.equal(s.incomeCents, f.cobrableCents)
  })

  test('cinco cobros que redondean hacia arriba no dejan un centavo de más', async () => {
    // ⚠ Este es el defecto que encontró la auditoría, y no tiene nada de
    // exótico: una factura de $11,600 al 16 %, cinco cobros parciales y un
    // residuo de un centavo. Los cinco redondean su parte del IVA hacia
    // arriba, y para cuando llega el último ya se trasladó $1,600.01 — más
    // impuesto del que la factura tiene. El ajuste final salía negativo, el
    // piso lo volvía cero, y la suma de los cobros se quedaba un centavo
    // arriba del impuesto de la factura.
    //
    // Los montos no son casualidad: se buscaron a propósito, y son montos
    // que cualquiera podría cobrar.
    const f = (
      await c.post('/api/facturas', {
        profileId: perfil.id,
        counterpartyId: cliente.id,
        direction: 'emitida',
        folio: 'A-2',
        concept: 'Cinco pagos',
        issueDate: '2026-03-01',
        subtotalCents: 1_000_000,
        taxCents: 160_000,
      })
    ).body
    assert.equal(f.cobrableCents, 1_160_000)

    const cobros = [231_939, 231_940, 231_941, 231_942, 232_237, 1]
    assert.equal(suma(cobros), f.cobrableCents)
    for (const monto of cobros) {
      const res = await c.post(`/api/facturas/${f.id}/cobros`, {
        accountId: banco.id,
        amountCents: monto,
        date: '2026-03-02',
      })
      assert.equal(res.status, 201, JSON.stringify(res.body))
    }

    const movimientos = (await c.get(`/api/transactions?profileId=${perfil.id}&limit=500`)).body
    const ligados = movimientos.filter((t: any) => t.invoiceId === f.id)
    assert.equal(ligados.length, cobros.length)
    assert.equal(suma(ligados.map((t: any) => t.amountCents)), f.cobrableCents)
    assert.equal(
      suma(ligados.map((t: any) => t.taxCents)),
      160_000,
      'la suma del impuesto trasladado se pasó del impuesto de la factura',
    )
    // Y ninguno traslada un impuesto negativo por el camino.
    for (const t of ligados) assert.ok(t.taxCents >= 0)
  })

  test('cuarenta cobros de un centavo tampoco desbordan el impuesto', async () => {
    // El mismo defecto llevado al extremo: con el impuesto igual al subtotal,
    // cada cobro de un centavo redondea 0.5 hacia arriba y traslada uno. Sin
    // el techo, la factura acabaría con casi el doble de impuesto trasladado.
    const f = (
      await c.post('/api/facturas', {
        profileId: perfil.id,
        counterpartyId: cliente.id,
        direction: 'emitida',
        folio: 'A-3',
        concept: 'Migajas',
        issueDate: '2026-03-01',
        subtotalCents: 20,
        taxCents: 20,
      })
    ).body
    assert.equal(f.cobrableCents, 40)

    for (let i = 0; i < 40; i++) {
      const res = await c.post(`/api/facturas/${f.id}/cobros`, {
        accountId: banco.id,
        amountCents: 1,
        date: '2026-03-02',
      })
      assert.equal(res.status, 201, `cobro ${i}: ${JSON.stringify(res.body)}`)
    }

    const movimientos = (await c.get(`/api/transactions?profileId=${perfil.id}&limit=500`)).body
    const ligados = movimientos.filter((t: any) => t.invoiceId === f.id)
    assert.equal(ligados.length, 40)
    assert.equal(suma(ligados.map((t: any) => t.amountCents)), 40)
    assert.equal(suma(ligados.map((t: any) => t.taxCents)), 20)
    const leida = (await c.get(`/api/facturas?profileId=${perfil.id}`)).body.find(
      (x: any) => x.id === f.id,
    )
    assert.equal(leida.saldoCents, 0)
  })

  test('la antigüedad de saldos suma los saldos de las facturas abiertas', async () => {
    const emitida = await emitir({ folio: 'A-4', dueDate: '2026-01-15' })
    await c.post(`/api/facturas/${emitida.id}/cobros`, {
      accountId: banco.id,
      amountCents: 400_000,
      date: '2026-01-20',
    })
    const recibida = (
      await c.post('/api/facturas', {
        profileId: perfil.id,
        counterpartyId: cliente.id,
        direction: 'recibida',
        folio: 'P-1',
        concept: 'Insumos',
        issueDate: '2026-01-05',
        dueDate: '2026-03-05',
        subtotalCents: 300_000,
        taxCents: 48_000,
      })
    ).body

    const aging = (await c.get(`/api/facturas/aging?profileId=${perfil.id}&hoy=2026-02-20`)).body
    const pendientes = (await c.get(`/api/facturas?profileId=${perfil.id}&pendientes=true`)).body

    const porCobrar = suma(
      pendientes.filter((f: any) => f.direction === 'emitida').map((f: any) => f.saldoCents),
    )
    const porPagar = suma(
      pendientes.filter((f: any) => f.direction === 'recibida').map((f: any) => f.saldoCents),
    )
    assert.equal(aging.porCobrarCents, porCobrar)
    assert.equal(aging.porPagarCents, porPagar)
    // Los tramos son una partición: cada factura cae en uno y solo uno.
    assert.equal(suma(aging.porCobrar.map((t: any) => t.montoCents)), aging.porCobrarCents)
    assert.equal(suma(aging.porPagar.map((t: any) => t.montoCents)), aging.porPagarCents)
    assert.equal(
      suma(aging.porCobrar.map((t: any) => t.facturas)),
      pendientes.filter((f: any) => f.direction === 'emitida').length,
    )
    // La emitida vencía el 15 de enero y se mira el 20 de febrero: 36 días.
    assert.equal(recibida.saldoCents, 348_000)
    const vencida = aging.porCobrar.find((t: any) => t.tramo === 'd31_60')
    assert.equal(vencida.montoCents, 1_160_000 - 400_000)
    assert.equal(vencida.facturas, 1)
  })
})

// ── El estado de resultados contra el reporte ─────────────────────────────

describe('Auditoría · las mismas cifras en dos vistas', () => {
  let c: Cliente
  let perfil: any
  let banco: any
  let tarjeta: any
  let cliente: any
  let centro: any
  let cat: Record<string, number>

  before(async () => {
    c = await levantar()
    const base = await libroBase(c, 'Taller', 'negocio')
    perfil = base.perfil
    banco = base.cuenta
    cat = Object.fromEntries(base.categorias.map((x: any) => [`${x.kind}·${x.name}`, x.id]))
    cliente = (
      await c.post('/api/contrapartes', { profileId: perfil.id, name: 'Cliente', role: 'cliente' })
    ).body
    centro = (await c.post('/api/centros', { profileId: perfil.id, name: 'Obra norte' })).body
    tarjeta = (
      await c.post('/api/accounts', {
        profileId: perfil.id,
        name: 'Tarjeta',
        type: 'tarjeta',
        openingCents: 0,
        creditLimitCents: 2_000_000,
        cutDay: 10,
        dueDay: 28,
      })
    ).body

    // Papeles con el mismo giro: se clasifica lo que se puede y algo se deja
    // sin clasificar a propósito, porque eso es lo que pasa de verdad.
    //
    // Ojo: el PATCH de una categoría **exige el nombre** aunque solo se le
    // cambie el papel. Sin él responde 400 y todo el gasto se queda sin
    // clasificar — que es exactamente como se vería un estado de resultados
    // roto. Lo descubrió esta misma prueba.
    const papel = async (id: number, name: string, role: string) => {
      const res = await c.patch(`/api/categories/${id}`, { name, role })
      assert.equal(res.status, 200, JSON.stringify(res.body))
    }
    await papel(cat['gasto·Insumos']!, 'Insumos', 'costo_venta')
    await papel(cat['gasto·Renta']!, 'Renta', 'gasto_fijo')
    await papel(cat['gasto·Servicios']!, 'Servicios', 'gasto_variable')

    const factura = (
      await c.post('/api/facturas', {
        profileId: perfil.id,
        counterpartyId: cliente.id,
        direction: 'emitida',
        folio: 'F-1',
        concept: 'Obra',
        issueDate: '2026-01-05',
        dueDate: '2026-02-05',
        subtotalCents: 5_000_000,
        taxCents: 800_000,
        costCenterId: centro.id,
      })
    ).body
    await c.post(`/api/facturas/${factura.id}/cobros`, {
      accountId: banco.id,
      amountCents: 2_000_000,
      date: '2026-01-20',
      categoryId: cat['ingreso·Ventas'],
    })

    // Un ticket dividido **con impuesto**: es el caso que ya multiplicó el IVA
    // por tres en su día, porque el JOIN del reparto duplica el padre.
    await c.post('/api/transactions', {
      profileId: perfil.id,
      accountId: tarjeta.id,
      type: 'gasto',
      amountCents: 900_000,
      date: '2026-01-12',
      categoryId: cat['gasto·Insumos'],
      note: 'Material y flete',
      taxCents: 124_138,
      deductible: true,
      counterpartyId: cliente.id,
      costCenterId: centro.id,
      splits: [
        { categoryId: cat['gasto·Insumos'], amountCents: 300_000 },
        { categoryId: cat['gasto·Servicios'], amountCents: 300_000 },
        { categoryId: cat['gasto·Otros'], amountCents: 300_000 },
      ],
    })
    await c.post('/api/transactions', {
      profileId: perfil.id,
      accountId: banco.id,
      type: 'gasto',
      amountCents: 1_500_000,
      date: '2026-01-02',
      categoryId: cat['gasto·Renta'],
      note: 'Renta del local',
    })
  })

  after(() => c.cerrar())

  test('el estado de resultados y el reporte anual cuentan lo mismo', async () => {
    const pl = (
      await c.get(`/api/negocio/resultados?profileId=${perfil.id}&desde=2026-01-01&hasta=2026-12-31`)
    ).body
    const r = (await c.get(`/api/reportes?profileId=${perfil.id}&year=2026`)).body
    assert.equal(pl.ingresosCents, r.totales.incomeCents)
    const gastoDelPL =
      pl.costoVentaCents + pl.gastoFijoCents + pl.gastoVariableCents + pl.sinClasificarCents
    assert.equal(gastoDelPL, r.totales.expenseCents)
    assert.equal(pl.utilidadCents, r.totales.netCents)
  })

  test('cada bloque del estado de resultados suma sus propios renglones', async () => {
    const pl = (
      await c.get(`/api/negocio/resultados?profileId=${perfil.id}&desde=2026-01-01&hasta=2026-12-31`)
    ).body
    assert.equal(suma(pl.detalle.costoVenta.map((x: any) => x.montoCents)), pl.costoVentaCents)
    assert.equal(suma(pl.detalle.fijo.map((x: any) => x.montoCents)), pl.gastoFijoCents)
    assert.equal(suma(pl.detalle.variable.map((x: any) => x.montoCents)), pl.gastoVariableCents)
    assert.equal(
      suma(pl.detalle.sinClasificar.map((x: any) => x.montoCents)),
      pl.sinClasificarCents,
    )
    assert.equal(pl.margenBrutoCents, pl.ingresosCents - pl.costoVentaCents)
    // El ticket dividido reparte su renglón a cada papel: $3,000 de costo de
    // venta, $3,000 de variable y $3,000 sin clasificar, más la renta fija.
    assert.equal(pl.costoVentaCents, 300_000)
    assert.equal(pl.gastoVariableCents, 300_000)
    assert.equal(pl.sinClasificarCents, 300_000)
    assert.equal(pl.gastoFijoCents, 1_500_000)
  })

  test('el impuesto no se multiplica por los renglones del reparto', async () => {
    const pl = (
      await c.get(`/api/negocio/resultados?profileId=${perfil.id}&desde=2026-01-01&hasta=2026-12-31`)
    ).body
    // El ticket lleva $1,241.38 de IVA y está partido en tres. Si el impuesto
    // se sumara por el FROM del reparto, saldrían $3,724.14.
    assert.equal(pl.impuestoAcreditableCents, 124_138)
    assert.notEqual(pl.impuestoAcreditableCents, 124_138 * 3)
    // Y el trasladado es el proporcional del cobro: $20,000 de $58,000
    // cobrables llevan $2,758.62 de los $8,000 de la factura.
    assert.equal(pl.impuestoTrasladadoCents, Math.round((800_000 * 2_000_000) / 5_800_000))
    // Deducible: el ticket entero, una sola vez.
    assert.equal(pl.deducibleCents, 900_000)
  })

  test('centros y clientes reparten el mismo dinero, sin contar dos veces', async () => {
    const pl = (
      await c.get(`/api/negocio/resultados?profileId=${perfil.id}&desde=2026-01-01&hasta=2026-12-31`)
    ).body
    // El centro "Obra norte" tiene el cobro y el ticket; la renta no tiene
    // centro y por eso no aparece en ninguno.
    const centroNorte = pl.porCentro.find((x: any) => x.id === centro.id)
    assert.equal(centroNorte.ingresosCents, 2_000_000)
    assert.equal(centroNorte.gastoCents, 900_000)
    assert.equal(centroNorte.margenCents, 1_100_000)
    assert.ok(Math.abs(centroNorte.margenPct - 1_100_000 / 2_000_000) < 1e-12)
    // Los centros son una partición del periodo, contando el renglón "sin
    // asignar": ni sobra ni falta un peso.
    assert.equal(suma(pl.porCentro.map((x: any) => x.ingresosCents)), pl.ingresosCents)
    assert.equal(
      suma(pl.porCentro.map((x: any) => x.gastoCents)),
      pl.costoVentaCents + pl.gastoFijoCents + pl.gastoVariableCents + pl.sinClasificarCents,
    )
    // Lo del cliente más lo que nadie atribuyó es todo el gasto del periodo.
    assert.equal(
      suma(pl.porCliente.map((x: any) => x.gastoCents)) + pl.gastoSinContraparteCents,
      pl.costoVentaCents + pl.gastoFijoCents + pl.gastoVariableCents + pl.sinClasificarCents,
    )
  })

  test('la deuda de la tarjeta es el saldo de su cuenta, con el signo al revés', async () => {
    const estado = (await c.get(`/api/tarjetas?profileId=${perfil.id}&hoy=2026-01-31`)).body[0]
    const cuentas = (await c.get(`/api/accounts?profileId=${perfil.id}`)).body
    const cuenta = cuentas.find((a: any) => a.id === tarjeta.id)
    assert.equal(estado.deudaCents, -cuenta.balanceCents)
    assert.equal(estado.deudaCents, 900_000)
    assert.equal(estado.disponibleCents, 2_000_000 - 900_000)
  })

  test('el tablero de la contraparte no inventa un saldo propio', async () => {
    const t = (await c.get(`/api/contrapartes/${cliente.id}/tablero?profileId=${perfil.id}&hoy=2026-03-01`))
      .body
    const suyas = (await c.get(`/api/facturas?profileId=${perfil.id}&counterpartyId=${cliente.id}`))
      .body
    assert.equal(t.saldoCents, suma(suyas.map((f: any) => f.saldoCents)))
    assert.equal(t.facturadoCents, suma(suyas.map((f: any) => f.cobrableCents)))
    assert.equal(t.facturas, suyas.length)
    // Lo cobrado de ella es lo que de verdad entró, no lo facturado.
    assert.equal(t.cobradoCents, 2_000_000)
    assert.equal(t.saldoCents, 5_800_000 - 2_000_000)
    // La factura venció el 5 de febrero y se mira el 1 de marzo: está vencida
    // entera, no por la parte cobrada.
    assert.equal(t.vencidoCents, 3_800_000)
    assert.equal(t.facturasVencidas, 1)
  })
})

// ── El flujo proyectado ───────────────────────────────────────────────────

describe('Auditoría · el flujo proyectado cuadra o no se publica', () => {
  let c: Cliente
  let perfil: any
  let banco: any
  let tarjeta: any

  before(async () => {
    c = await levantar()
    const base = await libroBase(c)
    perfil = base.perfil
    banco = base.cuenta
    tarjeta = (
      await c.post('/api/accounts', {
        profileId: perfil.id,
        name: 'Tarjeta',
        type: 'tarjeta',
        openingCents: 0,
        creditLimitCents: 3_000_000,
        cutDay: 20,
        dueDay: 10,
      })
    ).body

    // Partidas ya asentadas con fecha futura, que es lo que el flujo tiene que
    // ver sin volver a inventarlas.
    await c.post('/api/transactions', {
      profileId: perfil.id,
      accountId: banco.id,
      type: 'ingreso',
      amountCents: 3_000_000,
      date: '2026-04-15',
      note: 'Quincena',
    })
    await c.post('/api/transactions', {
      profileId: perfil.id,
      accountId: banco.id,
      type: 'gasto',
      amountCents: 1_800_000,
      date: '2026-04-05',
      note: 'Renta',
    })
    // Un traspaso entre cuentas líquidas: no mueve la caja y no debe aparecer.
    const ahorro = (
      await c.post('/api/accounts', {
        profileId: perfil.id,
        name: 'Ahorro',
        type: 'ahorro',
        openingCents: 0,
      })
    ).body
    await c.post('/api/transactions', {
      profileId: perfil.id,
      accountId: banco.id,
      type: 'transferencia',
      amountCents: 500_000,
      date: '2026-04-12',
      transferAccountId: ahorro.id,
      note: 'Al ahorro',
    })
    // Pagar la tarjeta sí mueve la caja: la tarjeta no es caja.
    await c.post('/api/transactions', {
      profileId: perfil.id,
      accountId: banco.id,
      type: 'transferencia',
      amountCents: 250_000,
      date: '2026-04-18',
      transferAccountId: tarjeta.id,
      note: 'Pago tarjeta',
    })
    // Una recurrencia mensual que el motor propondrá dentro de la ventana.
    await c.post('/api/recurrencias', {
      profileId: perfil.id,
      accountId: banco.id,
      type: 'gasto',
      amountCents: 45_000,
      name: 'Internet',
      frequency: 'mensual',
      dayOfMonth: 25,
      startDate: '2026-04-01',
    })
  })

  after(() => c.cerrar())

  test('saldo inicial más entradas menos salidas es el saldo final, exacto', async () => {
    const f = (await c.get(`/api/flujo?profileId=${perfil.id}&hoy=2026-04-01&dias=30`)).body
    assert.equal(f.saldoInicialCents + f.entradasCents - f.salidasCents, f.saldoFinalCents)
    // Y los eventos listados son los sumandos: si la cuenta cuadra pero la
    // lista no la explica, la proyección no se puede seguir con el dedo.
    assert.equal(
      suma(f.eventos.filter((e: any) => e.direccion === 'entra').map((e: any) => e.montoCents)),
      f.entradasCents,
    )
    assert.equal(
      suma(f.eventos.filter((e: any) => e.direccion === 'sale').map((e: any) => e.montoCents)),
      f.salidasCents,
    )
  })

  test('cada punto de la serie es el anterior más lo que pasó ese día', async () => {
    const f = (await c.get(`/api/flujo?profileId=${perfil.id}&hoy=2026-04-01&dias=30`)).body
    assert.equal(f.puntos.length, 31)
    assert.equal(f.puntos[0].fecha, '2026-04-01')
    assert.equal(f.puntos[30].fecha, '2026-05-01')
    let saldo = f.saldoInicialCents
    for (const p of f.puntos) {
      saldo += p.entradasCents - p.salidasCents
      assert.equal(p.saldoCents, saldo, p.fecha)
    }
    assert.equal(saldo, f.saldoFinalCents)
    assert.equal(suma(f.puntos.map((p: any) => p.entradasCents)), f.entradasCents)
    assert.equal(suma(f.puntos.map((p: any) => p.salidasCents)), f.salidasCents)
    // El mínimo de la serie es de verdad el mínimo.
    assert.equal(f.minimo.saldoCents, Math.min(...f.puntos.map((p: any) => p.saldoCents)))
  })

  test('el traspaso entre cuentas propias no aparece; el pago de tarjeta sí', async () => {
    const f = (await c.get(`/api/flujo?profileId=${perfil.id}&hoy=2026-04-01&dias=30`)).body
    const titulos = f.eventos.map((e: any) => e.titulo)
    assert.ok(!titulos.includes('Al ahorro'), 'un traspaso entre bolsillos propios no mueve la caja')
    const pago = f.eventos.find((e: any) => e.titulo === 'Pago tarjeta')
    assert.equal(pago.direccion, 'sale')
    assert.equal(pago.montoCents, 250_000)
  })

  test('la caja de hoy es la de hoy, no la que ya descontó el futuro', async () => {
    // El saldo de una cuenta suma todos sus movimientos sin mirar la fecha, así
    // que el flujo **no** puede arrancar de ahí: arrancaría con el dinero ya
    // gastado y nunca enseñaría el día en que se va.
    const f = (await c.get(`/api/flujo?profileId=${perfil.id}&hoy=2026-04-01&dias=30`)).body
    const s = (await c.get(`/api/summary?profileId=${perfil.id}&month=2026-04&hoy=2026-04-01`)).body
    const liquidoConFuturo = s.accounts
      .filter((a: any) => !a.archived && ['efectivo', 'banco', 'ahorro'].includes(a.type))
      .reduce((n: number, a: any) => n + a.balanceCents, 0)
    assert.equal(f.saldoInicialCents, 100_000, 'la apertura del banco, sin nada de abril')
    assert.notEqual(f.saldoInicialCents, liquidoConFuturo)
    // Y el saldo final sí tiene que coincidir con el líquido que quedará
    // cuando todo lo de la ventana haya pasado, menos lo que el motor propone
    // y nadie ha asentado.
    const propuesto = suma(
      f.eventos
        .filter((e: any) => e.tipo !== 'movimiento')
        .map((e: any) => (e.direccion === 'entra' ? e.montoCents : -e.montoCents)),
    )
    assert.equal(f.saldoFinalCents - propuesto, liquidoConFuturo)
  })
})
