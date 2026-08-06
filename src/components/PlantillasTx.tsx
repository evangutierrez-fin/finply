import { useState } from 'react'
import { api } from '../api.ts'
import { useApp } from '../context.ts'
import { useFetch } from '../hooks.ts'
import { fmtMoney, parseAmount } from '../format.ts'
import type { PlantillaTx, TxType } from '../../shared/types.ts'

const TIPOS: { id: TxType; label: string }[] = [
  { id: 'gasto', label: 'Gasto' },
  { id: 'ingreso', label: 'Ingreso' },
  { id: 'transferencia', label: 'Transferencia' },
]

/**
 * Plantillas de movimiento: "gasolina", "despensa quincenal".
 *
 * **No es una recurrencia** y la diferencia importa: una recurrencia sabe qué
 * día cae y te propone el periodo que se venció; una plantilla no sabe de
 * fechas y no propone nada sola. Es el formulario ya llenado, esperando a que
 * alguien lo abra. Por eso convive con la Fase 5 sin pisarla: la colegiatura es
 * una recurrencia, la gasolina es una plantilla.
 *
 * El monto puede quedarse vacío —"lo pongo yo cada vez"—, que es lo normal en
 * la gasolina y lo raro en la colegiatura.
 */
export function PlantillasTx() {
  const { profile, bump, stamp } = useApp()
  const [abierta, setAbierta] = useState<PlantillaTx | 'nueva' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { data: plantillas, reload } = useFetch(
    () => api.personalizacion.plantillas.list(profile.id),
    [profile.id],
  )
  const { data: cuentas } = useFetch(() => api.accounts.list(profile.id), [profile.id])
  const { data: categorias } = useFetch(() => api.categories.list(profile.id), [profile.id])

  const borrar = async (p: PlantillaTx) => {
    try {
      await api.personalizacion.plantillas.remove(p.id, profile.id)
      stamp('Borrada')
      reload()
      bump()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <section className="hoja ajustes-bloque">
      <h2 className="hoja-titulo">Plantillas de movimiento</h2>
      <p className="ajustes-texto">
        Lo que tecleas igual cada vez, guardado: la gasolina, la despensa, la comida del martes.
        Desde la barra de registro rápido se elige una y el formulario aparece lleno.{' '}
        <strong>No es una recurrencia</strong>: una plantilla no sabe qué día cae y no propone nada
        sola — la colegiatura es una recurrencia, la gasolina es una plantilla.
      </p>

      {plantillas && plantillas.length > 0 && (
        <ul className="campos-lista">
          {plantillas.map((p) => (
            <li key={p.id} className="campo-fila">
              <span className="campo-fila-datos">
                <strong>{p.name}</strong>
                <span className="campo-fila-sub">
                  {[
                    TIPOS.find((t) => t.id === p.type)?.label,
                    p.amountCents === null ? 'monto libre' : fmtMoney(p.amountCents),
                    p.accountName ?? 'sin cuenta',
                    p.categoryName,
                    p.note,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
              <span className="campo-fila-acciones">
                <button type="button" className="btn-liga" onClick={() => setAbierta(p)}>
                  Editar
                </button>
                <button type="button" className="btn-liga btn-liga-rojo" onClick={() => void borrar(p)}>
                  Borrar
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="forma-error" role="alert">{error}</p>}

      {abierta ? (
        <PlantillaForma
          plantilla={abierta === 'nueva' ? null : abierta}
          cuentas={cuentas ?? []}
          categorias={categorias ?? []}
          onCerrar={() => setAbierta(null)}
          onGuardada={() => {
            setAbierta(null)
            reload()
            bump()
          }}
        />
      ) : (
        <button type="button" className="btn btn-fantasma btn-chico" onClick={() => setAbierta('nueva')}>
          ＋ Nueva plantilla
        </button>
      )}
      {plantillas && plantillas.length > 0 && (
        <p className="ajustes-nota">
          Borrar una plantilla no toca los movimientos que salieron de ella: eso ya es del libro.
        </p>
      )}
    </section>
  )
}

function PlantillaForma({
  plantilla,
  cuentas,
  categorias,
  onCerrar,
  onGuardada,
}: {
  plantilla: PlantillaTx | null
  cuentas: { id: number; name: string; archived: boolean }[]
  categorias: { id: number; name: string; kind: string }[]
  onCerrar: () => void
  onGuardada: () => void
}) {
  const { profile, stamp } = useApp()
  const [name, setName] = useState(plantilla?.name ?? '')
  const [type, setType] = useState<TxType>(plantilla?.type ?? 'gasto')
  const [accountId, setAccountId] = useState(plantilla?.accountId ?? 0)
  const [transferAccountId, setTransferAccountId] = useState(plantilla?.transferAccountId ?? 0)
  const [categoryId, setCategoryId] = useState(plantilla?.categoryId ?? 0)
  const [amount, setAmount] = useState(
    plantilla?.amountCents == null ? '' : (plantilla.amountCents / 100).toFixed(2),
  )
  const [note, setNote] = useState(plantilla?.note ?? '')
  const [error, setError] = useState<string | null>(null)

  const vivas = cuentas.filter((c) => !c.archived || c.id === plantilla?.accountId)
  const opciones = categorias.filter((c) => c.kind === (type === 'ingreso' ? 'ingreso' : 'gasto'))

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return setError('Ponle nombre a la plantilla')
    // Vacío es una elección, no un error: "el monto lo pongo yo cada vez".
    const cents = amount.trim() === '' ? null : parseAmount(amount)
    if (amount.trim() !== '' && !cents) return setError('Ese monto no se entiende')
    const datos = {
      name: name.trim(),
      type,
      accountId: accountId || null,
      transferAccountId: type === 'transferencia' ? transferAccountId || null : null,
      categoryId: type === 'transferencia' ? null : categoryId || null,
      amountCents: cents,
      note,
    }
    try {
      if (plantilla) await api.personalizacion.plantillas.update(plantilla.id, profile.id, datos)
      else await api.personalizacion.plantillas.create({ profileId: profile.id, ...datos })
      stamp('Guardada')
      onGuardada()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <form className="forma campos-forma" onSubmit={guardar}>
      <div className="campos-2">
        <label className="campo">
          <span className="campo-label">Cómo se llama</span>
          <input
            className="campo-input"
            placeholder="Ej. Gasolina"
            maxLength={40}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </label>
        <label className="campo">
          <span className="campo-label">Tipo</span>
          <select
            className="campo-input"
            value={type}
            onChange={(e) => {
              setType(e.target.value as TxType)
              setCategoryId(0)
            }}
          >
            {TIPOS.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="campos-2">
        <label className="campo">
          <span className="campo-label">{type === 'transferencia' ? 'De la cuenta' : 'Cuenta'}</span>
          <select
            className="campo-input"
            value={accountId}
            onChange={(e) => setAccountId(Number(e.target.value))}
          >
            <option value={0}>La elijo al registrar</option>
            {vivas.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        {type === 'transferencia' ? (
          <label className="campo">
            <span className="campo-label">A la cuenta</span>
            <select
              className="campo-input"
              value={transferAccountId}
              onChange={(e) => setTransferAccountId(Number(e.target.value))}
            >
              <option value={0}>La elijo al registrar</option>
              {vivas.filter((c) => c.id !== accountId).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
        ) : (
          <label className="campo">
            <span className="campo-label">Categoría</span>
            <select
              className="campo-input"
              value={categoryId}
              onChange={(e) => setCategoryId(Number(e.target.value))}
            >
              <option value={0}>Sin categoría</option>
              {opciones.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="campos-2">
        <label className="campo">
          <span className="campo-label">Monto</span>
          <div className="monto-wrap">
            <span className="monto-signo" aria-hidden="true">$</span>
            <input
              className="campo-input"
              inputMode="decimal"
              placeholder="Lo pongo cada vez"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
        </label>
        <label className="campo">
          <span className="campo-label">Concepto</span>
          <input
            className="campo-input"
            maxLength={200}
            placeholder="Ej. Gasolina del coche"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
      </div>

      {error && <p className="forma-error" role="alert">{error}</p>}
      <footer className="forma-pie">
        <button type="button" className="btn btn-fantasma btn-chico" onClick={onCerrar}>
          Cancelar
        </button>
        <button type="submit" className="btn btn-primario btn-chico">
          {plantilla ? 'Guardar cambios' : 'Agregar plantilla'}
        </button>
      </footer>
    </form>
  )
}
