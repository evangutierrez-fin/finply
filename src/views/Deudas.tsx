import { useState } from 'react'
import { api } from '../api.ts'
import { useApp } from '../context.ts'
import { useFetch } from '../hooks.ts'
import { fmtDate, fmtDateAnio, fmtMoney, fmtTasa, isPastDue, todayISO } from '../format.ts'
import { tablaAmortizacion } from '../../shared/credito.ts'
import { Money } from '../components/Money.tsx'
import { DebtModal } from '../components/DebtModal.tsx'
import { AbonoModal } from '../components/AbonoModal.tsx'
import type { Debt } from '../../shared/types.ts'

/** El plan de pagos, tal como lo calcula el servidor. */
function TablaAmortizacion({ debt }: { debt: Debt }) {
  const { data, error } = useFetch(() => api.debts.amortizacion(debt.id), [debt.id])

  if (error) return <p className="aviso" role="alert">{error}</p>
  if (!data) return <p className="cargando">Calculando…</p>

  return (
    <div className="amort-wrap">
      <table className="libro amort-tabla">
        <caption className="sr-only">
          Plan de pagos de {debt.counterparty}: capital e intereses mes a mes
        </caption>
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Fecha</th>
            <th scope="col">Pago</th>
            <th scope="col">Interés</th>
            <th scope="col">Capital</th>
            <th scope="col">Saldo</th>
          </tr>
        </thead>
        <tbody>
          {data.filas.map((f) => (
            <tr key={f.n}>
              <td>{f.n}</td>
              <td>{fmtDateAnio(f.fecha)}</td>
              <td>{fmtMoney(f.pagoCents)}</td>
              <td>{fmtMoney(f.interesCents)}</td>
              <td>{fmtMoney(f.capitalCents)}</td>
              <td>{fmtMoney(f.saldoCents)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2}>Totales</td>
            <td>{fmtMoney(data.totalPagadoCents)}</td>
            <td>{fmtMoney(data.totalInteresCents)}</td>
            <td colSpan={2}>{fmtMoney(debt.principalCents)} de capital</td>
          </tr>
        </tfoot>
      </table>
      <p className="amort-nota">
        Es el plan sobre el monto original desde la fecha de inicio. Tus abonos reales van por
        su cuenta, arriba.
      </p>
    </div>
  )
}

function DebtCard({ debt, index }: { debt: Debt; index: number }) {
  const { bump, stamp } = useApp()
  const [showPayments, setShowPayments] = useState(false)
  const [showPlan, setShowPlan] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [abono, setAbono] = useState(false)

  // El pago mensual se calcula aquí mismo —es aritmética pura, la misma del
  // servidor— para no pedir una tabla por deuda solo para enseñar una cifra.
  const plan =
    debt.termMonths !== null
      ? tablaAmortizacion({
          principalCents: debt.principalCents,
          annualRateBp: debt.annualRateBp,
          termMonths: debt.termMonths,
          startDate: debt.startDate,
        })
      : null

  // Lo que se debe es el saldo insoluto: los intereses pagados no bajan el
  // principal. Con tasa 0 esto es idéntico a "principal − abonado".
  const remaining = debt.balanceCents
  const pct = Math.min(100, (debt.capitalPaidCents / debt.principalCents) * 100)
  const overdue = debt.status === 'abierta' && isPastDue(debt.dueDate)
  // La fila del plan que sigue según los abonos ya registrados, no según el
  // calendario: si ya pagaste la de agosto, la siguiente es la de septiembre
  // aunque agosto no haya terminado. Si su fecha ya pasó, vas tarde.
  const proximo = plan?.filas[debt.payments.length]
  const proximoAtrasado = proximo !== undefined && proximo.fecha < todayISO()

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

      {(debt.annualRateBp > 0 || plan) && (
        <p className="deuda-credito">
          {debt.annualRateBp > 0 && <span className="chip">{fmtTasa(debt.annualRateBp)} anual</span>}
          {plan && (
            <>
              <span className="chip">{debt.termMonths} meses</span>
              <span className="deuda-cuota">
                Pago mensual <strong className="cifra-chica">{fmtMoney(plan.pagoMensualCents)}</strong>
              </span>
            </>
          )}
        </p>
      )}

      <div className="deuda-riel" role="img" aria-label={`Capital abonado ${fmtMoney(debt.capitalPaidCents)} de ${fmtMoney(debt.principalCents)}`}>
        <span className="deuda-lleno" style={{ width: `${pct}%` }} />
      </div>
      <p className="deuda-cifras">
        {debt.status === 'saldada' ? (
          <>Se saldaron <Money cents={debt.principalCents} className="cifra-chica" /></>
        ) : (
          <>
            Restan <Money cents={remaining} className="cifra-chica deuda-restan" /> de{' '}
            <Money cents={debt.principalCents} className="cifra-chica" />
            {debt.interestPaidCents > 0 && (
              <>
                {' · '}<Money cents={debt.interestPaidCents} className="cifra-chica" /> pagados
                de intereses
              </>
            )}
          </>
        )}
      </p>

      {(debt.downPaymentCents > 0 || proximo) && (
        <p className="deuda-detalle">
          {debt.downPaymentCents > 0 && (
            <>
              Enganche <Money cents={debt.downPaymentCents} className="cifra-chica" />
              {plan && (
                <>
                  {' · '}el crédito te cuesta{' '}
                  <strong className="cifra-chica">
                    {fmtMoney(debt.downPaymentCents + debt.principalCents + plan.totalInteresCents)}
                  </strong>{' '}
                  con intereses
                </>
              )}
              {proximo && <br />}
            </>
          )}
          {proximo && debt.status === 'abierta' && (
            <>
              Próximo pago del plan <Money cents={proximo.pagoCents} className="cifra-chica" /> el{' '}
              {fmtDate(proximo.fecha)}
              {proximoAtrasado && <strong className="presup-rojo"> · atrasado</strong>}
            </>
          )}
        </p>
      )}

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
        {plan && (
          <button type="button" className="btn-liga" onClick={() => setShowPlan((s) => !s)}>
            {showPlan ? 'Ocultar plan' : 'Plan de pagos'}
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
              <span className="abono-nota">
                {p.note || 'Abono'}
                {p.interestCents > 0 && (
                  <span className="abono-desglose">
                    {fmtMoney(p.capitalCents)} a capital · {fmtMoney(p.interestCents)} de interés
                  </span>
                )}
              </span>
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

      {showPlan && plan && <TablaAmortizacion debt={debt} />}

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
    .reduce((s, d) => s + d.balanceCents, 0)
  const totalPagar = porPagar
    .filter((d) => d.status === 'abierta')
    .reduce((s, d) => s + d.balanceCents, 0)

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
