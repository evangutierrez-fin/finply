// Simulador de patrimonio: qué pasa si aparto X al mes.
//
// Módulo PURO a propósito (R16).
//
// R9 manda aquí más que en ningún otro lado: **esto es aritmética del propio
// usuario con supuestos que él escribe**, no un pronóstico. No recomienda
// instrumentos, no promete rendimientos y no sabe qué va a pasar. Cada
// supuesto que toma va devuelto en la respuesta para que la vista lo enseñe
// junto al número, no en una nota al pie.
//
// Los supuestos, completos:
//
//   1. El saldo líquido de hoy **no se mueve** mientras se aporta: lo que se
//      aparta cada mes es lo que el usuario declara, no lo que el simulador
//      decida quitarle. En la fase de retiro sí se toca, y solo cuando las
//      inversiones ya no alcanzan para el retiro del mes.
//   2. Las inversiones crecen a la tasa que el usuario ponga, convertida a
//      mensual de forma **efectiva** ((1+r)^(1/12)−1), para que doce meses den
//      exactamente la tasa anual escrita y no un poco más.
//   3. Las deudas devengan su propia tasa mensual (anual/12, como la tabla de
//      amortización) y se siguen pagando con la cuota de su plan, que sale del
//      gasto corriente y no del ahorro. **Esa cuota también es dinero tuyo que
//      entra**, y se lleva contada aparte: sin eso, la deuda bajaba sola y su
//      capital abonado se contaba como rendimiento. Con la cuota contada, lo
//      que la deuda deja en el rendimiento es exactamente su interés, en
//      negativo, que es lo único que de verdad cuesta deber.
//   4. Una deuda sin plazo ni tasa se queda quieta: no se le inventa una cuota.
//   5. La inflación la escribe el usuario y **no cambia una sola cifra
//      nominal**: se lleva aparte, como una segunda lectura del mismo
//      patrimonio en pesos del mes cero. Cero inflación deja las dos series
//      idénticas, que es como se comportaba esto antes de la Fase 18.
//   6. El retiro es una cantidad **nominal fija**: sacar $30,000 al mes durante
//      veinte años son treinta mil pesos cada vez, que con inflación compran
//      cada año un poco menos. La serie real es la que enseña cuánto menos; no
//      se le sube el retiro solo, porque eso sería un supuesto que nadie
//      escribió.
//   7. No hay impuestos ni comisiones.

import { tasaQueAnula } from './rendimiento.ts'

/** Una deuda tal como entra a la simulación. */
export interface DeudaSim {
  id: number
  nombre: string
  saldoCents: number
  annualRateBp: number
  /** Cuota que ya se paga cada mes. Cero si la deuda no tiene plan. */
  pagoMensualCents: number
}

export interface EstadoInicial {
  liquidoCents: number
  inversionesCents: number
  deudas: DeudaSim[]
}

/** A dónde va lo que se aparta cada mes. */
export type Estrategia = 'invertir' | 'deuda'

export interface Supuestos {
  meses: number
  ahorroMensualCents: number
  /** Rendimiento anual esperado en puntos base: 700 = 7 %. Entero, sin flotantes. */
  rendimientoAnualBp: number
  /** Inflación anual supuesta, en puntos base. Cero deja nominal y real iguales. */
  inflacionAnualBp: number
  /**
   * Hasta qué mes se aporta. Igual a `meses` cuando no hay fase de retiro, que
   * es el caso de siempre; menor, cuando la pregunta es "aporto N años y luego
   * ¿de qué vivo?".
   */
  mesesAporte: number
  /** Lo que se saca cada mes a partir de `mesesAporte`. Cero si nadie retira. */
  retiroMensualCents: number
  estrategia: Estrategia
}

export interface PuntoProyeccion {
  /** 0 es hoy; 1 es el primer mes proyectado. */
  mes: number
  liquidoCents: number
  inversionesCents: number
  deudaCents: number
  patrimonioCents: number
  /** El mismo patrimonio en pesos del mes 0, con la inflación supuesta. */
  patrimonioRealCents: number
  /** Lo aportado de propia mano hasta aquí, acumulado. */
  aportadoCents: number
  /**
   * Las cuotas del plan de tus deudas pagadas hasta aquí, acumuladas. Es
   * dinero tuyo que entra —del gasto corriente, no del ahorro—, y por eso va
   * contado y no confundido con rendimiento. Ver supuesto 3.
   */
  pagadoAPlanCents: number
  /** Lo retirado hasta aquí, acumulado. */
  retiradoCents: number
  /**
   * Lo que puso la tasa hasta aquí: patrimonio menos el de hoy, menos todo lo
   * que pusiste —lo apartado y las cuotas—, más lo que sacaste. Lo que queda
   * son las ganancias de lo invertido menos el interés de lo que debes, y
   * nada más. Es la cifra que de verdad distingue una ruta de la otra: el
   * patrimonio arrastra el punto de partida y las dos curvas se ven casi
   * iguales aunque una rinda el doble.
   */
  rendimientoCents: number
  /**
   * Ese mismo rendimiento contra lo que llevas puesto, en puntos base. `null`
   * cuando la base no es positiva: con patrimonio de hoy negativo, dividir
   * daría un porcentaje con el signo al revés y no significa nada.
   */
  rendimientoBp: number | null
  /** Interés pagado a las deudas hasta aquí, acumulado. */
  interesPagadoCents: number
}

export interface Proyeccion {
  estrategia: Estrategia
  puntos: PuntoProyeccion[]
  patrimonioFinalCents: number
  /** El mismo final en pesos de hoy. Igual al nominal si la inflación es cero. */
  patrimonioRealFinalCents: number
  /** Lo que se aportó de propia mano en todo el periodo. */
  aportadoCents: number
  /** Las cuotas del plan de las deudas en todo el periodo. Ver supuesto 3. */
  pagadoAPlanCents: number
  /** Lo que se sacó en la fase de retiro. Cero si nadie retira. */
  retiradoCents: number
  /** Lo que puso la tasa en todo el periodo. */
  rendimientoCents: number
  interesPagadoCents: number
  /** Mes en que la deuda llega a cero. `null` si no llega dentro del horizonte. */
  mesSinDeuda: number | null
  /**
   * Primer mes en que el retiro ya no se pudo pagar completo. `null` si el
   * dinero aguantó todo el horizonte, que es la respuesta que se busca.
   */
  mesSinFondos: number | null
  /**
   * La tasa anual que le sacaste a **todo** tu dinero, en puntos base: la que
   * anula tus flujos —lo que ya tenías, lo que fuiste poniendo (lo apartado y
   * las cuotas de tus deudas), lo que sacaste y con lo que acabaste—. Es la
   * única cifra comparable de frente contra la tasa que supusiste, y casi
   * nunca es igual: el saldo líquido está quieto y las deudas devengan, así
   * que las dos cosas la jalan hacia abajo. `null` cuando no se puede afirmar
   * nada.
   */
  tasaEquivalenteBp: number | null
}

/** Tasa anual efectiva → mensual efectiva. Ver supuesto 2. */
export function mensualEfectiva(rendimientoAnualBp: number): number {
  const anual = rendimientoAnualBp / 10_000
  if (anual <= -1) return -1
  return Math.pow(1 + anual, 1 / 12) - 1
}

/**
 * El mismo monto en pesos del mes 0. Descontar es la única operación que hace
 * la inflación aquí: nada nominal se toca (supuesto 5).
 */
export function enPesosDeHoy(cents: number, mes: number, inflacionAnualBp: number): number {
  if (inflacionAnualBp === 0) return cents
  const anual = inflacionAnualBp / 10_000
  if (anual <= -1) return cents
  return Math.round(cents / Math.pow(1 + anual, mes / 12))
}

/**
 * Proyecta el patrimonio mes a mes. Devuelve el punto 0 (hoy) y un punto por
 * cada mes del horizonte, así que la serie siempre tiene `meses + 1` puntos y
 * la gráfica arranca en la cifra que el usuario ya conoce.
 *
 * Con la estrategia `deuda`, lo apartado ataca primero **la deuda más cara**
 * —la de mayor tasa—, que es la que más cuesta tener viva; cuando no queda
 * ninguna, todo se va a inversión. Con `invertir`, todo se va a inversión
 * desde el primer mes y las deudas solo siguen su plan.
 */
export function proyectar(inicio: EstadoInicial, supuestos: Supuestos): Proyeccion {
  const rMensual = mensualEfectiva(supuestos.rendimientoAnualBp)
  const deudas = inicio.deudas.map((d) => ({ ...d }))

  let inversiones = inicio.inversionesCents
  let liquido = inicio.liquidoCents
  let interesPagado = 0
  let aportado = 0
  let pagadoAPlan = 0
  let retirado = 0
  let mesSinDeuda: number | null = null
  let mesSinFondos: number | null = null

  const saldoDeuda = () => deudas.reduce((s, d) => s + d.saldoCents, 0)
  const patrimonioHoy = inicio.liquidoCents + inicio.inversionesCents - saldoDeuda()

  const punto = (mes: number): PuntoProyeccion => {
    const deudaCents = saldoDeuda()
    const patrimonioCents = liquido + inversiones - deudaCents
    const puesto = aportado + pagadoAPlan
    const rendimientoCents = patrimonioCents - patrimonioHoy - puesto + retirado
    // La base es lo que llevas puesto: lo de hoy más todo lo que metiste,
    // menos lo que ya sacaste. Sin base positiva no hay porcentaje que decir.
    const base = patrimonioHoy + puesto - retirado
    return {
      mes,
      liquidoCents: liquido,
      inversionesCents: inversiones,
      deudaCents,
      patrimonioCents,
      patrimonioRealCents: enPesosDeHoy(patrimonioCents, mes, supuestos.inflacionAnualBp),
      aportadoCents: aportado,
      pagadoAPlanCents: pagadoAPlan,
      retiradoCents: retirado,
      rendimientoCents,
      rendimientoBp: base > 0 ? Math.round((rendimientoCents / base) * 10_000) : null,
      interesPagadoCents: interesPagado,
    }
  }

  const puntos: PuntoProyeccion[] = [punto(0)]
  if (saldoDeuda() === 0) mesSinDeuda = 0

  // Flujos para la tasa equivalente, con el signo del usuario: negativo lo que
  // sale de su bolsillo. El patrimonio de hoy cuenta como el primer flujo —es
  // el dinero que ya está adentro— y el final, como si liquidara todo.
  const flujos: { anios: number; monto: number }[] = [{ anios: 0, monto: -patrimonioHoy }]

  for (let mes = 1; mes <= supuestos.meses; mes++) {
    // 1. Rinde lo invertido.
    inversiones += Math.round(inversiones * rMensual)

    // 2. Las deudas devengan y reciben su cuota de siempre. La cuota se apunta
    //    como dinero puesto —lo es— y se cuenta la **pagada**, no la del plan:
    //    el último abono de una deuda casi siempre es más chico.
    let cuotasDelMes = 0
    for (const d of deudas) {
      if (d.saldoCents <= 0) continue
      const interes = Math.round((d.saldoCents * d.annualRateBp) / 10_000 / 12)
      interesPagado += interes
      const pago = Math.min(d.pagoMensualCents, d.saldoCents + interes)
      cuotasDelMes += pago
      d.saldoCents = Math.max(0, d.saldoCents + interes - pago)
    }
    pagadoAPlan += cuotasDelMes
    if (cuotasDelMes > 0) flujos.push({ anios: mes / 12, monto: -cuotasDelMes })

    if (mes <= supuestos.mesesAporte) {
      // 3a. Se aparta lo del mes y va a donde diga la estrategia.
      let disponible = supuestos.ahorroMensualCents
      aportado += disponible
      if (disponible > 0) flujos.push({ anios: mes / 12, monto: -disponible })
      if (supuestos.estrategia === 'deuda') {
        const porTasa = deudas
          .filter((d) => d.saldoCents > 0)
          .sort((a, b) => b.annualRateBp - a.annualRateBp || a.id - b.id)
        for (const d of porTasa) {
          if (disponible <= 0) break
          const abono = Math.min(disponible, d.saldoCents)
          d.saldoCents -= abono
          disponible -= abono
        }
      }
      inversiones += disponible
    } else if (supuestos.retiroMensualCents > 0) {
      // 3b. Fase de retiro: sale primero de lo invertido y, cuando eso se
      // acaba, del líquido. Lo que no alcance no se saca —no se inventa dinero
      // que no hay— y el mes en que eso pasa es la respuesta de la pregunta.
      const pedido = supuestos.retiroMensualCents
      const deInversiones = Math.min(pedido, Math.max(0, inversiones))
      inversiones -= deInversiones
      const delLiquido = Math.min(pedido - deInversiones, Math.max(0, liquido))
      liquido -= delLiquido
      const sacado = deInversiones + delLiquido
      retirado += sacado
      if (sacado > 0) flujos.push({ anios: mes / 12, monto: sacado })
      if (sacado < pedido && mesSinFondos === null) mesSinFondos = mes
    }

    if (mesSinDeuda === null && saldoDeuda() === 0) mesSinDeuda = mes
    puntos.push(punto(mes))
  }

  const ultimo = puntos[puntos.length - 1]!
  flujos.push({ anios: supuestos.meses / 12, monto: ultimo.patrimonioCents })

  return {
    estrategia: supuestos.estrategia,
    puntos,
    patrimonioFinalCents: ultimo.patrimonioCents,
    patrimonioRealFinalCents: ultimo.patrimonioRealCents,
    aportadoCents: aportado,
    pagadoAPlanCents: pagadoAPlan,
    retiradoCents: retirado,
    rendimientoCents: ultimo.rendimientoCents,
    interesPagadoCents: interesPagado,
    mesSinDeuda,
    mesSinFondos,
    tasaEquivalenteBp: bpDeTasa(tasaQueAnula(flujos)),
  }
}

/** Decimal (0.0734) → puntos base enteros (734). `null` sigue siendo `null`. */
function bpDeTasa(tasa: number | null): number | null {
  if (tasa === null || !Number.isFinite(tasa)) return null
  return Math.round(tasa * 10_000)
}

/** Techo de la búsqueda de la meta: el mismo tope que valida la petición. */
const AHORRO_MAX = 1_000_000_000_000

/**
 * La pregunta al revés: **cuánto hay que apartar al mes** para que el
 * patrimonio llegue a `objetivoCents` al final del horizonte.
 *
 * No hay fórmula cerrada que sirva aquí: la anualidad de libro no sabe de
 * deudas que devengan, de una estrategia que abona a la más cara ni del
 * redondeo a centavos de cada mes. Se resuelve **corriendo la misma
 * proyección** que el usuario tiene enfrente y buscando por bisección el
 * aporte más chico que llega — así la respuesta y la gráfica no pueden
 * discrepar, que es lo que R9 pide: su propia aritmética, no otra parecida.
 *
 * Devuelve `0` si ya se llega sin apartar nada y `null` si no se llega ni
 * apartando el tope: es preferible decir que no alcanza a devolver una cifra
 * inventada.
 */
export function ahorroParaMeta(
  inicio: EstadoInicial,
  supuestos: Omit<Supuestos, 'ahorroMensualCents'>,
  objetivoCents: number,
): number | null {
  const finalCon = (ahorroMensualCents: number) =>
    proyectar(inicio, { ...supuestos, ahorroMensualCents }).patrimonioFinalCents

  if (finalCon(0) >= objetivoCents) return 0
  if (finalCon(AHORRO_MAX) < objetivoCents) return null

  // Invariante: `lo` no llega y `hi` sí. Se parte hasta que se tocan, y la
  // respuesta es `hi` — el aporte más chico que sí llega.
  let lo = 0
  let hi = AHORRO_MAX
  while (hi - lo > 1) {
    const medio = Math.floor((lo + hi) / 2)
    if (finalCon(medio) >= objetivoCents) hi = medio
    else lo = medio
  }
  return hi
}
