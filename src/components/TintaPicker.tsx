import type { CSSProperties } from 'react'
import type { Accent } from '../../shared/types.ts'
import { AA_TEXTO, PRESETS, evaluarTinta, normalizarHex } from '../../shared/color.ts'

export const ACCENTS: { id: Accent; label: string }[] = [
  { id: 'verde', label: 'Verde banca' },
  { id: 'laton', label: 'Latón' },
  { id: 'cobalto', label: 'Cobalto' },
  { id: 'vino', label: 'Vino' },
]

export interface Tinta {
  accent: Accent
  /** Con las dos, el perfil usa tinta propia; sin ellas, el preset. */
  claro: string | null
  oscuro: string | null
}

export function tintaInicial(accent: Accent, claro: string | null, oscuro: string | null): Tinta {
  return { accent, claro, oscuro }
}

/** ¿Se puede guardar? Una tinta que no se lee no se guarda (R10). */
export function tintaValida(t: Tinta): boolean {
  if (t.claro === null || t.oscuro === null) return true
  return evaluarTinta(t.claro, 'claro').cumple && evaluarTinta(t.oscuro, 'oscuro').cumple
}

/** Lo que va al servidor. `null` en las dos vuelve al preset. */
export function tintaPayload(t: Tinta) {
  return { accent: t.accent, accentHex: t.claro, accentHexDark: t.oscuro }
}

function Medida({ hex, tema }: { hex: string; tema: 'claro' | 'oscuro' }) {
  const v = evaluarTinta(hex, tema)
  return (
    <span className={`tinta-medida${v.cumple ? '' : ' falla'}`}>
      {v.ratio}:1 · {v.cumple ? 'cumple AA' : `hace falta ${AA_TEXTO}:1 contra ${v.contra}`}
    </span>
  )
}

function Campo({
  tema,
  valor,
  onChange,
}: {
  tema: 'claro' | 'oscuro'
  valor: string
  onChange: (hex: string) => void
}) {
  return (
    <div className={`tinta-campo tinta-campo-${tema}`}>
      <span className="campo-label">{tema === 'claro' ? 'De día' : 'De noche'}</span>
      <div className="tinta-campo-fila">
        <input
          type="color"
          className="tinta-color"
          value={valor}
          aria-label={`Tinta del tema ${tema}`}
          onChange={(e) => onChange(e.target.value)}
        />
        <input
          className="campo-input tinta-hex"
          value={valor}
          spellCheck={false}
          aria-label={`Hex de la tinta del tema ${tema}`}
          onChange={(e) => {
            const hex = normalizarHex(e.target.value)
            onChange(hex ?? e.target.value)
          }}
        />
      </div>
      <span
        className={`tinta-muestra tinta-muestra-${tema}`}
        style={{ '--tinta-propia': valor } as CSSProperties}
      >
        Así se lee
      </span>
      <Medida hex={valor} tema={tema} />
    </div>
  )
}

/**
 * Elegir la tinta del perfil: uno de los cuatro presets o una propia.
 *
 * Son **dos** colores, uno por tema, y no es un capricho: se midió sobre una
 * malla de 140,608 colores y ni uno solo alcanza AA contra el papel claro y el
 * oscuro a la vez. El papel claro pide tinta oscura; el oscuro la pide clara.
 *
 * El contraste se calcula aquí con el mismo módulo que usa el servidor
 * (`shared/color.ts`), así que el número que se ve mientras eliges es
 * exactamente el que decide si se guarda. Y lo que la tinta **no** toca son los
 * colores de las gráficas: el par entrada/salida está validado para daltonismo
 * y su rayado se queda pase lo que pase (R10).
 */
export function TintaPicker({ valor, onChange }: { valor: Tinta; onChange: (t: Tinta) => void }) {
  const propia = valor.claro !== null && valor.oscuro !== null

  const elegirPreset = (id: Accent) => onChange({ accent: id, claro: null, oscuro: null })
  const elegirPropia = () => {
    const base = PRESETS[valor.accent]!
    onChange({ ...valor, claro: valor.claro ?? base.claro, oscuro: valor.oscuro ?? base.oscuro })
  }

  return (
    <fieldset className="campo campo-fieldset">
      <legend className="campo-label">Tinta</legend>
      <div className="tintas">
        {ACCENTS.map((a) => (
          <button
            key={a.id}
            type="button"
            className={`tinta-swatch dot-${a.id}${!propia && valor.accent === a.id ? ' activa' : ''}`}
            aria-label={a.label}
            aria-pressed={!propia && valor.accent === a.id}
            onClick={() => elegirPreset(a.id)}
          />
        ))}
        <button
          type="button"
          className={`tinta-swatch tinta-swatch-propia${propia ? ' activa' : ''}`}
          aria-label="Tinta propia"
          aria-pressed={propia}
          onClick={elegirPropia}
          style={propia ? ({ '--tinta-propia': valor.claro! } as CSSProperties) : undefined}
        >
          <span aria-hidden="true">✎</span>
        </button>
      </div>

      {propia && (
        <div className="tinta-propia-panel">
          <div className="campos-2">
            <Campo
              tema="claro"
              valor={valor.claro!}
              onChange={(hex) => onChange({ ...valor, claro: hex })}
            />
            <Campo
              tema="oscuro"
              valor={valor.oscuro!}
              onChange={(hex) => onChange({ ...valor, oscuro: hex })}
            />
          </div>
          <p className="tinta-nota">
            Dos colores porque son dos temas: ninguno solo se lee sobre el papel claro y el oscuro
            a la vez. Las gráficas no cambian — su par verde/rojo está validado para daltonismo.
          </p>
        </div>
      )}
    </fieldset>
  )
}
