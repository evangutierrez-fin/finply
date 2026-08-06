// Aritmética de los tres módulos de giro: inmuebles en renta, horas
// facturables e inventario simple.
//
// Módulo PURO a propósito (R16): no importa nada que abra la base, así que las
// pruebas pueden importarlo estáticamente sin riesgo de tocar el libro real.
// Todo el dinero en centavos enteros; las cantidades de inventario en
// **milésimas de unidad**, para que quepa 1.5 kg sin punto flotante.
//
// Nada de aquí es de un país (R15): no hay tasas, ni impuestos, ni reglas de
// depreciación. Son sumas y divisiones sobre cifras que escribió el usuario.

// ── Inventario: promedio ponderado móvil (D29) ────────────────────────────

export type TipoMovimientoExistencias = 'entrada' | 'salida' | 'ajuste'

export interface MovimientoExistencias {
  fecha: string
  tipo: TipoMovimientoExistencias
  /** Milésimas de unidad. En un ajuste puede ser negativa: es un delta. */
  cantidadMilli: number
  /** Solo en una entrada: lo que costó cada unidad completa. */
  costoUnitarioCents: number
}

export interface EstadoExistencias {
  /** Lo que queda, en milésimas de unidad. */
  cantidadMilli: number
  /** Costo promedio de una unidad completa, redondeado al centavo. */
  costoUnitarioCents: number
  /** Lo que vale lo que queda. Es el acumulado exacto, no cantidad × promedio. */
  valorCents: number
  /** Lo que costó lo que salió: el costo de ventas del periodo. */
  costoVendidoCents: number
  /** Lo que se perdió o apareció en un ajuste. **No** es costo de ventas. */
  ajusteCents: number
}

/** El costo de sacar `cantidadMilli` de un lote que vale `valorCents`. */
function costoDeSalida(cantidadMilli: number, quedaMilli: number, valorCents: number): number {
  // Si la salida vacía la existencia, se lleva el valor **entero**: es lo
  // mismo que hace `parcialidades` con el último pago, y evita que quede un
  // residuo de centavos en un almacén sin nada dentro.
  if (cantidadMilli >= quedaMilli) return valorCents
  return Math.round((valorCents * cantidadMilli) / quedaMilli)
}

/**
 * Recorre los movimientos de un producto en orden y devuelve en qué quedó.
 *
 * **Promedio ponderado móvil** (D29): cada entrada recalcula el costo unitario
 * mezclando lo que ya había con lo que llega, y cada salida se valúa a ese
 * promedio. Se eligió sobre PEPS porque no obliga a arrastrar capas por
 * producto —y con capas, un solo `SELECT` deja de bastar para decir cuánto
 * vale el almacén (R11)—; y sobre "último costo" porque ese ni siquiera suma
 * lo que se pagó.
 *
 * El valor se lleva **acumulado**, no como cantidad × promedio: el promedio
 * está redondeado al centavo y multiplicarlo dejaría diferencias que crecen
 * con cada movimiento.
 */
export function recorrerExistencias(movimientos: MovimientoExistencias[]): EstadoExistencias {
  let cantidad = 0
  let valor = 0
  let costoVendido = 0
  let ajuste = 0

  for (const m of movimientos) {
    if (m.tipo === 'entrada') {
      cantidad += m.cantidadMilli
      valor += Math.round((m.cantidadMilli * m.costoUnitarioCents) / 1000)
      continue
    }
    if (m.tipo === 'salida') {
      const costo = costoDeSalida(m.cantidadMilli, cantidad, valor)
      cantidad -= m.cantidadMilli
      valor -= costo
      costoVendido += costo
      continue
    }
    // Ajuste: un conteo que no cuadró, una merma, algo que apareció. El delta
    // se valúa al promedio de hoy y **no** entra al costo de ventas: no lo
    // vendiste. Meterlo ahí inflaría el costo de lo que sí se vendió.
    if (m.cantidadMilli < 0) {
      const costo = costoDeSalida(-m.cantidadMilli, cantidad, valor)
      cantidad += m.cantidadMilli
      valor -= costo
      ajuste -= costo
    } else {
      const unitario = cantidad > 0 ? valor / cantidad : m.costoUnitarioCents / 1000
      const costo = Math.round(m.cantidadMilli * unitario)
      cantidad += m.cantidadMilli
      valor += costo
      ajuste += costo
    }
  }

  return {
    cantidadMilli: cantidad,
    costoUnitarioCents: cantidad > 0 ? Math.round((valor * 1000) / cantidad) : 0,
    valorCents: valor,
    costoVendidoCents: costoVendido,
    ajusteCents: ajuste,
  }
}

/** 1500 → "1.5"; 2000 → "2". Las milésimas se escriben sin ceros de relleno. */
export function cantidadTexto(cantidadMilli: number): string {
  const signo = cantidadMilli < 0 ? '-' : ''
  const abs = Math.abs(cantidadMilli)
  const entero = Math.floor(abs / 1000)
  const resto = abs % 1000
  if (resto === 0) return `${signo}${entero}`
  return `${signo}${entero}.${String(resto).padStart(3, '0').replace(/0+$/, '')}`
}

/** "1.5" → 1500. `null` si no se entiende o si es negativa sin permiso. */
export function parseCantidad(raw: string, permitirNegativo = false): number | null {
  const limpio = raw.trim().replace(',', '.')
  if (limpio === '') return null
  const patron = permitirNegativo ? /^-?\d+(\.\d{1,3})?$/ : /^\d+(\.\d{1,3})?$/
  if (!patron.test(limpio)) return null
  return Math.round(parseFloat(limpio) * 1000)
}

// ── Horas facturables ─────────────────────────────────────────────────────

/**
 * Lo que valen unos minutos a una tarifa por hora. Se redondea una sola vez,
 * al final: cobrar por minuto y sumar dejaría un centavo de diferencia contra
 * la factura por cada renglón.
 */
export function importeDeMinutos(minutos: number, tarifaCents: number): number {
  return Math.round((minutos * tarifaCents) / 60)
}

/** 90 → "1:30". Las horas de trabajo se leen así, no como 1.5. */
export function horasTexto(minutos: number): string {
  const signo = minutos < 0 ? '-' : ''
  const abs = Math.abs(minutos)
  return `${signo}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, '0')}`
}

/** "1:30", "1.5" o "90m" → 90 minutos. `null` si no se entiende. */
export function parseHoras(raw: string): number | null {
  const limpio = raw.trim().toLowerCase().replace(',', '.')
  if (limpio === '') return null
  const reloj = /^(\d{1,3}):([0-5]\d)$/.exec(limpio)
  if (reloj) return Number(reloj[1]) * 60 + Number(reloj[2])
  const minutos = /^(\d{1,5})\s*m$/.exec(limpio)
  if (minutos) return Number(minutos[1])
  if (!/^\d{1,3}(\.\d{1,2})?\s*h?$/.test(limpio)) return null
  return Math.round(parseFloat(limpio) * 60)
}

// ── Inmuebles en renta ────────────────────────────────────────────────────

export interface RendimientoInmueble {
  /** Renta cobrada menos gasto atribuido, en la ventana mirada. */
  netoCents: number
  /** Ese neto llevado a doce meses. */
  anualizadoCents: number
  /**
   * El neto anualizado sobre lo que vale hoy, en puntos base. `null` cuando no
   * hay valor contra qué medirlo: dividir entre cero no da cero, da "no se
   * puede decir". Es la misma regla que el margen bruto.
   */
  tasaAnualBp: number | null
  /** La misma tasa contra lo que costó, que es la otra pregunta legítima. */
  tasaSobreCostoBp: number | null
}

/**
 * Qué deja una propiedad rentada. Aritmética del propio usuario con sus
 * supuestos a la vista (R9): no hay plusvalía supuesta, ni inflación, ni una
 * tasa de mercado con qué compararla. Solo lo que cobró, lo que gastó y lo que
 * él mismo declaró que vale.
 *
 * El depósito **no entra**: no es suyo, lo tiene que devolver.
 */
export function rendimientoInmueble(params: {
  cobradoCents: number
  gastoCents: number
  valorCents: number
  costoCents: number
  meses: number
}): RendimientoInmueble {
  const { cobradoCents, gastoCents, valorCents, costoCents, meses } = params
  const netoCents = cobradoCents - gastoCents
  const anualizadoCents = meses > 0 ? Math.round((netoCents * 12) / meses) : 0
  const tasa = (base: number) =>
    base > 0 ? Math.round((anualizadoCents / base) * 10_000) : null
  return {
    netoCents,
    anualizadoCents,
    tasaAnualBp: tasa(valorCents),
    tasaSobreCostoBp: tasa(costoCents),
  }
}
