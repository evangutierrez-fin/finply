// Aritmética de fechas. Todas las fechas son texto AAAA-MM-DD: comparar dos
// de ellas es comparar cadenas, y no hay zona horaria que pueda correr un día.
//
// Módulo PURO a propósito (R16): no importa nada que abra la base, así las
// pruebas pueden importarlo de forma estática. Salió de `credito.ts`, donde
// nació para los días de corte, cuando las recurrencias necesitaron lo mismo.

/** Hoy en local, como texto. Sin zona horaria de por medio. */
export function hoyISO(): string {
  return new Date().toLocaleDateString('sv-SE')
}

export function partesFecha(iso: string): { anio: number; mes: number; dia: number } {
  const [anio, mes, dia] = iso.split('-').map(Number)
  return { anio: anio!, mes: mes!, dia: dia! }
}

/** Los días de cada mes en un año común. Febrero se resuelve aparte. */
const DIAS_POR_MES = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

/** La regla gregoriana completa: 2000 fue bisiesto y 1900 no. */
export function esBisiesto(anio: number): boolean {
  return (anio % 4 === 0 && anio % 100 !== 0) || anio % 400 === 0
}

/**
 * Días que tiene un mes. `mes` va de 1 a 12.
 *
 * Es aritmética y no un `Date` a propósito: `Date.UTC` traduce los años de dos
 * dígitos al siglo XX —el año 26 se vuelve 1926—, así que un `Date` daría el
 * febrero equivocado justo donde esto se usa para decidir si una fecha existe.
 */
export function diasDelMes(anio: number, mes: number): number {
  if (mes < 1 || mes > 12) return 0
  return mes === 2 && esBisiesto(anio) ? 29 : DIAS_POR_MES[mes - 1]!
}

/**
 * El año más antiguo que Finply acepta en una fecha.
 *
 * No es un gusto: toda la aritmética de fechas pasa por `Date.UTC`, que mapea
 * los años de 0 a 99 al siglo XX. Una fecha del año 0026 se guardaría tal cual
 * y se calcularía como 1926, y a partir de ahí ninguna cuenta que la toque
 * significa nada. Con cuatro dígitos de verdad eso no puede pasar, y ningún
 * libro de finanzas anota el año 999.
 */
export const ANIO_MINIMO = 1000

/**
 * Si 'AAAA-MM-DD' es un día que de verdad existe.
 *
 * La forma no basta: `2026-02-30` y `2026-13-45` la cumplen y no son fechas.
 * Guardarlas es peor que rechazarlas, porque **ordenan como texto y no como
 * calendario**: un movimiento en el mes 13 baja el saldo de la cuenta y no
 * aparece en ningún reporte del año, así que el libro deja de cuadrar sin que
 * nadie vea dónde. Y `2026-02-30` se convierte en el 2 de marzo en cuanto
 * alguien cuenta días con él, de modo que la misma fecha cae en dos meses
 * distintos según quién la mire.
 */
export function esFechaReal(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false
  const { anio, mes, dia } = partesFecha(iso)
  if (anio < ANIO_MINIMO) return false
  return dia >= 1 && dia <= diasDelMes(anio, mes)
}

/**
 * Arma AAAA-MM-DD recortando el día al último del mes: un corte el 31 cae el
 * 28 en febrero (29 en bisiesto) y el 30 en abril. Sin esto, la mitad de las
 * tarjetas del mundo real generan fechas que no existen.
 */
export function fechaConDia(anio: number, mes: number, dia: number): string {
  const d = Math.min(Math.max(dia, 1), diasDelMes(anio, mes))
  return `${String(anio).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/**
 * El último día del mes de una fecha. Es el horizonte de la pregunta "¿llego a
 * fin de mes?", y va aquí y no en la vista porque el servidor y el cliente
 * tienen que estar mirando el mismo día.
 */
export function finDeMes(iso: string): string {
  const { anio, mes } = partesFecha(iso)
  return fechaConDia(anio, mes, diasDelMes(anio, mes))
}

/** Mueve (anio, mes) N meses, con el mes de 1 a 12. */
export function correrMes(anio: number, mes: number, meses: number): { anio: number; mes: number } {
  const total = anio * 12 + (mes - 1) + meses
  return { anio: Math.floor(total / 12), mes: (((total % 12) + 12) % 12) + 1 }
}

/** Suma meses conservando el día, recortado si el mes destino es más corto. */
export function sumarMeses(iso: string, meses: number): string {
  const { anio, mes, dia } = partesFecha(iso)
  const destino = correrMes(anio, mes, meses)
  return fechaConDia(destino.anio, destino.mes, dia)
}

/**
 * El corte más reciente que ya ocurrió, contando `hoy` como corte si cae justo
 * ese día. Se calcula desde el día pelón —no desde una fecha ya recortada—
 * para que un corte 31 no se quede pegado en el 28 después de febrero.
 */
export function ultimoCorte(hoy: string, diaCorte: number): string {
  const { anio, mes } = partesFecha(hoy)
  const enCurso = fechaConDia(anio, mes, diaCorte)
  if (enCurso <= hoy) return enCurso
  const previo = correrMes(anio, mes, -1)
  return fechaConDia(previo.anio, previo.mes, diaCorte)
}

/**
 * El primer día `dia` estrictamente posterior a `desde`. Es cómo cae la fecha
 * límite de pago: en el mismo mes del corte si el día de pago es mayor, y en
 * el siguiente si es menor.
 */
export function siguienteDiaDelMes(desde: string, dia: number): string {
  const { anio, mes } = partesFecha(desde)
  const enCurso = fechaConDia(anio, mes, dia)
  if (enCurso > desde) return enCurso
  const sig = correrMes(anio, mes, 1)
  return fechaConDia(sig.anio, sig.mes, dia)
}

/**
 * El primer día `dia` que cae **en o después** de `desde`. Es la variante que
 * necesita el calendario: si tu tarjeta corta hoy, el próximo corte es hoy, no
 * el del mes que viene.
 */
export function proximoDiaDelMes(desde: string, dia: number): string {
  const { anio, mes } = partesFecha(desde)
  const enCurso = fechaConDia(anio, mes, dia)
  if (enCurso >= desde) return enCurso
  const sig = correrMes(anio, mes, 1)
  return fechaConDia(sig.anio, sig.mes, dia)
}

/** Días completos entre dos fechas. Negativo si `hasta` es anterior. */
export function diasEntre(desde: string, hasta: string): number {
  const a = partesFecha(desde)
  const b = partesFecha(hasta)
  const ms = Date.UTC(b.anio, b.mes - 1, b.dia) - Date.UTC(a.anio, a.mes - 1, a.dia)
  return Math.round(ms / 86_400_000)
}

/** Suma (o resta) días naturales. Cruza meses y años sin ayuda. */
export function sumarDias(iso: string, dias: number): string {
  const { anio, mes, dia } = partesFecha(iso)
  const d = new Date(Date.UTC(anio, mes - 1, dia + dias))
  return d.toISOString().slice(0, 10)
}

/** Día de la semana en convención ISO: 1 = lunes … 7 = domingo. */
export function diaSemanaISO(iso: string): number {
  const { anio, mes, dia } = partesFecha(iso)
  const js = new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay()
  return js === 0 ? 7 : js
}

/**
 * Semana ISO 8601 de una fecha: el año y el número de semana.
 *
 * La semana va de lunes a domingo y la semana 1 es la que contiene el 4 de
 * enero. Por eso el **año de la semana** no siempre es el año de la fecha: el
 * 1 de enero de 2027 cae en la semana 53 de 2026. Se usa como clave de
 * idempotencia, así que tiene que ser estable: cualquier día de la misma
 * semana da la misma clave, y eso es justo lo que permite mover una
 * recurrencia de lunes a miércoles sin que se reproponga el periodo.
 */
export function semanaISO(iso: string): { anio: number; semana: number } {
  // El jueves de la semana manda: su año es el año ISO de toda la semana.
  const jueves = sumarDias(iso, 4 - diaSemanaISO(iso))
  const { anio } = partesFecha(jueves)
  const enero1 = `${String(anio).padStart(4, '0')}-01-01`
  return { anio, semana: Math.floor(diasEntre(enero1, jueves) / 7) + 1 }
}

/**
 * Cuánto lleva transcurrido un periodo de presupuesto, de 0 a 1.
 *
 * Es la mitad que le faltaba a la barra de presupuestos: gastar el 80 % del
 * tope el día 3 y gastarlo el día 28 son dos noticias opuestas, y hasta hoy se
 * pintaban idénticas. El periodo es 'AAAA-MM' o 'AAAA', el mismo texto que
 * guarda `budgets.period`.
 *
 * Un periodo ya cerrado vale 1 y uno que no empieza vale 0: el ritmo solo
 * tiene algo que decir mientras el periodo corre. Se cuenta por **días
 * completos vividos**, con el día en curso incluido —el día 1 de un mes de 31
 * vale 1/31, no 0—, porque el gasto de hoy ya está hecho.
 */
export function avanceDelPeriodo(periodo: string, hoy: string): number {
  const anual = periodo.length === 4
  const actual = anual ? hoy.slice(0, 4) : hoy.slice(0, 7)
  if (periodo < actual) return 1
  if (periodo > actual) return 0

  const { anio, mes, dia } = partesFecha(hoy)
  if (!anual) return dia / diasDelMes(anio, mes)

  const transcurridos = diasEntre(`${String(anio).padStart(4, '0')}-01-01`, hoy) + 1
  const delAnio = diasEntre(`${anio}-01-01`, `${anio + 1}-01-01`)
  return transcurridos / delAnio
}

/** Mueve un mes 'AAAA-MM' N meses, como texto. */
export function correrMesTexto(mes: string, meses: number): string {
  const [anio, m] = mes.split('-').map(Number)
  const destino = correrMes(anio!, m!, meses)
  return `${String(destino.anio).padStart(4, '0')}-${String(destino.mes).padStart(2, '0')}`
}

/**
 * Meses entre dos 'AAAA-MM', **contando los dos extremos**: de julio a julio es
 * 1, y de julio a septiembre son 3.
 *
 * Vive aquí por lo mismo que `correrMesTexto`. Esta cuenta estaba escrita otra
 * vez en los reportes y otra vez en el panel de análisis, palabra por palabra,
 * y las dos deciden divisores —el promedio de gasto de un periodo, la ventana
 * de la comparativa—. Dos aritméticas que tienen que coincidir son dos
 * aritméticas que se separan, y estas dividen dinero.
 */
export function mesesEntreTexto(desde: string, hasta: string): number {
  const [ya, ma] = desde.split('-').map(Number)
  const [yb, mb] = hasta.split('-').map(Number)
  return yb! * 12 + mb! - (ya! * 12 + ma!) + 1
}
