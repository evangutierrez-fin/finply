# Auditoría de las finanzas de Finply

**Fecha:** 3 de agosto de 2026 · **Esquema:** migración 21 · **Alcance:** todo lo
que Finply calcula con dinero.

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

## Hallazgos abiertos

Se dejan aquí, con nombre y apellido, en vez de arreglarse de paso: cada uno
pertenece a otra fase y arreglarlos aquí sería auditar y reescribir a la vez.

**Hallazgo 2 · `/api/horas/resumen` da dos respuestas a la misma pregunta.**
`importeSinFacturarCents` se calcula **dentro** de la ventana de fechas del
resumen, y la lista `porCobrar` de esa misma respuesta se calcula **sin**
ventana. En el libro demo, mirando agosto de 2026, la respuesta dice
`importeSinFacturarCents: 0` mientras su propia lista suma **$10,825.00** de
julio. Ninguna vista lo enseña —la de Horas suma la lista, que es lo correcto—,
así que hoy no hay una cifra mala en pantalla, pero la respuesta publica dos
verdades. Además, `porCobrar` redondea por cliente y el total redondea una vez,
así que aunque midieran lo mismo podrían separarse por centavos. **No se
arregló porque hay dos lecturas defendibles** —"lo sin facturar del periodo"
contra "todo lo que falta por cobrar"— y elegir una es una decisión de diseño
del módulo de Horas, no de esta auditoría.

**Hallazgo 3 · `PATCH /api/categories/:id` exige el nombre para cambiar el
papel.** Mandar solo `role` responde 400. El cliente siempre manda los dos, así
que nadie lo ve; pero un PATCH que exige un campo que no está cambiando es una
trampa para quien use la API, y lo pisó esta misma auditoría: el estado de
resultados salió con todo el gasto "sin clasificar" y parecía un defecto de
cálculo. No es de dinero, y por eso no se tocó el contrato.

---

## Lo que esta auditoría **no** cubre

Decirlo importa tanto como decir lo que sí.

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

## Cómo volver a correrla

```bash
node --test test/auditoria.test.ts test/auditoria.cruce.test.ts
```

Son 46 pruebas en 8 suites, y corren en menos de dos segundos. Van dentro de
`npm test` como todas las demás.
