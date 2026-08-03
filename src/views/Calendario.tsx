import { useState } from 'react'
import { api } from '../api.ts'
import { useApp } from '../context.ts'
import { useFetch } from '../hooks.ts'
import { fmtDate, fmtMoney, todayISO } from '../format.ts'
import { diasEntre } from '../../shared/fechas.ts'
import { PropuestaModal, type ParaAsentar } from '../components/PropuestaModal.tsx'
import type { BorradorTx, EventoCalendario, TipoEvento } from '../../shared/types.ts'

const ETIQUETA: Record<TipoEvento, string> = {
  recurrencia: 'Recurrente',
  pago_tarjeta: 'Pago de tarjeta',
  corte: 'Corte',
  deuda: 'Deuda',
  msi: 'A meses',
  factura: 'Factura',
  renta: 'Renta',
  // Aquí no aparece nunca: el calendario es lo que está **por confirmar**, y
  // un movimiento con fecha futura ya está asentado. Lo cuenta el flujo.
  movimiento: 'Ya asentado',
}

const VENTANAS = [
  { dias: 30, label: '30 días' },
  { dias: 60, label: '60 días' },
  { dias: 90, label: '90 días' },
]

function cuando(fecha: string, hoy: string): string {
  const dias = diasEntre(hoy, fecha)
  if (dias === 0) return 'hoy'
  if (dias === 1) return 'mañana'
  return `en ${dias} días`
}

/**
 * Cómo se llama la acción de cada renglón, o `null` si desde aquí no se puede
 * hacer nada.
 *
 * Los que faltan no son un olvido: un abono a deuda se parte en interés y
 * capital y una parcialidad a meses no se paga sola —se pagan pagando la
 * tarjeta—, así que cada uno tiene su propio formulario en su sección. Poner
 * aquí un botón que llevara a un cálculo a medias sería peor que no ponerlo.
 */
function accionDe(e: EventoCalendario): string | null {
  if (e.tipo === 'recurrencia' && e.refId && e.periodo) return 'Asentar'
  if (e.tipo === 'pago_tarjeta' && e.refId && e.montoCents !== null) return 'Pagarla'
  if (e.tipo === 'renta' && e.refId && e.montoCents !== null) return 'Cobrarla'
  return null
}

function Dia({
  fecha,
  eventos,
  hoy,
  onAccion,
}: {
  fecha: string
  eventos: EventoCalendario[]
  hoy: string
  onAccion: (e: EventoCalendario) => void
}) {
  return (
    <li className="cal-dia">
      <div className="cal-dia-fecha">
        <span className="cal-dia-num">{fmtDate(fecha)}</span>
        <span className="cal-dia-cuando">{cuando(fecha, hoy)}</span>
      </div>
      <ul className="cal-eventos">
        {eventos.map((e, i) => {
          const accion = accionDe(e)
          return (
            <li key={`${e.tipo}-${e.refId}-${i}`} className="hoja cal-evento">
              <div className="cal-evento-datos">
                <div className="cal-evento-head">
                  <span className={`chip cal-chip cal-chip-${e.tipo}`}>{ETIQUETA[e.tipo]}</span>
                  <span className="cal-evento-titulo">{e.titulo}</span>
                </div>
                <p className="cal-evento-detalle">{e.detalle}</p>
              </div>
              <span className="cal-evento-monto">
                {e.montoCents === null ? (
                  <span className="cal-sin-monto">por definir</span>
                ) : (
                  fmtMoney(e.montoCents)
                )}
              </span>
              {accion && (
                <button
                  type="button"
                  className="btn btn-fantasma btn-chico cal-evento-accion"
                  onClick={() => onAccion(e)}
                >
                  {accion}
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </li>
  )
}

export function Calendario() {
  const { profile, refreshKey, bump, openTx } = useApp()
  const [dias, setDias] = useState(30)
  const [asentando, setAsentando] = useState<ParaAsentar | null>(null)
  const { data, error } = useFetch(
    () => api.calendario(profile.id, dias),
    [profile.id, refreshKey, dias],
  )

  /**
   * Actuar desde donde aparece el dato (Fase 20). Hasta hoy, ver un
   * vencimiento aquí y registrarlo eran dos cosas separadas por tres clics y
   * un tecleo: el calendario decía "el 5 pagas $2,400 de la renta" y había que
   * ir a otra vista a escribir eso mismo a mano.
   *
   * Sigue sin asentar nada por su cuenta (R4): abre el formulario con lo que
   * Finply ya sabía, y guardar es del usuario.
   */
  const actuar = (e: EventoCalendario) => {
    if (e.tipo === 'recurrencia' && e.refId && e.periodo) {
      setAsentando({
        recurrenceId: e.refId,
        periodo: e.periodo,
        fecha: e.fecha,
        amountCents: e.montoCents ?? 0,
        // Es el concepto de la plantilla, que es justo lo que se ve arriba: el
        // usuario está confirmando el texto que tiene enfrente.
        note: e.titulo,
        descripcion: e.detalle,
      })
      return
    }
    const borrador: BorradorTx =
      e.tipo === 'pago_tarjeta'
        ? {
            // Pagar la tarjeta mueve dinero entre dos bolsillos tuyos: es una
            // transferencia, no un gasto (D6). De qué cuenta sale lo dice el
            // usuario, que es lo único que Finply no sabe.
            type: 'transferencia',
            transferAccountId: e.refId ?? undefined,
            amountCents: e.montoCents ?? undefined,
            date: e.fecha,
            note: e.titulo,
          }
        : {
            // La renta del mes: ingreso con su papel puesto, que es lo que la
            // hace contar en el rendimiento del inmueble (Fase 15).
            type: 'ingreso',
            amountCents: e.montoCents ?? undefined,
            date: e.fecha,
            note: e.titulo,
            rentalId: e.refId,
            rentalRole: 'renta',
          }
    openTx(null, borrador)
  }

  const hoy = data?.desde ?? todayISO()
  const porDia = new Map<string, EventoCalendario[]>()
  for (const e of data?.eventos ?? []) {
    porDia.set(e.fecha, [...(porDia.get(e.fecha) ?? []), e])
  }
  const totalConocido = (data?.eventos ?? []).reduce((s, e) => s + (e.montoCents ?? 0), 0)
  const porDefinir = (data?.eventos ?? []).filter((e) => e.montoCents === null).length

  return (
    <div className="vista">
      <header className="vista-head">
        <h1>Calendario</h1>
        <div className="seg seg-chico" role="radiogroup" aria-label="Ventana del calendario">
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

      {data && data.eventos.length === 0 ? (
        <div className="vacio">
          <p className="vacio-titulo">Nada vence en {dias} días.</p>
          <p className="vacio-sub">
            Aquí van a caer tus recurrencias, los cortes y pagos de tus tarjetas, las
            mensualidades de tus deudas y las parcialidades de tus compras a meses. Todo sale de
            lo que ya está en tu libro.
          </p>
        </div>
      ) : (
        data && (
          <>
            <section className="hoja cal-resumen">
              <div className="tarjetas-resumen-dato">
                <span className="rotulo">Compromisos en {dias} días</span>
                <span className="hero-cifra-media">{fmtMoney(totalConocido)}</span>
              </div>
              <p className="cal-resumen-nota">
                {data.eventos.length} {data.eventos.length === 1 ? 'vencimiento' : 'vencimientos'}{' '}
                hasta el {fmtDate(data.hasta)}
                {porDefinir > 0 && `, ${porDefinir} sin monto todavía`}. Es un recordatorio, no un
                cargo: nada de esto entra al libro hasta que tú lo asientes. Los que se pueden
                asentar desde aquí traen su botón, y abre el formulario con lo que ya sabemos —
                confirmarlo sigue siendo tuyo.
              </p>
            </section>

            <ul className="cal-lista">
              {[...porDia.entries()].map(([fecha, eventos]) => (
                <Dia key={fecha} fecha={fecha} eventos={eventos} hoy={hoy} onAccion={actuar} />
              ))}
            </ul>
          </>
        )
      )}

      {asentando && (
        <PropuestaModal
          propuesta={asentando}
          onClose={() => setAsentando(null)}
          onSaved={bump}
        />
      )}
    </div>
  )
}
