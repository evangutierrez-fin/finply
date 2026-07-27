// Recurrencias: qué periodos genera una plantilla y cómo se llama cada uno.
//
// Módulo PURO a propósito (R16): no importa nada que abra la base, así el
// servidor y el cliente calculan lo mismo —el cliente lo necesita para avisar
// "esto va a proponer 30 partidas" antes de guardar (D8)— y las pruebas pueden
// importarlo de forma estática.
//
// Lo único que hay que entender de aquí es **la clave de periodo**. Es la
// mitad de la llave de idempotencia de R5, junto con la plantilla:
//
//   mensual    2026-07
//   quincenal  2026-07-Q1, 2026-07-Q2
//   semanal    2026-W31   (semana ISO, de lunes a domingo)
//   anual      2026
//
// La clave nombra el **hueco**, no el día: por eso cambiar el día 1 al día 5
// de una renta —o el lunes por el miércoles de algo semanal— no reproduce el
// histórico entero como propuestas nuevas. Si esa clave cambiara de forma, se
// duplicaría todo lo ya asentado.
//
// Y hay un solo generador, sin función inversa: para saber la fecha de un
// periodo se genera la ventana que la contiene y se busca la clave. Dos
// aritméticas que tienen que coincidir son dos aritméticas que se separan.

import {
  correrMes,
  diaSemanaISO,
  diasDelMes,
  fechaConDia,
  partesFecha,
  semanaISO,
  sumarDias,
} from './fechas.ts'

export type Frecuencia = 'mensual' | 'quincenal' | 'semanal' | 'anual'

/** Lo que define **cuándo** cae una recurrencia. Sin dinero ni cuentas. */
export interface ReglaRecurrencia {
  frequency: Frecuencia
  /** Día del mes (mensual, anual y primera quincena). Se recorta en meses cortos. */
  dayOfMonth: number | null
  /** Día de la segunda quincena. 31 significa "el último del mes". */
  dayOfMonth2: number | null
  /** Mes del año, solo anual. */
  monthOfYear: number | null
  /** Día de la semana ISO (1 = lunes … 7 = domingo), solo semanal. */
  weekday: number | null
  startDate: string
  /** Sin fin mientras sea `null`. */
  endDate: string | null
}

export interface Ocurrencia {
  periodo: string
  fecha: string
}

/**
 * Tope de periodos que se generan de una sola plantilla. Una plantilla vieja
 * —o semanal desde hace años— no puede devolver una lista sin fin: son 50 años
 * de algo mensual y 11 de algo semanal. Lo que se recorta es lo más nuevo,
 * porque un atraso se pone al día del periodo más viejo hacia acá.
 */
export const MAX_PERIODOS = 600

const pad2 = (n: number) => String(n).padStart(2, '0')

/**
 * Completa la regla con lo que falte, tomándolo de la fecha de inicio: si
 * empiezas una renta el 5 de agosto, el día del mes es el 5 sin que nadie lo
 * escriba. La segunda quincena por omisión es el último día del mes.
 */
export function normalizarRegla(regla: ReglaRecurrencia): ReglaRecurrencia {
  const { mes, dia } = partesFecha(regla.startDate)
  return {
    frequency: regla.frequency,
    dayOfMonth: regla.frequency === 'semanal' ? null : (regla.dayOfMonth ?? dia),
    dayOfMonth2: regla.frequency === 'quincenal' ? (regla.dayOfMonth2 ?? 31) : null,
    monthOfYear: regla.frequency === 'anual' ? (regla.monthOfYear ?? mes) : null,
    weekday: regla.frequency === 'semanal' ? (regla.weekday ?? diaSemanaISO(regla.startDate)) : null,
    startDate: regla.startDate,
    endDate: regla.endDate,
  }
}

export interface Ventana {
  /** Piso inclusivo. Por omisión, la fecha de inicio de la plantilla. */
  desde?: string
  /** Techo inclusivo. */
  hasta: string
  max?: number
}

/**
 * Las ocurrencias de una plantilla dentro de una ventana, en orden de fecha.
 *
 * Los huecos son **absolutos**, no relativos a la fecha de inicio: el día 15
 * de cada mes es el día 15 de cada mes, se haya empezado en enero o en marzo.
 * Por eso se puede arrancar la generación desde cualquier fecha sin recorrer
 * el histórico completo, que es lo que hace barato el calendario.
 */
export function ocurrencias(
  regla: ReglaRecurrencia,
  ventana: Ventana,
): { lista: Ocurrencia[]; truncado: boolean } {
  const r = normalizarRegla(regla)
  const max = ventana.max ?? MAX_PERIODOS
  const desde = ventana.desde && ventana.desde > r.startDate ? ventana.desde : r.startDate
  const hasta = r.endDate && r.endDate < ventana.hasta ? r.endDate : ventana.hasta

  const lista: Ocurrencia[] = []
  if (hasta < desde || max <= 0) return { lista, truncado: false }

  let truncado = false
  /**
   * Devuelve false cuando ya no cabe nada más. El tope se revisa **antes** de
   * agregar: así una lista de exactamente `max` no se reporta como recortada.
   */
  const agregar = (periodo: string, fecha: string): boolean => {
    if (fecha < desde || fecha > hasta) return true
    if (lista.length >= max) {
      truncado = true
      return false
    }
    lista.push({ periodo, fecha })
    return true
  }

  if (r.frequency === 'semanal') {
    const objetivo = r.weekday!
    // El primer día de la semana pedido que cae en o después de `desde`.
    let fecha = sumarDias(desde, (objetivo - diaSemanaISO(desde) + 7) % 7)
    while (fecha <= hasta) {
      const { anio, semana } = semanaISO(fecha)
      if (!agregar(`${anio}-W${pad2(semana)}`, fecha)) break
      fecha = sumarDias(fecha, 7)
    }
    return { lista, truncado }
  }

  if (r.frequency === 'anual') {
    const mes = r.monthOfYear!
    const dia = r.dayOfMonth!
    for (let anio = partesFecha(desde).anio; anio <= partesFecha(hasta).anio; anio++) {
      if (!agregar(String(anio), fechaConDia(anio, mes, dia))) break
    }
    return { lista, truncado }
  }

  // Mensual y quincenal recorren mes por mes. El techo del recorrido es el mes
  // de `hasta`, así que el ciclo termina siempre.
  const inicio = partesFecha(desde)
  const fin = partesFecha(hasta)
  const meses = (fin.anio * 12 + fin.mes) - (inicio.anio * 12 + inicio.mes)
  for (let i = 0; i <= meses; i++) {
    const { anio, mes } = correrMes(inicio.anio, inicio.mes, i)
    const ym = `${String(anio).padStart(4, '0')}-${pad2(mes)}`
    if (r.frequency === 'mensual') {
      if (!agregar(ym, fechaConDia(anio, mes, r.dayOfMonth!))) break
      continue
    }
    // Las dos quincenas se ordenan por fecha, pero su clave es la del hueco:
    // Q1 siempre es el primer día configurado, aunque caiga después que Q2.
    const quincenas = [
      { periodo: `${ym}-Q1`, fecha: fechaConDia(anio, mes, r.dayOfMonth!) },
      { periodo: `${ym}-Q2`, fecha: fechaConDia(anio, mes, r.dayOfMonth2!) },
    ].sort((a, b) => a.fecha.localeCompare(b.fecha))
    let cabe = true
    for (const q of quincenas) {
      if (!agregar(q.periodo, q.fecha)) {
        cabe = false
        break
      }
    }
    if (!cabe) break
  }
  return { lista, truncado }
}

/** La primera ocurrencia en o después de `desde`, si la hay antes de `hasta`. */
export function proximaOcurrencia(
  regla: ReglaRecurrencia,
  desde: string,
  hasta: string,
): Ocurrencia | null {
  return ocurrencias(regla, { desde, hasta, max: 1 }).lista[0] ?? null
}

/**
 * La ventana mínima de fechas que puede contener un periodo, leída de su
 * clave. Es lo que permite resolver una clave sin función inversa: se genera
 * este pedacito y se busca la que coincide.
 */
function ventanaDeClave(periodo: string): { desde: string; hasta: string } | null {
  let m = /^(\d{4})$/.exec(periodo)
  if (m) return { desde: `${m[1]}-01-01`, hasta: `${m[1]}-12-31` }

  m = /^(\d{4})-(\d{2})(-Q[12])?$/.exec(periodo)
  if (m) {
    const anio = Number(m[1])
    const mes = Number(m[2])
    if (mes < 1 || mes > 12) return null
    return { desde: `${m[1]}-${m[2]}-01`, hasta: fechaConDia(anio, mes, diasDelMes(anio, mes)) }
  }

  // Una semana ISO desborda su año por los dos lados: la semana 1 puede
  // empezar el 29 de diciembre y la última terminar el 3 de enero.
  m = /^(\d{4})-W(\d{2})$/.exec(periodo)
  if (m) {
    const anio = Number(m[1])
    return { desde: `${anio - 1}-12-28`, hasta: `${anio + 1}-01-04` }
  }
  return null
}

/**
 * La fecha que le toca a un periodo de esta plantilla, o `null` si esa clave
 * no es suya: mal formada, de otra periodicidad, o fuera de su vigencia.
 * Es la validación que protege a `asentar` de escribir un periodo inventado.
 */
export function fechaDeOcurrencia(regla: ReglaRecurrencia, periodo: string): string | null {
  const ventana = ventanaDeClave(periodo)
  if (!ventana) return null
  const { lista } = ocurrencias(regla, { ...ventana, max: 64 })
  return lista.find((o) => o.periodo === periodo)?.fecha ?? null
}

const DIAS_SEMANA = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']
const MESES_LARGOS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

/** El día 31 es "el último": en febrero cae el 28 y nadie lo escribió así. */
function diaTexto(dia: number): string {
  return dia === 31 ? 'el último día' : `el ${dia}`
}

/** Cómo se lee una periodicidad. La usan la lista, el calendario y el modal. */
export function describirRecurrencia(regla: ReglaRecurrencia): string {
  const r = normalizarRegla(regla)
  switch (r.frequency) {
    case 'mensual':
      return `Cada mes, ${diaTexto(r.dayOfMonth!)}`
    case 'quincenal': {
      const dias = [r.dayOfMonth!, r.dayOfMonth2!].sort((a, b) => a - b)
      return `Cada quincena, ${diaTexto(dias[0]!)} y ${diaTexto(dias[1]!)}`
    }
    case 'semanal':
      return `Cada semana, los ${DIAS_SEMANA[r.weekday! - 1]}`
    case 'anual':
      return `Cada año, el ${r.dayOfMonth} de ${MESES_LARGOS[r.monthOfYear! - 1]}`
  }
}
