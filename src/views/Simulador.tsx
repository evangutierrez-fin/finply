import { useState } from 'react'
import { api } from '../api.ts'
import { useApp } from '../context.ts'
import { useFetch } from '../hooks.ts'
import { fmtMoney, parseAmount, parseTasa, fmtTasa } from '../format.ts'
import { Money } from '../components/Money.tsx'
import { ProyeccionLineas } from '../components/Charts.tsx'
import type { Proyeccion } from '../../shared/types.ts'

const HORIZONTES = [
  { meses: 12, label: '1 año' },
  { meses: 60, label: '5 años' },
  { meses: 120, label: '10 años' },
  { meses: 240, label: '20 años' },
]

/** "en 5 años" / "en 8 meses". El plazo se lee, no se cuenta con los dedos. */
function plazo(meses: number): string {
  if (meses % 12 === 0) {
    const anios = meses / 12
    return `${anios} ${anios === 1 ? 'año' : 'años'}`
  }
  if (meses < 12) return `${meses} ${meses === 1 ? 'mes' : 'meses'}`
  const anios = Math.floor(meses / 12)
  return `${anios} ${anios === 1 ? 'año' : 'años'} y ${meses % 12} ${meses % 12 === 1 ? 'mes' : 'meses'}`
}

function Ruta({
  titulo,
  descripcion,
  proyeccion,
  mejor,
}: {
  titulo: string
  descripcion: string
  proyeccion: Proyeccion
  mejor: boolean
}) {
  return (
    <section className={`hoja ruta${mejor ? ' ruta-mejor' : ''}`}>
      <header className="ruta-head">
        <h2 className="hoja-titulo">{titulo}</h2>
        {mejor && <span className="chip chip-acento">Termina más arriba</span>}
      </header>
      <p className="deuda-concepto">{descripcion}</p>
      <div className="ruta-cifra">
        <span className="rotulo">Patrimonio al final</span>
        <Money cents={proyeccion.patrimonioFinalCents} className="hero-cifra hero-cifra-media" />
      </div>
      <dl className="hero-stats">
        <div className="stat">
          <dt>Lo que apartaste</dt>
          <dd><Money cents={proyeccion.aportadoCents} /></dd>
        </div>
        <div className="stat">
          <dt>Lo que puso la tasa</dt>
          <dd>
            <span className={proyeccion.rendimientoCents >= 0 ? 'stat-in' : ''}>
              <Money cents={proyeccion.rendimientoCents} signed />
            </span>
          </dd>
        </div>
        <div className="stat">
          <dt>Interés pagado</dt>
          <dd><Money cents={proyeccion.interesPagadoCents} /></dd>
        </div>
        <div className="stat">
          <dt>Sin deuda</dt>
          <dd className="cifra">
            {proyeccion.mesSinDeuda === null ? 'No dentro del plazo' : `en ${plazo(proyeccion.mesSinDeuda)}`}
          </dd>
        </div>
      </dl>
    </section>
  )
}

export function Simulador() {
  const { profile, refreshKey } = useApp()
  const [ahorro, setAhorro] = useState('5000')
  const [tasa, setTasa] = useState('7')
  const [meses, setMeses] = useState(120)

  const ahorroCents = parseAmount(ahorro) ?? 0
  const rendimientoAnualBp = parseTasa(tasa) ?? 0

  const { data, error } = useFetch(
    () => api.simulador(profile.id, { meses, ahorroMensualCents: ahorroCents, rendimientoAnualBp }),
    [profile.id, meses, ahorroCents, rendimientoAnualBp, refreshKey],
  )

  const diferencia = data ? data.deuda.patrimonioFinalCents - data.invertir.patrimonioFinalCents : 0
  const hayDeuda = (data?.inicio.deudaCents ?? 0) > 0

  return (
    <div className="vista">
      <header className="vista-head">
        <h1>Simulador</h1>
        <div className="seg seg-chico" role="radiogroup" aria-label="Horizonte de la proyección">
          {HORIZONTES.map((h) => (
            <button
              key={h.meses}
              type="button"
              role="radio"
              aria-checked={meses === h.meses}
              className={`seg-item${meses === h.meses ? ' activa' : ''}`}
              onClick={() => setMeses(h.meses)}
            >
              {h.label}
            </button>
          ))}
        </div>
      </header>

      <section className="hoja">
        <div className="campos-2">
          <label className="campo">
            <span className="campo-label">Aparto cada mes</span>
            <div className="monto-wrap">
              <span className="monto-signo" aria-hidden="true">$</span>
              <input
                className="campo-input"
                inputMode="decimal"
                value={ahorro}
                onChange={(e) => setAhorro(e.target.value)}
              />
            </div>
          </label>
          <label className="campo">
            <span className="campo-label">Rendimiento anual que supongo</span>
            <div className="monto-wrap">
              <input
                className="campo-input"
                inputMode="decimal"
                value={tasa}
                onChange={(e) => setTasa(e.target.value)}
              />
              <span className="monto-signo monto-signo-fin" aria-hidden="true">%</span>
            </div>
          </label>
        </div>
        <p className="forma-nota">
          La tasa la pones tú. Finply no sabe cuánto va a rendir nada y no te va a sugerir dónde
          poner tu dinero: esto es tu propia aritmética, con tus cifras de hoy.
        </p>
      </section>

      {error && <p className="aviso" role="alert">{error}</p>}
      {!data && !error && <p className="cargando">Proyectando…</p>}

      {data && (
        <>
          <section className="hoja">
            <h2 className="hoja-titulo">De dónde parte</h2>
            <dl className="hero-stats">
              <div className="stat">
                <dt>Líquido</dt>
                <dd><Money cents={data.inicio.liquidoCents} /></dd>
              </div>
              <div className="stat">
                <dt>Invertido</dt>
                <dd><Money cents={data.inicio.inversionesCents} /></dd>
              </div>
              <div className="stat">
                <dt>Debes</dt>
                <dd><Money cents={data.inicio.deudaCents} /></dd>
              </div>
              <div className="stat stat-neto">
                <dt>Patrimonio hoy</dt>
                <dd><Money cents={data.inicio.patrimonioCents} /></dd>
              </div>
            </dl>
          </section>

          <section className="hoja">
            <h2 className="hoja-titulo">
              Patrimonio proyectado a {plazo(meses)}
            </h2>
            <ProyeccionLineas
              series={[
                { nombre: 'Todo a invertir', puntos: data.invertir.puntos },
                { nombre: 'Primero la deuda', puntos: data.deuda.puntos, punteada: true },
              ]}
            />
          </section>

          <div className="dos-columnas">
            <Ruta
              titulo="Todo a invertir"
              descripcion="Lo que apartas se va íntegro a inversión desde el primer mes. Las deudas siguen su plan."
              proyeccion={data.invertir}
              mejor={diferencia < 0 && hayDeuda}
            />
            <Ruta
              titulo="Primero la deuda"
              descripcion="Lo que apartas ataca primero la deuda más cara; cuando no queda ninguna, todo se invierte."
              proyeccion={data.deuda}
              mejor={diferencia > 0}
            />
          </div>

          <section className="hoja">
            <h2 className="hoja-titulo">Qué dice la comparación</h2>
            {!hayDeuda ? (
              <p className="ajustes-texto">
                No tienes deuda abierta, así que las dos rutas son la misma: todo lo que apartes se
                invierte. Con {fmtMoney(ahorroCents)} al mes al {fmtTasa(rendimientoAnualBp)} anual,
                tu patrimonio pasaría de {fmtMoney(data.inicio.patrimonioCents)} a{' '}
                {fmtMoney(data.invertir.patrimonioFinalCents)} en {plazo(meses)}, de los cuales{' '}
                {fmtMoney(data.invertir.aportadoCents)} los pusiste tú.
              </p>
            ) : (
              <p className="ajustes-texto">
                Con estos supuestos, {diferencia > 0 ? 'pagar primero la deuda' : 'invertirlo todo'}{' '}
                termina <strong className="cifra-chica">{fmtMoney(Math.abs(diferencia))}</strong>{' '}
                más arriba en {plazo(meses)}. La razón es aritmética y no opinión: quitarte una
                deuda te ahorra su tasa con certeza, mientras que invertir gana la tasa que tú
                supusiste. Cambia el {fmtTasa(rendimientoAnualBp)} de arriba y verás en qué punto
                se voltea la respuesta.
              </p>
            )}
            <p className="reportes-supuesto">
              Supuestos, todos: tu saldo líquido de hoy no se mueve — lo que se proyecta es solo lo
              que apartas. Las inversiones rinden la tasa que escribiste, convertida a mensual de
              forma efectiva, así que doce meses dan exactamente esa tasa. Las deudas devengan la
              suya y se siguen pagando con la cuota de su plan, que sale de tu gasto corriente y no
              de lo que apartas; una deuda sin plazo se queda quieta porque no hay cuota que
              suponerle. No hay inflación, ni impuestos, ni comisiones: los pesos del último mes se
              comparan con los de hoy tal cual. Nada de esto es un pronóstico ni un consejo de
              inversión.
            </p>
          </section>
        </>
      )}
    </div>
  )
}
