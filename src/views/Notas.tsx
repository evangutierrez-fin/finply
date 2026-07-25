import { useState } from 'react'
import { api } from '../api.ts'
import { useApp } from '../context.ts'
import { useFetch } from '../hooks.ts'
import { fmtDate } from '../format.ts'
import { Modal } from '../components/Modal.tsx'
import type { Note } from '../../shared/types.ts'

function NoteModal({
  note,
  onClose,
  onSaved,
}: {
  note: Note | null
  onClose: () => void
  onSaved: () => void
}) {
  const { profile, stamp, bump } = useApp()
  const [title, setTitle] = useState(note?.title ?? '')
  const [body, setBody] = useState(note?.body ?? '')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() && !body.trim()) return setError('La nota está vacía')
    setSaving(true)
    setError(null)
    try {
      if (note) {
        await api.notes.update(note.id, { title: title.trim(), body })
      } else {
        await api.notes.create({ profileId: profile.id, title: title.trim(), body })
      }
      stamp('Guardada')
      onSaved()
      onClose()
    } catch (err) {
      setError((err as Error).message)
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!note) return
    setSaving(true)
    try {
      await api.notes.remove(note.id)
      stamp('Borrada')
      bump()
      onClose()
    } catch (err) {
      setError((err as Error).message)
      setSaving(false)
    }
  }

  return (
    <Modal title={note ? 'Editar nota' : 'Nueva nota'} onClose={onClose}>
      <form className="forma" onSubmit={submit}>
        <label className="campo">
          <span className="campo-label">Título</span>
          <input
            className="campo-input"
            placeholder="Ej. Pendientes de julio"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus={!note}
          />
        </label>
        <label className="campo">
          <span className="campo-label">Apunte</span>
          <textarea
            className="campo-input nota-textarea"
            rows={9}
            placeholder="Escribe aquí, renglón por renglón…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </label>
        {error && <p className="forma-error" role="alert">{error}</p>}
        <footer className="forma-pie forma-pie-doble">
          {note ? (
            confirmDelete ? (
              <span className="confirmar">
                ¿Borrar la nota?
                <button type="button" className="btn-liga btn-liga-rojo" onClick={remove}>Sí, borrar</button>
                <button type="button" className="btn-liga" onClick={() => setConfirmDelete(false)}>No</button>
              </span>
            ) : (
              <button type="button" className="btn-liga btn-liga-rojo" onClick={() => setConfirmDelete(true)}>
                Borrar
              </button>
            )
          ) : (
            <span />
          )}
          <span className="forma-pie-der">
            <button type="button" className="btn btn-fantasma" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primario" disabled={saving}>
              {saving ? 'Guardando…' : 'Guardar nota'}
            </button>
          </span>
        </footer>
      </form>
    </Modal>
  )
}

export function Notas() {
  const { profile, refreshKey, bump, stamp } = useApp()
  const [modal, setModal] = useState<{ open: boolean; note: Note | null }>({ open: false, note: null })
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

  return (
    <div className="vista">
      <header className="vista-head">
        <h1>Notas</h1>
        <button type="button" className="btn btn-primario" onClick={() => setModal({ open: true, note: null })}>
          ＋ Nueva nota
        </button>
      </header>

      {error && <p className="aviso" role="alert">{error}</p>}

      {notes && notes.length === 0 ? (
        <div className="vacio">
          <p className="vacio-titulo">El margen está limpio.</p>
          <p className="vacio-sub">
            Apunta pendientes, acuerdos, reglas propias — todo lo que no es un número
            pero pertenece a tu libro.
          </p>
          <button type="button" className="btn btn-primario" onClick={() => setModal({ open: true, note: null })}>
            Escribir la primera
          </button>
        </div>
      ) : (
        <section className="notas-tablero">
          {(notes ?? []).map((n, i) => (
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
        <NoteModal note={modal.note} onClose={() => setModal({ open: false, note: null })} onSaved={bump} />
      )}
    </div>
  )
}
