import { MODULOS, porOmision, type ModuloId } from '../../shared/modulos.ts'
import type { ProfileKind } from '../../shared/types.ts'

/**
 * "¿Qué llevas en este libro?" — el segundo paso del alta y el bloque de
 * Ajustes, que son la misma pregunta hecha en dos momentos.
 *
 * Nace con todo lo que corresponde al tipo de perfil encendido, para que
 * aceptar sin leer deje un libro utilizable: quien no quiera decidir nada no
 * pierde nada. Apagar es la acción deliberada, no encender.
 */
export function ModulosPicker({
  valor,
  onChange,
  kind,
  titulo = '¿Qué llevas en este libro?',
  nota,
}: {
  valor: ModuloId[]
  onChange: (modulos: ModuloId[]) => void
  kind: ProfileKind
  titulo?: string
  nota?: string
}) {
  const toggle = (id: ModuloId) => {
    onChange(valor.includes(id) ? valor.filter((m) => m !== id) : [...valor, id])
  }
  const omision = porOmision(kind)
  const esOmision =
    omision.length === valor.length && omision.every((m) => valor.includes(m))

  return (
    <fieldset className="campo campo-fieldset modulos">
      <legend className="campo-label">{titulo}</legend>
      <p className="campo-ayuda">
        {nota ??
          'Solo cambia lo que ves: nada se borra al apagar un módulo, y puedes encenderlo después en Ajustes sin perder un dato.'}
      </p>
      <ul className="modulos-lista">
        {MODULOS.map((m) => {
          const activo = valor.includes(m.id)
          return (
            <li key={m.id}>
              <label className={`modulo${activo ? ' activo' : ''}`}>
                <input
                  type="checkbox"
                  checked={activo}
                  onChange={() => toggle(m.id)}
                />
                <span className="modulo-textos">
                  <span className="modulo-label">{m.label}</span>
                  <span className="modulo-desc">{m.descripcion}</span>
                </span>
              </label>
            </li>
          )
        })}
      </ul>
      <div className="modulos-pie">
        <span className="modulos-cuenta">
          {valor.length === 0
            ? 'Solo el libro: movimientos, cuentas, categorías y reportes.'
            : `${valor.length} de ${MODULOS.length} secciones, más el libro de siempre.`}
        </span>
        {!esOmision && (
          <button type="button" className="btn-liga" onClick={() => onChange(omision)}>
            Volver a lo normal de un libro {kind}
          </button>
        )}
      </div>
    </fieldset>
  )
}
