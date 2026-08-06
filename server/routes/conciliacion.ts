// Cortes de conciliación: la segunda mitad de D19.
//
// La bandera por movimiento es el dato; esto es lo que la convierte en una
// comprobación con respuesta sí/no. "Al 31 de julio mi banco decía $84,320.15":
// si lo palomeado suma esa cifra, la cuenta cuadra; si no, la diferencia y las
// partidas sin marcar de esa fecha hacia atrás dicen exactamente qué falta.
//
// Todo lo derivado se calcula al leer —el corte solo guarda la fecha y el saldo
// declarado—, así que marcar o desmarcar una partida vuelve a cuadrar el corte
// solo, sin recalcular nada guardado. Es la misma línea de D7 y D10.

import { Router } from 'express'
import { db, ensureAccount, ensureCategory, httpError, saldoAFecha } from '../db.ts'
import { ajusteCorteInput, cortInput, cortQuery } from '../validators.ts'

const router = Router()

function mapCorte(row: any) {
  const conciliadoCents = row.conciliado_cents as number
  return {
    id: row.id,
    profileId: row.profile_id,
    accountId: row.account_id,
    accountName: row.account_name,
    date: row.date,
    /** Lo que dice el estado de cuenta. Lo escribe el usuario. */
    balanceCents: row.balance_cents,
    /** Lo que suman las partidas ya palomeadas hasta esa fecha. */
    conciliadoCents,
    /** Lo que suma el libro entero hasta esa fecha, palomeado o no. */
    libroCents: row.libro_cents as number,
    /**
     * La respuesta. Cero es "cuadra"; cualquier otra cosa es lo que falta por
     * explicar, y `pendientes` es dónde buscarlo.
     */
    diferenciaCents: row.balance_cents - conciliadoCents,
    pendientes: row.pendientes as number,
    pendientesCents: row.pendientes_cents as number,
    note: row.note,
    createdAt: row.created_at,
  }
}

/**
 * Todo lo derivado sale en la **misma** consulta, no en tres por corte (R11):
 * el saldo palomeado, el del libro y las partidas que faltan por marcar.
 */
const CORTE_SELECT = `
  SELECT s.*, a.name AS account_name,
    ${saldoAFecha('a', 's.date', true)} AS conciliado_cents,
    ${saldoAFecha('a', 's.date', false)} AS libro_cents,
    (SELECT COUNT(*) FROM transactions t
      WHERE (t.account_id = a.id OR t.transfer_account_id = a.id)
        AND t.date <= s.date AND t.reconciled_at IS NULL) AS pendientes,
    COALESCE((SELECT SUM(CASE
        WHEN t.transfer_account_id = a.id THEN t.amount_cents
        WHEN t.type = 'ingreso' THEN t.amount_cents
        ELSE -t.amount_cents END)
      FROM transactions t
      WHERE (t.account_id = a.id OR t.transfer_account_id = a.id)
        AND t.date <= s.date AND t.reconciled_at IS NULL), 0) AS pendientes_cents
  FROM account_statements s
  JOIN accounts a ON a.id = s.account_id
`

router.get('/', (req, res) => {
  const query = cortQuery.parse(req.query)
  const filtro = query.accountId ? 'AND s.account_id = ?' : ''
  const params: number[] = query.accountId ? [query.profileId, query.accountId] : [query.profileId]
  const rows = db
    .prepare(`${CORTE_SELECT} WHERE s.profile_id = ? ${filtro} ORDER BY s.date DESC, s.id DESC`)
    .all(...params)
  res.json(rows.map(mapCorte))
})

/**
 * Declarar un corte. Repetir cuenta y fecha **corrige** el anterior en vez de
 * duplicarlo: quien vuelve a capturar el mismo corte está arreglando un dedazo,
 * no declarando dos verdades del mismo día.
 */
router.post('/', (req, res) => {
  const input = cortInput.parse(req.body)
  ensureAccount(input.profileId, input.accountId)
  db.prepare(
    `INSERT INTO account_statements (profile_id, account_id, date, balance_cents, note)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (account_id, date) DO UPDATE SET
       balance_cents = excluded.balance_cents, note = excluded.note`,
  ).run(input.profileId, input.accountId, input.date, input.balanceCents, input.note)
  const row = db
    .prepare(`${CORTE_SELECT} WHERE s.account_id = ? AND s.date = ?`)
    .get(input.accountId, input.date)
  res.status(201).json(mapCorte(row))
})

/**
 * Asentar la diferencia del corte como movimiento: el faltante del cajón es un
 * gasto y el sobrante es un ingreso.
 *
 * Hasta la Fase 19, un corte podía decir "faltan $340" y el libro se quedaba
 * mal para siempre — señalaba el hueco y no había forma de taparlo sin
 * inventar una partida a mano con un monto copiado a ojo. Es la diferencia
 * entre conciliar una cuenta de banco (donde lo que falta es una partida que
 * **sí** existe y hay que capturar) y cuadrar un cajón de efectivo (donde lo
 * que falta es dinero que no está y eso ya es el hecho).
 *
 * R4 en su forma exacta: el usuario pide el ajuste, Finply no lo asienta solo.
 * Y el monto es **el que Finply calculó**, no uno que se mande: aceptar otro
 * convertiría el ajuste en una partida inventada con nombre de ajuste.
 *
 * El movimiento nace **ya conciliado**: es del corte, así que dejarlo sin
 * marcar volvería a descuadrar el mismo corte que acaba de cerrar.
 */
router.post('/:id/ajustar', (req, res) => {
  const input = ajusteCorteInput.parse(req.body)
  const row: any = db
    .prepare(`${CORTE_SELECT} WHERE s.id = ? AND s.profile_id = ?`)
    .get(Number(req.params.id), input.profileId)
  if (!row) throw httpError(404, 'Ese corte no existe en este perfil')

  const corte = mapCorte(row)
  if (corte.diferenciaCents === 0) {
    throw httpError(409, 'Este corte ya cuadra: no hay diferencia que asentar')
  }
  // ⚠ Con partidas sin palomear, la diferencia **no es un faltante**: es lo que
  // todavía no has marcado, y asentarla taparía el hueco con una mentira del
  // tamaño de lo que falte por revisar. Se probó en el navegador sobre el libro
  // demo: con 53 partidas sin marcar, la "diferencia" era el saldo entero de la
  // cuenta y el ajuste habría metido $83,045.06 de ingreso inventado.
  //
  // La regla vive **aquí** y no solo en el botón que la esconde: un guardia que
  // solo vive en la vista no es un guardia.
  if (corte.pendientes > 0) {
    throw httpError(
      409,
      `Faltan ${corte.pendientes} partidas por palomear en esta cuenta: esa diferencia todavía ` +
        'no es un faltante, es lo que no has marcado. Palomea primero y vuelve a mirar.',
    )
  }
  // Sobra dinero → entró algo que no estaba apuntado. Falta → salió.
  const sobra = corte.diferenciaCents > 0
  const amountCents = Math.abs(corte.diferenciaCents)
  const type = sobra ? 'ingreso' : 'gasto'
  if (input.categoryId) ensureCategory(input.profileId, input.categoryId, type)

  // El concepto va en `note`, que es como se llama en `transactions`: el
  // movimiento tiene que poder leerse en el libro y decir de dónde salió.
  const note =
    input.concept ||
    (sobra ? `Sobrante del corte del ${corte.date}` : `Faltante del corte del ${corte.date}`)

  const result = db
    .prepare(
      `INSERT INTO transactions
        (profile_id, account_id, type, amount_cents, date, note, category_id, reconciled_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    )
    .run(
      input.profileId,
      corte.accountId,
      type,
      amountCents,
      corte.date,
      note,
      input.categoryId ?? null,
    )

  const despues: any = db.prepare(`${CORTE_SELECT} WHERE s.id = ?`).get(corte.id)
  res.status(201).json({
    txId: Number(result.lastInsertRowid),
    corte: mapCorte(despues),
  })
})

router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM account_statements WHERE id = ?').run(Number(req.params.id))
  if (Number(result.changes) === 0) throw httpError(404, 'Ese corte no existe')
  res.json({ ok: true })
})

export default router
