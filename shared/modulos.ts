// Módulos por perfil: qué secciones lleva este libro.
//
// **D16 · un módulo decide solo qué se ve, nunca qué tablas existen.** El
// esquema es siempre el completo, por tres razones que ya costaron caro en
// otras fases: encender un módulo a media vida del libro no puede exigir una
// migración (R1), el respaldo no puede depender de qué tenía activado quien lo
// generó, y apagar algo jamás puede perder un dato (R17). El costo es una base
// con tablas vacías, que en SQLite no cuesta nada.
//
// Módulo **puro**, usado por las dos mitades: el servidor calla las alertas y
// los eventos de calendario de un módulo apagado, el cliente arma el lomo. Si
// alguna vez llega a importar `db.ts`, rompe el build del frontend *y* la R16
// al mismo tiempo.

import type { ProfileKind } from './types.ts'

export type ModuloId =
  | 'tarjetas'
  | 'deudas'
  | 'bienes'
  | 'inversiones'
  | 'recurrencias'
  | 'presupuestos'
  | 'metas'
  | 'notas'
  | 'negocio'
  | 'inmuebles'
  | 'horas'
  | 'inventario'

export interface Modulo {
  id: ModuloId
  label: string
  /** Qué contesta, en una línea. Es lo que se lee en el alta del perfil. */
  descripcion: string
  /** Las vistas que aparecen y desaparecen con él. */
  vistas: readonly string[]
  /** Tipos de perfil que lo traen encendido mientras el usuario no opine. */
  omision: readonly ProfileKind[]
}

const TODOS: readonly ProfileKind[] = ['personal', 'negocio']

/**
 * El catálogo. Cada entrada es una sección que alguien reconoce por su nombre:
 * partirlo más fino ("¿quieres el aging?") convertiría el alta en un
 * cuestionario contable, y partirlo más grueso dejaría al libro personal
 * cargando la maquinaria del taller.
 */
export const MODULOS: readonly Modulo[] = [
  {
    id: 'tarjetas',
    label: 'Tarjetas de crédito',
    descripcion: 'Corte, fecha límite, pago para no generar intereses y compras a meses.',
    vistas: ['tarjetas'],
    omision: TODOS,
  },
  {
    id: 'deudas',
    label: 'Deudas y préstamos',
    descripcion: 'Lo que debes y lo que te deben, con tasa, plazo y tabla de amortización.',
    vistas: ['deudas'],
    omision: TODOS,
  },
  {
    id: 'bienes',
    label: 'Bienes',
    descripcion: 'La casa, el auto o la herramienta: lo que costaron y lo que valen hoy.',
    vistas: ['bienes'],
    omision: TODOS,
  },
  {
    // El simulador vive aquí y no aparte: su pregunta es "¿invierto o pago la
    // deuda?", y a quien no lleva inversiones no le queda pregunta.
    id: 'inversiones',
    label: 'Inversiones',
    descripcion: 'Aportes, unidades, valuaciones y rendimiento anualizado. Incluye el simulador.',
    vistas: ['inversiones', 'simulador'],
    omision: TODOS,
  },
  {
    id: 'recurrencias',
    label: 'Recurrencias y calendario',
    descripcion: 'La renta, el sueldo y las suscripciones, propuestas para que tú las asientes.',
    vistas: ['recurrencias', 'calendario'],
    omision: TODOS,
  },
  {
    id: 'presupuestos',
    label: 'Presupuestos',
    descripcion: 'Un tope por categoría y por mes, con su avance.',
    vistas: ['presupuestos'],
    omision: TODOS,
  },
  {
    id: 'metas',
    label: 'Metas',
    descripcion: 'Fondo de emergencia, viaje, enganche: cuánto llevas y si vas a tiempo.',
    vistas: ['metas'],
    omision: TODOS,
  },
  {
    id: 'notas',
    label: 'Notas',
    descripcion: 'Apuntes en hoja de libreta, fijables al tablero.',
    vistas: ['notas'],
    omision: TODOS,
  },
  {
    id: 'negocio',
    label: 'Negocio',
    descripcion:
      'Clientes y proveedores, facturas con vencimiento, antigüedad de saldos, estado de resultados y flujo proyectado.',
    vistas: ['contrapartes', 'facturas', 'negocio'],
    omision: ['negocio'],
  },
  // ── Módulos de giro (Fase 15) ─────────────────────────────────────────
  //
  // Los tres nacen **apagados para todo el mundo** (`omision` vacía), y esa es
  // toda la diferencia con los de arriba: cada uno es inútil para casi
  // cualquiera y decisivo para algunos. Un libro personal no tiene por qué
  // cargar con un almacén, y una panadería no tiene por qué cargar con horas
  // facturables.
  //
  // Nacer apagados no los esconde: aparecen con su descripción en el alta del
  // perfil y en Ajustes, que es donde se encienden. Y encenderlos no exige
  // migración porque las tablas ya existen (D16).
  {
    id: 'inmuebles',
    label: 'Inmuebles en renta',
    descripcion:
      'Inquilino, renta, depósito y mantenimiento de una propiedad que ya llevas como bien, y cuánto deja de verdad.',
    vistas: ['inmuebles'],
    omision: [],
  },
  {
    id: 'horas',
    label: 'Horas facturables',
    descripcion:
      'Horas por cliente con su tarifa, cuánto llevas trabajado sin cobrar, y de ahí la factura.',
    vistas: ['horas'],
    omision: [],
  },
  {
    id: 'inventario',
    label: 'Inventario simple',
    descripcion:
      'Entradas, salidas, qué vale lo que tienes y cuánto costó lo que vendiste, a costo promedio.',
    vistas: ['inventario'],
    omision: [],
  },
]

export const MODULO_IDS: readonly ModuloId[] = MODULOS.map((m) => m.id)

/**
 * Lo que existe siempre y no se puede apagar: sin esto no hay libro. Ajustes
 * entra aquí porque es desde donde se vuelven a encender los demás — apagarlo
 * dejaría al usuario encerrado.
 */
export const VISTAS_NUCLEO: readonly string[] = [
  'resumen',
  'movimientos',
  'cuentas',
  'taxonomia',
  'reportes',
  'analisis',
  'importar',
  // "¿Llego a fin de mes?" no es de un módulo: se contesta con las cuentas, que
  // son núcleo. Los módulos la **alimentan** —recurrencias, tarjetas, deudas,
  // facturas— y cuando el que más aporta está apagado, la vista lo dice en vez
  // de proyectar sobre nada.
  'flujo',
  'ajustes',
]

const VISTA_A_MODULO = new Map<string, ModuloId>(
  MODULOS.flatMap((m) => m.vistas.map((v) => [v, m.id] as [string, ModuloId])),
)

/** A qué módulo pertenece una vista. `null` es núcleo: no se apaga. */
export function moduloDeVista(vista: string): ModuloId | null {
  return VISTA_A_MODULO.get(vista) ?? null
}

export function esModulo(valor: string): valor is ModuloId {
  return VISTA_A_MODULO.has(valor) || (MODULO_IDS as string[]).includes(valor)
}

/** El juego que trae un perfil de este tipo mientras nadie opine. */
export function porOmision(kind: ProfileKind): ModuloId[] {
  return MODULOS.filter((m) => m.omision.includes(kind)).map((m) => m.id)
}

/**
 * Resuelve qué módulos están activos.
 *
 * Una fila explícita manda; **sin fila manda el juego por omisión del tipo**.
 * Esa regla es lo que vuelve inofensiva a la migración 13 —que no rellena
 * nada— y lo que salva dos casos que si no dejarían a alguien sin secciones:
 * un respaldo viejo, anterior a esta fase, cuyo JSON no trae la tabla; y un
 * módulo nuevo que se agregue en una versión futura, que aparece con su propio
 * valor por omisión en vez de nacer apagado para todo el mundo.
 */
export function resolverModulos(
  kind: ProfileKind,
  overrides: Map<string, boolean> | Record<string, boolean> = {},
): ModuloId[] {
  const leer = (id: ModuloId): boolean | undefined =>
    overrides instanceof Map ? overrides.get(id) : overrides[id]
  return MODULOS.filter((m) => leer(m.id) ?? m.omision.includes(kind)).map((m) => m.id)
}

/** ¿Se ve esta vista con estos módulos? El núcleo siempre se ve. */
export function vistaVisible(vista: string, modulos: readonly ModuloId[]): boolean {
  const modulo = moduloDeVista(vista)
  return modulo === null || modulos.includes(modulo)
}
