// El panel de conciliación (D19), dentro de Movimientos y no en una sección
// propia: conciliar es leer el libro con el estado de cuenta al lado, y mandar
// al usuario a otra vista sería separarlo justo de lo que tiene que palomear.
//
// La bandera vive en cada fila del listado; esto es la otra mitad: el corte con
// el saldo que declaró el banco y la diferencia contra lo ya palomeado. Todo lo
// que se enseña aquí es derivado, así que palomear una fila lo recalcula solo.

import { useState } from 'react'
import { api } from '../api.ts'
import { useApp } from '../context.ts'
import { useFetch } from '../hooks.ts'
import { fmtDate, parseAmount, todayISO } from '../format.ts'
import { Money } from './Money.tsx'
import type { Account } from '../../shared/types.ts'

export function Conciliar({
  accounts,
  accountId,
  onElegirCuenta,
  onSoloPendientes,
}: {
  accounts: Account[]
  accountId: number
  onElegirCuenta: (id: number) => void
  onSoloPendientes: () => void
}) {
  const { profile, refreshKey, bump, stamp } = useApp()
  const [date, setDate] = useState(todayISO())
  const [saldo, setSaldo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  const { data: cortes } = useFetch(
    () => api.conciliacion.list(profile.id, accountId || undefined),
    [profile.id, accountId, refreshKey],
  )

  const declarar = async (e: React.FormEvent) => {
    e.preventDefault()
    // El saldo de un corte va **con signo**: una tarjeta lo tiene en negativo,
    // así que no se puede exigir que sea positivo como en los montos normales.
    const cents = parseAmount(saldo, { permitirNegativo: true })
    if (cents === null) return setError('Escribe el saldo que dice tu estado de cuenta')
    setGuardando(true)
    setError(null)
    try {
      await api.conciliacion.declarar({
        profileId: profile.id,
        accountId,
        date,
        balanceCents: cents,
      })
      setSaldo('')
      stamp('Corte declarado')
      bump()
    } catch (err) {
      setError((err as Error).message)
    }
    setGuardando(false)
  }

  const quitar = async (id: number) => {
    try {
      await api.conciliacion.remove(id)
      bump()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <section className="conciliar" aria-label="Conciliación">
      <p className="conciliar-intro">
        Palomea cada partida contra tu estado de cuenta. Después declara el saldo que el
        banco dice a esa fecha: si la diferencia es cero, la cuenta cuadra.
      </p>

      {accountId === 0 ? (
        <div className="conciliar-elegir">
          <label className="filtro-campo">
            <span className="filtro-label">¿Qué cuenta estás conciliando?</span>
            <select
              className="filtro"
              value={accountId}
              onChange={(e) => onElegirCuenta(Number(e.target.value))}
            >
              <option value={0}>Elige una cuenta…</option>
              {accounts
                .filter((a) => !a.archived)
                .map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
            </select>
          </label>
        </div>
      ) : (
        <form className="conciliar-forma" onSubmit={declarar}>
          <label className="filtro-campo">
            <span className="filtro-label">Al día</span>
            <input
              type="date"
              className="filtro"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label className="filtro-campo">
            <span className="filtro-label">Mi banco decía</span>
            <input
              className="filtro"
              inputMode="decimal"
              placeholder="0.00"
              value={saldo}
              onChange={(e) => setSaldo(e.target.value)}
            />
          </label>
          <button type="submit" className="btn btn-fantasma btn-chico" disabled={guardando}>
            Declarar corte
          </button>
          <button type="button" className="btn-liga" onClick={onSoloPendientes}>
            Ver solo lo que falta
          </button>
        </form>
      )}

      {error && <p className="forma-error" role="alert">{error}</p>}

      {(cortes ?? []).length > 0 && (
        <table className="conciliar-tabla">
          <caption className="sr-only">Cortes declarados y su diferencia</caption>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Cuenta</th>
              <th className="col-monto">El banco</th>
              <th className="col-monto">Palomeado</th>
              <th className="col-monto">Diferencia</th>
              <th>Falta</th>
              <th className="col-acciones"><span className="sr-only">Acciones</span></th>
            </tr>
          </thead>
          <tbody>
            {(cortes ?? []).map((c) => (
              <tr key={c.id} className={c.diferenciaCents === 0 ? 'cuadra' : 'descuadra'}>
                <td>{fmtDate(c.date)}</td>
                <td>{c.accountName}</td>
                <td className="col-monto"><Money cents={c.balanceCents} /></td>
                <td className="col-monto"><Money cents={c.conciliadoCents} /></td>
                <td className="col-monto">
                  {c.diferenciaCents === 0 ? (
                    <span className="conciliar-ok">Cuadra</span>
                  ) : (
                    <Money cents={c.diferenciaCents} signed />
                  )}
                </td>
                <td>
                  {c.pendientes === 0
                    ? '—'
                    : `${c.pendientes} sin palomear`}
                </td>
                <td className="col-acciones">
                  <button
                    type="button"
                    className="accion"
                    aria-label={`Quitar el corte del ${fmtDate(c.date)}`}
                    onClick={() => void quitar(c.id)}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
