import { useState } from 'react'
import type { ModuloId, Profile, ProfileKind } from '../../shared/types.ts'
import { porOmision } from '../../shared/modulos.ts'
import { api } from '../api.ts'
import { Modal } from './Modal.tsx'
import { ModulosPicker } from './ModulosPicker.tsx'
import { TintaPicker, tintaInicial, tintaPayload, tintaValida } from './TintaPicker.tsx'

export function ProfileModal({
  profile,
  canDelete,
  onClose,
  onSaved,
  onDeleted,
}: {
  profile: Profile | null
  canDelete: boolean
  onClose: () => void
  onSaved: (profile: Profile) => void
  onDeleted: () => void
}) {
  const [name, setName] = useState(profile?.name ?? '')
  const [kind, setKind] = useState<ProfileKind>(profile?.kind ?? 'personal')
  const [tinta, setTinta] = useState(() =>
    tintaInicial(profile?.accent ?? 'verde', profile?.accentHex ?? null, profile?.accentHexDark ?? null),
  )
  const [dimensionLabel, setDimensionLabel] = useState(profile?.dimensionLabel ?? 'Proyecto')
  const [modules, setModules] = useState<ModuloId[]>(
    () => profile?.modules ?? porOmision(profile?.kind ?? 'personal'),
  )
  // Un perfil nuevo cuyos módulos nadie ha tocado sigue al tipo; uno que ya
  // existe no, porque su elección ya está hecha y cambiar de tipo no puede
  // devolverle secciones que apagó.
  const [tocado, setTocado] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const elegirKind = (next: ProfileKind) => {
    setKind(next)
    if (!profile && !tocado) setModules(porOmision(next))
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return setError('El perfil necesita un nombre')
    // El servidor rechaza igual una tinta ilegible; esto solo evita el viaje.
    if (!tintaValida(tinta)) return setError('Esa tinta no se lee: ajústala hasta que cumpla AA')
    setSaving(true)
    setError(null)
    try {
      const datos = {
        name: name.trim(),
        kind,
        dimensionLabel: dimensionLabel.trim() || 'Proyecto',
        modules,
        ...tintaPayload(tinta),
      }
      const saved = profile
        ? await api.profiles.update(profile.id, datos)
        : await api.profiles.create(datos)
      onSaved(saved)
      onClose()
    } catch (err) {
      setError((err as Error).message)
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!profile) return
    setSaving(true)
    try {
      await api.profiles.remove(profile.id)
      onDeleted()
      onClose()
    } catch (err) {
      setError((err as Error).message)
      setSaving(false)
    }
  }

  return (
    <Modal title={profile ? 'Editar perfil' : 'Nuevo perfil'} onClose={onClose}>
      <form className="forma" onSubmit={submit}>
        <label className="campo">
          <span className="campo-label">Nombre</span>
          <input
            className="campo-input"
            placeholder="Ej. Ana · Personal, Mi negocio"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </label>
        <div className="campos-2">
          <fieldset className="campo campo-fieldset">
            <legend className="campo-label">Tipo de libro</legend>
            <div className="radios">
              <label className="radio">
                <input
                  type="radio"
                  name="kind"
                  checked={kind === 'personal'}
                  onChange={() => elegirKind('personal')}
                />
                Personal
              </label>
              <label className="radio">
                <input
                  type="radio"
                  name="kind"
                  checked={kind === 'negocio'}
                  onChange={() => elegirKind('negocio')}
                />
                Negocio
              </label>
            </div>
          </fieldset>
          <TintaPicker valor={tinta} onChange={setTinta} />
        </div>
        <ModulosPicker
          valor={modules}
          kind={kind}
          onChange={(m) => {
            setTocado(true)
            setModules(m)
          }}
          titulo={profile ? 'Secciones de este libro' : '¿Qué llevas en este libro?'}
        />
        {/* La dimensión libre es de las vistas de negocio: se pregunta cuando
            ese módulo está encendido, no cuando el tipo de perfil dice negocio.
            Desde la Fase 9 el tipo solo elige el juego por omisión. */}
        {modules.includes('negocio') && (
          <label className="campo">
            <span className="campo-label">Cómo llamas a tu dimensión libre</span>
            <input
              className="campo-input"
              value={dimensionLabel}
              onChange={(e) => setDimensionLabel(e.target.value)}
              placeholder="Proyecto"
              maxLength={24}
            />
            <span className="campo-ayuda">
              Cada movimiento puede pertenecer a uno. Un taller diría "Obra", una cadena diría
              "Sucursal", una consultora diría "Cliente": Finply no lo decide por ti.
            </span>
          </label>
        )}
        {error && <p className="forma-error" role="alert">{error}</p>}
        <footer className="forma-pie forma-pie-doble">
          {profile && canDelete ? (
            confirmDelete ? (
              <span className="confirmar">
                ¿Borrar perfil y todos sus registros?
                <button type="button" className="btn-liga btn-liga-rojo" onClick={remove}>
                  Sí, borrar
                </button>
                <button type="button" className="btn-liga" onClick={() => setConfirmDelete(false)}>
                  No
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="btn-liga btn-liga-rojo"
                onClick={() => setConfirmDelete(true)}
              >
                Borrar perfil
              </button>
            )
          ) : (
            <span />
          )}
          <span className="forma-pie-der">
            <button type="button" className="btn btn-fantasma" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primario" disabled={saving}>
              {saving ? 'Guardando…' : profile ? 'Guardar cambios' : 'Crear perfil'}
            </button>
          </span>
        </footer>
      </form>
    </Modal>
  )
}
