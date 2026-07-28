// Tipos compartidos entre servidor y cliente.
// Todo el dinero se maneja en centavos enteros para evitar errores de punto flotante.

export type ProfileKind = 'personal' | 'negocio'
export type Accent = 'verde' | 'laton' | 'cobalto' | 'vino'

export interface Profile {
  id: number
  name: string
  kind: ProfileKind
  accent: Accent
  /**
   * Tinta propia del perfil, si eligió una. `null` usa el preset de `accent`.
   * Son **dos** colores porque son dos temas: ningún color alcanza AA sobre el
   * papel claro y el oscuro a la vez (medido, no supuesto).
   */
  accentHex: string | null
  accentHexDark: string | null
  createdAt: string
}

export type AccountType = 'efectivo' | 'banco' | 'tarjeta' | 'ahorro' | 'otro'

export interface Account {
  id: number
  profileId: number
  name: string
  type: AccountType
  currency: string
  openingCents: number
  archived: boolean
  balanceCents: number
  txCount: number
  /** Solo tarjetas. `null` mientras no se configuren. */
  creditLimitCents: number | null
  /** Día del mes en que corta la tarjeta (1–31, recortado en meses cortos). */
  cutDay: number | null
  /** Día límite de pago. */
  dueDay: number | null
}

export type TxType = 'ingreso' | 'gasto' | 'transferencia'

export interface Category {
  id: number
  profileId: number
  name: string
  kind: 'ingreso' | 'gasto'
  /** Movimientos que la usan; sirve para avisar antes de borrarla. */
  txCount: number
}

export interface Tag {
  id: number
  profileId: number
  name: string
  txCount: number
}

export interface Tx {
  id: number
  profileId: number
  accountId: number
  accountName: string
  type: TxType
  amountCents: number
  date: string
  categoryId: number | null
  categoryName: string | null
  note: string
  transferAccountId: number | null
  transferAccountName: string | null
  debtPaymentId: number | null
  investmentEntryId: number | null
  /** Si viene, este movimiento es el cargo de una compra a meses. */
  msiPurchaseId: number | null
  /** Si viene, este movimiento es el desembolso de una deuda. */
  debtId: number | null
  tags: { id: number; name: string }[]
}

export type DebtDirection = 'por_cobrar' | 'por_pagar'
export type DebtStatus = 'abierta' | 'saldada'

export interface DebtPayment {
  id: number
  debtId: number
  amountCents: number
  date: string
  note: string
  /** Parte del abono que se fue en intereses; 0 en una deuda sin tasa. */
  interestCents: number
  /** Lo que sí bajó el principal. */
  capitalCents: number
}

export interface Debt {
  id: number
  profileId: number
  direction: DebtDirection
  counterparty: string
  concept: string
  principalCents: number
  startDate: string
  dueDate: string | null
  status: DebtStatus
  /** Todo lo abonado, capital e intereses juntos. */
  paidCents: number
  /** Tasa anual en puntos base: 24.5 % = 2450. 0 es sin intereses. */
  annualRateBp: number
  /** Plazo en meses. Sin plazo no hay tabla de amortización. */
  termMonths: number | null
  /** Lo que se puso de contado al contratar. No es principal. */
  downPaymentCents: number
  /** De lo abonado, cuánto se fue en intereses. */
  interestPaidCents: number
  /** De lo abonado, cuánto bajó el principal. */
  capitalPaidCents: number
  /** Lo que de verdad debes hoy: principal − capital abonado. Nunca negativo. */
  balanceCents: number
  payments: DebtPayment[]
}

export interface FilaAmortizacion {
  n: number
  fecha: string
  pagoCents: number
  interesCents: number
  capitalCents: number
  saldoCents: number
}

/**
 * El plan original de la deuda, calculado sobre el principal desde su fecha de
 * inicio. Los abonos reales viven aparte, en `Debt.payments`.
 */
export interface Amortizacion {
  debtId: number
  pagoMensualCents: number
  totalPagadoCents: number
  totalInteresCents: number
  filas: FilaAmortizacion[]
}

// ── Tarjetas de crédito y meses sin intereses ─────────────────────────────

export interface ParcialidadMSI {
  id: number
  purchaseId: number
  /** 1..N. */
  number: number
  /** Corte en que se factura. */
  dueDate: string
  amountCents: number
}

export interface CompraMSI {
  id: number
  profileId: number
  accountId: number
  accountName: string
  concept: string
  totalCents: number
  months: number
  purchaseDate: string
  categoryId: number | null
  categoryName: string | null
  /** El cargo a la tarjeta que ancla la compra. */
  txId: number | null
  parcialidades: ParcialidadMSI[]
}

export interface EstadoTarjeta {
  accountId: number
  name: string
  creditLimitCents: number | null
  cutDay: number | null
  dueDay: number | null
  /** Lo que debes hoy en total, con la compra a meses completa. */
  deudaCents: number
  /** Límite menos deuda. `null` sin límite configurado. */
  disponibleCents: number | null
  /** Último corte que ya ocurrió. `null` sin día de corte configurado. */
  fechaCorte: string | null
  fechaLimitePago: string | null
  /** Lo facturado hasta el corte, ya descontando lo pagado hasta esa fecha. */
  saldoAlCorteCents: number | null
  /** Abonos posteriores al corte. */
  pagadoDesdeCorteCents: number | null
  /** Lo que falta pagar del corte para no generar intereses. */
  paraNoGenerarInteresesCents: number | null
  /** Parcialidades de MSI que aún no se facturan. */
  msiPorFacturarCents: number
  /** Lo que sumarán las parcialidades en el próximo corte. */
  msiProximoCorteCents: number
}

export interface Summary {
  month: string
  accounts: Account[]
  totalCents: number
  incomeCents: number
  expenseCents: number
  byDay: { date: string; incomeCents: number; expenseCents: number }[]
  byCategory: { name: string; expenseCents: number }[]
  recent: Tx[]
  debts: { porCobrarCents: number; porPagarCents: number; abiertas: number }
  investments: { investedCents: number; valueCents: number; count: number }
}

// ── Reportes históricos ───────────────────────────────────────────────────
//
// Un préstamo recibido no es ingreso y un aporte a una inversión no es gasto:
// mover dinero entre bolsillos propios no cuenta. De un abono a deuda cuenta
// solo el interés. Todo lo de aquí sigue esa regla.

export interface MesReporte {
  month: string
  incomeCents: number
  expenseCents: number
  netCents: number
}

export interface PuntoPatrimonio {
  month: string
  cuentasCents: number
  inversionesCents: number
  porCobrarCents: number
  porPagarCents: number
  /** Cuentas + inversiones + por cobrar − por pagar, igual que el Resumen. */
  totalCents: number
}

export interface ReporteAnual {
  year: number
  /** Los doce meses, incluidos los vacíos. */
  meses: MesReporte[]
  patrimonio: PuntoPatrimonio[]
  porCategoria: { name: string; expenseCents: number }[]
  porEtiqueta: { name: string; expenseCents: number }[]
  totales: {
    incomeCents: number
    expenseCents: number
    netCents: number
    /** Fracción de lo que entró que no salió. `null` si no hubo ingresos. */
    tasaAhorro: number | null
  }
}

export interface Comparativa {
  month: string
  anterior: string
  actual: { incomeCents: number; expenseCents: number }
  previo: { incomeCents: number; expenseCents: number }
  categorias: { name: string; actualCents: number; previoCents: number; deltaCents: number }[]
}

// ── Recurrencias y calendario ─────────────────────────────────────────────
//
// La automatización **propone**; el usuario asienta (R4). No existe un modo
// que escriba solo. Las propuestas ni siquiera se guardan: se derivan de las
// plantillas menos los periodos ya resueltos (D7).

export type Frecuencia = 'mensual' | 'quincenal' | 'semanal' | 'anual'

export interface Recurrencia {
  id: number
  profileId: number
  accountId: number
  accountName: string
  type: TxType
  amountCents: number
  categoryId: number | null
  categoryName: string | null
  transferAccountId: number | null
  transferAccountName: string | null
  note: string
  frequency: Frecuencia
  /** Día del mes; en quincenal es el de la primera. 31 = el último del mes. */
  dayOfMonth: number | null
  dayOfMonth2: number | null
  monthOfYear: number | null
  /** Día de la semana ISO: 1 = lunes … 7 = domingo. */
  weekday: number | null
  startDate: string
  endDate: string | null
  archived: boolean
  tags: { id: number; name: string }[]
  /** Cómo se lee la periodicidad, ya en español. */
  descripcion: string
  /** Lo que viene, si es que viene algo. */
  proximaFecha: string | null
  /** Periodos vencidos sin resolver. Es lo que la bandeja va a proponer. */
  pendientes: number
}

/**
 * Una propuesta. No existe en la base: se calcula al vuelo y desaparece en
 * cuanto el usuario la asienta o la descarta.
 */
export interface Propuesta {
  recurrenceId: number
  /** Clave del hueco: '2026-07', '2026-07-Q1', '2026-W31', '2026'. */
  periodo: string
  fecha: string
  accountId: number
  accountName: string
  type: TxType
  amountCents: number
  categoryId: number | null
  categoryName: string | null
  transferAccountId: number | null
  transferAccountName: string | null
  note: string
  tags: { id: number; name: string }[]
  descripcion: string
  /** Días de atraso respecto a hoy. Cero el mismo día. */
  atraso: number
}

export interface Bandeja {
  items: Propuesta[]
  /** Propuestas que hay en total, más allá de esta página. */
  total: number
  /** Alguna plantilla llegó al tope de periodos: hay más de los que caben. */
  truncado: boolean
}

export type TipoEvento = 'recurrencia' | 'corte' | 'pago_tarjeta' | 'deuda' | 'msi'

/** Algo que vence. Todo derivado y de solo lectura (D9). */
export interface EventoCalendario {
  fecha: string
  tipo: TipoEvento
  titulo: string
  detalle: string
  /** `null` cuando el monto aún no se sabe (un corte que no ha ocurrido). */
  montoCents: number | null
  /** A qué apunta, para poder navegar hasta ahí. */
  refId: number | null
  /** Solo en recurrencias: identifica la propuesta. */
  periodo?: string
}

export interface Calendario {
  desde: string
  hasta: string
  eventos: EventoCalendario[]
}

// ── Alertas y análisis ────────────────────────────────────────────────────
//
// Las alertas son **derivadas y no se descartan** (D10): se calculan al vuelo
// y se apagan solas cuando el hecho deja de ser cierto. No hay tabla, no hay
// "ya lo vi" que pueda quedarse viejo, y ninguna lectura escribe.

export type TipoAlerta = 'presupuesto' | 'tarjeta' | 'recurrencia' | 'deuda' | 'meta'

/** `alta` es lo que cuesta dinero si se ignora; `media`, lo que conviene ver. */
export type Severidad = 'alta' | 'media'

export interface Alerta {
  tipo: TipoAlerta
  severidad: Severidad
  titulo: string
  detalle: string
  /** `null` cuando la alerta no es de un monto (una meta que va lenta). */
  montoCents: number | null
  refId: number | null
  /** A qué sección lleva el clic. */
  vista: 'presupuestos' | 'tarjetas' | 'recurrencias' | 'deudas' | 'metas'
}

export interface CategoriaParte {
  name: string
  expenseCents: number
  /** Fracción del gasto del periodo, de 0 a 1. */
  parte: number
}

/**
 * El panel de análisis. Mira **meses cerrados**: el mes en curso va a medias y
 * arrastraría hacia abajo cualquier promedio.
 */
export interface Analisis {
  /** Primer y último mes cerrado que entraron, 'AAAA-MM'. */
  desde: string
  hasta: string
  /** Cuántos meses cerrados hay de verdad; puede ser menos que los pedidos. */
  meses: number
  incomeCents: number
  expenseCents: number
  /** La misma que los reportes, calculada con el mismo código (D6). */
  tasaAhorro: number | null
  /** Gasto nacido de una recurrencia, por la liga que dejó la Fase 5 (D11). */
  recurrenteCents: number
  /** Todo lo demás. Incluye lo recurrente registrado a mano: se dice en la vista. */
  discrecionalCents: number
  /** Gasto operativo promedio por mes cerrado. `null` sin meses cerrados. */
  gastoPromedioCents: number | null
  /** Efectivo, banco y ahorro de cuentas activas. La tarjeta no es colchón. */
  liquidoCents: number
  /** Líquido entre gasto promedio. `null` si no hay de qué dividir. */
  mesesColchon: number | null
  /** Categorías del periodo con su parte del gasto, de mayor a menor. */
  concentracion: CategoriaParte[]
}

export type InvestmentKind = 'cetes' | 'acciones' | 'cripto' | 'fondo' | 'inmueble' | 'otro'
export type InvestmentEntryType = 'aporte' | 'retiro' | 'valuacion'

export interface InvestmentEntry {
  id: number
  investmentId: number
  type: InvestmentEntryType
  amountCents: number
  date: string
  note: string
}

export interface Investment {
  id: number
  profileId: number
  name: string
  kind: InvestmentKind
  note: string
  archived: boolean
  createdAt: string
  investedCents: number
  valueCents: number
  entries: InvestmentEntry[]
}

export interface Budget {
  id: number
  profileId: number
  categoryId: number
  categoryName: string
  /** Mes al que aplica el tope, 'AAAA-MM'. */
  month: string
  amountCents: number
  spentCents: number
}

export interface GoalEntry {
  id: number
  goalId: number
  amountCents: number
  date: string
  note: string
}

export interface Goal {
  id: number
  profileId: number
  name: string
  targetCents: number
  dueDate: string | null
  note: string
  status: 'activa' | 'cumplida'
  savedCents: number
  entries: GoalEntry[]
}

export interface Note {
  id: number
  profileId: number
  title: string
  body: string
  pinned: boolean
  createdAt: string
  updatedAt: string
}

// ── Importación de CSV ────────────────────────────────────────────────────

export type CampoImport =
  | 'fecha' | 'monto' | 'cargo' | 'abono' | 'tipo'
  | 'cuenta' | 'cuentaDestino' | 'categoria' | 'etiquetas' | 'concepto'

/** Campo → índice de columna en el archivo. */
export type MapeoImport = Partial<Record<CampoImport, number>>

export type EstadoFila = 'nueva' | 'duplicada' | 'error'

export interface FilaAnalizada {
  /** Número de línea en el archivo, contando el encabezado. */
  linea: number
  estado: EstadoFila
  motivo?: string
  date: string
  type: TxType
  amountCents: number
  accountName: string
  transferAccountName: string
  categoryName: string
  tagNames: string[]
  note: string
}

export interface InformeImport {
  /** Identifica lo analizado; importar exige que coincida con lo aprobado. */
  huella: string
  separador: string
  encabezados: string[]
  mapeo: MapeoImport
  filas: FilaAnalizada[]
  resumen: {
    total: number
    nuevas: number
    duplicadas: number
    errores: number
    categoriasPorCrear: string[]
    etiquetasPorCrear: string[]
    cuentasNoEncontradas: string[]
  }
}

export interface ResultadoImport {
  batchId: number
  importadas: number
  omitidas: number
  errores: number
  categoriasCreadas: number
  etiquetasCreadas: number
}

export interface LoteImport {
  id: number
  profileId: number
  filename: string
  rowCount: number
  createdAt: string
  /** Partidas que quedan del lote; menos que `rowCount` si anulaste algunas. */
  vigentes: number
}
