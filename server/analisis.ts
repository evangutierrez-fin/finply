// Panel de análisis: cuatro números sobre los últimos meses cerrados.
//
// Todo aquí es de solo lectura y **reusa** lo que ya calculan los reportes: la
// regla de D6 (`MONTO_OPERATIVO`), la tasa de ahorro y el gasto por categoría
// salen del mismo código, no de una segunda versión. Es el mismo argumento por
// el que el patrimonio de la Fase 4 usa la fórmula del Resumen: dos
// aritméticas que deben coincidir son dos aritméticas que se separan, y el
// usuario acaba viendo dos verdades de lo mismo.
//
// Los supuestos —que hay tres— van escritos en la vista (R9):
//
//   1. Se miran **meses cerrados**. El mes en curso va a medias y arrastraría
//      cualquier promedio hacia abajo.
//   2. Gasto recurrente es el que **nació de una recurrencia** (D11), por la
//      liga que dejó la Fase 5. Lo que se registró a mano cae en discrecional
//      aunque se repita cada mes.
//   3. Colchón es el saldo **líquido** —efectivo, banco y ahorro— entre el
//      gasto operativo promedio del periodo. Una tarjeta no es colchón: es
//      crédito de alguien más.

import { db, saldoAFecha } from './db.ts'
import {
  CATEGORIA_OPERATIVA,
  DESDE_MOVIMIENTOS,
  DESDE_MOVIMIENTOS_SIN_REPARTO,
  MONTO_DEL_MOVIMIENTO,
  MONTO_OPERATIVO,
  TIPO_OPERATIVO,
  CON_CATEGORIA,
  gastoPorCategoriaAgrupado,
  ingresoGastoPorMes,
  ingresoPorCategoriaAgrupado,
  tasaDeAhorro,
} from './reportes.ts'
import { correrMesTexto, hoyISO, mesesEntreTexto } from '../shared/fechas.ts'
import { mediana, tendencia } from '../shared/estadistica.ts'
import type { Analisis } from '../shared/types.ts'

/**
 * Cuentas cuyo saldo se puede gastar mañana. La tarjeta no es una de ellas.
 *
 * Se exporta porque el flujo proyectado necesita el mismo juego: dos listas de
 * "qué es líquido" son dos cajas distintas el día que alguien agregue un tipo
 * de cuenta.
 */
export const TIPOS_LIQUIDOS = new Set(['efectivo', 'banco', 'ahorro'])

/**
 * Por debajo de esto una compra es "hormiga". $200 no es una verdad
 * universal: es un punto de partida que el usuario puede mover desde la vista,
 * y la cifra elegida va escrita junto al resultado.
 */
export const UMBRAL_HORMIGA_CENTS = 20_000

/**
 * Gasto operativo partido por origen: el que nació de una recurrencia contra
 * todo lo demás. La liga es `recurrence_runs.tx_id`, así que un LEFT JOIN
 * basta y las dos mitades suman exactamente el gasto del periodo — hay prueba
 * de esa igualdad, que es lo que impide que la gráfica mienta.
 */
function gastoPorOrigen(profileId: number, desde: string, hasta: string) {
  const fila: any = db
    .prepare(
      `SELECT
        COALESCE(SUM(CASE WHEN rr.tx_id IS NOT NULL THEN ${MONTO_OPERATIVO} END), 0) AS recurrente,
        COALESCE(SUM(CASE WHEN rr.tx_id IS NULL THEN ${MONTO_OPERATIVO} END), 0) AS discrecional
       ${DESDE_MOVIMIENTOS}
       LEFT JOIN recurrence_runs rr ON rr.tx_id = t.id
       WHERE t.profile_id = ? AND ${TIPO_OPERATIVO} = 'gasto'
         AND substr(t.date, 1, 7) BETWEEN ? AND ?`,
    )
    .get(profileId, desde, hasta)
  return { recurrente: fila.recurrente as number, discrecional: fila.discrecional as number }
}

/**
 * Saldo que se puede gastar mañana. Se exporta porque el simulador y el flujo
 * proyectado parten de la misma cifra: dos definiciones de "líquido" son dos
 * patrimonios de hoy.
 *
 * Va **a fecha**, y por omisión a hoy. El saldo de una cuenta suma todos sus
 * movimientos sin mirar la fecha —así se ve en Cuentas, y ahí está bien: es lo
 * que el banco va a decir—, pero lo que tienes hoy no incluye el cheque que
 * firmaste para el viernes. Sin este corte, el flujo arrancaría con dinero ya
 * comprometido y nunca enseñaría el día en que se va. En un libro sin partidas
 * futuras las dos cifras son idénticas.
 */
export function liquidoDe(profileId: number, hasta = hoyISO()): number {
  // El fragmento `saldoAFecha` mete la fecha **dos veces** (una por cada
  // subconsulta), así que van dos veces antes del perfil. Es la misma
  // aritmética que la vista de Cuentas: si se separaran, el flujo arrancaría
  // de un saldo que el usuario no ve en ningún lado.
  const fila: any = db
    .prepare(
      `SELECT COALESCE(SUM(${saldoAFecha('a', '?')}), 0) AS total
       FROM accounts a
       WHERE a.profile_id = ? AND a.archived = 0
         AND a.type IN (${[...TIPOS_LIQUIDOS].map(() => '?').join(', ')})`,
    )
    .get(hasta, hasta, profileId, ...TIPOS_LIQUIDOS)
  return fila.total as number
}

/** El mes del primer movimiento del libro. `null` si el libro está en blanco. */
function primerMes(profileId: number): string | null {
  const fila: any = db
    .prepare('SELECT MIN(substr(date, 1, 7)) AS mes FROM transactions WHERE profile_id = ?')
    .get(profileId)
  return fila?.mes ?? null
}

/**
 * El mismo mes del calendario, año contra año.
 *
 * Diciembre siempre cuesta más, y hasta hoy Finply no tenía forma de saberlo:
 * comparar diciembre con noviembre solo dice que diciembre subió, no si subió
 * lo de siempre. Se mira **todo** el libro, no la ventana de meses cerrados —
 * la gracia está justo en los años viejos— y solo entran meses completos, así
 * que el mes en curso nunca aparece a medias contra uno entero.
 */
function estacionalidad(profileId: number, mesCerrado: string) {
  const mesDelAnio = mesCerrado.slice(5, 7)
  const filas: any[] = db
    .prepare(
      `SELECT substr(t.date, 1, 4) AS anio, SUM(${MONTO_OPERATIVO}) AS gasto
       ${DESDE_MOVIMIENTOS}
       WHERE t.profile_id = ? AND ${TIPO_OPERATIVO} = 'gasto'
         AND substr(t.date, 6, 2) = ? AND substr(t.date, 1, 7) <= ?
       GROUP BY anio
       ORDER BY anio ASC`,
    )
    .all(profileId, mesDelAnio, mesCerrado)
  return filas.map((f) => ({ anio: f.anio as string, expenseCents: f.gasto as number }))
}

/**
 * Cuántos meses anteriores con gasto propio hacen falta para que una categoría
 * pueda decirse "disparada". Comparar contra un solo mes no es comparar contra
 * un promedio: es comparar contra una anécdota.
 */
const MESES_PARA_PROMEDIO = 3

/**
 * Cuánto tiene que pasarse de su propio promedio, y cuánto en pesos. Los dos
 * son **estrictos**: quedarse justo en el umbral no es pasarse, igual que
 * gastar exactamente el tope no es excederlo. Hay prueba de los dos lados.
 */
const SALTO_MINIMO = 0.4
const DIFERENCIA_MINIMA_CENTS = 50_000

/**
 * Categorías que se salieron de su propio promedio en el último mes cerrado.
 *
 * Los dos umbrales son necesarios y ninguno basta solo: sin el relativo, la
 * lista sería siempre las categorías grandes; sin el absoluto, un café de más
 * duplicaría una categoría de $80 y saldría gritando. Los dos van escritos en
 * la vista, porque un umbral escondido convierte un dato en una opinión (R9).
 *
 * El promedio se hace sobre los meses en que **hubo** gasto de esa categoría,
 * no sobre todos los del periodo: una categoría que aparece dos veces al año no
 * está disparada en marzo, es irregular, y llamarle anomalía sería ruido.
 */
function disparadas(profileId: number, desde: string, hasta: string) {
  const filas: any[] = db
    .prepare(
      // Por la categoría **raíz** (D25): si "Comida" se parte en cinco hijas,
      // un mes en que las cinco suben un poco no dispara ninguna y sí dispara a
      // Comida, que es lo que el usuario nota en su cuenta.
      `SELECT COALESCE(cp.name, c.name, 'Sin categoría') AS name, substr(t.date, 1, 7) AS mes,
        SUM(${MONTO_OPERATIVO}) AS gasto
       ${DESDE_MOVIMIENTOS}
       ${CON_CATEGORIA}
       WHERE t.profile_id = ? AND ${TIPO_OPERATIVO} = 'gasto'
         AND substr(t.date, 1, 7) BETWEEN ? AND ?
       GROUP BY 1, 2
       HAVING gasto > 0`,
    )
    .all(profileId, desde, hasta)

  const porCategoria = new Map<string, { mes: string; gasto: number }[]>()
  for (const f of filas) {
    if (!porCategoria.has(f.name)) porCategoria.set(f.name, [])
    porCategoria.get(f.name)!.push({ mes: f.mes, gasto: f.gasto })
  }

  const lista = []
  for (const [name, meses] of porCategoria) {
    const ultimo = meses.find((m) => m.mes === hasta)
    if (!ultimo) continue
    const previos = meses.filter((m) => m.mes !== hasta)
    if (previos.length < MESES_PARA_PROMEDIO) continue

    const promedio = previos.reduce((s, m) => s + m.gasto, 0) / previos.length
    const diferencia = ultimo.gasto - promedio
    if (diferencia <= DIFERENCIA_MINIMA_CENTS) continue
    if (promedio <= 0 || diferencia / promedio <= SALTO_MINIMO) continue

    lista.push({
      name,
      expenseCents: ultimo.gasto,
      promedioCents: Math.round(promedio),
      deltaCents: Math.round(diferencia),
      salto: diferencia / promedio,
      mesesPromediados: previos.length,
    })
  }
  return lista.sort((a, b) => b.deltaCents - a.deltaCents)
}

/**
 * Gasto hormiga: cuánto suman las partidas chicas.
 *
 * ⚠ Se mide por **movimiento**, no por renglón del reparto. Un ticket de $900
 * partido en tres no son tres compras de $300 — al revés: el reparto existe
 * justamente porque fue una sola compra. Por eso usa `MONTO_DEL_MOVIMIENTO` y
 * no toca `tx_splits`.
 *
 * Las devoluciones quedan fuera solas: su monto operativo es negativo, y el
 * filtro pide que sea mayor que cero.
 */
function hormiga(profileId: number, desde: string, hasta: string, umbralCents: number) {
  const fila: any = db
    .prepare(
      `SELECT COUNT(*) AS partidas, COALESCE(SUM(monto), 0) AS suma FROM (
        SELECT ${MONTO_DEL_MOVIMIENTO} AS monto
        ${DESDE_MOVIMIENTOS_SIN_REPARTO}
        WHERE t.profile_id = ? AND t.type = 'gasto'
          AND substr(t.date, 1, 7) BETWEEN ? AND ?
      ) WHERE monto > 0 AND monto <= ?`,
    )
    .get(profileId, desde, hasta, umbralCents)
  return { partidas: fila.partidas as number, sumaCents: fila.suma as number }
}

/**
 * El panel completo. `meses` es cuántos meses cerrados se piden; los que de
 * verdad entran pueden ser menos, porque un libro de dos meses no tiene seis.
 * Dividir entre seis lo que se gastó en dos inventaría un colchón que no
 * existe, así que el divisor es siempre el número de meses reales.
 */
export function analisis(
  profileId: number,
  meses = 6,
  hoy = hoyISO(),
  umbralHormigaCents = UMBRAL_HORMIGA_CENTS,
): Analisis {
  const hasta = correrMesTexto(hoy.slice(0, 7), -1)
  const pedido = correrMesTexto(hasta, -(meses - 1))
  const primero = primerMes(profileId)

  const liquidoCents = liquidoDe(profileId)

  // Un libro sin movimientos, o que solo tiene el mes en curso, no da un solo
  // mes cerrado que medir. Se dice que no se puede decir, en vez de inventar
  // ceros que parecerían datos.
  if (primero === null || primero > hasta) {
    return {
      desde: hasta,
      hasta,
      meses: 0,
      incomeCents: 0,
      expenseCents: 0,
      tasaAhorro: null,
      recurrenteCents: 0,
      discrecionalCents: 0,
      gastoPromedioCents: null,
      liquidoCents,
      mesesColchon: null,
      concentracion: [],
      fuentes: [],
      serie: [],
      tendenciaGasto: null,
      tendenciaIngreso: null,
      medianaGastoCents: null,
      medianaIngresoCents: null,
      estacionalidad: [],
      disparadas: [],
      hormiga: { partidas: 0, sumaCents: 0, umbralCents: umbralHormigaCents, parte: 0 },
    }
  }

  const desde = primero > pedido ? primero : pedido
  const cerrados = mesesEntreTexto(desde, hasta)

  const porMes = ingresoGastoPorMes(profileId, desde, hasta)
  let incomeCents = 0
  let expenseCents = 0
  for (const { ingreso, gasto } of porMes.values()) {
    incomeCents += ingreso
    expenseCents += gasto
  }

  const { recurrente, discrecional } = gastoPorOrigen(profileId, desde, hasta)
  // Plegadas al padre (D25): la concentración pregunta "¿en qué se me va el
  // dinero?", y partir "Comida" en cinco hijas es la manera más segura de que
  // ninguna se vea concentrada.
  const categorias = gastoPorCategoriaAgrupado(profileId, desde, hasta)
  const totalCategorias = categorias.reduce((s, c) => s + c.cents, 0)
  const gastoPromedioCents = Math.round(expenseCents / cerrados)

  // La serie mes a mes, con los huecos en cero: un mes sin movimiento existió
  // igual, y saltárselo movería la recta como si el tiempo no hubiera pasado.
  const serie = []
  for (let m = desde; m <= hasta; m = correrMesTexto(m, 1)) {
    const { ingreso, gasto } = porMes.get(m) ?? { ingreso: 0, gasto: 0 }
    serie.push({ month: m, incomeCents: ingreso, expenseCents: gasto })
  }

  const fuentes = ingresoPorCategoriaAgrupado(profileId, desde, hasta)
  const totalFuentes = fuentes.reduce((s, f) => s + f.cents, 0)

  const chica = hormiga(profileId, desde, hasta, umbralHormigaCents)

  return {
    desde,
    hasta,
    meses: cerrados,
    incomeCents,
    expenseCents,
    tasaAhorro: tasaDeAhorro(incomeCents, expenseCents),
    recurrenteCents: recurrente,
    discrecionalCents: discrecional,
    gastoPromedioCents,
    liquidoCents,
    // Dividir entre cero no da infinito, da "no se puede decir" — el mismo
    // trato que recibe la tasa de ahorro sin ingresos.
    mesesColchon: gastoPromedioCents > 0 ? liquidoCents / gastoPromedioCents : null,
    concentracion: categorias.map((c) => ({
      name: c.name,
      expenseCents: c.cents,
      parte: totalCategorias > 0 ? c.cents / totalCategorias : 0,
    })),
    fuentes: fuentes.map((f) => ({
      name: f.name,
      incomeCents: f.cents,
      parte: totalFuentes > 0 ? f.cents / totalFuentes : 0,
    })),
    serie,
    tendenciaGasto: tendencia(serie.map((m) => m.expenseCents)),
    tendenciaIngreso: tendencia(serie.map((m) => m.incomeCents)),
    // La mediana acompaña al promedio, nunca lo sustituye: si cambiaste el
    // refri en marzo, el promedio sube y la mediana no, y la diferencia entre
    // las dos **es** el dato.
    medianaGastoCents: mediana(serie.map((m) => m.expenseCents)),
    medianaIngresoCents: mediana(serie.map((m) => m.incomeCents)),
    estacionalidad: estacionalidad(profileId, hasta),
    disparadas: disparadas(profileId, desde, hasta),
    hormiga: {
      ...chica,
      umbralCents: umbralHormigaCents,
      parte: expenseCents > 0 ? chica.sumaCents / expenseCents : 0,
    },
  }
}
