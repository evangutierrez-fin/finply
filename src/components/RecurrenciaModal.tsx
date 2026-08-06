import { useEffect, useMemo, useState } from 'react'
import type {
  Account, Category, Frecuencia, Investment, ModoMonto, Recurrencia, Tag, TxType,
} from '../../shared/types.ts'
import { api } from '../api.ts'
import { fmtDateAnio, fmtMoney, parseAmount, todayISO } from '../format.ts'
import { finEfectivo, ocurrencias } from '../../shared/recurrencias.ts'
import { useApp } from '../context.ts'
import { Cadencia, reglaDesde, type ValoresCadencia } from './Cadencia.tsx'
import { Modal } from './Modal.tsx'

const TYPES: { id: TxType; label: string }[] = [
  { id: 'gasto', label: 'Gasto' },
  { id: 'ingreso', label: 'Ingreso' },
  { id: 'transferencia', label: 'Transferencia' },
]

export function RecurrenciaModal({
  recurrencia,
  onClose,
  onSaved,
}: {
  recurrencia: Recurrencia | null
  onClose: () => void
  onSaved: () => void
}) {
  const { profile, stamp } = useApp()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [tags, setTags] = useState<Tag[]>([])

  const [type, setType] = useState<TxType>(recurrencia?.type ?? 'gasto')
  const [amount, setAmount] = useState(
    recurrencia ? (recurrencia.amountCents / 100).toFixed(2) : '',
  )
  const [accountId, setAccountId] = useState(recurrencia?.accountId ?? 0)
  const [transferAccountId, setTransferAccountId] = useState(recurrencia?.transferAccountId ?? 0)
  const [categoryId, setCategoryId] = useState(recurrencia?.categoryId ?? 0)
  const [note, setNote] = useState(recurrencia?.note ?? '')
  const [tagIds, setTagIds] = useState<number[]>(recurrencia?.tags.map((t) => t.id) ?? [])
  const [frequency, setFrequency] = useState<Frecuencia>(recurrencia?.frequency ?? 'mensual')
  const [dayOfMonth, setDayOfMonth] = useState(recurrencia?.dayOfMonth ?? 1)
  const [dayOfMonth2, setDayOfMonth2] = useState(recurrencia?.dayOfMonth2 ?? 31)
  const [monthOfYear, setMonthOfYear] = useState(recurrencia?.monthOfYear ?? 1)
  const [weekday, setWeekday] = useState(recurrencia?.weekday ?? 1)
  const [startDate, setStartDate] = useState(recurrencia?.startDate ?? todayISO())
  const [endDate, setEndDate] = useState(recurrencia?.endDate ?? '')
  const [investments, setInvestments] = useState<Investment[]>([])
  const [investmentId, setInvestmentId] = useState(recurrencia?.investmentId ?? 0)
  const [amountMode, setAmountMode] = useState<ModoMonto>(recurrencia?.amountMode ?? 'fijo')
  const [pausedFrom, setPausedFrom] = useState(recurrencia?.pausedFrom ?? '')
  const [pausedUntil, setPausedUntil] = useState(recurrencia?.pausedUntil ?? '')
  const [tope, setTope] = useState(
    recurrencia?.maxOccurrences ? String(recurrencia.maxOccurrences) : '',
  )
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    Promise.all([
      api.accounts.list(profile.id),
      api.categories.list(profile.id),
      api.tags.list(profile.id),
      api.investments.list(profile.id),
    ]).then(
      ([accs, cats, tgs, invs]) => {
        setAccounts(accs)
        setCategories(cats)
        setTags(tgs)
        setInvestments(invs.filter((i) => !i.archived || i.id === recurrencia?.investmentId))
        const activas = accs.filter((a) => !a.archived)
        if (!recurrencia && activas.length > 0) setAccountId((id) => id || activas[0]!.id)
      },
      (err: Error) => setError(err.message),
    )
  }, [profile.id, recurrencia])

  const kind = type === 'ingreso' ? 'ingreso' : 'gasto'
  const opciones = useMemo(() => categories.filter((c) => c.kind === kind), [categories, kind])
  const seleccionables = useMemo(
    () => accounts.filter((a) => !a.archived || a.id === recurrencia?.accountId),
    [accounts, recurrencia],
  )

  const cadencia: ValoresCadencia = { frequency, dayOfMonth, dayOfMonth2, monthOfYear, weekday }
  const maxOccurrences = /^\d{1,3}$/.test(tope.trim()) ? Number(tope.trim()) : null
  // Lo que viaja al servidor es solo la cadencia; la pausa y el tope van por su
  // cuenta en el draft, con sus nombres de la API.
  const cadenciaRegla = reglaDesde(cadencia, startDate, endDate)
  // La previa, en cambio, sí los necesita adentro: cuenta lo que el servidor va
  // a proponer, y proponer con una pausa es proponer menos.
  const regla = {
    ...cadenciaRegla,
    pausadaDesde: pausedFrom && pausedUntil ? pausedFrom : null,
    pausadaHasta: pausedFrom && pausedUntil ? pausedUntil : null,
    maxOcurrencias: maxOccurrences,
  }
  const cambiarCadencia = (c: Partial<ValoresCadencia>) => {
    if (c.frequency !== undefined) setFrequency(c.frequency)
    if (c.dayOfMonth !== undefined) setDayOfMonth(c.dayOfMonth)
    if (c.dayOfMonth2 !== undefined) setDayOfMonth2(c.dayOfMonth2)
    if (c.monthOfYear !== undefined) setMonthOfYear(c.monthOfYear)
    if (c.weekday !== undefined) setWeekday(c.weekday)
  }

  /**
   * El aviso de D8: una plantilla propone **todo** desde su fecha de inicio,
   * y el usuario tiene que saber cuántas partidas va a encontrarse antes de
   * guardar. Sale del mismo módulo puro que usa el servidor, así que el número
   * no puede diferir del que aparezca en la bandeja.
   */
  const previa = useMemo(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return null
    const { lista, truncado } = ocurrencias(regla, { hasta: todayISO() })
    return {
      cuantas: lista.length,
      primera: lista[0]?.fecha ?? null,
      truncado,
      // Con tope, cuándo se acaba. Es la cifra que el usuario quiere ver: "12
      // ocurrencias" no dice en qué mes deja de aparecer.
      ultima: finEfectivo(regla),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    frequency, dayOfMonth, dayOfMonth2, monthOfYear, weekday, startDate, endDate,
    pausedFrom, pausedUntil, tope,
  ])

  const toggleTag = (id: number) =>
    setTagIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const cents = parseAmount(amount)
    if (!cents) return setError('Escribe un monto válido, por ejemplo 250 o 1,250.50')
    if (!accountId) return setError('Elige una cuenta')
    if (type === 'transferencia' && !transferAccountId) return setError('Elige la cuenta destino')
    if (tope.trim() !== '' && maxOccurrences === null) {
      return setError('El tope va en veces enteras, de 1 a 600')
    }
    if ((pausedFrom ? 1 : 0) + (pausedUntil ? 1 : 0) === 1) {
      return setError('La pausa necesita sus dos fechas: desde cuándo y hasta cuándo')
    }
    if (pausedFrom && pausedUntil && pausedUntil < pausedFrom) {
      return setError('La pausa termina antes de empezar')
    }
    setSaving(true)
    setError(null)
    try {
      const draft = {
        profileId: profile.id,
        accountId,
        type,
        amountCents: cents,
        categoryId: type === 'transferencia' ? null : categoryId || null,
        transferAccountId: type === 'transferencia' ? transferAccountId : null,
        note,
        ...cadenciaRegla,
        tagIds,
        investmentId: type === 'gasto' ? investmentId || null : null,
        amountMode,
        pausedFrom: pausedFrom || null,
        pausedUntil: pausedUntil || null,
        maxOccurrences,
        archived: recurrencia?.archived ?? false,
      }
      if (recurrencia) await api.recurrencias.update(recurrencia.id, draft)
      else await api.recurrencias.create(draft)
      stamp(recurrencia ? 'Guardada' : 'Creada')
      onSaved()
      onClose()
    } catch (err) {
      setError((err as Error).message)
      setSaving(false)
    }
  }

  return (
    <Modal title={recurrencia ? 'Editar recurrencia' : 'Nueva recurrencia'} onClose={onClose}>
      <form className="forma" onSubmit={submit}>
        <div className="seg" role="radiogroup" aria-label="Tipo de movimiento">
          {TYPES.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={type === t.id}
              className={`seg-item seg-${t.id}${type === t.id ? ' activa' : ''}`}
              onClick={() => {
                setType(t.id)
                setCategoryId(0)
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        <label className="campo campo-monto">
          <span className="campo-label">
            {amountMode === 'promedio' ? 'Monto de arranque' : 'Monto'}
          </span>
          <div className="monto-wrap">
            <span className="monto-signo" aria-hidden="true">$</span>
            <input
              className="campo-input monto"
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              autoFocus
            />
          </div>
        </label>

        {/* El recibo de luz nunca llega igual. El modo variable no es "sin
            monto": es de dónde sale el que se propone. El fijo se queda como
            monto de arranque, para mientras no haya historial que promediar. */}
        <div className="seg seg-chico" role="radiogroup" aria-label="De dónde sale el monto">
          <button
            type="button"
            role="radio"
            aria-checked={amountMode === 'fijo'}
            className={`seg-item${amountMode === 'fijo' ? ' activa' : ''}`}
            onClick={() => setAmountMode('fijo')}
          >
            Siempre el mismo
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={amountMode === 'promedio'}
            className={`seg-item${amountMode === 'promedio' ? ' activa' : ''}`}
            onClick={() => setAmountMode('promedio')}
          >
            Varía cada vez
          </button>
        </div>
        {amountMode === 'promedio' && (
          <p className="forma-nota">
            Cada propuesta va a traer el <strong>promedio de las últimas 3 que asentaste</strong>,
            no este monto. Mientras no haya ninguna, propone el de arriba. Sigue siendo una
            propuesta: el recibo real se escribe al confirmar.
            {recurrencia && recurrencia.muestrasPromedio > 0 && (
              <>
                {' '}Hoy propondría <strong>{fmtMoney(recurrencia.montoPropuestoCents)}</strong>, de{' '}
                {recurrencia.muestrasPromedio}{' '}
                {recurrencia.muestrasPromedio === 1 ? 'asentada' : 'asentadas'}.
              </>
            )}
          </p>
        )}

        <div className="campos-2">
          <label className="campo">
            <span className="campo-label">{type === 'transferencia' ? 'De la cuenta' : 'Cuenta'}</span>
            <select
              className="campo-input"
              value={accountId}
              onChange={(e) => setAccountId(Number(e.target.value))}
            >
              <option value={0} disabled>Elige…</option>
              {seleccionables.map((a) => (
                <option key={a.id} value={a.id}>{a.name}{a.archived ? ' (archivada)' : ''}</option>
              ))}
            </select>
          </label>

          {type === 'transferencia' ? (
            <label className="campo">
              <span className="campo-label">A la cuenta</span>
              <select
                className="campo-input"
                value={transferAccountId}
                onChange={(e) => setTransferAccountId(Number(e.target.value))}
              >
                <option value={0} disabled>Elige…</option>
                {seleccionables
                  .filter((a) => a.id !== accountId)
                  .map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
              </select>
            </label>
          ) : (
            <label className="campo">
              <span className="campo-label">Categoría</span>
              <select
                className="campo-input"
                value={categoryId}
                onChange={(e) => setCategoryId(Number(e.target.value))}
              >
                <option value={0}>Sin categoría</option>
                {opciones.map((cat) => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
              </select>
            </label>
          )}
        </div>

        <label className="campo">
          <span className="campo-label">Concepto</span>
          <input
            className="campo-input"
            placeholder="Ej. Renta, Netflix, colegiatura"
            maxLength={200}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>

        {/* Aportar a una inversión es un gasto de la cuenta hacia ella, así que
            solo aparece en un gasto. Al asentar se registra también el aporte y
            los dos quedan ligados. */}
        {type === 'gasto' && investments.length > 0 && (
          <>
            <label className="campo">
              <span className="campo-label">¿Es un aporte a una inversión? (opcional)</span>
              <select
                className="campo-input"
                value={investmentId}
                onChange={(e) => setInvestmentId(Number(e.target.value))}
              >
                <option value={0}>No, es un gasto normal</option>
                {investments.map((i) => (
                  <option key={i.id} value={i.id}>{i.name}</option>
                ))}
              </select>
            </label>
            {investmentId > 0 && (
              <p className="forma-nota">
                Al confirmar cada propuesta se registra además el aporte, y la partida queda ligada
                a él: no cuenta como gasto del mes, porque pasar dinero de tu cuenta a tu inversión
                no es gastarlo. Si anulas el movimiento, el aporte se va con él y el periodo vuelve
                a la bandeja.
              </p>
            )}
          </>
        )}

        <Cadencia valores={cadencia} onChange={cambiarCadencia} />

        <div className="campos-2">
          <label className="campo">
            <span className="campo-label">Desde</span>
            <input
              type="date"
              className="campo-input"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </label>
          <label className="campo">
            <span className="campo-label">Hasta (opcional)</span>
            <input
              type="date"
              className="campo-input"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </label>
        </div>

        {/* Doce mensualidades de un curso son doce. Cuenta las que de verdad
            caen, así que una pausa en medio corre el final en vez de
            comerse dos. */}
        <label className="campo">
          <span className="campo-label">Termina tras N veces (opcional)</span>
          <input
            className="campo-input"
            inputMode="numeric"
            placeholder="Ej. 12"
            value={tope}
            onChange={(e) => setTope(e.target.value)}
          />
        </label>

        {/* Pausar no es archivar. Archivar calla la plantilla entera y al
            desarchivarla vuelve el histórico completo; una pausa declara un
            hueco, y lo que cae dentro no propone nunca. */}
        <fieldset className="campo campo-fieldset">
          <legend className="campo-label">Pausa (opcional)</legend>
          <div className="campos-2">
            <label className="campo">
              <span className="campo-label">Desde</span>
              <input
                type="date"
                className="campo-input"
                value={pausedFrom}
                onChange={(e) => setPausedFrom(e.target.value)}
              />
            </label>
            <label className="campo">
              <span className="campo-label">Hasta</span>
              <input
                type="date"
                className="campo-input"
                value={pausedUntil}
                onChange={(e) => setPausedUntil(e.target.value)}
              />
            </label>
          </div>
          <p className="forma-nota">
            Lo que caiga en esas fechas <strong>no se propone nunca</strong>: no es un atraso que se
            acumule, es un hueco. Dos meses sin colegiatura no son dos colegiaturas pendientes.
            {pausedFrom && pausedUntil && (
              <> Se salta lo del {fmtDateAnio(pausedFrom)} al {fmtDateAnio(pausedUntil)}.</>
            )}
          </p>
        </fieldset>

        <fieldset className="campo campo-fieldset">
          <legend className="campo-label">Etiquetas</legend>
          {tags.length > 0 ? (
            <div className="etiquetas-picker">
              {tags.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={tagIds.includes(t.id)}
                  className={`chip chip-etiqueta chip-boton${tagIds.includes(t.id) ? ' activa' : ''}`}
                  onClick={() => toggleTag(t.id)}
                >
                  {t.name}
                </button>
              ))}
            </div>
          ) : (
            <p className="forma-nota">Todavía no hay etiquetas en este perfil.</p>
          )}
        </fieldset>

        {previa && (
          <p className="rec-previa" role="status">
            {previa.cuantas === 0 ? (
              <>Todavía no hay nada vencido. La primera propuesta llegará a su fecha.</>
            ) : recurrencia ? (
              // ⚠ Editando, "vas a encontrar N por confirmar" mentía: contaba
              // **todos** los periodos vencidos, incluidos los que esta
              // plantilla ya tiene asentados. El aviso de D8 se escribió para
              // crear, donde no hay historial y las dos cifras coinciden.
              <>
                Esta plantilla cubre{' '}
                <strong>
                  {previa.cuantas} {previa.cuantas === 1 ? 'periodo' : 'periodos'} hasta hoy
                </strong>
                , desde el {fmtDateAnio(previa.primera!)}. De esos,{' '}
                <strong>
                  {recurrencia.pendientes}{' '}
                  {recurrencia.pendientes === 1 ? 'sigue' : 'siguen'} sin resolver
                </strong>
                ; lo ya asentado no se toca.
              </>
            ) : (
              <>
                Al guardar vas a encontrar{' '}
                <strong>
                  {previa.cuantas} {previa.cuantas === 1 ? 'partida' : 'partidas'} por confirmar
                </strong>
                , desde el {fmtDateAnio(previa.primera!)}
                {previa.truncado && ' (y más, de tantas que son)'}. Ninguna se asienta sola:
                tú decides cuáles entran al libro.
                {amountMode === 'fijo' && parseAmount(amount) && (
                  <> Suman {fmtMoney(previa.cuantas * parseAmount(amount)!)}.</>
                )}
              </>
            )}
            {/* Con tope, la fecha es la respuesta: "12 veces" no dice en qué
                mes deja de aparecer. Sale del mismo módulo puro que el
                servidor, así que no puede diferir de lo que va a proponer. */}
            {maxOccurrences !== null && previa.ultima && (
              <>
                {' '}La última cae el <strong>{fmtDateAnio(previa.ultima)}</strong>, y después esta
                plantilla ya no propone nada.
              </>
            )}
          </p>
        )}

        {error && <p className="forma-error" role="alert">{error}</p>}

        <footer className="forma-pie">
          <button type="button" className="btn btn-fantasma" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primario" disabled={saving}>
            {saving ? 'Guardando…' : recurrencia ? 'Guardar cambios' : 'Crear recurrencia'}
          </button>
        </footer>
      </form>
    </Modal>
  )
}
