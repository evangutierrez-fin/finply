import { useRef, useState } from 'react'
import { MODULOS } from '../../shared/modulos.ts'
import { api } from '../api.ts'
import { useApp } from '../context.ts'
import { useFetch } from '../hooks.ts'

const CONFIRM_WORD = 'RESTAURAR'

export function Ajustes() {
  const { bump, stamp, profile, editProfile } = useApp()
  const { data: info } = useFetch(() => api.backup.info(), [])
  const fileInput = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<{ name: string; snapshot: unknown } | null>(null)
  const [confirmText, setConfirmText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  const pickFile = async (file: File) => {
    setError(null)
    setDone(null)
    try {
      const snapshot = JSON.parse(await file.text())
      setPending({ name: file.name, snapshot })
      setConfirmText('')
    } catch {
      setPending(null)
      setError('Ese archivo no es un JSON válido')
    }
  }

  const restore = async () => {
    if (!pending) return
    setWorking(true)
    try {
      const { restaurados } = await api.backup.restore(pending.snapshot)
      const total = Object.values(restaurados).reduce((s, n) => s + n, 0)
      setDone(`Libro restaurado: ${total} registros desde ${pending.name}.`)
      setPending(null)
      setConfirmText('')
      setError(null)
      stamp('Restaurado')
      bump()
      // Los perfiles cambiaron por completo; la forma honesta de reflejarlo
      // es recargar en vez de intentar reconciliar el estado en memoria.
      setTimeout(() => window.location.reload(), 1200)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setWorking(false)
    }
  }

  return (
    <div className="vista">
      <header className="vista-head">
        <h1>Ajustes</h1>
      </header>

      <section className="hoja ajustes-bloque">
        <h2 className="hoja-titulo">Secciones de {profile.name}</h2>
        <p className="ajustes-texto">
          Cada perfil lleva las secciones que necesita y ninguna más. Apagar una la quita del
          lomo; <strong>no borra nada</strong>, y lo que hayas registrado vuelve a la vista en
          cuanto la enciendas.
        </p>
        <ul className="ajustes-modulos">
          {MODULOS.map((m) => {
            const activo = profile.modules.includes(m.id)
            return (
              <li key={m.id} className={activo ? 'activo' : 'apagado'}>
                <span aria-hidden="true">{activo ? '●' : '○'}</span>
                <span>{m.label}</span>
                {!activo && <span className="ajustes-modulo-estado">apagada</span>}
              </li>
            )
          })}
        </ul>
        <button type="button" className="btn btn-fantasma btn-chico" onClick={editProfile}>
          Cambiar secciones
        </button>
      </section>

      <section className="hoja ajustes-bloque">
        <h2 className="hoja-titulo">Respaldo</h2>
        <p className="ajustes-texto">
          Descarga todo tu libro —los perfiles, hasta el último movimiento— en un solo archivo
          JSON que puedes abrir con cualquier editor. Guárdalo donde guardas lo que te importa.
        </p>
        <a className="btn btn-primario btn-chico" href={api.backup.downloadUrl} download>
          Descargar respaldo
        </a>
        <p className="ajustes-nota">
          Finply también deja una copia automática del día en <code>data/respaldos/</code> cada vez
          que arranca, y conserva las últimas siete.
        </p>
      </section>

      <section className="hoja ajustes-bloque">
        <h2 className="hoja-titulo">Restaurar</h2>
        <p className="ajustes-texto">
          Sustituye <strong>todo</strong> el contenido actual por el del respaldo: todos los
          perfiles, no solo el que tienes abierto. Lo que hay hoy se pierde.
        </p>

        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="ajustes-archivo"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void pickFile(file)
          }}
        />

        {pending && (
          <div className="ajustes-confirma">
            <p className="ajustes-texto">
              Vas a reemplazar tu libro con <strong>{pending.name}</strong>. Para confirmar,
              escribe <code>{CONFIRM_WORD}</code>:
            </p>
            <div className="ajustes-confirma-forma">
              <input
                className="campo-input"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                aria-label={`Escribe ${CONFIRM_WORD} para confirmar`}
                autoFocus
              />
              <button
                type="button"
                className="btn btn-primario btn-chico"
                disabled={confirmText !== CONFIRM_WORD || working}
                onClick={restore}
              >
                {working ? 'Restaurando…' : 'Restaurar'}
              </button>
              <button
                type="button"
                className="btn-liga"
                onClick={() => {
                  setPending(null)
                  setConfirmText('')
                  if (fileInput.current) fileInput.current.value = ''
                }}
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        {error && <p className="forma-error" role="alert">{error}</p>}
        {done && <p className="ajustes-ok" role="status">{done}</p>}
      </section>

      <section className="hoja ajustes-bloque">
        <h2 className="hoja-titulo">Tu libro</h2>
        <p className="ajustes-texto">
          Todo vive en un archivo SQLite en tu máquina. Nada se manda a ningún servidor.
        </p>
        {info && <p className="ajustes-ruta"><code>{info.dbPath}</code></p>}
        <p className="ajustes-nota">
          El servidor solo escucha en <code>127.0.0.1</code>: nadie más en tu red alcanza Finply.
        </p>
      </section>
    </div>
  )
}
