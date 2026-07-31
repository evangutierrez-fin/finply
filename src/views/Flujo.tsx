// Fase 16 · ¿Llego a fin de mes?
//
// La vista contesta una sola pregunta y todo lo demás está para respaldarla:
// el veredicto arriba, la curva en medio y **los renglones que la mueven**
// abajo, cada uno navegable a la sección de donde salió. Una proyección que no
// se puede seguir con el dedo no se le cree, y con razón: es la única cifra de
// Finply que habla del futuro.
//
// Nada de esto escribe una fila (R4). Y los supuestos van escritos, no en una
// nota al pie: lo que se cuenta, lo que todavía no tiene monto y lo que Finply
// no puede saber porque nadie lo ha apuntado (R9).

import { useState } from 'react'
import { api } from '../api.ts'
import { useApp } from '../context.ts'
import { useFetch } from '../hooks.ts'
import { fmtDate, fmtMoney, todayISO } from '../format.ts'
import { Money } from '../components/Money.tsx'
import { FlujoLinea } from '../components/Charts.tsx'
import type { View } from '../components/Sidebar.tsx'
import { diasEntre } from '../../shared/fechas.ts'
import type { EventoCalendario, TipoEvento } from '../../shared/types.ts'

const VENTANAS = [
  { dias: 30, label: '30 días' },
  { dias: 60, label: '60 días' },
  { dias: 90, label: '90 días' },
]

const ETIQUETA: Record<TipoEvento, string> = {
  recurrencia: 'Recurrente',
  pago_tarjeta: 'Pago de tarjeta',
  corte: 'Corte',
  deuda: 'Deuda',
  msi: 'A meses',
  factura: 'Factura',
  movimiento: 'Ya asentado',
}

/**
 * A dónde lleva el clic de cada renglón. El calendario ya calla los eventos de
 * un módulo apagado, así que ninguno de estos destinos puede estar fuera del
 * lomo — que es lo que la Fase 9 pedía de las alertas.
 */
const DESTINO: Record<TipoEvento, View> = {
  recurrencia: 'recurrencias',
  pago_tarjeta: 'tarjetas',
  corte: 'tarjetas',
  msi: 'tarjetas',
  deuda: 'deudas',
  factura: 'facturas',
  movimiento: 'movimientos',
}

function cuando(fecha: string, hoy: string): string {
  const dias = diasEntre(hoy, fecha)
  if (dias === 0) return 'hoy'
  if (dias === 1) return 'mañana'
  return `en ${dias} días`
}

export function Flujo({ onNav }: { onNav: (view: View) => void }) {
  const { profile, refreshKey, editProfile } = useApp()
  const [dias, setDias] = useState(30)
  const { data, error } = useFetch(
    () => api.flujo(profile.id, dias),
    [profile.id, refreshKey, dias],
  )

  const hoy = data?.desde ?? todayISO()
  const conRecurrencias = profile.modules.includes('recurrencias')

  const porDia = new Map<string, EventoCalendario[]>()
  for (const e of data?.eventos ?? []) {
    porDia.set(e.fecha, [...(porDia.get(e.fecha) ?? []), e])
  }
  const saldoDe = new Map((data?.puntos ?? []).map((p) => [p.fecha, p.saldoCents]))

  return (
    <div className="vista">
      <header className="vista-head">
        <h1>Flujo</h1>
        <div className="seg seg-chico" role="radiogroup" aria-label="Horizonte de la proyección">
          {VENTANAS.map((v) => (
            <button
              key={v.dias}
              type="button"
              role="radio"
              aria-checked={dias === v.dias}
              className={`seg-item${dias === v.dias ? ' activa' : ''}`}
              onClick={() => setDias(v.dias)}
            >
              {v.label}
            </button>
          ))}
        </div>
      </header>

      {error && <p className="aviso" role="alert">{error}</p>}
      {!data && !error && <div className="cargando" aria-label="Cargando" />}

      {data && (
        <>
          {/* El veredicto, con la cifra grande y la fecha con nombre. Si no hay
              día en rojo se dice **con todas sus letras**: callar se lee como
              que la pregunta no se contestó. */}
          <section className={`hoja flujo-veredicto${data.primerDiaEnRojo ? ' en-rojo' : ''}`}>
            <div className="flujo-veredicto-texto">
              {data.primerDiaEnRojo ? (
                <>
                  <span className="rotulo">Te quedas corto</span>
                  <p className="flujo-titular">
                    El <strong>{fmtDate(data.primerDiaEnRojo)}</strong>,{' '}
                    {cuando(data.primerDiaEnRojo, hoy)}.
                  </p>
                  <p className="flujo-sub">
                    El punto más bajo de la ventana es{' '}
                    <Money cents={data.minimo.saldoCents} className="cifra-chica" /> el{' '}
                    {fmtDate(data.minimo.fecha)}. Abajo está renglón por renglón de dónde sale, y
                    todavía se puede mover.
                  </p>
                </>
              ) : (
                <>
                  <span className="rotulo">Al {fmtDate(data.hasta)} te quedan</span>
                  <Money cents={data.saldoFinalCents} className="hero-cifra-media" />
                  <p className="flujo-sub">
                    No te quedas corto en estos {dias} días. Lo más bajo que llega la caja es{' '}
                    <Money cents={data.minimo.saldoCents} className="cifra-chica" />
                    {data.minimo.fecha !== hoy && <> el {fmtDate(data.minimo.fecha)}</>}.
                  </p>
                </>
              )}
            </div>
            <dl className="hero-stats flujo-stats">
              <div className="stat">
                <dt>Caja hoy</dt>
                <dd><Money cents={data.saldoInicialCents} /></dd>
              </div>
              <div className="stat">
                <dt>Va a entrar</dt>
                <dd><span className="stat-in"><Money cents={data.entradasCents} /></span></dd>
              </div>
              <div className="stat">
                <dt>Va a salir</dt>
                <dd><Money cents={-data.salidasCents} signed /></dd>
              </div>
              <div className="stat stat-neto">
                <dt>Caja en {dias} días</dt>
                <dd>
                  <span className={data.saldoFinalCents >= 0 ? '' : 'stat-rojo'}>
                    <Money cents={data.saldoFinalCents} />
                  </span>
                </dd>
              </div>
            </dl>
          </section>

          <section className="hoja">
            <h2 className="hoja-titulo">La caja, día a día</h2>
            <FlujoLinea puntos={data.puntos} primerDiaEnRojo={data.primerDiaEnRojo} />
          </section>

          <section className="hoja">
            <div className="hoja-head">
              <h2 className="hoja-titulo">Qué la mueve</h2>
              <span className="flujo-cuenta">
                {data.eventos.length}{' '}
                {data.eventos.length === 1 ? 'renglón' : 'renglones'}
                {data.sinMonto > 0 && ` · ${data.sinMonto} sin monto todavía`}
              </span>
            </div>

            {data.eventos.length === 0 ? (
              <p className="grafica-vacia">
                No hay nada comprometido en esta ventana: la caja se queda donde está.
              </p>
            ) : (
              <ul className="flujo-dias">
                {[...porDia.entries()].map(([fecha, eventos]) => (
                  <li key={fecha} className="flujo-dia">
                    <div className="flujo-dia-cabeza">
                      <span className="flujo-dia-fecha">{fmtDate(fecha)}</span>
                      <span className="flujo-dia-cuando">{cuando(fecha, hoy)}</span>
                      <span className="flujo-dia-saldo">
                        queda <Money cents={saldoDe.get(fecha) ?? 0} className="cifra-chica" />
                      </span>
                    </div>
                    <ul className="flujo-eventos">
                      {eventos.map((e, i) => (
                        <li key={`${e.tipo}-${e.refId}-${i}`}>
                          <button
                            type="button"
                            className="flujo-evento"
                            onClick={() => onNav(DESTINO[e.tipo])}
                          >
                            <span className={`chip cal-chip cal-chip-${e.tipo}`}>
                              {ETIQUETA[e.tipo]}
                            </span>
                            <span className="flujo-evento-textos">
                              <span className="flujo-evento-titulo">{e.titulo}</span>
                              <span className="flujo-evento-detalle">{e.detalle}</span>
                            </span>
                            <span
                              className={`cifra flujo-evento-monto${
                                e.direccion === 'entra' ? ' stat-in' : ''
                              }`}
                            >
                              {e.direccion === 'entra' ? '+' : '−'}
                              {fmtMoney(e.montoCents ?? 0)}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {!conRecurrencias && (
            <section className="hoja flujo-falta">
              <p>
                <strong>Recurrencias está apagado en este perfil</strong>, así que tu sueldo, tu
                renta y tus suscripciones no entran en esta proyección. Lo que ves de aquí a{' '}
                {fmtDate(data.hasta)} sale de tus tarjetas, tus deudas y lo que ya asentaste con
                fecha futura.
              </p>
              <button type="button" className="btn btn-fantasma btn-chico" onClick={editProfile}>
                Encender Recurrencias
              </button>
            </section>
          )}

          <p className="reportes-supuesto">
            La caja de hoy es lo líquido —efectivo, banco y ahorro—: la tarjeta no es caja, es
            crédito de alguien más. De ahí en adelante solo se cuenta lo que Finply ya sabe:
            recurrencias por confirmar, el pago para no generar intereses de tus tarjetas, la
            mensualidad de tus deudas con plazo, las parcialidades a meses, las facturas con fecha
            de pago y los movimientos que ya asentaste con fecha futura. No adivina el gasto de
            todos los días ni un ingreso que no hayas apuntado, así que la cifra del final es un
            piso, no un pronóstico. Lo que está <em>por confirmar</em> no entra al libro hasta que
            tú lo asientes; lo que ya asentaste con fecha futura sí está en él, y por eso va
            marcado.
          </p>
        </>
      )}
    </div>
  )
}
