// Alertas del Resumen: lo que conviene saber hoy, calculado hoy.
//
// El modelo, decidido en D10: las alertas son **derivadas y no se descartan**.
// Se calculan al vuelo, se apagan solas en cuanto el hecho deja de ser cierto y
// no dejan una sola fila en la base. No hay tabla de "ya lo vi" que pueda
// quedarse vieja ni un GET con efectos. Es la misma línea de la bandeja de
// recurrencias (D7).
//
// Aquí vive además lo que el calendario de la Fase 5 no puede mostrar: **lo
// vencido**. Aquel mira hacia adelante a propósito, así que una fecha límite de
// tarjeta que ya pasó sin cubrirse o una mensualidad de deuda atrasada no
// salían en ningún lado. Salen aquí, y en rojo.
//
// R11: son cinco familias de alerta y no pueden ser diez consultas por carga
// del Resumen. Todo lo grande —movimientos, abonos, aportes— se agrega en SQL,
// y lo que ya calculan `estadoTarjetas` y `recurrencias.listar` se **reusa**,
// no se reescribe. Hay una prueba que cuenta las consultas.

import { db, modulosDe } from './db.ts'
import { presupuestosDelMes } from './presupuestos.ts'
import type { ModuloId } from '../shared/modulos.ts'
import { estadoTarjetas } from './tarjetas.ts'
import { listar as listarRecurrencias } from './recurrencias.ts'
import { tablaAmortizacion } from '../shared/credito.ts'
import { diasEntre, hoyISO, sumarDias } from '../shared/fechas.ts'
import { cantidadTexto } from '../shared/giro.ts'
import type { Alerta } from '../shared/types.ts'

/**
 * Con cuántos días de anticipación se avisa un vencimiento. El operador es
 * `<=`: faltando exactamente estos días la alerta **ya** aparece. Hay prueba
 * de los dos lados de la frontera.
 */
const DIAS_AVISO = 5

/** Los cargos recurrentes se avisan más pegados: el calendario ya los lista. */
const DIAS_AVISO_RECURRENCIA = 3

/**
 * Cuentas por debajo del mínimo que el usuario declaró. Solo las activas y
 * solo las que tienen mínimo: sin ese número no hay nada que comparar, y
 * suponer uno sería inventar cuánto colchón necesita cada quien.
 */
function deSaldoMinimo(profileId: number): Alerta[] {
  const filas: any[] = db
    .prepare(
      `SELECT a.id, a.name, a.min_balance_cents,
        a.opening_cents
          + COALESCE((SELECT SUM(CASE
              WHEN t.type = 'ingreso' THEN t.amount_cents ELSE -t.amount_cents END)
            FROM transactions t WHERE t.account_id = a.id), 0)
          + COALESCE((SELECT SUM(t.amount_cents)
            FROM transactions t WHERE t.transfer_account_id = a.id), 0) AS saldo
       FROM accounts a
       WHERE a.profile_id = ? AND a.archived = 0 AND a.min_balance_cents IS NOT NULL
       ORDER BY a.name ASC`,
    )
    .all(profileId)

  // Estrictamente menor: quedarse **en** el mínimo es cumplirlo.
  return filas
    .filter((f) => f.saldo < f.min_balance_cents)
    .map((f) => ({
      tipo: 'saldo_minimo' as const,
      severidad: 'media' as const,
      titulo: `${f.name} bajó del mínimo`,
      detalle: `Tiene ${pesos(f.saldo)} y tu mínimo son ${pesos(f.min_balance_cents)}`,
      montoCents: f.min_balance_cents - f.saldo,
      refId: f.id,
      vista: 'cuentas' as const,
    }))
}

/**
 * Presupuestos rebasados del mes en curso, y el tope total si lo hay.
 *
 * El umbral es **estrictamente mayor**: gastar exactamente el tope no es
 * excederlo —cerraste justo, que es lo que el presupuesto pedía—; un centavo
 * más sí. Sale del mismo cálculo que sirve `GET /api/budgets`, no de una
 * consulta paralela, para que la alerta y la vista de Presupuestos no puedan
 * decir cifras distintas del mismo mes.
 *
 * Se mide contra `topeCents` —el tope más lo que arrastró— y no contra lo
 * escrito: si el mes pasado sobraron $500 y este mes te pasaste por $300, no
 * te pasaste de nada, y gritarlo sería mentir con la cifra correcta.
 */
function dePresupuestos(profileId: number, mes: string, hoy: string): Alerta[] {
  const { mensuales, anuales, total } = presupuestosDelMes(profileId, mes, hoy)

  const deCategoria = [...mensuales, ...anuales]
    .filter((b) => b.spentCents > b.topeCents)
    .map((b) => ({
      tipo: 'presupuesto' as const,
      severidad: 'media' as const,
      // Un techo bajo cero no se puede anunciar como techo: "llevas $645.29 de
      // −$16,383.12" es una resta correcta y una frase que no dice nada. Cuando
      // el arrastre se comió el tope, la noticia es el arrastre.
      titulo:
        b.topeCents < 0
          ? `${b.categoryName}: el arrastre se comió el tope`
          : `${b.categoryName}: te pasaste del tope`,
      detalle:
        b.topeCents < 0
          ? `Vienes arrastrando ${pesos(-b.arrastreCents)} de ${b.arrastreMeses} ` +
            `${b.arrastreMeses === 1 ? 'mes' : 'meses'}: hasta cubrirlo no hay techo`
          : `Llevas ${pesos(b.spentCents)} de ${pesos(b.topeCents)} ` +
            (b.periodKind === 'anio' ? 'este año' : 'este mes'),
      montoCents: b.spentCents - b.topeCents,
      refId: b.id,
      vista: 'presupuestos' as const,
    }))

  // El total va aparte porque no es la suma de los otros: incluye lo gastado
  // en categorías sin tope, así que puede saltar aunque ninguna categoría se
  // haya pasado. Con su propio tipo para que no se mezcle en el orden ni
  // comparta `refId` con un renglón de otra tabla.
  const deTotal: Alerta[] =
    total && total.spentCents > total.amountCents
      ? [
          {
            tipo: 'presupuesto_total',
            severidad: 'media',
            titulo: 'Te pasaste del tope del mes',
            detalle: `Llevas ${pesos(total.spentCents)} de ${pesos(total.amountCents)} en todo el mes`,
            montoCents: total.spentCents - total.amountCents,
            refId: total.id,
            vista: 'presupuestos',
          },
        ]
      : []

  return [...deTotal, ...deCategoria]
}

/**
 * Tarjetas: la **fecha límite de pago**, antes y después.
 *
 * Es la fecha que cuesta dinero, no la del corte: el corte solo cierra el
 * periodo y ya vive en el calendario. Dos estados, nunca los dos a la vez:
 * vencida y sin cubrir (alta), o por vencer dentro de `DIAS_AVISO` (media).
 * Reusa `estadoTarjetas`, que ya calcula el saldo al corte y lo que falta para
 * no generar intereses en dos consultas agregadas.
 */
function deTarjetas(profileId: number, hoy: string): Alerta[] {
  const alertas: Alerta[] = []
  for (const t of estadoTarjetas(profileId, hoy)) {
    const falta = t.paraNoGenerarInteresesCents ?? 0
    if (!t.fechaLimitePago || falta <= 0) continue

    if (t.fechaLimitePago < hoy) {
      const dias = diasEntre(t.fechaLimitePago, hoy)
      alertas.push({
        tipo: 'tarjeta',
        severidad: 'alta',
        titulo: `Se te pasó la fecha límite de ${t.name}`,
        detalle: `Venció hace ${dias} ${dias === 1 ? 'día' : 'días'} y quedaron ${pesos(falta)} del corte sin cubrir`,
        montoCents: falta,
        refId: t.accountId,
        vista: 'tarjetas',
      })
      continue
    }
    const dias = diasEntre(hoy, t.fechaLimitePago)
    if (dias <= DIAS_AVISO) {
      alertas.push({
        tipo: 'tarjeta',
        severidad: 'media',
        titulo: `Vence el pago de ${t.name}`,
        detalle:
          dias === 0
            ? `Hoy es la fecha límite: ${pesos(falta)} para no generar intereses`
            : `${dias === 1 ? 'Mañana' : `En ${dias} días`}: ${pesos(falta)} para no generar intereses`,
        montoCents: falta,
        refId: t.accountId,
        vista: 'tarjetas',
      })
    }
  }
  return alertas
}

/**
 * Recurrencias: lo que está por confirmar y lo que se cobra pronto.
 *
 * Se agregan en **dos alertas como mucho**, no una por plantilla: cinco
 * suscripciones no pueden ser cinco renglones rojos. Reusa `listar`, que ya
 * cuenta los periodos vencidos sin resolver y la próxima fecha de cada
 * plantilla; recalcularlo aquí sería tener dos aritméticas que deben coincidir.
 */
function deRecurrencias(profileId: number, hoy: string): Alerta[] {
  const recs = listarRecurrencias(profileId, hoy, { etiquetas: false })
  const alertas: Alerta[] = []

  const conPendientes = recs.filter((r) => r.pendientes > 0)
  const pendientes = conPendientes.reduce((s, r) => s + r.pendientes, 0)
  if (pendientes > 0) {
    const monto = conPendientes.reduce((s, r) => s + r.pendientes * r.amountCents, 0)
    alertas.push({
      tipo: 'recurrencia',
      severidad: 'media',
      titulo: `${pendientes} ${pendientes === 1 ? 'partida' : 'partidas'} por confirmar`,
      detalle:
        conPendientes.length === 1
          ? `De ${etiqueta(conPendientes[0]!.note, conPendientes[0]!.type)}, sin asentar en el libro`
          : `De ${conPendientes.length} plantillas, sin asentar en el libro`,
      montoCents: monto,
      refId: conPendientes.length === 1 ? conPendientes[0]!.id : null,
      vista: 'recurrencias',
    })
  }

  const proximas = recs.filter(
    (r) =>
      r.proximaFecha !== null &&
      r.proximaFecha >= hoy &&
      diasEntre(hoy, r.proximaFecha) <= DIAS_AVISO_RECURRENCIA,
  )
  if (proximas.length > 0) {
    const monto = proximas.reduce((s, r) => s + r.amountCents, 0)
    const una = proximas.length === 1 ? proximas[0]! : null
    alertas.push({
      tipo: 'recurrencia',
      severidad: 'media',
      titulo: una
        ? `${etiqueta(una.note, una.type)} ${una.type === 'ingreso' ? 'entra' : 'se cobra'} ${cuando(hoy, una.proximaFecha!)}`
        : `${proximas.length} movimientos recurrentes en ${DIAS_AVISO_RECURRENCIA} días`,
      detalle: una ? una.descripcion : `Suman ${pesos(monto)} entre todos`,
      montoCents: monto,
      refId: una?.id ?? null,
      vista: 'recurrencias',
    })
  }
  return alertas
}

/**
 * Deudas atrasadas. Dos formas de ir tarde, y las dos estaban sin cubrir:
 *
 *   · la **fecha pactada** ya pasó y todavía se debe algo;
 *   · el **plan** tiene una mensualidad vencida — la fila que sigue a los
 *     abonos hechos cayó antes de hoy. Es la misma fila que muestra la vista de
 *     Deudas y la misma que busca el calendario, solo que mirando hacia atrás.
 *
 * El umbral es estricto: lo que vence **hoy** no está atrasado.
 */
function deDeudas(profileId: number, hoy: string): Alerta[] {
  const deudas: any[] = db
    .prepare(
      `SELECT d.id, d.direction, d.counterparty, d.concept, d.due_date, d.term_months,
        d.annual_rate_bp, d.principal_cents, d.start_date,
        (SELECT COUNT(*) FROM debt_payments p WHERE p.debt_id = d.id) AS abonos,
        d.principal_cents - COALESCE((SELECT SUM(p.amount_cents - p.interest_cents)
          FROM debt_payments p WHERE p.debt_id = d.id), 0) AS saldo
       FROM debts d WHERE d.profile_id = ? AND d.status = 'abierta'
       ORDER BY d.id ASC`,
    )
    .all(profileId)

  const alertas: Alerta[] = []
  for (const d of deudas) {
    const saldo = Math.max(0, d.saldo)
    if (saldo <= 0) continue
    const suyo = d.direction === 'por_pagar'
    const quien = d.counterparty

    if (d.due_date && d.due_date < hoy) {
      const dias = diasEntre(d.due_date, hoy)
      alertas.push({
        tipo: 'deuda',
        severidad: 'alta',
        titulo: suyo ? `Venció lo de ${quien}` : `Te deben y ya venció: ${quien}`,
        detalle: `La fecha pactada pasó hace ${dias} ${dias === 1 ? 'día' : 'días'}${d.concept ? ` · ${d.concept}` : ''}`,
        montoCents: saldo,
        refId: d.id,
        vista: 'deudas',
      })
      continue
    }
    if (!d.term_months) continue

    // La amortización es pura: no toca la base, aunque se llame por deuda.
    const plan = tablaAmortizacion({
      principalCents: d.principal_cents,
      annualRateBp: d.annual_rate_bp,
      termMonths: d.term_months,
      startDate: d.start_date,
    })
    const siguiente = plan.filas[d.abonos]
    if (siguiente && siguiente.fecha < hoy) {
      const dias = diasEntre(siguiente.fecha, hoy)
      alertas.push({
        tipo: 'deuda',
        severidad: 'alta',
        titulo: suyo ? `Vas atrasado con ${quien}` : `${quien} va atrasado contigo`,
        detalle: `El pago ${siguiente.n} de ${d.term_months} venció hace ${dias} ${dias === 1 ? 'día' : 'días'}`,
        montoCents: siguiente.pagoCents,
        refId: d.id,
        vista: 'deudas',
      })
    }
  }
  return alertas
}

/**
 * Metas en riesgo: cuando el tiempo corre más rápido que el dinero.
 *
 * La aritmética, que va escrita en la vista (R9): se compara la fracción de
 * plazo transcurrida contra la fracción ya ahorrada, medidas desde el día en
 * que se creó la meta hasta su fecha límite. Se hace con enteros
 * —`transcurrido × objetivo` contra `total × ahorrado`— para que la frontera
 * sea exacta y no dependa de cómo redondee un flotante: ir **justo** al ritmo
 * no es ir en riesgo; un centavo por debajo, sí.
 *
 * Sin fecha límite no hay riesgo que medir: una meta sin plazo no llega tarde.
 */
function deMetas(profileId: number, hoy: string): Alerta[] {
  const metas: any[] = db
    .prepare(
      `SELECT g.id, g.name, g.target_cents, g.due_date, substr(g.created_at, 1, 10) AS inicio,
        COALESCE((SELECT SUM(e.amount_cents) FROM goal_entries e WHERE e.goal_id = g.id), 0) AS ahorrado
       FROM goals g
       WHERE g.profile_id = ? AND g.status = 'activa' AND g.due_date IS NOT NULL
       ORDER BY g.due_date ASC, g.id ASC`,
    )
    .all(profileId)

  const alertas: Alerta[] = []
  for (const g of metas) {
    const falta = g.target_cents - g.ahorrado
    if (falta <= 0) continue

    if (g.due_date < hoy) {
      const dias = diasEntre(g.due_date, hoy)
      alertas.push({
        tipo: 'meta',
        severidad: 'alta',
        titulo: `Se pasó la fecha de "${g.name}"`,
        detalle: `Venció hace ${dias} ${dias === 1 ? 'día' : 'días'} y faltan ${pesos(falta)}`,
        montoCents: falta,
        refId: g.id,
        vista: 'metas',
      })
      continue
    }

    const total = diasEntre(g.inicio, g.due_date)
    // Una meta creada el mismo día en que vence no tiene plazo que repartir:
    // no se puede decir si va lenta, así que no se dice.
    if (total <= 0) continue
    const transcurrido = Math.min(Math.max(diasEntre(g.inicio, hoy), 0), total)
    if (transcurrido * g.target_cents > total * g.ahorrado) {
      alertas.push({
        tipo: 'meta',
        severidad: 'media',
        titulo: `"${g.name}" va más lenta que su plazo`,
        detalle: `Llevas ${porcentaje(g.ahorrado, g.target_cents)} del monto con ${porcentaje(transcurrido, total)} del tiempo corrido`,
        montoCents: falta,
        refId: g.id,
        vista: 'metas',
      })
    }
  }
  return alertas
}

// ── Módulos de giro (Fase 15) ─────────────────────────────────────────────

/** Cuánto antes se avisa que un contrato se acaba. */
const DIAS_FIN_CONTRATO = 60

/**
 * El contrato que se acaba. Es la única alerta de inmuebles porque es la única
 * que **no se puede ver de otro modo**: la renta que no llegó ya la enseña el
 * flujo, pero un contrato que vence en un mes no aparece en ningún lado hasta
 * que el inquilino avisa.
 */
function deArrendamientos(profileId: number, hoy: string): Alerta[] {
  const filas: any[] = db
    .prepare(
      `SELECT r.id, r.tenant, r.end_date, r.rent_cents, a.name AS bien
       FROM rentals r
       JOIN assets a ON a.id = r.asset_id
       WHERE r.profile_id = ? AND r.archived = 0 AND r.end_date IS NOT NULL
         AND r.end_date >= ? AND r.end_date <= ?
       ORDER BY r.end_date ASC`,
    )
    .all(profileId, hoy, sumarDias(hoy, DIAS_FIN_CONTRATO))

  return filas.map((r) => {
    const dias = diasEntre(hoy, r.end_date)
    return {
      tipo: 'arrendamiento' as const,
      severidad: dias <= 30 ? ('alta' as const) : ('media' as const),
      titulo: `El contrato de ${r.bien} termina ${cuando(hoy, r.end_date)}`,
      detalle:
        `${r.tenant || 'El inquilino'} paga ${pesos(r.rent_cents)} al mes: ` +
        'si no se renueva, esa entrada deja de estar',
      montoCents: r.rent_cents,
      refId: r.id,
      vista: 'inmuebles' as const,
    }
  })
}

/** Cuántos días antes empieza a avisar una cotización por vencer. */
const DIAS_VIGENCIA = 7

/**
 * La cotización que se te vence sin respuesta (Fase 19).
 *
 * Solo las **emitidas**: una orden de compra que se pasa de vigencia es
 * problema del proveedor, no tuyo, y avisarte de las dos convertiría la sección
 * en ruido. Y solo las que siguen en 'enviada': una aceptada o una perdida ya
 * tienen respuesta, y su fecha dejó de importar.
 *
 * Las que **ya se pasaron** son 'alta' —ese trabajo se está enfriando— y las
 * que se pasan esta semana, 'media'.
 */
function deCotizaciones(profileId: number, hoy: string): Alerta[] {
  const filas: any[] = db
    .prepare(
      `SELECT q.id, q.folio, q.concept, q.valid_until,
        q.subtotal_cents + q.tax_cents AS total, c.name AS contraparte
       FROM quotes q
       JOIN counterparties c ON c.id = q.counterparty_id
       WHERE q.profile_id = ? AND q.direction = 'emitida' AND q.status = 'enviada'
         AND q.valid_until IS NOT NULL AND q.valid_until <= ?
       ORDER BY q.valid_until ASC`,
    )
    .all(profileId, sumarDias(hoy, DIAS_VIGENCIA))

  return filas.map((q) => {
    const vencida = q.valid_until < hoy
    const nombre = q.concept || q.folio || 'Una cotización'
    return {
      tipo: 'cotizacion' as const,
      severidad: vencida ? ('alta' as const) : ('media' as const),
      titulo: vencida
        ? `Se te venció la cotización de ${q.contraparte}`
        : `La cotización de ${q.contraparte} vence ${cuando(hoy, q.valid_until)}`,
      detalle:
        `${nombre} por ${pesos(q.total)}: ` +
        (vencida
          ? 'sigue sin respuesta y el precio que prometiste ya no te obliga'
          : 'si la vas a sostener, conviene confirmarla antes'),
      montoCents: q.total,
      refId: q.id,
      vista: 'cotizaciones' as const,
    }
  })
}

/**
 * El anaquel que se está vaciando. Solo habla de productos con mínimo puesto:
 * sin él, Finply no tiene forma de saber cuánto es poco para ese negocio.
 */
function deExistencias(profileId: number): Alerta[] {
  const filas: any[] = db
    .prepare(
      `SELECT p.id, p.name, p.unit, p.min_qty_milli AS minimo,
        COALESCE((SELECT SUM(CASE WHEN m.kind = 'salida' THEN -m.qty_milli ELSE m.qty_milli END)
          FROM stock_moves m WHERE m.product_id = p.id), 0) AS existencia
       FROM products p
       WHERE p.profile_id = ? AND p.archived = 0 AND p.min_qty_milli IS NOT NULL
       ORDER BY p.name ASC`,
    )
    .all(profileId)

  return filas
    .filter((p) => p.existencia < p.minimo)
    .map((p) => ({
      tipo: 'existencias' as const,
      severidad: p.existencia <= 0 ? ('alta' as const) : ('media' as const),
      titulo:
        p.existencia <= 0 ? `Te quedaste sin ${p.name}` : `Queda poco ${p.name}`,
      detalle:
        `${cantidadTexto(p.existencia)} ${p.unit} contra un mínimo de ` +
        `${cantidadTexto(p.minimo)}`,
      montoCents: null,
      refId: p.id,
      vista: 'inventario' as const,
    }))
}

// ── Formato ───────────────────────────────────────────────────────────────

function pesos(cents: number): string {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(cents / 100)
}

function porcentaje(parte: number, total: number): string {
  return `${Math.round((parte / total) * 100)} %`
}

function etiqueta(note: string, type: string): string {
  return note || (type === 'ingreso' ? 'Un ingreso recurrente' : 'Un gasto recurrente')
}

function cuando(hoy: string, fecha: string): string {
  const dias = diasEntre(hoy, fecha)
  if (dias === 0) return 'hoy'
  if (dias === 1) return 'mañana'
  return `en ${dias} días`
}

/** Lo urgente primero; dentro de una severidad, el orden en que se generaron. */
const ORDEN: Record<Alerta['tipo'], number> = {
  tarjeta: 0,
  saldo_minimo: 1,
  deuda: 2,
  presupuesto_total: 3,
  presupuesto: 4,
  recurrencia: 5,
  meta: 6,
  // Las de giro van al final dentro de su severidad: son de quien encendió ese
  // módulo, no de todo el mundo.
  arrendamiento: 7,
  existencias: 8,
  cotizacion: 9,
}

/** Qué módulo tiene que estar encendido para que una familia hable. */
const MODULO_DE: Record<Alerta['tipo'], ModuloId | null> = {
  tarjeta: 'tarjetas',
  // Cuentas es núcleo: el aviso de saldo mínimo no se apaga con ningún módulo.
  saldo_minimo: null,
  deuda: 'deudas',
  presupuesto: 'presupuestos',
  presupuesto_total: 'presupuestos',
  recurrencia: 'recurrencias',
  meta: 'metas',
  arrendamiento: 'inmuebles',
  existencias: 'inventario',
  cotizacion: 'negocio',
}

/**
 * Todo lo que hoy merece un aviso, de lo más urgente a lo menos. De solo
 * lectura: aquí no se escribe una sola fila.
 *
 * Las familias de un módulo apagado ni siquiera se calculan. No es solo
 * cosmético: cada alerta lleva un `vista` al que se navega con un clic, y
 * mandar al usuario a una sección que no está en su lomo es peor que callarse.
 * Además ahorra sus consultas, que es justo lo que R11 pide.
 */
export function alertas(profileId: number, hoy = hoyISO()): Alerta[] {
  const activos = modulosDe(profileId)
  const con = (id: ModuloId) => activos.includes(id)

  const lista = [
    ...(con('tarjetas') ? deTarjetas(profileId, hoy) : []),
    ...deSaldoMinimo(profileId),
    ...(con('deudas') ? deDeudas(profileId, hoy) : []),
    ...(con('presupuestos') ? dePresupuestos(profileId, hoy.slice(0, 7), hoy) : []),
    ...(con('recurrencias') ? deRecurrencias(profileId, hoy) : []),
    ...(con('metas') ? deMetas(profileId, hoy) : []),
    ...(con('inmuebles') ? deArrendamientos(profileId, hoy) : []),
    ...(con('inventario') ? deExistencias(profileId) : []),
    ...(con('negocio') ? deCotizaciones(profileId, hoy) : []),
  ].filter((a) => {
    const modulo = MODULO_DE[a.tipo]
    return modulo === null || con(modulo)
  })
  const peso = (a: Alerta) => (a.severidad === 'alta' ? 0 : 1)
  return lista.sort((a, b) => peso(a) - peso(b) || ORDEN[a.tipo] - ORDEN[b.tipo])
}
