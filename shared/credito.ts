// Aritmética de crédito: amortización, meses sin intereses e intereses
// devengados.
//
// Módulo PURO a propósito (R16): no importa nada que abra la base, así las
// pruebas pueden importarlo de forma estática sin riesgo de tocar el libro
// real. Todo el dinero en centavos enteros; todas las fechas texto AAAA-MM-DD.
//
// Las fechas viven en `shared/fechas.ts`: dejaron de ser solo de crédito
// cuando las recurrencias necesitaron el mismo recorte de día.

import { correrMes, diasEntre, fechaConDia, partesFecha, siguienteDiaDelMes, sumarMeses } from './fechas.ts'

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

// ── El pago mínimo de la tarjeta ──────────────────────────────────────────
//
// La tarjeta era la única deuda de Finply **sin interés modelado**, y es la
// más cara que tiene cualquiera: una deuda con tasa y plazo enseña su tabla de
// amortización, y la tarjeta enseñaba nada más el saldo.
//
// Nada de aquí es de un banco ni de un país (R15): el usuario escribe su tasa,
// su porcentaje de pago mínimo y su piso, que es lo que dice su contrato. Y
// nada de aquí es un consejo (R9): es su aritmética con sus supuestos.

/** Hasta dónde se simula antes de declarar que esto no termina. */
const TOPE_MESES = 600

export interface PlanPagoMinimo {
  /** Meses hasta liquidar. `null` si con el mínimo nunca se liquida. */
  meses: number | null
  totalPagadoCents: number
  totalInteresCents: number
  /** El primer pago mínimo, que es el que el usuario reconoce del estado. */
  primerPagoCents: number
  /**
   * Verdadero cuando el mínimo no alcanza ni para el interés del mes: el saldo
   * sube en vez de bajar y la deuda no se acaba nunca. Es la respuesta honesta,
   * no un error.
   */
  nuncaTermina: boolean
}

/**
 * El pago mínimo de un corte: un porcentaje del saldo, con piso, y nunca más
 * que el saldo entero. Así lo calculan los contratos — el piso existe justo
 * para que un saldo chico no se pague en cien años.
 */
export function pagoMinimo(
  saldoCents: number,
  minPaymentBp: number,
  floorCents: number | null,
): number {
  if (saldoCents <= 0) return 0
  const porcentaje = Math.round((saldoCents * minPaymentBp) / 10_000)
  return Math.min(saldoCents, Math.max(porcentaje, floorCents ?? 0))
}

/**
 * Qué pasa si solo pagas el mínimo, mes a mes: se devenga el interés del
 * periodo sobre el saldo, se abona el mínimo y se repite.
 *
 * El interés se aplica **antes** del pago, que es el orden del estado de
 * cuenta, y la simulación supone que no vuelves a usar la tarjeta. Ese
 * supuesto va escrito en la vista: es optimista a propósito, porque incluso
 * así la cifra asusta.
 */
export function simularPagoMinimo(params: {
  saldoCents: number
  annualRateBp: number
  minPaymentBp: number
  floorCents: number | null
  /** Un pago fijo del usuario en vez del mínimo, para poder comparar. */
  pagoFijoCents?: number
}): PlanPagoMinimo {
  const { saldoCents, annualRateBp, minPaymentBp, floorCents, pagoFijoCents } = params
  const vacio: PlanPagoMinimo = {
    meses: 0,
    totalPagadoCents: 0,
    totalInteresCents: 0,
    primerPagoCents: 0,
    nuncaTermina: false,
  }
  if (saldoCents <= 0) return vacio

  const tasaMensual = annualRateBp / 10_000 / 12
  let saldo = saldoCents
  let pagado = 0
  let intereses = 0
  let primerPago = 0

  for (let mes = 1; mes <= TOPE_MESES; mes++) {
    const interes = Math.round(saldo * tasaMensual)
    saldo += interes
    intereses += interes
    const exigido = pagoFijoCents ?? pagoMinimo(saldo, minPaymentBp, floorCents)
    const pago = Math.min(saldo, exigido)
    if (mes === 1) primerPago = pago
    // Si lo exigido no cubre ni el interés, el saldo crece: esto no termina.
    if (pago <= interes && saldo > 0) {
      return {
        meses: null,
        totalPagadoCents: pagado + pago,
        totalInteresCents: intereses,
        primerPagoCents: primerPago,
        nuncaTermina: true,
      }
    }
    saldo -= pago
    pagado += pago
    if (saldo <= 0) {
      return {
        meses: mes,
        totalPagadoCents: pagado,
        totalInteresCents: intereses,
        primerPagoCents: primerPago,
        nuncaTermina: false,
      }
    }
  }

  // Cincuenta años sin liquidar es, para cualquier efecto práctico, nunca.
  return {
    meses: null,
    totalPagadoCents: pagado,
    totalInteresCents: intereses,
    primerPagoCents: primerPago,
    nuncaTermina: true,
  }
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
