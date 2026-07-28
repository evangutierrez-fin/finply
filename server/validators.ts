import { z } from 'zod'
import { AA_TEXTO, evaluarTinta, normalizarHex } from '../shared/color.ts'

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
  })
  .superRefine((t, ctx) => {
    if (t.type === 'transferencia') {
      if (!t.transferAccountId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Elige la cuenta destino' })
      } else if (t.transferAccountId === t.accountId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Origen y destino deben ser distintas' })
      }
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
})

export const budgetInput = z.object({
  profileId: z.number().int().positive(),
  categoryId: z.number().int().positive(),
  month: isoMonth,
  amountCents: z.number().int().positive('El presupuesto debe ser mayor a cero'),
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

export const goalInput = z.object({
  profileId: z.number().int().positive(),
  name: z.string().trim().min(1, 'La meta necesita un nombre').max(60),
  targetCents: z.number().int().positive('La meta debe ser mayor a cero'),
  dueDate: isoDate.nullish(),
  note: z.string().trim().max(200).default(''),
})

export const goalPatch = goalInput.omit({ profileId: true }).partial()

export const goalEntryInput = z.object({
  amountCents: z.number().int().positive('El aporte debe ser mayor a cero'),
  date: isoDate,
  note: z.string().trim().max(200).default(''),
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

export const comparativaQuery = z.object({
  profileId: z.coerce.number().int().positive(),
  month: isoMonth,
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
})

export const summaryQuery = z.object({
  profileId: z.coerce.number().int().positive(),
  month: isoMonth,
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
