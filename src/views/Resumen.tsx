import { api } from '../api.ts'
import { useApp } from '../context.ts'
import { useFetch } from '../hooks.ts'
import { currentMonth, fmtDate, monthLabel } from '../format.ts'
import { CountUpMoney, Money } from '../components/Money.tsx'
import { CategoryBars, MonthBars } from '../components/Charts.tsx'
import type { Tx } from '../../shared/types.ts'

function txSignedCents(tx: Tx): number {
  return tx.type === 'gasto' ? -tx.amountCents : tx.amountCents
}

export function Resumen({ onNav }: { onNav: (view: 'movimientos' | 'cuentas' | 'deudas') => void }) {
  const { profile, refreshKey, openTx } = useApp()
  const month = currentMonth()
  const { data, error } = useFetch(
    () => api.summary(profile.id, month),
    [profile.id, refreshKey],
  )

  if (error) return <p className="aviso" role="alert">{error}</p>
  if (!data) return <div className="cargando" aria-label="Cargando" />

  const active = data.accounts.filter((a) => !a.archived)
  const neto = data.incomeCents - data.expenseCents

  if (active.length === 0) {
    return (
      <div className="vacio">
        <p className="vacio-titulo">Este libro está en blanco.</p>
        <p className="vacio-sub">Abre tu primera cuenta —efectivo, banco, caja— y empieza a registrar.</p>
        <button type="button" className="btn btn-primario" onClick={() => onNav('cuentas')}>
          Abrir una cuenta
        </button>
      </div>
    )
  }

  return (
    <div className="vista">
      <header className="vista-head">
        <h1>Resumen</h1>
        <span className="vista-mes">{monthLabel(month)}</span>
      </header>

      <section className="hero">
        <div className="hero-total">
          <span className="rotulo">Suma total · {active.length} {active.length === 1 ? 'cuenta' : 'cuentas'}</span>
          <CountUpMoney cents={data.totalCents} className="hero-cifra" />
        </div>
        <dl className="hero-stats">
          <div className="stat">
            <dt>Entró en {monthLabel(month).split(' ')[0]?.toLowerCase()}</dt>
            <dd><Money cents={data.incomeCents} signed className="stat-in" /></dd>
          </div>
          <div className="stat">
            <dt>Salió</dt>
            <dd><Money cents={-data.expenseCents} /></dd>
          </div>
          <div className="stat stat-neto">
            <dt>Neto del mes</dt>
            <dd><Money cents={neto} signed /></dd>
          </div>
        </dl>
      </section>

      <section className="cuentas-tira" aria-label="Cuentas">
        {active.map((a, i) => (
          <button
            type="button"
            key={a.id}
            className="cuenta-mini"
            style={{ animationDelay: `${i * 50}ms` }}
            onClick={() => onNav('cuentas')}
          >
            <span className="cuenta-mini-nombre">{a.name}</span>
            <Money cents={a.balanceCents} className="cuenta-mini-saldo" />
          </button>
        ))}
      </section>

      <section className="dos-columnas">
        <article className="hoja">
          <h2 className="hoja-titulo">Entradas y salidas del mes</h2>
          <MonthBars byDay={data.byDay} month={month} />
        </article>
        <article className="hoja">
          <h2 className="hoja-titulo">En qué se fue el gasto</h2>
          <CategoryBars byCategory={data.byCategory} />
        </article>
      </section>

      <section className="dos-columnas dos-columnas-desigual">
        <article className="hoja">
          <div className="hoja-head">
            <h2 className="hoja-titulo">Últimos movimientos</h2>
            <button type="button" className="btn-liga" onClick={() => onNav('movimientos')}>
              Ver el libro completo →
            </button>
          </div>
          {data.recent.length === 0 ? (
            <p className="grafica-vacia">Aún no hay movimientos registrados.</p>
          ) : (
            <ul className="recientes">
              {data.recent.map((tx, i) => (
                <li key={tx.id} style={{ animationDelay: `${i * 40}ms` }}>
                  <button type="button" className="reciente" onClick={() => openTx(tx)}>
                    <span className="reciente-fecha">{fmtDate(tx.date)}</span>
                    <span className="reciente-concepto">
                      {tx.note || tx.categoryName || (tx.type === 'transferencia' ? 'Transferencia' : 'Sin concepto')}
                      <span className="reciente-cuenta">
                        {tx.type === 'transferencia'
                          ? `${tx.accountName} → ${tx.transferAccountName}`
                          : tx.accountName}
                      </span>
                    </span>
                    {tx.type === 'transferencia' ? (
                      <span className="cifra reciente-monto neutro">
                        <Money cents={tx.amountCents} />
                      </span>
                    ) : (
                      <Money cents={txSignedCents(tx)} signed className="reciente-monto" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className="hoja deudas-mini">
          <div className="hoja-head">
            <h2 className="hoja-titulo">Patrimonio</h2>
            <button type="button" className="btn-liga" onClick={() => onNav('deudas')}>
              Ver deudas →
            </button>
          </div>
          <dl className="deudas-mini-lista">
            <div>
              <dt>En cuentas</dt>
              <dd><Money cents={data.totalCents} /></dd>
            </div>
            <div>
              <dt>Inversiones</dt>
              <dd><Money cents={data.investments.valueCents} /></dd>
            </div>
            <div>
              <dt>Te deben</dt>
              <dd><Money cents={data.debts.porCobrarCents} className="stat-in" /></dd>
            </div>
            <div>
              <dt>Debes</dt>
              <dd><Money cents={-data.debts.porPagarCents} /></dd>
            </div>
            <div className="patrimonio-total">
              <dt>Patrimonio</dt>
              <dd>
                <span className="doble-raya">
                  <Money
                    cents={
                      data.totalCents +
                      data.investments.valueCents +
                      data.debts.porCobrarCents -
                      data.debts.porPagarCents
                    }
                  />
                </span>
              </dd>
            </div>
          </dl>
          <p className="deudas-mini-nota">
            {data.debts.abiertas === 0
              ? 'Sin deudas pendientes. El libro está en paz.'
              : `${data.debts.abiertas} ${data.debts.abiertas === 1 ? 'deuda abierta' : 'deudas abiertas'} entre cobros y pagos.`}
          </p>
        </article>
      </section>
    </div>
  )
}
