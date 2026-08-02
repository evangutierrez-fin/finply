import { useEffect, useState } from 'react'
import { api } from '../api.ts'
import { useApp } from '../context.ts'
import { useFetch } from '../hooks.ts'
import { fmtDate, fmtMoney, fmtTasa, parseAmount, todayISO } from '../format.ts'
import { Money } from '../components/Money.tsx'
import { Modal } from '../components/Modal.tsx'
import { sumarDias } from '../../shared/fechas.ts'
import type {
  CentroCosto,
  Contraparte,
  Cotizacion,
  DireccionFactura,
  ResumenCotizaciones,
} from '../../shared/types.ts'

const DIRECCIONES: { id: DireccionFactura; label: string; que: string }[] = [
  { id: 'emitida', label: 'Cotizaciones', que: 'Lo que le prometiste a un cliente y estás esperando' },
  { id: 'recibida', label: 'Órdenes de compra', que: 'Lo que le encargaste a un proveedor y todavía no te factura' },
]

const ESTADOS: { id: 'todas' | 'enviada' | 'aceptada' | 'perdida'; label: string }[] = [
  { id: 'todas', label: 'Todas' },
  { id: 'enviada', label: 'Esperando' },
  { id: 'aceptada', label: 'Aceptadas' },
  { id: 'perdida', label: 'Perdidas' },
]

/** Vigencia por omisión de una cotización nueva: dos semanas. */
const DIAS_VIGENCIA = 14

function CotizacionModal({
  cotizacion,
  direction,
  contrapartes,
  centros,
  dimension,
  onClose,
  onSaved,
}: {
  cotizacion: Cotizacion | null
  direction: DireccionFactura
  contrapartes: Contraparte[]
  centros: CentroCosto[]
  dimension: string
  onClose: () => void
  onSaved: () => void
}) {
  const { profile } = useApp()
  const [counterpartyId, setCounterpartyId] = useState(
    cotizacion ? String(cotizacion.counterpartyId) : '',
  )
  const [folio, setFolio] = useState(cotizacion?.folio ?? '')
  const [concept, setConcept] = useState(cotizacion?.concept ?? '')
  const [issueDate, setIssueDate] = useState(cotizacion?.issueDate ?? todayISO())
  const [validUntil, setValidUntil] = useState(
    cotizacion?.validUntil ?? sumarDias(todayISO(), DIAS_VIGENCIA),
  )
  const [subtotal, setSubtotal] = useState(
    cotizacion ? String(cotizacion.subtotalCents / 100) : '',
  )
  const [impuesto, setImpuesto] = useState(cotizacion ? String(cotizacion.taxCents / 100) : '')
  const [costCenterId, setCostCenterId] = useState(
    cotizacion?.costCenterId ? String(cotizacion.costCenterId) : '',
  )
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const subtotalCents = parseAmount(subtotal) ?? 0
  const taxCents = impuesto.trim() === '' ? 0 : (parseAmount(impuesto) ?? 0)

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    if (!counterpartyId) return setError('Falta a quién va')
    if (subtotalCents <= 0) return setError('El subtotal debe ser mayor a cero')
    setSaving(true)
    setError(null)
    const datos = {
      profileId: profile.id,
      counterpartyId: Number(counterpartyId),
      direction,
      folio: folio.trim(),
      concept: concept.trim(),
      issueDate,
      // Ausente ≠ vacío: sin vigencia, la cotización no caduca y nunca avisa.
      validUntil: validUntil || null,
      subtotalCents,
      taxCents,
      costCenterId: costCenterId ? Number(costCenterId) : null,
    }
    try {
      if (cotizacion) await api.cotizaciones.update(cotizacion.id, datos)
      else await api.cotizaciones.create(datos)
      onSaved()
      onClose()
    } catch (err) {
      setError((err as Error).message)
      setSaving(false)
    }
  }

  const es = direction === 'emitida'
  return (
    <Modal
      title={cotizacion ? 'Editar' : es ? 'Nueva cotización' : 'Nueva orden de compra'}
      onClose={onClose}
    >
      <form className="forma" onSubmit={guardar}>
        <div className="campos-2">
          <label className="campo">
            <span className="campo-label">{es ? 'Para el cliente' : 'Al proveedor'}</span>
            <select
              className="campo-input"
              value={counterpartyId}
              onChange={(e) => setCounterpartyId(e.target.value)}
            >
              <option value="">Elige…</option>
              {contrapartes.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <label className="campo">
            <span className="campo-label">Folio</span>
            <input
              className="campo-input"
              value={folio}
              onChange={(e) => setFolio(e.target.value)}
              placeholder="COT-001"
            />
          </label>
        </div>
        <label className="campo">
          <span className="campo-label">Concepto</span>
          <input
            className="campo-input"
            value={concept}
            onChange={(e) => setConcept(e.target.value)}
            placeholder="Rediseño del sitio"
          />
        </label>
        <div className="campos-2">
          <label className="campo">
            <span className="campo-label">Fecha</span>
            <input
              className="campo-input"
              type="date"
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
            />
          </label>
          <label className="campo">
            <span className="campo-label">Vale hasta</span>
            <input
              className="campo-input"
              type="date"
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
            />
            <span className="campo-nota">Vacío: no caduca y no te avisa</span>
          </label>
        </div>
        <div className="campos-2">
          <label className="campo">
            <span className="campo-label">Subtotal</span>
            <div className="monto-wrap">
              <span className="monto-signo" aria-hidden="true">$</span>
              <input
                className="campo-input"
                inputMode="decimal"
                value={subtotal}
                onChange={(e) => setSubtotal(e.target.value)}
                placeholder="0.00"
              />
            </div>
          </label>
          <label className="campo">
            <span className="campo-label">Impuesto</span>
            <div className="monto-wrap">
              <span className="monto-signo" aria-hidden="true">$</span>
              <input
                className="campo-input"
                inputMode="decimal"
                value={impuesto}
                onChange={(e) => setImpuesto(e.target.value)}
                placeholder="0.00"
              />
            </div>
          </label>
        </div>
        {centros.length > 0 && (
          <label className="campo">
            <span className="campo-label">{dimension}</span>
            <select
              className="campo-input"
              value={costCenterId}
              onChange={(e) => setCostCenterId(e.target.value)}
            >
              <option value="">Sin asignar</option>
              {centros.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
        )}
        <p className="forma-nota">
          Total <strong className="cifra-chica">{fmtMoney(subtotalCents + taxCents)}</strong>. Esto
          no mueve tu libro: es una promesa de precio, no un cobro. El dinero nace cuando cobres la
          factura que salga de aquí.
        </p>
        {error && <p className="aviso" role="alert">{error}</p>}
        <div className="modal-acciones">
          <button type="button" className="btn btn-fantasma" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn-primario" disabled={saving}>
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

/**
 * Convertirla en factura. Es el único acto de esta sección que escribe en otra
 * tabla, y aun así no mueve dinero: crea el documento, no el cobro (D14).
 */
function FacturarModal({
  cotizacion,
  onClose,
  onSaved,
}: {
  cotizacion: Cotizacion
  onClose: () => void
  onSaved: () => void
}) {
  const { profile } = useApp()
  const [folio, setFolio] = useState('')
  const [issueDate, setIssueDate] = useState(todayISO())
  const [dueDate, setDueDate] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function convertir(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await api.cotizaciones.facturar(cotizacion.id, profile.id, {
        folio: folio.trim(),
        issueDate,
        // Ausente ≠ vacío: sin fecha manda el crédito pactado con la contraparte.
        ...(dueDate ? { dueDate } : {}),
      })
      onSaved()
      onClose()
    } catch (err) {
      setError((err as Error).message)
      setSaving(false)
    }
  }

  return (
    <Modal title={`Facturar · ${cotizacion.counterpartyName}`} onClose={onClose}>
      <form className="forma" onSubmit={convertir}>
        <p className="ajustes-texto">
          Se crea la factura con lo que ya dice esta cotización:{' '}
          <strong className="cifra-chica">{fmtMoney(cotizacion.totalCents)}</strong>
          {cotizacion.concept && <> por {cotizacion.concept}</>}. La cotización queda marcada como
          aceptada y ligada a su factura.
        </p>
        <div className="campos-2">
          <label className="campo">
            <span className="campo-label">Folio de la factura</span>
            <input
              className="campo-input"
              value={folio}
              onChange={(e) => setFolio(e.target.value)}
              placeholder="A-1042"
            />
          </label>
          <label className="campo">
            <span className="campo-label">Fecha</span>
            <input
              className="campo-input"
              type="date"
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
            />
          </label>
        </div>
        <label className="campo">
          <span className="campo-label">Vence</span>
          <input
            className="campo-input"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
          <span className="campo-nota">Vacío: manda el crédito pactado con la contraparte</span>
        </label>
        {error && <p className="aviso" role="alert">{error}</p>}
        <div className="modal-acciones">
          <button type="button" className="btn btn-fantasma" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn-primario" disabled={saving}>
            {saving ? 'Creando…' : 'Crear la factura'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function Tira({ resumen, direction }: { resumen: ResumenCotizaciones; direction: DireccionFactura }) {
  const es = direction === 'emitida'
  return (
    <dl className="stats stats-auto">
      <div className="stat">
        <dt>{es ? 'Esperando respuesta' : 'Comprometido'}</dt>
        <dd><Money cents={resumen.esperandoCents} /></dd>
        <span className="stat-pie">{resumen.esperando} sin contestar</span>
      </div>
      <div className="stat">
        <dt>De eso, ya vencido</dt>
        <dd>
          <span className={resumen.vencidoCents > 0 ? 'cifra-neg' : ''}>
            <Money cents={resumen.vencidoCents} />
          </span>
        </dd>
        <span className="stat-pie">{resumen.vencidas} pasadas de vigencia</span>
      </div>
      <div className="stat">
        <dt>{es ? 'Ganado' : 'Ya facturado'}</dt>
        <dd><Money cents={resumen.aceptadoCents} /></dd>
        <span className="stat-pie">{resumen.aceptadas} aceptadas</span>
      </div>
      <div className="stat stat-neto">
        <dt>{es ? 'De lo contestado, ganas' : 'Se concretan'}</dt>
        <dd className="cifra">
          {resumen.tasaExitoBp === null ? 'Sin contestar aún' : fmtTasa(resumen.tasaExitoBp)}
        </dd>
        <span className="stat-pie">
          {resumen.tasaExitoBp === null
            ? 'nadie ha respondido todavía'
            : `${resumen.aceptadas} de ${resumen.aceptadas + resumen.perdidas} contestadas`}
        </span>
      </div>
    </dl>
  )
}

export function Cotizaciones() {
  const { profile, bump, refreshKey } = useApp()
  const [direction, setDirection] = useState<DireccionFactura>('emitida')
  const [estado, setEstado] = useState<'todas' | 'enviada' | 'aceptada' | 'perdida'>('todas')
  const [editando, setEditando] = useState<Cotizacion | null>(null)
  const [nueva, setNueva] = useState(false)
  const [facturando, setFacturando] = useState<Cotizacion | null>(null)
  const [contrapartes, setContrapartes] = useState<Contraparte[]>([])
  const [centros, setCentros] = useState<CentroCosto[]>([])
  const [aviso, setAviso] = useState<string | null>(null)

  const { data, error } = useFetch(
    () =>
      api.cotizaciones.list(profile.id, {
        direction,
        ...(estado === 'todas' ? {} : { status: estado }),
      }),
    [profile.id, direction, estado, refreshKey],
  )
  const { data: resumen } = useFetch(
    () => api.cotizaciones.resumen(profile.id),
    [profile.id, refreshKey],
  )

  useEffect(() => {
    api.contrapartes.list(profile.id).then((cs) => setContrapartes(cs.filter((c) => !c.archived)))
    api.centros.list(profile.id).then((cs) => setCentros(cs.filter((c) => !c.archived)))
  }, [profile.id, refreshKey])

  async function cambiarEstado(c: Cotizacion, status: 'enviada' | 'perdida') {
    await api.cotizaciones.estado(c.id, profile.id, status)
    bump()
  }

  async function borrar(c: Cotizacion) {
    const r = await api.cotizaciones.remove(c.id, profile.id)
    if (r.facturaViva) {
      setAviso('Se borró la cotización. Su factura sigue en el libro: ese documento ya existe por su cuenta.')
    }
    bump()
  }

  const activa = DIRECCIONES.find((d) => d.id === direction)!

  return (
    <div className="vista">
      <header className="vista-head">
        <h1>Cotizaciones</h1>
        <button type="button" className="btn btn-primario" onClick={() => setNueva(true)}>
          {direction === 'emitida' ? '+ Cotización' : '+ Orden de compra'}
        </button>
      </header>

      <div className="seg" role="radiogroup" aria-label="Qué documentos">
        {DIRECCIONES.map((d) => (
          <button
            key={d.id}
            type="button"
            role="radio"
            aria-checked={direction === d.id}
            className={`seg-item${direction === d.id ? ' activa' : ''}`}
            onClick={() => setDirection(d.id)}
          >
            {d.label}
          </button>
        ))}
      </div>

      <section className="hoja">
        <h2 className="hoja-titulo">{activa.que}</h2>
        {resumen && <Tira resumen={resumen[direction]} direction={direction} />}
        <p className="reportes-supuesto">
          Una cotización no mueve tu libro: es el documento que va <strong>antes</strong> de la
          factura, y el dinero sigue naciendo cuando cobras. Lo que contesta esta pantalla es cuánto
          tienes en la calle esperando respuesta — que es con lo que se decide si puedes
          comprometerte a algo más.
        </p>
      </section>

      {aviso && (
        <p className="aviso" role="status">
          {aviso}{' '}
          <button type="button" className="btn-liga" onClick={() => setAviso(null)}>Entendido</button>
        </p>
      )}

      <div className="seg seg-chico" role="radiogroup" aria-label="Estado">
        {ESTADOS.map((e) => (
          <button
            key={e.id}
            type="button"
            role="radio"
            aria-checked={estado === e.id}
            className={`seg-item${estado === e.id ? ' activa' : ''}`}
            onClick={() => setEstado(e.id)}
          >
            {e.label}
          </button>
        ))}
      </div>

      {error && <p className="aviso" role="alert">{error}</p>}
      {!data && !error && <p className="cargando">Cargando…</p>}

      {data && data.length === 0 && (
        <p className="vacio">
          Nada aquí todavía. {direction === 'emitida'
            ? 'Una cotización es lo que le prometes a un cliente antes de facturarle.'
            : 'Una orden de compra es lo que le encargas a un proveedor antes de que te facture.'}
        </p>
      )}

      {data && data.length > 0 && (
        <section className="hoja">
          <table className="tabla">
            <thead>
              <tr>
                <th scope="col">Fecha</th>
                <th scope="col">{direction === 'emitida' ? 'Cliente' : 'Proveedor'}</th>
                <th scope="col">Concepto</th>
                <th scope="col">Vale hasta</th>
                <th scope="col" className="col-num">Total</th>
                <th scope="col">Estado</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id} className={c.vencida ? 'fila-vencida' : undefined}>
                  <td className="cifra-chica">{fmtDate(c.issueDate)}</td>
                  <td>
                    {c.counterpartyName}
                    {c.folio && <span className="tabla-sub">{c.folio}</span>}
                  </td>
                  <td>{c.concept || '—'}</td>
                  <td className="cifra-chica">
                    {c.validUntil ? fmtDate(c.validUntil) : 'sin vigencia'}
                  </td>
                  <td className="col-num"><Money cents={c.totalCents} /></td>
                  <td>
                    {c.status === 'aceptada' ? (
                      <span className="chip chip-acento">
                        Aceptada{c.invoiceFolio ? ` · ${c.invoiceFolio}` : ''}
                      </span>
                    ) : c.status === 'perdida' ? (
                      <span className="chip">Perdida</span>
                    ) : c.vencida ? (
                      <span className="chip chip-rojo">Vencida</span>
                    ) : (
                      <span className="chip">Esperando</span>
                    )}
                  </td>
                  <td className="giro-acciones">
                    {c.status !== 'aceptada' && (
                      <>
                        <button
                          type="button"
                          className="btn-liga"
                          onClick={() => setFacturando(c)}
                        >
                          Facturar
                        </button>
                        <button type="button" className="btn-liga" onClick={() => setEditando(c)}>
                          Editar
                        </button>
                        <button
                          type="button"
                          className="btn-liga"
                          onClick={() => cambiarEstado(c, c.status === 'perdida' ? 'enviada' : 'perdida')}
                        >
                          {c.status === 'perdida' ? 'Revivir' : 'Perdida'}
                        </button>
                      </>
                    )}
                    <button type="button" className="btn-liga btn-liga-rojo" onClick={() => borrar(c)}>
                      Borrar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {(nueva || editando) && (
        <CotizacionModal
          cotizacion={editando}
          direction={editando?.direction ?? direction}
          contrapartes={contrapartes}
          centros={centros}
          dimension={profile.dimensionLabel}
          onClose={() => {
            setNueva(false)
            setEditando(null)
          }}
          onSaved={bump}
        />
      )}

      {facturando && (
        <FacturarModal
          cotizacion={facturando}
          onClose={() => setFacturando(null)}
          onSaved={bump}
        />
      )}
    </div>
  )
}
