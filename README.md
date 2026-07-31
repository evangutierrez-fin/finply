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

- **El Resumen dice contra qué** — el total lleva su cambio contra el cierre
  del mes pasado (un total sin comparación no dice si vas bien), cada cuenta su
  minigráfica de 30 días con el cambio en pesos al lado, y el patrimonio se ve
  además como dos barras a la misma escala: lo que tienes, repartido, y lo que
  debes debajo. Cuatro números en fila no dicen si tu casa pesa más que tu
  deuda.
- **Perfiles ilimitados** — cada perfil es un libro independiente con sus
  propias cuentas, categorías, movimientos, deudas, inversiones, metas y notas.
  Ideal para separar tus finanzas personales de las de tu negocio. Cada perfil
  elige su tinta (verde banca, latón, cobalto o vino).
- **Cada libro lleva solo lo suyo** — al crear un perfil, Finply te pregunta
  qué llevas en él: tarjetas de crédito, deudas, inversiones, recurrencias,
  presupuestos, metas, notas, negocio. Lo que no marques no aparece en el lomo
  ni te llena el formulario de campos que nunca usas. Viene todo encendido
  según el tipo de libro, así que aceptar sin leer también funciona, y se
  cambia cuando quieras desde Ajustes. **Apagar una sección no borra nada**: el
  dato sigue ahí, sigue contando en tu patrimonio y vuelve a la vista en cuanto
  la enciendas — si llegas a una sección apagada, Finply te lo dice en vez de
  hacerte creer que se perdió. Y el tipo de libro solo elige el punto de
  partida: un perfil personal puede llevar facturas si le sirven.
- **Cuentas múltiples** — efectivo, banco, tarjeta, ahorro… con saldo inicial,
  saldo calculado y archivado (nunca pierdes historia).
- **Movimientos manuales** — gastos, ingresos y transferencias entre cuentas,
  con categorías, etiquetas, búsqueda y filtros por mes, rango de fechas,
  cuenta, tipo, etiqueta y rango de montos. Corrección o anulación de partidas,
  paginación y sumas del periodo al pie, como en el libro real.
- **Categorías y etiquetas** — renombra o borra categorías reasignando sus
  movimientos (ningún monto cambia nunca al reclasificar). Las etiquetas cruzan
  categorías: un mismo viaje lleva comida, transporte y hospedaje.
- **Partida dividida** — un ticket con despensa, farmacia y ropa es **un solo
  movimiento** con varias categorías, no tres movimientos que ya no se parecen
  al ticket. Los renglones tienen que sumar exactamente el total y Finply te
  dice cuánto falta por repartir mientras lo escribes. Tu saldo no se mueve: lo
  único que cambia es a qué categorías se reparte el gasto.
- **Reembolsos ligados** — una devolución apunta al gasto que devuelve. El
  dinero entra a tu cuenta, pero **no cuenta como ingreso del mes**: baja ese
  gasto y su categoría. Devolver una camisa no es ganar dinero, y sin esto tu
  tasa de ahorro subía cada vez que te reembolsaban algo.
- **Conciliación** — palomea cada partida contra tu estado de cuenta y declara
  el saldo que el banco dice a esa fecha. Finply resta y te enseña la
  diferencia y **cuántas partidas la explican**. Marcar no corrige nada: si te
  equivocaste, despalomea y el corte vuelve a descuadrar solo.
- **Bienes** — la casa, el auto, la herramienta del taller. Financiar un coche
  ya no te empobrece: la deuda resta y el bien suma, y Finply te dice **cuánto
  de él ya es tuyo** (su valor menos lo que debes del crédito). La depreciación
  la declaras tú, con la fecha en que lo valuaste: no hay una tasa que sirva
  para todos los coches, y Finply no se la inventa.
- **Metas con respaldo** — cada aporte puede salir de una cuenta de verdad y
  asentar su traspaso. La meta te dice cuánto de lo apartado es dinero movido y
  cuánto es solo un apunte, y **cuánto tienes que apartar al mes** para llegar a
  tiempo. Antes, apartar $50,000 no los quitaba de ningún lado.
- **Una moneda por libro** — se fija al crear el perfil y las cuentas la
  heredan. Si tienes dólares, abres otro perfil: convertir a un tipo de cambio
  inventado sería peor que no hacerlo.
- **Cada cuenta, en el tiempo** — el saldo de los últimos doce meses de esa
  cuenta (la serie de patrimonio es global y no dice si tu ahorro va subiendo),
  su institución, el orden en que las ves y un aviso cuando alguna baja del
  mínimo que tú pusiste.
- **Recibos y duplicados** — adjunta la foto o el PDF del ticket (se guarda
  dentro de tu libro y viaja en el respaldo) y duplica cualquier partida con la
  fecha de hoy, sin volver a teclear lo que Finply ya sabe.
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
- **Lo que de verdad cuesta la tarjeta** — escribe su tasa anual, el porcentaje
  del pago mínimo y el mínimo fijo, tal como vienen en tu contrato, y Finply te
  dice en cuántos meses la liquidas pagando **solo el mínimo** y cuánto pagas de
  intereses en el camino. Si el mínimo no alcanza ni para el interés del mes, lo
  dice con esas palabras: esa deuda no se acaba nunca. Sin la tasa no supone
  ninguna — no conoce la de tu banco.
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
- **¿Llego a fin de mes?** — la caja líquida de hoy movida **día a día** por
  todo lo que ya vence, a 30, 60 o 90 días: el primer día en rojo con su fecha
  y su cifra, o la confirmación de que no lo hay, y el punto más bajo del
  camino. Debajo va la cuenta completa —cada renglón con su día, su monto y su
  liga a la sección de donde salió—, porque una proyección que no se puede
  auditar renglón por renglón no merece que se le crea. Cuenta también lo que
  ya asentaste con fecha futura, así que el cheque que firmaste para el viernes
  se ve salir el viernes y no antes. La cifra aparece también en el Resumen.
  No adivina el gasto de todos los días: es un piso, no un pronóstico.
- **Inversiones por unidades** — CETES, fondos, acciones, cripto o lo que sea:
  registra aportes y retiros (ligables a una cuenta) con sus unidades y su
  precio, y valúa escribiendo el precio por unidad en vez del total. Finply
  calcula el **rendimiento anualizado** con tus fechas (XIRR, no el simple
  valor − aportado) y dibuja la evolución del valor. También puedes pegar un
  CSV de precios y valuar varias de un jalón: ves fila por fila lo que
  pasaría antes de asentar nada. **Sin cotizaciones en línea**, nunca —
  pedirlas le contaría a otro servidor qué tienes.
- **Perfil de negocio** — clientes y proveedores reutilizables, facturas
  emitidas y recibidas con su vencimiento, y antigüedad de saldos para ver no
  solo cuánto te deben sino desde hace cuánto. Registrar una factura **no mueve
  tu libro**: es el compromiso. El ingreso entra cuando la cobras, con su parte
  del impuesto. De ahí salen el estado de resultados —ingresos, costo de
  ventas, margen bruto, gastos fijos y variables, utilidad—, el punto de
  equilibrio. Nada es de un giro ni de un país: el identificador fiscal es libre, el impuesto se escribe
  en monto y la dimensión libre —proyecto, obra, sucursal— la nombras tú.
  Viene encendido en los libros de negocio y apagado en los personales, pero es
  una casilla: enciéndela si facturas por tu cuenta.
- **Lo que vas a cobrar no siempre es el total** — si te retienen impuesto o
  retención sobre el ingreso, se escriben en la factura (en monto, no en tasa) y
  Finply mide el saldo contra lo **cobrable**, no contra el papel: la factura se
  salda cuando llega lo que iba a llegar. Igual con las **notas de crédito**,
  que cancelan parte de una factura sin borrarla y sin mover un peso, porque
  ningún peso se movió. Y si cobraste **antes** de facturar, ese anticipo ya
  está en tu libro desde el día que entró: cuando llegue la factura se le aplica
  desde ahí, sin registrar dos veces el mismo dinero.
- **La cobranza de hoy y las facturas que se repiten** — una lista ordenada por
  antigüedad de a quién le hablas primero, con su contacto al lado, porque un
  saldo de hace noventa días no vale lo mismo que uno de ayer. La iguala del mes
  se guarda como plantilla y cada periodo vencido te espera **por emitir**: como
  las recurrencias, propone y tú decides. Emitirla tampoco mueve el libro.
- **Qué deja cada cliente y cada proyecto** — ingresos, costo atribuido, margen
  y su porcentaje, con el periodo comparado contra el anterior. Lo que no le
  atribuiste a nadie no se reparte a ojo: se dice cuánto quedó fuera.
- **La contraparte que ya sabe cómo te paga** — contacto, días de crédito que
  proponen el vencimiento al facturarle, y un límite de crédito que **avisa,
  nunca impide**: a quién le fías y cuánto es tu decisión.
- **Simulador de patrimonio** — qué pasa si apartas X al mes durante N años, y
  si conviene más invertirlo o pagar primero la deuda cara. Sale de tus cifras
  de hoy, la tasa la pones tú y los cinco supuestos van escritos junto al
  número. No es un pronóstico ni un consejo de inversión.
- **Reportes históricos** — el año completo en una vista: patrimonio mes a mes,
  ingresos contra gastos, en qué se fue el año por categoría y por etiqueta,
  tasa de ahorro y la comparativa de un mes contra el anterior. Con una regla
  explícita: recibir un préstamo, aportar a una inversión o abonar capital a
  una deuda **no cuentan** como ingreso ni gasto — mueven tu patrimonio de
  lugar, no lo crean ni lo consumen. Sin eso, endeudarte mejoraría tu tasa de
  ahorro. Imprimible como cierre de año.
- **Alertas que no se descartan** — en el Resumen: la fecha límite de una
  tarjeta que ya venció sin cubrirse, la que vence en cinco días, un
  presupuesto rebasado —o el techo de todo el mes, que puede saltar sin que
  ninguna categoría se pase—, las partidas recurrentes por confirmar, una deuda
  atrasada y una meta que va más lenta que su plazo. No se calculan una vez y
  se guardan: se derivan cada vez que abres, así que **se apagan solas** en
  cuanto pagas o corriges. No hay «marcar como visto» porque no hace falta.
- **Panel de análisis** — sobre los últimos 3, 6 o 12 meses **cerrados** (el
  mes en curso va a medias y arrastraría los promedios): tasa de ahorro,
  meses de colchón —tu líquido entre tu gasto promedio; una tarjeta no es
  colchón—, gasto recurrente contra discrecional y qué tan concentrado está tu
  gasto en una sola categoría. Los supuestos van escritos junto a las cifras.
- **¿Voy subiendo o bajando?** — la tendencia de tu gasto y de tu ingreso sobre
  los meses cerrados, medida con la **pendiente de en medio** entre todos los
  pares de meses. No es la recta de siempre, y por una razón: con cinco meses
  parejos y un viaje en el sexto, aquella declara que gastas miles más al mes
  porque un solo mes le tuerce el brazo. Si menos de dos de cada tres pares van
  en el mismo sentido, Finply dice que no hay dirección en vez de dibujar una
  flecha.
- **Estacionalidad** — el mismo mes contra los años anteriores. Diciembre
  siempre cuesta más; compararlo con noviembre solo dice que subió, no si subió
  lo de siempre.
- **Qué se disparó** — las categorías que se salieron de **su propio** promedio
  el último mes cerrado. Entra la que se pasó más del 40 % *y* por más de $500:
  con solo el primer umbral serían siempre las categorías grandes, con solo el
  segundo cualquier café de más gritaría. Los dos van escritos en la vista.
- **Gasto hormiga** — cuántas compras chicas hiciste y cuánto suman. Se cuenta
  por compra, no por renglón: un ticket repartido en tres categorías es una
  compra, no tres. El umbral lo eliges tú.
- **De dónde vino el dinero** — el ingreso desmenuzado por fuente, igual que el
  gasto. Quien vive de un sueldo y quien vive de seis clientes corren riesgos
  distintos.
- **Dos periodos cualesquiera** — mes contra mes, trimestre contra trimestre,
  año contra año o los rangos que tú escribas, categoría por categoría. Y la
  **mediana** junto al promedio: si cambiaste el refri en marzo, el promedio
  sube y la mediana no, y la distancia entre las dos es el dato.
- **Presupuestos que saben qué día es** — un tope por categoría **y por mes**,
  con barra de avance, alerta al 80 % y la cifra exacta de lo excedido. Encima,
  el **ritmo**: cada barra lleva la marca de dónde irías gastando parejo, y
  debajo dice con palabras cuánto vas arriba o abajo de ella — gastar el 80 %
  del tope el día 3 y gastarlo el día 28 son dos noticias opuestas. Además:
  un **tope de todo el mes** que cuenta también lo que gastas en categorías sin
  tope, **topes anuales** para lo que no es mensual (la tenencia, el seguro) y
  el **sobrante que rueda** al mes siguiente en las categorías que elijas.
  Rueda en los dos sentidos: si sobró sube tu techo, y si te pasaste lo baja,
  con la resta escrita a la vista. Cada mes lleva su propio plan; puedes
  arrastrar el del mes anterior de un clic.
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
- **Gráficas que se leen solas** — cada una lleva su eje con cifras en pasos
  redondos ($0 · $5k · $10k), así que se entiende sin pasarle el ratón encima
  y **se imprime bien**: el cierre de año en papel ya no son barras sin
  números. Se recorren con las flechas del teclado y cada punto se anuncia,
  y detrás de cada una hay una tabla con los datos para lectores de pantalla.
  Cuando un solo día se dispara —la nómina mide treinta veces cualquier gasto—
  la escala se corta para que el resto se vea, la barra recortada se marca con
  una punta serrada y el pie lo dice con palabras: nunca en silencio.
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
  precios.ts     import CSV de precios: analiza, y solo asienta lo marcado
  simulacion.ts  punto de partida del simulador (solo lectura)
  facturas.ts    facturas con lo cobrable derivado, aging y cobranza
  facturas-recurrentes.ts plantillas de factura sobre el motor de recurrencias
  negocio.ts     estado de resultados, rentabilidad y punto de equilibrio
  flujo.ts       la caja proyectada día a día, auditable (solo lectura)
  routes/        profiles · accounts · categories · tags · transactions · debts
                 · tarjetas · investments · budgets · goals · notes · summary
                 · reportes · alertas · analisis · precios · simulador
                 · contrapartes · centros · facturas · facturas-recurrentes
                 · negocio
                 · recurrencias · calendario · flujo · backup · importaciones
  seed.ts        datos demo deterministas
shared/
  types.ts       tipos compartidos cliente/servidor
  fechas.ts      aritmética de fechas: recorte de día, meses y semana ISO (puro)
  credito.ts     amortización, parcialidades e interés devengado (puro)
  recurrencias.ts periodos de una plantilla y su clave estable (puro)
  color.ts       contraste WCAG y veredicto por tema (puro)
  inversiones.ts recorrido del historial y unidades en enteros ×10⁸ (puro)
  rendimiento.ts XIRR por bisección, con null donde no se puede afirmar (puro)
  simulador.ts   proyección de patrimonio mes a mes (puro)
  negocio.ts     tramos de antigüedad y punto de equilibrio (puro)
  modulos.ts     catálogo de secciones por perfil y su resolución (puro)
  escalas.ts     marcas del eje y techo de una escala con atípico (puro)
src/
  views/         Resumen · Movimientos · Cuentas · Categorías · Reportes
                 · Análisis · Tarjetas · Deudas · Inversiones · Simulador
                 · Contrapartes · Facturas · Negocio · Recurrencias
                 · Calendario · Flujo · Presupuestos · Metas · Notas · Ajustes
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
| `GET/POST /api/profiles` · `PATCH/DELETE /:id` | Perfiles (libros), con sus secciones activas en `modules` |
| `GET/POST /api/accounts` · `PATCH/DELETE /:id` | Cuentas con saldo calculado |
| `GET/POST /api/categories` · `PATCH/DELETE /:id` | Categorías (borrar acepta `?reassignTo=` o `?force=true`) |
| `GET/POST /api/tags` · `PATCH/DELETE /:id` | Etiquetas por perfil |
| `GET/POST /api/transactions` · `PATCH/DELETE /:id` | Movimientos (filtros: mes, `from`/`to`, cuenta, tipo, etiqueta, `minCents`/`maxCents`, búsqueda, `conciliado`, `limit`/`offset`). `splits` reparte por categoría; `refundOfId` liga una devolución |
| `GET /api/transactions/export.csv` | Export CSV del filtro completo, sin paginar |
| `POST /api/transactions/conciliar` | Palomea o despalomea partidas en bloque. No mueve ninguna cifra |
| `POST /api/transactions/:id/duplicar` | Copia la partida sin sus ligas |
| `POST/GET/DELETE /api/transactions/:id/adjuntos` | Recibos: imagen o PDF hasta 2 MB, en base64 |
| `GET/POST /api/conciliacion` · `DELETE /:id` | Cortes: el saldo que declaró el banco, con la diferencia contra lo palomeado |
| `POST /api/importaciones/previsualizar` | Analiza un CSV y devuelve el informe. No escribe nada |
| `GET/POST /api/importaciones` · `DELETE /:id` | Lotes de importación y deshacer |
| `GET/POST /api/debts` · `PATCH/DELETE /:id` | Deudas por cobrar / por pagar, con tasa, plazo y enganche (`accountId` y `downPaymentAccountId` asientan sus movimientos) |
| `GET /api/debts/:id/amortizacion` | Tabla de pagos: capital contra interés mes a mes |
| `POST /api/debts/:id/payments` · `DELETE /api/debts/payments/:id` | Abonos (con movimiento ligado opcional; `interestCents` fija el desglose, si no se propone) |
| `GET /api/tarjetas?profileId` | Estado de cada tarjeta: corte, pago para no generar intereses y línea disponible |
| `GET/POST /api/tarjetas/msi` · `DELETE /msi/:id` | Compras a meses sin intereses y sus parcialidades |
| `GET/POST /api/investments` · `PATCH/DELETE /:id` | Inversiones con unidades, valor y rendimiento anualizado (XIRR) |
| `POST /api/investments/:id/entries` · `DELETE /api/investments/entries/:id` | Aportes, retiros y valuaciones, con unidades y precio por unidad |
| `POST /api/precios/analizar` | Lee un CSV de precios y dice qué pasaría. **No escribe nada** |
| `POST /api/precios/aplicar` | Asienta solo las filas marcadas, en una transacción |
| `GET/POST /api/budgets` · `DELETE /:id` | El presupuesto de un mes: topes por categoría, anuales del año, tope total, lo gastado, el arrastre y el ritmo |
| `PUT /api/budgets/total` · `DELETE /total/:id` | El techo de **todo** el mes, incluidas las categorías sin tope |
| `POST /api/budgets/copiar` | Copia los topes de un mes a otro sin pisar los que ya existen |
| `GET/POST /api/bienes` · `PATCH/DELETE /:id` | Bienes con su valor de hoy y su liga a la deuda que los financia |
| `POST /api/bienes/:id/valuaciones` · `DELETE /valuaciones/:id` | Cuánto vale hoy, declarado por ti. Repetir fecha corrige |
| `GET /api/accounts/:id/serie` | Saldo de esa cuenta al cierre de cada mes |
| `GET/POST /api/goals` · `PATCH/DELETE /:id` | Metas de ahorro |
| `POST /api/goals/:id/entries` · `DELETE /api/goals/entries/:id` | Aportes a metas |
| `GET/POST /api/notes` · `PATCH/DELETE /:id` | Notas (con fijado) |
| `GET /api/summary?profileId&month&hoy` | Resumen del mes + patrimonio, con el cambio contra el cierre del mes pasado y 30 días de saldo por cuenta |
| `GET /api/reportes?profileId&year` | El año: patrimonio mes a mes, ingresos vs gastos, categorías, etiquetas, de dónde vino, tasa de ahorro y mediana |
| `GET /api/reportes/comparativa?profileId&desde&hasta` | Dos periodos cualesquiera, categoría por categoría. Sin el segundo rango, el bloque anterior del mismo largo |
| `GET/POST /api/recurrencias` · `PATCH/DELETE /:id` | Plantillas de lo que se repite (mensual, quincenal, semanal, anual) |
| `GET /api/recurrencias/pendientes?profileId` | La bandeja por confirmar. **Derivada**: no escribe ni guarda propuestas |
| `POST /api/recurrencias/:id/asentar` | Crea el movimiento y marca el periodo, en una transacción. 409 si ya se resolvió |
| `POST /api/recurrencias/:id/descartar` · `/reabrir` | Descartar no mueve el libro; reabrir deshace un descarte |
| `GET /api/calendario?profileId&dias` | Lo que vence: recurrencias, cortes y pagos de tarjeta, deudas y parcialidades |
| `GET /api/alertas?profileId` | Lo vencido y lo que está por vencer. **Derivadas**: no se guardan ni se descartan |
| `GET /api/analisis?profileId&meses` | Colchón, tasa de ahorro, recurrente contra discrecional, concentración, tendencia, estacionalidad, categorías disparadas, gasto hormiga y fuentes de ingreso |
| `GET /api/simulador?profileId&meses&ahorroMensualCents&rendimientoAnualBp` | Las dos rutas —invertir o pagar la deuda— proyectadas sobre las mismas cifras |
| `GET/POST /api/contrapartes` · `PATCH/DELETE /:id` | Clientes y proveedores, con lo que te deben y lo que les debes |
| `GET/POST /api/centros` · `PATCH/DELETE /:id` | La dimensión libre del perfil (proyecto, obra, sucursal) |
| `GET/POST /api/facturas` · `PATCH/DELETE /:id` | Facturas emitidas y recibidas, con retenciones. Registrarlas **no mueve el libro** |
| `POST /api/facturas/:id/cobros` | El cobro (o el pago): aquí nace el asiento, con su parte del impuesto |
| `POST /api/facturas/:id/notas` · `DELETE /notas/:notaId` | Notas de crédito: cancelan parte de la factura sin mover un peso |
| `GET/POST /api/facturas/:id/anticipos` | Lo cobrado sin factura, y aplicarlo ligando el movimiento que ya existe |
| `GET /api/facturas/aging?profileId` | Antigüedad de saldos: corriente, 1-30, 31-60, 61-90 y más de 90 |
| `GET /api/facturas/cobranza?profileId` | A quién le hablas hoy, de lo más vencido a lo más nuevo |
| `GET/POST /api/facturas/recurrentes` · `PATCH/DELETE /:id` | Plantillas de factura que se repite |
| `GET /api/facturas/recurrentes/pendientes` · `POST /:id/emitir` · `/descartar` · `/reabrir` | La bandeja derivada y su resolución (R4, R5) |
| `GET /api/negocio/resultados?profileId&desde&hasta` | Estado de resultados, rentabilidad por cliente y por centro, impuestos, equilibrio y el periodo anterior |
| `GET /api/flujo?profileId&dias&hoy` | La caja proyectada día a día: puntos, eventos que la mueven y primer día en rojo |
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

**Lo que corrige algo que hoy está mal**

- **Auditoría de las cuentas de Finply** — verificar cada cifra que Finply
  calcula contra aritmética hecha aparte, dominio por dominio y simulando la
  vida entera de cada uno. Así salió el defecto que daba una deuda por saldada
  once pagos antes de tiempo; lo que se hizo con crédito hay que hacerlo con
  todo lo demás.

**El libro, más completo**

- Simulador: la gráfica del **rendimiento solo**, sin el patrimonio, que es lo
  que de verdad distingue una ruta de la otra; inflación y retiro

**Negocio**

- Cotizaciones que se vuelven factura, corte de caja, compras y órdenes
- Módulos de giro opcionales: inmuebles en renta, horas facturables e
  inventario simple

**Cómo se usa**

- Registrar más rápido, y que las secciones se hablen: pagar la tarjeta desde
  la alerta, asentar el vencimiento desde el calendario, cobrar la factura
  desde la antigüedad de saldos — sin navegar ni volver a teclear lo que Finply
  ya sabe. Nunca automático: se acorta el camino hasta la confirmación, no se
  quita la confirmación.
- Personalización: campos propios, plantillas de movimiento, orden de las
  secciones, formato de fechas
- Adjuntar recibos a los movimientos
- Móvil/PWA e internacionalización

Las contribuciones son bienvenidas: abre un issue o un PR. `npm test` corre en
cada PR junto con la verificación de tipos y la compilación.

## Licencia

[MIT](LICENSE) — úsalo, estúdialo, mejóralo y compártelo.
