import { useState } from 'react'
import { api } from '../api.ts'
import { useApp } from '../context.ts'
import { useFetch } from '../hooks.ts'
import { fmtDate, fmtMoney, currentMonth, shiftMonth, monthLabel } from '../format.ts'
import { Money } from '../components/Money.tsx'
import type { View } from '../components/Sidebar.tsx'
import type { EstadoResultados, RenglonResultados } from '../../shared/types.ts'

/** Primer y último día de un mes 'AAAA-MM'. */
function limites(month: string): { desde: string; hasta: string } {
  const [y, m] = month.split('-').map(Number)
  const ultimo = new Date(Date.UTC(y!, m!, 0)).getUTCDate()
  return { desde: `${month}-01`, hasta: `${month}-${String(ultimo).padStart(2, '0')}` }
}

function Renglones({ titulo, filas, total }: { titulo: string; filas: RenglonResultados[]; total: number }) {
  if (filas.length === 0) return null
  return (
    <>
      <tr className="resultados-grupo">
        <th colSpan={2}>{titulo}</th>
      </tr>
      {filas.map((f) => (
        <tr key={f.categoryId ?? f.name}>
          <td className="resultados-detalle">{f.name}</td>
          <td className="col-num"><Money cents={f.montoCents} className="cifra-chica" /></td>
        </tr>
      ))}
      <tr className="resultados-subtotal">
        <td>Total {titulo.toLowerCase()}</td>
        <td className="col-num"><Money cents={total} className="cifra-chica" /></td>
      </tr>
    </>
  )
}

function Resultados({ datos }: { datos: EstadoResultados }) {
  const pct = datos.margenBrutoPct
  return (
    <>
      <table className="tabla resultados">
        <tbody>
          <tr className="resultados-fuerte">
            <td>Ingresos cobrados</td>
            <td className="col-num"><Money cents={datos.ingresosCents} /></td>
          </tr>
          <Renglones titulo="Costo de ventas" filas={datos.detalle.costoVenta} total={datos.costoVentaCents} />
          <tr className="resultados-fuerte">
            <td>Margen bruto{pct !== null && <span className="cifra-chica"> · {Math.round(pct * 100)} %</span>}</td>
            <td className="col-num"><Money cents={datos.margenBrutoCents} /></td>
          </tr>
          <Renglones titulo="Gastos fijos" filas={datos.detalle.fijo} total={datos.gastoFijoCents} />
          <Renglones titulo="Gastos variables" filas={datos.detalle.variable} total={datos.gastoVariableCents} />
          <Renglones titulo="Sin clasificar" filas={datos.detalle.sinClasificar} total={datos.sinClasificarCents} />
          <tr className="resultados-fuerte resultados-utilidad">
            <td>Utilidad</td>
            <td className="col-num">
              <span className={datos.utilidadCents >= 0 ? 'stat-in' : ''}>
                <Money cents={datos.utilidadCents} signed />
              </span>
            </td>
          </tr>
        </tbody>
      </table>
      {datos.sinClasificarCents > 0 && (
        <p className="reportes-nota">
          Hay <strong className="cifra-chica">{fmtMoney(datos.sinClasificarCents)}</strong> en
          categorías que todavía no tienen papel. No se reparten a ojo: clasifícalas en Categorías
          como costo de ventas, gasto fijo o gasto variable y entrarán donde toca.
        </p>
      )}
    </>
  )
}

export function Negocio({ onNav }: { onNav: (view: View) => void }) {
  const { profile, refreshKey } = useApp()
  const [mes, setMes] = useState(currentMonth())
  const { desde, hasta } = limites(mes)

  const { data: r, error } = useFetch(
    () => api.negocio.resultados(profile.id, desde, hasta),
    [profile.id, desde, hasta, refreshKey],
  )

  return (
    <div className="vista">
      <header className="vista-head">
        <h1>Negocio</h1>
        <div className="vista-mes-nav">
          <button type="button" className="btn-liga" onClick={() => setMes(shiftMonth(mes, -1))}>‹</button>
          <span className="vista-mes">{monthLabel(mes)}</span>
          <button type="button" className="btn-liga" onClick={() => setMes(shiftMonth(mes, 1))}>›</button>
        </div>
      </header>

      {error && <p className="aviso" role="alert">{error}</p>}

      {r && (
        <>
          <section className="hoja">
            <h2 className="hoja-titulo">Estado de resultados</h2>
            <Resultados datos={r} />
            <p className="reportes-supuesto">
              Sobre lo <strong>cobrado y pagado</strong> en el mes, no sobre lo facturado: Finply
              lleva el libro por flujo de efectivo. Si vendiste en junio y cobraste en julio, ese
              ingreso es de julio. Un préstamo recibido y un aporte a una inversión no aparecen
              aquí, porque mueven tu patrimonio de lugar en vez de crearlo o consumirlo.
            </p>
          </section>

          <div className="dos-columnas">
            <section className="hoja">
              <h2 className="hoja-titulo">Punto de equilibrio</h2>
              {r.puntoEquilibrioCents === null ? (
                <p className="grafica-vacia">
                  {r.ingresosCents === 0
                    ? 'Sin ventas en el mes, no hay margen que medir.'
                    : 'Con este margen, vender más no acerca a cubrir lo fijo: no hay punto de equilibrio.'}
                </p>
              ) : (
                <>
                  <div className="hero-total">
                    <span className="rotulo">Hay que vender</span>
                    <Money cents={r.puntoEquilibrioCents} className="hero-cifra hero-cifra-media" />
                  </div>
                  <p className="reportes-nota">
                    De cada peso vendido te quedan{' '}
                    <strong className="cifra-chica">
                      {Math.round((r.margenContribucion ?? 0) * 100)} centavos
                    </strong>{' '}
                    después del costo de ventas y de lo que varía con la venta. Con{' '}
                    {fmtMoney(r.gastoFijoCents)} de gastos fijos, ese es el punto en que no pierdes
                    ni ganas. Este mes vendiste {fmtMoney(r.ingresosCents)}
                    {r.ingresosCents >= r.puntoEquilibrioCents ? ', ya por encima.' : '.'}
                  </p>
                </>
              )}
            </section>

            <section className="hoja">
              <h2 className="hoja-titulo">Impuestos del mes</h2>
              <dl className="hero-stats">
                <div className="stat">
                  <dt>Trasladado (lo cobraste)</dt>
                  <dd><Money cents={r.impuestoTrasladadoCents} /></dd>
                </div>
                <div className="stat">
                  <dt>Acreditable (lo pagaste)</dt>
                  <dd><Money cents={r.impuestoAcreditableCents} /></dd>
                </div>
                <div className="stat stat-neto">
                  <dt>Diferencia</dt>
                  <dd>
                    <Money cents={r.impuestoTrasladadoCents - r.impuestoAcreditableCents} signed />
                  </dd>
                </div>
                <div className="stat">
                  <dt>Gasto marcado deducible</dt>
                  <dd><Money cents={r.deducibleCents} /></dd>
                </div>
              </dl>
              <p className="reportes-nota">
                Son las cifras de tus propios movimientos, no una declaración. Finply no calcula
                impuestos ni conoce las reglas de tu país: suma lo que tú anotaste.
              </p>
            </section>
          </div>

          {r.porCentro.length > 1 && (
            <section className="hoja">
              <h2 className="hoja-titulo">Por {profile.dimensionLabel.toLowerCase()}</h2>
              <table className="tabla">
                <thead>
                  <tr>
                    <th>{profile.dimensionLabel}</th>
                    <th className="col-num">Entró</th>
                    <th className="col-num">Salió</th>
                    <th className="col-num">Neto</th>
                  </tr>
                </thead>
                <tbody>
                  {r.porCentro.map((c) => (
                    <tr key={c.id ?? 'sin'}>
                      <td>{c.name}</td>
                      <td className="col-num"><Money cents={c.ingresosCents} className="cifra-chica" /></td>
                      <td className="col-num"><Money cents={c.gastoCents} className="cifra-chica" /></td>
                      <td className="col-num">
                        <span className={c.ingresosCents - c.gastoCents >= 0 ? 'stat-in' : ''}>
                          <Money cents={c.ingresosCents - c.gastoCents} signed className="cifra-chica" />
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}

      {/*
        El flujo de caja proyectado vivía aquí y desde la Fase 16 tiene su
        propia sección, igual para un libro personal que para uno de negocio:
        "¿llego a fin de mes?" no es una pregunta de contabilidad. Queda la
        liga, no una segunda copia de la misma cifra.
      */}
      <section className="hoja negocio-liga">
        <div>
          <h2 className="hoja-titulo">Flujo de caja proyectado</h2>
          <p className="reportes-nota">
            La caja de hoy movida día a día por lo que ya vence: facturas con fecha de pago,
            recurrencias, tarjetas y deudas. Ahora vive en su propia sección.
          </p>
        </div>
        <button type="button" className="btn btn-fantasma" onClick={() => onNav('flujo')}>
          Ver el flujo →
        </button>
      </section>
    </div>
  )
}
