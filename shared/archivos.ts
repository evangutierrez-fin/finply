// Cómo se llama un archivo que sale de Finply. Módulo puro (R16).
//
// Vive aparte —y no dentro de `server/zip.ts`, que fue donde hizo falta
// primero— porque no es una regla del .zip: es la regla del **nombre**, y la
// usan tres puertas distintas que tienen que estar de acuerdo. La puerta de
// entrada (el validador del recibo), la de bajada (la cabecera
// `Content-Disposition`) y la del export completo (la ruta dentro del .zip).
// Dos de ellas ya se habían separado: el .zip cortaba `../../.ssh/config` y la
// bajada lo mandaba tal cual en la cabecera.

/**
 * Nombre seguro para un archivo que Finply entrega.
 *
 * Un recibo se llama como lo llamó el usuario, y ese texto acaba siendo una
 * **ruta** al descomprimir: `../../.ssh/config` escribiría fuera de la carpeta
 * destino en cualquier extractor descuidado. Y acaba también dentro de una
 * cabecera HTTP, donde un salto de línea no es un carácter raro sino el
 * separador entre dos cabeceras — Node se niega a mandarla y el recibo se
 * vuelve un archivo que entró al libro y ya no puede salir.
 *
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
