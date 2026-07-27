import { z } from 'zod'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (AAAA-MM-DD)')
const isoMonth = z.string().regex(/^\d{4}-\d{2}$/, 'Mes inválido (AAAA-MM)')

export const profileInput = z.object({
  name: z.string().trim().min(1, 'El perfil necesita un nombre').max(60),
  kind: z.enum(['personal', 'negocio']).default('personal'),
  accent: z.enum(['verde', 'laton', 'cobalto', 'vino']).default('verde'),
})

export const profilePatch = profileInput.partial()

export const accountInput = z.object({
  profileId: z.number().int().positive(),
  name: z.string().trim().min(1, 'La cuenta necesita un nombre').max(60),
  type: z.enum(['efectivo', 'banco', 'tarjeta', 'ahorro', 'otro']).default('efectivo'),
  currency: z.string().trim().length(3).toUpperCase().default('MXN'),
  openingCents: z.number().int().default(0),
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
})

// El estado no se manda: siempre se deriva de los abonos contra el principal.
export const debtPatch = debtInput.omit({ profileId: true }).partial()

export const paymentInput = z.object({
  amountCents: z.number().int().positive('El abono debe ser mayor a cero'),
  date: isoDate,
  note: z.string().trim().max(200).default(''),
  accountId: z.number().int().positive().nullish(),
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
