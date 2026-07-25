import { useState } from 'react'
import { api } from '../api.ts'
import { useApp } from '../context.ts'
import { useFetch } from '../hooks.ts'
import { fmtDate, fmtMoney, isPastDue } from '../format.ts'
import { Money } from '../components/Money.tsx'
import { DebtModal } from '../components/DebtModal.tsx'
import { AbonoModal } from '../components/AbonoModal.tsx'
import type { Debt } from '../../shared/types.ts'

function DebtCard({ debt, index }: { debt: Debt; index: number }) {
  const { bump, stamp } = useApp()
  const [showPayments, setShowPayments] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [abono, setAbono] = useState(false)

  const remaining = debt.principalCents - debt.paidCents
  const pct = Math.min(100, (debt.paidCents / debt.principalCents) * 100)
  const overdue = debt.status === 'abierta' && isPastDue(debt.dueDate)

  const remove = async () => {
    try {
      await api.debts.remove(debt.id)
      stamp('Borrada')
      bump()
    } catch (err) {
      alert((err as Error).message)
    }
  }

  const removePayment = async (paymentId: number) => {
    try {
      const payment = debt.payments.find((p) => p.id === paymentId)
      if (!payment) return
      await api.debts.removePayment(payment)
      stamp('Anulado')
      bump()
    } catch (err) {
      alert((err as Error).message)
    }
  }

  return (
    <article
      className={`hoja deuda${debt.status === 'saldada' ? ' saldada' : ''}`}
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <header className="deuda-head">
        <h3>{debt.counterparty}</h3>
        {debt.status === 'saldada' ? (
          <span className="sello-mini">Saldada</span>
        ) : debt.dueDate ? (
          <span className={`chip${overdue ? ' chip-rojo' : ''}`}>
            {overdue ? 'Venció' : 'Vence'} {fmtDate(debt.dueDate)}
          </span>
        ) : null}
      </header>
      {debt.concept && <p className="deuda-concepto">{debt.concept}</p>}

      <div className="deuda-riel" role="img" aria-label={`Abonado ${fmtMoney(debt.paidCents)} de ${fmtMoney(debt.principalCents)}`}>
        <span className="deuda-lleno" style={{ width: `${pct}%` }} />
      </div>
      <p className="deuda-cifras">
        {debt.status === 'saldada' ? (
          <>Se saldaron <Money cents={debt.principalCents} className="cifra-chica" /></>
        ) : (
          <>
            Restan <Money cents={remaining} className="cifra-chica deuda-restan" /> de{' '}
            <Money cents={debt.principalCents} className="cifra-chica" />
          </>
        )}
      </p>

      <footer className="deuda-pie">
        {debt.status === 'abierta' && (
          <button type="button" className="btn btn-primario btn-chico" onClick={() => setAbono(true)}>
            Abonar
          </button>
        )}
        {debt.payments.length > 0 && (
          <button type="button" className="btn-liga" onClick={() => setShowPayments((s) => !s)}>
            {showPayments ? 'Ocultar abonos' : `Abonos (${debt.payments.length})`}
          </button>
        )}
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
      </footer>

      {showPayments && (
        <ul className="abonos">
          {debt.payments.map((p) => (
            <li key={p.id}>
              <span className="abono-fecha">{fmtDate(p.date)}</span>
              <span className="abono-nota">{p.note || 'Abono'}</span>
              <Money cents={p.amountCents} className="cifra-chica" />
              <button
                type="button"
                className="accion"
                aria-label="Anular abono"
                onClick={() => removePayment(p.id)}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      {abono && <AbonoModal debt={debt} onClose={() => setAbono(false)} onSaved={bump} />}
    </article>
  )
}

export function Deudas() {
  const { profile, refreshKey, bump } = useApp()
  const [creating, setCreating] = useState(false)
  const { data: debts, error } = useFetch(() => api.debts.list(profile.id), [profile.id, refreshKey])

  const porCobrar = (debts ?? []).filter((d) => d.direction === 'por_cobrar')
  const porPagar = (debts ?? []).filter((d) => d.direction === 'por_pagar')
  const totalCobrar = porCobrar
    .filter((d) => d.status === 'abierta')
    .reduce((s, d) => s + d.principalCents - d.paidCents, 0)
  const totalPagar = porPagar
    .filter((d) => d.status === 'abierta')
    .reduce((s, d) => s + d.principalCents - d.paidCents, 0)

  return (
    <div className="vista">
      <header className="vista-head">
        <h1>Deudas</h1>
        <button type="button" className="btn btn-primario" onClick={() => setCreating(true)}>
          ＋ Apuntar deuda
        </button>
      </header>

      {error && <p className="aviso" role="alert">{error}</p>}

      {debts && debts.length === 0 ? (
        <div className="vacio">
          <p className="vacio-titulo">Sin deudas apuntadas.</p>
          <p className="vacio-sub">Apunta préstamos que hiciste, cortes de tarjeta o pedidos por cobrar, y registra cada abono.</p>
          <button type="button" className="btn btn-primario" onClick={() => setCreating(true)}>
            Apuntar la primera
          </button>
        </div>
      ) : (
        <div className="deudas-cols">
          <section>
            <header className="deudas-col-head">
              <h2 className="rotulo">Por cobrar · te deben</h2>
              <Money cents={totalCobrar} className="deudas-col-total" />
            </header>
            {porCobrar.length === 0 && <p className="grafica-vacia">Nadie te debe.</p>}
            {porCobrar.map((d, i) => (
              <DebtCard key={d.id} debt={d} index={i} />
            ))}
          </section>
          <section>
            <header className="deudas-col-head">
              <h2 className="rotulo">Por pagar · debes</h2>
              <Money cents={totalPagar} className="deudas-col-total" />
            </header>
            {porPagar.length === 0 && <p className="grafica-vacia">No debes nada.</p>}
            {porPagar.map((d, i) => (
              <DebtCard key={d.id} debt={d} index={i} />
            ))}
          </section>
        </div>
      )}

      {creating && <DebtModal onClose={() => setCreating(false)} onSaved={bump} />}
    </div>
  )
}
