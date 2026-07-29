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
//   1. El saldo líquido de hoy **no se mueve**: lo que se aparta cada mes es
//      lo que el usuario declara, no lo que el simulador decida quitarle.
//   2. Las inversiones crecen a la tasa que el usuario ponga, convertida a
//      mensual de forma **efectiva** ((1+r)^(1/12)−1), para que doce meses den
//      exactamente la tasa anual escrita y no un poco más.
//   3. Las deudas devengan su propia tasa mensual (anual/12, como la tabla de
//      amortización) y se siguen pagando con la cuota de su plan, que sale del
//      gasto corriente y no del ahorro.
//   4. Una deuda sin plazo ni tasa se queda quieta: no se le inventa una cuota.
//   5. No hay inflación, ni impuestos, ni comisiones. Los pesos del mes 60 se
//      comparan con los de hoy tal cual.

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
  estrategia: Estrategia
}

export interface PuntoProyeccion {
  /** 0 es hoy; 1 es el primer mes proyectado. */
  mes: number
  liquidoCents: number
  inversionesCents: number
  deudaCents: number
  patrimonioCents: number
}

export interface Proyeccion {
  estrategia: Estrategia
  puntos: PuntoProyeccion[]
  patrimonioFinalCents: number
  /** Lo que se aportó de propia mano en todo el periodo. */
  aportadoCents: number
  /** Patrimonio final menos el de hoy menos lo aportado: lo que puso la tasa. */
  rendimientoCents: number
  interesPagadoCents: number
  /** Mes en que la deuda llega a cero. `null` si no llega dentro del horizonte. */
  mesSinDeuda: number | null
}

/** Tasa anual efectiva → mensual efectiva. Ver supuesto 2. */
export function mensualEfectiva(rendimientoAnualBp: number): number {
  const anual = rendimientoAnualBp / 10_000
  if (anual <= -1) return -1
  return Math.pow(1 + anual, 1 / 12) - 1
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
  const liquido = inicio.liquidoCents
  let interesPagado = 0
  let aportado = 0
  let mesSinDeuda: number | null = null

  const saldoDeuda = () => deudas.reduce((s, d) => s + d.saldoCents, 0)
  const punto = (mes: number): PuntoProyeccion => {
    const deudaCents = saldoDeuda()
    return {
      mes,
      liquidoCents: liquido,
      inversionesCents: inversiones,
      deudaCents,
      patrimonioCents: liquido + inversiones - deudaCents,
    }
  }

  const puntos: PuntoProyeccion[] = [punto(0)]
  const patrimonioHoy = puntos[0]!.patrimonioCents
  if (saldoDeuda() === 0) mesSinDeuda = 0

  for (let mes = 1; mes <= supuestos.meses; mes++) {
    // 1. Rinde lo invertido.
    inversiones += Math.round(inversiones * rMensual)

    // 2. Las deudas devengan y reciben su cuota de siempre.
    for (const d of deudas) {
      if (d.saldoCents <= 0) continue
      const interes = Math.round((d.saldoCents * d.annualRateBp) / 10_000 / 12)
      interesPagado += interes
      const pago = Math.min(d.pagoMensualCents, d.saldoCents + interes)
      d.saldoCents = Math.max(0, d.saldoCents + interes - pago)
    }

    // 3. Se aparta lo del mes y va a donde diga la estrategia.
    let disponible = supuestos.ahorroMensualCents
    aportado += disponible
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

    if (mesSinDeuda === null && saldoDeuda() === 0) mesSinDeuda = mes
    puntos.push(punto(mes))
  }

  const patrimonioFinalCents = puntos[puntos.length - 1]!.patrimonioCents
  return {
    estrategia: supuestos.estrategia,
    puntos,
    patrimonioFinalCents,
    aportadoCents: aportado,
    rendimientoCents: patrimonioFinalCents - patrimonioHoy - aportado,
    interesPagadoCents: interesPagado,
    mesSinDeuda,
  }
}
