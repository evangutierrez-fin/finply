// Respaldo y restauración del libro completo.
//
// Dos mecanismos distintos y complementarios:
//
// 1. Export/import en JSON — legible, versionable y a prueba de cambios de
//    esquema: lo que descargas puedes abrirlo con cualquier editor.
// 2. Instantáneas .db rotativas al arrancar — copia fiel hecha por el propio
//    SQLite (VACUUM INTO), que protege contra un borrado accidental de data/.

import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { db, dataDir, httpError, inTransaction } from './db.ts'
import { SCHEMA_VERSION } from './migrations.ts'

/** Formato del archivo de respaldo. Sube si deja de ser compatible. */
const BACKUP_FORMAT = 1

/**
 * Orden de inserción: los padres antes que los hijos. Los movimientos van al
 * final porque referencian abonos y entradas de inversión.
 */
// ⚠ Al agregar una tabla al esquema hay que agregarla AQUÍ también, o el
// respaldo la pierde en silencio. Las tablas puente van después de sus dos
// extremos.
const TABLES = [
  'profiles',
  'accounts',
  'categories',
  'tags',
  'debts',
  'debt_payments',
  'investments',
  'investment_entries',
  'goals',
  'goal_entries',
  'budgets',
  'notes',
  'import_batches',
  // Las compras a meses van antes que los movimientos: el cargo que las ancla
  // las referencia.
  'msi_purchases',
  'msi_installments',
  'transactions',
  'transaction_tags',
] as const

export interface Snapshot {
  finply: number
  schema: number
  exportedAt: string
  tables: Record<string, Record<string, unknown>[]>
}

/** Vuelca todas las tablas —todos los perfiles— a un objeto plano. */
export function exportSnapshot(): Snapshot {
  const tables: Snapshot['tables'] = {}
  for (const table of TABLES) {
    // Por rowid, no por id: las tablas puente no tienen columna `id`.
    tables[table] = db.prepare(`SELECT * FROM ${table} ORDER BY rowid ASC`).all() as Record<
      string,
      unknown
    >[]
  }
  return {
    finply: BACKUP_FORMAT,
    schema: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    tables,
  }
}

function columnsOf(table: string): string[] {
  const info = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  return info.map((c) => c.name)
}

/** Revisa que el archivo tenga la forma esperada antes de tocar nada. */
function parseSnapshot(raw: unknown): Snapshot {
  if (typeof raw !== 'object' || raw === null) {
    throw httpError(400, 'El archivo de respaldo no es un objeto JSON')
  }
  const data = raw as Partial<Snapshot>
  if (data.finply !== BACKUP_FORMAT) {
    throw httpError(
      400,
      `Este archivo no es un respaldo de Finply, o es de un formato distinto (${String(data.finply)})`,
    )
  }
  if (typeof data.schema !== 'number' || data.schema > SCHEMA_VERSION) {
    throw httpError(
      400,
      'El respaldo viene de una versión más nueva de Finply. Actualiza antes de restaurar.',
    )
  }
  if (typeof data.tables !== 'object' || data.tables === null) {
    throw httpError(400, 'El respaldo no trae tablas')
  }
  for (const table of TABLES) {
    const rows = data.tables[table]
    if (rows === undefined) continue
    if (!Array.isArray(rows)) throw httpError(400, `La tabla "${table}" del respaldo no es una lista`)
    if (rows.some((r) => typeof r !== 'object' || r === null || Array.isArray(r))) {
      throw httpError(400, `La tabla "${table}" del respaldo trae registros con forma inválida`)
    }
  }
  return data as Snapshot
}

/**
 * Reemplaza el contenido del libro por el del respaldo. Todo ocurre dentro de
 * una transacción: si el archivo trae una sola referencia rota, no se aplica
 * nada y el libro anterior sigue intacto.
 */
export function importSnapshot(raw: unknown): { restaurados: Record<string, number> } {
  const snapshot = parseSnapshot(raw)
  const restaurados: Record<string, number> = {}

  inTransaction(() => {
    for (const table of [...TABLES].reverse()) {
      db.prepare(`DELETE FROM ${table}`).run()
    }
    for (const table of TABLES) {
      const rows = snapshot.tables[table] ?? []
      restaurados[table] = rows.length
      if (rows.length === 0) continue
      // Solo se copian las columnas que esta versión conoce: un respaldo viejo
      // al que le falte una columna nueva toma el valor por omisión.
      const columns = columnsOf(table).filter((c) => c in rows[0]!)
      if (columns.length === 0) {
        throw httpError(400, `La tabla "${table}" del respaldo no trae ninguna columna conocida`)
      }
      const insert = db.prepare(
        `INSERT INTO ${table} (${columns.join(', ')})
         VALUES (${columns.map(() => '?').join(', ')})`,
      )
      try {
        for (const row of rows) {
          insert.run(...columns.map((c) => (row[c] ?? null) as any))
        }
      } catch (err) {
        // Referencias rotas, montos negativos, tipos fuera del catálogo: el
        // archivo está mal, no Finply. Que el usuario lea qué tabla falló.
        throw httpError(
          400,
          `El respaldo trae datos que la base rechaza en "${table}": ${(err as Error).message}`,
        )
      }
    }
    const broken = db.prepare('PRAGMA foreign_key_check').all()
    if (broken.length > 0) {
      throw httpError(400, `El respaldo tiene ${broken.length} referencia(s) rota(s)`)
    }
  })

  return { restaurados }
}

const SNAPSHOT_DIR = path.join(dataDir, 'respaldos')
const KEEP_SNAPSHOTS = 7

/**
 * Deja una copia .db del día en data/respaldos y conserva las últimas
 * KEEP_SNAPSHOTS. Nunca interrumpe el arranque: si falla, solo avisa.
 */
export function writeRotatingSnapshot(): string | null {
  try {
    mkdirSync(SNAPSHOT_DIR, { recursive: true })
    const day = new Date().toISOString().slice(0, 10)
    const target = path.join(SNAPSHOT_DIR, `finply-${day}.db`)
    if (!existsSync(target)) {
      db.prepare('VACUUM INTO ?').run(target)
    }

    const previous = readdirSync(SNAPSHOT_DIR)
      .filter((f) => f.startsWith('finply-') && f.endsWith('.db'))
      .map((f) => path.join(SNAPSHOT_DIR, f))
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
    for (const stale of previous.slice(KEEP_SNAPSHOTS)) unlinkSync(stale)

    return target
  } catch (err) {
    console.error('[finply] no se pudo escribir el respaldo automático:', (err as Error).message)
    return null
  }
}
