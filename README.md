# Finply

**Tu libro de finanzas. Manual, local y tuyo.**

> Hecho en México 🇲🇽 y pensado para acá: todo en español, pesos por defecto,
> categorías como Súper, Nómina o Renta, e inversiones tipo CETES. Funciona
> igual en cualquier país cambiando la moneda de la cuenta.

Finply es un dashboard open source (MIT) de finanzas personales y de negocio con
registro 100 % manual — porque apuntar cada peso a mano es lo que te hace
consciente de a dónde se va. El diseño está inspirado en los libros mayores de
contabilidad: papel verde contable, doble filete rojo de margen, columnas de
cargo y abono, totales con doble subrayado y un sello de **REGISTRADO** cada
vez que asientas una partida. De noche, el modo oscuro "lámpara de banquero"
mantiene el mismo libro bajo otra luz.

Tus datos nunca salen de tu máquina: todo vive en un archivo SQLite local.

## Características

- **Perfiles ilimitados** — cada perfil es un libro independiente con sus
  propias cuentas, categorías, movimientos, deudas, inversiones, metas y notas.
  Ideal para separar tus finanzas personales de las de tu negocio. Cada perfil
  elige su tinta (verde banca, latón, cobalto o vino).
- **Cuentas múltiples** — efectivo, banco, tarjeta, ahorro… con saldo inicial,
  saldo calculado y archivado (nunca pierdes historia).
- **Movimientos manuales** — gastos, ingresos y transferencias entre cuentas,
  con categorías, búsqueda, filtros por mes/cuenta/tipo y corrección o
  anulación de partidas. Sumas del periodo al pie, como en el libro real.
- **Deudas y retornos** — apunta lo que te deben y lo que debes, registra
  abonos (opcionalmente ligados a una cuenta: el movimiento se asienta solo),
  y la deuda se salda automáticamente al completarse.
- **Inversiones** — CETES, fondos, acciones, cripto o lo que sea: registra
  aportes y retiros (ligables a una cuenta) y valúa cuando quieras. Finply
  calcula el rendimiento y dibuja la evolución del valor.
- **Presupuestos** — un tope mensual por categoría de gasto, con barra de
  avance, alerta al 80 % y estado de excedido con la cifra exacta.
- **Metas** — fondos de emergencia, viajes, enganches. Aporta cuando puedas;
  la meta se marca cumplida sola.
- **Notas** — apuntes con renglones de libreta y margen rojo, fijables al
  tablero, por perfil.
- **Modo claro / oscuro / auto** — el tema oscuro es una superficie propia
  ("lámpara de banquero"), no una inversión automática de colores.
- **Diseño accesible** — pares de colores de gráfica validados para daltonismo
  en ambos temas (con textura como codificación secundaria), foco visible por
  teclado y respeto a `prefers-reduced-motion`.

## Stack

| Capa | Tecnología |
|---|---|
| Frontend | React 19 + Vite 7 + TypeScript |
| Backend | Express 5 |
| Base de datos | SQLite nativo de Node (`node:sqlite`) — cero dependencias nativas |
| Validación | Zod |
| Tipografía | Besley · Instrument Sans · Spline Sans Mono (autohospedadas) |

El dinero se guarda como **centavos enteros** (nunca flotantes). El servidor
corre TypeScript directamente con el *type stripping* de Node ≥ 23.6 — no hay
paso de transpilación para el backend.

## Arranque

Requiere Node 23.6 o superior.

```bash
npm install
npm run seed   # datos de ejemplo (2 perfiles, movimientos, inversiones, metas…)
npm run dev    # API en :4321 + frontend en :5173
```

Abre http://localhost:5173.

| Comando | Qué hace |
|---|---|
| `npm run dev` | API + frontend en modo desarrollo |
| `npm run seed` | Llena el libro con datos demo (borra lo anterior) |
| `npm run reset` | Borra todo y deja un perfil vacío |
| `npm run build` | Verifica tipos y compila el frontend a `dist/` |
| `npm start` | Producción: un solo servidor sirve API + frontend en :4321 |

## Estructura

```
server/          Express + node:sqlite
  db.ts          esquema, migraciones ligeras, transacciones y helpers
  validators.ts  esquemas Zod (errores en español)
  routes/        profiles · accounts · categories · transactions · debts
                 · investments · budgets · goals · notes · summary
  seed.ts        datos demo deterministas
shared/types.ts  tipos compartidos cliente/servidor
src/
  views/         Resumen · Movimientos · Cuentas · Deudas · Inversiones
                 · Presupuestos · Metas · Notas
  components/    formularios, gráficas, sello, barra lateral
  styles/        tokens.css (temas claro/oscuro) + app.css
data/finply.db   tu libro (gitignored — nunca se versiona)
```

## API

REST sobre `/api`. Todas las cantidades en centavos enteros.

| Método y ruta | Descripción |
|---|---|
| `GET/POST /api/profiles` · `PATCH/DELETE /:id` | Perfiles (libros) |
| `GET/POST /api/accounts` · `PATCH/DELETE /:id` | Cuentas con saldo calculado |
| `GET/POST /api/categories` | Categorías por perfil y tipo |
| `GET/POST /api/transactions` · `PATCH/DELETE /:id` | Movimientos (filtros: mes, cuenta, tipo, búsqueda) |
| `GET/POST /api/debts` · `PATCH/DELETE /:id` | Deudas por cobrar / por pagar |
| `POST /api/debts/:id/payments` · `DELETE /api/debts/payments/:id` | Abonos (con movimiento ligado opcional) |
| `GET/POST /api/investments` · `PATCH/DELETE /:id` | Inversiones con rendimiento calculado |
| `POST /api/investments/:id/entries` · `DELETE /api/investments/entries/:id` | Aportes, retiros y valuaciones |
| `GET/POST /api/budgets` · `DELETE /:id` | Presupuestos por categoría (upsert) con gastado del mes |
| `GET/POST /api/goals` · `PATCH/DELETE /:id` | Metas de ahorro |
| `POST /api/goals/:id/entries` · `DELETE /api/goals/entries/:id` | Aportes a metas |
| `GET/POST /api/notes` · `PATCH/DELETE /:id` | Notas (con fijado) |
| `GET /api/summary?profileId&month` | Resumen del mes + patrimonio en una llamada |

Reglas de integridad que cuida el backend: una cuenta con movimientos solo se
archiva (no se borra); anular un movimiento ligado a un abono de deuda o a un
aporte de inversión anula también ese registro (y viceversa); editar uno de
esos movimientos sincroniza monto y fecha con su abono o aporte, y su tipo no
puede cambiar. El libro siempre cuadra.

## Sistema de diseño

| Token | Claro | Oscuro | Uso |
|---|---|---|---|
| `--papel` | `#EEF1E4` | `#10160F` | fondo |
| `--hoja` | `#F7F8EE` | `#1A221A` | tarjetas |
| `--tinta` | `#1E2A21` | `#E9EBD9` | texto |
| `--verde` | `#1D5C3D` | `#5AA87E` | acento por defecto |
| `--rojo` | `#B23A2A` | `#D66653` | filete de margen y números rojos |
| `--viz-entrada` / `--viz-salida` | `#3D8F63` / `#B23A2A` | `#35835A` / `#C14B37` | gráficas (pares validados CVD) |

Display: **Besley** (una Clarendon, la letra de la banca del XIX) · UI:
**Instrument Sans** · Cifras: **Spline Sans Mono** con números tabulares.

## Hoja de ruta

- Exportar movimientos a CSV
- Recurrencias (renta, suscripciones) con recordatorio
- Adjuntar recibos a los movimientos
- Multimoneda con tipo de cambio manual

Las contribuciones son bienvenidas: abre un issue o un PR.

## Licencia

[MIT](LICENSE) — úsalo, estúdialo, mejóralo y compártelo.
