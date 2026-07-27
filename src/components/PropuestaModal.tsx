import { useState } from 'react'
import type { Propuesta } from '../../shared/types.ts'
import { api } from '../api.ts'
import { parseAmount } from '../format.ts'
import { useApp } from '../context.ts'
import { Modal } from './Modal.tsx'

/**
 * Corregir una propuesta antes de asentarla: el recibo de luz nunca llega
 * exacto. Lo que se cambia aquí es **esta** partida, no la plantilla — si la
 * renta subió de verdad, eso se edita en la recurrencia.
 */
export function PropuestaModal({
  propuesta,
  onClose,
  onSaved,
}: {
  propuesta: Propuesta
  onClose: () => void
  onSaved: () => void
}) {
  const { profile, stamp } = useApp()
  const [amount, setAmount] = useState((propuesta.amountCents / 100).toFixed(2))
  const [date, setDate] = useState(propuesta.fecha)
  const [note, setNote] = useState(propuesta.note)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const cents = parseAmount(amount)
    if (!cents) return setError('Escribe un monto válido, por ejemplo 250 o 1,250.50')
    setSaving(true)
    setError(null)
    try {
      await api.recurrencias.asentar(propuesta.recurrenceId, profile.id, {
        periodo: propuesta.periodo,
        amountCents: cents,
        date,
        note,
      })
      stamp('Asentado')
      onSaved()
      onClose()
    } catch (err) {
      setError((err as Error).message)
      setSaving(false)
    }
  }

  return (
    <Modal title="Ajustar antes de asentar" onClose={onClose}>
      <form className="forma" onSubmit={submit}>
        <p className="forma-nota">
          {propuesta.accountName}
          {propuesta.categoryName && ` · ${propuesta.categoryName}`} · {propuesta.descripcion}
        </p>

        <label className="campo campo-monto">
          <span className="campo-label">Monto</span>
          <div className="monto-wrap">
            <span className="monto-signo" aria-hidden="true">$</span>
            <input
              className="campo-input monto"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              autoFocus
            />
          </div>
        </label>

        <div className="campos-2">
          <label className="campo">
            <span className="campo-label">Fecha</span>
            <input
              type="date"
              className="campo-input"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label className="campo">
            <span className="campo-label">Concepto</span>
            <input
              className="campo-input"
              maxLength={200}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
        </div>

        <p className="forma-nota">
          Solo cambia esta partida. La recurrencia sigue igual para los demás periodos.
        </p>

        {error && <p className="forma-error" role="alert">{error}</p>}

        <footer className="forma-pie">
          <button type="button" className="btn btn-fantasma" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primario" disabled={saving}>
            {saving ? 'Asentando…' : 'Asentar en el libro'}
          </button>
        </footer>
      </form>
    </Modal>
  )
}
