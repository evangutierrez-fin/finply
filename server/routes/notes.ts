// La libreta. Desde la Fase 20, la libreta que se habla con el libro.
//
// Una nota puede quedarse suelta —lo era hasta hoy y sigue siéndolo— o
// atarse a **un movimiento** ("el súper del 12 salió carísimo porque llevé a
// los niños") o a **un mes** ("este mes gasté de más por la mudanza"). Las dos
// ligas son opcionales y **excluyentes**: una nota explica una cosa, y dejar
// que explicara dos obligaría a cada vista a decidir cuál enseñar.

import { Router } from 'express'
import { db, httpError } from '../db.ts'
import { noteInput, notePatch, noteQuery } from '../validators.ts'

const router = Router()

/**
 * La nota con lo poco del movimiento que hace falta para poder nombrarlo. Sin
 * esto, la libreta enseñaría "nota de #418", que no le dice nada a nadie.
 */
const NOTE_SELECT = `
  SELECT n.*, t.date AS tx_date, t.note AS tx_note, t.amount_cents AS tx_amount_cents,
    t.type AS tx_type
  FROM notes n
  LEFT JOIN transactions t ON t.id = n.tx_id
`

function mapNote(row: any) {
  return {
    id: row.id,
    profileId: row.profile_id,
    title: row.title,
    body: row.body,
    pinned: row.pinned === 1,
    /** El movimiento que explica. `null` si la nota va suelta o es del mes. */
    txId: row.tx_id ?? null,
    /** El mes al que pertenece, 'AAAA-MM'. */
    period: row.period ?? null,
    /** Cómo se llama ese movimiento, para poder escribirlo sin otra consulta. */
    tx:
      row.tx_id && row.tx_date
        ? {
            id: row.tx_id,
            date: row.tx_date,
            note: row.tx_note,
            amountCents: row.tx_amount_cents,
            type: row.tx_type,
          }
        : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * Una nota explica **una** cosa. Y el movimiento tiene que ser del mismo
 * perfil: sin esta comprobación, la libreta de un libro podría colgarse de una
 * partida de otro y el respaldo saldría con una referencia cruzada.
 */
function revisarLiga(
  profileId: number,
  txId: number | null | undefined,
  period: string | null | undefined,
): void {
  if (txId && period) {
    throw httpError(400, 'Una nota se ata a un movimiento o a un mes, no a los dos')
  }
  if (!txId) return
  const row = db
    .prepare('SELECT id FROM transactions WHERE id = ? AND profile_id = ?')
    .get(txId, profileId)
  if (!row) throw httpError(400, 'Ese movimiento no pertenece a este perfil')
}

router.get('/', (req, res) => {
  const query = noteQuery.parse(req.query)
  const clauses = ['n.profile_id = ?']
  const params: (string | number)[] = [query.profileId]
  if (query.txId) {
    clauses.push('n.tx_id = ?')
    params.push(query.txId)
  }
  if (query.period) {
    clauses.push('n.period = ?')
    params.push(query.period)
  }
  const rows = db
    .prepare(
      `${NOTE_SELECT} WHERE ${clauses.join(' AND ')}
       ORDER BY n.pinned DESC, n.updated_at DESC, n.id DESC`,
    )
    .all(...params)
  res.json(rows.map(mapNote))
})

router.post('/', (req, res) => {
  const input = noteInput.parse(req.body)
  if (!input.title && !input.body.trim()) {
    return res.status(400).json({ error: 'La nota está vacía' })
  }
  revisarLiga(input.profileId, input.txId, input.period)
  const result = db
    .prepare(
      `INSERT INTO notes (profile_id, title, body, tx_id, period, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'), datetime('now', 'localtime'))`,
    )
    .run(input.profileId, input.title, input.body, input.txId ?? null, input.period ?? null)
  const row = db.prepare(`${NOTE_SELECT} WHERE n.id = ?`).get(Number(result.lastInsertRowid))
  res.status(201).json(mapNote(row))
})

router.patch('/:id', (req, res) => {
  const id = Number(req.params.id)
  const existing: any = db.prepare('SELECT * FROM notes WHERE id = ?').get(id)
  if (!existing) return res.status(404).json({ error: 'Nota no encontrada' })
  const input = notePatch.parse(req.body)
  // Ausente conserva lo que traía; `null` explícito suelta la liga. Es la
  // misma distinción que las etiquetas de un movimiento: "no opiné" no puede
  // significar lo mismo que "quítala".
  const txId = input.txId === undefined ? (existing.tx_id ?? null) : input.txId
  const period = input.period === undefined ? (existing.period ?? null) : input.period
  revisarLiga(existing.profile_id, txId, period)
  const contentChanged = input.title !== undefined || input.body !== undefined
  db.prepare(
    `UPDATE notes SET title = ?, body = ?, pinned = ?, tx_id = ?, period = ?,
      updated_at = CASE WHEN ? THEN datetime('now', 'localtime') ELSE updated_at END
     WHERE id = ?`,
  ).run(
    input.title ?? existing.title,
    input.body ?? existing.body,
    input.pinned === undefined ? existing.pinned : input.pinned ? 1 : 0,
    txId,
    period,
    contentChanged ? 1 : 0,
    id,
  )
  const row = db.prepare(`${NOTE_SELECT} WHERE n.id = ?`).get(id)
  res.json(mapNote(row))
})

router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM notes WHERE id = ?').run(Number(req.params.id))
  if (result.changes === 0) return res.status(404).json({ error: 'Nota no encontrada' })
  res.json({ ok: true })
})

export default router
