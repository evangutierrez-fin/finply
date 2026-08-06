// Estrategia de deuda: bola de nieve contra avalancha, y qué pasa si abonas
// de más.
//
// Módulo PURO a propósito (R16): no importa nada que abra la base, así que las
// pruebas lo importan de forma estática y la vista de deudas calcula lo mismo
// que el servidor sin pedir nada.
//
// **R9 manda aquí más que en ningún lado.** Esto no recomienda un método. Los
// dos se corren sobre el mismo dinero y las mismas deudas, y lo que se enseña
// son las dos respuestas juntas: cuándo terminas y cuánto interés pagas por
// cada camino. La bola de nieve casi siempre cuesta más y casi siempre se
// siente mejor —liquidas una deuda pronto—, y esa es una decisión del usuario,
// no una que Finply pueda tomar por él.
//
// La convención del interés mensual es la misma de `tablaAmortizacion` y la
// del simulador: **anual entre doce, sobre el saldo, antes del pago**. Tres
// aritméticas que deben coincidir son tres aritméticas que se separan, y aquí
// la comparación no significaría nada si cada método devengara distinto.

import { simularPagoMinimo, type PlanPagoMinimo } from './credito.ts'
import { tasaQueAnula } from './rendimiento.ts'

/** Hasta dónde se simula antes de declarar que esto no termina. */
const TOPE_MESES = 600

/** Una deuda tal como entra a la comparación. */
export interface DeudaEnJuego {
  id: number
  nombre: string
  /** Saldo insoluto de hoy: solo el capital abonado bajó el principal. */
  saldoCents: number
  annualRateBp: number
  /** La cuota que ya se paga cada mes. Cero si la deuda no tiene plan. */
  pagoMensualCents: number
}

/**
 * El orden en que se atacan.
 *
 * `bola_de_nieve` va por el **saldo más chico** —se liquida una deuda pronto y
 * eso se siente—; `avalancha` va por la **tasa más alta**, que es la que más
 * cuesta tener viva.
 */
export type Orden = 'bola_de_nieve' | 'avalancha'

export interface DeudaLiquidada {
  id: number
  nombre: string
  /** Mes en que llega a cero. `null` si no llega dentro del horizonte. */
  mes: number | null
  interesCents: number
  pagadoCents: number
}

export interface PlanEstrategia {
  orden: Orden
  /** Meses hasta que no debes nada. `null` si esto no termina. */
  meses: number | null
  totalPagadoCents: number
  totalInteresCents: number
  /**
   * En el orden en que se **atacan**, que es el plan. Ojo: no siempre es el
   * orden en que se liquidan — una deuda barata al final de la fila puede
   * acabarse antes por su propia cuota, mientras el sobrante ataca a otra.
   */
  deudas: DeudaLiquidada[]
  /** Saldo total al cierre de cada mes. El primero es el de hoy. */
  saldos: number[]
  /**
   * Verdadero cuando lo que se paga no alcanza ni para el interés del mes: el
   * saldo sube en vez de bajar. Es la respuesta honesta, no un error.
   */
  nuncaTermina: boolean
}

/**
 * Ordena las deudas según el método. **Se decide una sola vez, con los saldos
 * de hoy**, y no se vuelve a mirar: es lo que cualquiera hace en papel —haces
 * la lista y la sigues—, y un objetivo que cambia a media carrera deja de ser
 * un plan. El desempate va por id para que dos corridas den lo mismo.
 */
function ordenar(deudas: DeudaEnJuego[], orden: Orden): DeudaEnJuego[] {
  return [...deudas].sort((a, b) =>
    orden === 'bola_de_nieve'
      ? a.saldoCents - b.saldoCents || a.id - b.id
      : b.annualRateBp - a.annualRateBp || a.saldoCents - b.saldoCents || a.id - b.id,
  )
}

/**
 * Corre un método mes a mes sobre las deudas del usuario y el mismo dinero
 * extra.
 *
 * **Las dos rutas ruedan la cuota liberada.** Cuando una deuda se termina, su
 * cuota no desaparece: se suma a lo que ataca a la siguiente. Es lo que hace
 * que a esto se le llame bola de nieve, y si no rodara, la comparación no
 * sería entre dos métodos sino entre uno y ninguno. Lo único que cambia entre
 * los dos es **a quién le pegas primero**.
 *
 * El mes va en este orden, que es el del estado de cuenta: devenga el interés,
 * se pagan las cuotas, y lo que sobra en la bolsa ataca al objetivo.
 */
export function correrEstrategia(
  entrada: DeudaEnJuego[],
  extraMensualCents: number,
  orden: Orden,
): PlanEstrategia {
  const vivas = ordenar(entrada, orden).map((d) => ({
    ...d,
    interesCents: 0,
    pagadoCents: 0,
    // Una que ya venía en cero se liquidó en el mes cero, no en el primero.
    mes: d.saldoCents <= 0 ? 0 : (null as number | null),
  }))
  // Las cuotas de todas —vivas o no— más el extra: eso es lo que sale de tu
  // bolsillo cada mes, y no cambia porque una deuda se acabe. Ahí está la
  // bola de nieve.
  const bolsaMensual = vivas.reduce((s, d) => s + d.pagoMensualCents, 0) + extraMensualCents

  const saldoTotal = () => vivas.reduce((s, d) => s + d.saldoCents, 0)
  const saldos: number[] = [saldoTotal()]
  let totalPagado = 0
  let totalInteres = 0

  const cerrar = (meses: number | null, nuncaTermina: boolean): PlanEstrategia => ({
    orden,
    meses,
    totalPagadoCents: totalPagado,
    totalInteresCents: totalInteres,
    deudas: vivas.map((d) => ({
      id: d.id,
      nombre: d.nombre,
      mes: d.mes,
      interesCents: d.interesCents,
      pagadoCents: d.pagadoCents,
    })),
    saldos,
    nuncaTermina,
  })

  if (saldoTotal() === 0) return cerrar(0, false)

  for (let mes = 1; mes <= TOPE_MESES; mes++) {
    // 1. Devenga el interés de cada deuda viva, antes de cualquier pago.
    let interesDelMes = 0
    for (const d of vivas) {
      if (d.saldoCents <= 0) continue
      const interes = Math.round((d.saldoCents * d.annualRateBp) / 10_000 / 12)
      d.saldoCents += interes
      d.interesCents += interes
      interesDelMes += interes
    }
    totalInteres += interesDelMes

    // 2. Cada deuda viva recibe su cuota (nunca más que su saldo).
    let bolsa = bolsaMensual
    let pagadoDelMes = 0
    const abonar = (d: (typeof vivas)[number], cuanto: number) => {
      const abono = Math.min(cuanto, d.saldoCents)
      if (abono <= 0) return
      d.saldoCents -= abono
      d.pagadoCents += abono
      bolsa -= abono
      pagadoDelMes += abono
    }
    for (const d of vivas) abonar(d, Math.min(d.pagoMensualCents, bolsa))

    // 3. Lo que sobra —el extra más lo que liberaron las ya liquidadas— ataca
    //    en el orden del método, y desborda a la siguiente si alcanza.
    for (const d of vivas) {
      if (bolsa <= 0) break
      abonar(d, bolsa)
    }
    totalPagado += pagadoDelMes

    for (const d of vivas) if (d.saldoCents <= 0 && d.mes === null) d.mes = mes
    saldos.push(saldoTotal())

    if (saldoTotal() <= 0) return cerrar(mes, false)
    // Si lo que se pagó no cubrió ni el interés del mes, el saldo creció y
    // seguirá creciendo: no hay nada que esperar corriendo 599 meses más.
    if (pagadoDelMes <= interesDelMes) return cerrar(null, true)
  }

  // Cincuenta años debiendo es, para cualquier efecto práctico, nunca.
  return cerrar(null, true)
}

export interface Liquidacion {
  meses: number | null
  totalPagadoCents: number
  totalInteresCents: number
  nuncaTermina: boolean
}

export interface AbonoExtra {
  /** Cómo va la deuda tal cual, con la cuota de siempre. */
  base: Liquidacion
  /** Cómo iría abonando de más cada mes. */
  con: Liquidacion
  /** Meses que te ahorras. `null` si alguno de los dos caminos no termina. */
  mesesAhorrados: number | null
  /** Interés que te ahorras. `null` por la misma razón. */
  interesAhorradoCents: number | null
}

function comoLiquidacion(plan: PlanPagoMinimo): Liquidacion {
  return {
    meses: plan.meses,
    totalPagadoCents: plan.totalPagadoCents,
    totalInteresCents: plan.totalInteresCents,
    nuncaTermina: plan.nuncaTermina,
  }
}

/**
 * "Si abono $X extra cada mes, ¿cuánto me ahorro?" — sobre **el saldo de hoy**,
 * no sobre el principal original: la pregunta se hace a media deuda y con la
 * mitad ya pagada la respuesta es otra.
 *
 * Se resuelve con `simularPagoMinimo` de `shared/credito.ts`, la misma
 * aritmética que la auditoría de la Fase 22 comparó contra la fórmula cerrada
 * `n = −ln(1 − i·B/P) / ln(1+i)`. Reusarla es lo que hace que este número no
 * sea una cuarta versión del mismo cálculo.
 */
export function conAbonoExtra(params: {
  saldoCents: number
  annualRateBp: number
  pagoMensualCents: number
  extraCents: number
}): AbonoExtra {
  const { saldoCents, annualRateBp, pagoMensualCents, extraCents } = params
  const correr = (pago: number) =>
    comoLiquidacion(
      simularPagoMinimo({
        saldoCents,
        annualRateBp,
        minPaymentBp: 0,
        floorCents: null,
        pagoFijoCents: pago,
      }),
    )

  const base = correr(pagoMensualCents)
  const con = correr(pagoMensualCents + extraCents)
  const comparables = base.meses !== null && con.meses !== null
  return {
    base,
    con,
    mesesAhorrados: comparables ? base.meses! - con.meses! : null,
    interesAhorradoCents: comparables ? base.totalInteresCents - con.totalInteresCents : null,
  }
}

/**
 * La tasa que de verdad te cuesta el crédito: la anual efectiva que anula lo
 * que **recibiste** contra lo que vas a **pagar**.
 *
 * Existe por la comisión de apertura (D30). Debes el principal completo pero
 * te depositan el principal menos la comisión, así que la tasa del contrato se
 * queda corta —y cuanto más corto el plazo, más corta se queda—. Con comisión
 * cero sigue diciendo algo que la nominal no dice: la nominal no capitaliza y
 * esta sí, así que un 13.5 % anual con pagos mensuales sale 14.37 %.
 *
 * Se resuelve con `tasaQueAnula`, el mismo buscador de raíz del XIRR y del
 * simulador. Un solo buscador para todo, que es lo que evita que dos tasas del
 * mismo libro se calculen con dos aritméticas distintas.
 */
export function tasaEfectivaCredito(params: {
  recibidoCents: number
  pagos: { n: number; pagoCents: number }[]
}): number | null {
  const { recibidoCents, pagos } = params
  if (recibidoCents <= 0 || pagos.length === 0) return null
  return tasaQueAnula([
    { anios: 0, monto: recibidoCents },
    ...pagos.map((p) => ({ anios: p.n / 12, monto: -p.pagoCents })),
  ])
}
