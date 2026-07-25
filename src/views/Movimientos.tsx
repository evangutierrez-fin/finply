import { useEffect, useState } from 'react'
import { api } from '../api.ts'
import { useApp } from '../context.ts'
import { useFetch } from '../hooks.ts'
import { currentMonth, fmtDate, monthLabel, shiftMonth } from '../format.ts'
import { Money } from '../components/Money.tsx'
import type { Tx } from '../../shared/types.ts'

export function Movimientos() {
  const { profile, refreshKey, openTx, bump, stamp } = useApp()
  const [month, setMonth] = useState(currentMonth())
  const [accountId, setAccountId] = useState(0)
  const [type, setType] = useState('')
  const [qInput, setQInput] = useState('')
  const [q, setQ] = useState('')
  const [deletingId, setDeletingId] = useState<number | null>(null)

  // El buscador espera a que dejes de teclear antes de consultar.
  useEffect(() => {
    const timer = setTimeout(() => setQ(qInput.trim()), 300)
    return () => clearTimeout(timer)
  }, [qInput])

  const { data: accounts } = useFetch(() => api.accounts.list(profile.id), [profile.id, refreshKey])
  const { data: txs, error } = useFetch(
    () =>
      api.tx.list({
        profileId: profile.id,
        month,
        accountId: accountId || undefined,
        type: type || undefined,
        q: q || undefined,
      }),
    [profile.id, month, accountId, type, q, refreshKey],
  )

  const remove = async (tx: Tx) => {
    try {
      await api.tx.remove(tx.id)
      stamp('Anulado')
      bump()
    } catch (err) {
      alert((err as Error).message)
    }
    setDeletingId(null)
  }

  const cargos = (txs ?? []).filter((t) => t.type === 'gasto').reduce((s, t) => s + t.amountCents, 0)
  const abonos = (txs ?? []).filter((t) => t.type === 'ingreso').reduce((s, t) => s + t.amountCents, 0)

  return (
    <div className="vista">
      <header className="vista-head">
        <h1>Movimientos</h1>
        <div className="mes-nav">
          <button type="button" className="mes-flecha" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Mes anterior">‹</button>
          <span className="vista-mes">{monthLabel(month)}</span>
          <button type="button" className="mes-flecha" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Mes siguiente">›</button>
        </div>
      </header>

      <div className="filtros">
        <select
          className="filtro"
          value={accountId}
          onChange={(e) => setAccountId(Number(e.target.value))}
          aria-label="Filtrar por cuenta"
        >
          <option value={0}>Todas las cuentas</option>
          {(accounts ?? []).map((a) => (
            <option key={a.id} value={a.id}>{a.name}{a.archived ? ' (archivada)' : ''}</option>
          ))}
        </select>
        <select
          className="filtro"
          value={type}
          onChange={(e) => setType(e.target.value)}
          aria-label="Filtrar por tipo"
        >
          <option value="">Todos los tipos</option>
          <option value="gasto">Gastos</option>
          <option value="ingreso">Ingresos</option>
          <option value="transferencia">Transferencias</option>
        </select>
        <input
          className="filtro filtro-busqueda"
          placeholder="Buscar concepto, categoría o cuenta…"
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          aria-label="Buscar"
        />
      </div>

      {error && <p className="aviso" role="alert">{error}</p>}

      {txs && txs.length === 0 ? (
        <div className="vacio">
          <p className="vacio-titulo">Este mes está en blanco.</p>
          <p className="vacio-sub">
            {q || accountId || type
              ? 'Ningún movimiento coincide con los filtros.'
              : 'Registra el primer movimiento del periodo.'}
          </p>
          {!q && !accountId && !type && (
            <button type="button" className="btn btn-primario" onClick={() => openTx()}>
              ＋ Registrar movimiento
            </button>
          )}
        </div>
      ) : (
        <table className="libro">
          <thead>
            <tr>
              <th className="col-fecha">Fecha</th>
              <th>Concepto</th>
              <th className="col-cuenta">Cuenta</th>
              <th className="col-monto">Cargo</th>
              <th className="col-monto">Abono</th>
              <th className="col-acciones"><span className="sr-only">Acciones</span></th>
            </tr>
          </thead>
          <tbody>
            {(txs ?? []).map((tx, i) => (
              <tr key={tx.id} className="libro-fila" style={{ animationDelay: `${Math.min(i * 25, 400)}ms` }}>
                <td className="col-fecha">{fmtDate(tx.date)}</td>
                <td>
                  <span className="mov-concepto">
                    {tx.note || tx.categoryName || (tx.type === 'transferencia' ? 'Transferencia' : 'Sin concepto')}
                  </span>
                  {tx.categoryName && tx.note && <span className="mov-cat">{tx.categoryName}</span>}
                  {tx.debtPaymentId && <span className="mov-cat">Abono de deuda</span>}
                </td>
                <td className="col-cuenta">
                  {tx.type === 'transferencia'
                    ? `${tx.accountName} → ${tx.transferAccountName}`
                    : tx.accountName}
                </td>
                <td className={`col-monto${tx.type === 'transferencia' ? ' neutro' : ''}`}>
                  {tx.type === 'gasto' && <Money cents={tx.amountCents} />}
                  {tx.type === 'transferencia' && <Money cents={tx.amountCents} />}
                </td>
                <td className={`col-monto${tx.type === 'transferencia' ? ' neutro' : ''}`}>
                  {tx.type === 'ingreso' && <Money cents={tx.amountCents} />}
                  {tx.type === 'transferencia' && <Money cents={tx.amountCents} />}
                </td>
                <td className="col-acciones">
                  {deletingId === tx.id ? (
                    <span className="confirmar">
                      <button type="button" className="btn-liga btn-liga-rojo" onClick={() => remove(tx)}>Anular</button>
                      <button type="button" className="btn-liga" onClick={() => setDeletingId(null)}>No</button>
                    </span>
                  ) : (
                    <span className="acciones">
                      <button type="button" className="accion" onClick={() => openTx(tx)} aria-label="Corregir">✎</button>
                      <button type="button" className="accion" onClick={() => setDeletingId(tx.id)} aria-label="Anular">✕</button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="libro-suma">
              <td colSpan={3}>Sumas del periodo</td>
              <td className="col-monto"><Money cents={cargos} /></td>
              <td className="col-monto"><Money cents={abonos} /></td>
              <td />
            </tr>
            <tr className="libro-neto">
              <td colSpan={3}>Neto</td>
              <td colSpan={2} className="col-monto">
                <span className="doble-raya"><Money cents={abonos - cargos} signed /></span>
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  )
}
