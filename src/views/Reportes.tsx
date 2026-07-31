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

/** Meses de un rango, contando los dos extremos. */
function largoDe(p: { desde: string; hasta: string }): number {
  const [ya, ma] = p.desde.split('-').map(Number)
  const [yb, mb] = p.hasta.split('-').map(Number)
  return yb! * 12 + mb! - (ya! * 12 + ma!) + 1
}

/** 'AAAA-MM' a 'AAAA-MM' → un rótulo corto. Un solo mes no se escribe dos veces. */
function rotuloPeriodo(p: { desde: string; hasta: string }): string {
  return p.desde === p.hasta ? monthLabel(p.desde) : `${monthLabel(p.desde)} – ${monthLabel(p.hasta)}`
}

function ComparativaTabla({ datos }: { datos: Comparativa }) {
  const suben = datos.categorias.filter((c) => c.deltaCents !== 0).slice(0, 10)
  if (suben.length === 0) {
    return <p className="grafica-vacia">Los dos periodos gastaron igual, o no hubo gastos.</p>
  }
  return (
    <table className="libro comparativa-tabla">
      <thead>
        <tr>
          <th scope="col">Categoría</th>
          <th scope="col" className="col-monto">{rotuloPeriodo(datos.previo)}</th>
          <th scope="col" className="col-monto">{rotuloPeriodo(datos.actual)}</th>
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

type Molde = 'mes' | 'trimestre' | 'anio' | 'medida'

const MOLDES: { id: Molde; label: string; largo: number }[] = [
  { id: 'mes', label: 'Mes contra mes', largo: 1 },
  { id: 'trimestre', label: 'Trimestre contra trimestre', largo: 3 },
  { id: 'anio', label: 'Año contra año', largo: 12 },
  { id: 'medida', label: 'A la medida', largo: 0 },
]

export function Reportes() {
  const { profile, refreshKey } = useApp()
  const [year, setYear] = useState(() => Number(todayISO().slice(0, 4)))
  const [mes, setMes] = useState(currentMonth())
  const [molde, setMolde] = useState<Molde>('mes')
  // Solo se usan en "a la medida"; nacen del molde vigente para que abrirlo no
  // borre lo que ya estabas viendo.
  const [aMedida, setAMedida] = useState(() => ({
    desde: currentMonth(),
    hasta: currentMonth(),
    contraDesde: shiftMonth(currentMonth(), -1),
    contraHasta: shiftMonth(currentMonth(), -1),
  }))

  const largo = MOLDES.find((m) => m.id === molde)!.largo
  const periodo =
    molde === 'medida'
      ? { desde: aMedida.desde, hasta: aMedida.hasta }
      : { desde: shiftMonth(mes, -(largo - 1)), hasta: mes }
  const contra =
    molde === 'medida' ? { desde: aMedida.contraDesde, hasta: aMedida.contraHasta } : undefined

  const { data, error } = useFetch(
    () => api.reportes.anual(profile.id, year),
    [profile.id, year, refreshKey],
  )
  const { data: comp } = useFetch(
    () => api.reportes.comparativa(profile.id, periodo, contra),
    [profile.id, periodo.desde, periodo.hasta, contra?.desde, contra?.hasta, refreshKey],
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
            {/*
              La mediana junto al promedio, nunca en su lugar. Si cambiaste el
              refri en marzo, el promedio sube y la mediana no: la distancia
              entre las dos es exactamente el dato que un promedio solo esconde.
            */}
            {data.totales.medianaGastoCents !== null && data.totales.mesesConMovimiento > 1 && (
              <p className="reportes-supuesto">
                Tu mes <strong>de en medio</strong> gastó{' '}
                <strong className="cifra-chica">{fmtMoney(data.totales.medianaGastoCents)}</strong>{' '}
                y entró{' '}
                <strong className="cifra-chica">
                  {fmtMoney(data.totales.medianaIngresoCents ?? 0)}
                </strong>
                , contra un promedio de{' '}
                <strong className="cifra-chica">
                  {fmtMoney(Math.round(data.totales.expenseCents / data.totales.mesesConMovimiento))}
                </strong>{' '}
                de gasto, sobre los {data.totales.mesesConMovimiento} meses con movimiento. Cuando
                las dos se separan, la culpa es de un mes raro: la mediana no se mueve por una
                sola compra grande.
              </p>
            )}
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
            {/*
              El espejo que faltaba. El libro sabía desmenuzar en qué se va el
              dinero pero no de dónde viene, y las dos preguntas pesan igual:
              quien vive de un sueldo y quien vive de seis clientes corren
              riesgos distintos, y hasta hoy Finply no podía notarlo.
            */}
            <section className="hoja">
              <h2 className="hoja-titulo">De dónde vino</h2>
              {data.porFuente.length === 0 ? (
                <p className="grafica-vacia">Sin ingresos registrados este año.</p>
              ) : (
                <>
                  <CategoryBars
                    byCategory={data.porFuente
                      .slice(0, 10)
                      .map((f) => ({ name: f.name, expenseCents: f.incomeCents }))}
                  />
                  {data.porFuente.length > 0 && data.totales.incomeCents > 0 && (
                    <p className="reportes-nota">
                      {data.porFuente[0]!.name} trae{' '}
                      <strong className="cifra-chica">
                        {Math.round((data.porFuente[0]!.incomeCents / data.totales.incomeCents) * 100)} %
                      </strong>{' '}
                      de todo lo que entró
                      {data.porFuente.length === 1
                        ? ': es tu única fuente.'
                        : `, y tienes ${data.porFuente.length} fuentes en total.`}
                    </p>
                  )}
                </>
              )}
            </section>
          </div>

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

          <section className="hoja">
            <header className="hoja-head">
              <h2 className="hoja-titulo">Dos periodos</h2>
              <div className="reportes-comparar no-imprimir">
                <select
                  className="filtro"
                  value={molde}
                  onChange={(e) => setMolde(e.target.value as Molde)}
                  aria-label="Qué se compara"
                >
                  {MOLDES.map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
                {molde !== 'medida' && (
                  <div className="mes-nav">
                    <button type="button" className="mes-flecha" onClick={() => setMes(shiftMonth(mes, -1))} aria-label="Periodo anterior">‹</button>
                    <span className="vista-mes">{rotuloPeriodo(periodo)}</span>
                    <button type="button" className="mes-flecha" onClick={() => setMes(shiftMonth(mes, 1))} aria-label="Periodo siguiente">›</button>
                  </div>
                )}
              </div>
            </header>

            {molde === 'medida' && (
              <div className="reportes-medida no-imprimir">
                <label>
                  <span className="rotulo">Este periodo</span>
                  <span className="reportes-medida-par">
                    <input type="month" className="filtro" value={aMedida.desde} aria-label="Mes inicial del periodo" onChange={(e) => setAMedida({ ...aMedida, desde: e.target.value })} />
                    <input type="month" className="filtro" value={aMedida.hasta} aria-label="Mes final del periodo" onChange={(e) => setAMedida({ ...aMedida, hasta: e.target.value })} />
                  </span>
                </label>
                <label>
                  <span className="rotulo">Contra</span>
                  <span className="reportes-medida-par">
                    <input type="month" className="filtro" value={aMedida.contraDesde} aria-label="Mes inicial del periodo comparado" onChange={(e) => setAMedida({ ...aMedida, contraDesde: e.target.value })} />
                    <input type="month" className="filtro" value={aMedida.contraHasta} aria-label="Mes final del periodo comparado" onChange={(e) => setAMedida({ ...aMedida, contraHasta: e.target.value })} />
                  </span>
                </label>
              </div>
            )}

            {comp && (
              <>
                <p className="reportes-nota">
                  {rotuloPeriodo(comp.actual)} contra {rotuloPeriodo(comp.previo)}: gastaste{' '}
                  <strong className="cifra-chica">
                    {fmtMoney(Math.abs(comp.actual.expenseCents - comp.previo.expenseCents))}
                  </strong>{' '}
                  {comp.actual.expenseCents >= comp.previo.expenseCents ? 'más' : 'menos'} y entró{' '}
                  <strong className="cifra-chica">
                    {fmtMoney(Math.abs(comp.actual.incomeCents - comp.previo.incomeCents))}
                  </strong>{' '}
                  {comp.actual.incomeCents >= comp.previo.incomeCents ? 'más' : 'menos'}.
                  {/*
                    El aviso solo cuando de verdad aplica. Comparar tres meses
                    contra uno es legítimo si es lo que quieres, pero decirlo
                    cuando los dos periodos miden igual sería ruido.
                  */}
                  {largoDe(comp.actual) !== largoDe(comp.previo) && (
                    <>
                      {' '}
                      Ojo: son {largoDe(comp.actual)} meses contra {largoDe(comp.previo)}, así que
                      la diferencia incluye el tiempo, no solo el gasto.
                    </>
                  )}
                </p>
                <ComparativaTabla datos={comp} />
              </>
            )}
          </section>
        </>
      )}
    </div>
  )
}
