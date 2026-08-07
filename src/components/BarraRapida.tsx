import { useEffect, useRef, useState } from 'react'
import type { Account, Category, PlantillaTx, SugerenciaTx, TxType } from '../../shared/types.ts'
import { camposQueFaltan } from '../../shared/campos.ts'
import { rotuloCategoria } from '../../shared/taxonomia.ts'
import { api } from '../api.ts'
import { useApp } from '../context.ts'
import { useAtajos } from '../atajos.ts'
import { fmtDate, fmtMoney, mensajeMonto, parseAmount, todayISO } from '../format.ts'

/**
 * Registrar en una línea.
 *
 * El registro manual es el valor de Finply (R4), y por eso mismo el costo de
 * cada partida importa: si apuntar un café cuesta abrir un modal, elegir tipo,
 * cuenta, categoría y fecha, el libro se abandona a las tres semanas. Aquí
 * está lo que de verdad cambia entre una partida y la siguiente —cuánto y de
 * qué— y lo demás viene propuesto de la última vez.
 *
 * ⚠ Esto **no automatiza nada**. No hay un movimiento que nazca solo, ni un
 * atajo que asiente sin pasar por aquí: lo que se acorta es el camino hasta la
 * confirmación, nunca la confirmación. Y todo lo que se va a guardar está a la
 * vista —cuenta, fecha y categoría incluidas—, porque una barra que adivinara
 * la cuenta en silencio sería peor que el modal.
 */
export function BarraRapida() {
  const { profile, refreshKey, bump, stamp, openTx } = useApp()
  const [type, setType] = useState<TxType>('gasto')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [accountId, setAccountId] = useState(0)
  const [categoryId, setCategoryId] = useState(0)
  const [date, setDate] = useState(todayISO())
  const [accounts, setAccounts] = useState<Account[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [sugerencia, setSugerencia] = useState<SugerenciaTx | null>(null)
  // Las plantillas del perfil (Fase 21): el formulario ya llenado, esperando.
  const [plantillas, setPlantillas] = useState<PlantillaTx[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const montoRef = useRef<HTMLInputElement>(null)
  // El guardia contra el doble clic va en un ref y no en el estado: los dos
  // clics ocurren antes de que React repinte. Ya se aprendió en la Fase 5.
  const enVuelo = useRef(false)

  useEffect(() => {
    Promise.all([
      api.accounts.list(profile.id),
      api.categories.list(profile.id),
      api.tx.sugerencia(profile.id),
      api.personalizacion.plantillas.list(profile.id),
    ]).then(
      ([accs, cats, sug, plt]) => {
        setAccounts(accs.filter((a) => !a.archived))
        setCategories(cats)
        setSugerencia(sug)
        setPlantillas(plt)
      },
      (err: Error) => setError(err.message),
    )
  }, [profile.id, refreshKey])

  // Lo último usado **de ese tipo**: la cuenta del sueldo no es la del súper.
  // Solo se propone mientras el usuario no haya elegido otra cosa a mano, y
  // por eso depende del tipo y de la sugerencia, no de cada tecleo.
  useEffect(() => {
    if (!sugerencia) return
    const previo = sugerencia.porTipo[type]
    setAccountId(previo?.accountId ?? 0)
    setCategoryId(previo?.categoryId ?? 0)
  }, [sugerencia, type])

  const ultima = sugerencia?.ultima ?? null

  /**
   * Traer la última partida a la barra. **Llena, no guarda**: el usuario ve lo
   * que va a registrar y confirma. Es la diferencia entre repetir una partida
   * y que Finply escriba en tu libro por su cuenta.
   */
  const traerUltima = () => {
    if (!ultima) return
    setType(ultima.type)
    setAmount((ultima.amountCents / 100).toFixed(2))
    setNote(ultima.note)
    setAccountId(ultima.accountId)
    setCategoryId(ultima.categoryId ?? 0)
    setDate(todayISO())
    montoRef.current?.focus()
  }

  /**
   * Traer una plantilla a la barra. Igual que repetir: **llena, no guarda**.
   *
   * Lo que la plantilla no diga se queda como está —una plantilla sin cuenta
   * conserva la que ya venía propuesta— y el monto vacío es una elección suya:
   * "lo pongo yo cada vez". Ese es el caso de la gasolina.
   */
  const traerPlantilla = (p: PlantillaTx) => {
    if (p.type === 'transferencia') {
      // La barra no registra transferencias: son dos cuentas y una regla de D6
      // que no cabe en una línea. Se abre el formulario completo con lo suyo.
      openTx(null, {
        type: 'transferencia',
        accountId: p.accountId ?? undefined,
        transferAccountId: p.transferAccountId ?? undefined,
        amountCents: p.amountCents ?? undefined,
        note: p.note,
      })
      return
    }
    setType(p.type)
    setAmount(p.amountCents === null ? '' : (p.amountCents / 100).toFixed(2))
    setNote(p.note)
    if (p.accountId) setAccountId(p.accountId)
    if (p.categoryId) setCategoryId(p.categoryId)
    setDate(todayISO())
    montoRef.current?.focus()
  }

  // Los dos atajos de la barra los registra la barra: `b` y `r` solo
  // significan algo donde hay una barra que enfocar.
  useAtajos({ barra: () => montoRef.current?.focus(), repetir: traerUltima })

  const kind = type === 'ingreso' ? 'ingreso' : 'gasto'
  // Las archivadas no entran: la barra siempre registra algo nuevo, y una
  // categoría archivada es una que ya no se usa.
  const opciones = categories.filter((c) => c.kind === kind && !c.fueraDelSelector)
  const faltan = camposQueFaltan({ modules: profile.modules, type })

  /** Lo que hay escrito, para poder pasarlo al formulario completo. */
  const borrador = () => ({
    type,
    amountCents: parseAmount(amount) ?? undefined,
    accountId: accountId || undefined,
    categoryId: categoryId || null,
    date,
    note,
  })

  const registrar = async (e: React.FormEvent) => {
    e.preventDefault()
    const cents = parseAmount(amount)
    if (!cents) return setError(mensajeMonto(amount, 'Escribe un monto, por ejemplo 250 o 1,250.50'))
    if (!accountId) return setError('Elige de qué cuenta salió')
    if (enVuelo.current) return
    enVuelo.current = true
    setSaving(true)
    setError(null)
    try {
      await api.tx.create({
        profileId: profile.id,
        accountId,
        type,
        amountCents: cents,
        date,
        categoryId: categoryId || null,
        note,
        transferAccountId: null,
        tagIds: [],
        counterpartyId: null,
        costCenterId: null,
        taxCents: 0,
        deductible: false,
        splits: [],
        refundOfId: null,
        rentalId: null,
        rentalRole: null,
      })
      stamp('Registrado')
      // Monto y concepto se limpian; cuenta, categoría y fecha se quedan. Quien
      // captura los tickets del sábado no vuelve a elegir "Efectivo" seis veces.
      setAmount('')
      setNote('')
      bump()
      montoRef.current?.focus()
    } catch (err) {
      setError((err as Error).message)
    }
    enVuelo.current = false
    setSaving(false)
  }

  return (
    <section className="barra-rapida" aria-label="Registro rápido">
      <form className="barra-rapida-forma" onSubmit={registrar}>
        <div className="seg seg-chico barra-rapida-tipo" role="radiogroup" aria-label="Tipo">
          {(['gasto', 'ingreso'] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={type === t}
              className={`seg-item seg-${t}${type === t ? ' activa' : ''}`}
              onClick={() => setType(t)}
            >
              {t === 'gasto' ? 'Gasto' : 'Ingreso'}
            </button>
          ))}
        </div>

        <div className="monto-wrap barra-rapida-monto">
          <span className="monto-signo" aria-hidden="true">$</span>
          <input
            ref={montoRef}
            className="campo-input monto"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-label="Monto"
          />
        </div>

        <input
          className="campo-input barra-rapida-concepto"
          placeholder="Concepto (ej. Súper semanal)"
          maxLength={200}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          aria-label="Concepto"
        />

        <select
          className="campo-input barra-rapida-select"
          value={categoryId}
          onChange={(e) => setCategoryId(Number(e.target.value))}
          aria-label="Categoría"
        >
          <option value={0}>Sin categoría</option>
          {opciones.map((c) => (
            <option key={c.id} value={c.id}>{rotuloCategoria(c)}</option>
          ))}
        </select>

        <select
          className="campo-input barra-rapida-select"
          value={accountId}
          onChange={(e) => setAccountId(Number(e.target.value))}
          aria-label="Cuenta"
        >
          <option value={0} disabled>Cuenta…</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>

        <input
          type="date"
          className="campo-input barra-rapida-fecha"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          aria-label="Fecha"
        />

        <button type="submit" className="btn btn-primario btn-chico" disabled={saving}>
          {saving ? 'Guardando…' : 'Registrar'}
        </button>
      </form>

      {plantillas.length > 0 && (
        <div className="barra-rapida-plantillas">
          {plantillas.map((p) => (
            <button
              key={p.id}
              type="button"
              className="chip chip-plantilla"
              onClick={() => traerPlantilla(p)}
              title={
                p.amountCents === null
                  ? `${p.name}: el monto lo pones tú`
                  : `${p.name}: ${fmtMoney(p.amountCents)}`
              }
            >
              {p.name}
            </button>
          ))}
        </div>
      )}

      <div className="barra-rapida-pie">
        {ultima ? (
          <button type="button" className="btn-liga" onClick={traerUltima}>
            ↺ Repetir la última · {fmtDate(ultima.date)} ·{' '}
            {ultima.note || ultima.categoryName || 'Sin concepto'} ·{' '}
            {fmtMoney(ultima.amountCents)}
          </button>
        ) : (
          <span className="barra-rapida-nota">
            Escribe el monto y dale Enter. Con <kbd>b</kbd> vuelves aquí desde cualquier lado.
          </span>
        )}
        <button type="button" className="btn-liga" onClick={() => openTx(null, borrador())}>
          Más campos →
        </button>
      </div>

      {/*
        Lo que la barra no pregunta y este libro sí usa. Se dice en vez de
        guardar en silencio un movimiento de negocio sin contraparte: la barra
        acorta el camino, no cambia lo que un movimiento completo lleva.
      */}
      {faltan.length > 0 && (
        <p className="barra-rapida-nota">
          Este libro también apunta{' '}
          {faltan.includes('negocio') && 'contraparte, impuesto y centro'}
          {faltan.length === 2 && ', y '}
          {faltan.includes('inmueble') && 'de qué inmueble es'}. Aquí se quedan vacíos —usa
          «Más campos» cuando toque.
        </p>
      )}

      {error && <p className="forma-error" role="alert">{error}</p>}
    </section>
  )
}
