import { useEffect, useState } from 'react'
import { api } from '../api.ts'
import { useApp } from '../context.ts'
import { useFetch } from '../hooks.ts'
import { fmtDate, fmtMoney, parseAmount, todayISO } from '../format.ts'
import { Money, CountUpMoney } from '../components/Money.tsx'
import { Modal } from '../components/Modal.tsx'
import type { Account, Investment, InvestmentEntryType, InvestmentKind } from '../../shared/types.ts'

const KIND_LABEL: Record<InvestmentKind, string> = {
  cetes: 'CETES',
  acciones: 'Acciones',
  cripto: 'Cripto',
  fondo: 'Fondo',
  inmueble: 'Inmueble',
  otro: 'Otra',
}

const ENTRY_LABEL: Record<InvestmentEntryType, string> = {
  aporte: 'Aporte',
  retiro: 'Retiro',
  valuacion: 'Valuación',
}

/** Minigráfica del valor a lo largo del tiempo (aportes y valuaciones). */
function Sparkline({ investment }: { investment: Investment }) {
  const points: number[] = []
  let value = 0
  for (const e of investment.entries) {
    if (e.type === 'aporte') value += e.amountCents
    else if (e.type === 'retiro') value = Math.max(0, value - e.amountCents)
    else value = e.amountCents
    points.push(value)
  }
  if (points.length < 2) return null
  const min = Math.min(...points)
  const max = Math.max(...points)
  const range = max - min || 1
  const w = 200
  const h = 34
  const step = w / (points.length - 1)
  const coords = points.map((p, i) => `${(i * step).toFixed(1)},${(h - 4 - ((p - min) / range) * (h - 8)).toFixed(1)}`)
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="chispa"
      role="img"
      aria-label="Evolución del valor"
      preserveAspectRatio="none"
    >
      <polyline points={coords.join(' ')} className="chispa-linea" />
    </svg>
  )
}

function EntryModal({
  investment,
  mode,
  onClose,
  onSaved,
}: {
  investment: Investment
  mode: InvestmentEntryType
  onClose: () => void
  onSaved: () => void
}) {
  const { profile, stamp } = useApp()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [amount, setAmount] = useState(
    mode === 'valuacion' && investment.valueCents > 0
      ? (investment.valueCents / 100).toFixed(2)
      : '',
  )
  const [date, setDate] = useState(todayISO())
  const [accountId, setAccountId] = useState(0)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (mode === 'valuacion') return
    api.accounts.list(profile.id).then(
      (accs) => setAccounts(accs.filter((a) => !a.archived)),
      (err: Error) => setError(err.message),
    )
  }, [profile.id, mode])

  const titles: Record<InvestmentEntryType, string> = {
    aporte: `Aportar · ${investment.name}`,
    retiro: `Retirar · ${investment.name}`,
    valuacion: `Valuar · ${investment.name}`,
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const cents = parseAmount(amount)
    if (cents === null) return setError('Escribe un monto válido')
    setSaving(true)
    setError(null)
    try {
      await api.investments.addEntry(investment.id, {
        type: mode,
        amountCents: cents,
        date,
        note: note.trim(),
        accountId: mode === 'valuacion' ? null : accountId || null,
      })
      stamp(mode === 'aporte' ? 'Aportado' : mode === 'retiro' ? 'Retirado' : 'Valuado')
      onSaved()
      onClose()
    } catch (err) {
      setError((err as Error).message)
      setSaving(false)
    }
  }

  return (
    <Modal title={titles[mode]} onClose={onClose}>
      <form className="forma" onSubmit={submit}>
        {mode === 'valuacion' && (
          <p className="forma-nota">
            Apunta cuánto vale hoy la inversión completa (lo que ves en tu estado de cuenta).
          </p>
        )}
        <div className="campos-2">
          <label className="campo">
            <span className="campo-label">{mode === 'valuacion' ? 'Valor actual' : 'Monto'}</span>
            <div className="monto-wrap">
              <span className="monto-signo" aria-hidden="true">$</span>
              <input
                className="campo-input"
                inputMode="decimal"
                placeholder="0.00"
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
        {mode !== 'valuacion' && (
          <label className="campo">
            <span className="campo-label">{mode === 'aporte' ? 'Sale de la cuenta' : 'Entra a la cuenta'}</span>
            <select className="campo-input" value={accountId} onChange={(e) => setAccountId(Number(e.target.value))}>
              <option value={0}>Solo apuntar (sin movimiento)</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </label>
        )}
        <label className="campo">
          <span className="campo-label">Nota</span>
          <input className="campo-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Opcional" />
        </label>
        {error && <p className="forma-error" role="alert">{error}</p>}
        <footer className="forma-pie">
          <button type="button" className="btn btn-fantasma" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn-primario" disabled={saving}>
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </footer>
      </form>
    </Modal>
  )
}

function InvestmentModal({
  investment,
  onClose,
  onSaved,
}: {
  investment: Investment | null
  onClose: () => void
  onSaved: () => void
}) {
  const { profile, stamp } = useApp()
  const [name, setName] = useState(investment?.name ?? '')
  const [kind, setKind] = useState<InvestmentKind>(investment?.kind ?? 'otro')
  const [note, setNote] = useState(investment?.note ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return setError('La inversión necesita un nombre')
    setSaving(true)
    setError(null)
    try {
      if (investment) {
        await api.investments.update(investment.id, { name: name.trim(), kind, note: note.trim() })
      } else {
        await api.investments.create({ profileId: profile.id, name: name.trim(), kind, note: note.trim() })
      }
      stamp(investment ? 'Actualizada' : 'Abierta')
      onSaved()
      onClose()
    } catch (err) {
      setError((err as Error).message)
      setSaving(false)
    }
  }

  return (
    <Modal title={investment ? 'Editar inversión' : 'Nueva inversión'} onClose={onClose}>
      <form className="forma" onSubmit={submit}>
        <label className="campo">
          <span className="campo-label">Nombre</span>
          <input
            className="campo-input"
            placeholder="Ej. CETES 28 días, Fondo indexado"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </label>
        <div className="campos-2">
          <label className="campo">
            <span className="campo-label">Tipo</span>
            <select className="campo-input" value={kind} onChange={(e) => setKind(e.target.value as InvestmentKind)}>
              {(Object.keys(KIND_LABEL) as InvestmentKind[]).map((k) => (
                <option key={k} value={k}>{KIND_LABEL[k]}</option>
              ))}
            </select>
          </label>
          <label className="campo">
            <span className="campo-label">Nota</span>
            <input className="campo-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej. Cetesdirecto" />
          </label>
        </div>
        {error && <p className="forma-error" role="alert">{error}</p>}
        <footer className="forma-pie">
          <button type="button" className="btn btn-fantasma" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn-primario" disabled={saving}>
            {saving ? 'Guardando…' : investment ? 'Guardar cambios' : 'Abrir inversión'}
          </button>
        </footer>
      </form>
    </Modal>
  )
}

function InvestmentCard({ investment, index }: { investment: Investment; index: number }) {
  const { bump, stamp } = useApp()
  const [entryMode, setEntryMode] = useState<InvestmentEntryType | null>(null)
  const [editing, setEditing] = useState(false)
  const [showEntries, setShowEntries] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const gain = investment.valueCents - investment.investedCents
  const pct = investment.investedCents > 0 ? (gain / investment.investedCents) * 100 : null
  const lastValuation = [...investment.entries].reverse().find((e) => e.type === 'valuacion')

  const remove = async () => {
    try {
      await api.investments.remove(investment.id)
      stamp('Borrada')
      bump()
    } catch (err) {
      alert((err as Error).message)
    }
  }

  const removeEntry = async (entryId: number) => {
    try {
      await api.investments.removeEntry(entryId)
      stamp('Anulado')
      bump()
    } catch (err) {
      alert((err as Error).message)
    }
  }

  return (
    <article className="hoja inversion" style={{ animationDelay: `${index * 60}ms` }}>
      <header className="deuda-head">
        <h3>{investment.name}</h3>
        <span className="chip">{KIND_LABEL[investment.kind]}</span>
      </header>
      {investment.note && <p className="deuda-concepto">{investment.note}</p>}

      <div className="inversion-valor">
        <Money cents={investment.valueCents} className="inversion-cifra" />
        <span className={`inversion-gan ${gain >= 0 ? 'stat-in' : ''}`}>
          <Money cents={gain} signed className="cifra-chica" />
          {pct !== null && (
            <span className="cifra-chica"> · {gain >= 0 ? '+' : ''}{pct.toFixed(1)} %</span>
          )}
        </span>
      </div>

      <Sparkline investment={investment} />

      <p className="deuda-cifras">
        Aportado: <Money cents={investment.investedCents} className="cifra-chica" />
        {lastValuation && <> · valuada el {fmtDate(lastValuation.date)}</>}
      </p>

      <footer className="deuda-pie">
        <button type="button" className="btn btn-primario btn-chico" onClick={() => setEntryMode('aporte')}>
          Aportar
        </button>
        <button type="button" className="btn-liga" onClick={() => setEntryMode('valuacion')}>Valuar</button>
        <button type="button" className="btn-liga" onClick={() => setEntryMode('retiro')}>Retirar</button>
        {investment.entries.length > 0 && (
          <button type="button" className="btn-liga" onClick={() => setShowEntries((s) => !s)}>
            {showEntries ? 'Ocultar' : `Historial (${investment.entries.length})`}
          </button>
        )}
        <span className="deuda-borrar-zona">
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
        </span>
      </footer>

      {showEntries && (
        <ul className="abonos">
          {[...investment.entries].reverse().map((e) => (
            <li key={e.id}>
              <span className="abono-fecha">{fmtDate(e.date)}</span>
              <span className="abono-nota">
                {ENTRY_LABEL[e.type]}{e.note ? ` · ${e.note}` : ''}
              </span>
              <Money cents={e.amountCents} className="cifra-chica" />
              <button type="button" className="accion" aria-label="Anular registro" onClick={() => removeEntry(e.id)}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      {entryMode && (
        <EntryModal
          investment={investment}
          mode={entryMode}
          onClose={() => setEntryMode(null)}
          onSaved={bump}
        />
      )}
      {editing && (
        <InvestmentModal investment={investment} onClose={() => setEditing(false)} onSaved={bump} />
      )}
    </article>
  )
}

export function Inversiones() {
  const { profile, refreshKey, bump } = useApp()
  const [creating, setCreating] = useState(false)
  const { data: investments, error } = useFetch(
    () => api.investments.list(profile.id),
    [profile.id, refreshKey],
  )

  const active = (investments ?? []).filter((i) => !i.archived)
  const invested = active.reduce((s, i) => s + i.investedCents, 0)
  const value = active.reduce((s, i) => s + i.valueCents, 0)
  const gain = value - invested

  return (
    <div className="vista">
      <header className="vista-head">
        <h1>Inversiones</h1>
        <button type="button" className="btn btn-primario" onClick={() => setCreating(true)}>
          ＋ Nueva inversión
        </button>
      </header>

      {error && <p className="aviso" role="alert">{error}</p>}

      {investments && investments.length === 0 ? (
        <div className="vacio">
          <p className="vacio-titulo">Aún no siembras nada.</p>
          <p className="vacio-sub">
            Apunta tus CETES, fondos, acciones o cripto. Registra aportes y valúa cuando quieras:
            Finply te dice cuánto ha rendido cada una.
          </p>
          <button type="button" className="btn btn-primario" onClick={() => setCreating(true)}>
            Abrir la primera inversión
          </button>
        </div>
      ) : (
        <>
          <section className="hero">
            <div className="hero-total">
              <span className="rotulo">Valor actual · {active.length} {active.length === 1 ? 'inversión' : 'inversiones'}</span>
              <CountUpMoney cents={value} className="hero-cifra hero-cifra-media" />
            </div>
            <dl className="hero-stats">
              <div className="stat">
                <dt>Aportado</dt>
                <dd><Money cents={invested} /></dd>
              </div>
              <div className="stat stat-neto">
                <dt>Rendimiento</dt>
                <dd>
                  <span className={gain >= 0 ? 'stat-in' : ''}>
                    <Money cents={gain} signed />
                    {invested > 0 && (
                      <span className="cifra-chica"> · {gain >= 0 ? '+' : ''}{((gain / invested) * 100).toFixed(1)} %</span>
                    )}
                  </span>
                </dd>
              </div>
            </dl>
          </section>

          <section className="inversiones-grid">
            {active.map((inv, i) => (
              <InvestmentCard key={inv.id} investment={inv} index={i} />
            ))}
          </section>
        </>
      )}

      {creating && <InvestmentModal investment={null} onClose={() => setCreating(false)} onSaved={bump} />}
    </div>
  )
}
