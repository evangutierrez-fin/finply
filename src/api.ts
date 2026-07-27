import type {
  Account, Budget, Category, Debt, DebtPayment, Goal, InformeImport, Investment,
  InvestmentEntryType, LoteImport, MapeoImport, Note, Profile, ResultadoImport,
  Summary, Tag, Tx, TxType,
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
    create: (data: {
      profileId: number; name: string; type: string; openingCents: number
    }) => req<Account>('/api/accounts', { method: 'POST', body: JSON.stringify(data) }),
    update: (
      id: number,
      data: Partial<{ name: string; type: string; openingCents: number; archived: boolean }>,
    ) => req<Account>(`/api/accounts/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    remove: (id: number) => req<{ ok: true }>(`/api/accounts/${id}`, { method: 'DELETE' }),
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
    addPayment: (
      debtId: number,
      data: { amountCents: number; date: string; note?: string; accountId?: number | null },
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
  summary: (profileId: number, month: string) =>
    req<Summary>(`/api/summary?profileId=${profileId}&month=${month}`),
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
