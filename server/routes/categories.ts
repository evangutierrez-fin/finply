import { Router } from 'express'
import { db, httpError, inTransaction } from '../db.ts'
import {
  CATEGORY_SELECT,
  categoriaPorId,
  listarCategorias,
  listarReglas,
  mapCategory,
  reglaPorId,
  revisarPadre,
} from '../taxonomia.ts'
import {
  categoryDeleteQuery,
  categoryInput,
  categoryPatch,
  reglaInput,
  reglaPatch,
  reglaQuery,
} from '../validators.ts'

const router = Router()

// ── Reglas de import ──────────────────────────────────────────────────────
//
// Van antes que `/:id` porque Express casa por orden y '/reglas' entraría por
// la ruta del identificador.
//
// Viven aquí y no en su propio archivo por lo mismo que el papel de una
// categoría vive aquí: una regla **es** una categoría con un texto delante, y
// se edita en la misma vista.

router.get('/reglas', (req, res) => {
  const q = reglaQuery.parse(req.query)
  res.json(listarReglas(q.profileId))
})

router.post('/reglas', (req, res) => {
  const input = reglaInput.parse(req.body)
  const categoria = db
    .prepare('SELECT id FROM categories WHERE id = ? AND profile_id = ?')
    .get(input.categoryId, input.profileId)
  if (!categoria) return res.status(400).json({ error: 'Esa categoría no es de este perfil' })
  // Al final de la lista: el orden lo cambia el usuario, y una regla nueva no
  // puede colarse delante de las que ya funcionaban.
  const ultima: any = db
    .prepare('SELECT COALESCE(MAX(position), -1) AS n FROM import_rules WHERE profile_id = ?')
    .get(input.profileId)
  const result = db
    .prepare(
      'INSERT INTO import_rules (profile_id, pattern, category_id, position) VALUES (?, ?, ?, ?)',
    )
    .run(input.profileId, input.pattern, input.categoryId, ultima.n + 1)
  res.status(201).json(reglaPorId(Number(result.lastInsertRowid)))
})

router.patch('/reglas/:id', (req, res) => {
  const id = Number(req.params.id)
  const existing: any = db.prepare('SELECT * FROM import_rules WHERE id = ?').get(id)
  if (!existing) return res.status(404).json({ error: 'Regla no encontrada' })
  const input = reglaPatch.parse(req.body)
  if (input.categoryId) {
    const categoria = db
      .prepare('SELECT id FROM categories WHERE id = ? AND profile_id = ?')
      .get(input.categoryId, existing.profile_id)
    if (!categoria) return res.status(400).json({ error: 'Esa categoría no es de este perfil' })
  }
  db.prepare('UPDATE import_rules SET pattern = ?, category_id = ?, position = ? WHERE id = ?').run(
    input.pattern ?? existing.pattern,
    input.categoryId ?? existing.category_id,
    input.position ?? existing.position,
    id,
  )
  res.json(reglaPorId(id))
})

router.delete('/reglas/:id', (req, res) => {
  const id = Number(req.params.id)
  const existing = db.prepare('SELECT id FROM import_rules WHERE id = ?').get(id)
  if (!existing) return res.status(404).json({ error: 'Regla no encontrada' })
  db.prepare('DELETE FROM import_rules WHERE id = ?').run(id)
  res.json({ ok: true })
})

// ── Categorías ────────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  const profileId = Number(req.query.profileId)
  if (!Number.isInteger(profileId) || profileId <= 0) {
    return res.status(400).json({ error: 'Falta profileId' })
  }
  res.json(listarCategorias(profileId))
})

router.post('/', (req, res) => {
  const input = categoryInput.parse(req.body)
  if (input.parentId) revisarPadre(input.profileId, input.kind, null, input.parentId)
  db.prepare(
    'INSERT OR IGNORE INTO categories (profile_id, name, kind, parent_id) VALUES (?, ?, ?, ?)',
  ).run(input.profileId, input.name, input.kind, input.parentId ?? null)
  const row = db
    .prepare(`${CATEGORY_SELECT} WHERE c.profile_id = ? AND c.name = ? AND c.kind = ?`)
    .get(input.profileId, input.name, input.kind)
  res.status(201).json(mapCategory(row))
})

router.patch('/:id', (req, res) => {
  const id = Number(req.params.id)
  const existing: any = db.prepare('SELECT * FROM categories WHERE id = ?').get(id)
  if (!existing) return res.status(404).json({ error: 'Categoría no encontrada' })
  const input = categoryPatch.parse(req.body)
  const name = input.name ?? existing.name

  const choque = db
    .prepare('SELECT id FROM categories WHERE profile_id = ? AND name = ? AND kind = ? AND id != ?')
    .get(existing.profile_id, name, existing.kind, id)
  if (choque) {
    return res.status(409).json({ error: `Ya existe una categoría de ${existing.kind} con ese nombre` })
  }

  // `parentId` ausente deja el padre como estaba; `null` explícito la saca y la
  // vuelve principal. Es la misma distinción de `role`, de las etiquetas y del
  // reparto: "no opiné" no es lo mismo que "quítalo".
  const parentId = input.parentId === undefined ? existing.parent_id : input.parentId
  if (parentId !== null && parentId !== existing.parent_id) {
    revisarPadre(existing.profile_id, existing.kind, id, parentId)
  }

  db.prepare(
    'UPDATE categories SET name = ?, role = ?, parent_id = ?, archived = ? WHERE id = ?',
  ).run(
    name,
    input.role === undefined ? existing.role : input.role,
    parentId,
    input.archived === undefined ? existing.archived : input.archived ? 1 : 0,
    id,
  )
  res.json(categoriaPorId(id))
})

/**
 * Borrar una categoría en uso obliga a decidir qué pasa con sus movimientos:
 * o se mueven a otra categoría (`?reassignTo=`) o se aceptan explícitamente
 * como "Sin categoría" (`?force=true`). Sin ninguna de las dos, 409 con la
 * cuenta, para que la interfaz pueda preguntar en vez de perder clasificación.
 *
 * Con sus **subcategorías** no se pregunta nada: se promueven a principales
 * (`ON DELETE SET NULL`). Borrar "Comida" no puede llevarse "Restaurante" con
 * su historial por delante, y reasignarlas al destino sería inventar una
 * jerarquía que el usuario no pidió. `reassignTo` siempre habló de movimientos.
 */
router.delete('/:id', (req, res) => {
  const id = Number(req.params.id)
  const existing: any = db.prepare('SELECT * FROM categories WHERE id = ?').get(id)
  if (!existing) return res.status(404).json({ error: 'Categoría no encontrada' })
  const { reassignTo, force } = categoryDeleteQuery.parse(req.query)

  const usage: any = db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM transactions WHERE category_id = ?)
            + (SELECT COUNT(*) FROM tx_splits WHERE category_id = ?) AS n`,
    )
    .get(id, id)

  if (reassignTo !== undefined) {
    if (reassignTo === id) throw httpError(400, 'La categoría destino es la misma')
    const destino: any = db
      .prepare('SELECT * FROM categories WHERE id = ? AND profile_id = ?')
      .get(reassignTo, existing.profile_id)
    if (!destino) throw httpError(400, 'La categoría destino no pertenece a este perfil')
    if (destino.kind !== existing.kind) {
      throw httpError(400, `La categoría destino es de ${destino.kind} y esta es de ${existing.kind}`)
    }
  } else if (usage.n > 0 && !force) {
    return res.status(409).json({
      error: `"${existing.name}" tiene ${usage.n} movimiento(s). Elige a dónde moverlos o confirma dejarlos sin categoría.`,
      txCount: usage.n,
    })
  }

  const presupuestos: any = db
    .prepare('SELECT COUNT(*) AS n FROM budgets WHERE category_id = ?')
    .get(id)
  const hijos: any = db
    .prepare('SELECT COUNT(*) AS n FROM categories WHERE parent_id = ?')
    .get(id)
  const reglas: any = db
    .prepare('SELECT COUNT(*) AS n FROM import_rules WHERE category_id = ?')
    .get(id)

  inTransaction(() => {
    if (reassignTo !== undefined) {
      db.prepare('UPDATE transactions SET category_id = ? WHERE category_id = ?').run(reassignTo, id)
      // Los renglones del reparto se mueven igual. Sin esto, la cascada de la
      // llave foránea los dejaría en nulo y el ticket perdería clasificación
      // aunque el usuario haya pedido explícitamente reasignar.
      db.prepare('UPDATE tx_splits SET category_id = ? WHERE category_id = ?').run(reassignTo, id)
    }
    // Los presupuestos de la categoría se van con ella: un tope sin categoría
    // no significa nada, y moverlos podría chocar con el tope que el destino ya
    // tenga en ese mes. Se informa cuántos para que la interfaz lo diga.
    db.prepare('DELETE FROM budgets WHERE category_id = ?').run(id)
    // Las subcategorías se promueven en vez de irse con ella. Lo hace la llave
    // foránea (`ON DELETE SET NULL`), pero se escribe aquí para que se lea.
    db.prepare('DELETE FROM categories WHERE id = ?').run(id)
  })

  res.json({
    ok: true,
    movimientosReasignados: reassignTo !== undefined ? usage.n : 0,
    movimientosSinCategoria: reassignTo === undefined ? usage.n : 0,
    presupuestosBorrados: presupuestos.n,
    hijosPromovidos: hijos.n,
    reglasBorradas: reglas.n,
  })
})

export default router
