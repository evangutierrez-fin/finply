// Fase 26 · Sacar los datos.
//
// Lo que se comprueba aquí es de tres clases:
//
//   1. Que el .zip **sea** un .zip. Está escrito a mano, así que la prueba
//      trae su propio lector —firmas, directorio central, CRC— y no reusa el
//      escritor: comprobar un formato con el mismo código que lo produce no
//      comprueba nada.
//   2. Que el export sea **completo y de un solo perfil**. Una tabla olvidada
//      no da error: da un archivo incompleto que nadie nota.
//   3. Que las cifras del reporte en CSV sean **las mismas** que las de la
//      pantalla, al centavo, y que no sean menos: la vista dibuja diez
//      categorías y el archivo se las lleva todas.

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { crc32, inflateRawSync } from 'node:zlib'
import { levantar, libroBase, type Cliente } from './ayuda.ts'
// `server/csv.ts` no llega a `db.ts` (R16): es el módulo puro de siempre.
import { parseCsv } from '../server/csv.ts'
import { nombreSeguro } from '../shared/archivos.ts'

/**
 * Un lector de .zip mínimo, escrito para esta prueba. Va del directorio
 * central hacia atrás, que es como lo lee cualquier extractor de verdad, y
 * comprueba el CRC de cada entrada contra sus bytes.
 */
function leerZip(bytes: Uint8Array): Map<string, Buffer> {
  const buf = Buffer.from(bytes)
  let fin = buf.length - 22
  while (fin >= 0 && buf.readUInt32LE(fin) !== 0x06054b50) fin--
  assert.ok(fin >= 0, 'el archivo no remata con la firma de un .zip')

  const cuantos = buf.readUInt16LE(fin + 10)
  const tamDirectorio = buf.readUInt32LE(fin + 12)
  const inicioDirectorio = buf.readUInt32LE(fin + 16)

  const salida = new Map<string, Buffer>()
  let p = inicioDirectorio
  for (let i = 0; i < cuantos; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50, `entrada ${i} sin firma de directorio`)
    const metodo = buf.readUInt16LE(p + 10)
    const suma = buf.readUInt32LE(p + 16)
    const comprimido = buf.readUInt32LE(p + 20)
    const crudoLargo = buf.readUInt32LE(p + 24)
    const nombreLargo = buf.readUInt16LE(p + 28)
    const extraLargo = buf.readUInt16LE(p + 30)
    const comentarioLargo = buf.readUInt16LE(p + 32)
    const donde = buf.readUInt32LE(p + 42)
    const nombre = buf.subarray(p + 46, p + 46 + nombreLargo).toString('utf8')

    assert.equal(buf.readUInt32LE(donde), 0x04034b50, `${nombre} sin cabecera local`)
    const inicio = donde + 30 + buf.readUInt16LE(donde + 26) + buf.readUInt16LE(donde + 28)
    const datos = buf.subarray(inicio, inicio + comprimido)
    const crudo = metodo === 0 ? Buffer.from(datos) : inflateRawSync(datos)
    assert.equal(crudo.length, crudoLargo, `${nombre}: el largo no cuadra`)
    assert.equal(crc32(crudo) >>> 0, suma >>> 0, `${nombre}: el CRC no cuadra`)

    salida.set(nombre, crudo)
    p += 46 + nombreLargo + extraLargo + comentarioLargo
  }
  assert.equal(p, inicioDirectorio + tamDirectorio, 'el directorio central no mide lo que dice')
  return salida
}

/** Una hoja del .zip, ya partida en filas. */
function hoja(zip: Map<string, Buffer>, tabla: string): string[][] {
  const csv = zip.get(`${tabla}.csv`)
  assert.ok(csv, `falta ${tabla}.csv en el export`)
  return parseCsv(csv.toString('utf8'))
}

/** El valor de una columna en la primera fila de datos de una hoja. */
function celda(filas: string[][], columna: string, fila = 1): string {
  const i = filas[0]!.indexOf(columna)
  assert.ok(i >= 0, `la hoja no trae columna "${columna}": ${filas[0]!.join(', ')}`)
  return filas[fila]![i]!
}

describe('el export completo de un perfil', () => {
  let c: Cliente
  let perfil: any
  let cuenta: any
  let categorias: any[]
  let otro: any

  before(async () => {
    c = await levantar()
    const base = await libroBase(c, 'Casa')
    perfil = base.perfil
    cuenta = base.cuenta
    categorias = base.categorias

    // Un segundo libro con sus propios datos: el export de uno no puede
    // llevarse nada del otro, ni por las tablas que cuelgan de otra tabla.
    const b = await libroBase(c, 'Taller')
    otro = b.perfil
    await c.post('/api/transactions', {
      profileId: otro.id,
      accountId: b.cuenta.id,
      type: 'gasto',
      amountCents: 999_00,
      date: '2026-03-03',
      note: 'del otro libro',
    })
    const deudaAjena = (
      await c.post('/api/debts', {
        profileId: otro.id,
        direction: 'por_pagar',
        counterparty: 'Banco ajeno',
        concept: 'Ajena',
        principalCents: 100_000_00,
        startDate: '2026-01-01',
      })
    ).body
    await c.post(`/api/debts/${deudaAjena.id}/pagos`, { amountCents: 1_000_00, date: '2026-02-01' })
  })

  after(async () => {
    await c.cerrar()
  })

  test('trae una hoja por tabla, incluidas las vacías', async () => {
    const { TABLES } = await import('../server/backup.ts')
    const r = await c.getBytes(`/api/exportar/libro.zip?profileId=${perfil.id}`)
    assert.equal(r.status, 200)
    assert.equal(r.headers['content-type'], 'application/zip')
    assert.match(r.headers['content-disposition']!, /attachment; filename="finply-datos-\d{4}-\d\d-\d\d\.zip"/)

    const zip = leerZip(r.body)
    for (const tabla of TABLES) {
      const csv = zip.get(`${tabla}.csv`)
      assert.ok(csv, `falta ${tabla}.csv`)
      // Hasta la vacía trae su renglón de encabezados: un archivo que falta se
      // lee como "aquí se perdió algo"; uno vacío dice lo que de verdad pasa.
      assert.ok(csv.length > 0, `${tabla}.csv salió sin encabezados`)
    }
    assert.ok(zip.has('LEEME.txt'))
  })

  test('cada tabla del respaldo sabe cómo llegar a su perfil, y ninguna de más', async () => {
    // La misma red que ya cuida `backup.ts`, del otro lado: una tabla nueva
    // que se agregue al respaldo y se olvide aquí saldría vacía para siempre.
    const { TABLES } = await import('../server/backup.ts')
    const { ALCANCE } = await import('../server/exportar.ts')
    const conAlcance = Object.keys(ALCANCE).sort()
    assert.deepEqual(conAlcance, [...TABLES].sort())
  })

  test('los encabezados de una hoja nunca chocan entre sí', async () => {
    // Quitar el sufijo de la escala podría estrellar dos columnas en una:
    // `amount` y `amount_cents` en la misma tabla darían dos columnas iguales
    // y el archivo dejaría de poder leerse.
    const { db } = await import('../server/db.ts')
    const { TABLES } = await import('../server/backup.ts')
    const { encabezadoDe } = await import('../server/exportar.ts')
    for (const tabla of TABLES) {
      const columnas = (
        db.prepare(`PRAGMA table_info(${tabla})`).all() as { name: string }[]
      ).map((x) => encabezadoDe(x.name))
      assert.equal(new Set(columnas).size, columnas.length, `${tabla} tiene encabezados repetidos`)
    }
  })

  test('el dinero sale en pesos y la tasa en por ciento, no en la escala de adentro', async () => {
    const deuda = (
      await c.post('/api/debts', {
        profileId: perfil.id,
        direction: 'por_pagar',
        counterparty: 'Banco',
        concept: 'Auto',
        principalCents: 240_000_00,
        startDate: '2026-01-01',
        annualRateBp: 1350,
        termMonths: 48,
      })
    ).body
    assert.ok(deuda.id)

    const zip = leerZip((await c.getBytes(`/api/exportar/libro.zip?profileId=${perfil.id}`)).body)
    const deudas = hoja(zip, 'debts')
    assert.equal(celda(deudas, 'principal'), '240000.00')
    assert.equal(celda(deudas, 'annual_rate_pct'), '13.50')
    // Y el nombre viejo ya no está: una columna que no trae centavos no puede
    // seguir llamándose así.
    assert.ok(!deudas[0]!.includes('principal_cents'))
    assert.ok(!deudas[0]!.includes('annual_rate_bp'))
  })

  test('⚠ `hide_cents` no es dinero, y por eso sale tal cual', async () => {
    // La regla por sufijo es cómoda y por eso mismo peligrosa: aplicada a
    // ciegas, la casilla de "ocultar los centavos" saldría como 0.01 bajo una
    // columna llamada `hide`.
    await c.patch(`/api/profiles/${perfil.id}`, { hideCents: true })
    const zip = leerZip((await c.getBytes(`/api/exportar/libro.zip?profileId=${perfil.id}`)).body)
    const perfiles = hoja(zip, 'profiles')
    assert.equal(celda(perfiles, 'hide_cents'), '1')
    assert.ok(!perfiles[0]!.includes('hide'), 'la columna perdió el sufijo como si fuera dinero')
    await c.patch(`/api/profiles/${perfil.id}`, { hideCents: false })
  })

  test('se lleva lo de su perfil y nada de los demás', async () => {
    const zip = leerZip((await c.getBytes(`/api/exportar/libro.zip?profileId=${perfil.id}`)).body)

    // `profiles`: una sola fila, la suya.
    const perfiles = hoja(zip, 'profiles')
    assert.equal(perfiles.length, 2, 'el export trajo más de un perfil')
    assert.equal(celda(perfiles, 'name'), 'Casa')

    // Una tabla con `profile_id`.
    const txs = hoja(zip, 'transactions')
    assert.ok(!txs.some((f) => f.includes('del otro libro')))

    // Y una que cuelga de otra tabla: los abonos del otro libro no tienen
    // `profile_id` propio, así que solo se filtran por su deuda.
    const abonos = hoja(zip, 'debt_payments')
    assert.equal(abonos.length, 1, 'se colaron abonos de una deuda ajena')
  })

  test('el texto del usuario sale saneado contra la inyección de fórmulas (R7)', async () => {
    const cat = (
      await c.post('/api/categories', {
        profileId: perfil.id,
        name: '=HYPERLINK("http://malo","cobra")',
        kind: 'gasto',
      })
    ).body
    assert.ok(cat.id)
    const zip = leerZip((await c.getBytes(`/api/exportar/libro.zip?profileId=${perfil.id}`)).body)
    const cats = hoja(zip, 'categories')
    const fila = cats.find((f) => f.some((celda) => celda.includes('HYPERLINK')))
    assert.ok(fila, 'la categoría no salió en el export')
    assert.ok(
      fila.some((celda) => celda.startsWith("'=HYPERLINK")),
      `sin comilla de guardia: ${fila.join(' | ')}`,
    )
  })

  test('el recibo viaja como archivo, no como base64 en una celda', async () => {
    const tx = (
      await c.post('/api/transactions', {
        profileId: perfil.id,
        accountId: cuenta.id,
        type: 'gasto',
        amountCents: 500_00,
        date: '2026-05-05',
        categoryId: categorias.find((x: any) => x.kind === 'gasto')!.id,
        note: 'con recibo',
      })
    ).body
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6, 7, 8])
    const adjunto = await c.post(`/api/transactions/${tx.id}/adjuntos`, {
      // Un nombre que es una ruta: legal en Finply, y peligroso al
      // descomprimir si se escribiera tal cual.
      filename: '../../recibo raro.png',
      mime: 'image/png',
      dataB64: bytes.toString('base64'),
    })
    assert.equal(adjunto.status, 201, JSON.stringify(adjunto.body))

    const zip = leerZip((await c.getBytes(`/api/exportar/libro.zip?profileId=${perfil.id}`)).body)
    const rutas = [...zip.keys()].filter((k) => k.startsWith('recibos/'))
    assert.equal(rutas.length, 1)
    assert.ok(!rutas[0]!.includes('..'), `la ruta se escapa de su carpeta: ${rutas[0]}`)
    assert.deepEqual(zip.get(rutas[0]!), bytes, 'los bytes del recibo no son los mismos')

    const adjuntos = hoja(zip, 'tx_attachments')
    assert.equal(celda(adjuntos, 'archivo'), rutas[0])
    assert.ok(!adjuntos[0]!.includes('data_b64'))
  })

  test('un perfil que no existe da 404, y sin perfil da 400', async () => {
    assert.equal((await c.getBytes('/api/exportar/libro.zip?profileId=9999')).status, 404)
    assert.equal((await c.getBytes('/api/exportar/libro.zip')).status, 400)
  })
})

describe('el export no se encarece con el tamaño del libro (R11)', () => {
  let c: Cliente

  before(async () => {
    c = await levantar()
  })
  after(async () => {
    await c.cerrar()
  })

  test('un libro de 200 partidas cuesta las mismas consultas que uno de 3', async () => {
    const { db } = await import('../server/db.ts')
    const { exportarPerfil } = await import('../server/exportar.ts')

    const armar = async (nombre: string, cuantas: number) => {
      const { perfil, cuenta, categorias } = await libroBase(c, nombre)
      const cat = categorias.find((x: any) => x.kind === 'gasto')!.id
      for (let i = 0; i < cuantas; i++) {
        await c.post('/api/transactions', {
          profileId: perfil.id,
          accountId: cuenta.id,
          type: 'gasto',
          amountCents: 100_00 + i,
          date: `2026-0${(i % 9) + 1}-15`,
          categoryId: cat,
          note: `gasto ${i}`,
        })
      }
      return perfil.id
    }

    const chico = await armar('Chico', 3)
    const grande = await armar('Grande', 200)

    const original = db.prepare.bind(db)
    let n = 0
    const contar = (id: number) => {
      n = 0
      ;(db as any).prepare = (sql: string) => {
        n++
        return original(sql)
      }
      try {
        exportarPerfil(id)
      } finally {
        ;(db as any).prepare = original
      }
      return n
    }

    assert.equal(contar(grande), contar(chico), 'el export gasta consultas por fila')
  })
})

describe('el reporte que se baja dice lo mismo que el que se ve', () => {
  let c: Cliente
  let perfil: any

  before(async () => {
    c = await levantar()
    const base = await libroBase(c, 'Reportes')
    perfil = base.perfil
    const cuenta = base.cuenta
    const ingreso = base.categorias.find((x: any) => x.kind === 'ingreso')!.id

    await c.post('/api/transactions', {
      profileId: perfil.id,
      accountId: cuenta.id,
      type: 'ingreso',
      amountCents: 30_000_00,
      date: '2026-01-15',
      categoryId: ingreso,
      note: 'sueldo',
    })

    // Doce categorías de gasto con movimiento: la vista dibuja diez, el
    // archivo tiene que traerlas todas.
    for (let i = 0; i < 12; i++) {
      const cat = (
        await c.post('/api/categories', {
          profileId: perfil.id,
          name: `Gasto ${String(i).padStart(2, '0')}`,
          kind: 'gasto',
        })
      ).body
      await c.post('/api/transactions', {
        profileId: perfil.id,
        accountId: cuenta.id,
        type: 'gasto',
        amountCents: 1_000_00 + i * 100,
        date: '2026-02-10',
        categoryId: cat.id,
        note: `gasto ${i}`,
      })
    }
  })

  after(async () => {
    await c.cerrar()
  })

  test('los totales del CSV son los del JSON, al centavo', async () => {
    const json = (await c.get(`/api/reportes?profileId=${perfil.id}&year=2026`)).body
    const csv = await c.getText(`/api/reportes/export.csv?profileId=${perfil.id}&year=2026`)
    assert.equal(csv.status, 200)
    assert.match(csv.headers['content-disposition']!, /finply-reporte-2026\.csv/)

    const filas = parseCsv(csv.body)
    const buscar = (etiqueta: string) => filas.find((f) => f[0] === etiqueta)?.[1]
    assert.equal(buscar('Entró'), (json.totales.incomeCents / 100).toFixed(2))
    assert.equal(buscar('Salió'), (json.totales.expenseCents / 100).toFixed(2))
    assert.equal(buscar('Quedó'), (json.totales.netCents / 100).toFixed(2))
    assert.equal(buscar('Tasa de ahorro (%)'), (json.totales.tasaAhorro * 100).toFixed(2))
  })

  test('se lleva las doce categorías, no las diez que caben en la gráfica', async () => {
    const csv = (await c.getText(`/api/reportes/export.csv?profileId=${perfil.id}&year=2026`)).body
    const filas = parseCsv(csv)
    const cuantas = filas.filter((f) => /^Gasto \d\d$/.test(f[0] ?? '')).length
    assert.equal(cuantas, 12)
  })

  test('los doce meses salen, vacíos incluidos, con su patrimonio', async () => {
    const csv = (await c.getText(`/api/reportes/export.csv?profileId=${perfil.id}&year=2026`)).body
    const filas = parseCsv(csv)
    const meses = filas.filter((f) => /^2026-\d\d$/.test(f[0] ?? '') && f.length === 5)
    assert.equal(meses.length, 12, 'una serie con huecos hace creer que el año tuvo menos meses')
  })

  test('la comparativa trae los dos periodos y sus fechas', async () => {
    const url = `/api/reportes/comparativa.csv?profileId=${perfil.id}&desde=2026-02&hasta=2026-02`
    const csv = await c.getText(url)
    assert.equal(csv.status, 200)
    const filas = parseCsv(csv.body)
    const este = filas.find((f) => f[0] === 'Este')
    const contra = filas.find((f) => f[0] === 'Contra')
    assert.deepEqual(este?.slice(1, 3), ['2026-02', '2026-02'])
    // Sin segundo periodo, el bloque inmediatamente anterior del mismo largo.
    assert.deepEqual(contra?.slice(1, 3), ['2026-01', '2026-01'])

    const json = (
      await c.get(`/api/reportes/comparativa?profileId=${perfil.id}&desde=2026-02&hasta=2026-02`)
    ).body
    assert.equal(este?.[4], (json.actual.expenseCents / 100).toFixed(2))
    assert.equal(contra?.[4], (json.previo.expenseCents / 100).toFixed(2))
  })
})

describe('el nombre de un archivo dentro del .zip', () => {
  test('nunca se sale de su carpeta', () => {
    assert.equal(nombreSeguro('../../.ssh/config'), 'ssh-config')
    assert.equal(nombreSeguro('recibo.png'), 'recibo.png')
    assert.equal(nombreSeguro('a/b/c.pdf'), 'a-b-c.pdf')
    assert.equal(nombreSeguro('   '), 'archivo')
    assert.ok(!nombreSeguro('x'.repeat(400)).includes('/'))
    assert.ok(nombreSeguro('x'.repeat(400)).length <= 100)
  })

  test('ni parte una cabecera en dos', () => {
    // El mismo nombre viaja en `Content-Disposition` al bajar el recibo, y ahí
    // un salto de línea no es un carácter raro: es el separador entre dos
    // cabeceras. Node se niega a mandarla y el recibo se vuelve un archivo que
    // entró al libro y ya no puede salir.
    assert.equal(nombreSeguro('recibo\r\nX-Inyectado: si.pdf'), 'reciboX-Inyectado: si.pdf')
    assert.ok(!/[\r\n ]/.test(nombreSeguro('a b\nc')))
  })
})

/**
 * La salida de un libro que **ya** trae una cifra que JavaScript no puede
 * representar exacto. Son dos puertas —este .zip y el respaldo JSON— y las dos
 * tronaban con el mismo `RangeError`: el libro quedaba dentro de Finply sin
 * forma de sacarlo, que es lo contrario de lo que este archivo promete.
 */
describe('llevarse un libro escrito antes del techo', () => {
  let c: Cliente
  before(async () => {
    c = await levantar()
  })
  after(() => c.cerrar())

  test('el .zip sale, y la cifra sale entera', async () => {
    const { perfil, cuenta } = await libroBase(c, 'Envenenado')
    const { db } = await import('../server/db.ts')
    db.prepare(
      `INSERT INTO transactions (profile_id, account_id, type, amount_cents, date, note)
       VALUES (?, ?, 'gasto', 99999999999999999, '2026-07-11', 'Veneno')`,
    ).run(perfil.id, cuenta.id)

    const res = await c.getBytes(`/api/exportar/libro.zip?profileId=${perfil.id}`)
    assert.equal(res.status, 200, 'el libro no se podía sacar de Finply')

    // La cifra viaja exacta y desescalada. Es justo la que un `number` no
    // conserva: 99999999999999999 se redondea a 100000000000000000 en cuanto
    // pasa por coma flotante, y ahí los dos últimos centavos desaparecen.
    const filas = hoja(leerZip(res.body), 'transactions')
    const columna = filas[0]!.indexOf('amount')
    const suya = filas.slice(1).find((f) => f[filas[0]!.indexOf('note')] === 'Veneno')
    assert.ok(suya, 'el movimiento envenenado no salió en la hoja')
    assert.equal(suya[columna], '999999999999999.99', 'la cifra salió redondeada')
  })
})
