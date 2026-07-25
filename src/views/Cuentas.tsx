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
              {a.txCount} {a.txCount === 1 ? 'movimiento' : 'movimientos'} · abrió con{' '}
              <Money cents={a.openingCents} className="cifra-chica" />
            </p>
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
