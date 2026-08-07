// Formateo de dinero y fechas. Fechas siempre como texto 'AAAA-MM-DD'
// para evitar sorpresas de zona horaria.
//
// Desde la Fase 21 la **convención la elige el perfil** —cómo se ven las
// fechas, si se enseñan los centavos— y la aritmética vive en
// `shared/formato.ts`, que es puro y está probado. Aquí queda una sola cosa:
// dónde se guarda la preferencia activa.
//
// Es un valor de módulo y no un contexto de React **a propósito**. `fmtMoney` y
// `fmtDate` se llaman desde trescientos lugares, muchos fuera de un componente
// —dentro de `useMemo`, en funciones sueltas de una vista, en el rótulo de un
// eje—, y convertirlas en hooks obligaría a tocar cada uno para pasar algo que
// es global por naturaleza: cómo se lee este libro. App lo fija al cargar el
// perfil y lo cambia al cambiar de perfil.

import {
  FORMATO_POR_OMISION, MAX_CENTAVOS, MESES, fechaCon, fechaConAnio, pesosCon, type Formato,
} from '../shared/formato.ts'
import { correrMesTexto } from '../shared/fechas.ts'

let formatoActivo: Formato = FORMATO_POR_OMISION

/** Fija la convención del libro abierto. La llama App, y solo App. */
export function usarFormato(formato: Partial<Formato>): void {
  formatoActivo = { ...FORMATO_POR_OMISION, ...formato }
}

export function formatoActual(): Formato {
  return formatoActivo
}

const formatters = new Map<string, Intl.NumberFormat>()

export function fmtMoney(cents: number, currency = 'MXN'): string {
  // Sin centavos hay que rehacer el formateador, así que el camino rápido
  // —con centavos, que es el de siempre— conserva su caché.
  if (formatoActivo.sinCentavos) return pesosCon(cents, formatoActivo, currency)
  let f = formatters.get(currency)
  if (!f) {
    f = new Intl.NumberFormat('es-MX', { style: 'currency', currency })
    formatters.set(currency, f)
  }
  return f.format(cents / 100)
}

/**
 * Dinero corto para el eje de una gráfica: `$0`, `$850`, `$1.2k`, `$45k`,
 * `$1.3M`. El eje necesita que la cifra quepa; el pie y las tablas siguen
 * usando `fmtMoney`, que es la cifra exacta.
 */
export function fmtCompacto(cents: number): string {
  const pesos = cents / 100
  const signo = pesos < 0 ? '−' : ''
  const abs = Math.abs(pesos)
  if (abs >= 1_000_000) {
    const m = abs / 1_000_000
    return `${signo}$${m >= 10 ? Math.round(m) : m.toFixed(1).replace(/\.0$/, '')}M`
  }
  if (abs >= 1_000) {
    const k = abs / 1_000
    return `${signo}$${k >= 10 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, '')}k`
  }
  return `${signo}$${Math.round(abs)}`
}

/**
 * '1,234.56' | '$1234' | '1234.5' → centavos enteros, o null si no es un monto.
 *
 * Por omisión exige que sea **mayor que cero**, porque casi todo lo que se
 * teclea en Finply es un monto y un monto de cero no significa nada. La
 * excepción es el saldo de un corte de conciliación (D19): el estado de cuenta
 * de una tarjeta viene en negativo, y el de una cuenta vacía viene en cero.
 *
 * El techo es el mismo `MAX_CENTAVOS` que exige la API: el formulario lo dice
 * en el momento —el campo se queda en rojo— en vez de dejar que el usuario
 * mande la petición para que se la rechacen. Es la misma cifra en las tres
 * puertas, no tres copias.
 */
export function parseAmount(
  raw: string,
  opciones: { permitirNegativo?: boolean } = {},
): number | null {
  const clean = raw.replace(/[$,\s]/g, '')
  const patron = opciones.permitirNegativo ? /^-?\d+(\.\d{1,2})?$/ : /^\d+(\.\d{1,2})?$/
  if (!patron.test(clean)) return null
  const cents = Math.round(parseFloat(clean) * 100)
  if (!Number.isSafeInteger(cents) || Math.abs(cents) > MAX_CENTAVOS) return null
  if (opciones.permitirNegativo) return cents
  return cents > 0 ? cents : null
}

export { mensajeMonto } from '../shared/formato.ts'

/** '24.5' | '24,5' | '0' → puntos base, o null si no es una tasa. */
export function parseTasa(raw: string): number | null {
  const clean = raw.replace(/[%\s]/g, '').replace(',', '.')
  if (clean === '') return 0
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(clean)) return null
  const bp = Math.round(parseFloat(clean) * 100)
  return bp <= 100_000 ? bp : null
}

/** 2450 → '24.5 %'. */
export function fmtTasa(bp: number): string {
  const pct = bp / 100
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2).replace(/0$/, '')} %`
}

export { MESES }

export function fmtDate(iso: string): string {
  return fechaCon(iso, formatoActivo.fecha)
}

/** Como fmtDate pero con el año: un plan a 48 meses cruza varios. */
export function fmtDateAnio(iso: string): string {
  return fechaConAnio(iso, formatoActivo.fecha)
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-')
  const name = MESES[Number(m) - 1]!
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${y}`
}

export function todayISO(): string {
  const now = new Date()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${m}-${d}`
}

export function currentMonth(): string {
  return todayISO().slice(0, 7)
}

/**
 * Mueve un mes 'AAAA-MM'. Es `correrMesTexto` con el nombre que el cliente ya
 * usaba en veinte llamadas: la aritmética es la del servidor, no una copia —era
 * la sexta, y la única que además dejaba el año sin rellenar.
 */
export function shiftMonth(month: string, delta: number): string {
  return correrMesTexto(month, delta)
}

export function isPastDue(dueDate: string | null): boolean {
  return dueDate !== null && dueDate < todayISO()
}
