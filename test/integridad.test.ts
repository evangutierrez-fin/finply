// Las reglas que el README promete: si una de estas se rompe, el libro
// deja de cuadrar y el usuario no se entera hasta que es tarde.

import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { levantar, libroBase, type Cliente } from './ayuda.ts'

let c: Cliente
before(async () => {
  c = await levantar()
})
after(() => c.cerrar())

describe('cuentas', () => {
  test('una cuenta con movimientos no se borra, se archiva', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Cuentas')
    await c.post('/api/transactions', {
      profileId: perfil.id,
      accountId: cuenta.id,
      type: 'gasto',
      amountCents: 5000,
      date: '2026-07-10',
    })

    const borrada = await c.del(`/api/accounts/${cuenta.id}`)
    assert.equal(borrada.status, 409)

    const archivada = await c.patch(`/api/accounts/${cuenta.id}`, { archived: true })
    assert.equal(archivada.status, 200)
    assert.equal(archivada.body.archived, true)
  })

  test('el saldo refleja apertura, ingresos, gastos y transferencias', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Saldos')
    const destino = (
      await c.post('/api/accounts', {
        profileId: perfil.id,
        name: 'Efectivo',
        type: 'efectivo',
        openingCents: 0,
      })
    ).body

    await c.post('/api/transactions', {
      profileId: perfil.id, accountId: cuenta.id, type: 'ingreso',
      amountCents: 50000, date: '2026-07-01',
    })
    await c.post('/api/transactions', {
      profileId: perfil.id, accountId: cuenta.id, type: 'gasto',
      amountCents: 20000, date: '2026-07-02',
    })
    await c.post('/api/transactions', {
      profileId: perfil.id, accountId: cuenta.id, type: 'transferencia',
      amountCents: 30000, date: '2026-07-03', transferAccountId: destino.id,
    })

    const cuentas = (await c.get(`/api/accounts?profileId=${perfil.id}`)).body
    const origen = cuentas.find((a: any) => a.id === cuenta.id)
    const llegada = cuentas.find((a: any) => a.id === destino.id)
    // 100000 apertura + 50000 − 20000 − 30000 transferido
    assert.equal(origen.balanceCents, 100000)
    assert.equal(llegada.balanceCents, 30000)
  })

  test('una transferencia a la misma cuenta se rechaza', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Transferencia')
    const res = await c.post('/api/transactions', {
      profileId: perfil.id, accountId: cuenta.id, type: 'transferencia',
      amountCents: 1000, date: '2026-07-01', transferAccountId: cuenta.id,
    })
    assert.equal(res.status, 400)
  })
})

describe('el desembolso de una deuda', () => {
  /** Pedir prestado: el dinero entra a una cuenta y el libro tiene que verlo. */
  const pedir = (perfilId: number, cuentaId: number | null, cents = 300000) =>
    c.post('/api/debts', {
      profileId: perfilId,
      direction: 'por_pagar',
      counterparty: 'Gustavo',
      concept: 'Préstamo en efectivo',
      principalCents: cents,
      startDate: '2026-07-01',
      accountId: cuentaId,
    })

  test('pedir prestado con cuenta asienta la entrada de efectivo', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Desembolso')
    await pedir(perfil.id, cuenta.id)

    const movimientos = (await c.get(`/api/transactions?profileId=${perfil.id}`)).body
    assert.equal(movimientos.length, 1)
    assert.equal(movimientos[0].type, 'ingreso')
    assert.equal(movimientos[0].amountCents, 300000)
    assert.equal(movimientos[0].date, '2026-07-01')
    assert.ok(movimientos[0].debtId, 'el movimiento queda ligado a la deuda')
    assert.equal(movimientos[0].categoryId, null, 'un préstamo no es un gasto ni un ingreso más')

    const cuentas = (await c.get(`/api/accounts?profileId=${perfil.id}`)).body
    assert.equal(cuentas[0].balanceCents, 100000 + 300000)
  })

  test('sin cuenta, apuntar la deuda no mueve el libro', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Sin desembolso')
    await pedir(perfil.id, null)

    assert.deepEqual((await c.get(`/api/transactions?profileId=${perfil.id}`)).body, [])
    const cuentas = (await c.get(`/api/accounts?profileId=${perfil.id}`)).body
    assert.equal(cuentas.find((a: any) => a.id === cuenta.id).balanceCents, 100000)
  })

  test('prestar tú saca el dinero de la cuenta', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Prestar')
    await c.post('/api/debts', {
      profileId: perfil.id, direction: 'por_cobrar', counterparty: 'Luis',
      principalCents: 25000, startDate: '2026-07-01', accountId: cuenta.id,
    })

    const movimientos = (await c.get(`/api/transactions?profileId=${perfil.id}`)).body
    assert.equal(movimientos[0].type, 'gasto')
    const cuentas = (await c.get(`/api/accounts?profileId=${perfil.id}`)).body
    assert.equal(cuentas[0].balanceCents, 100000 - 25000)
  })

  test('pedir y abonar deja el saldo donde tiene que estar', async () => {
    // El caso que antes descuadraba: sin el desembolso, abonar dejaba la
    // cuenta en negativo por dinero que sí había entrado.
    const { perfil, cuenta } = await libroBase(c, 'Ciclo')
    const deuda = (await pedir(perfil.id, cuenta.id)).body
    await c.post(`/api/debts/${deuda.id}/payments`, {
      amountCents: 100000, date: '2026-08-01', accountId: cuenta.id,
    })

    const cuentas = (await c.get(`/api/accounts?profileId=${perfil.id}`)).body
    assert.equal(cuentas[0].balanceCents, 100000 + 300000 - 100000)
    const despues = (await c.get(`/api/debts?profileId=${perfil.id}`)).body[0]
    assert.equal(despues.paidCents, 100000)
    assert.equal(despues.status, 'abierta')
  })

  test('anular el desembolso no borra la deuda ni sus abonos', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Anular desembolso')
    const deuda = (await pedir(perfil.id, cuenta.id)).body
    await c.post(`/api/debts/${deuda.id}/payments`, { amountCents: 50000, date: '2026-08-01' })
    const desembolso = (await c.get(`/api/transactions?profileId=${perfil.id}`)).body.find(
      (t: any) => t.debtId !== null,
    )

    assert.equal((await c.del(`/api/transactions/${desembolso.id}`)).status, 200)

    const despues = (await c.get(`/api/debts?profileId=${perfil.id}`)).body
    assert.equal(despues.length, 1, 'la deuda sobrevive: es el registro principal')
    assert.equal(despues[0].paidCents, 50000)
  })

  test('borrar la deuda deja el movimiento en el libro', async () => {
    // El dinero sí se movió: borrarlo del libro sería mentir.
    const { perfil, cuenta } = await libroBase(c, 'Borrar deuda')
    const deuda = (await pedir(perfil.id, cuenta.id)).body

    await c.del(`/api/debts/${deuda.id}`)

    const movimientos = (await c.get(`/api/transactions?profileId=${perfil.id}`)).body
    assert.equal(movimientos.length, 1)
    assert.equal(movimientos[0].debtId, null, 'solo se pierde la liga')
    const cuentas = (await c.get(`/api/accounts?profileId=${perfil.id}`)).body
    assert.equal(cuentas[0].balanceCents, 400000)
  })

  test('corregir el desembolso corrige el principal de la deuda', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Corregir desembolso')
    const deuda = (await pedir(perfil.id, cuenta.id)).body
    const desembolso = (await c.get(`/api/transactions?profileId=${perfil.id}`)).body[0]

    await c.patch(`/api/transactions/${desembolso.id}`, {
      profileId: perfil.id, accountId: cuenta.id, type: 'ingreso',
      amountCents: 350000, date: '2026-07-02',
    })

    const despues = (await c.get(`/api/debts?profileId=${perfil.id}`)).body[0]
    assert.equal(despues.id, deuda.id)
    assert.equal(despues.principalCents, 350000)
    assert.equal(despues.startDate, '2026-07-02')
  })

  test('el tipo del desembolso no puede cambiar', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Tipo desembolso')
    await pedir(perfil.id, cuenta.id)
    const desembolso = (await c.get(`/api/transactions?profileId=${perfil.id}`)).body[0]

    const res = await c.patch(`/api/transactions/${desembolso.id}`, {
      profileId: perfil.id, accountId: cuenta.id, type: 'gasto',
      amountCents: 300000, date: '2026-07-01',
    })
    assert.equal(res.status, 400)
  })

  test('una cuenta de otro perfil no crea ni la deuda', async () => {
    const a = await libroBase(c, 'Desembolso A')
    const b = await libroBase(c, 'Desembolso B')

    const res = await pedir(a.perfil.id, b.cuenta.id)
    assert.equal(res.status, 400)
    assert.deepEqual((await c.get(`/api/debts?profileId=${a.perfil.id}`)).body, [])
    assert.deepEqual((await c.get(`/api/transactions?profileId=${b.perfil.id}`)).body, [])
  })
})

describe('saldo insoluto de una deuda con tasa', () => {
  /** $10,000 al 12 % anual a 12 meses: la cuota es $888.49. */
  const credito = async (perfilId: number) =>
    (
      await c.post('/api/debts', {
        profileId: perfilId, direction: 'por_pagar', counterparty: 'Banco',
        principalCents: 1_000_000, startDate: '2026-01-10',
        annualRateBp: 1200, termMonths: 12,
      })
    ).body

  test('solo el capital baja lo que debes', async () => {
    const { perfil } = await libroBase(c, 'Insoluto')
    const deuda = await credito(perfil.id)

    const tras = (await c.post(`/api/debts/${deuda.id}/payments`, {
      amountCents: 88849, date: '2026-02-10',
    })).body

    assert.ok(tras.payments[0].interestCents > 0, 'el abono trae interés')
    assert.equal(
      tras.payments[0].capitalCents,
      88849 - tras.payments[0].interestCents,
      'capital = abono − interés',
    )
    assert.equal(tras.paidCents, 88849, 'lo pagado sigue siendo el abono completo')
    assert.equal(tras.balanceCents, 1_000_000 - tras.payments[0].capitalCents)
    assert.ok(
      tras.balanceCents > 1_000_000 - 88849,
      'debes más de lo que dirías restando el abono entero',
    )
  })

  test('no se salda antes de tiempo', async () => {
    // El defecto que esto ataja: tratando cada peso como capital, un crédito
    // a 12 meses se marcaba saldado varios pagos antes.
    const { perfil } = await libroBase(c, 'No saldada')
    const deuda = await credito(perfil.id)
    const fechas = [
      '2026-02-10', '2026-03-10', '2026-04-10', '2026-05-10', '2026-06-10', '2026-07-10',
      '2026-08-10', '2026-09-10', '2026-10-10', '2026-11-10', '2026-12-10',
    ]
    let estado: any
    for (const fecha of fechas) {
      estado = (await c.post(`/api/debts/${deuda.id}/payments`, {
        amountCents: 88849, date: fecha,
      })).body
    }

    assert.equal(estado.status, 'abierta', 'faltando un pago, sigue abierta')
    assert.ok(estado.balanceCents > 0, `todavía debe algo, no ${estado.balanceCents}`)
    assert.ok(estado.interestPaidCents > 0)
    assert.equal(estado.capitalPaidCents + estado.interestPaidCents, estado.paidCents)

    // Y el último pago sí la cierra.
    const final = (await c.post(`/api/debts/${deuda.id}/payments`, {
      amountCents: estado.balanceCents + 20000, date: '2027-01-10',
    })).body
    assert.equal(final.status, 'saldada')
    assert.equal(final.balanceCents, 0, 'el saldo tiene piso en cero')
  })

  test('una deuda sin tasa se comporta igual que siempre', async () => {
    const { perfil } = await libroBase(c, 'Sin tasa')
    const deuda = (await c.post('/api/debts', {
      profileId: perfil.id, direction: 'por_cobrar', counterparty: 'Luis',
      principalCents: 250000, startDate: '2026-01-10',
    })).body

    const tras = (await c.post(`/api/debts/${deuda.id}/payments`, {
      amountCents: 100000, date: '2026-06-10',
    })).body
    assert.equal(tras.payments[0].interestCents, 0)
    assert.equal(tras.balanceCents, 150000)
    assert.equal(tras.status, 'abierta')

    const saldada = (await c.post(`/api/debts/${deuda.id}/payments`, {
      amountCents: 150000, date: '2026-07-10',
    })).body
    assert.equal(saldada.status, 'saldada')
    assert.equal(saldada.balanceCents, 0)
  })

  test('el interés propuesto se puede sobrescribir con el del estado de cuenta', async () => {
    const { perfil } = await libroBase(c, 'Override')
    const deuda = await credito(perfil.id)

    const tras = (await c.post(`/api/debts/${deuda.id}/payments`, {
      amountCents: 88849, date: '2026-02-10', interestCents: 10000,
    })).body
    assert.equal(tras.payments[0].interestCents, 10000)
    assert.equal(tras.balanceCents, 1_000_000 - (88849 - 10000))
  })

  test('un abono que no cubre el interés no baja el saldo, pero tampoco lo sube', async () => {
    // Finply no capitaliza intereses: no inventa deuda que nadie confirmó.
    const { perfil } = await libroBase(c, 'Interés mayor')
    const deuda = await credito(perfil.id)

    const tras = (await c.post(`/api/debts/${deuda.id}/payments`, {
      amountCents: 5000, date: '2026-02-10', interestCents: 90000,
    })).body
    assert.equal(tras.payments[0].interestCents, 5000, 'el interés se recorta al abono')
    assert.equal(tras.payments[0].capitalCents, 0)
    assert.equal(tras.balanceCents, 1_000_000)
  })

  test('corregir el movimiento del abono no deja el capital en negativo', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Corregir abono')
    const deuda = await credito(perfil.id)
    await c.post(`/api/debts/${deuda.id}/payments`, {
      amountCents: 88849, date: '2026-02-10', accountId: cuenta.id, interestCents: 10000,
    })
    const ligado = (await c.get(`/api/transactions?profileId=${perfil.id}`)).body.find(
      (t: any) => t.debtPaymentId !== null,
    )

    await c.patch(`/api/transactions/${ligado.id}`, {
      profileId: perfil.id, accountId: cuenta.id, type: 'gasto',
      amountCents: 6000, date: '2026-02-10',
    })

    const despues = (await c.get(`/api/debts?profileId=${perfil.id}`)).body[0]
    assert.equal(despues.payments[0].interestCents, 6000, 'el interés se recorta al nuevo monto')
    assert.equal(despues.payments[0].capitalCents, 0)
    assert.equal(despues.balanceCents, 1_000_000)
  })

  test('el Resumen suma el saldo insoluto, no el principal menos lo pagado', async () => {
    const { perfil } = await libroBase(c, 'Resumen insoluto')
    const deuda = await credito(perfil.id)
    const tras = (await c.post(`/api/debts/${deuda.id}/payments`, {
      amountCents: 88849, date: '2026-02-10',
    })).body

    const resumen = (await c.get(`/api/summary?profileId=${perfil.id}&month=2026-02`)).body
    assert.equal(resumen.debts.porPagarCents, tras.balanceCents)
  })
})

describe('enganche de una deuda', () => {
  const conEnganche = (perfilId: number, cuentaId: number | null, direction = 'por_pagar') =>
    c.post('/api/debts', {
      profileId: perfilId, direction, counterparty: 'Financiera', concept: 'Auto',
      principalCents: 24_000_000, startDate: '2026-01-10',
      annualRateBp: 1350, termMonths: 48,
      downPaymentCents: 6_000_000,
      downPaymentAccountId: cuentaId,
    })

  test('el enganche no es principal, y sale de la cuenta', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Enganche')
    const deuda = (await conEnganche(perfil.id, cuenta.id)).body

    assert.equal(deuda.principalCents, 24_000_000, 'lo financiado no incluye el enganche')
    assert.equal(deuda.downPaymentCents, 6_000_000)
    assert.equal(deuda.balanceCents, 24_000_000)

    const movimientos = (await c.get(`/api/transactions?profileId=${perfil.id}`)).body
    assert.equal(movimientos.length, 1, 'sin cuenta de desembolso, solo el enganche')
    assert.equal(movimientos[0].type, 'gasto')
    assert.equal(movimientos[0].amountCents, 6_000_000)
    assert.equal(movimientos[0].debtId, deuda.id)

    const cuentas = (await c.get(`/api/accounts?profileId=${perfil.id}`)).body
    assert.equal(cuentas[0].balanceCents, 100000 - 6_000_000)
  })

  test('si tú diste el crédito, el enganche entra', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Enganche recibido')
    await conEnganche(perfil.id, cuenta.id, 'por_cobrar')

    const movimientos = (await c.get(`/api/transactions?profileId=${perfil.id}`)).body
    assert.equal(movimientos[0].type, 'ingreso')
    assert.equal(movimientos[0].amountCents, 6_000_000)
  })

  test('sin cuenta se guarda el monto y no se mueve el libro', async () => {
    const { perfil } = await libroBase(c, 'Enganche apuntado')
    const deuda = (await conEnganche(perfil.id, null)).body

    assert.equal(deuda.downPaymentCents, 6_000_000)
    assert.deepEqual((await c.get(`/api/transactions?profileId=${perfil.id}`)).body, [])
  })

  test('elegir cuenta sin monto se rechaza', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Enganche sin monto')
    const res = await c.post('/api/debts', {
      profileId: perfil.id, direction: 'por_pagar', counterparty: 'X',
      principalCents: 100000, startDate: '2026-01-10', downPaymentAccountId: cuenta.id,
    })
    assert.equal(res.status, 400)
  })

  test('corregir el enganche corrige el enganche, no el principal', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Corregir enganche')
    const deuda = (await conEnganche(perfil.id, cuenta.id)).body
    const movimiento = (await c.get(`/api/transactions?profileId=${perfil.id}`)).body[0]

    await c.patch(`/api/transactions/${movimiento.id}`, {
      profileId: perfil.id, accountId: cuenta.id, type: 'gasto',
      amountCents: 7_000_000, date: '2026-01-10',
    })

    const despues = (await c.get(`/api/debts?profileId=${perfil.id}`)).body[0]
    assert.equal(despues.id, deuda.id)
    assert.equal(despues.downPaymentCents, 7_000_000)
    assert.equal(despues.principalCents, 24_000_000, 'lo financiado no se toca')
  })

  test('desembolso y enganche conviven sin pisarse', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Ambos')
    const deuda = (
      await c.post('/api/debts', {
        profileId: perfil.id, direction: 'por_pagar', counterparty: 'Financiera',
        principalCents: 24_000_000, startDate: '2026-01-10',
        accountId: cuenta.id,
        downPaymentCents: 6_000_000, downPaymentAccountId: cuenta.id,
      })
    ).body

    const movimientos = (await c.get(`/api/transactions?profileId=${perfil.id}`)).body
    assert.equal(movimientos.length, 2)
    assert.equal(movimientos.filter((t: any) => t.debtId === deuda.id).length, 2)
    const cuentas = (await c.get(`/api/accounts?profileId=${perfil.id}`)).body
    assert.equal(cuentas[0].balanceCents, 100000 + 24_000_000 - 6_000_000)
  })
})

describe('movimientos ligados a deudas', () => {
  test('anular el movimiento anula el abono y reabre la deuda', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Deuda anular')
    const deuda = (
      await c.post('/api/debts', {
        profileId: perfil.id, direction: 'por_cobrar', counterparty: 'Luis',
        principalCents: 100000, startDate: '2026-07-01',
      })
    ).body

    const conAbono = (
      await c.post(`/api/debts/${deuda.id}/payments`, {
        amountCents: 100000, date: '2026-07-05', accountId: cuenta.id,
      })
    ).body
    assert.equal(conAbono.status, 'saldada')

    const movimientos = (await c.get(`/api/transactions?profileId=${perfil.id}`)).body
    const ligado = movimientos.find((t: any) => t.debtPaymentId !== null)
    assert.ok(ligado, 'el abono debió asentar un movimiento')

    await c.del(`/api/transactions/${ligado.id}`)

    const despues = (await c.get(`/api/debts?profileId=${perfil.id}`)).body[0]
    assert.equal(despues.payments.length, 0)
    assert.equal(despues.paidCents, 0)
    assert.equal(despues.status, 'abierta')
  })

  test('editar el movimiento sincroniza monto y fecha del abono', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Deuda editar')
    const deuda = (
      await c.post('/api/debts', {
        profileId: perfil.id, direction: 'por_pagar', counterparty: 'Nu',
        principalCents: 200000, startDate: '2026-07-01',
      })
    ).body
    await c.post(`/api/debts/${deuda.id}/payments`, {
      amountCents: 50000, date: '2026-07-05', accountId: cuenta.id,
    })

    const movimientos = (await c.get(`/api/transactions?profileId=${perfil.id}`)).body
    const ligado = movimientos.find((t: any) => t.debtPaymentId !== null)

    await c.patch(`/api/transactions/${ligado.id}`, {
      profileId: perfil.id, accountId: cuenta.id, type: 'gasto',
      amountCents: 75000, date: '2026-07-09',
    })

    const despues = (await c.get(`/api/debts?profileId=${perfil.id}`)).body[0]
    assert.equal(despues.paidCents, 75000)
    assert.equal(despues.payments[0].amountCents, 75000)
    assert.equal(despues.payments[0].date, '2026-07-09')
  })

  test('el tipo de un movimiento ligado no puede cambiar', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Deuda tipo')
    const deuda = (
      await c.post('/api/debts', {
        profileId: perfil.id, direction: 'por_pagar', counterparty: 'Nu',
        principalCents: 200000, startDate: '2026-07-01',
      })
    ).body
    await c.post(`/api/debts/${deuda.id}/payments`, {
      amountCents: 50000, date: '2026-07-05', accountId: cuenta.id,
    })
    const ligado = (await c.get(`/api/transactions?profileId=${perfil.id}`)).body
      .find((t: any) => t.debtPaymentId !== null)

    const res = await c.patch(`/api/transactions/${ligado.id}`, {
      profileId: perfil.id, accountId: cuenta.id, type: 'ingreso',
      amountCents: 50000, date: '2026-07-05',
    })
    assert.equal(res.status, 400)
  })

  test('bajar el principal por debajo de lo abonado salda la deuda', async () => {
    const { perfil } = await libroBase(c, 'Deuda principal')
    const deuda = (
      await c.post('/api/debts', {
        profileId: perfil.id, direction: 'por_cobrar', counterparty: 'Ana',
        principalCents: 100000, startDate: '2026-07-01',
      })
    ).body
    await c.post(`/api/debts/${deuda.id}/payments`, { amountCents: 60000, date: '2026-07-05' })

    const bajada = (await c.patch(`/api/debts/${deuda.id}`, { principalCents: 50000 })).body
    assert.equal(bajada.status, 'saldada')

    const subida = (await c.patch(`/api/debts/${deuda.id}`, { principalCents: 90000 })).body
    assert.equal(subida.status, 'abierta')
  })
})

describe('movimientos ligados a inversiones', () => {
  test('anular el movimiento anula el aporte', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Inversión')
    const inv = (
      await c.post('/api/investments', { profileId: perfil.id, name: 'CETES', kind: 'cetes' })
    ).body
    await c.post(`/api/investments/${inv.id}/entries`, {
      type: 'aporte', amountCents: 40000, date: '2026-07-05', accountId: cuenta.id,
    })

    const ligado = (await c.get(`/api/transactions?profileId=${perfil.id}`)).body
      .find((t: any) => t.investmentEntryId !== null)
    assert.ok(ligado, 'el aporte debió asentar un movimiento')

    await c.del(`/api/transactions/${ligado.id}`)

    const despues = (await c.get(`/api/investments?profileId=${perfil.id}`)).body[0]
    assert.equal(despues.entries.length, 0)
    assert.equal(despues.investedCents, 0)
  })
})

describe('aislamiento entre perfiles', () => {
  test('un movimiento no puede usar la cuenta de otro perfil', async () => {
    const a = await libroBase(c, 'Perfil A')
    const b = await libroBase(c, 'Perfil B')
    const res = await c.post('/api/transactions', {
      profileId: a.perfil.id, accountId: b.cuenta.id, type: 'gasto',
      amountCents: 1000, date: '2026-07-01',
    })
    assert.equal(res.status, 400)
  })

  test('un movimiento no puede usar la categoría de otro perfil', async () => {
    const a = await libroBase(c, 'Categoría A')
    const b = await libroBase(c, 'Categoría B')
    const ajena = b.categorias.find((cat: any) => cat.kind === 'gasto')
    const res = await c.post('/api/transactions', {
      profileId: a.perfil.id, accountId: a.cuenta.id, type: 'gasto',
      amountCents: 1000, date: '2026-07-01', categoryId: ajena.id,
    })
    assert.equal(res.status, 400)
  })

  test('un gasto no puede llevar categoría de ingreso', async () => {
    const { perfil, cuenta, categorias } = await libroBase(c, 'Tipo categoría')
    const deIngreso = categorias.find((cat: any) => cat.kind === 'ingreso')
    const res = await c.post('/api/transactions', {
      profileId: perfil.id, accountId: cuenta.id, type: 'gasto',
      amountCents: 1000, date: '2026-07-01', categoryId: deIngreso.id,
    })
    assert.equal(res.status, 400)
  })

  test('un movimiento no puede cambiar de perfil', async () => {
    const a = await libroBase(c, 'Mover A')
    const b = await libroBase(c, 'Mover B')
    const mov = (
      await c.post('/api/transactions', {
        profileId: a.perfil.id, accountId: a.cuenta.id, type: 'gasto',
        amountCents: 1000, date: '2026-07-01',
      })
    ).body

    const res = await c.patch(`/api/transactions/${mov.id}`, {
      profileId: b.perfil.id, accountId: b.cuenta.id, type: 'gasto',
      amountCents: 1000, date: '2026-07-01',
    })
    assert.equal(res.status, 400)
  })

  test('borrar un perfil no deja registros huérfanos', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Efímero')
    await c.post('/api/transactions', {
      profileId: perfil.id, accountId: cuenta.id, type: 'gasto',
      amountCents: 1000, date: '2026-07-01',
    })
    await c.post('/api/goals', { profileId: perfil.id, name: 'Meta', targetCents: 10000 })
    await c.post('/api/notes', { profileId: perfil.id, title: 'Nota', body: 'x' })

    assert.equal((await c.del(`/api/profiles/${perfil.id}`)).status, 200)

    assert.deepEqual((await c.get(`/api/transactions?profileId=${perfil.id}`)).body, [])
    assert.deepEqual((await c.get(`/api/accounts?profileId=${perfil.id}`)).body, [])
    assert.deepEqual((await c.get(`/api/goals?profileId=${perfil.id}`)).body, [])
    assert.deepEqual((await c.get(`/api/notes?profileId=${perfil.id}`)).body, [])
  })
})

/**
 * Una fecha que no existe en el calendario no puede entrar al libro.
 *
 * No es un capricho de validador: las fechas de Finply son texto y **ordenan
 * como texto**. Un movimiento con fecha '2026-13-45' baja el saldo de su
 * cuenta y no cae en ningún mes del año, así que desaparece del reporte anual
 * sin desaparecer del saldo — el libro deja de cuadrar y nada lo grita. Y
 * '2026-02-30' se convierte en el 2 de marzo en cuanto alguien cuenta días con
 * él, de modo que la misma partida cae en dos meses según quién la mire.
 */
describe('fechas que no existen', () => {
  const imposibles = ['2026-13-45', '2026-00-10', '2026-02-30', '2025-02-29', '0026-01-01']

  test('el mes 13, el día 45 y el 30 de febrero se rechazan', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Calendario')
    for (const date of imposibles) {
      const r = await c.post('/api/transactions', {
        profileId: perfil.id, accountId: cuenta.id, type: 'gasto',
        amountCents: 100, date, note: date,
      })
      assert.equal(r.status, 400, `${date} no debería entrar`)
    }
    // Y el libro sigue sin un solo movimiento raro dentro.
    assert.deepEqual((await c.get(`/api/transactions?profileId=${perfil.id}`)).body, [])
  })

  test('el 29 de febrero de un bisiesto sí entra', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Bisiesto')
    const r = await c.post('/api/transactions', {
      profileId: perfil.id, accountId: cuenta.id, type: 'gasto',
      amountCents: 100, date: '2028-02-29',
    })
    assert.equal(r.status, 201, '2028 es bisiesto: ese día existe')
  })

  test('la puerta es la misma para todo lo que lleva fecha', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Puertas')
    const meta = (await c.post('/api/goals', { profileId: perfil.id, name: 'M', targetCents: 1000 })).body
    const inv = (await c.post('/api/investments', { profileId: perfil.id, name: 'F', kind: 'fondo' })).body

    const puertas: [string, unknown][] = [
      [`/api/goals/${meta.id}/entries`, { amountCents: 100, date: '2026-02-31' }],
      [`/api/investments/${inv.id}/entries`, {
        profileId: perfil.id, type: 'aporte', amountCents: 100, date: '2026-02-31',
      }],
      ['/api/debts', {
        profileId: perfil.id, direction: 'por_pagar', counterparty: 'X', concept: 'Y',
        principalCents: 1000, startDate: '2026-02-31',
      }],
      ['/api/budgets', { profileId: perfil.id, categoryId: 1, period: '2026-13', amountCents: 1000 }],
    ]
    for (const [ruta, cuerpo] of puertas) {
      const r = await c.post(ruta, cuerpo)
      assert.equal(r.status, 400, `${ruta} dejó pasar una fecha imposible`)
    }
    assert.equal(cuenta.id > 0, true)
  })
})

/**
 * Tercera vuelta de la auditoría. Cinco hallazgos, cada uno reproducido por
 * HTTP antes de tocar el código, y cada prueba corrida contra la versión sin
 * arreglar para comprobar que ahí falla.
 */
describe('el techo del dinero', () => {
  /**
   * El peor modo de fallar que hay: el INSERT no se queja, la partida queda
   * dentro del libro, y a partir de ahí `node:sqlite` se niega a devolver un
   * entero que JavaScript no puede representar exacto. Ninguna pantalla puede
   * enseñarla y ningún formulario puede corregirla.
   */
  test('una cifra por encima del entero seguro se rechaza, no se escribe', async () => {
    const { perfil, cuenta, categorias } = await libroBase(c, 'Techo')
    const gasto = categorias.find((k: any) => k.kind === 'gasto')
    const r = await c.post('/api/transactions', {
      profileId: perfil.id,
      accountId: cuenta.id,
      type: 'gasto',
      amountCents: Number.MAX_SAFE_INTEGER + 2,
      date: '2026-08-03',
      categoryId: gasto.id,
    })
    assert.equal(r.status, 400, 'pasó una cifra que el libro no puede releer')

    // Y el libro sigue legible, que es la mitad que importa.
    const listado = await c.get(`/api/transactions?profileId=${perfil.id}`)
    assert.equal(listado.status, 200)
    assert.equal(listado.body.length, 0)
    const cuentas = await c.get(`/api/accounts?profileId=${perfil.id}`)
    assert.equal(cuentas.body[0].balanceCents, cuenta.openingCents)
  })

  test('el techo cubre las demás puertas de dinero, no solo el movimiento', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Techo2')
    const enorme = Number.MAX_SAFE_INTEGER + 2
    const puertas: [string, unknown][] = [
      ['/api/accounts', { profileId: perfil.id, name: 'Gorda', type: 'banco', openingCents: enorme }],
      ['/api/debts', {
        profileId: perfil.id, direction: 'por_pagar', counterparty: 'X',
        principalCents: enorme, startDate: '2026-01-01',
      }],
      ['/api/goals', { profileId: perfil.id, name: 'Meta', targetCents: enorme }],
      [`/api/tarjetas/msi`, {
        profileId: perfil.id, accountId: cuenta.id, totalCents: enorme,
        months: 12, purchaseDate: '2026-01-01',
      }],
    ]
    for (const [ruta, cuerpo] of puertas) {
      const r = await c.post(ruta, cuerpo)
      assert.equal(r.status, 400, `${ruta} dejó pasar una cifra imposible`)
    }
  })

  /**
   * El import escribe **sin pasar por el validador de la API**, así que tiene
   * que traer el techo puesto. Sin él, `parseMonto` devolvía `1e22` —finito, no
   * entero seguro— y el saldo de la cuenta dejaba de ser un entero de centavos.
   */
  test('el CSV tampoco cuela una cifra que rompa el saldo', async () => {
    const { perfil, cuenta } = await libroBase(c, 'TechoCsv')
    const csv = 'fecha,monto,concepto\n2026-08-03,99999999999999999999,gordo\n'
    const cuerpo = {
      profileId: perfil.id,
      csv,
      cuentaPorOmision: cuenta.id,
      crearCategorias: false,
      crearEtiquetas: false,
      omitirDuplicadas: true,
    }
    const previa = await c.post('/api/importaciones/previsualizar', cuerpo)
    assert.equal(previa.status, 200)
    assert.equal(previa.body.filas[0].estado, 'error', 'la vista previa la dio por buena')
    assert.match(previa.body.filas[0].motivo, /Monto ilegible/)

    const escrito = await c.post('/api/importaciones', { ...cuerpo, huella: previa.body.huella })
    assert.equal(escrito.status, 400, 'no había nada legible que importar')
    const cuentas = await c.get(`/api/accounts?profileId=${perfil.id}`)
    assert.equal(cuentas.body[0].balanceCents, cuenta.openingCents, 'el saldo se movió')
  })

  test('un millón de pesos —una cifra grande de verdad— sigue entrando', async () => {
    const { perfil, cuenta, categorias } = await libroBase(c, 'TechoOk')
    const gasto = categorias.find((k: any) => k.kind === 'gasto')
    const r = await c.post('/api/transactions', {
      profileId: perfil.id,
      accountId: cuenta.id,
      type: 'gasto',
      amountCents: 1_000_000_00,
      date: '2026-08-03',
      categoryId: gasto.id,
    })
    assert.equal(r.status, 201, 'el techo no puede estorbarle a un libro real')
  })
})

/**
 * La otra mitad del mismo hallazgo, y la que la tercera vuelta no vio: **la
 * trampa no era del dinero, era del entero**.
 *
 * `qty_milli` y `position` son columnas INTEGER igual que los centavos, y el
 * techo del dinero no las cubría. Con una cantidad por encima de 2^53 el
 * almacén dejaba de abrir y —peor— el respaldo del libro entero contestaba
 * 500: la misma partida encerrada, por una puerta que no era de dinero.
 */
describe('el techo de las demás magnitudes', () => {
  const ENORME = Number.MAX_SAFE_INTEGER + 2

  test('una cantidad de existencias imposible se rechaza y el almacén sigue abriendo', async () => {
    const { perfil } = await libroBase(c, 'Cantidad', 'negocio')
    const prod = (
      await c.post('/api/inventario', { profileId: perfil.id, name: 'Cemento', unit: 'kg' })
    ).body
    const r = await c.post('/api/inventario/movimientos', {
      profileId: perfil.id,
      productId: prod.id,
      date: '2026-08-03',
      kind: 'entrada',
      qtyMilli: ENORME,
      unitCostCents: 100,
    })
    assert.equal(r.status, 400, 'pasó una cantidad que el libro no puede releer')

    const almacen = await c.get(`/api/inventario?profileId=${perfil.id}`)
    assert.equal(almacen.status, 200, 'el almacén dejó de abrir')
    assert.equal(almacen.body.productos[0].cantidadMilli, 0)
    // Y la puerta que de verdad importa: el libro entero se sigue pudiendo sacar.
    assert.equal((await c.get('/api/respaldo')).status, 200, 'el libro se quedó sin salida')
  })

  test('el mínimo de un producto tampoco cuela una cantidad imposible', async () => {
    const { perfil } = await libroBase(c, 'Minimo', 'negocio')
    const r = await c.post('/api/inventario', {
      profileId: perfil.id, name: 'Arena', unit: 'kg', minQtyMilli: ENORME,
    })
    assert.equal(r.status, 400)
    assert.equal((await c.get(`/api/inventario?profileId=${perfil.id}`)).status, 200)
  })

  test('el orden de una lista tampoco: es un entero como cualquier otro', async () => {
    const { perfil } = await libroBase(c, 'Orden')
    const campo = await c.post('/api/personalizacion/campos', {
      profileId: perfil.id, label: 'Obra', kind: 'texto', position: ENORME,
    })
    assert.equal(campo.status, 400)
    assert.equal(
      (await c.get(`/api/personalizacion/campos?profileId=${perfil.id}`)).status,
      200,
      'los campos propios dejaron de abrir',
    )

    const plantilla = await c.post('/api/personalizacion/plantillas', {
      profileId: perfil.id, name: 'Café', type: 'gasto', position: ENORME,
    })
    assert.equal(plantilla.status, 400)
  })

  test('mil quinientos kilos —una cantidad real— siguen entrando', async () => {
    const { perfil } = await libroBase(c, 'CantidadOk', 'negocio')
    const prod = (
      await c.post('/api/inventario', {
        profileId: perfil.id, name: 'Grava', unit: 'kg', minQtyMilli: 100_000,
      })
    ).body
    const r = await c.post('/api/inventario/movimientos', {
      profileId: perfil.id, productId: prod.id, date: '2026-08-03',
      kind: 'entrada', qtyMilli: 1_500_000, unitCostCents: 250,
    })
    assert.equal(r.status, 201, 'el techo no puede estorbarle a un almacén real')
  })
})
