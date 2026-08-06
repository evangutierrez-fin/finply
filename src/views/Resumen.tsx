import { useState } from 'react'
import { api } from '../api.ts'
import { useApp } from '../context.ts'
import { useFetch } from '../hooks.ts'
import { currentMonth, fmtDate, fmtMoney, monthLabel, shiftMonth, todayISO } from '../format.ts'
import { CountUpMoney, Money } from '../components/Money.tsx'
import { CategoryBars, Composicion, MonthBars, Spark } from '../components/Charts.tsx'
import { BarraRapida } from '../components/BarraRapida.tsx'
import { NotaModal } from '../components/NotaModal.tsx'
import type { View } from '../components/Sidebar.tsx'
import { diasEntre, finDeMes } from '../../shared/fechas.ts'
import type { Alerta, FlujoProyectado, Note, Tx } from '../../shared/types.ts'

function txSignedCents(tx: Tx): number {
  return tx.type === 'gasto' ? -tx.amountCents : tx.amountCents
}

/**
 * Las alertas no se descartan (D10): se apagan solas cuando el hecho deja de
 * ser cierto. Por eso no hay una ✕ en ninguna — cerrar una sería esconder algo
 * que sigue pasando.
 *
 * Desde la Fase 20 la de la tarjeta trae **el pago al lado**. El aviso decía
 * cuánto y cuándo, y para hacerle caso había que ir a Tarjetas, abrir el
 * formulario y volver a teclear una cifra que estaba dos centímetros arriba.
 * El botón la lleva puesta; lo que no hace es pagar solo (R4).
 */
function Alertas({
  alertas,
  onNav,
  onPagarTarjeta,
}: {
  alertas: Alerta[]
  onNav: (view: View) => void
  onPagarTarjeta: (alerta: Alerta) => void
}) {
  if (alertas.length === 0) return null
  return (
    <section className="alertas" aria-label="Avisos">
      <ul className="alertas-lista">
        {alertas.map((a, i) => (
          <li key={`${a.tipo}-${a.refId}-${i}`} className={`alerta alerta-${a.severidad}`}>
            <button type="button" className="alerta-cuerpo" onClick={() => onNav(a.vista)}>
              <span className="alerta-punto" aria-hidden="true" />
              <span className="alerta-textos">
                <span className="alerta-titulo">{a.titulo}</span>
                <span className="alerta-detalle">{a.detalle}</span>
              </span>
              {a.montoCents !== null && (
                <span className="cifra alerta-monto">{fmtMoney(a.montoCents)}</span>
              )}
            </button>
            {a.tipo === 'tarjeta' && a.refId !== null && a.montoCents !== null && (
              <button
                type="button"
                className="btn btn-fantasma btn-chico alerta-accion"
                onClick={() => onPagarTarjeta(a)}
              >
                Pagarla
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * Las notas del mes (Fase 20). La libreta era la única sección que no se
 * hablaba con ninguna otra: aquí es donde tiene sentido leer "este mes gasté
 * de más por la mudanza", junto a la cifra que lo dice.
 */
function NotasDelMes({
  notas,
  month,
  onEscribir,
  onAbrir,
}: {
  notas: Note[]
  month: string
  onEscribir: () => void
  onAbrir: (nota: Note) => void
}) {
  return (
    <section className="hoja notas-mes">
      <div className="hoja-head">
        <h2 className="hoja-titulo">Notas de {monthLabel(month).toLowerCase()}</h2>
        <button type="button" className="btn-liga" onClick={onEscribir}>
          ＋ Apuntar algo del mes
        </button>
      </div>
      {notas.length === 0 ? (
        <p className="grafica-vacia">
          Nada apuntado este mes. Lo que explica una cifra vale tanto como la cifra.
        </p>
      ) : (
        <ul className="notas-mes-lista">
          {notas.map((n) => (
            <li key={n.id}>
              <button type="button" className="nota-liga" onClick={() => onAbrir(n)}>
                {n.title && <span className="nota-liga-titulo">{n.title}</span>}
                <span className="nota-liga-texto">{n.body}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * El cambio contra el cierre del mes pasado, debajo del total.
 *
 * La resta es contra **la misma cifra que se ve arriba** —cuentas activas—, así
 * que quien quiera comprobarla puede hacerlo a mano. El porcentaje solo se
 * escribe cuando el mes pasado cerró en positivo: contra cero o contra un
 * número negativo, un porcentaje es un número grande que no significa nada.
 */
function Delta({ actual, previo, mes }: { actual: number; previo: number; mes: string }) {
  const delta = actual - previo
  if (delta === 0) {
    return <span className="hero-delta">Igual que al cierre de {mes.toLowerCase()}</span>
  }
  const pct = previo > 0 ? Math.round((delta / previo) * 1000) / 10 : null
  return (
    <span className={`hero-delta${delta > 0 ? ' delta-sube' : ' delta-baja'}`}>
      <span aria-hidden="true">{delta > 0 ? '▲' : '▼'}</span>{' '}
      <Money cents={delta} signed className="cifra-chica" />
      {pct !== null && ` · ${delta > 0 ? '+' : ''}${pct} %`} contra el cierre de {mes.toLowerCase()}
    </span>
  )
}

/**
 * La pregunta de la Fase 16, contestada donde primero se mira.
 *
 * La cifra es la **caja** —líquido: efectivo, banco y ahorro—, que no es el
 * total de arriba: la tarjeta no es dinero tuyo. Por eso lleva su rótulo y su
 * liga a la vista, donde la proyección se puede auditar renglón por renglón.
 */
function FinDeMes({ flujo, onNav }: { flujo: FlujoProyectado; onNav: (view: View) => void }) {
  const rojo = flujo.primerDiaEnRojo
  return (
    <section className={`hoja fin-de-mes${rojo ? ' en-rojo' : ''}`}>
      <div className="fin-de-mes-cifra">
        <span className="rotulo">
          {rojo ? 'Te quedas corto' : `Caja al ${fmtDate(flujo.hasta)}`}
        </span>
        {rojo ? (
          <span className="hero-cifra-media stat-rojo">{fmtDate(rojo)}</span>
        ) : (
          <Money cents={flujo.saldoFinalCents} className="hero-cifra-media" />
        )}
      </div>
      <p className="fin-de-mes-nota">
        {rojo ? (
          <>
            Con lo que ya está comprometido, la caja baja a{' '}
            <Money cents={flujo.minimo.saldoCents} className="cifra-chica" /> el{' '}
            {fmtDate(flujo.minimo.fecha)}. Nada está asentado todavía.
          </>
        ) : flujo.eventos.length === 0 ? (
          <>
            No hay nada comprometido de aquí al {fmtDate(flujo.hasta)}: lo líquido se queda como
            está.
          </>
        ) : (
          <>
            Lo líquido de hoy, más{' '}
            <Money cents={flujo.entradasCents} className="cifra-chica" /> que entran y{' '}
            <Money cents={flujo.salidasCents} className="cifra-chica" /> que salen en{' '}
            {flujo.eventos.length} {flujo.eventos.length === 1 ? 'renglón' : 'renglones'}.
          </>
        )}
      </p>
      <button type="button" className="btn-liga" onClick={() => onNav('flujo')}>
        Ver el flujo día a día →
      </button>
    </section>
  )
}

export function Resumen({ onNav }: { onNav: (view: View) => void }) {
  const { profile, refreshKey, bump, openTx } = useApp()
  const month = currentMonth()
  const [nota, setNota] = useState<{ open: boolean; note: Note | null }>({
    open: false,
    note: null,
  })
  const { data, error } = useFetch(
    () => api.summary(profile.id, month),
    [profile.id, refreshKey],
  )
  // En su propia petición: si el cálculo de una alerta falla, el Resumen sigue
  // siendo el Resumen.
  const { data: alertas } = useFetch(() => api.alertas(profile.id), [profile.id, refreshKey])
  // Y el flujo en la suya, por lo mismo. La ventana es exactamente lo que queda
  // del mes —cero días el día 31, que es una pregunta legítima—, no treinta
  // días redondos: "a fin de mes" es una fecha, no un plazo.
  const { data: flujo } = useFetch(
    () => api.flujo(profile.id, Math.max(0, diasEntre(todayISO(), finDeMes(todayISO())))),
    [profile.id, refreshKey],
  )
  // Las notas de este mes, en su propia petición como las alertas y el flujo.
  const { data: notasDelMes } = useFetch(
    () => api.notes.list(profile.id, { period: month }),
    [profile.id, refreshKey],
  )

  if (error) return <p className="aviso" role="alert">{error}</p>
  if (!data) return <div className="cargando" aria-label="Cargando" />

  const active = data.accounts.filter((a) => !a.archived)
  const neto = data.incomeCents - data.expenseCents
  const sparks = new Map(data.sparks.porCuenta.map((s) => [s.accountId, s.puntos]))
  // Un renglón se enseña si su módulo está encendido **o si trae saldo**: quien
  // apagó Deudas teniendo una abierta tiene que seguir viendo de dónde sale su
  // patrimonio, o la resta no cuadra con lo que se ve.
  const conDeudas = profile.modules.includes('deudas')
  const conInversiones = profile.modules.includes('inversiones')
  const conBienes = profile.modules.includes('bienes')

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

      <Alertas
        alertas={alertas ?? []}
        onNav={onNav}
        onPagarTarjeta={(a) => {
          // Pagar una tarjeta es una **transferencia**: sale del banco y baja
          // lo que debes, no es un gasto nuevo (D6). El monto y el destino los
          // pone la alerta; de qué cuenta sale lo dice el usuario, que es la
          // única parte que Finply no sabe.
          const tarjeta = data.accounts.find((a2) => a2.id === a.refId)
          openTx(null, {
            type: 'transferencia',
            transferAccountId: a.refId ?? undefined,
            amountCents: a.montoCents ?? undefined,
            note: tarjeta ? `Pago de ${tarjeta.name}` : 'Pago de tarjeta',
          })
        }}
      />

      <BarraRapida />

      <section className="hero">
        <div className="hero-total">
          <span className="rotulo">Suma total · {active.length} {active.length === 1 ? 'cuenta' : 'cuentas'}</span>
          <CountUpMoney cents={data.totalCents} className="hero-cifra" />
          <Delta
            actual={data.totalCents}
            previo={data.totalPrevioCents}
            mes={monthLabel(shiftMonth(month, -1))}
          />
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
        {/*
          El supuesto va junto a la cifra, no en una nota al pie de otra vista
          (R9). Estas tres cuentan con la regla de D6, la misma de Reportes y
          Análisis: hasta la Fase 18 el Resumen sumaba en crudo y un préstamo
          recibido salía aquí como ingreso y allá no.
        */}
        <p className="hero-supuesto">
          Entró y salió cuentan lo que ganaste y lo que gastaste. Recibir un préstamo, aportar a una
          inversión, guardar el depósito de un inquilino o abonar capital a una deuda no aparecen
          aquí: mueven tu dinero de bolsillo, no lo crean ni lo consumen. Tu saldo de arriba sí los
          incluye, porque ese es el dinero que tienes.
        </p>
      </section>

      {flujo && <FinDeMes flujo={flujo} onNav={onNav} />}

      <section className="cuentas-tira" aria-label="Cuentas">
        {active.map((a, i) => {
          // La minigráfica es la forma; el cambio en pesos es el dato, y va
          // escrito. Una cuenta abierta esta semana no tiene 30 días que
          // enseñar y no se le inventan.
          const puntos = sparks.get(a.id) ?? []
          const cambio = puntos.length > 1 ? puntos.at(-1)! - puntos[0]! : 0
          return (
            <button
              type="button"
              key={a.id}
              className="cuenta-mini"
              style={{ animationDelay: `${i * 50}ms` }}
              onClick={() => onNav('cuentas')}
            >
              <span className="cuenta-mini-nombre">{a.name}</span>
              <Money cents={a.balanceCents} className="cuenta-mini-saldo" />
              <Spark puntos={puntos} />
              <span className="cuenta-mini-cambio">
                {cambio === 0 ? (
                  'sin cambio en 30 días'
                ) : (
                  <>
                    <Money cents={cambio} signed className="cifra-chica" /> en 30 días
                  </>
                )}
              </span>
            </button>
          )
        })}
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
            {conDeudas && (
              <button type="button" className="btn-liga" onClick={() => onNav('deudas')}>
                Ver deudas →
              </button>
            )}
          </div>
          {/*
            Los renglones siguen a los módulos, pero **el total no**: aunque no
            veas la sección de deudas, lo que debes sigue restando de tu
            patrimonio. Apagar un módulo esconde una vista, no cambia una cifra
            (R18) — un patrimonio que sube por apagar Deudas sería una mentira
            cómoda, que es la peor clase.
          */}
          {/*
            Las dos barras van **antes** de la lista y a la misma escala: cuatro
            números en fila no dicen si tu casa pesa más que tu deuda. La lista
            de abajo es la tabla de esta gráfica —cada renglón con su muestra y
            su cifra—, así que ningún dato vive solo en el color (R19).
          */}
          <Composicion
            partes={[
              { nombre: 'En cuentas', cents: data.totalCents },
              { nombre: 'Inversiones', cents: data.investments.valueCents },
              { nombre: 'Bienes', cents: data.bienes.valueCents },
              { nombre: 'Te deben', cents: data.debts.porCobrarCents },
            ]}
            debesCents={data.debts.porPagarCents}
          />
          <dl className="deudas-mini-lista">
            <div>
              <dt><span className="muestra-parte parte-0" aria-hidden="true" />En cuentas</dt>
              <dd><Money cents={data.totalCents} /></dd>
            </div>
            {(conInversiones || data.investments.valueCents !== 0) && (
              <div>
                <dt><span className="muestra-parte parte-1" aria-hidden="true" />Inversiones</dt>
                <dd><Money cents={data.investments.valueCents} /></dd>
              </div>
            )}
            {(conBienes || data.bienes.valueCents !== 0) && (
              <div>
                <dt><span className="muestra-parte parte-2" aria-hidden="true" />Bienes</dt>
                <dd><Money cents={data.bienes.valueCents} /></dd>
              </div>
            )}
            {(conDeudas || data.debts.porCobrarCents !== 0) && (
              <div>
                <dt><span className="muestra-parte parte-3" aria-hidden="true" />Te deben</dt>
                <dd><Money cents={data.debts.porCobrarCents} className="stat-in" /></dd>
              </div>
            )}
            {(conDeudas || data.debts.porPagarCents !== 0) && (
              <div>
                <dt><span className="muestra-parte parte-debes" aria-hidden="true" />Debes</dt>
                <dd><Money cents={-data.debts.porPagarCents} /></dd>
              </div>
            )}
            <div className="patrimonio-total">
              <dt>Patrimonio</dt>
              <dd>
                <span className="doble-raya">
                  <Money
                    cents={
                      data.totalCents +
                      data.investments.valueCents +
                      data.bienes.valueCents +
                      data.debts.porCobrarCents -
                      data.debts.porPagarCents
                    }
                  />
                </span>
              </dd>
            </div>
          </dl>
          {conDeudas && (
            <p className="deudas-mini-nota">
              {data.debts.abiertas === 0
                ? 'Sin deudas pendientes. El libro está en paz.'
                : `${data.debts.abiertas} ${data.debts.abiertas === 1 ? 'deuda abierta' : 'deudas abiertas'} entre cobros y pagos.`}
            </p>
          )}
        </article>
      </section>

      <NotasDelMes
        notas={notasDelMes ?? []}
        month={month}
        onEscribir={() => setNota({ open: true, note: null })}
        onAbrir={(n) => setNota({ open: true, note: n })}
      />

      {nota.open && (
        <NotaModal
          note={nota.note}
          period={month}
          onClose={() => setNota({ open: false, note: null })}
          onSaved={bump}
        />
      )}
    </div>
  )
}
