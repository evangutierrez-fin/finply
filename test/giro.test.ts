// La aritmética de los tres módulos de giro (Fase 15).
//
// `shared/giro.ts` es puro: no abre la base, así que el import estático es
// seguro (R16) y estas pruebas corren sin levantar nada.
//
// Lo que se demuestra aquí, en una frase cada cosa: que el promedio ponderado
// no deja centavos huérfanos, que un ajuste no se disfraza de venta, que una
// hora se cobra redondeando **una** vez, y que una tasa sin contra qué medirse
// dice "no se puede" en vez de cero.

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  cantidadTexto,
  horasTexto,
  importeDeMinutos,
  parseCantidad,
  parseHoras,
  recorrerExistencias,
  rendimientoInmueble,
  type MovimientoExistencias,
} from '../shared/giro.ts'

const entrada = (cantidadMilli: number, costoUnitarioCents: number, fecha = '2026-07-01'): MovimientoExistencias => ({
  fecha,
  tipo: 'entrada',
  cantidadMilli,
  costoUnitarioCents,
})
const salida = (cantidadMilli: number, fecha = '2026-07-10'): MovimientoExistencias => ({
  fecha,
  tipo: 'salida',
  cantidadMilli,
  costoUnitarioCents: 0,
})
const ajuste = (cantidadMilli: number, fecha = '2026-07-20'): MovimientoExistencias => ({
  fecha,
  tipo: 'ajuste',
  cantidadMilli,
  costoUnitarioCents: 0,
})

describe('inventario · promedio ponderado móvil (D29)', () => {
  test('una entrada sola vale lo que costó', () => {
    const r = recorrerExistencias([entrada(10_000, 5000)])
    assert.equal(r.cantidadMilli, 10_000, 'diez unidades')
    assert.equal(r.valorCents, 50_000, 'diez por cincuenta pesos')
    assert.equal(r.costoUnitarioCents, 5000)
    assert.equal(r.costoVendidoCents, 0, 'nada ha salido')
  })

  test('la segunda entrada mezcla el costo, no lo reemplaza', () => {
    // Diez a $50 y diez a $100 dan veinte a $75. El "último costo" diría $100
    // y se inventaría $250 de valor que nadie pagó.
    const r = recorrerExistencias([entrada(10_000, 5000), entrada(10_000, 10_000)])
    assert.equal(r.cantidadMilli, 20_000)
    assert.equal(r.valorCents, 150_000)
    assert.equal(r.costoUnitarioCents, 7500)
  })

  test('la salida se valúa al promedio del momento, no al de hoy', () => {
    // Se vende **antes** de que llegue el lote caro: esa venta costó $50, no
    // $75. Es la diferencia entre recorrer la secuencia y sumar el total.
    const r = recorrerExistencias([
      entrada(10_000, 5000, '2026-07-01'),
      salida(4_000, '2026-07-05'),
      entrada(10_000, 10_000, '2026-07-08'),
    ])
    assert.equal(r.costoVendidoCents, 20_000, 'cuatro a cincuenta')
    assert.equal(r.cantidadMilli, 16_000)
    assert.equal(r.valorCents, 130_000)
  })

  test('la última salida se lleva el valor entero: no quedan centavos huérfanos', () => {
    // Tres unidades por un peso: el promedio es 33.33 centavos y no cabe
    // exacto. Vaciar el almacén tiene que dejarlo en cero, no en "queda 1 ¢ de
    // nada" — es la misma regla del último pago de una parcialidad.
    const r = recorrerExistencias([entrada(3_000, 100), salida(1_000), salida(1_000), salida(1_000)])
    assert.equal(r.cantidadMilli, 0)
    assert.equal(r.valorCents, 0, 'el almacén vacío vale cero')
    assert.equal(r.costoVendidoCents, 300, 'y lo vendido suma exactamente lo que costó')
    assert.equal(r.costoUnitarioCents, 0, 'sin existencia no hay costo unitario que declarar')
  })

  test('un ajuste negativo baja el valor pero no es costo de ventas', () => {
    // Una merma no se vendió. Meterla en el costo de ventas inflaría lo que
    // costó lo que sí entregaste, que es justo la cifra que el módulo existe
    // para decir.
    const r = recorrerExistencias([entrada(10_000, 5000), ajuste(-2_000)])
    assert.equal(r.cantidadMilli, 8_000)
    assert.equal(r.valorCents, 40_000)
    assert.equal(r.costoVendidoCents, 0, 'no lo vendiste')
    assert.equal(r.ajusteCents, -10_000, 'se perdió el valor de dos unidades')
  })

  test('un ajuste positivo entra al promedio que ya había', () => {
    const r = recorrerExistencias([entrada(10_000, 5000), ajuste(2_000)])
    assert.equal(r.cantidadMilli, 12_000)
    assert.equal(r.valorCents, 60_000, 'las dos que aparecieron valen lo que valen las demás')
    assert.equal(r.ajusteCents, 10_000)
    assert.equal(r.costoUnitarioCents, 5000, 'y el promedio no se movió')
  })

  test('sin movimientos no hay nada que declarar', () => {
    const r = recorrerExistencias([])
    assert.deepEqual(r, {
      cantidadMilli: 0,
      costoUnitarioCents: 0,
      valorCents: 0,
      costoVendidoCents: 0,
      ajusteCents: 0,
    })
  })

  test('el valor acumulado no se despega de la suma de lo que salió', () => {
    // Cien movimientos con costos que no dividen exacto. La invariante: lo que
    // entró = lo que queda + lo que salió + lo que se ajustó. Si el valor se
    // llevara como cantidad × promedio redondeado, esto se separaría solo.
    const movs: MovimientoExistencias[] = []
    let entro = 0
    for (let i = 1; i <= 50; i++) {
      const costo = 333 + i * 7
      movs.push(entrada(1_000 + i, costo, '2026-07-01'))
      entro += Math.round(((1_000 + i) * costo) / 1000)
      movs.push(salida(700, '2026-07-02'))
    }
    const r = recorrerExistencias(movs)
    assert.equal(
      r.valorCents + r.costoVendidoCents - r.ajusteCents,
      entro,
      'lo que entró es lo que queda más lo que salió',
    )
    assert.ok(r.cantidadMilli > 0)
  })
})

describe('inventario · cantidades en milésimas', () => {
  test('se escriben sin ceros de relleno', () => {
    assert.equal(cantidadTexto(2000), '2')
    assert.equal(cantidadTexto(1500), '1.5')
    assert.equal(cantidadTexto(1250), '1.25')
    assert.equal(cantidadTexto(1005), '1.005')
    assert.equal(cantidadTexto(0), '0')
    assert.equal(cantidadTexto(-1500), '-1.5')
  })

  test('y se leen de vuelta iguales', () => {
    for (const milli of [0, 1, 999, 1000, 1500, 1250, 123_456]) {
      assert.equal(parseCantidad(cantidadTexto(milli)), milli, `${milli} da la vuelta`)
    }
    assert.equal(parseCantidad('1,5'), 1500, 'la coma decimal también')
  })

  test('lo que no se entiende es null, no cero', () => {
    for (const raw of ['', 'dos', '1.2345', '--1', '1..2']) {
      assert.equal(parseCantidad(raw), null, `"${raw}" no se entiende`)
    }
    assert.equal(parseCantidad('-1'), null, 'negativa sin permiso, no')
    assert.equal(parseCantidad('-1', true), -1000, 'con permiso, sí: un ajuste es un delta')
  })
})

describe('horas facturables', () => {
  test('el importe se redondea una sola vez', () => {
    // Media hora a $99.99 son $49.995: el centavo se decide una vez, al final.
    assert.equal(importeDeMinutos(30, 9999), 5000)
    assert.equal(importeDeMinutos(60, 9999), 9999)
    assert.equal(importeDeMinutos(90, 10_000), 15_000)
    assert.equal(importeDeMinutos(0, 10_000), 0, 'sin tiempo no hay importe')
    assert.equal(importeDeMinutos(60, 0), 0, 'sin tarifa tampoco')
  })

  test('cobrar por minuto y sumar no da lo mismo, y por eso no se hace así', () => {
    // Tres renglones de 10 minutos a $100/h. Redondeando cada minuto por
    // separado se pierde contra el total: el módulo suma renglón por renglón,
    // cada uno redondeado una vez, y la factura vale lo que suman las horas.
    const porMinuto = 3 * 10 * Math.round(10_000 / 60)
    const porRenglon = 3 * importeDeMinutos(10, 10_000)
    assert.notEqual(porMinuto, porRenglon)
    assert.equal(porRenglon, 5001, 'tres veces $16.67')
  })

  test('el tiempo se lee como reloj', () => {
    assert.equal(horasTexto(90), '1:30')
    assert.equal(horasTexto(60), '1:00')
    assert.equal(horasTexto(5), '0:05')
    assert.equal(horasTexto(0), '0:00')
  })

  test('y se escribe de las tres formas en que la gente lo escribe', () => {
    assert.equal(parseHoras('1:30'), 90)
    assert.equal(parseHoras('1.5'), 90)
    assert.equal(parseHoras('1,5'), 90, 'la coma decimal también')
    assert.equal(parseHoras('90m'), 90)
    assert.equal(parseHoras('90 m'), 90)
    assert.equal(parseHoras('2'), 120)
    assert.equal(parseHoras('2h'), 120)
    assert.equal(parseHoras(' 2:05 '), 125)
  })

  test('lo que no se entiende es null', () => {
    for (const raw of ['', 'una hora', '1:60', '1:5', 'm', '-1']) {
      assert.equal(parseHoras(raw), null, `"${raw}" no se entiende`)
    }
  })
})

describe('inmuebles · qué deja la propiedad', () => {
  const base = { cobradoCents: 120_000, gastoCents: 20_000, meses: 12 }

  test('el neto es lo cobrado menos lo gastado, y se anualiza', () => {
    const r = rendimientoInmueble({ ...base, valorCents: 2_000_000, costoCents: 1_000_000 })
    assert.equal(r.netoCents, 100_000)
    assert.equal(r.anualizadoCents, 100_000, 'doce meses ya son un año')
    assert.equal(r.tasaAnualBp, 500, '5 % sobre lo que vale hoy')
    assert.equal(r.tasaSobreCostoBp, 1000, 'y 10 % sobre lo que costó')
  })

  test('media ventana se lleva al año', () => {
    const r = rendimientoInmueble({ ...base, meses: 6, valorCents: 2_000_000, costoCents: 0 })
    assert.equal(r.anualizadoCents, 200_000, 'seis meses valen la mitad de un año')
    assert.equal(r.tasaAnualBp, 1000)
  })

  test('sin valor contra qué medir, la tasa es null y no cero', () => {
    // Cero por ciento es una afirmación —"no te deja nada"— y sería mentira.
    const r = rendimientoInmueble({ ...base, valorCents: 0, costoCents: 0 })
    assert.equal(r.netoCents, 100_000, 'el neto sí se sabe')
    assert.equal(r.tasaAnualBp, null)
    assert.equal(r.tasaSobreCostoBp, null)
  })

  test('un inmueble que da pérdida lo dice con signo', () => {
    const r = rendimientoInmueble({
      cobradoCents: 50_000,
      gastoCents: 90_000,
      meses: 12,
      valorCents: 2_000_000,
      costoCents: 2_000_000,
    })
    assert.equal(r.netoCents, -40_000)
    assert.equal(r.tasaAnualBp, -200, 'menos 2 % anual')
  })

  test('sin meses no se inventa un anualizado', () => {
    const r = rendimientoInmueble({ ...base, meses: 0, valorCents: 2_000_000, costoCents: 0 })
    assert.equal(r.anualizadoCents, 0)
    assert.equal(r.tasaAnualBp, 0, 'cero entre algo sí es cero')
  })
})
