// Fase 22 · Auditoría de las finanzas de Finply · barrido por dominio.
//
// Esto no prueba una función nueva: **vuelve a hacer las cuentas**. Cada
// dominio que toca dinero se simula de punta a punta —la vida entera de un
// crédito, seis cortes de una tarjeta, dos años de una inversión— y lo que
// Finply dice se compara contra aritmética hecha aparte.
//
// La regla que hace que esto valga algo: **la cifra esperada no puede salir
// del código que se audita**. Este archivo no importa `shared/credito.ts`, ni
// `shared/rendimiento.ts`, ni `shared/inversiones.ts`, ni `shared/fechas.ts`.
// Lo que necesita lo escribe otra vez, de otra forma:
//
//   · los días se cuentan con `Date.UTC`, no con la aritmética de Finply;
//   · la cuota nivelada sale de la fórmula cerrada —P·i·(1+i)ⁿ/((1+i)ⁿ−1)—,
//     que es la que se teclea en una hoja de cálculo;
//   · el saldo tras k pagos sale de su propia fórmula cerrada, no de sumar la
//     tabla;
//   · el XIRR no se recalcula: se comprueba **por sustitución**, que es su
//     definición —el valor presente a esa tasa tiene que dar cero—;
//   · los meses que tarda un pago fijo en liquidar salen del logaritmo.
//
// Comparar el código contra sí mismo demuestra que es consistente, no que sea
// correcto. Esa distinción es la fase entera.
//
// De aquí salió, en su día, el defecto del saldo insoluto: un crédito de
// $240,000 se marcaba saldado once pagos antes de tiempo, debiendo todavía
// $66,882. Ninguna prueba de un caso lo vio; lo vio registrar los 48 abonos.

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { levantar, libroBase, type Cliente } from './ayuda.ts'

// ── Aritmética independiente ──────────────────────────────────────────────
//
// Nada de aquí llama a Finply. Es la hoja de cálculo del auditor.

/** Días entre dos fechas, contados en UTC. */
function dias(desde: string, hasta: string): number {
  const n = (iso: string) =>
    Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)))
  return Math.round((n(hasta) - n(desde)) / 86_400_000)
}

/** Una fecha N meses adelante, recortando el día al último del mes destino. */
function enMeses(iso: string, meses: number): string {
  const anio = Number(iso.slice(0, 4))
  const mes = Number(iso.slice(5, 7))
  const dia = Number(iso.slice(8, 10))
  const total = anio * 12 + (mes - 1) + meses
  const y = Math.floor(total / 12)
  const m = (total % 12) + 1
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const d = Math.min(dia, ultimo)
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** Cuota nivelada del sistema francés, como se teclea en una hoja de cálculo. */
function cuotaNivelada(principalCents: number, tasaAnual: number, meses: number): number {
  const i = tasaAnual / 12
  const f = Math.pow(1 + i, meses)
  return Math.round((principalCents * i * f) / (f - 1))
}

/**
 * Saldo tras k cuotas, por fórmula cerrada: B·(1+i)^k − pago·((1+i)^k−1)/i.
 * No suma la tabla — no la mira siquiera.
 */
function saldoTrasCuotas(
  principalCents: number,
  tasaAnual: number,
  pagoCents: number,
  k: number,
): number {
  const i = tasaAnual / 12
  const g = Math.pow(1 + i, k)
  return principalCents * g - (pagoCents * (g - 1)) / i
}

/** Valor presente de unos flujos a una tasa anual. La definición del XIRR. */
function valorPresente(flujos: { date: string; amountCents: number }[], tasa: number): number {
  const base = flujos.map((f) => f.date).sort()[0]!
  let total = 0
  for (const f of flujos) total += f.amountCents / Math.pow(1 + tasa, dias(base, f.date) / 365)
  return total
}

const suma = (xs: number[]) => xs.reduce((s, x) => s + x, 0)

/**
 * Hoy, en local, escrito sin pasar por Finply.
 *
 * Hace falta porque el rendimiento de una inversión **cierra su serie con el
 * valor de hoy** y no admite un parámetro para fijar la fecha: el XIRR de un
 * libro se mueve todos los días. No es un defecto de aritmética —el valor de
 * una inversión es el de su última valuación *hasta hoy*, que es lo que dicen
 * también el Resumen y los reportes—, pero sí obliga a que la auditoría se
 * pare en la misma fecha que el servidor en vez de hardcodear una.
 */
function hoyLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Una fecha N días atrás, contada en UTC. */
function haceDias(n: number): string {
  const hoy = hoyLocal()
  const t = Date.UTC(Number(hoy.slice(0, 4)), Number(hoy.slice(5, 7)) - 1, Number(hoy.slice(8, 10)))
  return new Date(t - n * 86_400_000).toISOString().slice(0, 10)
}

// ── El crédito, pago por pago ─────────────────────────────────────────────

describe('Auditoría · la vida entera de un crédito', () => {
  // El mismo crédito que destapó el defecto: $240,000 a 48 meses, 13.5 % anual.
  const PRINCIPAL = 24_000_000
  const TASA_BP = 1350
  const TASA = TASA_BP / 10_000
  const MESES = 48
  const INICIO = '2024-01-15'

  let c: Cliente
  let perfil: any
  let cuenta: any
  let tabla: any

  before(async () => {
    c = await levantar()
    const base = await libroBase(c)
    perfil = base.perfil
    cuenta = base.cuenta
    const deuda = (
      await c.post('/api/debts', {
        profileId: perfil.id,
        direction: 'por_pagar',
        counterparty: 'Banco',
        concept: 'Auto',
        principalCents: PRINCIPAL,
        startDate: INICIO,
        annualRateBp: TASA_BP,
        termMonths: MESES,
      })
    ).body
    tabla = (await c.get(`/api/debts/${deuda.id}/amortizacion`)).body
  })

  after(() => c.cerrar())

  test('la cuota nivelada es la de la fórmula cerrada, al centavo', () => {
    // $6,498.32 al mes. Sale de P·i·(1+i)ⁿ/((1+i)ⁿ−1); Finply usa la forma
    // equivalente con exponente negativo, y las dos tienen que dar lo mismo.
    assert.equal(cuotaNivelada(PRINCIPAL, TASA, MESES), 649_832)
    assert.equal(tabla.pagoMensualCents, 649_832)
  })

  test('la tabla cuadra por dentro: cada renglón y cada columna', () => {
    assert.equal(tabla.filas.length, MESES)
    for (const f of tabla.filas) {
      assert.equal(f.pagoCents, f.interesCents + f.capitalCents, `renglón ${f.n}`)
      assert.ok(f.interesCents >= 0 && f.capitalCents > 0, `renglón ${f.n} sin avance`)
    }
    // Lo que de verdad importa del redondeo: la columna de capital tiene que
    // sumar **exactamente** el principal, aunque cada renglón esté redondeado.
    assert.equal(suma(tabla.filas.map((f: any) => f.capitalCents)), PRINCIPAL)
    assert.equal(suma(tabla.filas.map((f: any) => f.pagoCents)), tabla.totalPagadoCents)
    assert.equal(suma(tabla.filas.map((f: any) => f.interesCents)), tabla.totalInteresCents)
    assert.equal(tabla.totalPagadoCents - tabla.totalInteresCents, PRINCIPAL)
    assert.equal(tabla.filas[MESES - 1].saldoCents, 0)
  })

  test('el saldo de cada renglón es el de la fórmula cerrada', () => {
    // El redondeo al centavo de cada renglón puede separarlos, pero no más de
    // un centavo por renglón acumulado. El defecto viejo se iba a $66,882.
    for (const f of tabla.filas) {
      const cerrado = saldoTrasCuotas(PRINCIPAL, TASA, tabla.pagoMensualCents, f.n)
      const dif = Math.abs(f.saldoCents - cerrado)
      assert.ok(dif <= f.n, `renglón ${f.n}: Finply ${f.saldoCents}, hoja ${Math.round(cerrado)}`)
    }
  })

  test('el interés total es el que sale de restar el principal', () => {
    // 48 × $6,498.32 − $240,000 = $71,919.36, menos el ajuste del último
    // renglón. Es la cifra que el usuario multiplica en una servilleta.
    const servilleta = tabla.pagoMensualCents * MESES - PRINCIPAL
    assert.ok(Math.abs(tabla.totalInteresCents - servilleta) < 100_00)
  })

  test('registrar los 48 abonos deja el saldo donde dice la hoja de cálculo', async () => {
    const deudas = (await c.get(`/api/debts?profileId=${perfil.id}`)).body
    const deuda = deudas[0]
    const pago = tabla.pagoMensualCents

    // El libro paralelo del auditor: saldo insoluto, interés devengado
    // actual/365 desde el abono anterior, y solo el capital baja el saldo.
    let saldo = PRINCIPAL
    let anterior = INICIO
    let interesTotal = 0

    for (let n = 1; n <= MESES; n++) {
      const fecha = enMeses(INICIO, n)
      const transcurridos = dias(anterior, fecha)
      const interes = Math.min(Math.round((saldo * TASA * transcurridos) / 365), pago)
      const monto = Math.min(pago, saldo + interes)
      const cobrado = Math.min(interes, monto)
      saldo = Math.max(0, saldo - (monto - cobrado))
      interesTotal += cobrado
      anterior = fecha

      const res = await c.post(`/api/debts/${deuda.id}/payments`, {
        amountCents: monto,
        date: fecha,
        accountId: cuenta.id,
      })
      assert.equal(res.status, 201, `abono ${n}: ${JSON.stringify(res.body)}`)
      assert.equal(
        res.body.balanceCents,
        saldo,
        `abono ${n} del ${fecha}: Finply dice ${res.body.balanceCents} y la hoja ${saldo}`,
      )
      // Y lo que ningún caso suelto ve: que no se salde antes de tiempo.
      if (n < MESES - 1) assert.ok(res.body.balanceCents > 0, `saldada en el abono ${n}`)
    }

    const final = (await c.get(`/api/debts?profileId=${perfil.id}`)).body[0]
    assert.equal(final.balanceCents, saldo)
    assert.equal(final.interestPaidCents, interesTotal)
    // El desglose cierra: lo abonado es interés más capital, sin un centavo
    // suelto en medio.
    assert.equal(final.paidCents, final.interestPaidCents + final.capitalPaidCents)
    assert.equal(final.principalCents - final.capitalPaidCents, saldo)
  })

  test('el devengo real y el plan no coinciden, y la diferencia es de días', async () => {
    // No es un defecto: el plan usa tasa mensual pareja y el devengo cuenta
    // los días que de verdad tiene cada mes. Se audita el **tamaño** de la
    // diferencia, que es lo que revelaría un error de convención (actual/360
    // contra actual/365 son un 1.4 %).
    const deuda = (await c.get(`/api/debts?profileId=${perfil.id}`)).body[0]
    const relativo = Math.abs(deuda.interestPaidCents - tabla.totalInteresCents) / tabla.totalInteresCents
    assert.ok(relativo < 0.01, `el devengo se separa del plan un ${(relativo * 100).toFixed(2)} %`)
  })
})

// ── La tarjeta, corte por corte ───────────────────────────────────────────

describe('Auditoría · seis cortes de una tarjeta', () => {
  // Corte el 15, fecha límite el 5. Todo lo que se registra abajo se apunta
  // también en un libro paralelo, y cada corte se compara contra él.
  const CORTE = 15
  let c: Cliente
  let perfil: any
  let banco: any
  let tarjeta: any

  /** El libro del auditor: cuánto suma cada partida a la deuda de la tarjeta. */
  const apuntes: { fecha: string; delta: number; msi: boolean }[] = []

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
        creditLimitCents: 5_000_000,
        cutDay: CORTE,
        dueDay: 5,
        annualRateBp: 4500,
        minPaymentBp: 500,
        minPaymentFloorCents: 20_000,
      })
    ).body

    const cargar = async (fecha: string, cents: number) => {
      await c.post('/api/transactions', {
        profileId: perfil.id,
        accountId: tarjeta.id,
        type: 'gasto',
        amountCents: cents,
        date: fecha,
        note: 'Compra',
      })
      apuntes.push({ fecha, delta: cents, msi: false })
    }
    const pagar = async (fecha: string, cents: number) => {
      await c.post('/api/transactions', {
        profileId: perfil.id,
        accountId: banco.id,
        type: 'transferencia',
        amountCents: cents,
        date: fecha,
        transferAccountId: tarjeta.id,
        note: 'Pago tarjeta',
      })
      apuntes.push({ fecha, delta: -cents, msi: false })
    }

    // Seis meses de vida: compras dentro y fuera del corte, pagos parciales y
    // un mes en que se paga de más.
    await cargar('2026-01-03', 123_456)
    await cargar('2026-01-14', 45_099)
    await pagar('2026-02-04', 100_000)
    await cargar('2026-02-16', 210_000)
    await cargar('2026-03-01', 88_888)
    await pagar('2026-03-05', 268_555)
    await cargar('2026-04-10', 315_000)
    await pagar('2026-04-05', 298_888)
    await cargar('2026-05-20', 42_000)
    await pagar('2026-05-05', 400_000)
    await cargar('2026-06-11', 999_999)
  })

  after(() => c.cerrar())

  test('la compra a meses reparte el total exacto y factura en los cortes', async () => {
    // $10,000.07 en 13 meses: el residuo tiene que caer en la última.
    const total = 1_000_007
    const meses = 13
    const compra = (
      await c.post('/api/tarjetas/msi', {
        profileId: perfil.id,
        accountId: tarjeta.id,
        concept: 'Refrigerador',
        totalCents: total,
        months: meses,
        purchaseDate: '2026-02-20',
      })
    ).body
    // El cargo ancla suma a la deuda de la tarjeta, pero no al saldo del corte.
    apuntes.push({ fecha: '2026-02-20', delta: total, msi: true })

    assert.equal(compra.parcialidades.length, meses)
    assert.equal(suma(compra.parcialidades.map((p: any) => p.amountCents)), total)
    // El reparto de la hoja: piso, y el resto en la última.
    const piso = Math.floor(total / meses)
    for (let i = 0; i < meses - 1; i++) assert.equal(compra.parcialidades[i].amountCents, piso)
    assert.equal(compra.parcialidades[meses - 1].amountCents, total - piso * (meses - 1))

    // Y cada parcialidad cae en un corte, empezando por el primero después de
    // la compra: 2026-03-15, 2026-04-15, …
    for (let i = 0; i < meses; i++) {
      assert.equal(compra.parcialidades[i].dueDate, enMeses('2026-03-15', i))
      assert.equal(compra.parcialidades[i].number, i + 1)
    }
  })

  test('el saldo de cada corte es el del libro paralelo', async () => {
    const compra = (await c.get(`/api/tarjetas/msi?profileId=${perfil.id}`)).body[0]
    const cuotas: { fecha: string; monto: number }[] = compra.parcialidades.map((p: any) => ({
      fecha: p.dueDate,
      monto: p.amountCents,
    }))

    for (const hoy of ['2026-01-20', '2026-02-20', '2026-03-20', '2026-04-20', '2026-05-20', '2026-06-20']) {
      const estado = (await c.get(`/api/tarjetas?profileId=${perfil.id}&hoy=${hoy}`)).body[0]
      const corte = estado.fechaCorte
      assert.equal(corte, `${hoy.slice(0, 7)}-${CORTE}`)

      // El saldo del corte: cargos menos abonos hasta el corte, **sin** el
      // cargo ancla de la compra a meses, más las parcialidades ya facturadas.
      const esperado =
        suma(apuntes.filter((a) => !a.msi && a.fecha <= corte).map((a) => a.delta)) +
        suma(cuotas.filter((q) => q.fecha <= corte).map((q) => q.monto))
      assert.equal(estado.saldoAlCorteCents, esperado, `corte del ${corte}`)

      // La deuda entera sí lleva el ancla y no lleva las parcialidades: si
      // contara las dos, la tarjeta pediría el doble.
      //
      // Y **no mira la fecha**, a diferencia del saldo del corte: es el saldo
      // de la cuenta, y en Finply el saldo de una cuenta suma todos sus
      // movimientos aunque tengan fecha adelantada. Auditado a propósito: es
      // la misma convención de la que depende el flujo proyectado —la caja de
      // hoy se pide a fecha justo porque el saldo no lo está— y separarlas
      // aquí dejaría dos verdades de la misma tarjeta.
      const deuda = suma(apuntes.map((a) => a.delta))
      assert.equal(estado.deudaCents, deuda, `deuda al ${hoy}`)
      assert.equal(estado.disponibleCents, 5_000_000 - deuda)

      // Lo que falta de ese corte no puede ser negativo ni pasarse del saldo.
      const pagadoDespues = suma(
        apuntes.filter((a) => !a.msi && a.fecha > corte && a.delta < 0).map((a) => -a.delta),
      )
      assert.equal(estado.pagadoDesdeCorteCents, pagadoDespues, `pagado tras el corte ${corte}`)
      assert.equal(
        estado.paraNoGenerarInteresesCents,
        Math.max(0, esperado - pagadoDespues),
        `para no generar intereses, corte ${corte}`,
      )
    }
  })

  test('el pago mínimo es el del contrato, con su piso', async () => {
    const estado = (await c.get(`/api/tarjetas?profileId=${perfil.id}&hoy=2026-06-20`)).body[0]
    // 5 % del saldo del corte, nunca menos de $200 ni más que el saldo.
    const porcentaje = Math.round((estado.saldoAlCorteCents * 500) / 10_000)
    assert.equal(
      estado.pagoMinimoCents,
      Math.min(estado.saldoAlCorteCents, Math.max(porcentaje, 20_000)),
    )
  })

  test('con un pago fijo, los meses hasta liquidar son los del logaritmo', async () => {
    // Un piso alto vuelve el mínimo un pago constante, y ahí la respuesta
    // tiene forma cerrada: n = −ln(1 − i·B/P) / ln(1+i). Es la única manera de
    // auditar la simulación sin volver a escribirla.
    const perfil2 = (await c.post('/api/profiles', { name: 'Cerrada', kind: 'personal' })).body
    const t2 = (
      await c.post('/api/accounts', {
        profileId: perfil2.id,
        name: 'Plástico',
        type: 'tarjeta',
        openingCents: 0,
        cutDay: 1,
        dueDay: 20,
        annualRateBp: 3600,
        minPaymentBp: 0,
        minPaymentFloorCents: 500_000,
      })
    ).body
    await c.post('/api/transactions', {
      profileId: perfil2.id,
      accountId: t2.id,
      type: 'gasto',
      amountCents: 10_000_000,
      date: '2026-01-02',
      note: 'Saldo',
    })

    const estado = (await c.get(`/api/tarjetas?profileId=${perfil2.id}&hoy=2026-02-05`)).body[0]
    const i = 0.36 / 12
    const B = 10_000_000
    const P = 500_000
    const cerrado = -Math.log(1 - (i * B) / P) / Math.log(1 + i)
    assert.equal(estado.siPagasElMinimo.meses, Math.ceil(cerrado))
    assert.equal(estado.siPagasElMinimo.primerPagoCents, P)
    // 27 pagos de $5,000 son $135,000 por una deuda de $100,000: el último es
    // menor, así que el total cae entre 26 y 27 cuotas.
    const total = estado.siPagasElMinimo.totalPagadoCents
    assert.ok(total > P * (Math.ceil(cerrado) - 1) && total <= P * Math.ceil(cerrado))
    assert.equal(total - estado.siPagasElMinimo.totalInteresCents, B)
  })

  test('si el mínimo no cubre el interés, se dice que no termina', async () => {
    const perfil3 = (await c.post('/api/profiles', { name: 'Sin salida', kind: 'personal' })).body
    const t3 = (
      await c.post('/api/accounts', {
        profileId: perfil3.id,
        name: 'Plástico',
        type: 'tarjeta',
        openingCents: 0,
        cutDay: 1,
        dueDay: 20,
        annualRateBp: 6000,
        minPaymentBp: 200,
        minPaymentFloorCents: null,
      })
    ).body
    await c.post('/api/transactions', {
      profileId: perfil3.id,
      accountId: t3.id,
      type: 'gasto',
      amountCents: 10_000_000,
      date: '2026-01-02',
      note: 'Saldo',
    })
    // 2 % de mínimo contra 5 % de interés mensual: la deuda sube sola.
    const estado = (await c.get(`/api/tarjetas?profileId=${perfil3.id}&hoy=2026-02-05`)).body[0]
    assert.equal(estado.siPagasElMinimo.nuncaTermina, true)
    assert.equal(estado.siPagasElMinimo.meses, null)
  })
})

// ── La inversión, dos años de vida ────────────────────────────────────────

describe('Auditoría · dos años de una inversión', () => {
  let c: Cliente
  let perfil: any

  before(async () => {
    c = await levantar()
    perfil = (await libroBase(c)).perfil
  })

  after(() => c.cerrar())

  const nueva = async (name: string) =>
    (await c.post('/api/investments', { profileId: perfil.id, name })).body

  test('el XIRR de un flujo de manual da la tasa de manual', async () => {
    const inv = await nueva('Pagaré')
    // $10,000 puestos y $11,000 sacados exactamente un año después: 10 %.
    await c.post(`/api/investments/${inv.id}/entries`, {
      type: 'aporte',
      amountCents: 1_000_000,
      date: '2025-01-01',
    })
    await c.post(`/api/investments/${inv.id}/entries`, {
      type: 'retiro',
      amountCents: 1_100_000,
      date: '2026-01-01',
    })
    const leida = (await c.get(`/api/investments?profileId=${perfil.id}`)).body.find(
      (i: any) => i.id === inv.id,
    )
    assert.ok(Math.abs(leida.rendimientoAnual - 0.1) < 1e-6, `dio ${leida.rendimientoAnual}`)
    // Y la ganancia no depende del piso de "aportado": valor + retirado − aportado.
    assert.equal(leida.gananciaCents, leida.valueCents + leida.retiradoCents - leida.aportadoCents)
    assert.equal(leida.gananciaCents, 100_000)
  })

  test('el XIRR de una serie irregular anula su valor presente', async () => {
    const inv = await nueva('Fondo')
    await c.post(`/api/investments/${inv.id}/entries`, {
      type: 'aporte',
      amountCents: 500_000,
      date: '2024-02-29',
    })
    await c.post(`/api/investments/${inv.id}/entries`, {
      type: 'aporte',
      amountCents: 250_000,
      date: '2024-07-11',
    })
    await c.post(`/api/investments/${inv.id}/entries`, {
      type: 'retiro',
      amountCents: 180_000,
      date: '2025-03-03',
    })
    await c.post(`/api/investments/${inv.id}/entries`, {
      type: 'valuacion',
      amountCents: 810_000,
      date: '2025-11-30',
    })

    const leida = (await c.get(`/api/investments?profileId=${perfil.id}`)).body.find(
      (i: any) => i.id === inv.id,
    )
    assert.equal(leida.valueCents, 810_000)
    // Los flujos son los aportes y los retiros; una valuación no es un flujo,
    // **cierra** la serie con el valor de hoy, como si se liquidara todo.
    const conValor = [
      { date: '2024-02-29', amountCents: -500_000 },
      { date: '2024-07-11', amountCents: -250_000 },
      { date: '2025-03-03', amountCents: 180_000 },
      { date: hoyLocal(), amountCents: 810_000 },
    ]
    const vp = valorPresente(conValor, leida.rendimientoAnual)
    assert.ok(Math.abs(vp) < 1, `el valor presente a esa tasa da ${vp}, no cero`)
  })

  test('menos de un mes no se anualiza, y sin salida no hay tasa', async () => {
    const corta = await nueva('Corta')
    // Diez días de vida: la serie cierra hoy y no llega al mes, así que no hay
    // nada honesto que anualizar. Un +2 % en tres días se vuelve +900 % anual.
    await c.post(`/api/investments/${corta.id}/entries`, {
      type: 'aporte',
      amountCents: 100_000,
      date: haceDias(10),
    })
    await c.post(`/api/investments/${corta.id}/entries`, {
      type: 'valuacion',
      amountCents: 102_000,
      date: haceDias(1),
    })
    const soloAportes = await nueva('Solo aportes')
    await c.post(`/api/investments/${soloAportes.id}/entries`, {
      type: 'aporte',
      amountCents: 100_000,
      date: '2024-01-01',
    })
    await c.post(`/api/investments/${soloAportes.id}/entries`, {
      type: 'aporte',
      amountCents: 100_000,
      date: '2025-01-01',
    })
    const lista = (await c.get(`/api/investments?profileId=${perfil.id}`)).body
    assert.equal(lista.find((i: any) => i.id === corta.id).rendimientoAnual, null)
    // Con solo aportes el valor iguala lo puesto: el flujo final positivo
    // existe, pero la tasa que lo anula es cero.
    const solo = lista.find((i: any) => i.id === soloAportes.id)
    assert.equal(solo.gananciaCents, 0)
    assert.ok(solo.rendimientoAnual === null || Math.abs(solo.rendimientoAnual) < 1e-6)
  })

  test('unidades por precio, con la multiplicación que se sale del entero seguro', async () => {
    const inv = await nueva('Acciones')
    // 10 000 títulos a $1,000.00: el producto intermedio es 10¹⁹, por encima
    // del entero seguro de JavaScript. Si se calculara con `number`, el
    // redondeo dejaría de ser exacto.
    await c.post(`/api/investments/${inv.id}/entries`, {
      type: 'aporte',
      amountCents: 1_000_000_000,
      date: '2025-01-10',
      unitsE8: 10_000 * 100_000_000,
      unitPriceCents: 100_000,
    })
    await c.post(`/api/investments/${inv.id}/entries`, {
      type: 'valuacion',
      amountCents: 0,
      date: '2025-06-10',
      unitPriceCents: 123_457,
    })
    const leida = (await c.get(`/api/investments?profileId=${perfil.id}`)).body.find(
      (i: any) => i.id === inv.id,
    )
    // 10 000 × $1,234.57 = $12,345,700.00, exacto.
    assert.equal(leida.valueCents, 10_000 * 123_457)

    // Y si aparece un aporte con fecha anterior, la valuación **no** se queda
    // con el número de ayer: el precio es el dato y el valor la consecuencia.
    await c.post(`/api/investments/${inv.id}/entries`, {
      type: 'aporte',
      amountCents: 200_000,
      date: '2025-03-01',
      unitsE8: 2 * 100_000_000,
      unitPriceCents: 100_000,
    })
    const otra = (await c.get(`/api/investments?profileId=${perfil.id}`)).body.find(
      (i: any) => i.id === inv.id,
    )
    assert.equal(otra.valueCents, 10_002 * 123_457)
  })

  test('veinticuatro aportes mensuales: la serie y los totales cuadran', async () => {
    const inv = await nueva('Ahorro mensual')
    let aportado = 0
    for (let n = 0; n < 24; n++) {
      const monto = 100_000 + n * 137
      aportado += monto
      await c.post(`/api/investments/${inv.id}/entries`, {
        type: 'aporte',
        amountCents: monto,
        date: enMeses('2024-01-05', n),
      })
    }
    // Una sola valuación al final: es como se registra de verdad.
    await c.post(`/api/investments/${inv.id}/entries`, {
      type: 'valuacion',
      amountCents: 3_000_000,
      date: '2025-12-31',
    })
    const leida = (await c.get(`/api/investments?profileId=${perfil.id}`)).body.find(
      (i: any) => i.id === inv.id,
    )
    assert.equal(leida.aportadoCents, aportado)
    assert.equal(leida.retiradoCents, 0)
    assert.equal(leida.investedCents, aportado)
    assert.equal(leida.valueCents, 3_000_000)
    assert.equal(leida.gananciaCents, 3_000_000 - aportado)
    // La serie tiene un punto por registro y el último es el valor de hoy.
    assert.equal(leida.puntos.length, 25)
    assert.equal(leida.puntos[24].valueCents, 3_000_000)
    // Antes de la valuación, el valor es exactamente lo aportado.
    assert.equal(leida.puntos[23].valueCents, aportado)
    // Y el valor presente a la tasa que da Finply tiene que anularse.
    const flujos = Array.from({ length: 24 }, (_, n) => ({
      date: enMeses('2024-01-05', n),
      amountCents: -(100_000 + n * 137),
    }))
    flujos.push({ date: hoyLocal(), amountCents: 3_000_000 })
    const vp = valorPresente(flujos, leida.rendimientoAnual)
    assert.ok(Math.abs(vp) < 1, `el valor presente da ${vp}`)
  })

  test('retirar más de lo aportado no voltea la ganancia', async () => {
    const inv = await nueva('Vendida')
    await c.post(`/api/investments/${inv.id}/entries`, {
      type: 'aporte',
      amountCents: 500_000,
      date: '2024-01-01',
    })
    await c.post(`/api/investments/${inv.id}/entries`, {
      type: 'valuacion',
      amountCents: 900_000,
      date: '2025-06-01',
    })
    await c.post(`/api/investments/${inv.id}/entries`, {
      type: 'retiro',
      amountCents: 900_000,
      date: '2025-07-01',
    })
    const leida = (await c.get(`/api/investments?profileId=${perfil.id}`)).body.find(
      (i: any) => i.id === inv.id,
    )
    assert.equal(leida.valueCents, 0)
    assert.equal(leida.investedCents, 0, 'el piso deja "aportado" en cero, no en negativo')
    assert.equal(leida.gananciaCents, 400_000, 'la ganancia real no depende del piso')
  })
})
