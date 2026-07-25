import { useState } from 'react'
import { api } from '../api.ts'
import { useApp } from '../context.ts'
import { useFetch } from '../hooks.ts'
import { fmtDate, fmtMoney, parseAmount, todayISO } from '../format.ts'
import { Money } from '../components/Money.tsx'
import { Modal } from '../components/Modal.tsx'
import type { Goal } from '../../shared/types.ts'

function GoalModal({
  goal,
  onClose,
  onSaved,
}: {
  goal: Goal | null
  onClose: () => void
  onSaved: () => void
}) {
  const { profile, stamp } = useApp()
  const [name, setName] = useState(goal?.name ?? '')
  const [target, setTarget] = useState(goal ? (goal.targetCents / 100).toFixed(2) : '')
  const [dueDate, setDueDate] = useState(goal?.dueDate ?? '')
  const [note, setNote] = useState(goal?.note ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const cents = parseAmount(target)
    if (!name.trim()) return setError('La meta necesita un nombre')
    if (!cents) return setError('Escribe el monto de la meta')
    setSaving(true)
    setError(null)
    try {
      if (goal) {
        await api.goals.update(goal.id, {
          name: name.trim(),
          targetCents: cents,
          dueDate: dueDate || null,
          note: note.trim(),
        })
      } else {
        await api.goals.create({
          profileId: profile.id,
          name: name.trim(),
          targetCents: cents,
          dueDate: dueDate || null,
          note: note.trim(),
        })
      }
      stamp(goal ? 'Actualizada' : 'Apuntada')
      onSaved()
      onClose()
    } catch (err) {
      setError((err as Error).message)
      setSaving(false)
    }
  }

  return (
    <Modal title={goal ? 'Editar meta' : 'Nueva meta'} onClose={onClose}>
      <form className="forma" onSubmit={submit}>
        <label className="campo">
          <span className="campo-label">Nombre</span>
          <input
            className="campo-input"
            placeholder="Ej. Fondo de emergencia, Viaje"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </label>
        <div className="campos-2">
          <label className="campo">
            <span className="campo-label">Monto de la meta</span>
            <div className="monto-wrap">
              <span className="monto-signo" aria-hidden="true">$</span>
              <input
                className="campo-input"
                inputMode="decimal"
                placeholder="0.00"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              />
            </div>
          </label>
          <label className="campo">
            <span className="campo-label">Fecha límite (opcional)</span>
            <input type="date" className="campo-input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </label>
        </div>
        <label className="campo">
          <span className="campo-label">Nota</span>
          <input className="campo-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Opcional" />
        </label>
        {error && <p className="forma-error" role="alert">{error}</p>}
        <footer className="forma-pie">
          <button type="button" className="btn btn-fantasma" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn-primario" disabled={saving}>
            {saving ? 'Guardando…' : goal ? 'Guardar cambios' : 'Apuntar meta'}
          </button>
        </footer>
      </form>
    </Modal>
  )
}

function GoalEntryModal({
  goal,
  onClose,
  onSaved,
}: {
  goal: Goal
  onClose: () => void
  onSaved: () => void
}) {
  const { stamp } = useApp()
  const remaining = Math.max(0, goal.targetCents - goal.savedCents)
  const [amount, setAmount] = useState(remaining > 0 ? (remaining / 100).toFixed(2) : '')
  const [date, setDate] = useState(todayISO())
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const cents = parseAmount(amount)
    if (!cents) return setError('Escribe el monto del aporte')
    setSaving(true)
    setError(null)
    try {
      const updated = await api.goals.addEntry(goal.id, { amountCents: cents, date, note: note.trim() })
      stamp(updated.status === 'cumplida' && goal.status !== 'cumplida' ? '¡Meta cumplida!' : 'Aportado')
      onSaved()
      onClose()
    } catch (err) {
      setError((err as Error).message)
      setSaving(false)
    }
  }

  return (
    <Modal title={`Aportar · ${goal.name}`} onClose={onClose}>
      <form className="forma" onSubmit={submit}>
        <p className="forma-nota">
          Llevas <strong className="cifra-chica">{fmtMoney(goal.savedCents)}</strong> de{' '}
          {fmtMoney(goal.targetCents)}.
        </p>
        <div className="campos-2">
          <label className="campo">
            <span className="campo-label">Monto</span>
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
            <input type="date" className="campo-input" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>
        <label className="campo">
          <span className="campo-label">Nota</span>
          <input className="campo-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Opcional" />
        </label>
        {error && <p className="forma-error" role="alert">{error}</p>}
        <footer className="forma-pie">
          <button type="button" className="btn btn-fantasma" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn-primario" disabled={saving}>
            {saving ? 'Guardando…' : 'Aportar'}
          </button>
        </footer>
      </form>
    </Modal>
  )
}

function GoalCard({ goal, index }: { goal: Goal; index: number }) {
  const { bump, stamp } = useApp()
  const [aporte, setAporte] = useState(false)
  const [editing, setEditing] = useState(false)
  const [showEntries, setShowEntries] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const pct = Math.min(100, (goal.savedCents / goal.targetCents) * 100)
  const remaining = Math.max(0, goal.targetCents - goal.savedCents)

  const remove = async () => {
    try {
      await api.goals.remove(goal.id)
      stamp('Borrada')
      bump()
    } catch (err) {
      alert((err as Error).message)
    }
  }

  const removeEntry = async (entryId: number) => {
    try {
      await api.goals.removeEntry(entryId)
      stamp('Anulado')
      bump()
    } catch (err) {
      alert((err as Error).message)
    }
  }

  return (
    <article
      className={`hoja deuda${goal.status === 'cumplida' ? ' saldada' : ''}`}
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <header className="deuda-head">
        <h3>{goal.name}</h3>
        {goal.status === 'cumplida' ? (
          <span className="sello-mini">Cumplida</span>
        ) : goal.dueDate ? (
          <span className="chip">Para {fmtDate(goal.dueDate)}</span>
        ) : null}
      </header>
      {goal.note && <p className="deuda-concepto">{goal.note}</p>}

      <div className="deuda-riel" role="img" aria-label={`Ahorrado ${fmtMoney(goal.savedCents)} de ${fmtMoney(goal.targetCents)}`}>
        <span className="deuda-lleno" style={{ width: `${pct}%` }} />
      </div>
      <p className="deuda-cifras">
        Llevas <Money cents={goal.savedCents} className="cifra-chica deuda-restan" /> de{' '}
        <Money cents={goal.targetCents} className="cifra-chica" />
        {goal.status !== 'cumplida' && <> · faltan {fmtMoney(remaining)}</>}
        <span className="cifra-chica"> · {pct.toFixed(0)} %</span>
      </p>

      <footer className="deuda-pie">
        {goal.status !== 'cumplida' && (
          <button type="button" className="btn btn-primario btn-chico" onClick={() => setAporte(true)}>
            Aportar
          </button>
        )}
        {goal.entries.length > 0 && (
          <button type="button" className="btn-liga" onClick={() => setShowEntries((s) => !s)}>
            {showEntries ? 'Ocultar aportes' : `Aportes (${goal.entries.length})`}
          </button>
        )}
        <button type="button" className="btn-liga" onClick={() => setEditing(true)}>Editar</button>
        {confirmDelete ? (
          <span className="confirmar">
            ¿Borrar?
            <button type="button" className="btn-liga btn-liga-rojo" onClick={remove}>Sí</button>
            <button type="button" className="btn-liga" onClick={() => setConfirmDelete(false)}>No</button>
          </span>
        ) : (
          <button type="button" className="btn-liga deuda-borrar" onClick={() => setConfirmDelete(true)}>
            Borrar
          </button>
        )}
      </footer>

      {showEntries && (
        <ul className="abonos">
          {goal.entries.map((e) => (
            <li key={e.id}>
              <span className="abono-fecha">{fmtDate(e.date)}</span>
              <span className="abono-nota">{e.note || 'Aporte'}</span>
              <Money cents={e.amountCents} className="cifra-chica" />
              <button type="button" className="accion" aria-label="Anular aporte" onClick={() => removeEntry(e.id)}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      {aporte && <GoalEntryModal goal={goal} onClose={() => setAporte(false)} onSaved={bump} />}
      {editing && <GoalModal goal={goal} onClose={() => setEditing(false)} onSaved={bump} />}
    </article>
  )
}

export function Metas() {
  const { profile, refreshKey, bump } = useApp()
  const [creating, setCreating] = useState(false)
  const { data: goals, error } = useFetch(() => api.goals.list(profile.id), [profile.id, refreshKey])

  const activas = (goals ?? []).filter((g) => g.status === 'activa')
  const totalTarget = activas.reduce((s, g) => s + g.targetCents, 0)
  const totalSaved = activas.reduce((s, g) => s + g.savedCents, 0)

  return (
    <div className="vista">
      <header className="vista-head">
        <h1>Metas</h1>
        <button type="button" className="btn btn-primario" onClick={() => setCreating(true)}>
          ＋ Nueva meta
        </button>
      </header>

      {error && <p className="aviso" role="alert">{error}</p>}

      {goals && goals.length === 0 ? (
        <div className="vacio">
          <p className="vacio-titulo">Sin metas todavía.</p>
          <p className="vacio-sub">
            Un fondo de emergencia, un viaje, el enganche de algo grande. Apunta la meta,
            aporta cuando puedas y mira la barra llenarse.
          </p>
          <button type="button" className="btn btn-primario" onClick={() => setCreating(true)}>
            Apuntar la primera
          </button>
        </div>
      ) : (
        <>
          {activas.length > 0 && (
            <p className="metas-resumen">
              Ahorrado <Money cents={totalSaved} className="cifra-chica deuda-restan" /> de{' '}
              <Money cents={totalTarget} className="cifra-chica" /> entre {activas.length}{' '}
              {activas.length === 1 ? 'meta activa' : 'metas activas'}.
            </p>
          )}
          <section className="metas-grid">
            {(goals ?? []).map((g, i) => (
              <GoalCard key={g.id} goal={g} index={i} />
            ))}
          </section>
        </>
      )}

      {creating && <GoalModal goal={null} onClose={() => setCreating(false)} onSaved={bump} />}
    </div>
  )
}
