// Campos propios y plantillas de movimiento (Fase 21).
//
// Dos catálogos por perfil, los dos de configuración y ninguno de dinero: aquí
// no se asienta nada, no se mueve un saldo y no se toca una cifra. Lo que se
// escribe con ellos —el valor de un campo, el movimiento que sale de una
// plantilla— pasa por el mismo `POST /api/transactions` de siempre.

import { Router } from 'express'
import { db, ensureAccount, ensureCategory, httpError } from '../db.ts'
import {
  campoPorId,
  listarCampos,
  listarPlantillas,
  plantillaPorId,
  siguientePosicion,
} from '../personalizacion.ts'
import { aplicarConfig, exportarConfig } from '../config-perfil.ts'
import { campoInput, campoPatch, plantillaTxInput, plantillaTxPatch } from '../validators.ts'

const router = Router()

function perfilDe(req: any): number {
  const profileId = Number(req.query.profileId)
  if (!Number.isInteger(profileId) || profileId <= 0) {
    throw httpError(400, 'Falta profileId')
  }
  return profileId
}

// ── Campos propios ────────────────────────────────────────────────────────

router.get('/campos', (req, res) => {
  res.json(listarCampos(perfilDe(req)))
})

router.post('/campos', (req, res) => {
  const input = campoInput.parse(req.body)
  const result = db
    .prepare(
      `INSERT INTO profile_fields (profile_id, label, kind, options, position)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      input.profileId,
      input.label,
      input.kind,
      input.options,
      input.position ?? siguientePosicion('profile_fields', input.profileId),
    )
  res.status(201).json(campoPorId(input.profileId, Number(result.lastInsertRowid)))
})

/**
 * Corregir un campo. El **tipo no se cambia**: los valores ya guardados se
 * validaron contra el tipo viejo, y pasar de texto a número dejaría respuestas
 * que el propio validador rechaza al escribir — el mismo estado imposible que
 * dejó el `rental_role` huérfano de la Fase 18. Quien se equivocó de tipo
 * archiva el campo y hace otro.
 */
router.patch('/campos/:id', (req, res) => {
  const profileId = perfilDe(req)
  const actual = campoPorId(profileId, Number(req.params.id))
  const input = campoPatch.parse(req.body)
  if (input.kind && input.kind !== actual.kind && actual.usos > 0) {
    throw httpError(
      409,
      `"${actual.label}" ya tiene ${actual.usos} respuestas guardadas con su tipo de hoy: ` +
        'archívalo y crea otro en vez de cambiárselo debajo.',
    )
  }
  db.prepare(
    `UPDATE profile_fields SET label = ?, kind = ?, options = ?, position = ?, archived = ?
     WHERE id = ? AND profile_id = ?`,
  ).run(
    input.label ?? actual.label,
    input.kind ?? actual.kind,
    input.options ?? actual.options,
    input.position ?? actual.position,
    input.archived === undefined ? (actual.archived ? 1 : 0) : input.archived ? 1 : 0,
    actual.id,
    profileId,
  )
  res.json(campoPorId(profileId, actual.id))
})

/**
 * Borrar un campo **se lleva sus respuestas**, y por eso la respuesta dice
 * cuántas eran: un aviso que no las cuenta miente por omisión. Archivar es la
 * salida para quien solo quiere dejar de verlo (R17).
 */
router.delete('/campos/:id', (req, res) => {
  const profileId = perfilDe(req)
  const campo = campoPorId(profileId, Number(req.params.id))
  db.prepare('DELETE FROM profile_fields WHERE id = ? AND profile_id = ?').run(campo.id, profileId)
  res.json({ ok: true, respuestas: campo.usos })
})

// ── Plantillas de movimiento ──────────────────────────────────────────────

router.get('/plantillas', (req, res) => {
  res.json(listarPlantillas(perfilDe(req)))
})

/** Cuenta y categoría tienen que ser del mismo libro, como en un movimiento. */
function revisarReferencias(input: {
  profileId: number
  type: 'ingreso' | 'gasto' | 'transferencia'
  accountId?: number | null
  transferAccountId?: number | null
  categoryId?: number | null
}): void {
  if (input.accountId) ensureAccount(input.profileId, input.accountId)
  if (input.transferAccountId) ensureAccount(input.profileId, input.transferAccountId)
  // La categoría se valida contra el tipo, igual que en un movimiento: una
  // plantilla de gasto con categoría de ingreso produciría partidas que suman
  // del lado contrario.
  if (input.categoryId && input.type !== 'transferencia') {
    ensureCategory(input.profileId, input.categoryId, input.type)
  }
}

router.post('/plantillas', (req, res) => {
  const input = plantillaTxInput.parse(req.body)
  revisarReferencias(input)
  const result = db
    .prepare(
      `INSERT INTO tx_templates
        (profile_id, name, type, account_id, transfer_account_id, category_id, amount_cents, note, position)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.profileId,
      input.name,
      input.type,
      input.accountId ?? null,
      input.type === 'transferencia' ? (input.transferAccountId ?? null) : null,
      input.type === 'transferencia' ? null : (input.categoryId ?? null),
      input.amountCents ?? null,
      input.note,
      input.position ?? siguientePosicion('tx_templates', input.profileId),
    )
  res.status(201).json(plantillaPorId(input.profileId, Number(result.lastInsertRowid)))
})

router.patch('/plantillas/:id', (req, res) => {
  const profileId = perfilDe(req)
  const actual = plantillaPorId(profileId, Number(req.params.id))
  const input = plantillaTxPatch.parse(req.body)
  const type = input.type ?? actual.type
  const accountId = input.accountId === undefined ? actual.accountId : input.accountId
  const transferAccountId =
    input.transferAccountId === undefined ? actual.transferAccountId : input.transferAccountId
  const categoryId = input.categoryId === undefined ? actual.categoryId : input.categoryId
  revisarReferencias({ profileId, type, accountId, transferAccountId, categoryId })
  db.prepare(
    `UPDATE tx_templates SET name = ?, type = ?, account_id = ?, transfer_account_id = ?,
       category_id = ?, amount_cents = ?, note = ?, position = ?
     WHERE id = ? AND profile_id = ?`,
  ).run(
    input.name ?? actual.name,
    type,
    accountId,
    type === 'transferencia' ? transferAccountId : null,
    type === 'transferencia' ? null : categoryId,
    input.amountCents === undefined ? actual.amountCents : input.amountCents,
    input.note ?? actual.note,
    input.position ?? actual.position,
    actual.id,
    profileId,
  )
  res.json(plantillaPorId(profileId, actual.id))
})

/**
 * Borrar una plantilla **no toca un solo movimiento**. Lo que se asentó con
 * ella ya es del libro: la plantilla solo llenó el formulario, y quitarla no
 * puede deshacer lo que el usuario confirmó. Por eso tampoco hay una liga que
 * mantener, a diferencia de una recurrencia.
 */
router.delete('/plantillas/:id', (req, res) => {
  const profileId = perfilDe(req)
  const plantilla = plantillaPorId(profileId, Number(req.params.id))
  db.prepare('DELETE FROM tx_templates WHERE id = ? AND profile_id = ?').run(plantilla.id, profileId)
  res.json({ ok: true })
})

// ── La configuración del perfil, sin sus datos ────────────────────────────

/**
 * Bájate cómo está montado este libro. Sin una sola cifra: qué secciones lleva,
 * su tinta, su formato, sus categorías, sus campos propios y sus plantillas.
 */
router.get('/config', (req, res) => {
  const profileId = perfilDe(req)
  const config = exportarConfig(profileId)
  const dia = new Date().toISOString().slice(0, 10)
  const nombre = config.origen.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase()
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="finply-config-${nombre}-${dia}.json"`)
  res.send(JSON.stringify(config, null, 2))
})

/**
 * Aplícasela a otro libro. **Aditivo y nunca destructivo**: crea lo que falta,
 * respeta lo que ya está y no toca un solo movimiento. Lo único que se
 * sobrescribe son las preferencias del perfil, que es lo que se venía a copiar.
 */
router.post('/config', (req, res) => {
  const profileId = perfilDe(req)
  res.json(aplicarConfig(profileId, req.body))
})

export default router
