// Estrategia de deuda, del lado del servidor: junta las deudas del perfil y
// corre los dos métodos sobre el mismo dinero extra.
//
// La aritmética entera vive en `shared/estrategia.ts`, que es puro. Aquí solo
// se arma el punto de partida, y se arma **con las mismas cifras que ya enseña
// la vista de deudas**: el saldo insoluto —solo el capital abonado baja el
// principal— y la cuota del plan. Si esto partiera de sus propias cifras, el
// usuario vería su deuda con dos valores distintos en dos pantallas.
//
// R9: no recomienda un método. Devuelve los dos y la diferencia entre ellos.

import { db } from './db.ts'
import { tablaAmortizacion } from '../shared/credito.ts'
import { correrEstrategia, type DeudaEnJuego } from '../shared/estrategia.ts'
import type { ComparacionEstrategia } from '../shared/types.ts'

/**
 * Deudas por pagar abiertas con saldo vivo, con su cuota mensual.
 *
 * Sin plazo no se inventa una cuota: la deuda entra con cero y solo se mueve
 * con lo que el usuario aparte de más. Es lo único que se puede afirmar de
 * ella, y dejarla fuera sería peor —la comparación ignoraría dinero que se
 * debe.
 */
export function deudasEnJuego(profileId: number): DeudaEnJuego[] {
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
    .map((d) => ({
      id: d.id,
      nombre: d.concept ? `${d.counterparty} · ${d.concept}` : d.counterparty,
      saldoCents: Math.max(0, d.principal_cents - d.capital_pagado),
      annualRateBp: d.annual_rate_bp,
      pagoMensualCents: d.term_months
        ? tablaAmortizacion({
            principalCents: d.principal_cents,
            annualRateBp: d.annual_rate_bp,
            termMonths: d.term_months,
            startDate: d.start_date,
          }).pagoMensualCents
        : 0,
    }))
    .filter((d) => d.saldoCents > 0)
}

/**
 * Los dos métodos, lado a lado, sobre las mismas deudas y el mismo extra.
 *
 * La diferencia se devuelve calculada porque es la única cifra que contesta la
 * pregunta del usuario —"¿cuál me conviene?"— y calcularla en la vista sería
 * repetirla en cada pantalla que la enseñe. Positiva significa que la
 * avalancha sale más barata, que es lo normal; cero, que da lo mismo, y pasa
 * más seguido de lo que parece cuando las tasas se parecen.
 */
export function compararEstrategias(
  profileId: number,
  extraMensualCents: number,
): ComparacionEstrategia {
  const deudas = deudasEnJuego(profileId)
  const bolaDeNieve = correrEstrategia(deudas, extraMensualCents, 'bola_de_nieve')
  const avalancha = correrEstrategia(deudas, extraMensualCents, 'avalancha')
  const comparables =
    bolaDeNieve.meses !== null && avalancha.meses !== null

  return {
    extraMensualCents,
    saldoTotalCents: deudas.reduce((s, d) => s + d.saldoCents, 0),
    cuotasCents: deudas.reduce((s, d) => s + d.pagoMensualCents, 0),
    deudas,
    bolaDeNieve,
    avalancha,
    interesAhorradoCents: comparables
      ? bolaDeNieve.totalInteresCents - avalancha.totalInteresCents
      : null,
    mesesAhorrados: comparables ? bolaDeNieve.meses! - avalancha.meses! : null,
  }
}
