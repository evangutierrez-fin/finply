// Importar movimientos desde CSV.
//
// El flujo tiene dos pasos a propósito: primero se analiza el archivo y se
// muestra fila por fila **cómo quedó interpretado** —sobre todo la fecha y el
// monto, que son ambiguos— y solo después se escribe. Nada llega al libro sin
// que se haya visto antes.

import { useRef, useState } from 'react'
import { api, type ImportDraft } from '../api.ts'
import { useApp } from '../context.ts'
import { useFetch } from '../hooks.ts'
import { fmtMoney } from '../format.ts'
import type { CampoImport, FilaAnalizada, InformeImport } from '../../shared/types.ts'

const CAMPOS: { id: CampoImport; label: string }[] = [
  { id: 'fecha', label: 'Fecha' },
  { id: 'monto', label: 'Monto (con signo)' },
  { id: 'cargo', label: 'Cargo' },
  { id: 'abono', label: 'Abono' },
  { id: 'tipo', label: 'Tipo' },
  { id: 'cuenta', label: 'Cuenta' },
  { id: 'cuentaDestino', label: 'Cuenta destino' },
  { id: 'categoria', label: 'Categoría' },
  { id: 'etiquetas', label: 'Etiquetas' },
  { id: 'concepto', label: 'Concepto' },
]

const ETIQUETA_ESTADO = {
  nueva: { texto: 'Nueva', clase: '' },
  duplicada: { texto: 'Duplicada', clase: 'chip-ambar' },
  error: { texto: 'Error', clase: 'chip-rojo' },
} as const

function FilaPrevia({ fila }: { fila: FilaAnalizada }) {
  const estado = ETIQUETA_ESTADO[fila.estado]
  return (
    <tr className={`previa-fila estado-${fila.estado}`}>
      <td className="col-fecha">{fila.linea}</td>
      <td><span className={`chip ${estado.clase}`}>{estado.texto}</span></td>
      <td className="col-fecha">{fila.date || '—'}</td>
      <td>
        {fila.estado === 'error' ? (
          <span className="previa-motivo">{fila.motivo}</span>
        ) : (
          <>
            <span className="mov-concepto">{fila.note || 'Sin concepto'}</span>
            {fila.categoryName && (
              <span className={`mov-cat${fila.reglaPattern ? ' previa-por-regla' : ''}`}>
                {fila.categoryName}
                {/* Quién la propuso, a la vista antes de escribir nada (R4):
                    una categoría que aparece sin explicación se lee como si
                    Finply hubiera decidido por su cuenta. */}
                {fila.reglaPattern && (
                  <span className="previa-regla"> · regla «{fila.reglaPattern}»</span>
                )}
              </span>
            )}
            {fila.tagNames.length > 0 && (
              <span className="mov-etiquetas">
                {fila.tagNames.map((t) => <span className="chip chip-etiqueta" key={t}>{t}</span>)}
              </span>
            )}
          </>
        )}
      </td>
      <td className="col-cuenta">
        {fila.type === 'transferencia'
          ? `${fila.accountName} → ${fila.transferAccountName}`
          : fila.accountName}
      </td>
      <td className={`col-monto${fila.type === 'gasto' ? ' negativo' : ''}`}>
        {fila.estado === 'error' ? '—' : fmtMoney(fila.type === 'gasto' ? -fila.amountCents : fila.amountCents)}
      </td>
    </tr>
  )
}

export function Importar({ onVerMovimientos }: { onVerMovimientos: () => void }) {
  const { profile, refreshKey, bump, stamp } = useApp()
  const fileInput = useRef<HTMLInputElement>(null)

  const [csv, setCsv] = useState('')
  const [filename, setFilename] = useState('')
  const [cuentaPorOmision, setCuentaPorOmision] = useState(0)
  const [crearCategorias, setCrearCategorias] = useState(true)
  const [crearEtiquetas, setCrearEtiquetas] = useState(true)
  const [omitirDuplicadas, setOmitirDuplicadas] = useState(true)
  const [mapeo, setMapeo] = useState<InformeImport['mapeo'] | null>(null)

  const [informe, setInforme] = useState<InformeImport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [trabajando, setTrabajando] = useState(false)
  const [hecho, setHecho] = useState<string | null>(null)

  const { data: cuentas } = useFetch(() => api.accounts.list(profile.id), [profile.id, refreshKey])
  const { data: lotes } = useFetch(() => api.importaciones.lotes(profile.id), [profile.id, refreshKey])

  const activas = (cuentas ?? []).filter((a) => !a.archived)
  const cuentaElegida = cuentaPorOmision || activas[0]?.id || 0

  const borrador = (): ImportDraft => ({
    profileId: profile.id,
    csv,
    filename,
    cuentaPorOmision: cuentaElegida,
    mapeo: mapeo ?? undefined,
    crearCategorias,
    crearEtiquetas,
    omitirDuplicadas,
  })

  const previsualizar = async (draft = borrador()) => {
    setTrabajando(true)
    setError(null)
    setHecho(null)
    try {
      const resultado = await api.importaciones.previsualizar(draft)
      setInforme(resultado)
      setMapeo(resultado.mapeo)
    } catch (err) {
      setInforme(null)
      setError((err as Error).message)
    } finally {
      setTrabajando(false)
    }
  }

  const elegirArchivo = async (file: File) => {
    const texto = await file.text()
    setCsv(texto)
    setFilename(file.name)
    setInforme(null)
    setMapeo(null)
    setError(null)
    setHecho(null)
    await previsualizar({ ...borrador(), csv: texto, filename: file.name, mapeo: undefined })
  }

  const cambiarMapeo = async (campo: CampoImport, indice: number) => {
    const siguiente = { ...(mapeo ?? {}) }
    if (indice < 0) delete siguiente[campo]
    else siguiente[campo] = indice
    setMapeo(siguiente)
    await previsualizar({ ...borrador(), mapeo: siguiente })
  }

  const importar = async () => {
    if (!informe) return
    setTrabajando(true)
    setError(null)
    try {
      const res = await api.importaciones.ejecutar({ ...borrador(), huella: informe.huella })
      const partes = [`${res.importadas} movimiento${res.importadas === 1 ? '' : 's'} importado${res.importadas === 1 ? '' : 's'}`]
      if (res.omitidas > 0) partes.push(`${res.omitidas} duplicado(s) omitido(s)`)
      if (res.errores > 0) partes.push(`${res.errores} con error, no se escribieron`)
      if (res.categoriasCreadas > 0) partes.push(`${res.categoriasCreadas} categoría(s) nueva(s)`)
      if (res.etiquetasCreadas > 0) partes.push(`${res.etiquetasCreadas} etiqueta(s) nueva(s)`)
      setHecho(`${partes.join(' · ')}.`)
      setInforme(null)
      setCsv('')
      setFilename('')
      if (fileInput.current) fileInput.current.value = ''
      stamp('Importado')
      bump()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setTrabajando(false)
    }
  }

  const deshacer = async (id: number, vigentes: number) => {
    if (!confirm(`Se borrarán ${vigentes} movimiento(s) de este lote. ¿Continuar?`)) return
    try {
      const res = await api.importaciones.deshacer(id, profile.id)
      setHecho(`Lote deshecho: ${res.borradas} movimiento(s) borrado(s).`)
      setError(null)
      stamp('Deshecho')
      bump()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const resumen = informe?.resumen
  const importables = resumen
    ? omitirDuplicadas ? resumen.nuevas : resumen.nuevas + resumen.duplicadas
    : 0

  return (
    <div className="vista">
      <header className="vista-head">
        <h1>Importar movimientos</h1>
        <button type="button" className="btn-liga" onClick={onVerMovimientos}>
          ← Volver a Movimientos
        </button>
      </header>

      <section className="hoja ajustes-bloque">
        <h2 className="hoja-titulo">El archivo</h2>
        <p className="ajustes-texto">
          Un CSV con una fila por movimiento. Finply reconoce las columnas por su nombre y
          detecta el separador. Nada se escribe hasta que revises la vista previa.
        </p>
        <div className="import-controles">
          <input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv,text/plain"
            className="ajustes-archivo"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void elegirArchivo(file)
            }}
          />
          <label className="filtro-campo">
            <span className="filtro-label">Cuenta por omisión</span>
            <select
              className="filtro"
              value={cuentaElegida}
              onChange={(e) => {
                setCuentaPorOmision(Number(e.target.value))
                if (csv) void previsualizar({ ...borrador(), cuentaPorOmision: Number(e.target.value) })
              }}
            >
              {activas.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </label>
        </div>
        <p className="ajustes-nota">
          Las filas cuya columna de cuenta no coincida con ninguna de tus cuentas caen en la
          cuenta por omisión.
        </p>
      </section>

      {error && <p className="aviso" role="alert">{error}</p>}
      {hecho && <p className="ajustes-ok" role="status">{hecho}</p>}

      {informe && (
        <>
          <section className="hoja ajustes-bloque">
            <h2 className="hoja-titulo">Columnas</h2>
            <p className="ajustes-texto">
              Separador detectado: <code>{informe.separador === '\t' ? 'tabulador' : informe.separador}</code>.
              Corrige aquí si alguna columna quedó mal asignada.
            </p>
            <div className="import-mapeo">
              {CAMPOS.map((campo) => (
                <label className="filtro-campo" key={campo.id}>
                  <span className="filtro-label">{campo.label}</span>
                  <select
                    className="filtro"
                    value={mapeo?.[campo.id] ?? -1}
                    onChange={(e) => void cambiarMapeo(campo.id, Number(e.target.value))}
                  >
                    <option value={-1}>— sin columna —</option>
                    {informe.encabezados.map((h, i) => (
                      <option key={i} value={i}>{h || `columna ${i + 1}`}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </section>

          <section className="hoja ajustes-bloque">
            <h2 className="hoja-titulo">Vista previa</h2>
            <p className="import-resumen">
              <strong>{resumen!.nuevas}</strong> nuevas ·{' '}
              <strong>{resumen!.duplicadas}</strong> duplicadas ·{' '}
              <strong className={resumen!.errores > 0 ? 'presup-rojo' : undefined}>
                {resumen!.errores}
              </strong>{' '}
              con error
            </p>

            {resumen!.errores > 0 && (
              <p className="ajustes-nota">
                Las filas con error no se importan; el resto sí. Corrige el archivo y vuelve a
                cargarlo si las necesitas.
              </p>
            )}
            {resumen!.propuestasPorRegla > 0 && (
              <p className="ajustes-nota">
                {resumen!.propuestasPorRegla} fila(s) recibieron categoría de una de tus reglas.
                Proponen, no asientan: revísalas arriba antes de importar, y edítalas en
                Categorías si alguna no acierta.
              </p>
            )}
            {resumen!.cuentasNoEncontradas.length > 0 && (
              <p className="ajustes-nota">
                Cuentas del archivo que no existen aquí (van a la cuenta por omisión):{' '}
                {resumen!.cuentasNoEncontradas.join(', ')}
              </p>
            )}
            {resumen!.categoriasPorCrear.length > 0 && crearCategorias && (
              <p className="ajustes-nota">
                Se crearán {resumen!.categoriasPorCrear.length} categoría(s):{' '}
                {resumen!.categoriasPorCrear.join(', ')}
              </p>
            )}
            {resumen!.etiquetasPorCrear.length > 0 && crearEtiquetas && (
              <p className="ajustes-nota">
                Se crearán {resumen!.etiquetasPorCrear.length} etiqueta(s):{' '}
                {resumen!.etiquetasPorCrear.join(', ')}
              </p>
            )}

            <div className="import-opciones">
              <label className="radio">
                <input
                  type="checkbox"
                  checked={omitirDuplicadas}
                  onChange={(e) => setOmitirDuplicadas(e.target.checked)}
                />
                Omitir duplicados
              </label>
              <label className="radio">
                <input
                  type="checkbox"
                  checked={crearCategorias}
                  onChange={(e) => {
                    setCrearCategorias(e.target.checked)
                    void previsualizar({ ...borrador(), crearCategorias: e.target.checked })
                  }}
                />
                Crear categorías que no existan
              </label>
              <label className="radio">
                <input
                  type="checkbox"
                  checked={crearEtiquetas}
                  onChange={(e) => {
                    setCrearEtiquetas(e.target.checked)
                    void previsualizar({ ...borrador(), crearEtiquetas: e.target.checked })
                  }}
                />
                Crear etiquetas que no existan
              </label>
            </div>

            <div className="import-tabla-wrap">
              <table className="libro import-tabla">
                <thead>
                  <tr>
                    <th className="col-fecha">Línea</th>
                    <th>Estado</th>
                    <th className="col-fecha">Fecha</th>
                    <th>Concepto</th>
                    <th className="col-cuenta">Cuenta</th>
                    <th className="col-monto">Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {informe.filas.map((fila) => <FilaPrevia fila={fila} key={fila.linea} />)}
                </tbody>
              </table>
            </div>

            <footer className="forma-pie import-pie">
              <button
                type="button"
                className="btn btn-fantasma"
                onClick={() => {
                  setInforme(null)
                  setCsv('')
                  setFilename('')
                  if (fileInput.current) fileInput.current.value = ''
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primario"
                disabled={trabajando || importables === 0}
                onClick={() => void importar()}
              >
                {trabajando
                  ? 'Importando…'
                  : `Importar ${importables} movimiento${importables === 1 ? '' : 's'}`}
              </button>
            </footer>
          </section>
        </>
      )}

      {(lotes ?? []).length > 0 && (
        <section className="hoja ajustes-bloque">
          <h2 className="hoja-titulo">Importaciones anteriores</h2>
          <p className="ajustes-texto">
            Deshacer borra las partidas que trajo ese archivo. Las categorías y etiquetas que se
            crearon se quedan, porque puedes haberlas usado en otros movimientos.
          </p>
          <ul className="taxo-lista">
            {(lotes ?? []).map((lote) => (
              <li className="taxo-fila" key={lote.id}>
                <span className="taxo-nombre">{lote.filename || `Lote ${lote.id}`}</span>
                <span className="taxo-cuenta">
                  {lote.createdAt.slice(0, 16).replace('T', ' ')} · {lote.vigentes} de {lote.rowCount}
                </span>
                <button
                  type="button"
                  className="btn-liga deuda-borrar"
                  disabled={lote.vigentes === 0}
                  onClick={() => void deshacer(lote.id, lote.vigentes)}
                >
                  Deshacer
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
