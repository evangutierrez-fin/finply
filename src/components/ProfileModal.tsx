import { useState } from 'react'
import type { Accent, Profile, ProfileKind } from '../../shared/types.ts'
import { api } from '../api.ts'
import { Modal } from './Modal.tsx'

const ACCENTS: { id: Accent; label: string }[] = [
  { id: 'verde', label: 'Verde banca' },
  { id: 'laton', label: 'Latón' },
  { id: 'cobalto', label: 'Cobalto' },
  { id: 'vino', label: 'Vino' },
]

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
  const [accent, setAccent] = useState<Accent>(profile?.accent ?? 'verde')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return setError('El perfil necesita un nombre')
    setSaving(true)
    setError(null)
    try {
      const saved = profile
        ? await api.profiles.update(profile.id, { name: name.trim(), kind, accent })
        : await api.profiles.create({ name: name.trim(), kind, accent })
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
                  onChange={() => setKind('personal')}
                />
                Personal
              </label>
              <label className="radio">
                <input
                  type="radio"
                  name="kind"
                  checked={kind === 'negocio'}
                  onChange={() => setKind('negocio')}
                />
                Negocio
              </label>
            </div>
          </fieldset>
          <fieldset className="campo campo-fieldset">
            <legend className="campo-label">Tinta</legend>
            <div className="tintas">
              {ACCENTS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className={`tinta-swatch dot-${a.id}${accent === a.id ? ' activa' : ''}`}
                  aria-label={a.label}
                  aria-pressed={accent === a.id}
                  onClick={() => setAccent(a.id)}
                />
              ))}
            </div>
          </fieldset>
        </div>
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
