import { useState } from 'react'
import { api } from '../api.ts'
import { useApp } from '../context.ts'
import { useFetch } from '../hooks.ts'
import { fmtMoney, monthLabel } from '../format.ts'
import { Money } from '../components/Money.tsx'
import { CategoryBars } from '../components/Charts.tsx'
import { CONSISTENCIA_MINIMA } from '../../shared/estadistica.ts'
import type { Analisis as Datos, Tendencia } from '../../shared/types.ts'

const VENTANAS = [
  { meses: 3, label: '3 meses' },
  { meses: 6, label: '6 meses' },
  { meses: 12, label: '12 meses' },
]

/** Debajo de cuánto una compra es "hormiga". El usuario elige; nada es sagrado. */
const UMBRALES = [10_000, 20_000, 50_000]

/** 0.3421 → '34 %'. Sin ingresos no hay tasa, y eso se dice, no se inventa. */
function fmtTasa(tasa: number | null): string {
  return tasa === null ? '—' : `${Math.round(tasa * 100)} %`
}

/** 4.318 → '4.3'. Un decimal: nadie tiene 4.318 meses de colchón. */
function fmtMeses(meses: number | null): string {
  return meses === null ? '—' : meses.toFixed(1)
}

/**
 * Gasto recurrente contra discrecional. Dos segmentos con su nombre y su
 * porcentaje escritos al lado: el color no es la única forma de leerlos, y por
 * eso la barra no necesita la textura del par entrada/salida (R10).
 */
function BarraOrigen({ datos }: { datos: Datos }) {
  const total = datos.recurrenteCents + datos.discrecionalCents
  if (total === 0) return <p className="grafica-vacia">Sin gastos en el periodo.</p>
  const parte = (n: number) => Math.round((n / total) * 100)
  return (
    <div className="origen">
      <div className="origen-riel" role="img" aria-label={`${parte(datos.recurrenteCents)} % recurrente, ${parte(datos.discrecionalCents)} % discrecional`}>
        <span className="origen-recurrente" style={{ width: `${(datos.recurrenteCents / total) * 100}%` }} />
        <span className="origen-discrecional" style={{ width: `${(datos.discrecionalCents / total) * 100}%` }} />
      </div>
      <dl className="origen-leyenda">
        <div>
          <dt><span className="muestra muestra-recurrente" aria-hidden="true" /> Recurrente</dt>
          <dd>
            <span className="cifra">{fmtMoney(datos.recurrenteCents)}</span>
            <span className="origen-parte">{parte(datos.recurrenteCents)} %</span>
          </dd>
        </div>
        <div>
          <dt><span className="muestra muestra-discrecional" aria-hidden="true" /> Discrecional</dt>
          <dd>
            <span className="cifra">{fmtMoney(datos.discrecionalCents)}</span>
            <span className="origen-parte">{parte(datos.discrecionalCents)} %</span>
          </dd>
        </div>
      </dl>
    </div>
  )
}

/**
 * La frase de una tendencia. Es lo único que se lee sin ver la gráfica, así que
 * lleva el sentido, la cifra por mes y el ajuste — y cuando el ajuste es malo
 * lo dice en vez de dibujar una flecha con aire de certeza (R9).
 */
function fraseTendencia(t: Tendencia | null, que: string, meses: number): string {
  if (t === null) return `Con menos de tres meses cerrados no hay tendencia que medir, solo dos puntos.`
  const porMes = fmtMoney(Math.abs(t.pendienteCents))
  const rumbo = t.pendienteCents > 0 ? 'subiendo' : t.pendienteCents < 0 ? 'bajando' : 'plano'
  if (t.consistencia < CONSISTENCIA_MINIMA) {
    return (
      `Tus ${meses} meses van sin dirección: solo ${Math.round(t.consistencia * 100)} % de los ` +
      `pares de meses coinciden en el sentido, así que Finply no dice que tu ${que} vaya ` +
      `subiendo ni bajando. Un mes caro y otro tranquilo no son una dirección.`
    )
  }
  if (rumbo === 'plano') return `Tu ${que} lleva ${meses} meses parejo.`
  return (
    `Tu ${que} va ${rumbo} unos ${porMes} al mes: de ${fmtMoney(t.primeroCents)} ` +
    `a ${fmtMoney(t.ultimoCents)} según la recta, y ${Math.round(t.consistencia * 100)} % de los ` +
    `pares de meses van en ese mismo sentido.`
  )
}

/**
 * La serie con su recta encima. La cifra que importa —cuánto sube al mes— ya
 * está escrita arriba; esto es el apoyo, no el dato (R19).
 */
function SerieConRecta({ datos }: { datos: Datos }) {
  const t = datos.tendenciaGasto
  const valores = datos.serie.map((m) => m.expenseCents)
  if (valores.length < 2) return null
  const max = Math.max(...valores, t ? Math.max(t.primeroCents, t.ultimoCents) : 0) || 1
  const x = (i: number) => (i / (valores.length - 1)) * 100
  const y = (v: number) => 40 - (v / max) * 38

  return (
    <div className="tendencia-grafica">
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
        <path
          d={valores.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(' ')}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          vectorEffect="non-scaling-stroke"
        />
        {t && t.consistencia >= CONSISTENCIA_MINIMA && (
          <path
            d={`M0,${y(t.primeroCents).toFixed(2)} L100,${y(t.ultimoCents).toFixed(2)}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            strokeDasharray="3 3"
            opacity="0.55"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      <p className="tendencia-pie">
        {monthLabel(datos.serie[0]!.month)} … {monthLabel(datos.serie.at(-1)!.month)} · línea
        continua: tu gasto mes a mes · punteada: la recta
      </p>
      {/* La misma serie en texto, para quien no ve la gráfica (R19). */}
      <table className="sr-only">
        <caption>Gasto por mes cerrado</caption>
        <tbody>
          {datos.serie.map((m) => (
            <tr key={m.month}>
              <th scope="row">{monthLabel(m.month)}</th>
              <td>{fmtMoney(m.expenseCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * El mismo mes, año contra año, en orden cronológico.
 *
 * No usa `CategoryBars` por una razón de fondo: aquel pone al lado la parte del
 * total, y aquí el total no significa nada — 2025 y 2026 no son partes de un
 * entero, son el mismo mes dos veces. Un "29 % / 71 %" ahí sería una cifra
 * correcta contestando una pregunta que nadie hizo.
 */
function SerieAnual({ puntos }: { puntos: { anio: string; expenseCents: number }[] }) {
  const max = Math.max(...puntos.map((p) => p.expenseCents), 1)
  return (
    <ul className="cat-bars">
      {puntos.map((p, i) => (
        <li key={p.anio} className="cat-row">
          <span className="cat-nombre">{p.anio}</span>
          <span className="cat-riel">
            <span
              className="cat-lleno"
              style={{
                width: `${Math.max(2, (p.expenseCents / max) * 100)}%`,
                animationDelay: `${i * 60}ms`,
              }}
            />
          </span>
          <span className="cifra cifra-chica">{fmtMoney(p.expenseCents)}</span>
        </li>
      ))}
    </ul>
  )
}

export function Analisis() {
  const { profile, refreshKey } = useApp()
  const [meses, setMeses] = useState(6)
  const [umbral, setUmbral] = useState(UMBRALES[1]!)
  const { data, error } = useFetch(
    () => api.analisis(profile.id, meses, umbral),
    [profile.id, meses, umbral, refreshKey],
  )

  const top = data?.concentracion[0]
  const parteTop = top && data!.expenseCents > 0 ? Math.round(top.parte * 100) : null

  return (
    <div className="vista">
      <header className="vista-head">
        <h1>Análisis</h1>
        <div className="seg seg-chico" role="radiogroup" aria-label="Meses cerrados que entran">
          {VENTANAS.map((v) => (
            <button
              key={v.meses}
              type="button"
              role="radio"
              aria-checked={meses === v.meses}
              className={`seg-item${meses === v.meses ? ' activa' : ''}`}
              onClick={() => setMeses(v.meses)}
            >
              {v.label}
            </button>
          ))}
        </div>
      </header>

      {error && <p className="aviso" role="alert">{error}</p>}
      {!data && !error && <p className="cargando">Midiendo los meses cerrados…</p>}

      {data && data.meses === 0 && (
        <div className="vacio">
          <p className="vacio-titulo">Todavía no hay un mes cerrado que medir.</p>
          <p className="vacio-sub">
            Este panel mira meses completos: el que está en curso va a medias y arrastraría
            cualquier promedio. Vuelve cuando termine el mes.
          </p>
        </div>
      )}

      {data && data.meses > 0 && (
        <>
          <section className="hoja analisis-hero">
            <div className="analisis-hero-dato">
              <span className="rotulo">Meses de colchón</span>
              <span className="hero-cifra-media">{fmtMeses(data.mesesColchon)}</span>
              <span className="analisis-hero-pie">
                {fmtMoney(data.liquidoCents)} líquidos entre {fmtMoney(data.gastoPromedioCents ?? 0)}{' '}
                de gasto al mes
              </span>
            </div>
            <dl className="analisis-stats">
              <div>
                <dt>Tasa de ahorro</dt>
                <dd className="cifra">{fmtTasa(data.tasaAhorro)}</dd>
              </div>
              <div>
                <dt>Entró</dt>
                <dd><Money cents={data.incomeCents} className="stat-in" /></dd>
              </div>
              <div>
                <dt>Salió</dt>
                <dd><Money cents={data.expenseCents} /></dd>
              </div>
              <div>
                <dt>Meses medidos</dt>
                <dd className="cifra">{data.meses}</dd>
              </div>
            </dl>
            <p className="reportes-supuesto">
              De {monthLabel(data.desde)} a {monthLabel(data.hasta)}
              {data.meses < meses && ` — son los ${data.meses} meses cerrados que tiene tu libro, no ${meses}`}.
              El mes en curso no entra: va a medias y bajaría todos los promedios. El colchón
              cuenta como líquido tu efectivo, banco y ahorro; una tarjeta no es colchón, es
              crédito de alguien más.
            </p>
          </section>

          <div className="dos-columnas">
            <section className="hoja">
              <h2 className="hoja-titulo">Recurrente contra discrecional</h2>
              <BarraOrigen datos={data} />
              <p className="reportes-nota">
                Recurrente es el gasto que <strong>nació de una recurrencia</strong> tuya y lo
                asentaste desde la bandeja. Una renta que apuntaste a mano cuenta como
                discrecional aunque se repita cada mes: Finply no adivina lo que nadie declaró.
              </p>
            </section>
            <section className="hoja">
              <h2 className="hoja-titulo">Concentración por categoría</h2>
              <CategoryBars byCategory={data.concentracion.slice(0, 8)} />
              {parteTop !== null && top && (
                <p className="reportes-nota">
                  {top.name} se lleva <strong className="cifra-chica">{parteTop} %</strong> de todo
                  lo que gastaste en el periodo
                  {data.concentracion.length > 2 && (
                    <>
                      ; las tres primeras juntas,{' '}
                      <strong className="cifra-chica">
                        {Math.round(
                          data.concentracion.slice(0, 3).reduce((s, c) => s + c.parte, 0) * 100,
                        )}{' '}
                        %
                      </strong>
                    </>
                  )}
                  .
                </p>
              )}
            </section>
          </div>

          {/*
            ¿Voy subiendo o bajando? Es la pregunta que un promedio no contesta:
            seis meses pueden promediar lo mismo yendo hacia arriba o hacia
            abajo. El método va escrito, y con él el umbral de cuándo Finply se
            calla (R9).
          */}
          <section className="hoja">
            <h2 className="hoja-titulo">¿Voy subiendo o bajando?</h2>
            <p className="analisis-frase">{fraseTendencia(data.tendenciaGasto, 'gasto', data.meses)}</p>
            <SerieConRecta datos={data} />
            <p className="reportes-nota">
              {fraseTendencia(data.tendenciaIngreso, 'ingreso', data.meses)}
            </p>
            <p className="reportes-supuesto">
              El método: se mide el cambio entre <strong>cada par</strong> de meses cerrados y se
              toma el de en medio. No es la recta de mínimos cuadrados de siempre, y por una razón
              concreta: con cinco meses parejos y un viaje en el sexto, aquella declaraba que tu
              gasto subía miles al mes — un solo mes le torcía el brazo. Una mediana no se deja
              mover por un dato raro. Si menos de dos de cada tres pares van en el mismo sentido,
              Finply dice que no hay dirección en vez de dibujar una flecha. Y con menos de tres
              meses no dice nada: por dos puntos pasa siempre una recta.
            </p>
          </section>

          <div className="dos-columnas">
            {/*
              Estacionalidad. Diciembre siempre cuesta más, y comparar diciembre
              con noviembre solo dice que subió — no si subió lo de siempre.
            */}
            <section className="hoja">
              <h2 className="hoja-titulo">
                {monthLabel(data.hasta).split(' ')[0]} contra otros años
              </h2>
              {data.estacionalidad.length < 2 ? (
                <p className="grafica-vacia">
                  Todavía no hay otro {monthLabel(data.hasta).split(' ')[0]?.toLowerCase()} con qué
                  compararlo. Esta sección se llena sola cuando tu libro cumpla un año.
                </p>
              ) : (
                <>
                  <SerieAnual puntos={data.estacionalidad} />
                  <p className="reportes-nota">
                    {(() => {
                      const puntos = data.estacionalidad
                      const ultimo = puntos.at(-1)!
                      const previos = puntos.slice(0, -1)
                      const promedio = Math.round(
                        previos.reduce((s, p) => s + p.expenseCents, 0) / previos.length,
                      )
                      const delta = ultimo.expenseCents - promedio
                      if (promedio === 0) return 'Los años anteriores no tuvieron gasto en este mes.'
                      return (
                        <>
                          Este {monthLabel(data.hasta).split(' ')[0]?.toLowerCase()} gastaste{' '}
                          <strong className="cifra-chica">{fmtMoney(Math.abs(delta))}</strong>{' '}
                          {delta >= 0 ? 'más' : 'menos'} que el promedio de los{' '}
                          {previos.length === 1 ? 'del año anterior' : `${previos.length} anteriores`}{' '}
                          ({fmtMoney(promedio)}).
                        </>
                      )
                    })()}
                  </p>
                </>
              )}
            </section>

            {/* Gasto hormiga: lo que no duele de a uno y sí de a trescientos. */}
            <section className="hoja">
              <header className="hoja-head">
                <h2 className="hoja-titulo">Gasto hormiga</h2>
                <div className="seg seg-chico" role="radiogroup" aria-label="Debajo de cuánto es hormiga">
                  {UMBRALES.map((u) => (
                    <button
                      key={u}
                      type="button"
                      role="radio"
                      aria-checked={umbral === u}
                      className={`seg-item${umbral === u ? ' activa' : ''}`}
                      onClick={() => setUmbral(u)}
                    >
                      {fmtMoney(u)}
                    </button>
                  ))}
                </div>
              </header>
              {data.hormiga.partidas === 0 ? (
                <p className="grafica-vacia">
                  Ninguna partida por debajo de {fmtMoney(data.hormiga.umbralCents)} en el periodo.
                </p>
              ) : (
                <>
                  <p className="analisis-frase">
                    <strong className="cifra">{data.hormiga.partidas}</strong> partidas de menos de{' '}
                    {fmtMoney(data.hormiga.umbralCents)} suman{' '}
                    <strong className="cifra">{fmtMoney(data.hormiga.sumaCents)}</strong>: el{' '}
                    <strong className="cifra">{Math.round(data.hormiga.parte * 100)} %</strong> de
                    todo lo que gastaste.
                  </p>
                  <p className="reportes-nota">
                    Se cuenta por <strong>compra</strong>, no por renglón: un ticket de $900
                    repartido en tres categorías es una compra de $900, no tres de $300. El umbral
                    lo eliges tú — no hay una cifra que sirva para todos.
                  </p>
                </>
              )}
            </section>
          </div>

          {/*
            Qué se disparó. Dos umbrales, los dos escritos: sin el relativo la
            lista sería siempre las categorías grandes; sin el absoluto, un café
            de más duplicaría una categoría de $80 y saldría gritando.
          */}
          <section className="hoja">
            <h2 className="hoja-titulo">Qué se disparó en {monthLabel(data.hasta)}</h2>
            {data.disparadas.length === 0 ? (
              <p className="grafica-vacia">
                Ninguna categoría se salió de su propio promedio en {monthLabel(data.hasta)}. Para
                entrar aquí hace falta pasarse más del 40 % <em>y</em> por más de $500, con al
                menos tres meses anteriores de referencia.
              </p>
            ) : (
              <>
                <table className="libro comparativa-tabla">
                  <thead>
                    <tr>
                      <th scope="col">Categoría</th>
                      <th scope="col" className="col-monto">Su promedio</th>
                      <th scope="col" className="col-monto">{monthLabel(data.hasta)}</th>
                      <th scope="col" className="col-monto">Diferencia</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.disparadas.map((d) => (
                      <tr key={d.name} className="libro-fila">
                        <td>
                          {d.name}
                          <span className="disparada-salto">+{Math.round(d.salto * 100)} %</span>
                        </td>
                        <td className="col-monto">{fmtMoney(d.promedioCents)}</td>
                        <td className="col-monto">{fmtMoney(d.expenseCents)}</td>
                        <td className="col-monto"><Money cents={d.deltaCents} signed /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="reportes-supuesto">
                  Cada categoría se compara contra <strong>su propio</strong> promedio de los meses
                  anteriores en que hubo gasto, no contra las demás. Entra si se pasó más del 40 %{' '}
                  <em>y</em> por más de $500: con solo el primero, la lista serían siempre las
                  categorías grandes; con solo el segundo, un café de más duplicaría una categoría
                  de $80 y saldría gritando. Quedarse justo en el umbral no es pasarse. Se piden al
                  menos tres meses de referencia: comparar contra un solo mes no es comparar contra
                  un promedio.
                </p>
              </>
            )}
          </section>

          <section className="hoja">
            <h2 className="hoja-titulo">De dónde vino el dinero</h2>
            {data.fuentes.length === 0 ? (
              <p className="grafica-vacia">Sin ingresos en el periodo.</p>
            ) : (
              <>
                <CategoryBars
                  byCategory={data.fuentes
                    .slice(0, 8)
                    .map((f) => ({ name: f.name, expenseCents: f.incomeCents }))}
                />
                <p className="reportes-nota">
                  {data.fuentes[0]!.name} trae{' '}
                  <strong className="cifra-chica">{Math.round(data.fuentes[0]!.parte * 100)} %</strong>{' '}
                  de todo lo que entró
                  {data.fuentes.length === 1
                    ? ': es tu única fuente, y eso es exactamente lo que esta gráfica viene a decir.'
                    : `, repartido entre ${data.fuentes.length} fuentes.`}
                </p>
              </>
            )}
          </section>

          <section className="hoja">
            <h2 className="hoja-titulo">Cómo leer esto</h2>
            <p className="ajustes-texto">
              Son cuatro cuentas hechas con tus propios movimientos, con los supuestos a la vista.
              La tasa de ahorro es la misma que la de Reportes —sale del mismo cálculo— y sigue la
              regla de siempre: recibir un préstamo, aportar a una inversión o abonar capital a una
              deuda no cuentan como ingreso ni gasto, porque mueven tu patrimonio de lugar en vez
              de crearlo o consumirlo. Finply mide; no recomienda un instrumento ni promete un
              rendimiento.
            </p>
          </section>
        </>
      )}
    </div>
  )
}
