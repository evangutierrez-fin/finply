import { useState } from 'react'
import type { MesReporte, PuntoPatrimonio, Summary } from '../../shared/types.ts'
import { fmtDate, fmtMoney, MESES } from '../format.ts'

function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number)
  return new Date(y!, m!, 0).getDate()
}

/**
 * Barras diarias del mes: entradas (verde sólido) y salidas (rojo con rayado).
 * El rayado es codificación secundaria para visión con daltonismo, además de
 * la leyenda y la posición fija (entrada siempre a la izquierda del par).
 */
export function MonthBars({ byDay, month }: { byDay: Summary['byDay']; month: string }) {
  const [hover, setHover] = useState<string | null>(null)
  const days = daysInMonth(month)
  const map = new Map(byDay.map((d) => [d.date, d]))
  const max = Math.max(...byDay.map((d) => Math.max(d.incomeCents, d.expenseCents)), 1)

  const step = 16
  const barW = 5
  const chartH = 120
  const width = days * step
  const height = chartH + 22

  if (byDay.length === 0) {
    return <p className="grafica-vacia">Sin movimientos este mes. La gráfica espera tu primer registro.</p>
  }

  const hovered = hover ? map.get(hover) : null

  return (
    <div className="grafica">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="grafica-svg"
        role="img"
        aria-label="Entradas y salidas por día del mes"
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <pattern id="rayado" patternUnits="userSpaceOnUse" width="4" height="4" patternTransform="rotate(45)">
            <rect width="4" height="4" fill="var(--viz-salida)" />
            <line x1="0" y1="0" x2="0" y2="4" stroke="var(--hoja)" strokeWidth="1.6" />
          </pattern>
        </defs>
        {/* línea guía del máximo */}
        <line x1="0" y1={chartH - chartH * 0.9} x2={width} y2={chartH - chartH * 0.9} className="grafica-guia" />
        <line x1="0" y1={chartH} x2={width} y2={chartH} className="grafica-base" />
        {Array.from({ length: days }, (_, i) => {
          const dayNum = i + 1
          const date = `${month}-${String(dayNum).padStart(2, '0')}`
          const d = map.get(date)
          const hIn = d ? Math.max(2, (d.incomeCents / max) * chartH * 0.9) : 0
          const hOut = d ? Math.max(2, (d.expenseCents / max) * chartH * 0.9) : 0
          const x = i * step + (step - barW * 2 - 2) / 2
          return (
            <g key={date} onMouseEnter={() => setHover(date)}>
              {/* blanco de interacción a lo alto de la columna */}
              <rect x={i * step} y="0" width={step} height={chartH} fill="transparent" />
              {d && d.incomeCents > 0 && (
                <rect
                  className="barra"
                  style={{ animationDelay: `${Math.min(i * 14, 420)}ms` }}
                  x={x}
                  y={chartH - hIn}
                  width={barW}
                  height={hIn}
                  rx="1.5"
                  fill="var(--viz-entrada)"
                />
              )}
              {d && d.expenseCents > 0 && (
                <rect
                  className="barra"
                  style={{ animationDelay: `${Math.min(i * 14 + 40, 460)}ms` }}
                  x={x + barW + 2}
                  y={chartH - hOut}
                  width={barW}
                  height={hOut}
                  rx="1.5"
                  fill="url(#rayado)"
                />
              )}
              {hover === date && <rect x={i * step} y="0" width={step} height={chartH} className="grafica-halo" />}
              {(dayNum === 1 || dayNum % 7 === 0) && (
                <text x={i * step + step / 2} y={chartH + 15} className="grafica-tick" textAnchor="middle">
                  {dayNum}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      <div className="grafica-pie">
        {hovered ? (
          <span className="grafica-dato">
            <strong>{fmtDate(hovered.date)}</strong>
            {' · entró '}
            <span className="cifra-chica">{fmtMoney(hovered.incomeCents)}</span>
            {' · salió '}
            <span className="cifra-chica">{fmtMoney(hovered.expenseCents)}</span>
          </span>
        ) : (
          <span className="grafica-leyenda">
            <span className="muestra muestra-entrada" aria-hidden="true" /> Entradas
            <span className="muestra muestra-salida" aria-hidden="true" /> Salidas
          </span>
        )}
      </div>
    </div>
  )
}

const INICIAL = MESES.map((m) => m.charAt(0).toUpperCase())

/**
 * Doce meses de entradas contra salidas. Mismo lenguaje que las barras del
 * mes: verde sólido para lo que entra, rojo rayado para lo que sale, y la
 * entrada siempre a la izquierda del par (R10).
 */
export function YearBars({ meses }: { meses: MesReporte[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(...meses.map((m) => Math.max(m.incomeCents, m.expenseCents)), 1)

  const step = 54
  const barW = 18
  const chartH = 150
  const width = meses.length * step
  const height = chartH + 24
  const hovered = hover === null ? null : meses[hover]

  if (meses.every((m) => m.incomeCents === 0 && m.expenseCents === 0)) {
    return <p className="grafica-vacia">Este año no tiene movimientos todavía.</p>
  }

  return (
    <div className="grafica">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="grafica-svg"
        role="img"
        aria-label="Entradas y salidas mes a mes del año"
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <pattern id="rayado-anio" patternUnits="userSpaceOnUse" width="4" height="4" patternTransform="rotate(45)">
            <rect width="4" height="4" fill="var(--viz-salida)" />
            <line x1="0" y1="0" x2="0" y2="4" stroke="var(--hoja)" strokeWidth="1.6" />
          </pattern>
        </defs>
        <line x1="0" y1={chartH * 0.1} x2={width} y2={chartH * 0.1} className="grafica-guia" />
        <line x1="0" y1={chartH} x2={width} y2={chartH} className="grafica-base" />
        {meses.map((m, i) => {
          const hIn = m.incomeCents > 0 ? Math.max(2, (m.incomeCents / max) * chartH * 0.9) : 0
          const hOut = m.expenseCents > 0 ? Math.max(2, (m.expenseCents / max) * chartH * 0.9) : 0
          const x = i * step + (step - barW * 2 - 3) / 2
          return (
            <g key={m.month} onMouseEnter={() => setHover(i)}>
              <rect x={i * step} y="0" width={step} height={chartH} fill="transparent" />
              {hIn > 0 && (
                <rect
                  className="barra"
                  style={{ animationDelay: `${i * 30}ms` }}
                  x={x} y={chartH - hIn} width={barW} height={hIn} rx="1.5"
                  fill="var(--viz-entrada)"
                />
              )}
              {hOut > 0 && (
                <rect
                  className="barra"
                  style={{ animationDelay: `${i * 30 + 60}ms` }}
                  x={x + barW + 3} y={chartH - hOut} width={barW} height={hOut} rx="1.5"
                  fill="url(#rayado-anio)"
                />
              )}
              {hover === i && <rect x={i * step} y="0" width={step} height={chartH} className="grafica-halo" />}
              <text x={i * step + step / 2} y={chartH + 16} className="grafica-tick" textAnchor="middle">
                {INICIAL[i]}
              </text>
            </g>
          )
        })}
      </svg>
      <div className="grafica-pie">
        {hovered ? (
          <span className="grafica-dato">
            <strong>{MESES[Number(hovered.month.slice(5)) - 1]}</strong>
            {' · entró '}
            <span className="cifra-chica">{fmtMoney(hovered.incomeCents)}</span>
            {' · salió '}
            <span className="cifra-chica">{fmtMoney(hovered.expenseCents)}</span>
            {' · quedó '}
            <span className="cifra-chica">{fmtMoney(hovered.netCents)}</span>
          </span>
        ) : (
          <span className="grafica-leyenda">
            <span className="muestra muestra-entrada" aria-hidden="true" /> Entradas
            <span className="muestra muestra-salida" aria-hidden="true" /> Salidas
          </span>
        )}
      </div>
    </div>
  )
}

/**
 * El patrimonio a lo largo del año. Una sola serie, así que el color no
 * codifica nada: la forma es el dato. Si la serie cruza el cero se dibuja esa
 * línea, porque deber más de lo que tienes se ve distinto a tener poco.
 */
export function PatrimonioLinea({ patrimonio }: { patrimonio: PuntoPatrimonio[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const valores = patrimonio.map((p) => p.totalCents)
  const max = Math.max(...valores, 0)
  const min = Math.min(...valores, 0)
  const rango = max - min || 1

  const chartH = 130
  const step = 54
  // Medio paso de aire a cada lado: sin él, el primer y el último punto se
  // parten contra el borde del recuadro.
  const margen = step / 2
  const width = (patrimonio.length - 1) * step + margen * 2
  const height = chartH + 24
  const y = (cents: number) => chartH - ((cents - min) / rango) * chartH * 0.9 - chartH * 0.05
  const puntos = patrimonio.map((p, i) => ({ x: margen + i * step, y: y(p.totalCents), p }))
  const linea = puntos.map((q) => `${q.x},${q.y}`).join(' ')
  // El relleno baja hasta el cero, no hasta el fondo del recuadro: así se ve
  // de un vistazo cuánto del año se pasó en números rojos.
  const base = y(0)
  const area = `${puntos[0]!.x},${base} ${linea} ${puntos.at(-1)!.x},${base}`
  const hovered = hover === null ? null : patrimonio[hover]

  return (
    <div className="grafica">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="grafica-svg"
        role="img"
        aria-label="Patrimonio al cierre de cada mes"
        onMouseLeave={() => setHover(null)}
      >
        <polygon points={area} className="serie-area" />
        <polyline points={linea} className="serie-linea" />
        {min < 0 && <line x1="0" y1={base} x2={width} y2={base} className="grafica-base" />}
        {puntos.map((q, i) => (
          <g key={q.p.month} onMouseEnter={() => setHover(i)}>
            <rect x={q.x - step / 2} y="0" width={step} height={chartH} fill="transparent" />
            <circle cx={q.x} cy={q.y} r={hover === i ? 4 : 2.5} className="serie-punto" />
            <text x={q.x} y={chartH + 16} className="grafica-tick" textAnchor="middle">
              {INICIAL[i]}
            </text>
          </g>
        ))}
      </svg>
      <div className="grafica-pie">
        {hovered ? (
          <span className="grafica-dato">
            <strong>{MESES[Number(hovered.month.slice(5)) - 1]}</strong>
            {' · '}
            <span className="cifra-chica">{fmtMoney(hovered.totalCents)}</span>
            {' · en cuentas '}
            <span className="cifra-chica">{fmtMoney(hovered.cuentasCents)}</span>
            {hovered.inversionesCents > 0 && (
              <> · invertido <span className="cifra-chica">{fmtMoney(hovered.inversionesCents)}</span></>
            )}
            {hovered.porPagarCents > 0 && (
              <> · debes <span className="cifra-chica">{fmtMoney(hovered.porPagarCents)}</span></>
            )}
          </span>
        ) : (
          <span className="grafica-leyenda">Cuentas + inversiones + lo que te deben − lo que debes</span>
        )}
      </div>
    </div>
  )
}

/** Barras horizontales: en qué se fue el gasto del mes (una sola serie, tono de acento). */
export function CategoryBars({ byCategory }: { byCategory: Summary['byCategory'] }) {
  if (byCategory.length === 0) {
    return <p className="grafica-vacia">Sin gastos este mes.</p>
  }
  const max = byCategory[0]!.expenseCents || 1
  return (
    <ul className="cat-bars">
      {byCategory.map((c, i) => (
        <li key={c.name} className="cat-row">
          <span className="cat-nombre">{c.name}</span>
          <span className="cat-riel">
            <span
              className="cat-lleno"
              style={{
                width: `${Math.max(2, (c.expenseCents / max) * 100)}%`,
                animationDelay: `${i * 60}ms`,
              }}
            />
          </span>
          <span className="cifra cifra-chica">{fmtMoney(c.expenseCents)}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * El valor de una inversión a lo largo de su historial. Los puntos van
 * igualmente espaciados aunque las fechas no lo estén: son registros, no una
 * serie de tiempo continua, y estirar el eje por una valuación de hace tres
 * años dejaría el resto amontonado contra el borde. La fecha va en el pie.
 */
export function HistorialValor({
  puntos,
}: {
  puntos: { date: string; valueCents: number }[]
}) {
  const [hover, setHover] = useState<number | null>(null)
  if (puntos.length < 2) return null

  const valores = puntos.map((p) => p.valueCents)
  const max = Math.max(...valores)
  const min = Math.min(...valores, 0)
  const rango = max - min || 1

  const chartH = 110
  const width = 640
  const margen = 14
  const paso = (width - margen * 2) / (puntos.length - 1)
  const y = (cents: number) => chartH - ((cents - min) / rango) * chartH * 0.88 - chartH * 0.06
  const coords = puntos.map((p, i) => ({ x: margen + i * paso, y: y(p.valueCents), p }))
  const linea = coords.map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' ')
  const base = y(min < 0 ? 0 : min)
  const area = `${coords[0]!.x},${base} ${linea} ${coords.at(-1)!.x},${base}`
  const hovered = hover === null ? null : puntos[hover]

  return (
    <div className="grafica">
      <svg
        viewBox={`0 0 ${width} ${chartH}`}
        className="grafica-svg"
        role="img"
        aria-label="Valor de la inversión después de cada registro"
        onMouseLeave={() => setHover(null)}
        preserveAspectRatio="none"
      >
        <polygon points={area} className="serie-area" />
        <polyline points={linea} className="serie-linea" />
        {coords.map((q, i) => (
          <g key={`${q.p.date}-${i}`} onMouseEnter={() => setHover(i)}>
            <rect x={q.x - paso / 2} y="0" width={paso} height={chartH} fill="transparent" />
            <circle cx={q.x} cy={q.y} r={hover === i ? 4 : 2.5} className="serie-punto" />
          </g>
        ))}
      </svg>
      <div className="grafica-pie">
        {hovered ? (
          <span className="grafica-dato">
            <strong>{fmtDate(hovered.date)}</strong>
            {' · '}
            <span className="cifra-chica">{fmtMoney(hovered.valueCents)}</span>
          </span>
        ) : (
          <span className="grafica-leyenda">
            {fmtDate(puntos[0]!.date)} — {fmtDate(puntos.at(-1)!.date)} · {puntos.length} registros
          </span>
        )}
      </div>
    </div>
  )
}

/**
 * Dos proyecciones sobre el mismo eje. Se distinguen por **forma** además de
 * por color —una continua, la otra punteada— porque el color solo no es una
 * codificación accesible (R10), y la leyenda dice cuál es cuál con palabras.
 */
export function ProyeccionLineas({
  series,
}: {
  series: { nombre: string; puntos: { mes: number; patrimonioCents: number }[]; punteada?: boolean }[]
}) {
  const [hover, setHover] = useState<number | null>(null)
  const todos = series.flatMap((s) => s.puntos.map((p) => p.patrimonioCents))
  if (todos.length === 0) return null
  const max = Math.max(...todos)
  const min = Math.min(...todos, 0)
  const rango = max - min || 1
  const meses = Math.max(...series.map((s) => s.puntos.length)) - 1

  const chartH = 150
  const width = 640
  const margen = 14
  const paso = (width - margen * 2) / (meses || 1)
  const y = (cents: number) => chartH - ((cents - min) / rango) * chartH * 0.88 - chartH * 0.06
  const base = y(0)

  return (
    <div className="grafica">
      <svg
        viewBox={`0 0 ${width} ${chartH}`}
        className="grafica-svg"
        role="img"
        aria-label="Patrimonio proyectado con cada estrategia"
        onMouseLeave={() => setHover(null)}
        preserveAspectRatio="none"
      >
        {min < 0 && <line x1="0" y1={base} x2={width} y2={base} className="grafica-base" />}
        {series.map((s) => (
          <polyline
            key={s.nombre}
            points={s.puntos
              .map((p) => `${(margen + p.mes * paso).toFixed(1)},${y(p.patrimonioCents).toFixed(1)}`)
              .join(' ')}
            className={`serie-linea ${s.punteada ? 'serie-punteada' : ''}`}
          />
        ))}
        {Array.from({ length: meses + 1 }, (_, i) => (
          <rect
            key={i}
            x={margen + i * paso - paso / 2}
            y="0"
            width={paso}
            height={chartH}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}
        {hover !== null &&
          series.map((s) => {
            const p = s.puntos[hover]
            return p ? (
              <circle
                key={s.nombre}
                cx={margen + p.mes * paso}
                cy={y(p.patrimonioCents)}
                r="4"
                className="serie-punto"
              />
            ) : null
          })}
      </svg>
      <div className="grafica-pie">
        {hover !== null ? (
          <span className="grafica-dato">
            <strong>Mes {hover}</strong>
            {series.map((s) => (
              <span key={s.nombre}>
                {' · '}
                {s.nombre}: <span className="cifra-chica">{fmtMoney(s.puntos[hover]?.patrimonioCents ?? 0)}</span>
              </span>
            ))}
          </span>
        ) : (
          <span className="grafica-leyenda">
            {series.map((s, i) => (
              <span key={s.nombre}>
                {i > 0 && ' · '}
                <span className={`muestra-linea ${s.punteada ? 'muestra-punteada' : ''}`} aria-hidden="true" />
                {s.nombre}
              </span>
            ))}
          </span>
        )}
      </div>
    </div>
  )
}
