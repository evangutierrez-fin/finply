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
  con categorías, etiquetas, búsqueda y filtros por mes, rango de fechas,
  cuenta, tipo, etiqueta y rango de montos. Corrección o anulación de partidas,
  paginación y sumas del periodo al pie, como en el libro real.
- **Categorías y etiquetas** — renombra o borra categorías reasignando sus
  movimientos (ningún monto cambia nunca al reclasificar). Las etiquetas cruzan
  categorías: un mismo viaje lleva comida, transporte y hospedaje.
- **Exportar a CSV** — el filtro completo que tengas en pantalla, con BOM para
  que Excel respete los acentos y sin dejar pasar celdas ejecutables.
- **Importar CSV** — el archivo de tu banco, con detección del separador y de
  las columnas. Primero ves una vista previa fila por fila —con la fecha y el
  monto ya interpretados, que es donde se esconden los errores— y solo entonces
  se escribe, en una sola transacción y atado a un lote que puedes deshacer
  completo. Los duplicados se detectan y se omiten por omisión.
- **Deudas y retornos** — apunta lo que te deben y lo que debes. Al apuntarla
  puedes elegir la cuenta por la que **entró o salió el dinero** y Finply
  asienta ese movimiento, para que el saldo no se quede corto por el monto del
  préstamo; si el dinero nunca pasó por tus cuentas, «solo apuntar» deja la
  deuda como pura obligación. Los abonos funcionan igual, y la deuda se salda
  automáticamente al completarse. Con tasa anual y plazo,
  Finply arma la **tabla de amortización**: cuánto de cada mensualidad es
  interés y cuánto capital, cuadrada al centavo contra el monto original.
- **Saldo insoluto de verdad** — en una deuda con tasa, cada abono se divide en
  interés y capital, y **solo el capital baja lo que debes**. Finply propone el
  interés devengado por los días transcurridos y tú lo corriges con la cifra de
  tu estado de cuenta, que es la que manda. Sin eso, un crédito a 48 meses se
  daría por saldado once pagos antes de tiempo.
- **Enganche** — el 20 % que pusiste del auto se apunta con la deuda, con su
  movimiento opcional en la cuenta de la que salió. No es principal (no se
  financia), pero sí es parte de lo que te costó: Finply te dice qué costó el
  bien y qué te cuesta el crédito con intereses.
- **Tarjetas de crédito** — límite, día de corte y día de pago. Finply calcula
  el **saldo al corte** (lo de después del corte no cuenta) y el **pago para no
  generar intereses**, descontando lo que ya abonaste y con la fecha límite a
  la vista. Un corte 31 cae el 28 en febrero, como en el banco.
- **Meses sin intereses** — una compra a N meses asienta un cargo por el total
  —tu línea de crédito se usa completa desde el primer día, que es lo que de
  verdad pasa— y genera las N parcialidades, cada una en su corte. El saldo al
  corte suma solo las parcialidades ya facturadas: nunca la compra dos veces.
- **Recurrencias que proponen, no asientan** — la renta, las suscripciones, la
  colegiatura o el sueldo quincenal. Finply calcula los periodos vencidos y te
  los pone en una bandeja **por confirmar**; tú los asientas, los ajustas o los
  descartas uno por uno. No hay modo automático y no lo va a haber: el valor de
  llevar un libro es que nada entra sin que lo veas. Las propuestas ni siquiera
  se guardan —se derivan de la plantilla cada vez—, así que si le subes a la
  renta, lo pendiente sube y lo ya asentado no se toca. Y un periodo no puede
  asentarse dos veces, ni con dos pestañas abiertas.
- **Calendario de vencimientos** — 30, 60 o 90 días con todo lo que ya sabe tu
  libro: recurrencias por confirmar, cortes de tarjeta con su fecha límite de
  pago, la mensualidad que sigue de cada deuda con plazo y las parcialidades de
  tus compras a meses. Es un recordatorio, no un cargo.
- **Inversiones** — CETES, fondos, acciones, cripto o lo que sea: registra
  aportes y retiros (ligables a una cuenta) y valúa cuando quieras. Finply
  calcula el rendimiento y dibuja la evolución del valor.
- **Reportes históricos** — el año completo en una vista: patrimonio mes a mes,
  ingresos contra gastos, en qué se fue el año por categoría y por etiqueta,
  tasa de ahorro y la comparativa de un mes contra el anterior. Con una regla
  explícita: recibir un préstamo, aportar a una inversión o abonar capital a
  una deuda **no cuentan** como ingreso ni gasto — mueven tu patrimonio de
  lugar, no lo crean ni lo consumen. Sin eso, endeudarte mejoraría tu tasa de
  ahorro. Imprimible como cierre de año.
- **Alertas que no se descartan** — en el Resumen: la fecha límite de una
  tarjeta que ya venció sin cubrirse, la que vence en cinco días, un
  presupuesto rebasado, las partidas recurrentes por confirmar, una deuda
  atrasada y una meta que va más lenta que su plazo. No se calculan una vez y
  se guardan: se derivan cada vez que abres, así que **se apagan solas** en
  cuanto pagas o corriges. No hay «marcar como visto» porque no hace falta.
- **Panel de análisis** — sobre los últimos 3, 6 o 12 meses **cerrados** (el
  mes en curso va a medias y arrastraría los promedios): tasa de ahorro,
  meses de colchón —tu líquido entre tu gasto promedio; una tarjeta no es
  colchón—, gasto recurrente contra discrecional y qué tan concentrado está tu
  gasto en una sola categoría. Los supuestos van escritos junto a las cifras.
- **Presupuestos** — un tope por categoría de gasto **y por mes**, con barra de
  avance, alerta al 80 % y estado de excedido con la cifra exacta. Cada mes
  lleva su propio plan; puedes arrastrar el del mes anterior de un clic.
- **Metas** — fondos de emergencia, viajes, enganches. Aporta cuando puedas;
  la meta se marca cumplida sola.
- **Notas** — apuntes con renglones de libreta y margen rojo, fijables al
  tablero, por perfil.
- **Respaldo y restauración** — descarga todo tu libro en un JSON legible y
  vuelve a cargarlo cuando quieras. Además, Finply deja una copia `.db` del día
  en `data/respaldos/` cada vez que arranca y conserva las últimas siete.
- **Modo claro / oscuro / auto** — el tema oscuro es una superficie propia
  ("lámpara de banquero"), no una inversión automática de colores.
- **Tinta propia, con el contraste medido** — además de los cuatro presets,
  cada perfil puede llevar su propio color. Son **dos** colores, uno por tema,
  y no por gusto: ningún color alcanza AA sobre el papel claro y el oscuro a la
  vez (probado sobre 140,608 colores, cero lo logran). Finply te enseña la
  razón de contraste mientras eliges —`6.45:1 · cumple AA`— y **no guarda** una
  tinta que no se pueda leer. Los colores de las gráficas no se tocan: ese par
  está validado para daltonismo.
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
| `npm test` | Pruebas de integridad del libro (sin dependencias externas) |
| `npm run build` | Verifica tipos y compila el frontend a `dist/` |
| `npm start` | Producción: un solo servidor sirve API + frontend en :4321 |

## Privacidad

Finply **no pide contraseña**, y por eso el servidor solo escucha en
`127.0.0.1`: nadie más en tu red —ni en el WiFi del café— alcanza tu libro.
Si necesitas exponerlo a propósito, `API_HOST=0.0.0.0` lo permite, pero
entonces cualquiera que sepa tu IP entra y escribe sin credenciales. Ponle un
proxy con autenticación enfrente antes de hacerlo.

Tus datos viven en un solo archivo SQLite (`data/finply.db`, gitignoreado).
Desde **Ajustes** puedes descargar un respaldo completo en JSON o restaurar uno
anterior; la ruta exacta del archivo también aparece ahí, por si prefieres
respaldarlo por fuera. `FINPLY_DB=/otra/ruta.db` cambia dónde vive.

## Estructura

```
server/          Express + node:sqlite
  app.ts         arma la app (sin escuchar: así la prueban las pruebas)
  index.ts       la pone a escuchar en 127.0.0.1
  db.ts          conexión, transacciones y helpers compartidos
  migrations.ts  migraciones numeradas (PRAGMA user_version)
  backup.ts      export/import JSON e instantáneas .db rotativas
  validators.ts  esquemas Zod (errores en español)
  csv.ts         lectura/escritura de CSV y saneo de inyección de fórmulas
  valores.ts     interpretación de fechas y montos ajenos (módulo puro)
  importar.ts    análisis, ejecución y deshacer de importaciones
  tarjetas.ts    saldo al corte, línea disponible y compras a meses
  reportes.ts    agregados del año y serie de patrimonio (solo lectura)
  recurrencias.ts plantillas y bandeja derivada de propuestas
  calendario.ts  lo que vence en los próximos días (solo lectura)
  alertas.ts     lo que hoy merece un aviso, derivado (solo lectura)
  analisis.ts    colchón, origen del gasto y concentración (solo lectura)
  routes/        profiles · accounts · categories · tags · transactions · debts
                 · tarjetas · investments · budgets · goals · notes · summary
                 · reportes · alertas · analisis · recurrencias · calendario
                 · backup · importaciones
  seed.ts        datos demo deterministas
shared/
  types.ts       tipos compartidos cliente/servidor
  fechas.ts      aritmética de fechas: recorte de día, meses y semana ISO (puro)
  credito.ts     amortización, parcialidades e interés devengado (puro)
  recurrencias.ts periodos de una plantilla y su clave estable (puro)
  color.ts       contraste WCAG y veredicto por tema (puro)
src/
  views/         Resumen · Movimientos · Cuentas · Categorías · Reportes
                 · Análisis · Tarjetas · Deudas · Inversiones · Recurrencias
                 · Calendario · Presupuestos · Metas · Notas · Ajustes
  components/    formularios, gráficas, sello, barra lateral
  styles/        tokens.css (temas claro/oscuro) + app.css
test/            pruebas de integridad contra una base temporal
data/finply.db   tu libro (gitignored — nunca se versiona)
data/respaldos/  copias automáticas del día (gitignored)
```

### Migraciones

El esquema se versiona en `PRAGMA user_version`, dentro del propio `.db`. Para
cambiarlo se agrega una entrada nueva al final de `MIGRATIONS`
([server/migrations.ts](server/migrations.ts)) — nunca se edita una ya
publicada, porque las bases de los demás ya la corrieron. Cada migración va en
su propia transacción y al final se revisan las llaves foráneas.

## API

REST sobre `/api`. Todas las cantidades en centavos enteros.

| Método y ruta | Descripción |
|---|---|
| `GET/POST /api/profiles` · `PATCH/DELETE /:id` | Perfiles (libros) |
| `GET/POST /api/accounts` · `PATCH/DELETE /:id` | Cuentas con saldo calculado |
| `GET/POST /api/categories` · `PATCH/DELETE /:id` | Categorías (borrar acepta `?reassignTo=` o `?force=true`) |
| `GET/POST /api/tags` · `PATCH/DELETE /:id` | Etiquetas por perfil |
| `GET/POST /api/transactions` · `PATCH/DELETE /:id` | Movimientos (filtros: mes, `from`/`to`, cuenta, tipo, etiqueta, `minCents`/`maxCents`, búsqueda, `limit`/`offset`) |
| `GET /api/transactions/export.csv` | Export CSV del filtro completo, sin paginar |
| `POST /api/importaciones/previsualizar` | Analiza un CSV y devuelve el informe. No escribe nada |
| `GET/POST /api/importaciones` · `DELETE /:id` | Lotes de importación y deshacer |
| `GET/POST /api/debts` · `PATCH/DELETE /:id` | Deudas por cobrar / por pagar, con tasa, plazo y enganche (`accountId` y `downPaymentAccountId` asientan sus movimientos) |
| `GET /api/debts/:id/amortizacion` | Tabla de pagos: capital contra interés mes a mes |
| `POST /api/debts/:id/payments` · `DELETE /api/debts/payments/:id` | Abonos (con movimiento ligado opcional; `interestCents` fija el desglose, si no se propone) |
| `GET /api/tarjetas?profileId` | Estado de cada tarjeta: corte, pago para no generar intereses y línea disponible |
| `GET/POST /api/tarjetas/msi` · `DELETE /msi/:id` | Compras a meses sin intereses y sus parcialidades |
| `GET/POST /api/investments` · `PATCH/DELETE /:id` | Inversiones con rendimiento calculado |
| `POST /api/investments/:id/entries` · `DELETE /api/investments/entries/:id` | Aportes, retiros y valuaciones |
| `GET/POST /api/budgets` · `DELETE /:id` | Presupuestos por categoría y mes (upsert) con gastado del mes |
| `POST /api/budgets/copiar` | Copia los topes de un mes a otro sin pisar los que ya existen |
| `GET/POST /api/goals` · `PATCH/DELETE /:id` | Metas de ahorro |
| `POST /api/goals/:id/entries` · `DELETE /api/goals/entries/:id` | Aportes a metas |
| `GET/POST /api/notes` · `PATCH/DELETE /:id` | Notas (con fijado) |
| `GET /api/summary?profileId&month` | Resumen del mes + patrimonio en una llamada |
| `GET /api/reportes?profileId&year` | El año: patrimonio mes a mes, ingresos vs gastos, categorías, etiquetas y tasa de ahorro |
| `GET /api/reportes/comparativa?profileId&month` | Un mes contra el anterior, categoría por categoría |
| `GET/POST /api/recurrencias` · `PATCH/DELETE /:id` | Plantillas de lo que se repite (mensual, quincenal, semanal, anual) |
| `GET /api/recurrencias/pendientes?profileId` | La bandeja por confirmar. **Derivada**: no escribe ni guarda propuestas |
| `POST /api/recurrencias/:id/asentar` | Crea el movimiento y marca el periodo, en una transacción. 409 si ya se resolvió |
| `POST /api/recurrencias/:id/descartar` · `/reabrir` | Descartar no mueve el libro; reabrir deshace un descarte |
| `GET /api/calendario?profileId&dias` | Lo que vence: recurrencias, cortes y pagos de tarjeta, deudas y parcialidades |
| `GET /api/alertas?profileId` | Lo vencido y lo que está por vencer. **Derivadas**: no se guardan ni se descartan |
| `GET /api/analisis?profileId&meses` | Meses de colchón, tasa de ahorro, gasto recurrente contra discrecional y concentración |
| `GET /api/respaldo` · `GET /info` · `POST /restaurar` | Respaldo completo en JSON |

Reglas de integridad que cuida el backend, todas cubiertas por `npm test`:
una cuenta con movimientos solo se archiva (no se borra); anular un movimiento
ligado a un abono de deuda, a un aporte de inversión o a una compra a meses
anula también ese registro (y viceversa); editar uno de esos movimientos
sincroniza monto y fecha con su abono, aporte o calendario de parcialidades, y
su tipo no puede cambiar; el desembolso y el enganche de una deuda son la
excepción a la cascada —anularlos no borra la deuda, porque una deuda con
abonos no puede evaporarse por anular un movimiento—; el estado de una deuda
siempre se deriva del **capital** abonado contra el principal, nunca del total
pagado; las parcialidades de una compra a meses suman
exactamente su total y la amortización cuadra al centavo contra el monto
original; y un movimiento nunca cruza de perfil, ni toma la cuenta o la
categoría de otro libro —ni una categoría de ingreso para un gasto—; y una
recurrencia no puede asentar dos veces el mismo periodo, porque la clave
`(plantilla, periodo)` es única en la base y no una comprobación del código
—si anulas el movimiento que asentaste, ese periodo vuelve solo a la bandeja—.
El libro siempre cuadra.

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

La tinta de un perfil —preset o propia— se valida con la razón de contraste
WCAG real contra las superficies de su tema, no contra una lista de colores
permitidos: [shared/color.ts](shared/color.ts) es un módulo puro que usan el
servidor para rechazar y el cliente para enseñar el número mientras eliges.
El mínimo es AA para texto normal (4.5:1) y se mide contra la peor superficie
donde aparece, que en el tema oscuro es la hoja, no el fondo.

## Hoja de ruta

**Siguiente**

- Inversiones con unidades, precio por unidad y rendimiento anualizado
  (XIRR/TWR), histórico de valuaciones y simulador de escenarios con los
  supuestos a la vista. **Sin cotizaciones en línea**: valuación manual o CSV
  de precios, porque tus datos no salen de tu máquina.

**Después**

- Funciones de negocio agnósticas del giro: contrapartes, facturas con
  vencimiento, antigüedad de saldos, IVA y deducibles, centros de costo,
  estado de resultados y punto de equilibrio
- Multimoneda de verdad (hoy la columna existe pero los totales asumen MXN)
- Importar CFDI (XML del SAT) para perfiles de negocio
- Adjuntar recibos a los movimientos
- Móvil/PWA e internacionalización

Las contribuciones son bienvenidas: abre un issue o un PR. `npm test` corre en
cada PR junto con la verificación de tipos y la compilación.

## Licencia

[MIT](LICENSE) — úsalo, estúdialo, mejóralo y compártelo.
