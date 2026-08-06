// Horas facturables: lo trabajado, y sobre todo lo trabajado **sin cobrar**.
//
// La vista está ordenada por esa pregunta. Arriba, cuánto trabajaste en el mes;
// enseguida, y en grande, lo que ya vale trabajo hecho que nadie te ha pagado
// —eso mira **todo** el historial, no el mes: una hora de hace medio año sin
// facturar sigue sin cobrarse—; y al final el detalle.
//
// Facturar **no asienta un peso** (D14): crea la factura y marca las horas. El
// ingreso nace cuando la cobres, en Facturas.

import { useState } from 'react'
import { api } from '../api.ts'
import { useApp } from '../context.ts'
import { useFetch } from '../hooks.ts'
import {
  currentMonth,
  fmtDate,
  fmtMoney,
  monthLabel,
  parseAmount,
  shiftMonth,
  todayISO,
} from '../format.ts'
import { horasTexto, parseHoras } from '../../shared/giro.ts'
import { Money } from '../components/Money.tsx'
import { Modal } from '../components/Modal.tsx'
import type { View } from '../components/Sidebar.tsx'
import type { CentroCosto, Contraparte, Hora, HorasPorCobrar } from '../../shared/types.ts'

/** El primer y el último día de un 'AAAA-MM'. */
function rangoDelMes(month: string): { desde: string; hasta: string } {
  const [anio, mes] = month.split('-').map(Number)
  const ultimo = new Date(Date.UTC(anio!, mes!, 0)).getUTCDate()
  return { desde: `${month}-01`, hasta: `${month}-${String(ultimo).padStart(2, '0')}` }
}

function HoraModal({
  hora,
  clientes,
  centros,
  onClose,
  onSaved,
}: {
  hora: Hora | null
  clientes: Contraparte[]
  centros: CentroCosto[]
  onClose: () => void
  onSaved: () => void
}) {
  const { profile, stamp } = useApp()
  const [date, setDate] = useState(hora?.date ?? todayISO())
  const [tiempo, setTiempo] = useState(hora ? horasTexto(hora.minutes) : '')
  const [rate, setRate] = useState(hora ? (hora.rateCents / 100).toFixed(2) : '')
  const [counterpartyId, setCounterpartyId] = useState(hora?.counterpartyId ?? 0)
  const [costCenterId, setCostCenterId] = useState(hora?.costCenterId ?? 0)
  const [note, setNote] = useState(hora?.note ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const minutos = parseHoras(tiempo)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (minutos === null || minutos <= 0) {
      return setError('Escribe el tiempo como 1:30, 1.5 o 90m')
    }
    const rateCents = rate.trim() === '' ? 0 : parseAmount(rate)
    if (rateCents === null) return setError('Esa tarifa no se entiende')
    setSaving(true)
    setError(null)
    try {
      const datos = {
        profileId: profile.id,
        date,
        minutes: minutos,
        rateCents,
        counterpartyId: counterpartyId || null,
        costCenterId: costCenterId || null,
        note: note.trim(),
      }
      if (hora) await api.horas.update(hora.id, datos)
      else await api.horas.create(datos)
      stamp(hora ? 'Actualizado' : 'Apuntado')
      onSaved()
      onClose()
    } catch (err) {
      setError((err as Error).message)
      setSaving(false)
    }
  }

  return (
    <Modal title={hora ? 'Corregir horas' : 'Apuntar horas'} onClose={onClose}>
      <form className="forma" onSubmit={submit}>
        <div className="campos-3">
          <label className="campo">
            <span className="campo-label">Cuándo</span>
            <input type="date" className="campo-input" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="campo">
            <span className="campo-label">Cuánto tiempo</span>
            <input
              className="campo-input"
              placeholder="1:30"
              value={tiempo}
              onChange={(e) => setTiempo(e.target.value)}
              autoFocus
            />
          </label>
          <label className="campo campo-monto">
            <span className="campo-label">Por hora</span>
            <div className="monto-wrap">
              <span className="monto-signo" aria-hidden="true">$</span>
              <input
                className="campo-input monto"
                inputMode="decimal"
                placeholder="0.00"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
              />
            </div>
          </label>
        </div>

        <p className="forma-nota">
          {minutos === null || minutos <= 0 ? (
            <>El tiempo se escribe como <strong>1:30</strong>, <strong>1.5</strong> o <strong>90m</strong>.</>
          ) : (
            <>
              Son <strong>{horasTexto(minutos)} horas</strong>
              {rate.trim() !== '' && parseAmount(rate) !== null && (
                <> · valen <strong>{fmtMoney(Math.round((minutos * parseAmount(rate)!) / 60))}</strong></>
              )}
              . La tarifa se guarda <strong>en este renglón</strong>: subirla mañana no reescribe
              el precio de lo que ya trabajaste.
            </>
          )}
        </p>

        <div className="campos-2">
          <label className="campo">
            <span className="campo-label">Para quién</span>
            <select className="campo-input" value={counterpartyId} onChange={(e) => setCounterpartyId(Number(e.target.value))}>
              <option value={0}>Sin cliente</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <label className="campo">
            <span className="campo-label">Centro</span>
            <select className="campo-input" value={costCenterId} onChange={(e) => setCostCenterId(Number(e.target.value))}>
              <option value={0}>Sin centro</option>
              {centros.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
        </div>

        <label className="campo">
          <span className="campo-label">En qué</span>
          <input
            className="campo-input"
            placeholder="Ej. Junta de arranque, ajustes al informe"
            maxLength={200}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>

        {counterpartyId === 0 && (
          <p className="forma-nota">
            Sin cliente el tiempo queda apuntado, pero <strong>no se puede facturar</strong>: una
            factura necesita a quién dirigirse.
          </p>
        )}
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

/**
 * Convierte en **una** factura todas las horas sin facturar de un cliente.
 *
 * La fecha de vencimiento se manda solo si el usuario la escribió: dejarla en
 * blanco hace que el servidor la calcule con los días de crédito del cliente,
 * que es lo que ya sabe de él.
 */
function FacturarModal({
  fila,
  onClose,
  onSaved,
}: {
  fila: HorasPorCobrar
  onClose: () => void
  onSaved: () => void
}) {
  const { profile, stamp } = useApp()
  const [issueDate, setIssueDate] = useState(todayISO())
  const [dueDate, setDueDate] = useState('')
  const [folio, setFolio] = useState('')
  const [concept, setConcept] = useState(
    `Servicios profesionales · ${horasTexto(fila.minutos)} horas`,
  )
  const [tax, setTax] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const taxCents = tax.trim() === '' ? 0 : parseAmount(tax)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (taxCents === null) return setError('Ese impuesto no se entiende')
    setSaving(true)
    setError(null)
    try {
      await api.horas.facturar(profile.id, {
        counterpartyId: fila.counterpartyId!,
        issueDate,
        // Ausente ≠ vacío: sin fecha, manda el crédito pactado con el cliente.
        ...(dueDate ? { dueDate } : {}),
        folio: folio.trim(),
        concept: concept.trim(),
        taxCents,
      })
      stamp('Facturado')
      onSaved()
      onClose()
    } catch (err) {
      setError((err as Error).message)
      setSaving(false)
    }
  }

  return (
    <Modal title={`Facturar a ${fila.counterpartyName}`} onClose={onClose}>
      <form className="forma" onSubmit={submit}>
        <p className="forma-nota">
          Van <strong>{fila.entradas} renglones</strong> —{horasTexto(fila.minutos)} horas del{' '}
          {fmtDate(fila.desde)} al {fmtDate(fila.hasta)}— en una sola factura por{' '}
          <strong>{fmtMoney(fila.importeCents)}</strong> más impuesto. Emitirla{' '}
          <strong>no asienta un peso</strong>: el ingreso nace cuando la cobres.
        </p>

        <div className="campos-2">
          <label className="campo">
            <span className="campo-label">Fecha</span>
            <input type="date" className="campo-input" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
          </label>
          <label className="campo">
            <span className="campo-label">Vence (opcional)</span>
            <input type="date" className="campo-input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </label>
        </div>

        <div className="campos-2">
          <label className="campo">
            <span className="campo-label">Folio</span>
            <input className="campo-input" maxLength={40} value={folio} onChange={(e) => setFolio(e.target.value)} />
          </label>
          <label className="campo campo-monto">
            <span className="campo-label">Impuesto</span>
            <div className="monto-wrap">
              <span className="monto-signo" aria-hidden="true">$</span>
              <input
                className="campo-input monto"
                inputMode="decimal"
                placeholder="0.00"
                value={tax}
                onChange={(e) => setTax(e.target.value)}
              />
            </div>
          </label>
        </div>

        <label className="campo">
          <span className="campo-label">Concepto</span>
          <input className="campo-input" maxLength={200} value={concept} onChange={(e) => setConcept(e.target.value)} />
        </label>

        <p className="forma-nota">
          El impuesto se escribe en monto, no en porcentaje: Finply no conoce el de tu país
          (R15). {taxCents !== null && taxCents > 0 && (
            <>La factura quedará en <strong>{fmtMoney(fila.importeCents + taxCents)}</strong>.</>
          )}
        </p>

        {error && <p className="forma-error" role="alert">{error}</p>}
        <footer className="forma-pie">
          <button type="button" className="btn btn-fantasma" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn-primario" disabled={saving}>
            {saving ? 'Emitiendo…' : 'Emitir factura'}
          </button>
        </footer>
      </form>
    </Modal>
  )
}

export function Horas({ onNav }: { onNav: (view: View) => void }) {
  const { profile, refreshKey, bump, stamp } = useApp()
  const [month, setMonth] = useState(currentMonth())
  const [editando, setEditando] = useState<Hora | null | undefined>(undefined)
  const [facturando, setFacturando] = useState<HorasPorCobrar | null>(null)
  const [borrando, setBorrando] = useState<number | null>(null)

  const { desde, hasta } = rangoDelMes(month)
  const { data: resumen, error } = useFetch(
    () => api.horas.resumen(profile.id, desde, hasta),
    [profile.id, desde, hasta, refreshKey],
  )
  const { data: horas } = useFetch(
    () => api.horas.list({ profileId: profile.id, desde, hasta }),
    [profile.id, desde, hasta, refreshKey],
  )
  const { data: clientes } = useFetch(() => api.contrapartes.list(profile.id), [profile.id, refreshKey])
  const { data: centros } = useFetch(() => api.centros.list(profile.id), [profile.id, refreshKey])

  const lista = horas ?? []
  const porCobrar = resumen?.porCobrar ?? []

  const borrar = async (h: Hora) => {
    try {
      await api.horas.remove(profile.id, h.id)
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
        <h1>Horas</h1>
        <div className="vista-head-acciones">
          <div className="mes-nav">
            <button type="button" className="mes-flecha" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Mes anterior">‹</button>
            <span className="vista-mes">{monthLabel(month)}</span>
            <button type="button" className="mes-flecha" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Mes siguiente">›</button>
          </div>
          <button type="button" className="btn btn-primario btn-chico" onClick={() => setEditando(null)}>
            ＋ Apuntar horas
          </button>
        </div>
      </header>

      {error && <p className="aviso" role="alert">{error}</p>}

      {resumen && lista.length === 0 && porCobrar.length === 0 ? (
        <div className="vacio">
          <p className="vacio-titulo">Ninguna hora apuntada.</p>
          <p className="vacio-sub">
            Apunta el tiempo con su tarifa y Finply te dirá cuánto llevas trabajado sin cobrar —y
            lo convertirá en factura cuando se lo pidas.
          </p>
          <button type="button" className="btn btn-primario" onClick={() => setEditando(null)}>
            Apuntar las primeras horas
          </button>
        </div>
      ) : (
        <>
          {resumen && (
            <div className="stats stats-auto">
              <div className="stat">
                <span className="stat-label">Trabajado en {monthLabel(month)}</span>
                <span className="stat-valor">{horasTexto(resumen.minutosTotal)} h</span>
              </div>
              <div className="stat">
                <span className="stat-label">Lo que vale</span>
                <span className="stat-valor"><Money cents={resumen.importeTotalCents} /></span>
              </div>
              <div className="stat">
                <span className="stat-label">Sin facturar, de siempre</span>
                <span className="stat-valor stat-in">
                  <Money cents={porCobrar.reduce((s, c) => s + c.importeCents, 0)} />
                </span>
              </div>
              {resumen.tarifaMediaCents !== null && (
                <div className="stat">
                  <span className="stat-label">Tarifa media del mes</span>
                  <span className="stat-valor"><Money cents={resumen.tarifaMediaCents} /> /h</span>
                </div>
              )}
            </div>
          )}

          {porCobrar.length > 0 && (
            <section className="hoja">
              <h2 className="hoja-titulo">Trabajo hecho que nadie te ha pagado</h2>
              <table className="tabla">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th className="col-num">Horas</th>
                    <th className="col-num">Importe</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {porCobrar.map((c) => (
                    <tr key={c.counterpartyId ?? 'sin'}>
                      <td>
                        {c.counterpartyName}
                        <div className="tabla-sub">
                          {c.entradas} renglones · del {fmtDate(c.desde)} al {fmtDate(c.hasta)}
                        </div>
                      </td>
                      <td className="col-num">{horasTexto(c.minutos)}</td>
                      <td className="col-num"><Money cents={c.importeCents} /></td>
                      <td className="col-num">
                        {c.counterpartyId === null ? (
                          <span className="tabla-sub">Sin cliente no hay a quién facturarle</span>
                        ) : c.importeCents <= 0 ? (
                          <span className="tabla-sub">Ponles tarifa antes de facturar</span>
                        ) : (
                          <button type="button" className="btn-liga" onClick={() => setFacturando(c)}>
                            Facturar
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="reportes-nota">
                Esto mira <strong>todo tu historial</strong>, no el mes: una hora de hace medio año
                sin facturar sigue sin cobrarse. Emitir la factura{' '}
                <strong>no mueve tu libro</strong> — el ingreso nace cuando la cobres, en{' '}
                <button type="button" className="btn-liga" onClick={() => onNav('facturas')}>
                  Facturas
                </button>
                .
              </p>
            </section>
          )}

          {lista.length > 0 && (
            <section className="hoja">
              <h2 className="hoja-titulo">Lo que apuntaste en {monthLabel(month)}</h2>
              <table className="tabla">
                <thead>
                  <tr>
                    <th>Día</th>
                    <th>En qué</th>
                    <th className="col-num">Horas</th>
                    <th className="col-num">Por hora</th>
                    <th className="col-num">Importe</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {lista.map((h) => (
                    <tr key={h.id}>
                      <td>{fmtDate(h.date)}</td>
                      <td>
                        {h.note || <span className="tabla-sub">Sin nota</span>}
                        <div className="tabla-sub">
                          {h.counterpartyName ?? 'Sin cliente'}
                          {h.costCenterName && ` · ${h.costCenterName}`}
                          {h.invoiceId !== null && ` · facturado ${h.invoiceFolio || ''}`.trimEnd()}
                        </div>
                      </td>
                      <td className="col-num">{horasTexto(h.minutes)}</td>
                      <td className="col-num"><Money cents={h.rateCents} /></td>
                      <td className="col-num"><Money cents={h.importeCents} /></td>
                      <td className="col-num">
                        {h.invoiceId !== null ? (
                          <span className="chip">Facturado</span>
                        ) : borrando === h.id ? (
                          <span className="giro-acciones">
                            <button type="button" className="btn-liga btn-liga-rojo" onClick={() => void borrar(h)}>Borrar</button>
                            <button type="button" className="btn-liga" onClick={() => setBorrando(null)}>No</button>
                          </span>
                        ) : (
                          <span className="giro-acciones">
                            <button type="button" className="accion" onClick={() => setEditando(h)} aria-label="Corregir">✎</button>
                            <button type="button" className="accion" onClick={() => setBorrando(h.id)} aria-label="Borrar">✕</button>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          <p className="reportes-supuesto">
            Las horas <strong>no son dinero todavía</strong>: no aparecen en tu ingreso ni en tu
            patrimonio, y apuntarlas no mueve una cuenta. Se vuelven una factura cuando lo pides, y
            dinero cuando la cobras. La tarifa vive en cada renglón, así que subirla no reescribe
            lo que trabajaste antes.
          </p>
        </>
      )}

      {editando !== undefined && (
        <HoraModal
          hora={editando}
          clientes={(clientes ?? []).filter((c) => !c.archived)}
          centros={(centros ?? []).filter((c) => !c.archived)}
          onClose={() => setEditando(undefined)}
          onSaved={bump}
        />
      )}
      {facturando && (
        <FacturarModal fila={facturando} onClose={() => setFacturando(null)} onSaved={bump} />
      )}
    </div>
  )
}
