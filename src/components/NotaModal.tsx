import { useEffect, useState } from 'react'
import { api } from '../api.ts'
import { useApp } from '../context.ts'
import { fmtDate, fmtMoney, monthLabel } from '../format.ts'
import { Modal } from './Modal.tsx'
import type { Note, Tx } from '../../shared/types.ts'

/**
 * Escribir una nota. Vive en `components/` y no dentro de la vista de Notas
 * porque desde la Fase 20 se abre desde tres lados: la libreta, el renglón de
 * un movimiento y el Resumen del mes. Tenerlo en un solo lugar es lo que hace
 * que la nota del movimiento y la de la libreta sean la misma cosa.
 */
export function NotaModal({
  note,
  txId,
  period,
  onClose,
  onSaved,
}: {
  note: Note | null
  /** Nace atada a este movimiento (se abrió desde el libro). */
  txId?: number | null
  /** Nace atada a este mes, 'AAAA-MM' (se abrió desde el Resumen). */
  period?: string | null
  onClose: () => void
  onSaved: () => void
}) {
  const { profile, stamp, bump } = useApp()
  const [title, setTitle] = useState(note?.title ?? '')
  const [body, setBody] = useState(note?.body ?? '')
  // A qué se refiere. Al abrir desde un movimiento o desde un mes ya viene
  // elegido; desde la libreta se elige aquí.
  const [ata, setAta] = useState<'nada' | 'movimiento' | 'mes'>(() => {
    if (note) return note.txId ? 'movimiento' : note.period ? 'mes' : 'nada'
    if (txId) return 'movimiento'
    if (period) return 'mes'
    return 'nada'
  })
  const [movimientoId, setMovimientoId] = useState<number>(note?.txId ?? txId ?? 0)
  const [mes, setMes] = useState<string>(note?.period ?? period ?? '')
  const [recientes, setRecientes] = useState<Tx[]>([])
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Los movimientos a los que se puede atar. Solo se piden si hace falta
  // elegir: llegando desde el libro el movimiento ya está decidido.
  const eligiendoMovimiento = ata === 'movimiento' && !txId
  useEffect(() => {
    if (!eligiendoMovimiento) return
    api.tx.list({ profileId: profile.id, limit: 60 }).then(
      (page) => setRecientes(page.items),
      () => {
        // Que falle solo quita la lista; la nota se guarda igual.
      },
    )
  }, [profile.id, eligiendoMovimiento])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() && !body.trim()) return setError('La nota está vacía')
    if (ata === 'movimiento' && !movimientoId) return setError('Elige de qué movimiento hablas')
    if (ata === 'mes' && !mes) return setError('Elige de qué mes hablas')
    setSaving(true)
    setError(null)
    // Las dos ligas se mandan **siempre**, y la que no aplica va en `null`
    // explícito: es lo que suelta una liga vieja al cambiar de opinión. Sin
    // eso, pasar una nota de "de este movimiento" a "suelta" la dejaría atada.
    const liga = {
      txId: ata === 'movimiento' ? movimientoId : null,
      period: ata === 'mes' ? mes : null,
    }
    try {
      if (note) {
        await api.notes.update(note.id, { title: title.trim(), body, ...liga })
      } else {
        await api.notes.create({ profileId: profile.id, title: title.trim(), body, ...liga })
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
        {/* Llegando desde el libro, la nota ya sabe de qué habla y no se
            vuelve a preguntar: es justo lo que la Fase 20 viene a acortar. */}
        {txId && !note && (
          <p className="forma-nota">
            Esta nota queda pegada a ese movimiento. Anularlo no la borra: se pierde la liga y el
            apunte se queda en tu libreta.
          </p>
        )}

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

        {!txId && (
          <fieldset className="campo campo-fieldset">
            <legend className="campo-label">¿De qué habla?</legend>
            <div className="radios">
              <label className="radio">
                <input type="radio" checked={ata === 'nada'} onChange={() => setAta('nada')} />
                De nada en particular
              </label>
              <label className="radio">
                <input
                  type="radio"
                  checked={ata === 'movimiento'}
                  onChange={() => setAta('movimiento')}
                />
                De un movimiento
              </label>
              <label className="radio">
                <input type="radio" checked={ata === 'mes'} onChange={() => setAta('mes')} />
                De un mes
              </label>
            </div>
            {ata === 'movimiento' && (
              <select
                className="campo-input"
                value={movimientoId}
                onChange={(e) => setMovimientoId(Number(e.target.value))}
                aria-label="Movimiento del que habla la nota"
              >
                <option value={0}>Elige el movimiento…</option>
                {recientes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {fmtDate(t.date)} · {t.note || t.categoryName || 'Sin concepto'} ·{' '}
                    {fmtMoney(t.amountCents)}
                  </option>
                ))}
              </select>
            )}
            {ata === 'mes' && (
              <input
                type="month"
                className="campo-input"
                value={mes}
                onChange={(e) => setMes(e.target.value)}
                aria-label="Mes del que habla la nota"
              />
            )}
            <p className="campo-nota">
              {ata === 'movimiento'
                ? 'La nota aparece en el renglón de esa partida, en el libro.'
                : ata === 'mes'
                  ? `La nota aparece en el Resumen${mes ? ` de ${monthLabel(mes).toLowerCase()}` : ' de ese mes'}.`
                  : 'Se queda en la libreta, como siempre.'}
            </p>
          </fieldset>
        )}

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
