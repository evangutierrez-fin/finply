import { useEffect, useState } from 'react'
import type { Account, Category } from '../../shared/types.ts'
import { api } from '../api.ts'
import { fmtMoney, parseAmount, todayISO } from '../format.ts'
import { useApp } from '../context.ts'
import { Modal } from './Modal.tsx'

const PLAZOS = [3, 6, 9, 12, 18, 24]

export function MsiModal({
  tarjetas,
  tarjetaId,
  onClose,
  onSaved,
}: {
  tarjetas: Account[]
  tarjetaId: number
  onClose: () => void
  onSaved: () => void
}) {
  const { profile, stamp } = useApp()
  const [accountId, setAccountId] = useState(tarjetaId)
  const [concept, setConcept] = useState('')
  const [total, setTotal] = useState('')
  const [months, setMonths] = useState(12)
  const [purchaseDate, setPurchaseDate] = useState(todayISO())
  const [categoryId, setCategoryId] = useState(0)
  const [categories, setCategories] = useState<Category[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.categories.list(profile.id).then(
      (cats) => setCategories(cats.filter((c) => c.kind === 'gasto')),
      (err: Error) => setError(err.message),
    )
  }, [profile.id])

  const cents = parseAmount(total)
  const parcialidad = cents ? Math.floor(cents / months) : null

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!cents) return setError('Escribe el monto de la compra')
    setSaving(true)
    setError(null)
    try {
      await api.tarjetas.msi.create({
        profileId: profile.id,
        accountId,
        concept: concept.trim(),
        totalCents: cents,
        months,
        purchaseDate,
        categoryId: categoryId || null,
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
    <Modal title="Compra a meses sin intereses" onClose={onClose}>
      <form className="forma" onSubmit={submit}>
        <p className="forma-nota">
          Se asienta un cargo por el total —tu línea de crédito se usa completa desde hoy— y
          Finply guarda el calendario de lo que te van a facturar en cada corte.
        </p>
        <div className="campos-2">
          <label className="campo">
            <span className="campo-label">Tarjeta</span>
            <select
              className="campo-input"
              value={accountId}
              onChange={(e) => setAccountId(Number(e.target.value))}
            >
              {tarjetas.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </label>
          <label className="campo">
            <span className="campo-label">Monto total</span>
            <div className="monto-wrap">
              <span className="monto-signo" aria-hidden="true">$</span>
              <input
                className="campo-input"
                inputMode="decimal"
                placeholder="0.00"
                value={total}
                onChange={(e) => setTotal(e.target.value)}
                autoFocus
              />
            </div>
          </label>
        </div>
        <label className="campo">
          <span className="campo-label">Concepto</span>
          <input
            className="campo-input"
            placeholder="Ej. Refrigerador, boletos, laptop"
            value={concept}
            onChange={(e) => setConcept(e.target.value)}
          />
        </label>
        <div className="campos-3">
          <label className="campo">
            <span className="campo-label">Plazo</span>
            <select
              className="campo-input"
              value={months}
              onChange={(e) => setMonths(Number(e.target.value))}
            >
              {PLAZOS.map((m) => (
                <option key={m} value={m}>{m} meses</option>
              ))}
            </select>
          </label>
          <label className="campo">
            <span className="campo-label">Fecha de compra</span>
            <input
              type="date"
              className="campo-input"
              value={purchaseDate}
              onChange={(e) => setPurchaseDate(e.target.value)}
            />
          </label>
          <label className="campo">
            <span className="campo-label">Categoría</span>
            <select
              className="campo-input"
              value={categoryId}
              onChange={(e) => setCategoryId(Number(e.target.value))}
            >
              <option value={0}>Sin categoría</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
        </div>
        {parcialidad !== null && (
          <p className="forma-nota msi-previa">
            {months} parcialidades de <strong className="cifra-chica">{fmtMoney(parcialidad)}</strong>
            {cents! % months !== 0 && ' (la última se lleva los centavos que sobran)'}
          </p>
        )}
        {error && <p className="forma-error" role="alert">{error}</p>}
        <footer className="forma-pie">
          <button type="button" className="btn btn-fantasma" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primario" disabled={saving}>
            {saving ? 'Guardando…' : 'Registrar compra'}
          </button>
        </footer>
      </form>
    </Modal>
  )
}
