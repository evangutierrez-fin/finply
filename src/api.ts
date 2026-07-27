import type {
  Account, Amortizacion, Bandeja, Budget, Calendario, Category, Comparativa, CompraMSI, Debt,
  DebtPayment, EstadoTarjeta, Frecuencia, Goal, InformeImport, Investment, InvestmentEntryType,
  LoteImport, MapeoImport, Note, Profile, Recurrencia, ReporteAnual, ResultadoImport, Summary,
  Tag, Tx, TxType,
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

export const api = {
  profiles: {
    list: () => req<Profile[]>('/api/profiles'),
    create: (data: { name: string; kind: string; accent: string }) =>
      req<Profile>('/api/profiles', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: Partial<{ name: string; kind: string; accent: string }>) =>
      req<Profile>(`/api/profiles/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    remove: (id: number) => req<{ ok: true }>(`/api/profiles/${id}`, { method: 'DELETE' }),
  },
  accounts: {
    list: (profileId: number) => req<Account[]>(`/api/accounts?profileId=${profileId}`),
    create: (
      data: { profileId: number; name: string; type: string; openingCents: number } & CreditoDraft,
    ) => req<Account>('/api/accounts', { method: 'POST', body: JSON.stringify(data) }),
    update: (
      id: number,
      data: Partial<{ name: string; type: string; openingCents: number; archived: boolean }> &
        CreditoDraft,
    ) => req<Account>(`/api/accounts/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    remove: (id: number) => req<{ ok: true }>(`/api/accounts/${id}`, { method: 'DELETE' }),
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
      },
    ) => req<Investment>(`/api/investments/${id}/entries`, { method: 'POST', body: JSON.stringify(data) }),
    removeEntry: (entryId: number) =>
      req<Investment>(`/api/investments/entries/${entryId}`, { method: 'DELETE' }),
  },
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
      profileId: number; name: string; targetCents: number; dueDate?: string | null; note?: string
    }) => req<Goal>('/api/goals', { method: 'POST', body: JSON.stringify(data) }),
    update: (
      id: number,
      data: Partial<{ name: string; targetCents: number; dueDate: string | null; note: string }>,
    ) => req<Goal>(`/api/goals/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    remove: (id: number) => req<{ ok: true }>(`/api/goals/${id}`, { method: 'DELETE' }),
    addEntry: (id: number, data: { amountCents: number; date: string; note?: string }) =>
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
