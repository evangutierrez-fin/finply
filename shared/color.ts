// Contraste de color, calculado — no una lista de colores permitidos.
//
// Módulo PURO a propósito (R16): no importa nada que abra la base, así que las
// pruebas pueden importarlo de forma estática y las **dos mitades** usan la
// misma aritmética. El servidor rechaza una tinta que no cumple; el cliente
// enseña el mismo número mientras el usuario elige. Si fueran dos cálculos,
// serían dos verdades.
//
// La regla es R10: cualquier paleta personalizada valida contraste AA. Y hay
// que validarla en **los dos temas**: una tinta que cumple sobre el papel claro
// puede desaparecer sobre el oscuro. De hecho ningún color cumple en los dos a
// la vez —el papel claro pide tinta oscura y el oscuro la pide clara—, y por
// eso una tinta personalizada son dos colores, uno por tema, igual que los
// cuatro presets que Finply trae desde siempre.

export interface Rgb {
  r: number
  g: number
  b: number
}

/** '#1d5c3d' o '#abc' → componentes 0–255. `null` si no es un color. */
export function parseHex(hex: string): Rgb | null {
  const limpio = hex.trim().toLowerCase()
  const corto = /^#([0-9a-f]{3})$/.exec(limpio)
  const largo = /^#([0-9a-f]{6})$/.exec(limpio)
  const cuerpo = corto ? corto[1]!.replace(/./g, (c) => c + c) : largo?.[1]
  if (!cuerpo) return null
  return {
    r: parseInt(cuerpo.slice(0, 2), 16),
    g: parseInt(cuerpo.slice(2, 4), 16),
    b: parseInt(cuerpo.slice(4, 6), 16),
  }
}

/** Siempre en la forma larga y en minúsculas, que es como se guarda. */
export function normalizarHex(hex: string): string | null {
  const rgb = parseHex(hex)
  if (!rgb) return null
  const dos = (n: number) => n.toString(16).padStart(2, '0')
  return `#${dos(rgb.r)}${dos(rgb.g)}${dos(rgb.b)}`
}

/** Luminancia relativa de WCAG 2.1: 0 es negro, 1 es blanco. */
export function luminancia({ r, g, b }: Rgb): number {
  const canal = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b)
}

/**
 * Razón de contraste WCAG entre dos colores: de 1 (idénticos) a 21
 * (blanco contra negro). No depende del orden.
 */
export function contraste(a: string, b: string): number {
  const ca = parseHex(a)
  const cb = parseHex(b)
  if (!ca || !cb) return 0
  const la = luminancia(ca)
  const lb = luminancia(cb)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** El mínimo de AA para texto normal. La tinta se usa como texto de liga. */
export const AA_TEXTO = 4.5

export type Tema = 'claro' | 'oscuro'

/**
 * Las superficies contra las que la tinta tiene que verse en cada tema. Son
 * las de `tokens.css`, y están aquí las **peores** de cada una: en el tema
 * claro la hoja es más clara que el papel, y en el oscuro la hoja es más clara
 * que el fondo. El texto de los botones cuenta porque la tinta también se usa
 * como fondo de botón, con `--boton-texto` encima.
 */
export const SUPERFICIES: Record<Tema, { papel: string; hoja: string; botonTexto: string }> = {
  claro: { papel: '#eef1e4', hoja: '#f7f8ee', botonTexto: '#fdfdf7' },
  oscuro: { papel: '#10160f', hoja: '#212b21', botonTexto: '#10160f' },
}

/**
 * Los cuatro presets, cada uno con su color por tema. Es la misma tabla que
 * `src/styles/tokens.css` —si se cambia allá, se cambia aquí—: aquí sirve para
 * arrancar la tinta propia desde algo válido y para que la prueba mida que las
 * tintas de Finply cumplen AA, en vez de darlo por hecho.
 */
export const PRESETS: Record<string, { claro: string; oscuro: string }> = {
  verde: { claro: '#1d5c3d', oscuro: '#5aa87e' },
  laton: { claro: '#8f6420', oscuro: '#cfa24f' },
  cobalto: { claro: '#2c4a74', oscuro: '#88abd8' },
  vino: { claro: '#7c2f42', oscuro: '#cd7f92' },
}

export interface Veredicto {
  /** El peor contraste de la tinta contra las superficies de su tema. */
  ratio: number
  cumple: boolean
  /** Contra qué superficie salió peor; sirve para explicarlo. */
  contra: string
}

/**
 * ¿Esta tinta se puede leer en este tema? Se mide contra **todas** las
 * superficies donde aparece y manda la peor: que contraste con el papel no
 * sirve de nada si se pierde sobre la hoja.
 */
export function evaluarTinta(hex: string, tema: Tema): Veredicto {
  const s = SUPERFICIES[tema]
  const contra: { nombre: string; color: string }[] = [
    { nombre: 'el papel', color: s.papel },
    { nombre: 'la hoja', color: s.hoja },
    { nombre: 'el texto de los botones', color: s.botonTexto },
  ]
  let peor = contra[0]!
  let ratio = Infinity
  for (const c of contra) {
    const r = contraste(hex, c.color)
    if (r < ratio) {
      ratio = r
      peor = c
    }
  }
  // Dos decimales: es lo que se enseña y lo que se compara, y así el número de
  // la vista es exactamente el que decidió el servidor.
  const redondeado = Math.round(ratio * 100) / 100
  return { ratio: redondeado, cumple: redondeado >= AA_TEXTO, contra: peor.nombre }
}
