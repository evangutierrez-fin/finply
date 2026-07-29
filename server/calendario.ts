// Calendario de vencimientos: todo lo que Finply ya sabe que va a caer.
//
// Decidido en D9: no inventa nada ni pide datos nuevos. Junta lo que las fases
// anteriores ya dejaron calculado —recurrencias por confirmar, cortes de
// tarjeta con su fecha límite de pago, el próximo pago del plan de una deuda y
// las parcialidades de meses sin intereses— y lo ordena por día.
//
// Es de **solo lectura**, como los reportes: aquí no se escribe una sola fila.

import { db, modulosDe } from './db.ts'
import type { ModuloId } from '../shared/modulos.ts'
import { estadoTarjetas } from './tarjetas.ts'
import { reglaDe } from './recurrencias.ts'
import { tablaAmortizacion } from '../shared/credito.ts'
import { hoyISO, proximoDiaDelMes, siguienteDiaDelMes, sumarDias } from '../shared/fechas.ts'
import { describirRecurrencia, ocurrencias } from '../shared/recurrencias.ts'
import type { Calendario, EventoCalendario } from '../shared/types.ts'

/** Recurrencias que caen en la ventana y todavía nadie ha resuelto. */
function deRecurrencias(profileId: number, desde: string, hasta: string): EventoCalendario[] {
  const rows: any[] = db
    .prepare(
      `SELECT r.*, a.name AS account_name FROM recurrences r
       JOIN accounts a ON a.id = r.account_id
       WHERE r.profile_id = ? AND r.archived = 0`,
    )
    .all(profileId)
  if (rows.length === 0) return []

  const ids = rows.map((r) => r.id)
  const resueltos = new Set(
    (
      db
        .prepare(
          `SELECT recurrence_id, period FROM recurrence_runs
           WHERE recurrence_id IN (${ids.map(() => '?').join(',')})`,
        )
        .all(...ids) as { recurrence_id: number; period: string }[]
    ).map((f) => `${f.recurrence_id}·${f.period}`),
  )

  const eventos: EventoCalendario[] = []
  for (const row of rows) {
    const regla = reglaDe(row)
    for (const o of ocurrencias(regla, { desde, hasta }).lista) {
      if (resueltos.has(`${row.id}·${o.periodo}`)) continue
      eventos.push({
        fecha: o.fecha,
        tipo: 'recurrencia',
        titulo: row.note || (row.type === 'ingreso' ? 'Ingreso recurrente' : 'Gasto recurrente'),
        detalle: `${row.account_name} · ${describirRecurrencia(regla)}`,
        montoCents: row.amount_cents,
        refId: row.id,
        direccion: row.type === 'ingreso' ? 'entra' : 'sale',
        periodo: o.periodo,
      })
    }
  }
  return eventos
}

/**
 * De cada tarjeta salen tres cosas distintas:
 *
 *   · la **fecha límite** del corte que ya ocurrió, con lo que falta pagar
 *     para no generar intereses — es el único monto que ya se sabe;
 *   · el **próximo corte**, que aún no tiene monto porque no ha pasado;
 *   · la fecha límite **de ese próximo corte**, sin monto todavía. Sin ella,
 *     una tarjeta cuyo pago venció ayer desaparecía del calendario hasta el
 *     mes siguiente, que es justo cuando más falta hace verla.
 */
function deTarjetas(profileId: number, desde: string, hasta: string): EventoCalendario[] {
  const eventos: EventoCalendario[] = []
  const dentro = (f: string) => f >= desde && f <= hasta

  for (const t of estadoTarjetas(profileId, desde)) {
    if (t.fechaLimitePago && dentro(t.fechaLimitePago) && (t.paraNoGenerarInteresesCents ?? 0) > 0) {
      eventos.push({
        fecha: t.fechaLimitePago,
        tipo: 'pago_tarjeta',
        titulo: `Pagar ${t.name}`,
        detalle: 'Para no generar intereses del corte anterior',
        montoCents: t.paraNoGenerarInteresesCents,
        refId: t.accountId,
        direccion: 'sale',
      })
    }
    if (!t.cutDay) continue

    const proximoCorte = proximoDiaDelMes(desde, t.cutDay)
    if (dentro(proximoCorte)) {
      eventos.push({
        fecha: proximoCorte,
        tipo: 'corte',
        titulo: `Corta ${t.name}`,
        detalle:
          t.msiProximoCorteCents > 0
            ? 'En este corte se facturan parcialidades de meses sin intereses'
            : 'Cierra el periodo de la tarjeta',
        montoCents: t.msiProximoCorteCents > 0 ? t.msiProximoCorteCents : null,
        refId: t.accountId,
        // Un corte no mueve dinero: solo cierra el periodo. Se marca como
        // salida por coherencia del tipo, y el flujo proyectado lo ignora
        // porque su monto es informativo, no un cargo a la caja.
        direccion: 'sale',
      })
    }
    // Si el próximo corte es el que ya ocurrió —hoy es justo el día de corte—,
    // su fecha límite ya salió arriba con su monto: no se anuncia dos veces.
    if (t.dueDay && proximoCorte !== t.fechaCorte) {
      const limite = siguienteDiaDelMes(proximoCorte, t.dueDay)
      if (dentro(limite)) {
        eventos.push({
          fecha: limite,
          tipo: 'pago_tarjeta',
          titulo: `Pagar ${t.name}`,
          detalle: 'El monto se define en el corte de este periodo',
          montoCents: null,
          refId: t.accountId,
          direccion: 'sale',
        })
      }
    }
  }
  return eventos
}

/**
 * El próximo pago del plan de cada deuda abierta. Se toma la fila del plan que
 * sigue a los abonos ya hechos —igual que lo muestra la vista de Deudas—; sin
 * plazo no hay plan, y entonces lo único que vence es la fecha pactada.
 */
function deDeudas(profileId: number, desde: string, hasta: string): EventoCalendario[] {
  const deudas: any[] = db
    .prepare(
      `SELECT d.*,
        (SELECT COUNT(*) FROM debt_payments p WHERE p.debt_id = d.id) AS abonos,
        d.principal_cents - COALESCE((SELECT SUM(p.amount_cents - p.interest_cents)
          FROM debt_payments p WHERE p.debt_id = d.id), 0) AS saldo
       FROM debts d WHERE d.profile_id = ? AND d.status = 'abierta'`,
    )
    .all(profileId)

  const eventos: EventoCalendario[] = []
  for (const d of deudas) {
    const suyo = d.direction === 'por_pagar'
    if (d.term_months) {
      const plan = tablaAmortizacion({
        principalCents: d.principal_cents,
        annualRateBp: d.annual_rate_bp,
        termMonths: d.term_months,
        startDate: d.start_date,
      })
      // Se arranca en la fila que sigue a los abonos hechos —así nunca se
      // anuncia una mensualidad ya pagada, ni cuando el usuario va adelantado—
      // y de ahí se toma la primera que caiga en la ventana: si viene
      // atrasado, la vencida ya no entra en "los próximos 30 días", pero la
      // que sí entra tiene que verse.
      const proximo = plan.filas
        .slice(d.abonos)
        .find((f) => f.fecha >= desde && f.fecha <= hasta)
      if (proximo) {
        eventos.push({
          fecha: proximo.fecha,
          tipo: 'deuda',
          titulo: suyo ? `Pago a ${d.counterparty}` : `Cobro a ${d.counterparty}`,
          detalle: `Pago ${proximo.n} de ${d.term_months} del plan${d.concept ? ` · ${d.concept}` : ''}`,
          montoCents: proximo.pagoCents,
          refId: d.id,
          direccion: suyo ? 'sale' : 'entra',
        })
      }
      continue
    }
    if (d.due_date && d.due_date >= desde && d.due_date <= hasta) {
      eventos.push({
        fecha: d.due_date,
        tipo: 'deuda',
        titulo: suyo ? `Vence lo de ${d.counterparty}` : `Te deben: ${d.counterparty}`,
        detalle: d.concept || 'Fecha pactada',
        // Lo que falta, no el principal: si ya abonaste la mitad, la mitad es
        // lo que vence.
        montoCents: Math.max(0, d.saldo),
        refId: d.id,
        direccion: suyo ? 'sale' : 'entra',
      })
    }
  }
  return eventos
}

/** Parcialidades de meses sin intereses que se facturan en la ventana. */
function deMSI(profileId: number, desde: string, hasta: string): EventoCalendario[] {
  const filas: any[] = db
    .prepare(
      `SELECT i.due_date, i.number, i.amount_cents, p.id AS purchase_id, p.concept, p.months,
        a.name AS account_name
       FROM msi_installments i
       JOIN msi_purchases p ON p.id = i.purchase_id
       JOIN accounts a ON a.id = p.account_id
       WHERE p.profile_id = ? AND i.due_date BETWEEN ? AND ?`,
    )
    .all(profileId, desde, hasta)
  return filas.map((f) => ({
    fecha: f.due_date,
    tipo: 'msi' as const,
    titulo: f.concept || 'Compra a meses',
    detalle: `Parcialidad ${f.number} de ${f.months} · ${f.account_name}`,
    montoCents: f.amount_cents,
    refId: f.purchase_id,
    direccion: 'sale' as const,
  }))
}

/**
 * Facturas abiertas con saldo, que vencen dentro de la ventana. Entran aquí
 * por lo mismo que entraron las deudas (D9): el calendario junta lo que Finply
 * ya sabe que va a caer, y una factura por cobrar es exactamente eso.
 *
 * El saldo se calcula en SQL contra los movimientos ligados, no recorriendo
 * cobros en JS (R11).
 */
function deFacturas(profileId: number, desde: string, hasta: string): EventoCalendario[] {
  const filas: any[] = db
    .prepare(
      `SELECT f.id, f.direction, f.folio, f.concept, f.due_date,
        f.subtotal_cents + f.tax_cents
          - COALESCE((SELECT SUM(t.amount_cents) FROM transactions t WHERE t.invoice_id = f.id), 0)
          AS saldo,
        c.name AS contraparte
       FROM invoices f
       JOIN counterparties c ON c.id = f.counterparty_id
       WHERE f.profile_id = ? AND f.status = 'abierta'
         AND f.due_date IS NOT NULL AND f.due_date BETWEEN ? AND ?`,
    )
    .all(profileId, desde, hasta)

  return filas
    .filter((f) => f.saldo > 0)
    .map((f) => ({
      fecha: f.due_date,
      tipo: 'factura' as const,
      titulo:
        f.direction === 'emitida' ? `Cobrar a ${f.contraparte}` : `Pagar a ${f.contraparte}`,
      detalle: [f.folio && `Folio ${f.folio}`, f.concept].filter(Boolean).join(' · ') || 'Factura',
      montoCents: f.saldo as number,
      refId: f.id as number,
      direccion: (f.direction === 'emitida' ? 'entra' : 'sale') as 'entra' | 'sale',
    }))
}

const ORDEN: Record<EventoCalendario['tipo'], number> = {
  pago_tarjeta: 0,
  deuda: 1,
  factura: 2,
  recurrencia: 3,
  msi: 4,
  corte: 5,
}

/**
 * Todo lo que vence en los próximos `dias` días, del más cercano al último.
 *
 * Cada fuente pertenece a un módulo y calla si está apagado — un vencimiento
 * de tarjeta en el calendario de quien no lleva tarjetas es ruido, y el clic
 * llevaría a una sección que no está en su lomo. Las parcialidades de meses
 * sin intereses cuelgan del módulo de tarjetas, que es donde se registran.
 */
export function calendario(profileId: number, hoy = hoyISO(), dias = 30): Calendario {
  const hasta = sumarDias(hoy, dias)
  const activos = modulosDe(profileId)
  const con = (id: ModuloId) => activos.includes(id)

  const eventos = [
    ...(con('recurrencias') ? deRecurrencias(profileId, hoy, hasta) : []),
    ...(con('tarjetas') ? deTarjetas(profileId, hoy, hasta) : []),
    ...(con('deudas') ? deDeudas(profileId, hoy, hasta) : []),
    ...(con('tarjetas') ? deMSI(profileId, hoy, hasta) : []),
    ...(con('negocio') ? deFacturas(profileId, hoy, hasta) : []),
  ]
  // Dentro de un mismo día manda lo que cuesta dinero si se te pasa.
  eventos.sort(
    (a, b) => a.fecha.localeCompare(b.fecha) || ORDEN[a.tipo] - ORDEN[b.tipo] || a.titulo.localeCompare(b.titulo),
  )
  return { desde: hoy, hasta, eventos }
}
