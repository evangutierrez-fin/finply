import type {
  Account, Alerta, Amortizacion, Analisis, Bandeja, Budget, Calendario, Category, Comparativa,
  Aging, CentroCosto, CompraMSI, Contraparte, Debt, DebtPayment, EstadoResultados, EstadoTarjeta,
  Factura, FlujoProyectado, Frecuencia, Goal, InformeImport, InformePrecios, Investment,
  InvestmentEntryType, LoteImport, MapeoImport, ModuloId, Note, Profile, Recurrencia, ReporteAnual,
  ResultadoImport, RolCategoria, Simulacion, Summary, Tag, Tx, TxAttachment, TxType,
  Bien, BienKind, CorteConciliacion, SerieCuenta, PresupuestoMes, TopeTotal,
  Anticipo, BandejaFacturas, Cobranza, FacturaRecurrente,
  Almacen, Arrendamiento, Hora, MovimientoStock, Producto, ResumenHoras,
  Cotizacion, ResumenCotizaciones, TableroContraparte,
} from '../shared/types.ts'

/** Error de la API que conserva el código y el cuerpo, para poder reaccionar. */
export class ApiError extends Error {
  status: number
  body: any
  constructor(message: string, status: number, body: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

async function raw(url: string, options?: RequestInit): Promise<Response> {
  const res = await fetch(url, {
    headers: options?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
  })
  if (!res.ok) {
    let message = `Error ${res.status}`
    let body: unknown = null
    try {
      body = await res.json()
      if ((body as any)?.error) message = (body as any).error
    } catch {
      // sin cuerpo JSON: se queda el mensaje genérico
    }
    throw new ApiError(message, res.status, body)
  }
  return res
}

async function req<T>(url: string, options?: RequestInit): Promise<T> {
  return (await raw(url, options)).json() as Promise<T>
}

export interface TxPage {
  items: Tx[]
  /** Movimientos que cumplen el filtro, más allá de la página. */
  total: number
  /** Sumas de todo el filtro, no de la página. */
  gastoCents: number
  ingresoCents: number
}

export interface TxFilters {
  profileId: number
  month?: string
  from?: string
  to?: string
  accountId?: number
  type?: string
  tagId?: number
  minCents?: number
  maxCents?: number
  q?: string
  /** Conciliación: 'si' solo lo palomeado, 'no' solo lo pendiente. */
  conciliado?: 'si' | 'no'
  limit?: number
  offset?: number
}

function txSearch(params: TxFilters): URLSearchParams {
  const search = new URLSearchParams()
  search.set('profileId', String(params.profileId))
  if (params.month) search.set('month', params.month)
  if (params.from) search.set('from', params.from)
  if (params.to) search.set('to', params.to)
  if (params.accountId) search.set('accountId', String(params.accountId))
  if (params.type) search.set('type', params.type)
  if (params.tagId) search.set('tagId', String(params.tagId))
  if (params.minCents !== undefined) search.set('minCents', String(params.minCents))
  if (params.maxCents !== undefined) search.set('maxCents', String(params.maxCents))
  if (params.q) search.set('q', params.q)
  if (params.conciliado) search.set('conciliado', params.conciliado)
  if (params.limit !== undefined) search.set('limit', String(params.limit))
  if (params.offset) search.set('offset', String(params.offset))
  return search
}

export interface TxDraft {
  profileId: number
  accountId: number
  type: TxType
  amountCents: number
  date: string
  categoryId?: number | null
  note?: string
  transferAccountId?: number | null
  /** Ausente deja las etiquetas como estaban; arreglo vacío las quita. */
  tagIds?: number[]
  /** Perfil de negocio. Todo opcional: un movimiento personal no los manda. */
  counterpartyId?: number | null
  costCenterId?: number | null
  invoiceId?: number | null
  /** Impuesto contenido en el monto, no sumado a él. */
  taxCents?: number
  deductible?: boolean
  /**
   * El reparto por categoría (D17). **Ausente ≠ vacío**, igual que `tagIds`:
   * ausente deja el reparto como estaba, vacío lo quita. Los renglones tienen
   * que sumar exactamente `amountCents` o el servidor rechaza.
   */
  splits?: { categoryId?: number | null; amountCents: number; note?: string }[]
  /** El gasto que este movimiento devuelve. `null` explícito lo desliga. */
  refundOfId?: number | null
  /**
   * Módulo Inmuebles. Van los dos o ninguno: el papel es lo que hace que un
   * depósito no cuente como ingreso, y vive en el movimiento —no en el
   * módulo—, así que apagar Inmuebles no lo convierte en ingreso (R18).
   */
  rentalId?: number | null
  rentalRole?: 'renta' | 'deposito' | 'devolucion_deposito' | 'mantenimiento' | null
}

export interface ImportDraft {
  profileId: number
  csv: string
  filename?: string
  cuentaPorOmision: number
  mapeo?: MapeoImport
  separador?: string
  crearCategorias?: boolean
  crearEtiquetas?: boolean
  omitirDuplicadas?: boolean
}

export interface DebtDraft {
  profileId: number
  direction: 'por_cobrar' | 'por_pagar'
  counterparty: string
  concept?: string
  principalCents: number
  startDate: string
  dueDate?: string | null
  /** Puntos base: 24.5 % anual = 2450. */
  annualRateBp?: number
  /** `null` quita el plazo; ausente lo deja como estaba. */
  termMonths?: number | null
  /**
   * Solo al crear: cuenta por la que entra o sale el dinero. Con ella se
   * asienta el movimiento del desembolso; sin ella el libro no se mueve.
   */
  accountId?: number | null
  /** Enganche puesto de contado al contratar. No es principal. */
  downPaymentCents?: number
  /** Solo al crear: cuenta de la que sale (o a la que entra) el enganche. */
  downPaymentAccountId?: number | null
}

/** Lo que la Fase 11 le agregó a una cuenta. `null` en el mínimo quita el aviso. */
export interface CuentaExtra {
  minBalanceCents?: number | null
  institution?: string
  sortOrder?: number
}

/** Datos de crédito de una cuenta. `null` los borra; ausente no opina. */
export interface CreditoDraft {
  creditLimitCents?: number | null
  cutDay?: number | null
  dueDay?: number | null
}

export interface MsiDraft {
  profileId: number
  accountId: number
  concept: string
  totalCents: number
  months: number
  purchaseDate: string
  categoryId?: number | null
}

export interface RecurrenciaDraft {
  profileId: number
  accountId: number
  type: TxType
  amountCents: number
  categoryId?: number | null
  transferAccountId?: number | null
  note?: string
  frequency: Frecuencia
  dayOfMonth?: number | null
  dayOfMonth2?: number | null
  monthOfYear?: number | null
  weekday?: number | null
  startDate: string
  endDate?: string | null
  tagIds?: number[]
  archived?: boolean
}

/** Cambios de **esta** partida al asentarla. No tocan la plantilla. */
export interface AsentarDraft {
  periodo: string
  date?: string
  amountCents?: number
  categoryId?: number | null
  transferAccountId?: number | null
  accountId?: number
  note?: string
  tagIds?: number[]
}

/** El contrato que renta un bien. El inmueble vive en Bienes, no aquí. */
export interface ArrendamientoDraft {
  profileId: number
  assetId: number
  tenant: string
  rentCents: number
  depositCents: number
  paymentDay: number
  startDate: string
  endDate?: string | null
  note?: string
  archived?: boolean
}

export interface HoraDraft {
  profileId: number
  date: string
  minutes: number
  /** La tarifa **de este renglón**. Admite cero: primero el tiempo, luego el precio. */
  rateCents: number
  counterpartyId?: number | null
  costCenterId?: number | null
  note?: string
}

export interface FiltroHoras {
  profileId: number
  desde?: string
  hasta?: string
  counterpartyId?: number
  sinFacturar?: boolean
}

export interface ProductoDraft {
  profileId: number
  sku?: string
  name: string
  unit?: string
  /** Debajo de esto Finply avisa. `null` quita el aviso. */
  minQtyMilli?: number | null
  archived?: boolean
}

export interface MovimientoStockDraft {
  profileId: number
  productId: number
  date: string
  kind: 'entrada' | 'salida' | 'ajuste'
  /** Milésimas de unidad. En un ajuste puede ser negativa: es un delta. */
  qtyMilli: number
  unitCostCents?: number
  note?: string
  /** El movimiento del libro que pagó esta entrada. Ligarlo no lo crea (R4). */
  txId?: number | null
}

/**
 * Tinta propia del perfil. Van las dos o ninguna: `null` en ambas vuelve al
 * preset. El servidor rechaza la que no alcance AA en su tema.
 */
export interface TintaDraft {
  accentHex?: string | null
  accentHexDark?: string | null
}

export const api = {
  profiles: {
    list: () => req<Profile[]>('/api/profiles'),
    create: (
      data: {
        name: string
        kind: string
        accent: string
        dimensionLabel?: string
        modules?: ModuloId[]
      } & TintaDraft,
    ) => req<Profile>('/api/profiles', { method: 'POST', body: JSON.stringify(data) }),
    update: (
      id: number,
      data: Partial<{
        name: string
        kind: string
        accent: string
        dimensionLabel: string
        modules: ModuloId[]
      }> &
        TintaDraft,
    ) => req<Profile>(`/api/profiles/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    remove: (id: number) => req<{ ok: true }>(`/api/profiles/${id}`, { method: 'DELETE' }),
  },
  accounts: {
    list: (profileId: number) => req<Account[]>(`/api/accounts?profileId=${profileId}`),
    create: (
      data: { profileId: number; name: string; type: string; openingCents: number } & CreditoDraft &
        CuentaExtra,
    ) => req<Account>('/api/accounts', { method: 'POST', body: JSON.stringify(data) }),
    update: (
      id: number,
      data: Partial<{ name: string; type: string; openingCents: number; archived: boolean }> &
        CreditoDraft &
        CuentaExtra,
    ) => req<Account>(`/api/accounts/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    remove: (id: number) => req<{ ok: true }>(`/api/accounts/${id}`, { method: 'DELETE' }),
    /** El saldo de esta cuenta al cierre de cada mes. La serie global no lo dice. */
    serie: (id: number, meses = 12) => req<SerieCuenta>(`/api/accounts/${id}/serie?meses=${meses}`),
  },
  tarjetas: {
    /** Estado de cuenta de cada tarjeta: corte, pago y línea disponible. */
    estado: (profileId: number) => req<EstadoTarjeta[]>(`/api/tarjetas?profileId=${profileId}`),
    msi: {
      list: (profileId: number) => req<CompraMSI[]>(`/api/tarjetas/msi?profileId=${profileId}`),
      create: (data: MsiDraft) =>
        req<CompraMSI>('/api/tarjetas/msi', { method: 'POST', body: JSON.stringify(data) }),
      /** Borra también el cargo que la ancla en el libro. */
      remove: (id: number, profileId: number) =>
        req<{ ok: true }>(`/api/tarjetas/msi/${id}?profileId=${profileId}`, { method: 'DELETE' }),
    },
  },
  categories: {
    list: (profileId: number) => req<Category[]>(`/api/categories?profileId=${profileId}`),
    create: (data: { profileId: number; name: string; kind: 'ingreso' | 'gasto' }) =>
      req<Category>('/api/categories', { method: 'POST', body: JSON.stringify(data) }),
    rename: (id: number, name: string) =>
      req<Category>(`/api/categories/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
    /** El papel en el estado de resultados. `null` la deja sin clasificar. */
    setRole: (id: number, name: string, role: RolCategoria | null) =>
      req<Category>(`/api/categories/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name, role }),
      }),
    /** Sin `reassignTo` ni `force`, una categoría en uso responde 409 con txCount. */
    remove: (id: number, options: { reassignTo?: number; force?: boolean } = {}) => {
      const search = new URLSearchParams()
      if (options.reassignTo) search.set('reassignTo', String(options.reassignTo))
      if (options.force) search.set('force', 'true')
      const qs = search.toString()
      return req<{
        ok: true
        movimientosReasignados: number
        movimientosSinCategoria: number
        presupuestosBorrados: number
      }>(`/api/categories/${id}${qs ? `?${qs}` : ''}`, { method: 'DELETE' })
    },
  },
  tags: {
    list: (profileId: number) => req<Tag[]>(`/api/tags?profileId=${profileId}`),
    create: (data: { profileId: number; name: string }) =>
      req<Tag>('/api/tags', { method: 'POST', body: JSON.stringify(data) }),
    rename: (id: number, name: string) =>
      req<Tag>(`/api/tags/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
    remove: (id: number) => req<{ ok: true }>(`/api/tags/${id}`, { method: 'DELETE' }),
  },
  tx: {
    /**
     * Devuelve la página más los agregados de **todo** el filtro, que vienen
     * en cabeceras: el pie del libro no debe sumar solo la página visible.
     */
    list: async (params: TxFilters): Promise<TxPage> => {
      const res = await raw(`/api/transactions?${txSearch(params)}`)
      const items = (await res.json()) as Tx[]
      const num = (nombre: string, porOmision: number) => {
        const valor = Number(res.headers.get(nombre))
        return Number.isFinite(valor) ? valor : porOmision
      }
      return {
        items,
        total: num('X-Total-Count', items.length),
        gastoCents: num('X-Sum-Gasto-Cents', 0),
        ingresoCents: num('X-Sum-Ingreso-Cents', 0),
      }
    },
    exportUrl: (params: TxFilters) => `/api/transactions/export.csv?${txSearch(params)}`,
    create: (data: TxDraft) =>
      req<Tx>('/api/transactions', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: TxDraft) =>
      req<Tx>(`/api/transactions/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    remove: (id: number) => req<{ ok: true }>(`/api/transactions/${id}`, { method: 'DELETE' }),
    /** Copia una partida sin sus ligas: es un movimiento nuevo, no un segundo abono. */
    duplicar: (id: number, date?: string) =>
      req<Tx>(`/api/transactions/${id}/duplicar`, {
        method: 'POST',
        body: JSON.stringify(date ? { date } : {}),
      }),
    /** Palomear (o despalomear) contra el estado de cuenta. No mueve una cifra. */
    conciliar: (data: { profileId: number; txIds: number[]; reconciled: boolean }) =>
      req<{ ok: true; cambiados: number }>('/api/transactions/conciliar', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    adjuntar: (id: number, data: { filename: string; mime: string; dataB64: string }) =>
      req<TxAttachment>(`/api/transactions/${id}/adjuntos`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    adjuntoUrl: (txId: number, adjuntoId: number) =>
      `/api/transactions/${txId}/adjuntos/${adjuntoId}`,
    quitarAdjunto: (txId: number, adjuntoId: number) =>
      req<{ ok: true }>(`/api/transactions/${txId}/adjuntos/${adjuntoId}`, { method: 'DELETE' }),
  },
  bienes: {
    list: (profileId: number) => req<Bien[]>(`/api/bienes?profileId=${profileId}`),
    create: (data: {
      profileId: number
      name: string
      kind: BienKind
      costCents: number
      acquiredDate: string
      debtId?: number | null
      note?: string
    }) => req<Bien>('/api/bienes', { method: 'POST', body: JSON.stringify(data) }),
    update: (
      id: number,
      data: Partial<{
        name: string
        kind: BienKind
        costCents: number
        acquiredDate: string
        debtId: number | null
        note: string
        archived: boolean
      }>,
    ) => req<Bien>(`/api/bienes/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    remove: (id: number) => req<{ ok: true }>(`/api/bienes/${id}`, { method: 'DELETE' }),
    /** Cuánto vale hoy, declarado por el usuario. Repetir fecha corrige. */
    valuar: (id: number, data: { date: string; valueCents: number; note?: string }) =>
      req<Bien>(`/api/bienes/${id}/valuaciones`, { method: 'POST', body: JSON.stringify(data) }),
    quitarValuacion: (valuacionId: number) =>
      req<Bien>(`/api/bienes/valuaciones/${valuacionId}`, { method: 'DELETE' }),
  },
  conciliacion: {
    list: (profileId: number, accountId?: number) =>
      req<CorteConciliacion[]>(
        `/api/conciliacion?profileId=${profileId}${accountId ? `&accountId=${accountId}` : ''}`,
      ),
    declarar: (data: {
      profileId: number
      accountId: number
      date: string
      balanceCents: number
      note?: string
    }) => req<CorteConciliacion>('/api/conciliacion', { method: 'POST', body: JSON.stringify(data) }),
    /**
     * Asienta la diferencia del corte como movimiento: faltante del cajón como
     * gasto, sobrante como ingreso. El monto no se manda — es el que Finply ya
     * calculó, y aceptar otro convertiría el ajuste en una partida inventada.
     */
    ajustar: (id: number, profileId: number, datos: { categoryId?: number | null; concept?: string } = {}) =>
      req<{ txId: number; corte: CorteConciliacion }>(`/api/conciliacion/${id}/ajustar`, {
        method: 'POST',
        body: JSON.stringify({ profileId, ...datos }),
      }),
    remove: (id: number) => req<{ ok: true }>(`/api/conciliacion/${id}`, { method: 'DELETE' }),
  },
  debts: {
    list: (profileId: number) => req<Debt[]>(`/api/debts?profileId=${profileId}`),
    create: (data: DebtDraft) =>
      req<Debt>('/api/debts', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: Partial<DebtDraft & { status: string }>) =>
      req<Debt>(`/api/debts/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    remove: (id: number) => req<{ ok: true }>(`/api/debts/${id}`, { method: 'DELETE' }),
    /** El plan de pagos: capital contra interés mes por mes. Exige plazo. */
    amortizacion: (id: number) => req<Amortizacion>(`/api/debts/${id}/amortizacion`),
    addPayment: (
      debtId: number,
      data: {
        amountCents: number
        date: string
        note?: string
        accountId?: number | null
        /** Ausente, el servidor propone el interés devengado. */
        interestCents?: number
      },
    ) => req<Debt>(`/api/debts/${debtId}/payments`, { method: 'POST', body: JSON.stringify(data) }),
    removePayment: (payment: DebtPayment) =>
      req<Debt>(`/api/debts/payments/${payment.id}`, { method: 'DELETE' }),
  },
  investments: {
    list: (profileId: number) => req<Investment[]>(`/api/investments?profileId=${profileId}`),
    create: (data: { profileId: number; name: string; kind: string; note?: string }) =>
      req<Investment>('/api/investments', { method: 'POST', body: JSON.stringify(data) }),
    update: (
      id: number,
      data: Partial<{ name: string; kind: string; note: string; archived: boolean }>,
    ) => req<Investment>(`/api/investments/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    remove: (id: number) => req<{ ok: true }>(`/api/investments/${id}`, { method: 'DELETE' }),
    addEntry: (
      id: number,
      data: {
        type: InvestmentEntryType
        amountCents: number
        date: string
        note?: string
        accountId?: number | null
        unitsE8?: number | null
        unitPriceCents?: number | null
      },
    ) => req<Investment>(`/api/investments/${id}/entries`, { method: 'POST', body: JSON.stringify(data) }),
    removeEntry: (entryId: number) =>
      req<Investment>(`/api/investments/entries/${entryId}`, { method: 'DELETE' }),
  },
  contrapartes: {
    list: (profileId: number) => req<Contraparte[]>(`/api/contrapartes?profileId=${profileId}`),
    /** Todo de una contraparte en una hoja. Derivado: no guarda nada. */
    tablero: (id: number, profileId: number) =>
      req<TableroContraparte>(`/api/contrapartes/${id}/tablero?profileId=${profileId}`),
    create: (data: {
      profileId: number
      name: string
      role?: string
      taxId?: string
      note?: string
      contact?: string
      creditDays?: number | null
      creditLimitCents?: number | null
    }) => req<Contraparte>('/api/contrapartes', { method: 'POST', body: JSON.stringify(data) }),
    update: (
      id: number,
      data: Partial<{
        name: string
        role: string
        taxId: string
        note: string
        contact: string
        creditDays: number | null
        creditLimitCents: number | null
        archived: boolean
      }>,
    ) => req<Contraparte>(`/api/contrapartes/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    remove: (id: number) => req<{ ok: true }>(`/api/contrapartes/${id}`, { method: 'DELETE' }),
  },
  centros: {
    list: (profileId: number) => req<CentroCosto[]>(`/api/centros?profileId=${profileId}`),
    create: (data: { profileId: number; name: string }) =>
      req<CentroCosto>('/api/centros', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: Partial<{ name: string; archived: boolean }>) =>
      req<CentroCosto>(`/api/centros/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    remove: (id: number) => req<{ ok: true }>(`/api/centros/${id}`, { method: 'DELETE' }),
  },
  /** Cotizaciones y órdenes de compra: el documento que va antes de la factura. */
  cotizaciones: {
    list: (profileId: number, opciones: { direction?: string; status?: string } = {}) => {
      const q = new URLSearchParams({ profileId: String(profileId) })
      if (opciones.direction) q.set('direction', opciones.direction)
      if (opciones.status) q.set('status', opciones.status)
      return req<Cotizacion[]>(`/api/cotizaciones?${q}`)
    },
    resumen: (profileId: number) =>
      req<{ emitida: ResumenCotizaciones; recibida: ResumenCotizaciones }>(
        `/api/cotizaciones/resumen?profileId=${profileId}`,
      ),
    create: (data: {
      profileId: number
      counterpartyId: number
      direction: string
      folio?: string
      concept?: string
      issueDate: string
      validUntil?: string | null
      subtotalCents: number
      taxCents?: number
      costCenterId?: number | null
    }) => req<Cotizacion>('/api/cotizaciones', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: Record<string, unknown>) =>
      req<Cotizacion>(`/api/cotizaciones/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    /** Darla por perdida, o revivirla. 'aceptada' se llega facturando. */
    estado: (id: number, profileId: number, status: 'enviada' | 'perdida') =>
      req<Cotizacion>(`/api/cotizaciones/${id}/estado?profileId=${profileId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }),
    facturar: (
      id: number,
      profileId: number,
      data: { folio?: string; issueDate: string; dueDate?: string | null },
    ) =>
      req<{ cotizacion: Cotizacion; factura: Factura }>(
        `/api/cotizaciones/${id}/facturar?profileId=${profileId}`,
        { method: 'POST', body: JSON.stringify(data) },
      ),
    remove: (id: number, profileId: number) =>
      req<{ ok: true; facturaViva: boolean }>(
        `/api/cotizaciones/${id}?profileId=${profileId}`,
        { method: 'DELETE' },
      ),
  },
  facturas: {
    list: (profileId: number, opciones: { direction?: string; pendientes?: boolean } = {}) => {
      const q = new URLSearchParams({ profileId: String(profileId) })
      if (opciones.direction) q.set('direction', opciones.direction)
      if (opciones.pendientes) q.set('pendientes', 'true')
      return req<Factura[]>(`/api/facturas?${q}`)
    },
    aging: (profileId: number) => req<Aging>(`/api/facturas/aging?profileId=${profileId}`),
    cobranza: (profileId: number) => req<Cobranza>(`/api/facturas/cobranza?profileId=${profileId}`),
    create: (data: {
      profileId: number
      counterpartyId: number
      direction: string
      folio?: string
      concept?: string
      issueDate: string
      dueDate?: string | null
      subtotalCents: number
      taxCents?: number
      withheldTaxCents?: number
      withheldIncomeCents?: number
      costCenterId?: number | null
    }) => req<Factura>('/api/facturas', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: Record<string, unknown>) =>
      req<Factura>(`/api/facturas/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    remove: (id: number) => req<{ ok: true }>(`/api/facturas/${id}`, { method: 'DELETE' }),
    cobrar: (
      id: number,
      data: { accountId: number; amountCents: number; date: string; note?: string; categoryId?: number | null },
    ) => req<Factura>(`/api/facturas/${id}/cobros`, { method: 'POST', body: JSON.stringify(data) }),
    /** Cancelar parte de una factura. No mueve dinero: baja lo cobrable. */
    nota: (id: number, data: { date: string; folio?: string; concept?: string; amountCents: number }) =>
      req<Factura>(`/api/facturas/${id}/notas`, { method: 'POST', body: JSON.stringify(data) }),
    quitarNota: (id: number, notaId: number) =>
      req<Factura>(`/api/facturas/${id}/notas/${notaId}`, { method: 'DELETE' }),
    anticipos: (id: number) => req<Anticipo[]>(`/api/facturas/${id}/anticipos`),
    /** Liga un cobro que ya existía. No crea un movimiento nuevo. */
    aplicarAnticipo: (id: number, txId: number) =>
      req<Factura>(`/api/facturas/${id}/anticipos`, { method: 'POST', body: JSON.stringify({ txId }) }),
    recurrentes: {
      list: (profileId: number) =>
        req<FacturaRecurrente[]>(`/api/facturas/recurrentes?profileId=${profileId}`),
      pendientes: (profileId: number) =>
        req<BandejaFacturas>(`/api/facturas/recurrentes/pendientes?profileId=${profileId}`),
      create: (data: Record<string, unknown>) =>
        req<FacturaRecurrente>('/api/facturas/recurrentes', { method: 'POST', body: JSON.stringify(data) }),
      update: (id: number, data: Record<string, unknown>) =>
        req<FacturaRecurrente>(`/api/facturas/recurrentes/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
      remove: (profileId: number, id: number) =>
        req<{ ok: true; emitidas: number }>(
          `/api/facturas/recurrentes/${id}?profileId=${profileId}`,
          { method: 'DELETE' },
        ),
      emitir: (profileId: number, id: number, data: { periodo: string } & Record<string, unknown>) =>
        req<Factura>(`/api/facturas/recurrentes/${id}/emitir?profileId=${profileId}`, {
          method: 'POST',
          body: JSON.stringify(data),
        }),
      descartar: (profileId: number, id: number, periodo: string) =>
        req<{ ok: true }>(`/api/facturas/recurrentes/${id}/descartar?profileId=${profileId}`, {
          method: 'POST',
          body: JSON.stringify({ periodo }),
        }),
    },
  },
  negocio: {
    resultados: (profileId: number, desde: string, hasta: string) =>
      req<EstadoResultados>(`/api/negocio/resultados?profileId=${profileId}&desde=${desde}&hasta=${hasta}`),
  },
  // ── Módulos de giro (Fase 15). Los tres son opt-in y ninguno asienta dinero
  // por su cuenta: lo que mueve el libro se registra como movimiento normal.
  inmuebles: {
    list: (profileId: number) => req<Arrendamiento[]>(`/api/inmuebles?profileId=${profileId}`),
    create: (data: ArrendamientoDraft) =>
      req<Arrendamiento>('/api/inmuebles', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: ArrendamientoDraft) =>
      req<Arrendamiento>(`/api/inmuebles/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    /**
     * Los movimientos se quedan en el libro: ese dinero se movió. Pierden la
     * liga —y con ella su papel—, así que dice cuántos depósitos vuelven a
     * contar como ingreso.
     */
    remove: (profileId: number, id: number) =>
      req<{ ok: true; movimientos: number; depositos: number }>(
        `/api/inmuebles/${id}?profileId=${profileId}`,
        { method: 'DELETE' },
      ),
  },
  horas: {
    list: (filtro: FiltroHoras) => {
      const q = new URLSearchParams({ profileId: String(filtro.profileId) })
      if (filtro.desde) q.set('desde', filtro.desde)
      if (filtro.hasta) q.set('hasta', filtro.hasta)
      if (filtro.counterpartyId) q.set('counterpartyId', String(filtro.counterpartyId))
      if (filtro.sinFacturar) q.set('sinFacturar', 'true')
      return req<Hora[]>(`/api/horas?${q}`)
    },
    /** Los totales miran la ventana; lo por cobrar mira **todo** el historial. */
    resumen: (profileId: number, desde?: string, hasta?: string) => {
      const q = new URLSearchParams({ profileId: String(profileId) })
      if (desde) q.set('desde', desde)
      if (hasta) q.set('hasta', hasta)
      return req<ResumenHoras>(`/api/horas/resumen?${q}`)
    },
    create: (data: HoraDraft) =>
      req<Hora>('/api/horas', { method: 'POST', body: JSON.stringify(data) }),
    /** 409 si ya se facturaron: editarlas cambiaría el respaldo de la factura. */
    update: (id: number, data: HoraDraft) =>
      req<Hora>(`/api/horas/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    remove: (profileId: number, id: number) =>
      req<{ ok: true }>(`/api/horas/${id}?profileId=${profileId}`, { method: 'DELETE' }),
    /**
     * Todas las horas sin facturar de un cliente, en una factura. **No asienta
     * un peso**: el ingreso nace al cobrarla (D14).
     */
    facturar: (
      profileId: number,
      data: {
        counterpartyId: number
        issueDate: string
        dueDate?: string | null
        folio?: string
        concept?: string
        taxCents?: number
      },
    ) =>
      req<Factura>(`/api/horas/facturar?profileId=${profileId}`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  },
  inventario: {
    /**
     * La ventana solo afecta al **costo de ventas**: la existencia y el valor
     * miran todo el historial, porque lo que tienes hoy es lo que entró menos
     * lo que salió desde siempre.
     */
    almacen: (profileId: number, periodo?: { desde: string; hasta: string }) => {
      const q = new URLSearchParams({ profileId: String(profileId) })
      if (periodo) {
        q.set('desde', periodo.desde)
        q.set('hasta', periodo.hasta)
      }
      return req<Almacen>(`/api/inventario?${q}`)
    },
    movimientos: (profileId: number, productId: number) =>
      req<MovimientoStock[]>(`/api/inventario/${productId}/movimientos?profileId=${profileId}`),
    create: (data: ProductoDraft) =>
      req<Producto>('/api/inventario', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: ProductoDraft) =>
      req<Producto>(`/api/inventario/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    /** Con historial responde 409: lo que toca es archivar, no perder el pasado. */
    remove: (profileId: number, id: number) =>
      req<{ ok: true }>(`/api/inventario/${id}?profileId=${profileId}`, { method: 'DELETE' }),
    registrar: (data: MovimientoStockDraft) =>
      req<Producto>('/api/inventario/movimientos', { method: 'POST', body: JSON.stringify(data) }),
    borrarMovimiento: (profileId: number, id: number) =>
      req<{ ok: true }>(`/api/inventario/movimientos/${id}?profileId=${profileId}`, {
        method: 'DELETE',
      }),
  },
  precios: {
    analizar: (data: { profileId: number; texto: string; fecha?: string | null }) =>
      req<InformePrecios>('/api/precios/analizar', { method: 'POST', body: JSON.stringify(data) }),
    aplicar: (data: { profileId: number; texto: string; fecha?: string | null; filas: number[] }) =>
      req<{ creadas: number; omitidas: number }>('/api/precios/aplicar', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  },
  simulador: (
    profileId: number,
    opciones: {
      meses: number
      ahorroMensualCents: number
      rendimientoAnualBp: number
      inflacionAnualBp?: number
      /** Ausente = se aporta todo el horizonte. */
      mesesAporte?: number
      retiroMensualCents?: number
      /** Cero o ausente = no se pregunta por una meta. */
      objetivoCents?: number
    },
  ) =>
    req<Simulacion>(
      `/api/simulador?profileId=${profileId}&meses=${opciones.meses}` +
        `&ahorroMensualCents=${opciones.ahorroMensualCents}` +
        `&rendimientoAnualBp=${opciones.rendimientoAnualBp}` +
        `&inflacionAnualBp=${opciones.inflacionAnualBp ?? 0}` +
        (opciones.mesesAporte === undefined ? '' : `&mesesAporte=${opciones.mesesAporte}`) +
        `&retiroMensualCents=${opciones.retiroMensualCents ?? 0}` +
        `&objetivoCents=${opciones.objetivoCents ?? 0}`,
    ),
  budgets: {
    /** El mes entero: topes mensuales, anuales del año, tope total y el avance. */
    list: (profileId: number, month: string) =>
      req<PresupuestoMes>(`/api/budgets?profileId=${profileId}&month=${month}`),
    set: (data: {
      profileId: number
      categoryId: number
      /** 'AAAA-MM' si es mensual, 'AAAA' si es anual. */
      period: string
      periodKind?: 'mes' | 'anio'
      amountCents: number
      /** Si este mes recibe el saldo del anterior. Solo mensuales. */
      rollover?: boolean
    }) => req<PresupuestoMes>('/api/budgets', { method: 'POST', body: JSON.stringify(data) }),
    copy: (data: { profileId: number; from: string; to: string }) =>
      req<{ copiados: number; presupuesto: PresupuestoMes }>('/api/budgets/copiar', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    remove: (id: number) => req<{ ok: true }>(`/api/budgets/${id}`, { method: 'DELETE' }),
    setTotal: (data: { profileId: number; month: string; amountCents: number }) =>
      req<TopeTotal>('/api/budgets/total', { method: 'PUT', body: JSON.stringify(data) }),
    removeTotal: (id: number) =>
      req<{ ok: true }>(`/api/budgets/total/${id}`, { method: 'DELETE' }),
  },
  goals: {
    list: (profileId: number) => req<Goal[]>(`/api/goals?profileId=${profileId}`),
    create: (data: {
      profileId: number
      name: string
      targetCents: number
      dueDate?: string | null
      note?: string
      /** Dónde vive el dinero de la meta. Sin ella, la meta es solo un apunte. */
      accountId?: number | null
    }) => req<Goal>('/api/goals', { method: 'POST', body: JSON.stringify(data) }),
    update: (
      id: number,
      data: Partial<{
        name: string
        targetCents: number
        dueDate: string | null
        note: string
        accountId: number | null
      }>,
    ) => req<Goal>(`/api/goals/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    remove: (id: number) => req<{ ok: true }>(`/api/goals/${id}`, { method: 'DELETE' }),
    addEntry: (
      id: number,
      data: { amountCents: number; date: string; note?: string; accountId?: number | null },
    ) =>
      req<Goal>(`/api/goals/${id}/entries`, { method: 'POST', body: JSON.stringify(data) }),
    removeEntry: (entryId: number) =>
      req<Goal>(`/api/goals/entries/${entryId}`, { method: 'DELETE' }),
  },
  notes: {
    list: (profileId: number) => req<Note[]>(`/api/notes?profileId=${profileId}`),
    create: (data: { profileId: number; title: string; body: string }) =>
      req<Note>('/api/notes', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: Partial<{ title: string; body: string; pinned: boolean }>) =>
      req<Note>(`/api/notes/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    remove: (id: number) => req<{ ok: true }>(`/api/notes/${id}`, { method: 'DELETE' }),
  },
  importaciones: {
    /** Analiza sin escribir nada. Devuelve el informe fila por fila. */
    previsualizar: (data: ImportDraft) =>
      req<InformeImport>('/api/importaciones/previsualizar', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    /** Escribe. `huella` obliga a que sea lo mismo que se previsualizó. */
    ejecutar: (data: ImportDraft & { huella: string }) =>
      req<ResultadoImport>('/api/importaciones', { method: 'POST', body: JSON.stringify(data) }),
    lotes: (profileId: number) => req<LoteImport[]>(`/api/importaciones?profileId=${profileId}`),
    deshacer: (id: number, profileId: number) =>
      req<{ borradas: number }>(`/api/importaciones/${id}?profileId=${profileId}`, {
        method: 'DELETE',
      }),
  },
  recurrencias: {
    list: (profileId: number) => req<Recurrencia[]>(`/api/recurrencias?profileId=${profileId}`),
    /**
     * La bandeja de propuestas. **No existe en la base**: se deriva de las
     * plantillas menos los periodos ya resueltos, así que pedirla no escribe
     * nada ni asienta nada.
     */
    pendientes: (profileId: number, limit = 100, offset = 0) =>
      req<Bandeja>(
        `/api/recurrencias/pendientes?profileId=${profileId}&limit=${limit}&offset=${offset}`,
      ),
    create: (data: RecurrenciaDraft) =>
      req<Recurrencia>('/api/recurrencias', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: RecurrenciaDraft) =>
      req<Recurrencia>(`/api/recurrencias/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    /** Los movimientos ya asentados se quedan en el libro; dice cuántos son. */
    remove: (id: number, profileId: number) =>
      req<{ ok: true; asentados: number }>(`/api/recurrencias/${id}?profileId=${profileId}`, {
        method: 'DELETE',
      }),
    /** Lo único de esta sección que escribe en el libro, y siempre a petición. */
    asentar: (id: number, profileId: number, data: AsentarDraft) =>
      req<Tx>(`/api/recurrencias/${id}/asentar?profileId=${profileId}`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    descartar: (id: number, profileId: number, periodo: string) =>
      req<{ ok: true }>(`/api/recurrencias/${id}/descartar?profileId=${profileId}`, {
        method: 'POST',
        body: JSON.stringify({ periodo }),
      }),
    reabrir: (id: number, profileId: number, periodo: string) =>
      req<{ ok: true }>(`/api/recurrencias/${id}/reabrir?profileId=${profileId}`, {
        method: 'POST',
        body: JSON.stringify({ periodo }),
      }),
  },
  calendario: (profileId: number, dias = 30) =>
    req<Calendario>(`/api/calendario?profileId=${profileId}&dias=${dias}`),
  /**
   * La caja proyectada día a día. Derivada del calendario y de lo que ya está
   * asentado con fecha futura: pedirla no escribe una fila.
   */
  flujo: (profileId: number, dias = 30) =>
    req<FlujoProyectado>(`/api/flujo?profileId=${profileId}&dias=${dias}`),
  /**
   * Las alertas de hoy. **Derivadas**: no se guardan, no se descartan y
   * pedirlas no escribe nada. Se apagan solas cuando el hecho deja de ser
   * cierto.
   */
  alertas: (profileId: number) => req<Alerta[]>(`/api/alertas?profileId=${profileId}`),
  /** El panel sobre los últimos `meses` **cerrados**; el mes en curso no entra. */
  analisis: (profileId: number, meses = 6, umbralHormigaCents?: number) =>
    req<Analisis>(
      `/api/analisis?profileId=${profileId}&meses=${meses}` +
        (umbralHormigaCents === undefined ? '' : `&umbralHormigaCents=${umbralHormigaCents}`),
    ),
  summary: (profileId: number, month: string) =>
    req<Summary>(`/api/summary?profileId=${profileId}&month=${month}`),
  reportes: {
    /** El año completo: series, categorías, etiquetas y totales. */
    anual: (profileId: number, year: number) =>
      req<ReporteAnual>(`/api/reportes?profileId=${profileId}&year=${year}`),
    /**
     * Dos periodos cualesquiera, de mes a mes. Sin `contra`, el servidor toma
     * el bloque inmediatamente anterior del mismo largo.
     */
    comparativa: (
      profileId: number,
      periodo: { desde: string; hasta: string },
      contra?: { desde: string; hasta: string },
    ) =>
      req<Comparativa>(
        `/api/reportes/comparativa?profileId=${profileId}` +
          `&desde=${periodo.desde}&hasta=${periodo.hasta}` +
          (contra ? `&contraDesde=${contra.desde}&contraHasta=${contra.hasta}` : ''),
      ),
  },
  backup: {
    /** El navegador descarga el archivo directo desde esta ruta. */
    downloadUrl: '/api/respaldo',
    info: () => req<{ dbPath: string }>('/api/respaldo/info'),
    restore: (snapshot: unknown) =>
      req<{ restaurados: Record<string, number> }>('/api/respaldo/restaurar', {
        method: 'POST',
        body: JSON.stringify(snapshot),
      }),
  },
}
