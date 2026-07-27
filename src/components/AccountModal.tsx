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
  tipoInicial = 'efectivo',
  onClose,
  onSaved,
}: {
  account: Account | null
  /** Con qué tipo abre el formulario de una cuenta nueva. */
  tipoInicial?: AccountType
  onClose: () => void
  onSaved: () => void
}) {
  const { profile, stamp } = useApp()
  const [name, setName] = useState(account?.name ?? '')
  const [type, setType] = useState<AccountType>(account?.type ?? tipoInicial)
  const [opening, setOpening] = useState(
    account ? (account.openingCents / 100).toFixed(2) : '0',
  )
  const [limite, setLimite] = useState(
    account?.creditLimitCents != null ? (account.creditLimitCents / 100).toFixed(2) : '',
  )
  const [corte, setCorte] = useState(account?.cutDay != null ? String(account.cutDay) : '')
  const [pago, setPago] = useState(account?.dueDay != null ? String(account.dueDay) : '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  /** Vacío significa "sin configurar", que es distinto de un cero. */
  const dia = (raw: string): number | null | 'error' => {
    const limpio = raw.trim()
    if (limpio === '') return null
    if (!/^\d{1,2}$/.test(limpio)) return 'error'
    const n = Number(limpio)
    return n >= 1 && n <= 31 ? n : 'error'
  }

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

    const cutDay = dia(corte)
    const dueDay = dia(pago)
    if (cutDay === 'error' || dueDay === 'error') {
      return setError('El día de corte y el de pago van del 1 al 31')
    }
    const creditLimitCents = limite.trim() === '' ? null : parseAmount(limite)
    if (limite.trim() !== '' && creditLimitCents === null) {
      return setError('El límite de crédito no es un monto válido')
    }
    // Los datos de crédito solo viajan si la cuenta es tarjeta; el servidor
    // rechaza lo contrario, y aquí ni siquiera se muestran.
    const credito =
      type === 'tarjeta' ? { creditLimitCents, cutDay, dueDay } : {}

    setSaving(true)
    setError(null)
    try {
      if (account) {
        await api.accounts.update(account.id, {
          name: name.trim(),
          type,
          openingCents,
          ...credito,
        })
      } else {
        await api.accounts.create({
          profileId: profile.id,
          name: name.trim(),
          type,
          openingCents,
          ...credito,
        })
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
        {type === 'tarjeta' && (
          <fieldset className="campo campo-fieldset tarjeta-campos">
            <legend className="campo-label">Datos de la tarjeta</legend>
            <p className="forma-nota">
              Con el día de corte, Finply calcula cuánto tienes que pagar para no generar
              intereses. Déjalos vacíos si aún no los sabes.
            </p>
            <div className="campos-3">
              <label className="campo">
                <span className="campo-label">Límite</span>
                <div className="monto-wrap">
                  <span className="monto-signo" aria-hidden="true">$</span>
                  <input
                    className="campo-input"
                    inputMode="decimal"
                    placeholder="Sin límite"
                    value={limite}
                    onChange={(e) => setLimite(e.target.value)}
                  />
                </div>
              </label>
              <label className="campo">
                <span className="campo-label">Día de corte</span>
                <input
                  className="campo-input"
                  inputMode="numeric"
                  placeholder="Ej. 5"
                  value={corte}
                  onChange={(e) => setCorte(e.target.value)}
                />
              </label>
              <label className="campo">
                <span className="campo-label">Día de pago</span>
                <input
                  className="campo-input"
                  inputMode="numeric"
                  placeholder="Ej. 25"
                  value={pago}
                  onChange={(e) => setPago(e.target.value)}
                />
              </label>
            </div>
          </fieldset>
        )}
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
