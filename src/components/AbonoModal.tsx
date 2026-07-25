import { useEffect, useState } from 'react'
import type { Account, Debt } from '../../shared/types.ts'
import { api } from '../api.ts'
import { fmtMoney, parseAmount, todayISO } from '../format.ts'
import { useApp } from '../context.ts'
import { Modal } from './Modal.tsx'

export function AbonoModal({
  debt,
  onClose,
  onSaved,
}: {
  debt: Debt
  onClose: () => void
  onSaved: () => void
}) {
  const { profile, stamp } = useApp()
  const remaining = debt.principalCents - debt.paidCents
  const [accounts, setAccounts] = useState<Account[]>([])
  const [amount, setAmount] = useState((remaining / 100).toFixed(2))
  const [date, setDate] = useState(todayISO())
  const [accountId, setAccountId] = useState<number>(0)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.accounts.list(profile.id).then(
      (accs) => setAccounts(accs.filter((a) => !a.archived)),
      (err: Error) => setError(err.message),
    )
  }, [profile.id])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const cents = parseAmount(amount)
    if (!cents) return setError('Escribe el monto del abono')
    setSaving(true)
    setError(null)
    try {
      await api.debts.addPayment(debt.id, {
        amountCents: cents,
        date,
        note: note.trim(),
        accountId: accountId || null,
      })
      stamp('Abonado')
      onSaved()
      onClose()
    } catch (err) {
      setError((err as Error).message)
      setSaving(false)
    }
  }

  return (
    <Modal title={`Abonar · ${debt.counterparty}`} onClose={onClose}>
      <form className="forma" onSubmit={submit}>
        <p className="forma-nota">
          Restan <strong className="cifra-chica">{fmtMoney(remaining)}</strong> de{' '}
          {fmtMoney(debt.principalCents)}.
        </p>
        <div className="campos-2">
          <label className="campo">
            <span className="campo-label">Monto del abono</span>
            <div className="monto-wrap">
              <span className="monto-signo" aria-hidden="true">$</span>
              <input
                className="campo-input"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                autoFocus
              />
            </div>
          </label>
          <label className="campo">
            <span className="campo-label">Fecha</span>
            <input
              type="date"
              className="campo-input"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
        </div>
        <label className="campo">
          <span className="campo-label">
            {debt.direction === 'por_cobrar' ? 'Entra a la cuenta' : 'Sale de la cuenta'}
          </span>
          <select
            className="campo-input"
            value={accountId}
            onChange={(e) => setAccountId(Number(e.target.value))}
          >
            <option value={0}>Solo apuntar (sin movimiento)</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </label>
        <label className="campo">
          <span className="campo-label">Nota</span>
          <input
            className="campo-input"
            placeholder={`Abono · ${debt.counterparty}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        {error && <p className="forma-error" role="alert">{error}</p>}
        <footer className="forma-pie">
          <button type="button" className="btn btn-fantasma" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primario" disabled={saving}>
            {saving ? 'Guardando…' : 'Registrar abono'}
          </button>
        </footer>
      </form>
    </Modal>
  )
}
