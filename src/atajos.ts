import { useEffect, useRef } from 'react'
import { resolverAtajo, type AtajoId } from '../shared/atajos.ts'

/** Cuánto espera la `g` a su segunda tecla antes de olvidarse. */
const ESPERA_PREFIJO = 1500

function esCampoDeTexto(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || !el.tagName) return false
  const tag = el.tagName.toUpperCase()
  return (
    tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true
  )
}

/**
 * ¿Hay un modal encima? Se pregunta al DOM y no a un prop: cualquier vista
 * puede registrar atajos y ninguna sabe qué modales abrió otra. El velo se
 * marca con `aria-modal`, que es el mismo dato que ya usan los lectores de
 * pantalla — si algún día deja de estar, se rompe la accesibilidad primero y
 * eso sí se nota.
 */
function hayModal(): boolean {
  return document.querySelector('[aria-modal="true"]') !== null
}

/**
 * Registra atajos de teclado. Cada vista pone los suyos: `/` es de Movimientos
 * porque el buscador vive ahí, y `n` es de la app entera.
 *
 * Lo que decide si una tecla es un atajo vive en `shared/atajos.ts`, que es
 * puro y está probado. Aquí solo queda lo que necesita el DOM: dónde está el
 * foco, si hay un modal encima y la `g` que espera su segunda tecla.
 */
export function useAtajos(handlers: Partial<Record<AtajoId, () => void>>): void {
  // En un ref para que cambiar un manejador no vuelva a suscribir la ventana,
  // y para que el que se ejecute sea siempre el del render actual.
  const actuales = useRef(handlers)
  actuales.current = handlers

  useEffect(() => {
    let prefijo = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const olvidar = () => {
      prefijo = false
      if (timer) clearTimeout(timer)
      timer = null
    }

    const onKey = (e: KeyboardEvent) => {
      // Con un modal encima manda el modal: sus campos son los que importan y
      // su Escape ya lo cierra. Un atajo global que abriera otra cosa desde
      // ahí dejaría dos formularios apilados.
      if (hayModal()) return olvidar()
      const resultado = resolverAtajo({
        tecla: e.key,
        conModificador: e.ctrlKey || e.metaKey || e.altKey,
        enCampo: esCampoDeTexto(e.target),
        prefijoActivo: prefijo,
      })
      if (resultado?.tipo === 'prefijo') {
        prefijo = true
        if (timer) clearTimeout(timer)
        timer = setTimeout(olvidar, ESPERA_PREFIJO)
        return
      }
      olvidar()
      if (!resultado) return
      const handler = actuales.current[resultado.id]
      if (!handler) return
      // Solo se cancela el evento cuando de verdad hay quien lo atienda: si
      // nadie escucha `/`, la barra de búsqueda del navegador sigue siendo del
      // navegador.
      e.preventDefault()
      handler()
    }

    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      olvidar()
    }
  }, [])
}
