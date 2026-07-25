import { useEffect, useMemo, useState } from 'react'
import type { Account, Category, Tx, TxType } from '../../shared/types.ts'
import { api } from '../api.ts'
import { parseAmount, todayISO } from '../format.ts'
import { useApp } from '../context.ts'
import { Modal } from './Modal.tsx'

const TYPES: { id: TxType; label: string }[] = [
  { id: 'gasto', label: 'Gasto' },
  { id: 'ingreso', label: 'Ingreso' },
  { id: 'transferencia', label: 'Transferencia' },
]

export function TxModal({
  tx,
  onClose,
  onSaved,
}: {
  tx: Tx | null
  onClose: () => void
  onSaved: () => void
}) {
  const { profile, stamp } = useApp()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [type, setType] = useState<TxType>(tx?.type ?? 'gasto')
  const [amount, setAmount] = useState(tx ? (tx.amountCents / 100).toFixed(2) : '')
  const [accountId, setAccountId] = useState<number>(tx?.accountId ?? 0)
  const [transferAccountId, setTransferAccountId] = useState<number>(tx?.transferAccountId ?? 0)
  const [categoryId, setCategoryId] = useState<number>(tx?.categoryId ?? 0)
  const [date, setDate] = useState(tx?.date ?? todayISO())
  const [note, setNote] = useState(tx?.note ?? '')
  const [newCategory, setNewCategory] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    Promise.all([api.accounts.list(profile.id), api.categories.list(profile.id)]).then(
      ([accs, cats]) => {
        setAccounts(accs)
        setCategories(cats)
        const active = accs.filter((a) => !a.archived)
        if (!tx && active.length > 0) setAccountId((id) => id || active[0]!.id)
      },
      (err: Error) => setError(err.message),
    )
  }, [profile.id, tx])

  const kind = type === 'ingreso' ? 'ingreso' : 'gasto'
  const options = useMemo(
    () => categories.filter((c) => c.kind === kind),
    [categories, kind],
  )

  // Al editar, la cuenta original aparece aunque esté archivada.
  const selectable = useMemo(
    () =>
      accounts.filter(
        (a) => !a.archived || a.id === tx?.accountId || a.id === tx?.transferAccountId,
      ),
    [accounts, tx],
  )

  // Los movimientos que nacieron de un abono o una inversión mantienen su tipo;
  // monto y fecha se sincronizan con ese registro en el servidor.
  const linked = Boolean(tx && (tx.debtPaymentId || tx.investmentEntryId))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const cents = parseAmount(amount)
    if (!cents) return setError('Escribe un monto válido, por ejemplo 250 o 1,250.50')
    if (!accountId) return setError('Elige una cuenta')
    setSaving(true)
    setError(null)
    try {
      let catId = categoryId || null
      if (newCategory && newCategory.trim()) {
        const created = await api.categories.create({
          profileId: profile.id,
          name: newCategory.trim(),
          kind,
        })
        catId = created.id
      }
      const draft = {
        profileId: profile.id,
        accountId,
        type,
        amountCents: cents,
        date,
        categoryId: type === 'transferencia' ? null : catId,
        note,
        transferAccountId: type === 'transferencia' ? transferAccountId || null : null,
      }
      if (tx) await api.tx.update(tx.id, draft)
      else await api.tx.create(draft)
      stamp('Registrado')
      onSaved()
      onClose()
    } catch (err) {
      setError((err as Error).message)
      setSaving(false)
    }
  }

  return (
    <Modal title={tx ? 'Corregir movimiento' : 'Nuevo movimiento'} onClose={onClose}>
      <form className="forma" onSubmit={submit}>
        <div className="seg" role="radiogroup" aria-label="Tipo de movimiento">
          {TYPES.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={type === t.id}
              disabled={linked}
              className={`seg-item seg-${t.id}${type === t.id ? ' activa' : ''}`}
              onClick={() => {
                setType(t.id)
                setCategoryId(0)
                setNewCategory(null)
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        {linked && (
          <p className="forma-nota">
            Este movimiento está ligado a {tx?.debtPaymentId ? 'un abono de deuda' : 'una inversión'}:
            monto y fecha se sincronizan con ese registro y el tipo no puede cambiar.
          </p>
        )}

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
              {selectable.map((a) => (
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
                {selectable
                  .filter((a) => a.id !== accountId)
                  .map((a) => (
                    <option key={a.id} value={a.id}>{a.name}{a.archived ? ' (archivada)' : ''}</option>
                  ))}
              </select>
            </label>
          ) : (
            <label className="campo">
              <span className="campo-label">Categoría</span>
              {newCategory === null ? (
                <select
                  className="campo-input"
                  value={categoryId}
                  onChange={(e) => {
                    if (e.target.value === '__nueva') {
                      setNewCategory('')
                    } else {
                      setCategoryId(Number(e.target.value))
                    }
                  }}
                >
                  <option value={0}>Sin categoría</option>
                  {options.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                  <option value="__nueva">＋ Nueva categoría…</option>
                </select>
              ) : (
                <div className="campo-inline">
                  <input
                    className="campo-input"
                    placeholder="Nombre de la categoría"
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                    autoFocus
                  />
                  <button type="button" className="btn-liga" onClick={() => setNewCategory(null)}>
                    Cancelar
                  </button>
                </div>
              )}
            </label>
          )}
        </div>

        <div className="campos-2">
          <label className="campo">
            <span className="campo-label">Fecha</span>
            <input
              type="date"
              className="campo-input"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label className="campo">
            <span className="campo-label">Concepto</span>
            <input
              className="campo-input"
              placeholder="Ej. Súper semanal"
              maxLength={200}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
        </div>

        {error && <p className="forma-error" role="alert">{error}</p>}

        <footer className="forma-pie">
          <button type="button" className="btn btn-fantasma" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primario" disabled={saving}>
            {saving ? 'Guardando…' : tx ? 'Guardar cambios' : 'Guardar movimiento'}
          </button>
        </footer>
      </form>
    </Modal>
  )
}
