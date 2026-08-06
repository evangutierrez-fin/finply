// Un archivo .zip, escrito a mano.
//
// Hace falta porque el export completo son **muchos** archivos —una hoja por
// tabla, más los recibos— y un navegador solo sabe bajar uno. Un .zip es el
// contenedor que abre cualquier sistema operativo sin instalar nada, que es
// justo la promesa del export: que lo tuyo se pueda abrir fuera de Finply.
//
// Se escribe aquí en vez de traer una dependencia porque el formato que se
// necesita cabe en un archivo: cabecera local, datos, directorio central y
// remate. Nada de cifrado, nada de ZIP64 (topes abajo), nada de carpetas
// propias — una entrada con `/` en el nombre ya es una carpeta para cualquier
// lector. `zlib.crc32` y `zlib.deflateRawSync` ponen las dos únicas piezas
// que serían delicadas de escribir a mano.

import { crc32, deflateRawSync } from 'node:zlib'

export interface EntradaZip {
  /** Ruta dentro del archivo. Las barras son carpetas. */
  nombre: string
  datos: Buffer
}

/** Sin ZIP64 no caben más de estos. Ningún libro se acerca, pero se comprueba. */
const MAX_ENTRADAS = 0xffff
const MAX_BYTES = 0xffffffff

const METODO_DEFLATE = 8
/** Bit 11: el nombre va en UTF-8. Sin él, un recibo con acentos sale roto. */
const BANDERA_UTF8 = 0x0800
/** La versión que hace falta para extraer: 2.0, que es la que trae deflate. */
const VERSION = 20

/** Fecha y hora en el formato de MS-DOS, que es lo que el .zip guarda. */
function fechaDos(d: Date): { hora: number; dia: number } {
  return {
    hora: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    dia: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}

/**
 * Arma un .zip con las entradas dadas, en ese orden.
 *
 * `fecha` es la que llevan todas las entradas: pasarla explícita hace que dos
 * exports del mismo libro den el mismo archivo, que es lo que permite
 * comprobarlo byte a byte en una prueba.
 */
export function armarZip(entradas: EntradaZip[], fecha = new Date()): Buffer {
  if (entradas.length > MAX_ENTRADAS) {
    throw new Error(`Un .zip sin ZIP64 no lleva más de ${MAX_ENTRADAS} archivos`)
  }
  const { hora, dia } = fechaDos(fecha)

  const locales: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0

  for (const entrada of entradas) {
    const nombre = Buffer.from(entrada.nombre, 'utf8')
    const crudo = entrada.datos
    const comprimido = deflateRawSync(crudo)
    // Comprimir puede salir más grande que no comprimir —pasa con lo ya
    // comprimido, que es justo el caso de un recibo en JPG—, y entonces se
    // guarda tal cual: el .zip admite las dos cosas por entrada.
    const guardarCrudo = comprimido.length >= crudo.length
    const datos = guardarCrudo ? crudo : comprimido
    const metodo = guardarCrudo ? 0 : METODO_DEFLATE
    const suma = crc32(crudo)

    if (crudo.length > MAX_BYTES || datos.length > MAX_BYTES) {
      throw new Error(`"${entrada.nombre}" no cabe en un .zip sin ZIP64`)
    }

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(VERSION, 4)
    local.writeUInt16LE(BANDERA_UTF8, 6)
    local.writeUInt16LE(metodo, 8)
    local.writeUInt16LE(hora, 10)
    local.writeUInt16LE(dia, 12)
    local.writeUInt32LE(suma, 14)
    local.writeUInt32LE(datos.length, 18)
    local.writeUInt32LE(crudo.length, 22)
    local.writeUInt16LE(nombre.length, 26)
    local.writeUInt16LE(0, 28)
    locales.push(local, nombre, datos)

    const dir = Buffer.alloc(46)
    dir.writeUInt32LE(0x02014b50, 0)
    dir.writeUInt16LE(VERSION, 4)
    dir.writeUInt16LE(VERSION, 6)
    dir.writeUInt16LE(BANDERA_UTF8, 8)
    dir.writeUInt16LE(metodo, 10)
    dir.writeUInt16LE(hora, 12)
    dir.writeUInt16LE(dia, 14)
    dir.writeUInt32LE(suma, 16)
    dir.writeUInt32LE(datos.length, 20)
    dir.writeUInt32LE(crudo.length, 24)
    dir.writeUInt16LE(nombre.length, 28)
    // Extra, comentario, disco, atributos internos y externos: todo en cero.
    dir.writeUInt32LE(offset, 42)
    central.push(dir, nombre)

    offset += local.length + nombre.length + datos.length
  }

  const cuerpo = Buffer.concat(locales)
  const directorio = Buffer.concat(central)

  const remate = Buffer.alloc(22)
  remate.writeUInt32LE(0x06054b50, 0)
  remate.writeUInt16LE(entradas.length, 8)
  remate.writeUInt16LE(entradas.length, 10)
  remate.writeUInt32LE(directorio.length, 12)
  remate.writeUInt32LE(cuerpo.length, 16)

  return Buffer.concat([cuerpo, directorio, remate])
}

/**
 * Nombre seguro para una entrada. Un recibo se llama como lo llamó el usuario,
 * y ese texto acaba siendo una **ruta** al descomprimir: `../../.ssh/config`
 * escribiría fuera de la carpeta destino en cualquier extractor descuidado.
 * Se corta a lo que sí es un nombre de archivo.
 */
export function nombreSeguro(texto: string, porOmision = 'archivo'): string {
  const limpio = texto
    .replace(/[\\/]/g, '-')
    // Nulos y control: como escape, no literales — un salto de línea dentro
    // del nombre partiría la ruta en dos y un editor se lo come sin avisar.
    .replace(/[\u0000-\u001f]/g, '')
    // Dos puntos seguidos nunca son parte de un nombre: son el salto de
    // carpeta. Se colapsan antes de quitar lo que sobra por delante.
    .replace(/\.{2,}/g, '.')
    .replace(/^[.\-\s]+/, '')
    .trim()
    .slice(0, 100)
  return limpio === '' ? porOmision : limpio
}
