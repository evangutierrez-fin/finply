// El simulador, del lado del servidor: junta el punto de partida y corre las
// dos rutas sobre los mismos supuestos.
//
// La aritmética entera vive en `shared/simulador.ts`, que es puro y no sabe de
// bases de datos. Aquí solo se arma el estado inicial, y se arma **con las
// mismas fórmulas que ya usa el tablero**: el líquido es el del panel de
// análisis, las inversiones son las del Resumen y el saldo insoluto es el que
// enseña la vista de deudas. Si el simulador partiera de sus propias cifras,
// el usuario vería su patrimonio de hoy con dos valores distintos.
//
// R9: nada de esto recomienda nada. La tasa la escribe el usuario, y los
// supuestos van de vuelta en la respuesta para enseñarlos junto al número.

import { db, investmentsWithTotals } from './db.ts'
import { liquidoDe } from './analisis.ts'
import { tablaAmortizacion } from '../shared/credito.ts'
import { ahorroParaMeta, proyectar, type DeudaSim } from '../shared/simulador.ts'
import type { Simulacion } from '../shared/types.ts'

/**
 * Deudas por pagar abiertas, con su saldo insoluto y la cuota de su plan.
 *
 * Solo el capital abonado baja el principal —es el defecto que se corrigió en
 * la Fase 3—, y la cuota sale de la tabla de amortización cuando la deuda
 * tiene plazo. Sin plazo no se inventa una: se queda en cero y la deuda se
 * proyecta quieta, que es lo único que se puede afirmar de ella.
 */
function deudasDe(profileId: number): DeudaSim[] {
  const filas: any[] = db
    .prepare(
      `SELECT d.id, d.counterparty, d.concept, d.principal_cents, d.annual_rate_bp,
              d.term_months, d.start_date,
              COALESCE((SELECT SUM(p.amount_cents - p.interest_cents) FROM debt_payments p
                WHERE p.debt_id = d.id), 0) AS capital_pagado
       FROM debts d
       WHERE d.profile_id = ? AND d.status = 'abierta' AND d.direction = 'por_pagar'
       ORDER BY d.id ASC`,
    )
    .all(profileId)

  return filas
    .map((d) => {
      const saldoCents = Math.max(0, d.principal_cents - d.capital_pagado)
      const pagoMensualCents = d.term_months
        ? tablaAmortizacion({
            principalCents: d.principal_cents,
            annualRateBp: d.annual_rate_bp,
            termMonths: d.term_months,
            startDate: d.start_date,
          }).pagoMensualCents
        : 0
      return {
        id: d.id,
        nombre: d.concept ? `${d.counterparty} · ${d.concept}` : d.counterparty,
        saldoCents,
        annualRateBp: d.annual_rate_bp,
        pagoMensualCents,
      }
    })
    .filter((d) => d.saldoCents > 0)
}

export interface OpcionesSimulacion {
  meses: number
  ahorroMensualCents: number
  rendimientoAnualBp: number
  inflacionAnualBp: number
  /** Hasta qué mes se aporta. Ausente = todo el horizonte, que es lo de siempre. */
  mesesAporte?: number
  retiroMensualCents: number
  /** A cuánto quiere llegar. Cero = no preguntó, y no se le responde de más. */
  objetivoCents: number
}

/**
 * Corre las dos estrategias —todo a invertir, o primero la deuda— sobre el
 * mismo punto de partida y los mismos supuestos. Se devuelven las dos porque
 * la pregunta del usuario nunca es "cuánto tendré", es "cuál de las dos me
 * deja mejor", y esa respuesta depende de su tasa contra la de su deuda.
 *
 * La meta se resuelve **para las dos rutas** por la misma razón: cuánto hay que
 * apartar para juntar $X depende de a dónde va lo que apartas, y la diferencia
 * entre las dos cifras es exactamente la misma comparación de arriba, dicha por
 * el otro lado.
 */
export function simular(profileId: number, opciones: OpcionesSimulacion): Simulacion {
  const liquidoCents = liquidoDe(profileId)
  const inversionesCents = investmentsWithTotals(profileId)
    .filter((i: any) => !i.archived)
    .reduce((s: number, i: any) => s + i.valueCents, 0)
  const deudas = deudasDe(profileId)
  const deudaCents = deudas.reduce((s, d) => s + d.saldoCents, 0)

  const inicio = { liquidoCents, inversionesCents, deudas }
  const supuestos = {
    meses: opciones.meses,
    ahorroMensualCents: opciones.ahorroMensualCents,
    rendimientoAnualBp: opciones.rendimientoAnualBp,
    inflacionAnualBp: opciones.inflacionAnualBp,
    mesesAporte: Math.min(opciones.mesesAporte ?? opciones.meses, opciones.meses),
    retiroMensualCents: opciones.retiroMensualCents,
  }

  const meta =
    opciones.objetivoCents > 0
      ? {
          objetivoCents: opciones.objetivoCents,
          invertirCents: ahorroParaMeta(
            inicio,
            { ...supuestos, estrategia: 'invertir' },
            opciones.objetivoCents,
          ),
          deudaCents: ahorroParaMeta(
            inicio,
            { ...supuestos, estrategia: 'deuda' },
            opciones.objetivoCents,
          ),
        }
      : null

  return {
    inicio: {
      liquidoCents,
      inversionesCents,
      deudaCents,
      patrimonioCents: liquidoCents + inversionesCents - deudaCents,
      deudas,
    },
    supuestos,
    invertir: proyectar(inicio, { ...supuestos, estrategia: 'invertir' }),
    deuda: proyectar(inicio, { ...supuestos, estrategia: 'deuda' }),
    meta,
  }
}
