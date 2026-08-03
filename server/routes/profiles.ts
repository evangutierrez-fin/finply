import { Router } from 'express'
import { db, guardarModulos, inTransaction, mapProfile, seedCategories } from '../db.ts'
import { resolverModulos } from '../../shared/modulos.ts'
import { profileInput, profilePatch } from '../validators.ts'

const router = Router()

router.get('/', (_req, res) => {
  const rows: any[] = db.prepare('SELECT * FROM profiles ORDER BY created_at ASC, id ASC').all()
  // Los overrides de todos los perfiles en **una** consulta, no una por perfil
  // (R11). Son pocos perfiles, pero la forma correcta cuesta lo mismo.
  const overrides = new Map<number, Map<string, boolean>>()
  for (const f of db.prepare('SELECT profile_id, module, enabled FROM profile_modules').all() as any[]) {
    const porPerfil = overrides.get(f.profile_id) ?? new Map<string, boolean>()
    porPerfil.set(String(f.module), f.enabled === 1)
    overrides.set(f.profile_id, porPerfil)
  }
  res.json(rows.map((row) => mapProfile(row, resolverModulos(row.kind, overrides.get(row.id) ?? new Map()))))
})

router.post('/', (req, res) => {
  const input = profileInput.parse(req.body)
  const id = inTransaction(() => {
    const result = db
      .prepare(
        `INSERT INTO profiles (name, kind, accent, accent_hex, accent_hex_dark, dimension_label)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.name,
        input.kind,
        input.accent,
        input.accentHex ?? null,
        input.accentHexDark ?? null,
        input.dimensionLabel,
      )
    const nuevo = Number(result.lastInsertRowid)
    seedCategories(nuevo, input.kind)
    // Sin `modules` no se escribe una sola fila: el perfil queda con el juego
    // por omisión de su tipo, que es como nacían todos antes de esta fase.
    if (input.modules) guardarModulos(nuevo, input.modules)
    return nuevo
  })
  const row = db.prepare('SELECT * FROM profiles WHERE id = ?').get(id)
  res.status(201).json(mapProfile(row))
})

router.patch('/:id', (req, res) => {
  const id = Number(req.params.id)
  const input = profilePatch.parse(req.body)
  const existing: any = db.prepare('SELECT * FROM profiles WHERE id = ?').get(id)
  if (!existing) return res.status(404).json({ error: 'Perfil no encontrado' })
  // La tinta distingue "no opiné" de "quítala", igual que las etiquetas de un
  // movimiento: ausente la deja como estaba, `null` explícito vuelve al preset.
  // Las preferencias de la Fase 21 siguen exactamente la misma regla, y por eso
  // guardar los módulos desde otro formulario no le borra el orden del lomo.
  const orden =
    input.navOrder === undefined
      ? existing.nav_order
      : input.navOrder === null || input.navOrder.length === 0
        ? null
        : input.navOrder.join(',')
  db.prepare(
    `UPDATE profiles SET name = ?, kind = ?, accent = ?, accent_hex = ?, accent_hex_dark = ?,
       dimension_label = ?, nav_order = ?, home_view = ?, date_format = ?, week_start = ?,
       hide_cents = ? WHERE id = ?`,
  ).run(
    input.name ?? existing.name,
    input.kind ?? existing.kind,
    input.accent ?? existing.accent,
    input.accentHex === undefined ? existing.accent_hex : input.accentHex,
    input.accentHexDark === undefined ? existing.accent_hex_dark : input.accentHexDark,
    input.dimensionLabel ?? existing.dimension_label,
    orden,
    input.homeView === undefined ? existing.home_view : input.homeView,
    input.dateFormat === undefined ? existing.date_format : input.dateFormat,
    input.weekStart === undefined ? existing.week_start : input.weekStart,
    input.hideCents === undefined ? existing.hide_cents : input.hideCents ? 1 : 0,
    id,
  )
  // Misma convención que la tinta: ausente no opina, presente manda. Un
  // arreglo vacío apaga todo, y R17 se encarga de que eso no pierda un dato.
  if (input.modules) guardarModulos(id, input.modules)
  const row = db.prepare('SELECT * FROM profiles WHERE id = ?').get(id)
  res.json(mapProfile(row))
})

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id)
  const existing = db.prepare('SELECT id FROM profiles WHERE id = ?').get(id)
  if (!existing) return res.status(404).json({ error: 'Perfil no encontrado' })
  // Borrado en orden explícito (hijos antes que padres): el orden de las
  // cascadas de SQLite no está garantizado entre versiones.
  inTransaction(() => {
    db.prepare('DELETE FROM transactions WHERE profile_id = ?').run(id)
    db.prepare(
      'DELETE FROM debt_payments WHERE debt_id IN (SELECT id FROM debts WHERE profile_id = ?)',
    ).run(id)
    db.prepare('DELETE FROM debts WHERE profile_id = ?').run(id)
    db.prepare(
      'DELETE FROM investment_entries WHERE investment_id IN (SELECT id FROM investments WHERE profile_id = ?)',
    ).run(id)
    db.prepare('DELETE FROM investments WHERE profile_id = ?').run(id)
    db.prepare(
      'DELETE FROM goal_entries WHERE goal_id IN (SELECT id FROM goals WHERE profile_id = ?)',
    ).run(id)
    db.prepare('DELETE FROM goals WHERE profile_id = ?').run(id)
    db.prepare('DELETE FROM budgets WHERE profile_id = ?').run(id)
    db.prepare('DELETE FROM notes WHERE profile_id = ?').run(id)
    db.prepare('DELETE FROM invoices WHERE profile_id = ?').run(id)
    db.prepare('DELETE FROM counterparties WHERE profile_id = ?').run(id)
    db.prepare('DELETE FROM cost_centers WHERE profile_id = ?').run(id)
    db.prepare('DELETE FROM tx_templates WHERE profile_id = ?').run(id)
    db.prepare('DELETE FROM profile_fields WHERE profile_id = ?').run(id)
    db.prepare('DELETE FROM categories WHERE profile_id = ?').run(id)
    db.prepare('DELETE FROM accounts WHERE profile_id = ?').run(id)
    db.prepare('DELETE FROM profile_modules WHERE profile_id = ?').run(id)
    db.prepare('DELETE FROM profiles WHERE id = ?').run(id)
  })
  res.json({ ok: true })
})

export default router
