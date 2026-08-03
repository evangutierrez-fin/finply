// Atajos de teclado: el catálogo y la regla de cuándo se disparan.
//
// Módulo puro a propósito. Lo que decide si una tecla es un atajo o es una
// letra que el usuario está escribiendo **no puede vivir dentro de un
// `onKeyDown`**: es exactamente la clase de lógica que se rompe en silencio
// —empiezas a escribir "nota" en el buscador y se te abre el formulario de
// movimiento— y que sin un módulo puro no se puede probar (R16).
//
// Tres reglas, y las tres salen del mismo miedo:
//
//   1. Dentro de un campo de texto **no hay atajos**. Ninguno. Escape es la
//      única excepción, porque ahí significa "sácame de aquí".
//   2. Con Ctrl, Cmd o Alt tampoco: esas combinaciones son del navegador y del
//      sistema, y robárselas es peor que no tener atajos.
//   3. Nada que escriba en el libro. La tecla **abre el formulario**; guardar
//      sigue pidiendo un clic o un Enter sobre un campo lleno (R4). No existe
//      un atajo que asiente un movimiento.

export type AtajoId =
  | 'nuevo'
  | 'repetir'
  | 'barra'
  | 'buscar'
  | 'ayuda'
  | 'cerrar'
  | 'ir-resumen'
  | 'ir-movimientos'
  | 'ir-cuentas'
  | 'ir-flujo'
  | 'ir-presupuestos'
  | 'ir-notas'

export interface Atajo {
  id: AtajoId
  /** Lo que se teclea, tal como se enseña. */
  tecla: string
  que: string
  grupo: 'Registrar' | 'Moverse' | 'Otros'
}

/**
 * El catálogo. Es la misma lista que se enseña con `?` y la que resuelve las
 * teclas: si fueran dos, la ayuda mentiría en cuanto alguien cambiara una.
 */
export const ATAJOS: Atajo[] = [
  { id: 'nuevo', tecla: 'n', que: 'Registrar un movimiento', grupo: 'Registrar' },
  { id: 'barra', tecla: 'b', que: 'Ir a la barra de registro rápido', grupo: 'Registrar' },
  { id: 'repetir', tecla: 'r', que: 'Traer la última partida a la barra', grupo: 'Registrar' },
  { id: 'buscar', tecla: '/', que: 'Buscar en el libro', grupo: 'Otros' },
  { id: 'ayuda', tecla: '?', que: 'Ver esta lista', grupo: 'Otros' },
  { id: 'cerrar', tecla: 'Esc', que: 'Cerrar lo que esté abierto', grupo: 'Otros' },
  { id: 'ir-resumen', tecla: 'g r', que: 'Resumen', grupo: 'Moverse' },
  { id: 'ir-movimientos', tecla: 'g m', que: 'Movimientos', grupo: 'Moverse' },
  { id: 'ir-cuentas', tecla: 'g c', que: 'Cuentas', grupo: 'Moverse' },
  { id: 'ir-flujo', tecla: 'g f', que: 'Flujo', grupo: 'Moverse' },
  { id: 'ir-presupuestos', tecla: 'g p', que: 'Presupuestos', grupo: 'Moverse' },
  { id: 'ir-notas', tecla: 'g n', que: 'Notas', grupo: 'Moverse' },
]

/** La tecla que abre una secuencia de dos, al estilo de siempre: `g` + destino. */
export const PREFIJO = 'g'

const DIRECTOS: Record<string, AtajoId> = {
  n: 'nuevo',
  b: 'barra',
  r: 'repetir',
  '/': 'buscar',
  '?': 'ayuda',
}

const CON_PREFIJO: Record<string, AtajoId> = {
  r: 'ir-resumen',
  m: 'ir-movimientos',
  c: 'ir-cuentas',
  f: 'ir-flujo',
  p: 'ir-presupuestos',
  n: 'ir-notas',
}

export interface Pulsacion {
  /** `event.key` tal cual. */
  tecla: string
  /** Ctrl, Cmd o Alt: entonces la combinación no es nuestra. */
  conModificador?: boolean
  /** El foco está en un input, un textarea, un select o algo editable. */
  enCampo?: boolean
  /** `g` quedó apretada antes y esperamos el destino. */
  prefijoActivo?: boolean
}

export type Resultado =
  | { tipo: 'atajo'; id: AtajoId }
  /** `g` sola: hay que esperar la segunda tecla. */
  | { tipo: 'prefijo' }
  /** Nada que hacer, y si había un prefijo se descarta. */
  | null

/**
 * Qué hacer con una tecla. Sin efectos y sin DOM: quien llama decide si
 * cancela el evento y qué hace con el resultado.
 */
export function resolverAtajo(p: Pulsacion): Resultado {
  // Escape es lo único que vale dentro de un campo: es la salida.
  if (p.tecla === 'Escape') return { tipo: 'atajo', id: 'cerrar' }
  if (p.conModificador) return null
  if (p.enCampo) return null

  if (p.prefijoActivo) {
    const id = CON_PREFIJO[p.tecla.toLowerCase()]
    return id ? { tipo: 'atajo', id } : null
  }
  if (p.tecla.toLowerCase() === PREFIJO) return { tipo: 'prefijo' }

  // '?' llega con Shift en casi todos los teclados; la tecla ya viene resuelta.
  const id = DIRECTOS[p.tecla === '?' ? '?' : p.tecla.toLowerCase()]
  return id ? { tipo: 'atajo', id } : null
}

/** A qué vista lleva un atajo de navegación. `null` si no navega. */
export function vistaDeAtajo(id: AtajoId): string | null {
  return id.startsWith('ir-') ? id.slice(3) : null
}
