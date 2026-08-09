// Lo que pesa una lista de vencimientos. Módulo puro (R16).
//
// Existe por una cifra que no significaba nada. El Calendario anunciaba
// "Compromisos en 30 días: $56,300.01" sumando **todos** los eventos de la
// ventana sin mirar hacia dónde va cada uno, así que juntaba $52,800.01 que un
// cliente te va a pagar con $3,500.00 que tú vas a pagar. El Flujo, con la
// misma ventana y los mismos eventos, los enseñaba partidos —"va a entrar" y
// "va a salir"—, y tenía razón: nadie tiene un compromiso de cobrar.
//
// La aritmética vive aquí y no en el `.tsx` por lo de siempre: dos pantallas
// dicen esto y dentro de un componente no se puede probar.

/** Lo mínimo de un evento para pesarlo: cuánto y hacia dónde. */
export interface EventoPesable {
  montoCents: number | null
  direccion: 'entra' | 'sale'
}

export interface PesoDeEventos {
  /** Lo que va a entrar. */
  entraCents: number
  /** Lo que va a salir. Positivo: el signo lo pone quien lo escribe. */
  saleCents: number
  /** Cuántos todavía no tienen monto. No se suponen (R9). */
  sinMonto: number
}

export function pesoDeEventos(eventos: EventoPesable[]): PesoDeEventos {
  const peso: PesoDeEventos = { entraCents: 0, saleCents: 0, sinMonto: 0 }
  for (const e of eventos) {
    if (e.montoCents === null) {
      peso.sinMonto++
      continue
    }
    if (e.direccion === 'entra') peso.entraCents += e.montoCents
    else peso.saleCents += e.montoCents
  }
  return peso
}
