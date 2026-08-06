// Campos propios y plantillas de movimiento. La Fase 21, del lado del servidor.
//
// **D24 se resolvió en llave-valor** (ver la migración 21): el catálogo de
// campos vive en `profile_fields` y los valores en `tx_field_values`, uno por
// (movimiento, campo). Un campo por perfil no puede ser una columna —cada libro
// pediría su migración, y eso choca de frente con R1—.
//
// La consecuencia que hay que tener presente: **un campo propio no suma**. Se
// ve, se edita, se busca con los ojos y se exporta, pero ningún reporte lo
// agrega. Es lo que la propia D24 dejó escrito, y de paso lo que impide que un
// dato que Finply no entiende mueva una cifra que sí entiende (R18).

import { db, httpError } from './db.ts'
import type { CampoPropio, PlantillaTx, TipoCampo } from '../shared/types.ts'

// ── Campos propios ────────────────────────────────────────────────────────

function mapCampo(row: any): CampoPropio {
  return {
    id: row.id,
    profileId: row.profile_id,
    label: row.label,
    kind: row.kind,
    options: row.options ?? '',
    position: row.position,
    archived: row.archived === 1,
    usos: row.usos ?? 0,
  }
}

/**
 * El catálogo del perfil, con **cuántos movimientos usa cada campo**.
 *
 * El conteo va en la misma consulta y no en una por campo (R11), y existe para
 * que borrar pueda decir qué se lleva por delante: un campo con 300 respuestas
 * no se borra con la misma ligereza que uno que nadie contestó.
 */
export function listarCampos(profileId: number, incluirArchivados = true): CampoPropio[] {
  const rows = db
    .prepare(
      `SELECT f.*, (SELECT COUNT(*) FROM tx_field_values v WHERE v.field_id = f.id) AS usos
       FROM profile_fields f
       WHERE f.profile_id = ? ${incluirArchivados ? '' : 'AND f.archived = 0'}
       ORDER BY f.position ASC, f.id ASC`,
    )
    .all(profileId) as any[]
  return rows.map(mapCampo)
}

export function campoPorId(profileId: number, id: number): CampoPropio {
  const row = db
    .prepare(
      `SELECT f.*, (SELECT COUNT(*) FROM tx_field_values v WHERE v.field_id = f.id) AS usos
       FROM profile_fields f WHERE f.id = ? AND f.profile_id = ?`,
    )
    .get(id, profileId)
  if (!row) throw httpError(404, 'Ese campo no existe en este perfil')
  return mapCampo(row)
}

/** Las opciones de una lista, ya limpias. Vacío en cualquier otro tipo. */
export function opcionesDe(campo: { kind: TipoCampo; options: string }): string[] {
  if (campo.kind !== 'lista') return []
  return campo.options
    .split('\n')
    .map((o) => o.trim())
    .filter(Boolean)
}

/**
 * Valida el valor de un campo contra su tipo y lo devuelve **normalizado**.
 *
 * Es lo único que hace que un campo propio sea un campo y no texto libre con
 * etiqueta: un 'numero' que acepta "como tres mil" no sirve para nada, y una
 * 'lista' que acepta cualquier cosa no es una lista. Vacío siempre se acepta —
 * un campo propio nunca es obligatorio: quien lo inventó puede no saberlo
 * todavía cuando registra la partida.
 */
export function normalizarValor(campo: CampoPropio, valor: string): string {
  const v = valor.trim()
  if (v === '') return ''
  switch (campo.kind) {
    case 'numero': {
      // Se guarda como texto porque la tabla es llave-valor; lo que se valida
      // es que sea un número, para que exportarlo o leerlo tenga sentido.
      const limpio = v.replace(/[,\s]/g, '')
      if (!/^-?\d+(\.\d+)?$/.test(limpio)) {
        throw httpError(400, `"${campo.label}" espera un número`)
      }
      return limpio
    }
    case 'fecha':
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
        throw httpError(400, `"${campo.label}" espera una fecha (AAAA-MM-DD)`)
      }
      return v
    case 'casilla':
      // Una casilla solo tiene dos estados, y "no" se guarda como ausencia:
      // media base llena de "no" es media base de nada.
      return v === 'si' || v === 'sí' || v === 'true' || v === '1' ? 'si' : ''
    case 'lista': {
      const opciones = opcionesDe(campo)
      if (opciones.length > 0 && !opciones.includes(v)) {
        throw httpError(400, `"${v}" no es una de las opciones de "${campo.label}"`)
      }
      return v
    }
    default:
      return v.slice(0, 200)
  }
}

/**
 * Reemplaza los valores propios de un movimiento. Llamar dentro de una
 * transacción, como `setTxSplits`.
 *
 * Un valor vacío **borra la fila** en vez de guardar una cadena vacía: "no
 * contesté" y "contesté que nada" son la misma cosa, y guardarlas distinto
 * dejaría la tabla llena de filas que no dicen nada.
 */
export function setCamposDeTx(
  profileId: number,
  txId: number,
  valores: Record<string, string>,
): void {
  const campos = new Map(listarCampos(profileId).map((c) => [c.id, c]))
  const borrar = db.prepare('DELETE FROM tx_field_values WHERE tx_id = ? AND field_id = ?')
  const guardar = db.prepare(
    `INSERT INTO tx_field_values (tx_id, field_id, value) VALUES (?, ?, ?)
     ON CONFLICT (tx_id, field_id) DO UPDATE SET value = excluded.value`,
  )
  for (const [clave, crudo] of Object.entries(valores)) {
    const campo = campos.get(Number(clave))
    if (!campo) throw httpError(400, 'Ese campo propio no pertenece a este perfil')
    const valor = normalizarValor(campo, String(crudo ?? ''))
    if (valor === '') borrar.run(txId, campo.id)
    else guardar.run(txId, campo.id, valor)
  }
}

/** Los valores propios de varios movimientos, en **una** consulta (R11). */
export function attachCampos(
  txs: { id: number; fields: Record<string, string> }[],
): void {
  if (txs.length === 0) return
  const ids = txs.map((t) => t.id)
  const rows = db
    .prepare(
      `SELECT tx_id, field_id, value FROM tx_field_values
       WHERE tx_id IN (${ids.map(() => '?').join(',')})`,
    )
    .all(...ids) as any[]
  const porTx = new Map<number, Record<string, string>>()
  for (const r of rows) {
    const actual = porTx.get(r.tx_id) ?? {}
    actual[String(r.field_id)] = r.value
    porTx.set(r.tx_id, actual)
  }
  for (const tx of txs) tx.fields = porTx.get(tx.id) ?? {}
}

// ── Plantillas de movimiento ──────────────────────────────────────────────

function mapPlantilla(row: any): PlantillaTx {
  return {
    id: row.id,
    profileId: row.profile_id,
    name: row.name,
    type: row.type,
    accountId: row.account_id ?? null,
    accountName: row.account_name ?? null,
    transferAccountId: row.transfer_account_id ?? null,
    transferAccountName: row.transfer_account_name ?? null,
    categoryId: row.category_id ?? null,
    categoryName: row.category_name ?? null,
    amountCents: row.amount_cents ?? null,
    note: row.note,
    position: row.position,
  }
}

/**
 * Las plantillas con los nombres ya resueltos, en una consulta.
 *
 * Los `LEFT JOIN` son a propósito: archivar la cuenta de una plantilla o borrar
 * su categoría la deja **coja pero viva** (`ON DELETE SET NULL`), y la vista lo
 * enseña en vez de callarlo. Borrar la plantilla por eso sería tirar el nombre
 * y el concepto que el usuario ya había escrito.
 */
export function listarPlantillas(profileId: number): PlantillaTx[] {
  const rows = db
    .prepare(
      `SELECT p.*, a.name AS account_name, d.name AS transfer_account_name, c.name AS category_name
       FROM tx_templates p
       LEFT JOIN accounts a ON a.id = p.account_id
       LEFT JOIN accounts d ON d.id = p.transfer_account_id
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.profile_id = ?
       ORDER BY p.position ASC, p.id ASC`,
    )
    .all(profileId) as any[]
  return rows.map(mapPlantilla)
}

export function plantillaPorId(profileId: number, id: number): PlantillaTx {
  const row = db
    .prepare(
      `SELECT p.*, a.name AS account_name, d.name AS transfer_account_name, c.name AS category_name
       FROM tx_templates p
       LEFT JOIN accounts a ON a.id = p.account_id
       LEFT JOIN accounts d ON d.id = p.transfer_account_id
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.id = ? AND p.profile_id = ?`,
    )
    .get(id, profileId)
  if (!row) throw httpError(404, 'Esa plantilla no existe en este perfil')
  return mapPlantilla(row)
}

/** El siguiente lugar de la lista, para que lo nuevo caiga al final. */
export function siguientePosicion(tabla: 'profile_fields' | 'tx_templates', profileId: number): number {
  const row: any = db
    .prepare(`SELECT COALESCE(MAX(position), -1) + 1 AS n FROM ${tabla} WHERE profile_id = ?`)
    .get(profileId)
  return row.n as number
}
