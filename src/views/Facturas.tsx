import { useEffect, useMemo, useState } from 'react'
import { api } from '../api.ts'
import { useApp } from '../context.ts'
import { useFetch } from '../hooks.ts'
import { fmtDate, fmtMoney, parseAmount, todayISO } from '../format.ts'
import { Money } from '../components/Money.tsx'
import { Modal } from '../components/Modal.tsx'
import { Cadencia, reglaDesde, type ValoresCadencia } from '../components/Cadencia.tsx'
import { ocurrencias } from '../../shared/recurrencias.ts'
import { sumarDias } from '../../shared/fechas.ts'
import { tramoDe, TRAMO_LABEL } from '../../shared/negocio.ts'
import type {
  Account,
  Anticipo,
  CentroCosto,
  Contraparte,
  DireccionFactura,
  Factura,
  FacturaRecurrente,
  PropuestaFactura,
} from '../../shared/types.ts'

const DIRECCIONES: { id: DireccionFactura | 'todas'; label: string }[] = [
  { id: 'todas', label: 'Todas' },
  { id: 'emitida', label: 'Emitidas' },
  { id: 'recibida', label: 'Recibidas' },
]

/** Los dos campos de retención, que solo aparecen si el usuario los pide. */
function Retenciones({
  retenidoImpuesto,
  retenidoRenta,
  onImpuesto,
  onRenta,
}: {
  retenidoImpuesto: string
  retenidoRenta: string
  onImpuesto: (v: string) => void
  onRenta: (v: string) => void
}) {
  return (
    <>
      <div className="campos-2">
        <label className="campo">
          <span className="campo-label">Impuesto retenido</span>
          <div className="monto-wrap">
            <span className="monto-signo" aria-hidden="true">$</span>
            <input
              className="campo-input"
              inputMode="decimal"
              value={retenidoImpuesto}
              onChange={(e) => onImpuesto(e.target.value)}
              placeholder="0.00"
            />
          </div>
        </label>
        <label className="campo">
          <span className="campo-label">Retención sobre el ingreso</span>
          <div className="monto-wrap">
            <span className="monto-signo" aria-hidden="true">$</span>
            <input
              className="campo-input"
              inputMode="decimal"
              value={retenidoRenta}
              onChange={(e) => onRenta(e.target.value)}
              placeholder="0.00"
            />
          </div>
        </label>
      </div>
      <p className="forma-nota">
        Lo retenido <strong>no te lo van a pagar</strong>: lo entera quien te paga. Por eso baja lo
        que Finply te dice que falta por cobrar, y por eso la factura se salda sin ese dinero. Van
        en monto, no en tasa: Finply no supone los porcentajes de tu país.
      </p>
    </>
  )
}

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
  const [tocaronVence, setTocaronVence] = useState(false)
  const [subtotal, setSubtotal] = useState('')
  const [tax, setTax] = useState('')
  const [conRetencion, setConRetencion] = useState(false)
  const [retenidoImpuesto, setRetenidoImpuesto] = useState('')
  const [retenidoRenta, setRetenidoRenta] = useState('')
  const [costCenterId, setCostCenterId] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const elegida = contrapartes.find((c) => c.id === counterpartyId) ?? null

  // Los días de crédito de la contraparte proponen el vencimiento. Es una
  // propuesta, no una imposición: en cuanto el usuario toca la fecha, manda él.
  useEffect(() => {
    if (tocaronVence) return
    setDueDate(elegida?.creditDays == null ? '' : sumarDias(issueDate, elegida.creditDays))
  }, [elegida, issueDate, tocaronVence])

  const subtotalCents = parseAmount(subtotal)
  const taxCents = tax.trim() === '' ? 0 : parseAmount(tax)
  const retImpuesto = !conRetencion || retenidoImpuesto.trim() === '' ? 0 : parseAmount(retenidoImpuesto)
  const retRenta = !conRetencion || retenidoRenta.trim() === '' ? 0 : parseAmount(retenidoRenta)
  const total = subtotalCents !== null && taxCents !== null ? subtotalCents + taxCents : null
  const retenido = retImpuesto !== null && retRenta !== null ? retImpuesto + retRenta : null

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!counterpartyId) return setError('Elige la contraparte')
    if (subtotalCents === null) return setError('Escribe un subtotal válido')
    if (taxCents === null) return setError('Ese impuesto no se entiende')
    if (retImpuesto === null || retRenta === null) return setError('Esa retención no se entiende')
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
        withheldTaxCents: retImpuesto,
        withheldIncomeCents: retRenta,
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
            <input
              type="date"
              className="campo-input"
              value={dueDate}
              onChange={(e) => {
                setTocaronVence(true)
                setDueDate(e.target.value)
              }}
            />
          </label>
        </div>
        {!tocaronVence && elegida?.creditDays != null && (
          <p className="forma-nota">
            {elegida.name} tiene {elegida.creditDays} días de crédito, así que el vencimiento sale
            solo. Cámbialo si esta va distinta.
          </p>
        )}
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

        <label className="campo campo-casilla">
          <input
            type="checkbox"
            checked={conRetencion}
            onChange={(e) => setConRetencion(e.target.checked)}
          />
          <span className="campo-label">Me retienen parte</span>
        </label>
        {conRetencion && (
          <Retenciones
            retenidoImpuesto={retenidoImpuesto}
            retenidoRenta={retenidoRenta}
            onImpuesto={setRetenidoImpuesto}
            onRenta={setRetenidoRenta}
          />
        )}

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
            Total: <strong className="cifra-chica">{fmtMoney(total)}</strong>
            {retenido !== null && retenido > 0 && (
              <>
                , de los que te retienen {fmtMoney(retenido)}:{' '}
                <strong className="cifra-chica">vas a cobrar {fmtMoney(total - retenido)}</strong>
              </>
            )}
            . El impuesto se escribe en monto, no en tasa: Finply no supone el porcentaje de tu país.
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
          {fmtMoney(factura.cobrableCents)}
          {factura.cobrableCents !== factura.totalCents && (
            <> cobrables, sobre un documento de {fmtMoney(factura.totalCents)}</>
          )}
          .
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
        {factura.retenidoCents > 0 && (
          <p className="forma-nota">
            De esta factura te retienen {fmtMoney(factura.retenidoCents)}: ese dinero no va a
            llegar a tu cuenta y por eso no se cobra aquí. El impuesto trasladado sigue siendo el de
            la factura completa.
          </p>
        )}
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

/** Cancelar parte de una factura ya emitida. No mueve un peso. */
function NotaCreditoModal({ factura, onClose, onSaved }: { factura: Factura; onClose: () => void; onSaved: () => void }) {
  const { stamp } = useApp()
  const cancelable = factura.cobrableCents - factura.pagadoCents
  const [amount, setAmount] = useState((cancelable / 100).toFixed(2))
  const [date, setDate] = useState(todayISO())
  const [folio, setFolio] = useState('')
  const [concept, setConcept] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const cents = parseAmount(amount)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (cents === null) return setError('Escribe un monto válido')
    setSaving(true)
    setError(null)
    try {
      await api.facturas.nota(factura.id, {
        date,
        folio: folio.trim(),
        concept: concept.trim(),
        amountCents: cents,
      })
      stamp('Cancelada')
      onSaved()
      onClose()
    } catch (err) {
      setError((err as Error).message)
      setSaving(false)
    }
  }

  return (
    <Modal title={`Nota de crédito · ${factura.counterpartyName}`} onClose={onClose}>
      <form className="forma" onSubmit={submit}>
        <p className="forma-nota">
          Una nota de crédito <strong>no mueve dinero</strong>: cancela parte de lo que quedaba por
          cobrar. Por el total de lo pendiente ({fmtMoney(cancelable)}) cancela la factura entera.
          Si te devolvieron dinero que ya habías cobrado, eso no es esto: regístralo como una
          devolución del movimiento.
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
        <div className="campos-2">
          <label className="campo">
            <span className="campo-label">Folio</span>
            <input className="campo-input" value={folio} onChange={(e) => setFolio(e.target.value)} placeholder="Opcional" />
          </label>
          <label className="campo">
            <span className="campo-label">Motivo</span>
            <input className="campo-input" value={concept} onChange={(e) => setConcept(e.target.value)} placeholder="Opcional" />
          </label>
        </div>
        {error && <p className="forma-error" role="alert">{error}</p>}
        <footer className="forma-pie">
          <button type="button" className="btn btn-fantasma" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn-primario" disabled={saving}>
            {saving ? 'Guardando…' : 'Cancelar ese monto'}
          </button>
        </footer>
      </form>
    </Modal>
  )
}

/** Ligar un cobro que ya existía. No crea un movimiento nuevo. */
function AnticipoModal({ factura, onClose, onSaved }: { factura: Factura; onClose: () => void; onSaved: () => void }) {
  const { stamp } = useApp()
  const [lista, setLista] = useState<Anticipo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aplicando, setAplicando] = useState(0)

  useEffect(() => {
    api.facturas.anticipos(factura.id).then(setLista, (err: Error) => setError(err.message))
  }, [factura.id])

  const aplicar = async (txId: number) => {
    setAplicando(txId)
    setError(null)
    try {
      await api.facturas.aplicarAnticipo(factura.id, txId)
      stamp('Aplicado')
      onSaved()
      onClose()
    } catch (err) {
      setError((err as Error).message)
      setAplicando(0)
    }
  }

  return (
    <Modal title={`Aplicar un anticipo · ${factura.counterpartyName}`} onClose={onClose}>
      <div className="forma">
        <p className="forma-nota">
          Cobraste antes de facturar. Ese dinero <strong>ya entró a tu libro</strong> el día que lo
          cobraste y ya cuenta en su mes: aquí no se registra otra vez, solo se dice a qué factura
          correspondía. A esta le faltan{' '}
          <strong className="cifra-chica">{fmtMoney(factura.saldoCents)}</strong>.
        </p>
        {error && <p className="forma-error" role="alert">{error}</p>}
        {lista && lista.length === 0 && (
          <p className="grafica-vacia">
            No hay cobros sueltos de {factura.counterpartyName}: todo lo que le has registrado ya
            tiene su factura.
          </p>
        )}
        {lista && lista.length > 0 && (
          <ul className="lista-simple anticipos">
            {lista.map((a) => (
              <li key={a.txId}>
                <span>
                  {fmtDate(a.date)} · {a.accountName}
                  {a.note && <div className="tabla-sub">{a.note}</div>}
                </span>
                <span className="anticipo-accion">
                  <Money cents={a.amountCents} className="cifra-chica" />
                  <button
                    type="button"
                    className="btn-liga"
                    disabled={aplicando !== 0}
                    onClick={() => aplicar(a.txId)}
                  >
                    Aplicar
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <footer className="forma-pie">
          <button type="button" className="btn btn-fantasma" onClick={onClose}>Cerrar</button>
        </footer>
      </div>
    </Modal>
  )
}

function PlantillaModal({
  plantilla,
  contrapartes,
  centros,
  dimensionLabel,
  onClose,
  onSaved,
}: {
  plantilla: FacturaRecurrente | null
  contrapartes: Contraparte[]
  centros: CentroCosto[]
  dimensionLabel: string
  onClose: () => void
  onSaved: () => void
}) {
  const { profile, stamp } = useApp()
  const [direction, setDirection] = useState<DireccionFactura>(plantilla?.direction ?? 'emitida')
  const [counterpartyId, setCounterpartyId] = useState(plantilla?.counterpartyId ?? contrapartes[0]?.id ?? 0)
  const [concept, setConcept] = useState(plantilla?.concept ?? '')
  const [subtotal, setSubtotal] = useState(plantilla ? (plantilla.subtotalCents / 100).toFixed(2) : '')
  const [tax, setTax] = useState(plantilla ? (plantilla.taxCents / 100).toFixed(2) : '')
  const [conRetencion, setConRetencion] = useState(
    !!plantilla && plantilla.withheldTaxCents + plantilla.withheldIncomeCents > 0,
  )
  const [retenidoImpuesto, setRetenidoImpuesto] = useState(
    plantilla ? (plantilla.withheldTaxCents / 100).toFixed(2) : '',
  )
  const [retenidoRenta, setRetenidoRenta] = useState(
    plantilla ? (plantilla.withheldIncomeCents / 100).toFixed(2) : '',
  )
  const [creditDays, setCreditDays] = useState(
    plantilla?.creditDays == null ? '' : String(plantilla.creditDays),
  )
  const [costCenterId, setCostCenterId] = useState(plantilla?.costCenterId ?? 0)
  const [cadencia, setCadencia] = useState<ValoresCadencia>({
    frequency: plantilla?.frequency ?? 'mensual',
    dayOfMonth: plantilla?.dayOfMonth ?? 1,
    dayOfMonth2: plantilla?.dayOfMonth2 ?? 31,
    monthOfYear: plantilla?.monthOfYear ?? 1,
    weekday: plantilla?.weekday ?? 1,
  })
  const [startDate, setStartDate] = useState(plantilla?.startDate ?? todayISO())
  const [endDate, setEndDate] = useState(plantilla?.endDate ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const regla = reglaDesde(cadencia, startDate, endDate)

  // El mismo aviso de D8 que en las recurrencias de movimiento: una plantilla
  // propone **todo** desde su fecha de inicio, y el usuario tiene que saber
  // cuántas facturas se va a encontrar antes de guardar.
  const previa = useMemo(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return null
    const { lista, truncado } = ocurrencias(regla, { hasta: todayISO() })
    return { cuantas: lista.length, primera: lista[0]?.fecha ?? null, truncado }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cadencia, startDate, endDate])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const subtotalCents = parseAmount(subtotal)
    const taxCents = tax.trim() === '' ? 0 : parseAmount(tax)
    const retImpuesto = !conRetencion || retenidoImpuesto.trim() === '' ? 0 : parseAmount(retenidoImpuesto)
    const retRenta = !conRetencion || retenidoRenta.trim() === '' ? 0 : parseAmount(retenidoRenta)
    if (!counterpartyId) return setError('Elige la contraparte')
    if (!subtotalCents) return setError('Escribe un subtotal válido')
    if (taxCents === null) return setError('Ese impuesto no se entiende')
    if (retImpuesto === null || retRenta === null) return setError('Esa retención no se entiende')
    setSaving(true)
    setError(null)
    try {
      const datos = {
        profileId: profile.id,
        counterpartyId,
        direction,
        concept: concept.trim(),
        subtotalCents,
        taxCents,
        withheldTaxCents: retImpuesto,
        withheldIncomeCents: retRenta,
        costCenterId: costCenterId || null,
        creditDays: creditDays.trim() === '' ? null : Number(creditDays),
        ...regla,
        archived: plantilla?.archived ?? false,
      }
      if (plantilla) await api.facturas.recurrentes.update(plantilla.id, datos)
      else await api.facturas.recurrentes.create(datos)
      stamp(plantilla ? 'Actualizada' : 'Guardada')
      onSaved()
      onClose()
    } catch (err) {
      setError((err as Error).message)
      setSaving(false)
    }
  }

  return (
    <Modal title={plantilla ? 'Editar plantilla' : 'Factura que se repite'} onClose={onClose}>
      <form className="forma" onSubmit={submit}>
        <p className="forma-nota">
          Una plantilla <strong>no emite nada sola</strong>. Cada periodo que vence aparece arriba
          como propuesta y tú decides si esa factura sale. Emitirla tampoco mueve tu libro: el
          dinero entra cuando la cobres.
        </p>
        <div className="seg seg-chico" role="radiogroup" aria-label="Tipo de factura">
          {(['emitida', 'recibida'] as DireccionFactura[]).map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={direction === d}
              className={`seg-item${direction === d ? ' activa' : ''}`}
              onClick={() => setDirection(d)}
            >
              {d === 'emitida' ? 'Yo la emito' : 'Me la emiten'}
            </button>
          ))}
        </div>
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
            <span className="campo-label">Días de crédito</span>
            <input
              className="campo-input"
              inputMode="numeric"
              value={creditDays}
              onChange={(e) => setCreditDays(e.target.value)}
              placeholder="Sin fecha de pago"
            />
          </label>
        </div>
        <label className="campo">
          <span className="campo-label">Concepto</span>
          <input
            className="campo-input"
            value={concept}
            onChange={(e) => setConcept(e.target.value)}
            placeholder="Ej. Iguala mensual, renta del local"
          />
        </label>
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

        <label className="campo campo-casilla">
          <input type="checkbox" checked={conRetencion} onChange={(e) => setConRetencion(e.target.checked)} />
          <span className="campo-label">Me retienen parte</span>
        </label>
        {conRetencion && (
          <Retenciones
            retenidoImpuesto={retenidoImpuesto}
            retenidoRenta={retenidoRenta}
            onImpuesto={setRetenidoImpuesto}
            onRenta={setRetenidoRenta}
          />
        )}

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

        <Cadencia valores={cadencia} onChange={(c) => setCadencia((v) => ({ ...v, ...c }))} />

        <div className="campos-2">
          <label className="campo">
            <span className="campo-label">Desde</span>
            <input type="date" className="campo-input" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
          <label className="campo">
            <span className="campo-label">Hasta (opcional)</span>
            <input type="date" className="campo-input" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </label>
        </div>
        {previa && previa.cuantas > 0 && (
          <p className="forma-nota">
            Con esta fecha de inicio te van a esperar <strong>{previa.cuantas}</strong> factura(s)
            por emitir, desde {fmtDate(previa.primera!)}
            {previa.truncado && ' (y hay más de las que caben en una pasada)'}. Ninguna sale sin
            que tú la confirmes.
          </p>
        )}
        {error && <p className="forma-error" role="alert">{error}</p>}
        <footer className="forma-pie">
          <button type="button" className="btn btn-fantasma" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn-primario" disabled={saving}>
            {saving ? 'Guardando…' : 'Guardar plantilla'}
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
  const [cancelando, setCancelando] = useState<Factura | null>(null)
  const [anticipando, setAnticipando] = useState<Factura | null>(null)
  const [plantillaAbierta, setPlantillaAbierta] = useState<FacturaRecurrente | null>(null)
  const [creandoPlantilla, setCreandoPlantilla] = useState(false)
  const [verPlantillas, setVerPlantillas] = useState(false)

  const { data: facturas, error } = useFetch(
    () => api.facturas.list(profile.id),
    [profile.id, refreshKey],
  )
  const { data: aging } = useFetch(() => api.facturas.aging(profile.id), [profile.id, refreshKey])
  const { data: cobranza } = useFetch(
    () => api.facturas.cobranza(profile.id),
    [profile.id, refreshKey],
  )
  const { data: contrapartes } = useFetch(
    () => api.contrapartes.list(profile.id),
    [profile.id, refreshKey],
  )
  const { data: centros } = useFetch(() => api.centros.list(profile.id), [profile.id, refreshKey])
  const { data: plantillas } = useFetch(
    () => api.facturas.recurrentes.list(profile.id),
    [profile.id, refreshKey],
  )
  const { data: pendientes } = useFetch(
    () => api.facturas.recurrentes.pendientes(profile.id),
    [profile.id, refreshKey],
  )

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

  const emitir = async (p: PropuestaFactura) => {
    try {
      await api.facturas.recurrentes.emitir(profile.id, p.recurrenceId, { periodo: p.periodo })
      stamp('Emitida')
      bump()
    } catch (err) {
      alert((err as Error).message)
    }
  }

  const descartar = async (p: PropuestaFactura) => {
    try {
      await api.facturas.recurrentes.descartar(profile.id, p.recurrenceId, p.periodo)
      stamp('Descartada')
      bump()
    } catch (err) {
      alert((err as Error).message)
    }
  }

  const borrarPlantilla = async (p: FacturaRecurrente) => {
    try {
      const r = await api.facturas.recurrentes.remove(profile.id, p.id)
      stamp(r.emitidas > 0 ? `Borrada · ${r.emitidas} factura(s) se quedan` : 'Borrada')
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
            onClick={() => setCreandoPlantilla(true)}
          >
            ＋ Plantilla
          </button>
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

      {pendientes && pendientes.items.length > 0 && (
        <section className="hoja">
          <h2 className="hoja-titulo">
            Por emitir · {pendientes.total} {pendientes.total === 1 ? 'factura' : 'facturas'}
          </h2>
          <p className="reportes-nota">
            Periodos vencidos de tus plantillas. Ninguna existe todavía: Finply propone y tú
            decides. Emitirla tampoco mueve el libro — el dinero entra al cobrarla.
          </p>
          <table className="tabla">
            <tbody>
              {pendientes.items.map((p) => (
                <tr key={`${p.recurrenceId}-${p.periodo}`}>
                  <td>
                    <strong>{p.counterpartyName}</strong>
                    <div className="tabla-sub">
                      {p.concept || p.descripcion}
                      {p.atraso > 0 && ` · ${p.atraso} día(s) de atraso`}
                    </div>
                  </td>
                  <td className="cifra-chica">{fmtDate(p.fecha)}</td>
                  <td className="col-num"><Money cents={p.totalCents} className="cifra-chica" /></td>
                  <td className="col-acciones">
                    <button type="button" className="btn-liga" onClick={() => emitir(p)}>Emitir</button>
                    <button type="button" className="btn-liga" onClick={() => descartar(p)}>Descartar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
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

      {cobranza && cobranza.renglones.length > 0 && (
        <section className="hoja">
          <h2 className="hoja-titulo">A quién le hablas hoy</h2>
          <dl className="hero-stats">
            <div className="stat">
              <dt>Vencido</dt>
              <dd><Money cents={cobranza.vencidoCents} /></dd>
            </div>
            <div className="stat">
              <dt>Vence esta semana</dt>
              <dd><Money cents={cobranza.porVencerCents} /></dd>
            </div>
            <div className="stat stat-neto">
              <dt>Todo por cobrar</dt>
              <dd><Money cents={cobranza.totalCents} /></dd>
            </div>
          </dl>
          <table className="tabla cobranza">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Desde cuándo</th>
                <th className="col-num">Falta</th>
              </tr>
            </thead>
            <tbody>
              {cobranza.renglones.map((r) => (
                <tr key={r.facturaId} className={r.diasVencida > 0 ? 'cobranza-vencida' : ''}>
                  <td>
                    <strong>{r.counterpartyName}</strong>
                    <div className="tabla-sub">
                      {[r.folio && `Folio ${r.folio}`, r.concept, r.contact].filter(Boolean).join(' · ')}
                    </div>
                  </td>
                  <td className="cifra-chica">
                    {r.diasVencida > 0
                      ? `${r.diasVencida} día(s) vencida`
                      : r.dueDate
                        ? `vence el ${fmtDate(r.dueDate)}`
                        : 'sin fecha pactada'}
                  </td>
                  <td className="col-num"><Money cents={r.saldoCents} className="cifra-chica" /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="reportes-supuesto">
            Ordenada por antigüedad: primero lo más vencido, porque un saldo de hace noventa días no
            vale lo mismo que uno de ayer. Lo que ves es lo <strong>cobrable</strong> — ya sin lo
            retenido y sin lo que cancelaste con notas de crédito.
          </p>
        </section>
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
                const descuentos = [
                  f.retenidoCents > 0 && `retienen ${fmtMoney(f.retenidoCents)}`,
                  f.notasCreditoCents > 0 && `cancelado ${fmtMoney(f.notasCreditoCents)}`,
                ].filter(Boolean) as string[]
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
                      {descuentos.length > 0 && (
                        <div className="tabla-sub">
                          {descuentos.join(' · ')} → se cobran {fmtMoney(f.cobrableCents)}
                        </div>
                      )}
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
                    <td className="col-acciones facturas-acciones">
                      {f.saldoCents > 0 && f.status === 'abierta' && (
                        <>
                          <button type="button" className="btn-liga" onClick={() => setCobrando(f)}>
                            {f.direction === 'emitida' ? 'Cobrar' : 'Pagar'}
                          </button>
                          <button type="button" className="btn-liga" onClick={() => setAnticipando(f)}>
                            Anticipo
                          </button>
                          <button type="button" className="btn-liga" onClick={() => setCancelando(f)}>
                            Nota de crédito
                          </button>
                        </>
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

      {plantillas && plantillas.length > 0 && (
        <section className="hoja">
          <div className="hoja-head">
            <h2 className="hoja-titulo">Facturas que se repiten · {plantillas.length}</h2>
            <button type="button" className="btn-liga" onClick={() => setVerPlantillas((v) => !v)}>
              {verPlantillas ? 'Ocultar' : 'Ver'}
            </button>
          </div>
          {verPlantillas && (
            <table className="tabla">
              <tbody>
                {plantillas.map((p) => (
                  <tr key={p.id} className={p.archived ? 'fila-archivada' : ''}>
                    <td>
                      <strong>{p.counterpartyName}</strong>
                      <div className="tabla-sub">
                        {p.concept && `${p.concept} · `}
                        {p.descripcion}
                        {p.creditDays !== null && ` · vence a ${p.creditDays} días`}
                      </div>
                    </td>
                    <td className="cifra-chica">
                      {p.proximaFecha ? `sigue el ${fmtDate(p.proximaFecha)}` : 'sin fecha próxima'}
                    </td>
                    <td className="col-num"><Money cents={p.totalCents} className="cifra-chica" /></td>
                    <td className="col-acciones">
                      <button type="button" className="btn-liga" onClick={() => setPlantillaAbierta(p)}>
                        Editar
                      </button>
                      <button type="button" className="btn-liga btn-liga-rojo" onClick={() => borrarPlantilla(p)}>
                        Borrar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
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
      {cancelando && (
        <NotaCreditoModal factura={cancelando} onClose={() => setCancelando(null)} onSaved={bump} />
      )}
      {anticipando && (
        <AnticipoModal factura={anticipando} onClose={() => setAnticipando(null)} onSaved={bump} />
      )}
      {(creandoPlantilla || plantillaAbierta) && (
        <PlantillaModal
          plantilla={plantillaAbierta}
          contrapartes={vivas}
          centros={centros ?? []}
          dimensionLabel={profile.dimensionLabel}
          onClose={() => {
            setCreandoPlantilla(false)
            setPlantillaAbierta(null)
          }}
          onSaved={bump}
        />
      )}
    </div>
  )
}
