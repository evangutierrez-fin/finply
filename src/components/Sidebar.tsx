import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { vistaVisible } from '../../shared/modulos.ts'
import type { Profile } from '../../shared/types.ts'

/** El punto del perfil: su preset, o su tinta propia si eligió una. */
function TintaDot({ profile }: { profile: Profile }) {
  if (profile.accentHex && profile.accentHexDark) {
    return (
      <span
        className="tinta-dot dot-propia"
        aria-hidden="true"
        style={
          {
            '--dot-claro': profile.accentHex,
            '--dot-oscuro': profile.accentHexDark,
          } as CSSProperties
        }
      />
    )
  }
  return <span className={`tinta-dot dot-${profile.accent}`} aria-hidden="true" />
}

export type View =
  | 'resumen'
  | 'movimientos'
  | 'cuentas'
  | 'reportes'
  | 'analisis'
  | 'tarjetas'
  | 'deudas'
  | 'bienes'
  | 'inversiones'
  | 'simulador'
  | 'contrapartes'
  | 'facturas'
  | 'negocio'
  | 'presupuestos'
  | 'metas'
  | 'notas'
  | 'taxonomia'
  | 'importar'
  | 'recurrencias'
  | 'calendario'
  | 'flujo'
  | 'ajustes'

export type ThemePref = 'claro' | 'oscuro' | 'auto'

/**
 * El lomo completo. Lo que se muestra sale de cruzarlo con los módulos activos
 * del perfil: una vista de módulo apagado no aparece, y un grupo que se queda
 * sin renglones desaparece con su rótulo. Antes esto se decidía con
 * `profile.kind`; ahora el tipo solo elige el juego por omisión (D16).
 */
const NAV_GROUPS: { label: string | null; items: { id: View; label: string }[] }[] = [
  { label: null, items: [{ id: 'resumen', label: 'Resumen' }] },
  {
    label: 'El libro',
    items: [
      { id: 'movimientos', label: 'Movimientos' },
      { id: 'cuentas', label: 'Cuentas' },
      { id: 'taxonomia', label: 'Categorías' },
      { id: 'reportes', label: 'Reportes' },
      { id: 'analisis', label: 'Análisis' },
    ],
  },
  {
    label: 'Patrimonio',
    items: [
      { id: 'tarjetas', label: 'Tarjetas' },
      { id: 'deudas', label: 'Deudas' },
      { id: 'bienes', label: 'Bienes' },
      { id: 'inversiones', label: 'Inversiones' },
      { id: 'simulador', label: 'Simulador' },
    ],
  },
  {
    label: 'Plan',
    items: [
      { id: 'recurrencias', label: 'Recurrencias' },
      { id: 'calendario', label: 'Calendario' },
      { id: 'flujo', label: 'Flujo' },
      { id: 'presupuestos', label: 'Presupuestos' },
      { id: 'metas', label: 'Metas' },
      { id: 'notas', label: 'Notas' },
    ],
  },
  {
    label: 'Negocio',
    items: [
      { id: 'contrapartes', label: 'Contrapartes' },
      { id: 'facturas', label: 'Facturas' },
      { id: 'negocio', label: 'Resultados' },
    ],
  },
]

const THEME_LABEL: Record<ThemePref, string> = {
  claro: '☀ Claro',
  oscuro: '☾ Oscuro',
  auto: '◐ Auto',
}

const KIND_LABEL = { personal: 'Personal', negocio: 'Negocio' } as const

export function Sidebar({
  profiles,
  profile,
  view,
  theme,
  onCycleTheme,
  onNav,
  onSelectProfile,
  onNewProfile,
  onEditProfile,
  onRegister,
}: {
  profiles: Profile[]
  profile: Profile
  view: View
  theme: ThemePref
  onCycleTheme: () => void
  onNav: (view: View) => void
  onSelectProfile: (id: number) => void
  onNewProfile: () => void
  onEditProfile: (profile: Profile) => void
  onRegister: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Un grupo que se queda sin renglones desaparece con su rótulo: "Patrimonio"
  // sobre un hueco se lee como un error de la app, no como una elección.
  const grupos = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => vistaVisible(item.id, profile.modules)),
  })).filter((group) => group.items.length > 0)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <aside className="lomo">
      <div className="marca">
        <span className="marca-nombre">Finply</span>
        <span className="marca-sub">Libro de finanzas</span>
      </div>

      <div className="perfil" ref={ref}>
        <button
          type="button"
          className="perfil-actual"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-haspopup="listbox"
        >
          <TintaDot profile={profile} />
          <span className="perfil-textos">
            <span className="perfil-nombre">{profile.name}</span>
            <span className="perfil-tipo">{KIND_LABEL[profile.kind]}</span>
          </span>
          <span className="perfil-flecha" aria-hidden="true">▾</span>
        </button>
        {open && (
          <div className="perfil-lista" role="listbox" aria-label="Cambiar de perfil">
            {profiles.map((p) => (
              <button
                key={p.id}
                type="button"
                role="option"
                aria-selected={p.id === profile.id}
                className={`perfil-opcion${p.id === profile.id ? ' activa' : ''}`}
                onClick={() => {
                  setOpen(false)
                  if (p.id !== profile.id) onSelectProfile(p.id)
                }}
              >
                <TintaDot profile={p} />
                <span className="perfil-textos">
                  <span className="perfil-nombre">{p.name}</span>
                  <span className="perfil-tipo">{KIND_LABEL[p.kind]}</span>
                </span>
              </button>
            ))}
            <div className="perfil-lista-pie">
              <button
                type="button"
                className="btn-liga"
                onClick={() => {
                  setOpen(false)
                  onEditProfile(profile)
                }}
              >
                Editar perfil
              </button>
              <button
                type="button"
                className="btn-liga"
                onClick={() => {
                  setOpen(false)
                  onNewProfile()
                }}
              >
                ＋ Nuevo perfil
              </button>
            </div>
          </div>
        )}
      </div>

      <nav className="nav" aria-label="Secciones">
        {grupos.map((group, gi) => (
          <div className="nav-grupo" key={group.label ?? gi}>
            {group.label && <span className="nav-grupo-label">{group.label}</span>}
            {group.items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`nav-item${view === item.id ? ' activa' : ''}`}
                aria-current={view === item.id ? 'page' : undefined}
                onClick={() => onNav(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        ))}
      </nav>

      <div className="lomo-pie">
        <div className="lomo-pie-fila">
          <button
            type="button"
            className="btn btn-fantasma btn-chico tema-btn"
            onClick={onCycleTheme}
            aria-label={`Tema: ${THEME_LABEL[theme]}. Cambiar`}
          >
            {THEME_LABEL[theme]}
          </button>
          {/* Ajustes es configuración de la app, no una sección del libro:
              vive con el tema, no con Movimientos y Metas. */}
          <button
            type="button"
            className={`btn btn-fantasma btn-chico ajustes-btn${view === 'ajustes' ? ' activa' : ''}`}
            aria-current={view === 'ajustes' ? 'page' : undefined}
            onClick={() => onNav('ajustes')}
          >
            ⚙ Ajustes
          </button>
        </div>
        <button type="button" className="btn btn-primario btn-registrar" onClick={onRegister}>
          ＋ Registrar movimiento
        </button>
        <span className="lomo-nota">Local · MXN · MIT</span>
      </div>
    </aside>
  )
}
