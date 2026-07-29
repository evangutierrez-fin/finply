// Import de precios: valuar varias inversiones de un jalón, sin red.
//
// D2 resolvió que Finply **nunca** consulta una cotización en línea: pedir el
// precio del Bitcoin a un servidor le cuenta a ese servidor que tienes
// Bitcoin. Así que el precio entra como entra todo lo demás, escrito por el
// usuario: a mano una por una, o pegando el CSV que su casa de bolsa ya le
// deja descargar.
//
// El flujo es el de la Fase 2 (R4 y R8): se analiza sin tocar la base, se
// devuelve fila por fila con el valor que resultaría, y solo cuando el usuario
// confirma se escribe todo dentro de una transacción. Sin lote de deshacer,
// porque una valuación se anula sola desde el historial y no arrastra
// movimientos: no hay nada que reconstruir.

import { db, httpError, inTransaction } from './db.ts'
import { detectarSeparador, parseCsv } from './csv.ts'
import { normalizar, parseFecha, parseMonto } from './valores.ts'
import { recorrer, valorDeUnidades, type EntradaInversion } from '../shared/inversiones.ts'
import { hoyISO } from '../shared/fechas.ts'
import type { FilaPrecio, InformePrecios } from '../shared/types.ts'

export const MAX_FILAS_PRECIOS = 1000

const ALIAS_NOMBRE = ['inversion', 'nombre', 'instrumento', 'activo', 'symbol', 'simbolo', 'ticker', 'clave', 'name']
const ALIAS_PRECIO = ['precio', 'price', 'cotizacion', 'valor unitario', 'precio unitario', 'ultimo', 'cierre', 'close']
const ALIAS_FECHA = ['fecha', 'date', 'dia']

interface Columnas {
  nombre: number
  precio: number
  fecha: number | null
  /** Si la primera fila era encabezado, se salta al leer. */
  conEncabezado: boolean
}

/**
 * Qué columna es cuál. Con encabezado se reconoce por nombre; sin él, se
 * asume el orden natural de este tipo de archivo: nombre y luego precio.
 */
function columnas(filas: string[][]): Columnas {
  const primera = (filas[0] ?? []).map((c) => normalizar(c))
  const nombre = primera.findIndex((h) => ALIAS_NOMBRE.includes(h))
  const precio = primera.findIndex((h) => ALIAS_PRECIO.includes(h))
  if (nombre >= 0 && precio >= 0) {
    const fecha = primera.findIndex((h) => ALIAS_FECHA.includes(h))
    return { nombre, precio, fecha: fecha >= 0 ? fecha : null, conEncabezado: true }
  }
  if ((filas[0] ?? []).length < 2) {
    throw httpError(400, 'El archivo necesita al menos dos columnas: la inversión y su precio')
  }
  return { nombre: 0, precio: 1, fecha: null, conEncabezado: false }
}

/** Las inversiones activas del perfil con sus unidades en mano. */
function inversionesConUnidades(profileId: number) {
  const invs = db
    .prepare('SELECT id, name FROM investments WHERE profile_id = ? AND archived = 0')
    .all(profileId) as { id: number; name: string }[]
  const entradas = db
    .prepare(
      `SELECT e.investment_id, e.id, e.type, e.amount_cents, e.date, e.units_e8, e.unit_price_cents
       FROM investment_entries e
       JOIN investments i ON i.id = e.investment_id
       WHERE i.profile_id = ?`,
    )
    .all(profileId) as any[]

  const porInversion = new Map<number, EntradaInversion[]>()
  for (const f of entradas) {
    const lista = porInversion.get(f.investment_id) ?? []
    lista.push({
      id: f.id,
      type: f.type,
      amountCents: f.amount_cents,
      date: f.date,
      unitsE8: f.units_e8 ?? null,
      unitPriceCents: f.unit_price_cents ?? null,
    })
    porInversion.set(f.investment_id, lista)
  }
  return invs.map((i) => ({
    ...i,
    unitsE8: recorrer(porInversion.get(i.id) ?? []).unitsE8,
  }))
}

export interface OpcionesPrecios {
  profileId: number
  texto: string
  /** Fecha para las filas que no traigan la suya. Por omisión, hoy. */
  fecha?: string | null
}

/**
 * Lee el CSV y dice qué pasaría, sin escribir nada. Cada fila trae el valor
 * que tendría la inversión si se acepta, que es lo que el usuario necesita
 * ver antes de decidir: un precio en la unidad equivocada se nota ahí.
 */
export function analizarPrecios(opciones: OpcionesPrecios): InformePrecios {
  const separador = detectarSeparador(opciones.texto)
  const crudas = parseCsv(opciones.texto, separador)
  if (crudas.length === 0) throw httpError(400, 'El archivo no tiene filas')
  const cols = columnas(crudas)
  const cuerpo = cols.conEncabezado ? crudas.slice(1) : crudas
  if (cuerpo.length > MAX_FILAS_PRECIOS) {
    throw httpError(400, `El archivo trae más de ${MAX_FILAS_PRECIOS} filas de precios`)
  }

  const inversiones = inversionesConUnidades(opciones.profileId)
  const porNombre = new Map(inversiones.map((i) => [normalizar(i.name), i]))
  const porOmision = opciones.fecha ?? hoyISO()

  const filas: FilaPrecio[] = cuerpo.map((fila, indice) => {
    const nombre = (fila[cols.nombre] ?? '').trim()
    const precioCents = parseMonto(fila[cols.precio] ?? '')
    const fechaCruda = cols.fecha === null ? '' : (fila[cols.fecha] ?? '').trim()
    const fecha = fechaCruda ? parseFecha(fechaCruda) : porOmision
    const base: FilaPrecio = {
      fila: indice,
      nombre,
      fecha,
      precioCents,
      investmentId: null,
      investmentName: null,
      unitsE8: 0,
      valorCents: null,
      estado: 'invalida',
      motivo: '',
    }

    if (!nombre) return { ...base, motivo: 'Sin nombre de inversión' }
    if (precioCents === null) {
      return { ...base, motivo: `No se entiende el precio «${(fila[cols.precio] ?? '').trim()}»` }
    }
    if (precioCents < 0) return { ...base, motivo: 'El precio no puede ser negativo' }
    if (fecha === null) return { ...base, motivo: `No se entiende la fecha «${fechaCruda}»` }

    const inv = porNombre.get(normalizar(nombre))
    if (!inv) {
      return { ...base, estado: 'sin_inversion', motivo: 'No hay una inversión con ese nombre' }
    }
    if (inv.unitsE8 <= 0) {
      return {
        ...base,
        investmentId: inv.id,
        investmentName: inv.name,
        estado: 'sin_unidades',
        motivo: 'Esa inversión no lleva unidades registradas; un precio no le dice nada',
      }
    }
    return {
      ...base,
      investmentId: inv.id,
      investmentName: inv.name,
      unitsE8: inv.unitsE8,
      valorCents: valorDeUnidades(inv.unitsE8, precioCents),
      estado: 'lista',
      motivo: '',
    }
  })

  return {
    filas,
    listas: filas.filter((f) => f.estado === 'lista').length,
    descartadas: filas.filter((f) => f.estado !== 'lista').length,
  }
}

/**
 * Asienta las filas que el usuario dejó marcadas, en una sola transacción.
 * Se vuelve a analizar aquí dentro en vez de confiar en lo que mande el
 * cliente: entre la vista previa y el visto bueno pudo cambiar el libro, y lo
 * que se escribe tiene que ser lo que el archivo dice ahora.
 */
export function aplicarPrecios(
  opciones: OpcionesPrecios & { filas: number[] },
): { creadas: number; omitidas: number } {
  const informe = analizarPrecios(opciones)
  const elegidas = new Set(opciones.filas)
  const aplicables = informe.filas.filter((f) => elegidas.has(f.fila) && f.estado === 'lista')

  inTransaction(() => {
    const insertar = db.prepare(
      `INSERT INTO investment_entries
         (investment_id, type, amount_cents, date, note, units_e8, unit_price_cents)
       VALUES (?, 'valuacion', 0, ?, ?, NULL, ?)`,
    )
    for (const f of aplicables) {
      insertar.run(f.investmentId!, f.fecha!, 'Precio importado', f.precioCents!)
    }
  })

  return { creadas: aplicables.length, omitidas: elegidas.size - aplicables.length }
}
