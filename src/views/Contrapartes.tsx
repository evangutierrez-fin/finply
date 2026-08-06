import { Fragment, useState } from 'react'
import { api } from '../api.ts'
import { useApp } from '../context.ts'
import { useFetch } from '../hooks.ts'
import { fmtDate, fmtMoney, fmtTasa, parseAmount } from '../format.ts'
import { Money } from '../components/Money.tsx'
import { Modal } from '../components/Modal.tsx'
import type { Contraparte, RolContraparte } from '../../shared/types.ts'

const ROL_LABEL: Record<RolContraparte, string> = {
  cliente: 'Cliente',
  proveedor: 'Proveedor',
  ambos: 'Cliente y proveedor',
}

function ContraparteModal({
  contraparte,
  onClose,
  onSaved,
}: {
  contraparte: Contraparte | null
  onClose: () => void
  onSaved: () => void
}) {
  const { profile, stamp } = useApp()
  const [name, setName] = useState(contraparte?.name ?? '')
  const [role, setRole] = useState<RolContraparte>(contraparte?.role ?? 'ambos')
  const [taxId, setTaxId] = useState(contraparte?.taxId ?? '')
  const [note, setNote] = useState(contraparte?.note ?? '')
  const [contact, setContact] = useState(contraparte?.contact ?? '')
  const [creditDays, setCreditDays] = useState(
    contraparte?.creditDays == null ? '' : String(contraparte.creditDays),
  )
  const [creditLimit, setCreditLimit] = useState(
    contraparte?.creditLimitCents == null ? '' : (contraparte.creditLimitCents / 100).toFixed(2),
  )
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return setError('Necesita un nombre')
    const dias = creditDays.trim() === '' ? null : Number(creditDays)
    if (dias !== null && (!Number.isInteger(dias) || dias < 0)) {
      return setError('Los días de crédito son un número entero de días')
    }
    const limite = creditLimit.trim() === '' ? null : parseAmount(creditLimit)
    if (limite === null && creditLimit.trim() !== '') return setError('Ese límite no se entiende')
    setSaving(true)
    setError(null)
    try {
      const datos = {
        name: name.trim(),
        role,
        taxId: taxId.trim(),
        note: note.trim(),
        contact: contact.trim(),
        creditDays: dias,
        creditLimitCents: limite,
      }
      if (contraparte) await api.contrapartes.update(contraparte.id, datos)
      else await api.contrapartes.create({ profileId: profile.id, ...datos })
      stamp(contraparte ? 'Actualizada' : 'Agregada')
      onSaved()
      onClose()
    } catch (err) {
      setError((err as Error).message)
      setSaving(false)
    }
  }

  return (
    <Modal title={contraparte ? 'Editar contraparte' : 'Nueva contraparte'} onClose={onClose}>
      <form className="forma" onSubmit={submit}>
        <label className="campo">
          <span className="campo-label">Nombre</span>
          <input
            className="campo-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ej. Panadería del Centro"
            autoFocus
          />
        </label>
        <div className="campos-2">
          <label className="campo">
            <span className="campo-label">Qué es tuyo</span>
            <select
              className="campo-input"
              value={role}
              onChange={(e) => setRole(e.target.value as RolContraparte)}
            >
              {(Object.keys(ROL_LABEL) as RolContraparte[]).map((r) => (
                <option key={r} value={r}>{ROL_LABEL[r]}</option>
              ))}
            </select>
          </label>
          <label className="campo">
            <span className="campo-label">Identificador fiscal</span>
            <input
              className="campo-input"
              value={taxId}
              onChange={(e) => setTaxId(e.target.value)}
              placeholder="Opcional"
            />
          </label>
        </div>
        <p className="forma-nota">
          Ese campo es libre a propósito: aquí cabe un RFC, un CUIT, un VAT o nada. Finply no valida
          el formato de ningún país porque no sabe en cuál estás.
        </p>
        <label className="campo">
          <span className="campo-label">Contacto</span>
          <input
            className="campo-input"
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            placeholder="Correo, teléfono o a quién buscar"
          />
        </label>
        <div className="campos-2">
          <label className="campo">
            <span className="campo-label">Días de crédito</span>
            <input
              className="campo-input"
              inputMode="numeric"
              value={creditDays}
              onChange={(e) => setCreditDays(e.target.value)}
              placeholder="Sin plazo pactado"
            />
          </label>
          <label className="campo">
            <span className="campo-label">Cuánto le fías</span>
            <div className="monto-wrap">
              <span className="monto-signo" aria-hidden="true">$</span>
              <input
                className="campo-input"
                inputMode="decimal"
                value={creditLimit}
                onChange={(e) => setCreditLimit(e.target.value)}
                placeholder="Sin límite"
              />
            </div>
          </label>
        </div>
        <p className="forma-nota">
          Los días de crédito solo <strong>proponen</strong> el vencimiento al facturarle: la fecha
          se puede cambiar factura por factura. Y el límite <strong>avisa, nunca impide</strong>:
          es tu decisión a quién le fías y cuánto, no la de Finply.
        </p>
        <label className="campo">
          <span className="campo-label">Nota</span>
          <input className="campo-input" value={note} onChange={(e) => setNote(e.target.value)} />
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

/**
 * Todo de una contraparte en una hoja (Fase 19).
 *
 * Va **dentro de su renglón**, desplegable, y no en una vista aparte: la
 * pregunta que contesta —"¿le sigo fiando a este?"— se hace mirando la lista,
 * y mandar al usuario a otra pantalla lo separaría de la comparación. Nada de
 * esto se guarda: son las mismas cifras de Facturas, Movimientos y la
 * antigüedad de saldos, juntadas por fin por contraparte.
 */
function Tablero({ contraparte }: { contraparte: Contraparte }) {
  const { profile, refreshKey } = useApp()
  const { data, error } = useFetch(
    () => api.contrapartes.tablero(contraparte.id, profile.id),
    [contraparte.id, profile.id, refreshKey],
  )
  if (error) return <p className="aviso" role="alert">{error}</p>
  if (!data) return <p className="cargando">Cargando…</p>

  const dias = data.diasDePagoPromedio
  return (
    <div className="tablero">
      <dl className="stats stats-auto">
        <div className="stat">
          <dt>Facturado</dt>
          <dd><Money cents={data.facturadoCents} /></dd>
          <span className="stat-pie">{data.facturas} facturas abiertas</span>
        </div>
        <div className="stat">
          <dt>Cobrado</dt>
          <dd><Money cents={data.cobradoCents} /></dd>
          <span className="stat-pie">lo que de verdad entró</span>
        </div>
        <div className="stat">
          <dt>Te debe</dt>
          <dd><Money cents={data.saldoCents} /></dd>
          <span className="stat-pie">
            {data.vencidoCents > 0
              ? `${fmtMoney(data.vencidoCents)} ya vencidos, en ${data.facturasVencidas}`
              : 'nada vencido'}
          </span>
        </div>
        <div className="stat">
          <dt>Tarda en pagar</dt>
          <dd className="cifra">
            {dias === null ? 'Sin saldar aún' : `${dias} ${dias === 1 ? 'día' : 'días'}`}
          </dd>
          <span className="stat-pie">
            {dias === null
              ? 'ninguna factura suya se ha saldado'
              : data.creditDays === null
                ? 'sin crédito pactado con qué medirlo'
                : dias <= data.creditDays
                  ? `dentro de los ${data.creditDays} que pactaron`
                  : `${dias - data.creditDays} más de los ${data.creditDays} pactados`}
          </span>
        </div>
        {data.cotizacionesEsperando > 0 && (
          <div className="stat">
            <dt>Cotizado sin respuesta</dt>
            <dd><Money cents={data.esperandoCents} /></dd>
            <span className="stat-pie">{data.cotizacionesEsperando} en la calle</span>
          </div>
        )}
        {data.tasaExitoBp !== null && (
          <div className="stat">
            <dt>De lo que le cotizas, ganas</dt>
            <dd className="cifra">{fmtTasa(data.tasaExitoBp)}</dd>
            <span className="stat-pie">de lo que ha contestado</span>
          </div>
        )}
        {data.pagadoCents > 0 && (
          <div className="stat">
            <dt>Le pagaste</dt>
            <dd><Money cents={data.pagadoCents} /></dd>
            <span className="stat-pie">salió hacia esta contraparte</span>
          </div>
        )}
      </dl>
      {data.primeraFactura && (
        <p className="reportes-supuesto">
          Le facturas desde el {fmtDate(data.primeraFactura)}
          {data.ultimaFactura && data.ultimaFactura !== data.primeraFactura && (
            <> y la última fue el {fmtDate(data.ultimaFactura)}</>
          )}
          . El plazo de pago se mide sobre sus facturas ya saldadas y hasta el <strong>último</strong>{' '}
          cobro: pagar el 10 % a tiempo y el resto tres meses después no es pagar a tiempo.
        </p>
      )}
    </div>
  )
}

export function Contrapartes() {
  const { profile, refreshKey, bump, stamp } = useApp()
  const [creando, setCreando] = useState(false)
  const [editando, setEditando] = useState<Contraparte | null>(null)
  const [abierta, setAbierta] = useState<number | null>(null)
  const [verArchivadas, setVerArchivadas] = useState(false)
  const { data, error } = useFetch(
    () => api.contrapartes.list(profile.id),
    [profile.id, refreshKey],
  )

  const todas = data ?? []
  const lista = verArchivadas ? todas : todas.filter((c) => !c.archived)

  const borrar = async (c: Contraparte) => {
    try {
      await api.contrapartes.remove(c.id)
      stamp('Borrada')
      bump()
    } catch (err) {
      alert((err as Error).message)
    }
  }

  const archivar = async (c: Contraparte) => {
    await api.contrapartes.update(c.id, { archived: !c.archived })
    stamp(c.archived ? 'Recuperada' : 'Archivada')
    bump()
  }

  return (
    <div className="vista">
      <header className="vista-head">
        <h1>Contrapartes</h1>
        <button type="button" className="btn btn-primario" onClick={() => setCreando(true)}>
          ＋ Nueva contraparte
        </button>
      </header>

      {error && <p className="aviso" role="alert">{error}</p>}

      {data && todas.length === 0 ? (
        <div className="vacio">
          <p className="vacio-titulo">Todavía nadie.</p>
          <p className="vacio-sub">
            Un cliente o un proveedor se apunta una vez y se reutiliza en cada factura y cada
            movimiento. Es lo que permite después preguntar quién te debe y desde cuándo.
          </p>
          <button type="button" className="btn btn-primario" onClick={() => setCreando(true)}>
            Agregar la primera
          </button>
        </div>
      ) : (
        <section className="hoja">
          <table className="tabla">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Papel</th>
                <th className="col-num">Te deben</th>
                <th className="col-num">Le debes</th>
                <th className="col-num">Anticipos</th>
                <th className="col-num">Facturas</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lista.map((c) => (
                // Fragmento y no `<tr>` suelto: el tablero desplegado es una
                // fila hermana, no un hijo de la fila que lo abre.
                <Fragment key={c.id}>
                <tr className={c.archived ? 'fila-archivada' : ''}>
                  <td>
                    <strong>{c.name}</strong>
                    {c.taxId && <span className="cifra-chica"> · {c.taxId}</span>}
                    {(c.contact || c.creditDays !== null) && (
                      <div className="tabla-sub">
                        {[c.contact, c.creditDays !== null && `${c.creditDays} días de crédito`]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    )}
                    {c.note && <div className="tabla-sub">{c.note}</div>}
                    {c.sobreLimite && (
                      <div className="tabla-sub contraparte-sobre-limite">
                        Le fías {fmtMoney(c.creditLimitCents!)} y ya te debe más. Es un aviso, no un
                        candado: la próxima factura se registra igual.
                      </div>
                    )}
                  </td>
                  <td>{ROL_LABEL[c.role]}</td>
                  <td className="col-num">
                    {c.porCobrarCents > 0 ? (
                      <>
                        <Money cents={c.porCobrarCents} className="cifra-chica" />
                        {c.creditLimitCents !== null && (
                          <div className={`tabla-sub${c.sobreLimite ? ' contraparte-sobre-limite' : ''}`}>
                            de {fmtMoney(c.creditLimitCents)}
                          </div>
                        )}
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="col-num">
                    {c.porPagarCents > 0 ? <Money cents={c.porPagarCents} className="cifra-chica" /> : '—'}
                  </td>
                  <td className="col-num">
                    {c.anticiposCents > 0 ? <Money cents={c.anticiposCents} className="cifra-chica" /> : '—'}
                  </td>
                  <td className="col-num cifra-chica">{c.invoiceCount}</td>
                  <td className="col-acciones">
                    <button
                      type="button"
                      className="btn-liga"
                      aria-expanded={abierta === c.id}
                      onClick={() => setAbierta(abierta === c.id ? null : c.id)}
                    >
                      {abierta === c.id ? 'Cerrar' : 'Ver todo'}
                    </button>
                    <button type="button" className="btn-liga" onClick={() => setEditando(c)}>Editar</button>
                    <button type="button" className="btn-liga" onClick={() => archivar(c)}>
                      {c.archived ? 'Recuperar' : 'Archivar'}
                    </button>
                    {c.invoiceCount === 0 && (
                      <button type="button" className="btn-liga btn-liga-rojo" onClick={() => borrar(c)}>
                        Borrar
                      </button>
                    )}
                  </td>
                </tr>
                {abierta === c.id && (
                  <tr className="fila-tablero">
                    <td colSpan={7}>
                      <Tablero contraparte={c} />
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table>
          {todas.some((c) => c.anticiposCents > 0) && (
            <p className="reportes-supuesto">
              Un <strong>anticipo</strong> es dinero que ya cobraste y que todavía no tiene factura.
              Ya está en tu libro y ya cuenta en su mes: cuando llegue la factura se le aplica desde
              ahí, sin volver a registrar el mismo peso.
            </p>
          )}
          {todas.some((c) => c.archived) && (
            <button type="button" className="btn-liga" onClick={() => setVerArchivadas((v) => !v)}>
              {verArchivadas ? 'Ocultar archivadas' : 'Ver archivadas'}
            </button>
          )}
        </section>
      )}

      {creando && <ContraparteModal contraparte={null} onClose={() => setCreando(false)} onSaved={bump} />}
      {editando && (
        <ContraparteModal contraparte={editando} onClose={() => setEditando(null)} onSaved={bump} />
      )}
    </div>
  )
}
