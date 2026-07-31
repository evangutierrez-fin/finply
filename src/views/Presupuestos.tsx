import { useState } from 'react'
import { api } from '../api.ts'
import { useApp } from '../context.ts'
import { useFetch } from '../hooks.ts'
import { currentMonth, fmtMoney, monthLabel, parseAmount, shiftMonth } from '../format.ts'
import { Money } from '../components/Money.tsx'
import type { Budget } from '../../shared/types.ts'

/**
 * El estado se mide contra `topeCents` —lo escrito **más** lo que arrastró— y
 * no contra lo escrito. Si el mes pasado sobraron $500, pasarte por $300 de lo
 * que escribiste no es pasarte de nada.
 */
function rowState(b: Budget): 'bien' | 'alerta' | 'excedido' {
  if (b.spentCents > b.topeCents) return 'excedido'
  if (b.topeCents > 0 && b.spentCents >= b.topeCents * 0.8) return 'alerta'
  return 'bien'
}

function ancho(gastado: number, tope: number): number {
  if (tope <= 0) return gastado > 0 ? 100 : 0
  return Math.min(100, (gastado / tope) * 100)
}

/**
 * El ritmo: el tope contra el **día**, no solo contra el gasto.
 *
 * Gastar el 80 % del tope el día 3 y gastarlo el día 28 son dos noticias
 * opuestas, y la barra sola las pinta idénticas. En un periodo cerrado o que
 * no ha empezado no hay ritmo que medir, y decir algo sería inventarlo.
 */
function ritmo(gastado: number, esperado: number, avance: number): string | null {
  if (avance <= 0 || avance >= 1) return null
  const dif = gastado - esperado
  if (dif === 0) return 'justo en el ritmo'
  return dif > 0 ? `${fmtMoney(dif)} arriba del ritmo` : `${fmtMoney(-dif)} abajo del ritmo`
}

/** La marca del día sobre el riel. Va con su texto al lado, nunca sola (R19). */
function MarcaDelRitmo({ avance }: { avance: number }) {
  if (avance <= 0 || avance >= 1) return null
  return <span className="presup-marca" style={{ left: `${avance * 100}%` }} aria-hidden="true" />
}

function Riel({
  gastado,
  tope,
  estado,
  avance,
  retraso = 0,
}: {
  gastado: number
  tope: number
  estado: string
  avance: number
  retraso?: number
}) {
  return (
    <div
      className="presup-riel-caja"
      role="img"
      aria-label={`Gastado ${fmtMoney(gastado)} de ${fmtMoney(tope)}`}
    >
      <div className="presup-riel">
        <span
          className={`presup-lleno estado-${estado}`}
          style={{ width: `${ancho(gastado, tope)}%`, animationDelay: `${retraso}ms` }}
        />
      </div>
      <MarcaDelRitmo avance={avance} />
    </div>
  )
}

export function Presupuestos() {
  const { profile, refreshKey, bump, stamp } = useApp()
  const [month, setMonth] = useState(currentMonth())
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editValue, setEditValue] = useState('')
  const [newCategoryId, setNewCategoryId] = useState(0)
  const [newAmount, setNewAmount] = useState('')
  const [newKind, setNewKind] = useState<'mes' | 'anio'>('mes')
  const [totalValue, setTotalValue] = useState('')
  const [editingTotal, setEditingTotal] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const { data, error } = useFetch(
    () => api.budgets.list(profile.id, month),
    [profile.id, month, refreshKey],
  )
  const { data: categories } = useFetch(
    () => api.categories.list(profile.id),
    [profile.id, refreshKey],
  )

  const mensuales = data?.mensuales ?? []
  const anuales = data?.anuales ?? []
  const total = data?.total ?? null
  const avance = data?.avance ?? 0
  const avanceAnual = data?.avanceAnual ?? 0
  const anio = month.slice(0, 4)

  const usadas = newKind === 'anio' ? anuales : mensuales
  const available = (categories ?? []).filter(
    (c) => c.kind === 'gasto' && !usadas.some((b) => b.categoryId === c.id),
  )

  const totalBudget = mensuales.reduce((s, b) => s + b.topeCents, 0)
  const totalSpent = mensuales.reduce((s, b) => s + b.spentCents, 0)

  // El día del mes solo tiene sentido cuando el mes es el que corre. En uno
  // cerrado el ritmo ya no dice nada y en uno futuro tampoco.
  const hoy = new Date()
  const enCurso = month === currentMonth()
  const diaDeHoy = hoy.getDate()
  const diasDelMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate()

  const setBudget = async (
    categoryId: number,
    raw: string,
    opciones: { periodKind?: 'mes' | 'anio'; rollover?: boolean } = {},
  ) => {
    const cents = parseAmount(raw)
    if (!cents) {
      setFormError('Escribe un monto válido para el presupuesto')
      return false
    }
    const periodKind = opciones.periodKind ?? 'mes'
    try {
      await api.budgets.set({
        profileId: profile.id,
        categoryId,
        period: periodKind === 'anio' ? anio : month,
        periodKind,
        amountCents: cents,
        rollover: opciones.rollover ?? false,
      })
      stamp('Fijado')
      setFormError(null)
      bump()
      return true
    } catch (err) {
      setFormError((err as Error).message)
      return false
    }
  }

  const toggleRollover = async (b: Budget) => {
    try {
      await api.budgets.set({
        profileId: profile.id,
        categoryId: b.categoryId,
        period: b.period,
        periodKind: 'mes',
        amountCents: b.amountCents,
        rollover: !b.rollover,
      })
      stamp(b.rollover ? 'Ya no rueda' : 'Rueda')
      bump()
    } catch (err) {
      setFormError((err as Error).message)
    }
  }

  const guardarTotal = async () => {
    const cents = parseAmount(totalValue)
    if (!cents) {
      setFormError('Escribe un monto válido para el tope del mes')
      return
    }
    try {
      await api.budgets.setTotal({ profileId: profile.id, month, amountCents: cents })
      stamp('Fijado')
      setFormError(null)
      setEditingTotal(false)
      bump()
    } catch (err) {
      setFormError((err as Error).message)
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

  const quitarTotal = async () => {
    if (!total) return
    try {
      await api.budgets.removeTotal(total.id)
      bump()
    } catch (err) {
      alert((err as Error).message)
    }
  }

  const filaPresupuesto = (b: Budget, i: number, avanceDelTipo: number) => {
    const estado = rowState(b)
    const restante = b.topeCents - b.spentCents
    const frase = ritmo(b.spentCents, b.esperadoCents, avanceDelTipo)
    return (
      <article className="hoja presup-fila" key={b.id} style={{ animationDelay: `${i * 40}ms` }}>
        <div className="presup-fila-head">
          <h3>{b.categoryName}</h3>
          {b.rollover && <span className="chip">Rueda</span>}
          {estado === 'excedido' && <span className="chip chip-rojo">Excedido</span>}
        </div>
        <Riel
          gastado={b.spentCents}
          tope={b.topeCents}
          estado={estado}
          avance={avanceDelTipo}
          retraso={i * 40}
        />
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
                    const ok = await setBudget(b.categoryId, editValue, {
                      periodKind: b.periodKind,
                      rollover: b.rollover,
                    })
                    if (ok) setEditingId(null)
                  }
                  if (e.key === 'Escape') setEditingId(null)
                }}
              />
              <button
                type="button"
                className="btn-liga"
                onClick={async () => {
                  const ok = await setBudget(b.categoryId, editValue, {
                    periodKind: b.periodKind,
                    rollover: b.rollover,
                  })
                  if (ok) setEditingId(null)
                }}
              >
                Guardar
              </button>
            </span>
          ) : (
            <Money cents={b.topeCents} className="cifra-chica" />
          )}
          {' · '}
          {restante >= 0 ? (
            <>quedan <strong className="cifra-chica">{fmtMoney(restante)}</strong></>
          ) : (
            <strong className="cifra-chica presup-rojo">te pasaste por {fmtMoney(-restante)}</strong>
          )}
          {frase && <> · {frase}</>}
        </p>
        {/*
          El arrastre se escribe siempre que exista, con su signo y con la
          cuenta hecha: un techo que cambió solo y no se explica es peor que no
          tener arrastre. Rueda en los dos sentidos a propósito — uno que solo
          ayudara sería un techo que sube solo, y entonces no es un techo.

          ⚠ La cifra es de **toda la cadena**, no del mes anterior. Nombrar al
          anterior con una cifra de tres meses le echa la culpa de lo que no
          hizo, y eso es una frase falsa aunque el número esté bien.
        */}
        {b.arrastreCents !== 0 && (
          <p className="presup-arrastre">
            {b.arrastreMeses > 1 ? (
              <>
                Vienes arrastrando {b.arrastreMeses} meses:{' '}
                <strong className={b.arrastreCents < 0 ? 'presup-rojo' : undefined}>
                  {b.arrastreCents > 0 ? 'sobraron' : 'faltaron'}{' '}
                  {fmtMoney(Math.abs(b.arrastreCents))}
                </strong>
              </>
            ) : (
              <>
                {monthLabel(shiftMonth(b.period, -1))}{' '}
                {b.arrastreCents > 0 ? 'te dejó' : 'se pasó por'}{' '}
                <strong className={b.arrastreCents < 0 ? 'presup-rojo' : undefined}>
                  {fmtMoney(Math.abs(b.arrastreCents))}
                </strong>
              </>
            )}
            : {fmtMoney(b.amountCents)} {b.arrastreCents > 0 ? '+' : '−'}{' '}
            {fmtMoney(Math.abs(b.arrastreCents))} = {fmtMoney(b.topeCents)}
          </p>
        )}
        {/*
          Un techo bajo cero no es un techo: es una deuda con el mes que viene, y
          leído como cifra suelta ("llevas $645.29 de −$16,383.12") no dice nada.
          Se explica qué significa y dónde está la salida, que es el botón de
          aquí abajo — apagar el arrastre de este mes reinicia la cadena (D27).
        */}
        {b.topeCents < 0 && (
          <p className="presup-arrastre presup-sin-techo">
            Con eso, este mes <strong>no tienes techo</strong>: cualquier gasto se pasa hasta
            cubrir el faltante. Si prefieres empezar de nuevo, quita el arrastre de este mes —
            los meses anteriores se quedan como están.
          </p>
        )}
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
          {b.periodKind === 'mes' && (
            <button type="button" className="btn-liga" onClick={() => toggleRollover(b)}>
              {b.rollover ? 'Que no ruede' : 'Que el sobrante ruede'}
            </button>
          )}
          <button type="button" className="btn-liga deuda-borrar" onClick={() => remove(b)}>
            Quitar
          </button>
        </footer>
      </article>
    )
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

      {data && mensuales.length === 0 && anuales.length === 0 && !total ? (
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
        data && (
          <section className="hoja presup-resumen">
            {total ? (
              <>
                <div className="presup-totales">
                  <span className="rotulo">Tope de todo el mes</span>
                  <p className="presup-frase">
                    Gastado <Money cents={total.spentCents} className="cifra-chica" /> de{' '}
                    {editingTotal ? (
                      <span className="campo-inline presup-editor">
                        <span className="monto-signo">$</span>
                        <input
                          className="campo-input"
                          inputMode="decimal"
                          value={totalValue}
                          autoFocus
                          onChange={(e) => setTotalValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              void guardarTotal()
                            }
                            if (e.key === 'Escape') setEditingTotal(false)
                          }}
                        />
                        <button type="button" className="btn-liga" onClick={guardarTotal}>
                          Guardar
                        </button>
                      </span>
                    ) : (
                      <Money cents={total.amountCents} className="cifra-chica" />
                    )}
                    {total.spentCents <= total.amountCents ? (
                      <> · quedan <strong className="cifra-chica">{fmtMoney(total.amountCents - total.spentCents)}</strong></>
                    ) : (
                      <> · <strong className="cifra-chica presup-rojo">excedido por {fmtMoney(total.spentCents - total.amountCents)}</strong></>
                    )}
                    {ritmo(total.spentCents, total.esperadoCents, avance) && (
                      <> · {ritmo(total.spentCents, total.esperadoCents, avance)}</>
                    )}
                  </p>
                </div>
                <Riel
                  gastado={total.spentCents}
                  tope={total.amountCents}
                  estado={
                    total.spentCents > total.amountCents
                      ? 'excedido'
                      : total.spentCents >= total.amountCents * 0.8
                        ? 'alerta'
                        : 'bien'
                  }
                  avance={avance}
                />
                {/*
                  La diferencia con la suma de los topes por categoría es el
                  punto entero del tope total: cuenta lo que gastaste donde no
                  pusiste techo. Un techo que ignorara eso no sería un techo.
                */}
                <p className="presup-pie">
                  Cuenta <strong>todo</strong> el gasto del mes, también el de categorías sin tope.
                  {mensuales.length > 0 && (
                    <> Bajo un tope por categoría llevas {fmtMoney(totalSpent)} de {fmtMoney(totalBudget)}.</>
                  )}
                  {' · '}
                  <button type="button" className="btn-liga" onClick={() => { setEditingTotal(true); setTotalValue((total.amountCents / 100).toFixed(2)) }}>
                    Cambiar
                  </button>
                  {' · '}
                  <button type="button" className="btn-liga deuda-borrar" onClick={quitarTotal}>
                    Quitar
                  </button>
                </p>
              </>
            ) : (
              <>
                <div className="presup-totales">
                  <span className="rotulo">De lo presupuestado</span>
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
                <Riel
                  gastado={totalSpent}
                  tope={totalBudget}
                  estado={
                    totalSpent > totalBudget
                      ? 'excedido'
                      : totalSpent >= totalBudget * 0.8
                        ? 'alerta'
                        : 'bien'
                  }
                  avance={avance}
                />
                <p className="presup-pie">
                  Es la suma de los topes por categoría, no un techo del mes.
                  {' '}
                  <button
                    type="button"
                    className="btn-liga"
                    onClick={() => { setEditingTotal(true); setTotalValue('') }}
                  >
                    Ponle techo a todo el mes
                  </button>
                  {editingTotal && (
                    <span className="campo-inline presup-editor">
                      <span className="monto-signo">$</span>
                      <input
                        className="campo-input"
                        inputMode="decimal"
                        value={totalValue}
                        autoFocus
                        placeholder="Tope del mes"
                        aria-label="Tope de todo el mes"
                        onChange={(e) => setTotalValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            void guardarTotal()
                          }
                          if (e.key === 'Escape') setEditingTotal(false)
                        }}
                      />
                      <button type="button" className="btn-liga" onClick={guardarTotal}>
                        Guardar
                      </button>
                    </span>
                  )}
                </p>
              </>
            )}
            {/*
              El ritmo escrito, no solo dibujado. La marca sobre el riel dice
              dónde deberías ir; esta línea dice lo mismo con palabras, que es
              lo único que se lee con teclado, en papel o en voz alta (R19).
            */}
            <p className="presup-ritmo">
              {avance >= 1 && !enCurso
                ? `${monthLabel(month)} ya cerró: aquí no hay ritmo que seguir, solo el resultado.`
                : avance <= 0
                  ? `${monthLabel(month)} todavía no empieza.`
                  : `Día ${diaDeHoy} de ${diasDelMes}: llevas el ${Math.round(avance * 100)} % del mes. La marca de cada barra es ahí donde irías yendo parejo.`}
            </p>
          </section>
        )
      )}

      {mensuales.length > 0 && (
        <section className="presup-lista">
          <h2 className="rotulo">Del mes</h2>
          {mensuales.map((b, i) => filaPresupuesto(b, i, avance))}
        </section>
      )}

      {/*
        Los topes anuales viajan con todos los meses del año a propósito: la
        tenencia se paga en marzo y en septiembre sigue importando cuánto quedó.
        Uno que solo se viera en su mes de pago no serviría para lo único que
        sirve, que es no llegar a diciembre sin dinero para lo de diciembre.
      */}
      {anuales.length > 0 && (
        <section className="presup-lista">
          <h2 className="rotulo">Del año {anio}</h2>
          <p className="presup-pie">
            Para lo que no es mensual: tenencia, seguros, la reinscripción. Se miden contra el año
            entero, así que en {monthLabel(month)} van al {Math.round(avanceAnual * 100)} % del año.
          </p>
          {anuales.map((b, i) => filaPresupuesto(b, i, avanceAnual))}
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
              if (await setBudget(newCategoryId, newAmount, { periodKind: newKind })) {
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
            <select
              className="filtro"
              value={newKind}
              onChange={(e) => {
                // La lista de categorías libres es distinta en cada periodo:
                // dejar seleccionada una que ya no está sería fijar un tope a
                // la categoría equivocada de un clic.
                setNewKind(e.target.value as 'mes' | 'anio')
                setNewCategoryId(0)
              }}
              aria-label="Periodo del tope"
            >
              <option value="mes">Por mes ({monthLabel(month)})</option>
              <option value="anio">Por año ({anio})</option>
            </select>
            <div className="monto-wrap">
              <span className="monto-signo" aria-hidden="true">$</span>
              <input
                className="campo-input"
                inputMode="decimal"
                placeholder={newKind === 'anio' ? 'Tope anual' : 'Tope mensual'}
                value={newAmount}
                onChange={(e) => setNewAmount(e.target.value)}
                aria-label={newKind === 'anio' ? 'Tope anual' : 'Tope mensual'}
              />
            </div>
            <button type="submit" className="btn btn-primario btn-chico">Fijar</button>
          </form>
          {formError && <p className="forma-error" role="alert">{formError}</p>}
          {mensuales.length > 0 && (
            <p className="presup-pie">
              <button type="button" className="btn-liga" onClick={copyPrevious}>
                Traer los topes de {monthLabel(shiftMonth(month, -1))}
              </button>
              {' · no toca los que ya fijaste en este mes'}
            </p>
          )}
        </section>
      )}

      {formError && available.length === 0 && <p className="forma-error" role="alert">{formError}</p>}
    </div>
  )
}
