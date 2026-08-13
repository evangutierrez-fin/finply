# Auditoría de las finanzas de Finply

**Primera vuelta:** 3 de agosto de 2026 · esquema 21 · todo lo que Finply
calcula con dinero.
**Segunda vuelta:** 6 de agosto de 2026 · lo que la primera dejó fuera a
propósito, más la puerta por donde entran las fechas. Va en su propia sección
al final, con cinco hallazgos de dinero y sus arreglos.
**Tercera vuelta:** 7 de agosto de 2026 · barrido completo del servidor y de la
mitad que dibuja. Siete hallazgos: dos rompen el libro, cuatro hacen que dos
pantallas digan dos cifras del mismo peso, y uno desborda una gráfica. Cierra
además los tres huecos que ella misma había declarado, y el séptimo salió justo
de ahí — de escribir la prueba de uno de ellos.

Finply es un libro de finanzas. Si una cifra está mal, está mal en las
decisiones de alguien. Esta auditoría no agrega una función: **vuelve a hacer
las cuentas**, dominio por dominio, contra aritmética hecha aparte.

La regla que hace que valga algo: **la cifra esperada no puede salir del código
que se audita.** Comparar el código consigo mismo demuestra que es consistente,
no que sea correcto — y esa distinción es la auditoría entera.

Existe porque ya pasó. El saldo insoluto de una deuda estuvo mal desde siempre y
ninguna prueba de un caso lo vio: un crédito de $240,000 se marcaba **saldado
once pagos antes de tiempo**, debiendo todavía $66,882.62, y el Resumen decía
"$0.00 por pagar". Lo encontró un script que registró los 48 abonos y comparó,
pago por pago, lo que decía Finply contra lo que de verdad se debía.

---

## Cómo se auditó

Las pruebas viven en [`test/auditoria.test.ts`](test/auditoria.test.ts) (barrido
por dominio) y [`test/auditoria.cruce.test.ts`](test/auditoria.cruce.test.ts)
(cuadre cruzado y redondeo). **Ninguno de los dos importa los módulos que
audita.** Lo que necesitan lo escriben otra vez, de otra forma:

| Qué se comprueba | Contra qué |
|---|---|
| Cuota nivelada de un crédito | Fórmula cerrada `P·i·(1+i)ⁿ/((1+i)ⁿ−1)`, la de una hoja de cálculo |
| Saldo tras *k* cuotas | Su propia fórmula cerrada, sin mirar la tabla |
| Saldo insoluto tras 48 abonos reales | Un libro paralelo con devengo actual/365 escrito en la prueba |
| Meses hasta liquidar con pago fijo | `n = −ln(1 − i·B/P) / ln(1+i)` |
| XIRR | **Sustitución**: el valor presente a esa tasa tiene que dar cero |
| Saldo de seis cortes de tarjeta | Una lista de apuntes con fecha, sumada a mano |
| Ingresos y gastos de un año | Un libro paralelo con la regla de D6 escrita otra vez |
| Días entre fechas | `Date.UTC`, no la aritmética de fechas de Finply |

Cada dominio se simula **de punta a punta** —la vida entera de un crédito, seis
cortes de una tarjeta, dos años de una inversión, un año de libro, cuatro meses
de presupuesto, una factura cobrada en siete pedazos— porque los defectos que
importan son los que crecen despacio y ninguna prueba de un caso ve.

---

## Qué se auditó, y con qué resultado

### 1 · Amortización y abonos · ✅ sin hallazgos

- La cuota nivelada de $240,000 a 48 meses al 13.5 % da **$6,498.32**, al
  centavo, tanto por la forma de Finply como por la de la hoja de cálculo.
- La columna de capital de la tabla suma **exactamente** el principal, aunque
  cada renglón esté redondeado. `totalPagado − totalInterés = principal`.
- El saldo de cada renglón no se separa de la fórmula cerrada más de un centavo
  por renglón. El defecto viejo se iba a $66,882.
- **Los 48 abonos, uno por uno**: el saldo insoluto que reporta Finply coincide
  con el libro paralelo en los 48, la deuda no se salda antes de tiempo, y
  `abonado = interés + capital` sin un centavo suelto.
- El devengo real (actual/365, días de verdad) y el plan (tasa mensual pareja)
  **no coinciden, y está bien**: la diferencia es menor al 1 %, del tamaño que
  explican los días del mes. Una convención equivocada —actual/360 contra
  actual/365— habría dado ~1.4 %.

### 2 · Tarjetas y meses sin intereses · ✅ sin hallazgos

- Una compra de $10,000.07 en 13 parcialidades reparte el residuo en la última
  y suma **exactamente** el total. Cada parcialidad cae en un corte.
- Los seis cortes de una tarjeta con once movimientos, pagos parciales, un mes
  pagado de más y una compra a meses de por medio: el saldo al corte coincide
  con el libro paralelo en los seis.
- El **cargo ancla queda fuera del saldo al corte** y dentro de la deuda; las
  parcialidades, al revés. Contarlos juntos haría que la tarjeta pidiera el
  doble, y no ocurre.
- Con pago fijo, los meses hasta liquidar son exactamente `⌈−ln(1 − i·B/P) /
  ln(1+i)⌉`, y `totalPagado − totalInterés = saldo`.
- Cuando el mínimo no cubre ni el interés del mes, Finply dice **"nunca
  termina"** en vez de devolver un número.

**Auditado a propósito y correcto:** `deudaCents` **no mira la fecha** —es el
saldo de la cuenta, y en Finply el saldo de una cuenta suma todos sus
movimientos aunque tengan fecha adelantada—, mientras que `saldoAlCorteCents`
sí. No es una contradicción: es la misma convención de la que depende el flujo
proyectado, que pide la caja de hoy *a fecha* justo porque el saldo no lo está.

### 3 · Inversiones y XIRR · ✅ sin hallazgos

- $10,000 puestos y $11,000 sacados un año después dan **10.00 %** exacto.
- En series irregulares —cuatro flujos en fechas cualesquiera, incluido un
  29 de febrero— el valor presente a la tasa que devuelve Finply da **cero**.
  Es la definición del XIRR, comprobada por sustitución.
- Por debajo de 30 días no se anualiza nada: devuelve `null` y la vista lo
  explica. Un +2 % en tres días se anualiza en +900 %, que es ruido con cara de
  dato.
- `ganancia = valor + retirado − aportado` se sostiene **incluso cuando ya
  retiraste más de lo que pusiste**, que es donde un "aportado" con piso en cero
  voltearía el signo de cualquier porcentaje.
- 10 000 títulos a $1,234.57 dan $12,345,700.00 exactos: el producto intermedio
  es 10¹⁹, por encima del entero seguro de JavaScript, y va en `BigInt`.
- Una valuación **por precio** se recalcula cuando aparece un aporte con fecha
  anterior: el precio es el dato, el valor es la consecuencia.

**Nota, no defecto:** el rendimiento cierra su serie con el valor de **hoy** y
no admite un parámetro para fijar la fecha, así que el XIRR de un libro cambia
todos los días. Es correcto —el valor de una inversión es el de su última
valuación *hasta hoy*, que es lo que dicen también el Resumen y los reportes—,
pero obliga a que cualquier prueba se pare en la misma fecha que el servidor.

### 4 · Reportes y tasa de ahorro · ✅ sin hallazgos

Un libro de doce meses con sueldo, gasto corriente, un crédito de $240,000 con
su desembolso y tres abonos, un aporte a inversión, un aporte a meta, un
traspaso entre cuentas propias, un ticket dividido en tres y una devolución:

- Los ingresos y los gastos del año coinciden **al centavo** con el libro
  paralelo, con **D6 escrito otra vez** en la prueba.
- Los doce meses suman el total del año, y ninguno falta.
- El desglose por categoría suma **exactamente** el total; lo mismo el desglose
  por fuente de ingreso.
- El interés de los tres abonos aparece —y aparece sin categoría—; el capital
  no. El préstamo de $240,000 no está en ingresos por ningún lado.
- La tasa de ahorro es la división que el usuario haría a mano.
- La comparativa de dos periodos usa los mismos totales, y cada renglón de
  categoría es la resta exacta de sus dos periodos.

### 5 · Presupuestos · ✅ sin hallazgos

- Lo gastado contra cada tope coincide con el libro paralelo, mes a mes.
- La **cadena de arrastre** rueda en los dos sentidos: enero deja $80,000,
  febrero se pasa por $110,000 y marzo recibe −$30,000. La cadena de cuatro
  meses suma exactamente lo que sobró y lo que faltó, y `arrastreMeses` dice de
  cuántos meses viene.
- Un tope **sin arrastre** empieza de cero aunque tenga meses detrás.
- El **tope total** cuenta todo el gasto del mes, también el de categorías que
  nadie presupuestó — y esa cifra es exactamente el gasto que el Resumen enseña.
- El renglón de un ticket dividido cuenta en **su** categoría; el tope total
  sigue viendo el ticket entero, una sola vez.

### 6 · Facturas e impuesto proporcional · ⚠ **un hallazgo, arreglado**

- Lo cobrable es el total menos las retenciones menos las notas de crédito, con
  piso en cero. Verificado con las cuatro cosas a la vez.
- Siete cobros desiguales dejan el saldo en cero y el impuesto exacto.
- La antigüedad de saldos suma los saldos de las facturas abiertas, y sus tramos
  son una partición: cada factura cae en uno y solo uno.
- El tablero de la contraparte no inventa un saldo propio.

**⚠ Hallazgo 1 · El impuesto trasladado podía pasarse de la factura.**

Cada cobro parcial traslada su parte proporcional del IVA, redondeada al
centavo, y el último cobro ajusta el redondeo contra lo ya trasladado. Con
varios cobros que redondeen **hacia arriba**, para cuando llega el último ya se
trasladó más impuesto del que la factura tiene: el ajuste sale negativo, el piso
lo vuelve cero, y la suma de los cobros se queda por encima del impuesto de la
factura.

No hace falta nada exótico. **Una factura de $11,600 al 16 %, cinco cobros
parciales y un residuo de un centavo**: la suma daba $1,600.01 contra los
$1,600.00 de la factura. El estado de resultados enseñaba ese centavo de más
como IVA trasladado del mes.

*Arreglado* en [`server/routes/facturas.ts`](server/routes/facturas.ts): ningún
cobro puede trasladar más de lo que queda por trasladar, así que el último
siempre cierra en la cifra exacta. Dos pruebas de regresión lo fijan —la
secuencia realista de cinco cobros y una de cuarenta cobros de un centavo—, y
las dos se comprobaron contra el código sin arreglar: fallan.

### 7 · Patrimonio y flujo · ✅ sin hallazgos

- El patrimonio del Resumen es el **último punto** de la serie del año, y no
  solo en el total: cuentas, inversiones, bienes, por cobrar y por pagar
  coinciden renglón por renglón. Si las partes se separan y el total cuadra por
  casualidad, el usuario ve dos historias.
- El flujo proyectado cuadra: `saldo inicial + entradas − salidas = saldo
  final`, exacto, y los eventos listados son los sumandos.
- Cada punto de la serie es el anterior más lo que pasó ese día, los 31 puntos,
  y el mínimo reportado es de verdad el mínimo.
- Un traspaso entre cuentas propias **no aparece** —no mueve la caja—; pagar la
  tarjeta sí, porque la tarjeta no es caja.
- La caja de hoy es la de hoy: el flujo no arranca del saldo de la cuenta, que
  ya descontó el futuro.

### 8 · Cuadre cruzado entre vistas · ✅ sin hallazgos

Las cifras que aparecen en dos lados dan lo mismo al centavo:

| Esto | Contra esto |
|---|---|
| Resumen de cada mes (ingreso y gasto) | Reporte anual, mes a mes, los doce |
| Desglose por día del Resumen | Total del mes del propio Resumen |
| Panel de análisis (12 meses cerrados) | Reporte anual del mismo año |
| Recurrente + discrecional del análisis | Gasto del periodo |
| Concentración y fuentes del análisis | Gasto e ingreso del periodo, con las partes sumando 1 |
| Patrimonio del Resumen | Último punto de la serie del año, renglón por renglón |
| Tope total del presupuesto | Gasto del mes del Resumen |
| Estado de resultados | Reporte anual: ingresos, gasto y utilidad |
| Centros de costo y clientes | El mismo dinero del periodo, sin contarlo dos veces |
| Deuda de la tarjeta | Saldo de su cuenta, con el signo al revés |
| Antigüedad de saldos | Saldos de las facturas pendientes |
| Tablero de la contraparte | Sus propias facturas |

Se comprobó además que el **impuesto no se multiplica por los renglones del
reparto**: un ticket dividido en tres con $1,241.38 de IVA traslada $1,241.38,
no $3,724.14. Es el defecto que ya ocurrió una vez —un `LEFT JOIN` a una tabla
hija multiplica todo lo que viva en el padre— y ahora tiene prueba.

### 9 · Redondeo · ✅ salvo el hallazgo 1

Ninguna suma de partes se aleja de su total:

- Los renglones de un ticket dividido suman el movimiento (lo exige el
  validador).
- Las parcialidades de una compra a meses suman el total, con el residuo en la
  última.
- La columna de capital de una amortización suma el principal.
- Los cobros de una factura suman lo cobrable, y su impuesto suma el de la
  factura (**tras el hallazgo 1**).
- La cadena de arrastre de un presupuesto suma lo que sobró y lo que faltó.
- El desglose por categoría de un año suma el gasto del año; el de fuentes, el
  ingreso.
- Los bloques del estado de resultados suman sus propios renglones.

---

## Hallazgos que quedaron abiertos, y cómo se cerraron

Los dos se dejaron abiertos en la primera vuelta porque arreglarlos ahí habría
sido auditar y reescribir a la vez. Los dos están cerrados hoy.

**Hallazgo 2 · `/api/horas/resumen` da dos respuestas a la misma pregunta.**
`importeSinFacturarCents` se calculaba **dentro** de la ventana de fechas del
resumen, y la lista `porCobrar` de esa misma respuesta **sin** ventana. En el
libro demo, mirando agosto de 2026, la respuesta decía
`importeSinFacturarCents: 0` mientras su propia lista sumaba **$10,825.00** de
julio. Ninguna vista lo enseñaba —la de Horas sumaba la lista, que es lo
correcto—, pero la respuesta publicaba dos verdades bajo un nombre que no
distinguía cuál era cuál.

*Cerrado en la segunda vuelta*, y con las dos lecturas conservadas porque las
dos son legítimas: los campos del periodo se llaman ahora
`minutosSinFacturarDelPeriodo` e `importeSinFacturarDelPeriodoCents`, y el
rezago de todo el historial tiene los suyos, `porCobrarMinutos` y
`porCobrarCents`. Estos últimos son la **suma de los renglones ya redondeados**
de `porCobrar`, así que la cifra grande y la tabla de abajo no pueden separarse
por centavos — que era la otra mitad del hallazgo. La vista dejó de sumar la
lista por su cuenta.

**Hallazgo 3 · `PATCH /api/categories/:id` exige el nombre para cambiar el
papel.** Ya estaba arreglado cuando esta segunda vuelta fue a comprobarlo:
**la Fase 23 lo cerró** al volver opcional el nombre en `categoryPatch`, y
mandar solo `role` responde 200. Lo que quedó vencido fue este documento, que
lo seguía listando como abierto. Es el defecto más barato de todos y el más
fácil de dejar pasar: un informe que se queda viejo miente igual que una cifra.

---

## Lo que la primera vuelta **no** cubrió

Decirlo importa tanto como decir lo que sí. Esta lista es la que le dio su
alcance a la segunda vuelta, y por eso se conserva tal cual.

- **Los módulos de giro** (inventario, horas, arrendamientos) solo entraron por
  la puerta del redondeo, que es de donde salió el hallazgo 2. Su aritmética
  propia —costo promedio, valuación de almacén, rendimiento de un inmueble—
  tiene sus pruebas de la Fase 15, no un barrido de vida entera.
- **El simulador** (Fases 7 y 18) muestra proyecciones con supuestos escritos,
  no cifras del libro; se audita distinto y no entró aquí.
- **El import de CSV** y el respaldo tienen sus propias pruebas y no calculan
  dinero: lo mueven.
- **Nada de esto es una declaración fiscal.** Finply suma lo que el usuario
  anotó; no conoce las reglas de ningún país y no calcula impuestos (R9, R15).

---

# Segunda vuelta · 6 de agosto de 2026

La primera vuelta declaró tres huecos, y esta fue a meterse en ellos: los tres
módulos de giro, el simulador y las dos puertas por donde los datos entran y
salen. Se agregó una cuarta, que no estaba en la lista y resultó ser la más
grave: **la validación de fechas**, que no es de ninguna sección porque las
atraviesa todas.

La regla no cambió — la cifra esperada no puede salir del código que se audita —
y se le sumó una segunda: **lo que se encuentre se reproduce por HTTP antes de
tocar nada**, para no arreglar un defecto que solo existía en la lectura.

## 10 · Fechas · ⚠ **hallazgo 4, arreglado**

**Una fecha que no existe entraba al libro y lo descuadraba en silencio.**

`isoDate` comprobaba la **forma** (`^\d{4}-\d{2}-\d{2}$`) y nada más. Entraban
`2026-13-45`, `2026-00-00`, `2026-02-30` y `0000-01-01`, por cualquiera de las
puertas que llevan fecha: movimientos, abonos, aportes, valuaciones, cortes,
facturas, horas, existencias.

Lo que hacían adentro, comprobado contra el libro: cuatro gastos de $1.00 con
esas fechas dejaron el saldo de la cuenta en **$996.00** —los cuatro contaron— y
el reporte del año **no vio ni uno**. Las fechas de Finply son texto y ordenan
como texto: `substr(date,1,7)` de una de ellas da `2026-13`, que no es ninguno
de los doce meses. El movimiento baja el saldo y no aparece en ningún reporte.
Es la peor forma de descuadre: la que no se nota. Y `2026-02-30` es peor de otra
manera —existe para el texto y no para la aritmética—: en cuanto algo cuenta
días con ella se convierte en el 2 de marzo, así que la misma partida cae en
febrero o en marzo según quién la mire.

*Arreglado* con `esFechaReal` en [`shared/fechas.ts`](shared/fechas.ts), que
comprueba el día contra el calendario de verdad —con la regla gregoriana
completa: 2000 fue bisiesto y 1900 no— y que usan tanto `isoDate` como
`isoMonth`. `diasDelMes` dejó de calcularse con un `Date`, que traduce los años
de dos dígitos al siglo XX y habría contestado por 1926 lo que se le preguntaba
del año 26; por lo mismo, el año va de cuatro dígitos de verdad (`ANIO_MINIMO`).

El **import de CSV escribe sin pasar por el validador de la API**, así que tenía
su propia copia de la regla — y una copia de una regla que debe coincidir es una
regla que se separa. Ahora `parseFecha` usa la misma función, y de paso se cerró
lo suyo: con el año sin rellenar, `0026-03-05` producía la cadena `26-03-05`,
que ni es AAAA-MM-DD ni ordena con las demás.

## 11 · Inventario · ⚠ **hallazgo 5, arreglado**

**Una salida con fecha anterior a su entrada valuaba el almacén al doble y
dejaba el costo de ventas en cero.**

La comprobación de existencia miraba lo que hay **hoy**, no lo que había el día
del movimiento. Diez kilos de café comprados el 1 de agosto a $200 y cinco
vendidos con fecha del 15 de julio: la venta pasaba, porque hoy hay diez. Y
entonces el recorrido del promedio ponderado se hacía contra una cantidad
negativa. Medido contra el libro, esto respondía Finply:

| | Decía | Debía decir |
|---|---|---|
| Costo unitario | **$400.00 /kg** | $200.00 /kg |
| Valor del almacén | **$2,000.00** | $1,000.00 |
| Costo de lo vendido | **$0.00** | $1,000.00 |

Los cinco kilos que quedaban valían lo que costaron los diez, y lo vendido no
había costado nada. No hace falta nada exótico para llegar ahí: basta capturar
la factura de compra el día que llega y las ventas de la semana pasada después.

*Arreglado* en dos capas, porque el defecto tiene dos mitades. La escritura
([`server/inventario.ts`](server/inventario.ts)) mide contra
`existenciaMinimaDesde`: el **punto más bajo del tramo que la fecha alcanza**, y
no lo que hay hoy ni lo que había ese día. Las tres cifras son distintas — con
diez kilos que entran el 1 y diez que salen el 5, hoy hay cero, el día 3 había
diez, y meter una salida el 3 dejaría el día 5 en menos cinco. La lectura
([`shared/giro.ts`](shared/giro.ts)) ya no deja la existencia bajo cero aunque
los datos vengan así —de un libro viejo o de un respaldo—: lo que salió sin
respaldo se apunta como faltante y se valúa con la primera entrada que llega,
que es el único costo que ese anaquel puede conocer. Con eso, lo comprado sigue
siendo igual a lo vendido más lo que queda.

## 12 · Arrendamientos · ⚠ **hallazgo 6, arreglado**

**El rendimiento de un contrato nuevo se anualizaba sobre doce meses que no
habían pasado.**

`meses` era la constante `VENTANA_MESES`, siempre 12, así que "lo cobrado en la
ventana llevado a un año" era lo cobrado en la ventana y ya. Para un contrato de
un año o más está bien y por eso nadie lo veía. Para uno firmado hace dos meses,
no: un local de $20,000 al mes con dos rentas cobradas decía **$40,000 anuales y
3.33 %** cuando son **$240,000 y 20 %** — un sexto de lo que es.

*Arreglado* en [`server/inmuebles.ts`](server/inmuebles.ts) con `mesesEnVentana`,
que cuenta los meses del contrato que de verdad caen dentro. Un contrato que aún
no empieza da `null` en la tasa y no `0`: cero por ciento es una afirmación —"no
te deja nada"— y sería mentira, que es la misma regla que ya regía cuando no hay
valor contra qué medir. La vista dejó de rotular "Cobrado en 12 meses" a secas y
dice los meses que son, con el anualizado al lado cuando son menos de doce.

## 13 · Flujo proyectado · ⚠ **hallazgo 7, arreglado**

**Una renta ya cobrada se contaba dos veces.**

Cada fuente del calendario evita anunciar lo que ya ocurrió, cada una a su
manera: la factura por su saldo, la deuda por sus abonos, la recurrencia por
`recurrence_runs`. Las rentas no evitaban nada. Un inquilino que paga el día 3
la renta que vence el 5 dejaba en el flujo el movimiento asentado **y** el cobro
esperado: $20,000 de renta entraban como $40,000 de entradas. Es la cifra que
contesta "¿llego a fin de mes?", y estaba inflada justo del lado peligroso.

*Arreglado* en [`server/calendario.ts`](server/calendario.ts): las rentas ya
cobradas del mes se saltan, con una sola consulta para todos los contratos. El
único dato para emparejar es el mes del movimiento —un cobro de renta no lleva a
qué periodo pertenece—, así que un pago atrasado tapa el del mes siguiente. Es a
propósito: de los dos errores posibles, no anunciar un cobro que quizá ya ocurrió
es el prudente.

## 14 · Simulador · ✅ sin hallazgos

La primera vuelta lo dejó fuera por ser proyección y no libro. Se auditó igual,
contra aritmética hecha aparte:

- Sin rendimiento, el final es exactamente el líquido más los aportes.
- $100,000 al 7 % durante doce meses dan **$107,000.00 exactos**: la tasa
  mensual efectiva compone a la anual escrita, sin el sobrante que deja
  dividir entre doce.
- En una deuda simulada, `pagado al plan − interés = principal`, al centavo.
- `ahorroParaMeta` devuelve el aporte **mínimo** que llega: con un centavo menos
  no llega. Se comprobó por los dos lados.
- La inflación solo descuenta y no toca una cifra nominal.

## 15 · Lo que no es dinero

Salieron cinco cosas más, ninguna de dinero, todas arregladas:

- Una recurrencia **anual** el día 31 se describía como "el 31 de febrero" — un
  día que ella misma nunca propone, porque al generar la fecha se recorta al
  último del mes. Ahora lo dice como las otras tres periodicidades.
- La vista de **Metas** saltaba de `h1` a `h3`: para un lector de pantalla, un
  índice al que le falta un nivel.
- Los tres campos de **archivo** (importar CSV, restaurar respaldo, aplicar
  configuración) se anunciaban solo como "botón examinar", sin decir qué
  archivo se estaba pidiendo.
- Dos **tablas sin encabezados**: la de facturas por emitir ahora los tiene, y
  el estado de resultados —que no tiene columnas que nombrar, sino conceptos y
  su monto— lleva un `caption` que lo nombra.

## Lo que la segunda vuelta **no** cubre

- **El respaldo no valida fechas al restaurar.** Un archivo hecho antes del
  hallazgo 4 puede traer una fecha imposible dentro, y la restauración la
  aceptará: comprueba llaves foráneas y las reglas de la base, no el calendario.
  Se deja así a propósito —negarse a restaurar el respaldo de alguien es peor
  que restaurarlo con un renglón torcido— pero hay que saberlo.
- **Los adjuntos, la conciliación y la tinta** no se tocaron: no calculan dinero.
- Sigue en pie lo último de la primera vuelta: **nada de esto es una declaración
  fiscal**.

---

# Tercera vuelta · 7 de agosto de 2026

Las dos primeras auditaron **la aritmética**. Esta auditó **las juntas**: los
lugares donde el mismo peso se calcula dos veces, y las puertas por donde entra
lo que nadie previó. Se leyó el servidor entero, los módulos puros y la mitad
que dibuja.

Las dos reglas de siempre siguen: la cifra esperada no sale del código que se
audita, y lo que se encuentre se reproduce por HTTP antes de tocar nada. Se le
sumó una tercera, que es la que ordenó el barrido: **cuando dos pantallas
enseñan la misma partida, se comparan.** Cuatro de los seis hallazgos salieron
de ahí.

## 16 · El techo del dinero · ⚠ **hallazgo 8, arreglado**

**Una cifra sin tope no daba un número raro: dejaba la partida dentro del libro
y cerraba la puerta.**

Ningún campo de dinero tenía máximo. Un `amountCents` de 2⁵³+1 pasaba el
validador, el `INSERT` lo escribía sin quejarse —SQLite guarda enteros de 64
bits— y a partir de ahí `node:sqlite` **se niega a devolverlo**, porque
JavaScript no lo puede representar exacto. Medido: la petición contestó `500
RangeError`, la partida quedó asentada, y desde ese momento cualquier lectura de
esa cuenta tronaba igual. Ni el listado la enseñaba, ni el formulario podía
corregirla, ni el respaldo salía. Es el peor modo de fallar que hay: el que deja
el dato adentro y la puerta cerrada.

Por la puerta del CSV era distinto y peor, porque ahí no hay validador que
valga: `parseMonto` devolvía `1e22` —finito, y no un entero seguro— y se
escribía tal cual. El saldo de la cuenta dejó de ser un entero de centavos y
pasó a ser `1e+22`. El libro entero deja de cuadrar y nadie ve dónde.

*Arreglado* con `MAX_CENTAVOS` —un billón de pesos— en
[`shared/formato.ts`](shared/formato.ts), y desde ahí en **las tres puertas que
escriben dinero**: los 45 campos del validador de la API, `parseMonto` del
import y `parseAmount` del formulario, que ahora lo dice antes de mandar la
petición. Una sola cifra, no tres copias — que es la razón por la que vive en
`shared` y no en el validador. Un billón deja noventa partidas en el tope antes
de acercarse al entero seguro, y es el mismo número que ya acotaba el objetivo
del simulador.

## 17 · Horas · ⚠ **hallazgo 9, arreglado**

**El panel prometía una cifra y la factura pedía otra.**

El importe de un renglón de horas se redondea **una sola vez**, al convertir
minutos por tarifa —así lo hace `mapHora` y así arma su subtotal `facturar`,
para que la factura valga exactamente lo que suman las horas que la respaldan—.
El panel de "por cobrar" no: sumaba `minutos × tarifa` de todos los renglones y
dividía entre 60 al final.

No son la misma cuenta. **Dos renglones de un minuto a $100 la hora**: cada uno
vale `round(10000/60) = 167`, así que la lista suma $3.34 y la factura cobra
$3.34; el panel decía **$3.33**. Un centavo, siempre del lado de prometer menos
de lo que se va a cobrar, y creciendo con el número de renglones. Es la otra
mitad del hallazgo 2 de la segunda vuelta, que ya había obligado a que la cifra
grande fuera la suma de la tabla — y se quedó corta, porque los renglones de esa
tabla también venían del agregado.

*Arreglado* en [`server/horas.ts`](server/horas.ts) con `IMPORTE_RENGLON`, que
suma en SQL los renglones **ya redondeados**. El total del periodo, el rezago,
la tabla por cliente y la factura dan ahora la misma cifra al centavo.

## 18 · La alerta de recurrencias · ⚠ **hallazgo 10, arreglado**

**El Resumen valuaba el atraso nueve veces por debajo de lo que vale.**

Una plantilla de monto variable propone el **promedio de lo asentado**, no la
columna. La bandeja lo hace, el calendario lo hace —está escrito ahí que dos
pantallas no pueden decir dos cifras de la misma partida (D14)— y la alerta del
Resumen leía `amountCents`, la columna fija. Peor: `listar` colgaba el cálculo
del promedio de la misma bandera con la que las alertas piden "sin etiquetas"
para ahorrarse consultas, así que el error solo le pasaba a quien llamaba desde
las alertas.

Medido con una plantilla de $100 fijos y tres asentadas de $900: la bandeja y el
calendario proponían **$900** cada una, y la alerta sumaba **$500** de cinco
partidas que valen **$4,500**. En la única pantalla que el usuario mira todos
los días.

*Arreglado* en [`server/alertas.ts`](server/alertas.ts) y
[`server/recurrencias.ts`](server/recurrencias.ts): la alerta usa
`montoPropuestoCents` y el promedio deja de colgar de la bandera de etiquetas.
Lo que sí se conservó de R11 es no pagar la consulta cuando no sirve — solo se
consultan las plantillas de monto variable, así que un libro sin ninguna cuesta
exactamente lo de antes, y la prueba que cuenta consultas sigue en pie.

## 19 · La alerta de existencias · ⚠ **hallazgo 11, arreglado**

**La vista decía 0 kg y la alerta decía −10 kg del mismo anaquel.**

La segunda vuelta puso el piso en cero en `recorrerExistencias`: lo que salió
sin respaldo se apunta como faltante y la existencia nunca baja de cero. La
alerta no se enteró, porque tenía **su propio `SUM`** en SQL. Basta borrar la
entrada que surtía una salida —o restaurar un respaldo viejo— para que las dos
pantallas se contradigan.

*Arreglado* en [`server/alertas.ts`](server/alertas.ts): la alerta lee `almacen`,
la misma función que pinta la vista, y de paso hereda su `bajoMinimo`. Es lo que
este archivo ya hacía con `estadoTarjetas` y con `listar`, y era la única
familia que se había escrito su propia aritmética.

## 20 · El IVA de una devolución · ⚠ **hallazgo 12, arreglado**

**Devolver una compra aparecía como impuesto que cobraste.**

D6 dice que una devolución es dinero que entra y **cuenta del lado del gasto**;
esa regla ya gobierna los montos, con `TIPO_OPERATIVO`. El impuesto no la
seguía: el estado de resultados sumaba `tax_cents` por `t.type` en crudo.

Medido: una compra de $1,160 con $160 de IVA, devuelta entera, dejaba **$160
trasladados y $160 acreditables** donde lo correcto es cero y cero. El neto
salía bien —por eso ninguna prueba lo vio— y los dos renglones que la vista
enseña **por separado** estaban inflados los dos. Quien mire su IVA trasladado
del mes ve dinero que nunca cobró.

*Arreglado* en [`server/negocio.ts`](server/negocio.ts): el impuesto usa el mismo
`TIPO_OPERATIVO` que decide el lado de los montos, y una devolución entra con el
signo que le toca. No se tocó nada más de la regla — R15 sigue entero: Finply no
conoce el impuesto de ningún país, suma el que el usuario escribió.

## 21 · La barra de composición · ⚠ **hallazgo 13, arreglado**

**Con una tarjeta que se comía la caja, la barra se salía del riel.**

La composición del patrimonio escala contra la suma de sus partes y solo dibuja
las positivas. Cuando una es negativa —"En cuentas" bajo cero, que es
exactamente lo que pasa cuando la tarjeta pesa más que el banco— el divisor
queda por debajo de lo dibujado y los tramos suman más de 100 %.

*Arreglado* en [`shared/escalas.ts`](shared/escalas.ts) con `rielDeComposicion`,
que escala contra **lo que de verdad se pinta** y no deja pasar del riel. Vive
ahí y no en el `.tsx` por lo que ese archivo dice en su encabezado: un ancho mal
calculado se ve perfectamente bien, y dentro de un componente no se puede
probar. Lo negativo no se esconde — sigue en la lista de abajo con su cifra y su
signo, que es la tabla de esta gráfica (R19).

## 22 · Lo que no es un hallazgo: seis copias de la misma cuenta

Mover un mes de texto estaba escrito **seis veces** —en los reportes, en el
panel de análisis, en el Resumen, en los arrendamientos, en el formato del
cliente y, con un `Date` de por medio, en las gráficas—, y `shared/fechas.ts` ya
la tenía. Ninguna daba una cifra mala hoy: cinco no rellenaban el año a cuatro
dígitos y la sexta usaba `Date`, que es justo lo que la segunda vuelta prohibió
por mapear los años de dos dígitos al siglo XX. Son fallas que esperan.

Se consolidaron en `correrMesTexto`, `mesesEntreTexto`, `finDeMes` y
`diasDelMes`. No cambia una sola cifra —hay 916 pruebas que lo dicen— y quita
cinco lugares donde la próxima corrección se puede olvidar.

## 23 · Los tres huecos que la tercera vuelta declaró, cerrados

La primera versión de este informe cerró con tres cosas que dejaba fuera. Las
tres se hicieron después, y una de ellas destapó algo que ninguna sonda había
visto.

### 23a · Las facturas recurrentes entran al calendario y al flujo

La asimetría se veía: un gasto recurrente sin confirmar aparecía en el
calendario y en el flujo, y **la iguala del mes no aparecía en ninguno de los
dos** hasta que alguien la emitía a mano. La respuesta a "¿llego a fin de mes?"
se quedaba corta justo del lado de lo que va a entrar.

Tres decisiones, y las tres se pagan caras al revés:

1. **El evento cae en la fecha de cobro, no en la de emisión.** Emitir no mueve
   un peso (D14): el dinero llega a los días de crédito. En la fecha de emisión,
   la caja de agosto se habría llevado un cobro de octubre.
2. **Solo las plantillas con días de crédito.** Sin ellos, la factura que salga
   nace sin vencimiento y `deFacturas` tampoco dice nada de ella. Suponer que te
   pagan el mismo día infla la caja, que es el error peligroso.
3. **El periodo resuelto se salta.** En cuanto se emite, la factura existe y se
   anuncia por su saldo. Sin esto, el mismo cobro salía dos veces — el hallazgo
   7 otra vez, con otra ropa.

El monto proyectado es lo **cobrable**, no el total: lo retenido no lo va a
mandar el cliente. Va con su propio tipo de evento —`factura_recurrente`, con el
chip punteado— porque un documento que existe no pesa lo mismo que uno que
todavía puede no emitirse. Ocho pruebas, incluida la que comprueba que el flujo
sigue cuadrando y la que emite el periodo y cuenta que el cobro aparezca **una
sola vez**.

### 23b · El respaldo dice qué trae dentro · ⚠ **hallazgo 14, arreglado**

Aquí estaba lo que no se esperaba. La idea era solo *avisar* —restaurar entero y
decir qué venía torcido— y al escribir la prueba se cayó sola: **después de
restaurar un respaldo con una cifra ilegible, el libro ya no se podía
respaldar.** `exportSnapshot` tronaba con el mismo `RangeError` del hallazgo 8.
Un libro que no abre y del que ya no se puede sacar nada.

Así que las dos cosas que puede traer un archivo viejo no se tratan igual, y
tratarlas igual era el error:

| Qué trae | Qué se hace | Por qué |
|---|---|---|
| Una fecha que no existe | Se restaura **tal cual** | El libro abre y los saldos cuadran; solo los reportes del año no la ven. Cuál era la fecha de verdad solo lo sabe el usuario |
| Una cifra que no se puede releer | Se restaura **en un centavo** | Tal cual, la fila entra y ninguna lectura vuelve a contestar — ni el respaldo siguiente |

La regla de fondo no se movió: **negarse a restaurar el respaldo de alguien es
peor que restaurarlo con un renglón torcido** — ese archivo puede ser lo único
que le queda. Lo único que no entra es lo que dejaría el libro sin abrir, la
fila se conserva entera —fecha, concepto, cuenta, ligas— y el valor original
viaja en el informe para volver a escribirlo. Un centavo y no cero porque el
esquema exige `> 0` en casi toda columna de dinero: restaurar obedece las mismas
reglas que todo lo demás.

El aviso se queda en pantalla y **corta la recarga automática**: llevársela sería
llevarse el único aviso que el usuario va a recibir.

### 23c · El formulario dice por qué la cifra no cabe

Con un monto por encima del techo, el formulario contestaba "escribe un monto,
por ejemplo 250 o 1,250.50" — la guía correcta y una respuesta absurda, porque
sí escribió un monto. Ahora dice la razón, con el techo escrito: *"Esa cifra pasa
de $1,000,000,000,000, que es el tope de un libro de Finply. Revisa los ceros."*

La frase la decide **un solo lugar** (`mensajeMonto` en `shared/formato.ts`,
junto al techo) y cada una de las nueve puertas conserva su propia voz para el
otro caso — "para el presupuesto", "para el tope del mes"—, que es lo que evita
nueve frases distintas del mismo techo. Y vive en `shared` y no en el `.tsx` por
lo de siempre: ahí no se puede probar.

## Lo que la tercera vuelta **no** cubrió

- **Un libro que ya tenga una cifra ilegible dentro no se puede exportar.** El
  techo impide crearla y la restauración la aparta, así que solo puede venir de
  un libro anterior a esa vuelta. *Cerrado en la cuarta (§ 24).*
- **Los adjuntos, la conciliación y la tinta**: no calculan dinero. Los
  adjuntos resultaron tener lo suyo, y no era de dinero (§ 27).
- Y sigue en pie lo primero de todo: **nada de esto es una declaración fiscal**.

---

# Cuarta vuelta · 9 de agosto de 2026

Las tres primeras auditaron la aritmética y las juntas. Esta salió de una
pregunta distinta: **¿está lista para compartirse?** Así que fue a lo que
impedía decir que sí — el hueco que la tercera dejó escrito, lo que ninguna
vuelta había leído, y la primera revisión de seguridad del proyecto.

Las tres reglas siguen: la cifra esperada no sale del código que se audita, el
hallazgo se reproduce antes de tocar nada, y **cuando dos pantallas enseñan la
misma partida, se comparan**. Esta vez se le sumó una cuarta, que es la que
encontró la mitad de los hallazgos: **una cifra que suma dos direcciones no es
una cifra**. Y una forma de trabajo nueva: la app se levantó con el libro demo
y se recorrió vista por vista en el navegador, comparando cada titular contra
lo que contesta su propia API. Tres hallazgos salieron de ahí y ninguna prueba
los habría encontrado, porque el error no estaba en el servidor.

## 24 · La salida de un libro envenenado · ⚠ **hallazgo 15, arreglado**

**El hueco que la tercera vuelta dejó escrito, y que era el peor de los suyos.**

El techo del dinero (§ 16) protege a los libros nuevos y la revisión del
respaldo aparta lo que llega en un archivo viejo. Faltaba el tercer caso: quien
**ya** tenía la cifra dentro, escrita con una versión anterior. Para ese libro
las dos salidas —el respaldo JSON y el .zip de "llevarte tus datos"— contestaban
`500` con el mismo `RangeError`, medido por HTTP en las dos. Un libro del que no
puedes salir no es tuyo.

*Arreglado* en `filasCrudas` ([`server/db.ts`](server/db.ts)): si la lectura
lanza `RangeError`, se reintenta esa consulta con `setReadBigInts`. El reintento
vive ahí y no en cada salida porque **las dos tropezaban con lo mismo**. Cada
una escribe después lo que sabe escribir: el respaldo saca la cifra como texto
—lo único que la conserva entera— y el CSV la escribe exacta y desescalada,
porque `escalaCsv` ya trabajaba en BigInt justo para esto. Y el ciclo cierra:
exportar y restaurar el mismo archivo deja el libro sano, con el informe
diciendo qué se apartó.

## 25 · El techo no era del dinero, era del entero · ⚠ **hallazgo 16, arreglado**

**La misma trampa del hallazgo 8, por tres puertas que no eran de dinero.**

`qty_milli` —la cantidad de un movimiento de existencias—, `min_qty_milli` y
`position` son columnas `INTEGER` como los centavos, y ninguna tenía tope. Con
una cantidad de 2⁵³+1, medido por HTTP: el `POST` contestó 500 **y la fila
quedó escrita**, el almacén dejó de abrir, y `GET /api/respaldo` —el libro
entero, no solo ese módulo— contestó 500 también. El techo del dinero no las
cubría porque no son dinero.

*Arreglado* con `MAX_MILESIMAS` en [`shared/giro.ts`](shared/giro.ts) —mil
millones de unidades, con holgura para multiplicarla por un costo— y un tope de
lista para `position`. Y la revisión del respaldo dejó de mirar solo `_cents`:
ahora pregunta al esquema **qué columnas son enteras** y aparta cualquiera que
el libro no pueda releer, con su propio motivo (`cifra`), porque "un centavo" no
significa nada al lado de un kilo. Se le pregunta al esquema y no al nombre a
propósito: un folio de factura es texto y puede ser una tirada larguísima de
dígitos perfectamente legítima.

## 26 · La primera fila decidía por todas · ⚠ **hallazgo 17, arreglado**

**Restaurar perdía datos en silencio, con un 200.**

`importSnapshot` miraba las columnas de la **primera** fila de cada tabla y con
esas armaba el `INSERT` de todas. Correcto mientras el archivo sea homogéneo, y
una pérdida callada en cuanto deje de serlo: si al primer renglón le faltaba el
concepto —un archivo editado a mano, dos respaldos unidos, otro programa— la
columna se caía y **todos los conceptos de la tabla se perdían**. Medido: dos
movimientos, "Primero" y "Segundo"; se le quitó el concepto al primero; después
de restaurar, ninguno de los dos tenía concepto.

*Arreglado* agrupando las filas por la forma que traen: cada renglón entra con
lo que tiene, y una columna ausente se **omite** en vez de mandarse nula, que es
lo que deja a SQLite aplicar su valor por omisión. Un archivo sano tiene una
sola forma y no paga nada.

## 27 · Seguridad · ⚠ **hallazgos 18 y 19, arreglados**

La primera revisión de seguridad del proyecto. Lo que se miró y salió limpio:
inyección de SQL —toda interpolación viene de listas del propio código, nunca de
la petición—, inyección de fórmulas en CSV (ya cubierta), *zip slip*,
contaminación de prototipo por el cuerpo JSON y por un respaldo, el tope de
cuerpo, el catálogo de MIME de los adjuntos, y las dependencias
(`npm audit`: cero, y una de desarrollo actualizada).

**Hallazgo 18 · Cualquier página podía leer el libro entero.** Finply no pide
contraseña porque escucha solo en `127.0.0.1`. Eso es cierto para la red y falso
para el navegador: una página cualquiera puede resolver *su* dominio a
`127.0.0.1` —*DNS rebinding*— y desde ese momento el navegador la considera del
mismo origen, sin CORS que estorbe. Medido con una petición a nombre de
`malicioso.example`: contestó `200` con las cuentas. *Arreglado* comprobando la
cabecera `Host` — lo único que el atacante no puede falsear, porque para rebotar
el DNS necesita un dominio suyo. Pasan `localhost` y las IP literales (contra
una IP no hay DNS que rebotar, y quien puso `API_HOST=0.0.0.0` llega por una);
un nombre propio se declara en `FINPLY_HOSTS`.

**Hallazgo 19 · Un recibo que entraba y ya no salía.** El nombre de un adjunto
se saneaba al meterlo en el .zip y **no** al mandarlo en la cabecera
`Content-Disposition`. Con un salto de línea en el nombre —que el validador
aceptaba— la subida contestaba `201` y la bajada `500` para siempre: un salto de
línea separa dos cabeceras HTTP y Node se niega a mandarla. Es el mismo modo de
fallar que una cifra ilegible, en otro material. *Arreglado* moviendo
`nombreSeguro` a [`shared/archivos.ts`](shared/archivos.ts) y poniéndolo en las
**tres** puertas: la de entrada, la de bajada y la del .zip.

## 28 · Las alertas sumaban ingresos con gastos · ⚠ **hallazgo 20, arreglado**

**Encontrado mirando la app, no el código.**

El Resumen anunciaba "8 partidas por confirmar · **$20,494.24**". La bandeja de
Recurrencias, hablando del mismo montón, decía "8 partidas · **$9,594.24** de
gasto · $2,000.00 a inversión". La cifra del Resumen era la suma de las tres
direcciones: el gasto, el aporte a un fondo propio —que D6 dice que no es
gasto— y el sueldo que **entra**. Un número que no aparece en ninguna otra
pantalla y que no describe nada. La segunda alerta hacía lo mismo: "Suman
$3,450.00 entre todos" juntaba $1,450 de un curso con $2,000 que van a una
inversión.

La bandeja tenía razón desde siempre, pero su aritmética vivía dentro del
`.tsx`, donde no se puede probar, así que la alerta se escribió otra por su
cuenta. *Arreglado* llevándola a `pesoPendiente` en
[`shared/recurrencias.ts`](shared/recurrencias.ts): tres montones y no un neto,
por la misma razón por la que el Resumen nunca neteó "entró" contra "salió". La
alerta enseña lo que sale —de eso avisa una alerta— y **dice** lo que deja
fuera en vez de sumárselo.

## 29 · El calendario tampoco · ⚠ **hallazgo 21, arreglado**

El Calendario decía "Compromisos en 30 días · **$56,300.01**". El Flujo, con la
**misma ventana y los mismos eventos**, decía "va a entrar $52,800.01, va a
salir $3,500.00". La primera cifra era la suma de las otras dos. Nadie tiene un
compromiso de cobrar.

*Arreglado* con `pesoDeEventos` en
[`shared/calendario.ts`](shared/calendario.ts), y aplicado en los dos sitios
donde la vista sumaba: el titular y el pie de la rejilla. Hay prueba de que las
dos cifras del Calendario son las dos del Flujo, al centavo.

## 30 · Dos cosas pequeñas que se ven todos los días

**El patrimonio en cero de una pestaña de fondo.** `useCountUp` anima la cifra
grande del Resumen y de Inversiones con `requestAnimationFrame`, y el navegador
**congela** `rAF` en una pestaña que no se está mirando: el paso intermedio
nunca corre y la cifra se queda en el valor con el que montó, que en la carga
inicial es cero. Un libro abierto en una pestaña de atrás enseñaba `$0.00` de
patrimonio. Se vio en el propio barrido, con el panel oculto. *Arreglado*: con
la pestaña oculta no se anima, se salta al final. **Ninguna cifra puede depender
de que corra una animación.**

**El cero con signo.** El Resumen enseña la salida del mes negando el gasto
(`-expenseCents`), y en un mes sin gastos eso es `-0`, que `Intl` escribe
`−$0.00`. Ni siquiera salía en rojo, porque `-0 < 0` es falso. *Arreglado* en
`pesosCon` y en el camino rápido de `fmtMoney`, que son las dos puertas por las
que se escribe dinero en pantalla.

## Lo que la cuarta vuelta **no** cubre

- **Una renta vencida y no cobrada no aparece en ningún lado.** El calendario y
  el flujo miran de hoy hacia adelante —igual para rentas, facturas y deudas, es
  una decisión y es consistente—, así que la renta de agosto que nadie pagó
  simplemente deja de estar y `proximoCobro` salta a septiembre. Las facturas
  tienen su antigüedad de saldos para eso; los arrendamientos no tienen nada
  equivalente. No se tocó porque no es un error de cuenta: es una vista que
  falta, y eso se decide, no se arregla.
- **`server/migrations.ts` y `server/seed.ts` siguen sin leerse renglón a
  renglón.** El primero está cubierto por `test/migraciones.test.ts` y por el
  hecho de que todo el resto corre encima de él; el segundo solo escribe el
  libro demo.
- **La revisión de seguridad no incluyó una herramienta automática.** Fue
  manual, guiada por las superficies reales de esta app: sin red que la exponga,
  sin autenticación que romper y sin usuarios entre los que escalar.
- **El bundle pesa 645 kB** (169 kB comprimido) y el aviso de Vite sigue ahí. En
  una app local que se sirve desde tu propia máquina no cuesta nada; en cuanto
  alguien la ponga detrás de un dominio, sí.
- Y sigue en pie lo primero de todo: **nada de esto es una declaración fiscal**.

---

## Cómo volver a correrla

```bash
node --test test/auditoria.test.ts test/auditoria.cruce.test.ts
```

Son 46 pruebas en 8 suites, y corren en menos de dos segundos. Van dentro de
`npm test` como todas las demás.

Los hallazgos de la segunda vuelta en adelante tienen sus pruebas de regresión
donde vive cada uno —`test/integridad.test.ts` (fechas, el techo del dinero y el
de las demás magnitudes), `test/giro.modulos.test.ts` (inventario, horas,
rentas), `test/negocio2.test.ts` (el IVA de una devolución y la proyección de
facturas recurrentes), `test/alertas.test.ts` (el monto propuesto y el peso de
la bandeja), `test/escalas.test.ts` (el riel), `test/respaldo.test.ts` (lo que
trae un archivo viejo, la salida de un libro envenenado y las filas
desparejas), `test/exportar.test.ts` (el .zip de ese mismo libro y el nombre de
un recibo), `test/cuadre.test.ts` (el recibo que entraba y no salía),
`test/puerta.test.ts` (a nombre de quién llega la petición),
`test/calendario.peso.test.ts` (las dos direcciones de una ventana),
`test/recurrencias.test.ts` (los tres montones), `test/formato.test.ts` (el
mensaje del techo y el cero sin signo), `test/giro.test.ts` (rendimiento) y
`test/importar.test.ts` (fechas del CSV)—.

Todas se corrieron contra el código **sin arreglar**: las nueve de la segunda
vuelta fallan ahí, y de las dieciocho del primer tramo de la tercera **fallan
doce** —al menos una por hallazgo; las otras seis comprueban que lo que ya
funcionaba sigue igual, y por eso pasan de los dos lados. Es lo que separa una
prueba de regresión de una que solo describe lo que el código ya hacía. Las de
la cuarta también: la del `Host`, la del respaldo desparejo, la de las
existencias imposibles, la del recibo y la de la alerta fallan contra el código
de antes, comprobado quitando el arreglo y volviéndolo a poner.

La suite completa quedó en **963 pruebas**, con `npm run typecheck` y
`npm run build` verdes, y CI en verde sobre Node 24 y 26.
