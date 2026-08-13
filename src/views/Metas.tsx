import { useState } from 'react'
import { api } from '../api.ts'
import { useApp } from '../context.ts'
import { useFetch } from '../hooks.ts'
import { fmtDate, fmtMoney, parseAmount, todayISO } from '../format.ts'
import type { Account } from '../../shared/types.ts'
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
  const [accountId, setAccountId] = useState<number>(goal?.accountId ?? 0)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const { data: cuentas } = useFetch(() => api.accounts.list(profile.id), [profile.id])

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
          accountId: accountId || null,
        })
      } else {
        await api.goals.create({
          profileId: profile.id,
          name: name.trim(),
          targetCents: cents,
          dueDate: dueDate || null,
          note: note.trim(),
          accountId: accountId || null,
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
          <span className="campo-label">¿Dónde vive este dinero?</span>
          <select
            className="campo-input"
            value={accountId}
            onChange={(e) => setAccountId(Number(e.target.value))}
          >
            <option value={0}>En ningún lado todavía (solo apuntar)</option>
            {(cuentas ?? [])
              .filter((a: Account) => !a.archived)
              .map((a: Account) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
          </select>
          <span className="campo-ayuda">
            Con una cuenta, cada aporte mueve el dinero de verdad. Sin ella, la meta es un
            apunte: llevas la cuenta mentalmente y Finply te lo dice así.
          </span>
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
  const { profile, stamp } = useApp()
  const remaining = Math.max(0, goal.targetCents - goal.savedCents)
  const [amount, setAmount] = useState(
    goal.porMesCents ? (goal.porMesCents / 100).toFixed(2) : remaining > 0 ? (remaining / 100).toFixed(2) : '',
  )
  const [date, setDate] = useState(todayISO())
  const [note, setNote] = useState('')
  const [origenId, setOrigenId] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const { data: cuentas } = useFetch(() => api.accounts.list(profile.id), [profile.id])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const cents = parseAmount(amount)
    if (!cents) return setError('Escribe el monto del aporte')
    setSaving(true)
    setError(null)
    try {
      const updated = await api.goals.addEntry(goal.id, {
        amountCents: cents,
        date,
        note: note.trim(),
        accountId: origenId || null,
      })
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
          {goal.porMesCents !== null && goal.porMesCents > 0 && (
            <> Para llegar a tiempo hacen falta {fmtMoney(goal.porMesCents)} al mes.</>
          )}
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
          <span className="campo-label">¿De qué cuenta sale?</span>
          <select
            className="campo-input"
            value={origenId}
            onChange={(e) => setOrigenId(Number(e.target.value))}
            disabled={!goal.accountId}
          >
            <option value={0}>De ninguna (solo apuntarlo)</option>
            {(cuentas ?? [])
              .filter((a: Account) => !a.archived && a.id !== goal.accountId)
              .map((a: Account) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
          </select>
          <span className="campo-ayuda">
            {goal.accountId
              ? `Se asienta un traspaso a ${goal.accountName}. Sin cuenta, el aporte es solo un apunte.`
              : 'Esta meta todavía no dice dónde vive su dinero: elígela al editarla para poder moverlo.'}
          </span>
        </label>
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
        {/* h2 y no h3: aquí las metas cuelgan directo del título de la vista,
            sin encabezado de sección de por medio. Con h3 el índice del lector
            de pantalla saltaba de nivel 1 a nivel 3, que se lee como si
            faltara una sección. En Deudas e Inversiones sí hay un h2 arriba,
            y por eso ahí las tarjetas son h3. */}
        <h2>{goal.name}</h2>
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
      {/*
        H1. Antes, lo apartado no salía de ningún lado y el mismo peso se
        contaba dos veces entre esta vista y la de Cuentas. Ahora se dice
        cuánto de esto es dinero movido de verdad y cuánto es un apunte.
      */}
      {goal.status !== 'cumplida' && (
        <p className="meta-respaldo">
          {goal.accountId === null ? (
            <>Es un apunte: este dinero no sale de ninguna cuenta.</>
          ) : goal.respaldadoCents >= goal.savedCents ? (
            <>Respaldado en {goal.accountName}.</>
          ) : (
            <>
              Solo <Money cents={goal.respaldadoCents} className="cifra-chica" /> salieron de
              una cuenta; el resto es apunte.
            </>
          )}
          {goal.porMesCents !== null && goal.porMesCents > 0 && (
            <> Para llegar a tiempo: <Money cents={goal.porMesCents} className="cifra-chica" /> al mes.</>
          )}
        </p>
      )}

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
