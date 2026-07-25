import { useState } from 'react'
import type { Summary } from '../../shared/types.ts'
import { fmtDate, fmtMoney } from '../format.ts'

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
