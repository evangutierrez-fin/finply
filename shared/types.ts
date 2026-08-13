// Tipos compartidos entre servidor y cliente.
// Todo el dinero se maneja en centavos enteros para evitar errores de punto flotante.

export type ProfileKind = 'personal' | 'negocio'
export type Accent = 'verde' | 'laton' | 'cobalto' | 'vino'

// El catálogo de módulos vive en `shared/modulos.ts`, que es puro y lo usan
// las dos mitades. Aquí solo se reexporta el id para que `Profile` lo lleve.
export type { ModuloId } from './modulos.ts'

// La recta de tendencia nace en `shared/estadistica.ts`, donde vive su
// aritmética y donde se puede probar. Aquí solo se reexporta.
export type { Tendencia } from './estadistica.ts'
import type { Tendencia } from './estadistica.ts'

// Lo mismo con el plan de pago mínimo: su aritmética vive en `shared/credito.ts`
// junto a la amortización, que es de donde salió.
export type { PlanPagoMinimo } from './credito.ts'
import type { PlanPagoMinimo } from './credito.ts'

// Y con el rendimiento de un inmueble rentado, que vive en `shared/giro.ts`
// con el resto de la aritmética de los módulos de giro.
export type { RendimientoInmueble } from './giro.ts'
import type { RendimientoInmueble } from './giro.ts'

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
  /** Cómo llama este perfil a su dimensión libre: "Proyecto", "Sucursal"… */
  dimensionLabel: string
  /**
   * La moneda del libro (D18). **Una por perfil**: las cuentas la heredan y
   * quien tenga dólares abre otro perfil. Hacer multimoneda de verdad exige
   * tipo de cambio con fecha, y eso es justo lo que R6 impide automatizar.
   */
  currency: string
  /**
   * Las secciones que lleva este libro. Ya resueltas: lo guardado son
   * overrides y lo que falta sale del juego por omisión del tipo (D16).
   */
  modules: import('./modulos.ts').ModuloId[]
  /**
   * Orden propio del lomo (Fase 21). `null` es el orden agrupado de siempre;
   * con una lista, el lomo se aplana y manda ella.
   */
  navOrder: string[] | null
  /** Qué sección abre al entrar. `null` es el Resumen. */
  homeView: string | null
  dateFormat: import('./formato.ts').FormatoFecha
  /** 1 = lunes … 7 = domingo. **Solo de vista**: no mueve la semana ISO (R5). */
  weekStart: number
  /** Redondear las cifras al peso a la vista. Nunca cambia lo guardado. */
  hideCents: boolean
  createdAt: string
}

/** Un campo propio del perfil (D24): el catálogo, no sus valores. */
export type TipoCampo = 'texto' | 'numero' | 'fecha' | 'lista' | 'casilla'

export interface CampoPropio {
  id: number
  profileId: number
  label: string
  kind: TipoCampo
  /** Solo en 'lista': una opción por renglón. */
  options: string
  position: number
  archived: boolean
  /** Cuántos movimientos lo tienen contestado. Derivado. */
  usos: number
}

/**
 * Una plantilla de movimiento: el formulario ya llenado, esperando confirmación.
 * **No es una recurrencia**: no tiene fecha, no tiene periodo y no propone nada
 * sola. Es lo que se teclea igual cada vez, guardado.
 */
export interface PlantillaTx {
  id: number
  profileId: number
  name: string
  type: TxType
  accountId: number | null
  accountName: string | null
  transferAccountId: number | null
  transferAccountName: string | null
  categoryId: number | null
  categoryName: string | null
  /** `null`: "el monto lo pongo yo cada vez". */
  amountCents: number | null
  note: string
  position: number
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
  /** Debajo de esto Finply avisa. `null` = sin aviso. */
  minBalanceCents: number | null
  /** Quién la lleva: "BBVA", "Nu", "bajo el colchón". */
  institution: string
  /** Orden en el que se listan; a igualdad, manda la antigüedad. */
  sortOrder: number
  /**
   * Lo que cuesta la tarjeta, copiado del contrato del usuario. Solo tarjetas
   * y solo si lo escribió: Finply no supone la tasa ni el mínimo de nadie.
   */
  annualRateBp: number | null
  minPaymentBp: number | null
  minPaymentFloorCents: number | null
}

export type TxType = 'ingreso' | 'gasto' | 'transferencia'

/**
 * Papel de una categoría de gasto en el estado de resultados. `null` es "sin
 * clasificar", que es como nacen todas: se muestran aparte en vez de
 * suponerles un lugar.
 */
export type RolCategoria = 'costo_venta' | 'gasto_fijo' | 'gasto_variable'

export interface Category {
  id: number
  profileId: number
  name: string
  kind: 'ingreso' | 'gasto'
  /**
   * El papel en el estado de resultados. **Un hijo sin papel toma el de su
   * padre** (D25): si no, colgar "Restaurante" de "Insumos" sacaría ese gasto
   * del costo de ventas y movería el punto de equilibrio sin que nadie lo
   * pidiera. `rolEfectivo` es el que de verdad se aplica.
   */
  role: RolCategoria | null
  rolEfectivo: RolCategoria | null
  /** Movimientos que la usan; sirve para avisar antes de borrarla. */
  txCount: number
  /** La categoría de la que cuelga. Un solo nivel: un padre no tiene padre. */
  parentId: number | null
  parentName: string | null
  /** Cuántas cuelgan de ella. Con hijos, no puede volverse hija de nadie. */
  hijos: number
  archived: boolean
  /**
   * Archivada de hecho: ella o su padre. Se hereda porque un padre archivado se
   * lleva su grupo del selector, y desarchivarlo lo devuelve tal cual (R17).
   */
  fueraDelSelector: boolean
}

/**
 * Una regla que **propone** categoría al importar (Fase 23). Propone, no
 * asienta (R4): se ve en la vista previa del import y el usuario confirma el
 * lote como siempre.
 */
export interface ReglaImport {
  id: number
  profileId: number
  /** Texto que se busca dentro del concepto, sin acentos ni mayúsculas. */
  pattern: string
  categoryId: number
  categoryName: string
  categoryKind: 'ingreso' | 'gasto'
  /** Gana la primera que case, así que la más específica va arriba. */
  position: number
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
  /**
   * Si viene, este movimiento pertenece a un arrendamiento. El papel importa:
   * la renta es ingreso y el depósito **no**, porque ese dinero no es tuyo.
   */
  rentalId: number | null
  rentalRole: 'renta' | 'deposito' | 'devolucion_deposito' | 'mantenimiento' | null
  /** Si viene, este movimiento cobra o paga esa factura. */
  invoiceId: number | null
  counterpartyId: number | null
  counterpartyName: string | null
  costCenterId: number | null
  costCenterName: string | null
  /** Impuesto **contenido** en el monto, no sumado a él. */
  taxCents: number
  deductible: boolean
  /** Fecha en que se palomeó contra el estado de cuenta. `null` sin conciliar. */
  reconciledAt: string | null
  /** Si viene, este movimiento devuelve ese gasto y **resta** de él (D6). */
  refundOfId: number | null
  tags: { id: number; name: string }[]
  /**
   * El reparto por categoría (D17). Vacío significa "sin dividir", y entonces
   * manda `categoryId`. Los renglones suman exactamente `amountCents`.
   */
  splits: TxSplit[]
  /** La ficha de los recibos adjuntos; los bytes se piden por su propia ruta. */
  attachments: TxAttachment[]
  /**
   * Las notas de la libreta atadas a esta partida (Fase 20). Solo el título:
   * en el listado se enseña que **hay** una nota, no la nota entera.
   */
  notes: { id: number; title: string }[]
  /**
   * Los campos propios contestados en esta partida (Fase 21), por id de campo.
   * **Ningún reporte los suma**: se ven, se editan y se exportan (D24).
   */
  fields: Record<string, string>
}

/**
 * Un movimiento a medio escribir. Lo que una sección le pasa al formulario
 * cuando ya sabe parte de la respuesta: la alerta de la tarjeta sabe cuánto y
 * a qué tarjeta, el calendario sabe qué renta cae y de cuánto es.
 *
 * Es **relleno, no registro** (R4): abre el formulario con los campos puestos
 * y el usuario sigue teniendo que confirmarlo.
 */
export interface BorradorTx {
  type?: TxType
  amountCents?: number
  accountId?: number
  transferAccountId?: number
  categoryId?: number | null
  date?: string
  note?: string
  rentalId?: number | null
  rentalRole?: Tx['rentalRole']
  counterpartyId?: number | null
}

/**
 * Lo que la barra de registro rápido propone antes de que se escriba nada.
 * Es una propuesta y nada más: nadie asienta hasta que el usuario lo diga (R4).
 */
export interface SugerenciaTx {
  /** La última partida **registrada**, para poder repetirla. */
  ultima: Tx | null
  /** Por tipo, la cuenta y la categoría de la última vez. */
  porTipo: Partial<Record<TxType, { accountId: number; categoryId: number | null }>>
}

export interface TxSplit {
  id: number
  categoryId: number | null
  categoryName: string | null
  amountCents: number
  note: string
}

export interface TxAttachment {
  id: number
  filename: string
  mime: string
  sizeBytes: number
  createdAt: string
}

/**
 * Un corte de conciliación: lo que el estado de cuenta decía a esa fecha (D19).
 * Todo lo demás es derivado y se recalcula al leer.
 */
export interface CorteConciliacion {
  id: number
  profileId: number
  accountId: number
  accountName: string
  date: string
  /** Lo que declaró el usuario. */
  balanceCents: number
  /** Lo que suman las partidas ya palomeadas hasta esa fecha. */
  conciliadoCents: number
  /** Lo que suma el libro entero hasta esa fecha. */
  libroCents: number
  /** Cero es "cuadra"; lo demás es lo que falta por explicar. */
  diferenciaCents: number
  pendientes: number
  pendientesCents: number
  note: string
  createdAt: string
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
  /**
   * Comisión de apertura: la debes, pero nunca te la depositaron (D30). El
   * desembolso asienta `principal − comisión`, que es lo que de verdad llegó
   * a la cuenta.
   */
  originationFeeCents: number
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
  /** Lo que te depositaron: principal menos la comisión de apertura. */
  recibidoCents: number
  /**
   * La anual **efectiva** que anula lo recibido contra lo que vas a pagar, en
   * puntos base. Con comisión, sube; sin ella sigue siendo más alta que la del
   * contrato, porque la nominal no capitaliza. `null` si no se puede afirmar.
   */
  tasaEfectivaBp: number | null
}

// ── Estrategia de deuda: bola de nieve contra avalancha ───────────────────

export type OrdenEstrategia = 'bola_de_nieve' | 'avalancha'

export interface PlanEstrategia {
  orden: OrdenEstrategia
  /** Meses hasta no deber nada. `null` si con ese dinero esto no termina. */
  meses: number | null
  totalPagadoCents: number
  totalInteresCents: number
  /**
   * En el orden en que se **atacan**. No siempre es el orden en que terminan:
   * una barata al final de la fila puede acabarse antes por su propia cuota.
   */
  deudas: { id: number; nombre: string; mes: number | null; interesCents: number; pagadoCents: number }[]
  /** Saldo total al cierre de cada mes. El primero es el de hoy. */
  saldos: number[]
  nuncaTermina: boolean
}

/** Los dos métodos sobre las mismas deudas y el mismo dinero extra. */
export interface ComparacionEstrategia {
  extraMensualCents: number
  saldoTotalCents: number
  /** Lo que ya pagas al mes en cuotas, sin contar el extra. */
  cuotasCents: number
  deudas: { id: number; nombre: string; saldoCents: number; annualRateBp: number; pagoMensualCents: number }[]
  bolaDeNieve: PlanEstrategia
  avalancha: PlanEstrategia
  /** Lo que la avalancha ahorra frente a la bola de nieve. `null` si alguna no termina. */
  interesAhorradoCents: number | null
  mesesAhorrados: number | null
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
  /** Tasa anual en puntos base, como la escribió el usuario. `null` si no. */
  annualRateBp: number | null
  /** Porcentaje del saldo que exige el pago mínimo, en puntos base. */
  minPaymentBp: number | null
  minPaymentFloorCents: number | null
  /** El mínimo de este corte. `null` mientras falte cómo calcularlo. */
  pagoMinimoCents: number | null
  /**
   * Qué pasa si solo pagas el mínimo hasta liquidar. `null` sin tasa: sin
   * saber cuánto cobra la tarjeta no hay nada honesto que decir.
   */
  siPagasElMinimo: PlanPagoMinimo | null
}

export interface Summary {
  month: string
  accounts: Account[]
  totalCents: number
  /**
   * El mismo total al **cierre del mes pasado**, para poder restar. Un total
   * sin nada contra qué medirlo no dice si vas bien. Cuentas activas, como el
   * de arriba: si no, la resta no cuadraría con la cifra que se ve.
   */
  totalPrevioCents: number
  /** Los últimos 30 días de saldo de cada cuenta activa, un punto por día. */
  sparks: {
    desde: string
    hasta: string
    porCuenta: { accountId: number; puntos: number[] }[]
  }
  incomeCents: number
  expenseCents: number
  byDay: { date: string; incomeCents: number; expenseCents: number }[]
  /** Las seis mayores, **plegadas al padre** desde la Fase 23, con su desglose. */
  byCategory: { name: string; expenseCents: number; hijos: { name: string; expenseCents: number }[] }[]
  recent: Tx[]
  debts: { porCobrarCents: number; porPagarCents: number; abiertas: number }
  investments: { investedCents: number; valueCents: number; count: number }
  /** H3: el auto financiado también es tuyo. Entra al patrimonio por su valor. */
  bienes: { costCents: number; valueCents: number; count: number }
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
  bienesCents: number
  porCobrarCents: number
  porPagarCents: number
  /**
   * Cuentas + inversiones + bienes + por cobrar − por pagar, igual que el
   * Resumen. Los bienes entran por su **valor**: la deuda que los financia ya
   * está en `porPagar` y restarla aquí la contaría dos veces (R18).
   */
  totalCents: number
}

export interface ReporteAnual {
  year: number
  /** Los doce meses, incluidos los vacíos. */
  meses: MesReporte[]
  patrimonio: PuntoPatrimonio[]
  /**
   * Gasto por categoría, **agregado al padre** desde la Fase 23 (D25), con el
   * desglose colgando de cada renglón. `hijos` va vacío cuando la categoría no
   * tiene subcategorías, que es el caso de cualquier libro anterior.
   */
  porCategoria: { name: string; expenseCents: number; hijos: { name: string; expenseCents: number }[] }[]
  porEtiqueta: { name: string; expenseCents: number }[]
  /** De dónde vino el ingreso. Antes solo se desmenuzaba el gasto. */
  porFuente: { name: string; incomeCents: number; hijos: { name: string; incomeCents: number }[] }[]
  totales: {
    incomeCents: number
    expenseCents: number
    netCents: number
    /** Fracción de lo que entró que no salió. `null` si no hubo ingresos. */
    tasaAhorro: number | null
    /**
     * El mes de en medio, sobre los meses **con movimiento**. Los que no han
     * llegado valen cero y contarlos arrastraría la mediana al suelo.
     */
    medianaIngresoCents: number | null
    medianaGastoCents: number | null
    mesesConMovimiento: number
  }
}

/** Un rango de meses con sus totales, inclusivo por los dos lados. */
export interface PeriodoComparado {
  desde: string
  hasta: string
  incomeCents: number
  expenseCents: number
}

export interface Comparativa {
  actual: PeriodoComparado
  previo: PeriodoComparado
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
  /**
   * Inversión a la que aporta esta plantilla. Al asentar se registra también
   * el aporte y los dos quedan ligados, así que D6 lo saca del gasto del mes.
   */
  investmentId: number | null
  investmentName: string | null
  /**
   * De dónde sale el monto que propone. `promedio` usa las últimas asentadas y
   * deja `amountCents` como monto de arranque, para cuando no hay historial.
   */
  amountMode: ModoMonto
  /**
   * Ventana de pausa, inclusiva por los dos lados. Lo que cae dentro no
   * propone **nunca**: no es atraso, es un hueco declarado.
   */
  pausedFrom: string | null
  pausedUntil: string | null
  /** Termina tras tantas ocurrencias, contando las que de verdad caen. */
  maxOccurrences: number | null
  /** Lo que propondría hoy: el fijo, o el promedio si es de monto variable. */
  montoPropuestoCents: number
  /** Cuántas asentadas entraron en ese promedio. Cero si no hay historial. */
  muestrasPromedio: number
  /** El día de su última ocurrencia. `null` si no termina. */
  ultimaFecha: string | null
  tags: { id: number; name: string }[]
  /** Cómo se lee la periodicidad, ya en español. */
  descripcion: string
  /** Lo que viene, si es que viene algo. */
  proximaFecha: string | null
  /** Periodos vencidos sin resolver. Es lo que la bandeja va a proponer. */
  pendientes: number
}

export type ModoMonto = 'fijo' | 'promedio'

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
  /**
   * Inversión a la que aportaría. Sale de la cuenta, pero **no es gasto**
   * (D6), y por eso la bandeja lo cuenta aparte de los gastos.
   */
  investmentId: number | null
  investmentName: string | null
  /** Cómo se calculó el monto de arriba, para poder decirlo en la bandeja. */
  amountMode: ModoMonto
  /** Asentadas que entraron en el promedio. Cero cuando el monto es el fijo. */
  muestrasPromedio: number
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

export type TipoEvento =
  /** La renta de un inmueble arrendado (Fase 15). */
  | 'renta'
  | 'recurrencia'
  | 'corte'
  | 'pago_tarjeta'
  | 'deuda'
  | 'msi'
  | 'factura'
  /**
   * Una factura que **todavía no se emite**: el periodo de una plantilla que
   * sigue en la bandeja. Es al documento lo que 'recurrencia' es al
   * movimiento, y va aparte de 'factura' porque no es lo mismo de ninguna
   * manera que importe: aquella existe y esta no, aquella tiene folio y saldo
   * y esta tiene una fecha de cobro **proyectada**. En cuanto se emite, el
   * periodo queda resuelto y el evento pasa a ser 'factura'.
   */
  | 'factura_recurrente'
  /**
   * Una partida **ya asentada** con fecha futura. No la genera el calendario
   * —ahí solo va lo que está por confirmar—, sino el flujo proyectado, que
   * tiene que contarla: ya está en el libro y va a mover la caja.
   */
  | 'movimiento'

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
  /**
   * Hacia dónde mueve el dinero. Lo pone quien genera el evento, que es el
   * único que lo sabe con certeza: el flujo proyectado lee esto en vez de
   * volver a deducirlo, para que no haya dos versiones de lo que vence.
   */
  direccion: 'entra' | 'sale'
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

export type TipoAlerta =
  | 'presupuesto'
  /** Módulos de giro (Fase 15): el contrato que se acaba y el anaquel vacío. */
  | 'arrendamiento'
  | 'existencias'
  /** La cotización que se te vence sin respuesta (Fase 19). */
  | 'cotizacion'
  /** El techo de todo el mes: no es la suma de los otros, por eso va aparte. */
  | 'presupuesto_total'
  | 'tarjeta'
  | 'saldo_minimo'
  | 'recurrencia'
  | 'deuda'
  | 'meta'

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
  vista:
    | 'presupuestos'
    | 'tarjetas'
    | 'cuentas'
    | 'recurrencias'
    | 'deudas'
    | 'metas'
    | 'inmuebles'
    | 'inventario'
    | 'cotizaciones'
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
  /** De dónde vino el ingreso, con su parte. El espejo de `concentracion`. */
  fuentes: FuenteParte[]
  /** Un punto por mes cerrado, con los huecos en cero. */
  serie: { month: string; incomeCents: number; expenseCents: number }[]
  /** Recta de mínimos cuadrados sobre `serie`. `null` con menos de tres meses. */
  tendenciaGasto: Tendencia | null
  tendenciaIngreso: Tendencia | null
  /** El mes de en medio. Va junto al promedio, nunca en su lugar. */
  medianaGastoCents: number | null
  medianaIngresoCents: number | null
  /** El mismo mes del calendario, año contra año. Todo el libro, no la ventana. */
  estacionalidad: { anio: string; expenseCents: number }[]
  /** Categorías que en el último mes cerrado se salieron de su propio promedio. */
  disparadas: CategoriaDisparada[]
  hormiga: GastoHormiga
}

export interface FuenteParte {
  name: string
  incomeCents: number
  /** Fracción del ingreso del periodo, de 0 a 1. */
  parte: number
}

export interface CategoriaDisparada {
  name: string
  /** Lo del último mes cerrado. */
  expenseCents: number
  /** Su propio promedio en los meses anteriores en que hubo gasto. */
  promedioCents: number
  deltaCents: number
  /** Cuánto se pasó de su promedio, en fracción. 0.6 es 60 % arriba. */
  salto: number
  mesesPromediados: number
}

export interface GastoHormiga {
  /** Cuántos **movimientos** —no renglones de reparto— cayeron debajo del umbral. */
  partidas: number
  sumaCents: number
  /** El umbral con el que se midió. Va escrito junto al resultado (R9). */
  umbralCents: number
  /** Qué fracción del gasto del periodo son. */
  parte: number
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
  /** Unidades del movimiento ×10⁸. `null` si la inversión no las lleva. */
  unitsE8: number | null
  /** Precio por unidad en centavos. En una valuación manda sobre el monto. */
  unitPriceCents: number | null
}

export interface Investment {
  id: number
  profileId: number
  name: string
  kind: InvestmentKind
  note: string
  archived: boolean
  createdAt: string
  /** Aportado menos retirado, con piso en cero. */
  investedCents: number
  /** Suma de los aportes, sin restar nada. */
  aportadoCents: number
  retiradoCents: number
  /** Valor de hoy más lo retirado, menos lo aportado. No depende del piso. */
  gananciaCents: number
  /** Lo que costó lo que todavía tienes, con el costo consumido a prorrata (D31). */
  costoCents: number
  /** De la ganancia, la que ya cobraste al retirar. */
  gananciaRealizadaCents: number
  /** De la ganancia, la que sigue en papel. Las dos suman `gananciaCents`. */
  gananciaEnPapelCents: number
  valueCents: number
  /** Unidades en mano ×10⁸. Cero si nunca se registraron. */
  unitsE8: number
  /** Tasa anual efectiva (XIRR) como decimal. `null` si no se puede afirmar. */
  rendimientoAnual: number | null
  /** El valor después de cada registro: la serie de la gráfica. */
  puntos: { date: string; valueCents: number; unitsE8: number }[]
  entries: InvestmentEntry[]
}

/** Una fila del CSV de precios, ya interpretada y con su destino resuelto. */
export interface FilaPrecio {
  fila: number
  nombre: string
  fecha: string | null
  precioCents: number | null
  investmentId: number | null
  investmentName: string | null
  unitsE8: number
  /** Lo que valdría la inversión si se acepta esta fila. */
  valorCents: number | null
  estado: 'lista' | 'sin_inversion' | 'sin_unidades' | 'invalida'
  motivo: string
}

export interface InformePrecios {
  filas: FilaPrecio[]
  listas: number
  descartadas: number
}

export type EstrategiaSimulacion = 'invertir' | 'deuda'

export interface PuntoProyeccion {
  mes: number
  liquidoCents: number
  inversionesCents: number
  deudaCents: number
  patrimonioCents: number
  /** El mismo patrimonio en pesos del mes 0. Igual al nominal sin inflación. */
  patrimonioRealCents: number
  aportadoCents: number
  /** Las cuotas del plan de tus deudas hasta aquí: dinero tuyo que entra. */
  pagadoAPlanCents: number
  retiradoCents: number
  /** Lo que puso la tasa hasta aquí, sin el punto de partida ni lo que pusiste. */
  rendimientoCents: number
  /** Ese rendimiento contra lo puesto, en bp. `null` si la base no es positiva. */
  rendimientoBp: number | null
  interesPagadoCents: number
}

export interface Proyeccion {
  estrategia: EstrategiaSimulacion
  puntos: PuntoProyeccion[]
  patrimonioFinalCents: number
  patrimonioRealFinalCents: number
  aportadoCents: number
  pagadoAPlanCents: number
  retiradoCents: number
  rendimientoCents: number
  interesPagadoCents: number
  mesSinDeuda: number | null
  /** Primer mes en que el retiro no se pudo pagar completo. `null` si aguantó. */
  mesSinFondos: number | null
  /** La tasa anual que le sacaste a todo tu dinero, en bp. Ver `Proyeccion` en shared/simulador.ts. */
  tasaEquivalenteBp: number | null
}

export interface Simulacion {
  /** Punto de partida, tomado del libro tal como está hoy. */
  inicio: {
    liquidoCents: number
    inversionesCents: number
    deudaCents: number
    patrimonioCents: number
    deudas: { id: number; nombre: string; saldoCents: number; annualRateBp: number; pagoMensualCents: number }[]
  }
  supuestos: {
    meses: number
    ahorroMensualCents: number
    rendimientoAnualBp: number
    inflacionAnualBp: number
    mesesAporte: number
    retiroMensualCents: number
  }
  /** Las dos rutas, sobre los mismos supuestos, para poder compararlas. */
  invertir: Proyeccion
  deuda: Proyeccion
  /**
   * Cuánto habría que apartar al mes para llegar al objetivo, por ruta. `null`
   * en el objeto cuando no se preguntó; `null` en una ruta cuando no se llega
   * ni apartando el tope.
   */
  meta: { objetivoCents: number; invertirCents: number | null; deudaCents: number | null } | null
}

export interface Budget {
  id: number
  profileId: number
  categoryId: number
  categoryName: string
  /** Periodo al que aplica: 'AAAA-MM' si es mensual, 'AAAA' si es anual. */
  period: string
  periodKind: 'mes' | 'anio'
  /** El tope que escribió el usuario, sin el arrastre. */
  amountCents: number
  spentCents: number
  /** Si este renglón recibe el saldo del mes anterior. Solo los mensuales. */
  rollover: boolean
  /** Lo que trajo la cadena de atrás. Negativo si aquellos meses se pasaron. */
  arrastreCents: number
  /**
   * De cuántos meses viene ese arrastre. Uno solo se puede nombrar ("junio te
   * dejó $500"); tres no —la cifra es de los tres— y decir el nombre del
   * anterior sería atribuirle algo que no hizo.
   */
  arrastreMeses: number
  /** El techo de verdad contra el que se mide: `amountCents + arrastreCents`. */
  topeCents: number
  /** Lo que llevarías gastado yendo parejo: `topeCents` por lo que va del periodo. */
  esperadoCents: number
}

/** El techo de **todo** un mes, por encima del de cada categoría. */
export interface TopeTotal {
  id: number
  profileId: number
  month: string
  amountCents: number
  /** Todo el gasto operativo del mes, también el de categorías sin tope. */
  spentCents: number
  esperadoCents: number
}

export interface PresupuestoMes {
  /** Cuánto del mes ha transcurrido, de 0 a 1. Un mes cerrado vale 1. */
  avance: number
  /** Lo mismo para el año, que es contra lo que se mide un tope anual. */
  avanceAnual: number
  mensuales: Budget[]
  /** Los topes anuales del año de ese mes. Viajan con todos sus meses. */
  anuales: Budget[]
  total: TopeTotal | null
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
  /** Dónde vive el dinero de la meta. `null` = la meta es solo un apunte (H1). */
  accountId: number | null
  accountName: string | null
  accountBalanceCents: number | null
  /**
   * Cuánto de lo apartado movió dinero de verdad. Menor que `savedCents`
   * significa que el resto son apuntes sin respaldo, y la vista lo dice.
   */
  respaldadoCents: number
  /** Cuánto hay que apartar al mes para llegar. `null` sin fecha límite. */
  porMesCents: number | null
  entries: GoalEntry[]
}

export type BienKind = 'inmueble' | 'vehiculo' | 'equipo' | 'otro'

export interface ValuacionBien {
  id: number
  assetId: number
  date: string
  valueCents: number
  note: string
}

/**
 * Un bien: la casa, el auto, la herramienta (H3). Tabla propia y no una
 * inversión (D20): un bien no tiene aportes ni rendimiento, tiene costo, valor
 * y depreciación — y esa la **declara el usuario**, nunca la supone Finply.
 */
export interface Bien {
  id: number
  profileId: number
  name: string
  kind: BienKind
  costCents: number
  acquiredDate: string
  /** La deuda que lo financia, si la hay. */
  debtId: number | null
  debtConcept: string | null
  debtBalanceCents: number
  note: string
  archived: boolean
  /** Lo que declaró el usuario, o el costo si nunca lo ha valuado. */
  valueCents: number
  /** Lo que ha perdido de valor. Negativo si subió. */
  depreciacionCents: number
  /** Lo que ya es tuyo: valor menos lo que debes del crédito. Puede ser negativo. */
  equityCents: number
  valuaciones: number
  entries: ValuacionBien[]
}

export interface SerieCuenta {
  accountId: number
  name: string
  puntos: { month: string; balanceCents: number }[]
}

export interface Note {
  id: number
  profileId: number
  title: string
  body: string
  pinned: boolean
  /**
   * A qué se refiere la nota (Fase 20). Excluyentes y las dos opcionales: una
   * nota explica un movimiento, o un mes, o nada — la libreta sigue siendo la
   * libreta.
   */
  txId: number | null
  /** El mes al que pertenece, 'AAAA-MM'. */
  period: string | null
  /** Cómo se llama ese movimiento, para poder escribirlo sin otra consulta. */
  tx: { id: number; date: string; note: string; amountCents: number; type: TxType } | null
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
  /**
   * La regla que propuso esa categoría, si la propuso una (Fase 23). El archivo
   * manda: una regla solo habla cuando la fila no trae categoría. Viaja hasta
   * la vista previa para que se vea **quién** propuso qué antes de escribir
   * nada (R4).
   */
  reglaPattern?: string
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
    /** Cuántas filas recibieron categoría de una regla (Fase 23). */
    propuestasPorRegla: number
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

// ── Perfil de negocio ─────────────────────────────────────────────────────
//
// El libro sigue siendo de **flujo de efectivo**: una factura es el documento
// y el compromiso —de ahí salen la antigüedad de saldos y el flujo
// proyectado—, pero el ingreso nace cuando se cobra, con su movimiento
// ligado. Sin esa regla, emitir y cobrar contarían dos veces el mismo peso.

export type RolContraparte = 'cliente' | 'proveedor' | 'ambos'

export interface Contraparte {
  id: number
  profileId: number
  name: string
  role: RolContraparte
  /** Identificador fiscal, si el usuario lo usa. RFC, CUIT, VAT… o vacío. */
  taxId: string
  note: string
  /** Correo, teléfono o a quién buscar. Campo libre: no se valida ni se usa. */
  contact: string
  /**
   * Días entre emitir y vencer, propuestos al facturarle. `null` es "no lo
   * uso": la fecha se sigue tecleando a mano, como antes de la Fase 14.
   */
  creditDays: number | null
  /** Cuánto le fías. `null` sin límite. Avisa, nunca impide. */
  creditLimitCents: number | null
  archived: boolean
  /** Movimientos y facturas que la usan; sirve para avisar antes de borrarla. */
  txCount: number
  invoiceCount: number
  /** Lo que falta por cobrarle y por pagarle, de sus facturas abiertas. */
  porCobrarCents: number
  porPagarCents: number
  /** Lo cobrado sin factura que todavía se le puede aplicar a una. */
  anticiposCents: number
  /** Derivado: `porCobrar` pasó del límite. `false` si no hay límite. */
  sobreLimite: boolean
}

export interface CentroCosto {
  id: number
  profileId: number
  name: string
  archived: boolean
  txCount: number
}

export type DireccionFactura = 'emitida' | 'recibida'

/**
 * Una nota de crédito: el documento con el que se cancela parte de una factura
 * ya emitida. **No es dinero** —no se movió un peso— y por eso no tiene
 * movimiento ligado ni aparece en ningún reporte de flujo. Lo único que hace
 * es bajar lo que queda por cobrar.
 */
export interface NotaCredito {
  id: number
  invoiceId: number
  date: string
  folio: string
  concept: string
  amountCents: number
}

export interface Factura {
  id: number
  profileId: number
  counterpartyId: number
  counterpartyName: string
  direction: DireccionFactura
  folio: string
  concept: string
  issueDate: string
  dueDate: string | null
  subtotalCents: number
  taxCents: number
  /** Impuesto retenido por quien te paga. Monto, no tasa (R15). */
  withheldTaxCents: number
  /** Retención sobre la renta o el ingreso, con el mismo criterio. */
  withheldIncomeCents: number
  /** Los dos anteriores. Nunca se cobra: lo entera el otro. */
  retenidoCents: number
  /** Subtotal más impuesto: el total del documento. Se calcula, no se guarda. */
  totalCents: number
  /** Lo que se le canceló con notas de crédito. */
  notasCreditoCents: number
  /**
   * Lo que de verdad se puede cobrar: total − retenido − notas de crédito.
   * **Es contra esto que se mide el saldo**, y no contra el total: prometer el
   * total es prometer un dinero que nunca va a llegar.
   */
  cobrableCents: number
  /** Suma de los movimientos ligados. */
  pagadoCents: number
  /** Cobrable menos pagado, con piso en cero. */
  saldoCents: number
  status: 'abierta' | 'cancelada'
  /** Derivado del saldo, no guardado: no puede quedarse viejo. */
  cobrada: boolean
  costCenterId: number | null
  costCenterName: string | null
  notasCredito: NotaCredito[]
  createdAt: string
}

/** Lo que puede pasarle a una cotización. 'vencida' no está: se deriva. */
export type EstadoCotizacion = 'enviada' | 'aceptada' | 'perdida'

/**
 * Una cotización (`emitida`) o una orden de compra (`recibida`): el documento
 * que va **antes** de la factura. Una promesa de precio, no un cobro — no
 * asienta nada, igual que la factura no asienta hasta que se cobra (D14).
 */
export interface Cotizacion {
  id: number
  profileId: number
  counterpartyId: number
  counterpartyName: string
  direction: DireccionFactura
  folio: string
  concept: string
  issueDate: string
  /** Hasta cuándo vale lo que prometiste. Nulo si no se puso vigencia. */
  validUntil: string | null
  subtotalCents: number
  taxCents: number
  totalCents: number
  costCenterId: number | null
  costCenterName: string | null
  status: EstadoCotizacion
  /**
   * Enviada y con la vigencia atrás. **Derivado, no guardado**: un estado
   * guardado necesitaría que algo lo cambiara de noche y se quedaría viejo.
   */
  vencida: boolean
  /** La factura que salió de ella, si ya se convirtió. */
  invoiceId: number | null
  invoiceFolio: string | null
  createdAt: string
}

/**
 * Todo de una contraparte en una hoja. Nada de esto se guarda: son las mismas
 * cifras que ya viven en Facturas, Movimientos, la antigüedad de saldos y
 * Resultados, juntadas por fin **por contraparte**, que es la pregunta que un
 * negocio se hace antes de dar más crédito.
 */
export interface TableroContraparte {
  counterpartyId: number
  name: string
  role: RolContraparte
  creditDays: number | null
  creditLimitCents: number | null
  /** Lo cobrable de sus facturas abiertas: el total menos retenciones y notas. */
  facturadoCents: number
  /** Lo que de eso falta. */
  saldoCents: number
  /** Lo que falta y además ya se pasó de su fecha. */
  vencidoCents: number
  facturas: number
  facturasVencidas: number
  primeraFactura: string | null
  ultimaFactura: string | null
  /** Lo que de verdad entró de esta contraparte, con la regla de D6. */
  cobradoCents: number
  /** Y lo que salió hacia ella. */
  pagadoCents: number
  /** Lo cotizado que sigue esperando respuesta (Fase 19). */
  esperandoCents: number
  cotizacionesEsperando: number
  /**
   * Cuántos días tarda en pagar, en promedio, sobre sus facturas **saldadas** y
   * contando hasta el **último** cobro. `null` si nunca ha saldado una: no se
   * puede afirmar nada.
   */
  diasDePagoPromedio: number | null
  /** Cuántas de sus cotizaciones contestadas se ganaron, en bp. */
  tasaExitoBp: number | null
  sobreLimite: boolean
}

/** Lo que hay en la calle esperando respuesta, de un lado o del otro. */
export interface ResumenCotizaciones {
  direction: DireccionFactura
  esperandoCents: number
  esperando: number
  vencidoCents: number
  vencidas: number
  aceptadoCents: number
  aceptadas: number
  perdidoCents: number
  perdidas: number
  /**
   * Cuántas de las **contestadas** se ganaron, en puntos base. `null` cuando
   * nadie ha contestado: un 0 % ahí diría que pierdes todo, y lo cierto es que
   * no se sabe (R9). Lo que sigue esperando no entra en el denominador — si
   * entrara, mandar una cotización nueva bajaría tu tasa de éxito.
   */
  tasaExitoBp: number | null
}

/**
 * Un anticipo: dinero que ya entró y todavía no tiene factura. En un libro de
 * flujo de efectivo **ya es ingreso del día que se cobró** (D14) — lo que
 * falta es poder decir después a qué factura correspondía, sin volver a
 * registrar el mismo peso.
 */
export interface Anticipo {
  txId: number
  date: string
  amountCents: number
  note: string
  accountName: string
}

/** Un renglón de la lista de cobranza: qué toca cobrar y desde cuándo. */
export interface RenglonCobranza {
  facturaId: number
  counterpartyId: number
  counterpartyName: string
  contact: string
  folio: string
  concept: string
  issueDate: string
  dueDate: string | null
  saldoCents: number
  /** Días vencida. Cero o negativo mientras no llegue su fecha. */
  diasVencida: number
  tramo: string
  tramoLabel: string
}

export interface Cobranza {
  hoy: string
  /** De lo más vencido a lo más nuevo: se cobra empezando por lo de antes. */
  renglones: RenglonCobranza[]
  totalCents: number
  vencidoCents: number
  /** Lo que vence dentro de los próximos siete días. */
  porVencerCents: number
}

export interface TramoAging {
  tramo: string
  label: string
  montoCents: number
  facturas: number
}

export interface Aging {
  hoy: string
  porCobrar: TramoAging[]
  porPagar: TramoAging[]
  porCobrarCents: number
  porPagarCents: number
  /** Las contrapartes con más saldo vencido, de mayor a menor. */
  vencidoPorContraparte: { id: number; name: string; montoCents: number; direction: DireccionFactura }[]
}

/**
 * La plantilla de una factura que se repite: la renta del local, la iguala del
 * mes, la suscripción que le cobras a un cliente.
 *
 * Vive aparte de `Recurrencia` (D28) porque no asienta dinero: emite un
 * documento. No tiene cuenta ni tipo, y su periodo se resuelve emitiendo la
 * factura, no registrando el movimiento — el ingreso sigue naciendo al
 * cobrarla, como manda D14.
 */
export interface FacturaRecurrente {
  id: number
  profileId: number
  counterpartyId: number
  counterpartyName: string
  direction: DireccionFactura
  concept: string
  subtotalCents: number
  taxCents: number
  withheldTaxCents: number
  withheldIncomeCents: number
  totalCents: number
  costCenterId: number | null
  costCenterName: string | null
  /** Días entre emisión y vencimiento de cada factura que salga de aquí. */
  creditDays: number | null
  frequency: 'mensual' | 'quincenal' | 'semanal' | 'anual'
  dayOfMonth: number | null
  dayOfMonth2: number | null
  monthOfYear: number | null
  weekday: number | null
  startDate: string
  endDate: string | null
  archived: boolean
  /** En palabras: "cada mes el día 1". */
  descripcion: string
  /** Periodos vencidos sin emitir ni descartar. */
  pendientes: number
  proximaFecha: string | null
}

/** Un periodo vencido de una plantilla, todavía sin emitir. Derivado (D7). */
export interface PropuestaFactura {
  recurrenceId: number
  periodo: string
  fecha: string
  counterpartyId: number
  counterpartyName: string
  direction: DireccionFactura
  concept: string
  subtotalCents: number
  taxCents: number
  totalCents: number
  /** La fecha de vencimiento que tendría, si la plantilla trae días. */
  dueDate: string | null
  descripcion: string
  atraso: number
}

export interface BandejaFacturas {
  items: PropuestaFactura[]
  total: number
  truncado: boolean
}

// ── Módulos de giro (Fase 15) ──────────────────────────────────────────────
//
// Los tres son opt-in y ninguno cambia una cifra ya calculada (R18). Lo que
// registran dinero lo registran como movimientos normales, con las mismas
// reglas de D6 que todo lo demás.

/**
 * El arrendamiento de un bien que ya existe. El inmueble **no vive aquí**: es
 * un `Bien` de la Fase 11, y esto es el contrato que lo renta. Duplicarlo
 * habría metido la misma casa dos veces en el patrimonio.
 */
export interface Arrendamiento {
  id: number
  profileId: number
  assetId: number
  assetName: string
  /** Lo que vale hoy el bien, según su última valuación. */
  assetValueCents: number
  assetCostCents: number
  tenant: string
  rentCents: number
  depositCents: number
  /** Día del mes en que toca cobrar. 31 cae el último. */
  paymentDay: number
  startDate: string
  endDate: string | null
  note: string
  archived: boolean
  /** Renta cobrada en la ventana mirada, ya sin el depósito. */
  cobradoCents: number
  /** Mantenimiento y demás gasto atribuido a este arrendamiento. */
  gastoCents: number
  /** El depósito que de verdad tienes en la mano: recibido menos devuelto. */
  depositoEnManoCents: number
  /**
   * Cuántos meses del contrato caen dentro de la ventana de las dos cifras de
   * arriba. Es doce en un contrato que lleva un año o más; menos en uno recién
   * firmado o ya terminado, y es el divisor con el que se anualiza.
   */
  meses: number
  rendimiento: RendimientoInmueble
  /** La próxima fecha de cobro, dentro del contrato. `null` si ya terminó. */
  proximoCobro: string | null
}

/** Un renglón de trabajo: minutos a una tarifa, de un cliente. */
export interface Hora {
  id: number
  profileId: number
  date: string
  minutes: number
  /** La tarifa por hora **de ese renglón**: subirla no reescribe el pasado. */
  rateCents: number
  /** Minutos × tarifa, redondeado una sola vez. */
  importeCents: number
  counterpartyId: number | null
  counterpartyName: string | null
  costCenterId: number | null
  costCenterName: string | null
  note: string
  /** Si viene, esas horas ya se facturaron. Derivado: borrar la factura las libera. */
  invoiceId: number | null
  invoiceFolio: string | null
}

/** Lo trabajado y no cobrado de un cliente: lo que se puede facturar de un jalón. */
export interface HorasPorCobrar {
  counterpartyId: number | null
  counterpartyName: string
  minutos: number
  importeCents: number
  entradas: number
  desde: string
  hasta: string
}

/**
 * El panel de Horas. Lleva **dos ventanas distintas y las dos dicen cuál es**:
 * lo del periodo mirado y lo que falta por cobrar de todo el historial.
 *
 * Los nombres son largos a propósito. Antes había un `importeSinFacturarCents`
 * que medía el periodo junto a un `porCobrar` que medía siempre, y en el libro
 * demo la misma respuesta decía `0` mientras su propia lista sumaba $10,825:
 * dos verdades bajo un nombre que no distinguía cuál era cuál.
 */
export interface ResumenHoras {
  desde: string
  hasta: string
  minutosTotal: number
  importeTotalCents: number
  /** Sin facturar **de la ventana**, no de siempre. */
  minutosSinFacturarDelPeriodo: number
  importeSinFacturarDelPeriodoCents: number
  /** Tarifa media efectiva del periodo, en centavos por hora. `null` sin horas. */
  tarifaMediaCents: number | null
  /**
   * Lo que falta por cobrar de **todo el historial**, por cliente: una hora de
   * hace medio año sin facturar sigue sin cobrarse.
   */
  porCobrar: HorasPorCobrar[]
  /**
   * El total de esa lista. Es la **suma de sus renglones ya redondeados**, no
   * un agregado aparte: redondear por cliente y redondear el total por su
   * cuenta puede separarse unos centavos, y la vista enseña las dos cosas
   * juntas.
   */
  porCobrarMinutos: number
  porCobrarCents: number
}

export interface Producto {
  id: number
  profileId: number
  sku: string
  name: string
  unit: string
  /** Debajo de esto Finply avisa. `null` = sin aviso. */
  minQtyMilli: number | null
  archived: boolean
  /** Todo lo de abajo se **deriva** recorriendo los movimientos, nunca se guarda. */
  cantidadMilli: number
  costoUnitarioCents: number
  valorCents: number
  /** Costo de lo que salió en la ventana mirada. */
  costoVendidoCents: number
  ajusteCents: number
  movimientos: number
  ultimoMovimiento: string | null
  bajoMinimo: boolean
}

export interface MovimientoStock {
  id: number
  productId: number
  date: string
  kind: 'entrada' | 'salida' | 'ajuste'
  qtyMilli: number
  unitCostCents: number
  note: string
  txId: number | null
}

export interface Almacen {
  desde: string
  hasta: string
  /** Lo que vale todo lo que tienes hoy, a costo promedio. */
  valorCents: number
  /** Lo que costó lo que salió en la ventana. **No** entra al estado de resultados. */
  costoVendidoCents: number
  ajusteCents: number
  productos: Producto[]
  bajoMinimo: number
}

export interface RenglonResultados {
  categoryId: number | null
  name: string
  montoCents: number
}

/**
 * Cuánto deja cada cliente y cada centro. El costo que aparece aquí es
 * **solo el que el usuario atribuyó**: un gasto sin contraparte no se reparte
 * a ojo entre los clientes, por la misma razón que un gasto sin papel no se
 * supone fijo. Por eso la vista dice cuánto quedó sin atribuir.
 */
export interface RenglonRentabilidad {
  id: number | null
  name: string
  ingresosCents: number
  gastoCents: number
  /** Ingresos menos gasto atribuido. */
  margenCents: number
  /** Margen entre ingresos. `null` sin ingresos: no se puede decir. */
  margenPct: number | null
}

/** El mismo periodo, corrido hacia atrás su propia longitud. */
export interface PeriodoPrevio {
  desde: string
  hasta: string
  ingresosCents: number
  gastoTotalCents: number
  utilidadCents: number
}

export interface EstadoResultados {
  desde: string
  hasta: string
  ingresosCents: number
  costoVentaCents: number
  margenBrutoCents: number
  /** Margen bruto entre ingresos. `null` sin ingresos. */
  margenBrutoPct: number | null
  gastoFijoCents: number
  gastoVariableCents: number
  /** Gasto de categorías que nadie ha clasificado todavía. */
  sinClasificarCents: number
  utilidadCents: number
  /** Impuesto que cobraste en tus ingresos y el que pagaste en tus gastos. */
  impuestoTrasladadoCents: number
  impuestoAcreditableCents: number
  deducibleCents: number
  detalle: { costoVenta: RenglonResultados[]; fijo: RenglonResultados[]; variable: RenglonResultados[]; sinClasificar: RenglonResultados[] }
  porCentro: RenglonRentabilidad[]
  /** Qué deja cada cliente, de mayor margen a menor. */
  porCliente: RenglonRentabilidad[]
  /** Gasto que nadie atribuyó a una contraparte: el que no se reparte a ojo. */
  gastoSinContraparteCents: number
  /** El mismo periodo anterior, para poder restar. */
  previo: PeriodoPrevio
  /** Cuánto hay que vender para no perder ni ganar. `null` si no se puede decir. */
  puntoEquilibrioCents: number | null
  margenContribucion: number | null
}

/**
 * La respuesta a "¿llego a fin de mes?", con la cuenta hecha a la vista.
 *
 * `saldoInicialCents + entradasCents − salidasCents = saldoFinalCents`, y los
 * `eventos` son exactamente esos sumandos: la proyección se puede auditar
 * renglón por renglón, que es lo único que la vuelve creíble.
 */
export interface FlujoProyectado {
  desde: string
  hasta: string
  /**
   * Saldo líquido **de este momento**: efectivo, banco y ahorro. La tarjeta no
   * es caja, y lo que ya asentaste con fecha futura tampoco: eso entra como
   * evento el día que le toca. Lo que vence hoy y todavía no has asentado
   * tampoco está aquí — cae en el primer punto de la serie.
   */
  saldoInicialCents: number
  saldoFinalCents: number
  entradasCents: number
  salidasCents: number
  /** El día en que el saldo proyectado se vuelve negativo, si ocurre. */
  primerDiaEnRojo: string | null
  /** El punto más bajo de la ventana. Es el que dice si el mes se aprieta. */
  minimo: { fecha: string; saldoCents: number }
  /** Vencimientos sin monto todavía. No entran en la cuenta; se dicen (R9). */
  sinMonto: number
  /**
   * Un punto **por día**, incluidos los días en que no pasa nada. Cada uno es
   * el cierre de su día, así que el primero ya trae lo que vence hoy.
   */
  puntos: { fecha: string; saldoCents: number; entradasCents: number; salidasCents: number }[]
  eventos: EventoCalendario[]
}

// ── El respaldo ───────────────────────────────────────────────────────────

/**
 * Un renglón del respaldo que la base acepta y el calendario —o la aritmética
 * del dinero— no. No es un error del archivo ni de Finply: es algo que hay que
 * saber para poder ir a corregirlo.
 *
 * `motivo` no es solo una etiqueta: **dice qué se hizo con el valor**.
 *
 *   · `'fecha'` — se restauró **tal cual**. Un `2026-02-30` es ilegible para el
 *     calendario y perfectamente legible para todo lo demás: el libro abre, el
 *     saldo cuadra y solo los reportes del año se pierden ese renglón. Cuál era
 *     la fecha de verdad solo lo sabe el usuario, así que Finply no la adivina.
 *   · `'monto'` — **no se pudo restaurar y quedó en un centavo.** Una cifra por
 *     encima del entero seguro no es un número raro: es un número que
 *     `node:sqlite` se niega a devolver, así que la fila entra y ninguna
 *     pantalla vuelve a leerla — ni el propio respaldo siguiente. Meterla tal
 *     cual sería restaurar un libro que no se puede abrir. Se guarda todo lo
 *     demás de la fila —su fecha, su concepto, su cuenta, sus ligas— con el
 *     monto en un centavo, y `valor` trae lo que decía para poder volver a
 *     escribirlo. Un centavo y no cero porque el esquema exige `> 0` en casi
 *     toda columna de dinero, y restaurar obedece las mismas reglas.
 */
export interface HallazgoRespaldo {
  tabla: string
  columna: string
  /** El valor tal cual venía, recortado para que quepa en un aviso. */
  valor: string
  /**
   * `cifra` es la hermana de `monto`: una magnitud entera que no es dinero
   * —una cantidad de existencias, el orden de una lista— y que rompe el libro
   * exactamente igual. Se separan porque lo que se le dice al usuario no es lo
   * mismo: "un centavo" no significa nada al lado de un kilo.
   */
  motivo: 'fecha' | 'monto' | 'cifra'
}

/**
 * Lo que traía dentro un respaldo restaurado.
 *
 * Restaurar comprueba llaves foráneas y las reglas de la base, no el
 * calendario ni el techo del dinero: un archivo hecho antes de que existieran
 * esas dos reglas puede traer un `2026-02-30` o una cifra que ninguna pantalla
 * podrá volver a leer.
 *
 * La regla que gobierna esto: **negarse a restaurar el respaldo de alguien es
 * peor que restaurarlo con un renglón torcido** — ese archivo puede ser lo
 * único que le queda. Así que se restaura, entero, y lo único que no entra es
 * lo que dejaría el libro sin poder abrirse. Todo lo que se tocó se dice.
 */
export interface RevisionRespaldo {
  /** Fechas que no existen en el calendario. Se restauraron tal cual. */
  fechas: number
  /** Cifras que el libro no puede releer. Se restauraron en un centavo. */
  montos: number
  /** Magnitudes que no son dinero y tampoco se pueden releer. En 1. */
  cifras: number
  /** Los primeros, para poder ir a buscarlos. La cuenta completa va arriba. */
  ejemplos: HallazgoRespaldo[]
}
