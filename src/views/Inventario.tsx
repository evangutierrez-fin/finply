// Inventario simple: qué tienes, cuánto vale y cuánto costó lo que vendiste.
//
// Lo más importante de esta vista es lo que **no** hace, y por eso se dice a la
// vista en el pie:
//
//   · El almacén **no suma a tu patrimonio**. Si quieres que cuente, la
//     mercancía se registra como un bien. Sumarla aquí haría que apagar el
//     módulo bajara tu patrimonio, y un patrimonio que cambia al desmarcar una
//     casilla es la peor clase de mentira (R18).
//   · El costo de ventas **no cambia tu estado de resultados**. Finply lleva el
//     libro por flujo de efectivo (D14): la mercancía es gasto el día que la
//     pagaste. Lo de aquí es la otra verdad sobre el mismo peso.
//   · Registrar un movimiento **no asienta dinero** (R4).

import { useState } from 'react'
import { api } from '../api.ts'
import { useApp } from '../context.ts'
import { useFetch } from '../hooks.ts'
import { currentMonth, fmtDate, fmtMoney, monthLabel, parseAmount, shiftMonth, todayISO } from '../format.ts'
import { cantidadTexto, parseCantidad } from '../../shared/giro.ts'
import { Money } from '../components/Money.tsx'
import { Modal } from '../components/Modal.tsx'
import type { View } from '../components/Sidebar.tsx'
import type { MovimientoStock, Producto } from '../../shared/types.ts'

const TIPOS: { id: MovimientoStock['kind']; label: string; ayuda: string }[] = [
  { id: 'entrada', label: 'Entrada', ayuda: 'Llegó mercancía. Va con lo que costó cada unidad.' },
  { id: 'salida', label: 'Salida', ayuda: 'Se vendió o se usó. Se valúa al costo promedio de hoy.' },
  {
    id: 'ajuste',
    label: 'Ajuste',
    ayuda: 'Un conteo que no cuadró, una merma, algo que apareció. Puede ser negativo.',
  },
]

/** El primer y el último día de un 'AAAA-MM'. */
function rangoDelMes(month: string): { desde: string; hasta: string } {
  const [anio, mes] = month.split('-').map(Number)
  const ultimo = new Date(Date.UTC(anio!, mes!, 0)).getUTCDate()
  return { desde: `${month}-01`, hasta: `${month}-${String(ultimo).padStart(2, '0')}` }
}

function ProductoModal({
  producto,
  onClose,
  onSaved,
}: {
  producto: Producto | null
  onClose: () => void
  onSaved: () => void
}) {
  const { profile, stamp } = useApp()
  const [name, setName] = useState(producto?.name ?? '')
  const [sku, setSku] = useState(producto?.sku ?? '')
  const [unit, setUnit] = useState(producto?.unit ?? 'pieza')
  const [minimo, setMinimo] = useState(
    producto?.minQtyMilli != null ? cantidadTexto(producto.minQtyMilli) : '',
  )
  const [archived, setArchived] = useState(producto?.archived ?? false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return setError('El producto necesita un nombre')
    const minQtyMilli = minimo.trim() === '' ? null : parseCantidad(minimo)
    if (minimo.trim() !== '' && minQtyMilli === null) return setError('Ese mínimo no se entiende')
    setSaving(true)
    setError(null)
    try {
      const datos = {
        profileId: profile.id,
        sku: sku.trim(),
        name: name.trim(),
        unit: unit.trim() || 'pieza',
        minQtyMilli,
        archived,
      }
      if (producto) await api.inventario.update(producto.id, datos)
      else await api.inventario.create(datos)
      stamp(producto ? 'Actualizado' : 'Guardado')
      onSaved()
      onClose()
    } catch (err) {
      setError((err as Error).message)
      setSaving(false)
    }
  }

  return (
    <Modal title={producto ? 'Corregir producto' : 'Nuevo producto'} onClose={onClose}>
      <form className="forma" onSubmit={submit}>
        <label className="campo">
          <span className="campo-label">Qué es</span>
          <input
            className="campo-input"
            placeholder="Ej. Café en grano, playera blanca M"
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </label>

        <div className="campos-3">
          <label className="campo">
            <span className="campo-label">Clave</span>
            <input className="campo-input" maxLength={40} value={sku} onChange={(e) => setSku(e.target.value)} />
          </label>
          <label className="campo">
            <span className="campo-label">Se mide en</span>
            <input
              className="campo-input"
              maxLength={16}
              placeholder="pieza, kg, litro"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
            />
          </label>
          <label className="campo">
            <span className="campo-label">Avísame bajo</span>
            <input
              className="campo-input"
              inputMode="decimal"
              placeholder="sin aviso"
              value={minimo}
              onChange={(e) => setMinimo(e.target.value)}
            />
          </label>
        </div>

        <p className="forma-nota">
          La existencia y el costo <strong>no se escriben aquí</strong>: salen de los movimientos.
          Se apunta lo que entra con lo que costó, y Finply calcula el promedio.
        </p>

        {producto && (
          <label className="campo campo-casilla">
            <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
            <span>Archivado — deja de contar y de avisar, pero conserva su historial</span>
          </label>
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

function MovimientoModal({
  producto,
  onClose,
  onSaved,
}: {
  producto: Producto
  onClose: () => void
  onSaved: () => void
}) {
  const { profile, stamp } = useApp()
  const [kind, setKind] = useState<MovimientoStock['kind']>('entrada')
  const [date, setDate] = useState(todayISO())
  const [cantidad, setCantidad] = useState('')
  const [costo, setCosto] = useState(
    producto.costoUnitarioCents > 0 ? (producto.costoUnitarioCents / 100).toFixed(2) : '',
  )
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const qty = parseCantidad(cantidad, kind === 'ajuste')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (qty === null || qty === 0) {
      return setError(
        kind === 'ajuste'
          ? 'Escribe cuánto sobró o faltó. Puede ser negativo, pero no cero.'
          : 'Escribe cuánta mercancía es',
      )
    }
    const unitCostCents = costo.trim() === '' ? 0 : parseAmount(costo)
    if (unitCostCents === null) return setError('Ese costo no se entiende')
    setSaving(true)
    setError(null)
    try {
      await api.inventario.registrar({
        profileId: profile.id,
        productId: producto.id,
        date,
        kind,
        qtyMilli: qty,
        unitCostCents,
        note: note.trim(),
      })
      stamp('Registrado')
      onSaved()
      onClose()
    } catch (err) {
      setError((err as Error).message)
      setSaving(false)
    }
  }

  const ayuda = TIPOS.find((t) => t.id === kind)!.ayuda

  return (
    <Modal title={`Movimiento · ${producto.name}`} onClose={onClose}>
      <form className="forma" onSubmit={submit}>
        <p className="forma-nota">
          Ahora tienes <strong>{cantidadTexto(producto.cantidadMilli)} {producto.unit}</strong>
          {producto.valorCents > 0 && (
            <> por <strong>{fmtMoney(producto.valorCents)}</strong>, a {fmtMoney(producto.costoUnitarioCents)} cada {producto.unit}</>
          )}
          .
        </p>

        <div className="campos-3">
          <label className="campo">
            <span className="campo-label">Qué pasó</span>
            <select
              className="campo-input"
              value={kind}
              onChange={(e) => setKind(e.target.value as MovimientoStock['kind'])}
            >
              {TIPOS.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          </label>
          <label className="campo">
            <span className="campo-label">Cuándo</span>
            <input type="date" className="campo-input" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="campo">
            <span className="campo-label">Cuánto ({producto.unit})</span>
            <input
              className="campo-input"
              inputMode="decimal"
              placeholder={kind === 'ajuste' ? '-1' : '0'}
              value={cantidad}
              onChange={(e) => setCantidad(e.target.value)}
              autoFocus
            />
          </label>
        </div>

        {kind === 'entrada' && (
          <label className="campo campo-monto">
            <span className="campo-label">Costo de cada {producto.unit}</span>
            <div className="monto-wrap">
              <span className="monto-signo" aria-hidden="true">$</span>
              <input
                className="campo-input monto"
                inputMode="decimal"
                placeholder="0.00"
                value={costo}
                onChange={(e) => setCosto(e.target.value)}
              />
            </div>
          </label>
        )}

        <label className="campo">
          <span className="campo-label">Nota</span>
          <input className="campo-input" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>

        <p className="forma-nota">
          {ayuda}{' '}
          {kind === 'entrada' ? (
            <>El costo promedio se recalcula mezclando lo que ya había con lo que llega.</>
          ) : kind === 'salida' ? (
            <>Sacar más de lo que hay no se puede: la existencia no se va a negativos.</>
          ) : (
            <>Un ajuste <strong>no es costo de ventas</strong>: no lo vendiste.</>
          )}{' '}
          Esto <strong>no mueve tu libro</strong> — el dinero de la compra se registra aparte, como
          cualquier gasto.
        </p>

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

/** El historial de un producto, que es de donde salen todas sus cifras. */
function Historial({ producto, onCambio }: { producto: Producto; onCambio: () => void }) {
  const { profile, refreshKey, stamp } = useApp()
  const { data } = useFetch(
    () => api.inventario.movimientos(profile.id, producto.id),
    [profile.id, producto.id, refreshKey],
  )

  const borrar = async (m: MovimientoStock) => {
    try {
      await api.inventario.borrarMovimiento(profile.id, m.id)
      stamp('Borrado')
      onCambio()
    } catch (err) {
      alert((err as Error).message)
    }
  }

  if (!data) return null
  if (data.length === 0) {
    return <p className="reportes-nota">Todavía no tiene movimientos. Registra la primera entrada.</p>
  }

  return (
    <table className="tabla alm-historial">
      <thead>
        <tr>
          <th>Día</th>
          <th>Qué pasó</th>
          <th className="col-num">Cantidad</th>
          <th className="col-num">Costo unitario</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {data.map((m) => (
          <tr key={m.id}>
            <td>{fmtDate(m.date)}</td>
            <td>
              {TIPOS.find((t) => t.id === m.kind)!.label}
              {m.note && <div className="tabla-sub">{m.note}</div>}
            </td>
            <td className="col-num">
              {m.kind === 'salida' ? '−' : ''}
              {cantidadTexto(m.qtyMilli)} {producto.unit}
            </td>
            <td className="col-num">
              {m.kind === 'entrada' ? <Money cents={m.unitCostCents} /> : <span className="tabla-sub">al promedio</span>}
            </td>
            <td className="col-num">
              <span className="giro-acciones">
                <button type="button" className="accion" onClick={() => void borrar(m)} aria-label="Borrar movimiento">✕</button>
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function Inventario({ onNav }: { onNav: (view: View) => void }) {
  const { profile, refreshKey, bump, stamp } = useApp()
  const [month, setMonth] = useState(currentMonth())
  const [editando, setEditando] = useState<Producto | null | undefined>(undefined)
  const [moviendo, setMoviendo] = useState<Producto | null>(null)
  const [abierto, setAbierto] = useState<number | null>(null)

  const periodo = rangoDelMes(month)
  const { data: almacen, error } = useFetch(
    () => api.inventario.almacen(profile.id, periodo),
    [profile.id, periodo.desde, periodo.hasta, refreshKey],
  )

  const productos = almacen?.productos ?? []
  const vivos = productos.filter((p) => !p.archived)

  const borrar = async (p: Producto) => {
    try {
      await api.inventario.remove(profile.id, p.id)
      stamp('Borrado')
      bump()
    } catch (err) {
      alert((err as Error).message)
    }
  }

  return (
    <div className="vista">
      <header className="vista-head">
        <h1>Inventario</h1>
        <div className="vista-head-acciones">
          <div className="mes-nav">
            <button type="button" className="mes-flecha" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Mes anterior">‹</button>
            <span className="vista-mes">{monthLabel(month)}</span>
            <button type="button" className="mes-flecha" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Mes siguiente">›</button>
          </div>
          <button type="button" className="btn btn-primario btn-chico" onClick={() => setEditando(null)}>
            ＋ Nuevo producto
          </button>
        </div>
      </header>

      {error && <p className="aviso" role="alert">{error}</p>}

      {almacen && productos.length === 0 ? (
        <div className="vacio">
          <p className="vacio-titulo">El almacén está vacío.</p>
          <p className="vacio-sub">
            Da de alta lo que vendes y apunta lo que entra con lo que costó. Finply te dirá cuánto
            tienes, cuánto vale y cuánto costó lo que salió.
          </p>
          <button type="button" className="btn btn-primario" onClick={() => setEditando(null)}>
            Dar de alta el primero
          </button>
        </div>
      ) : (
        almacen && (
          <>
            <div className="stats stats-auto">
              <div className="stat">
                <span className="stat-label">Vale lo que tienes</span>
                <span className="stat-valor"><Money cents={almacen.valorCents} /></span>
              </div>
              <div className="stat">
                <span className="stat-label">Costó lo que salió en {monthLabel(month)}</span>
                <span className="stat-valor"><Money cents={almacen.costoVendidoCents} /></span>
              </div>
              {almacen.ajusteCents !== 0 && (
                <div className="stat">
                  <span className="stat-label">
                    {almacen.ajusteCents < 0 ? 'Se perdió en ajustes' : 'Apareció en ajustes'}
                  </span>
                  <span className="stat-valor"><Money cents={Math.abs(almacen.ajusteCents)} /></span>
                </div>
              )}
              {almacen.bajoMinimo > 0 && (
                <div className="stat">
                  <span className="stat-label">Bajo su mínimo</span>
                  <span className="stat-valor stat-rojo">{almacen.bajoMinimo}</span>
                </div>
              )}
            </div>

            <section className="hoja">
              <table className="tabla">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th className="col-num">Tienes</th>
                    <th className="col-num">Cada uno</th>
                    <th className="col-num">Vale</th>
                    <th className="col-num">Salió en el mes</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {productos.map((p) => (
                    <tr key={p.id} className={p.archived ? 'fila-archivada' : undefined}>
                      <td>
                        <button
                          type="button"
                          className="btn-liga"
                          onClick={() => setAbierto(abierto === p.id ? null : p.id)}
                        >
                          {p.name}
                        </button>
                        <div className="tabla-sub">
                          {p.sku && `${p.sku} · `}
                          {p.movimientos} movimientos
                          {p.ultimoMovimiento && ` · último ${fmtDate(p.ultimoMovimiento)}`}
                          {p.archived && ' · archivado'}
                        </div>
                      </td>
                      <td className="col-num">
                        <span className={p.bajoMinimo ? 'stat-rojo' : undefined}>
                          {cantidadTexto(p.cantidadMilli)} {p.unit}
                        </span>
                        {p.bajoMinimo && p.minQtyMilli !== null && (
                          <div className="tabla-sub">mínimo {cantidadTexto(p.minQtyMilli)}</div>
                        )}
                      </td>
                      <td className="col-num"><Money cents={p.costoUnitarioCents} /></td>
                      <td className="col-num"><Money cents={p.valorCents} /></td>
                      <td className="col-num"><Money cents={p.costoVendidoCents} /></td>
                      <td className="col-num">
                        <span className="giro-acciones">
                          <button type="button" className="accion" onClick={() => setMoviendo(p)} aria-label={`Movimiento de ${p.name}`}>±</button>
                          <button type="button" className="accion" onClick={() => setEditando(p)} aria-label={`Corregir ${p.name}`}>✎</button>
                          {p.movimientos === 0 && (
                            <button type="button" className="accion" onClick={() => void borrar(p)} aria-label={`Borrar ${p.name}`}>✕</button>
                          )}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                {vivos.length > 1 && (
                  <tfoot>
                    <tr>
                      <td colSpan={3}>Todo el almacén</td>
                      <td className="col-num"><Money cents={almacen.valorCents} /></td>
                      <td className="col-num"><Money cents={almacen.costoVendidoCents} /></td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>

              {abierto !== null && productos.some((p) => p.id === abierto) && (
                <Historial producto={productos.find((p) => p.id === abierto)!} onCambio={bump} />
              )}
            </section>

            <p className="reportes-supuesto">
              Dos cosas que este almacén <strong>no</strong> hace, a propósito. No suma a tu
              patrimonio: si quieres que la mercancía cuente, regístrala en{' '}
              <button type="button" className="btn-liga" onClick={() => onNav('bienes')}>Bienes</button>.
              Y ese costo de ventas <strong>no cambia tu estado de resultados</strong>, que lleva la
              mercancía como gasto el día que la pagaste — son dos verdades sobre el mismo peso:
              cuándo salió de tu cuenta, y cuánto costó lo que de verdad entregaste. El costo sale
              del <strong>promedio ponderado</strong> de lo que has ido comprando.
            </p>
          </>
        )
      )}

      {editando !== undefined && (
        <ProductoModal producto={editando} onClose={() => setEditando(undefined)} onSaved={bump} />
      )}
      {moviendo && (
        <MovimientoModal producto={moviendo} onClose={() => setMoviendo(null)} onSaved={bump} />
      )}
    </div>
  )
}
