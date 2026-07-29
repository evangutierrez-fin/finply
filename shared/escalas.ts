// La aritmética de los ejes. Puro y probable: decidir dónde van las marcas y
// dónde se corta la escala es lo único de una gráfica que se puede equivocar
// en silencio, así que vive fuera del componente que la dibuja.

/**
 * El paso "bonito" más cercano para cubrir un rango con `deseados` marcas.
 *
 * Solo 1, 2, 2.5 y 5 por potencia de diez: son los saltos que alguien lee sin
 * pensar ($5,000 · $10,000 · $15,000). Un paso de $3,700 es igual de correcto
 * y obliga a hacer cuentas para saber cuánto mide una barra.
 */
export function pasoBonito(rango: number, deseados = 4): number {
  if (!(rango > 0) || !(deseados > 0)) return 1
  const crudo = rango / deseados
  const magnitud = 10 ** Math.floor(Math.log10(crudo))
  const normal = crudo / magnitud
  const multiplo = normal <= 1 ? 1 : normal <= 2 ? 2 : normal <= 2.5 ? 2.5 : normal <= 5 ? 5 : 10
  return multiplo * magnitud
}

/**
 * Las marcas del eje entre `min` y `max`, en pasos bonitos.
 *
 * El cero siempre entra si el rango lo cruza —es la única marca que significa
 * algo por sí sola— y por eso `min` se baja a cero cuando todo es positivo:
 * una gráfica de dinero que arranca en $40,000 exagera cualquier subida.
 */
export function ticksBonitos(min: number, max: number, deseados = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return []
  const desde = Math.min(0, min)
  const hasta = Math.max(0, max)
  if (hasta === desde) return [0]
  const paso = pasoBonito(hasta - desde, deseados)
  const primero = Math.ceil(desde / paso)
  const ultimo = Math.floor(hasta / paso)
  const marcas: number[] = []
  // Se multiplica por el índice en vez de ir sumando: acumular el paso arrastra
  // el error del flotante y la última marca acaba en 14,999.999999998.
  for (let i = primero; i <= ultimo; i++) marcas.push(Math.round(i * paso))
  return marcas
}

export interface Techo {
  /** Hasta dónde llega la escala. */
  techo: number
  /** Cuántos valores se salen de ella y se dibujan recortados. */
  recortados: number
}

/**
 * Hasta dónde llega la escala de una serie con un valor desproporcionado.
 *
 * El caso real: el día que cae la nómina mide treinta veces cualquier gasto, y
 * con una escala hasta el máximo los otros veintinueve días quedan en dos
 * píxeles — la gráfica es técnicamente correcta y no se puede leer.
 *
 * La regla es conservadora a propósito, porque recortar una escala también
 * puede mentir: se corta en el **percentil 90** y **solo si el máximo lo
 * supera más de diez veces**.
 *
 * El diez no es un número redondo elegido al azar: es el punto donde el grueso
 * de la serie baja del 10 % del alto de la gráfica, que es cuando de verdad
 * deja de leerse. Con un factor de 3 —lo primero que se probó— una renta de
 * $4,500 entre gastos de cientos ya se recortaba, y esa sí hay que verla: es
 * un gasto legítimo, no un atípico. Hay prueba de los dos casos.
 *
 * Lo recortado se marca en la barra y se dice con palabras: una escala cortada
 * en silencio es peor que una aplastada.
 */
export function techoDeEscala(valores: number[], factor = 10, percentil = 0.9): Techo {
  const orden = valores.filter((v) => v > 0).sort((a, b) => a - b)
  if (orden.length === 0) return { techo: 1, recortados: 0 }
  const max = orden[orden.length - 1]!
  // Con tres valores o menos no hay "el resto" que proteger: el atípico *es*
  // la serie, y recortarlo escondería justo lo que hay que ver.
  if (orden.length < 4) return { techo: max, recortados: 0 }
  const corte = orden[Math.max(0, Math.ceil(percentil * orden.length) - 1)]!
  if (corte <= 0 || max <= corte * factor) return { techo: max, recortados: 0 }
  return { techo: corte, recortados: orden.filter((v) => v > corte).length }
}
