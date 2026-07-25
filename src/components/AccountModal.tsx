import { useState } from 'react'
import type { Account, AccountType } from '../../shared/types.ts'
import { api } from '../api.ts'
import { parseAmount } from '../format.ts'
import { useApp } from '../context.ts'
import { Modal } from './Modal.tsx'

const TYPES: { id: AccountType; label: string }[] = [
  { id: 'efectivo', label: 'Efectivo' },
  { id: 'banco', label: 'Banco' },
  { id: 'tarjeta', label: 'Tarjeta' },
  { id: 'ahorro', label: 'Ahorro' },
  { id: 'otro', label: 'Otra' },
]

export function AccountModal({
  account,
  onClose,
  onSaved,
}: {
  account: Account | null
  onClose: () => void
  onSaved: () => void
}) {
  const { profile, stamp } = useApp()
  const [name, setName] = useState(account?.name ?? '')
  const [type, setType] = useState<AccountType>(account?.type ?? 'efectivo')
  const [opening, setOpening] = useState(
    account ? (account.openingCents / 100).toFixed(2) : '0',
  )
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    // Se admite negativo: una tarjeta puede abrir debiendo.
    const raw = opening.trim()
    let openingCents: number | null
    if (raw === '' || /^-?0(\.0{1,2})?$/.test(raw)) {
      openingCents = 0
    } else {
      const negative = raw.startsWith('-')
      const abs = parseAmount(negative ? raw.slice(1) : raw)
      openingCents = abs === null ? null : negative ? -abs : abs
    }
    if (openingCents === null) return setError('El saldo inicial no es un monto válido')
    if (!name.trim()) return setError('La cuenta necesita un nombre')
    setSaving(true)
    setError(null)
    try {
      if (account) {
        await api.accounts.update(account.id, { name: name.trim(), type, openingCents })
      } else {
        await api.accounts.create({ profileId: profile.id, name: name.trim(), type, openingCents })
      }
      stamp(account ? 'Actualizado' : 'Abierta')
      onSaved()
      onClose()
    } catch (err) {
      setError((err as Error).message)
      setSaving(false)
    }
  }

  return (
    <Modal title={account ? 'Editar cuenta' : 'Abrir cuenta'} onClose={onClose}>
      <form className="forma" onSubmit={submit}>
        <label className="campo">
          <span className="campo-label">Nombre</span>
          <input
            className="campo-input"
            placeholder="Ej. Efectivo, BBVA, Caja"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </label>
        <div className="campos-2">
          <label className="campo">
            <span className="campo-label">Tipo</span>
            <select
              className="campo-input"
              value={type}
              onChange={(e) => setType(e.target.value as AccountType)}
            >
              {TYPES.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          </label>
          <label className="campo">
            <span className="campo-label">Saldo inicial</span>
            <div className="monto-wrap">
              <span className="monto-signo" aria-hidden="true">$</span>
              <input
                className="campo-input"
                inputMode="decimal"
                value={opening}
                onChange={(e) => setOpening(e.target.value)}
              />
            </div>
          </label>
        </div>
        {error && <p className="forma-error" role="alert">{error}</p>}
        <footer className="forma-pie">
          <button type="button" className="btn btn-fantasma" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primario" disabled={saving}>
            {saving ? 'Guardando…' : account ? 'Guardar cambios' : 'Abrir cuenta'}
          </button>
        </footer>
      </form>
    </Modal>
  )
}
