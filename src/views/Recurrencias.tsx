import { useRef, useState } from 'react'
import { api } from '../api.ts'
import { useApp } from '../context.ts'
import { useFetch } from '../hooks.ts'
import { fmtDateAnio, fmtMoney } from '../format.ts'
import { Money } from '../components/Money.tsx'
import { RecurrenciaModal } from '../components/RecurrenciaModal.tsx'
import { PropuestaModal } from '../components/PropuestaModal.tsx'
import type { Propuesta, Recurrencia } from '../../shared/types.ts'

function atrasoTexto(dias: number): string {
  if (dias <= 0) return 'de hoy'
  if (dias === 1) return 'de ayer'
  if (dias < 31) return `hace ${dias} días`
  const meses = Math.floor(dias / 30)
  return `hace ${meses} ${meses === 1 ? 'mes' : 'meses'}`
}

function FilaPropuesta({
  propuesta,
  onAsentar,
  onEditar,
  onDescartar,
  ocupada,
}: {
  propuesta: Propuesta
  onAsentar: () => void
  onEditar: () => void
  onDescartar: () => void
  ocupada: boolean
}) {
  return (
    <li className="hoja propuesta">
      <div className="propuesta-datos">
        <div className="propuesta-head">
          <span className="propuesta-concepto">{propuesta.note || 'Sin concepto'}</span>
          <span className={`chip${propuesta.atraso > 0 ? ' chip-ambar' : ''}`}>
            {fmtDateAnio(propuesta.fecha)} · {atrasoTexto(propuesta.atraso)}
          </span>
        </div>
        <p className="propuesta-meta">
          {propuesta.accountName}
          {propuesta.categoryName && ` · ${propuesta.categoryName}`}
          {/* Se dice a dónde va: el dinero sale de la cuenta y no se pierde,
              cambia de bolsillo. Es lo que el total de arriba cuenta aparte. */}
          {propuesta.investmentName && ` · aporte a ${propuesta.investmentName}`}
          {propuesta.tags.length > 0 && ` · ${propuesta.tags.map((t) => t.name).join(' · ')}`}
        </p>
      </div>
      <Money
        cents={propuesta.type === 'gasto' ? -propuesta.amountCents : propuesta.amountCents}
        className="propuesta-monto"
      />
      <div className="propuesta-acciones">
        <button
          type="button"
          className="btn btn-primario btn-chico"
          onClick={onAsentar}
          disabled={ocupada}
        >
          Asentar
        </button>
        <button type="button" className="btn-liga" onClick={onEditar} disabled={ocupada}>
          Ajustar…
        </button>
        <button type="button" className="btn-liga propuesta-descartar" onClick={onDescartar} disabled={ocupada}>
          Descartar
        </button>
      </div>
    </li>
  )
}

function FilaPlantilla({
  rec,
  onEditar,
  onBorrar,
}: {
  rec: Recurrencia
  onEditar: () => void
  onBorrar: () => void
}) {
  return (
    <li className={`hoja plantilla${rec.archived ? ' plantilla-archivada' : ''}`}>
      <div className="plantilla-head">
        <span className="plantilla-concepto">{rec.note || 'Sin concepto'}</span>
        <Money
          cents={rec.type === 'gasto' ? -rec.amountCents : rec.amountCents}
          className="cifra-chica"
        />
      </div>
      <p className="plantilla-meta">
        {rec.descripcion} · {rec.accountName}
        {rec.categoryName && ` · ${rec.categoryName}`}
        {rec.type === 'transferencia' && rec.transferAccountName && ` → ${rec.transferAccountName}`}
      </p>
      <p className="plantilla-meta">
        {rec.archived ? (
          'Archivada: ya no propone nada.'
        ) : (
          <>
            {rec.pendientes > 0 && (
              <strong className="plantilla-pendientes">
                {rec.pendientes} por confirmar ·{' '}
              </strong>
            )}
            {rec.proximaFecha ? `Sigue el ${fmtDateAnio(rec.proximaFecha)}` : 'Ya terminó'}
            {rec.endDate && ` · hasta el ${fmtDateAnio(rec.endDate)}`}
          </>
        )}
      </p>
      <div className="plantilla-acciones">
        <button type="button" className="btn-liga" onClick={onEditar}>
          Editar
        </button>
        <button type="button" className="btn-liga deuda-borrar" onClick={onBorrar}>
          Borrar
        </button>
      </div>
    </li>
  )
}

export function Recurrencias() {
  const { profile, refreshKey, bump, stamp } = useApp()
  const [editando, setEditando] = useState<Recurrencia | null | 'nueva'>(null)
  const [ajustando, setAjustando] = useState<Propuesta | null>(null)
  const [ocupada, setOcupada] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // El candado va en una referencia, no en el estado: dos clics seguidos
  // ocurren antes de que React vuelva a pintar, así que `ocupada` todavía
  // valdría null en el segundo. El UNIQUE de la base sigue siendo la red real
  // —para dos pestañas no hay guardia de cliente que valga—, pero un doble
  // clic no tiene por qué acabar en un mensaje de error.
  const enVuelo = useRef<string | null>(null)

  const { data: bandeja } = useFetch(
    () => api.recurrencias.pendientes(profile.id),
    [profile.id, refreshKey],
  )
  const { data: plantillas } = useFetch(
    () => api.recurrencias.list(profile.id),
    [profile.id, refreshKey],
  )

  const clave = (p: Propuesta) => `${p.recurrenceId}·${p.periodo}`

  const conBloqueo = async (p: Propuesta, fn: () => Promise<unknown>, sello: string) => {
    if (enVuelo.current) return
    enVuelo.current = clave(p)
    setOcupada(clave(p))
    setError(null)
    try {
      await fn()
      stamp(sello)
      bump()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      enVuelo.current = null
      setOcupada(null)
    }
  }

  const asentar = (p: Propuesta) =>
    conBloqueo(
      p,
      () => api.recurrencias.asentar(p.recurrenceId, profile.id, { periodo: p.periodo }),
      'Asentado',
    )

  const descartar = (p: Propuesta) => {
    if (!confirm(`¿Descartar la partida del ${p.fecha}? No se asienta nada y no vuelve a aparecer.`)) {
      return
    }
    return conBloqueo(
      p,
      () => api.recurrencias.descartar(p.recurrenceId, profile.id, p.periodo),
      'Descartada',
    )
  }

  const borrar = async (rec: Recurrencia) => {
    if (!confirm(`¿Borrar "${rec.note || 'esta recurrencia'}"? Lo que ya asentaste se queda en el libro.`)) {
      return
    }
    try {
      const res = await api.recurrencias.remove(rec.id, profile.id)
      stamp('Borrada')
      if (res.asentados > 0) {
        setError(
          `Se borró la recurrencia. Los ${res.asentados} movimientos que ya habías asentado siguen en el libro.`,
        )
      }
      bump()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const total = bandeja?.total ?? 0
  // Un aporte a una inversión sale de la cuenta pero **no es gasto** (D6):
  // sumarlo aquí daría un total que ni el Resumen ni los reportes confirman
  // nunca. Va contado aparte, con su nombre.
  const sumaPendiente = (bandeja?.items ?? []).reduce(
    (s, p) => s + (p.type === 'gasto' && !p.investmentId ? p.amountCents : 0),
    0,
  )
  const sumaAporte = (bandeja?.items ?? []).reduce(
    (s, p) => s + (p.investmentId ? p.amountCents : 0),
    0,
  )

  return (
    <div className="vista">
      <header className="vista-head">
        <h1>Recurrencias</h1>
        <button type="button" className="btn btn-primario" onClick={() => setEditando('nueva')}>
          ＋ Nueva recurrencia
        </button>
      </header>

      {error && <p className="aviso" role="alert">{error}</p>}

      {plantillas && plantillas.length === 0 ? (
        <div className="vacio">
          <p className="vacio-titulo">Nada se repite todavía.</p>
          <p className="vacio-sub">
            Apunta la renta, las suscripciones o la colegiatura y Finply te las va a{' '}
            <strong>proponer</strong> cuando toquen. Nunca las asienta solo: eso lo decides tú,
            partida por partida.
          </p>
          <button type="button" className="btn btn-primario" onClick={() => setEditando('nueva')}>
            Apuntar la primera
          </button>
        </div>
      ) : (
        <>
          <section className="rec-bandeja">
            <div className="hoja-head">
              <h2 className="hoja-titulo">Por confirmar</h2>
              {total > 0 && (
                <span className="rec-bandeja-total">
                  {total} {total === 1 ? 'partida' : 'partidas'}
                  {sumaPendiente > 0 && <> · {fmtMoney(sumaPendiente)} de gasto</>}
                  {sumaAporte > 0 && <> · {fmtMoney(sumaAporte)} a inversión</>}
                </span>
              )}
            </div>

            {bandeja && bandeja.items.length === 0 ? (
              <p className="rec-al-dia">
                Al día. No hay nada vencido esperando tu confirmación.
              </p>
            ) : (
              <>
                <ul className="rec-lista">
                  {(bandeja?.items ?? []).map((p) => (
                    <FilaPropuesta
                      key={clave(p)}
                      propuesta={p}
                      ocupada={ocupada === clave(p)}
                      onAsentar={() => void asentar(p)}
                      onEditar={() => setAjustando(p)}
                      onDescartar={() => void descartar(p)}
                    />
                  ))}
                </ul>
                {bandeja && bandeja.total > bandeja.items.length && (
                  <p className="rec-nota-pie">
                    Se muestran {bandeja.items.length} de {bandeja.total}. Confirma o descarta
                    estas y aparecerán las siguientes.
                  </p>
                )}
                {bandeja?.truncado && (
                  <p className="rec-nota-pie">
                    Alguna recurrencia acumuló más periodos de los que caben de una vez. Ponte al
                    día con estos y saldrán los que faltan.
                  </p>
                )}
              </>
            )}
          </section>

          <section className="rec-plantillas">
            <div className="hoja-head">
              <h2 className="hoja-titulo">Lo que se repite</h2>
            </div>
            <ul className="rec-lista">
              {(plantillas ?? []).map((rec) => (
                <FilaPlantilla
                  key={rec.id}
                  rec={rec}
                  onEditar={() => setEditando(rec)}
                  onBorrar={() => void borrar(rec)}
                />
              ))}
            </ul>
          </section>
        </>
      )}

      {editando !== null && (
        <RecurrenciaModal
          recurrencia={editando === 'nueva' ? null : editando}
          onClose={() => setEditando(null)}
          onSaved={bump}
        />
      )}

      {ajustando && (
        <PropuestaModal
          propuesta={ajustando}
          onClose={() => setAjustando(null)}
          onSaved={bump}
        />
      )}
    </div>
  )
}
