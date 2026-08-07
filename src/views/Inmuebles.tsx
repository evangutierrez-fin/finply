import { useState } from 'react'
import { api } from '../api.ts'
import { useApp } from '../context.ts'
import { useFetch } from '../hooks.ts'
import { fmtDate, fmtMoney, fmtTasa, parseAmount, todayISO } from '../format.ts'
import { Money } from '../components/Money.tsx'
import { Modal } from '../components/Modal.tsx'
import type { View } from '../components/Sidebar.tsx'
import type { Arrendamiento, Bien } from '../../shared/types.ts'

const DIAS_MES = Array.from({ length: 31 }, (_, i) => ({
  id: i + 1,
  label: i + 1 === 31 ? 'el último día' : String(i + 1),
}))

function ArrendamientoModal({
  arrendamiento,
  bienes,
  onClose,
  onSaved,
}: {
  arrendamiento: Arrendamiento | null
  bienes: Bien[]
  onClose: () => void
  onSaved: () => void
}) {
  const { profile, stamp } = useApp()
  const [assetId, setAssetId] = useState(arrendamiento?.assetId ?? bienes[0]?.id ?? 0)
  const [tenant, setTenant] = useState(arrendamiento?.tenant ?? '')
  const [rent, setRent] = useState(arrendamiento ? (arrendamiento.rentCents / 100).toFixed(2) : '')
  const [deposit, setDeposit] = useState(
    arrendamiento ? (arrendamiento.depositCents / 100).toFixed(2) : '',
  )
  const [paymentDay, setPaymentDay] = useState(arrendamiento?.paymentDay ?? 1)
  const [startDate, setStartDate] = useState(arrendamiento?.startDate ?? todayISO())
  const [endDate, setEndDate] = useState(arrendamiento?.endDate ?? '')
  const [note, setNote] = useState(arrendamiento?.note ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!assetId) return setError('Elige el bien que se renta')
    const rentCents = rent.trim() === '' ? 0 : parseAmount(rent)
    const depositCents = deposit.trim() === '' ? 0 : parseAmount(deposit)
    if (rentCents === null) return setError('Esa renta no se entiende')
    if (depositCents === null) return setError('Ese depósito no se entiende')
    setSaving(true)
    setError(null)
    try {
      const datos = {
        profileId: profile.id,
        assetId,
        tenant: tenant.trim(),
        rentCents,
        depositCents,
        paymentDay,
        startDate,
        endDate: endDate || null,
        note: note.trim(),
        archived: arrendamiento?.archived ?? false,
      }
      if (arrendamiento) await api.inmuebles.update(arrendamiento.id, datos)
      else await api.inmuebles.create(datos)
      stamp(arrendamiento ? 'Actualizado' : 'Guardado')
      onSaved()
      onClose()
    } catch (err) {
      setError((err as Error).message)
      setSaving(false)
    }
  }

  return (
    <Modal title={arrendamiento ? 'Editar arrendamiento' : 'Rentar un bien'} onClose={onClose}>
      <form className="forma" onSubmit={submit}>
        <p className="forma-nota">
          El inmueble ya vive en <strong>Bienes</strong>, con lo que costó y lo que vale hoy: esto
          es su contrato. Guardarlo <strong>no mueve tu libro</strong> — la renta entra cuando la
          registres, desde aquí.
        </p>
        <label className="campo">
          <span className="campo-label">Qué se renta</span>
          <select className="campo-input" value={assetId} onChange={(e) => setAssetId(Number(e.target.value))}>
            <option value={0}>Elige…</option>
            {bienes.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </label>
        <label className="campo">
          <span className="campo-label">Inquilino</span>
          <input
            className="campo-input"
            value={tenant}
            onChange={(e) => setTenant(e.target.value)}
            placeholder="Quién lo renta"
          />
        </label>
        <div className="campos-3">
          <label className="campo">
            <span className="campo-label">Renta mensual</span>
            <div className="monto-wrap">
              <span className="monto-signo" aria-hidden="true">$</span>
              <input className="campo-input" inputMode="decimal" value={rent} onChange={(e) => setRent(e.target.value)} placeholder="0.00" />
            </div>
          </label>
          <label className="campo">
            <span className="campo-label">Depósito</span>
            <div className="monto-wrap">
              <span className="monto-signo" aria-hidden="true">$</span>
              <input className="campo-input" inputMode="decimal" value={deposit} onChange={(e) => setDeposit(e.target.value)} placeholder="0.00" />
            </div>
          </label>
          <label className="campo">
            <span className="campo-label">Cobra el día</span>
            <select className="campo-input" value={paymentDay} onChange={(e) => setPaymentDay(Number(e.target.value))}>
              {DIAS_MES.map((d) => (
                <option key={d.id} value={d.id}>{d.label}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="campos-2">
          <label className="campo">
            <span className="campo-label">Empieza</span>
            <input type="date" className="campo-input" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
          <label className="campo">
            <span className="campo-label">Termina (opcional)</span>
            <input type="date" className="campo-input" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </label>
        </div>
        <label className="campo">
          <span className="campo-label">Nota</span>
          <input className="campo-input" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <p className="forma-nota">
          El <strong>depósito no es un ingreso</strong>: lo tienes en la cuenta y lo debes. Cuando
          lo registres, márcalo como depósito y Finply lo deja fuera de tu ingreso del mes y del
          rendimiento — pero sí en el saldo de tu cuenta, porque el dinero ahí está.
        </p>
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

function Carta({
  r,
  onEditar,
  onBorrar,
  index,
}: {
  r: Arrendamiento
  onEditar: () => void
  onBorrar: () => void
  index: number
}) {
  const tasa = r.rendimiento.tasaAnualBp
  return (
    <article className="hoja renta-carta" style={{ animationDelay: `${index * 60}ms` }}>
      <header className="tarjeta-head">
        <h2>{r.assetName}</h2>
        <span className="renta-acciones">
          <button type="button" className="btn-liga" onClick={onEditar}>Editar</button>
          <button type="button" className="btn-liga btn-liga-rojo" onClick={onBorrar}>Borrar</button>
        </span>
      </header>
      <p className="renta-sub">
        {r.tenant || 'Sin inquilino apuntado'} · <Money cents={r.rentCents} className="cifra-chica" /> al
        mes, el día {r.paymentDay === 31 ? 'último' : r.paymentDay}
        {r.endDate && <> · hasta el {fmtDate(r.endDate)}</>}
      </p>

      <dl className="renta-cifras">
        <div>
          {/* El rótulo dice la ventana **de este contrato**, no la de la
              consulta: uno firmado hace dos meses lleva dos, y llamarle "12
              meses" a lo que cobró en dos vuelve ilegible la cifra de al lado. */}
          <dt>Cobrado en {r.meses === 1 ? 'el mes' : `${r.meses} meses`}</dt>
          <dd><Money cents={r.cobradoCents} /></dd>
        </div>
        <div>
          <dt>Mantenimiento</dt>
          <dd><Money cents={r.gastoCents} /></dd>
        </div>
        <div>
          <dt>Te dejó</dt>
          <dd className={r.rendimiento.netoCents >= 0 ? 'stat-in' : 'stat-rojo'}>
            <Money cents={r.rendimiento.netoCents} signed />
          </dd>
        </div>
      </dl>

      {tasa === null ? (
        <p className="reportes-nota">
          Ponle un valor al bien en <strong>Bienes</strong> —lo que costó o lo que declaraste que
          vale hoy— y esto te dirá qué tasa te está dejando.
        </p>
      ) : (
        <p className="reportes-nota">
          {r.meses < 12 && (
            <>
              Llevando ese ritmo de {r.meses === 1 ? 'un mes' : `${r.meses} meses`} a un año son{' '}
              <Money cents={r.rendimiento.anualizadoCents} signed className="cifra-chica" />.{' '}
            </>
          )}
          Eso es <strong className="cifra-chica">{fmtTasa(tasa)} anual</strong> sobre los{' '}
          {fmtMoney(r.assetValueCents)} que vale hoy
          {r.rendimiento.tasaSobreCostoBp !== null && r.assetCostCents !== r.assetValueCents && (
            <>, y {fmtTasa(r.rendimiento.tasaSobreCostoBp)} sobre los {fmtMoney(r.assetCostCents)} que costó</>
          )}
          . Es tu propia aritmética: no lleva plusvalía, ni inflación, ni una tasa de mercado con
          qué compararla.
        </p>
      )}

      <div className="renta-pie">
        {r.depositoEnManoCents > 0 && (
          <span className="chip">
            Depósito en tu poder <Money cents={r.depositoEnManoCents} className="cifra-chica" />
          </span>
        )}
        {r.proximoCobro && <span className="chip">Toca cobrar el {fmtDate(r.proximoCobro)}</span>}
        {r.archived && <span className="chip">Archivado</span>}
      </div>
    </article>
  )
}

export function Inmuebles({ onNav }: { onNav: (view: View) => void }) {
  const { profile, refreshKey, bump, stamp } = useApp()
  const [creando, setCreando] = useState(false)
  const [editando, setEditando] = useState<Arrendamiento | null>(null)

  const { data, error } = useFetch(() => api.inmuebles.list(profile.id), [profile.id, refreshKey])
  const { data: bienes } = useFetch(() => api.bienes.list(profile.id), [profile.id, refreshKey])

  const lista = data ?? []
  const rentables = (bienes ?? []).filter((b) => !b.archived)
  const cobrado = lista.reduce((s, r) => s + r.cobradoCents, 0)
  const neto = lista.reduce((s, r) => s + r.rendimiento.netoCents, 0)
  const depositos = lista.reduce((s, r) => s + r.depositoEnManoCents, 0)

  const borrar = async (r: Arrendamiento) => {
    try {
      const res = await api.inmuebles.remove(profile.id, r.id)
      stamp(
        res.depositos > 0
          ? `Borrado · ${res.depositos} depósito(s) vuelven a contar como ingreso`
          : 'Borrado',
      )
      bump()
    } catch (err) {
      alert((err as Error).message)
    }
  }

  return (
    <div className="vista">
      <header className="vista-head">
        <h1>Inmuebles</h1>
        <button
          type="button"
          className="btn btn-primario"
          disabled={rentables.length === 0}
          onClick={() => setCreando(true)}
        >
          ＋ Rentar un bien
        </button>
      </header>

      {error && <p className="aviso" role="alert">{error}</p>}

      {bienes && rentables.length === 0 ? (
        <div className="vacio">
          <p className="vacio-titulo">Primero el bien, luego el contrato.</p>
          <p className="vacio-sub">
            La casa o el local se registran en <strong>Bienes</strong>, con lo que costaron y lo que
            valen hoy — ahí es donde suman a tu patrimonio. Este módulo solo les pone inquilino,
            renta y depósito, para poder decirte cuánto te dejan de verdad.
          </p>
          <button type="button" className="btn btn-primario" onClick={() => onNav('bienes')}>
            Ir a Bienes
          </button>
        </div>
      ) : lista.length === 0 ? (
        <div className="vacio">
          <p className="vacio-titulo">Ningún bien rentado todavía.</p>
          <p className="vacio-sub">
            Apunta el contrato y Finply te dirá qué deja la propiedad al año, sin contar el
            depósito: ese no es tuyo.
          </p>
        </div>
      ) : (
        <>
          <div className="stats stats-auto">
            <div className="stat">
              {/* Doce aquí sí es la ventana de la consulta: el total junta
                  contratos de distinta edad y solo lo mirado los abarca a todos. */}
              <span className="stat-label">Rentas cobradas en los últimos 12 meses</span>
              <span className="stat-valor"><Money cents={cobrado} /></span>
            </div>
            <div className="stat">
              <span className="stat-label">Después del mantenimiento</span>
              <span className={`stat-valor ${neto >= 0 ? 'stat-in' : 'stat-rojo'}`}>
                <Money cents={neto} signed />
              </span>
            </div>
            {depositos > 0 && (
              <div className="stat">
                <span className="stat-label">Depósitos que debes</span>
                <span className="stat-valor"><Money cents={depositos} /></span>
              </div>
            )}
          </div>

          <div className="rentas-lista">
            {lista.map((r, i) => (
              <Carta
                key={r.id}
                r={r}
                index={i}
                onEditar={() => setEditando(r)}
                onBorrar={() => borrar(r)}
              />
            ))}
          </div>

          <p className="reportes-supuesto">
            Las cifras salen de los movimientos que marcaste como renta, depósito o mantenimiento
            de cada contrato: si no los marcas, el dinero sigue en tu libro pero no aparece aquí.
            El <strong>depósito no cuenta como ingreso</strong> ni entra al rendimiento — lo tienes
            y lo debes. Y el valor del inmueble es el que tú declaraste en Bienes: Finply no lo
            revalúa por su cuenta.
          </p>
        </>
      )}

      {(creando || editando) && (
        <ArrendamientoModal
          arrendamiento={editando}
          bienes={rentables}
          onClose={() => {
            setCreando(false)
            setEditando(null)
          }}
          onSaved={bump}
        />
      )}
    </div>
  )
}
