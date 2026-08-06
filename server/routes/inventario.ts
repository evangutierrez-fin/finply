import { Router } from 'express'
import {
  actualizarProducto,
  almacen,
  borrarMovimiento,
  borrarProducto,
  crearProducto,
  mesDe,
  movimientosDe,
  registrarMovimiento,
} from '../inventario.ts'
import { giroQuery, movimientoStockInput, periodoQuery, productoInput } from '../validators.ts'

const router = Router()

/**
 * El almacén entero. La ventana solo afecta al **costo de ventas**: la
 * existencia y el valor miran todo el historial, porque lo que tienes hoy es
 * lo que entró menos lo que salió desde siempre.
 */
router.get('/', (req, res) => {
  const q = giroQuery.parse(req.query)
  const mes = mesDe(q.hoy)
  const ventana = periodoQuery.safeParse(req.query)
  res.json(
    almacen(
      q.profileId,
      ventana.success ? ventana.data.desde : mes.desde,
      ventana.success ? ventana.data.hasta : mes.hasta,
    ),
  )
})

router.get('/:id/movimientos', (req, res) => {
  const { profileId } = giroQuery.parse(req.query)
  res.json(movimientosDe(profileId, Number(req.params.id)))
})

router.post('/', (req, res) => {
  res.status(201).json(crearProducto(productoInput.parse(req.body)))
})

router.patch('/:id', (req, res) => {
  const input = productoInput.parse(req.body)
  res.json(actualizarProducto(input.profileId, Number(req.params.id), input))
})

router.delete('/:id', (req, res) => {
  const { profileId } = giroQuery.parse(req.query)
  borrarProducto(profileId, Number(req.params.id))
  res.json({ ok: true })
})

/** Una entrada, una salida o un ajuste. **No** asienta dinero (R4). */
router.post('/movimientos', (req, res) => {
  res.status(201).json(registrarMovimiento(movimientoStockInput.parse(req.body)))
})

router.delete('/movimientos/:id', (req, res) => {
  const { profileId } = giroQuery.parse(req.query)
  borrarMovimiento(profileId, Number(req.params.id))
  res.json({ ok: true })
})

export default router
