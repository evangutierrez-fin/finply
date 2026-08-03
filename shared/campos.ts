// Qué campos pide un movimiento. **Un solo lugar.**
//
// Hasta la Fase 20 la respuesta vivía repartida en `TxModal`: un
// `profile.modules.includes('negocio')` aquí, un `conInmuebles` allá, un
// `type !== 'transferencia'` en cada bloque y la regla de "solo si hay
// contratos" escondida en medio del JSX. Funcionaba, y ese es el problema: la
// lógica que decide qué se le pregunta al usuario no se podía probar sin
// montar un componente, y cada módulo nuevo agregaba otra condición suelta.
//
// Aquí es una función pura sobre tres datos —los módulos del perfil, el tipo
// del movimiento y si hay contratos que elegir—, así que se prueba
// estáticamente (R16) y **la barra de registro rápido lee lo mismo que el
// modal**. Sin esto, la barra y el modal serían dos opiniones sobre qué es un
// movimiento completo, que es como se acaban separando dos vistas de la misma
// cosa.
//
// ⚠ Esto decide qué se **pregunta**, nunca qué se guarda (R17). Un campo que
// no se ve se manda tal como venía: apagar Negocio no puede vaciarle la
// contraparte a una partida vieja. Esa regla vive en el modal, junto al PATCH,
// que es donde se rompe.

import type { ModuloId } from './modulos.ts'

export type TxType = 'ingreso' | 'gasto' | 'transferencia'

/** Cada campo del formulario que puede estar o no estar. */
export type CampoTx =
  /** Cuenta destino. Solo en una transferencia. */
  | 'cuentaDestino'
  /** La categoría de arriba. Se va cuando el ticket va repartido. */
  | 'categoria'
  /** El reparto por categoría (D17). */
  | 'reparto'
  /** ¿Devuelve un gasto? Solo tiene sentido en un ingreso. */
  | 'devolucion'
  /** Contraparte, centro de costo, impuesto y deducible. */
  | 'negocio'
  /** De qué inmueble y qué papel juega el movimiento (Fase 15). */
  | 'inmueble'
  | 'etiquetas'
  /** El recibo adjunto. Exige que el movimiento ya exista. */
  | 'recibo'

export interface ContextoCampos {
  modules: ModuloId[]
  type: TxType
  /** El ticket va repartido en renglones: entonces no hay categoría de arriba. */
  dividida?: boolean
  /** ¿Hay arrendamientos vivos que elegir? Sin ellos serían dos selects vacíos. */
  hayArrendamientos?: boolean
  /** ¿El movimiento ya existe? Sin id no hay dónde colgar un recibo. */
  existe?: boolean
}

/**
 * Los campos que este movimiento pide, en el orden en que se ven.
 *
 * El orden importa: es el que recorre el tabulador, y una lista que lo diga
 * es una lista que se puede comparar contra la vista.
 */
export function camposDelMovimiento(ctx: ContextoCampos): CampoTx[] {
  const con = (m: ModuloId) => ctx.modules.includes(m)
  const campos: CampoTx[] = []

  if (ctx.type === 'transferencia') {
    // Mover dinero entre dos bolsillos tuyos no tiene categoría, ni reparto,
    // ni impuesto, ni inquilino: es el mismo peso cambiando de lugar (D6).
    campos.push('cuentaDestino')
    campos.push('etiquetas')
    if (ctx.existe) campos.push('recibo')
    return campos
  }

  if (!ctx.dividida) campos.push('categoria')
  campos.push('reparto')
  if (ctx.type === 'ingreso') campos.push('devolucion')
  // Los campos de negocio los trae el **módulo**, no el tipo de perfil: desde
  // la Fase 9 el tipo solo elige el juego por omisión, y un libro personal que
  // encienda Negocio tiene que verlos igual.
  if (con('negocio')) campos.push('negocio')
  if (con('inmuebles') && ctx.hayArrendamientos) campos.push('inmueble')
  campos.push('etiquetas')
  if (ctx.existe) campos.push('recibo')
  return campos
}

/** ¿Este formulario pregunta por ese campo? */
export function pideCampo(ctx: ContextoCampos, campo: CampoTx): boolean {
  return camposDelMovimiento(ctx).includes(campo)
}

/**
 * ¿Este libro pide ese campo **alguna vez**, sea cual sea el tipo?
 *
 * Es la pregunta que decide qué datos vale la pena cargar: las contrapartes y
 * los centros se piden una vez al abrir el formulario, no cada vez que se
 * cambia de gasto a transferencia. En un libro personal no se piden nunca.
 */
export function libroPide(modules: ModuloId[], campo: CampoTx): boolean {
  const tipos: TxType[] = ['gasto', 'ingreso', 'transferencia']
  return tipos.some((type) =>
    camposDelMovimiento({ modules, type, hayArrendamientos: true }).includes(campo),
  )
}

/**
 * Lo que la barra de registro rápido siempre pregunta: monto, cuenta,
 * categoría, concepto y fecha. Es el movimiento mínimo que el servidor acepta.
 *
 * Todo lo demás —reparto, devolución, negocio, inmueble, etiquetas, recibo— se
 * queda fuera **a propósito**: una línea que pregunta ocho cosas ya es un
 * modal. La barra no los inventa ni los borra; los deja en su valor por
 * omisión, y quien los necesite abre el formulario completo con lo que ya
 * escribió.
 */
export const CAMPOS_RAPIDOS = ['monto', 'cuenta', 'categoria', 'concepto', 'fecha'] as const

/**
 * Los campos que la barra **no** cubre y este perfil sí pediría. Es lo que
 * hace honesto el atajo: en un libro de negocio la barra dice qué se está
 * saltando en vez de guardar en silencio un movimiento sin contraparte.
 */
export function camposQueFaltan(ctx: ContextoCampos): CampoTx[] {
  return camposDelMovimiento(ctx).filter((c) => c === 'negocio' || c === 'inmueble')
}
