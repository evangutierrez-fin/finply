import { Router } from 'express'
import {
  db,
  accountsWithBalance,
  investmentsWithTotals,
  mapAccount,
  mapTx,
  saldoAFecha,
  TX_SELECT,
} from '../db.ts'
import { listarBienes } from '../bienes.ts'
import { hoyISO, sumarDias } from '../../shared/fechas.ts'
import { summaryQuery } from '../validators.ts'
import type { Account, Summary } from '../../shared/types.ts'

const router = Router()

/** Cuántos días trae la minigráfica de cada cuenta, contando hoy. */
const DIAS_SPARK = 30

/** El último día del mes anterior a un 'AAAA-MM'. */
function cierreAnterior(mes: string): string {
  const [y, m] = mes.split('-').map(Number)
  // El día 0 del mes es el último del anterior, y `Date.UTC` lo resuelve solo.
  return new Date(Date.UTC(y!, m! - 1, 0)).toISOString().slice(0, 10)
}

/**
 * El saldo de cada cuenta activa en dos fechas de golpe: el arranque de la
 * ventana de la minigráfica y el cierre del mes pasado.
 *
 * Van en la **misma** consulta porque son la misma pregunta con dos fechas, y
 * porque el Resumen se carga en cada visita: cada consulta de más se paga
 * siempre (R11). El fragmento es el de la vista de Cuentas —dos veces la fecha
 * por expresión, una por subconsulta—, así que estas cifras y las que el
 * usuario ve en Cuentas no pueden separarse.
 */
function saldosEnDosFechas(
  profileId: number,
  inicioVentana: string,
  cierreMesPasado: string,
): Map<number, { inicio: number; previo: number }> {
  const filas: any[] = db
    .prepare(
      `SELECT a.id,
        ${saldoAFecha('a', '?')} AS inicio,
        ${saldoAFecha('a', '?')} AS previo
       FROM accounts a
       WHERE a.profile_id = ? AND a.archived = 0`,
    )
    .all(inicioVentana, inicioVentana, cierreMesPasado, cierreMesPasado, profileId)
  return new Map(filas.map((f) => [f.id as number, { inicio: f.inicio, previo: f.previo }]))
}

/**
 * Lo que se movió cada día en cada cuenta dentro de la ventana, en **una**
 * consulta para todas: la pata que sale y la que recibe de una transferencia
 * se juntan con un `UNION ALL`. Con una consulta por cuenta —o peor, por día—
 * un libro de diez cuentas costaría trescientas.
 */
function movimientoDiario(
  profileId: number,
  desde: string,
  hasta: string,
): Map<string, number> {
  const filas: any[] = db
    .prepare(
      `SELECT id, date, SUM(neto) AS neto FROM (
        SELECT t.account_id AS id, t.date AS date,
          SUM(CASE WHEN t.type = 'ingreso' THEN t.amount_cents ELSE -t.amount_cents END) AS neto
        FROM transactions t
        WHERE t.profile_id = ? AND t.date BETWEEN ? AND ?
        GROUP BY t.account_id, t.date
        UNION ALL
        SELECT t.transfer_account_id AS id, t.date AS date, SUM(t.amount_cents) AS neto
        FROM transactions t
        WHERE t.profile_id = ? AND t.transfer_account_id IS NOT NULL
          AND t.date BETWEEN ? AND ?
        GROUP BY t.transfer_account_id, t.date
      ) GROUP BY id, date`,
    )
    .all(profileId, desde, hasta, profileId, desde, hasta)
  return new Map(filas.map((f) => [`${f.id}·${f.date}`, f.neto as number]))
}

/**
 * Treinta días de saldo por cuenta, un punto por día.
 *
 * Se arma **hacia adelante** desde el saldo del día anterior a la ventana: así
 * cada punto es el cierre de su día y el último es el saldo de hoy, la misma
 * cifra que la cuenta enseña arriba. Hacia atrás desde el saldo de la cuenta no
 * se puede: ese saldo suma todos los movimientos **sin mirar la fecha**, así
 * que una partida con fecha futura lo dejaría corrido (es lo mismo que costó
 * un defecto en la Fase 16).
 */
function sparksDe(profileId: number, cuentas: Account[], hoy: string, mes: string) {
  const desde = sumarDias(hoy, -(DIAS_SPARK - 1))
  const saldos = saldosEnDosFechas(profileId, sumarDias(desde, -1), cierreAnterior(mes))
  const diario = movimientoDiario(profileId, desde, hoy)

  const porCuenta = cuentas.map((cuenta) => {
    let saldo = saldos.get(cuenta.id)?.inicio ?? 0
    const puntos: number[] = []
    for (let i = 0; i < DIAS_SPARK; i++) {
      saldo += diario.get(`${cuenta.id}·${sumarDias(desde, i)}`) ?? 0
      puntos.push(saldo)
    }
    return { accountId: cuenta.id, puntos }
  })

  const totalPrevioCents = cuentas.reduce((s, c) => s + (saldos.get(c.id)?.previo ?? 0), 0)
  return { sparks: { desde, hasta: hoy, porCuenta }, totalPrevioCents }
}

router.get('/', (req, res) => {
  const { profileId, month, hoy } = summaryQuery.parse(req.query)

  const accounts = accountsWithBalance(profileId).map(mapAccount)
  const active = accounts.filter((a) => !a.archived)
  const totalCents = active.reduce((sum, a) => sum + a.balanceCents, 0)

  // La comparación y las minigráficas salen de las mismas dos consultas: un
  // total sin nada contra qué medirlo no dice si vas bien, y una cuenta con su
  // cifra sola no dice si viene subiendo.
  const { sparks, totalPrevioCents } = sparksDe(profileId, active, hoy ?? hoyISO(), month)

  const totals: any = db
    .prepare(
      `SELECT
        COALESCE(SUM(CASE WHEN type = 'ingreso' THEN amount_cents END), 0) AS income,
        COALESCE(SUM(CASE WHEN type = 'gasto' THEN amount_cents END), 0) AS expense
      FROM transactions
      WHERE profile_id = ? AND substr(date, 1, 7) = ? AND type IN ('ingreso', 'gasto')`,
    )
    .get(profileId, month)

  const byDay: any[] = db
    .prepare(
      `SELECT date,
        COALESCE(SUM(CASE WHEN type = 'ingreso' THEN amount_cents END), 0) AS income,
        COALESCE(SUM(CASE WHEN type = 'gasto' THEN amount_cents END), 0) AS expense
      FROM transactions
      WHERE profile_id = ? AND substr(date, 1, 7) = ? AND type IN ('ingreso', 'gasto')
      GROUP BY date ORDER BY date ASC`,
    )
    .all(profileId, month)

  const byCategory: any[] = db
    .prepare(
      `SELECT COALESCE(c.name, 'Sin categoría') AS name, SUM(t.amount_cents) AS expense
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id
      WHERE t.profile_id = ? AND substr(t.date, 1, 7) = ? AND t.type = 'gasto'
      GROUP BY COALESCE(c.name, 'Sin categoría')
      ORDER BY expense DESC LIMIT 6`,
    )
    .all(profileId, month)

  const recent: any[] = db
    .prepare(`${TX_SELECT} WHERE t.profile_id = ? ORDER BY t.date DESC, t.id DESC LIMIT 8`)
    .all(profileId)

  const debts: any = db
    .prepare(
      `SELECT
        COALESCE(SUM(CASE WHEN direction = 'por_cobrar' THEN remaining END), 0) AS por_cobrar,
        COALESCE(SUM(CASE WHEN direction = 'por_pagar' THEN remaining END), 0) AS por_pagar,
        COUNT(*) AS abiertas
      FROM (
        SELECT d.direction,
          -- Saldo insoluto: solo el capital abonado baja el principal.
          d.principal_cents - COALESCE((SELECT SUM(p.amount_cents - p.interest_cents)
            FROM debt_payments p WHERE p.debt_id = d.id), 0) AS remaining
        FROM debts d
        WHERE d.profile_id = ? AND d.status = 'abierta'
      )`,
    )
    .get(profileId)

  const investments = investmentsWithTotals(profileId).filter((i) => !i.archived)
  // H3: el auto que financiaste también es tuyo. Entra por su valor declarado
  // —la deuda ya se resta en su propio renglón— y por eso el Resumen dejó de
  // decir que comprar un coche te empobrece.
  const bienes = listarBienes(profileId).filter((b) => !b.archived)

  const cuerpo: Summary = {
    month,
    accounts,
    totalCents,
    totalPrevioCents,
    sparks,
    incomeCents: totals.income,
    expenseCents: totals.expense,
    byDay: byDay.map((d) => ({ date: d.date, incomeCents: d.income, expenseCents: d.expense })),
    byCategory: byCategory.map((c) => ({ name: c.name, expenseCents: c.expense })),
    recent: recent.map(mapTx),
    debts: {
      porCobrarCents: debts.por_cobrar,
      porPagarCents: debts.por_pagar,
      abiertas: debts.abiertas,
    },
    investments: {
      investedCents: investments.reduce((s, i) => s + i.investedCents, 0),
      valueCents: investments.reduce((s, i) => s + i.valueCents, 0),
      count: investments.length,
    },
    bienes: {
      costCents: bienes.reduce((s, b) => s + b.costCents, 0),
      valueCents: bienes.reduce((s, b) => s + b.valueCents, 0),
      count: bienes.length,
    },
  }
  res.json(cuerpo)
})

export default router
