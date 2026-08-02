// Inventario simple: qué tienes, cuánto vale y cuánto costó lo que vendiste.
//
// Lo que hay que entender antes de tocar nada, y sobre todo lo que este módulo
// **no** hace:
//
//   · **No suma al patrimonio.** Si quieres que lo que tienes en la bodega
//     cuente, se registra como un bien (Fase 11). Meterlo aquí haría que
//     apagar el módulo bajara el patrimonio, y un patrimonio que cambia al
//     desmarcar una casilla es la peor clase de mentira (R18).
//   · **No cambia el estado de resultados.** Finply lleva el libro por flujo de
//     efectivo (D14): la mercancía es gasto el día que la pagaste. El costo de
//     ventas de aquí es la **otra** verdad sobre el mismo peso —cuánto costó lo
//     que de verdad salió— y por eso vive en su propia sección, con la
//     diferencia dicha con todas sus letras.
//   · **No asienta dinero.** Una entrada puede apuntar al movimiento que la
//     pagó, pero no lo crea (R4).
//
// La existencia y el costo promedio **se derivan** recorriendo los
// movimientos, como la bandeja de recurrencias (D7) y el saldo de una factura:
// una columna `existencia` envejece en cuanto alguien corrige una entrada de
// hace un mes.

import { db, httpError } from './db.ts'
import { finDeMes, hoyISO } from '../shared/fechas.ts'
import { recorrerExistencias, type MovimientoExistencias } from '../shared/giro.ts'
import type { Almacen, MovimientoStock, Producto } from '../shared/types.ts'

function mapMovimiento(row: any): MovimientoStock {
  return {
    id: row.id,
    productId: row.product_id,
    date: row.date,
    kind: row.kind,
    qtyMilli: row.qty_milli,
    unitCostCents: row.unit_cost_cents,
    note: row.note,
    txId: row.tx_id ?? null,
  }
}

/**
 * El almacén entero: cada producto con su existencia, su costo promedio y lo
 * que costó lo que salió en la ventana.
 *
 * **Dos consultas, no una por producto** (R11): el catálogo y *todos* sus
 * movimientos en orden. El recorrido es JS y no SQL a propósito — el promedio
 * ponderado móvil es una secuencia, no una suma, igual que las inversiones en
 * los reportes. Lo que R11 pide es que no crezca el **número de consultas**, y
 * no crece.
 *
 * Ojo con la ventana: la existencia y el valor miran **todo el historial**
 * —lo que tienes hoy es lo que entró menos lo que salió desde siempre—, y solo
 * el costo de ventas mira la ventana. Cortar el historial daría existencias
 * negativas en cuanto alguien pida un mes que empieza con la bodega llena.
 */
export function almacen(profileId: number, desde: string, hasta: string): Almacen {
  const productos: any[] = db
    .prepare(
      `SELECT * FROM products WHERE profile_id = ?
       ORDER BY archived ASC, name ASC`,
    )
    .all(profileId)

  const movimientos: any[] =
    productos.length === 0
      ? []
      : db
          .prepare(
            `SELECT m.* FROM stock_moves m
             JOIN products p ON p.id = m.product_id
             WHERE p.profile_id = ?
             ORDER BY m.product_id ASC, m.date ASC, m.id ASC`,
          )
          .all(profileId)

  const porProducto = new Map<number, any[]>()
  for (const m of movimientos) {
    const lista = porProducto.get(m.product_id) ?? []
    lista.push(m)
    porProducto.set(m.product_id, lista)
  }

  const filas = productos.map((p): Producto => {
    const suyos = porProducto.get(p.id) ?? []
    const como = (m: any): MovimientoExistencias => ({
      fecha: m.date,
      tipo: m.kind,
      cantidadMilli: m.qty_milli,
      costoUnitarioCents: m.unit_cost_cents,
    })
    // Se recorre dos veces sobre la misma lista: el estado con todo el
    // historial, y el costo de ventas solo con la ventana. La segunda pasada
    // arranca del estado que dejó lo anterior a `desde`, que es lo que evita
    // valuar una salida de julio con el costo de una entrada de agosto.
    const todo = recorrerExistencias(suyos.map(como))
    const previos = suyos.filter((m) => m.date < desde)
    const dentro = suyos.filter((m) => m.date >= desde && m.date <= hasta)
    const arranque = recorrerExistencias(previos.map(como))
    const enVentana = recorrerExistencias([
      // El estado previo entra como una sola entrada equivalente: misma
      // cantidad, mismo valor. Así la primera salida de la ventana se valúa al
      // promedio que ya había, no al costo de la primera entrada del mes.
      ...(arranque.cantidadMilli > 0
        ? [
            {
              fecha: desde,
              tipo: 'entrada' as const,
              cantidadMilli: arranque.cantidadMilli,
              costoUnitarioCents: arranque.costoUnitarioCents,
            },
          ]
        : []),
      ...dentro.map(como),
    ])

    return {
      id: p.id,
      profileId: p.profile_id,
      sku: p.sku,
      name: p.name,
      unit: p.unit,
      minQtyMilli: p.min_qty_milli ?? null,
      archived: p.archived === 1,
      cantidadMilli: todo.cantidadMilli,
      costoUnitarioCents: todo.costoUnitarioCents,
      valorCents: todo.valorCents,
      costoVendidoCents: enVentana.costoVendidoCents,
      ajusteCents: enVentana.ajusteCents,
      movimientos: suyos.length,
      ultimoMovimiento: suyos.length > 0 ? suyos[suyos.length - 1]!.date : null,
      bajoMinimo: p.min_qty_milli !== null && todo.cantidadMilli < p.min_qty_milli,
    }
  })

  const vivos = filas.filter((f) => !f.archived)
  return {
    desde,
    hasta,
    valorCents: vivos.reduce((s, f) => s + f.valorCents, 0),
    costoVendidoCents: vivos.reduce((s, f) => s + f.costoVendidoCents, 0),
    ajusteCents: vivos.reduce((s, f) => s + f.ajusteCents, 0),
    productos: filas,
    bajoMinimo: vivos.filter((f) => f.bajoMinimo).length,
  }
}

export function productoPorId(profileId: number, id: number, hoy = hoyISO()): Producto | null {
  const { desde, hasta } = mesDe(hoy)
  return almacen(profileId, desde, hasta).productos.find((p) => p.id === id) ?? null
}

export function movimientosDe(profileId: number, productId: number): MovimientoStock[] {
  const producto = db
    .prepare('SELECT id FROM products WHERE id = ? AND profile_id = ?')
    .get(productId, profileId)
  if (!producto) throw httpError(404, 'Ese producto no existe')
  const filas: any[] = db
    .prepare('SELECT * FROM stock_moves WHERE product_id = ? ORDER BY date DESC, id DESC LIMIT 200')
    .all(productId)
  return filas.map(mapMovimiento)
}

export interface EntradaProducto {
  profileId: number
  sku: string
  name: string
  unit: string
  minQtyMilli?: number | null
  archived?: boolean
}

export function crearProducto(input: EntradaProducto): Producto {
  const choque = db
    .prepare('SELECT id FROM products WHERE profile_id = ? AND name = ?')
    .get(input.profileId, input.name)
  if (choque) throw httpError(409, 'Ya hay un producto con ese nombre')
  const result = db
    .prepare(
      'INSERT INTO products (profile_id, sku, name, unit, min_qty_milli) VALUES (?, ?, ?, ?, ?)',
    )
    .run(input.profileId, input.sku, input.name, input.unit, input.minQtyMilli ?? null)
  return productoPorId(input.profileId, Number(result.lastInsertRowid))!
}

export function actualizarProducto(profileId: number, id: number, input: EntradaProducto): Producto {
  const existe: any = db
    .prepare('SELECT * FROM products WHERE id = ? AND profile_id = ?')
    .get(id, profileId)
  if (!existe) throw httpError(404, 'Ese producto no existe')
  if (input.name !== existe.name) {
    const choque = db
      .prepare('SELECT id FROM products WHERE profile_id = ? AND name = ? AND id != ?')
      .get(profileId, input.name, id)
    if (choque) throw httpError(409, 'Ya hay un producto con ese nombre')
  }
  db.prepare(
    'UPDATE products SET sku = ?, name = ?, unit = ?, min_qty_milli = ?, archived = ? WHERE id = ?',
  ).run(
    input.sku,
    input.name,
    input.unit,
    input.minQtyMilli ?? null,
    input.archived ? 1 : 0,
    id,
  )
  return productoPorId(profileId, id)!
}

/**
 * Borrar el producto se lleva sus movimientos: son suyos y no son dinero — el
 * gasto de la compra vive en el libro, aparte, y ahí se queda. Con historial
 * lo que corresponde es archivar, igual que con una cuenta.
 */
export function borrarProducto(profileId: number, id: number): void {
  const existe: any = db
    .prepare('SELECT * FROM products WHERE id = ? AND profile_id = ?')
    .get(id, profileId)
  if (!existe) throw httpError(404, 'Ese producto no existe')
  const movs: any = db
    .prepare('SELECT COUNT(*) AS n FROM stock_moves WHERE product_id = ?')
    .get(id)
  if (movs.n > 0) {
    throw httpError(
      409,
      `Tiene ${movs.n} movimiento(s). Archívalo en vez de borrarlo para no perder su historial.`,
    )
  }
  db.prepare('DELETE FROM products WHERE id = ?').run(id)
}

export interface EntradaMovimiento {
  profileId: number
  productId: number
  date: string
  kind: 'entrada' | 'salida' | 'ajuste'
  qtyMilli: number
  unitCostCents: number
  note: string
  txId?: number | null
}

export function registrarMovimiento(input: EntradaMovimiento): Producto {
  const producto = productoPorId(input.profileId, input.productId, input.date)
  if (!producto) throw httpError(404, 'Ese producto no existe')
  if (input.txId) {
    const tx = db
      .prepare('SELECT id FROM transactions WHERE id = ? AND profile_id = ?')
      .get(input.txId, input.profileId)
    if (!tx) throw httpError(400, 'Ese movimiento no es de este perfil')
  }

  // Sacar más de lo que hay dejaría una existencia negativa, y de ahí en
  // adelante el costo promedio deja de significar nada. Se dice cuánto hay.
  const saca = input.kind === 'salida' ? input.qtyMilli : input.kind === 'ajuste' && input.qtyMilli < 0 ? -input.qtyMilli : 0
  if (saca > producto.cantidadMilli) {
    throw httpError(
      400,
      `Solo tienes ${producto.cantidadMilli / 1000} ${producto.unit} de ${producto.name}`,
    )
  }
  if (input.kind === 'salida' && input.qtyMilli <= 0) {
    throw httpError(400, 'Una salida saca una cantidad positiva')
  }
  if (input.kind === 'entrada' && input.qtyMilli <= 0) {
    throw httpError(400, 'Una entrada mete una cantidad positiva')
  }

  db.prepare(
    `INSERT INTO stock_moves (product_id, date, kind, qty_milli, unit_cost_cents, note, tx_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.productId,
    input.date,
    input.kind,
    input.qtyMilli,
    input.unitCostCents,
    input.note,
    input.txId ?? null,
  )
  // La ventana del costo de ventas es la del **movimiento que se acaba de
  // apuntar**, no la del mes en que corre el servidor: quien registra una
  // salida de julio espera ver el costo de julio. Es la misma fecha con la que
  // se leyó el producto al entrar, y leerlo con otra dejaba la comprobación y
  // la respuesta mirando meses distintos — un defecto que solo se veía a
  // partir del día 1 del mes siguiente.
  return productoPorId(input.profileId, input.productId, input.date)!
}

export function borrarMovimiento(profileId: number, id: number): void {
  const row: any = db
    .prepare(
      `SELECT m.id FROM stock_moves m JOIN products p ON p.id = m.product_id
       WHERE m.id = ? AND p.profile_id = ?`,
    )
    .get(id, profileId)
  if (!row) throw httpError(404, 'Ese movimiento no existe')
  db.prepare('DELETE FROM stock_moves WHERE id = ?').run(id)
}

/** El mes en curso, que es la ventana por omisión del costo de ventas. */
export function mesDe(hoy = hoyISO()): { desde: string; hasta: string } {
  return { desde: `${hoy.slice(0, 7)}-01`, hasta: finDeMes(hoy) }
}
