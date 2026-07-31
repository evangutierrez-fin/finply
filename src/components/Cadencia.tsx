// El "cada cuándo" de una plantilla, en un solo lugar.
//
// Lo usaban las recurrencias de movimiento; desde la Fase 14 lo usan también
// las facturas recurrentes, que comparten el motor de fechas (D28). Escribirlo
// dos veces habría dejado dos formularios que se parecen y que un día dejarían
// de parecerse: el día 31 que cae "el último del mes" es una convención del
// motor, y tiene que decirse igual en los dos lados.

import type { Frecuencia } from '../../shared/types.ts'
import { MESES } from '../format.ts'

const FRECUENCIAS: { id: Frecuencia; label: string }[] = [
  { id: 'mensual', label: 'Cada mes' },
  { id: 'quincenal', label: 'Cada quincena' },
  { id: 'semanal', label: 'Cada semana' },
  { id: 'anual', label: 'Cada año' },
]

const DIAS_SEMANA = [
  { id: 1, label: 'lunes' },
  { id: 2, label: 'martes' },
  { id: 3, label: 'miércoles' },
  { id: 4, label: 'jueves' },
  { id: 5, label: 'viernes' },
  { id: 6, label: 'sábado' },
  { id: 7, label: 'domingo' },
]

/** 1–31, con el 31 marcado como "el último" porque en febrero cae el 28. */
const DIAS_MES = Array.from({ length: 31 }, (_, i) => ({
  id: i + 1,
  label: i + 1 === 31 ? 'el último día' : String(i + 1),
}))

export interface ValoresCadencia {
  frequency: Frecuencia
  dayOfMonth: number
  dayOfMonth2: number
  monthOfYear: number
  weekday: number
}

export function Cadencia({
  valores,
  onChange,
}: {
  valores: ValoresCadencia
  onChange: (cambio: Partial<ValoresCadencia>) => void
}) {
  const { frequency, dayOfMonth, dayOfMonth2, monthOfYear, weekday } = valores
  return (
    <fieldset className="campo campo-fieldset rec-cadencia">
      <legend className="campo-label">Cada cuándo</legend>
      <div className="seg seg-4" role="radiogroup" aria-label="Periodicidad">
        {FRECUENCIAS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="radio"
            aria-checked={frequency === f.id}
            className={`seg-item${frequency === f.id ? ' activa' : ''}`}
            onClick={() => onChange({ frequency: f.id })}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="campos-2 rec-dias">
        {frequency === 'semanal' && (
          <label className="campo">
            <span className="campo-label">Día de la semana</span>
            <select
              className="campo-input"
              value={weekday}
              onChange={(e) => onChange({ weekday: Number(e.target.value) })}
            >
              {DIAS_SEMANA.map((d) => (
                <option key={d.id} value={d.id}>{d.label}</option>
              ))}
            </select>
          </label>
        )}

        {frequency === 'anual' && (
          <label className="campo">
            <span className="campo-label">Mes</span>
            <select
              className="campo-input"
              value={monthOfYear}
              onChange={(e) => onChange({ monthOfYear: Number(e.target.value) })}
            >
              {MESES.map((m, i) => (
                <option key={m} value={i + 1}>{m}</option>
              ))}
            </select>
          </label>
        )}

        {frequency !== 'semanal' && (
          <label className="campo">
            <span className="campo-label">
              {frequency === 'quincenal' ? 'Primera quincena' : 'Día del mes'}
            </span>
            <select
              className="campo-input"
              value={dayOfMonth}
              onChange={(e) => onChange({ dayOfMonth: Number(e.target.value) })}
            >
              {DIAS_MES.map((d) => (
                <option key={d.id} value={d.id}>{d.label}</option>
              ))}
            </select>
          </label>
        )}

        {frequency === 'quincenal' && (
          <label className="campo">
            <span className="campo-label">Segunda quincena</span>
            <select
              className="campo-input"
              value={dayOfMonth2}
              onChange={(e) => onChange({ dayOfMonth2: Number(e.target.value) })}
            >
              {DIAS_MES.map((d) => (
                <option key={d.id} value={d.id}>{d.label}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      <p className="forma-nota rec-nota-dia">
        El día 31 cae el último de cada mes: en febrero, el 28.
      </p>
    </fieldset>
  )
}

/** La regla que entiende el motor, armada desde los valores del formulario. */
export function reglaDesde(valores: ValoresCadencia, startDate: string, endDate: string) {
  const { frequency, dayOfMonth, dayOfMonth2, monthOfYear, weekday } = valores
  return {
    frequency,
    dayOfMonth: frequency === 'semanal' ? null : dayOfMonth,
    dayOfMonth2: frequency === 'quincenal' ? dayOfMonth2 : null,
    monthOfYear: frequency === 'anual' ? monthOfYear : null,
    weekday: frequency === 'semanal' ? weekday : null,
    startDate,
    endDate: endDate || null,
  }
}
