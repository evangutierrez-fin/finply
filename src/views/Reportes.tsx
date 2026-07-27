import { useState } from 'react'
import { api } from '../api.ts'
import { useApp } from '../context.ts'
import { useFetch } from '../hooks.ts'
import { currentMonth, fmtMoney, monthLabel, shiftMonth, todayISO } from '../format.ts'
import { Money } from '../components/Money.tsx'
import { CategoryBars, PatrimonioLinea, YearBars } from '../components/Charts.tsx'
import type { Comparativa } from '../../shared/types.ts'

/** 0.3421 → '34 %'. Sin ingresos no hay tasa, y eso se dice, no se inventa. */
function fmtTasa(tasa: number | null): string {
  return tasa === null ? '—' : `${Math.round(tasa * 100)} %`
}

function ComparativaMes({ datos }: { datos: Comparativa }) {
  const suben = datos.categorias.filter((c) => c.deltaCents !== 0).slice(0, 8)
  if (suben.length === 0) {
    return <p className="grafica-vacia">Los dos meses gastaron igual, o no hubo gastos.</p>
  }
  return (
    <table className="libro comparativa-tabla">
      <thead>
        <tr>
          <th scope="col">Categoría</th>
          <th scope="col" className="col-monto">{monthLabel(datos.anterior)}</th>
          <th scope="col" className="col-monto">{monthLabel(datos.month)}</th>
          <th scope="col" className="col-monto">Diferencia</th>
        </tr>
      </thead>
      <tbody>
        {suben.map((c) => (
          <tr key={c.name} className="libro-fila">
            <td>{c.name}</td>
            <td className="col-monto">{fmtMoney(c.previoCents)}</td>
            <td className="col-monto">{fmtMoney(c.actualCents)}</td>
            <td className="col-monto">
              <Money cents={c.deltaCents} signed />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function Reportes() {
  const { profile, refreshKey } = useApp()
  const [year, setYear] = useState(() => Number(todayISO().slice(0, 4)))
  const [mes, setMes] = useState(currentMonth())

  const { data, error } = useFetch(
    () => api.reportes.anual(profile.id, year),
    [profile.id, year, refreshKey],
  )
  const { data: comp } = useFetch(
    () => api.reportes.comparativa(profile.id, mes),
    [profile.id, mes, refreshKey],
  )

  const cierre = data?.patrimonio.at(-1)
  const mejor = data?.meses.reduce(
    (mejor, m) => (mejor === null || m.netCents > mejor.netCents ? m : mejor),
    null as (typeof data.meses)[number] | null,
  )

  return (
    <div className="vista vista-reportes">
      <header className="vista-head">
        <h1>Reportes</h1>
        <div className="reportes-controles">
          <div className="mes-nav">
            <button type="button" className="mes-flecha" onClick={() => setYear((y) => y - 1)} aria-label="Año anterior">‹</button>
            <span className="vista-mes">{year}</span>
            <button type="button" className="mes-flecha" onClick={() => setYear((y) => y + 1)} aria-label="Año siguiente">›</button>
          </div>
          <button type="button" className="btn btn-fantasma btn-chico no-imprimir" onClick={() => window.print()}>
            Imprimir
          </button>
        </div>
      </header>

      {error && <p className="aviso" role="alert">{error}</p>}
      {!data && !error && <p className="cargando">Sumando el año…</p>}

      {data && (
        <>
          <section className="hoja reportes-hero">
            <div className="reportes-hero-dato">
              <span className="rotulo">Patrimonio al cierre</span>
              <Money cents={cierre?.totalCents ?? 0} className="hero-cifra-media" />
            </div>
            <dl className="reportes-stats">
              <div>
                <dt>Entró en el año</dt>
                <dd><Money cents={data.totales.incomeCents} className="stat-in" /></dd>
              </div>
              <div>
                <dt>Salió</dt>
                <dd><Money cents={data.totales.expenseCents} /></dd>
              </div>
              <div>
                <dt>Quedó</dt>
                <dd><Money cents={data.totales.netCents} signed /></dd>
              </div>
              <div>
                <dt>Tasa de ahorro</dt>
                <dd className="cifra">{fmtTasa(data.totales.tasaAhorro)}</dd>
              </div>
            </dl>
            <p className="reportes-supuesto">
              De cada peso que entró, cuánto no salió. Recibir un préstamo, aportar a una
              inversión o abonar capital a una deuda no cuentan como ingreso ni gasto: mueven
              tu patrimonio de lugar, no lo crean ni lo consumen.
            </p>
          </section>

          <div className="dos-columnas">
            <section className="hoja">
              <h2 className="hoja-titulo">Patrimonio en el año</h2>
              <PatrimonioLinea patrimonio={data.patrimonio} />
            </section>
            <section className="hoja">
              <h2 className="hoja-titulo">Ingresos contra gastos</h2>
              <YearBars meses={data.meses} />
              {mejor && mejor.netCents > 0 && (
                <p className="reportes-nota">
                  Tu mejor mes fue {monthLabel(mejor.month)}: quedaron{' '}
                  <strong className="cifra-chica">{fmtMoney(mejor.netCents)}</strong>.
                </p>
              )}
            </section>
          </div>

          <div className="dos-columnas">
            <section className="hoja">
              <h2 className="hoja-titulo">En qué se fue el año</h2>
              <CategoryBars byCategory={data.porCategoria.slice(0, 10)} />
            </section>
            <section className="hoja">
              <h2 className="hoja-titulo">Por etiqueta</h2>
              {data.porEtiqueta.length === 0 ? (
                <p className="grafica-vacia">
                  Sin etiquetas este año. Sirven para cruzar categorías: un viaje lleva comida,
                  transporte y hospedaje.
                </p>
              ) : (
                <CategoryBars byCategory={data.porEtiqueta} />
              )}
            </section>
          </div>

          <section className="hoja">
            <header className="hoja-head">
              <h2 className="hoja-titulo">Mes contra mes</h2>
              <div className="mes-nav no-imprimir">
                <button type="button" className="mes-flecha" onClick={() => setMes(shiftMonth(mes, -1))} aria-label="Mes anterior">‹</button>
                <span className="vista-mes">{monthLabel(mes)}</span>
                <button type="button" className="mes-flecha" onClick={() => setMes(shiftMonth(mes, 1))} aria-label="Mes siguiente">›</button>
              </div>
            </header>
            {comp && (
              <>
                <p className="reportes-nota">
                  {monthLabel(comp.month)} contra {monthLabel(comp.anterior)}: gastaste{' '}
                  <strong className="cifra-chica">
                    {fmtMoney(Math.abs(comp.actual.expenseCents - comp.previo.expenseCents))}
                  </strong>{' '}
                  {comp.actual.expenseCents >= comp.previo.expenseCents ? 'más' : 'menos'}.
                </p>
                <ComparativaMes datos={comp} />
              </>
            )}
          </section>
        </>
      )}
    </div>
  )
}
