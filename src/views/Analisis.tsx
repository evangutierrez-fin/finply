import { useState } from 'react'
import { api } from '../api.ts'
import { useApp } from '../context.ts'
import { useFetch } from '../hooks.ts'
import { fmtMoney, monthLabel } from '../format.ts'
import { Money } from '../components/Money.tsx'
import { CategoryBars } from '../components/Charts.tsx'
import type { Analisis as Datos } from '../../shared/types.ts'

const VENTANAS = [
  { meses: 3, label: '3 meses' },
  { meses: 6, label: '6 meses' },
  { meses: 12, label: '12 meses' },
]

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

export function Analisis() {
  const { profile, refreshKey } = useApp()
  const [meses, setMeses] = useState(6)
  const { data, error } = useFetch(
    () => api.analisis(profile.id, meses),
    [profile.id, meses, refreshKey],
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
