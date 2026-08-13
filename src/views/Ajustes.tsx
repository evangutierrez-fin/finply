import { useRef, useState } from 'react'
import { MODULOS, vistaVisible } from '../../shared/modulos.ts'
import type { FormatoFecha } from '../../shared/formato.ts'
import { api } from '../api.ts'
import { useApp } from '../context.ts'
import { useFetch } from '../hooks.ts'
import { fmtDate, fmtMoney, todayISO } from '../format.ts'
import { NAV_ITEMS } from '../components/Sidebar.tsx'
import { CamposPropios } from '../components/CamposPropios.tsx'
import { PlantillasTx } from '../components/PlantillasTx.tsx'
import { diasDesde } from '../../shared/formato.ts'
import type { RevisionRespaldo } from '../../shared/types.ts'

const CONFIRM_WORD = 'RESTAURAR'

/**
 * Lo que el respaldo traía dentro y la base sí acepta: fechas que no existen en
 * el calendario y cifras que la aritmética no puede releer.
 *
 * Se enseña **después** de restaurar y no antes, porque no cambia la decisión:
 * el archivo se restaura entero de todos modos. Negarse a restaurar el respaldo
 * de alguien es peor que restaurarlo con un renglón torcido — ese archivo puede
 * ser lo único que le queda. Lo que sí cambia es que ahora sabe qué buscar, con
 * la tabla, la columna y el valor, y el formulario ya no le deja volver a
 * escribirlos.
 */
/**
 * Cuántos renglones tocó la revisión. Una sola cuenta y no tres: de esto
 * dependen el aviso, el recorte de la lista y **si la pantalla se recarga**, y
 * tres sumas que deben coincidir son tres sumas que se separan — la tercera
 * causa se agregó en la cuarta vuelta y las otras dos ya se habrían quedado
 * atrás.
 */
function totalHallazgos(r: RevisionRespaldo): number {
  return r.fechas + r.montos + r.cifras
}

function RevisionDelRespaldo({ revision }: { revision: RevisionRespaldo }) {
  return (
    <div className="ajustes-revision" role="status">
      <p className="ajustes-texto">
        <strong>Se restauró el libro completo</strong>, y el archivo traía renglones escritos antes
        de que existieran las reglas que hoy los rechazan. No es un error del respaldo ni de
        Finply, pero conviene corregirlos desde su movimiento.
      </p>
      {revision.fechas > 0 && (
        <p className="ajustes-texto">
          {revision.fechas === 1
            ? 'Una fecha que no existe en el calendario, restaurada tal cual: el saldo la cuenta y los reportes del año no la ven.'
            : `${revision.fechas} fechas que no existen en el calendario, restauradas tal cual: el saldo las cuenta y los reportes del año no las ven.`}{' '}
          Cuál era la fecha de verdad solo lo sabes tú, así que Finply no la adivinó.
        </p>
      )}
      {revision.montos > 0 && (
        <p className="ajustes-texto">
          {revision.montos === 1
            ? 'Una cifra que el libro no puede releer, restaurada en un centavo: su renglón está completo —fecha, concepto, cuenta— y solo el monto se apartó.'
            : `${revision.montos} cifras que el libro no puede releer, restauradas en un centavo: sus renglones están completos —fecha, concepto, cuenta— y solo el monto se apartó.`}{' '}
          Un centavo al lado de una cifra de verdad no se puede confundir, y dejarlas como venían
          habría devuelto un libro que no abre. Aquí abajo está lo que decían, para volver a
          escribirlo.
        </p>
      )}
      {revision.cifras > 0 && (
        <p className="ajustes-texto">
          {revision.cifras === 1
            ? 'Una cantidad que no es dinero y el libro tampoco puede releer —una existencia, el orden de una lista—, restaurada en 1.'
            : `${revision.cifras} cantidades que no son dinero y el libro tampoco puede releer —existencias, el orden de una lista—, restauradas en 1.`}{' '}
          Cae en la misma trampa que un monto imposible y con el mismo resultado: el libro deja de
          abrir. Aquí abajo está lo que decían.
        </p>
      )}
      <ul className="ajustes-revision-lista">
        {revision.ejemplos.map((h, i) => (
          <li key={`${h.tabla}-${h.columna}-${i}`}>
            <code>
              {h.tabla}.{h.columna}
            </code>{' '}
            = <code>{h.valor}</code>
          </li>
        ))}
      </ul>
      {totalHallazgos(revision) > revision.ejemplos.length && (
        <p className="ajustes-nota">
          Se enseñan los primeros {revision.ejemplos.length}; el total está arriba.
        </p>
      )}
    </div>
  )
}

/**
 * Ajustes, partido en dos.
 *
 * Hasta la Fase 21 esta vista mezclaba dos cosas que no se parecen: **el
 * respaldo, que es de la máquina** —vive en un archivo, se pierde con el disco,
 * vale para todos los perfiles— y **los módulos, que son del perfil**. Puestas
 * en la misma columna, cualquiera podía creer que el respaldo era solo del
 * libro abierto, que es exactamente al revés de lo que hace: reemplaza todo.
 */
const PESTANAS = [
  { id: 'perfil', label: 'Este libro' },
  { id: 'app', label: 'La app' },
] as const

type Pestana = (typeof PESTANAS)[number]['id']

const FORMATOS: { id: FormatoFecha; ejemplo: (iso: string) => string; que: string }[] = [
  { id: 'corto', ejemplo: () => '12 jun', que: 'Compacto, sin año: lo que cabe en una tabla' },
  { id: 'numerico', ejemplo: () => '12/06/2026', que: 'Como en un estado de cuenta' },
  { id: 'iso', ejemplo: () => '2026-06-12', que: 'Ordena solo y no se confunde con nada' },
]

export function Ajustes() {
  const [pestana, setPestana] = useState<Pestana>('perfil')
  return (
    <div className="vista">
      <header className="vista-head">
        <h1>Ajustes</h1>
        <div className="seg seg-chico" role="radiogroup" aria-label="Qué ajustes">
          {PESTANAS.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={pestana === p.id}
              className={`seg-item${pestana === p.id ? ' activa' : ''}`}
              onClick={() => setPestana(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </header>
      {pestana === 'perfil' ? <AjustesDelPerfil /> : <AjustesDeLaApp />}
    </div>
  )
}

// ── Lo que es de este libro ───────────────────────────────────────────────

function AjustesDelPerfil() {
  const { profile } = useApp()
  return (
    <>
      <p className="ajustes-texto ajustes-intro">
        Todo lo de aquí es de <strong>{profile.name}</strong> y viaja con él: si abres otro libro,
        el otro tiene lo suyo.
      </p>
      <Secciones />
      <Formato />
      <CamposPropios />
      <PlantillasTx />
      <Configuracion />
      <TusDatos />
    </>
  )
}

/**
 * Bajarse los datos, que es lo contrario del respaldo de la otra pestaña.
 *
 * Va aquí y no allá porque **es de este libro**: el respaldo se lleva todos
 * los perfiles y sirve para volver a entrar a Finply; esto sirve para salir,
 * y por eso sale en hojas que abre cualquiera en vez de en el JSON que solo
 * Finply sabe restaurar.
 */
function TusDatos() {
  const { profile } = useApp()
  return (
    <section className="hoja ajustes-bloque">
      <h2 className="hoja-titulo">Llevarte tus datos</h2>
      <p className="ajustes-texto">
        Todo lo de <strong>{profile.name}</strong> en un .zip con una hoja de cálculo por tabla:
        movimientos, cuentas, categorías, deudas, inversiones, facturas y lo demás, más tus
        recibos como archivos. Se abre en Excel, LibreOffice o Sheets{' '}
        <strong>sin pasar por Finply</strong>.
      </p>
      <a className="btn btn-primario btn-chico" href={api.exportar.libroUrl(profile.id)} download>
        Descargar mis datos
      </a>
      <p className="ajustes-nota">
        El dinero sale en pesos y las tasas en por ciento, no en la escala interna. Los ids se
        conservan: son lo que liga una hoja con otra. Para <em>volver a entrar</em> a Finply lo
        que sirve es el respaldo de <strong>La app</strong>, no esto.
      </p>
    </section>
  )
}

/** Qué secciones lleva el libro, en qué orden y cuál abre. */
function Secciones() {
  const { profile, bump, stamp, editProfile, perfilGuardado } = useApp()
  const [error, setError] = useState<string | null>(null)

  // El orden que se está editando: el guardado, o el de omisión. Solo las
  // secciones que este libro **sí** tiene: ofrecer reordenar una que está
  // apagada sería ofrecer mover algo que no se ve.
  const visibles = NAV_ITEMS.filter((i) => vistaVisible(i.id, profile.modules))
  const orden = profile.navOrder
    ? [...visibles].sort(
        (a, b) =>
          (profile.navOrder!.indexOf(a.id) + 1 || 999) - (profile.navOrder!.indexOf(b.id) + 1 || 999),
      )
    : visibles

  const guardar = async (datos: Record<string, unknown>) => {
    try {
      // El perfil guardado vuelve a memoria: `bump()` solo invalida las vistas,
      // y el lomo se dibuja con la lista de perfiles que vive en App.
      perfilGuardado(await api.profiles.update(profile.id, datos))
      stamp('Guardado')
      bump()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const mover = (id: string, delta: number) => {
    const ids = orden.map((i) => i.id as string)
    const i = ids.indexOf(id)
    const j = i + delta
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j]!, ids[i]!]
    void guardar({ navOrder: ids })
  }

  return (
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

      <div className="ajustes-sub">
        <h3 className="ajustes-sub-titulo">Orden del lomo</h3>
        <p className="ajustes-texto">
          Sube lo que usas todos los días. Con un orden propio, el lomo{' '}
          <strong>deja de agruparse</strong>: los grupos son un orden y dos órdenes sobre la misma
          lista no caben. Quitarlo devuelve los grupos tal como estaban.
        </p>
        <ol className="orden-lomo">
          {orden.map((item, i) => (
            <li key={item.id}>
              <span className="orden-num" aria-hidden="true">{i + 1}</span>
              <span className="orden-nombre">{item.label}</span>
              <span className="campo-fila-acciones">
                <button
                  type="button"
                  className="accion"
                  aria-label={`Subir ${item.label}`}
                  disabled={i === 0}
                  onClick={() => mover(item.id, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="accion"
                  aria-label={`Bajar ${item.label}`}
                  disabled={i === orden.length - 1}
                  onClick={() => mover(item.id, 1)}
                >
                  ↓
                </button>
              </span>
            </li>
          ))}
        </ol>
        {profile.navOrder && (
          <button
            type="button"
            className="btn-liga"
            onClick={() => void guardar({ navOrder: null })}
          >
            Volver al orden de siempre
          </button>
        )}
      </div>

      <div className="ajustes-sub">
        <h3 className="ajustes-sub-titulo">Qué abre al entrar</h3>
        <label className="campo">
          <span className="campo-label">Sección de inicio</span>
          <select
            className="campo-input"
            value={profile.homeView ?? ''}
            onChange={(e) => void guardar({ homeView: e.target.value || null })}
          >
            <option value="">El Resumen</option>
            {visibles.map((i) => (
              <option key={i.id} value={i.id}>{i.label}</option>
            ))}
          </select>
        </label>
        <p className="campo-nota">
          Solo cuando entras sin pedir nada: un enlace guardado a otra sección sigue llevando ahí.
        </p>
      </div>

      {error && <p className="forma-error" role="alert">{error}</p>}
    </section>
  )
}

function Formato() {
  const { profile, bump, stamp, perfilGuardado } = useApp()
  const [error, setError] = useState<string | null>(null)
  const hoy = todayISO()

  const guardar = async (datos: Record<string, unknown>) => {
    try {
      perfilGuardado(await api.profiles.update(profile.id, datos))
      stamp('Guardado')
      bump()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <section className="hoja ajustes-bloque">
      <h2 className="hoja-titulo">Formato</h2>
      <p className="ajustes-texto">
        Cómo se leen las cifras y las fechas de este libro. No cambia una sola: el dinero sigue en
        centavos y las fechas siguen siendo las mismas.
      </p>

      <fieldset className="campo campo-fieldset">
        <legend className="campo-label">Las fechas</legend>
        <div className="radios radios-columna">
          {FORMATOS.map((f) => (
            <label className="radio" key={f.id}>
              <input
                type="radio"
                checked={(profile.dateFormat ?? 'corto') === f.id}
                onChange={() => void guardar({ dateFormat: f.id })}
              />
              <span>
                <strong className="cifra-chica">{f.ejemplo(hoy)}</strong> · {f.que}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="campo campo-casilla">
        <input
          type="checkbox"
          checked={profile.hideCents}
          onChange={(e) => void guardar({ hideCents: e.target.checked })}
        />
        <span>Ocultar los centavos</span>
      </label>
      <p className="campo-nota">
        Hoy: <strong className="cifra-chica">{fmtMoney(129990)}</strong> · con la fecha de hoy
        escrita <strong className="cifra-chica">{fmtDate(hoy)}</strong>. Ojo: redondear es solo
        para verse —el libro sigue en centavos y las cuentas se hacen con centavos—, pero una
        columna redondeada puede alejarse un peso de su propio total.
      </p>

      <div className="ajustes-sub">
        <h3 className="ajustes-sub-titulo">La semana empieza en</h3>
        <label className="campo">
          <span className="campo-label">Primer día</span>
          <select
            className="campo-input"
            value={profile.weekStart ?? 1}
            onChange={(e) => void guardar({ weekStart: Number(e.target.value) })}
          >
            {diasDesde(1).map((d) => (
              <option key={d.id} value={d.id}>{d.label}</option>
            ))}
          </select>
        </label>
        <p className="campo-nota">
          Ordena la lista de días donde haya que elegir uno. <strong>No mueve la semana de una
          recurrencia</strong>: esa es la semana ISO, de lunes a domingo, y cambiarla volvería a
          proponerte todo el histórico.
        </p>
      </div>

      {error && <p className="forma-error" role="alert">{error}</p>}
    </section>
  )
}

/** Bajarse cómo está montado el libro, y aplicárselo a otro. */
function Configuracion() {
  const { profile, bump, stamp } = useApp()
  const archivo = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [resultado, setResultado] = useState<string | null>(null)

  const aplicar = async (file: File) => {
    setError(null)
    setResultado(null)
    try {
      const config = JSON.parse(await file.text())
      const r = await api.personalizacion.aplicarConfig(profile.id, config)
      const nuevas = [
        r.categoriasNuevas > 0 && `${r.categoriasNuevas} categorías`,
        r.camposNuevos > 0 && `${r.camposNuevos} campos propios`,
        r.plantillasNuevas > 0 && `${r.plantillasNuevas} plantillas`,
      ].filter(Boolean)
      const respetadas =
        r.respetadas.categorias + r.respetadas.campos + r.respetadas.plantillas
      setResultado(
        `${nuevas.length > 0 ? `Se agregaron ${nuevas.join(', ')}.` : 'No hizo falta agregar nada.'}` +
          (respetadas > 0 ? ` ${respetadas} cosas ya estaban y se quedaron como estaban.` : '') +
          (r.plantillasCojas.length > 0
            ? ` Ojo: ${r.plantillasCojas.join(', ')} llegaron sin su cuenta o su categoría, porque en este libro no existen con ese nombre.`
            : ''),
      )
      stamp('Aplicada')
      bump()
    } catch (err) {
      setError((err as Error).message)
    }
    if (archivo.current) archivo.current.value = ''
  }

  return (
    <section className="hoja ajustes-bloque">
      <h2 className="hoja-titulo">Llevarte esta configuración</h2>
      <p className="ajustes-texto">
        Cómo está montado este libro —sus secciones, su tinta, su formato, sus categorías, sus
        campos propios y sus plantillas— <strong>sin una sola cifra</strong>. Sirve para montar otro
        perfil igual sin volver a armarlo a mano.
      </p>
      <a
        className="btn btn-primario btn-chico"
        href={api.personalizacion.configUrl(profile.id)}
        download
      >
        Descargar la configuración
      </a>

      <div className="ajustes-sub">
        <h3 className="ajustes-sub-titulo">Aplicar una a este libro</h3>
        <p className="ajustes-texto">
          Crea lo que falte y <strong>respeta lo que ya está</strong>: no borra una categoría, no
          toca un movimiento y no cambia el nombre del perfil. Lo único que se sobrescribe son las
          preferencias —tinta, formato, orden del lomo—, que es lo que se viene a copiar.
        </p>
        {/* Un `type="file"` sin etiqueta se anuncia como "botón examinar" y
            nada más: quien no ve la pantalla no sabe qué archivo se le está
            pidiendo. El texto de arriba lo explica y es el que se nombra. */}
        <input
          ref={archivo}
          type="file"
          accept="application/json,.json"
          aria-label="Archivo de configuración .json para aplicar a este libro"
          className="ajustes-archivo"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void aplicar(file)
          }}
        />
        {error && <p className="forma-error" role="alert">{error}</p>}
        {resultado && <p className="ajustes-ok" role="status">{resultado}</p>}
      </div>
    </section>
  )
}

// ── Lo que es de esta máquina ─────────────────────────────────────────────

function AjustesDeLaApp() {
  const { bump, stamp } = useApp()
  const { data: info } = useFetch(() => api.backup.info(), [])
  const fileInput = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<{ name: string; snapshot: unknown } | null>(null)
  const [confirmText, setConfirmText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  /** Lo que el archivo traía dentro y la base sí acepta. `null` = venía limpio. */
  const [revision, setRevision] = useState<RevisionRespaldo | null>(null)
  const [working, setWorking] = useState(false)

  const pickFile = async (file: File) => {
    setError(null)
    setDone(null)
    setRevision(null)
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
      const { restaurados, revision } = await api.backup.restore(pending.snapshot)
      const total = Object.values(restaurados).reduce((s, n) => s + n, 0)
      setDone(`Libro restaurado: ${total} registros desde ${pending.name}.`)
      setRevision(totalHallazgos(revision) > 0 ? revision : null)
      setPending(null)
      setConfirmText('')
      setError(null)
      stamp('Restaurado')
      bump()
      // Los perfiles cambiaron por completo; la forma honesta de reflejarlo
      // es recargar en vez de intentar reconciliar el estado en memoria.
      //
      // ⚠ Salvo que el archivo trajera algo torcido: entonces la recarga se
      // llevaría el único aviso que el usuario va a recibir, y ese aviso es
      // justo el que le dice qué ir a corregir. Ahí se queda en pantalla y él
      // decide cuándo recargar.
      if (totalHallazgos(revision) === 0) {
        setTimeout(() => window.location.reload(), 1200)
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setWorking(false)
    }
  }

  return (
    <>
      <p className="ajustes-texto ajustes-intro">
        Lo de aquí es de esta máquina y vale para <strong>todos</strong> tus libros a la vez.
      </p>

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
          aria-label="Archivo de respaldo .json para restaurar"
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
        {revision && <RevisionDelRespaldo revision={revision} />}
      </section>

      <section className="hoja ajustes-bloque">
        <h2 className="hoja-titulo">Tu libro</h2>
        <p className="ajustes-texto">
          Todo vive en un archivo SQLite en tu máquina. Nada se manda a ningún servidor.
        </p>
        {info && <p className="ajustes-ruta"><code>{info.dbPath}</code></p>}
        <p className="ajustes-nota">
          El servidor solo escucha en <code>127.0.0.1</code>: nadie más en tu red alcanza Finply. Y
          solo contesta si la petición viene a nombre de esta máquina, para que una página abierta
          en otra pestaña no pueda hacerse pasar por ella.
        </p>
      </section>
    </>
  )
}
