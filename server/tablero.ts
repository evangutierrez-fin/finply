// Todo de un cliente —o de un proveedor— en una hoja.
//
// Las cifras ya existían todas, repartidas en cuatro vistas: lo facturado en
// Facturas, lo cobrado en Movimientos, el vencido en la antigüedad de saldos y
// el margen en Resultados. Nadie las había juntado por contraparte, y esa es
// justo la pregunta que un negocio se hace antes de dar más crédito: *este*
// cliente, ¿cuánto me deja, cuánto me debe y cuánto tarda en pagarme?
//
// Nada se guarda: todo se deriva de las mismas fuentes que las otras vistas,
// con **el mismo SQL importado** (`COBRABLE`, `SALDO_FACTURA`) y no copiado. Una
// copia envejecería en cuanto lo cobrable cambie de definición — que es
// exactamente lo que pasó cuando llegaron las retenciones.
//
// Y todo en un número acotado de consultas, no una por factura (R11).

import { db, httpError } from './db.ts'
import { COBRABLE, SALDO_FACTURA } from './facturas.ts'
import { MONTO_OPERATIVO, TIPO_OPERATIVO, DESDE_MOVIMIENTOS } from './reportes.ts'
import { hoyISO } from '../shared/fechas.ts'
import type { TableroContraparte } from '../shared/types.ts'

/**
 * Cuánto tarda en pagar, en días.
 *
 * Se mide sobre las facturas **saldadas**: una abierta no ha terminado de
 * pagarse y meterla bajaría el promedio con un plazo que todavía corre. La
 * fecha que cuenta es la del **último** cobro —el día en que quedó saldada—,
 * no la del primero: pagar el 10 % a tiempo y el resto tres meses después no
 * es pagar a tiempo.
 *
 * `null` cuando no hay ninguna saldada: no se puede afirmar nada (R9).
 */
const DIAS_DE_PAGO = `
  (SELECT AVG(julianday(ultimo) - julianday(f.issue_date))
   FROM invoices f
   JOIN (SELECT invoice_id, MAX(date) AS ultimo FROM transactions
         WHERE invoice_id IS NOT NULL GROUP BY invoice_id) p ON p.invoice_id = f.id
   WHERE f.counterparty_id = ? AND f.status = 'abierta'
     AND ${SALDO_FACTURA} = 0 AND ${COBRABLE} > 0)`

export function tableroDe(
  profileId: number,
  counterpartyId: number,
  hoy = hoyISO(),
): TableroContraparte {
  const contraparte: any = db
    .prepare('SELECT * FROM counterparties WHERE id = ? AND profile_id = ?')
    .get(counterpartyId, profileId)
  if (!contraparte) throw httpError(404, 'Esa contraparte no existe en este perfil')

  // 1. El documento: qué se le facturó, qué queda y qué de eso ya venció.
  const facturas: any = db
    .prepare(
      `SELECT
        COUNT(*) AS n,
        COALESCE(SUM(${COBRABLE}), 0) AS cobrable,
        COALESCE(SUM(${SALDO_FACTURA}), 0) AS saldo,
        COALESCE(SUM(CASE WHEN f.due_date IS NOT NULL AND f.due_date < ?
          THEN ${SALDO_FACTURA} END), 0) AS vencido,
        COUNT(CASE WHEN f.due_date IS NOT NULL AND f.due_date < ?
          AND ${SALDO_FACTURA} > 0 THEN 1 END) AS n_vencidas,
        MIN(f.issue_date) AS primera,
        MAX(f.issue_date) AS ultima
       FROM invoices f
       WHERE f.counterparty_id = ? AND f.status = 'abierta'`,
    )
    .get(hoy, hoy, counterpartyId)

  // 2. El dinero: lo que de verdad se movió con esta contraparte, con la regla
  //    de D6. Un anticipo suyo es ingreso; un préstamo no lo sería.
  const flujo: any = db
    .prepare(
      `SELECT
        COALESCE(SUM(CASE WHEN ${TIPO_OPERATIVO} = 'ingreso' THEN ${MONTO_OPERATIVO} END), 0) AS cobrado,
        COALESCE(SUM(CASE WHEN ${TIPO_OPERATIVO} = 'gasto' THEN ${MONTO_OPERATIVO} END), 0) AS pagado
       ${DESDE_MOVIMIENTOS}
       WHERE t.profile_id = ? AND t.counterparty_id = ?`,
    )
    .get(profileId, counterpartyId)

  // 3. Lo comprometido antes de la factura, que es lo que trajo esta fase.
  const cotizaciones: any = db
    .prepare(
      `SELECT
        COALESCE(SUM(CASE WHEN status = 'enviada' THEN subtotal_cents + tax_cents END), 0) AS esperando,
        COUNT(CASE WHEN status = 'enviada' THEN 1 END) AS n_esperando,
        COUNT(CASE WHEN status = 'aceptada' THEN 1 END) AS n_aceptadas,
        COUNT(CASE WHEN status = 'perdida' THEN 1 END) AS n_perdidas
       FROM quotes WHERE counterparty_id = ?`,
    )
    .get(counterpartyId)

  const dias: any = db.prepare(`SELECT ${DIAS_DE_PAGO} AS dias`).get(counterpartyId)
  const contestadas = cotizaciones.n_aceptadas + cotizaciones.n_perdidas

  return {
    counterpartyId,
    name: contraparte.name,
    role: contraparte.role,
    creditDays: contraparte.credit_days ?? null,
    creditLimitCents: contraparte.credit_limit_cents ?? null,
    facturadoCents: facturas.cobrable,
    saldoCents: facturas.saldo,
    vencidoCents: facturas.vencido,
    facturas: facturas.n,
    facturasVencidas: facturas.n_vencidas,
    primeraFactura: facturas.primera ?? null,
    ultimaFactura: facturas.ultima ?? null,
    cobradoCents: flujo.cobrado,
    pagadoCents: flujo.pagado,
    esperandoCents: cotizaciones.esperando,
    cotizacionesEsperando: cotizaciones.n_esperando,
    // Redondeado a días enteros: el promedio sale con decimales y "paga en
    // 23.4 días" finge una precisión que no hay.
    diasDePagoPromedio: dias.dias === null ? null : Math.round(dias.dias),
    tasaExitoBp:
      contestadas === 0
        ? null
        : Math.round((cotizaciones.n_aceptadas / contestadas) * 10_000),
    sobreLimite:
      contraparte.credit_limit_cents !== null &&
      contraparte.credit_limit_cents !== undefined &&
      facturas.saldo > contraparte.credit_limit_cents,
  }
}
