import { useEffect, useState } from 'react'
import type { Account, DebtDirection } from '../../shared/types.ts'
import { api } from '../api.ts'
import { fmtMoney, parseAmount, parseTasa, todayISO } from '../format.ts'
import { tablaAmortizacion } from '../../shared/credito.ts'
import { useApp } from '../context.ts'
import { Modal } from './Modal.tsx'

export function DebtModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { profile, stamp } = useApp()
  const [direction, setDirection] = useState<DebtDirection>('por_cobrar')
  const [counterparty, setCounterparty] = useState('')
  const [concept, setConcept] = useState('')
  const [principal, setPrincipal] = useState('')
  const [startDate, setStartDate] = useState(todayISO())
  const [dueDate, setDueDate] = useState('')
  const [tasa, setTasa] = useState('')
  const [plazo, setPlazo] = useState('')
  const [accounts, setAccounts] = useState<Account[]>([])
  // Por omisión no se mueve el libro: el movimiento se asienta solo si el
  // usuario elige la cuenta a propósito (R4).
  const [accountId, setAccountId] = useState(0)
  const [enganche, setEnganche] = useState('')
  const [engancheAccountId, setEngancheAccountId] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.accounts.list(profile.id).then(
      (accs) => setAccounts(accs.filter((a) => !a.archived)),
      (err: Error) => setError(err.message),
    )
  }, [profile.id])

  // La misma aritmética que usará el servidor, para que el pago mensual se
  // vea antes de guardar.
  const centsPrevia = parseAmount(principal)
  const engancheCents = enganche.trim() === '' ? 0 : parseAmount(enganche)
  const bpPrevia = parseTasa(tasa)
  const mesesPrevia = /^\d{1,3}$/.test(plazo.trim()) ? Number(plazo.trim()) : 0
  const previa =
    centsPrevia && bpPrevia !== null && mesesPrevia >= 1 && mesesPrevia <= 600
      ? tablaAmortizacion({
          principalCents: centsPrevia,
          annualRateBp: bpPrevia,
          termMonths: mesesPrevia,
          startDate,
        })
      : null

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const cents = parseAmount(principal)
    if (!cents) return setError('Escribe el monto de la deuda')
    if (!counterparty.trim()) return setError('¿Con quién es la deuda?')
    const annualRateBp = parseTasa(tasa)
    if (annualRateBp === null) return setError('La tasa anual no es válida (ej. 24.5)')
    const plazoLimpio = plazo.trim()
    if (plazoLimpio !== '' && !/^\d{1,3}$/.test(plazoLimpio)) {
      return setError('El plazo va en meses enteros')
    }
    const termMonths = plazoLimpio === '' ? null : Number(plazoLimpio)
    if (termMonths !== null && (termMonths < 1 || termMonths > 600)) {
      return setError('El plazo va de 1 a 600 meses')
    }
    const downPaymentCents = enganche.trim() === '' ? 0 : parseAmount(enganche)
    if (downPaymentCents === null) return setError('El enganche no es un monto válido')
    if (engancheAccountId && downPaymentCents === 0) {
      return setError('Elegiste cuenta para el enganche pero no escribiste su monto')
    }
    setSaving(true)
    setError(null)
    try {
      await api.debts.create({
        profileId: profile.id,
        direction,
        counterparty: counterparty.trim(),
        concept: concept.trim(),
        principalCents: cents,
        startDate,
        dueDate: dueDate || null,
        annualRateBp,
        termMonths,
        accountId: accountId || null,
        downPaymentCents,
        downPaymentAccountId: engancheAccountId || null,
      })
      stamp('Apuntada')
      onSaved()
      onClose()
    } catch (err) {
      setError((err as Error).message)
      setSaving(false)
    }
  }

  return (
    <Modal title="Apuntar deuda" onClose={onClose}>
      <form className="forma" onSubmit={submit}>
        <div className="seg" role="radiogroup" aria-label="Dirección de la deuda">
          <button
            type="button"
            role="radio"
            aria-checked={direction === 'por_cobrar'}
            className={`seg-item seg-ingreso${direction === 'por_cobrar' ? ' activa' : ''}`}
            onClick={() => setDirection('por_cobrar')}
          >
            Me deben
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={direction === 'por_pagar'}
            className={`seg-item seg-gasto${direction === 'por_pagar' ? ' activa' : ''}`}
            onClick={() => setDirection('por_pagar')}
          >
            Debo
          </button>
        </div>
        <div className="campos-2">
          <label className="campo">
            <span className="campo-label">{direction === 'por_cobrar' ? 'Quién te debe' : 'A quién le debes'}</span>
            <input
              className="campo-input"
              placeholder="Nombre o negocio"
              value={counterparty}
              onChange={(e) => setCounterparty(e.target.value)}
              autoFocus
            />
          </label>
          <label className="campo">
            <span className="campo-label">Monto</span>
            <div className="monto-wrap">
              <span className="monto-signo" aria-hidden="true">$</span>
              <input
                className="campo-input"
                inputMode="decimal"
                placeholder="0.00"
                value={principal}
                onChange={(e) => setPrincipal(e.target.value)}
              />
            </div>
          </label>
        </div>
        <label className="campo">
          <span className="campo-label">Concepto</span>
          <input
            className="campo-input"
            placeholder="Ej. Préstamo, corte de tarjeta, pedido"
            value={concept}
            onChange={(e) => setConcept(e.target.value)}
          />
        </label>
        <div className="campos-2">
          <label className="campo">
            <span className="campo-label">Fecha de inicio</span>
            <input
              type="date"
              className="campo-input"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </label>
          <label className="campo">
            <span className="campo-label">Vence (opcional)</span>
            <input
              type="date"
              className="campo-input"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </label>
        </div>
        <div className="campos-2">
          <label className="campo">
            <span className="campo-label">Tasa anual (opcional)</span>
            <div className="monto-wrap">
              <input
                className="campo-input"
                inputMode="decimal"
                placeholder="0"
                value={tasa}
                onChange={(e) => setTasa(e.target.value)}
              />
              <span className="monto-signo" aria-hidden="true">%</span>
            </div>
          </label>
          <label className="campo">
            <span className="campo-label">Plazo en meses (opcional)</span>
            <input
              className="campo-input"
              inputMode="numeric"
              placeholder="Ej. 12"
              value={plazo}
              onChange={(e) => setPlazo(e.target.value)}
            />
          </label>
        </div>
        <label className="campo">
          <span className="campo-label">
            {direction === 'por_cobrar' ? 'Sale de la cuenta' : 'Entra a la cuenta'}
          </span>
          <select
            className="campo-input"
            value={accountId}
            onChange={(e) => setAccountId(Number(e.target.value))}
          >
            <option value={0}>Solo apuntar (sin movimiento)</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </label>
        <p className="forma-nota">
          {accountId ? (
            <>
              Se asienta {direction === 'por_cobrar' ? 'la salida' : 'la entrada'} de{' '}
              <strong className="cifra-chica">{fmtMoney(centsPrevia ?? 0)}</strong> en esa cuenta,
              con la fecha de inicio. Si ya registraste ese movimiento a mano, deja
              «solo apuntar» para no duplicarlo.
            </>
          ) : (
            <>
              El saldo de tus cuentas no se moverá. Elige una cuenta si el dinero{' '}
              {direction === 'por_cobrar' ? 'salió de' : 'entró a'} ella y quieres que quede
              asentado.
            </>
          )}
        </p>
        <div className="campos-2">
          <label className="campo">
            <span className="campo-label">
              Enganche {direction === 'por_cobrar' ? 'recibido' : 'que pusiste'} (opcional)
            </span>
            <div className="monto-wrap">
              <span className="monto-signo" aria-hidden="true">$</span>
              <input
                className="campo-input"
                inputMode="decimal"
                placeholder="0.00"
                value={enganche}
                onChange={(e) => setEnganche(e.target.value)}
              />
            </div>
          </label>
          <label className="campo">
            <span className="campo-label">
              {direction === 'por_cobrar' ? 'Entra a la cuenta' : 'Sale de la cuenta'}
            </span>
            <select
              className="campo-input"
              value={engancheAccountId}
              onChange={(e) => setEngancheAccountId(Number(e.target.value))}
            >
              <option value={0}>Solo apuntar (sin movimiento)</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </label>
        </div>
        {engancheCents !== null && engancheCents > 0 && centsPrevia && (
          <p className="forma-nota">
            Costo del bien: <strong className="cifra-chica">
              {fmtMoney(engancheCents + centsPrevia)}
            </strong>{' '}
            — {fmtMoney(engancheCents)} de enganche y {fmtMoney(centsPrevia)} financiados.
            El enganche no forma parte de la deuda.
          </p>
        )}
        {previa && (
          <p className="forma-nota">
            {previa.filas.length} pagos de{' '}
            <strong className="cifra-chica">{fmtMoney(previa.pagoMensualCents)}</strong>
            {previa.totalInteresCents > 0 && (
              <> · {fmtMoney(previa.totalInteresCents)} de intereses en total</>
            )}
          </p>
        )}
        {error && <p className="forma-error" role="alert">{error}</p>}
        <footer className="forma-pie">
          <button type="button" className="btn btn-fantasma" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primario" disabled={saving}>
            {saving ? 'Guardando…' : 'Apuntar deuda'}
          </button>
        </footer>
      </form>
    </Modal>
  )
}
