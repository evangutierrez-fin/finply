// Plegar un desglose por categoría a su padre (Fase 23).
//
// Módulo PURO a propósito (R16): lo usan el servidor para armar los reportes y
// el cliente para dibujar el desglose sin volver a pedir nada.
//
// Aquí vive la mitad barata de D25. La consulta agrupa por la categoría de
// siempre —**una fila por hoja**, el mismo `GROUP BY` de antes— y el plegado al
// padre ocurre acá arriba. Así se tienen los dos niveles sin una sola consulta
// de más y sin CTE recursiva, que era justo la condición con la que se eligió
// la jerarquía de un nivel.
//
// La alternativa era agrupar por `COALESCE(parent_id, id)` en SQL, que da el
// padre y **pierde el hijo**: el desglose exigiría una segunda consulta. Esta
// forma no cuesta nada y devuelve las dos cosas.

/**
 * Cómo se escribe una categoría en un selector: "Comida · Restaurante".
 *
 * El separador no es casual: es el que los usuarios ya usaban para simular la
 * jerarquía con texto —"Comida · restaurante"— antes de que existiera. Que la
 * cosa real se lea igual que el apaño evita tener que reaprender nada.
 */
export function rotuloCategoria(c: { name: string; parentName?: string | null }): string {
  return c.parentName ? `${c.parentName} · ${c.name}` : c.name
}

export interface RenglonHoja {
  name: string
  /** El padre, si esta categoría cuelga de alguno. */
  padre: string | null
  cents: number
}

export interface RenglonAgrupado {
  name: string
  cents: number
  /** El desglose. Vacío cuando la categoría no tiene subcategorías. */
  hijos: { name: string; cents: number }[]
}

/**
 * Pliega las hojas en sus padres, conservando el desglose.
 *
 * Un padre que **no** aparece en las filas —nadie gastó directamente en
 * "Comida", solo en sus hijas— entra igual, con el total de sus hijas: si no,
 * el desglose no tendría de dónde colgar y el reporte perdería el dinero.
 *
 * El orden es por magnitud, como el de la consulta que lo alimenta, y se mide
 * en **valor absoluto**: una categoría con más devoluciones que gasto tiene
 * total negativo, y ordenarla al final la escondería justo cuando más llama la
 * atención.
 */
export function agruparPorPadre(filas: RenglonHoja[]): RenglonAgrupado[] {
  const grupos = new Map<string, RenglonAgrupado>()
  const dame = (name: string): RenglonAgrupado => {
    const actual = grupos.get(name)
    if (actual) return actual
    const nuevo: RenglonAgrupado = { name, cents: 0, hijos: [] }
    grupos.set(name, nuevo)
    return nuevo
  }

  for (const fila of filas) {
    if (fila.padre === null) {
      dame(fila.name).cents += fila.cents
    } else {
      const grupo = dame(fila.padre)
      grupo.cents += fila.cents
      grupo.hijos.push({ name: fila.name, cents: fila.cents })
    }
  }

  const lista = [...grupos.values()]
  for (const grupo of lista) grupo.hijos.sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents))
  lista.sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents) || a.name.localeCompare(b.name))
  return lista
}
