import { createContext, useContext } from 'react'
import type { Profile, Tx } from '../shared/types.ts'

export interface AppState {
  profile: Profile
  refreshKey: number
  /** Invalida los datos de todas las vistas tras una mutación. */
  bump: () => void
  /** Muestra el sello de tinta (p. ej. "REGISTRADO"). */
  stamp: (text: string) => void
  /** Abre el formulario de movimiento; con `tx` entra en modo edición. */
  openTx: (tx?: Tx) => void
  /**
   * Abre la ficha del perfil abierto. Los módulos se editan ahí y no en dos
   * lados: Ajustes y la sección apagada son dos puertas al mismo formulario,
   * para que no puedan decir cosas distintas.
   */
  editProfile: () => void
}

export const AppCtx = createContext<AppState | null>(null)

export function useApp(): AppState {
  const ctx = useContext(AppCtx)
  if (!ctx) throw new Error('AppCtx sin proveedor')
  return ctx
}
