import { useState } from 'react'
import { api } from '../api.ts'
import { useApp } from '../context.ts'
import { useFetch } from '../hooks.ts'
import { Money } from '../components/Money.tsx'
import { Modal } from '../components/Modal.tsx'
import type { Contraparte, RolContraparte } from '../../shared/types.ts'

const ROL_LABEL: Record<RolContraparte, string> = {
  cliente: 'Cliente',
  proveedor: 'Proveedor',
  ambos: 'Cliente y proveedor',
}

function ContraparteModal({
  contraparte,
  onClose,
  onSaved,
}: {
  contraparte: Contraparte | null
  onClose: () => void
  onSaved: () => void
}) {
  const { profile, stamp } = useApp()
  const [name, setName] = useState(contraparte?.name ?? '')
  const [role, setRole] = useState<RolContraparte>(contraparte?.role ?? 'ambos')
  const [taxId, setTaxId] = useState(contraparte?.taxId ?? '')
  const [note, setNote] = useState(contraparte?.note ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return setError('Necesita un nombre')
    setSaving(true)
    setError(null)
    try {
      const datos = { name: name.trim(), role, taxId: taxId.trim(), note: note.trim() }
      if (contraparte) await api.contrapartes.update(contraparte.id, datos)
      else await api.contrapartes.create({ profileId: profile.id, ...datos })
      stamp(contraparte ? 'Actualizada' : 'Agregada')
      onSaved()
      onClose()
    } catch (err) {
      setError((err as Error).message)
      setSaving(false)
    }
  }

  return (
    <Modal title={contraparte ? 'Editar contraparte' : 'Nueva contraparte'} onClose={onClose}>
      <form className="forma" onSubmit={submit}>
        <label className="campo">
          <span className="campo-label">Nombre</span>
          <input
            className="campo-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ej. Panadería del Centro"
            autoFocus
          />
        </label>
        <div className="campos-2">
          <label className="campo">
            <span className="campo-label">Qué es tuyo</span>
            <select
              className="campo-input"
              value={role}
              onChange={(e) => setRole(e.target.value as RolContraparte)}
            >
              {(Object.keys(ROL_LABEL) as RolContraparte[]).map((r) => (
                <option key={r} value={r}>{ROL_LABEL[r]}</option>
              ))}
            </select>
          </label>
          <label className="campo">
            <span className="campo-label">Identificador fiscal</span>
            <input
              className="campo-input"
              value={taxId}
              onChange={(e) => setTaxId(e.target.value)}
              placeholder="Opcional"
            />
          </label>
        </div>
        <p className="forma-nota">
          Ese campo es libre a propósito: aquí cabe un RFC, un CUIT, un VAT o nada. Finply no valida
          el formato de ningún país porque no sabe en cuál estás.
        </p>
        <label className="campo">
          <span className="campo-label">Nota</span>
          <input className="campo-input" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {error && <p className="forma-error" role="alert">{error}</p>}
        <footer className="forma-pie">
          <button type="button" className="btn btn-fantasma" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn-primario" disabled={saving}>
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </footer>
      </form>
    </Modal>
  )
}

export function Contrapartes() {
  const { profile, refreshKey, bump, stamp } = useApp()
  const [creando, setCreando] = useState(false)
  const [editando, setEditando] = useState<Contraparte | null>(null)
  const [verArchivadas, setVerArchivadas] = useState(false)
  const { data, error } = useFetch(
    () => api.contrapartes.list(profile.id),
    [profile.id, refreshKey],
  )

  const todas = data ?? []
  const lista = verArchivadas ? todas : todas.filter((c) => !c.archived)

  const borrar = async (c: Contraparte) => {
    try {
      await api.contrapartes.remove(c.id)
      stamp('Borrada')
      bump()
    } catch (err) {
      alert((err as Error).message)
    }
  }

  const archivar = async (c: Contraparte) => {
    await api.contrapartes.update(c.id, { archived: !c.archived })
    stamp(c.archived ? 'Recuperada' : 'Archivada')
    bump()
  }

  return (
    <div className="vista">
      <header className="vista-head">
        <h1>Contrapartes</h1>
        <button type="button" className="btn btn-primario" onClick={() => setCreando(true)}>
          ＋ Nueva contraparte
        </button>
      </header>

      {error && <p className="aviso" role="alert">{error}</p>}

      {data && todas.length === 0 ? (
        <div className="vacio">
          <p className="vacio-titulo">Todavía nadie.</p>
          <p className="vacio-sub">
            Un cliente o un proveedor se apunta una vez y se reutiliza en cada factura y cada
            movimiento. Es lo que permite después preguntar quién te debe y desde cuándo.
          </p>
          <button type="button" className="btn btn-primario" onClick={() => setCreando(true)}>
            Agregar la primera
          </button>
        </div>
      ) : (
        <section className="hoja">
          <table className="tabla">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Papel</th>
                <th className="col-num">Te deben</th>
                <th className="col-num">Le debes</th>
                <th className="col-num">Facturas</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lista.map((c) => (
                <tr key={c.id} className={c.archived ? 'fila-archivada' : ''}>
                  <td>
                    <strong>{c.name}</strong>
                    {c.taxId && <span className="cifra-chica"> · {c.taxId}</span>}
                    {c.note && <div className="tabla-sub">{c.note}</div>}
                  </td>
                  <td>{ROL_LABEL[c.role]}</td>
                  <td className="col-num">
                    {c.porCobrarCents > 0 ? <Money cents={c.porCobrarCents} className="cifra-chica" /> : '—'}
                  </td>
                  <td className="col-num">
                    {c.porPagarCents > 0 ? <Money cents={c.porPagarCents} className="cifra-chica" /> : '—'}
                  </td>
                  <td className="col-num cifra-chica">{c.invoiceCount}</td>
                  <td className="col-acciones">
                    <button type="button" className="btn-liga" onClick={() => setEditando(c)}>Editar</button>
                    <button type="button" className="btn-liga" onClick={() => archivar(c)}>
                      {c.archived ? 'Recuperar' : 'Archivar'}
                    </button>
                    {c.invoiceCount === 0 && (
                      <button type="button" className="btn-liga btn-liga-rojo" onClick={() => borrar(c)}>
                        Borrar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {todas.some((c) => c.archived) && (
            <button type="button" className="btn-liga" onClick={() => setVerArchivadas((v) => !v)}>
              {verArchivadas ? 'Ocultar archivadas' : 'Ver archivadas'}
            </button>
          )}
        </section>
      )}

      {creando && <ContraparteModal contraparte={null} onClose={() => setCreando(false)} onSaved={bump} />}
      {editando && (
        <ContraparteModal contraparte={editando} onClose={() => setEditando(null)} onSaved={bump} />
      )}
    </div>
  )
}
