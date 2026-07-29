import type {
  Account, Alerta, Amortizacion, Analisis, Bandeja, Budget, Calendario, Category, Comparativa,
  Aging, CentroCosto, CompraMSI, Contraparte, Debt, DebtPayment, EstadoResultados, EstadoTarjeta,
  Factura, FlujoProyectado, Frecuencia, Goal, InformeImport, InformePrecios, Investment,
  InvestmentEntryType, LoteImport, MapeoImport, ModuloId, Note, Profile, Recurrencia, ReporteAnual,
  ResultadoImport, RolCategoria, Simulacion, Summary, Tag, Tx, TxAttachment, TxType,
  Bien, BienKind, CorteConciliacion, SerieCuenta,
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
    create: (data: { profileId: number; name: string; role?: string; taxId?: string; note?: string }) =>
      req<Contraparte>('/api/contrapartes', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: Partial<{ name: string; role: string; taxId: string; note: string; archived: boolean }>) =>
      req<Contraparte>(`/api/contrapartes/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
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
  facturas: {
    list: (profileId: number, opciones: { direction?: string; pendientes?: boolean } = {}) => {
      const q = new URLSearchParams({ profileId: String(profileId) })
      if (opciones.direction) q.set('direction', opciones.direction)
      if (opciones.pendientes) q.set('pendientes', 'true')
      return req<Factura[]>(`/api/facturas?${q}`)
    },
    aging: (profileId: number) => req<Aging>(`/api/facturas/aging?profileId=${profileId}`),
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
      costCenterId?: number | null
    }) => req<Factura>('/api/facturas', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: Record<string, unknown>) =>
      req<Factura>(`/api/facturas/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    remove: (id: number) => req<{ ok: true }>(`/api/facturas/${id}`, { method: 'DELETE' }),
    cobrar: (
      id: number,
      data: { accountId: number; amountCents: number; date: string; note?: string; categoryId?: number | null },
    ) => req<Factura>(`/api/facturas/${id}/cobros`, { method: 'POST', body: JSON.stringify(data) }),
  },
  negocio: {
    resultados: (profileId: number, desde: string, hasta: string) =>
      req<EstadoResultados>(`/api/negocio/resultados?profileId=${profileId}&desde=${desde}&hasta=${hasta}`),
    flujo: (profileId: number, dias: number) =>
      req<FlujoProyectado>(`/api/negocio/flujo?profileId=${profileId}&dias=${dias}`),
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
    opciones: { meses: number; ahorroMensualCents: number; rendimientoAnualBp: number },
  ) =>
    req<Simulacion>(
      `/api/simulador?profileId=${profileId}&meses=${opciones.meses}` +
        `&ahorroMensualCents=${opciones.ahorroMensualCents}` +
        `&rendimientoAnualBp=${opciones.rendimientoAnualBp}`,
    ),
  budgets: {
    list: (profileId: number, month: string) =>
      req<Budget[]>(`/api/budgets?profileId=${profileId}&month=${month}`),
    set: (data: { profileId: number; categoryId: number; month: string; amountCents: number }) =>
      req<Budget>('/api/budgets', { method: 'POST', body: JSON.stringify(data) }),
    copy: (data: { profileId: number; from: string; to: string }) =>
      req<{ copiados: number; budgets: Budget[] }>('/api/budgets/copiar', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    remove: (id: number) => req<{ ok: true }>(`/api/budgets/${id}`, { method: 'DELETE' }),
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
   * Las alertas de hoy. **Derivadas**: no se guardan, no se descartan y
   * pedirlas no escribe nada. Se apagan solas cuando el hecho deja de ser
   * cierto.
   */
  alertas: (profileId: number) => req<Alerta[]>(`/api/alertas?profileId=${profileId}`),
  /** El panel sobre los últimos `meses` **cerrados**; el mes en curso no entra. */
  analisis: (profileId: number, meses = 6) =>
    req<Analisis>(`/api/analisis?profileId=${profileId}&meses=${meses}`),
  summary: (profileId: number, month: string) =>
    req<Summary>(`/api/summary?profileId=${profileId}&month=${month}`),
  reportes: {
    /** El año completo: series, categorías, etiquetas y totales. */
    anual: (profileId: number, year: number) =>
      req<ReporteAnual>(`/api/reportes?profileId=${profileId}&year=${year}`),
    comparativa: (profileId: number, month: string) =>
      req<Comparativa>(`/api/reportes/comparativa?profileId=${profileId}&month=${month}`),
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
