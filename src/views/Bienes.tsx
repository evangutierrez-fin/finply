// Bienes: la casa, el auto, la herramienta (H3).
//
// Lo que arregla: financiar un auto creaba una deuda que bajaba el patrimonio
// y el auto nunca lo subía. Aquí vive el otro lado de esa resta.
//
// El valor **lo declara el usuario** (R9). Finply no deprecia por su cuenta:
// no hay una tasa universal para un coche o una casa. Sin valuaciones, un bien
// vale lo que costó, que es lo más honesto que se puede afirmar de él.

import { useState } from 'react'
import { api } from '../api.ts'
import { useApp } from '../context.ts'
import { useFetch } from '../hooks.ts'
import { fmtDate, parseAmount, todayISO } from '../format.ts'
import { Money } from '../components/Money.tsx'
import { Modal } from '../components/Modal.tsx'
import type { Bien, BienKind, Debt } from '../../shared/types.ts'

const TIPOS: { id: BienKind; label: string }[] = [
  { id: 'inmueble', label: 'Inmueble' },
  { id: 'vehiculo', label: 'Vehículo' },
  { id: 'equipo', label: 'Equipo' },
  { id: 'otro', label: 'Otro' },
]

const ETIQUETA = new Map(TIPOS.map((t) => [t.id, t.label]))

function BienModal({
  bien,
  deudas,
  onClose,
  onSaved,
}: {
  bien: Bien | null
  deudas: Debt[]
  onClose: () => void
  onSaved: () => void
}) {
  const { profile, stamp } = useApp()
  const [name, setName] = useState(bien?.name ?? '')
  const [kind, setKind] = useState<BienKind>(bien?.kind ?? 'otro')
  const [cost, setCost] = useState(bien ? (bien.costCents / 100).toFixed(2) : '')
  const [acquiredDate, setAcquiredDate] = useState(bien?.acquiredDate ?? todayISO())
  const [debtId, setDebtId] = useState<number>(bien?.debtId ?? 0)
  const [note, setNote] = useState(bien?.note ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const cents = parseAmount(cost, { permitirNegativo: true })
    if (!name.trim()) return setError('El bien necesita un nombre')
    if (cents === null || cents < 0) return setError('Escribe cuánto costó')
    setSaving(true)
    setError(null)
    try {
      const datos = {
        name: name.trim(),
        kind,
        costCents: cents,
        acquiredDate,
        debtId: debtId || null,
        note: note.trim(),
      }
      if (bien) await api.bienes.update(bien.id, datos)
      else await api.bienes.create({ profileId: profile.id, ...datos })
      stamp(bien ? 'Actualizado' : 'Apuntado')
      onSaved()
      onClose()
    } catch (err) {
      setError((err as Error).message)
      setSaving(false)
    }
  }

  return (
    <Modal title={bien ? 'Corregir bien' : 'Nuevo bien'} onClose={onClose}>
      <form className="forma" onSubmit={submit}>
        <label className="campo">
          <span className="campo-label">Qué es</span>
          <input
            className="campo-input"
            placeholder="Ej. Casa de Coyoacán, Nissan Versa, torno"
            maxLength={60}
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
              value={kind}
              onChange={(e) => setKind(e.target.value as BienKind)}
            >
              {TIPOS.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          </label>
          <label className="campo campo-monto">
            <span className="campo-label">Qué costó</span>
            <div className="monto-wrap">
              <span className="monto-signo" aria-hidden="true">$</span>
              <input
                className="campo-input monto"
                inputMode="decimal"
                placeholder="0.00"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
              />
            </div>
          </label>
        </div>

        <div className="campos-2">
          <label className="campo">
            <span className="campo-label">Cuándo lo compraste</span>
            <input
              type="date"
              className="campo-input"
              value={acquiredDate}
              onChange={(e) => setAcquiredDate(e.target.value)}
            />
          </label>
          <label className="campo">
            <span className="campo-label">¿Lo financiaste?</span>
            <select
              className="campo-input"
              value={debtId}
              onChange={(e) => setDebtId(Number(e.target.value))}
            >
              <option value={0}>No, de contado</option>
              {deudas
                .filter((d) => d.direction === 'por_pagar')
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.concept || d.counterparty} · ${(d.balanceCents / 100).toFixed(2)}
                  </option>
                ))}
            </select>
          </label>
        </div>

        <label className="campo">
          <span className="campo-label">Nota</span>
          <input
            className="campo-input"
            maxLength={200}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
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

function ValuarModal({ bien, onClose, onSaved }: { bien: Bien; onClose: () => void; onSaved: () => void }) {
  const { stamp } = useApp()
  const [date, setDate] = useState(todayISO())
  const [valor, setValor] = useState((bien.valueCents / 100).toFixed(2))
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const cents = parseAmount(valor, { permitirNegativo: true })
    if (cents === null || cents < 0) return setError('Escribe cuánto vale hoy')
    setSaving(true)
    setError(null)
    try {
      await api.bienes.valuar(bien.id, { date, valueCents: cents, note: note.trim() })
      stamp('Valuado')
      onSaved()
      onClose()
    } catch (err) {
      setError((err as Error).message)
      setSaving(false)
    }
  }

  return (
    <Modal title={`Cuánto vale ${bien.name}`} onClose={onClose}>
      <form className="forma" onSubmit={submit}>
        <p className="forma-nota">
          Lo declaras tú. Finply no deprecia por su cuenta: no hay una tasa que sirva para
          todos los coches ni para todas las casas.
        </p>
        <div className="campos-2">
          <label className="campo">
            <span className="campo-label">Al día</span>
            <input type="date" className="campo-input" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="campo campo-monto">
            <span className="campo-label">Vale</span>
            <div className="monto-wrap">
              <span className="monto-signo" aria-hidden="true">$</span>
              <input
                className="campo-input monto"
                inputMode="decimal"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                autoFocus
              />
            </div>
          </label>
        </div>
        <label className="campo">
          <span className="campo-label">De dónde sale ese número</span>
          <input
            className="campo-input"
            placeholder="Ej. Guía de precios, avalúo, lo que ofrecen"
            maxLength={200}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        {error && <p className="forma-error" role="alert">{error}</p>}
        <footer className="forma-pie">
          <button type="button" className="btn btn-fantasma" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn-primario" disabled={saving}>
            {saving ? 'Guardando…' : 'Guardar valor'}
          </button>
        </footer>
      </form>
    </Modal>
  )
}

export function Bienes() {
  const { profile, refreshKey, bump, stamp } = useApp()
  const [editando, setEditando] = useState<Bien | null | undefined>(undefined)
  const [valuando, setValuando] = useState<Bien | null>(null)
  const [borrando, setBorrando] = useState<number | null>(null)

  const { data: bienes, error } = useFetch(() => api.bienes.list(profile.id), [profile.id, refreshKey])
  const { data: deudas } = useFetch(() => api.debts.list(profile.id), [profile.id, refreshKey])

  const activos = (bienes ?? []).filter((b) => !b.archived)
  const valorTotal = activos.reduce((s, b) => s + b.valueCents, 0)
  const costoTotal = activos.reduce((s, b) => s + b.costCents, 0)
  const deudaTotal = activos.reduce((s, b) => s + b.debtBalanceCents, 0)

  const borrar = async (bien: Bien) => {
    try {
      await api.bienes.remove(bien.id)
      stamp('Borrado')
      bump()
    } catch (err) {
      alert((err as Error).message)
    }
    setBorrando(null)
  }

  return (
    <div className="vista">
      <header className="vista-head">
        <h1>Bienes</h1>
        <button type="button" className="btn btn-primario btn-chico" onClick={() => setEditando(null)}>
          ＋ Apuntar un bien
        </button>
      </header>

      {error && <p className="aviso" role="alert">{error}</p>}

      {bienes && activos.length === 0 ? (
        <div className="vacio">
          <p className="vacio-titulo">Todavía no apuntas ningún bien.</p>
          <p className="vacio-sub">
            La casa, el auto o la herramienta del taller. Sin ellos, financiar algo solo
            resta de tu patrimonio: la deuda aparece y lo que compraste no.
          </p>
        </div>
      ) : (
        <>
          <div className="stats">
            <div className="stat">
              <span className="stat-label">Valen hoy</span>
              <span className="stat-valor"><Money cents={valorTotal} /></span>
            </div>
            <div className="stat">
              <span className="stat-label">Costaron</span>
              <span className="stat-valor"><Money cents={costoTotal} /></span>
            </div>
            <div className="stat">
              <span className="stat-label">Se debe de ellos</span>
              <span className="stat-valor"><Money cents={deudaTotal} /></span>
            </div>
            <div className="stat">
              <span className="stat-label">Ya es tuyo</span>
              <span className="stat-valor"><Money cents={valorTotal - deudaTotal} signed /></span>
            </div>
          </div>

          <ul className="bienes">
            {activos.map((b) => (
              <li className="bien" key={b.id}>
                <div className="bien-cabeza">
                  <div>
                    <h2 className="bien-nombre">{b.name}</h2>
                    <p className="bien-meta">
                      {ETIQUETA.get(b.kind)} · desde {fmtDate(b.acquiredDate)}
                      {b.debtId && ` · financiado (${b.debtConcept || 'crédito'})`}
                    </p>
                  </div>
                  <span className="acciones">
                    <button type="button" className="accion" onClick={() => setValuando(b)} aria-label={`Valuar ${b.name}`}>$</button>
                    <button type="button" className="accion" onClick={() => setEditando(b)} aria-label={`Corregir ${b.name}`}>✎</button>
                    {borrando === b.id ? (
                      <>
                        <button type="button" className="btn-liga btn-liga-rojo" onClick={() => void borrar(b)}>Borrar</button>
                        <button type="button" className="btn-liga" onClick={() => setBorrando(null)}>No</button>
                      </>
                    ) : (
                      <button type="button" className="accion" onClick={() => setBorrando(b.id)} aria-label={`Borrar ${b.name}`}>✕</button>
                    )}
                  </span>
                </div>

                <dl className="bien-cifras">
                  <div>
                    <dt>Vale hoy</dt>
                    <dd><Money cents={b.valueCents} /></dd>
                  </div>
                  <div>
                    <dt>Costó</dt>
                    <dd><Money cents={b.costCents} /></dd>
                  </div>
                  <div>
                    <dt>{b.depreciacionCents >= 0 ? 'Ha perdido' : 'Ha subido'}</dt>
                    <dd><Money cents={Math.abs(b.depreciacionCents)} /></dd>
                  </div>
                  {b.debtId !== null && (
                    <>
                      <div>
                        <dt>Debes</dt>
                        <dd><Money cents={b.debtBalanceCents} /></dd>
                      </div>
                      <div>
                        <dt>Ya es tuyo</dt>
                        <dd className={b.equityCents < 0 ? 'stat-rojo' : undefined}>
                          <Money cents={b.equityCents} signed />
                        </dd>
                      </div>
                    </>
                  )}
                </dl>

                {b.valuaciones === 0 ? (
                  <p className="bien-aviso">
                    Nunca lo has valuado, así que cuenta por lo que costó. Ponle su valor de
                    hoy para que tu patrimonio deje de suponerlo.
                  </p>
                ) : (
                  <ul className="bien-valuaciones">
                    {b.entries.slice(0, 4).map((v) => (
                      <li key={v.id}>
                        <span className="bien-fecha">{fmtDate(v.date)}</span>
                        <Money cents={v.valueCents} />
                        {v.note && <span className="bien-nota">{v.note}</span>}
                      </li>
                    ))}
                  </ul>
                )}
                {b.note && <p className="bien-nota-libre">{b.note}</p>}
              </li>
            ))}
          </ul>
        </>
      )}

      {editando !== undefined && (
        <BienModal
          bien={editando}
          deudas={deudas ?? []}
          onClose={() => setEditando(undefined)}
          onSaved={bump}
        />
      )}
      {valuando && <ValuarModal bien={valuando} onClose={() => setValuando(null)} onSaved={bump} />}
    </div>
  )
}
