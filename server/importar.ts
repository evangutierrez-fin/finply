// Importación de movimientos desde CSV.
//
// Regla de la fase (R8): importar nunca escribe a medias. Se analiza primero
// —sin tocar la base— se devuelve un informe fila por fila, y solo cuando el
// usuario confirma se escribe todo dentro de una transacción, atado a un lote
// que se puede deshacer completo.
//
// Fechas y montos vienen de un archivo ajeno, así que ambos son ambiguos:
// 03/04/2026 puede ser marzo o abril, y 1,234 puede ser mil o uno. Aquí se
// decide con reglas explícitas y el informe muestra **el valor interpretado**
// para que el usuario cache el error antes de escribir nada.

import { createHash } from 'node:crypto'
import type {
  CampoImport as Campo, EstadoFila, FilaAnalizada, InformeImport as Informe,
  LoteImport as Lote, MapeoImport as Mapeo, ResultadoImport as Resultado,
} from '../shared/types.ts'
import { normalizar, parseFecha, parseMonto } from './valores.ts'
import { db, httpError, inTransaction } from './db.ts'
import { detectarSeparador, parseCsv } from './csv.ts'

export const MAX_FILAS = 5000

export type { Campo, EstadoFila, FilaAnalizada, Informe, Lote, Mapeo, Resultado }
export { parseFecha, parseMonto } from './valores.ts'

/** Nombres de columna que se reconocen solos, en minúsculas y sin acentos. */
const ALIAS: Record<Campo, string[]> = {
  fecha: ['fecha', 'date', 'fecha operacion', 'fecha de operacion', 'f operacion', 'dia'],
  monto: ['monto', 'importe', 'amount', 'cantidad', 'valor'],
  cargo: ['cargo', 'cargos', 'debito', 'debe', 'retiro', 'egreso'],
  abono: ['abono', 'abonos', 'credito', 'haber', 'deposito', 'ingreso'],
  tipo: ['tipo', 'type', 'movimiento'],
  cuenta: ['cuenta', 'account', 'cuenta origen'],
  cuentaDestino: ['cuenta destino', 'cuenta_destino', 'destino', 'a la cuenta'],
  categoria: ['categoria', 'category', 'rubro'],
  etiquetas: ['etiquetas', 'tags', 'etiqueta'],
  concepto: ['concepto', 'descripcion', 'description', 'detalle', 'referencia', 'nota', 'note'],
}

export function detectarMapeo(encabezados: string[]): Mapeo {
  const normalizados = encabezados.map(normalizar)
  const mapeo: Mapeo = {}
  for (const [campo, alias] of Object.entries(ALIAS) as [Campo, string[]][]) {
    const indice = normalizados.findIndex((h) => alias.includes(h))
    if (indice >= 0) mapeo[campo] = indice
  }
  return mapeo
}

// ── Análisis ──────────────────────────────────────────────────────────────

export interface OpcionesImport {
  profileId: number
  csv: string
  filename?: string
  /** Cuenta para las filas cuyo nombre de cuenta no exista en el perfil. */
  cuentaPorOmision: number
  mapeo?: Mapeo
  separador?: string
  crearCategorias: boolean
  crearEtiquetas: boolean
  /** Con `false`, las filas duplicadas también se importan. */
  omitirDuplicadas: boolean
}

const SEPARADOR_ETIQUETAS = /\s*[·,;|]\s*/

export function analizar(opciones: OpcionesImport): Informe {
  const separador = opciones.separador ?? detectarSeparador(opciones.csv)
  const filasCrudas = parseCsv(opciones.csv, separador)
  if (filasCrudas.length === 0) throw httpError(400, 'El archivo no tiene filas')
  if (filasCrudas.length - 1 > MAX_FILAS) {
    throw httpError(400, `El archivo trae más de ${MAX_FILAS} filas; pártelo en varios`)
  }

  const encabezados = filasCrudas[0]!.map((h) => h.trim())
  const mapeo = opciones.mapeo ?? detectarMapeo(encabezados)
  if (mapeo.fecha === undefined) {
    throw httpError(400, 'No se encontró la columna de fecha. Indícala en el mapeo.')
  }
  if (mapeo.monto === undefined && mapeo.cargo === undefined && mapeo.abono === undefined) {
    throw httpError(400, 'No se encontró columna de monto (ni cargo/abono). Indícala en el mapeo.')
  }

  const cuentas = db
    .prepare('SELECT id, name FROM accounts WHERE profile_id = ?')
    .all(opciones.profileId) as { id: number; name: string }[]
  const cuentaPorNombre = new Map(cuentas.map((a) => [normalizar(a.name), a]))
  const porOmision = cuentas.find((a) => a.id === opciones.cuentaPorOmision)
  if (!porOmision) throw httpError(400, 'La cuenta por omisión no pertenece a este perfil')

  const categorias = db
    .prepare('SELECT id, name, kind FROM categories WHERE profile_id = ?')
    .all(opciones.profileId) as { id: number; name: string; kind: string }[]
  const categoriaExiste = new Set(categorias.map((c) => `${c.kind}|${normalizar(c.name)}`))
  const etiquetas = db
    .prepare('SELECT id, name FROM tags WHERE profile_id = ?')
    .all(opciones.profileId) as { id: number; name: string }[]
  const etiquetaExiste = new Set(etiquetas.map((t) => normalizar(t.name)))

  const celda = (fila: string[], campo: Campo): string => {
    const indice = mapeo[campo]
    return indice === undefined ? '' : (fila[indice] ?? '').trim()
  }

  // Preparada una sola vez: dentro del bucle serían hasta MAX_FILAS
  // compilaciones de la misma consulta (R11).
  const buscarDuplicado = db.prepare(
    `SELECT id FROM transactions
     WHERE profile_id = ? AND date = ? AND amount_cents = ? AND account_id = ? AND note = ?
     LIMIT 1`,
  )

  const filas: FilaAnalizada[] = []
  const vistasEnArchivo = new Set<string>()
  const categoriasPorCrear = new Set<string>()
  const etiquetasPorCrear = new Set<string>()
  const cuentasNoEncontradas = new Set<string>()

  for (let i = 1; i < filasCrudas.length; i++) {
    const cruda = filasCrudas[i]!
    const linea = i + 1
    const base = {
      linea,
      date: '',
      type: 'gasto' as FilaAnalizada['type'],
      amountCents: 0,
      accountName: '',
      transferAccountName: '',
      categoryName: '',
      tagNames: [] as string[],
      note: celda(cruda, 'concepto'),
    }
    const conError = (motivo: string): FilaAnalizada => ({ ...base, estado: 'error', motivo })

    const date = parseFecha(celda(cruda, 'fecha'))
    if (!date) {
      filas.push(conError(`Fecha ilegible: "${celda(cruda, 'fecha')}"`))
      continue
    }
    base.date = date

    // Monto: una columna con signo, o cargo/abono por separado.
    let firmado: number | null = null
    if (mapeo.monto !== undefined && celda(cruda, 'monto') !== '') {
      firmado = parseMonto(celda(cruda, 'monto'))
    } else {
      const cargo = parseMonto(celda(cruda, 'cargo'))
      const abono = parseMonto(celda(cruda, 'abono'))
      if (cargo !== null && cargo !== 0) firmado = -Math.abs(cargo)
      else if (abono !== null && abono !== 0) firmado = Math.abs(abono)
    }
    if (firmado === null) {
      filas.push(conError(`Monto ilegible: "${celda(cruda, 'monto') || celda(cruda, 'cargo') || celda(cruda, 'abono')}"`))
      continue
    }
    if (firmado === 0) {
      filas.push(conError('El monto es cero'))
      continue
    }

    // Tipo: la columna manda; si no hay, lo dice el signo del monto.
    const tipoCrudo = normalizar(celda(cruda, 'tipo'))
    let type: FilaAnalizada['type']
    if (tipoCrudo.startsWith('transfer')) type = 'transferencia'
    else if (tipoCrudo === 'ingreso' || tipoCrudo === 'abono' || tipoCrudo === 'deposito') type = 'ingreso'
    else if (tipoCrudo === 'gasto' || tipoCrudo === 'cargo' || tipoCrudo === 'retiro') type = 'gasto'
    else type = firmado < 0 ? 'gasto' : 'ingreso'
    base.type = type
    base.amountCents = Math.abs(firmado)

    // Cuenta: por nombre si coincide, si no la elegida por omisión.
    const nombreCuenta = celda(cruda, 'cuenta')
    const cuenta = nombreCuenta ? cuentaPorNombre.get(normalizar(nombreCuenta)) : undefined
    if (nombreCuenta && !cuenta) cuentasNoEncontradas.add(nombreCuenta)
    base.accountName = (cuenta ?? porOmision).name

    if (type === 'transferencia') {
      const nombreDestino = celda(cruda, 'cuentaDestino')
      const destino = nombreDestino ? cuentaPorNombre.get(normalizar(nombreDestino)) : undefined
      if (!destino) {
        filas.push(conError(
          nombreDestino
            ? `La cuenta destino "${nombreDestino}" no existe en este perfil`
            : 'Una transferencia necesita cuenta destino',
        ))
        continue
      }
      if (destino.id === (cuenta ?? porOmision).id) {
        filas.push(conError('El origen y el destino son la misma cuenta'))
        continue
      }
      base.transferAccountName = destino.name
    } else {
      const nombreCategoria = celda(cruda, 'categoria')
      if (nombreCategoria) {
        base.categoryName = nombreCategoria
        const clave = `${type}|${normalizar(nombreCategoria)}`
        if (!categoriaExiste.has(clave)) {
          if (!opciones.crearCategorias) {
            filas.push(conError(`La categoría "${nombreCategoria}" no existe`))
            continue
          }
          categoriasPorCrear.add(`${type}|${nombreCategoria}`)
        }
      }
      const crudasEtiquetas = celda(cruda, 'etiquetas')
      // Ojo: el `continue` de un for interno no salta la fila. Se marca la
      // etiqueta faltante y se decide fuera del bucle.
      let etiquetaFaltante: string | null = null
      if (crudasEtiquetas) {
        base.tagNames = crudasEtiquetas.split(SEPARADOR_ETIQUETAS).map((t) => t.trim()).filter(Boolean)
        for (const nombre of base.tagNames) {
          if (etiquetaExiste.has(normalizar(nombre))) continue
          if (!opciones.crearEtiquetas) {
            etiquetaFaltante = nombre
            break
          }
          etiquetasPorCrear.add(nombre)
        }
      }
      if (etiquetaFaltante) {
        filas.push(conError(`La etiqueta "${etiquetaFaltante}" no existe`))
        continue
      }
    }

    // Duplicados: contra lo que ya hay en el libro y contra el propio archivo.
    const cuentaId = (cuenta ?? porOmision).id
    const clave = `${base.date}|${base.amountCents}|${cuentaId}|${base.note}`
    const yaEnLibro = buscarDuplicado.get(
      opciones.profileId, base.date, base.amountCents, cuentaId, base.note,
    )

    const duplicada = Boolean(yaEnLibro) || vistasEnArchivo.has(clave)
    vistasEnArchivo.add(clave)
    filas.push({ ...base, estado: duplicada ? 'duplicada' : 'nueva' })
  }

  const huella = createHash('sha256')
    .update(
      JSON.stringify(
        filas.map((f) => [f.linea, f.estado, f.date, f.type, f.amountCents, f.accountName, f.note]),
      ),
    )
    .digest('hex')
    .slice(0, 16)

  return {
    huella,
    separador,
    encabezados,
    mapeo,
    filas,
    resumen: {
      total: filas.length,
      nuevas: filas.filter((f) => f.estado === 'nueva').length,
      duplicadas: filas.filter((f) => f.estado === 'duplicada').length,
      errores: filas.filter((f) => f.estado === 'error').length,
      categoriasPorCrear: [...categoriasPorCrear].map((c) => c.split('|')[1]!),
      etiquetasPorCrear: [...etiquetasPorCrear],
      cuentasNoEncontradas: [...cuentasNoEncontradas],
    },
  }
}

// ── Ejecución ─────────────────────────────────────────────────────────────

/**
 * Escribe el lote. Todo dentro de una transacción: si una sola fila la rechaza
 * la base, no queda nada a medias (R8).
 *
 * `huellaEsperada` obliga a que lo que se escribe sea exactamente lo que se
 * previsualizó: sin eso, un cliente podría mandar un archivo distinto al que
 * el usuario aprobó.
 */
export function ejecutar(opciones: OpcionesImport, huellaEsperada?: string): Resultado {
  const informe = analizar(opciones)
  if (huellaEsperada && huellaEsperada !== informe.huella) {
    throw httpError(
      409,
      'El archivo cambió respecto a la vista previa. Vuelve a previsualizar antes de importar.',
    )
  }

  const aImportar = informe.filas.filter(
    (f) => f.estado === 'nueva' || (f.estado === 'duplicada' && !opciones.omitirDuplicadas),
  )
  if (aImportar.length === 0) {
    throw httpError(400, 'No hay ninguna fila que importar')
  }

  let categoriasCreadas = 0
  let etiquetasCreadas = 0
  let batchId = 0

  inTransaction(() => {
    batchId = Number(
      db
        .prepare('INSERT INTO import_batches (profile_id, filename, row_count) VALUES (?, ?, ?)')
        .run(opciones.profileId, opciones.filename ?? '', aImportar.length).lastInsertRowid,
    )

    const cuentas = db
      .prepare('SELECT id, name FROM accounts WHERE profile_id = ?')
      .all(opciones.profileId) as { id: number; name: string }[]
    const cuentaPorNombre = new Map(cuentas.map((a) => [normalizar(a.name), a.id]))

    const insertCategoria = db.prepare(
      'INSERT OR IGNORE INTO categories (profile_id, name, kind) VALUES (?, ?, ?)',
    )
    const buscarCategoria = db.prepare(
      'SELECT id FROM categories WHERE profile_id = ? AND name = ? AND kind = ?',
    )
    const insertEtiqueta = db.prepare('INSERT OR IGNORE INTO tags (profile_id, name) VALUES (?, ?)')
    const buscarEtiqueta = db.prepare('SELECT id FROM tags WHERE profile_id = ? AND name = ?')
    const insertTx = db.prepare(
      `INSERT INTO transactions
        (profile_id, account_id, type, amount_cents, date, category_id, note,
         transfer_account_id, import_batch_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    const insertTxTag = db.prepare(
      'INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)',
    )

    // Índices en memoria, construidos una vez: buscar por nombre dentro del
    // bucle sería una consulta por fila y por etiqueta (R11).
    const categoriaPorClave = new Map(
      (db
        .prepare('SELECT id, name, kind FROM categories WHERE profile_id = ?')
        .all(opciones.profileId) as { id: number; name: string; kind: string }[])
        .map((c) => [`${c.kind}|${normalizar(c.name)}`, c.id]),
    )
    const etiquetaPorNombre = new Map(
      (db
        .prepare('SELECT id, name FROM tags WHERE profile_id = ?')
        .all(opciones.profileId) as { id: number; name: string }[])
        .map((t) => [normalizar(t.name), t.id]),
    )

    /** Busca sin distinguir acentos ni mayúsculas; crea solo si no existe. */
    const idCategoria = (nombre: string, kind: string): number | null => {
      if (!nombre) return null
      const clave = `${kind}|${normalizar(nombre)}`
      const existente = categoriaPorClave.get(clave)
      if (existente !== undefined) return existente
      if (insertCategoria.run(opciones.profileId, nombre, kind).changes > 0) categoriasCreadas++
      const fila: any = buscarCategoria.get(opciones.profileId, nombre, kind)
      if (fila) categoriaPorClave.set(clave, fila.id)
      return fila?.id ?? null
    }

    const idEtiqueta = (nombre: string): number | null => {
      const clave = normalizar(nombre)
      const existente = etiquetaPorNombre.get(clave)
      if (existente !== undefined) return existente
      if (insertEtiqueta.run(opciones.profileId, nombre).changes > 0) etiquetasCreadas++
      const fila: any = buscarEtiqueta.get(opciones.profileId, nombre)
      if (fila) etiquetaPorNombre.set(clave, fila.id)
      return fila?.id ?? null
    }

    for (const fila of aImportar) {
      const cuentaId = cuentaPorNombre.get(normalizar(fila.accountName)) ?? opciones.cuentaPorOmision
      const destinoId =
        fila.type === 'transferencia'
          ? (cuentaPorNombre.get(normalizar(fila.transferAccountName)) ?? null)
          : null
      const categoriaId =
        fila.type === 'transferencia' ? null : idCategoria(fila.categoryName, fila.type)

      const txId = Number(
        insertTx.run(
          opciones.profileId,
          cuentaId,
          fila.type,
          fila.amountCents,
          fila.date,
          categoriaId,
          fila.note,
          destinoId,
          batchId,
        ).lastInsertRowid,
      )
      for (const nombre of fila.tagNames) {
        const tagId = idEtiqueta(nombre)
        if (tagId) insertTxTag.run(txId, tagId)
      }
    }
  })

  return {
    batchId,
    importadas: aImportar.length,
    omitidas: informe.resumen.total - aImportar.length - informe.resumen.errores,
    errores: informe.resumen.errores,
    categoriasCreadas,
    etiquetasCreadas,
  }
}

export function lotes(profileId: number): Lote[] {
  const filas = db
    .prepare(
      `SELECT b.*, (SELECT COUNT(*) FROM transactions t WHERE t.import_batch_id = b.id) AS vigentes
       FROM import_batches b WHERE b.profile_id = ?
       ORDER BY b.id DESC`,
    )
    .all(profileId) as any[]
  return filas.map((f) => ({
    id: f.id,
    profileId: f.profile_id,
    filename: f.filename,
    rowCount: f.row_count,
    createdAt: f.created_at,
    vigentes: f.vigentes,
  }))
}

/**
 * Deshace un lote: borra sus partidas y el lote. Las etiquetas y categorías
 * que se crearon durante la importación se quedan — borrarlas podría afectar
 * movimientos que el usuario etiquetó a mano después.
 */
export function deshacer(profileId: number, batchId: number): { borradas: number } {
  const lote: any = db
    .prepare('SELECT * FROM import_batches WHERE id = ? AND profile_id = ?')
    .get(batchId, profileId)
  if (!lote) throw httpError(404, 'Lote de importación no encontrado')

  // Una partida importada no puede haberse ligado a una deuda, una inversión
  // o una compra a meses, pero si algún día pasara, borrarla descuadraría ese
  // registro.
  const ligadas: any = db
    .prepare(
      `SELECT COUNT(*) AS n FROM transactions
       WHERE import_batch_id = ? AND (debt_payment_id IS NOT NULL
         OR investment_entry_id IS NOT NULL OR msi_purchase_id IS NOT NULL
         OR debt_id IS NOT NULL)`,
    )
    .get(batchId)
  if (ligadas.n > 0) {
    throw httpError(
      409,
      `${ligadas.n} partida(s) del lote quedaron ligadas a una deuda, inversión o compra a meses. ` +
        'Anúlalas desde ahí.',
    )
  }

  let borradas = 0
  inTransaction(() => {
    borradas = Number(
      db.prepare('DELETE FROM transactions WHERE import_batch_id = ?').run(batchId).changes,
    )
    db.prepare('DELETE FROM import_batches WHERE id = ?').run(batchId)
  })
  return { borradas }
}
