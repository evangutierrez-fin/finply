import { useState } from 'react'
import { api } from '../api.ts'
import { useApp } from '../context.ts'
import { useFetch } from '../hooks.ts'
import { fmtMoney, parseAmount, parseTasa, fmtTasa } from '../format.ts'
import { Money } from '../components/Money.tsx'
import { ProyeccionLineas } from '../components/Charts.tsx'
import type { Proyeccion, Simulacion } from '../../shared/types.ts'

const HORIZONTES = [
  { meses: 12, label: '1 año' },
  { meses: 60, label: '5 años' },
  { meses: 120, label: '10 años' },
  { meses: 240, label: '20 años' },
]

const RETIROS = [
  { meses: 120, label: '10 años' },
  { meses: 240, label: '20 años' },
  { meses: 360, label: '30 años' },
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

/** Un campo de monto con su signo de pesos, que aquí van varios iguales. */
function CampoMonto({
  label,
  valor,
  onChange,
  nota,
}: {
  label: string
  valor: string
  onChange: (v: string) => void
  nota?: string
}) {
  return (
    <label className="campo">
      <span className="campo-label">{label}</span>
      <div className="monto-wrap">
        <span className="monto-signo" aria-hidden="true">$</span>
        <input
          className="campo-input"
          inputMode="decimal"
          value={valor}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
      {nota && <span className="campo-nota">{nota}</span>}
    </label>
  )
}

function CampoTasa({
  label,
  valor,
  onChange,
  nota,
}: {
  label: string
  valor: string
  onChange: (v: string) => void
  nota?: string
}) {
  return (
    <label className="campo">
      <span className="campo-label">{label}</span>
      <div className="monto-wrap">
        <input
          className="campo-input"
          inputMode="decimal"
          value={valor}
          onChange={(e) => onChange(e.target.value)}
        />
        <span className="monto-signo monto-signo-fin" aria-hidden="true">%</span>
      </div>
      {nota && <span className="campo-nota">{nota}</span>}
    </label>
  )
}

function Ruta({
  titulo,
  descripcion,
  proyeccion,
  mejor,
  conInflacion,
  hayRetiro,
  mesesAporte,
}: {
  titulo: string
  descripcion: string
  proyeccion: Proyeccion
  mejor: boolean
  conInflacion: boolean
  hayRetiro: boolean
  /** Para contar lo que aguanta el dinero **desde que empiezas a retirar**. */
  mesesAporte: number
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
        {conInflacion && (
          <span className="ruta-real">
            <Money cents={proyeccion.patrimonioRealFinalCents} className="cifra-chica" /> en pesos de hoy
          </span>
        )}
      </div>
      <dl className="hero-stats">
        <div className="stat">
          <dt>Lo que apartaste</dt>
          <dd><Money cents={proyeccion.aportadoCents} /></dd>
        </div>
        {proyeccion.pagadoAPlanCents > 0 && (
          <div className="stat">
            <dt>Cuotas de tus deudas</dt>
            <dd><Money cents={proyeccion.pagadoAPlanCents} /></dd>
          </div>
        )}
        {hayRetiro && (
          <div className="stat">
            <dt>Lo que sacaste</dt>
            <dd><Money cents={proyeccion.retiradoCents} /></dd>
          </div>
        )}
        <div className="stat">
          <dt>Lo que puso la tasa</dt>
          <dd>
            <span className={proyeccion.rendimientoCents >= 0 ? 'stat-in' : ''}>
              <Money cents={proyeccion.rendimientoCents} signed />
            </span>
          </dd>
        </div>
        <div className="stat">
          <dt>Le sacaste al año</dt>
          {/* Hay rutas sin una tasa que las describa —acabar debiendo después de
              vaciarlo todo es una— y en esas no se inventa un número: es lo
              mismo que hace el XIRR de Inversiones cuando no puede afirmar nada. */}
          <dd className="cifra">
            {proyeccion.tasaEquivalenteBp === null
              ? 'No se puede decir'
              : fmtTasa(proyeccion.tasaEquivalenteBp)}
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
        {hayRetiro && (
          <div className="stat stat-neto">
            <dt>El dinero aguanta</dt>
            {/* El mes que devuelve el servidor cuenta desde hoy; lo que la
                pregunta quiere saber es cuánto dura **el retiro**, así que se le
                descuentan los meses de aporte. */}
            <dd className="cifra">
              {proyeccion.mesSinFondos === null
                ? 'todo el plazo'
                : `${plazo(proyeccion.mesSinFondos - 1 - mesesAporte)} de retiro`}
            </dd>
          </div>
        )}
      </dl>
    </section>
  )
}

/**
 * Lo que puso la tasa, mes a mes. Es la gráfica que faltaba: el patrimonio
 * arrastra el punto de partida, así que quien empieza con $80,000 ve dos curvas
 * que se separan poco y parecen equivalentes aunque una rinda el doble. Sin el
 * punto de partida encima, la diferencia se ve sola.
 */
function Rendimiento({ data }: { data: Simulacion }) {
  const [modo, setModo] = useState<'pesos' | 'porciento'>('pesos')
  const rutas = [
    { nombre: 'Todo a invertir', p: data.invertir, punteada: false },
    { nombre: 'Primero la deuda', p: data.deuda, punteada: true },
  ]

  // En porcentaje, un mes sin base positiva no tiene nada que decir; se dibuja
  // como cero y la nota de abajo explica por qué la línea empieza plana.
  const series = rutas.map((r) => ({
    nombre: r.nombre,
    punteada: r.punteada,
    puntos: r.p.puntos.map((q) =>
      modo === 'pesos' ? q.rendimientoCents : (q.rendimientoBp ?? 0),
    ),
  }))
  const mudos = data.invertir.puntos.some((q) => q.rendimientoBp === null)

  return (
    <section className="hoja">
      <header className="hoja-head">
        <h2 className="hoja-titulo">Lo que puso la tasa, sin tu punto de partida encima</h2>
        <div className="seg seg-chico" role="radiogroup" aria-label="Cómo se mide el rendimiento">
          {(['pesos', 'porciento'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={modo === m}
              className={`seg-item${modo === m ? ' activa' : ''}`}
              onClick={() => setModo(m)}
            >
              {m === 'pesos' ? 'En pesos' : 'En porcentaje'}
            </button>
          ))}
        </div>
      </header>
      <ProyeccionLineas
        series={series}
        titulo={
          modo === 'pesos'
            ? 'Rendimiento acumulado con cada estrategia'
            : 'Rendimiento acumulado sobre lo puesto, con cada estrategia'
        }
        etiqueta={
          modo === 'pesos'
            ? 'Rendimiento acumulado con cada estrategia, mes a mes.'
            : 'Rendimiento acumulado sobre lo que llevas puesto, con cada estrategia.'
        }
        formato={modo === 'pesos' ? undefined : (v) => fmtTasa(Math.round(v))}
        formatoEje={modo === 'pesos' ? undefined : (v) => fmtTasa(Math.round(v))}
        marca={
          data.supuestos.retiroMensualCents > 0
            ? { mes: data.supuestos.mesesAporte, texto: 'empiezas a retirar' }
            : null
        }
      />
      <p className="reportes-supuesto">
        {modo === 'pesos' ? (
          <>
            Patrimonio menos el de hoy, menos todo lo que pusiste —lo que apartas y las cuotas del
            plan de tus deudas—, más lo que sacaste. Lo que queda son las ganancias de lo invertido
            menos el interés de lo que debes, y nada más: cuando la línea va hacia abajo, la deuda
            está devengando más de lo que rinde lo invertido. Las cuotas cuentan como dinero puesto
            porque lo son; si no, la deuda bajaría sola y su capital se vería como rendimiento.
          </>
        ) : (
          <>
            Ese mismo rendimiento contra lo que llevas puesto —lo de hoy más lo aportado y las
            cuotas—, que es acumulado y no anual: a diez años, un 7 % anual da mucho más de 7 %
            aquí. La cifra comparable de frente contra tu{' '}
            {fmtTasa(data.supuestos.rendimientoAnualBp)} es la de "le sacaste al año" de cada ruta.{' '}
            {mudos && 'Los meses en que llevas puesto menos que nada no dicen porcentaje: no significaría nada.'}
          </>
        )}
      </p>
    </section>
  )
}

/**
 * El saldo invertido, solo.
 *
 * La gráfica del patrimonio mezcla tres cosas —lo líquido, que está quieto; lo
 * invertido, que crece; y la deuda, que se resta— y la que manda a la vista es
 * la más grande. Con $398,000 parados en la cuenta y $39,000 invertidos, la
 * curva que se ve es la del efectivo y la bolsa que de verdad rinde no se
 * distingue. Esta es esa bolsa sola: es sobre la que actúa la tasa que
 * escribiste, y con la ruta de la deuda se ve arrancar plana —todo se va a
 * abonar— y despegar el mes en que la deuda muere.
 */
function Invertido({ data }: { data: Simulacion }) {
  const hayRetiro = data.supuestos.retiroMensualCents > 0
  const finInvertir = data.invertir.puntos.at(-1)!.inversionesCents
  const finDeuda = data.deuda.puntos.at(-1)!.inversionesCents
  // Lo que separa a las dos líneas es la deuda llevándose lo que apartas, así
  // que lo que hay que mirar es si hay deuda y cuándo muere — **no** si la
  // línea toca el cero. Empezar con algo ya invertido la mantiene despegada
  // desde el primer mes aunque cada peso nuevo se vaya a abonar.
  const hayDeuda = data.inicio.deudaCents > 0
  const muere = data.deuda.mesSinDeuda

  return (
    <section className="hoja">
      <h2 className="hoja-titulo">Lo invertido, solo</h2>
      <ProyeccionLineas
        series={[
          { nombre: 'Todo a invertir', puntos: data.invertir.puntos.map((q) => q.inversionesCents) },
          {
            nombre: 'Primero la deuda',
            puntos: data.deuda.puntos.map((q) => q.inversionesCents),
            punteada: true,
          },
        ]}
        titulo="Saldo invertido con cada estrategia"
        etiqueta="Saldo invertido con cada estrategia, mes a mes, sin el efectivo ni la deuda."
        marca={hayRetiro ? { mes: data.supuestos.mesesAporte, texto: 'empiezas a retirar' } : null}
      />
      <p className="reportes-supuesto">
        Sin el saldo líquido encima y sin restarle la deuda: esta es la bolsa sobre la que actúa el{' '}
        {fmtTasa(data.supuestos.rendimientoAnualBp)} que supusiste. Al final del plazo tendrías{' '}
        <strong className="cifra-chica">{fmtMoney(finInvertir)}</strong> invirtiéndolo todo y{' '}
        <strong className="cifra-chica">{fmtMoney(finDeuda)}</strong> pagando primero la deuda.{' '}
        {!hayDeuda ? (
          <>Las dos líneas son la misma: no hay deuda que se lleve lo que apartas.</>
        ) : muere === null ? (
          <>
            La línea punteada no recibe un peso nuevo en todo el plazo: la deuda no se acaba dentro
            del horizonte, así que cada peso que apartas sigue yendo a abonar. Lo poco que sube es
            solo lo que ya tenías invertido, rindiendo.
          </>
        ) : (
          <>
            La línea punteada se queda atrás mientras la deuda vive —cada peso que apartas va a
            abonar— y a partir de {plazo(muere)} las dos suben igual, porque desde ahí las dos rutas
            hacen lo mismo. Ojo: lo que la punteada no tiene invertido lo tiene en deuda que ya no
            debe, y esa comparación se hace abajo, con el patrimonio.
          </>
        )}
        {hayRetiro && ' Y baja hasta el cero cuando empiezas a retirar: de aquí sale el retiro, antes que de tu efectivo.'}
      </p>
    </section>
  )
}

/** El interés que te ahorras liquidando antes, creciendo mes a mes. */
function Interes({ data }: { data: Simulacion }) {
  const ahorro = data.invertir.interesPagadoCents - data.deuda.interesPagadoCents
  return (
    <section className="hoja">
      <h2 className="hoja-titulo">Lo que cuesta seguir debiendo</h2>
      <ProyeccionLineas
        series={[
          { nombre: 'Todo a invertir', puntos: data.invertir.puntos.map((q) => q.interesPagadoCents) },
          {
            nombre: 'Primero la deuda',
            puntos: data.deuda.puntos.map((q) => q.interesPagadoCents),
            punteada: true,
          },
        ]}
        titulo="Interés pagado acumulado con cada estrategia"
        etiqueta="Interés pagado acumulado con cada estrategia, mes a mes."
      />
      <p className="reportes-supuesto">
        {ahorro > 0 ? (
          <>
            Liquidar primero te ahorra{' '}
            <strong className="cifra-chica">{fmtMoney(ahorro)}</strong> de interés en{' '}
            {plazo(data.supuestos.meses)}. La distancia entre las dos líneas es ese ahorro, y crece
            solo: cada mes que la deuda sigue viva vuelve a devengar.
          </>
        ) : (
          <>
            Las dos rutas pagan el mismo interés: sin deuda abierta —o sin tasa— no hay nada que
            adelantar.
          </>
        )}
      </p>
    </section>
  )
}

/** La misma proyección en pesos de hoy. Solo aparece si el usuario supuso inflación. */
function Real({ data }: { data: Simulacion }) {
  const perdido = data.invertir.patrimonioFinalCents - data.invertir.patrimonioRealFinalCents
  return (
    <section className="hoja">
      <h2 className="hoja-titulo">Lo mismo, en pesos de hoy</h2>
      <ProyeccionLineas
        series={[
          { nombre: 'Nominal', puntos: data.invertir.puntos.map((q) => q.patrimonioCents) },
          {
            nombre: 'En pesos de hoy',
            puntos: data.invertir.puntos.map((q) => q.patrimonioRealCents),
            punteada: true,
          },
        ]}
        titulo="Patrimonio nominal y en pesos de hoy, ruta de invertir"
        etiqueta="Patrimonio proyectado en pesos corrientes y en pesos de hoy."
        marca={
          data.supuestos.retiroMensualCents > 0
            ? { mes: data.supuestos.mesesAporte, texto: 'empiezas a retirar' }
            : null
        }
      />
      <p className="reportes-supuesto">
        {data.invertir.patrimonioFinalCents >= 0 ? (
          <>
            Con {fmtTasa(data.supuestos.inflacionAnualBp)} de inflación anual, los{' '}
            <strong className="cifra-chica">{fmtMoney(data.invertir.patrimonioFinalCents)}</strong>{' '}
            del último mes comprarían lo que hoy compran{' '}
            <strong className="cifra-chica">
              {fmtMoney(data.invertir.patrimonioRealFinalCents)}
            </strong>
            : la diferencia, <span className="cifra-chica">{fmtMoney(perdido)}</span>, no la
            pierdes en ningún lado, es que el peso vale menos.{' '}
          </>
        ) : (
          // Terminar debiendo invierte la frase: la inflación encoge la deuda
          // igual que encoge el ahorro, y decirlo al revés sonaría a pérdida.
          <>
            Con {fmtTasa(data.supuestos.inflacionAnualBp)} de inflación anual, los{' '}
            <strong className="cifra-chica">
              {fmtMoney(-data.invertir.patrimonioFinalCents)}
            </strong>{' '}
            que deberías al final pesarían como{' '}
            <strong className="cifra-chica">
              {fmtMoney(-data.invertir.patrimonioRealFinalCents)}
            </strong>{' '}
            de hoy: el peso que vale menos también encoge lo que debes.{' '}
          </>
        )}
        La inflación la escribes tú y no cambia una sola cifra nominal de arriba — es una segunda
        lectura del mismo patrimonio, no otra proyección.
      </p>
    </section>
  )
}

export function Simulador() {
  const { profile, refreshKey } = useApp()
  const [ahorro, setAhorro] = useState('5000')
  const [tasa, setTasa] = useState('7')
  const [inflacion, setInflacion] = useState('0')
  const [meses, setMeses] = useState(120)
  const [objetivo, setObjetivo] = useState('')
  const [conRetiro, setConRetiro] = useState(false)
  const [mesesRetiro, setMesesRetiro] = useState(240)
  const [retiro, setRetiro] = useState('30000')

  const ahorroCents = parseAmount(ahorro) ?? 0
  const rendimientoAnualBp = parseTasa(tasa) ?? 0
  const inflacionAnualBp = parseTasa(inflacion) ?? 0
  const objetivoCents = objetivo.trim() === '' ? 0 : (parseAmount(objetivo) ?? 0)
  const retiroCents = conRetiro ? (parseAmount(retiro) ?? 0) : 0
  // Con fase de retiro, el horizonte deja de ser el plazo: es lo que aportas
  // más lo que vives de ello. La cima de la montaña es `meses`.
  const horizonte = conRetiro ? meses + mesesRetiro : meses

  const { data, error } = useFetch(
    () =>
      api.simulador(profile.id, {
        meses: horizonte,
        mesesAporte: meses,
        ahorroMensualCents: ahorroCents,
        rendimientoAnualBp,
        inflacionAnualBp,
        retiroMensualCents: retiroCents,
        objetivoCents,
      }),
    [
      profile.id, horizonte, meses, ahorroCents, rendimientoAnualBp, inflacionAnualBp,
      retiroCents, objetivoCents, refreshKey,
    ],
  )

  const diferencia = data ? data.deuda.patrimonioFinalCents - data.invertir.patrimonioFinalCents : 0
  const hayDeuda = (data?.inicio.deudaCents ?? 0) > 0

  return (
    <div className="vista">
      <header className="vista-head">
        <h1>Simulador</h1>
        <div className="seg seg-chico" role="radiogroup" aria-label={conRetiro ? 'Años aportando' : 'Horizonte de la proyección'}>
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
        <div className="campos-3">
          <CampoMonto label="Aparto cada mes" valor={ahorro} onChange={setAhorro} />
          <CampoTasa label="Rendimiento anual que supongo" valor={tasa} onChange={setTasa} />
          <CampoTasa
            label="Inflación anual que supongo"
            valor={inflacion}
            onChange={setInflacion}
            nota="En cero, la proyección es solo nominal"
          />
        </div>
        <p className="forma-nota">
          Las dos tasas las pones tú. Finply no sabe cuánto va a rendir nada, no sabe cuánto va a
          subir el costo de la vida y no te va a sugerir dónde poner tu dinero: esto es tu propia
          aritmética, con tus cifras de hoy.
        </p>
      </section>

      {error && <p className="aviso" role="alert">{error}</p>}
      {!data && !error && <p className="cargando">Proyectando…</p>}

      {data && (
        <>
          <section className="hoja">
            <h2 className="hoja-titulo">De dónde parte</h2>
            {/* `.stats`, no `.hero-stats`: esta última es una columna pensada
                para vivir dentro de un `.hero`, y suelta en una hoja ancha deja
                cuatro cajas apiladas a todo lo largo. Es la misma trampa que
                costó media hora en la Fase 15. */}
            <dl className="stats">
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
              {conRetiro
                ? `Patrimonio: ${plazo(meses)} aportando y ${plazo(mesesRetiro)} viviendo de ello`
                : `Patrimonio proyectado a ${plazo(meses)}`}
            </h2>
            <ProyeccionLineas
              series={[
                { nombre: 'Todo a invertir', puntos: data.invertir.puntos.map((q) => q.patrimonioCents) },
                {
                  nombre: 'Primero la deuda',
                  puntos: data.deuda.puntos.map((q) => q.patrimonioCents),
                  punteada: true,
                },
              ]}
              titulo="Patrimonio proyectado con cada estrategia"
              etiqueta="Patrimonio proyectado con cada estrategia."
              marca={conRetiro ? { mes: meses, texto: 'empiezas a retirar' } : null}
            />
          </section>

          {/* Va aquí y no más abajo: primero el todo, luego la parte que crece
              —que es la que la tasa toca— y después lo que la tasa puso. Sin
              nada invertido y sin apartar nada no hay bolsa que enseñar, y una
              raya en el cero no es una gráfica. */}
          {(data.inicio.inversionesCents > 0 || ahorroCents > 0) && <Invertido data={data} />}

          <Rendimiento data={data} />

          <Interes data={data} />

          {inflacionAnualBp > 0 && <Real data={data} />}

          <div className="dos-columnas">
            <Ruta
              titulo="Todo a invertir"
              descripcion="Lo que apartas se va íntegro a inversión desde el primer mes. Las deudas siguen su plan."
              proyeccion={data.invertir}
              mejor={diferencia < 0 && hayDeuda}
              conInflacion={inflacionAnualBp > 0}
              hayRetiro={conRetiro}
              mesesAporte={meses}
            />
            <Ruta
              titulo="Primero la deuda"
              descripcion="Lo que apartas ataca primero la deuda más cara; cuando no queda ninguna, todo se invierte."
              proyeccion={data.deuda}
              mejor={diferencia > 0}
              conInflacion={inflacionAnualBp > 0}
              hayRetiro={conRetiro}
              mesesAporte={meses}
            />
          </div>

          {/*
            La pregunta al revés. No es otra simulación: es la misma, corrida
            hacia atrás hasta encontrar el aporte más chico que llega — por eso
            la cifra y la gráfica de arriba no pueden discrepar.
          */}
          <section className="hoja">
            <h2 className="hoja-titulo">Al revés: ¿cuánto aparto al mes?</h2>
            <div className="campos-2">
              <CampoMonto
                label={`Quiero llegar a esto en ${plazo(horizonte)}`}
                valor={objetivo}
                onChange={setObjetivo}
                nota="Déjalo vacío si no vas por una cifra"
              />
            </div>
            {data.meta && (
              <dl className="stats stats-auto">
                <div className="stat">
                  <dt>Todo a invertir</dt>
                  <dd>
                    {data.meta.invertirCents === null ? (
                      <span className="cifra">No se llega</span>
                    ) : (
                      <Money cents={data.meta.invertirCents} />
                    )}
                  </dd>
                </div>
                <div className="stat">
                  <dt>Primero la deuda</dt>
                  <dd>
                    {data.meta.deudaCents === null ? (
                      <span className="cifra">No se llega</span>
                    ) : (
                      <Money cents={data.meta.deudaCents} />
                    )}
                  </dd>
                </div>
              </dl>
            )}
            <p className="reportes-supuesto">
              {data.meta === null ? (
                <>
                  Escribe a cuánto quieres llegar y Finply busca, corriendo la misma proyección de
                  arriba, el aporte mensual más chico que lo alcanza por cada ruta.
                </>
              ) : data.meta.invertirCents === null && data.meta.deudaCents === null ? (
                <>
                  Con estos supuestos no se llega a esa cifra ni apartando el tope. Estirar el plazo
                  o bajar la meta son las dos salidas honestas; subir la tasa supuesta solo cambia
                  el número, no lo que va a pasar.
                </>
              ) : (
                <>
                  Es el aporte más chico que llega: con un centavo menos, la proyección se queda
                  corta. Sale de correr esta misma simulación una y otra vez, no de una fórmula
                  aparte, así que la cifra y la gráfica de arriba dicen lo mismo.
                </>
              )}
            </p>
          </section>

          {/*
            Y la pregunta que sigue a "¿cuánto junto?", que es la que de verdad
            importa: ¿de qué vivo después? Es la misma proyección con dos
            supuestos más, no una simulación distinta.
          */}
          <section className="hoja">
            <header className="hoja-head">
              <h2 className="hoja-titulo">Y después, ¿de qué vivo?</h2>
              <button
                type="button"
                className={`chip${conRetiro ? ' chip-acento' : ''}`}
                aria-pressed={conRetiro}
                onClick={() => setConRetiro((v) => !v)}
              >
                {conRetiro ? 'Quitar el retiro' : 'Agregar una etapa de retiro'}
              </button>
            </header>
            {conRetiro ? (
              <>
                <div className="campos-2">
                  <CampoMonto
                    label="Saco cada mes al retirarme"
                    valor={retiro}
                    onChange={setRetiro}
                    nota="La misma cantidad cada mes, sin ajustar por inflación"
                  />
                  <div className="campo">
                    <span className="campo-label">Durante</span>
                    <div className="seg seg-chico" role="radiogroup" aria-label="Años retirando">
                      {RETIROS.map((r) => (
                        <button
                          key={r.meses}
                          type="button"
                          role="radio"
                          aria-checked={mesesRetiro === r.meses}
                          className={`seg-item${mesesRetiro === r.meses ? ' activa' : ''}`}
                          onClick={() => setMesesRetiro(r.meses)}
                        >
                          {r.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <p className="reportes-supuesto">
                  Aportas {plazo(meses)} y después sacas{' '}
                  <strong className="cifra-chica">{fmtMoney(retiroCents)}</strong> al mes durante{' '}
                  {plazo(mesesRetiro)}. El retiro sale primero de lo invertido y, cuando eso se
                  acaba, de tu saldo líquido; lo que no alcance no se saca, y el mes en que eso pasa
                  está arriba en cada ruta. Ojo con el supuesto 6: son{' '}
                  {fmtMoney(retiroCents)} <em>nominales</em> cada mes, así que con inflación cada
                  año compran un poco menos — la gráfica en pesos de hoy es la que enseña cuánto
                  menos.
                </p>
              </>
            ) : (
              <p className="ajustes-texto">
                Juntar una cifra es media pregunta. La otra mitad es cuánto dura: aportar{' '}
                {plazo(meses)} y después sacar una cantidad al mes hasta que se acabe — o hasta que
                se demuestre que no se acaba.
              </p>
            )}
          </section>

          <section className="hoja">
            <h2 className="hoja-titulo">Qué dice la comparación</h2>
            {!hayDeuda ? (
              <p className="ajustes-texto">
                No tienes deuda abierta, así que las dos rutas son la misma: todo lo que apartes se
                invierte. Con {fmtMoney(ahorroCents)} al mes al {fmtTasa(rendimientoAnualBp)} anual,
                tu patrimonio pasaría de {fmtMoney(data.inicio.patrimonioCents)} a{' '}
                {fmtMoney(data.invertir.patrimonioFinalCents)} en {plazo(horizonte)}, de los cuales{' '}
                {fmtMoney(data.invertir.aportadoCents)} los pusiste tú.
              </p>
            ) : (
              <p className="ajustes-texto">
                Con estos supuestos, {diferencia > 0 ? 'pagar primero la deuda' : 'invertirlo todo'}{' '}
                termina <strong className="cifra-chica">{fmtMoney(Math.abs(diferencia))}</strong>{' '}
                más arriba en {plazo(horizonte)}. La razón es aritmética y no opinión: quitarte una
                deuda te ahorra su tasa con certeza, mientras que invertir gana la tasa que tú
                supusiste. Cambia el {fmtTasa(rendimientoAnualBp)} de arriba y verás en qué punto
                se voltea la respuesta.
              </p>
            )}
            <p className="reportes-supuesto">
              Supuestos, todos: tu saldo líquido de hoy no se mueve mientras aportas — lo que se
              proyecta es solo lo que apartas—, y en la etapa de retiro solo se toca cuando lo
              invertido ya no alcanza. Las inversiones rinden la tasa que escribiste, convertida a
              mensual de forma efectiva, así que doce meses dan exactamente esa tasa. Las deudas
              devengan la suya y se siguen pagando con la cuota de su plan, que sale de tu gasto
              corriente y no de lo que apartas — esa cuota va contada como dinero tuyo que entra,
              porque lo es—; una deuda sin plazo se queda quieta porque no hay cuota que suponerle.
              La inflación no cambia ninguna cifra nominal: se lleva aparte, como una segunda
              lectura en pesos de hoy. No hay impuestos ni comisiones. Nada de esto es un
              pronóstico ni un consejo de inversión.
            </p>
          </section>
        </>
      )}
    </div>
  )
}
