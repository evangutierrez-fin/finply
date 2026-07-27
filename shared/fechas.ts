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

/** Días que tiene un mes. `mes` va de 1 a 12. */
export function diasDelMes(anio: number, mes: number): number {
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate()
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
