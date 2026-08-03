// Cómo se ven las cifras y las fechas de un libro. Módulo puro (R16).
//
// Hasta la Fase 21 el formato era una decisión de Finply escrita en
// `src/format.ts`: "12 jun" y siempre con centavos. Son dos convenciones
// razonables y ninguna es universal — quien viene de un estado de cuenta lee
// `12/06/2026`, quien exporta a una hoja quiere `2026-06-12`, y a quien maneja
// cifras de siete dígitos los centavos solo le estorban.
//
// Vive aquí y no en el componente por la misma razón que la aritmética del eje
// (Fase 10a) o los campos del formulario (Fase 20): lo que decide cómo se lee
// una cifra se equivoca en silencio, y dentro de un `.tsx` no se puede probar.

/** Las tres formas de escribir una fecha. Nulo o desconocido: 'corto'. */
export type FormatoFecha = 'corto' | 'numerico' | 'iso'

export interface Formato {
  fecha: FormatoFecha
  /**
   * Redondear a pesos enteros al mostrar. **Nunca cambia lo guardado**: el
   * libro sigue en centavos y las cuentas se hacen con centavos. Lo que sí
   * cambia es que una columna redondeada puede no sumar exactamente su total,
   * y eso se dice donde se elige.
   */
  sinCentavos: boolean
  /** Qué día empieza la semana (1 = lunes … 7 = domingo). Solo de vista. */
  inicioSemana: number
}

export const FORMATO_POR_OMISION: Formato = {
  fecha: 'corto',
  sinCentavos: false,
  inicioSemana: 1,
}

export const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

export const DIAS_SEMANA = [
  'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo',
]

/**
 * 'AAAA-MM-DD' → cómo lo lee este libro.
 *
 * `corto` se come el año a propósito: en una tabla de un mes, repetir "2026"
 * en cada renglón es ruido. Los otros dos lo llevan porque su gracia es
 * justamente ser inequívocos — uno para leerlo como en el banco y otro para
 * ordenarlo o pegarlo en una hoja de cálculo.
 */
export function fechaCon(iso: string, formato: FormatoFecha = 'corto'): string {
  const [y, m, d] = iso.split('-')
  if (!y || !m || !d) return iso
  if (formato === 'iso') return iso
  if (formato === 'numerico') return `${d}/${m}/${y}`
  return `${Number(d)} ${MESES[Number(m) - 1]!.slice(0, 3)}`
}

/** Como `fechaCon`, pero siempre con el año: un plan a 48 meses cruza varios. */
export function fechaConAnio(iso: string, formato: FormatoFecha = 'corto'): string {
  if (formato === 'corto') {
    const [y] = iso.split('-')
    return `${fechaCon(iso, 'corto')} ${y!.slice(2)}`
  }
  return fechaCon(iso, formato)
}

/**
 * Los días de la semana empezando por el que diga el perfil.
 *
 * ⚠ Es **solo el orden en que se enseñan**. La clave de periodo de una
 * recurrencia semanal sigue siendo la semana ISO —de lunes a domingo, por
 * definición—, y moverla reproponría el histórico entero (R5). Lo que cambia
 * aquí es dónde empieza la lista que ve el usuario, nada más.
 */
export function diasDesde(inicio = 1): { id: number; label: string }[] {
  const base = Math.min(7, Math.max(1, Math.round(inicio)))
  return Array.from({ length: 7 }, (_, i) => {
    const id = ((base - 1 + i) % 7) + 1
    return { id, label: DIAS_SEMANA[id - 1]! }
  })
}

/**
 * Centavos → pesos, con la convención del libro.
 *
 * Sin centavos redondea **al peso más cercano**, no trunca: truncar sesga todo
 * hacia abajo y una columna de gastos acabaría diciendo menos de lo que
 * costaron. Aun redondeando, la suma de las partes puede alejarse un peso del
 * total —cuatro partidas de $0.50 se ven como $1, $1, $1, $1 y suman $2—, y
 * por eso la opción lleva su advertencia donde se elige.
 */
export function pesosCon(cents: number, formato: Formato, currency = 'MXN'): string {
  const opciones: Intl.NumberFormatOptions = {
    style: 'currency',
    currency,
    ...(formato.sinCentavos ? { minimumFractionDigits: 0, maximumFractionDigits: 0 } : {}),
  }
  return new Intl.NumberFormat('es-MX', opciones).format(cents / 100)
}
