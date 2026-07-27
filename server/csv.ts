// Generación de CSV.
//
// El punto delicado es la inyección de fórmulas: si un concepto empieza con
// `=`, `+`, `-`, `@` (o tab/retorno), Excel y LibreOffice lo interpretan como
// fórmula al abrir el archivo. `=HYPERLINK(...)` o `=cmd|...` en la nota de un
// movimiento se vuelven ejecutables en la máquina de quien abra el CSV.
// Se neutraliza anteponiendo una comilla simple.

const PELIGROSO = /^[=+\-@\t\r]/

/** Marca de orden de bytes. Como escape, no literal: un BOM invisible en el
 *  código es un carácter que cualquier editor puede comerse sin avisar. */
const BOM = '\uFEFF'

/**
 * Prepara un texto **del usuario** para una celda. No usar en valores que
 * genera Finply (montos con signo, fechas): ahí el prefijo estorbaría y no
 * hay riesgo, porque no vienen de una entrada libre.
 */
export function celdaTexto(valor: string | null | undefined): string {
  const texto = valor ?? ''
  return PELIGROSO.test(texto) ? `'${texto}` : texto
}

/** Escapa una celda ya saneada según RFC 4180. */
function escapar(celda: string): string {
  return /[",\r\n]/.test(celda) ? `"${celda.replace(/"/g, '""')}"` : celda
}

/**
 * Une filas en un CSV. Las celdas ya deben venir saneadas (`celdaTexto` para
 * lo que escribió el usuario). Lleva BOM para que Excel reconozca UTF-8 y no
 * destroce los acentos.
 */
export function armarCsv(encabezados: string[], filas: string[][]): string {
  const lineas = [encabezados, ...filas].map((fila) => fila.map(escapar).join(','))
  return `${BOM}${lineas.join('\r\n')}\r\n`
}

/** Centavos enteros → '1234.56', con punto decimal y sin separador de miles. */
export function montoCsv(cents: number): string {
  const signo = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  return `${signo}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

// ── Lectura ───────────────────────────────────────────────────────────────

const SEPARADORES = [',', ';', '\t', '|'] as const

/**
 * Adivina el separador contando cuál aparece más en la primera línea que no
 * esté dentro de comillas. Los bancos en español exportan con `;` tan seguido
 * como con `,`, y equivocarse deja todo el archivo en una sola columna.
 */
export function detectarSeparador(texto: string): string {
  const primeraLinea = texto.slice(0, 4000).split(/\r?\n/)[0] ?? ''
  let mejor = ','
  let maximo = -1
  for (const sep of SEPARADORES) {
    let cuenta = 0
    let enComillas = false
    for (const ch of primeraLinea) {
      if (ch === '"') enComillas = !enComillas
      else if (ch === sep && !enComillas) cuenta++
    }
    if (cuenta > maximo) {
      maximo = cuenta
      mejor = sep
    }
  }
  return mejor
}

/**
 * Parser de CSV según RFC 4180: respeta celdas entrecomilladas, comillas
 * escapadas (`""`) y saltos de línea dentro de una celda. Devuelve filas de
 * texto crudo; interpretarlas es trabajo de quien llama.
 */
export function parseCsv(texto: string, separador = detectarSeparador(texto)): string[][] {
  // El BOM que escribimos al exportar reaparece al reimportar el archivo.
  const limpio = texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto

  const filas: string[][] = []
  let fila: string[] = []
  let celda = ''
  let enComillas = false
  let i = 0

  const cerrarCelda = () => {
    fila.push(celda)
    celda = ''
  }
  const cerrarFila = () => {
    cerrarCelda()
    filas.push(fila)
    fila = []
  }

  while (i < limpio.length) {
    const ch = limpio[i]!
    if (enComillas) {
      if (ch === '"') {
        if (limpio[i + 1] === '"') {
          celda += '"'
          i += 2
          continue
        }
        enComillas = false
        i++
        continue
      }
      celda += ch
      i++
      continue
    }
    if (ch === '"' && celda === '') {
      enComillas = true
      i++
      continue
    }
    if (ch === separador) {
      cerrarCelda()
      i++
      continue
    }
    if (ch === '\n') {
      cerrarFila()
      i++
      continue
    }
    if (ch === '\r') {
      // Sirve igual para CRLF que para un \r suelto.
      cerrarFila()
      if (limpio[i + 1] === '\n') i++
      i++
      continue
    }
    celda += ch
    i++
  }
  if (celda !== '' || fila.length > 0) cerrarFila()

  // Las líneas en blanco del final no son filas.
  return filas.filter((f) => f.some((c) => c.trim() !== ''))
}
