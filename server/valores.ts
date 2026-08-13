// Interpretación de fechas y montos que vienen de un archivo ajeno.
//
// Módulo deliberadamente puro: no importa `db.ts` ni nada que abra la base.
// Así las pruebas pueden importarlo de forma estática sin arrastrar la
// conexión, que es lo que una vez llenó el libro real de datos de prueba.
//
// Ambos formatos son ambiguos —03/04/2026 puede ser marzo o abril, 1,234
// puede ser mil o uno— así que aquí se decide con reglas explícitas y la
// vista previa muestra el valor resultante para que el usuario lo verifique.

import { esFechaReal } from '../shared/fechas.ts'
import { MAX_CENTAVOS } from '../shared/formato.ts'

/**
 * Texto → centavos con signo, o null si no es un monto.
 *
 * Con dos separadores distintos, el **último** es el decimal: así `1,234.56`
 * y `1.234,56` se leen bien sin adivinar la región. Con uno solo, tres dígitos
 * detrás significan miles (`1,234` = 1234) y otra cantidad, decimales
 * (`1,23` = 1.23). Los paréntesis son negativos, como en contabilidad.
 */
export function parseMonto(raw: string): number | null {
  let texto = raw.trim()
  if (!texto) return null

  let negativo = false
  if (/^\(.*\)$/.test(texto)) {
    negativo = true
    texto = texto.slice(1, -1)
  }
  texto = texto.replace(/[$\s ]/g, '').replace(/(MXN|USD|EUR)/gi, '')
  if (texto.startsWith('-')) {
    negativo = true
    texto = texto.slice(1)
  } else if (texto.startsWith('+')) {
    texto = texto.slice(1)
  }
  if (!/^[\d.,]+$/.test(texto)) return null

  const ultimaComa = texto.lastIndexOf(',')
  const ultimoPunto = texto.lastIndexOf('.')
  let entero = texto
  let decimales = ''

  if (ultimaComa >= 0 && ultimoPunto >= 0) {
    const corte = Math.max(ultimaComa, ultimoPunto)
    entero = texto.slice(0, corte)
    decimales = texto.slice(corte + 1)
  } else if (ultimaComa >= 0 || ultimoPunto >= 0) {
    const corte = Math.max(ultimaComa, ultimoPunto)
    const cola = texto.slice(corte + 1)
    if (cola.length === 3 && texto.slice(0, corte).length > 0) {
      entero = texto // separador de miles
    } else {
      entero = texto.slice(0, corte)
      decimales = cola
    }
  }

  // La parte entera solo puede venir en dígitos corridos o agrupada de tres
  // en tres. Sin esta comprobación, basura como "1.2.3.4" se colaría como
  // 12.34 después de quitarle los separadores.
  if (entero !== '' && !/^\d+$/.test(entero) && !/^\d{1,3}([.,]\d{3})+$/.test(entero)) return null
  entero = entero.replace(/[.,]/g, '')
  if (!/^\d*$/.test(decimales)) return null
  if (entero === '' && decimales === '') return null
  if (decimales.length > 2) return null

  const cents = Number(entero || '0') * 100 + Number(decimales.padEnd(2, '0') || '0')
  // Finito no basta, y por eso esto no es una precaución teórica: una columna
  // con veinte dígitos daba `1e22`, que es finito, no es entero seguro y se
  // escribía tal cual porque el import no pasa por el validador de la API. El
  // saldo de la cuenta dejaba de ser un entero de centavos y se volvía un
  // flotante — el libro entero deja de cuadrar y nadie ve dónde. El techo es el
  // mismo de la API (`MAX_CENTAVOS`) para que las dos puertas no discrepen.
  if (!Number.isSafeInteger(cents) || cents > MAX_CENTAVOS) return null
  return negativo ? -cents : cents
}

/**
 * La fecha armada, con el **año a cuatro dígitos**.
 *
 * El padding no es cosmético: sin él, un archivo con `0026-03-05` producía la
 * cadena `26-03-05`, que no es AAAA-MM-DD y ordena antes que cualquier fecha
 * de verdad. El import escribe en la base sin pasar por el validador de la
 * API, así que lo que salga de aquí es lo que se guarda.
 */
const iso = (y: number, m: number, d: number) =>
  `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

/**
 * Texto → 'AAAA-MM-DD', o null si no es una fecha válida.
 *
 * Con formato `03/04/2026` se toma **día primero**, que es la convención en
 * México y en casi toda Latinoamérica. La vista previa muestra la fecha
 * resultante precisamente para que un archivo en otro formato se note.
 *
 * Que el día **exista** lo decide `esFechaReal`, la misma función que usa el
 * validador de la API. Aquí había una copia con su propia aritmética, y una
 * copia de una regla que debe coincidir es una regla que se separa: esta
 * aceptaba años de dos dígitos como si fueran del siglo XX, así que el 29 de
 * febrero de un bisiesto podía caer del lado equivocado.
 */
export function parseFecha(raw: string): string | null {
  const texto = raw.trim()
  if (!texto) return null

  const armar = (y: number, m: number, d: number): string | null => {
    if (m < 1 || m > 12 || d < 1 || d > 31) return null
    const fecha = iso(y, m, d)
    return esFechaReal(fecha) ? fecha : null
  }

  const conAnioPrimero = texto.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)
  if (conAnioPrimero) {
    const [, y, m, d] = conAnioPrimero.map(Number) as [number, number, number, number]
    return armar(y, m, d)
  }

  const diaPrimero = texto.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/)
  if (diaPrimero) {
    let [, d, m, y] = diaPrimero.map(Number) as [number, number, number, number]
    if (y < 100) y += y < 70 ? 2000 : 1900
    // Un "mes" mayor a 12 solo puede ser el día: el archivo venía al revés.
    if (m > 12 && d <= 12) [d, m] = [m, d]
    return armar(y, m, d)
  }
  return null
}

/** Minúsculas, sin acentos y con separadores normalizados, para comparar nombres. */
export function normalizar(texto: string): string {
  return texto
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
}
