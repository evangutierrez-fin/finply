import { useState } from 'react'
import { api } from '../api.ts'
import { useApp } from '../context.ts'
import { useFetch } from '../hooks.ts'
import { Money } from '../components/Money.tsx'
import { AccountModal } from '../components/AccountModal.tsx'
import type { Account } from '../../shared/types.ts'

const TYPE_LABEL: Record<Account['type'], string> = {
  efectivo: 'Efectivo',
  banco: 'Banco',
  tarjeta: 'Tarjeta',
  ahorro: 'Ahorro',
  otro: 'Otra',
}

/**
 * Los últimos doce meses de **esta** cuenta. La serie de patrimonio es global
 * y no contesta "¿mi ahorro va subiendo?"; doce cifras y una línea sí.
 *
 * Es una minigráfica de apoyo, no una gráfica publicada: la cifra que importa
 * —el saldo de hoy— ya está arriba en grande, y el dato que agrega —cuánto se
 * movió en el año— va escrito al lado, no solo dibujado (R19).
 */
function SerieCuentaMini({ accountId }: { accountId: number }) {
  const { refreshKey } = useApp()
  const { data } = useFetch(() => api.accounts.serie(accountId, 12), [accountId, refreshKey])
  const puntos = data?.puntos ?? []
  if (puntos.length < 2) return null

  const valores = puntos.map((p) => p.balanceCents)
  const min = Math.min(...valores, 0)
  const max = Math.max(...valores, 0)
  const rango = max - min || 1
  const d = puntos
    .map((p, i) => {
      const x = (i / (puntos.length - 1)) * 100
      const y = 24 - ((p.balanceCents - min) / rango) * 24
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')

  const delta = puntos[puntos.length - 1]!.balanceCents - puntos[0]!.balanceCents

  return (
    <div className="cuenta-serie">
      <svg viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true">
        <path
          d={d}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <span className="cuenta-serie-pie">
        12 meses ·{' '}
        <span className={delta < 0 ? 'stat-rojo' : undefined}>
          <Money cents={delta} signed className="cifra-chica" />
        </span>
      </span>
    </div>
  )
}

export function Cuentas() {
  const { profile, refreshKey, bump, stamp } = useApp()
  const [modal, setModal] = useState<{ open: boolean; account: Account | null }>({
    open: false,
    account: null,
  })
  const { data: accounts, error } = useFetch(
    () => api.accounts.list(profile.id),
    [profile.id, refreshKey],
  )

  const active = (accounts ?? []).filter((a) => !a.archived)
  const archived = (accounts ?? []).filter((a) => a.archived)

  const toggleArchive = async (account: Account) => {
    try {
      await api.accounts.update(account.id, { archived: !account.archived })
      stamp(account.archived ? 'Reabierta' : 'Archivada')
      bump()
    } catch (err) {
      alert((err as Error).message)
    }
  }

  return (
    <div className="vista">
      <header className="vista-head">
        <h1>Cuentas</h1>
        <button
          type="button"
          className="btn btn-primario"
          onClick={() => setModal({ open: true, account: null })}
        >
          ＋ Abrir cuenta
        </button>
      </header>

      {error && <p className="aviso" role="alert">{error}</p>}

      {accounts && accounts.length === 0 && (
        <div className="vacio">
          <p className="vacio-titulo">Sin cuentas todavía.</p>
          <p className="vacio-sub">Cada cuenta es una columna de tu libro: efectivo, banco, caja del negocio…</p>
          <button type="button" className="btn btn-primario" onClick={() => setModal({ open: true, account: null })}>
            Abrir la primera cuenta
          </button>
        </div>
      )}

      <section className="cuentas-grid">
        {active.map((a, i) => (
          <article key={a.id} className="hoja cuenta-carta" style={{ animationDelay: `${i * 50}ms` }}>
            <header className="cuenta-carta-head">
              <h2>{a.name}</h2>
              <span className="chip">{TYPE_LABEL[a.type]}</span>
            </header>
            <Money cents={a.balanceCents} className="cuenta-carta-saldo" />
            <p className="cuenta-carta-meta">
              {a.institution && <>{a.institution} · </>}
              {a.txCount} {a.txCount === 1 ? 'movimiento' : 'movimientos'} · abrió con{' '}
              <Money cents={a.openingCents} className="cifra-chica" />
            </p>
            {a.minBalanceCents !== null && a.balanceCents < a.minBalanceCents && (
              <p className="cuenta-aviso">
                Bajó de tu mínimo (<Money cents={a.minBalanceCents} className="cifra-chica" />)
              </p>
            )}
            {/*
              La moneda solo se menciona cuando **difiere** de la del libro. Una
              cuenta así se sigue sumando como si fuera de la moneda del perfil
              (D18: una moneda por libro), y callarlo sería la mentira que H2
              venía a cerrar.
            */}
            {a.currency !== profile.currency && (
              <p className="cuenta-aviso">
                Está en {a.currency} y este libro lleva {profile.currency}: su saldo se suma sin
                convertir. Para llevar {a.currency} de verdad, abre otro perfil.
              </p>
            )}
            <SerieCuentaMini accountId={a.id} />
            <footer className="cuenta-carta-pie">
              <button type="button" className="btn-liga" onClick={() => setModal({ open: true, account: a })}>
                Editar
              </button>
              <button type="button" className="btn-liga" onClick={() => toggleArchive(a)}>
                Archivar
              </button>
            </footer>
          </article>
        ))}
      </section>

      {archived.length > 0 && (
        <section className="archivadas">
          <h2 className="rotulo">Archivadas</h2>
          <ul className="archivadas-lista">
            {archived.map((a) => (
              <li key={a.id}>
                <span>{a.name}</span>
                <Money cents={a.balanceCents} className="cifra-chica" />
                <button type="button" className="btn-liga" onClick={() => toggleArchive(a)}>
                  Reabrir
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {modal.open && (
        <AccountModal
          account={modal.account}
          onClose={() => setModal({ open: false, account: null })}
          onSaved={bump}
        />
      )}
    </div>
  )
}
