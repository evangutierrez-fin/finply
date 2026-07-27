// Tipos compartidos entre servidor y cliente.
// Todo el dinero se maneja en centavos enteros para evitar errores de punto flotante.

export type ProfileKind = 'personal' | 'negocio'
export type Accent = 'verde' | 'laton' | 'cobalto' | 'vino'

export interface Profile {
  id: number
  name: string
  kind: ProfileKind
  accent: Accent
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
