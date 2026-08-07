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
import { SALDO_FACTURA } from './facturas.ts'
import { reglaDe as reglaDeFactura } from './facturas-recurrentes.ts'
import { estadoTarjetas } from './tarjetas.ts'
import { montoPropuesto, promediosDe, reglaDe } from './recurrencias.ts'
import { tablaAmortizacion } from '../shared/credito.ts'
import {
  hoyISO,
  partesFecha,
  proximoDiaDelMes,
  siguienteDiaDelMes,
  sumarDias,
} from '../shared/fechas.ts'
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

  // El monto que se anuncia tiene que ser **el que la bandeja va a proponer**,
  // no la columna: con monto variable son distintos, y dos pantallas que
  // enseñan la misma partida no pueden decir dos cifras (D14).
  const promedios = promediosDe(ids)

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
        montoCents: montoPropuesto(row, promedios.get(row.id)),
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
  // Lo que va a caer es lo **cobrable**, no el total del documento: lo
  // retenido no lo va a pagar el cliente y lo cancelado con una nota de
  // crédito ya no se debe. Proyectarlo entero inflaría el flujo con dinero que
  // nadie va a mandar.
  const filas: any[] = db
    .prepare(
      `SELECT f.id, f.direction, f.folio, f.concept, f.due_date,
        ${SALDO_FACTURA} AS saldo,
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

/**
 * Las facturas que una plantilla va a emitir y que **todavía no se han
 * emitido**. Es al documento lo que `deRecurrencias` es al movimiento.
 *
 * Faltaba, y la asimetría se veía: un gasto recurrente sin confirmar aparecía
 * en el calendario y en el flujo, y la iguala del mes —que es la entrada más
 * segura que tiene un negocio— no aparecía en ninguno de los dos hasta que
 * alguien la emitía a mano. La respuesta a "¿llego a fin de mes?" se quedaba
 * corta justo del lado de lo que va a entrar.
 *
 * Tres decisiones, y las tres son de las que se pagan caras si se toman al
 * revés:
 *
 *   1. **El evento cae en la fecha de cobro, no en la de emisión.** Emitir no
 *      mueve un peso (D14): el dinero llega a los días de crédito. Ponerlo en
 *      la fecha de emisión metería en la caja de hoy un cobro de dentro de un
 *      mes, que es exactamente el error que el flujo existe para no cometer.
 *   2. **Solo las plantillas con días de crédito.** Sin ellos, la factura que
 *      salga nace sin vencimiento y `deFacturas` tampoco dice nada de ella —no
 *      hay fecha que proyectar—. Inventarle una supondría que te pagan el mismo
 *      día, y de los dos errores posibles ese es el que infla la caja.
 *   3. **El periodo resuelto se salta.** En cuanto se emite, la factura existe
 *      y `deFacturas` la anuncia por su saldo. Sin esto, el mismo cobro saldría
 *      dos veces —la plantilla y el documento— igual que pasó con las rentas.
 *
 * El monto es lo **cobrable**: total menos retenciones, la misma definición de
 * `COBRABLE`. Lo retenido no lo va a mandar el cliente.
 *
 * ⚠ Se generan las ocurrencias desde `hoy − días de crédito` y no desde `hoy`:
 * un periodo que se debió emitir la semana pasada y sigue en la bandeja cobra
 * dentro de la ventana, y mirar solo hacia adelante lo habría perdido.
 */
function deFacturasRecurrentes(
  profileId: number,
  desde: string,
  hasta: string,
): EventoCalendario[] {
  const filas: any[] = db
    .prepare(
      `SELECT r.*, c.name AS contraparte
       FROM invoice_recurrences r
       JOIN counterparties c ON c.id = r.counterparty_id
       WHERE r.profile_id = ? AND r.archived = 0 AND r.credit_days IS NOT NULL`,
    )
    .all(profileId)
  if (filas.length === 0) return []

  const ids = filas.map((r) => r.id)
  const resueltos = new Set(
    (
      db
        .prepare(
          `SELECT recurrence_id, period FROM invoice_recurrence_runs
           WHERE recurrence_id IN (${ids.map(() => '?').join(',')})`,
        )
        .all(...ids) as { recurrence_id: number; period: string }[]
    ).map((f) => `${f.recurrence_id}·${f.period}`),
  )

  const eventos: EventoCalendario[] = []
  for (const r of filas) {
    const credito = r.credit_days as number
    const cobrable = Math.max(
      0,
      r.subtotal_cents + r.tax_cents - r.withheld_tax_cents - r.withheld_income_cents,
    )
    if (cobrable === 0) continue
    const emitida = r.direction === 'emitida'
    for (const o of ocurrencias(reglaDeFactura(r), { desde: sumarDias(desde, -credito), hasta })
      .lista) {
      if (resueltos.has(`${r.id}·${o.periodo}`)) continue
      const cobro = sumarDias(o.fecha, credito)
      if (cobro < desde || cobro > hasta) continue
      eventos.push({
        fecha: cobro,
        tipo: 'factura_recurrente',
        titulo: emitida ? `Cobrar a ${r.contraparte}` : `Pagar a ${r.contraparte}`,
        detalle:
          `${r.concept || 'Factura recurrente'} · sin emitir todavía, ` +
          `a ${credito} ${credito === 1 ? 'día' : 'días'} de la emisión del ${fechaCorta(o.fecha)}`,
        montoCents: cobrable,
        refId: r.id as number,
        direccion: emitida ? 'entra' : 'sale',
        periodo: o.periodo,
      })
    }
  }
  return eventos
}

/** El día y el mes de una fecha, para meterla dentro de una frase. */
function fechaCorta(iso: string): string {
  const { mes, dia } = partesFecha(iso)
  return `${dia}/${String(mes).padStart(2, '0')}`
}

/**
 * Las rentas que caen en la ventana **y todavía no se han cobrado**. Entran por
 * lo mismo que las facturas y las deudas (D9): el calendario junta lo que
 * Finply ya sabe que va a caer, y una renta pactada es de lo más seguro que hay.
 *
 * ⚠ Lo ya cobrado se salta, igual que una recurrencia con su periodo resuelto.
 * Sin eso, un inquilino que paga el día 3 lo que vencía el 5 aparecía **dos
 * veces** en el flujo proyectado —el movimiento asentado y el cobro esperado—,
 * y la respuesta a "¿llego a fin de mes?" traía una renta de más. Las otras
 * fuentes ya lo evitaban cada una a su manera: la factura por su saldo, la
 * deuda por sus abonos, la recurrencia por `recurrence_runs`.
 *
 * El único dato que hay para emparejar es el **mes del movimiento**: un cobro
 * de renta no lleva a qué periodo pertenece. Un pago atrasado —la renta de
 * agosto cobrada el 2 de septiembre— tapa entonces la de septiembre, y eso es
 * a propósito: de los dos errores posibles, no anunciar un cobro que quizá ya
 * ocurrió es el prudente; anunciarlo dos veces infla la caja que el usuario
 * está contando.
 *
 * ⚠ Y si el usuario además guardó la renta como recurrencia, saldrá dos veces:
 * son dos cosas que él escribió y Finply no puede saber que hablan del mismo
 * dinero. Lo mismo pasa ya entre facturas y recurrencias.
 */
function deRentas(profileId: number, desde: string, hasta: string): EventoCalendario[] {
  const filas: any[] = db
    .prepare(
      `SELECT r.id, r.tenant, r.rent_cents, r.payment_day, r.start_date, r.end_date,
        a.name AS bien
       FROM rentals r
       JOIN assets a ON a.id = r.asset_id
       WHERE r.profile_id = ? AND r.archived = 0 AND r.rent_cents > 0
         AND r.start_date <= ? AND (r.end_date IS NULL OR r.end_date >= ?)`,
    )
    .all(profileId, hasta, desde)
  if (filas.length === 0) return []

  // Los meses ya cobrados de cada contrato, en **una** consulta para todos
  // (R11). Se mira desde el primer día del mes de `desde`: un cobro del día 1
  // queda fuera de la ventana y aun así liquida la renta que vence el 5.
  const cobrados = new Set(
    (
      db
        .prepare(
          `SELECT DISTINCT rental_id, substr(date, 1, 7) AS mes FROM transactions
           WHERE profile_id = ? AND rental_id IS NOT NULL AND rental_role = 'renta'
             AND date >= ? AND date <= ?`,
        )
        .all(profileId, `${desde.slice(0, 7)}-01`, hasta) as { rental_id: number; mes: string }[]
    ).map((f) => `${f.rental_id}·${f.mes}`),
  )

  const eventos: EventoCalendario[] = []
  for (const r of filas) {
    // Se recorren los cobros que caen dentro de la ventana. Son pocos —una
    // ventana de 90 días son tres— así que no hace falta consulta por mes.
    let fecha = proximoDiaDelMes(desde > r.start_date ? desde : r.start_date, r.payment_day)
    while (fecha <= hasta) {
      if (
        fecha >= desde &&
        (r.end_date === null || fecha <= r.end_date) &&
        !cobrados.has(`${r.id}·${fecha.slice(0, 7)}`)
      ) {
        eventos.push({
          fecha,
          tipo: 'renta' as const,
          titulo: `Cobrar la renta de ${r.bien}`,
          detalle: r.tenant || 'Sin inquilino apuntado',
          montoCents: r.rent_cents as number,
          refId: r.id as number,
          direccion: 'entra' as const,
        })
      }
      fecha = proximoDiaDelMes(sumarDias(fecha, 1), r.payment_day)
    }
  }
  return eventos
}

const ORDEN: Record<EventoCalendario['tipo'], number> = {
  pago_tarjeta: 0,
  deuda: 1,
  factura: 2,
  renta: 3,
  recurrencia: 3,
  // Detrás de la factura que ya existe: un documento emitido pesa más que uno
  // que todavía puede no emitirse.
  factura_recurrente: 3,
  msi: 4,
  corte: 5,
  // El calendario nunca genera uno: lo que ya está asentado no está por
  // confirmar. Lo agrega el flujo proyectado, que sí tiene que contarlo.
  movimiento: 6,
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
    ...(con('negocio') ? deFacturasRecurrentes(profileId, hoy, hasta) : []),
    ...(con('inmuebles') ? deRentas(profileId, hoy, hasta) : []),
  ]
  // Dentro de un mismo día manda lo que cuesta dinero si se te pasa.
  eventos.sort(
    (a, b) => a.fecha.localeCompare(b.fecha) || ORDEN[a.tipo] - ORDEN[b.tipo] || a.titulo.localeCompare(b.titulo),
  )
  return { desde: hoy, hasta, eventos }
}
