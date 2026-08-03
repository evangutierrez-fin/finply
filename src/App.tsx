import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { BorradorTx, ModuloId, Profile, ProfileKind, Tx } from '../shared/types.ts'
import { MODULOS, moduloDeVista, porOmision, vistaVisible } from '../shared/modulos.ts'
import { api } from './api.ts'
import { usarFormato } from './format.ts'
import { AppCtx } from './context.ts'
import { useAtajos } from './atajos.ts'
import { Sidebar, type ThemePref, type View } from './components/Sidebar.tsx'
import { Atajos } from './components/Atajos.tsx'
import { TxModal } from './components/TxModal.tsx'
import { ModulosPicker } from './components/ModulosPicker.tsx'
import { ProfileModal } from './components/ProfileModal.tsx'
import { TintaPicker, tintaInicial, tintaPayload, tintaValida } from './components/TintaPicker.tsx'
import { Resumen } from './views/Resumen.tsx'
import { Analisis } from './views/Analisis.tsx'
import { Simulador } from './views/Simulador.tsx'
import { Contrapartes } from './views/Contrapartes.tsx'
import { Facturas } from './views/Facturas.tsx'
import { Negocio } from './views/Negocio.tsx'
import { Movimientos } from './views/Movimientos.tsx'
import { Cuentas } from './views/Cuentas.tsx'
import { Reportes } from './views/Reportes.tsx'
import { Tarjetas } from './views/Tarjetas.tsx'
import { Deudas } from './views/Deudas.tsx'
import { Bienes } from './views/Bienes.tsx'
import { Inversiones } from './views/Inversiones.tsx'
import { Recurrencias } from './views/Recurrencias.tsx'
import { Calendario } from './views/Calendario.tsx'
import { Flujo } from './views/Flujo.tsx'
import { Presupuestos } from './views/Presupuestos.tsx'
import { Metas } from './views/Metas.tsx'
import { Notas } from './views/Notas.tsx'
import { Cotizaciones } from './views/Cotizaciones.tsx'
import { Ajustes } from './views/Ajustes.tsx'
import { Inmuebles } from './views/Inmuebles.tsx'
import { Horas } from './views/Horas.tsx'
import { Inventario } from './views/Inventario.tsx'
import { Taxonomia } from './views/Taxonomia.tsx'
import { Importar } from './views/Importar.tsx'

// 'importar' no tiene entrada en el nav: se llega desde Movimientos, que es
// donde uno la busca.
const VIEWS: View[] = [
  'resumen', 'movimientos', 'cuentas', 'taxonomia', 'reportes', 'analisis', 'importar', 'tarjetas',
  'deudas', 'bienes', 'inversiones', 'simulador', 'contrapartes', 'cotizaciones', 'facturas', 'negocio', 'inmuebles', 'horas', 'inventario', 'recurrencias', 'calendario', 'flujo', 'presupuestos', 'metas', 'notas', 'ajustes',
]

const THEME_CYCLE: Record<ThemePref, ThemePref> = { claro: 'oscuro', oscuro: 'auto', auto: 'claro' }

/**
 * La vista del hash, o `null` si no hay ninguna. **Nulo no es "resumen"**: es
 * "el usuario no pidió nada", y desde la Fase 21 eso lo contesta la sección de
 * inicio del perfil. Un hash que apunte a una vista que no existe también cae
 * aquí, para no dejar la app en una pantalla en blanco.
 */
function viewFromHash(): View | null {
  const hash = window.location.hash.replace('#/', '')
  return (VIEWS as string[]).includes(hash) ? (hash as View) : null
}

function Onboarding({ onCreated }: { onCreated: (profile: Profile) => void }) {
  const [paso, setPaso] = useState<1 | 2>(1)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<ProfileKind>('personal')
  const [tinta, setTinta] = useState(() => tintaInicial('verde', null, null))
  // Los módulos siguen al tipo mientras nadie los toque: cambiar de personal a
  // negocio en el primer paso tiene que traer Negocio encendido al segundo.
  const [modules, setModules] = useState<ModuloId[]>(() => porOmision('personal'))
  const [tocado, setTocado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const elegirKind = (next: ProfileKind) => {
    setKind(next)
    if (!tocado) setModules(porOmision(next))
  }

  const siguiente = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return setError('Ponle nombre a tu primer perfil')
    if (!tintaValida(tinta)) return setError('Esa tinta no se lee: ajústala hasta que cumpla AA')
    setError(null)
    setPaso(2)
  }

  const crear = async () => {
    setSaving(true)
    try {
      onCreated(
        await api.profiles.create({ name: name.trim(), kind, modules, ...tintaPayload(tinta) }),
      )
    } catch (err) {
      setError((err as Error).message)
      setSaving(false)
    }
  }

  return (
    <div className="portada">
      <div className="portada-carta">
        <span className="marca-nombre">Finply</span>
        <p className="portada-lema">Tu libro de finanzas. Manual, local y tuyo.</p>
        {paso === 1 ? (
          <form className="forma" onSubmit={siguiente}>
            <label className="campo">
              <span className="campo-label">Nombre del perfil</span>
              <input
                className="campo-input"
                placeholder="Ej. Ana · Personal"
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
                    <input type="radio" checked={kind === 'personal'} onChange={() => elegirKind('personal')} />
                    Personal
                  </label>
                  <label className="radio">
                    <input type="radio" checked={kind === 'negocio'} onChange={() => elegirKind('negocio')} />
                    Negocio
                  </label>
                </div>
              </fieldset>
              <TintaPicker valor={tinta} onChange={setTinta} />
            </div>
            {error && <p className="forma-error" role="alert">{error}</p>}
            <button type="submit" className="btn btn-primario">Continuar</button>
          </form>
        ) : (
          <form
            className="forma"
            onSubmit={(e) => {
              e.preventDefault()
              void crear()
            }}
          >
            <ModulosPicker
              valor={modules}
              kind={kind}
              onChange={(m) => {
                setTocado(true)
                setModules(m)
              }}
            />
            {error && <p className="forma-error" role="alert">{error}</p>}
            <footer className="forma-pie forma-pie-doble">
              <button type="button" className="btn-liga" onClick={() => setPaso(1)}>
                ‹ Atrás
              </button>
              <button type="submit" className="btn btn-primario" disabled={saving}>
                {saving ? 'Abriendo…' : 'Abrir mi libro'}
              </button>
            </footer>
          </form>
        )}
      </div>
    </div>
  )
}

/**
 * Lo que se ve al llegar por el hash a una sección de un módulo apagado.
 *
 * No se redirige al Resumen en silencio: R17 dice que apagar **oculta, nunca
 * borra**, y un enlace guardado que lleva a otro lado se lee como que los
 * datos ya no están. Se dice qué pasó y se ofrece el interruptor.
 */
function ModuloApagado({ vista, onEncender }: { vista: View; onEncender: () => void }) {
  const modulo = MODULOS.find((m) => m.id === moduloDeVista(vista))
  return (
    <div className="vista">
      <div className="vacio">
        <p className="vacio-titulo">{modulo?.label ?? 'Este módulo'} está apagado en este perfil.</p>
        <p className="vacio-sub">
          Por eso no aparece en el lomo. Nada se borró: lo que hayas registrado sigue ahí y
          vuelve a la vista en cuanto lo enciendas.
        </p>
        <button type="button" className="btn btn-primario" onClick={onEncender}>
          Encender {modulo?.label ?? 'el módulo'}
        </button>
      </div>
    </div>
  )
}

export default function App() {
  const [profiles, setProfiles] = useState<Profile[] | null>(null)
  const [currentId, setCurrentId] = useState<number>(() =>
    Number(localStorage.getItem('finply.profile') ?? localStorage.getItem('tomo.profile') ?? 0),
  )
  const [theme, setTheme] = useState<ThemePref>(() => {
    const stored = localStorage.getItem('finply.theme')
    return stored === 'claro' || stored === 'oscuro' || stored === 'auto' ? stored : 'auto'
  })
  const [view, setView] = useState<View | null>(viewFromHash)
  const [refreshKey, setRefreshKey] = useState(0)
  const [stampText, setStampText] = useState<string | null>(null)
  const [ayuda, setAyuda] = useState(false)
  const [txModal, setTxModal] = useState<{
    open: boolean
    tx: Tx | null
    borrador?: BorradorTx
  }>({ open: false, tx: null })
  const [profileModal, setProfileModal] = useState<{ open: boolean; profile: Profile | null }>({
    open: false,
    profile: null,
  })
  const stampTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    api.profiles.list().then(setProfiles, () => setProfiles([]))
    // Migración de la clave vieja de Tomo: se conserva la selección y se limpia.
    const legacy = localStorage.getItem('tomo.profile')
    if (legacy !== null) {
      if (localStorage.getItem('finply.profile') === null) {
        localStorage.setItem('finply.profile', legacy)
      }
      localStorage.removeItem('tomo.profile')
    }
  }, [])

  useEffect(() => {
    const onHash = () => setView(viewFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    localStorage.setItem('finply.theme', theme)
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = theme === 'oscuro' || (theme === 'auto' && mq.matches)
      document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme])

  const profile = useMemo(() => {
    if (!profiles || profiles.length === 0) return null
    return profiles.find((p) => p.id === currentId) ?? profiles[0]!
  }, [profiles, currentId])

  /**
   * La convención de este libro (Fase 21): cómo se ven sus fechas y si enseña
   * los centavos. Se fija **antes de pintar** —en el render, no en un efecto—
   * porque `fmtMoney` y `fmtDate` se llaman durante el propio render de las
   * vistas: hacerlo después dejaría el primer pintado con el formato anterior.
   */
  if (profile) {
    usarFormato({
      fecha: profile.dateFormat,
      sinCentavos: profile.hideCents,
      inicioSemana: profile.weekStart,
    })
  }

  /**
   * Qué sección se ve. El hash manda siempre; sin hash manda la sección de
   * inicio del perfil, y si esa está apagada —o el perfil no eligió ninguna—
   * el Resumen, que es núcleo y no se apaga nunca.
   */
  const vista: View = useMemo(() => {
    if (view) return view
    const inicio = profile?.homeView
    if (inicio && (VIEWS as string[]).includes(inicio) && vistaVisible(inicio, profile!.modules)) {
      return inicio as View
    }
    return 'resumen'
  }, [view, profile])

  const selectProfile = useCallback((id: number) => {
    setCurrentId(id)
    localStorage.setItem('finply.profile', String(id))
  }, [])

  const nav = useCallback((next: View) => {
    window.location.hash = `#/${next}`
    setView(next)
  }, [])

  const bump = useCallback(() => setRefreshKey((k) => k + 1), [])

  const stamp = useCallback((text: string) => {
    if (stampTimer.current) clearTimeout(stampTimer.current)
    setStampText(text)
    stampTimer.current = setTimeout(() => setStampText(null), 1000)
  }, [])

  const openTx = useCallback(
    (tx?: Tx | null, borrador?: BorradorTx) =>
      setTxModal({ open: true, tx: tx ?? null, borrador }),
    [],
  )

  const perfilGuardado = useCallback((guardado: Profile) => {
    setProfiles((prev) => (prev ?? []).map((p) => (p.id === guardado.id ? guardado : p)))
  }, [])

  /**
   * Los atajos de la app entera. `b` y `r` no están aquí: son de la barra de
   * registro rápido y solo significan algo donde hay una barra (Resumen y
   * Movimientos). Desde cualquier otra vista, `b` lleva al libro, que es donde
   * está la barra.
   *
   * Ninguno escribe: `n` abre el formulario y guardar sigue siendo un clic
   * (R4). La navegación respeta los módulos apagados —mandar a una sección que
   * no está en el lomo sería peor que no hacer nada (R17)—.
   */
  const conBarra = vista === 'resumen' || vista === 'movimientos'
  useAtajos({
    nuevo: () => openTx(),
    ayuda: () => setAyuda(true),
    ...(conBarra ? {} : { barra: () => nav('movimientos') }),
    'ir-resumen': () => nav('resumen'),
    'ir-movimientos': () => nav('movimientos'),
    'ir-cuentas': () => nav('cuentas'),
    'ir-flujo': () => irSiSeVe('flujo'),
    'ir-presupuestos': () => irSiSeVe('presupuestos'),
    'ir-notas': () => irSiSeVe('notas'),
  })

  function irSiSeVe(destino: View) {
    if (profile && vistaVisible(destino, profile.modules)) nav(destino)
  }

  if (profiles === null) {
    return (
      <div className="portada">
        <span className="marca-nombre splash-nombre">Finply</span>
      </div>
    )
  }

  if (!profile) {
    return (
      <Onboarding
        onCreated={(p) => {
          setProfiles([p])
          selectProfile(p.id)
        }}
      />
    )
  }

  // Tinta propia: se pasan los dos colores como variables y el CSS elige el del
  // tema activo. Hacerlo en CSS y no en React es lo que hace que cambiar de
  // claro a oscuro se vea al instante, sin volver a pintar el árbol entero.
  const tinta =
    profile.accentHex && profile.accentHexDark
      ? ({
          '--acento-claro': profile.accentHex,
          '--acento-oscuro': profile.accentHexDark,
        } as CSSProperties)
      : undefined

  return (
    <AppCtx.Provider
      value={{
        profile,
        refreshKey,
        bump,
        stamp,
        openTx,
        editProfile: () => setProfileModal({ open: true, profile }),
        perfilGuardado,
      }}
    >
      <div
        className="app"
        data-accent={profile.accent}
        data-tinta={tinta ? 'propia' : undefined}
        style={tinta}
      >
        <Sidebar
          profiles={profiles}
          profile={profile}
          view={vista}
          theme={theme}
          onCycleTheme={() => setTheme((t) => THEME_CYCLE[t])}
          onNav={nav}
          onSelectProfile={selectProfile}
          onNewProfile={() => setProfileModal({ open: true, profile: null })}
          onEditProfile={(p) => setProfileModal({ open: true, profile: p })}
          onRegister={() => openTx()}
        />
        <main className="pagina" key={`${profile.id}-${vista}`}>
          {!vistaVisible(vista, profile.modules) && (
            <ModuloApagado
              vista={vista}
              onEncender={() => setProfileModal({ open: true, profile })}
            />
          )}
          {vistaVisible(vista, profile.modules) && (
          <>
          {vista === 'resumen' && <Resumen onNav={nav} />}
          {vista === 'movimientos' && <Movimientos />}
          {vista === 'cuentas' && <Cuentas />}
          {vista === 'taxonomia' && <Taxonomia />}
          {vista === 'importar' && <Importar onVerMovimientos={() => nav('movimientos')} />}
          {vista === 'reportes' && <Reportes />}
          {vista === 'analisis' && <Analisis />}
          {vista === 'tarjetas' && <Tarjetas />}
          {vista === 'deudas' && <Deudas />}
          {vista === 'bienes' && <Bienes />}
          {vista === 'inversiones' && <Inversiones />}
          {vista === 'simulador' && <Simulador />}
          {vista === 'contrapartes' && <Contrapartes />}
          {vista === 'cotizaciones' && <Cotizaciones />}
          {vista === 'facturas' && <Facturas />}
          {vista === 'negocio' && <Negocio onNav={nav} />}
          {vista === 'inmuebles' && <Inmuebles onNav={nav} />}
          {vista === 'horas' && <Horas onNav={nav} />}
          {vista === 'inventario' && <Inventario onNav={nav} />}
          {vista === 'recurrencias' && <Recurrencias />}
          {vista === 'calendario' && <Calendario />}
          {vista === 'flujo' && <Flujo onNav={nav} />}
          {vista === 'presupuestos' && <Presupuestos />}
          {vista === 'metas' && <Metas />}
          {vista === 'notas' && <Notas />}
          {vista === 'ajustes' && <Ajustes />}
          </>
          )}
        </main>

        {txModal.open && (
          <TxModal
            tx={txModal.tx}
            borrador={txModal.borrador}
            onClose={() => setTxModal({ open: false, tx: null })}
            onSaved={bump}
          />
        )}

        {ayuda && <Atajos onClose={() => setAyuda(false)} />}

        {profileModal.open && (
          <ProfileModal
            profile={profileModal.profile}
            canDelete={profiles.length > 1}
            onClose={() => setProfileModal({ open: false, profile: null })}
            onSaved={(saved) => {
              setProfiles((prev) => {
                if (!prev) return [saved]
                const exists = prev.some((p) => p.id === saved.id)
                return exists ? prev.map((p) => (p.id === saved.id ? saved : p)) : [...prev, saved]
              })
              selectProfile(saved.id)
              bump()
            }}
            onDeleted={() => {
              setProfiles((prev) => {
                const rest = (prev ?? []).filter((p) => p.id !== profileModal.profile?.id)
                if (rest.length > 0) selectProfile(rest[0]!.id)
                return rest
              })
              bump()
            }}
          />
        )}

        {stampText && (
          <div className="sello-capa" aria-live="polite">
            <span className="sello">{stampText}</span>
          </div>
        )}
      </div>
    </AppCtx.Provider>
  )
}
