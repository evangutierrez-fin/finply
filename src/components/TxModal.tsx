import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  Account, Arrendamiento, BorradorTx, CampoPropio, CentroCosto, Category, Contraparte, Tag, Tx,
  TxAttachment, TxType,
} from '../../shared/types.ts'
import { libroPide, pideCampo, type CampoTx } from '../../shared/campos.ts'
import { rotuloCategoria } from '../../shared/taxonomia.ts'
import { api } from '../api.ts'
import { fmtDate, mensajeMonto, parseAmount, todayISO } from '../format.ts'
import { useApp } from '../context.ts'
import { Money } from './Money.tsx'
import { Modal } from './Modal.tsx'

const TYPES: { id: TxType; label: string }[] = [
  { id: 'gasto', label: 'Gasto' },
  { id: 'ingreso', label: 'Ingreso' },
  { id: 'transferencia', label: 'Transferencia' },
]

/** Un renglón del reparto mientras se edita: el monto vive como texto. */
interface Renglon {
  categoryId: number
  amount: string
  note: string
}

const RENGLON_VACIO: Renglon = { categoryId: 0, amount: '', note: '' }

export function TxModal({
  tx,
  borrador,
  onClose,
  onSaved,
}: {
  tx: Tx | null
  /**
   * Un movimiento a medio escribir, para abrir el formulario ya lleno desde
   * donde apareció el dato (Fase 20). Solo cuenta al **crear**: corrigiendo
   * manda el movimiento, siempre.
   */
  borrador?: BorradorTx
  onClose: () => void
  onSaved: () => void
}) {
  const { profile, stamp } = useApp()
  const previo = tx ? undefined : borrador
  const [accounts, setAccounts] = useState<Account[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [type, setType] = useState<TxType>(tx?.type ?? previo?.type ?? 'gasto')
  const [amount, setAmount] = useState(() => {
    const cents = tx?.amountCents ?? previo?.amountCents
    return cents === undefined ? '' : (cents / 100).toFixed(2)
  })
  const [accountId, setAccountId] = useState<number>(tx?.accountId ?? previo?.accountId ?? 0)
  const [transferAccountId, setTransferAccountId] = useState<number>(
    tx?.transferAccountId ?? previo?.transferAccountId ?? 0,
  )
  const [categoryId, setCategoryId] = useState<number>(tx?.categoryId ?? previo?.categoryId ?? 0)
  const [date, setDate] = useState(tx?.date ?? previo?.date ?? todayISO())
  const [note, setNote] = useState(tx?.note ?? previo?.note ?? '')
  const [newCategory, setNewCategory] = useState<string | null>(null)
  const [tags, setTags] = useState<Tag[]>([])
  const [tagIds, setTagIds] = useState<number[]>(tx?.tags.map((t) => t.id) ?? [])
  // Campos del perfil de negocio. Solo se piden en un libro de negocio: en uno
  // personal serían cuatro casillas que nadie va a llenar nunca.
  const [contrapartes, setContrapartes] = useState<Contraparte[]>([])
  const [centros, setCentros] = useState<CentroCosto[]>([])
  const [counterpartyId, setCounterpartyId] = useState<number>(
    tx?.counterpartyId ?? previo?.counterpartyId ?? 0,
  )
  const [costCenterId, setCostCenterId] = useState<number>(tx?.costCenterId ?? 0)
  const [tax, setTax] = useState(tx?.taxCents ? (tx.taxCents / 100).toFixed(2) : '')
  const [deductible, setDeductible] = useState(tx?.deductible ?? false)
  const [arrendamientos, setArrendamientos] = useState<Arrendamiento[]>([])
  // Los campos propios del perfil (Fase 21) y lo contestado en esta partida.
  const [propios, setPropios] = useState<CampoPropio[]>([])
  const [valores, setValores] = useState<Record<string, string>>(tx?.fields ?? {})
  const [rentalId, setRentalId] = useState<number>(tx?.rentalId ?? previo?.rentalId ?? 0)
  const [rentalRole, setRentalRole] = useState<string>(tx?.rentalRole ?? previo?.rentalRole ?? '')
  const [newTag, setNewTag] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Fase 10. El reparto por categoría (D17): mientras está apagado, manda la
  // categoría de arriba; encendido, mandan los renglones y la de arriba se va.
  const [dividida, setDividida] = useState((tx?.splits.length ?? 0) > 0)
  const [renglones, setRenglones] = useState<Renglon[]>(
    tx && tx.splits.length > 0
      ? tx.splits.map((r) => ({
          categoryId: r.categoryId ?? 0,
          amount: (r.amountCents / 100).toFixed(2),
          note: r.note,
        }))
      : [RENGLON_VACIO, RENGLON_VACIO],
  )
  // La devolución y su gasto original.
  const [refundOfId, setRefundOfId] = useState<number>(tx?.refundOfId ?? 0)
  const [gastosRecientes, setGastosRecientes] = useState<Tx[]>([])
  // Los recibos ya guardados. Solo existen al corregir: adjuntar algo exige que
  // el movimiento ya tenga id.
  const [adjuntos, setAdjuntos] = useState<TxAttachment[]>(tx?.attachments ?? [])
  const [subiendo, setSubiendo] = useState(false)
  const archivoRef = useRef<HTMLInputElement>(null)

  /**
   * Qué campos pide este movimiento. **La respuesta vive en un solo lugar**
   * (`shared/campos.ts`, Fase 20); aquí solo se pregunta.
   *
   * Antes estaba repartida por todo el archivo —un `includes('negocio')` en un
   * `useEffect`, un `type !== 'transferencia'` en cada bloque, la regla de "solo
   * si hay contratos" escondida en el JSX— y cada módulo nuevo agregaba otra
   * condición suelta que nadie podía probar sin montar el componente.
   */
  const pide = (campo: CampoTx) =>
    pideCampo(
      {
        modules: profile.modules,
        type,
        dividida,
        hayArrendamientos: arrendamientos.length > 0,
        existe: Boolean(tx),
        hayCamposPropios: propios.length > 0,
      },
      campo,
    )

  useEffect(() => {
    Promise.all([
      api.accounts.list(profile.id),
      api.categories.list(profile.id),
      api.tags.list(profile.id),
    ]).then(
      ([accs, cats, tgs]) => {
        setAccounts(accs)
        setCategories(cats)
        setTags(tgs)
        const active = accs.filter((a) => !a.archived)
        if (!tx && active.length > 0) setAccountId((id) => id || active[0]!.id)
      },
      (err: Error) => setError(err.message),
    )
  }, [profile.id, tx])

  // Qué se **carga** no depende del tipo elegido ahora, sino de si este libro
  // pide esos campos alguna vez: cambiar de gasto a transferencia no puede
  // costar dos llamadas más. En un libro personal no se piden nunca.
  const usaNegocio = libroPide(profile.modules, 'negocio')
  const usaInmuebles = libroPide(profile.modules, 'inmueble')

  useEffect(() => {
    if (!usaNegocio) return
    Promise.all([api.contrapartes.list(profile.id), api.centros.list(profile.id)]).then(
      ([cps, ccs]) => {
        setContrapartes(cps.filter((c) => !c.archived))
        setCentros(ccs.filter((c) => !c.archived))
      },
      () => {
        // Que falten no impide registrar el movimiento: son campos opcionales.
      },
    )
  }, [profile.id, usaNegocio])

  // Los campos propios se piden siempre: no dependen de ningún módulo, son del
  // libro. En el que no tenga ninguno, la respuesta vacía apaga la sección
  // entera sin que nadie tenga que decidir nada.
  useEffect(() => {
    api.personalizacion.campos.list(profile.id).then(
      (cs) => setPropios(cs.filter((c) => !c.archived)),
      () => {
        // Que fallen no impide registrar: son campos opcionales por definición.
      },
    )
  }, [profile.id])

  useEffect(() => {
    if (!usaInmuebles) return
    api.inmuebles.list(profile.id).then(
      (rs) => setArrendamientos(rs.filter((r) => !r.archived)),
      () => {
        // Que falten no impide registrar el movimiento: el campo es opcional.
      },
    )
  }, [profile.id, usaInmuebles])

  // Los gastos a los que se puede ligar una devolución. Solo se piden cuando el
  // movimiento es un ingreso: en cualquier otro caso la pregunta no existe.
  useEffect(() => {
    if (type !== 'ingreso') return
    api.tx
      .list({ profileId: profile.id, type: 'gasto', limit: 60 })
      .then(
        (page) => setGastosRecientes(page.items.filter((g) => !g.refundOfId)),
        () => {
          // Que falle solo quita la sugerencia; el movimiento se registra igual.
        },
      )
  }, [profile.id, type])

  const toggleTag = (id: number) =>
    setTagIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  const setRenglon = (i: number, cambio: Partial<Renglon>) =>
    setRenglones((prev) => prev.map((r, j) => (j === i ? { ...r, ...cambio } : r)))

  /** Lo que llevan los renglones ahora mismo, para poder enseñar lo que falta. */
  const sumaRenglones = renglones.reduce((s, r) => s + (parseAmount(r.amount) ?? 0), 0)
  const totalCents = parseAmount(amount) ?? 0
  const restante = totalCents - sumaRenglones

  /**
   * Adjuntar el recibo. El archivo se lee en el navegador y viaja en base64
   * dentro del JSON: no hay multipart en Finply, y el respaldo se lo lleva
   * justo porque acaba guardado en la base (ver la migración 14).
   */
  const adjuntar = async (file: File) => {
    if (!tx) return
    setSubiendo(true)
    setError(null)
    try {
      const buffer = await file.arrayBuffer()
      let binario = ''
      const bytes = new Uint8Array(buffer)
      for (let i = 0; i < bytes.length; i += 1) binario += String.fromCharCode(bytes[i]!)
      const creado = await api.tx.adjuntar(tx.id, {
        filename: file.name,
        mime: file.type,
        dataB64: btoa(binario),
      })
      setAdjuntos((prev) => [...prev, creado])
    } catch (err) {
      setError((err as Error).message)
    }
    setSubiendo(false)
    if (archivoRef.current) archivoRef.current.value = ''
  }

  const quitarAdjunto = async (adjunto: TxAttachment) => {
    if (!tx) return
    try {
      await api.tx.quitarAdjunto(tx.id, adjunto.id)
      setAdjuntos((prev) => prev.filter((a) => a.id !== adjunto.id))
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const addTag = async () => {
    const name = newTag.trim()
    if (!name) return
    try {
      const created = await api.tags.create({ profileId: profile.id, name })
      setTags((prev) => (prev.some((t) => t.id === created.id) ? prev : [...prev, created]))
      setTagIds((prev) => (prev.includes(created.id) ? prev : [...prev, created.id]))
      setNewTag('')
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const kind = type === 'ingreso' ? 'ingreso' : 'gasto'
  // Una categoría archivada sale del selector **pero sigue apareciendo si es la
  // que el movimiento ya traía**: es la misma regla que las cuentas archivadas,
  // y sin ella corregir la fecha de una partida vieja le cambiaría la categoría
  // en silencio (el trato de §2 con los PATCH que reemplazan el registro).
  const options = useMemo(
    () =>
      categories.filter(
        (c) => c.kind === kind && (!c.fueraDelSelector || c.id === tx?.categoryId),
      ),
    [categories, kind, tx],
  )

  // Al editar, la cuenta original aparece aunque esté archivada.
  const selectable = useMemo(
    () =>
      accounts.filter(
        (a) => !a.archived || a.id === tx?.accountId || a.id === tx?.transferAccountId,
      ),
    [accounts, tx],
  )

  // Los movimientos que nacieron de un abono, una inversión o una compra a
  // meses mantienen su tipo; monto y fecha se sincronizan con ese registro en
  // el servidor.
  const linked = Boolean(
    tx && (tx.debtPaymentId || tx.investmentEntryId || tx.msiPurchaseId || tx.debtId),
  )
  const ligadoA = tx?.debtPaymentId
    ? 'un abono de deuda'
    : tx?.investmentEntryId
      ? 'una inversión'
      : tx?.debtId
        ? 'el desembolso de una deuda'
        : 'una compra a meses'

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const cents = parseAmount(amount)
    if (!cents) return setError(mensajeMonto(amount, 'Escribe un monto válido, por ejemplo 250 o 1,250.50'))
    if (!accountId) return setError('Elige una cuenta')
    setSaving(true)
    setError(null)
    try {
      let catId = categoryId || null
      if (newCategory && newCategory.trim()) {
        const created = await api.categories.create({
          profileId: profile.id,
          name: newCategory.trim(),
          kind,
        })
        catId = created.id
      }
      const draft = {
        profileId: profile.id,
        accountId,
        type,
        amountCents: cents,
        date,
        categoryId: type === 'transferencia' ? null : catId,
        note,
        transferAccountId: type === 'transferencia' ? transferAccountId || null : null,
        tagIds,
        // Se mandan siempre, incluso con el módulo apagado, y **eso es R17**:
        // el PATCH reemplaza el movimiento entero, así que mandar `null`
        // porque los campos no están a la vista le borraría al usuario la
        // contraparte y el impuesto de una partida vieja con solo corregirle
        // la fecha. Como el estado nace del propio movimiento, mandarlo tal
        // cual lo devuelve intacto. En un libro sin negocio ya vienen vacíos.
        counterpartyId: counterpartyId || null,
        costCenterId: costCenterId || null,
        taxCents: parseAmount(tax) ?? 0,
        deductible,
        // Misma regla de R17 que los campos de negocio: se manda siempre lo que
        // el estado trae del propio movimiento. Apagar el reparto es un arreglo
        // vacío —"quítalo"—, y eso es una decisión del usuario, no un descuido.
        splits: dividida
          ? renglones.map((r) => ({
              categoryId: r.categoryId || null,
              amountCents: parseAmount(r.amount) ?? 0,
              note: r.note,
            }))
          : [],
        refundOfId: type === 'ingreso' ? refundOfId || null : null,
        // Los dos juntos o ninguno: un papel sin contrato no significa nada, y
        // un contrato sin papel deja al rendimiento sin saber qué hacer con el
        // monto. Misma regla de R17 que los campos de negocio.
        rentalId: rentalRole ? rentalId || null : null,
        rentalRole: rentalId && rentalRole ? (rentalRole as Tx['rentalRole']) : null,
        // Se mandan los del catálogo vivo, incluso vacíos: vacío **borra** esa
        // respuesta, que es lo que hace que se pueda desdecir. Lo contestado
        // con un campo archivado no viaja y por eso no se pierde — misma regla
        // de R17 que la contraparte y el impuesto.
        fields: Object.fromEntries(propios.map((c) => [String(c.id), valores[String(c.id)] ?? ''])),
      }
      if (tx) await api.tx.update(tx.id, draft)
      else await api.tx.create(draft)
      stamp('Registrado')
      onSaved()
      onClose()
    } catch (err) {
      setError((err as Error).message)
      setSaving(false)
    }
  }

  return (
    <Modal title={tx ? 'Corregir movimiento' : 'Nuevo movimiento'} onClose={onClose}>
      <form className="forma" onSubmit={submit}>
        <div className="seg" role="radiogroup" aria-label="Tipo de movimiento">
          {TYPES.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={type === t.id}
              disabled={linked}
              className={`seg-item seg-${t.id}${type === t.id ? ' activa' : ''}`}
              onClick={() => {
                setType(t.id)
                setCategoryId(0)
                setNewCategory(null)
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        {linked && (
          <p className="forma-nota">
            Este movimiento está ligado a {ligadoA}: monto y fecha se sincronizan con ese
            registro y el tipo no puede cambiar.
            {tx?.msiPurchaseId && ' Cambiar el monto rehace las parcialidades.'}
            {tx?.debtId && ' Anularlo no borra la deuda; solo quita el movimiento del libro.'}
          </p>
        )}
        {/*
          Llegó lleno desde donde apareció el dato: la alerta de la tarjeta, un
          renglón del calendario, la barra rápida. Se dice, porque un
          formulario que aparece con cifras puestas tiene que explicar de dónde
          salieron — y porque lo que sigue es confirmarlo, no aceptarlo (R4).
        */}
        {previo && (
          <p className="forma-nota">
            Finply llenó lo que ya sabía. Revísalo y confirma: nada entra al libro hasta que
            guardes.
          </p>
        )}

        <label className="campo campo-monto">
          <span className="campo-label">Monto</span>
          <div className="monto-wrap">
            <span className="monto-signo" aria-hidden="true">$</span>
            <input
              className="campo-input monto"
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              autoFocus
            />
          </div>
        </label>

        <div className="campos-2">
          <label className="campo">
            <span className="campo-label">{type === 'transferencia' ? 'De la cuenta' : 'Cuenta'}</span>
            <select
              className="campo-input"
              value={accountId}
              onChange={(e) => setAccountId(Number(e.target.value))}
            >
              <option value={0} disabled>Elige…</option>
              {selectable.map((a) => (
                <option key={a.id} value={a.id}>{a.name}{a.archived ? ' (archivada)' : ''}</option>
              ))}
            </select>
          </label>

          {pide('cuentaDestino') ? (
            <label className="campo">
              <span className="campo-label">A la cuenta</span>
              <select
                className="campo-input"
                value={transferAccountId}
                onChange={(e) => setTransferAccountId(Number(e.target.value))}
              >
                <option value={0} disabled>Elige…</option>
                {selectable
                  .filter((a) => a.id !== accountId)
                  .map((a) => (
                    <option key={a.id} value={a.id}>{a.name}{a.archived ? ' (archivada)' : ''}</option>
                  ))}
              </select>
            </label>
          ) : !pide('categoria') ? (
            <div className="campo">
              <span className="campo-label">Categoría</span>
              <p className="campo-nota">
                Este ticket va repartido en {renglones.length} renglones; su categoría son
                las de abajo.
              </p>
            </div>
          ) : (
            <label className="campo">
              <span className="campo-label">Categoría</span>
              {newCategory === null ? (
                <select
                  className="campo-input"
                  value={categoryId}
                  onChange={(e) => {
                    if (e.target.value === '__nueva') {
                      setNewCategory('')
                    } else {
                      setCategoryId(Number(e.target.value))
                    }
                  }}
                >
                  <option value={0}>Sin categoría</option>
                  {options.map((c) => (
                    <option key={c.id} value={c.id}>{rotuloCategoria(c)}</option>
                  ))}
                  <option value="__nueva">＋ Nueva categoría…</option>
                </select>
              ) : (
                <div className="campo-inline">
                  <input
                    className="campo-input"
                    placeholder="Nombre de la categoría"
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                    autoFocus
                  />
                  <button type="button" className="btn-liga" onClick={() => setNewCategory(null)}>
                    Cancelar
                  </button>
                </div>
              )}
            </label>
          )}
        </div>

        <div className="campos-2">
          <label className="campo">
            <span className="campo-label">Fecha</span>
            <input
              type="date"
              className="campo-input"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label className="campo">
            <span className="campo-label">Concepto</span>
            <input
              className="campo-input"
              placeholder="Ej. Súper semanal"
              maxLength={200}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
        </div>

        {/*
          El reparto por categoría. Un ticket con despensa, farmacia y ropa es
          un solo movimiento —el saldo bajó una vez—, con varias categorías.
        */}
        {pide('reparto') && (
          <fieldset className="campo campo-fieldset">
            <legend className="campo-label">Reparto por categoría</legend>
            <label className="campo-casilla">
              <input
                type="checkbox"
                checked={dividida}
                onChange={(e) => setDividida(e.target.checked)}
              />
              <span>Dividir en varias categorías</span>
            </label>
            {dividida && (
              <>
                {renglones.map((r, i) => (
                  <div className="renglon" key={i}>
                    <select
                      className="campo-input"
                      value={r.categoryId}
                      onChange={(e) => setRenglon(i, { categoryId: Number(e.target.value) })}
                      aria-label={`Categoría del renglón ${i + 1}`}
                    >
                      <option value={0}>Sin categoría</option>
                      {options.map((c) => (
                        <option key={c.id} value={c.id}>{rotuloCategoria(c)}</option>
                      ))}
                    </select>
                    <div className="monto-wrap">
                      <span className="monto-signo" aria-hidden="true">$</span>
                      <input
                        className="campo-input"
                        inputMode="decimal"
                        placeholder="0.00"
                        value={r.amount}
                        onChange={(e) => setRenglon(i, { amount: e.target.value })}
                        aria-label={`Monto del renglón ${i + 1}`}
                      />
                    </div>
                    <input
                      className="campo-input"
                      placeholder="Detalle (opcional)"
                      maxLength={120}
                      value={r.note}
                      onChange={(e) => setRenglon(i, { note: e.target.value })}
                      aria-label={`Detalle del renglón ${i + 1}`}
                    />
                    <button
                      type="button"
                      className="accion"
                      aria-label={`Quitar renglón ${i + 1}`}
                      disabled={renglones.length <= 2}
                      onClick={() => setRenglones((prev) => prev.filter((_, j) => j !== i))}
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <div className="renglon-pie">
                  <button
                    type="button"
                    className="btn-liga"
                    onClick={() => setRenglones((prev) => [...prev, { ...RENGLON_VACIO }])}
                  >
                    ＋ Otro renglón
                  </button>
                  {/*
                    Lo que falta por repartir, siempre a la vista: el servidor
                    exige que los renglones sumen exactamente el movimiento, y
                    descubrirlo al guardar sería descubrirlo tarde.
                  */}
                  <span className={`renglon-resta${restante === 0 ? ' cuadra' : ''}`}>
                    {restante === 0 ? (
                      'Cuadra'
                    ) : (
                      <>
                        {restante > 0 ? 'Falta por repartir ' : 'Te pasaste por '}
                        <Money cents={Math.abs(restante)} />
                      </>
                    )}
                  </span>
                </div>
              </>
            )}
          </fieldset>
        )}

        {/*
          La devolución. Ligarla al gasto original es lo que evita que una
          camisa devuelta cuente como ingreso e infle la tasa de ahorro.
        */}
        {pide('devolucion') && (
          <label className="campo">
            <span className="campo-label">¿Devuelve un gasto?</span>
            <select
              className="campo-input"
              value={refundOfId}
              onChange={(e) => setRefundOfId(Number(e.target.value))}
            >
              <option value={0}>No, es un ingreso normal</option>
              {gastosRecientes.map((g) => (
                <option key={g.id} value={g.id}>
                  {fmtDate(g.date)} · {g.note || g.categoryName || 'Sin concepto'} · $
                  {(g.amountCents / 100).toFixed(2)}
                </option>
              ))}
            </select>
            {refundOfId > 0 && (
              <p className="campo-nota">
                No cuenta como ingreso del mes: baja el gasto de esa partida y su categoría.
              </p>
            )}
          </label>
        )}

        {pide('negocio') && (
          <>
            <div className="campos-2">
              <label className="campo">
                <span className="campo-label">Contraparte</span>
                <select
                  className="campo-input"
                  value={counterpartyId}
                  onChange={(e) => setCounterpartyId(Number(e.target.value))}
                >
                  <option value={0}>Sin contraparte</option>
                  {contrapartes.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </label>
              <label className="campo">
                <span className="campo-label">{profile.dimensionLabel}</span>
                <select
                  className="campo-input"
                  value={costCenterId}
                  onChange={(e) => setCostCenterId(Number(e.target.value))}
                >
                  <option value={0}>Sin asignar</option>
                  {centros.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="campos-2">
              <label className="campo">
                <span className="campo-label">Impuesto incluido</span>
                <div className="monto-wrap">
                  <span className="monto-signo" aria-hidden="true">$</span>
                  <input
                    className="campo-input"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={tax}
                    onChange={(e) => setTax(e.target.value)}
                  />
                </div>
              </label>
              {type === 'gasto' && (
                <label className="campo campo-casilla">
                  <input
                    type="checkbox"
                    checked={deductible}
                    onChange={(e) => setDeductible(e.target.checked)}
                  />
                  <span>Deducible</span>
                </label>
              )}
            </div>
          </>
        )}

        {/* Un movimiento de un inmueble rentado. Se pregunta solo si hay
            contratos: sin ellos son dos selects vacíos en cada partida. Esa
            regla vive en `shared/campos.ts`, con todas las demás. */}
        {pide('inmueble') && (
          <>
            <div className="campos-2">
              <label className="campo">
                <span className="campo-label">De qué inmueble</span>
                <select
                  className="campo-input"
                  value={rentalId}
                  onChange={(e) => setRentalId(Number(e.target.value))}
                >
                  <option value={0}>No es de un inmueble</option>
                  {arrendamientos.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.assetName}{r.tenant && ` · ${r.tenant}`}
                    </option>
                  ))}
                </select>
              </label>
              {rentalId > 0 && (
                <label className="campo">
                  <span className="campo-label">Qué es</span>
                  <select
                    className="campo-input"
                    value={rentalRole}
                    onChange={(e) => setRentalRole(e.target.value)}
                  >
                    <option value="">Elige…</option>
                    <option value="renta">La renta del mes</option>
                    <option value="deposito">El depósito</option>
                    <option value="devolucion_deposito">Devolución del depósito</option>
                    <option value="mantenimiento">Mantenimiento</option>
                  </select>
                </label>
              )}
            </div>
            {(rentalRole === 'deposito' || rentalRole === 'devolucion_deposito') && (
              <p className="forma-nota">
                El depósito <strong>no es tuyo</strong>: entra a tu cuenta y sube tu saldo, pero
                Finply lo deja fuera de tu ingreso del mes y del rendimiento del inmueble, porque
                lo tienes que devolver.
              </p>
            )}
          </>
        )}

        {/*
          Los campos propios de este libro (D24, Fase 21). Van juntos y con su
          nombre, porque son suyos: Finply no sabe qué significan y por eso
          tampoco los suma en ningún lado.
        */}
        {pide('propios') && (
          <fieldset className="campo campo-fieldset">
            <legend className="campo-label">Datos de este libro</legend>
            <div className="campos-2">
              {propios.map((c) => (
                <label className="campo" key={c.id}>
                  <span className="campo-label">{c.label}</span>
                  <CampoPropioInput
                    campo={c}
                    valor={valores[String(c.id)] ?? ''}
                    onChange={(v) => setValores((prev) => ({ ...prev, [String(c.id)]: v }))}
                  />
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <fieldset className="campo campo-fieldset">
          <legend className="campo-label">Etiquetas</legend>
          {tags.length > 0 && (
            <div className="etiquetas-picker">
              {tags.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={tagIds.includes(t.id)}
                  className={`chip chip-etiqueta chip-boton${tagIds.includes(t.id) ? ' activa' : ''}`}
                  onClick={() => toggleTag(t.id)}
                >
                  {t.name}
                </button>
              ))}
            </div>
          )}
          <div className="campo-inline">
            <input
              className="campo-input"
              placeholder="Nueva etiqueta…"
              maxLength={30}
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void addTag()
                }
              }}
              aria-label="Nueva etiqueta"
            />
            <button type="button" className="btn-liga" onClick={() => void addTag()} disabled={!newTag.trim()}>
              Agregar
            </button>
          </div>
        </fieldset>

        {/* El recibo. Exige que el movimiento exista: sin id no hay dónde
            colgarlo, y eso es lo que dice `existe` en `shared/campos.ts`. El
            `tx &&` de al lado es para el compilador, que no puede saberlo. */}
        {pide('recibo') && tx && (
          <fieldset className="campo campo-fieldset">
            <legend className="campo-label">Recibo</legend>
            {adjuntos.length > 0 && (
              <ul className="adjuntos">
                {adjuntos.map((a) => (
                  <li key={a.id} className="adjunto">
                    <a href={api.tx.adjuntoUrl(tx.id, a.id)} download={a.filename}>
                      {a.filename}
                    </a>
                    <span className="adjunto-peso">{Math.round(a.sizeBytes / 1024)} KB</span>
                    <button
                      type="button"
                      className="accion"
                      aria-label={`Quitar ${a.filename}`}
                      onClick={() => void quitarAdjunto(a)}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <input
              ref={archivoRef}
              type="file"
              className="campo-input"
              accept="image/png,image/jpeg,image/webp,image/heic,application/pdf"
              disabled={subiendo}
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void adjuntar(file)
              }}
              aria-label="Adjuntar recibo"
            />
            <p className="campo-nota">
              Foto o PDF, hasta 2 MB. Se guarda dentro de tu libro y viaja en el respaldo.
            </p>
          </fieldset>
        )}

        {error && <p className="forma-error" role="alert">{error}</p>}

        <footer className="forma-pie">
          <button type="button" className="btn btn-fantasma" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primario" disabled={saving}>
            {saving ? 'Guardando…' : tx ? 'Guardar cambios' : 'Guardar movimiento'}
          </button>
        </footer>
      </form>
    </Modal>
  )
}

/**
 * El control de un campo propio. El tipo elegido en Ajustes decide qué se
 * dibuja: es lo único que separa un campo de "texto libre con etiqueta".
 *
 * Una lista sin opciones cae a texto en vez de dejar un select vacío — quien
 * la creó todavía no las escribió, y un control con el que no se puede hacer
 * nada es peor que uno sencillo.
 */
function CampoPropioInput({
  campo,
  valor,
  onChange,
}: {
  campo: CampoPropio
  valor: string
  onChange: (v: string) => void
}) {
  const opciones = campo.kind === 'lista'
    ? campo.options.split('\n').map((o) => o.trim()).filter(Boolean)
    : []

  if (campo.kind === 'casilla') {
    return (
      <span className="campo-casilla campo-casilla-suelta">
        <input
          type="checkbox"
          checked={valor === 'si'}
          onChange={(e) => onChange(e.target.checked ? 'si' : '')}
        />
        <span>Sí</span>
      </span>
    )
  }
  if (campo.kind === 'lista' && opciones.length > 0) {
    return (
      <select className="campo-input" value={valor} onChange={(e) => onChange(e.target.value)}>
        <option value="">Sin elegir</option>
        {opciones.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    )
  }
  return (
    <input
      className="campo-input"
      type={campo.kind === 'fecha' ? 'date' : 'text'}
      inputMode={campo.kind === 'numero' ? 'decimal' : undefined}
      maxLength={200}
      value={valor}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}
