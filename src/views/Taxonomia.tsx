// Administración de categorías y etiquetas del perfil abierto.
//
// El caso delicado es borrar una categoría en uso: el servidor responde 409
// con la cuenta de movimientos en vez de perder su clasificación, y aquí se
// pregunta a dónde moverlos.
//
// Desde la Fase 23 esta vista lleva además la jerarquía de un nivel (D25), el
// archivado y las reglas que proponen categoría al importar. Las tres cosas
// viven juntas porque son la misma pregunta —cómo está organizado este libro—
// y partirlas en tres pantallas obligaría a ir y venir para colgar una
// categoría de otra y luego escribirle su regla.

import { useState } from 'react'
import { ApiError, api } from '../api.ts'
import { useApp } from '../context.ts'
import { useFetch } from '../hooks.ts'
import type { Category, RolCategoria, ReglaImport, Tag } from '../../shared/types.ts'
import { rotuloCategoria } from '../../shared/taxonomia.ts'

type Pendiente = { categoria: Category; txCount: number }

const ROL_LABEL: Record<RolCategoria, string> = {
  costo_venta: 'Costo de ventas',
  gasto_fijo: 'Gasto fijo',
  gasto_variable: 'Gasto variable',
}

/**
 * Alta de categoría desde esta vista. Hasta la Fase 23 solo se podían crear al
 * registrar un movimiento, y ahí no hay dónde decir de quién cuelga: una
 * subcategoría se piensa organizando el libro, no tecleando un gasto.
 */
function NuevaCategoria({
  kind,
  padres,
  onCrear,
}: {
  kind: 'ingreso' | 'gasto'
  padres: Category[]
  onCrear: (datos: { name: string; kind: 'ingreso' | 'gasto'; parentId: number | null }) => Promise<boolean>
}) {
  const [name, setName] = useState('')
  const [parentId, setParentId] = useState(0)
  return (
    <form
      className="campo-inline"
      onSubmit={async (e) => {
        e.preventDefault()
        const limpio = name.trim()
        if (!limpio) return
        if (await onCrear({ name: limpio, kind, parentId: parentId || null })) {
          setName('')
          setParentId(0)
        }
      }}
    >
      <input
        className="campo-input"
        placeholder={`Nueva categoría de ${kind}…`}
        maxLength={40}
        value={name}
        onChange={(e) => setName(e.target.value)}
        aria-label={`Nueva categoría de ${kind}`}
      />
      <select
        className="filtro"
        value={parentId}
        onChange={(e) => setParentId(Number(e.target.value))}
        aria-label="Dentro de"
      >
        <option value={0}>Principal</option>
        {padres.map((p) => (
          <option key={p.id} value={p.id}>Dentro de {p.name}</option>
        ))}
      </select>
      <button type="submit" className="btn btn-primario btn-chico" disabled={!name.trim()}>
        Crear
      </button>
    </form>
  )
}

function Renombrable({
  nombre,
  onGuardar,
}: {
  nombre: string
  onGuardar: (nuevo: string) => Promise<void>
}) {
  const [editando, setEditando] = useState(false)
  const [valor, setValor] = useState(nombre)

  if (!editando) {
    return (
      <button type="button" className="btn-liga taxo-nombre" onClick={() => { setValor(nombre); setEditando(true) }}>
        {nombre}
      </button>
    )
  }
  const guardar = async () => {
    await onGuardar(valor.trim())
    setEditando(false)
  }
  return (
    <span className="campo-inline taxo-editor">
      <input
        className="campo-input"
        value={valor}
        autoFocus
        onChange={(e) => setValor(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); void guardar() }
          if (e.key === 'Escape') setEditando(false)
        }}
      />
      <button type="button" className="btn-liga" onClick={() => void guardar()}>Guardar</button>
      <button type="button" className="btn-liga" onClick={() => setEditando(false)}>Cancelar</button>
    </span>
  )
}

export function Taxonomia() {
  const { profile, refreshKey, bump, stamp } = useApp()
  const { data: categorias, error: errCat } = useFetch(
    () => api.categories.list(profile.id),
    [profile.id, refreshKey],
  )
  const { data: etiquetas, error: errTag } = useFetch(
    () => api.tags.list(profile.id),
    [profile.id, refreshKey],
  )
  const { data: reglas, error: errReglas } = useFetch(
    () => api.categories.reglas.list(profile.id),
    [profile.id, refreshKey],
  )
  const [error, setError] = useState<string | null>(null)
  // El papel de una categoría solo significa algo en el estado de resultados,
  // que es del módulo de negocio.
  const esNegocio = profile.modules.includes('negocio')
  const [pendiente, setPendiente] = useState<Pendiente | null>(null)
  const [destino, setDestino] = useState(0)
  const [nuevaEtiqueta, setNuevaEtiqueta] = useState('')
  const [verArchivadas, setVerArchivadas] = useState(false)
  const [nuevaRegla, setNuevaRegla] = useState({ pattern: '', categoryId: 0 })

  const correr = async (fn: () => Promise<unknown>, sello?: string) => {
    try {
      await fn()
      setError(null)
      if (sello) stamp(sello)
      bump()
      return true
    } catch (err) {
      setError((err as Error).message)
      return false
    }
  }

  const borrarCategoria = async (categoria: Category) => {
    try {
      await api.categories.remove(categoria.id)
      setError(null)
      stamp('Borrada')
      bump()
    } catch (err) {
      // 409 = está en uso. No es un fallo: es una pregunta.
      if (err instanceof ApiError && err.status === 409) {
        setPendiente({ categoria, txCount: err.body?.txCount ?? 0 })
        setDestino(0)
        setError(null)
        return
      }
      setError((err as Error).message)
    }
  }

  const resolverPendiente = async (modo: 'mover' | 'sinCategoria') => {
    if (!pendiente) return
    const ok = await correr(
      () =>
        api.categories.remove(pendiente.categoria.id,
          modo === 'mover' ? { reassignTo: destino } : { force: true }),
      'Borrada',
    )
    if (ok) setPendiente(null)
  }

  const grupos: { kind: 'gasto' | 'ingreso'; label: string }[] = [
    { kind: 'gasto', label: 'De gasto' },
    { kind: 'ingreso', label: 'De ingreso' },
  ]

  /**
   * Sube una regla un lugar **intercambiando** las dos posiciones, no restando
   * uno: bajarle el número a una sola dejaría dos reglas empatadas y el orden
   * lo decidiría el id, que es como se ve un orden que no funciona.
   */
  const subirRegla = async (i: number) => {
    const lista = reglas ?? []
    const arriba = lista[i - 1]
    const esta = lista[i]
    if (!arriba || !esta) return
    await correr(async () => {
      await api.categories.reglas.update(esta.id, { position: arriba.position })
      await api.categories.reglas.update(arriba.id, { position: esta.position })
    }, 'Ordenada')
  }

  const todas = categorias ?? []
  /**
   * Las de un tipo, padres primero y cada hija detrás de la suya. El orden lo
   * da el servidor; aquí solo se filtra por tipo y por archivadas.
   */
  const delTipo = (kind: 'gasto' | 'ingreso') =>
    todas.filter((c) => c.kind === kind && (verArchivadas || !c.fueraDelSelector))
  /** Las que pueden ser padre: principales del mismo tipo y vivas. */
  const posiblesPadres = (c: Category) =>
    todas.filter(
      (p) => p.kind === c.kind && p.parentId === null && p.id !== c.id && !p.archived,
    )
  const archivadas = todas.filter((c) => c.fueraDelSelector).length

  return (
    <div className="vista">
      <header className="vista-head">
        <h1>Categorías y etiquetas</h1>
        <span className="vista-mes">{profile.name}</span>
      </header>

      {(error || errCat || errTag) && (
        <p className="aviso" role="alert">{error ?? errCat ?? errTag}</p>
      )}

      {pendiente && (
        <section className="hoja taxo-pendiente">
          <h2 className="hoja-titulo">¿Y sus movimientos?</h2>
          <p className="ajustes-texto">
            <strong>{pendiente.categoria.name}</strong> tiene {pendiente.txCount} movimiento
            {pendiente.txCount === 1 ? '' : 's'}. Ningún monto cambia: solo eliges cómo quedan
            clasificados.
          </p>
          <div className="taxo-pendiente-forma">
            <select
              className="filtro"
              value={destino}
              onChange={(e) => setDestino(Number(e.target.value))}
              aria-label="Mover a la categoría"
            >
              <option value={0} disabled>Moverlos a…</option>
              {(categorias ?? [])
                .filter((c) => c.kind === pendiente.categoria.kind && c.id !== pendiente.categoria.id)
                .map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
            </select>
            <button
              type="button"
              className="btn btn-primario btn-chico"
              disabled={!destino}
              onClick={() => void resolverPendiente('mover')}
            >
              Mover y borrar
            </button>
            <button type="button" className="btn-liga" onClick={() => void resolverPendiente('sinCategoria')}>
              Dejarlos sin categoría
            </button>
            <button type="button" className="btn-liga" onClick={() => setPendiente(null)}>
              Cancelar
            </button>
          </div>
        </section>
      )}

      {archivadas > 0 && (
        <p className="ajustes-nota taxo-archivadas-aviso">
          {archivadas} categoría{archivadas === 1 ? '' : 's'} archivada
          {archivadas === 1 ? '' : 's'}: fuera del selector, con su historial intacto.{' '}
          <button type="button" className="btn-liga" onClick={() => setVerArchivadas(!verArchivadas)}>
            {verArchivadas ? 'Ocultarlas' : 'Verlas'}
          </button>
        </p>
      )}

      {grupos.map((grupo) => (
        <section className="hoja ajustes-bloque" key={grupo.kind}>
          <h2 className="hoja-titulo">Categorías · {grupo.label}</h2>
          <ul className="taxo-lista">
            {delTipo(grupo.kind).map((c) => (
              <li
                className={`taxo-fila${c.parentId ? ' taxo-hija' : ''}${c.fueraDelSelector ? ' taxo-archivada' : ''}`}
                key={c.id}
              >
                <Renombrable
                  nombre={c.name}
                  onGuardar={async (nuevo) => {
                    if (nuevo && nuevo !== c.name) {
                      await correr(() => api.categories.update(c.id, { name: nuevo }), 'Renombrada')
                    }
                  }}
                />
                {/* De quién cuelga. Una categoría con hijas no puede volverse
                    hija: el selector se apaga y lo dice, en vez de dejar
                    intentarlo para responder con un 400. */}
                <select
                  className="taxo-rol"
                  aria-label={`Categoría padre de ${c.name}`}
                  value={c.parentId ?? ''}
                  disabled={c.hijos > 0}
                  title={c.hijos > 0 ? `Tiene ${c.hijos} subcategoría(s)` : undefined}
                  onChange={(e) =>
                    void correr(
                      () =>
                        api.categories.update(c.id, {
                          parentId: e.target.value ? Number(e.target.value) : null,
                        }),
                      'Movida',
                    )
                  }
                >
                  <option value="">Principal</option>
                  {posiblesPadres(c).map((p) => (
                    <option key={p.id} value={p.id}>
                      Dentro de {p.name}
                    </option>
                  ))}
                </select>
                {/* El papel solo aplica al gasto: un ingreso no es ni fijo
                    ni variable, es la venta contra la que se miden. */}
                {esNegocio && grupo.kind === 'gasto' && (
                  <select
                    className="taxo-rol"
                    aria-label={`Papel de ${c.name} en el estado de resultados`}
                    value={c.role ?? ''}
                    onChange={(e) =>
                      void correr(
                        () =>
                          api.categories.update(c.id, {
                            role: (e.target.value || null) as RolCategoria | null,
                          }),
                        'Clasificada',
                      )
                    }
                  >
                    {/* Una hija sin papel propio dice de quién lo hereda: sin
                        eso, "Sin clasificar" mentiría sobre dónde cae. */}
                    <option value="">
                      {c.parentId && c.rolEfectivo ? `Hereda: ${ROL_LABEL[c.rolEfectivo]}` : 'Sin clasificar'}
                    </option>
                    <option value="costo_venta">Costo de ventas</option>
                    <option value="gasto_fijo">Gasto fijo</option>
                    <option value="gasto_variable">Gasto variable</option>
                  </select>
                )}
                <span className="taxo-cuenta">
                  {c.txCount} movimiento{c.txCount === 1 ? '' : 's'}
                </span>
                <button
                  type="button"
                  className="btn-liga"
                  onClick={() =>
                    void correr(
                      () => api.categories.update(c.id, { archived: !c.archived }),
                      c.archived ? 'Devuelta' : 'Archivada',
                    )
                  }
                >
                  {c.archived ? 'Desarchivar' : 'Archivar'}
                </button>
                <button type="button" className="btn-liga deuda-borrar" onClick={() => void borrarCategoria(c)}>
                  Borrar
                </button>
              </li>
            ))}
          </ul>
          <NuevaCategoria
            kind={grupo.kind}
            padres={todas.filter((p) => p.kind === grupo.kind && p.parentId === null && !p.archived)}
            onCrear={(datos) =>
              correr(() => api.categories.create({ profileId: profile.id, ...datos }), 'Creada')
            }
          />
          <p className="ajustes-nota">
            Una subcategoría suma dentro de su padre en todos los reportes, y el desglose se ve
            debajo. Finply lleva <strong>un solo nivel</strong>: una que tenga hijas no puede
            colgar de otra.
            {esNegocio && grupo.kind === 'gasto' && (
              <>
                {' '}El papel de cada una es lo que arma tu estado de resultados y tu punto de
                equilibrio; una hija sin papel propio toma el de su padre. Lo que dejes sin
                clasificar no se reparte a ojo: aparece aparte.
              </>
            )}
          </p>
        </section>
      ))}

      <section className="hoja ajustes-bloque">
        <h2 className="hoja-titulo">Reglas al importar</h2>
        <p className="ajustes-texto">
          "Si el concepto trae OXXO, propón Despensa". <strong>Proponen, no asientan</strong>: la
          categoría aparece rellenada en la vista previa del import y tú confirmas el lote como
          siempre. Solo hablan cuando el archivo no trae categoría, y gana la primera que case —
          por eso la más específica va arriba.
        </p>
        {errReglas && <p className="aviso" role="alert">{errReglas}</p>}
        <ul className="taxo-lista">
          {(reglas ?? []).map((r: ReglaImport, i: number) => (
            <li className="taxo-fila" key={r.id}>
              <span className="taxo-orden">{i + 1}</span>
              <code className="taxo-patron">{r.pattern}</code>
              <span className="taxo-flecha" aria-hidden="true">→</span>
              <span className="taxo-nombre-plano">{r.categoryName}</span>
              <button
                type="button"
                className="btn-liga"
                disabled={i === 0}
                aria-label={`Subir la regla ${r.pattern}`}
                onClick={() => void subirRegla(i)}
              >
                ↑
              </button>
              <button
                type="button"
                className="btn-liga deuda-borrar"
                onClick={() => void correr(() => api.categories.reglas.remove(r.id), 'Borrada')}
              >
                Borrar
              </button>
            </li>
          ))}
        </ul>
        <form
          className="campo-inline"
          onSubmit={async (e) => {
            e.preventDefault()
            const pattern = nuevaRegla.pattern.trim()
            if (!pattern || !nuevaRegla.categoryId) return
            const ok = await correr(
              () =>
                api.categories.reglas.create({
                  profileId: profile.id,
                  pattern,
                  categoryId: nuevaRegla.categoryId,
                }),
              'Creada',
            )
            if (ok) setNuevaRegla({ pattern: '', categoryId: 0 })
          }}
        >
          <input
            className="campo-input"
            placeholder="Texto del concepto…"
            maxLength={60}
            value={nuevaRegla.pattern}
            onChange={(e) => setNuevaRegla({ ...nuevaRegla, pattern: e.target.value })}
            aria-label="Texto que se busca en el concepto"
          />
          <select
            className="filtro"
            value={nuevaRegla.categoryId}
            onChange={(e) => setNuevaRegla({ ...nuevaRegla, categoryId: Number(e.target.value) })}
            aria-label="Categoría que propone la regla"
          >
            <option value={0} disabled>Proponer…</option>
            {todas
              .filter((c) => !c.fueraDelSelector)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {rotuloCategoria(c)} ({c.kind})
                </option>
              ))}
          </select>
          <button
            type="submit"
            className="btn btn-primario btn-chico"
            disabled={!nuevaRegla.pattern.trim() || !nuevaRegla.categoryId}
          >
            Crear regla
          </button>
        </form>
      </section>

      <section className="hoja ajustes-bloque">
        <h2 className="hoja-titulo">Etiquetas</h2>
        <p className="ajustes-texto">
          Cruzan categorías: un mismo viaje puede tener comida, transporte y hospedaje.
          Borrar una etiqueta solo la despega; ningún movimiento se pierde.
        </p>
        <ul className="taxo-lista">
          {(etiquetas ?? []).map((t: Tag) => (
            <li className="taxo-fila" key={t.id}>
              <Renombrable
                nombre={t.name}
                onGuardar={async (nuevo) => {
                  if (nuevo && nuevo !== t.name) {
                    await correr(() => api.tags.rename(t.id, nuevo), 'Renombrada')
                  }
                }}
              />
              <span className="taxo-cuenta">
                {t.txCount} movimiento{t.txCount === 1 ? '' : 's'}
              </span>
              <button
                type="button"
                className="btn-liga deuda-borrar"
                onClick={() => void correr(() => api.tags.remove(t.id), 'Borrada')}
              >
                Borrar
              </button>
            </li>
          ))}
        </ul>
        <form
          className="campo-inline"
          onSubmit={async (e) => {
            e.preventDefault()
            const name = nuevaEtiqueta.trim()
            if (!name) return
            if (await correr(() => api.tags.create({ profileId: profile.id, name }), 'Creada')) {
              setNuevaEtiqueta('')
            }
          }}
        >
          <input
            className="campo-input"
            placeholder="Nueva etiqueta…"
            maxLength={30}
            value={nuevaEtiqueta}
            onChange={(e) => setNuevaEtiqueta(e.target.value)}
            aria-label="Nueva etiqueta"
          />
          <button type="submit" className="btn btn-primario btn-chico" disabled={!nuevaEtiqueta.trim()}>
            Crear
          </button>
        </form>
      </section>
    </div>
  )
}
