import { useState } from 'react'
import { api } from '../api.ts'
import { useApp } from '../context.ts'
import { useFetch } from '../hooks.ts'
import type { CampoPropio, TipoCampo } from '../../shared/types.ts'

const TIPOS: { id: TipoCampo; label: string; pista: string }[] = [
  { id: 'texto', label: 'Texto', pista: 'Lo que sea: un folio, una placa, un nombre.' },
  { id: 'numero', label: 'Número', pista: 'Se valida que sea un número, para que se pueda leer fuera.' },
  { id: 'fecha', label: 'Fecha', pista: 'AAAA-MM-DD, como todas las fechas del libro.' },
  { id: 'lista', label: 'Lista', pista: 'Opciones fijas, una por renglón. Nada fuera de ellas entra.' },
  { id: 'casilla', label: 'Sí / no', pista: 'Una palomita. El "no" no se guarda: es la ausencia.' },
]

/**
 * Los campos propios del perfil (D24, Fase 21).
 *
 * Un dato que solo este libro necesita —la placa del coche, el número de obra,
 * el paciente— y que Finply no tiene por qué entender. Por eso mismo **no
 * suma**: se ve en el movimiento, se edita y sale en el CSV, pero ningún
 * reporte lo agrega. Un dato que Finply no entiende no puede mover una cifra
 * que sí entiende.
 */
export function CamposPropios() {
  const { profile, bump, stamp } = useApp()
  const [nuevo, setNuevo] = useState(false)
  const [label, setLabel] = useState('')
  const [kind, setKind] = useState<TipoCampo>('texto')
  const [options, setOptions] = useState('')
  const [borrando, setBorrando] = useState<CampoPropio | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { data: campos, reload } = useFetch(
    () => api.personalizacion.campos.list(profile.id),
    [profile.id],
  )

  const limpiar = () => {
    setNuevo(false)
    setLabel('')
    setKind('texto')
    setOptions('')
  }

  const crear = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!label.trim()) return setError('Ponle nombre al campo')
    try {
      await api.personalizacion.campos.create({
        profileId: profile.id,
        label: label.trim(),
        kind,
        options: kind === 'lista' ? options : '',
      })
      stamp('Guardado')
      limpiar()
      setError(null)
      reload()
      bump()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const archivar = async (campo: CampoPropio) => {
    try {
      await api.personalizacion.campos.update(campo.id, profile.id, { archived: !campo.archived })
      reload()
      bump()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const mover = async (campo: CampoPropio, delta: number) => {
    const lista = campos ?? []
    const i = lista.findIndex((c) => c.id === campo.id)
    const vecino = lista[i + delta]
    if (!vecino) return
    try {
      await api.personalizacion.campos.update(campo.id, profile.id, { position: vecino.position })
      await api.personalizacion.campos.update(vecino.id, profile.id, { position: campo.position })
      reload()
      bump()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const borrar = async (campo: CampoPropio) => {
    try {
      const { respuestas } = await api.personalizacion.campos.remove(campo.id, profile.id)
      stamp(respuestas > 0 ? `Borrado · ${respuestas} respuestas` : 'Borrado')
      setBorrando(null)
      reload()
      bump()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <section className="hoja ajustes-bloque">
      <h2 className="hoja-titulo">Campos propios</h2>
      <p className="ajustes-texto">
        Un dato que solo este libro necesita y que Finply no tiene por qué entender: la placa del
        coche, el número de obra, quién venía en la comida. Aparece en el formulario de movimiento y
        sale en el CSV. <strong>No entra a ningún reporte</strong>: nada que Finply no entienda
        puede mover una cifra que sí entiende.
      </p>

      {campos && campos.length > 0 && (
        <ul className="campos-lista">
          {campos.map((c, i) => (
            <li key={c.id} className={c.archived ? 'campo-fila archivado' : 'campo-fila'}>
              <span className="campo-fila-datos">
                <strong>{c.label}</strong>
                <span className="campo-fila-sub">
                  {TIPOS.find((t) => t.id === c.kind)?.label ?? c.kind}
                  {c.usos > 0 && ` · ${c.usos} ${c.usos === 1 ? 'respuesta' : 'respuestas'}`}
                  {c.archived && ' · archivado'}
                </span>
              </span>
              <span className="campo-fila-acciones">
                <button
                  type="button"
                  className="accion"
                  aria-label={`Subir ${c.label}`}
                  disabled={i === 0}
                  onClick={() => void mover(c, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="accion"
                  aria-label={`Bajar ${c.label}`}
                  disabled={i === (campos.length - 1)}
                  onClick={() => void mover(c, 1)}
                >
                  ↓
                </button>
                <button type="button" className="btn-liga" onClick={() => void archivar(c)}>
                  {c.archived ? 'Reactivar' : 'Archivar'}
                </button>
                {borrando?.id === c.id ? (
                  <span className="confirmar">
                    {c.usos > 0 ? `¿Borrar y perder ${c.usos}?` : '¿Borrar?'}
                    <button type="button" className="btn-liga btn-liga-rojo" onClick={() => void borrar(c)}>
                      Sí
                    </button>
                    <button type="button" className="btn-liga" onClick={() => setBorrando(null)}>
                      No
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="btn-liga btn-liga-rojo"
                    onClick={() => setBorrando(c)}
                  >
                    Borrar
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {nuevo ? (
        <form className="forma campos-forma" onSubmit={crear}>
          <div className="campos-2">
            <label className="campo">
              <span className="campo-label">Cómo se llama</span>
              <input
                className="campo-input"
                placeholder="Ej. Número de obra"
                maxLength={40}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                autoFocus
              />
            </label>
            <label className="campo">
              <span className="campo-label">Qué guarda</span>
              <select
                className="campo-input"
                value={kind}
                onChange={(e) => setKind(e.target.value as TipoCampo)}
              >
                {TIPOS.map((t) => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </select>
            </label>
          </div>
          <p className="campo-nota">{TIPOS.find((t) => t.id === kind)?.pista}</p>
          {kind === 'lista' && (
            <label className="campo">
              <span className="campo-label">Opciones, una por renglón</span>
              <textarea
                className="campo-input nota-textarea"
                rows={4}
                placeholder={'Obra Norte\nObra Sur\nTaller'}
                value={options}
                onChange={(e) => setOptions(e.target.value)}
              />
            </label>
          )}
          <p className="campo-nota">
            El tipo no se puede cambiar después si el campo ya tiene respuestas: cambiarlo debajo
            dejaría valores que el propio formulario rechaza al guardar.
          </p>
          {error && <p className="forma-error" role="alert">{error}</p>}
          <footer className="forma-pie">
            <button type="button" className="btn btn-fantasma btn-chico" onClick={limpiar}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primario btn-chico">Agregar campo</button>
          </footer>
        </form>
      ) : (
        <>
          {error && <p className="forma-error" role="alert">{error}</p>}
          <button type="button" className="btn btn-fantasma btn-chico" onClick={() => setNuevo(true)}>
            ＋ Nuevo campo
          </button>
        </>
      )}
    </section>
  )
}
