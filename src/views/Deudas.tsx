import { useState } from 'react'
import { api } from '../api.ts'
import { useApp } from '../context.ts'
import { useFetch } from '../hooks.ts'
import { fmtDate, fmtDateAnio, fmtMoney, fmtTasa, isPastDue, parseAmount, todayISO } from '../format.ts'
import { tablaAmortizacion } from '../../shared/credito.ts'
import { conAbonoExtra } from '../../shared/estrategia.ts'
import { Money } from '../components/Money.tsx'
import { DebtModal } from '../components/DebtModal.tsx'
import { AbonoModal } from '../components/AbonoModal.tsx'
import type { Debt, PlanEstrategia } from '../../shared/types.ts'

/** "3 años y 4 meses" se lee; "40 meses" hay que dividirlo con la cabeza. */
function enMeses(meses: number): string {
  if (meses < 12) return `${meses} ${meses === 1 ? 'mes' : 'meses'}`
  const anios = Math.floor(meses / 12)
  const resto = meses % 12
  const a = `${anios} ${anios === 1 ? 'año' : 'años'}`
  return resto === 0 ? a : `${a} y ${resto} ${resto === 1 ? 'mes' : 'meses'}`
}

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
      {data.tasaEfectivaBp !== null && (
        <p className="amort-nota">
          Recibiste <strong className="cifra-chica">{fmtMoney(data.recibidoCents)}</strong> y vas a
          pagar <strong className="cifra-chica">{fmtMoney(data.totalPagadoCents)}</strong>: eso es
          una tasa efectiva de{' '}
          <strong className="cifra-chica">{fmtTasa(data.tasaEfectivaBp)}</strong> anual.
          {debt.originationFeeCents > 0 ? (
            <> La comisión de {fmtMoney(debt.originationFeeCents)} no aparece en la tasa del contrato y sí la sube.</>
          ) : (
            <> Sale arriba de la del contrato porque la nominal no capitaliza y esta sí.</>
          )}
        </p>
      )}
    </div>
  )
}

/**
 * "Si abono $X extra cada mes, ¿cuánto me ahorro?" — sobre el saldo de hoy y
 * con la cuota del plan.
 *
 * Se calcula **aquí mismo**: `shared/estrategia.ts` es puro y lo usan las dos
 * mitades, así que mover el deslizador no cuesta una petición. Es lo mismo que
 * ya hace la previa del pago mensual.
 */
function AbonoExtra({ debt, pagoMensualCents }: { debt: Debt; pagoMensualCents: number }) {
  const [extra, setExtra] = useState('')
  const extraCents = extra.trim() === '' ? 0 : parseAmount(extra)
  const plan =
    extraCents !== null && extraCents > 0
      ? conAbonoExtra({
          saldoCents: debt.balanceCents,
          annualRateBp: debt.annualRateBp,
          pagoMensualCents,
          extraCents,
        })
      : null

  return (
    <div className="extra-caja">
      <label className="campo">
        <span className="campo-label">Si abono de más cada mes</span>
        <div className="monto-wrap">
          <span className="monto-signo" aria-hidden="true">$</span>
          <input
            className="campo-input"
            inputMode="decimal"
            placeholder="0.00"
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
          />
        </div>
      </label>
      {extra.trim() !== '' && extraCents === null && (
        <p className="amort-nota">Ese monto no se entiende.</p>
      )}
      {plan && (
        <p className="amort-nota">
          {plan.base.meses === null ? (
            <>
              Con la cuota de {fmtMoney(pagoMensualCents)} esta deuda no se acaba: no alcanza ni
              para el interés del mes.
            </>
          ) : plan.con.meses === null ? (
            <>Ni con el abono extra alcanza para el interés del mes.</>
          ) : (
            <>
              Terminas en <strong className="cifra-chica">{enMeses(plan.con.meses)}</strong> en vez
              de {enMeses(plan.base.meses)} —{' '}
              <strong className="cifra-chica">{enMeses(plan.mesesAhorrados ?? 0)}</strong> menos — y
              te ahorras{' '}
              <strong className="cifra-chica">
                {fmtMoney(plan.interesAhorradoCents ?? 0)}
              </strong>{' '}
              de intereses. Supone que abonas ese extra todos los meses hasta liquidarla.
            </>
          )}
        </p>
      )}
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

      {debt.originationFeeCents > 0 && (
        <p className="deuda-detalle">
          Comisión de apertura <Money cents={debt.originationFeeCents} className="cifra-chica" />
          {' · '}te depositaron{' '}
          <strong className="cifra-chica">
            {fmtMoney(debt.principalCents - debt.originationFeeCents)}
          </strong>{' '}
          de los {fmtMoney(debt.principalCents)} que debes
        </p>
      )}

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

      {showPlan && plan && (
        <>
          <TablaAmortizacion debt={debt} />
          {debt.status === 'abierta' && debt.direction === 'por_pagar' && (
            <AbonoExtra debt={debt} pagoMensualCents={plan.pagoMensualCents} />
          )}
        </>
      )}

      {abono && <AbonoModal debt={debt} onClose={() => setAbono(false)} onSaved={bump} />}
    </article>
  )
}

/** Una de las dos columnas de la comparación. */
function ColumnaEstrategia({
  plan,
  titulo,
  explica,
  gana,
}: {
  plan: PlanEstrategia
  titulo: string
  explica: string
  gana: boolean
}) {
  return (
    <div className={`estrategia-col${gana ? ' estrategia-gana' : ''}`}>
      <h3 className="rotulo">
        {titulo}
        {gana && <span className="chip"> menos intereses</span>}
      </h3>
      <p className="estrategia-explica">{explica}</p>
      {plan.nuncaTermina || plan.meses === null ? (
        <p className="estrategia-cifra">
          Con ese dinero no se acaba: no alcanza ni para los intereses del mes.
        </p>
      ) : (
        <>
          <p className="estrategia-cifra">
            Libre en <strong>{enMeses(plan.meses)}</strong>
          </p>
          <p className="deuda-cifras">
            Intereses: <Money cents={plan.totalInteresCents} className="cifra-chica" /> · pagas{' '}
            <Money cents={plan.totalPagadoCents} className="cifra-chica" /> en total
          </p>
          {/* El orden es el de **ataque**, que es el plan. Los meses pueden no
              ir en orden, y no es un defecto: una deuda barata al final de la
              fila se acaba sola con su cuota mientras el sobrante ataca a
              otra. Por eso el encabezado dice cuál de las dos cosas ordena. */}
          <p className="estrategia-orden-titulo">En este orden les pegas · termina</p>
          <ol className="estrategia-orden">
            {plan.deudas.map((d) => (
              <li key={d.id}>
                <span className="estrategia-nombre">{d.nombre}</span>
                <span className="cifra-chica">
                  {d.mes === null ? 'sigue viva' : `mes ${d.mes}`}
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  )
}

/**
 * Bola de nieve contra avalancha, sobre las mismas deudas y el mismo dinero.
 *
 * Se enseñan **las dos** y la diferencia entre ellas. Cuál conviene no lo dice
 * Finply (R9): la avalancha casi siempre cuesta menos y la bola de nieve casi
 * siempre se siente mejor, porque liquidas una deuda pronto. Esa es una
 * decisión del usuario y aquí solo está la aritmética.
 */
function Estrategia({ profileId }: { profileId: number }) {
  const [extra, setExtra] = useState('')
  const extraCents = extra.trim() === '' ? 0 : (parseAmount(extra) ?? 0)
  const { data, error } = useFetch(
    () => api.debts.estrategia(profileId, extraCents),
    [profileId, extraCents],
  )

  if (error) return <p className="aviso" role="alert">{error}</p>
  if (!data || data.deudas.length < 2) return null

  const ahorro = data.interesAhorradoCents
  // Cuándo cae la primera deuda por cada ruta. Es el argumento entero de la
  // bola de nieve, así que no se afirma sin comprobarlo: cuando la más chica
  // ya se acababa sola con su cuota, atacarla primero no adelanta nada.
  const primera = (plan: PlanEstrategia) => {
    const meses = plan.deudas.map((d) => d.mes).filter((m): m is number => m !== null && m > 0)
    return meses.length > 0 ? Math.min(...meses) : null
  }
  const primeraNieve = primera(data.bolaDeNieve)
  const primeraAvalancha = primera(data.avalancha)
  const tachaAntes =
    primeraNieve !== null && primeraAvalancha !== null && primeraNieve < primeraAvalancha

  return (
    <section className="hoja estrategia">
      <header className="deudas-col-head">
        <h2 className="rotulo">Con qué orden las pagas</h2>
        <span className="cifra-chica">
          {data.deudas.length} deudas · {fmtMoney(data.saldoTotalCents)}
        </span>
      </header>
      <p className="estrategia-intro">
        Ya pagas <strong className="cifra-chica">{fmtMoney(data.cuotasCents)}</strong> al mes en
        cuotas. Las dos rutas usan ese mismo dinero y, cuando una deuda se acaba, su cuota pasa a
        la siguiente. Lo único que cambia es a quién le pegas primero.
      </p>
      <label className="campo estrategia-extra">
        <span className="campo-label">Y si además apartas cada mes</span>
        <div className="monto-wrap">
          <span className="monto-signo" aria-hidden="true">$</span>
          <input
            className="campo-input"
            inputMode="decimal"
            placeholder="0.00"
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
          />
        </div>
      </label>
      <div className="estrategia-cols">
        <ColumnaEstrategia
          plan={data.bolaDeNieve}
          titulo="Bola de nieve"
          explica="Primero la de saldo más chico. Tachas una deuda pronto, y eso se siente."
          gana={ahorro !== null && ahorro < 0}
        />
        <ColumnaEstrategia
          plan={data.avalancha}
          titulo="Avalancha"
          explica="Primero la de tasa más alta. Es la que más cuesta tener viva."
          gana={ahorro !== null && ahorro > 0}
        />
      </div>
      {ahorro !== null && (
        <p className="estrategia-veredicto">
          {ahorro === 0 ? (
            <>
              Las dos cuestan lo mismo con estas deudas. Elige la que vayas a sostener: la que se
              sigue es la que sirve.
            </>
          ) : ahorro > 0 ? (
            <>
              La avalancha te ahorra <strong className="cifra-chica">{fmtMoney(ahorro)}</strong> de
              intereses
              {data.mesesAhorrados !== null && data.mesesAhorrados > 0 && (
                <> y {enMeses(data.mesesAhorrados)}</>
              )}
              .{' '}
              {tachaAntes ? (
                <>
                  La bola de nieve tacha la primera deuda en el mes {primeraNieve} en vez del{' '}
                  {primeraAvalancha}: es lo que compras con esa diferencia.
                </>
              ) : (
                <>
                  Y aquí ni siquiera compras nada a cambio: con estas deudas la primera cae en el
                  mismo mes por las dos rutas.
                </>
              )}{' '}
              Los dos números son tuyos; la decisión también.
            </>
          ) : (
            <>
              Con estas deudas la bola de nieve sale{' '}
              <strong className="cifra-chica">{fmtMoney(-ahorro)}</strong> más barata
              {tachaAntes && <>, y además tacha la primera deuda en el mes {primeraNieve}</>}.
            </>
          )}
        </p>
      )}
    </section>
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
        <>
        <Estrategia profileId={profile.id} />
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
        </>
      )}

      {creating && <DebtModal onClose={() => setCreating(false)} onSaved={bump} />}
    </div>
  )
}
