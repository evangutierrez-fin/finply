import { useState } from 'react'
import { api } from '../api.ts'
import { useApp } from '../context.ts'
import { useFetch } from '../hooks.ts'
import { fmtDate, fmtMoney, fmtTasa, todayISO } from '../format.ts'
import { Money } from '../components/Money.tsx'
import { AccountModal } from '../components/AccountModal.tsx'
import { MsiModal } from '../components/MsiModal.tsx'
import type { Account, CompraMSI, EstadoTarjeta } from '../../shared/types.ts'

function ComprasMSI({
  compras,
  onBorrar,
}: {
  compras: CompraMSI[]
  onBorrar: (compra: CompraMSI) => void
}) {
  const hoy = todayISO()
  return (
    <ul className="msi-lista">
      {compras.map((compra) => {
        const facturadas = compra.parcialidades.filter((p) => p.dueDate <= hoy)
        const siguiente = compra.parcialidades.find((p) => p.dueDate > hoy)
        const restante = compra.totalCents - facturadas.reduce((s, p) => s + p.amountCents, 0)
        return (
          <li key={compra.id} className="msi-fila">
            <div className="msi-fila-head">
              <span className="msi-concepto">{compra.concept || 'Compra a meses'}</span>
              <span className="chip">
                {facturadas.length} de {compra.months}
              </span>
            </div>
            <div className="msi-riel" role="img" aria-label={`${facturadas.length} de ${compra.months} parcialidades facturadas`}>
              <span
                className="msi-lleno"
                style={{ width: `${(facturadas.length / compra.months) * 100}%` }}
              />
            </div>
            <p className="msi-cifras">
              <Money cents={compra.totalCents} className="cifra-chica" /> en {compra.months} meses ·
              faltan <strong className="cifra-chica">{fmtMoney(restante)}</strong>
              {siguiente && (
                <>
                  {' · '}próxima <Money cents={siguiente.amountCents} className="cifra-chica" /> el{' '}
                  {fmtDate(siguiente.dueDate)}
                </>
              )}
            </p>
            <button
              type="button"
              className="btn-liga deuda-borrar msi-borrar"
              onClick={() => onBorrar(compra)}
            >
              Borrar compra
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function TarjetaCarta({
  estado,
  cuenta,
  compras,
  onEditar,
  onComprar,
  onBorrarCompra,
  index,
}: {
  estado: EstadoTarjeta
  cuenta: Account | undefined
  compras: CompraMSI[]
  onEditar: () => void
  onComprar: () => void
  onBorrarCompra: (compra: CompraMSI) => void
  index: number
}) {
  const limite = estado.creditLimitCents
  const usado = limite ? Math.min(100, Math.max(0, (estado.deudaCents / limite) * 100)) : 0
  const sobregirada = limite !== null && estado.deudaCents > limite
  const plan = estado.siPagasElMinimo

  return (
    <article className="hoja tarjeta-carta" style={{ animationDelay: `${index * 60}ms` }}>
      <header className="tarjeta-head">
        <h2>{estado.name}</h2>
        <button type="button" className="btn-liga" onClick={onEditar} disabled={!cuenta}>
          Editar
        </button>
      </header>

      <p className="rotulo">Debes hoy</p>
      <Money cents={estado.deudaCents} className="tarjeta-deuda" />

      {limite !== null ? (
        <>
          <div className="tarjeta-riel" role="img" aria-label={`Usado ${fmtMoney(estado.deudaCents)} de ${fmtMoney(limite)}`}>
            <span
              className={`tarjeta-lleno${sobregirada ? ' estado-excedido' : ''}`}
              style={{ width: `${usado}%` }}
            />
          </div>
          <p className="tarjeta-linea">
            {sobregirada ? (
              <strong className="presup-rojo">
                Te pasaste del límite por {fmtMoney(estado.deudaCents - limite)}
              </strong>
            ) : (
              <>
                Disponible <strong className="cifra-chica">{fmtMoney(estado.disponibleCents ?? 0)}</strong>{' '}
                de {fmtMoney(limite)}
              </>
            )}
          </p>
        </>
      ) : (
        <p className="tarjeta-linea neutro">Sin límite configurado.</p>
      )}

      {estado.fechaCorte ? (
        <div className="tarjeta-corte">
          <div className="tarjeta-corte-fila">
            <span className="rotulo">Cortó el {fmtDate(estado.fechaCorte)}</span>
            <Money cents={estado.saldoAlCorteCents ?? 0} className="cifra-chica" />
          </div>
          {(estado.pagadoDesdeCorteCents ?? 0) > 0 && (
            <div className="tarjeta-corte-fila">
              <span className="rotulo">Abonado desde el corte</span>
              <Money cents={-(estado.pagadoDesdeCorteCents ?? 0)} className="cifra-chica" />
            </div>
          )}
          <div className="tarjeta-corte-fila tarjeta-pngi">
            <span className="rotulo">
              Para no generar intereses
              {estado.fechaLimitePago && <> · antes del {fmtDate(estado.fechaLimitePago)}</>}
            </span>
            <Money cents={estado.paraNoGenerarInteresesCents ?? 0} className="cifra" />
          </div>
          {estado.paraNoGenerarInteresesCents === 0 && (
            <p className="tarjeta-nota">Este corte ya está cubierto.</p>
          )}
        </div>
      ) : (
        <p className="tarjeta-nota">
          Ponle día de corte y día de pago para ver cuánto tienes que pagar y hasta cuándo.
        </p>
      )}

      {estado.pagoMinimoCents !== null && (
        <div className="tarjeta-minimo">
          <div className="tarjeta-corte-fila">
            <span className="rotulo">
              Pago mínimo
              {estado.annualRateBp !== null && <> · {fmtTasa(estado.annualRateBp)} anual</>}
            </span>
            <Money cents={estado.pagoMinimoCents} className="cifra-chica" />
          </div>
          {plan === null ? (
            <p className="tarjeta-nota">
              Escribe la tasa anual de la tarjeta para saber qué cuesta pagar solo el mínimo.
            </p>
          ) : plan.nuncaTermina ? (
            <p className="tarjeta-nota tarjeta-nunca">
              <strong>Pagando el mínimo, esta deuda no se acaba.</strong> Con esa tasa, el interés
              de cada mes se come el abono y el saldo no baja. Es aritmética de tus propias cifras,
              no una predicción.
            </p>
          ) : (
            <p className="tarjeta-nota">
              Pagando <strong>solo el mínimo</strong> —y sin volver a usarla— saldas en{' '}
              <strong>{plan.meses} meses</strong> y pagas{' '}
              <strong className="cifra-chica">{fmtMoney(plan.totalInteresCents)}</strong> de
              intereses: {fmtMoney(plan.totalPagadoCents)} por{' '}
              {fmtMoney(estado.deudaCents - estado.msiPorFacturarCents)} de deuda.
            </p>
          )}
        </div>
      )}

      <footer className="tarjeta-pie">
        <button type="button" className="btn btn-primario btn-chico" onClick={onComprar}>
          ＋ Compra a meses
        </button>
        {estado.msiPorFacturarCents > 0 && (
          <span className="tarjeta-msi-resumen">
            A meses por facturar <Money cents={estado.msiPorFacturarCents} className="cifra-chica" />
            {estado.msiProximoCorteCents > 0 && (
              <> · en el próximo corte {fmtMoney(estado.msiProximoCorteCents)}</>
            )}
          </span>
        )}
      </footer>

      {compras.length > 0 && <ComprasMSI compras={compras} onBorrar={onBorrarCompra} />}
    </article>
  )
}

export function Tarjetas() {
  const { profile, refreshKey, bump, stamp } = useApp()
  const [editando, setEditando] = useState<Account | null | 'nueva'>(null)
  const [comprando, setComprando] = useState<number | null>(null)

  const { data: estados, error } = useFetch(
    () => api.tarjetas.estado(profile.id),
    [profile.id, refreshKey],
  )
  const { data: cuentas } = useFetch(() => api.accounts.list(profile.id), [profile.id, refreshKey])
  const { data: compras } = useFetch(
    () => api.tarjetas.msi.list(profile.id),
    [profile.id, refreshKey],
  )

  const tarjetas = (cuentas ?? []).filter((a) => a.type === 'tarjeta' && !a.archived)
  const deudaTotal = (estados ?? []).reduce((s, t) => s + t.deudaCents, 0)
  const pagoTotal = (estados ?? []).reduce((s, t) => s + (t.paraNoGenerarInteresesCents ?? 0), 0)

  const borrarCompra = async (compra: CompraMSI) => {
    if (!confirm(`¿Borrar "${compra.concept || 'la compra a meses'}"? También se borra su cargo.`)) {
      return
    }
    try {
      await api.tarjetas.msi.remove(compra.id, profile.id)
      stamp('Borrada')
      bump()
    } catch (err) {
      alert((err as Error).message)
    }
  }

  return (
    <div className="vista">
      <header className="vista-head">
        <h1>Tarjetas</h1>
        <button
          type="button"
          className="btn btn-primario"
          onClick={() => setEditando('nueva')}
        >
          ＋ Abrir tarjeta
        </button>
      </header>

      {error && <p className="aviso" role="alert">{error}</p>}

      {estados && estados.length === 0 ? (
        <div className="vacio">
          <p className="vacio-titulo">Sin tarjetas todavía.</p>
          <p className="vacio-sub">
            Una tarjeta con día de corte y día de pago te dice lo único que importa: cuánto
            tienes que pagar y antes de cuándo, para no regalarle intereses al banco.
          </p>
          <button type="button" className="btn btn-primario" onClick={() => setEditando('nueva')}>
            Abrir la primera
          </button>
        </div>
      ) : (
        estados && (
          <>
            <section className="hoja tarjetas-resumen">
              <div className="tarjetas-resumen-dato">
                <span className="rotulo">Debes en tarjetas</span>
                <Money cents={deudaTotal} className="hero-cifra-media" />
              </div>
              <div className="tarjetas-resumen-dato">
                <span className="rotulo">Para no generar intereses</span>
                <Money cents={pagoTotal} className="hero-cifra-media" />
              </div>
            </section>

            <section className="tarjetas-grid">
              {estados.map((estado, i) => (
                <TarjetaCarta
                  key={estado.accountId}
                  estado={estado}
                  cuenta={tarjetas.find((t) => t.id === estado.accountId)}
                  compras={(compras ?? []).filter((c) => c.accountId === estado.accountId)}
                  onEditar={() =>
                    setEditando(tarjetas.find((t) => t.id === estado.accountId) ?? null)
                  }
                  onComprar={() => setComprando(estado.accountId)}
                  onBorrarCompra={borrarCompra}
                  index={i}
                />
              ))}
            </section>
          </>
        )
      )}

      {editando !== null && (
        <AccountModal
          account={editando === 'nueva' ? null : editando}
          tipoInicial="tarjeta"
          onClose={() => setEditando(null)}
          onSaved={bump}
        />
      )}

      {comprando !== null && (
        <MsiModal
          tarjetas={tarjetas}
          tarjetaId={comprando}
          onClose={() => setComprando(null)}
          onSaved={bump}
        />
      )}
    </div>
  )
}
