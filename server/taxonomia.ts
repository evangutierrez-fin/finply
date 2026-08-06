// Categorías con jerarquía de un nivel y las reglas que proponen categoría al
// importar (Fase 23).
//
// **D25: un solo nivel.** Un padre no puede tener padre y un hijo no puede
// tener hijos. La regla no es estética: con profundidad conocida, el gasto por
// categoría sigue siendo un `GROUP BY` sobre una fila por hoja y el plegado al
// padre ocurre en JavaScript, sin una consulta de más. Con árbol libre, cada
// reporte necesitaría una CTE recursiva.
//
// Tres cosas se heredan del padre, y las tres se decidieron por el mismo
// motivo: **crear una subcategoría no puede mover una cifra en silencio** (R18).
//
//   · el **papel** del estado de resultados, si el hijo no tiene el suyo;
//   · el **tope** de un presupuesto, que cubre lo gastado en los hijos;
//   · el **archivado**, que se lleva el grupo entero del selector y lo devuelve
//     tal cual al desarchivar (R17: oculta, nunca borra).
//
// Lo que **no** se hereda es el nombre: el `UNIQUE (profile_id, name, kind)`
// sigue en pie y un nombre es único en todo el libro. Tres cosas dependen de
// eso —el import casa por nombre, la configuración exportable viaja por nombre
// y los reportes agrupan por nombre—, así que dos "Frutas" en dos padres
// distintos se sumarían solas.

import { db, httpError } from './db.ts'
import { normalizar } from './valores.ts'
import type { Category, ReglaImport } from '../shared/types.ts'

/**
 * El conteo suma los movimientos que apuntan a la categoría **y los renglones
 * de partidas divididas** que la usan: desde la Fase 10, una categoría puede
 * estar en uso sin que ninguna partida la lleve arriba, y borrarla sin
 * contarlos dejaría renglones sin clasificar en silencio.
 *
 * El `LEFT JOIN` al padre es uno solo y no recursivo, que es toda la ventaja de
 * haber cerrado D25 en un nivel.
 */
export const CATEGORY_SELECT = `
  SELECT c.*,
    p.name AS parent_name, p.role AS parent_role, p.archived AS parent_archived,
    (SELECT COUNT(*) FROM transactions t WHERE t.category_id = c.id)
    + (SELECT COUNT(*) FROM tx_splits s WHERE s.category_id = c.id) AS tx_count,
    (SELECT COUNT(*) FROM categories h WHERE h.parent_id = c.id) AS hijos
  FROM categories c
  LEFT JOIN categories p ON p.id = c.parent_id
`

export function mapCategory(row: any): Category {
  return {
    id: row.id,
    profileId: row.profile_id,
    name: row.name,
    kind: row.kind,
    role: row.role ?? null,
    // El papel que de verdad se aplica: el suyo, o el de su padre.
    rolEfectivo: row.role ?? row.parent_role ?? null,
    txCount: row.tx_count ?? 0,
    parentId: row.parent_id ?? null,
    parentName: row.parent_name ?? null,
    hijos: row.hijos ?? 0,
    archived: row.archived === 1,
    fueraDelSelector: row.archived === 1 || row.parent_archived === 1,
  }
}

/**
 * Las categorías de un perfil, padres antes que hijos y cada hijo detrás del
 * suyo. El orden lo hace la consulta y no la vista, porque lo usan el selector
 * del modal, la vista de Taxonomía y el CSV: tres lugares que tendrían que
 * ordenar igual.
 */
export function listarCategorias(profileId: number): Category[] {
  const filas: any[] = db
    .prepare(
      `${CATEGORY_SELECT} WHERE c.profile_id = ?
       ORDER BY c.kind, COALESCE(p.name, c.name), c.parent_id IS NOT NULL, c.name`,
    )
    .all(profileId)
  return filas.map(mapCategory)
}

export function categoriaPorId(id: number): Category | null {
  const row: any = db.prepare(`${CATEGORY_SELECT} WHERE c.id = ?`).get(id)
  return row ? mapCategory(row) : null
}

/**
 * ¿Puede esta categoría colgar de ese padre? Cuatro noes, y cada uno con su
 * mensaje: el padre tiene que existir en el mismo perfil, ser del mismo tipo,
 * no ser ella misma y **no ser ya hijo de otra** — ahí es donde vive D25.
 *
 * `id` es `null` al crear, porque todavía no hay categoría que comparar.
 */
export function revisarPadre(
  profileId: number,
  kind: string,
  id: number | null,
  parentId: number,
): void {
  if (id !== null && parentId === id) {
    throw httpError(400, 'Una categoría no puede colgar de sí misma')
  }
  const padre: any = db
    .prepare('SELECT * FROM categories WHERE id = ? AND profile_id = ?')
    .get(parentId, profileId)
  if (!padre) throw httpError(400, 'La categoría padre no pertenece a este perfil')
  if (padre.kind !== kind) {
    throw httpError(
      400,
      `"${padre.name}" es de ${padre.kind} y esta es de ${kind}: una subcategoría es del mismo tipo que su padre`,
    )
  }
  if (padre.parent_id !== null) {
    throw httpError(
      400,
      `"${padre.name}" ya cuelga de "${nombreDe(padre.parent_id)}". ` +
        'Finply lleva un solo nivel de subcategorías.',
    )
  }
  // Y al revés: la que tiene hijos no puede volverse hija. Sin esta mitad, el
  // segundo nivel entra por la puerta de atrás.
  if (id !== null) {
    const hijos: any = db.prepare('SELECT COUNT(*) AS n FROM categories WHERE parent_id = ?').get(id)
    if (hijos.n > 0) {
      throw httpError(
        400,
        `Esta categoría tiene ${hijos.n} subcategoría(s). Sácalas de aquí antes de colgarla de otra.`,
      )
    }
  }
}

function nombreDe(id: number): string {
  const row: any = db.prepare('SELECT name FROM categories WHERE id = ?').get(id)
  return row?.name ?? ''
}

// ── Reglas de import ──────────────────────────────────────────────────────

const REGLA_SELECT = `
  SELECT r.*, c.name AS category_name, c.kind AS category_kind
  FROM import_rules r
  JOIN categories c ON c.id = r.category_id
`

function mapRegla(row: any): ReglaImport {
  return {
    id: row.id,
    profileId: row.profile_id,
    pattern: row.pattern,
    categoryId: row.category_id,
    categoryName: row.category_name,
    categoryKind: row.category_kind,
    position: row.position,
  }
}

export function listarReglas(profileId: number): ReglaImport[] {
  const filas: any[] = db
    .prepare(`${REGLA_SELECT} WHERE r.profile_id = ? ORDER BY r.position ASC, r.id ASC`)
    .all(profileId)
  return filas.map(mapRegla)
}

export function reglaPorId(id: number): ReglaImport | null {
  const row: any = db.prepare(`${REGLA_SELECT} WHERE r.id = ?`).get(id)
  return row ? mapRegla(row) : null
}

/** Una regla lista para comparar: el patrón ya normalizado. */
export interface ReglaLista {
  pattern: string
  buscado: string
  categoryId: number
  categoryName: string
  categoryKind: string
}

/**
 * Las reglas de un perfil, en orden y con el patrón ya normalizado. Se piden
 * **una vez** por análisis: normalizar dentro del bucle de filas sería hacerlo
 * cinco mil veces por el mismo puñado de reglas.
 */
export function reglasListas(profileId: number): ReglaLista[] {
  return listarReglas(profileId).map((r) => ({
    pattern: r.pattern,
    buscado: normalizar(r.pattern),
    categoryId: r.categoryId,
    categoryName: r.categoryName,
    categoryKind: r.categoryKind,
  }))
}

/**
 * Qué regla propone algo para este concepto. Gana **la primera que case**, por
 * eso el orden es del usuario: la regla específica va arriba de la general.
 *
 * El tipo tiene que coincidir: una regla que apunta a una categoría de gasto no
 * dice nada de un ingreso, aunque el concepto case. Proponer una categoría del
 * tipo equivocado dejaría una fila que el propio validador rechaza al escribir.
 */
export function reglaQueCasa(
  reglas: ReglaLista[],
  concepto: string,
  tipo: string,
): ReglaLista | null {
  if (!concepto) return null
  const texto = normalizar(concepto)
  for (const regla of reglas) {
    if (regla.categoryKind !== tipo) continue
    if (texto.includes(regla.buscado)) return regla
  }
  return null
}
