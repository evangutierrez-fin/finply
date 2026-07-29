import { useEffect, useState } from 'react'
import { api, type TxFilters } from '../api.ts'
import { useApp } from '../context.ts'
import { useFetch } from '../hooks.ts'
import { currentMonth, fmtDate, monthLabel, parseAmount, shiftMonth, todayISO } from '../format.ts'
import { Money } from '../components/Money.tsx'
import { Conciliar } from '../components/Conciliar.tsx'
import type { Tx } from '../../shared/types.ts'

const POR_PAGINA = 50

/** La app escucha `hashchange`, así que basta con cambiar el hash. */
function irAImportar() {
  window.location.hash = '#/importar'
}

export function Movimientos() {
  const { profile, refreshKey, openTx, bump, stamp } = useApp()
  const [month, setMonth] = useState(currentMonth())
  const [accountId, setAccountId] = useState(0)
  const [type, setType] = useState('')
  const [conciliado, setConciliado] = useState<'' | 'si' | 'no'>('')
  // La conciliación se abre a mano y solo con una cuenta elegida: comparar
  // contra un estado de cuenta exige saber contra cuál.
  const [conciliando, setConciliando] = useState(false)
  const [qInput, setQInput] = useState('')
  const [q, setQ] = useState('')
  const [deletingId, setDeletingId] = useState<number | null>(null)

  // Filtros avanzados: ocultos por omisión para no saturar la vista diaria.
  const [avanzados, setAvanzados] = useState(false)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [minInput, setMinInput] = useState('')
  const [maxInput, setMaxInput] = useState('')
  const [tagId, setTagId] = useState(0)

  const [pagina, setPagina] = useState(0)

  // El buscador espera a que dejes de teclear antes de consultar.
  useEffect(() => {
    const timer = setTimeout(() => setQ(qInput.trim()), 300)
    return () => clearTimeout(timer)
  }, [qInput])

  const minCents = parseAmount(minInput) ?? undefined
  const maxCents = parseAmount(maxInput) ?? undefined
  const porRango = Boolean(from || to)

  const filtros: TxFilters = {
    profileId: profile.id,
    // Un rango explícito reemplaza al mes; el servidor aplica la misma regla.
    month: porRango ? undefined : month,
    from: from || undefined,
    to: to || undefined,
    accountId: accountId || undefined,
    type: type || undefined,
    tagId: tagId || undefined,
    minCents,
    maxCents,
    q: q || undefined,
    conciliado: conciliado || undefined,
  }

  // Cualquier cambio de filtro vuelve a la primera página: quedarse en la
  // página 4 de un resultado de 10 filas se ve como "no hay nada".
  const claveFiltros = JSON.stringify(filtros)
  useEffect(() => setPagina(0), [claveFiltros])

  const { data: accounts } = useFetch(() => api.accounts.list(profile.id), [profile.id, refreshKey])
  const { data: tags } = useFetch(() => api.tags.list(profile.id), [profile.id, refreshKey])
  const { data: page, error } = useFetch(
    () => api.tx.list({ ...filtros, limit: POR_PAGINA, offset: pagina * POR_PAGINA }),
    [claveFiltros, pagina, refreshKey],
  )

  const remove = async (tx: Tx) => {
    try {
      await api.tx.remove(tx.id)
      stamp('Anulado')
      bump()
    } catch (err) {
      alert((err as Error).message)
    }
    setDeletingId(null)
  }

  const txs = page?.items ?? []
  const total = page?.total ?? 0
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA))
  const hayFiltro = Boolean(
    q || accountId || type || tagId || from || to || minInput || maxInput || conciliado,
  )

  const limpiar = () => {
    setFrom('')
    setTo('')
    setMinInput('')
    setMaxInput('')
    setTagId(0)
    setAccountId(0)
    setType('')
    setQInput('')
    setConciliado('')
  }

  const duplicar = async (tx: Tx) => {
    try {
      await api.tx.duplicar(tx.id, todayISO())
      stamp('Duplicado')
      bump()
    } catch (err) {
      alert((err as Error).message)
    }
  }

  /** Palomear o despalomear una partida. No mueve un solo saldo. */
  const marcar = async (tx: Tx, reconciled: boolean) => {
    try {
      await api.tx.conciliar({ profileId: profile.id, txIds: [tx.id], reconciled })
      bump()
    } catch (err) {
      alert((err as Error).message)
    }
  }

  return (
    <div className="vista">
      <header className="vista-head">
        <h1>Movimientos</h1>
        <div className="mes-nav">
          {porRango ? (
            <span className="vista-mes">Rango elegido</span>
          ) : (
            <>
              <button type="button" className="mes-flecha" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Mes anterior">‹</button>
              <span className="vista-mes">{monthLabel(month)}</span>
              <button type="button" className="mes-flecha" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Mes siguiente">›</button>
            </>
          )}
        </div>
      </header>

      <div className="filtros">
        <select
          className="filtro"
          value={accountId}
          onChange={(e) => setAccountId(Number(e.target.value))}
          aria-label="Filtrar por cuenta"
        >
          <option value={0}>Todas las cuentas</option>
          {(accounts ?? []).map((a) => (
            <option key={a.id} value={a.id}>{a.name}{a.archived ? ' (archivada)' : ''}</option>
          ))}
        </select>
        <select
          className="filtro"
          value={type}
          onChange={(e) => setType(e.target.value)}
          aria-label="Filtrar por tipo"
        >
          <option value="">Todos los tipos</option>
          <option value="gasto">Gastos</option>
          <option value="ingreso">Ingresos</option>
          <option value="transferencia">Transferencias</option>
        </select>
        <input
          className="filtro filtro-busqueda"
          placeholder="Buscar concepto, categoría o cuenta…"
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          aria-label="Buscar"
        />
        <button
          type="button"
          className="btn btn-fantasma btn-chico"
          aria-expanded={avanzados}
          onClick={() => setAvanzados((v) => !v)}
        >
          {avanzados ? 'Menos filtros' : 'Más filtros'}
        </button>
      </div>

      {avanzados && (
        <div className="filtros filtros-avanzados">
          <label className="filtro-campo">
            <span className="filtro-label">Desde</span>
            <input type="date" className="filtro" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="filtro-campo">
            <span className="filtro-label">Hasta</span>
            <input type="date" className="filtro" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label className="filtro-campo">
            <span className="filtro-label">Monto mínimo</span>
            <input className="filtro" inputMode="decimal" placeholder="0.00" value={minInput} onChange={(e) => setMinInput(e.target.value)} />
          </label>
          <label className="filtro-campo">
            <span className="filtro-label">Monto máximo</span>
            <input className="filtro" inputMode="decimal" placeholder="Sin tope" value={maxInput} onChange={(e) => setMaxInput(e.target.value)} />
          </label>
          <label className="filtro-campo">
            <span className="filtro-label">Etiqueta</span>
            <select className="filtro" value={tagId} onChange={(e) => setTagId(Number(e.target.value))}>
              <option value={0}>Cualquiera</option>
              {(tags ?? []).map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </label>
          <label className="filtro-campo">
            <span className="filtro-label">Conciliación</span>
            <select
              className="filtro"
              value={conciliado}
              onChange={(e) => setConciliado(e.target.value as '' | 'si' | 'no')}
            >
              <option value="">Todo</option>
              <option value="no">Sin palomear</option>
              <option value="si">Palomeado</option>
            </select>
          </label>
          {hayFiltro && (
            <button type="button" className="btn-liga" onClick={limpiar}>Limpiar filtros</button>
          )}
        </div>
      )}

      {error && <p className="aviso" role="alert">{error}</p>}

      {page && txs.length === 0 ? (
        <div className="vacio">
          <p className="vacio-titulo">{porRango ? 'Nada en ese rango.' : 'Este mes está en blanco.'}</p>
          <p className="vacio-sub">
            {hayFiltro
              ? 'Ningún movimiento coincide con los filtros.'
              : 'Registra el primer movimiento del periodo.'}
          </p>
          {!hayFiltro && (
            <div className="vacio-acciones">
              <button type="button" className="btn btn-primario" onClick={() => openTx()}>
                ＋ Registrar movimiento
              </button>
              <button type="button" className="btn btn-fantasma" onClick={irAImportar}>
                ↑ Importar CSV
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="libro-barra">
            <span className="libro-cuenta">
              {total} movimiento{total === 1 ? '' : 's'}
              {paginas > 1 && ` · página ${pagina + 1} de ${paginas}`}
            </span>
            <span className="libro-barra-acciones">
              <button
                type="button"
                className="btn btn-fantasma btn-chico"
                aria-expanded={conciliando}
                onClick={() => setConciliando((v) => !v)}
              >
                ✓ Conciliar
              </button>
              <button type="button" className="btn btn-fantasma btn-chico" onClick={irAImportar}>
                ↑ Importar CSV
              </button>
              <a className="btn btn-fantasma btn-chico" href={api.tx.exportUrl(filtros)}>
                ↓ Exportar CSV
              </a>
            </span>
          </div>

          {conciliando && (
            <Conciliar
              accounts={accounts ?? []}
              accountId={accountId}
              onElegirCuenta={setAccountId}
              onSoloPendientes={() => {
                setConciliado('no')
                setAvanzados(true)
              }}
            />
          )}

          <table className="libro">
            <thead>
              <tr>
                {conciliando && <th className="col-palomear">✓</th>}
                <th className="col-fecha">Fecha</th>
                <th>Concepto</th>
                <th className="col-cuenta">Cuenta</th>
                <th className="col-monto">Cargo</th>
                <th className="col-monto">Abono</th>
                <th className="col-acciones"><span className="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              {txs.map((tx, i) => (
                <tr
                  key={tx.id}
                  className={`libro-fila${tx.reconciledAt ? ' conciliada' : ''}`}
                  style={{ animationDelay: `${Math.min(i * 25, 400)}ms` }}
                >
                  {conciliando && (
                    <td className="col-palomear">
                      <input
                        type="checkbox"
                        checked={Boolean(tx.reconciledAt)}
                        onChange={(e) => void marcar(tx, e.target.checked)}
                        aria-label={`Conciliar ${tx.note || fmtDate(tx.date)}`}
                      />
                    </td>
                  )}
                  <td className="col-fecha">{fmtDate(tx.date)}</td>
                  <td>
                    <span className="mov-concepto">
                      {tx.note || tx.categoryName || (tx.type === 'transferencia' ? 'Transferencia' : 'Sin concepto')}
                    </span>
                    {tx.categoryName && tx.note && <span className="mov-cat">{tx.categoryName}</span>}
                    {tx.debtPaymentId && <span className="mov-cat">Abono de deuda</span>}
                    {tx.msiPurchaseId && <span className="mov-cat">Compra a meses</span>}
                    {tx.debtId && <span className="mov-cat">Desembolso de deuda</span>}
                    {tx.refundOfId && <span className="mov-cat">Devolución · baja el gasto</span>}
                    {tx.attachments.length > 0 && (
                      <span className="mov-cat" title="Tiene recibo">◫ recibo</span>
                    )}
                    {/*
                      El reparto se enseña entero: un ticket dividido cuya
                      categoría no se ve se lee como "sin clasificar", que es
                      justo lo contrario de lo que pasó.
                    */}
                    {tx.splits.length > 0 && (
                      <span className="mov-reparto">
                        {tx.splits.map((r) => (
                          <span className="chip chip-renglon" key={r.id}>
                            {r.categoryName ?? 'Sin categoría'} <Money cents={r.amountCents} />
                          </span>
                        ))}
                      </span>
                    )}
                    {tx.tags.length > 0 && (
                      <span className="mov-etiquetas">
                        {tx.tags.map((t) => (
                          <span className="chip chip-etiqueta" key={t.id}>{t.name}</span>
                        ))}
                      </span>
                    )}
                  </td>
                  <td className="col-cuenta">
                    {tx.type === 'transferencia'
                      ? `${tx.accountName} → ${tx.transferAccountName}`
                      : tx.accountName}
                  </td>
                  <td className={`col-monto${tx.type === 'transferencia' ? ' neutro' : ''}`}>
                    {tx.type === 'gasto' && <Money cents={tx.amountCents} />}
                    {tx.type === 'transferencia' && <Money cents={tx.amountCents} />}
                  </td>
                  <td className={`col-monto${tx.type === 'transferencia' ? ' neutro' : ''}`}>
                    {tx.type === 'ingreso' && <Money cents={tx.amountCents} />}
                    {tx.type === 'transferencia' && <Money cents={tx.amountCents} />}
                  </td>
                  <td className="col-acciones">
                    {deletingId === tx.id ? (
                      <span className="confirmar">
                        <button type="button" className="btn-liga btn-liga-rojo" onClick={() => remove(tx)}>Anular</button>
                        <button type="button" className="btn-liga" onClick={() => setDeletingId(null)}>No</button>
                      </span>
                    ) : (
                      <span className="acciones">
                        <button type="button" className="accion" onClick={() => openTx(tx)} aria-label="Corregir">✎</button>
                        <button type="button" className="accion" onClick={() => void duplicar(tx)} aria-label="Duplicar con la fecha de hoy">⧉</button>
                        <button type="button" className="accion" onClick={() => setDeletingId(tx.id)} aria-label="Anular">✕</button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              {/* Las sumas son de todo el filtro, no de la página visible. */}
              <tr className="libro-suma">
                <td colSpan={conciliando ? 4 : 3}>Sumas del periodo</td>
                <td className="col-monto"><Money cents={page?.gastoCents ?? 0} /></td>
                <td className="col-monto"><Money cents={page?.ingresoCents ?? 0} /></td>
                <td />
              </tr>
              <tr className="libro-neto">
                <td colSpan={conciliando ? 4 : 3}>Neto</td>
                <td colSpan={2} className="col-monto">
                  <span className="doble-raya">
                    <Money cents={(page?.ingresoCents ?? 0) - (page?.gastoCents ?? 0)} signed />
                  </span>
                </td>
                <td />
              </tr>
            </tfoot>
          </table>

          {paginas > 1 && (
            <nav className="paginacion" aria-label="Páginas de movimientos">
              <button
                type="button"
                className="btn btn-fantasma btn-chico"
                disabled={pagina === 0}
                onClick={() => setPagina((p) => Math.max(0, p - 1))}
              >
                ‹ Anteriores
              </button>
              <span className="paginacion-estado">Página {pagina + 1} de {paginas}</span>
              <button
                type="button"
                className="btn btn-fantasma btn-chico"
                disabled={pagina + 1 >= paginas}
                onClick={() => setPagina((p) => p + 1)}
              >
                Siguientes ›
              </button>
            </nav>
          )}
        </>
      )}
    </div>
  )
}
