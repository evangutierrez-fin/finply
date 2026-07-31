import { z } from 'zod'
import { AA_TEXTO, evaluarTinta, normalizarHex } from '../shared/color.ts'
import { MAX_UNIDADES_E8 } from '../shared/inversiones.ts'
import { MODULO_IDS, type ModuloId } from '../shared/modulos.ts'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (AAAA-MM-DD)')
const isoMonth = z.string().regex(/^\d{4}-\d{2}$/, 'Mes inválido (AAAA-MM)')

/**
 * Una tinta personalizada para un tema. `null` vuelve al preset.
 *
 * El contraste **se calcula**, no se compara contra una lista de colores
 * permitidos, y se mide en el tema donde va a usarse: R10 no se cumple
 * autorizando colores bonitos, se cumple midiendo. La misma función corre en
 * el cliente mientras el usuario elige, así que el número que ve es el que
 * decide aquí.
 */
function tinta(tema: 'claro' | 'oscuro') {
  return z
    .string()
    .transform((raw, ctx) => {
      const hex = normalizarHex(raw)
      if (!hex) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Ese color no es un hex (#1d5c3d)' })
        return z.NEVER
      }
      const { ratio, cumple, contra } = evaluarTinta(hex, tema)
      if (!cumple) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            `Esa tinta contrasta ${ratio}:1 con ${contra} del tema ${tema} y hacen falta ` +
            `${AA_TEXTO}:1 para leerla. Prueba una ${tema === 'claro' ? 'más oscura' : 'más clara'}.`,
        })
        return z.NEVER
      }
      return hex
    })
    .nullish()
}

export const profileInput = z.object({
  name: z.string().trim().min(1, 'El perfil necesita un nombre').max(60),
  kind: z.enum(['personal', 'negocio']).default('personal'),
  accent: z.enum(['verde', 'laton', 'cobalto', 'vino']).default('verde'),
  /** Ausentes dejan la tinta como estaba; `null` explícito vuelve al preset. */
  accentHex: tinta('claro'),
  accentHexDark: tinta('oscuro'),
  /** Cómo llama este perfil a su dimensión libre. La nombra el usuario (R15). */
  dimensionLabel: z.string().trim().min(1).max(24).default('Proyecto'),
  /**
   * Las secciones que lleva el libro. **Ausente ≠ vacío**, igual que las
   * etiquetas de un movimiento: ausente deja los módulos como estaban (o en el
   * juego por omisión del tipo, si nadie ha opinado); un arreglo vacío es una
   * elección legítima —un libro de puro movimiento— y se guarda como tal.
   */
  modules: z.array(z.enum(MODULO_IDS as [ModuloId, ...ModuloId[]])).optional(),
})

export const profilePatch = profileInput.partial()

const diaDelMes = z
  .number()
  .int()
  .min(1, 'El día va del 1 al 31')
  .max(31, 'El día va del 1 al 31')

export const accountInput = z.object({
  profileId: z.number().int().positive(),
  name: z.string().trim().min(1, 'La cuenta necesita un nombre').max(60),
  type: z.enum(['efectivo', 'banco', 'tarjeta', 'ahorro', 'otro']).default('efectivo'),
  currency: z.string().trim().length(3).toUpperCase().default('MXN'),
  openingCents: z.number().int().default(0),
  // Datos de tarjeta. `null` explícito los borra; ausentes los dejan como
  // estaban, que es la diferencia entre "quítalo" y "no opiné".
  creditLimitCents: z.number().int().nonnegative('El límite no puede ser negativo').nullish(),
  cutDay: diaDelMes.nullish(),
  dueDay: diaDelMes.nullish(),
  /** Debajo de esto, Finply avisa. `null` quita el aviso. */
  minBalanceCents: z.number().int().nullish(),
  institution: z.string().trim().max(60).default(''),
  sortOrder: z.number().int().min(-999).max(999).default(0),
  // Lo que de verdad cuesta la tarjeta (Fase 14). Los tres los copia el
  // usuario de su contrato: Finply no supone la tasa ni el mínimo de ningún
  // banco (R15). El tope de 200 % anual deja pasar cualquier tarjeta real y
  // ataja un dedazo de un cero.
  annualRateBp: z.number().int().min(0).max(2_000_000, 'Esa tasa no es de una tarjeta').nullish(),
  /** Porcentaje del saldo que exige el pago mínimo, en puntos base. */
  minPaymentBp: z.number().int().min(0).max(10_000, 'El mínimo no puede pasar del 100 %').nullish(),
  minPaymentFloorCents: z.number().int().nonnegative().nullish(),
})

export const accountPatch = accountInput.omit({ profileId: true }).partial().extend({
  archived: z.boolean().optional(),
})

export const categoryInput = z.object({
  profileId: z.number().int().positive(),
  name: z.string().trim().min(1).max(40),
  kind: z.enum(['ingreso', 'gasto']),
})

// El tipo de una categoría no se cambia: sus movimientos ya están clasificados
// como ingreso o gasto y cambiarlo los dejaría mal etiquetados en masa.
export const categoryPatch = z.object({
  name: z.string().trim().min(1, 'La categoría necesita un nombre').max(40),
  // El papel en el estado de resultados. `null` explícito la deja sin
  // clasificar, que es distinto de no mandarlo (deja lo que tenía).
  role: z.enum(['costo_venta', 'gasto_fijo', 'gasto_variable']).nullish(),
})

export const categoryDeleteQuery = z.object({
  /** Categoría a la que se mueven los movimientos antes de borrar. */
  reassignTo: z.coerce.number().int().positive().optional(),
  /** Sin reasignar: acepta explícitamente dejarlos como "Sin categoría". */
  force: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
})

export const tagInput = z.object({
  profileId: z.number().int().positive(),
  name: z.string().trim().min(1, 'La etiqueta necesita un nombre').max(30),
})

export const tagPatch = tagInput.omit({ profileId: true })

const campoImport = z.enum([
  'fecha', 'monto', 'cargo', 'abono', 'tipo',
  'cuenta', 'cuentaDestino', 'categoria', 'etiquetas', 'concepto',
])

export const importInput = z.object({
  profileId: z.number().int().positive(),
  csv: z.string().min(1, 'El archivo está vacío').max(8_000_000, 'El archivo es demasiado grande'),
  filename: z.string().max(200).default(''),
  cuentaPorOmision: z.number().int().positive(),
  mapeo: z.record(campoImport, z.number().int().nonnegative()).optional(),
  separador: z.string().length(1).optional(),
  crearCategorias: z.boolean().default(true),
  crearEtiquetas: z.boolean().default(true),
  omitirDuplicadas: z.boolean().default(true),
  /** La devuelve la vista previa; obliga a importar lo que se aprobó. */
  huella: z.string().max(64).optional(),
})

/**
 * Un renglón de una partida dividida (D17). Lleva su propia categoría y su
 * propio monto; el concepto es opcional porque el del ticket ya está arriba.
 */
const txSplit = z.object({
  categoryId: z.number().int().positive().nullish(),
  amountCents: z.number().int().positive('Cada renglón debe ser mayor a cero'),
  note: z.string().trim().max(120).default(''),
})

/** Cuántos renglones caben en un ticket. Cuarenta es más de lo que nadie divide. */
export const MAX_RENGLONES = 40

export const txInput = z
  .object({
    profileId: z.number().int().positive(),
    accountId: z.number().int().positive(),
    type: z.enum(['ingreso', 'gasto', 'transferencia']),
    amountCents: z.number().int().positive('El monto debe ser mayor a cero'),
    date: isoDate,
    categoryId: z.number().int().positive().nullish(),
    note: z.string().trim().max(200).default(''),
    transferAccountId: z.number().int().positive().nullish(),
    tagIds: z.array(z.number().int().positive()).max(20).optional(),
    // Perfil de negocio. Todo opcional: un movimiento personal nunca los manda.
    counterpartyId: z.number().int().positive().nullish(),
    costCenterId: z.number().int().positive().nullish(),
    invoiceId: z.number().int().positive().nullish(),
    // Impuesto **contenido** en el monto, no sumado: por eso se valida contra
    // él y no puede pasarse. Un IVA mayor que la factura no existe.
    taxCents: z.number().int().min(0).default(0),
    deductible: z.boolean().default(false),
    // Fase 10. Los dos ausentes dejan lo que ya había —la misma regla de
    // `tagIds`—; un arreglo vacío quita el reparto y un `null` explícito
    // desliga la devolución. Es la diferencia entre "no opiné" y "quítalo".
    splits: z.array(txSplit).max(MAX_RENGLONES).optional(),
    refundOfId: z.number().int().positive().nullish(),
    // Fase 15. El papel vive **en el movimiento**, no en el módulo: por eso
    // apagar Inmuebles no convierte un depósito viejo en ingreso (R18).
    rentalId: z.number().int().positive().nullish(),
    rentalRole: z
      .enum(['renta', 'deposito', 'devolucion_deposito', 'mantenimiento'])
      .nullish(),
  })
  .superRefine((t, ctx) => {
    if (t.splits && t.splits.length > 0) {
      if (t.type === 'transferencia') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Una transferencia no se divide por categoría: no tiene categoría',
        })
      }
      if (t.splits.length < 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Dividir una partida son al menos dos renglones; con uno, basta su categoría',
        })
      }
      // La invariante de D17: los renglones suman **exactamente** el
      // movimiento. Si no, el gasto por categoría dejaría de sumar el total y
      // el usuario vería dos verdades del mismo ticket.
      const suma = t.splits.reduce((s, r) => s + r.amountCents, 0)
      if (suma !== t.amountCents) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Los renglones suman ${suma / 100} y el movimiento es ${t.amountCents / 100}`,
        })
      }
    }
    if (t.refundOfId && t.type !== 'ingreso') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Una devolución es dinero que entra: va como ingreso, ligada al gasto original',
      })
    }
    if (t.taxCents > t.amountCents) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'El impuesto va incluido en el monto, así que no puede ser mayor',
      })
    }
    if (t.type === 'transferencia') {
      if (!t.transferAccountId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Elige la cuenta destino' })
      } else if (t.transferAccountId === t.accountId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Origen y destino deben ser distintas' })
      }
    }
    // Un papel sin contrato no significa nada: "esto es un depósito" solo se
    // entiende junto a "de qué arrendamiento". Y al revés, ligar un movimiento
    // a un contrato sin decir qué es dejaría al rendimiento sin saber si
    // sumarlo, restarlo o ignorarlo.
    if (t.rentalRole && !t.rentalId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Di de qué arrendamiento es ese cobro',
      })
    }
    if (t.rentalId && !t.rentalRole) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Di qué es: renta, depósito, devolución del depósito o mantenimiento',
      })
    }
  })

export const debtInput = z.object({
  profileId: z.number().int().positive(),
  direction: z.enum(['por_cobrar', 'por_pagar']),
  counterparty: z.string().trim().min(1, 'Falta el nombre de la persona o negocio').max(60),
  concept: z.string().trim().max(120).default(''),
  principalCents: z.number().int().positive('El monto debe ser mayor a cero'),
  startDate: isoDate,
  dueDate: isoDate.nullish(),
  // Puntos base para no guardar flotantes: 24.5 % anual = 2450. El tope de
  // 1000 % deja pasar cualquier tarjeta real y ataja un dedazo de un cero.
  annualRateBp: z
    .number()
    .int('La tasa se guarda en puntos base enteros')
    .min(0, 'La tasa no puede ser negativa')
    .max(100_000, 'Esa tasa anual es imposible')
    .default(0),
  termMonths: z
    .number()
    .int()
    .min(1, 'El plazo va de 1 a 600 meses')
    .max(600, 'El plazo va de 1 a 600 meses')
    .nullish(),
  /**
   * Cuenta por la que entra (o sale) el dinero de la deuda. Si viene, se
   * asienta el movimiento del desembolso; si no, la deuda queda como pura
   * obligación y el libro no se mueve.
   */
  accountId: z.number().int().positive().nullish(),
  /** Enganche: lo que se puso de contado al contratar. No es principal. */
  downPaymentCents: z.number().int().nonnegative('El enganche no puede ser negativo').default(0),
  /** Cuenta de la que sale (o a la que entra) el enganche. */
  downPaymentAccountId: z.number().int().positive().nullish(),
})

// El estado no se manda: siempre se deriva de los abonos contra el principal.
// Las cuentas solo existen al crear: los movimientos ya asentados se corrigen
// desde el libro, no desde aquí.
export const debtPatch = debtInput
  .omit({ profileId: true, accountId: true, downPaymentAccountId: true })
  .partial()

export const paymentInput = z.object({
  amountCents: z.number().int().positive('El abono debe ser mayor a cero'),
  date: isoDate,
  note: z.string().trim().max(200).default(''),
  accountId: z.number().int().positive().nullish(),
  /**
   * Cuánto del abono fue interés. Ausente, el servidor lo propone con el
   * interés devengado desde el abono anterior; presente, manda lo que diga el
   * estado de cuenta del usuario.
   */
  interestCents: z.number().int().nonnegative('El interés no puede ser negativo').optional(),
})

export const msiInput = z.object({
  profileId: z.number().int().positive(),
  /** Tiene que ser una tarjeta; la ruta lo verifica contra el libro. */
  accountId: z.number().int().positive(),
  concept: z.string().trim().max(120).default(''),
  totalCents: z.number().int().positive('El monto de la compra debe ser mayor a cero'),
  months: z
    .number()
    .int()
    .min(2, 'Una compra a meses son al menos 2 parcialidades')
    .max(60, 'El máximo son 60 meses'),
  purchaseDate: isoDate,
  categoryId: z.number().int().positive().nullish(),
})

export const tarjetasQuery = z.object({
  profileId: z.coerce.number().int().positive(),
  /** Desde qué día se mira el estado de cuenta. Por omisión, hoy. */
  hoy: isoDate.optional(),
})

// ── Recurrencias ──────────────────────────────────────────────────────────

/**
 * La clave de un periodo. Que tenga forma válida no basta: la ruta comprueba
 * además que sea una clave que **esa** plantilla genere, y ahí es donde se
 * rechaza un '2026-07-Q1' pedido a una recurrencia mensual.
 */
const periodo = z
  .string()
  .regex(/^\d{4}(-(\d{2}(-Q[12])?|W\d{2}))?$/, 'Periodo inválido')

export const recurrenceInput = z
  .object({
    profileId: z.number().int().positive(),
    accountId: z.number().int().positive(),
    type: z.enum(['ingreso', 'gasto', 'transferencia']),
    amountCents: z.number().int().positive('El monto debe ser mayor a cero'),
    categoryId: z.number().int().positive().nullish(),
    transferAccountId: z.number().int().positive().nullish(),
    note: z.string().trim().max(200).default(''),
    frequency: z.enum(['mensual', 'quincenal', 'semanal', 'anual']),
    dayOfMonth: diaDelMes.nullish(),
    /** Segunda quincena. 31 es "el último día del mes". */
    dayOfMonth2: diaDelMes.nullish(),
    monthOfYear: z.number().int().min(1, 'Mes inválido').max(12, 'Mes inválido').nullish(),
    /** Día de la semana ISO: 1 = lunes … 7 = domingo. */
    weekday: z.number().int().min(1, 'Día de la semana inválido').max(7, 'Día de la semana inválido').nullish(),
    startDate: isoDate,
    endDate: isoDate.nullish(),
    tagIds: z.array(z.number().int().positive()).max(20).optional(),
    archived: z.boolean().default(false),
  })
  .superRefine((r, ctx) => {
    if (r.type === 'transferencia') {
      if (!r.transferAccountId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Elige la cuenta destino' })
      } else if (r.transferAccountId === r.accountId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Origen y destino deben ser distintas' })
      }
    }
    if (r.endDate && r.endDate < r.startDate) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'La fecha de fin es anterior a la de inicio' })
    }
    // Dos quincenas el mismo día serían dos propuestas idénticas cada mes.
    if (r.frequency === 'quincenal' && r.dayOfMonth && r.dayOfMonth2 === r.dayOfMonth) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Las dos quincenas no pueden caer el mismo día' })
    }
  })

export const recurrenceQuery = z.object({
  profileId: z.coerce.number().int().positive(),
  /** Desde qué día se mira. Por omisión, hoy; las pruebas lo fijan. */
  hoy: isoDate.optional(),
})

export const bandejaQuery = recurrenceQuery.extend({
  limit: z.coerce.number().int().positive().max(200).default(100),
  offset: z.coerce.number().int().nonnegative().default(0),
})

/** Ajustes de **esta** partida, que no tocan la plantilla. */
export const asentarInput = z.object({
  periodo,
  date: isoDate.optional(),
  amountCents: z.number().int().positive('El monto debe ser mayor a cero').optional(),
  categoryId: z.number().int().positive().nullish(),
  transferAccountId: z.number().int().positive().nullish(),
  accountId: z.number().int().positive().optional(),
  note: z.string().trim().max(200).optional(),
  tagIds: z.array(z.number().int().positive()).max(20).optional(),
})

export const periodoInput = z.object({ periodo })

export const calendarioQuery = recurrenceQuery.extend({
  dias: z.coerce
    .number()
    .int()
    .min(1, 'El calendario va de 1 a 365 días')
    .max(365, 'El calendario va de 1 a 365 días')
    .default(30),
})

export const investmentInput = z.object({
  profileId: z.number().int().positive(),
  name: z.string().trim().min(1, 'La inversión necesita un nombre').max(60),
  kind: z.enum(['cetes', 'acciones', 'cripto', 'fondo', 'inmueble', 'otro']).default('otro'),
  note: z.string().trim().max(200).default(''),
})

export const investmentPatch = investmentInput.omit({ profileId: true }).partial().extend({
  archived: z.boolean().optional(),
})

export const investmentEntryInput = z.object({
  type: z.enum(['aporte', 'retiro', 'valuacion']),
  amountCents: z.number().int().min(0, 'El monto no puede ser negativo'),
  date: isoDate,
  note: z.string().trim().max(200).default(''),
  accountId: z.number().int().positive().nullish(),
  // Unidades y precio son opcionales: una inversión que solo lleva montos
  // —un pagaré, un inmueble— nunca los manda y se comporta igual que antes.
  unitsE8: z
    .number()
    .int('Las unidades llevan 8 decimales como máximo')
    .min(0, 'Las unidades no pueden ser negativas')
    .max(MAX_UNIDADES_E8, 'Son demasiadas unidades para un solo registro')
    .nullish(),
  unitPriceCents: z
    .number()
    .int()
    .min(0, 'El precio no puede ser negativo')
    .nullish(),
})

/** El CSV de precios: texto pegado o archivo leído, más el mapeo elegido. */
export const preciosInput = z.object({
  profileId: z.number().int().positive(),
  texto: z.string().min(1, 'No hay nada que leer').max(2_000_000),
  fecha: isoDate.nullish(),
})

export const preciosConfirmar = preciosInput.extend({
  // Solo se asientan las filas que el usuario dejó marcadas. Sin esta lista no
  // se escribe nada: la vista previa propone, el usuario confirma (R4).
  filas: z.array(z.number().int().nonnegative()).min(1, 'No hay filas seleccionadas'),
})

export const simuladorQuery = z.object({
  profileId: z.coerce.number().int().positive(),
  meses: z.coerce.number().int().min(1).max(600).default(120),
  ahorroMensualCents: z.coerce.number().int().min(0).max(1_000_000_000_000).default(0),
  // De −99.99 % a +200 % anual. El techo no es una opinión sobre qué es
  // razonable: es lo que evita que un cero de más proyecte un número absurdo.
  rendimientoAnualBp: z.coerce.number().int().min(-9_999).max(20_000).default(700),
})

/** Un año suelto, 'AAAA'. El periodo de un tope anual. */
const isoAnio = z.string().regex(/^\d{4}$/, 'El año va como AAAA')

export const budgetInput = z
  .object({
    profileId: z.number().int().positive(),
    categoryId: z.number().int().positive(),
    /** 'AAAA-MM' o 'AAAA', según `periodKind`. */
    period: z.union([isoMonth, isoAnio]),
    periodKind: z.enum(['mes', 'anio']).default('mes'),
    amountCents: z.number().int().positive('El presupuesto debe ser mayor a cero'),
    rollover: z.boolean().default(false),
  })
  // El tipo y el texto tienen que concordar: guardar 'anio' con '2026-03'
  // dejaría un tope que se mide contra un recorte de cuatro caracteres y
  // nunca cuadraría con nada.
  .refine((v) => (v.periodKind === 'anio' ? isoAnio.safeParse(v.period) : isoMonth.safeParse(v.period)).success, {
    message: 'Un tope mensual lleva AAAA-MM y uno anual lleva AAAA',
    path: ['period'],
  })
  // El arrastre es "traer lo del mes pasado". Un tope anual no tiene mes
  // pasado, así que la casilla no significaría nada.
  .refine((v) => !(v.rollover && v.periodKind === 'anio'), {
    message: 'Un tope anual no arrastra: no hay mes anterior del cual traer',
    path: ['rollover'],
  })

export const budgetQuery = z.object({
  profileId: z.coerce.number().int().positive(),
  month: isoMonth,
})

export const budgetCopyInput = z.object({
  profileId: z.number().int().positive(),
  from: isoMonth,
  to: isoMonth,
})

export const budgetTotalInput = z.object({
  profileId: z.number().int().positive(),
  month: isoMonth,
  amountCents: z.number().int().positive('El tope total debe ser mayor a cero'),
})

export const goalInput = z.object({
  profileId: z.number().int().positive(),
  name: z.string().trim().min(1, 'La meta necesita un nombre').max(60),
  targetCents: z.number().int().positive('La meta debe ser mayor a cero'),
  dueDate: isoDate.nullish(),
  note: z.string().trim().max(200).default(''),
  /**
   * Dónde vive el dinero de esta meta (H1). Sin cuenta, la meta sigue siendo
   * un apunte —lo que era antes— y la vista lo dice en vez de fingir que ese
   * dinero está apartado en algún lado.
   */
  accountId: z.number().int().positive().nullish(),
})

export const goalPatch = goalInput.omit({ profileId: true }).partial()

export const goalEntryInput = z.object({
  amountCents: z.number().int().positive('El aporte debe ser mayor a cero'),
  date: isoDate,
  note: z.string().trim().max(200).default(''),
  /**
   * La cuenta de la que **sale** el dinero. Con ella, el aporte asienta una
   * transferencia a la cuenta de la meta y deja de ser dinero fantasma (H1).
   * Sin ella es "solo apuntar", que es lo que manda R4 por omisión.
   */
  accountId: z.number().int().positive().nullish(),
})

export const noteInput = z.object({
  profileId: z.number().int().positive(),
  title: z.string().trim().max(80).default(''),
  body: z.string().max(5000).default(''),
})

export const notePatch = z.object({
  title: z.string().trim().max(80).optional(),
  body: z.string().max(5000).optional(),
  pinned: z.boolean().optional(),
})

export const reporteQuery = z.object({
  profileId: z.coerce.number().int().positive(),
  year: z.coerce
    .number()
    .int()
    .min(1900, 'Año fuera de rango')
    .max(2200, 'Año fuera de rango'),
})

/**
 * Dos periodos cualesquiera, de mes a mes e inclusivos. `desde`/`hasta` son el
 * periodo que se mira; `contraDesde`/`contraHasta`, contra qué. Sin el segundo,
 * el servidor toma el bloque de meses inmediatamente anterior del mismo largo,
 * que es lo que hacía cuando solo sabía comparar un mes con el previo.
 */
export const comparativaQuery = z
  .object({
    profileId: z.coerce.number().int().positive(),
    desde: isoMonth,
    hasta: isoMonth,
    contraDesde: isoMonth.optional(),
    contraHasta: isoMonth.optional(),
  })
  .refine((v) => v.desde <= v.hasta, {
    message: 'El mes inicial va antes que el final',
    path: ['hasta'],
  })
  .refine((v) => (v.contraDesde === undefined) === (v.contraHasta === undefined), {
    message: 'El periodo contra el que comparas necesita sus dos meses',
    path: ['contraHasta'],
  })
  .refine((v) => v.contraDesde === undefined || v.contraDesde <= v.contraHasta!, {
    message: 'El mes inicial va antes que el final',
    path: ['contraHasta'],
  })

export const analisisQuery = z.object({
  profileId: z.coerce.number().int().positive(),
  /** Meses **cerrados** hacia atrás. El mes en curso nunca entra. */
  meses: z.coerce
    .number()
    .int()
    .min(1, 'El análisis va de 1 a 36 meses')
    .max(36, 'El análisis va de 1 a 36 meses')
    .default(6),
  hoy: isoDate.optional(),
  /** Debajo de cuánto una compra es "hormiga". El usuario lo elige. */
  umbralHormigaCents: z.coerce
    .number()
    .int()
    .min(1, 'El umbral del gasto hormiga tiene que ser mayor a cero')
    .max(100_000_000)
    .optional(),
})

export const summaryQuery = z.object({
  profileId: z.coerce.number().int().positive(),
  month: isoMonth,
  /** Fija el "hoy" de las minigráficas. Sin él, cada día darían otra cosa. */
  hoy: isoDate.optional(),
})

export const txQuery = z
  .object({
    profileId: z.coerce.number().int().positive(),
    month: isoMonth.optional(),
    /** Rango de fechas inclusivo. Ignora `month` si viene alguno de los dos. */
    from: isoDate.optional(),
    to: isoDate.optional(),
    accountId: z.coerce.number().int().positive().optional(),
    type: z.enum(['ingreso', 'gasto', 'transferencia']).optional(),
    tagId: z.coerce.number().int().positive().optional(),
    minCents: z.coerce.number().int().nonnegative().optional(),
    maxCents: z.coerce.number().int().nonnegative().optional(),
    q: z.string().trim().max(100).optional(),
    /** Conciliación: 'si' solo lo marcado, 'no' solo lo pendiente. */
    conciliado: z.enum(['si', 'no']).optional(),
    limit: z.coerce.number().int().positive().max(500).default(500),
    offset: z.coerce.number().int().nonnegative().default(0),
  })
  .superRefine((t, ctx) => {
    if (t.from && t.to && t.from > t.to) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'La fecha inicial es posterior a la final' })
    }
    if (t.minCents !== undefined && t.maxCents !== undefined && t.minCents > t.maxCents) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'El monto mínimo es mayor al máximo' })
    }
  })

// ── Perfil de negocio ─────────────────────────────────────────────────────

export const contraparteInput = z.object({
  profileId: z.number().int().positive(),
  name: z.string().trim().min(1, 'La contraparte necesita un nombre').max(80),
  role: z.enum(['cliente', 'proveedor', 'ambos']).default('ambos'),
  // Genérico a propósito (R15): RFC en México, CUIT en Argentina, VAT en
  // Europa, o vacío. Finply no valida el formato de ningún país.
  taxId: z.string().trim().max(40).default(''),
  note: z.string().trim().max(200).default(''),
  /** Correo, teléfono o a quién buscar. Libre por lo mismo que `taxId`. */
  contact: z.string().trim().max(120).default(''),
  /** Días de crédito por omisión. `null` explícito los quita. */
  creditDays: z.number().int().min(0).max(365, 'Eso ya no es crédito comercial').nullish(),
  creditLimitCents: z.number().int().nonnegative('El límite no puede ser negativo').nullish(),
})

export const contrapartePatch = contraparteInput
  .omit({ profileId: true })
  .partial()
  .extend({ archived: z.boolean().optional() })

export const centroInput = z.object({
  profileId: z.number().int().positive(),
  name: z.string().trim().min(1, 'El centro necesita un nombre').max(60),
})

export const centroPatch = centroInput
  .omit({ profileId: true })
  .partial()
  .extend({ archived: z.boolean().optional() })

export const facturaInput = z.object({
  profileId: z.number().int().positive(),
  counterpartyId: z.number().int().positive(),
  direction: z.enum(['emitida', 'recibida']),
  folio: z.string().trim().max(40).default(''),
  concept: z.string().trim().max(200).default(''),
  issueDate: isoDate,
  dueDate: isoDate.nullish(),
  subtotalCents: z.number().int().positive('El subtotal debe ser mayor a cero'),
  taxCents: z.number().int().min(0).default(0),
  // Retenciones (D21): **monto y no tasa**, igual que el impuesto, para no
  // amarrar el modelo a ninguna jurisdicción. Son dos porque así vienen
  // desglosadas en la factura que el usuario tiene enfrente.
  withheldTaxCents: z.number().int().min(0).default(0),
  withheldIncomeCents: z.number().int().min(0).default(0),
  costCenterId: z.number().int().positive().nullish(),
})

export const facturaPatch = facturaInput
  .omit({ profileId: true, direction: true })
  .partial()
  .extend({ status: z.enum(['abierta', 'cancelada']).optional() })

/**
 * Una nota de crédito: cancela parte de una factura ya emitida. **No mueve
 * dinero** —por eso no lleva cuenta— y por eso tampoco lleva impuesto: lo que
 * baja es lo cobrable completo, con su parte de IVA adentro.
 */
export const notaCreditoInput = z.object({
  date: isoDate,
  folio: z.string().trim().max(40).default(''),
  concept: z.string().trim().max(200).default(''),
  amountCents: z.number().int().positive('La nota de crédito debe ser mayor a cero'),
})

/** Aplicar un anticipo: liga un movimiento que ya existe a esta factura. */
export const anticipoInput = z.object({
  txId: z.number().int().positive(),
})

export const facturaRecurrenteInput = z
  .object({
    profileId: z.number().int().positive(),
    counterpartyId: z.number().int().positive(),
    direction: z.enum(['emitida', 'recibida']),
    concept: z.string().trim().max(200).default(''),
    subtotalCents: z.number().int().positive('El subtotal debe ser mayor a cero'),
    taxCents: z.number().int().min(0).default(0),
    withheldTaxCents: z.number().int().min(0).default(0),
    withheldIncomeCents: z.number().int().min(0).default(0),
    costCenterId: z.number().int().positive().nullish(),
    creditDays: z.number().int().min(0).max(365).nullish(),
    frequency: z.enum(['mensual', 'quincenal', 'semanal', 'anual']),
    dayOfMonth: diaDelMes.nullish(),
    dayOfMonth2: diaDelMes.nullish(),
    monthOfYear: z.number().int().min(1, 'Mes inválido').max(12, 'Mes inválido').nullish(),
    weekday: z.number().int().min(1, 'Día de la semana inválido').max(7, 'Día de la semana inválido').nullish(),
    startDate: isoDate,
    endDate: isoDate.nullish(),
    archived: z.boolean().default(false),
  })
  .superRefine((r, ctx) => {
    if (r.endDate && r.endDate < r.startDate) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'La fecha de fin es anterior a la de inicio' })
    }
    if (r.frequency === 'quincenal' && r.dayOfMonth && r.dayOfMonth2 === r.dayOfMonth) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Las dos quincenas no pueden caer el mismo día' })
    }
  })

/** Ajustes de **esta** factura, que no tocan la plantilla. */
export const emitirFacturaInput = z.object({
  periodo,
  issueDate: isoDate.optional(),
  dueDate: isoDate.nullish(),
  folio: z.string().trim().max(40).optional(),
  concept: z.string().trim().max(200).optional(),
  subtotalCents: z.number().int().positive('El subtotal debe ser mayor a cero').optional(),
  taxCents: z.number().int().min(0).optional(),
})

export const facturaQuery = z.object({
  profileId: z.coerce.number().int().positive(),
  direction: z.enum(['emitida', 'recibida']).optional(),
  counterpartyId: z.coerce.number().int().positive().optional(),
  pendientes: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
})

/** El cobro o pago de una factura: crea el movimiento y lo liga. */
export const cobroInput = z.object({
  accountId: z.number().int().positive(),
  amountCents: z.number().int().positive('El monto debe ser mayor a cero'),
  date: isoDate,
  note: z.string().trim().max(200).default(''),
  categoryId: z.number().int().positive().nullish(),
})

export const periodoQuery = z.object({
  profileId: z.coerce.number().int().positive(),
  desde: isoDate,
  hasta: isoDate,
})

// ── Fase 15 · módulos de giro ────────────────────────────────────────────────

/**
 * El arrendamiento de un bien. La renta admite **cero** a propósito: un
 * comodato o un préstamo de la casa a un familiar sigue teniendo inquilino,
 * fechas y mantenimiento, y esconderlo no lo haría desaparecer.
 */
export const arrendamientoInput = z.object({
  profileId: z.number().int().positive(),
  assetId: z.number().int().positive(),
  tenant: z.string().trim().max(80).default(''),
  rentCents: z.number().int().nonnegative('La renta no puede ser negativa'),
  depositCents: z.number().int().nonnegative('El depósito no puede ser negativo').default(0),
  paymentDay: diaDelMes.default(1),
  startDate: isoDate,
  endDate: isoDate.nullish(),
  note: z.string().trim().max(200).default(''),
  archived: z.boolean().default(false),
})

export const giroQuery = z.object({
  profileId: z.coerce.number().int().positive(),
  hoy: isoDate.optional(),
})

/**
 * Un renglón de horas. La tarifa va **en el renglón** y admite cero: se apunta
 * el tiempo primero y se le pone precio después, que es como se trabaja.
 */
export const horaInput = z.object({
  profileId: z.number().int().positive(),
  date: isoDate,
  minutes: z
    .number()
    .int()
    .positive('Las horas se apuntan en minutos, y tienen que ser más de cero')
    .max(24 * 60, 'Eso es más de un día'),
  rateCents: z.number().int().nonnegative('La tarifa no puede ser negativa').default(0),
  counterpartyId: z.number().int().positive().nullish(),
  costCenterId: z.number().int().positive().nullish(),
  note: z.string().trim().max(200).default(''),
})

export const horasQuery = z.object({
  profileId: z.coerce.number().int().positive(),
  desde: isoDate.optional(),
  hasta: isoDate.optional(),
  counterpartyId: z.coerce.number().int().positive().optional(),
  sinFacturar: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
})

/** Convierte en una factura todas las horas sin facturar de un cliente (R4). */
export const facturarHorasInput = z.object({
  counterpartyId: z.number().int().positive(),
  issueDate: isoDate,
  dueDate: isoDate.nullish(),
  folio: z.string().trim().max(40).default(''),
  concept: z.string().trim().max(200).default(''),
  taxCents: z.number().int().min(0).default(0),
})

export const productoInput = z.object({
  profileId: z.number().int().positive(),
  sku: z.string().trim().max(40).default(''),
  name: z.string().trim().min(1, 'El producto necesita un nombre').max(80),
  unit: z.string().trim().min(1).max(16).default('pieza'),
  /** Debajo de esto Finply avisa. `null` quita el aviso. */
  minQtyMilli: z.number().int().nonnegative().nullish(),
  archived: z.boolean().default(false),
})

/**
 * Un movimiento de existencias. La cantidad va en **milésimas de unidad** y en
 * un ajuste puede ser negativa: ahí es un delta —una merma, un conteo que no
 * cuadró—, no una cantidad. Cero no es un movimiento.
 */
export const movimientoStockInput = z.object({
  profileId: z.number().int().positive(),
  productId: z.number().int().positive(),
  date: isoDate,
  kind: z.enum(['entrada', 'salida', 'ajuste']),
  qtyMilli: z.number().int().refine((n) => n !== 0, 'Un movimiento de cero no es un movimiento'),
  unitCostCents: z.number().int().nonnegative('El costo no puede ser negativo').default(0),
  note: z.string().trim().max(200).default(''),
  txId: z.number().int().positive().nullish(),
})

export const agingQuery = z.object({
  profileId: z.coerce.number().int().positive(),
  hoy: isoDate.optional(),
})

/**
 * La ventana del flujo proyectado. Admite **cero días**: el 31 del mes, "¿llego
 * a fin de mes?" pregunta por lo que queda de hoy, y rechazarlo dejaría al
 * Resumen sin cifra justo el día que más se mira.
 */
export const flujoQuery = z.object({
  profileId: z.coerce.number().int().positive(),
  dias: z.coerce.number().int().min(0).max(365).default(30),
  hoy: isoDate.optional(),
})

// ── Fase 10 · el libro que cuadra ────────────────────────────────────────────

/**
 * El corte de conciliación: "al 31 de julio mi banco decía $X" (D19). El saldo
 * va **con signo** —una tarjeta lo tiene en negativo— y por eso no lleva el
 * `positive()` de los montos normales.
 */
export const cortInput = z.object({
  profileId: z.number().int().positive(),
  accountId: z.number().int().positive(),
  date: isoDate,
  balanceCents: z.number().int(),
  note: z.string().trim().max(200).default(''),
})

export const cortQuery = z.object({
  profileId: z.coerce.number().int().positive(),
  accountId: z.coerce.number().int().positive().optional(),
})

/** Marcar o desmarcar movimientos contra el estado de cuenta. */
export const conciliarInput = z.object({
  profileId: z.number().int().positive(),
  txIds: z.array(z.number().int().positive()).min(1).max(500),
  reconciled: z.boolean(),
})

/**
 * Tope de un recibo. 2 MB del archivo original; en base64 ocupa un tercio más,
 * que es el precio de que el respaldo se lo lleve (ver la migración 14).
 */
export const MAX_ADJUNTO_BYTES = 2 * 1024 * 1024

/**
 * Lo que se acepta adjuntar. Lista cerrada a propósito: un recibo es una foto
 * o un PDF, y aceptar cualquier cosa convertiría el libro en un almacén de
 * archivos ejecutables que después alguien abre.
 */
export const MIMES_ADJUNTO = ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'application/pdf']

export const adjuntoInput = z
  .object({
    filename: z.string().trim().min(1).max(120),
    mime: z.string().trim().refine((m) => MIMES_ADJUNTO.includes(m), {
      message: `Solo se adjuntan imágenes o PDF (${MIMES_ADJUNTO.join(', ')})`,
    }),
    // El archivo llega en base64 dentro del JSON: no hay multipart en Finply y
    // meter una dependencia para subir un recibo no vale la pena.
    dataB64: z.string().min(1),
  })
  .superRefine((a, ctx) => {
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(a.dataB64)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'El archivo no viene en base64' })
      return
    }
    // Tamaño real del binario, deducido del largo del base64: 4 caracteres por
    // cada 3 bytes, menos el relleno. Así el tope se aplica antes de decodificar.
    const relleno = a.dataB64.endsWith('==') ? 2 : a.dataB64.endsWith('=') ? 1 : 0
    const bytes = Math.floor((a.dataB64.length * 3) / 4) - relleno
    if (bytes <= 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'El archivo viene vacío' })
    }
    if (bytes > MAX_ADJUNTO_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `El recibo pesa ${Math.round(bytes / 1024)} KB y el tope son ${MAX_ADJUNTO_BYTES / 1024} KB`,
      })
    }
  })

// ── Fase 11 · patrimonio completo ────────────────────────────────────────────

export const bienInput = z.object({
  profileId: z.number().int().positive(),
  name: z.string().trim().min(1, 'El bien necesita un nombre').max(60),
  kind: z.enum(['inmueble', 'vehiculo', 'equipo', 'otro']).default('otro'),
  costCents: z.number().int().nonnegative('El costo no puede ser negativo'),
  acquiredDate: isoDate,
  /** La deuda que lo financia. `null` explícito la desliga. */
  debtId: z.number().int().positive().nullish(),
  note: z.string().trim().max(200).default(''),
})

export const bienPatch = bienInput.omit({ profileId: true }).partial().extend({
  archived: z.boolean().optional(),
})

export const bienQuery = z.object({
  profileId: z.coerce.number().int().positive(),
  /** Para que las pruebas puedan pararse en una fecha; por omisión es hoy. */
  hoy: isoDate.optional(),
})

/**
 * Cuánto vale hoy, **declarado por el usuario** (R9). Cero es legítimo: una
 * herramienta puede acabar sin valor, y decirlo vale más que borrarla.
 */
export const valuacionInput = z.object({
  date: isoDate,
  valueCents: z.number().int().nonnegative('El valor no puede ser negativo'),
  note: z.string().trim().max(200).default(''),
})

export const serieCuentaQuery = z.object({
  meses: z.coerce.number().int().min(2).max(120).default(12),
  hoy: isoDate.optional(),
})
