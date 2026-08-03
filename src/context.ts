import { createContext, useContext } from 'react'
import type { BorradorTx, Profile, Tx } from '../shared/types.ts'

export interface AppState {
  profile: Profile
  refreshKey: number
  /** Invalida los datos de todas las vistas tras una mutación. */
  bump: () => void
  /** Muestra el sello de tinta (p. ej. "REGISTRADO"). */
  stamp: (text: string) => void
  /**
   * Abre el formulario de movimiento. Con `tx` entra en modo edición; con
   * `borrador` abre uno nuevo **con campos puestos**, que es lo que permite
   * pagar la tarjeta desde su alerta o asentar una renta desde el calendario
   * sin volver a teclear lo que Finply ya sabe (Fase 20).
   *
   * Rellenar no es registrar (R4): el formulario se abre, el usuario confirma.
   */
  openTx: (tx?: Tx | null, borrador?: BorradorTx) => void
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
