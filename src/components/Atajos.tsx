import { ATAJOS, type Atajo } from '../../shared/atajos.ts'
import { Modal } from './Modal.tsx'

const GRUPOS: Atajo['grupo'][] = ['Registrar', 'Moverse', 'Otros']

/**
 * La lista de atajos, la misma que resuelve las teclas.
 *
 * Sale del catálogo de `shared/atajos.ts` y no de una tabla escrita a mano
 * aquí: dos listas que deben coincidir son dos listas que se separan, y una
 * ayuda que miente sobre qué hace una tecla es peor que no tener ayuda.
 */
export function Atajos({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Atajos de teclado" onClose={onClose}>
      <div className="atajos">
        {GRUPOS.map((grupo) => (
          <section key={grupo} className="atajos-grupo">
            <h3 className="atajos-titulo">{grupo}</h3>
            <dl className="atajos-lista">
              {ATAJOS.filter((a) => a.grupo === grupo).map((a) => (
                <div key={a.id}>
                  <dt>
                    {a.tecla.split(' ').map((t, i) => (
                      <kbd key={i}>{t}</kbd>
                    ))}
                  </dt>
                  <dd>{a.que}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <p className="forma-nota">
        Ninguna tecla asienta nada en el libro: abren el formulario o llenan la barra, y guardar
        sigue siendo tuyo. Dentro de un campo de texto los atajos se callan —salvo Escape—, para
        que escribir «notas» en el buscador no abra media aplicación.
      </p>
      <p className="forma-nota">
        <kbd>b</kbd> y <kbd>r</kbd> trabajan donde hay barra de registro rápido: el Resumen y
        Movimientos.
      </p>
    </Modal>
  )
}
