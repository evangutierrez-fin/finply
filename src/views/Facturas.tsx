import { useEffect, useState } from 'react'
import { api } from '../api.ts'
import { useApp } from '../context.ts'
import { useFetch } from '../hooks.ts'
import { fmtDate, fmtMoney, parseAmount, todayISO } from '../format.ts'
import { Money } from '../components/Money.tsx'
import { Modal } from '../components/Modal.tsx'
import { tramoDe, TRAMO_LABEL } from '../../shared/negocio.ts'
import type { Account, CentroCosto, Contraparte, DireccionFactura, Factura } from '../../shared/types.ts'

const DIRECCIONES: { id: DireccionFactura | 'todas'; label: string }[] = [
  { id: 'todas', label: 'Todas' },
  { id: 'emitida', label: 'Emitidas' },
  { id: 'recibida', label: 'Recibidas' },
]

function FacturaModal({
  direction,
  contrapartes,
  centros,
  dimensionLabel,
  onClose,
  onSaved,
}: {
  direction: DireccionFactura
  contrapartes: Contraparte[]
  centros: CentroCosto[]
  dimensionLabel: string
  onClose: () => void
  onSaved: () => void
}) {
  const { profile, stamp } = useApp()
  const [counterpartyId, setCounterpartyId] = useState(contrapartes[0]?.id ?? 0)
  const [folio, setFolio] = useState('')
  const [concept, setConcept] = useState('')
  const [issueDate, setIssueDate] = useState(todayISO())
  const [dueDate, setDueDate] = useState('')
  const [subtotal, setSubtotal] = useState('')
  const [tax, setTax] = useState('')
  const [costCenterId, setCostCenterId] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const subtotalCents = parseAmount(subtotal)
  const taxCents = tax.trim() === '' ? 0 : parseAmount(tax)
  const total = subtotalCents !== null && taxCents !== null ? subtotalCents + taxCents : null

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!counterpartyId) return setError('Elige la contraparte')
    if (subtotalCents === null) return setError('Escribe un subtotal válido')
    if (taxCents === null) return setError('Ese impuesto no se entiende')
    setSaving(true)
    setError(null)
    try {
      await api.facturas.create({
        profileId: profile.id,
        counterpartyId,
        direction,
        folio: folio.trim(),
        concept: concept.trim(),
        issueDate,
        dueDate: dueDate || null,
        subtotalCents,
        taxCents,
        costCenterId: costCenterId || null,
      })
      stamp('Registrada')
      onSaved()
      onClose()
    } catch (err) {
      setError((err as Error).message)
      setSaving(false)
    }
  }

  return (
    <Modal
      title={direction === 'emitida' ? 'Nueva factura emitida' : 'Nueva factura recibida'}
      onClose={onClose}
    >
      <form className="forma" onSubmit={submit}>
        <p className="forma-nota">
          Registrarla <strong>no mueve tu libro</strong>: es el compromiso, no el asiento. El
          {direction === 'emitida' ? ' ingreso' : ' gasto'} entra cuando la
          {direction === 'emitida' ? ' cobres' : ' pagues'}, desde esta misma lista.
        </p>
        <div className="campos-2">
          <label className="campo">
            <span className="campo-label">{direction === 'emitida' ? 'Cliente' : 'Proveedor'}</span>
            <select
              className="campo-input"
              value={counterpartyId}
              onChange={(e) => setCounterpartyId(Number(e.target.value))}
            >
              <option value={0}>Elige…</option>
              {contrapartes.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <label className="campo">
            <span className="campo-label">Folio</span>
            <input className="campo-input" value={folio} onChange={(e) => setFolio(e.target.value)} placeholder="Opcional" />
          </label>
        </div>
        <label className="campo">
          <span className="campo-label">Concepto</span>
          <input className="campo-input" value={concept} onChange={(e) => setConcept(e.target.value)} />
        </label>
        <div className="campos-2">
          <label className="campo">
            <span className="campo-label">Fecha de emisión</span>
            <input type="date" className="campo-input" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
          </label>
          <label className="campo">
            <span className="campo-label">Vence</span>
            <input type="date" className="campo-input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </label>
        </div>
        <div className="campos-2">
          <label className="campo">
            <span className="campo-label">Subtotal</span>
            <div className="monto-wrap">
              <span className="monto-signo" aria-hidden="true">$</span>
              <input className="campo-input" inputMode="decimal" value={subtotal} onChange={(e) => setSubtotal(e.target.value)} placeholder="0.00" />
            </div>
          </label>
          <label className="campo">
            <span className="campo-label">Impuesto</span>
            <div className="monto-wrap">
              <span className="monto-signo" aria-hidden="true">$</span>
              <input className="campo-input" inputMode="decimal" value={tax} onChange={(e) => setTax(e.target.value)} placeholder="0.00" />
            </div>
          </label>
        </div>
        {centros.length > 0 && (
          <label className="campo">
            <span className="campo-label">{dimensionLabel}</span>
            <select className="campo-input" value={costCenterId} onChange={(e) => setCostCenterId(Number(e.target.value))}>
              <option value={0}>Sin asignar</option>
              {centros.filter((c) => !c.archived).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
        )}
        {total !== null && (
          <p className="forma-nota">
            Total: <strong className="cifra-chica">{fmtMoney(total)}</strong>. El impuesto se escribe
            en monto, no en tasa: Finply no supone el porcentaje de tu país.
          </p>
        )}
        {error && <p className="forma-error" role="alert">{error}</p>}
        <footer className="forma-pie">
          <button type="button" className="btn btn-fantasma" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn-primario" disabled={saving}>
            {saving ? 'Guardando…' : 'Registrar factura'}
          </button>
        </footer>
      </form>
    </Modal>
  )
}

function CobroModal({ factura, onClose, onSaved }: { factura: Factura; onClose: () => void; onSaved: () => void }) {
  const { profile, stamp } = useApp()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [accountId, setAccountId] = useState(0)
  const [amount, setAmount] = useState((factura.saldoCents / 100).toFixed(2))
  const [date, setDate] = useState(todayISO())
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.accounts.list(profile.id).then((accs) => {
      const vivas = accs.filter((a) => !a.archived)
      setAccounts(vivas)
      setAccountId(vivas[0]?.id ?? 0)
    }, (err: Error) => setError(err.message))
  }, [profile.id])

  const cents = parseAmount(amount)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!accountId) return setError('Elige la cuenta')
    if (cents === null) return setError('Escribe un monto válido')
    setSaving(true)
    setError(null)
    try {
      await api.facturas.cobrar(factura.id, { accountId, amountCents: cents, date })
      stamp(factura.direction === 'emitida' ? 'Cobrada' : 'Pagada')
      onSaved()
      onClose()
    } catch (err) {
      setError((err as Error).message)
      setSaving(false)
    }
  }

  return (
    <Modal
      title={`${factura.direction === 'emitida' ? 'Cobrar' : 'Pagar'} · ${factura.counterpartyName}`}
      onClose={onClose}
    >
      <form className="forma" onSubmit={submit}>
        <p className="forma-nota">
          Aquí es donde el dinero entra al libro. Falta{' '}
          <strong className="cifra-chica">{fmtMoney(factura.saldoCents)}</strong> de{' '}
          {fmtMoney(factura.totalCents)}.
        </p>
        <div className="campos-2">
          <label className="campo">
            <span className="campo-label">Monto</span>
            <div className="monto-wrap">
              <span className="monto-signo" aria-hidden="true">$</span>
              <input className="campo-input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
            </div>
          </label>
          <label className="campo">
            <span className="campo-label">Fecha</span>
            <input type="date" className="campo-input" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>
        <label className="campo">
          <span className="campo-label">{factura.direction === 'emitida' ? 'Entra a' : 'Sale de'}</span>
          <select className="campo-input" value={accountId} onChange={(e) => setAccountId(Number(e.target.value))}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </label>
        {factura.taxCents > 0 && cents !== null && (
          <p className="forma-nota">
            Se traslada la parte proporcional del impuesto: cobrar la mitad traslada la mitad.
          </p>
        )}
        {error && <p className="forma-error" role="alert">{error}</p>}
        <footer className="forma-pie">
          <button type="button" className="btn btn-fantasma" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn-primario" disabled={saving}>
            {saving ? 'Guardando…' : 'Registrar'}
          </button>
        </footer>
      </form>
    </Modal>
  )
}

/** Antigüedad de saldos: cuánto te deben y desde hace cuánto. */
function Aging({ lado, tramos, total }: { lado: string; tramos: { tramo: string; label: string; montoCents: number; facturas: number }[]; total: number }) {
  if (total === 0) return <p className="grafica-vacia">Nada pendiente de {lado.toLowerCase()}.</p>
  return (
    <ul className="aging">
      {tramos.map((t) => {
        // Un tramo vacío se queda en gris: pintarlo de vencido llamaría la
        // atención sobre una fila que no tiene nada dentro.
        const vencido = t.tramo !== 'corriente' && t.montoCents > 0
        return (
          <li key={t.tramo} className={vencido ? 'aging-vencido' : ''}>
            <span className="aging-label">{t.label}</span>
            <span className="aging-riel">
              {t.montoCents > 0 && (
                <span
                  className={`aging-lleno${vencido ? ' aging-lleno-vencido' : ''}`}
                  style={{ width: `${(t.montoCents / total) * 100}%` }}
                />
              )}
            </span>
            <span className="cifra cifra-chica">{fmtMoney(t.montoCents)}</span>
          </li>
        )
      })}
    </ul>
  )
}

export function Facturas() {
  const { profile, refreshKey, bump, stamp } = useApp()
  const [filtro, setFiltro] = useState<DireccionFactura | 'todas'>('todas')
  const [creando, setCreando] = useState<DireccionFactura | null>(null)
  const [cobrando, setCobrando] = useState<Factura | null>(null)

  const { data: facturas, error } = useFetch(
    () => api.facturas.list(profile.id),
    [profile.id, refreshKey],
  )
  const { data: aging } = useFetch(() => api.facturas.aging(profile.id), [profile.id, refreshKey])
  const { data: contrapartes } = useFetch(
    () => api.contrapartes.list(profile.id),
    [profile.id, refreshKey],
  )
  const { data: centros } = useFetch(() => api.centros.list(profile.id), [profile.id, refreshKey])

  const lista = (facturas ?? []).filter((f) => filtro === 'todas' || f.direction === filtro)
  const vivas = (contrapartes ?? []).filter((c) => !c.archived)
  const hoy = todayISO()

  const borrar = async (f: Factura) => {
    try {
      await api.facturas.remove(f.id)
      stamp('Borrada')
      bump()
    } catch (err) {
      alert((err as Error).message)
    }
  }

  return (
    <div className="vista">
      <header className="vista-head">
        <h1>Facturas</h1>
        <div className="vista-head-acciones">
          <button
            type="button"
            className="btn btn-fantasma"
            disabled={vivas.length === 0}
            onClick={() => setCreando('recibida')}
          >
            ＋ Recibida
          </button>
          <button
            type="button"
            className="btn btn-primario"
            disabled={vivas.length === 0}
            onClick={() => setCreando('emitida')}
          >
            ＋ Emitida
          </button>
        </div>
      </header>

      {error && <p className="aviso" role="alert">{error}</p>}
      {contrapartes && vivas.length === 0 && (
        <p className="aviso">
          Antes de facturar hace falta al menos una contraparte: una factura siempre es a alguien.
        </p>
      )}

      {aging && (
        <div className="dos-columnas">
          <section className="hoja">
            <h2 className="hoja-titulo">Te deben · <Money cents={aging.porCobrarCents} className="cifra-chica" /></h2>
            <Aging lado="cobrar" tramos={aging.porCobrar} total={aging.porCobrarCents} />
          </section>
          <section className="hoja">
            <h2 className="hoja-titulo">Debes · <Money cents={aging.porPagarCents} className="cifra-chica" /></h2>
            <Aging lado="pagar" tramos={aging.porPagar} total={aging.porPagarCents} />
          </section>
        </div>
      )}

      {aging && aging.vencidoPorContraparte.length > 0 && (
        <section className="hoja">
          <h2 className="hoja-titulo">Lo vencido, por quién</h2>
          <ul className="lista-simple">
            {aging.vencidoPorContraparte.map((v) => (
              <li key={`${v.direction}-${v.id}`}>
                <span>{v.name}</span>
                <span className="cifra-chica">
                  {v.direction === 'emitida' ? 'te debe ' : 'le debes '}
                  <Money cents={v.montoCents} className="cifra-chica" />
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="seg seg-chico" role="radiogroup" aria-label="Qué facturas ver">
        {DIRECCIONES.map((d) => (
          <button
            key={d.id}
            type="button"
            role="radio"
            aria-checked={filtro === d.id}
            className={`seg-item${filtro === d.id ? ' activa' : ''}`}
            onClick={() => setFiltro(d.id)}
          >
            {d.label}
          </button>
        ))}
      </div>

      {facturas && lista.length === 0 ? (
        <div className="vacio">
          <p className="vacio-titulo">Sin facturas todavía.</p>
          <p className="vacio-sub">
            Una factura registrada no mueve tu libro: es el compromiso. El dinero entra o sale
            cuando la cobras o la pagas desde aquí, y mientras tanto aparece en tu flujo proyectado
            y en la antigüedad de saldos.
          </p>
        </div>
      ) : (
        <section className="hoja">
          <table className="tabla">
            <thead>
              <tr>
                <th>Contraparte</th>
                <th>Emitida</th>
                <th>Vence</th>
                <th className="col-num">Total</th>
                <th className="col-num">Falta</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lista.map((f) => {
                const tramo = f.saldoCents > 0 ? tramoDe(hoy, f.dueDate) : 'corriente'
                const vencida = f.saldoCents > 0 && tramo !== 'corriente'
                return (
                  <tr key={f.id} className={f.status === 'cancelada' ? 'fila-archivada' : ''}>
                    <td>
                      <strong>{f.counterpartyName}</strong>
                      <div className="tabla-sub">
                        {f.direction === 'emitida' ? 'Emitida' : 'Recibida'}
                        {f.folio && ` · ${f.folio}`}
                        {f.concept && ` · ${f.concept}`}
                        {f.costCenterName && ` · ${f.costCenterName}`}
                      </div>
                    </td>
                    <td className="cifra-chica">{fmtDate(f.issueDate)}</td>
                    <td className="cifra-chica">
                      {f.dueDate ? fmtDate(f.dueDate) : '—'}
                      {vencida && <span className="chip chip-rojo aging-chip">{TRAMO_LABEL[tramo]}</span>}
                    </td>
                    <td className="col-num"><Money cents={f.totalCents} className="cifra-chica" /></td>
                    <td className="col-num">
                      {f.saldoCents === 0 ? (
                        <span className="cifra-chica stat-in">Saldada</span>
                      ) : (
                        <Money cents={f.saldoCents} className="cifra-chica" />
                      )}
                    </td>
                    <td className="col-acciones">
                      {f.saldoCents > 0 && f.status === 'abierta' && (
                        <button type="button" className="btn-liga" onClick={() => setCobrando(f)}>
                          {f.direction === 'emitida' ? 'Cobrar' : 'Pagar'}
                        </button>
                      )}
                      <button type="button" className="btn-liga btn-liga-rojo" onClick={() => borrar(f)}>
                        Borrar
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>
      )}

      {creando && (
        <FacturaModal
          direction={creando}
          contrapartes={vivas}
          centros={centros ?? []}
          dimensionLabel={profile.dimensionLabel}
          onClose={() => setCreando(null)}
          onSaved={bump}
        />
      )}
      {cobrando && (
        <CobroModal factura={cobrando} onClose={() => setCobrando(null)} onSaved={bump} />
      )}
    </div>
  )
}
