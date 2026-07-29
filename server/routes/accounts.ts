import { Router } from 'express'
import { db, accountsWithBalance, httpError, mapAccount, saldoAFecha } from '../db.ts'
import { accountInput, accountPatch, serieCuentaQuery } from '../validators.ts'
import { hoyISO } from '../../shared/fechas.ts'

const router = Router()

/** Límite y días de corte/pago solo tienen sentido en una tarjeta. */
function ensureSoloTarjeta(
  type: string,
  input: { creditLimitCents?: number | null; cutDay?: number | null; dueDay?: number | null },
): void {
  if (type === 'tarjeta') return
  const trae = [input.creditLimitCents, input.cutDay, input.dueDay].some(
    (v) => v !== undefined && v !== null,
  )
  if (trae) {
    throw httpError(400, 'El límite y los días de corte y pago son solo de una tarjeta')
  }
}

router.get('/', (req, res) => {
  const profileId = Number(req.query.profileId)
  if (!Number.isInteger(profileId) || profileId <= 0) {
    return res.status(400).json({ error: 'Falta profileId' })
  }
  res.json(accountsWithBalance(profileId).map(mapAccount))
})

router.post('/', (req, res) => {
  const input = accountInput.parse(req.body)
  ensureSoloTarjeta(input.type, input)
  const result = db
    .prepare(
      `INSERT INTO accounts
        (profile_id, name, type, currency, opening_cents, credit_limit_cents, cut_day, due_day,
         min_balance_cents, institution, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.profileId,
      input.name,
      input.type,
      input.currency,
      input.openingCents,
      input.creditLimitCents ?? null,
      input.cutDay ?? null,
      input.dueDay ?? null,
      input.minBalanceCents ?? null,
      input.institution,
      input.sortOrder,
    )
  const rows = accountsWithBalance(input.profileId).map(mapAccount)
  const created = rows.find((a) => a.id === Number(result.lastInsertRowid))
  res.status(201).json(created)
})

router.patch('/:id', (req, res) => {
  const id = Number(req.params.id)
  const input = accountPatch.parse(req.body)
  const existing: any = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id)
  if (!existing) return res.status(404).json({ error: 'Cuenta no encontrada' })

  const type = input.type ?? existing.type
  ensureSoloTarjeta(type, input)
  // Ausente deja el dato como estaba; `null` lo borra. Y si la cuenta deja de
  // ser tarjeta, los datos de crédito se van con el tipo: un día de corte en
  // una cuenta de efectivo no significa nada.
  const credito =
    type === 'tarjeta'
      ? {
          limite:
            input.creditLimitCents === undefined
              ? existing.credit_limit_cents
              : input.creditLimitCents,
          corte: input.cutDay === undefined ? existing.cut_day : input.cutDay,
          pago: input.dueDay === undefined ? existing.due_day : input.dueDay,
        }
      : { limite: null, corte: null, pago: null }

  db.prepare(
    `UPDATE accounts SET name = ?, type = ?, currency = ?, opening_cents = ?, archived = ?,
      credit_limit_cents = ?, cut_day = ?, due_day = ?,
      min_balance_cents = ?, institution = ?, sort_order = ? WHERE id = ?`,
  ).run(
    input.name ?? existing.name,
    type,
    input.currency ?? existing.currency,
    input.openingCents ?? existing.opening_cents,
    input.archived === undefined ? existing.archived : input.archived ? 1 : 0,
    credito.limite,
    credito.corte,
    credito.pago,
    input.minBalanceCents === undefined ? existing.min_balance_cents : input.minBalanceCents,
    input.institution ?? existing.institution,
    input.sortOrder ?? existing.sort_order,
    id,
  )
  const rows = accountsWithBalance(existing.profile_id).map(mapAccount)
  res.json(rows.find((a) => a.id === id))
})

/**
 * El saldo de **esta** cuenta al cierre de cada mes. La serie de patrimonio es
 * global y no contesta "¿mi cuenta de ahorro va subiendo?": esta sí.
 *
 * Una sola consulta para toda la serie —un `saldoAFecha` por mes dentro del
 * mismo SELECT— en vez de una por mes (R11).
 */
router.get('/:id/serie', (req, res) => {
  const id = Number(req.params.id)
  const cuenta: any = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id)
  if (!cuenta) return res.status(404).json({ error: 'Cuenta no encontrada' })
  const { meses, hoy } = serieCuentaQuery.parse(req.query)
  const hasta = hoy ?? hoyISO()

  // Los cierres, de más viejo a más nuevo. El del mes en curso es hoy: el mes
  // va a medias y decir su cierre sería inventar lo que todavía no pasa.
  const [y, m] = hasta.slice(0, 7).split('-').map(Number)
  const puntos: { month: string; cierre: string }[] = []
  for (let i = meses - 1; i >= 0; i -= 1) {
    const total = y! * 12 + (m! - 1) - i
    const mes = `${Math.floor(total / 12)}-${String((((total % 12) + 12) % 12) + 1).padStart(2, '0')}`
    puntos.push({ month: mes, cierre: i === 0 ? hasta : `${mes}-31` })
  }

  const columnas = puntos.map((_, i) => `${saldoAFecha('a', `?${''}`)} AS m${i}`).join(', ')
  const fila: any = db
    .prepare(`SELECT ${columnas} FROM accounts a WHERE a.id = ?`)
    .get(...puntos.flatMap((p) => [p.cierre, p.cierre]), id)

  res.json({
    accountId: id,
    name: cuenta.name,
    puntos: puntos.map((p, i) => ({ month: p.month, balanceCents: fila[`m${i}`] as number })),
  })
})

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id)
  const existing: any = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id)
  if (!existing) return res.status(404).json({ error: 'Cuenta no encontrada' })
  const usage: any = db
    .prepare(
      'SELECT COUNT(*) AS n FROM transactions WHERE account_id = ? OR transfer_account_id = ?',
    )
    .get(id, id)
  if (usage.n > 0) {
    return res.status(409).json({
      error: 'La cuenta tiene movimientos registrados. Archívala en su lugar.',
    })
  }
  db.prepare('DELETE FROM accounts WHERE id = ?').run(id)
  res.json({ ok: true })
})

export default router
