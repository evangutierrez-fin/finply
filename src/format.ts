// Formateo de dinero y fechas. Fechas siempre como texto 'AAAA-MM-DD'
// para evitar sorpresas de zona horaria.

const formatters = new Map<string, Intl.NumberFormat>()

export function fmtMoney(cents: number, currency = 'MXN'): string {
  let f = formatters.get(currency)
  if (!f) {
    f = new Intl.NumberFormat('es-MX', { style: 'currency', currency })
    formatters.set(currency, f)
  }
  return f.format(cents / 100)
}

/** '1,234.56' | '$1234' | '1234.5' → centavos enteros, o null si no es un monto. */
export function parseAmount(raw: string): number | null {
  const clean = raw.replace(/[$,\s]/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null
  const cents = Math.round(parseFloat(clean) * 100)
  return cents > 0 ? cents : null
}

export const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

export function fmtDate(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${Number(d)} ${MESES[Number(m) - 1]!.slice(0, 3)}`
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-')
  const name = MESES[Number(m) - 1]!
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${y}`
}

export function todayISO(): string {
  const now = new Date()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${m}-${d}`
}

export function currentMonth(): string {
  return todayISO().slice(0, 7)
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const total = (y! * 12 + (m! - 1)) + delta
  const ny = Math.floor(total / 12)
  const nm = (total % 12) + 1
  return `${ny}-${String(nm).padStart(2, '0')}`
}

export function isPastDue(dueDate: string | null): boolean {
  return dueDate !== null && dueDate < todayISO()
}
