import { useState } from 'react'
import type { DebtDirection } from '../../shared/types.ts'
import { api } from '../api.ts'
import { parseAmount, todayISO } from '../format.ts'
import { useApp } from '../context.ts'
import { Modal } from './Modal.tsx'

export function DebtModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { profile, stamp } = useApp()
  const [direction, setDirection] = useState<DebtDirection>('por_cobrar')
  const [counterparty, setCounterparty] = useState('')
  const [concept, setConcept] = useState('')
  const [principal, setPrincipal] = useState('')
  const [startDate, setStartDate] = useState(todayISO())
  const [dueDate, setDueDate] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const cents = parseAmount(principal)
    if (!cents) return setError('Escribe el monto de la deuda')
    if (!counterparty.trim()) return setError('¿Con quién es la deuda?')
    setSaving(true)
    setError(null)
    try {
      await api.debts.create({
        profileId: profile.id,
        direction,
        counterparty: counterparty.trim(),
        concept: concept.trim(),
        principalCents: cents,
        startDate,
        dueDate: dueDate || null,
      })
      stamp('Apuntada')
      onSaved()
      onClose()
    } catch (err) {
      setError((err as Error).message)
      setSaving(false)
    }
  }

  return (
    <Modal title="Apuntar deuda" onClose={onClose}>
      <form className="forma" onSubmit={submit}>
        <div className="seg" role="radiogroup" aria-label="Dirección de la deuda">
          <button
            type="button"
            role="radio"
            aria-checked={direction === 'por_cobrar'}
            className={`seg-item seg-ingreso${direction === 'por_cobrar' ? ' activa' : ''}`}
            onClick={() => setDirection('por_cobrar')}
          >
            Me deben
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={direction === 'por_pagar'}
            className={`seg-item seg-gasto${direction === 'por_pagar' ? ' activa' : ''}`}
            onClick={() => setDirection('por_pagar')}
          >
            Debo
          </button>
        </div>
        <div className="campos-2">
          <label className="campo">
            <span className="campo-label">{direction === 'por_cobrar' ? 'Quién te debe' : 'A quién le debes'}</span>
            <input
              className="campo-input"
              placeholder="Nombre o negocio"
              value={counterparty}
              onChange={(e) => setCounterparty(e.target.value)}
              autoFocus
            />
          </label>
          <label className="campo">
            <span className="campo-label">Monto</span>
            <div className="monto-wrap">
              <span className="monto-signo" aria-hidden="true">$</span>
              <input
                className="campo-input"
                inputMode="decimal"
                placeholder="0.00"
                value={principal}
                onChange={(e) => setPrincipal(e.target.value)}
              />
            </div>
          </label>
        </div>
        <label className="campo">
          <span className="campo-label">Concepto</span>
          <input
            className="campo-input"
            placeholder="Ej. Préstamo, corte de tarjeta, pedido"
            value={concept}
            onChange={(e) => setConcept(e.target.value)}
          />
        </label>
        <div className="campos-2">
          <label className="campo">
            <span className="campo-label">Fecha de inicio</span>
            <input
              type="date"
              className="campo-input"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </label>
          <label className="campo">
            <span className="campo-label">Vence (opcional)</span>
            <input
              type="date"
              className="campo-input"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </label>
        </div>
        {error && <p className="forma-error" role="alert">{error}</p>}
        <footer className="forma-pie">
          <button type="button" className="btn btn-fantasma" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primario" disabled={saving}>
            {saving ? 'Guardando…' : 'Apuntar deuda'}
          </button>
        </footer>
      </form>
    </Modal>
  )
}
