// Flujo proyectado: ¿llego a fin de mes?
//
// Es la pregunta más personal que existe y hasta la Fase 16 solo la veía un
// perfil de negocio, escondida al final del estado de resultados. El motor ya
// estaba; lo que faltaba era sacarlo de ahí, hacerlo **día a día** y que se
// pueda auditar renglón por renglón — una proyección que no se puede seguir
// con el dedo no se le cree, y con razón.
//
// Tres reglas gobiernan este archivo:
//
//   1. **No inventa una sola fecha.** Los eventos son los del calendario (D9),
//      que ya junta recurrencias, tarjetas, deudas, parcialidades y facturas,
//      más los movimientos que el usuario ya asentó con fecha futura. Cada uno
//      trae su dirección puesta por quien lo generó: aquí no se vuelve a
//      deducir si algo entra o sale, porque dos versiones de lo que vence
//      acaban discrepando.
//   2. **La cuenta cuadra o no se publica.** Saldo inicial + entradas −
//      salidas = saldo final, exactamente, y los eventos listados son los
//      sumandos. Hay prueba de esa identidad.
//   3. **Lo que no se sabe se dice, no se supone** (R9). Un pago de tarjeta
//      cuyo corte no ha ocurrido no tiene monto: no entra en la cuenta y se
//      informa cuántos son.

import { db } from './db.ts'
import { liquidoDe, TIPOS_LIQUIDOS } from './analisis.ts'
import { calendario } from './calendario.ts'
import { hoyISO, sumarDias } from '../shared/fechas.ts'
import type { EventoCalendario, FlujoProyectado } from '../shared/types.ts'

/**
 * Los mismos tipos de cuenta que cuentan como líquido en el análisis, escritos
 * como lista SQL. Salen de la constante, no de una copia: son nombres del
 * propio código, no datos del usuario.
 */
const LIQUIDAS = `(${[...TIPOS_LIQUIDOS].map((t) => `'${t}'`).join(', ')})`

/**
 * Lo que el usuario **ya asentó** con fecha futura: el cheque que firmó, la
 * renta que adelantó, la quincena que ya sabe que cae el viernes.
 *
 * Tiene que estar aquí por una razón que se ve en cuanto se mira el saldo: el
 * balance de una cuenta suma todos sus movimientos **sin mirar la fecha**, así
 * que una partida del viernes ya está descontada del saldo de hoy. Si la caja
 * de hoy se tomara de ahí, la proyección arrancaría con dinero que todavía
 * tienes y nunca enseñaría el día en que se va. Por eso la caja de hoy es a
 * fecha (`liquidoDe(perfil, hoy)`) y lo de adelante entra como evento.
 *
 * El monto es el **efecto neto sobre el líquido**, no el monto de la partida:
 * una transferencia entre dos cuentas tuyas no mueve la caja y no aparece;
 * pagar la tarjeta desde el banco sí, porque la tarjeta no es caja.
 */
function deMovimientos(profileId: number, hoy: string, hasta: string): EventoCalendario[] {
  const filas: any[] = db
    .prepare(
      `SELECT t.id, t.date, t.type, t.note, t.amount_cents,
        c.name AS categoria, a.name AS cuenta, d.name AS destino,
        (CASE
          WHEN t.type = 'ingreso' AND a.archived = 0 AND a.type IN ${LIQUIDAS}
            THEN t.amount_cents
          WHEN t.type = 'gasto' AND a.archived = 0 AND a.type IN ${LIQUIDAS}
            THEN -t.amount_cents
          WHEN t.type = 'transferencia' THEN
            (CASE WHEN a.archived = 0 AND a.type IN ${LIQUIDAS} THEN -t.amount_cents ELSE 0 END)
            + (CASE WHEN d.archived = 0 AND d.type IN ${LIQUIDAS} THEN t.amount_cents ELSE 0 END)
          ELSE 0
        END) AS neto
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       LEFT JOIN accounts d ON d.id = t.transfer_account_id
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.profile_id = ? AND t.date > ? AND t.date <= ?
       ORDER BY t.date ASC, t.id ASC`,
    )
    .all(profileId, hoy, hasta)

  return filas
    .filter((f) => f.neto !== 0)
    .map((f) => ({
      fecha: f.date as string,
      tipo: 'movimiento' as const,
      titulo: f.note || f.categoria || (f.type === 'transferencia' ? 'Traspaso' : 'Movimiento'),
      // El detalle no repite "ya asentado": eso lo dice la etiqueta del
      // renglón. Aquí va de dónde sale el dinero, que es lo que no se sabe.
      detalle: f.type === 'transferencia' ? `${f.cuenta} → ${f.destino}` : f.cuenta,
      montoCents: Math.abs(f.neto as number),
      refId: f.id as number,
      direccion: ((f.neto as number) > 0 ? 'entra' : 'sale') as 'entra' | 'sale',
    }))
}

/**
 * El saldo líquido de hoy, movido día a día por todo lo que ya se sabe.
 *
 * Los cortes de tarjeta se saltan: un corte no mueve dinero, solo cierra el
 * periodo, y su fecha límite de pago ya viene como evento aparte. Lo que
 * todavía no tiene monto tampoco entra, y por eso se devuelve `sinMonto`: la
 * vista dice cuántos son en vez de suponer cuánto valen.
 *
 * La serie es **continua**: un punto por día, incluidos los días en que no
 * pasa nada. Con solo los días con evento, la recta entre dos puntos lejanos
 * se lee como un descenso gradual que no ocurre —el dinero se va de golpe— y
 * el día del cruce a rojo caería donde no es.
 */
export function flujoProyectado(profileId: number, hoy = hoyISO(), dias = 30): FlujoProyectado {
  const hasta = sumarDias(hoy, dias)
  const { eventos } = calendario(profileId, hoy, dias)
  const conMonto = eventos.filter((e) => e.tipo !== 'corte' && e.montoCents !== null)
  const sinMonto = eventos.filter((e) => e.tipo !== 'corte' && e.montoCents === null).length

  const utiles = [...conMonto, ...deMovimientos(profileId, hoy, hasta)].sort((a, b) =>
    a.fecha.localeCompare(b.fecha),
  )

  const saldoInicialCents = liquidoDe(profileId, hoy)
  const porDia = new Map<string, { entradas: number; salidas: number }>()
  for (const e of utiles) {
    const dia = porDia.get(e.fecha) ?? { entradas: 0, salidas: 0 }
    if (e.direccion === 'entra') dia.entradas += e.montoCents!
    else dia.salidas += e.montoCents!
    porDia.set(e.fecha, dia)
  }

  let saldo = saldoInicialCents
  let entradasCents = 0
  let salidasCents = 0
  let primerDiaEnRojo: string | null = null
  let minimo = { fecha: hoy, saldoCents: saldo }
  const puntos: FlujoProyectado['puntos'] = []

  // Se arranca en **hoy**, no en mañana: lo que vence hoy y nadie ha asentado
  // todavía —la quincena que cae esta tarde, el pago de la tarjeta de hoy—
  // mueve la caja hoy. Cada punto es el **cierre** de su día; el del primero
  // ya trae lo de hoy, que es justo lo que la cuenta de arriba dice.
  for (let i = 0; i <= dias; i++) {
    const fecha = sumarDias(hoy, i)
    const dia = porDia.get(fecha) ?? { entradas: 0, salidas: 0 }
    saldo += dia.entradas - dia.salidas
    entradasCents += dia.entradas
    salidasCents += dia.salidas
    // Estrictamente menor: quedarte en cero es llegar justo, no quedarte
    // corto. Es la misma frontera del saldo mínimo de la Fase 11.
    if (primerDiaEnRojo === null && saldo < 0) primerDiaEnRojo = fecha
    if (i === 0 || saldo < minimo.saldoCents) minimo = { fecha, saldoCents: saldo }
    puntos.push({ fecha, saldoCents: saldo, entradasCents: dia.entradas, salidasCents: dia.salidas })
  }

  return {
    desde: hoy,
    hasta,
    saldoInicialCents,
    saldoFinalCents: saldo,
    entradasCents,
    salidasCents,
    primerDiaEnRojo,
    minimo,
    sinMonto,
    puntos,
    eventos: utiles,
  }
}
