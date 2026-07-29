// Administración de categorías y etiquetas del perfil abierto.
//
// El caso delicado es borrar una categoría en uso: el servidor responde 409
// con la cuenta de movimientos en vez de perder su clasificación, y aquí se
// pregunta a dónde moverlos.

import { useState } from 'react'
import { ApiError, api } from '../api.ts'
import { useApp } from '../context.ts'
import { useFetch } from '../hooks.ts'
import type { Category, RolCategoria, Tag } from '../../shared/types.ts'

type Pendiente = { categoria: Category; txCount: number }

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
  const [error, setError] = useState<string | null>(null)
  const esNegocio = profile.kind === 'negocio'
  const [pendiente, setPendiente] = useState<Pendiente | null>(null)
  const [destino, setDestino] = useState(0)
  const [nuevaEtiqueta, setNuevaEtiqueta] = useState('')

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

      {grupos.map((grupo) => (
        <section className="hoja ajustes-bloque" key={grupo.kind}>
          <h2 className="hoja-titulo">Categorías · {grupo.label}</h2>
          <ul className="taxo-lista">
            {(categorias ?? [])
              .filter((c) => c.kind === grupo.kind)
              .map((c) => (
                <li className="taxo-fila" key={c.id}>
                  <Renombrable
                    nombre={c.name}
                    onGuardar={async (nuevo) => {
                      if (nuevo && nuevo !== c.name) {
                        await correr(() => api.categories.rename(c.id, nuevo), 'Renombrada')
                      }
                    }}
                  />
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
                            api.categories.setRole(
                              c.id,
                              c.name,
                              (e.target.value || null) as RolCategoria | null,
                            ),
                          'Clasificada',
                        )
                      }
                    >
                      <option value="">Sin clasificar</option>
                      <option value="costo_venta">Costo de ventas</option>
                      <option value="gasto_fijo">Gasto fijo</option>
                      <option value="gasto_variable">Gasto variable</option>
                    </select>
                  )}
                  <span className="taxo-cuenta">
                    {c.txCount} movimiento{c.txCount === 1 ? '' : 's'}
                  </span>
                  <button type="button" className="btn-liga deuda-borrar" onClick={() => void borrarCategoria(c)}>
                    Borrar
                  </button>
                </li>
              ))}
          </ul>
          <p className="ajustes-nota">
            Las categorías nuevas se crean al registrar un movimiento.
            {esNegocio && grupo.kind === 'gasto' && (
              <>
                {' '}El papel de cada una es lo que arma tu estado de resultados y tu punto de
                equilibrio. Lo que dejes sin clasificar no se reparte a ojo: aparece aparte.
              </>
            )}
          </p>
        </section>
      ))}

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
