// Aritmética de crédito: fechas de corte, amortización y meses sin intereses.
//
// Módulo PURO a propósito (R16): no importa nada que abra la base, así las
// pruebas pueden importarlo de forma estática sin riesgo de tocar el libro
// real. Todo el dinero en centavos enteros; todas las fechas texto AAAA-MM-DD.

export interface Amortizacion {
  /** Cuota nivelada del plan. La última fila puede diferir por redondeo. */
  pagoMensualCents: number
  totalPagadoCents: number
  totalInteresCents: number
  filas: FilaAmortizacion[]
}

export interface FilaAmortizacion {
  n: number
  fecha: string
  pagoCents: number
  interesCents: number
  capitalCents: number
  /** Lo que queda por pagar después de esta fila. */
  saldoCents: number
}

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
function correrMes(anio: number, mes: number, meses: number): { anio: number; mes: number } {
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

/** Días completos entre dos fechas. Negativo si `hasta` es anterior. */
export function diasEntre(desde: string, hasta: string): number {
  const a = partesFecha(desde)
  const b = partesFecha(hasta)
  const ms = Date.UTC(b.anio, b.mes - 1, b.dia) - Date.UTC(a.anio, a.mes - 1, a.dia)
  return Math.round(ms / 86_400_000)
}

/**
 * Interés simple devengado sobre un saldo entre dos fechas, con la convención
 * **actual/365**: tasa anual entre 365, por los días que de verdad pasaron.
 *
 * Es una propuesta, no un dogma: el desglose que manda es el del estado de
 * cuenta del banco, y por eso el usuario puede sobrescribirlo. Sirve para que
 * registrar un abono no obligue a sacar la calculadora.
 */
export function interesDevengado(
  saldoCents: number,
  annualRateBp: number,
  desde: string,
  hasta: string,
): number {
  if (annualRateBp <= 0 || saldoCents <= 0) return 0
  const dias = diasEntre(desde, hasta)
  if (dias <= 0) return 0
  return Math.round((saldoCents * (annualRateBp / 10_000) * dias) / 365)
}

/**
 * Reparte un total en N parcialidades enteras que suman **exactamente** el
 * total. El residuo va en la última: es lo que hace el banco, y es lo que
 * evita que doce parcialidades se queden a unos centavos del principal.
 */
export function parcialidades(totalCents: number, meses: number): number[] {
  const base = Math.floor(totalCents / meses)
  const filas = Array.from({ length: meses }, () => base)
  filas[meses - 1] = totalCents - base * (meses - 1)
  return filas
}

/**
 * Fechas en que se factura cada parcialidad. Con día de corte cada una cae en
 * un corte —así se ve en el estado de cuenta—; sin él, mes a mes desde la
 * compra. Se congelan al crear la compra: cambiar después el día de corte de
 * la tarjeta no reescribe un calendario que el usuario ya vio.
 */
export function fechasParcialidades(
  compra: string,
  meses: number,
  diaCorte: number | null,
): string[] {
  if (diaCorte === null) {
    return Array.from({ length: meses }, (_, i) => sumarMeses(compra, i + 1))
  }
  const primera = siguienteDiaDelMes(compra, diaCorte)
  const { anio, mes } = partesFecha(primera)
  return Array.from({ length: meses }, (_, i) => {
    const destino = correrMes(anio, mes, i)
    return fechaConDia(destino.anio, destino.mes, diaCorte)
  })
}

/**
 * Tabla de amortización de cuota nivelada (sistema francés).
 *
 * El interés de cada mes se calcula sobre el saldo insoluto y el resto del
 * pago abona a capital. La última fila cierra el saldo en cero: por eso la
 * suma de la columna de capital da **exactamente** el principal, aunque cada
 * fila esté redondeada al centavo.
 */
export function tablaAmortizacion(params: {
  principalCents: number
  annualRateBp: number
  termMonths: number
  startDate: string
}): Amortizacion {
  const { principalCents, annualRateBp, termMonths, startDate } = params
  const tasaMensual = annualRateBp / 10_000 / 12

  let pago =
    tasaMensual === 0
      ? Math.round(principalCents / termMonths)
      : Math.round(
          (principalCents * tasaMensual) / (1 - Math.pow(1 + tasaMensual, -termMonths)),
        )

  // Con una tasa absurda y un principal diminuto, el redondeo puede dejar la
  // cuota igual al interés del primer mes: la deuda nunca bajaría. Un centavo
  // de más garantiza que el saldo siempre avanza hacia cero.
  const primerInteres = Math.round(principalCents * tasaMensual)
  if (pago <= primerInteres) pago = primerInteres + 1

  const filas: FilaAmortizacion[] = []
  let saldo = principalCents
  for (let n = 1; n <= termMonths && saldo > 0; n++) {
    const interes = Math.round(saldo * tasaMensual)
    // La última fila —o cualquiera que ya alcance— se lleva el saldo completo.
    const capital = n === termMonths || pago - interes >= saldo ? saldo : pago - interes
    saldo -= capital
    filas.push({
      n,
      fecha: sumarMeses(startDate, n),
      pagoCents: capital + interes,
      interesCents: interes,
      capitalCents: capital,
      saldoCents: saldo,
    })
  }

  return {
    pagoMensualCents: pago,
    totalPagadoCents: filas.reduce((s, f) => s + f.pagoCents, 0),
    totalInteresCents: filas.reduce((s, f) => s + f.interesCents, 0),
    filas,
  }
}
