import { useState } from 'react'
import { api } from '../api.ts'
import { useApp } from '../context.ts'
import { useFetch } from '../hooks.ts'
import { fmtDate, fmtMoney, todayISO } from '../format.ts'
import { diasEntre } from '../../shared/fechas.ts'
import type { EventoCalendario, TipoEvento } from '../../shared/types.ts'

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

function Dia({ fecha, eventos, hoy }: { fecha: string; eventos: EventoCalendario[]; hoy: string }) {
  return (
    <li className="cal-dia">
      <div className="cal-dia-fecha">
        <span className="cal-dia-num">{fmtDate(fecha)}</span>
        <span className="cal-dia-cuando">{cuando(fecha, hoy)}</span>
      </div>
      <ul className="cal-eventos">
        {eventos.map((e, i) => (
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
          </li>
        ))}
      </ul>
    </li>
  )
}

export function Calendario() {
  const { profile, refreshKey } = useApp()
  const [dias, setDias] = useState(30)
  const { data, error } = useFetch(
    () => api.calendario(profile.id, dias),
    [profile.id, refreshKey, dias],
  )

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
                cargo: nada de esto entra al libro hasta que tú lo asientes.
              </p>
            </section>

            <ul className="cal-lista">
              {[...porDia.entries()].map(([fecha, eventos]) => (
                <Dia key={fecha} fecha={fecha} eventos={eventos} hoy={hoy} />
              ))}
            </ul>
          </>
        )
      )}
    </div>
  )
}
