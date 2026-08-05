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
  deuda. Lo que entró y salió del mes se cuenta con la **misma regla que los
  reportes**: recibir un préstamo o guardar el depósito de un inquilino no es
  ingreso, y un ticket dividido se reparte entre sus categorías. Tu saldo sí los
  incluye, porque ese es el dinero que tienes.
- **Perfiles ilimitados** — cada perfil es un libro independiente con sus
  propias cuentas, categorías, movimientos, deudas, inversiones, metas y notas.
  Ideal para separar tus finanzas personales de las de tu negocio. Cada perfil
  elige su tinta (verde banca, latón, cobalto o vino).
- **Cada libro lleva solo lo suyo** — al crear un perfil, Finply te pregunta
  qué llevas en él: tarjetas de crédito, deudas, inversiones, recurrencias,
  presupuestos, metas, notas, negocio. Hay tres más que **nadie trae
  encendido** porque solo le sirven a quien vive de eso: inmuebles en renta,
  horas facturables e inventario. Lo que no marques no aparece en el lomo
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
- **Registrar en una línea** — el registro manual es el valor de Finply, y por
  eso mismo el costo de cada partida importa: si apuntar un café cuesta abrir un
  modal y elegir cinco cosas, el libro se abandona. La barra pide lo que de
  verdad cambia entre una partida y la siguiente —cuánto y de qué— y propone lo
  demás de la última vez, **por tipo**: la cuenta del sueldo no es la del súper.
  Todo lo que se va a guardar está a la vista, cuenta y fecha incluidas, porque
  una barra que adivina la cuenta en silencio es peor que el modal. Un botón
  trae la última partida para repetirla —la **llena**, no la guarda— y «Más
  campos» abre el formulario completo con lo que ya escribiste.
- **Acción desde donde aparece el dato** — la alerta de la tarjeta trae el pago
  al lado, el vencimiento del calendario se asienta desde su renglón y la
  factura se cobra desde la lista de cobranza. El formulario se abre **con lo
  que Finply ya sabía** —cuánto, a qué cuenta, de qué contrato— y lo dice;
  confirmarlo sigue siendo tuyo. Nada se registra solo: lo que se acorta es el
  camino hasta la confirmación, nunca la confirmación.
- **Atajos de teclado** — `n` registra, `b` va a la barra rápida, `r` trae la
  última partida, `/` busca, `g` y una letra saltan de sección, `?` enseña la
  lista. Dentro de un campo de texto se callan todos —salvo Escape—, para que
  escribir «notas» en el buscador no abra media aplicación. Ninguno asienta
  nada en el libro.
- **Plantillas de movimiento** — lo que tecleas igual cada vez, guardado: la
  gasolina, la despensa, la comida del martes. Se elige una y el formulario
  aparece lleno; el monto puede quedarse libre —«lo pongo yo cada vez»—, que es
  justo el caso de la gasolina. **No es una recurrencia**: no sabe qué día cae y
  no propone nada sola. La colegiatura es una recurrencia; la gasolina es una
  plantilla.
- **Campos propios** — un dato que solo tu libro necesita y que Finply no tiene
  por qué entender: la placa del coche, el número de obra, con quién fuiste a
  cenar. Texto, número, fecha, lista de opciones o sí/no, con su tipo validado
  de verdad. Aparecen en el formulario de movimiento y salen en el CSV con su
  columna. **No entran a ningún reporte**, y eso es a propósito: nada que Finply
  no entienda puede mover una cifra que sí entiende.
- **El libro se lee como tú quieras** — el orden de las secciones en el lomo,
  cuál abre al entrar, cómo se escriben las fechas (`12 jun`, `12/06/2026` o
  `2026-06-12`), si se enseñan los centavos y en qué día empieza la semana. Nada
  de esto cambia una cifra: el libro sigue en centavos y las fechas siguen
  siendo las mismas. Y la configuración completa de un perfil —secciones, tinta,
  formato, categorías, campos propios y plantillas, **sin una sola cifra**— se
  descarga y se aplica a otro libro para montarlo igual sin rearmarlo a mano.
  Aplicarla crea lo que falta y respeta lo que ya está: no borra una categoría
  ni toca un movimiento.
- **Categorías y etiquetas** — renombra o borra categorías reasignando sus
  movimientos (ningún monto cambia nunca al reclasificar). Las etiquetas cruzan
  categorías: un mismo viaje lleva comida, transporte y hospedaje.
- **Subcategorías de un nivel** — "Restaurante" y "Café" cuelgan de "Comida", y
  **todos los reportes suman al padre** con el desglose a la vista debajo. Antes
  se escribía "Comida · restaurante" a mano y ningún reporte las juntaba. Tres
  cosas se heredan, y las tres para que crear una subcategoría no mueva una
  cifra en silencio: el **papel** del estado de resultados, el **tope** del
  presupuesto —que cuenta lo gastado en las hijas— y el **archivado**. Borrar un
  padre **promueve** a sus hijas en vez de llevárselas.
- **Archivar una categoría** — sale del selector y su historial queda intacto,
  igual que una cuenta archivada. Y sigue aceptándose al corregir un movimiento
  viejo, porque si no, archivar sería una forma silenciosa de perder datos.
- **Reglas que proponen categoría al importar** — "si el concepto trae OXXO,
  propón Súper". **Proponen, no asientan**: la categoría llega rellenada en la
  vista previa del import, con el nombre de la regla que la propuso al lado, y
  tú confirmas el lote como siempre. El archivo manda —una regla solo habla
  cuando la fila no trae categoría— y gana la primera que case, así que el orden
  lo pones tú.
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
- **Comisión de apertura y la tasa que de verdad pagas** — a diferencia del
  enganche, la comisión **nunca entra a tu cuenta**: debes $240,000 y el banco
  te deposita $235,200. Finply asienta el desembolso por lo que llegó de verdad
  y calcula la **tasa efectiva** de lo recibido contra lo que vas a pagar. Ese
  crédito «al 13.5 %» cuesta 15.62 %, y no hay forma de verlo en el contrato.
- **Bola de nieve contra avalancha** — con varias deudas, el mismo dinero
  puesto en distinto orden. Finply corre los dos métodos —primero la más chica
  o primero la más cara— sobre tus saldos y tus cuotas, y te enseña **los dos**:
  cuándo quedas libre y cuánto interés paga cada camino. Los dos ruedan la cuota
  liberada, así que la única diferencia es el orden. Cuál elegir es tuyo:
  la avalancha suele costar menos y la bola de nieve suele sentirse mejor.
- **«Si abono $X extra»** — sobre el saldo de hoy y con tu cuota, cuántos meses
  te ahorras y cuánto interés. Dos mil pesos más al mes en un crédito de auto
  lo acortan un año y ahorran $17,000 de intereses.
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
- **Cómo está repartida tu cartera** — cuánto pesa cada tipo sobre el total, de
  la tajada más grande a la más chica. Es la misma pregunta que le haces a tu
  gasto por categoría, hecha a tu dinero: si esa clase se mueve, se mueve esa
  parte de lo que tienes.
- **Ganancia cobrada contra ganancia en papel** — al retirar, parte de lo que
  sacas era tu costo y parte era ganancia. Finply las separa: lo que ya cobraste
  es tuyo, lo que sigue en papel todavía puede irse. El costo se consume a
  prorrata, no fingiendo un orden de venta que Finply nunca te pidió.
- **Aportar sin acordarte** — una plantilla de recurrencia puede aportar a una
  inversión. Al confirmarla se registra el aporte y queda ligado al movimiento,
  así que sale de tu cuenta pero **no cuenta como gasto**: pasar dinero de un
  bolsillo tuyo a otro no es gastarlo. Si anulas el movimiento, el aporte se va
  con él.
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
- **Tu inmueble rentado, y qué deja de verdad** — el contrato sobre una casa
  que ya llevas en Bienes: inquilino, renta, depósito y mantenimiento. Te dice
  lo cobrado del año, lo que se fue en arreglos y qué tasa anual sale de eso
  sobre lo que la propiedad vale hoy. El **depósito no es un ingreso**: entra a
  tu cuenta y sube tu saldo, pero lo tienes que devolver, así que queda fuera de
  tu ingreso del mes y del rendimiento. Esa regla vive en el movimiento, no en
  la sección: apagar el módulo no convierte un depósito viejo en ingreso.
- **Horas que todavía no son dinero** — apuntas el tiempo con su tarifa y
  Finply te dice lo que llevas trabajado **sin cobrar**, por cliente, mirando
  todo tu historial y no solo el mes: una hora de hace medio año sin facturar
  sigue sin cobrarse. De ahí sale la factura, todas las horas del cliente en
  una. La tarifa se guarda en cada renglón, así que subirla no reescribe lo que
  trabajaste antes.
- **Inventario simple** — entradas, salidas y ajustes; qué tienes, cuánto vale
  a costo promedio y cuánto costó lo que salió en el mes. Avisa cuando un
  producto baja de su mínimo. Dos cosas que **no** hace, a propósito: no suma a
  tu patrimonio —para eso están los bienes— y no cambia tu estado de resultados,
  que lleva la mercancía como gasto el día que la pagaste. Son dos verdades
  sobre el mismo peso, y la vista dice cuál es cuál.
- **Simulador de patrimonio** — qué pasa si apartas X al mes durante N años, y
  si conviene más invertirlo o pagar primero la deuda cara. Sale de tus cifras
  de hoy, las tasas las pones tú y los siete supuestos van escritos junto al
  número. Además del patrimonio —que arrastra tu punto de partida y hace que dos
  rutas muy distintas se vean casi iguales— enseña **lo invertido solo**, sin el
  efectivo quieto ni la deuda restada, que es la bolsa sobre la que de verdad
  actúa la tasa; y **lo que puso la tasa**, también solo:
  en pesos, en porcentaje y como una tasa anual equivalente que sí se puede
  comparar contra la que supusiste. Casi nunca coincide, y esa distancia es el
  dato: el dinero parado no rinde y las deudas devengan. También el interés que
  te ahorras liquidando antes, la misma proyección **en pesos de hoy** con tu
  inflación, una etapa de **retiro** (aportas N años, sacas una cantidad al mes
  hasta que se acabe — o hasta que se demuestre que no se acaba) y la pregunta
  al revés: **cuánto tienes que apartar al mes** para llegar a una cifra, que se
  resuelve corriendo la misma proyección hasta encontrar el aporte más chico que
  llega. No es un pronóstico ni un consejo de inversión.
- **Cotizaciones y órdenes de compra** — el documento que va **antes** de la
  factura, que es donde el ciclo empezaba a media calle. Lo que le prometes a un
  cliente y lo que le encargas a un proveedor viven en la misma sección con la
  flecha invertida, con su vigencia y su estado. Se convierten en factura de un
  clic heredando concepto, montos y centro —lo que Finply ya tiene enfrente no
  se vuelve a teclear— y la que se te vence sin respuesta te avisa. La tasa de
  éxito se mide sobre lo **contestado**: si lo que sigue esperando entrara en la
  cuenta, mandar una cotización nueva te haría ver peor. Nada de esto mueve tu
  libro: prometer un precio no es cobrar.
- **Corte de caja** — el cajón de efectivo se cuadra como una cuenta de banco:
  cuentas lo que hay, Finply dice cuánto debería haber, y **la diferencia se
  asienta como movimiento** —faltante como gasto, sobrante como ingreso— con el
  monto que salió de la resta, no uno tecleado. Solo cuando no queda nada por
  palomear: con partidas sin marcar, esa diferencia no es un faltante, es lo que
  no has revisado, y Finply se niega diciendo cuántas faltan.
- **Tablero por contraparte** — todo de un cliente en una hoja, desplegable en
  su renglón: facturado, cobrado, lo que te debe, lo vencido, lo cotizado sin
  respuesta y **cuánto tarda en pagarte** contra el crédito que le diste. El
  plazo se mide hasta el último cobro: pagar el 10 % a tiempo y el resto tres
  meses después no es pagar a tiempo.
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
- **Notas que se hablan con el libro** — apuntes con renglones de libreta y
  margen rojo, fijables al tablero. Una nota puede quedarse suelta, explicar
  **un movimiento** ("el súper salió carísimo porque llevé a los niños") o
  hablar de **un mes** entero, y entonces aparece donde sirve: en el renglón de
  esa partida y en el Resumen de ese mes. Anular el movimiento no borra lo que
  escribiste — se pierde la liga, nunca el apunte.
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
- **Las cuentas están auditadas, y el informe se publica** — cada dominio que
  toca dinero se simuló de punta a punta —la vida entera de un crédito de 48
  abonos, seis cortes de una tarjeta, dos años de una inversión, un año de
  libro, una factura cobrada en siete pedazos— y se comparó contra aritmética
  **hecha aparte**: fórmulas cerradas de hoja de cálculo, no el propio código
  de Finply. Salió un defecto de redondeo en el impuesto de una factura,
  arreglado y con pruebas de regresión. El informe completo, con lo que **no**
  cubre, está en [AUDITORIA.md](AUDITORIA.md).

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
  cotizaciones.ts el documento antes de la factura, con su vigencia derivada
  tablero.ts     todo de una contraparte, derivado de lo que ya existe
  facturas.ts    facturas con lo cobrable derivado, aging y cobranza
  facturas-recurrentes.ts plantillas de factura sobre el motor de recurrencias
  negocio.ts     estado de resultados, rentabilidad y punto de equilibrio
  flujo.ts       la caja proyectada día a día, auditable (solo lectura)
  personalizacion.ts campos propios (llave-valor, D24) y plantillas de movimiento
  taxonomia.ts   jerarquía de categorías (un nivel, D25) y reglas de import
  estrategia.ts  las deudas del perfil corridas por los dos métodos (solo lectura)
  config-perfil.ts   la configuración de un perfil, por nombre y sin sus cifras
  routes/        profiles · accounts · categories · tags · transactions · debts
                 · tarjetas · investments · budgets · goals · notes · summary
                 · reportes · alertas · analisis · precios · simulador
                 · cotizaciones
                 · contrapartes · centros · facturas · facturas-recurrentes
                 · negocio
                 · recurrencias · calendario · flujo · backup · importaciones
                 · personalizacion
  seed.ts        datos demo deterministas
shared/
  types.ts       tipos compartidos cliente/servidor
  fechas.ts      aritmética de fechas: recorte de día, meses y semana ISO (puro)
  credito.ts     amortización, parcialidades e interés devengado (puro)
  recurrencias.ts periodos de una plantilla y su clave estable (puro)
  color.ts       contraste WCAG y veredicto por tema (puro)
  inversiones.ts recorrido del historial y unidades en enteros ×10⁸ (puro)
  rendimiento.ts la tasa que anula unos flujos, por bisección, y XIRR encima
                 de ella; null donde no se puede afirmar nada (puro)
  simulador.ts   proyección mes a mes: patrimonio, rendimiento, inflación,
                 retiro y el aporte para una meta (puro)
  negocio.ts     tramos de antigüedad y punto de equilibrio (puro)
  modulos.ts     catálogo de secciones por perfil y su resolución (puro)
  giro.ts        promedio ponderado, horas y rendimiento de un inmueble (puro)
  escalas.ts     marcas del eje y techo de una escala con atípico (puro)
  campos.ts      qué campos pide un movimiento: el único lugar que lo decide (puro)
  atajos.ts      catálogo de atajos y cuándo una tecla lo es (puro)
  formato.ts     cómo se leen las fechas y las cifras de este libro (puro)
  taxonomia.ts   plegar un desglose por categoría a su padre, sin SQL (puro)
  estrategia.ts  bola de nieve contra avalancha, abonar de más y la tasa
                 efectiva de un crédito con comisión (puro)
src/
  views/         Resumen · Movimientos · Cuentas · Categorías · Reportes
                 · Análisis · Tarjetas · Deudas · Inversiones · Simulador
                 · Contrapartes · Cotizaciones · Facturas · Resultados
                 · Contrapartes · Facturas · Negocio · Inmuebles · Horas
                 · Inventario · Recurrencias · Calendario · Flujo
                 · Presupuestos · Metas · Notas · Ajustes
  atajos.ts      el teclado global: dónde está el foco y si hay un modal encima
  components/    formularios, gráficas, sello, barra lateral, barra de registro
                 rápido y la lista de atajos
  styles/        tokens.css (temas claro/oscuro) + app.css
test/            pruebas de integridad contra una base temporal
  auditoria.test.ts       barrido por dominio contra aritmética independiente
  auditoria.cruce.test.ts cuadre entre vistas y redondeo (ver AUDITORIA.md)
data/finply.db   tu libro (gitignored — nunca se versiona)
data/respaldos/  copias automáticas del día (gitignored)
AUDITORIA.md     el informe de la auditoría de las cuentas
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
| `GET/POST /api/categories` · `PATCH/DELETE /:id` | Categorías con su jerarquía de un nivel (`parentId`) y su archivado. El PATCH es parcial: lo que no mandes se queda. Borrar acepta `?reassignTo=` o `?force=true` y **promueve** a las subcategorías |
| `GET/POST /api/categories/reglas` · `PATCH/DELETE /reglas/:id` | Las reglas que proponen categoría al importar, en el orden en que se evalúan |
| `GET/POST /api/tags` · `PATCH/DELETE /:id` | Etiquetas por perfil |
| `GET/POST /api/transactions` · `PATCH/DELETE /:id` | Movimientos (filtros: mes, `from`/`to`, cuenta, tipo, etiqueta, `minCents`/`maxCents`, búsqueda, `conciliado`, `limit`/`offset`). `splits` reparte por categoría; `refundOfId` liga una devolución |
| `GET /api/transactions/export.csv` | Export CSV del filtro completo, sin paginar |
| `POST /api/transactions/conciliar` | Palomea o despalomea partidas en bloque. No mueve ninguna cifra |
| `POST /api/transactions/:id/duplicar` | Copia la partida sin sus ligas |
| `POST/GET/DELETE /api/transactions/:id/adjuntos` | Recibos: imagen o PDF hasta 2 MB, en base64 |
| `GET/POST /api/conciliacion` · `DELETE /:id` | Cortes: el saldo que declaró el banco, con la diferencia contra lo palomeado |
| `POST /api/importaciones/previsualizar` | Analiza un CSV y devuelve el informe. No escribe nada |
| `GET/POST /api/importaciones` · `DELETE /:id` | Lotes de importación y deshacer |
| `GET/POST /api/debts` · `PATCH/DELETE /:id` | Deudas por cobrar / por pagar, con tasa, plazo, enganche y comisión de apertura (`accountId` y `downPaymentAccountId` asientan sus movimientos; el desembolso vale `principal − comisión`) |
| `GET /api/debts/:id/amortizacion` | Tabla de pagos: capital contra interés mes a mes, más lo recibido y la tasa efectiva |
| `GET /api/debts/estrategia?profileId&extraCents` | Bola de nieve y avalancha sobre las mismas deudas y el mismo dinero extra, con la diferencia entre las dos |
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
| `GET/POST /api/notes` · `PATCH/DELETE /:id` | Notas (con fijado), atadas opcionalmente a un movimiento (`txId`) o a un mes (`period`); `?txId=` y `?period=` filtran |
| `GET /api/transactions/sugerencia?profileId` | Lo que propone la barra rápida: la última partida registrada y, por tipo, la cuenta y la categoría de la última vez. **No escribe nada** |
| `GET/POST /api/personalizacion/campos` · `PATCH/DELETE /:id` | Campos propios del perfil. Borrar dice cuántas respuestas se lleva; el tipo no se cambia si ya las tiene |
| `GET/POST /api/personalizacion/plantillas` · `PATCH/DELETE /:id` | Plantillas de movimiento. Borrarlas no toca lo que se asentó con ellas |
| `GET/POST /api/personalizacion/config?profileId` | La configuración del perfil, sin sus datos. Aplicarla es aditivo: crea lo que falta y respeta lo que hay |
| `GET /api/summary?profileId&month&hoy` | Resumen del mes + patrimonio, con el cambio contra el cierre del mes pasado y 30 días de saldo por cuenta. Ingreso, gasto y categorías con la regla de D6 y el reparto de las partidas divididas |
| `GET /api/reportes?profileId&year` | El año: patrimonio mes a mes, ingresos vs gastos, categorías, etiquetas, de dónde vino, tasa de ahorro y mediana |
| `GET /api/reportes/comparativa?profileId&desde&hasta` | Dos periodos cualesquiera, categoría por categoría. Sin el segundo rango, el bloque anterior del mismo largo |
| `GET/POST /api/recurrencias` · `PATCH/DELETE /:id` | Plantillas de lo que se repite (mensual, quincenal, semanal, anual) |
| `GET /api/recurrencias/pendientes?profileId` | La bandeja por confirmar. **Derivada**: no escribe ni guarda propuestas |
| `POST /api/recurrencias/:id/asentar` | Crea el movimiento y marca el periodo, en una transacción. 409 si ya se resolvió |
| `POST /api/recurrencias/:id/descartar` · `/reabrir` | Descartar no mueve el libro; reabrir deshace un descarte |
| `GET /api/calendario?profileId&dias` | Lo que vence: recurrencias, cortes y pagos de tarjeta, deudas y parcialidades |
| `GET /api/alertas?profileId` | Lo vencido y lo que está por vencer. **Derivadas**: no se guardan ni se descartan |
| `GET /api/analisis?profileId&meses` | Colchón, tasa de ahorro, recurrente contra discrecional, concentración, tendencia, estacionalidad, categorías disparadas, gasto hormiga y fuentes de ingreso |
| `GET /api/simulador?profileId&meses&ahorroMensualCents&rendimientoAnualBp&inflacionAnualBp&mesesAporte&retiroMensualCents&objetivoCents` | Las dos rutas —invertir o pagar la deuda— proyectadas sobre las mismas cifras, con rendimiento aparte, lectura en pesos de hoy, etapa de retiro y el aporte que hace falta para una meta |
| `GET /api/contrapartes/:id/tablero?profileId&hoy` | Todo de una contraparte en una hoja: facturado, cobrado, vencido, cotizado sin respuesta y días que tarda en pagar |
| `GET/POST /api/contrapartes` · `PATCH/DELETE /:id` | Clientes y proveedores, con lo que te deben y lo que les debes |
| `GET/POST /api/centros` · `PATCH/DELETE /:id` | La dimensión libre del perfil (proyecto, obra, sucursal) |
| `GET/POST /api/cotizaciones` · `PATCH/DELETE /:id` | Cotizaciones y órdenes de compra, con su vigencia y su estado |
| `GET /api/cotizaciones/resumen?profileId&hoy` | Cuánto hay en la calle esperando respuesta, cuánto ya venció y qué proporción de lo contestado se gana |
| `PATCH /api/cotizaciones/:id/estado` | Darla por perdida, o revivirla |
| `POST /api/cotizaciones/:id/facturar` | Convertirla en factura heredando su contenido. No asienta dinero |
| `POST /api/conciliacion/:id/ajustar` | Asienta la diferencia del corte como movimiento. Se niega si quedan partidas sin palomear |
| `GET/POST /api/facturas` · `PATCH/DELETE /:id` | Facturas emitidas y recibidas, con retenciones. Registrarlas **no mueve el libro** |
| `POST /api/facturas/:id/cobros` | El cobro (o el pago): aquí nace el asiento, con su parte del impuesto |
| `POST /api/facturas/:id/notas` · `DELETE /notas/:notaId` | Notas de crédito: cancelan parte de la factura sin mover un peso |
| `GET/POST /api/facturas/:id/anticipos` | Lo cobrado sin factura, y aplicarlo ligando el movimiento que ya existe |
| `GET /api/facturas/aging?profileId` | Antigüedad de saldos: corriente, 1-30, 31-60, 61-90 y más de 90 |
| `GET /api/facturas/cobranza?profileId` | A quién le hablas hoy, de lo más vencido a lo más nuevo |
| `GET/POST /api/facturas/recurrentes` · `PATCH/DELETE /:id` | Plantillas de factura que se repite |
| `GET /api/facturas/recurrentes/pendientes` · `POST /:id/emitir` · `/descartar` · `/reabrir` | La bandeja derivada y su resolución (R4, R5) |
| `GET /api/negocio/resultados?profileId&desde&hasta` | Estado de resultados, rentabilidad por cliente y por centro, impuestos, equilibrio y el periodo anterior |
| `GET/POST /api/inmuebles` · `PATCH/DELETE /:id` | Contratos de renta sobre un bien, con lo cobrado, el depósito en mano y qué deja la propiedad |
| `GET/POST /api/horas` · `PATCH/DELETE /:id` · `GET /resumen` | Horas con su tarifa y cuánto llevas trabajado sin cobrar, por cliente |
| `POST /api/horas/facturar?profileId` | Todas las horas sin facturar de un cliente, en una factura. No asienta un peso |
| `GET/POST /api/inventario` · `PATCH/DELETE /:id` · `GET /:id/movimientos` | Productos con existencia, costo promedio y costo de lo que salió |
| `POST /api/inventario/movimientos` · `DELETE /movimientos/:id` | Entradas, salidas y ajustes. No mueven dinero |
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
pagado; corregir el desembolso de una deuda con comisión devuelve el principal
con la comisión adentro, porque el movimiento vale `principal − comisión` y las
dos direcciones tienen que ser la misma igualdad;
las parcialidades de una compra a meses suman
exactamente su total y la amortización cuadra al centavo contra el monto
original; la ganancia cobrada y la ganancia en papel de una inversión suman
siempre la ganancia total, al centavo, redondee como redondee la prorrata;
y un movimiento nunca cruza de perfil, ni toma la cuenta o la
categoría de otro libro —ni una categoría de ingreso para un gasto—; y una
recurrencia no puede asentar dos veces el mismo periodo, porque la clave
`(plantilla, periodo)` es única en la base y no una comprobación del código
—si anulas el movimiento que asentaste, ese periodo vuelve solo a la bandeja, y
si esa plantilla aportaba a una inversión, el aporte se va con el movimiento—.
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

La **auditoría de las cuentas** ya se hizo: está en
[AUDITORIA.md](AUDITORIA.md), con lo que se revisó, contra qué, lo que se
encontró y lo que **no** cubre.

**Cómo se usa**

- Recurrencias de monto variable, pausar sin archivar y rejilla mensual en el
  calendario
- Export completo del perfil, no solo movimientos
- Móvil/PWA e internacionalización

Las contribuciones son bienvenidas: abre un issue o un PR. `npm test` corre en
cada PR junto con la verificación de tipos y la compilación.

## Licencia

[MIT](LICENSE) — úsalo, estúdialo, mejóralo y compártelo.
