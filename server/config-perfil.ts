// Exportar e importar **la configuración** de un perfil, sin sus datos.
//
// La pregunta que contesta: "monté mi libro personal como quería y ahora abro
// el del negocio — no quiero volver a armar todo a mano". Lo que viaja es cómo
// se ve y qué pregunta el libro; lo que **no** viaja es una sola cifra.
//
// Dos decisiones que sostienen todo lo demás:
//
//   · **Se referencia por nombre, nunca por id.** Un id de cuenta o de
//     categoría no significa nada en otro perfil —ni en otra máquina—, y
//     copiarlo produciría plantillas apuntando al banco de alguien más. Al
//     aplicar se busca por nombre y lo que no aparece se deja en nulo, con la
//     plantilla coja pero viva y la cuenta dicha.
//   · **Aplicar es aditivo y jamás destructivo.** Crea lo que falta y no toca
//     lo que ya está: importar la configuración a un libro con quince meses de
//     historia no puede borrarle una categoría en uso. Lo único que se
//     sobrescribe son las preferencias del propio perfil —tinta, formato,
//     orden del lomo—, que es justamente lo que se venía a copiar.

import { db, guardarModulos, httpError, inTransaction, mapProfile } from './db.ts'
import { listarCampos, listarPlantillas } from './personalizacion.ts'
import { MODULO_IDS } from '../shared/modulos.ts'

/** Sube si el archivo deja de ser compatible, como el del respaldo. */
const CONFIG_FORMAT = 1

export interface ConfigPerfil {
  finplyConfig: number
  exportadoEl: string
  /** De qué libro salió. Es informativo: al aplicar no se copia el nombre. */
  origen: string
  perfil: {
    kind: string
    accent: string
    accentHex: string | null
    accentHexDark: string | null
    dimensionLabel: string
    modules: string[]
    navOrder: string[] | null
    homeView: string | null
    dateFormat: string
    weekStart: number
    hideCents: boolean
  }
  /** `padre` es el nombre de la categoría de la que cuelga (Fase 23), o nulo. */
  categorias: { name: string; kind: string; role: string | null; padre?: string | null }[]
  campos: { label: string; kind: string; options: string; position: number }[]
  plantillas: {
    name: string
    type: string
    cuenta: string | null
    cuentaDestino: string | null
    categoria: string | null
    amountCents: number | null
    note: string
    position: number
  }[]
}

function perfilFila(profileId: number): any {
  const row = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId)
  if (!row) throw httpError(404, 'Ese perfil no existe')
  return row
}

export function exportarConfig(profileId: number): ConfigPerfil {
  const fila = perfilFila(profileId)
  const perfil = mapProfile(fila)
  // Los padres primero: al aplicar se resuelve el padre **por nombre**, así que
  // un hijo que llegara antes que su padre se quedaría suelto. Es el mismo
  // cuidado que pide el respaldo desde que `categories` se referencia a sí misma.
  const categorias = db
    .prepare(
      `SELECT c.name, c.kind, c.role, p.name AS padre
       FROM categories c LEFT JOIN categories p ON p.id = c.parent_id
       WHERE c.profile_id = ? ORDER BY c.parent_id IS NOT NULL, c.kind, c.name`,
    )
    .all(profileId) as any[]

  return {
    finplyConfig: CONFIG_FORMAT,
    exportadoEl: new Date().toISOString(),
    origen: perfil.name,
    perfil: {
      kind: perfil.kind,
      accent: perfil.accent,
      accentHex: perfil.accentHex,
      accentHexDark: perfil.accentHexDark,
      dimensionLabel: perfil.dimensionLabel,
      modules: perfil.modules,
      navOrder: perfil.navOrder,
      homeView: perfil.homeView,
      dateFormat: perfil.dateFormat,
      weekStart: perfil.weekStart,
      hideCents: perfil.hideCents,
    },
    categorias: categorias.map((c) => ({
      name: c.name,
      kind: c.kind,
      role: c.role ?? null,
      padre: c.padre ?? null,
    })),
    campos: listarCampos(profileId).map((c) => ({
      label: c.label,
      kind: c.kind,
      options: c.options,
      position: c.position,
    })),
    // Las plantillas viajan con **nombres** de cuenta y categoría, no con ids.
    plantillas: listarPlantillas(profileId).map((p) => ({
      name: p.name,
      type: p.type,
      cuenta: p.accountName,
      cuentaDestino: p.transferAccountName,
      categoria: p.categoryName,
      amountCents: p.amountCents,
      note: p.note,
      position: p.position,
    })),
  }
}

function revisar(raw: unknown): ConfigPerfil {
  if (typeof raw !== 'object' || raw === null) {
    throw httpError(400, 'El archivo de configuración no es un objeto JSON')
  }
  const data = raw as Partial<ConfigPerfil>
  if (data.finplyConfig !== CONFIG_FORMAT) {
    throw httpError(
      400,
      'Ese archivo no es una configuración de Finply, o es de un formato distinto',
    )
  }
  if (typeof data.perfil !== 'object' || data.perfil === null) {
    throw httpError(400, 'La configuración no trae las preferencias del perfil')
  }
  return data as ConfigPerfil
}

export interface ResultadoConfig {
  categoriasNuevas: number
  camposNuevos: number
  plantillasNuevas: number
  /** Plantillas que llegaron sin poder resolver su cuenta o su categoría. */
  plantillasCojas: string[]
  /** Lo que ya existía y **no** se tocó. */
  respetadas: { categorias: number; campos: number; plantillas: number }
}

/**
 * Aplica una configuración a un perfil que ya existe.
 *
 * Todo en una sola transacción, como el import de movimientos (R8): media
 * configuración aplicada es peor que ninguna, porque nadie sabe qué mitad.
 */
export function aplicarConfig(profileId: number, raw: unknown): ResultadoConfig {
  const config = revisar(raw)
  const fila = perfilFila(profileId)

  return inTransaction(() => {
    // 1. Las preferencias del perfil. Es lo único que se sobrescribe, porque es
    //    lo que se venía a copiar. El **nombre no viaja**: es la identidad del
    //    libro, no su configuración, y pisarlo dejaría dos perfiles llamados
    //    igual sin que nadie lo pidiera.
    const p = config.perfil
    db.prepare(
      `UPDATE profiles SET accent = ?, accent_hex = ?, accent_hex_dark = ?, dimension_label = ?,
         nav_order = ?, home_view = ?, date_format = ?, week_start = ?, hide_cents = ?
       WHERE id = ?`,
    ).run(
      p.accent ?? fila.accent,
      p.accentHex ?? null,
      p.accentHexDark ?? null,
      p.dimensionLabel ?? fila.dimension_label,
      p.navOrder && p.navOrder.length > 0 ? p.navOrder.join(',') : null,
      p.homeView ?? null,
      p.dateFormat ?? null,
      p.weekStart ?? null,
      p.hideCents ? 1 : 0,
      profileId,
    )
    if (Array.isArray(p.modules)) {
      // `guardarModulos` escribe las doce filas, no solo las encendidas: es la
      // regla de la Fase 9, y lo que hace que "lo apagué" no se confunda con
      // "no opiné". Un módulo que el archivo no conozca —viene de una versión
      // vieja— cae en su valor por omisión en vez de nacer apagado.
      const conocidos = MODULO_IDS.filter((id) => (p.modules as string[]).includes(id))
      guardarModulos(profileId, conocidos)
    }

    // 2. Categorías: se crea la que falte y **no se toca** la que ya está. El
    //    UNIQUE de (perfil, nombre, tipo) hace el trabajo; contarlas antes y
    //    después sería la segunda versión de la misma verdad.
    //
    //    El padre viaja por **nombre**, como todo lo demás. Se resuelve contra
    //    lo que ya hay más lo que se acaba de crear, y por eso el archivo llega
    //    con los padres delante. Si el padre no aparece —un archivo a medias, o
    //    editado a mano—, la categoría entra igual como principal: perder la
    //    jerarquía es molesto, perder la categoría sería destructivo.
    const insertarCategoria = db.prepare(
      `INSERT INTO categories (profile_id, name, kind, role, parent_id) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (profile_id, name, kind) DO NOTHING`,
    )
    const buscarCategoria = db.prepare(
      'SELECT id, parent_id FROM categories WHERE profile_id = ? AND name = ? AND kind = ?',
    )
    let categoriasNuevas = 0
    let categoriasRespetadas = 0
    for (const c of config.categorias ?? []) {
      // Un solo nivel (D25): si el padre que llega es a su vez hijo de alguien,
      // esta cuelga de la raíz en vez de abrir un segundo nivel por la puerta
      // de atrás.
      let padreId: number | null = null
      if (c.padre) {
        const padre: any = buscarCategoria.get(profileId, c.padre, c.kind)
        padreId = padre ? (padre.parent_id ?? padre.id) : null
      }
      const r = insertarCategoria.run(profileId, c.name, c.kind, c.role ?? null, padreId)
      if (Number(r.changes) > 0) categoriasNuevas += 1
      else categoriasRespetadas += 1
    }

    // 3. Campos propios: se identifican por su etiqueta. Uno que ya existe se
    //    respeta entero —puede tener respuestas guardadas y cambiarle el tipo
    //    debajo dejaría valores que el validador rechaza (Fase 18 otra vez)—.
    const existentes = new Set(listarCampos(profileId).map((c) => c.label.toLowerCase()))
    const insertarCampo = db.prepare(
      `INSERT INTO profile_fields (profile_id, label, kind, options, position)
       VALUES (?, ?, ?, ?, ?)`,
    )
    let camposNuevos = 0
    let camposRespetados = 0
    for (const c of config.campos ?? []) {
      if (existentes.has(String(c.label).toLowerCase())) {
        camposRespetados += 1
        continue
      }
      insertarCampo.run(profileId, c.label, c.kind, c.options ?? '', c.position ?? 0)
      camposNuevos += 1
    }

    // 4. Plantillas: sus referencias se resuelven **por nombre** en este libro.
    //    Lo que no aparece se queda en nulo y se dice cuál — una plantilla coja
    //    sigue sirviendo, y borrarla por eso tiraría el nombre y el concepto.
    const cuentaPorNombre = new Map(
      (db.prepare('SELECT id, name FROM accounts WHERE profile_id = ?').all(profileId) as any[])
        .map((a) => [String(a.name).toLowerCase(), a.id as number]),
    )
    const categoriaPorNombre = new Map(
      (
        db.prepare('SELECT id, name, kind FROM categories WHERE profile_id = ?').all(profileId) as any[]
      ).map((c) => [`${String(c.name).toLowerCase()}·${c.kind}`, c.id as number]),
    )
    const yaHay = new Set(listarPlantillas(profileId).map((t) => t.name.toLowerCase()))
    const insertarPlantilla = db.prepare(
      `INSERT INTO tx_templates
        (profile_id, name, type, account_id, transfer_account_id, category_id, amount_cents, note, position)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    let plantillasNuevas = 0
    let plantillasRespetadas = 0
    const plantillasCojas: string[] = []
    for (const t of config.plantillas ?? []) {
      if (yaHay.has(String(t.name).toLowerCase())) {
        plantillasRespetadas += 1
        continue
      }
      const kind = t.type === 'ingreso' ? 'ingreso' : 'gasto'
      const cuenta = t.cuenta ? (cuentaPorNombre.get(t.cuenta.toLowerCase()) ?? null) : null
      const destino = t.cuentaDestino
        ? (cuentaPorNombre.get(t.cuentaDestino.toLowerCase()) ?? null)
        : null
      const categoria = t.categoria
        ? (categoriaPorNombre.get(`${t.categoria.toLowerCase()}·${kind}`) ?? null)
        : null
      if ((t.cuenta && !cuenta) || (t.categoria && !categoria)) plantillasCojas.push(t.name)
      insertarPlantilla.run(
        profileId,
        t.name,
        t.type,
        cuenta,
        t.type === 'transferencia' ? destino : null,
        t.type === 'transferencia' ? null : categoria,
        t.amountCents ?? null,
        t.note ?? '',
        t.position ?? 0,
      )
      plantillasNuevas += 1
    }

    return {
      categoriasNuevas,
      camposNuevos,
      plantillasNuevas,
      plantillasCojas,
      respetadas: {
        categorias: categoriasRespetadas,
        campos: camposRespetados,
        plantillas: plantillasRespetadas,
      },
    }
  })
}
