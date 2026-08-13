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
import { db, dataDir, filasCrudas, httpError, inTransaction } from './db.ts'
import { SCHEMA_VERSION } from './migrations.ts'
import { esFechaReal } from '../shared/fechas.ts'
import type { HallazgoRespaldo, RevisionRespaldo } from '../shared/types.ts'
import { MAX_CENTAVOS } from '../shared/formato.ts'

/** Formato del archivo de respaldo. Sube si deja de ser compatible. */
const BACKUP_FORMAT = 1

/**
 * Orden de inserción: los padres antes que los hijos. Los movimientos van al
 * final porque referencian abonos y entradas de inversión.
 */
// ⚠ Al agregar una tabla al esquema hay que agregarla AQUÍ también, o el
// respaldo la pierde en silencio. Las tablas puente van después de sus dos
// extremos.
export const TABLES = [
  'profiles',
  // Los módulos van pegados al perfil, que es su único padre. Un respaldo
  // anterior a la Fase 9 no trae esta tabla y eso es inofensivo: sin filas,
  // cada perfil vuelve al juego por omisión de su tipo (`shared/modulos.ts`).
  'profile_modules',
  'accounts',
  'categories',
  // Las reglas de import apuntan a la categoría que proponen (Fase 23), así
  // que van justo detrás de ella.
  'import_rules',
  'tags',
  'debts',
  'debt_payments',
  'investments',
  'investment_entries',
  'goals',
  'goal_entries',
  // Los bienes van antes que los movimientos como todo lo demás, y después de
  // `debts` porque un bien puede apuntar a la deuda que lo financia.
  'assets',
  'asset_valuations',
  'budgets',
  // El tope de todo el mes es una tabla más, y una tabla que se olvide aquí
  // se pierde en cada respaldo sin decir nada.
  'budget_totals',
  // El catálogo de campos propios cuelga del perfil (Fase 21); sus **valores**
  // cuelgan del movimiento y por eso viven al final, con los demás hijos.
  'profile_fields',
  // Las plantillas apuntan a cuenta y categoría, así que van después de las dos
  // y antes de los movimientos, como todo lo demás.
  'tx_templates',
  'import_batches',
  // Una plantilla puede aportar a una inversión (Fase 24), que ya venía
  // arriba: la liga nueva no movió a nadie de lugar, pero es la tercera vez
  // que una columna nueva podía haberlo hecho.
  'recurrences',
  'recurrence_tags',
  // Las compras a meses van antes que los movimientos: el cargo que las ancla
  // las referencia.
  'msi_purchases',
  'msi_installments',
  // Contrapartes, centros y facturas van antes que los movimientos, porque el
  // cobro apunta a su factura. Y las tres tienen que estar aquí: una tabla que
  // se olvide en esta lista se pierde en cada respaldo sin avisar.
  'counterparties',
  'cost_centers',
  'invoices',
  // La nota de crédito cuelga de la factura y la plantilla apunta a la
  // contraparte y al centro; las tres van después de ellos y antes de los
  // movimientos, como todo lo demás.
  'invoice_credit_notes',
  'invoice_recurrences',
  // La cotización va **después** de `invoices` porque apunta a la factura que
  // salió de ella, y después de `cost_centers` por su centro. Antes de los
  // movimientos como todo lo demás.
  'quotes',
  // Los módulos de giro (Fase 15). El arrendamiento va después de `assets`
  // —renta un bien— y **antes de los movimientos**, que lo referencian: un
  // movimiento con `rental_id` no puede restaurarse sin su contrato. El
  // producto va aquí por simetría, antes de sus movimientos de existencias.
  'rentals',
  'products',
  'transactions',
  'transaction_tags',
  // Todo lo que cuelga del movimiento va después de él: el reparto por
  // categoría, el recibo y —aunque no cuelgue— el corte de conciliación, que
  // solo necesita su cuenta.
  'tx_splits',
  'tx_attachments',
  // Los valores de los campos propios: cuelgan del movimiento **y** del campo,
  // así que van después de los dos. Tabla puente sin columna `id`, como
  // `transaction_tags`: se vuelca por `rowid`.
  'tx_field_values',
  'account_statements',
  // ⚠ La libreta se mudó aquí en la Fase 20 y **tenía** que mudarse: desde la
  // migración 20 una nota puede apuntar al movimiento que explica, y estaba
  // listada arriba, antes de `transactions`. Restaurar habría reventado con
  // una llave foránea rota. Es exactamente lo que ya pasó con `rentals` en la
  // Fase 15: la lista está ordenada por dependencias y una columna nueva puede
  // cambiar de lugar una tabla vieja.
  'notes',
  // Los periodos resueltos van hasta el final: apuntan al movimiento asentado.
  'recurrence_runs',
  // Y los de facturas apuntan a la factura que salió de ellos.
  'invoice_recurrence_runs',
  // Estas dos van al final porque apuntan a movimientos y facturas.
  'stock_moves',
  'time_entries',
] as const

export interface Snapshot {
  finply: number
  schema: number
  exportedAt: string
  tables: Record<string, Record<string, unknown>[]>
}

/**
 * Tablas que **se referencian a sí mismas** y por eso no pueden volcarse por
 * `rowid` a secas: una fila tiene que salir después de aquella a la que apunta.
 *
 * `categories` estrenó `parent_id` en la Fase 23, y el orden de creación no
 * basta: si alguien crea "Restaurante", después crea "Comida" y **luego** cuelga
 * la primera de la segunda, el hijo tiene `rowid` menor que su padre. Volcarlo
 * en ese orden produce un respaldo que revienta al restaurarse, con una llave
 * foránea rota y sin que nadie lo note hasta que hace falta.
 *
 * Se ordena por dependencia y no se difiere la comprobación de llaves: así el
 * archivo queda bien ordenado **para cualquiera que lo lea**, no solo para la
 * restauración de Finply.
 */
const ORDEN_DE_VOLCADO: Record<string, string> = {
  categories: 'parent_id IS NOT NULL, rowid ASC',
}

/**
 * Un entero de SQLite que JavaScript no puede representar exacto, escrito
 * como texto. Es lo único que lo conserva **entero**: pasarlo a `Number` lo
 * redondea en silencio, que es peor que no poder leerlo.
 *
 * Lo lee de vuelta `revisarSnapshot`, que lo cuenta y lo aparta al restaurar.
 */
function sinBigInts(fila: Record<string, unknown>): Record<string, unknown> {
  const salida: Record<string, unknown> = {}
  for (const [columna, valor] of Object.entries(fila)) {
    if (typeof valor !== 'bigint') {
      salida[columna] = valor
      continue
    }
    const cabe =
      valor >= BigInt(Number.MIN_SAFE_INTEGER) && valor <= BigInt(Number.MAX_SAFE_INTEGER)
    salida[columna] = cabe ? Number(valor) : String(valor)
  }
  return salida
}

/**
 * Una tabla, y si el libro **ya** trae una cifra ilegible, la misma tabla con
 * esa cifra escrita como texto.
 *
 * Este es el otro lado del hallazgo 8, y el que quedó abierto: el techo
 * protege a los libros nuevos y la revisión a los restaurados, pero quien
 * escribió la cifra con una versión anterior seguía encerrado — la lectura
 * lanzaba `RangeError` y la exportación era justo la puerta que necesitaba.
 * Un libro del que no puedes salir no es tuyo.
 *
 * El reintento vive en `filasCrudas` porque las dos salidas —este respaldo y
 * el .zip de "llevarte tus datos"— tropezaban con lo mismo, y dos puertas que
 * deben abrir igual no pueden tener cada una su propio arreglo.
 */
function volcar(table: string, orden: string): Record<string, unknown>[] {
  const { filas, ilegibles } = filasCrudas(`SELECT * FROM ${table} ORDER BY ${orden}`)
  return ilegibles ? filas.map(sinBigInts) : filas
}

/** Vuelca todas las tablas —todos los perfiles— a un objeto plano. */
export function exportSnapshot(): Snapshot {
  const tables: Snapshot['tables'] = {}
  for (const table of TABLES) {
    // Por rowid, no por id: las tablas puente no tienen columna `id`.
    tables[table] = volcar(table, ORDEN_DE_VOLCADO[table] ?? 'rowid ASC')
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

/** Cuántos ejemplos se devuelven. Más que esto ya no es un aviso, es un volcado. */
const MAX_EJEMPLOS = 8

/**
 * Si una columna guarda una fecha de calendario. Se mira el **nombre**, que es
 * la convención del esquema entero: `date`, `due_date`, `start_date`,
 * `valid_until`, `paused_from`. Los `_at` quedan fuera a propósito: son marcas
 * de tiempo con hora, no días del calendario.
 */
function esColumnaDeFecha(nombre: string): boolean {
  if (nombre.endsWith('_at')) return false
  return (
    nombre === 'date' ||
    nombre.endsWith('_date') ||
    nombre === 'valid_until' ||
    nombre === 'paused_from' ||
    nombre === 'paused_until'
  )
}

/** Si una cifra de dinero es de las que el libro puede volver a leer. */
function montoLegible(valor: unknown): boolean {
  return (
    typeof valor === 'number' && Number.isSafeInteger(valor) && Math.abs(valor) <= MAX_CENTAVOS
  )
}

/**
 * Las columnas que la base guarda como entero, por tabla.
 *
 * Se le pregunta al esquema en vez de adivinar por el nombre. La diferencia
 * importa: un folio de factura es texto y puede ser una tirada larguísima de
 * dígitos perfectamente legítima —marcarlo por su forma lo habría apartado—,
 * mientras que `qty_milli` o `position` son enteros aunque no lo parezcan.
 */
function columnasEnteras(table: string): Set<string> {
  const info = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string; type: string }[]
  return new Set(info.filter((c) => c.type.toUpperCase() === 'INTEGER').map((c) => c.name))
}

/**
 * Los enteros que **no** son una magnitud: la llave de la fila y sus ligas.
 *
 * Quedan fuera de la revisión a propósito. Un id lo pone SQLite y no el
 * usuario, así que llegar a uno ilegible pediría nueve mil billones de filas;
 * y si alguna vez llegara, apartarlo en 1 lo estrellaría contra otra fila o
 * rompería la liga en silencio. Un id imposible tiene que fallar ruidosamente
 * al restaurar, que es lo que ya hace la comprobación de llaves foráneas.
 */
function esLlave(columna: string): boolean {
  return columna === 'id' || columna.endsWith('_id')
}

/**
 * Con cuánto se restaura una cifra que el libro no puede releer.
 *
 * **Un centavo, y no cero**, por una razón que no es de gusto: casi toda
 * columna de dinero del esquema lleva `CHECK (amount_cents > 0)`, así que un
 * cero haría que la restauración entera fallara con un 400 — y entonces el
 * usuario se quedaría sin su respaldo por querer protegerlo, que es exactamente
 * lo contrario de lo que se buscaba. Restaurar obedece las mismas reglas que
 * todo lo demás.
 *
 * Un centavo al lado de una cifra de verdad es inconfundible, y el informe trae
 * lo que decía para volver a escribirlo.
 */
const MONTO_ILEGIBLE = 1

/**
 * Revisa lo que el respaldo trae dentro **sin negarse a restaurarlo**, y de
 * paso deja sin efecto lo único que no se puede restaurar.
 *
 * La segunda vuelta de la auditoría dejó esto escrito como hueco conocido: la
 * restauración comprueba llaves foráneas y las reglas de la base, no el
 * calendario. Un archivo hecho antes del hallazgo 4 puede traer un `2026-02-30`
 * —que existe para el texto y no para la aritmética— y uno anterior al hallazgo
 * 8 puede traer una cifra que ninguna pantalla podrá volver a leer.
 *
 * La decisión de fondo no cambia, y es la que gobierna las dos ramas de abajo:
 * **negarse a restaurar el respaldo de alguien es peor que restaurarlo con un
 * renglón torcido.** Ese archivo puede ser lo único que le queda. Pero las dos
 * cosas no son iguales, y tratarlas igual sería el error:
 *
 *   · **La fecha se restaura tal cual.** El libro abre, los saldos cuadran y lo
 *     único que se pierde es ese renglón en los reportes del año. Cuál era la
 *     fecha de verdad solo lo sabe el usuario.
 *   · **La cifra ilegible no se restaura: entra en un centavo.** Aquí no hay
 *     elección que tomar. Se comprobó escribiéndola: la fila entra, y a partir
 *     de ahí ninguna lectura de esa cuenta contesta — **ni la exportación del
 *     respaldo siguiente**. Restaurarla tal cual sería devolverle al usuario un
 *     libro que no puede abrir y del que ya no puede sacar nada. La fila se
 *     conserva entera —su fecha, su concepto, su cuenta, sus ligas— y el valor
 *     original viaja en el informe para que lo vuelva a escribir. Por qué un
 *     centavo y no cero, en `MONTO_ILEGIBLE`.
 *
 * Muta `snapshot` a propósito: es el objeto que se va a insertar, y sanear en
 * una copia dejaría la puerta abierta a insertar el original por descuido.
 */
export function revisarSnapshot(snapshot: Snapshot): RevisionRespaldo {
  const revision: RevisionRespaldo = { fechas: 0, montos: 0, cifras: 0, ejemplos: [] }
  const apuntar = (h: HallazgoRespaldo) => {
    if (h.motivo === 'fecha') revision.fechas++
    else if (h.motivo === 'monto') revision.montos++
    else revision.cifras++
    if (revision.ejemplos.length < MAX_EJEMPLOS) revision.ejemplos.push(h)
  }

  for (const tabla of TABLES) {
    const filas = snapshot.tables[tabla] ?? []
    if (filas.length === 0) continue
    const enteras = columnasEnteras(tabla)
    for (const fila of filas) {
      for (const [columna, valor] of Object.entries(fila)) {
        if (valor === null || valor === undefined) continue
        if (esColumnaDeFecha(columna)) {
          if (typeof valor !== 'string' || !esFechaReal(valor)) {
            apuntar({ tabla, columna, valor: String(valor).slice(0, 40), motivo: 'fecha' })
          }
          continue
        }
        if (columna.endsWith('_cents')) {
          if (montoLegible(valor)) continue
          apuntar({ tabla, columna, valor: String(valor).slice(0, 40), motivo: 'monto' })
          fila[columna] = MONTO_ILEGIBLE
          continue
        }
        // Y las demás magnitudes enteras, que caen en la misma trampa sin ser
        // dinero: una cantidad de existencias basta para que el libro no abra.
        if (esLlave(columna) || !enteras.has(columna)) continue
        if (typeof valor === 'number' && Number.isSafeInteger(valor)) continue
        apuntar({ tabla, columna, valor: String(valor).slice(0, 40), motivo: 'cifra' })
        fila[columna] = MONTO_ILEGIBLE
      }
    }
  }
  return revision
}

/**
 * Las filas de una tabla, agrupadas por **qué columnas trae cada una**.
 *
 * Antes se miraba solo la primera fila y sus columnas decidían por todas, que
 * es correcto mientras el archivo sea homogéneo y una pérdida silenciosa en
 * cuanto deje de serlo: si al primer renglón le faltaba el concepto, la
 * columna se caía del INSERT y **todos los conceptos de la tabla se perdían**
 * sin un solo aviso. Y al revés —si la primera lo traía y otra no— se mandaba
 * `null` a una columna `NOT NULL` y reventaba la restauración entera.
 *
 * Agrupar arregla las dos: cada renglón entra con lo que trae, y una columna
 * ausente se **omite** en vez de mandarse nula, que es lo que deja a SQLite
 * aplicar su valor por omisión. Un archivo sano tiene una sola forma, así que
 * esto no cambia nada para él (R11: el número de consultas sigue sin depender
 * del tamaño del libro, solo de cuántas formas distintas traiga el archivo).
 *
 * `Object.hasOwn` y no `in`: lo heredado no es una columna del respaldo.
 */
function porForma(
  table: string,
  rows: Record<string, unknown>[],
): Map<string[], Record<string, unknown>[]> {
  const conocidas = columnsOf(table)
  const porClave = new Map<string, { columns: string[]; filas: Record<string, unknown>[] }>()
  for (const row of rows) {
    const columns = conocidas.filter((c) => Object.hasOwn(row, c))
    if (columns.length === 0) {
      throw httpError(400, `La tabla "${table}" del respaldo no trae ninguna columna conocida`)
    }
    const clave = columns.join(',')
    const grupo = porClave.get(clave) ?? { columns, filas: [] }
    grupo.filas.push(row)
    porClave.set(clave, grupo)
  }
  return new Map([...porClave.values()].map((g) => [g.columns, g.filas]))
}

/**
 * Reemplaza el contenido del libro por el del respaldo. Todo ocurre dentro de
 * una transacción: si el archivo trae una sola referencia rota, no se aplica
 * nada y el libro anterior sigue intacto.
 *
 * Antes de escribir nada pasa por `revisarSnapshot`, que además de contar lo
 * que viene torcido **deja en cero las cifras que el libro no puede releer**:
 * ver ahí por qué esa es la única de las dos que no se restaura tal cual.
 */
export function importSnapshot(raw: unknown): {
  restaurados: Record<string, number>
  revision: RevisionRespaldo
} {
  const snapshot = parseSnapshot(raw)
  const revision = revisarSnapshot(snapshot)
  const restaurados: Record<string, number> = {}

  inTransaction(() => {
    for (const table of [...TABLES].reverse()) {
      db.prepare(`DELETE FROM ${table}`).run()
    }
    for (const table of TABLES) {
      const rows = snapshot.tables[table] ?? []
      restaurados[table] = rows.length
      if (rows.length === 0) continue
      try {
        for (const [columns, filas] of porForma(table, rows)) {
          const insert = db.prepare(
            `INSERT INTO ${table} (${columns.join(', ')})
             VALUES (${columns.map(() => '?').join(', ')})`,
          )
          for (const row of filas) {
            insert.run(...columns.map((c) => (row[c] ?? null) as any))
          }
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

  return { restaurados, revision }
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
