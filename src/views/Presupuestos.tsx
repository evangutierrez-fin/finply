import { useState } from 'react'
import { api } from '../api.ts'
import { useApp } from '../context.ts'
import { useFetch } from '../hooks.ts'
import { currentMonth, fmtMoney, monthLabel, parseAmount, shiftMonth } from '../format.ts'
import { Money } from '../components/Money.tsx'
import type { Budget } from '../../shared/types.ts'

function rowState(b: Budget): 'bien' | 'alerta' | 'excedido' {
  if (b.spentCents > b.amountCents) return 'excedido'
  if (b.spentCents >= b.amountCents * 0.8) return 'alerta'
  return 'bien'
}

export function Presupuestos() {
  const { profile, refreshKey, bump, stamp } = useApp()
  const [month, setMonth] = useState(currentMonth())
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editValue, setEditValue] = useState('')
  const [newCategoryId, setNewCategoryId] = useState(0)
  const [newAmount, setNewAmount] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  const { data: budgets, error } = useFetch(
    () => api.budgets.list(profile.id, month),
    [profile.id, month, refreshKey],
  )
  const { data: categories } = useFetch(
    () => api.categories.list(profile.id),
    [profile.id, refreshKey],
  )

  const available = (categories ?? []).filter(
    (c) => c.kind === 'gasto' && !(budgets ?? []).some((b) => b.categoryId === c.id),
  )

  const totalBudget = (budgets ?? []).reduce((s, b) => s + b.amountCents, 0)
  const totalSpent = (budgets ?? []).reduce((s, b) => s + b.spentCents, 0)

  const setBudget = async (categoryId: number, raw: string) => {
    const cents = parseAmount(raw)
    if (!cents) {
      setFormError('Escribe un monto válido para el presupuesto')
      return false
    }
    try {
      await api.budgets.set({ profileId: profile.id, categoryId, month, amountCents: cents })
      stamp('Fijado')
      setFormError(null)
      bump()
      return true
    } catch (err) {
      setFormError((err as Error).message)
      return false
    }
  }

  const copyPrevious = async () => {
    try {
      const { copiados } = await api.budgets.copy({
        profileId: profile.id,
        from: shiftMonth(month, -1),
        to: month,
      })
      if (copiados === 0) {
        setFormError(`${monthLabel(shiftMonth(month, -1))} no tiene presupuestos que copiar`)
        return
      }
      stamp('Copiado')
      setFormError(null)
      bump()
    } catch (err) {
      setFormError((err as Error).message)
    }
  }

  const remove = async (b: Budget) => {
    try {
      await api.budgets.remove(b.id)
      bump()
    } catch (err) {
      alert((err as Error).message)
    }
  }

  return (
    <div className="vista">
      <header className="vista-head">
        <h1>Presupuestos</h1>
        <div className="mes-nav">
          <button type="button" className="mes-flecha" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Mes anterior">‹</button>
          <span className="vista-mes">{monthLabel(month)}</span>
          <button type="button" className="mes-flecha" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Mes siguiente">›</button>
        </div>
      </header>

      {error && <p className="aviso" role="alert">{error}</p>}

      {budgets && budgets.length === 0 ? (
        <div className="vacio">
          <p className="vacio-titulo">Sin presupuestos en {monthLabel(month)}.</p>
          <p className="vacio-sub">
            Cada mes lleva sus propios topes. Ponle un techo a cada categoría de gasto y Finply
            te dirá cuánto te queda conforme registras movimientos.
          </p>
          <button type="button" className="btn btn-fantasma btn-chico" onClick={copyPrevious}>
            Copiar los de {monthLabel(shiftMonth(month, -1))}
          </button>
        </div>
      ) : (
        budgets && (
          <section className="hoja presup-resumen">
            <div className="presup-totales">
              <span className="rotulo">Del presupuesto total</span>
              <p className="presup-frase">
                Gastado <Money cents={totalSpent} className="cifra-chica" /> de{' '}
                <Money cents={totalBudget} className="cifra-chica" />
                {totalSpent <= totalBudget ? (
                  <> · quedan <strong className="cifra-chica">{fmtMoney(totalBudget - totalSpent)}</strong></>
                ) : (
                  <> · <strong className="cifra-chica presup-rojo">excedido por {fmtMoney(totalSpent - totalBudget)}</strong></>
                )}
              </p>
            </div>
            <div className="presup-riel" role="img" aria-label={`Gastado ${fmtMoney(totalSpent)} de ${fmtMoney(totalBudget)}`}>
              <span
                className={`presup-lleno estado-${totalSpent > totalBudget ? 'excedido' : totalSpent >= totalBudget * 0.8 ? 'alerta' : 'bien'}`}
                style={{ width: `${Math.min(100, totalBudget ? (totalSpent / totalBudget) * 100 : 0)}%` }}
              />
            </div>
          </section>
        )
      )}

      {budgets && budgets.length > 0 && (
        <section className="presup-lista">
          {budgets.map((b, i) => {
            const estado = rowState(b)
            const restante = b.amountCents - b.spentCents
            return (
              <article className="hoja presup-fila" key={b.id} style={{ animationDelay: `${i * 40}ms` }}>
                <div className="presup-fila-head">
                  <h2>{b.categoryName}</h2>
                  {estado === 'excedido' && <span className="chip chip-rojo">Excedido</span>}
                </div>
                <div className="presup-riel">
                  <span
                    className={`presup-lleno estado-${estado}`}
                    style={{ width: `${Math.min(100, (b.spentCents / b.amountCents) * 100)}%`, animationDelay: `${i * 40}ms` }}
                  />
                </div>
                <p className="presup-cifras">
                  <Money cents={b.spentCents} className="cifra-chica" /> de{' '}
                  {editingId === b.id ? (
                    <span className="campo-inline presup-editor">
                      <span className="monto-signo">$</span>
                      <input
                        className="campo-input"
                        inputMode="decimal"
                        value={editValue}
                        autoFocus
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={async (e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            if (await setBudget(b.categoryId, editValue)) setEditingId(null)
                          }
                          if (e.key === 'Escape') setEditingId(null)
                        }}
                      />
                      <button
                        type="button"
                        className="btn-liga"
                        onClick={async () => {
                          if (await setBudget(b.categoryId, editValue)) setEditingId(null)
                        }}
                      >
                        Guardar
                      </button>
                    </span>
                  ) : (
                    <Money cents={b.amountCents} className="cifra-chica" />
                  )}
                  {' · '}
                  {restante >= 0 ? (
                    <>quedan <strong className="cifra-chica">{fmtMoney(restante)}</strong></>
                  ) : (
                    <strong className="cifra-chica presup-rojo">te pasaste por {fmtMoney(-restante)}</strong>
                  )}
                </p>
                <footer className="presup-acciones">
                  <button
                    type="button"
                    className="btn-liga"
                    onClick={() => {
                      setEditingId(b.id)
                      setEditValue((b.amountCents / 100).toFixed(2))
                    }}
                  >
                    Cambiar tope
                  </button>
                  <button type="button" className="btn-liga deuda-borrar" onClick={() => remove(b)}>
                    Quitar
                  </button>
                </footer>
              </article>
            )
          })}
        </section>
      )}

      {available.length > 0 && (
        <section className="hoja presup-nuevo">
          <h2 className="hoja-titulo">Fijar presupuesto</h2>
          <form
            className="presup-nuevo-forma"
            onSubmit={async (e) => {
              e.preventDefault()
              if (!newCategoryId) {
                setFormError('Elige una categoría')
                return
              }
              if (await setBudget(newCategoryId, newAmount)) {
                setNewCategoryId(0)
                setNewAmount('')
              }
            }}
          >
            <select
              className="filtro"
              value={newCategoryId}
              onChange={(e) => setNewCategoryId(Number(e.target.value))}
              aria-label="Categoría"
            >
              <option value={0} disabled>Categoría de gasto…</option>
              {available.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <div className="monto-wrap">
              <span className="monto-signo" aria-hidden="true">$</span>
              <input
                className="campo-input"
                inputMode="decimal"
                placeholder="Tope mensual"
                value={newAmount}
                onChange={(e) => setNewAmount(e.target.value)}
                aria-label="Tope mensual"
              />
            </div>
            <button type="submit" className="btn btn-primario btn-chico">Fijar</button>
          </form>
          {formError && <p className="forma-error" role="alert">{formError}</p>}
          {budgets && budgets.length > 0 && (
            <p className="presup-pie">
              <button type="button" className="btn-liga" onClick={copyPrevious}>
                Traer los topes de {monthLabel(shiftMonth(month, -1))}
              </button>
              {' · no toca los que ya fijaste en este mes'}
            </p>
          )}
        </section>
      )}
    </div>
  )
}
