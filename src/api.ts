import type {
  Account, Budget, Category, Debt, DebtPayment, Goal, Investment, InvestmentEntryType,
  Note, Profile, Summary, Tx, TxType,
} from '../shared/types.ts'

async function req<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: options?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
  })
  if (!res.ok) {
    let message = `Error ${res.status}`
    try {
      const body = await res.json()
      if (body?.error) message = body.error
    } catch {
      // sin cuerpo JSON: se queda el mensaje genérico
    }
    throw new Error(message)
  }
  return res.json() as Promise<T>
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
  },
  tx: {
    list: (params: {
      profileId: number; month?: string; accountId?: number; type?: string; q?: string
    }) => {
      const search = new URLSearchParams()
      search.set('profileId', String(params.profileId))
      if (params.month) search.set('month', params.month)
      if (params.accountId) search.set('accountId', String(params.accountId))
      if (params.type) search.set('type', params.type)
      if (params.q) search.set('q', params.q)
      return req<Tx[]>(`/api/transactions?${search}`)
    },
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
    set: (data: { profileId: number; categoryId: number; amountCents: number }) =>
      req<{ ok: true }>('/api/budgets', { method: 'POST', body: JSON.stringify(data) }),
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
  summary: (profileId: number, month: string) =>
    req<Summary>(`/api/summary?profileId=${profileId}&month=${month}`),
}
