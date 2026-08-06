import { useEffect, useState } from 'react'
import { api } from '../api.ts'
import { useApp } from '../context.ts'
import { useFetch } from '../hooks.ts'
import { fmtDate, fmtMoney, parseAmount, todayISO } from '../format.ts'
import { Money, CountUpMoney } from '../components/Money.tsx'
import { Modal } from '../components/Modal.tsx'
import { HistorialValor } from '../components/Charts.tsx'
import {
  fmtUnidades, parseUnidades, precioImplicito, repartoPorTipo, valorDeUnidades,
} from '../../shared/inversiones.ts'
import type {
  Account, InformePrecios, Investment, InvestmentEntryType, InvestmentKind,
} from '../../shared/types.ts'

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

/**
 * Minigráfica del valor a lo largo del tiempo. Los puntos vienen calculados
 * del servidor (`shared/inversiones.ts`): recorrer aquí el historial otra vez
 * sería una cuarta copia de la misma aritmética, y la que se vería primero
 * cuando dejara de coincidir.
 */
function Sparkline({ investment }: { investment: Investment }) {
  const points = investment.puntos.map((p) => p.valueCents)
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
  const [units, setUnits] = useState('')
  const [price, setPrice] = useState('')
  // Valuar por precio solo tiene sentido con unidades en mano: el precio de
  // nada es nada. Sin ellas, la única forma es el valor total.
  const puedeValuarPorPrecio = investment.unitsE8 > 0
  const [porPrecio, setPorPrecio] = useState(mode === 'valuacion' && puedeValuarPorPrecio)
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

  const unitsE8 = parseUnidades(units)
  const priceCents = parseAmount(price)
  // El monto se calcula solo cuando hay unidades y precio, que es como viene
  // una compra de acciones o de cripto. Sigue siendo editable: una comisión
  // hace que lo que salió de la cuenta no sea exactamente unidades × precio.
  const montoCalculado =
    mode !== 'valuacion' && unitsE8 !== null && unitsE8 > 0 && priceCents !== null
      ? valorDeUnidades(unitsE8, priceCents)
      : null
  const montoEfectivo = montoCalculado ?? parseAmount(amount)
  const valuacionPorPrecio =
    mode === 'valuacion' && porPrecio && priceCents !== null
      ? valorDeUnidades(investment.unitsE8, priceCents)
      : null

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (mode === 'valuacion' && porPrecio) {
      if (priceCents === null) return setError('Escribe un precio por unidad válido')
    }
    const cents = montoEfectivo
    if (!(mode === 'valuacion' && porPrecio) && cents === null) {
      return setError('Escribe un monto válido')
    }
    if (units.trim() && unitsE8 === null) {
      return setError('Esas unidades no se entienden (hasta 8 decimales)')
    }
    if (mode !== 'valuacion' && price.trim() && priceCents === null) {
      return setError('Ese precio por unidad no se entiende')
    }
    setSaving(true)
    setError(null)
    try {
      await api.investments.addEntry(investment.id, {
        type: mode,
        amountCents: mode === 'valuacion' && porPrecio ? 0 : cents!,
        date,
        note: note.trim(),
        accountId: mode === 'valuacion' ? null : accountId || null,
        unitsE8: mode === 'valuacion' ? null : unitsE8,
        unitPriceCents:
          mode === 'valuacion'
            ? porPrecio
              ? priceCents
              : null
            : unitsE8 && priceCents !== null
              ? priceCents
              : null,
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
        {mode === 'valuacion' && !porPrecio && (
          <p className="forma-nota">
            Apunta cuánto vale hoy la inversión completa (lo que ves en tu estado de cuenta).
          </p>
        )}
        {mode === 'valuacion' && puedeValuarPorPrecio && (
          <div className="seg seg-chico" role="radiogroup" aria-label="Cómo valuar">
            <button
              type="button"
              role="radio"
              aria-checked={porPrecio}
              className={`seg-item${porPrecio ? ' activa' : ''}`}
              onClick={() => setPorPrecio(true)}
            >
              Por precio
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={!porPrecio}
              className={`seg-item${!porPrecio ? ' activa' : ''}`}
              onClick={() => setPorPrecio(false)}
            >
              Por valor total
            </button>
          </div>
        )}
        <div className="campos-2">
          {mode === 'valuacion' && porPrecio ? (
            <label className="campo">
              <span className="campo-label">Precio por unidad</span>
              <div className="monto-wrap">
                <span className="monto-signo" aria-hidden="true">$</span>
                <input
                  className="campo-input"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  autoFocus
                />
              </div>
            </label>
          ) : (
            <label className="campo">
              <span className="campo-label">{mode === 'valuacion' ? 'Valor actual' : 'Monto'}</span>
              <div className="monto-wrap">
                <span className="monto-signo" aria-hidden="true">$</span>
                <input
                  className="campo-input"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={montoCalculado !== null ? (montoCalculado / 100).toFixed(2) : amount}
                  onChange={(e) => setAmount(e.target.value)}
                  readOnly={montoCalculado !== null}
                  autoFocus
                />
              </div>
            </label>
          )}
          <label className="campo">
            <span className="campo-label">Fecha</span>
            <input type="date" className="campo-input" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>

        {mode === 'valuacion' && porPrecio && (
          <p className="forma-nota">
            {fmtUnidades(investment.unitsE8)} unidades
            {priceCents !== null && valuacionPorPrecio !== null ? (
              <> × {fmtMoney(priceCents)} = <strong className="cifra-chica">{fmtMoney(valuacionPorPrecio)}</strong></>
            ) : (
              <> en mano. El valor se recalcula solo si después registras un aporte con fecha anterior.</>
            )}
          </p>
        )}

        {mode !== 'valuacion' && (
          <div className="campos-2">
            <label className="campo">
              <span className="campo-label">Unidades (opcional)</span>
              <input
                className="campo-input"
                inputMode="decimal"
                placeholder="Ej. 0.0125"
                value={units}
                onChange={(e) => setUnits(e.target.value)}
              />
            </label>
            <label className="campo">
              <span className="campo-label">Precio por unidad</span>
              <div className="monto-wrap">
                <span className="monto-signo" aria-hidden="true">$</span>
                <input
                  className="campo-input"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                />
              </div>
            </label>
          </div>
        )}
        {mode !== 'valuacion' && units.trim() !== '' && (
          <p className="forma-nota">
            {unitsE8 === null
              ? 'Esas unidades no se entienden: hasta 8 decimales.'
              : montoCalculado !== null
                ? `El monto se calcula: ${fmtUnidades(unitsE8)} × ${fmtMoney(priceCents!)}. Deja el precio en blanco para escribirlo tú.`
                : `Apuntar unidades te deja valuar por precio después${
                    parseAmount(amount) !== null && unitsE8 > 0
                      ? `. A este monto, saldrían a ${fmtMoney(precioImplicito(parseAmount(amount)!, unitsE8) ?? 0)} por unidad`
                      : ''
                  }.`}
          </p>
        )}

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

  // La ganancia es valor + retirado − aportado: así sigue siendo correcta
  // cuando ya sacaste más de lo que pusiste, que es justo cuando la resta
  // simple contra "aportado" empieza a mentir.
  const gain = investment.gananciaCents
  const pct = investment.aportadoCents > 0 ? (gain / investment.aportadoCents) * 100 : null
  const lastValuation = [...investment.entries].reverse().find((e) => e.type === 'valuacion')
  const precioActual =
    investment.unitsE8 > 0 ? precioImplicito(investment.valueCents, investment.unitsE8) : null

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

      {investment.retiradoCents > 0 && (
        <p className="deuda-cifras">
          De esa ganancia, <Money cents={investment.gananciaRealizadaCents} className="cifra-chica" />{' '}
          ya la cobraste al retirar y{' '}
          <Money cents={investment.gananciaEnPapelCents} className="cifra-chica" /> sigue en papel.
          Lo que todavía tienes te costó {fmtMoney(investment.costoCents)}.
        </p>
      )}

      <p className="deuda-cifras">
        Aportado: <Money cents={investment.aportadoCents} className="cifra-chica" />
        {investment.retiradoCents > 0 && (
          <> · retirado <Money cents={investment.retiradoCents} className="cifra-chica" /></>
        )}
        {investment.unitsE8 > 0 && (
          <>
            {' · '}
            <span className="cifra-chica">{fmtUnidades(investment.unitsE8)}</span> unidades
            {precioActual !== null && <> a {fmtMoney(precioActual)}</>}
          </>
        )}
        {lastValuation && <> · valuada el {fmtDate(lastValuation.date)}</>}
      </p>

      <p className="deuda-cifras">
        Rendimiento anualizado:{' '}
        {investment.rendimientoAnual === null ? (
          <span title="Hacen falta al menos 30 días entre el primer aporte y hoy">
            todavía no se puede decir
          </span>
        ) : (
          <strong className={`cifra-chica ${investment.rendimientoAnual >= 0 ? 'stat-in' : ''}`}>
            {investment.rendimientoAnual >= 0 ? '+' : ''}
            {(investment.rendimientoAnual * 100).toFixed(1)} % anual
          </strong>
        )}
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
        <>
          <HistorialValor puntos={investment.puntos} />
          <ul className="abonos">
            {[...investment.entries].reverse().map((e) => (
              <li key={e.id}>
                <span className="abono-fecha">{fmtDate(e.date)}</span>
                <span className="abono-nota">
                  {ENTRY_LABEL[e.type]}
                  {e.unitsE8 ? ` · ${fmtUnidades(e.unitsE8)} u` : ''}
                  {e.unitPriceCents !== null ? ` · ${fmtMoney(e.unitPriceCents)} c/u` : ''}
                  {e.note ? ` · ${e.note}` : ''}
                </span>
                {/* Una valuación por precio guarda monto cero a propósito: su
                    valor sale del precio y de las unidades de esa fecha. */}
                {e.type === 'valuacion' && e.unitPriceCents !== null ? (
                  <span className="cifra-chica">—</span>
                ) : (
                  <Money cents={e.amountCents} className="cifra-chica" />
                )}
                <button type="button" className="accion" aria-label="Anular registro" onClick={() => removeEntry(e.id)}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </>
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

/**
 * Cómo está repartida la cartera por tipo. Es el mismo ángulo que la
 * concentración del gasto por categoría, y contesta la misma pregunta: de qué
 * depende tu dinero.
 *
 * Las barras van contra el **total**, no contra la más grande: aquí la
 * pregunta es qué parte del todo pesa cada una, no cuál gana. Y va todo a la
 * vista, sin `hover` ni clic (R19): con `<dl>` y sus cifras al lado, se lee
 * igual en papel y con un lector de pantalla. Esto no recomienda un reparto
 * (R9): dice el que hay.
 */
function RepartoCartera({ inversiones }: { inversiones: Investment[] }) {
  const filas = repartoPorTipo(inversiones)
  if (filas.length < 2) return null
  const total = filas.reduce((s, f) => s + f.valueCents, 0)
  const mayor = filas[0]!

  return (
    <section className="hoja">
      <h2 className="rotulo">Cómo está repartida</h2>
      <ul className="cat-bars reparto-bars">
        {filas.map((f, i) => (
          <li key={f.kind} className="cat-row-grupo">
            <div className="cat-row">
              <span className="cat-nombre">{KIND_LABEL[f.kind as InvestmentKind] ?? f.kind}</span>
              <span className="cat-riel">
                <span
                  className="cat-lleno"
                  style={{
                    width: `${Math.max(2, (f.valueCents / total) * 100)}%`,
                    animationDelay: `${i * 60}ms`,
                  }}
                />
              </span>
              <span className="cifra cifra-chica">{fmtMoney(f.valueCents)}</span>
              <span className="cat-parte">{(f.parteBp / 100).toFixed(1)} %</span>
            </div>
          </li>
        ))}
      </ul>
      <p className="amort-nota">
        {(mayor.parteBp / 100).toFixed(1)} % de lo que tienes está en{' '}
        {KIND_LABEL[mayor.kind as InvestmentKind] ?? mayor.kind}. Es tu concentración: si esa
        clase se mueve, se mueve esa parte de tu dinero.
      </p>
    </section>
  )
}

const ESTADO_PRECIO: Record<string, string> = {
  lista: 'Lista',
  sin_inversion: 'Sin inversión',
  sin_unidades: 'Sin unidades',
  invalida: 'No se entiende',
}

/**
 * Import de precios desde CSV. D2 lo dejó claro: Finply no consulta ninguna
 * cotización en línea, porque pedirla le cuenta a un servidor ajeno qué tienes.
 * El precio entra escrito por el usuario, y aquí en lote.
 *
 * Se ve primero lo que pasaría —fila por fila, con el valor que resultaría— y
 * solo lo marcado se asienta, todo en una transacción (R4 y R8).
 */
function PreciosModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { profile, stamp } = useApp()
  const [texto, setTexto] = useState('')
  const [fecha, setFecha] = useState(todayISO())
  const [informe, setInforme] = useState<InformePrecios | null>(null)
  const [elegidas, setElegidas] = useState<Set<number>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  const analizar = async () => {
    setOcupado(true)
    setError(null)
    try {
      const res = await api.precios.analizar({ profileId: profile.id, texto, fecha })
      setInforme(res)
      setElegidas(new Set(res.filas.filter((f) => f.estado === 'lista').map((f) => f.fila)))
    } catch (err) {
      setError((err as Error).message)
      setInforme(null)
    }
    setOcupado(false)
  }

  const aplicar = async () => {
    setOcupado(true)
    setError(null)
    try {
      const res = await api.precios.aplicar({
        profileId: profile.id,
        texto,
        fecha,
        filas: [...elegidas],
      })
      stamp(`${res.creadas} valuada${res.creadas === 1 ? '' : 's'}`)
      onSaved()
      onClose()
    } catch (err) {
      setError((err as Error).message)
      setOcupado(false)
    }
  }

  const archivo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setTexto(await file.text())
    setInforme(null)
  }

  return (
    <Modal title="Importar precios" onClose={onClose}>
      <div className="forma">
        <p className="forma-nota">
          Pega dos columnas —la inversión y su precio por unidad— o sube el CSV que te deja
          descargar tu casa de bolsa. Finply nunca consulta un precio en línea: eso le contaría a
          otro servidor qué tienes.
        </p>
        <div className="campos-2">
          <label className="campo">
            <span className="campo-label">Archivo CSV</span>
            <input type="file" accept=".csv,text/csv,text/plain" className="campo-input" onChange={archivo} />
          </label>
          <label className="campo">
            <span className="campo-label">Fecha (para las filas sin la suya)</span>
            <input type="date" className="campo-input" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </label>
        </div>
        <label className="campo">
          <span className="campo-label">O pega aquí</span>
          <textarea
            className="campo-input campo-area"
            rows={5}
            placeholder={'inversion,precio\nBitcoin,1850000\nFondo indexado,24.55'}
            value={texto}
            onChange={(e) => {
              setTexto(e.target.value)
              setInforme(null)
            }}
          />
        </label>

        {error && <p className="forma-error" role="alert">{error}</p>}

        {informe && (
          <>
            <p className="forma-nota">
              {informe.listas} fila{informe.listas === 1 ? '' : 's'} lista
              {informe.listas === 1 ? '' : 's'}
              {informe.descartadas > 0 && `, ${informe.descartadas} que no se pueden usar`}.
            </p>
            <ul className="precios-lista">
              {informe.filas.map((f) => (
                <li key={f.fila} className={f.estado === 'lista' ? '' : 'precio-descartada'}>
                  <label className="precio-fila">
                    <input
                      type="checkbox"
                      disabled={f.estado !== 'lista'}
                      checked={elegidas.has(f.fila)}
                      onChange={(e) => {
                        const s = new Set(elegidas)
                        if (e.target.checked) s.add(f.fila)
                        else s.delete(f.fila)
                        setElegidas(s)
                      }}
                    />
                    <span className="precio-nombre">{f.investmentName ?? (f.nombre || '(sin nombre)')}</span>
                    <span className="cifra-chica">
                      {f.precioCents !== null ? fmtMoney(f.precioCents) : '—'}
                    </span>
                    <span className="precio-valor">
                      {f.estado === 'lista' ? (
                        <>
                          {fmtUnidades(f.unitsE8)} u ={' '}
                          <strong className="cifra-chica">{fmtMoney(f.valorCents ?? 0)}</strong>
                        </>
                      ) : (
                        <span className="precio-motivo">
                          {ESTADO_PRECIO[f.estado]}: {f.motivo}
                        </span>
                      )}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}

        <footer className="forma-pie">
          <button type="button" className="btn btn-fantasma" onClick={onClose}>Cancelar</button>
          {informe ? (
            <button
              type="button"
              className="btn btn-primario"
              disabled={ocupado || elegidas.size === 0}
              onClick={aplicar}
            >
              {ocupado ? 'Guardando…' : `Valuar ${elegidas.size}`}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primario"
              disabled={ocupado || texto.trim() === ''}
              onClick={analizar}
            >
              {ocupado ? 'Leyendo…' : 'Ver qué pasaría'}
            </button>
          )}
        </footer>
      </div>
    </Modal>
  )
}

export function Inversiones() {
  const { profile, refreshKey, bump } = useApp()
  const [creating, setCreating] = useState(false)
  const [precios, setPrecios] = useState(false)
  const { data: investments, error } = useFetch(
    () => api.investments.list(profile.id),
    [profile.id, refreshKey],
  )

  const active = (investments ?? []).filter((i) => !i.archived)
  const aportado = active.reduce((s, i) => s + i.aportadoCents, 0)
  const value = active.reduce((s, i) => s + i.valueCents, 0)
  const gain = active.reduce((s, i) => s + i.gananciaCents, 0)
  const realizada = active.reduce((s, i) => s + i.gananciaRealizadaCents, 0)
  const conUnidades = active.some((i) => i.unitsE8 > 0)
  const conRetiros = active.some((i) => i.retiradoCents > 0)

  return (
    <div className="vista">
      <header className="vista-head">
        <h1>Inversiones</h1>
        <div className="vista-head-acciones">
          {conUnidades && (
            <button type="button" className="btn btn-fantasma" onClick={() => setPrecios(true)}>
              Importar precios
            </button>
          )}
          <button type="button" className="btn btn-primario" onClick={() => setCreating(true)}>
            ＋ Nueva inversión
          </button>
        </div>
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
                <dd><Money cents={aportado} /></dd>
              </div>
              <div className="stat stat-neto">
                <dt>Rendimiento</dt>
                <dd>
                  <span className={gain >= 0 ? 'stat-in' : ''}>
                    <Money cents={gain} signed />
                    {aportado > 0 && (
                      <span className="cifra-chica"> · {gain >= 0 ? '+' : ''}{((gain / aportado) * 100).toFixed(1)} %</span>
                    )}
                  </span>
                </dd>
              </div>
              {/* La misma ganancia partida en dos: lo cobrado ya es tuyo y lo
                  de papel todavía puede irse. Solo aparece si retiraste algo:
                  sin retiros la realizada es cero y el renglón sería ruido. */}
              {conRetiros && (
                <div className="stat">
                  <dt>Ya cobrado</dt>
                  <dd>
                    <Money cents={realizada} signed />
                    <span className="cifra-chica"> · {fmtMoney(gain - realizada)} en papel</span>
                  </dd>
                </div>
              )}
            </dl>
          </section>

          <RepartoCartera inversiones={active} />

          <section className="inversiones-grid">
            {active.map((inv, i) => (
              <InvestmentCard key={inv.id} investment={inv} index={i} />
            ))}
          </section>
        </>
      )}

      {creating && <InvestmentModal investment={null} onClose={() => setCreating(false)} onSaved={bump} />}
      {precios && <PreciosModal onClose={() => setPrecios(false)} onSaved={bump} />}
    </div>
  )
}
