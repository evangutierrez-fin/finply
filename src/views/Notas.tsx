import { useState } from 'react'
import { api } from '../api.ts'
import { useApp } from '../context.ts'
import { useFetch } from '../hooks.ts'
import { fmtDate, fmtMoney, monthLabel } from '../format.ts'
import { NotaModal } from '../components/NotaModal.tsx'
import type { Note } from '../../shared/types.ts'

/** Los filtros de la libreta: de qué habla cada apunte. */
const FILTROS = [
  { id: 'todas', label: 'Todas' },
  { id: 'movimiento', label: 'De un movimiento' },
  { id: 'mes', label: 'De un mes' },
  { id: 'suelta', label: 'Sueltas' },
] as const

type Filtro = (typeof FILTROS)[number]['id']

function cumple(n: Note, filtro: Filtro): boolean {
  if (filtro === 'todas') return true
  if (filtro === 'movimiento') return n.txId !== null
  if (filtro === 'mes') return n.period !== null
  return n.txId === null && n.period === null
}

/**
 * De qué habla la nota, escrito (Fase 20). Una liga que no se puede leer no
 * sirve de nada: "nota del movimiento #418" no le dice nada a nadie, así que
 * se nombra la partida como se nombra en el libro.
 */
function DeQueHabla({ nota, onVerMovimiento }: { nota: Note; onVerMovimiento: () => void }) {
  if (nota.tx) {
    return (
      <button type="button" className="btn-liga nota-ata" onClick={onVerMovimiento}>
        ⇢ {fmtDate(nota.tx.date)} · {nota.tx.note || 'Sin concepto'} ·{' '}
        {fmtMoney(nota.tx.amountCents)}
      </button>
    )
  }
  // Con `txId` y sin `tx`, el movimiento se anuló: la nota sobrevive porque la
  // llave es `ON DELETE SET NULL`, y decirlo es más honesto que callarlo.
  if (nota.txId) return <span className="nota-ata">⇢ su movimiento ya no está</span>
  if (nota.period) return <span className="nota-ata">⇢ {monthLabel(nota.period)}</span>
  return null
}

export function Notas() {
  const { profile, refreshKey, bump, stamp } = useApp()
  const [modal, setModal] = useState<{ open: boolean; note: Note | null }>({ open: false, note: null })
  const [filtro, setFiltro] = useState<Filtro>('todas')
  const { data: notes, error } = useFetch(() => api.notes.list(profile.id), [profile.id, refreshKey])

  const togglePin = async (note: Note) => {
    try {
      await api.notes.update(note.id, { pinned: !note.pinned })
      stamp(note.pinned ? 'Soltada' : 'Fijada')
      bump()
    } catch (err) {
      alert((err as Error).message)
    }
  }

  const lista = (notes ?? []).filter((n) => cumple(n, filtro))
  const atadas = (notes ?? []).filter((n) => n.txId !== null || n.period !== null).length

  return (
    <div className="vista">
      <header className="vista-head">
        <h1>Notas</h1>
        <button type="button" className="btn btn-primario" onClick={() => setModal({ open: true, note: null })}>
          ＋ Nueva nota
        </button>
      </header>

      {error && <p className="aviso" role="alert">{error}</p>}

      {notes && notes.length > 0 && atadas > 0 && (
        <div className="seg seg-chico" role="radiogroup" aria-label="Qué notas ver">
          {FILTROS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="radio"
              aria-checked={filtro === f.id}
              className={`seg-item${filtro === f.id ? ' activa' : ''}`}
              onClick={() => setFiltro(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {notes && lista.length === 0 ? (
        <div className="vacio">
          <p className="vacio-titulo">
            {filtro === 'todas' ? 'El margen está limpio.' : 'Ninguna nota de esas.'}
          </p>
          <p className="vacio-sub">
            Apunta pendientes, acuerdos, reglas propias — todo lo que no es un número
            pero pertenece a tu libro. Una nota puede quedarse aquí, explicar un movimiento
            o hablar de todo un mes.
          </p>
          {filtro === 'todas' && (
            <button type="button" className="btn btn-primario" onClick={() => setModal({ open: true, note: null })}>
              Escribir la primera
            </button>
          )}
        </div>
      ) : (
        <section className="notas-tablero">
          {lista.map((n, i) => (
            <article className="nota" key={n.id} style={{ animationDelay: `${Math.min(i * 40, 300)}ms` }}>
              <button
                type="button"
                className="nota-cuerpo"
                onClick={() => {
                  // Si el clic fue para seleccionar texto, no se abre el editor.
                  if (window.getSelection()?.toString()) return
                  setModal({ open: true, note: n })
                }}
                aria-label={`Editar nota: ${n.title || 'sin título'}`}
              >
                {n.title && <span className="nota-titulo">{n.title}</span>}
                <span className="nota-texto">{n.body}</span>
              </button>
              <DeQueHabla
                nota={n}
                onVerMovimiento={() => {
                  window.location.hash = '#/movimientos'
                }}
              />
              <footer className="nota-pie">
                <span className="nota-fecha">{fmtDate(n.updatedAt.slice(0, 10))}</span>
                <button
                  type="button"
                  className={`btn-liga nota-pin${n.pinned ? ' fijada' : ''}`}
                  onClick={() => togglePin(n)}
                >
                  {n.pinned ? '★ Fijada' : '☆ Fijar'}
                </button>
              </footer>
            </article>
          ))}
        </section>
      )}

      {modal.open && (
        <NotaModal note={modal.note} onClose={() => setModal({ open: false, note: null })} onSaved={bump} />
      )}
    </div>
  )
}
