import { useEffect, useRef, type ReactNode } from 'react'

const FOCUSABLE =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Al cerrar, el foco regresa a donde estaba (el botón que abrió el modal).
    const previous = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      // El tabulador circula dentro del modal, nunca detrás del velo.
      if (e.key === 'Tab' && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)
        if (focusables.length === 0) return
        const first = focusables[0]!
        const last = focusables[focusables.length - 1]!
        const current = document.activeElement
        if (e.shiftKey && (current === first || !dialogRef.current.contains(current))) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && (current === last || !dialogRef.current.contains(current))) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      previous?.focus?.()
    }
  }, [onClose])

  return (
    <div
      className="velo"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="pliego" role="dialog" aria-modal="true" aria-label={title} ref={dialogRef}>
        <header className="pliego-head">
          <h2>{title}</h2>
          <button type="button" className="cerrar" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </header>
        {children}
      </div>
    </div>
  )
}
