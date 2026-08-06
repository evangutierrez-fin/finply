import { useState, type Dispatch, type KeyboardEvent, type SetStateAction } from 'react'
import type { MesReporte, PuntoPatrimonio, Summary } from '../../shared/types.ts'
import { ticksBonitos, techoDeEscala } from '../../shared/escalas.ts'
import { fmtCompacto, fmtDate, fmtMoney, MESES } from '../format.ts'

function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number)
  return new Date(y!, m!, 0).getDate()
}

/**
 * Ancho reservado a los rótulos del eje, en unidades del viewBox.
 *
 * El eje no es decoración: sin él, la única forma de saber cuánto mide una
 * barra es pasarle el ratón encima — y el cierre de año **se imprime**, donde
 * no hay ratón que valga. Una gráfica que solo se entiende en pantalla y con
 * mouse no es una gráfica, es un adorno interactivo.
 */
const MARGEN_EJE = 46

/** Las marcas horizontales con su cifra. Se leen igual en papel. */
function EjeY({
  marcas,
  y,
  x0,
  x1,
  rotulo = fmtCompacto,
}: {
  marcas: number[]
  y: (cents: number) => number
  x0: number
  x1: number
  /** Cómo se escribe cada marca. Pesos por omisión; la serie en porcentaje trae la suya. */
  rotulo?: (v: number) => string
}) {
  return (
    <g aria-hidden="true">
      {marcas.map((v) => (
        <g key={v}>
          <line x1={x0} y1={y(v)} x2={x1} y2={y(v)} className={v === 0 ? 'grafica-base' : 'grafica-guia'} />
          <text x={x0 - 6} y={y(v) + 3.2} className="grafica-tick eje-rotulo" textAnchor="end">
            {rotulo(v)}
          </text>
        </g>
      ))}
    </g>
  )
}

/**
 * Los mismos datos en una tabla que solo ven los lectores de pantalla.
 *
 * Un `role="img"` con etiqueta dice *qué* es la gráfica, nunca *cuánto* vale
 * cada barra. La tabla es la que entrega las cifras, y va siempre en el DOM
 * —no detrás de un botón— para que no dependa de que alguien la abra.
 */
function TablaDatos({
  titulo,
  columnas,
  filas,
}: {
  titulo: string
  columnas: string[]
  filas: (string | number)[][]
}) {
  return (
    <table className="sr-only">
      <caption>{titulo}</caption>
      <thead>
        <tr>
          {columnas.map((c) => (
            <th key={c} scope="col">{c}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {filas.map((fila, i) => (
          <tr key={i}>
            {fila.map((celda, j) =>
              j === 0 ? (
                <th key={j} scope="row">{celda}</th>
              ) : (
                <td key={j}>{celda}</td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/**
 * Recorrer una serie con el teclado.
 *
 * El dato de estas gráficas vivía entero en `onMouseEnter`, así que con
 * teclado o en una pantalla táctil no había forma de leer un valor. Con esto
 * el SVG entra en el orden de tabulación y las flechas mueven el punto
 * destacado; el pie va en `aria-live`, así que cada paso se anuncia.
 */
function useNavegable(n: number, setActivo: Dispatch<SetStateAction<number | null>>) {
  return {
    tabIndex: n > 0 ? 0 : undefined,
    onFocus: () => setActivo((a) => a ?? 0),
    onBlur: () => setActivo(null),
    onMouseLeave: () => setActivo(null),
    onKeyDown: (e: KeyboardEvent) => {
      const paso = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
      if (paso !== 0) {
        e.preventDefault()
        // Actualización **funcional**, no `activo + paso`: con la tecla dejada
        // apretada los eventos llegan más rápido de lo que React repinta, y
        // todos leerían el mismo valor viejo. Se veía: tres flechas seguidas
        // movían un solo paso.
        setActivo((a) => Math.min(n - 1, Math.max(0, (a ?? 0) + paso)))
      } else if (e.key === 'Home') {
        e.preventDefault()
        setActivo(0)
      } else if (e.key === 'End') {
        e.preventDefault()
        setActivo(n - 1)
      } else if (e.key === 'Escape') {
        setActivo(null)
      }
    },
  }
}

/** Lo que dice el pie cuando la escala se cortó. Nunca se calla. */
function notaRecorte(recortados: number): string | null {
  if (recortados === 0) return null
  return recortados === 1
    ? '1 barra se sale de la escala y va recortada'
    : `${recortados} barras se salen de la escala y van recortadas`
}

/** La punta serrada de una barra recortada: se ve que le falta. */
function Serrucho({ x, y, w }: { x: number; y: number; w: number }) {
  const dientes = 3
  const paso = w / dientes
  const puntos = Array.from({ length: dientes * 2 + 1 }, (_, i) => {
    const px = x + (i * paso) / 2
    return `${px.toFixed(2)},${(y + (i % 2 === 0 ? 0 : 2.4)).toFixed(2)}`
  }).join(' ')
  return <polyline points={puntos} className="barra-recorte" />
}

/**
 * Barras diarias del mes: entradas (verde sólido) y salidas (rojo con rayado).
 * El rayado es codificación secundaria para visión con daltonismo, además de
 * la leyenda y la posición fija (entrada siempre a la izquierda del par).
 */
export function MonthBars({ byDay, month }: { byDay: Summary['byDay']; month: string }) {
  const [activo, setActivo] = useState<number | null>(null)
  const days = daysInMonth(month)
  const map = new Map(byDay.map((d) => [d.date, d]))
  const fechaDe = (i: number) => `${month}-${String(i + 1).padStart(2, '0')}`

  // El día de la nómina mide treinta veces cualquier gasto; con la escala
  // hasta el máximo, los otros veintinueve días quedan invisibles.
  const { techo, recortados } = techoDeEscala(
    byDay.flatMap((d) => [d.incomeCents, d.expenseCents]),
  )

  const step = 16
  const barW = 5
  const chartH = 120
  const util = chartH * 0.9
  const ancho = days * step
  const width = MARGEN_EJE + ancho
  const height = chartH + 22
  const y = (cents: number) => chartH - Math.min(cents, techo) / techo * util
  const nav = useNavegable(days, setActivo)

  if (byDay.length === 0) {
    return <p className="grafica-vacia">Sin movimientos este mes. La gráfica espera tu primer registro.</p>
  }

  // Un día sin movimientos también se anuncia: recorriendo con el teclado, no
  // decir nada se siente como que la flecha no hizo nada.
  const destacado =
    activo === null
      ? null
      : (map.get(fechaDe(activo)) ?? { date: fechaDe(activo), incomeCents: 0, expenseCents: 0 })
  const aviso = notaRecorte(recortados)

  return (
    <div className="grafica">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="grafica-svg"
        role="img"
        aria-label={`Entradas y salidas por día. Usa las flechas para recorrer los ${days} días.`}
        {...nav}
      >
        <defs>
          <pattern id="rayado" patternUnits="userSpaceOnUse" width="4" height="4" patternTransform="rotate(45)">
            <rect width="4" height="4" fill="var(--viz-salida)" />
            <line x1="0" y1="0" x2="0" y2="4" stroke="var(--hoja)" strokeWidth="1.6" />
          </pattern>
        </defs>
        <EjeY marcas={ticksBonitos(0, techo, 3)} y={y} x0={MARGEN_EJE} x1={width} />
        <line x1={MARGEN_EJE} y1={chartH} x2={width} y2={chartH} className="grafica-base" />
        {Array.from({ length: days }, (_, i) => {
          const dayNum = i + 1
          const date = fechaDe(i)
          const d = map.get(date)
          const x = MARGEN_EJE + i * step + (step - barW * 2 - 2) / 2
          // Se dibuja **desde la base hacia arriba**: con un alto mínimo pero
          // anclada en `y(cents)`, una barra diminuta se salía por debajo de
          // la línea del cero.
          const alto = (cents: number) => Math.max(2, chartH - y(cents))
          const arriba = (cents: number) => chartH - alto(cents)
          return (
            <g key={date} onMouseEnter={() => setActivo(i)}>
              {/* blanco de interacción a lo alto de la columna */}
              <rect x={MARGEN_EJE + i * step} y="0" width={step} height={chartH} fill="transparent" />
              {d && d.incomeCents > 0 && (
                <>
                  <rect
                    className="barra"
                    style={{ animationDelay: `${Math.min(i * 14, 420)}ms` }}
                    x={x}
                    y={arriba(d.incomeCents)}
                    width={barW}
                    height={alto(d.incomeCents)}
                    rx="1.5"
                    fill="var(--viz-entrada)"
                  />
                  {d.incomeCents > techo && <Serrucho x={x} y={arriba(d.incomeCents)} w={barW} />}
                </>
              )}
              {d && d.expenseCents > 0 && (
                <>
                  <rect
                    className="barra"
                    style={{ animationDelay: `${Math.min(i * 14 + 40, 460)}ms` }}
                    x={x + barW + 2}
                    y={arriba(d.expenseCents)}
                    width={barW}
                    height={alto(d.expenseCents)}
                    rx="1.5"
                    fill="url(#rayado)"
                  />
                  {d.expenseCents > techo && <Serrucho x={x + barW + 2} y={arriba(d.expenseCents)} w={barW} />}
                </>
              )}
              {activo === i && (
                <rect x={MARGEN_EJE + i * step} y="0" width={step} height={chartH} className="grafica-halo" />
              )}
              {(dayNum === 1 || dayNum % 7 === 0) && (
                <text x={MARGEN_EJE + i * step + step / 2} y={chartH + 15} className="grafica-tick" textAnchor="middle">
                  {dayNum}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      <div className="grafica-pie" aria-live="polite">
        {destacado ? (
          <span className="grafica-dato">
            <strong>{fmtDate(destacado.date)}</strong>
            {' · entró '}
            <span className="cifra-chica">{fmtMoney(destacado.incomeCents)}</span>
            {' · salió '}
            <span className="cifra-chica">{fmtMoney(destacado.expenseCents)}</span>
          </span>
        ) : (
          <span className="grafica-leyenda">
            <span className="muestra muestra-entrada" aria-hidden="true" /> Entradas
            <span className="muestra muestra-salida" aria-hidden="true" /> Salidas
            {aviso && <span className="grafica-aviso">· {aviso}</span>}
          </span>
        )}
      </div>
      <TablaDatos
        titulo="Entradas y salidas por día del mes"
        columnas={['Día', 'Entró', 'Salió']}
        filas={byDay.map((d) => [fmtDate(d.date), fmtMoney(d.incomeCents), fmtMoney(d.expenseCents)])}
      />
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
  const [activo, setActivo] = useState<number | null>(null)
  const { techo, recortados } = techoDeEscala(meses.flatMap((m) => [m.incomeCents, m.expenseCents]))

  const step = 54
  const barW = 18
  const chartH = 150
  const util = chartH * 0.9
  const ancho = meses.length * step
  const width = MARGEN_EJE + ancho
  const height = chartH + 24
  const y = (cents: number) => chartH - Math.min(cents, techo) / techo * util
  const destacado = activo === null ? null : meses[activo]
  const nav = useNavegable(meses.length, setActivo)
  const aviso = notaRecorte(recortados)

  if (meses.every((m) => m.incomeCents === 0 && m.expenseCents === 0)) {
    return <p className="grafica-vacia">Este año no tiene movimientos todavía.</p>
  }

  return (
    <div className="grafica">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="grafica-svg"
        role="img"
        aria-label="Entradas y salidas mes a mes del año. Usa las flechas para recorrer los meses."
        {...nav}
      >
        <defs>
          <pattern id="rayado-anio" patternUnits="userSpaceOnUse" width="4" height="4" patternTransform="rotate(45)">
            <rect width="4" height="4" fill="var(--viz-salida)" />
            <line x1="0" y1="0" x2="0" y2="4" stroke="var(--hoja)" strokeWidth="1.6" />
          </pattern>
        </defs>
        <EjeY marcas={ticksBonitos(0, techo, 4)} y={y} x0={MARGEN_EJE} x1={width} />
        <line x1={MARGEN_EJE} y1={chartH} x2={width} y2={chartH} className="grafica-base" />
        {meses.map((m, i) => {
          const x = MARGEN_EJE + i * step + (step - barW * 2 - 3) / 2
          const alto = (cents: number) => Math.max(2, chartH - y(cents))
          const arriba = (cents: number) => chartH - alto(cents)
          return (
            <g key={m.month} onMouseEnter={() => setActivo(i)}>
              <rect x={MARGEN_EJE + i * step} y="0" width={step} height={chartH} fill="transparent" />
              {m.incomeCents > 0 && (
                <>
                  <rect
                    className="barra"
                    style={{ animationDelay: `${i * 30}ms` }}
                    x={x} y={arriba(m.incomeCents)} width={barW} height={alto(m.incomeCents)} rx="1.5"
                    fill="var(--viz-entrada)"
                  />
                  {m.incomeCents > techo && <Serrucho x={x} y={arriba(m.incomeCents)} w={barW} />}
                </>
              )}
              {m.expenseCents > 0 && (
                <>
                  <rect
                    className="barra"
                    style={{ animationDelay: `${i * 30 + 60}ms` }}
                    x={x + barW + 3} y={arriba(m.expenseCents)} width={barW} height={alto(m.expenseCents)} rx="1.5"
                    fill="url(#rayado-anio)"
                  />
                  {m.expenseCents > techo && <Serrucho x={x + barW + 3} y={arriba(m.expenseCents)} w={barW} />}
                </>
              )}
              {activo === i && (
                <rect x={MARGEN_EJE + i * step} y="0" width={step} height={chartH} className="grafica-halo" />
              )}
              <text x={MARGEN_EJE + i * step + step / 2} y={chartH + 16} className="grafica-tick" textAnchor="middle">
                {INICIAL[i]}
              </text>
            </g>
          )
        })}
      </svg>
      <div className="grafica-pie" aria-live="polite">
        {destacado ? (
          <span className="grafica-dato">
            <strong>{MESES[Number(destacado.month.slice(5)) - 1]}</strong>
            {' · entró '}
            <span className="cifra-chica">{fmtMoney(destacado.incomeCents)}</span>
            {' · salió '}
            <span className="cifra-chica">{fmtMoney(destacado.expenseCents)}</span>
            {' · quedó '}
            <span className="cifra-chica">{fmtMoney(destacado.netCents)}</span>
          </span>
        ) : (
          <span className="grafica-leyenda">
            <span className="muestra muestra-entrada" aria-hidden="true" /> Entradas
            <span className="muestra muestra-salida" aria-hidden="true" /> Salidas
            {aviso && <span className="grafica-aviso">· {aviso}</span>}
          </span>
        )}
      </div>
      <TablaDatos
        titulo="Entradas y salidas mes a mes del año"
        columnas={['Mes', 'Entró', 'Salió', 'Quedó']}
        filas={meses.map((m) => [
          MESES[Number(m.month.slice(5)) - 1]!,
          fmtMoney(m.incomeCents),
          fmtMoney(m.expenseCents),
          fmtMoney(m.netCents),
        ])}
      />
    </div>
  )
}

/**
 * El patrimonio a lo largo del año. Una sola serie, así que el color no
 * codifica nada: la forma es el dato. Si la serie cruza el cero se dibuja esa
 * línea, porque deber más de lo que tienes se ve distinto a tener poco.
 */
export function PatrimonioLinea({ patrimonio }: { patrimonio: PuntoPatrimonio[] }) {
  const [activo, setActivo] = useState<number | null>(null)
  const valores = patrimonio.map((p) => p.totalCents)
  const max = Math.max(...valores, 0)
  const min = Math.min(...valores, 0)
  const rango = max - min || 1

  const chartH = 130
  const step = 54
  // Medio paso de aire a cada lado: sin él, el primer y el último punto se
  // parten contra el borde del recuadro.
  const margen = step / 2
  const ancho = (patrimonio.length - 1) * step + margen * 2
  const width = MARGEN_EJE + ancho
  const height = chartH + 24
  const y = (cents: number) => chartH - ((cents - min) / rango) * chartH * 0.9 - chartH * 0.05
  const puntos = patrimonio.map((p, i) => ({ x: MARGEN_EJE + margen + i * step, y: y(p.totalCents), p }))
  const linea = puntos.map((q) => `${q.x},${q.y}`).join(' ')
  // El relleno baja hasta el cero, no hasta el fondo del recuadro: así se ve
  // de un vistazo cuánto del año se pasó en números rojos.
  const base = y(0)
  const area = `${puntos[0]!.x},${base} ${linea} ${puntos.at(-1)!.x},${base}`
  const destacado = activo === null ? null : patrimonio[activo]
  const nav = useNavegable(patrimonio.length, setActivo)

  return (
    <div className="grafica">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="grafica-svg"
        role="img"
        aria-label="Patrimonio al cierre de cada mes. Usa las flechas para recorrer los meses."
        {...nav}
      >
        <EjeY marcas={ticksBonitos(min, max, 4)} y={y} x0={MARGEN_EJE} x1={width} />
        <polygon points={area} className="serie-area" />
        <polyline points={linea} className="serie-linea" />
        {min < 0 && <line x1={MARGEN_EJE} y1={base} x2={width} y2={base} className="grafica-base" />}
        {puntos.map((q, i) => (
          <g key={q.p.month} onMouseEnter={() => setActivo(i)}>
            <rect x={q.x - step / 2} y="0" width={step} height={chartH} fill="transparent" />
            <circle cx={q.x} cy={q.y} r={activo === i ? 4 : 2.5} className="serie-punto" />
            <text x={q.x} y={chartH + 16} className="grafica-tick" textAnchor="middle">
              {INICIAL[i]}
            </text>
          </g>
        ))}
      </svg>
      <div className="grafica-pie" aria-live="polite">
        {destacado ? (
          <span className="grafica-dato">
            <strong>{MESES[Number(destacado.month.slice(5)) - 1]}</strong>
            {' · '}
            <span className="cifra-chica">{fmtMoney(destacado.totalCents)}</span>
            {' · en cuentas '}
            <span className="cifra-chica">{fmtMoney(destacado.cuentasCents)}</span>
            {destacado.inversionesCents > 0 && (
              <> · invertido <span className="cifra-chica">{fmtMoney(destacado.inversionesCents)}</span></>
            )}
            {destacado.porPagarCents > 0 && (
              <> · debes <span className="cifra-chica">{fmtMoney(destacado.porPagarCents)}</span></>
            )}
          </span>
        ) : (
          <span className="grafica-leyenda">Cuentas + inversiones + lo que te deben − lo que debes</span>
        )}
      </div>
      <TablaDatos
        titulo="Patrimonio al cierre de cada mes"
        columnas={['Mes', 'Patrimonio', 'En cuentas', 'Invertido', 'Debes']}
        filas={patrimonio.map((p) => [
          MESES[Number(p.month.slice(5)) - 1]!,
          fmtMoney(p.totalCents),
          fmtMoney(p.cuentasCents),
          fmtMoney(p.inversionesCents),
          fmtMoney(p.porPagarCents),
        ])}
      />
    </div>
  )
}

/**
 * La caja proyectada, día a día.
 *
 * A diferencia del patrimonio —doce puntos, uno por mes—, aquí los puntos son
 * hasta noventa y ninguno se puede rotular: el eje X va con marcas cada siete
 * días y la fecha exacta la dice el pie al recorrer. La línea del cero se
 * dibuja siempre que la serie la cruce, porque **el cruce es la respuesta**: el
 * tramo bajo cero se pinta aparte para que el día en rojo se vea sin leer una
 * sola cifra, y aun así la cifra va escrita en el pie y en la tabla (R19).
 */
export function FlujoLinea({
  puntos,
  primerDiaEnRojo,
}: {
  puntos: { fecha: string; saldoCents: number; entradasCents: number; salidasCents: number }[]
  primerDiaEnRojo: string | null
}) {
  const [activo, setActivo] = useState<number | null>(null)
  const nav = useNavegable(puntos.length, setActivo)
  if (puntos.length < 2) return null

  const valores = puntos.map((p) => p.saldoCents)
  const max = Math.max(...valores, 0)
  const min = Math.min(...valores, 0)
  const rango = max - min || 1

  const chartH = 150
  const ancho = 620
  const width = MARGEN_EJE + ancho
  const margen = 12
  const paso = (ancho - margen * 2) / (puntos.length - 1)
  const y = (cents: number) => chartH - ((cents - min) / rango) * chartH * 0.86 - chartH * 0.07
  const x = (i: number) => MARGEN_EJE + margen + i * paso
  const base = y(0)

  const coords = puntos.map((p, i) => ({ x: x(i), y: y(p.saldoCents), p }))
  const linea = coords.map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' ')
  const area = `${coords[0]!.x},${base} ${linea} ${coords.at(-1)!.x},${base}`
  const destacado = activo === null ? null : puntos[activo]
  const iRojo = primerDiaEnRojo === null ? -1 : puntos.findIndex((p) => p.fecha === primerDiaEnRojo)

  return (
    <div className="grafica">
      <svg
        viewBox={`0 0 ${width} ${chartH + 20}`}
        className="grafica-svg"
        role="img"
        aria-label={`Saldo proyectado día a día, del ${fmtDate(puntos[0]!.fecha)} al ${fmtDate(
          puntos.at(-1)!.fecha,
        )}. Usa las flechas para recorrer los días.`}
        {...nav}
      >
        <EjeY marcas={ticksBonitos(min, max, 4)} y={y} x0={MARGEN_EJE} x1={width} />
        <polygon points={area} className="serie-area" />
        <polyline points={linea} className="serie-linea" />
        {min < 0 && (
          <>
            {/* Lo que cae bajo cero, con su propia tinta: el rojo del libro. */}
            <clipPath id="bajo-cero">
              <rect x={MARGEN_EJE} y={base} width={width - MARGEN_EJE} height={chartH - base} />
            </clipPath>
            <polyline points={linea} className="serie-linea serie-rojo" clipPath="url(#bajo-cero)" />
            <line x1={MARGEN_EJE} y1={base} x2={width} y2={base} className="grafica-base" />
          </>
        )}
        {iRojo > 0 && (
          <line
            x1={x(iRojo)}
            y1="0"
            x2={x(iRojo)}
            y2={chartH}
            className="grafica-marca-rojo"
          />
        )}
        {coords.map((q, i) => (
          <g key={q.p.fecha} onMouseEnter={() => setActivo(i)}>
            <rect x={q.x - paso / 2} y="0" width={paso} height={chartH} fill="transparent" />
            {(activo === i || i === 0 || i === coords.length - 1 || i === iRojo) && (
              <circle cx={q.x} cy={q.y} r={activo === i ? 4 : 2.5} className="serie-punto" />
            )}
            {i % 7 === 0 && i > 0 && (
              <text x={q.x} y={chartH + 14} className="grafica-tick" textAnchor="middle">
                {q.p.fecha.slice(8)}
              </text>
            )}
          </g>
        ))}
      </svg>
      <div className="grafica-pie" aria-live="polite">
        {destacado ? (
          <span className="grafica-dato">
            <strong>{fmtDate(destacado.fecha)}</strong>
            {' · caja '}
            <span className="cifra-chica">{fmtMoney(destacado.saldoCents)}</span>
            {destacado.entradasCents > 0 && (
              <> · entra <span className="cifra-chica">{fmtMoney(destacado.entradasCents)}</span></>
            )}
            {destacado.salidasCents > 0 && (
              <> · sale <span className="cifra-chica">{fmtMoney(destacado.salidasCents)}</span></>
            )}
            {destacado.entradasCents === 0 && destacado.salidasCents === 0 && ' · sin movimiento'}
          </span>
        ) : (
          <span className="grafica-leyenda">
            Caja al cierre de cada día · {fmtDate(puntos[0]!.fecha)} —{' '}
            {fmtDate(puntos.at(-1)!.fecha)}
          </span>
        )}
      </div>
      <TablaDatos
        titulo="Saldo proyectado al cierre de cada día"
        columnas={['Día', 'Caja', 'Entra', 'Sale']}
        filas={puntos.map((p) => [
          fmtDate(p.fecha),
          fmtMoney(p.saldoCents),
          fmtMoney(p.entradasCents),
          fmtMoney(p.salidasCents),
        ])}
      />
    </div>
  )
}

/**
 * La minigráfica de una cuenta: treinta días de saldo en el ancho de un dedo.
 *
 * **Es forma, no magnitud**, y por eso es la única gráfica de Finply que no se
 * mide desde cero (Fase 10a). La razón es que aquí no hay eje ni cifras que
 * leer: la cantidad va escrita al lado —el saldo y el cambio de los 30 días, en
 * pesos—, así que un trazo que arranca en el mínimo no puede confundirse con
 * una montaña. Medida desde cero, una cuenta de $150,000 que se movió $8,000
 * dibujaría una raya recta en todos los casos, que es no dibujar nada.
 *
 * Va `aria-hidden`: lo que dice ya está en el texto del renglón, y un lector de
 * pantalla no necesita oír dos veces lo mismo (R19).
 */
export function Spark({ puntos }: { puntos: number[] }) {
  if (puntos.length < 2) return null
  const max = Math.max(...puntos)
  const min = Math.min(...puntos)
  const rango = max - min || 1
  const w = 100
  const h = 22
  const x = (i: number) => (i / (puntos.length - 1)) * w
  const y = (v: number) => h - 3 - ((v - min) / rango) * (h - 6)
  const linea = puntos.map((p, i) => `${x(i).toFixed(1)},${y(p).toFixed(1)}`).join(' ')
  const sube = puntos.at(-1)! >= puntos[0]!

  return (
    // Sin `preserveAspectRatio="none"`: estirarlo al ancho del renglón cambiaría
    // la pendiente, y la pendiente es lo único que esta gráfica dice.
    <svg viewBox={`0 0 ${w} ${h}`} className="spark" aria-hidden="true">
      <polyline points={linea} className={`spark-linea${sube ? '' : ' spark-baja'}`} />
      <circle cx={x(puntos.length - 1)} cy={y(puntos.at(-1)!)} r="2" className="spark-punta" />
    </svg>
  )
}

/**
 * De qué está hecho el patrimonio, en dos barras a la misma escala: lo que
 * tienes, repartido, y lo que debes debajo. Cuatro números en una lista no
 * dicen si tu casa pesa más que tu deuda; dos barras sí, de un vistazo.
 *
 * Los segmentos se distinguen por **claridad**, no por tono —una rampa de la
 * misma tinta se lee igual con cualquier daltonismo (R10)— y cada uno lleva su
 * muestra junto a su cifra en la lista de abajo, que es la tabla de esta
 * gráfica: aquí no hay dato que viva solo en el color.
 */
export function Composicion({
  partes,
  debesCents,
}: {
  partes: { nombre: string; cents: number }[]
  debesCents: number
}) {
  const bruto = partes.reduce((s, p) => s + p.cents, 0)
  if (bruto <= 0 && debesCents <= 0) return null
  const escala = Math.max(bruto, debesCents, 1)
  const parte = (cents: number) => `${Math.max(0, (cents / escala) * 100)}%`

  return (
    // `aria-hidden` por lo mismo que la minigráfica: cada tramo está escrito
    // con su nombre y su cifra en la lista de abajo, y oírlo dos veces no
    // agrega nada.
    <div className="composicion" aria-hidden="true">
      <div className="composicion-fila">
        <span className="composicion-rotulo">Tienes</span>
        <span className="composicion-riel">
          {/*
            El índice es el del renglón, **no** el de los que sobrevivieron al
            filtro: con Bienes en cero, "Te deben" se pintaba con el tono de
            Bienes y su muestra en la lista decía otro. Un dato que vive en el
            color no puede cambiar de color según qué más haya.
          */}
          {partes.map((p, i) =>
            p.cents > 0 ? (
              <span
                key={p.nombre}
                className={`composicion-parte parte-${i}`}
                style={{ width: parte(p.cents) }}
                title={p.nombre}
              />
            ) : null,
          )}
        </span>
      </div>
      {debesCents > 0 && (
        <div className="composicion-fila">
          <span className="composicion-rotulo">Debes</span>
          <span className="composicion-riel">
            <span className="composicion-parte parte-debes" style={{ width: parte(debesCents) }} />
          </span>
        </div>
      )}
    </div>
  )
}

/**
 * Un renglón de la gráfica de categorías. `hijos` es el desglose de la Fase 23
 * y es opcional: las etiquetas y las fuentes lo mandan vacío o no lo mandan.
 */
export interface RenglonCategoria {
  name: string
  expenseCents: number
  hijos?: { name: string; expenseCents: number }[]
}

/** Barras horizontales: en qué se fue el gasto del mes (una sola serie, tono de acento). */
export function CategoryBars({ byCategory }: { byCategory: RenglonCategoria[] }) {
  if (byCategory.length === 0) {
    return <p className="grafica-vacia">Sin gastos este mes.</p>
  }
  // El máximo se busca, no se supone en el primer renglón: una lista que llegue
  // en cualquier otro orden dibujaba barras más largas que el riel.
  const max = Math.max(...byCategory.map((c) => c.expenseCents), 1)
  const total = byCategory.reduce((s, c) => s + c.expenseCents, 0)
  return (
    <ul className="cat-bars">
      {byCategory.map((c, i) => (
        <li key={c.name} className="cat-row-grupo">
          <div className="cat-row">
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
            {/* La barra compara contra la categoría más grande; el porcentaje
                dice la parte del total, que es otra pregunta. */}
            <span className="cat-parte">{total > 0 ? Math.round((c.expenseCents / total) * 100) : 0} %</span>
          </div>
          {/* El desglose (D25). Va siempre a la vista, no detrás de un clic ni
              de un `hover`: el cierre de año se imprime, y en papel no hay
              ratón (R19). Si el reporte agrega al padre, el hijo tiene que
              poder verse o la cifra deja de ser auditable. */}
          {c.hijos && c.hijos.length > 0 && (
            <ul className="cat-hijos">
              {c.hijos.map((h) => (
                <li key={h.name} className="cat-hijo">
                  <span className="cat-hijo-nombre">{h.name}</span>
                  <span className="cifra cifra-chica">{fmtMoney(h.expenseCents)}</span>
                  <span className="cat-parte">
                    {c.expenseCents !== 0 ? Math.round((h.expenseCents / c.expenseCents) * 100) : 0} %
                  </span>
                </li>
              ))}
            </ul>
          )}
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
  const [activo, setActivo] = useState<number | null>(null)
  const nav = useNavegable(puntos.length, setActivo)
  if (puntos.length < 2) return null

  const valores = puntos.map((p) => p.valueCents)
  const max = Math.max(...valores)
  const min = Math.min(...valores, 0)
  const rango = max - min || 1

  const chartH = 110
  const ancho = 600
  const width = MARGEN_EJE + ancho
  const margen = 14
  const paso = (ancho - margen * 2) / (puntos.length - 1)
  const y = (cents: number) => chartH - ((cents - min) / rango) * chartH * 0.88 - chartH * 0.06
  const coords = puntos.map((p, i) => ({ x: MARGEN_EJE + margen + i * paso, y: y(p.valueCents), p }))
  const linea = coords.map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' ')
  const base = y(min < 0 ? 0 : min)
  const area = `${coords[0]!.x},${base} ${linea} ${coords.at(-1)!.x},${base}`
  const destacado = activo === null ? null : puntos[activo]

  return (
    <div className="grafica">
      {/* Sin `preserveAspectRatio="none"`: estirarlo al ancho del contenedor
          cambiaba la pendiente del trazo, y la pendiente **es** el dato. */}
      <svg
        viewBox={`0 0 ${width} ${chartH}`}
        className="grafica-svg"
        role="img"
        aria-label="Valor de la inversión después de cada registro. Usa las flechas para recorrerlos."
        {...nav}
      >
        <EjeY marcas={ticksBonitos(min, max, 3)} y={y} x0={MARGEN_EJE} x1={width} />
        <polygon points={area} className="serie-area" />
        <polyline points={linea} className="serie-linea" />
        {coords.map((q, i) => (
          <g key={`${q.p.date}-${i}`} onMouseEnter={() => setActivo(i)}>
            <rect x={q.x - paso / 2} y="0" width={paso} height={chartH} fill="transparent" />
            <circle cx={q.x} cy={q.y} r={activo === i ? 4 : 2.5} className="serie-punto" />
          </g>
        ))}
      </svg>
      <div className="grafica-pie" aria-live="polite">
        {destacado ? (
          <span className="grafica-dato">
            <strong>{fmtDate(destacado.date)}</strong>
            {' · '}
            <span className="cifra-chica">{fmtMoney(destacado.valueCents)}</span>
          </span>
        ) : (
          <span className="grafica-leyenda">
            {fmtDate(puntos[0]!.date)} — {fmtDate(puntos.at(-1)!.date)} · {puntos.length} registros
          </span>
        )}
      </div>
      <TablaDatos
        titulo="Valor de la inversión después de cada registro"
        columnas={['Fecha', 'Valor']}
        filas={puntos.map((p) => [fmtDate(p.date), fmtMoney(p.valueCents)])}
      />
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
  titulo,
  etiqueta,
  formato = fmtMoney,
  formatoEje = fmtCompacto,
  marca,
}: {
  /** Una serie por ruta. `puntos[i]` es el valor del mes `i`. */
  series: { nombre: string; puntos: number[]; punteada?: boolean }[]
  /** Encabezado de la tabla que leen los lectores de pantalla. */
  titulo: string
  /** Qué se está viendo, para el `aria-label` del SVG. */
  etiqueta: string
  /**
   * Cómo se escribe un valor en el pie y en la tabla. Por omisión son pesos;
   * la serie en porcentaje pasa la suya.
   */
  formato?: (v: number) => string
  /**
   * Cómo se escribe una marca del eje. Va aparte de `formato` porque el eje
   * tiene 46 px: los pesos van compactos ("$1.5M") o se salen del recuadro, y
   * un porcentaje cabe entero. Cuando no se pasa, se compacta.
   */
  formatoEje?: (v: number) => string
  /**
   * Un mes que merece una raya vertical: el último de aporte, cuando hay fase
   * de retiro. Sin él, la cima de la montaña es un cambio de pendiente que hay
   * que adivinar.
   */
  marca?: { mes: number; texto: string } | null
}) {
  const [activo, setActivo] = useState<number | null>(null)
  const todos = series.flatMap((s) => s.puntos)
  const meses = Math.max(...series.map((s) => s.puntos.length), 1) - 1
  const nav = useNavegable(meses + 1, setActivo)
  if (todos.length === 0) return null
  const max = Math.max(...todos)
  const min = Math.min(...todos, 0)
  const rango = max - min || 1

  const chartH = 150
  const ancho = 600
  const width = MARGEN_EJE + ancho
  const margen = 14
  const paso = (ancho - margen * 2) / (meses || 1)
  const y = (v: number) => chartH - ((v - min) / rango) * chartH * 0.88 - chartH * 0.06
  const base = y(0)
  const x = (mes: number) => MARGEN_EJE + margen + mes * paso

  return (
    <div className="grafica">
      <svg
        viewBox={`0 0 ${width} ${chartH}`}
        className="grafica-svg"
        role="img"
        aria-label={`${etiqueta} Usa las flechas para recorrer los meses.`}
        {...nav}
      >
        <EjeY marcas={ticksBonitos(min, max, 4)} y={y} x0={MARGEN_EJE} x1={width} rotulo={formatoEje} />
        {min < 0 && <line x1={MARGEN_EJE} y1={base} x2={width} y2={base} className="grafica-base" />}
        {marca && marca.mes > 0 && marca.mes < meses && (
          <g aria-hidden="true">
            <line x1={x(marca.mes)} y1="0" x2={x(marca.mes)} y2={chartH} className="grafica-corte" />
            <text x={x(marca.mes) + 4} y="11" className="grafica-tick">{marca.texto}</text>
          </g>
        )}
        {series.map((s) => (
          <polyline
            key={s.nombre}
            points={s.puntos.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}
            className={`serie-linea ${s.punteada ? 'serie-punteada' : ''}`}
          />
        ))}
        {Array.from({ length: meses + 1 }, (_, i) => (
          <rect
            key={i}
            x={x(i) - paso / 2}
            y="0"
            width={paso}
            height={chartH}
            fill="transparent"
            onMouseEnter={() => setActivo(i)}
          />
        ))}
        {activo !== null &&
          series.map((s) => {
            const v = s.puntos[activo]
            return v === undefined ? null : (
              <circle key={s.nombre} cx={x(activo)} cy={y(v)} r="4" className="serie-punto" />
            )
          })}
      </svg>
      <div className="grafica-pie" aria-live="polite">
        {activo !== null ? (
          <span className="grafica-dato">
            <strong>Mes {activo}</strong>
            {series.map((s) => (
              <span key={s.nombre}>
                {' · '}
                {s.nombre}: <span className="cifra-chica">{formato(s.puntos[activo] ?? 0)}</span>
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
      <TablaDatos
        titulo={titulo}
        columnas={['Mes', ...series.map((s) => s.nombre)]}
        filas={Array.from({ length: meses + 1 }, (_, i) => [
          String(i),
          ...series.map((s) => formato(s.puntos[i] ?? 0)),
        ])}
      />
    </div>
  )
}
