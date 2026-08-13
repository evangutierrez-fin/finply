// Sacar los datos: el libro entero de un perfil, en hojas que abre cualquiera.
//
// El respaldo JSON ya existía, pero es otra cosa: sirve para **volver a
// entrar** a Finply, no para salir. Aquí el destino es Excel, LibreOffice o
// Sheets, y eso cambia tres decisiones (D32):
//
//   1. **Una hoja por tabla.** Cada una tiene sus columnas; meterlas todas en
//      un CSV daría un archivo que no es una tabla. Van dentro de un .zip
//      porque el navegador solo sabe bajar un archivo.
//   2. **Los números salen sin la escala de Finply.** Adentro el dinero son
//      centavos enteros y las tasas puntos base, por exactitud; afuera, `4500`
//      donde hay $45.00 es un error de cien veces en cuanto alguien sume la
//      columna. La columna pierde el sufijo que nombraba la escala.
//   3. **Los ids se quedan.** Son lo único que liga una hoja con otra: sin
//      ellos, `transactions.csv` no sabría de qué cuenta habla. Un export sin
//      relaciones es una foto, no los datos.
//
// Y una cosa más, que no es decisión sino consecuencia: los recibos no caben
// en una celda —son megas de base64, y una celda de Excel se corta a 32 767
// caracteres—, así que viajan como archivos de verdad dentro del .zip.

import { db, filasCrudas, httpError } from './db.ts'
import { TABLES } from './backup.ts'
import { SCHEMA_VERSION } from './migrations.ts'
import { armarCsv, armarCsvSecciones, celdaTexto, escalaCsv, montoCsv } from './csv.ts'
import { comparativa, reporteAnual } from './reportes.ts'
import { armarZip, nombreSeguro, type EntradaZip } from './zip.ts'

type Tabla = (typeof TABLES)[number]

/**
 * Cómo se llega desde cada tabla al perfil que la exporta.
 *
 * El respaldo no necesita esto —se lleva el libro entero, todos los perfiles—
 * pero el export sí: es **de un perfil**, y la mitad de las tablas no tiene
 * columna `profile_id` porque cuelga de otra que sí la tiene.
 *
 * ⚠ Cada tabla de `TABLES` tiene que aparecer aquí, y ninguna de más. Hay
 * prueba de las dos direcciones: es la misma red que ya cuida `backup.ts`, y
 * por la misma razón — una tabla olvidada no da error, da un export incompleto
 * que nadie nota hasta que hace falta.
 */
export const ALCANCE: Record<Tabla, { padre: string; llave: string } | 'propia' | 'perfil'> = {
  profiles: 'perfil',
  profile_modules: 'propia',
  accounts: 'propia',
  categories: 'propia',
  import_rules: 'propia',
  tags: 'propia',
  debts: 'propia',
  debt_payments: { padre: 'debts', llave: 'debt_id' },
  investments: 'propia',
  investment_entries: { padre: 'investments', llave: 'investment_id' },
  goals: 'propia',
  goal_entries: { padre: 'goals', llave: 'goal_id' },
  assets: 'propia',
  asset_valuations: { padre: 'assets', llave: 'asset_id' },
  budgets: 'propia',
  budget_totals: 'propia',
  profile_fields: 'propia',
  tx_templates: 'propia',
  import_batches: 'propia',
  recurrences: 'propia',
  recurrence_tags: { padre: 'recurrences', llave: 'recurrence_id' },
  msi_purchases: 'propia',
  msi_installments: { padre: 'msi_purchases', llave: 'purchase_id' },
  counterparties: 'propia',
  cost_centers: 'propia',
  invoices: 'propia',
  invoice_credit_notes: { padre: 'invoices', llave: 'invoice_id' },
  invoice_recurrences: 'propia',
  quotes: 'propia',
  rentals: 'propia',
  products: 'propia',
  transactions: 'propia',
  transaction_tags: { padre: 'transactions', llave: 'transaction_id' },
  tx_splits: { padre: 'transactions', llave: 'tx_id' },
  tx_attachments: { padre: 'transactions', llave: 'tx_id' },
  tx_field_values: { padre: 'transactions', llave: 'tx_id' },
  account_statements: 'propia',
  notes: 'propia',
  recurrence_runs: { padre: 'recurrences', llave: 'recurrence_id' },
  invoice_recurrence_runs: { padre: 'invoice_recurrences', llave: 'recurrence_id' },
  stock_moves: { padre: 'products', llave: 'product_id' },
  time_entries: 'propia',
}

/**
 * Las escalas de Finply, por sufijo de columna. El sufijo se va con la escala:
 * una columna que ya no trae centavos no puede seguir llamándose `_cents`.
 */
const ESCALAS: { sufijo: string; decimales: number; nuevo: (col: string) => string }[] = [
  { sufijo: '_cents', decimales: 2, nuevo: (c) => c.slice(0, -6) },
  // Puntos base a por ciento: 4500 bp son 45.00 %.
  { sufijo: '_bp', decimales: 2, nuevo: (c) => `${c.slice(0, -3)}_pct` },
  { sufijo: '_e8', decimales: 8, nuevo: (c) => c.slice(0, -3) },
  { sufijo: '_milli', decimales: 3, nuevo: (c) => c.slice(0, -6) },
]

/**
 * ⚠ Columnas cuyo nombre termina como una escala **sin serlo**.
 *
 * `profiles.hide_cents` es la casilla de "ocultar los centavos": aplicarle la
 * regla la convertiría en `0.01` bajo una columna llamada `hide`. La regla por
 * sufijo es cómoda y por eso mismo es peligrosa, así que la excepción se
 * declara y hay una prueba que recorre el esquema entero: cualquier columna
 * nueva que acabe en `_cents`, `_bp`, `_e8` o `_milli` y no sea de esa escala
 * tiene que aparecer aquí o la suite se cae.
 */
export const SIN_ESCALA = new Set(['hide_cents'])

/**
 * Columnas que cambian de nombre porque cambian de contenido. Solo una: el
 * recibo sale como archivo dentro del .zip y su celda pasa a ser la ruta, así
 * que llamarla `data_b64` sería describir lo que ya no lleva.
 */
const RENOMBRES: Record<string, string> = { data_b64: 'archivo' }

/** El orden en que se leen las filas. Por `rowid` salvo donde haya uno mejor. */
const ORDEN: Partial<Record<Tabla, string>> = {
  // Igual que el CSV de movimientos, que ya salía en orden de fecha: dos
  // exports del mismo libro no pueden ordenar la misma tabla de dos formas.
  transactions: 'date ASC, id ASC',
  // Un hijo nunca antes que su padre, por lo mismo que en el respaldo.
  categories: 'parent_id IS NOT NULL, rowid ASC',
}

function columnasDe(tabla: string): string[] {
  const info = db.prepare(`PRAGMA table_info(${tabla})`).all() as { name: string }[]
  return info.map((c) => c.name)
}

/** Las filas de una tabla que pertenecen a un perfil. Una consulta, siempre. */
export function filasDe(tabla: Tabla, profileId: number): Record<string, unknown>[] {
  const alcance = ALCANCE[tabla]
  const orden = ORDEN[tabla] ?? 'rowid ASC'
  const donde =
    alcance === 'perfil'
      ? 'id = ?'
      : alcance === 'propia'
        ? 'profile_id = ?'
        : `${alcance.llave} IN (SELECT id FROM ${alcance.padre} WHERE profile_id = ?)`
  // Por `filasCrudas` y no por `.all()`: un libro escrito antes del techo de
  // la cuarta vuelta puede traer un entero que JavaScript no representa
  // exacto, y entonces esta —que es la puerta de salida— era justo la que
  // tronaba. El CSV escribe la cifra tal cual, que es lo que hay que sacar:
  // `escalaCsv` trabaja en BigInt precisamente para esto.
  return filasCrudas(`SELECT * FROM ${tabla} WHERE ${donde} ORDER BY ${orden}`, profileId).filas
}

/** El encabezado de una columna: sin el sufijo de su escala, si lo tenía. */
export function encabezadoDe(columna: string): string {
  if (RENOMBRES[columna]) return RENOMBRES[columna]!
  if (SIN_ESCALA.has(columna)) return columna
  const escala = ESCALAS.find((e) => columna.endsWith(e.sufijo))
  return escala ? escala.nuevo(columna) : columna
}

/** Una celda: los enteros escalados se desescalan; el texto se sanea (R7). */
function celdaDe(columna: string, valor: unknown): string {
  if (valor === null || valor === undefined) return ''
  const escala = SIN_ESCALA.has(columna)
    ? undefined
    : ESCALAS.find((e) => columna.endsWith(e.sufijo))
  if (escala && (typeof valor === 'number' || typeof valor === 'bigint')) {
    return escalaCsv(valor, escala.decimales)
  }
  if (typeof valor === 'number' || typeof valor === 'bigint') return String(valor)
  if (valor instanceof Uint8Array) return `(${valor.length} bytes)`
  // Todo lo demás es texto que escribió el usuario: nombre de cuenta,
  // concepto, nota, folio. Ahí vive la inyección de fórmulas (R7).
  return celdaTexto(String(valor))
}

/** El CSV de una tabla, con sus columnas tal como están en la base. */
export function tablaCsv(tabla: Tabla, filas: Record<string, unknown>[]): string {
  const columnas = columnasDe(tabla)
  return armarCsv(
    columnas.map(encabezadoDe),
    filas.map((f) => columnas.map((c) => celdaDe(c, f[c]))),
  )
}

/** `tx_attachments.data_b64` deja de ser base64 y pasa a ser una ruta. */
const COLUMNA_RECIBO = 'data_b64'

/** Los bytes de un recibo y cómo se llama dentro del .zip. */
function recibosDe(filas: Record<string, unknown>[]): { entrada: EntradaZip; fila: number }[] {
  return filas.map((f, i) => ({
    fila: i,
    entrada: {
      nombre: `recibos/${f['id']}-${nombreSeguro(String(f['filename'] ?? ''), 'recibo')}`,
      datos: Buffer.from(String(f[COLUMNA_RECIBO] ?? ''), 'base64'),
    },
  }))
}

/**
 * El .zip completo de un perfil: una hoja por tabla, los recibos como
 * archivos y un LEEME que dice qué es cada cosa.
 *
 * Las tablas vacías **también salen**, con su renglón de encabezados. Un
 * archivo que falta se lee como "aquí faltó algo"; uno vacío dice justo lo que
 * pasa, que es que ese libro no lleva facturas.
 */
export function exportarPerfil(profileId: number, fecha = new Date()): Buffer {
  const perfil = db.prepare('SELECT name FROM profiles WHERE id = ?').get(profileId) as
    | { name: string }
    | undefined
  if (!perfil) throw httpError(404, 'Ese perfil no existe')

  const entradas: EntradaZip[] = []
  const conteo: { tabla: string; filas: number }[] = []
  let recibos = 0

  for (const tabla of TABLES) {
    const filas = filasDe(tabla, profileId)
    conteo.push({ tabla, filas: filas.length })
    if (tabla === 'tx_attachments') {
      // El recibo sale como archivo y la hoja se queda con su ficha: el
      // `data_b64` se cambia por dónde quedó dentro del .zip.
      for (const { entrada, fila } of recibosDe(filas)) {
        entradas.push(entrada)
        filas[fila]![COLUMNA_RECIBO] = entrada.nombre
        recibos++
      }
    }
    entradas.push({ nombre: `${tabla}.csv`, datos: Buffer.from(tablaCsv(tabla, filas), 'utf8') })
  }

  entradas.unshift({
    nombre: 'LEEME.txt',
    datos: Buffer.from(leeme(perfil.name, fecha, conteo, recibos), 'utf8'),
  })
  return armarZip(entradas, fecha)
}

function leeme(
  nombre: string,
  fecha: Date,
  conteo: { tabla: string; filas: number }[],
  recibos: number,
): string {
  const total = conteo.reduce((s, c) => s + c.filas, 0)
  const anchos = Math.max(...conteo.map((c) => c.tabla.length))
  return [
    `Finply · datos de "${nombre}"`,
    `Exportado el ${fecha.toISOString().slice(0, 10)} · esquema ${SCHEMA_VERSION} · ${total} registros`,
    '',
    'QUÉ ES ESTO',
    '  Una hoja por tabla, en CSV, para abrirlas donde quieras. Los ids se',
    '  conservan porque son lo que liga una hoja con otra: la columna',
    '  account_id de transactions.csv es la columna id de accounts.csv.',
    '',
    'QUÉ NO ES',
    '  El archivo para volver a entrar a Finply. Ese es el respaldo JSON de',
    '  Ajustes → La app, que se lleva todos los perfiles y se puede restaurar.',
    '  Esto es lo contrario: es para salir.',
    '',
    'LAS CIFRAS',
    '  El dinero va en pesos con dos decimales, no en centavos; las tasas en',
    '  por ciento, no en puntos base. Adentro Finply los guarda como enteros',
    '  para no perder un centavo, y aquí se les quita esa escala junto con el',
    `  sufijo del nombre: amount_cents se llama amount.`,
    '  Las fechas van como AAAA-MM-DD y ordenan solas.',
    '',
    recibos > 0
      ? `LOS RECIBOS\n  ${recibos} archivo(s) en recibos/. En tx_attachments.csv, la columna\n  ${encabezadoDe(COLUMNA_RECIBO)} dice cuál es el de cada renglón.`
      : 'LOS RECIBOS\n  Este libro no tiene recibos adjuntos.',
    '',
    'LAS HOJAS',
    ...conteo.map(
      (c) => `  ${c.tabla.padEnd(anchos)}  ${String(c.filas).padStart(6)}${c.filas === 0 ? '  (vacía)' : ''}`,
    ),
    '',
  ].join('\n')
}

// ── Los reportes, tal como se leen en pantalla ────────────────────────────
//
// Salen de **la misma función** que llena la vista, no de una segunda consulta
// parecida. Es la regla de siempre en este libro: dos caminos hacia la misma
// cifra acaban diciendo dos cifras, y aquí sería peor que en cualquier lado
// porque el archivo se guarda y la pantalla no. Hay prueba de que el total del
// CSV es exactamente el de la respuesta JSON.
//
// Lo que sí se separa de la pantalla es **cuánto** sale: la vista dibuja las
// diez categorías más grandes porque una gráfica de cuarenta barras no se lee,
// y el archivo se las lleva todas. Es la misma decisión que tomó la Fase 1 con
// el CSV de movimientos, que ignora la paginación a propósito.

/** El nombre de un perfil, para encabezar lo que se baje. */
function nombreDelPerfil(profileId: number): string {
  const fila = db.prepare('SELECT name FROM profiles WHERE id = ?').get(profileId) as
    | { name: string }
    | undefined
  if (!fila) throw httpError(404, 'Ese perfil no existe')
  return fila.name
}

/** 0.3421 → '34.21', y `null` → vacío: sin ingresos no hay tasa que escribir. */
function tasaCsv(tasa: number | null): string {
  return tasa === null ? '' : (tasa * 100).toFixed(2)
}

/** El reporte anual entero: totales, meses, patrimonio, categorías y fuentes. */
export function reporteAnualCsv(profileId: number, year: number): string {
  const nombre = nombreDelPerfil(profileId)
  const r = reporteAnual(profileId, year)
  const patrimonio = new Map(r.patrimonio.map((p) => [p.month, p]))

  // El desglose baja colgando de su padre, como en la vista: el renglón del
  // padre trae su total (que ya incluye a los hijos) y cada hijo el suyo.
  const conHijos = (
    filas: { name: string; cents: number; hijos: { name: string; cents: number }[] }[],
  ): string[][] =>
    filas.flatMap((c) => [
      [celdaTexto(c.name), '', montoCsv(c.cents)],
      ...c.hijos.map((h) => [celdaTexto(c.name), celdaTexto(h.name), montoCsv(h.cents)]),
    ])

  return armarCsvSecciones(`Finply · reporte de ${nombre} · ${year}`, [
    {
      titulo: 'Totales del año',
      encabezados: ['concepto', 'monto'],
      filas: [
        ['Entró', montoCsv(r.totales.incomeCents)],
        ['Salió', montoCsv(r.totales.expenseCents)],
        ['Quedó', montoCsv(r.totales.netCents)],
        ['Tasa de ahorro (%)', tasaCsv(r.totales.tasaAhorro)],
        ['Mediana de ingreso', r.totales.medianaIngresoCents === null ? '' : montoCsv(r.totales.medianaIngresoCents)],
        ['Mediana de gasto', r.totales.medianaGastoCents === null ? '' : montoCsv(r.totales.medianaGastoCents)],
        ['Meses con movimiento', String(r.totales.mesesConMovimiento)],
      ],
    },
    {
      titulo: 'Mes a mes',
      encabezados: ['mes', 'ingreso', 'gasto', 'neto', 'patrimonio al cierre'],
      filas: r.meses.map((m) => [
        m.month,
        montoCsv(m.incomeCents),
        montoCsv(m.expenseCents),
        montoCsv(m.netCents),
        montoCsv(patrimonio.get(m.month)?.totalCents ?? 0),
      ]),
    },
    {
      titulo: 'En qué se fue',
      encabezados: ['categoría', 'subcategoría', 'gasto'],
      filas: conHijos(
        r.porCategoria.map((c) => ({
          name: c.name,
          cents: c.expenseCents,
          hijos: c.hijos.map((h) => ({ name: h.name, cents: h.expenseCents })),
        })),
      ),
    },
    {
      titulo: 'De dónde vino',
      encabezados: ['categoría', 'subcategoría', 'ingreso'],
      filas: conHijos(
        r.porFuente.map((c) => ({
          name: c.name,
          cents: c.incomeCents,
          hijos: c.hijos.map((h) => ({ name: h.name, cents: h.incomeCents })),
        })),
      ),
    },
    {
      titulo: 'Por etiqueta',
      encabezados: ['etiqueta', 'gasto'],
      filas: r.porEtiqueta.map((e) => [celdaTexto(e.name), montoCsv(e.expenseCents)]),
    },
    {
      titulo: 'Patrimonio por renglón',
      encabezados: ['mes', 'cuentas', 'inversiones', 'bienes', 'te deben', 'debes', 'total'],
      filas: r.patrimonio.map((p) => [
        p.month,
        montoCsv(p.cuentasCents),
        montoCsv(p.inversionesCents),
        montoCsv(p.bienesCents),
        montoCsv(p.porCobrarCents),
        montoCsv(p.porPagarCents),
        montoCsv(p.totalCents),
      ]),
    },
  ])
}

/** Dos periodos, categoría por categoría, con las fechas que se compararon. */
export function comparativaCsv(
  profileId: number,
  actual: { desde: string; hasta: string },
  previo?: { desde: string; hasta: string },
): string {
  const nombre = nombreDelPerfil(profileId)
  const c = comparativa(profileId, actual, previo)
  const rotulo = (p: { desde: string; hasta: string }) =>
    p.desde === p.hasta ? p.desde : `${p.desde} a ${p.hasta}`

  return armarCsvSecciones(
    `Finply · ${nombre} · ${rotulo(c.actual)} contra ${rotulo(c.previo)}`,
    [
      {
        titulo: 'Los dos periodos',
        encabezados: ['periodo', 'desde', 'hasta', 'ingreso', 'gasto'],
        filas: [
          ['Este', c.actual.desde, c.actual.hasta, montoCsv(c.actual.incomeCents), montoCsv(c.actual.expenseCents)],
          ['Contra', c.previo.desde, c.previo.hasta, montoCsv(c.previo.incomeCents), montoCsv(c.previo.expenseCents)],
        ],
      },
      {
        titulo: 'Gasto por categoría',
        encabezados: ['categoría', rotulo(c.previo), rotulo(c.actual), 'diferencia'],
        filas: c.categorias.map((x) => [
          celdaTexto(x.name),
          montoCsv(x.previoCents),
          montoCsv(x.actualCents),
          montoCsv(x.deltaCents),
        ]),
      },
    ],
  )
}
