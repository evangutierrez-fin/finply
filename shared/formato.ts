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

/**
 * Techo de cualquier cifra de dinero: un billón de pesos, en centavos.
 *
 * **No es una opinión sobre qué es mucho dinero: es lo que impide que el libro
 * se rompa.** Los centavos viven en columnas INTEGER de SQLite, que son de 64
 * bits, y `node:sqlite` se niega a *devolver* un entero que JavaScript no pueda
 * representar exacto — por encima de 2^53 lanza `RangeError`. Un dedazo de
 * ceros de más pasaba la validación, el INSERT lo escribía sin quejarse, y de
 * ahí en adelante **cualquier lectura de esa cuenta contestaba un 500**: la
 * partida quedaba dentro del libro y no había pantalla capaz de enseñarla ni
 * formulario capaz de corregirla. Es el peor modo de fallar que hay — el que
 * deja el dato adentro y la puerta cerrada.
 *
 * Por la puerta del CSV era distinto y peor: `parseMonto` devolvía `1e22`, que
 * es finito y no es entero, y el saldo de la cuenta pasaba a ser un flotante.
 *
 * Vive aquí, y no en el validador, porque son **tres puertas** las que escriben
 * dinero y las tres tienen que estar de acuerdo: la API (`server/validators`),
 * el import de CSV (`server/valores`, que no pasa por el validador) y el
 * formulario (`src/format`, que lo dice antes de mandar la petición). Es la
 * misma razón por la que `esFechaReal` acabó en `shared/fechas`.
 *
 * Un billón deja noventa partidas en el tope antes de acercarse al entero
 * seguro, y es la cifra que ya acotaba el objetivo del simulador.
 */
export const MAX_CENTAVOS = 1_000_000_000_000_00

/**
 * Si lo que se escribió **es** una cantidad y lo único que le pasa es que no
 * cabe en el libro.
 *
 * Existe porque leer un monto puede fallar por dos razones muy distintas y los
 * formularios solo sabían decir una: quien tecleaba veinte dígitos recibía
 * "escribe un monto, por ejemplo 250 o 1,250.50" —la guía correcta y una
 * respuesta absurda, porque sí escribió un monto—. La cifra no llega al libro
 * en ninguno de los dos casos, para eso está `MAX_CENTAVOS`; lo que faltaba era
 * decirle cuál de los dos es el suyo.
 *
 * Vive aquí y no en el formulario por lo mismo que el techo: se equivoca en
 * silencio y en un `.tsx` no se puede probar.
 */
export function montoPasaDelTecho(raw: string): boolean {
  const limpio = raw.replace(/[$,\s]/g, '')
  if (!/^-?\d+(\.\d{1,2})?$/.test(limpio)) return false
  const cents = Math.round(parseFloat(limpio) * 100)
  return !Number.isSafeInteger(cents) || Math.abs(cents) > MAX_CENTAVOS
}

/** El techo escrito como se lee, para poder ponerlo dentro de la frase. */
function techoEnPesos(): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    maximumFractionDigits: 0,
  }).format(MAX_CENTAVOS / 100)
}

/**
 * El mensaje que le toca a un monto que no se pudo leer.
 *
 * `base` es lo que cada formulario ya decía, con su propia voz —"para el
 * presupuesto", "para el tope del mes"—: se conserva, y solo se sustituye
 * cuando la razón de verdad es otra. Un solo lugar decide la frase del techo,
 * así que las nueve puertas que piden un monto no pueden acabar diciendo nueve
 * cosas distintas de lo mismo.
 */
export function mensajeMonto(raw: string, base: string): string {
  if (!montoPasaDelTecho(raw)) return base
  return `Esa cifra pasa de ${techoEnPesos()}, que es el tope de un libro de Finply. Revisa los ceros.`
}

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
  return new Intl.NumberFormat('es-MX', opciones).format(sinCeroNegativo(cents) / 100)
}

/**
 * El cero no tiene signo.
 *
 * JavaScript sí tiene `-0`, e `Intl` lo escribe `-$0.00`. Aparece en cuanto
 * una vista niega una cifra para enseñarla como salida —`-data.expenseCents`—
 * y el mes no tuvo gastos: el Resumen decía "Salió −$0.00". Ni siquiera sale
 * en rojo, porque `-0 < 0` es falso, así que es solo un signo que sobra.
 *
 * Se arregla aquí y no en la vista porque las vistas que niegan una cifra son
 * muchas y la puerta por la que se escribe el dinero es una.
 */
export function sinCeroNegativo(cents: number): number {
  return cents === 0 ? 0 : cents
}
