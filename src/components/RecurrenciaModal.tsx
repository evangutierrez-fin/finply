import { useEffect, useMemo, useState } from 'react'
import type { Account, Category, Frecuencia, Recurrencia, Tag, TxType } from '../../shared/types.ts'
import { api } from '../api.ts'
import { fmtDateAnio, fmtMoney, MESES, parseAmount, todayISO } from '../format.ts'
import { ocurrencias } from '../../shared/recurrencias.ts'
import { useApp } from '../context.ts'
import { Modal } from './Modal.tsx'

const TYPES: { id: TxType; label: string }[] = [
  { id: 'gasto', label: 'Gasto' },
  { id: 'ingreso', label: 'Ingreso' },
  { id: 'transferencia', label: 'Transferencia' },
]

const FRECUENCIAS: { id: Frecuencia; label: string }[] = [
  { id: 'mensual', label: 'Cada mes' },
  { id: 'quincenal', label: 'Cada quincena' },
  { id: 'semanal', label: 'Cada semana' },
  { id: 'anual', label: 'Cada año' },
]

const DIAS_SEMANA = [
  { id: 1, label: 'lunes' },
  { id: 2, label: 'martes' },
  { id: 3, label: 'miércoles' },
  { id: 4, label: 'jueves' },
  { id: 5, label: 'viernes' },
  { id: 6, label: 'sábado' },
  { id: 7, label: 'domingo' },
]

/** 1–31, con el 31 marcado como "el último" porque en febrero cae el 28. */
const DIAS_MES = Array.from({ length: 31 }, (_, i) => ({
  id: i + 1,
  label: i + 1 === 31 ? 'el último día' : String(i + 1),
}))

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
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    Promise.all([
      api.accounts.list(profile.id),
      api.categories.list(profile.id),
      api.tags.list(profile.id),
    ]).then(
      ([accs, cats, tgs]) => {
        setAccounts(accs)
        setCategories(cats)
        setTags(tgs)
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

  const regla = {
    frequency,
    dayOfMonth: frequency === 'semanal' ? null : dayOfMonth,
    dayOfMonth2: frequency === 'quincenal' ? dayOfMonth2 : null,
    monthOfYear: frequency === 'anual' ? monthOfYear : null,
    weekday: frequency === 'semanal' ? weekday : null,
    startDate,
    endDate: endDate || null,
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
    return { cuantas: lista.length, primera: lista[0]?.fecha ?? null, truncado }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frequency, dayOfMonth, dayOfMonth2, monthOfYear, weekday, startDate, endDate])

  const toggleTag = (id: number) =>
    setTagIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const cents = parseAmount(amount)
    if (!cents) return setError('Escribe un monto válido, por ejemplo 250 o 1,250.50')
    if (!accountId) return setError('Elige una cuenta')
    if (type === 'transferencia' && !transferAccountId) return setError('Elige la cuenta destino')
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
        ...regla,
        tagIds,
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
          <span className="campo-label">Monto</span>
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

        <fieldset className="campo campo-fieldset rec-cadencia">
          <legend className="campo-label">Cada cuándo</legend>
          <div className="seg seg-4" role="radiogroup" aria-label="Periodicidad">
            {FRECUENCIAS.map((f) => (
              <button
                key={f.id}
                type="button"
                role="radio"
                aria-checked={frequency === f.id}
                className={`seg-item${frequency === f.id ? ' activa' : ''}`}
                onClick={() => setFrequency(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="campos-2 rec-dias">
            {frequency === 'semanal' && (
              <label className="campo">
                <span className="campo-label">Día de la semana</span>
                <select
                  className="campo-input"
                  value={weekday}
                  onChange={(e) => setWeekday(Number(e.target.value))}
                >
                  {DIAS_SEMANA.map((d) => (
                    <option key={d.id} value={d.id}>{d.label}</option>
                  ))}
                </select>
              </label>
            )}

            {frequency === 'anual' && (
              <label className="campo">
                <span className="campo-label">Mes</span>
                <select
                  className="campo-input"
                  value={monthOfYear}
                  onChange={(e) => setMonthOfYear(Number(e.target.value))}
                >
                  {MESES.map((m, i) => (
                    <option key={m} value={i + 1}>{m}</option>
                  ))}
                </select>
              </label>
            )}

            {frequency !== 'semanal' && (
              <label className="campo">
                <span className="campo-label">
                  {frequency === 'quincenal' ? 'Primera quincena' : 'Día del mes'}
                </span>
                <select
                  className="campo-input"
                  value={dayOfMonth}
                  onChange={(e) => setDayOfMonth(Number(e.target.value))}
                >
                  {DIAS_MES.map((d) => (
                    <option key={d.id} value={d.id}>{d.label}</option>
                  ))}
                </select>
              </label>
            )}

            {frequency === 'quincenal' && (
              <label className="campo">
                <span className="campo-label">Segunda quincena</span>
                <select
                  className="campo-input"
                  value={dayOfMonth2}
                  onChange={(e) => setDayOfMonth2(Number(e.target.value))}
                >
                  {DIAS_MES.map((d) => (
                    <option key={d.id} value={d.id}>{d.label}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <p className="forma-nota rec-nota-dia">
            El día 31 cae el último de cada mes: en febrero, el 28.
          </p>
        </fieldset>

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
            ) : (
              <>
                Al guardar vas a encontrar{' '}
                <strong>
                  {previa.cuantas} {previa.cuantas === 1 ? 'partida' : 'partidas'} por confirmar
                </strong>
                , desde el {fmtDateAnio(previa.primera!)}
                {previa.truncado && ' (y más, de tantas que son)'}. Ninguna se asienta sola:
                tú decides cuáles entran al libro.
                {parseAmount(amount) && (
                  <> Suman {fmtMoney(previa.cuantas * parseAmount(amount)!)}.</>
                )}
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
