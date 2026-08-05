// Aritmética de inversiones: el recorrido del historial y las unidades.
//
// Módulo PURO a propósito (R16): no importa nada que abra la base, así las
// pruebas pueden importarlo de forma estática y la vista puede dibujar la
// misma serie que calcula el servidor.
//
// Existe porque el recorrido estaba escrito tres veces —en `db.ts`, en
// `reportes.ts` y en la minigráfica de la vista— y las tres tenían que dar el
// mismo número. Tres copias de una aritmética que debe coincidir son tres
// aritméticas que se separan.
//
// **Las unidades son enteros escalados por 10⁸**, no flotantes: un satoshi
// (0.00000001) es exacto y en la base no entra un solo `REAL`. Es la misma
// razón por la que el dinero va en centavos enteros.

/** Un entero de unidades vale esto: 1 unidad = 100 000 000. */
export const UNIDAD = 100_000_000

/** Ocho decimales: lo que necesita un satoshi y de sobra para un fondo. */
export const DECIMALES_UNIDAD = 8

/**
 * Tope de unidades por registro. `unitsE8` es un entero de JavaScript y por
 * encima de 2^53 dejan de serlo: 90 000 000 de unidades caben con holgura y
 * el que las rebase recibe un mensaje en vez de un número redondeado en
 * silencio.
 */
export const MAX_UNIDADES_E8 = 9_000_000_000_000_000

export type TipoEntrada = 'aporte' | 'retiro' | 'valuacion'

export interface EntradaInversion {
  id: number
  type: TipoEntrada
  amountCents: number
  date: string
  /** Unidades del movimiento, ×10⁸. `null` cuando la inversión no las lleva. */
  unitsE8: number | null
  /** Precio por unidad en centavos. En una valuación, manda sobre el monto. */
  unitPriceCents: number | null
}

export interface PuntoValor {
  date: string
  valueCents: number
  unitsE8: number
}

export interface Recorrido {
  /** Suma de los aportes, sin restar nada. */
  aportadoCents: number
  /** Suma de los retiros. */
  retiradoCents: number
  /**
   * Aportado menos retirado, **con piso en cero**: retirar más de lo que
   * pusiste no deja un "aportado" negativo, que no significa nada en pantalla
   * y voltea el signo de cualquier porcentaje que se calcule con él.
   */
  investedCents: number
  valueCents: number
  unitsE8: number
  /**
   * Ganancia real: lo que vale hoy más lo que ya sacaste, menos lo que
   * pusiste. No depende del piso de `investedCents`, y por eso sigue siendo
   * correcta cuando ya retiraste más de lo aportado.
   */
  gananciaCents: number
  /**
   * Lo que te costó **lo que todavía tienes**: los aportes menos la parte que
   * se llevó cada retiro. No es "aportado menos retirado": si sacaste con
   * ganancia, parte de lo que sacaste era ganancia y no costo.
   */
  costoCents: number
  /** Ganancia ya cobrada: de cada retiro, lo que iba por encima de su costo. */
  gananciaRealizadaCents: number
  /** Ganancia en papel: lo que vale hoy menos lo que costó. Todavía no es tuya. */
  gananciaEnPapelCents: number
  /** El valor después de cada registro, en orden. Es la serie de la gráfica. */
  puntos: PuntoValor[]
}

/**
 * Valor de una posición: unidades por precio, en enteros.
 *
 * La multiplicación va en `BigInt` porque `unitsE8 × precio` se sale del
 * entero seguro de JavaScript con cantidades perfectamente normales (10 000
 * títulos a $1 000 ya son 10^19), y ahí el redondeo dejaría de ser exacto.
 */
export function valorDeUnidades(unitsE8: number, unitPriceCents: number): number {
  const u = BigInt(Math.round(unitsE8))
  const p = BigInt(Math.round(unitPriceCents))
  const escala = BigInt(UNIDAD)
  const bruto = u * p
  // Redondeo al centavo más cercano, con el medio hacia arriba en magnitud.
  const medio = escala / 2n
  const redondeado = bruto >= 0n ? (bruto + medio) / escala : (bruto - medio) / escala
  return Number(redondeado)
}

/**
 * Recorre el historial de una inversión y devuelve sus totales y su serie.
 *
 * El orden manda: una valuación **fija** el valor y los aportes y retiros
 * posteriores lo ajustan, así que esto no es una suma que SQL pueda agregar
 * (nota de la Fase 4). Se ordena aquí dentro para que ningún llamador dependa
 * de haberlo hecho antes.
 *
 * Una valuación con precio por unidad se calcula **al vuelo** contra las
 * unidades que había en ese momento. Así, si mañana aparece un aporte con
 * fecha vieja, la valuación no se queda con el número de ayer: el precio es el
 * dato, el valor es la consecuencia.
 *
 * **El costo se consume a prorrata** (D31), no por PEPS: un retiro se lleva la
 * misma fracción del costo que se llevó del valor. Es la misma elección que
 * D29 hizo para el inventario —promedio ponderado— y por lo mismo: Finply no
 * guarda qué unidad concreta vendiste, así que fingir un orden sería inventar
 * un dato. De ahí salen las dos mitades de la ganancia, y suman **exactamente**
 * la de siempre sin importar cómo redondee la prorrata: lo que se le resta al
 * costo es lo mismo que se le suma a la realizada.
 */
export function recorrer(entradas: EntradaInversion[]): Recorrido {
  const orden = [...entradas].sort((a, b) =>
    a.date === b.date ? a.id - b.id : a.date < b.date ? -1 : 1,
  )

  let aportadoCents = 0
  let retiradoCents = 0
  let valueCents = 0
  let unitsE8 = 0
  let costoCents = 0
  let realizadaCents = 0
  const puntos: PuntoValor[] = []

  for (const e of orden) {
    if (e.type === 'aporte') {
      aportadoCents += e.amountCents
      valueCents += e.amountCents
      costoCents += e.amountCents
      unitsE8 += e.unitsE8 ?? 0
    } else if (e.type === 'retiro') {
      retiradoCents += e.amountCents
      // La parte del costo que se va con este retiro: la misma proporción del
      // valor que se está sacando, nunca más de lo que queda de costo. Sin
      // valor que repartir no hay costo que consumir, y entonces el retiro
      // entero es ganancia cobrada — que es lo que significa sacar dinero de
      // algo que ya no vale nada en libros.
      const costoRetirado =
        valueCents > 0
          ? Math.min(costoCents, Math.round((costoCents * e.amountCents) / valueCents))
          : 0
      costoCents -= costoRetirado
      realizadaCents += e.amountCents - costoRetirado
      valueCents = Math.max(0, valueCents - e.amountCents)
      unitsE8 = Math.max(0, unitsE8 - (e.unitsE8 ?? 0))
    } else if (e.unitPriceCents !== null) {
      valueCents = valorDeUnidades(unitsE8, e.unitPriceCents)
    } else {
      valueCents = e.amountCents
    }
    puntos.push({ date: e.date, valueCents, unitsE8 })
  }

  return {
    aportadoCents,
    retiradoCents,
    investedCents: Math.max(0, aportadoCents - retiradoCents),
    valueCents,
    unitsE8,
    gananciaCents: valueCents + retiradoCents - aportadoCents,
    costoCents,
    gananciaRealizadaCents: realizadaCents,
    gananciaEnPapelCents: valueCents - costoCents,
    puntos,
  }
}

/** Un renglón del reparto de la cartera: un tipo y lo que pesa. */
export interface RenglonCartera {
  kind: string
  valueCents: number
  /** Su parte del total, en puntos base enteros: 2500 = 25 %. */
  parteBp: number
}

/**
 * Cómo está repartida la cartera por tipo, de la tajada más grande a la más
 * chica. Es el mismo ángulo que la concentración del gasto por categoría, con
 * la misma respuesta útil: la primera línea dice de qué depende tu dinero.
 *
 * La parte va en **puntos base enteros** y la más grande absorbe el residuo,
 * así que las tajadas suman 10 000 exactos y la vista nunca enseña un reparto
 * que dé 99 %. Los tipos sin valor no aparecen: un renglón en cero no es
 * información, es ruido. Nada de esto recomienda un reparto (R9): dice el que
 * hay.
 */
export function repartoPorTipo(
  inversiones: { kind: string; valueCents: number }[],
): RenglonCartera[] {
  const porTipo = new Map<string, number>()
  for (const i of inversiones) {
    porTipo.set(i.kind, (porTipo.get(i.kind) ?? 0) + i.valueCents)
  }
  const filas = [...porTipo.entries()]
    .filter(([, cents]) => cents > 0)
    .map(([kind, valueCents]) => ({ kind, valueCents, parteBp: 0 }))
    .sort((a, b) => b.valueCents - a.valueCents || a.kind.localeCompare(b.kind))

  const total = filas.reduce((s, f) => s + f.valueCents, 0)
  if (total <= 0) return filas
  let repartido = 0
  filas.forEach((f, i) => {
    f.parteBp =
      i === 0 ? 0 : Math.round((f.valueCents * 10_000) / total)
    if (i > 0) repartido += f.parteBp
  })
  if (filas[0]) filas[0].parteBp = 10_000 - repartido
  return filas
}

/**
 * Texto → unidades ×10⁸, o `null` si no es una cantidad.
 *
 * Acepta el separador de miles y hasta ocho decimales. Más de ocho se rechaza
 * en vez de redondearse: cambiarle la cifra al usuario en silencio es peor que
 * decirle que no cabe. Sigue la misma convención que `parseMonto`, con el
 * último separador como decimal.
 */
export function parseUnidades(raw: string): number | null {
  let texto = raw.trim()
  if (!texto) return null
  texto = texto.replace(/[\s ]/g, '')
  if (texto.startsWith('+')) texto = texto.slice(1)
  if (!/^[\d.,]+$/.test(texto)) return null

  const ultimaComa = texto.lastIndexOf(',')
  const ultimoPunto = texto.lastIndexOf('.')
  let entero = texto
  let decimales = ''

  if (ultimaComa >= 0 && ultimoPunto >= 0) {
    const corte = Math.max(ultimaComa, ultimoPunto)
    entero = texto.slice(0, corte)
    decimales = texto.slice(corte + 1)
  } else if (ultimaComa >= 0 || ultimoPunto >= 0) {
    const corte = Math.max(ultimaComa, ultimoPunto)
    const cola = texto.slice(corte + 1)
    // Tres dígitos detrás de un separador único son miles, no decimales:
    // "1,234" son mil doscientas treinta y cuatro unidades.
    if (cola.length === 3 && corte > 0) entero = texto
    else {
      entero = texto.slice(0, corte)
      decimales = cola
    }
  }

  if (entero !== '' && !/^\d+$/.test(entero) && !/^\d{1,3}([.,]\d{3})+$/.test(entero)) return null
  entero = entero.replace(/[.,]/g, '')
  if (!/^\d*$/.test(decimales)) return null
  if (entero === '' && decimales === '') return null
  if (decimales.length > DECIMALES_UNIDAD) return null

  const e8 = Number(entero || '0') * UNIDAD + Number(decimales.padEnd(DECIMALES_UNIDAD, '0') || '0')
  if (!Number.isSafeInteger(e8) || e8 > MAX_UNIDADES_E8) return null
  return e8
}

/**
 * Unidades ×10⁸ → texto, sin ceros de relleno. 1.5 se escribe "1.5" y no
 * "1.50000000", que se lee como precisión que nadie declaró.
 */
export function fmtUnidades(unitsE8: number): string {
  const negativo = unitsE8 < 0
  const abs = Math.abs(Math.round(unitsE8))
  const entero = Math.floor(abs / UNIDAD)
  const resto = String(abs % UNIDAD).padStart(DECIMALES_UNIDAD, '0').replace(/0+$/, '')
  const miles = entero.toLocaleString('es-MX')
  return `${negativo ? '-' : ''}${miles}${resto ? `.${resto}` : ''}`
}

/**
 * Precio implícito de un movimiento: monto entre unidades. Sirve para
 * rellenar el precio cuando el usuario escribe monto y unidades, y al revés.
 */
export function precioImplicito(amountCents: number, unitsE8: number): number | null {
  if (unitsE8 <= 0) return null
  const bruto = BigInt(Math.round(amountCents)) * BigInt(UNIDAD)
  const u = BigInt(Math.round(unitsE8))
  return Number((bruto + u / 2n) / u)
}
