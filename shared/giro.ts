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
  if (quedaMilli <= 0 || cantidadMilli <= 0) return 0
  // Si la salida vacía la existencia, se lleva el valor **entero**: es lo
  // mismo que hace `parcialidades` con el último pago, y evita que quede un
  // residuo de centavos en un almacén sin nada dentro.
  if (cantidadMilli >= quedaMilli) return valorCents
  return Math.round((valorCents * cantidadMilli) / quedaMilli)
}

/** Cuánto mueve el anaquel un movimiento: positivo entra, negativo sale. */
function delta(m: MovimientoExistencias): number {
  return m.tipo === 'salida' ? -m.cantidadMilli : m.cantidadMilli
}

/**
 * Lo más que se puede sacar con fecha `desde` sin dejar el anaquel en negativo
 * en **ningún** momento posterior.
 *
 * No basta con mirar lo que hay hoy ni lo que había ese día. Meter una salida
 * con fecha vieja baja el recorrido entero de ahí en adelante, así que lo que
 * limita es el **punto más bajo** de ese tramo: con diez kilos que entraron el
 * 1 y diez que salieron el 5, hoy hay cero y el día 3 había diez, pero sacar
 * cinco con fecha 3 dejaría el día 5 en menos cinco. El mínimo del tramo es la
 * única cifra que contesta bien las tres preguntas.
 *
 * Los movimientos tienen que venir en el orden en que ocurrieron.
 */
export function existenciaMinimaDesde(
  movimientos: MovimientoExistencias[],
  desde: string,
): number {
  let cantidad = 0
  let minimo: number | null = null
  for (const m of movimientos) {
    // El punto de inserción: lo que hay justo antes del primer movimiento que
    // la fecha nueva alcanza. Un movimiento nuevo se apunta al final de su día.
    if (m.fecha > desde && minimo === null) minimo = cantidad
    cantidad += delta(m)
    if (m.fecha > desde) minimo = Math.min(minimo!, cantidad)
  }
  return minimo === null ? cantidad : Math.min(minimo, cantidad)
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
  // Lo que salió **antes de haber entrado**. Con el validador de hoy no puede
  // ocurrir —una salida no pasa si deja el anaquel en negativo—, pero sí llega
  // de un libro viejo o de un respaldo hecho antes de esa regla, y hay que
  // leerlo sin inventar cifras. La existencia nunca baja de cero: lo que falta
  // se apunta aquí y se valúa con la primera entrada que llegue, que es el
  // único costo que ese anaquel puede conocer. Sin esto, el promedio ponderado
  // se calculaba contra una cantidad negativa y una compra de $2,000 dejaba
  // cinco kilos valuados en $2,000 con el costo de ventas en cero: el almacén
  // valía el doble y lo vendido no había costado nada.
  let faltanteSalida = 0
  let faltanteAjuste = 0

  for (const m of movimientos) {
    if (m.tipo === 'entrada') {
      const valorEntrada = Math.round((m.cantidadMilli * m.costoUnitarioCents) / 1000)
      let restante = m.cantidadMilli
      let repartido = 0
      // El valor de la entrada se reparte entre lo que tapa y lo que se queda,
      // y el residuo del redondeo va al final: lo que compraste vale lo que
      // pagaste, se use para lo que se use.
      const parte = (milli: number) => {
        const c = Math.round((valorEntrada * milli) / m.cantidadMilli)
        repartido += c
        return c
      }
      const cubreSalida = Math.min(faltanteSalida, restante)
      if (cubreSalida > 0) {
        costoVendido += parte(cubreSalida)
        faltanteSalida -= cubreSalida
        restante -= cubreSalida
      }
      const cubreAjuste = Math.min(faltanteAjuste, restante)
      if (cubreAjuste > 0) {
        ajuste -= parte(cubreAjuste)
        faltanteAjuste -= cubreAjuste
        restante -= cubreAjuste
      }
      cantidad += restante
      valor += valorEntrada - repartido
      continue
    }
    if (m.tipo === 'salida') {
      const cubierto = Math.min(m.cantidadMilli, Math.max(cantidad, 0))
      const costo = costoDeSalida(cubierto, cantidad, valor)
      cantidad -= cubierto
      valor -= costo
      costoVendido += costo
      faltanteSalida += m.cantidadMilli - cubierto
      continue
    }
    // Ajuste: un conteo que no cuadró, una merma, algo que apareció. El delta
    // se valúa al promedio de hoy y **no** entra al costo de ventas: no lo
    // vendiste. Meterlo ahí inflaría el costo de lo que sí se vendió.
    if (m.cantidadMilli < 0) {
      const pedido = -m.cantidadMilli
      const cubierto = Math.min(pedido, Math.max(cantidad, 0))
      const costo = costoDeSalida(cubierto, cantidad, valor)
      cantidad -= cubierto
      valor -= costo
      ajuste -= costo
      faltanteAjuste += pedido - cubierto
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
  /**
   * Ese neto llevado a doce meses. Con menos de doce meses de contrato dentro
   * de la ventana, se anualiza sobre **los que hubo**: un depto que se rentó
   * hace dos meses no rinde al año lo que cobró en dos.
   */
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
 *
 * ⚠ `meses` son los que el contrato **de verdad estuvo vivo** dentro de la
 * ventana, no el largo de la ventana. Con doce fijos, un contrato firmado hace
 * dos meses anualizaba lo cobrado en dos como si fuera un año entero: un depto
 * de $20,000 al mes salía dejando $40,000 anuales, y su tasa, la sexta parte
 * de la que era. Lo que se anualiza es un ritmo, y un ritmo necesita saber
 * sobre cuánto tiempo se midió.
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
  if (meses <= 0) {
    // Un contrato que todavía no empieza no tiene ritmo que anualizar. Es "no
    // se puede decir", no cero: cero se lee como que no deja nada.
    return { netoCents, anualizadoCents: 0, tasaAnualBp: null, tasaSobreCostoBp: null }
  }
  const anualizadoCents = Math.round((netoCents * 12) / meses)
  const tasa = (base: number) =>
    base > 0 ? Math.round((anualizadoCents / base) * 10_000) : null
  return {
    netoCents,
    anualizadoCents,
    tasaAnualBp: tasa(valorCents),
    tasaSobreCostoBp: tasa(costoCents),
  }
}
