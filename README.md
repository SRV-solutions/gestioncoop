# GestiónCoop

Plataforma de gestión para cooperativas de servicios: del medidor a la caja, sin papeles y sin planillas.
Cliente piloto: Cooperativa de Agua, Energía y Otros Servicios Comunitarios de Dos de Mayo Ltda. (Misiones).

La especificación completa está en `../SPEC-app-gestion-cooperativa.md`. El nombre (por ahora, GestiónCoop) se cambia
en un solo lugar: `APP_NOMBRE` en `api/src/shared/constants.ts`. Repositorio: `SRV-solutions/gestioncoop`.

**Estado: las nueve fases del SPEC están listas en local** (falta publicarlas). El guion para mostrarla está en
[docs/GUION-DEMO.md](docs/GUION-DEMO.md).

| Fase | Qué incluye | Estado |
|---|---|---|
| 0. Cimientos | Login, sesiones, roles, multi-cooperativa con aislamiento, layout por rol, modo demo, modo claro y oscuro | Lista, en local |
| 1. Padrón + seed | Socios, conexiones, servicios, medidores, sepelio; 2.000 hogares ficticios sobre las calles reales; búsqueda en un solo campo | Lista, en local |
| 2. Tarifas | Cuadros tarifarios versionados, impuestos y cargos configurables, motor de cálculo que reproduce las facturas reales, simulador | Lista, en local |
| 3. Lecturas | Rutas del operario en el celular, sin conexión, con validaciones al instante; control desde la oficina | Lista, en local |
| 4. Facturación | Asistente del mes: control de lecturas, cierre, pre-factura con revisión de las raras, emisión numerada en segundo plano, PDF y nota de crédito | Lista, en local |
| 5. Caja | Apertura y cierre con arqueo, cobro en el mostrador solo con el teclado (lector de código de barras, pago parcial, varios medios), recibo en ticket o A4, venta de gas, anulación con permiso | Lista, en local |
| 6. Portal del socio | Inicio con lo que debe, facturas con «¿Por qué pago esto?», consumo contra su zona, pago online con pasarela de prueba y con el QR del papel, cuenta propia con DNI, reclamos con foto y su seguimiento, cortes programados | Lista, en local |
| 7. Tablero | Seis indicadores y ocho gráficos filtrables por mes, servicio y zona, con cada número enlazado a su detalle; siete informes para bajar en Excel, CSV o PDF; balance de energía | Lista, en local |
| 8. Mapa | Mapa 3D de Dos de Mayo con relieve, día y noche según la hora, una casa por conexión pintada según su deuda; capas de reclamos, cortes, rutas y zonas; mapa de calor de deuda y de consumo; filtros; ficha de cada casa; área dibujada a mano con su resumen y exportación; lecturas en vivo | Lista, en local |
| 9. Pulido | Recorrido de los 7 flujos probado de punta a punta, accesibilidad (contraste, foco, teclado, objetivos táctiles), pantalla de error, guion de demo | Lista, en local |

---

## Estructura

```
api/      Express + TypeScript + Sequelize + PostgreSQL  →  http://localhost:4100/api/v1
client/   React + Vite + TypeScript + Tailwind            →  http://localhost:5180
```

- `api/src/shared/` es el código que comparten los dos lados (roles, validaciones, formato es-AR, tipos).
  El client lo importa como `@shared`; no hay copias que mantener sincronizadas.
- `api/src/modules/*.routes.ts`: una ruta por módulo. `api/src/lib/`: sesión, auditoría, aislamiento, errores.
- `api/src/motor/`: el motor de cálculo de facturas. No toca la base ni mira la fecha de hoy.
- `client/src/features/<área>/`: las pantallas. `client/src/components/`: layouts por rol y piezas de interfaz.

## Cómo levantarla

En dos terminales:

```bash
cd api
npm install      # la primera vez
npm run dev
```

```bash
cd client
npm install      # la primera vez
npm run dev
```

Abrí <http://localhost:5180>. El client redirige `/api` a la API, así que la API tiene que estar corriendo.

`npm run dev` de la API, antes de arrancar:
1. Prende la base de datos local si está apagada. Es una base propia del proyecto, guardada en `api/.data/pg` y en el
   puerto **5440**: no toca otras bases de la PC. Usa los programas de PostgreSQL instalados.
2. Aplica las migraciones pendientes.
3. Carga los datos iniciales que falten (ver abajo).

La primera vez hay que crear `api/.env` copiando `api/.env.example`.

## Usuarios

**Usuarios de prueba** (`DEMO_MODE=true`): entran con su email y la clave de `DEMO_PASSWORD` (en la demo,
`demo1234`). Con `DEMO_MODE=false` no pueden entrar de ninguna forma.

Los botones «Entrar como socio / operario / caja…» de la pantalla de ingreso, que entran sin contraseña, están
**apagados**: se prenden con `DEMO_ACCESO_RAPIDO=true` (sirve para ensayar rápido, no para mandarle la demo a nadie).
Con ellos aparece también el selector entre las dos cooperativas; sin ellos, la segunda se abre con
`/login?coop=arroyodelmonte`.

| Cooperativa | Usuarios de prueba |
|---|---|
| AyE Dos de Mayo | `socio`, `operario`, `operario2`, `operario3`, `caja`, `caja2`, `facturacion`, `gerencia`, `admin` — todos `@dosdemayo.example` |
| Arroyo del Monte (inventada, para mostrar el aislamiento) | `socio`, `operario`, `caja`, `facturacion`, `gerencia`, `admin` — todos `@arroyodelmonte.example` |


**Socios:** no tienen usuario ni contraseña. Entran en «Soy socio» con tres datos de su factura, igual que en la
intranet que la cooperativa ya usa: **código de socio, número de conexión y DNI/CUIT/CUIL** (`POST /auth/acceso-socio`).
Vale el DNI o el CUIT/CUIL que lo contiene, con o sin puntos. Si algo no coincide, el mensaje es el mismo para todo: no
dice qué dato está mal ni si ese socio existe; hay un límite de intentos por conexión de internet. La primera vez se le
arma un usuario por dentro (sin email y con una clave al azar que nadie conoce) para que tenga sesión.

- **La sesión del socio dura 90 días** sin usarse (la del personal, 30) y se renueva con cada uso.
- **«Salir» y «Ver otra cuenta»** están en el menú del usuario. Las cuentas que se abrieron en ese dispositivo quedan en
  la pantalla de ingreso (nombre, código de socio y conexión; **nunca el documento**) y se pueden quitar.
- **Lo que se resigna** (decisión de la cooperativa; el SPEC proponía una contraseña): quien tenga la factura de otra
  persona puede entrar a su cuenta, ver, pagar, reclamar y cambiar el email y el celular de contacto. Si hace falta más
  resguardo, lo más barato es pedir una confirmación extra solo para cambiar los datos de contacto.
- En la demo, la socia de prueba es Marta Benítez: socio `1043`, conexión `1026`, DNI `99.658.939` (inventados).

Todos los nombres son inventados; no hay datos de socios ni empleados reales.

**Superadmin** (nosotros, el proveedor): el de `SUPERADMIN_EMAIL` en `api/.env`, con la clave de `SUPERADMIN_PASSWORD`.
No pertenece a ninguna cooperativa: entra a su panel, elige una y la ve como soporte.

## Datos de prueba

`npm run dev` (o `npm run seed`) carga el padrón de prueba la primera vez, cuando la cooperativa todavía no tiene socios:

- **Dos de Mayo:** 2.000 conexiones y 1.864 socios, con las proporciones del SPEC (energía 100 %, agua ~60 %, internet
  ~700, TV ~450, sepelio ~900 titulares; 85 % residencial, 60 % de ellos con subsidio). 6 zonas urbanas y 4 rurales con
  nombres de barrios y parajes reales, y una ruta de lectura por zona con orden de recorrido.
- **Arroyo del Monte:** 40 conexiones con dirección pero sin coordenadas (el caso de una cooperativa sin padrón georreferenciado).

El generador (`api/src/seed/generar-padron.ts`) es determinístico: misma semilla, mismo padrón. Para volver a
generarlo desde cero: `npm run db:reset`.

También carga las lecturas de prueba, cuando la cooperativa todavía no tiene períodos: 12 meses de historial por medidor
(con estacionalidad) y el mes en curso a medio leer —cerca del 85 % cargado, con ~2 % de anomalías y novedades—. En Dos
de Mayo la ruta 4, del operario de la demo, queda empezada (36 de 160 casas) y la ruta 10 sin empezar. El mes "en curso"
es el del día en que corre el seed.

Y las facturas de prueba, cuando la cooperativa todavía no tiene comprobantes: los 12 meses del historial se emiten
uno por uno con el mismo código que usa la facturación de verdad (motor, numeración, mora). En Dos de Mayo son unas
49.000 facturas; cerca del 18 % de los socios queda con deuda y el 5 % debe tres meses o más. La socia de la demo
(Marta Benítez) tiene subsidio en la energía, consume por encima del tope (unos 250 kWh por mes; el tope es 120) y
debe el último mes: el portal tiene qué explicar y qué pagar.

Y los pagos de ese historial, cuando la cooperativa todavía no tiene ninguno: cada factura paga tiene su pago, con su
recibo numerado (un pago por socio y por mes, entre la emisión y el vencimiento). Cerca del 15 % entró por el pago
online; el resto lo cobraron los cajeros de la demo, y cada día de cobro de cada cajero es una caja cerrada con su
arqueo (algunas con unos pesos de diferencia y su explicación). En Dos de Mayo son unos 21.000 pagos en 210 cajas.
También se cargan los productos del mostrador (garrafa, cilindro, reconexión; precios ilustrativos, a confirmar).

Y los reclamos: 60 en Dos de Mayo (la cuarta parte abiertos, repartidos en el mapa), cada uno con su historial y
tiempos creíbles —lo urgente se resuelve en horas, lo administrativo en días—; uno viejo y resuelto es de la socia de la
demo. Más dos cortes programados para los próximos días (uno de energía en la zona de la socia de la demo, que lo ve en
su inicio) y uno que ya pasó.

Y la energía que entró a la red en cada mes facturado (comprada a EMSA y generada en El Saltito), para el balance del
tablero. **Es inventada:** se arma sumándole a lo facturado pérdidas de entre 9 y 14 %.

Personas, documentos (rango 99.xxx.xxx), teléfonos y emails son inventados. Lo único real son las calles: salen de
OpenStreetMap y están guardadas en `api/src/seed/data/dosdemayo.json` (se regeneran con `api/scripts/osm-import.mjs`).
**Datos del mapa © colaboradores de OpenStreetMap, licencia ODbL.**

## Tarifas y motor de cálculo

La pantalla **Tarifas** (administración, gerencia y facturación; solo administración las cambia) tiene:
- **Cuadros tarifarios:** cuota fija + escalones por servicio y categoría. Un cuadro no se edita: «Nueva versión» crea
  otro que rige desde una fecha y cierra el anterior el día antes. El historial queda.
- **Impuestos y cargos:** porcentajes (sobre cuota fija + consumo, sobre el subtotal o sobre los intereses), montos
  fijos o montos por unidad consumida; por servicio, categoría y condición frente al IVA. También versionados.
- **Planes y mora:** abonos de internet y TV, interés diario, vencimientos y regla de corte sugerido.
- **Simulador:** arma una factura con las tarifas cargadas, sin guardar nada.

El motor (`api/src/motor/calcular.ts`) es una función pura: `calcularFactura(entrada)` devuelve los renglones, los
totales, los avisos y una copia de las tarifas usadas (para guardar con la factura). Dinero con `decimal.js`; cada
renglón se redondea a 2 decimales, medio hacia arriba, y el total es la suma de los renglones.

- La estructura sale de las dos facturas reales de la cooperativa, y `tests/motor-facturas-reales.test.ts` verifica que
  el motor, con las tarifas del seed, dé los mismos importes al centavo.
- `tests/motor.test.ts` cubre los casos borde: consumo cero, vuelta de contador, cambio de medidor, cambio de tarifa a
  mitad de período (prorrateo por días), alta y baja a mitad de mes, lectura estimada y su ajuste.
- `npm run test:motor` mide la cobertura del motor y falla si baja del 95 %.

Qué valores del seed son reales y cuáles ilustrativos está anotado en `api/src/seed/tarifas.ts`.

## Lecturas en campo

El operario entra desde el celular (`/operario`) y ve **Mi ruta de hoy** con el avance de cada ruta.

- **Una casa por pantalla:** dirección, titular, medidor, lectura anterior y consumo promedio; teclado numérico propio y
  grande. Al confirmar pasa sola al otro medidor de la casa o a la casa siguiente del recorrido.
- **Validaciones al instante** (`api/src/shared/lecturas.ts`, las mismas en el teléfono y en la API): lectura menor a la
  anterior → obliga a elegir vuelta de contador o cambio de medidor; consumo mayor a 3× o menor a 0,2× el promedio →
  pide confirmación y foto; igual a la anterior → "sin consumo".
- **Novedades:** medidor roto, sin acceso, perro, casa cerrada, posible fraude, pérdida visible, con foto y nota.
- **Sin conexión:** cada lectura se escribe primero en el teléfono (IndexedDB, `client/src/features/operario/almacen.ts`)
  y después se manda. Sale de la cola recién cuando el servidor la confirma. Cada una lleva un UUID generado en el
  teléfono: reintentar nunca duplica. La barra de arriba muestra siempre si hay señal y cuántas faltan enviar.
- **Lista, búsqueda y mapa:** casas en orden de recorrido, búsqueda por medidor, dirección o titular, y mapa con lo que
  falta y la posición del operario. Cada lectura guarda hora y GPS (si el teléfono lo permite).
- **Recorrido armado por la app:** el orden por defecto es el de la oficina. Con «Recorrido», el operario elige de
  dónde sale —su ubicación, una calle o una casa— y la app ordena lo que falta: va siempre a lo más cercano y después
  deshace los cruces (2-opt). Es una función pura (`api/src/shared/recorrido.ts`, con sus tests) que corre en el
  teléfono, también sin señal. El orden elegido se guarda en el teléfono, por persona y por ruta
  (`client/src/features/operario/recorrido.ts`); no cambia el orden de la oficina. **Las distancias son en línea
  recta:** no conoce el sentido de las calles ni lo que no se puede cruzar. Para caminos reales haría falta la red de
  calles de OpenStreetMap y un ruteador.
- **Mapa de la ruta:** el recorrido que falta, el número de paso de cada casa, cuál sigue y a cuántos metros, y cuántas
  casas y kilómetros quedan. Lo que falta se dibuja encima de lo hecho.
- **Las mismas cuentas en el teléfono y en la oficina:** las dos pantallas muestran medidores leídos, casas terminadas
  y lo que falta. El teléfono usa su copia guardada solo si no está más atrasada que el servidor: si otra persona cargó
  lecturas (la ruta era de otro operario) o cambió la cantidad de medidores, muestra lo del servidor y vuelve a bajar
  la ruta. Las rutas que ya no son suyas se sacan del teléfono, salvo que tengan lecturas sin enviar. «Mi ruta de hoy»
  se actualiza sola cada minuto.
- **Oficina (`/lecturas`):** avance por ruta que se actualiza solo, lecturas para revisar, novedades con su foto,
  medidores sin leer, estimación por promedio de 6 meses y reasignación de rutas. Al elegir a quién pasarle una ruta se
  ve cuánto tiene a cargo cada operario.

**App instalable (PWA):** `npm run build` genera `sw.js` con todos los archivos de la app, para que abra sin señal.
El service worker solo se registra en la versión publicada (no en `npm run dev`) y los navegadores lo exigen sobre
**https** (o `localhost`). Probando desde el celular contra la IP de la compu por http, la app funciona sin señal
mientras la pestaña siga abierta, pero no vuelve a abrir si se la cierra; el GPS tampoco anda sin https.

Las fotos se guardan en la base (`lectura_fotos`), achicadas en el teléfono a 1280 px. Alcanza para la demo; con
volumen real conviene pasarlas a un almacenamiento de archivos.

## Facturación

La pantalla **Facturación** (`/facturacion`: facturación y administración operan; gerencia mira) es un asistente de
cuatro pasos, uno por decisión:

1. **Abrir la lectura** del mes (energía y agua juntas).
2. **Controlar lecturas:** cuántos medidores faltan, cuáles dieron menos que la anterior sin aclarar y qué quedó sin
   revisar. Lo que falta se puede estimar de una vez (promedio de 6 meses). No deja cerrar con medidores sin resolver.
3. **Pre-facturar y revisar:** al cerrar la lectura se calcula la factura de cada servicio de cada conexión —energía
   (con el sepelio como adicional), agua, internet y TV— y quedan como pre-facturas, sin número. El sistema separa las
   **raras** (el servicio cambió más del 50 % contra el mes anterior, importe cero, medidor sin lectura) para mirarlas
   una por una, con el cálculo, la lectura y la foto del operario. Se puede volver a calcular o reabrir la lectura.
4. **Emitir:** numera, pone fecha y vencimiento, deja la deuda cargada y un aviso para cada socio con email.

Cómo está hecho (`api/src/lib/facturacion.ts`, `api/src/modules/facturacion.routes.ts`):

- **Segundo plano con avance:** calcular y emitir corren fuera del pedido y la pantalla sigue la barra de progreso
  (`procesos_facturacion`). En la base de prueba, las ~4.300 facturas del mes se calculan en unos 2,5 s y se emiten en
  menos de 1 s. Uno solo a la vez por cooperativa. Si la API se reinicia en el medio, el trabajo queda marcado como
  interrumpido y al reintentar sigue desde donde quedó. Es una cola en memoria del proceso de la API: con varias
  instancias habría que pasarla a una cola sobre Postgres (`pg-boss`), como pide el SPEC.
- **Numeración correlativa sin huecos:** por tipo, letra (A para responsables inscriptos, B para el resto) y punto de
  venta. Cada lote reserva sus números bloqueando la fila del numerador dentro de la misma transacción que emite.
- **Inmutables:** una factura emitida no se edita. Se anula con una **nota de crédito** por el total (solo si no tiene
  pagos); queda en auditoría. Refacturar un servicio suelto después de anular todavía no está.
- **Lo que guarda cada comprobante:** sus renglones (`comprobante_renglones`), con cada precio, porcentaje y base
  usados, y un resumen en `snapshot_json` (titular, domicilio, lecturas, totales, versiones de tarifa). La suma de los
  renglones siempre es igual al total: lo verifican los tests sobre todo el historial.
- **Mora:** una factura vencida e impaga suma su interés en la factura siguiente del mismo servicio, contado desde el
  vencimiento o desde la factura anterior (lo que ya se cobró no se vuelve a cobrar). Lo que se pagó fuera de término
  también: el interés corre hasta el día del pago y sale en la factura siguiente como «Recargo por pago fuera de
  término». En la caja no se cobra recargo: se cobra lo que dice la factura.
- **Tarifas y meses emitidos:** una tarifa nueva no puede regir desde un mes que ya se facturó.
- **PDF** (`api/src/lib/pdf-comprobante.ts`): encabezado, total y vencimiento, lecturas, gráfico de consumo de 12
  meses, desglose del cálculo, «¿en qué se va tu factura?», código de barras y QR. No se guardan archivos: se arma al
  pedirlo, siempre con lo que el comprobante tiene guardado. El QR apunta a `/pagar/<código>`, que es de la Fase 6.
- **Código de barras:** 32 dígitos (cooperativa, comprobante, vencimiento, importe y verificador), Interleaved 2 of 5.
  `leerCodigoDeBarras` en `api/src/shared/facturacion.ts` es lo que usa la caja para encontrar la factura.
- **Simulados** (`api/src/proveedores/`): factura electrónica (`ProveedorFiscal`: inventa un código con forma de CAE,
  y los PDF dicen «DEMO — sin validez fiscal») y avisos (`ProveedorNotificaciones`: quedan en la tabla
  `notificaciones`, no se envían).

Pendiente de este módulo: nota de débito, nota de crédito parcial y refacturación de un servicio; la factura final de
un servicio dado de baja (hoy los servicios de baja no se facturan).

## Caja y cobranza

La pantalla **Caja** (`/caja`: cobran el cajero y administración; gerencia mira) está pensada para usarse sin el mouse:

| Tecla | Qué hace |
|---|---|
| `F2` | Vuelve al buscador, desde cualquier parte, y arranca un cobro nuevo |
| `↑` `↓` `Enter` | Elegir un socio de la lista y abrirlo |
| `Tab` `Espacio` | Moverse entre las facturas y marcarlas o desmarcarlas |
| `E` `T` `D` `C` `Q` | Medio de pago: efectivo, transferencia, débito, crédito, QR |
| `G` | Abrir o cerrar «Gas y otros conceptos» |
| `Enter` | Cobrar. Después del cobro, pasar al siguiente |
| `T` `A` | Con el recibo a la vista: imprimir ticket de 80 mm o A4 |
| `F4` | Venta de mostrador a alguien que no es socio |
| `Esc` | Cancelar el cobro |

1. **Abrir la caja** con el efectivo que hay en el cajón (fondo inicial). Una sola abierta por cajero.
2. **Buscar** en un solo campo: nombre, documento, número de socio, de conexión o de medidor, o el **código de barras**
   de la factura. El lector tipea el código y manda Enter: se abre el socio con esa factura ya elegida. Si el código
   se leyó mal, es de otra cooperativa o la factura ya está paga, avisa en lugar de traer cualquier cosa.
3. **Cobrar:** llega todo lo que debe ya marcado, de lo más viejo a lo más nuevo. Se tipea con cuánto paga y `Enter`:
   el vuelto aparece al instante. Para un **pago parcial** se escribe el importe y se aplica desde la factura más
   vieja. En el mismo cobro se puede sumar gas u otro concepto (descuenta stock).
4. **Recibo:** queda el vuelto en grande y el recibo listo para imprimir, en ticket o A4 (PDF armado al pedirlo).
5. **Cerrar con arqueo:** el sistema dice cuánto efectivo tiene que haber (fondo + lo cobrado en efectivo) y se carga lo
   contado —el total, o billete por billete—. Si no coincide, hay que escribir qué pasó; la diferencia queda guardada.

Cómo está hecho (`api/src/lib/caja.ts`, `api/src/modules/caja.routes.ts`):

- **Un cobro, un recibo:** cada fila de `pagos` lleva su número de recibo (correlativo por letra y punto de venta, con
  el mismo numerador bloqueado que usan las facturas) y una copia del titular. `pago_aplicaciones` dice a qué
  facturas se aplicó y cuánto; `pago_items`, qué productos se vendieron.
- **Saldo = total − pagos acreditados aplicados**, siempre: lo verifican los tests sobre todo el historial.
- **Nada se cobra dos veces:** el cobro corre en una transacción que bloquea la caja, las facturas y el stock. Si dos
  cajeros cobran la misma factura a la vez, cobra uno y al otro le avisa. Y cada cobro lleva una clave que genera la
  pantalla: si el pedido sale dos veces (doble Enter, reintento por mala señal), el segundo devuelve el mismo recibo.
- **Cobros inmutables:** no se editan ni se borran. **Anular** un cobro lo puede hacer solo administración, con motivo:
  las facturas vuelven a deberse, el stock vuelve, el recibo queda marcado como anulado y todo va a auditoría. El
  arqueo de una caja ya cerrada no cambia.
- **Plata sin decimales flotantes:** en el servidor, `decimal.js`; en la pantalla, las sumas van en centavos enteros
  (`aCentavos`, `repartirPago` en `api/src/shared/caja.ts`).
- En la ficha de cada factura (Facturación → Comprobantes) se ven los pagos que recibió.

Pendiente de este módulo: planes de pago en cuotas; cobrar una misma operación con dos medios (hoy son dos cobros);
factura de mostrador para la venta de gas (hoy sale solo el recibo); pantalla para cargar productos y reponer stock
(se cargan por seed); que administración cierre la caja que un cajero dejó abierta; planilla de cierre para imprimir.
El pago online y la conciliación con el banco son de la Fase 6.

## Portal del socio

Pensado para el celular y para gente mayor (letra de 18 px, botones grandes, barra de 4 ítems, dos niveles como mucho):

- **Inicio:** «Debés $ X» o «Estás al día», el vencimiento, el botón para pagar, los cortes programados de su zona y
  sus reclamos en curso.
- **Facturas:** todas, con su estado y el PDF. Cada una explica **«¿Por qué pago esto?»**: una barra con en qué se va
  la plata (cuota fija, consumo con subsidio, consumo sin subsidio, impuestos, adicionales, intereses), cuánto entró en
  el tope subsidiado y cuánto se pasó, y frases cortas («Tenés subsidio en los primeros 120 kWh. Este mes consumiste 224
  kWh: 104 kWh quedaron por encima del tope…»). La cuenta la hace la API (`api/src/lib/explicar.ts`) con lo que la
  factura tiene guardado; los colores de la barra son fijos por parte y están validados para visión de colores reducida.
- **Consumo:** los últimos 12 meses de energía y agua, contra el mes anterior y contra el promedio de su zona (mismas
  conexiones de su categoría), con la tabla para quien prefiere números.
- **Más:** reclamos, mis pagos (con los recibos), mis conexiones, sepelio y mis datos (email, celular y adhesión a la
  factura digital).

## Pago online

El socio elige qué facturas paga, ve el total y un botón «Pagar $ X»; va a la pasarela y, al volver, ve el recibo y lo
que sigue debiendo (SPEC 6.6.1). También se paga **con el QR de la factura de papel**, sin tener cuenta
(`/pagar/<código>`): muestra solo lo justo para reconocer la factura, sin nombres ni domicilios.

- **Proveedor detrás de una interfaz** (`api/src/proveedores/pagos.ts`): `crearIntento`, `confirmarRetorno`,
  `procesarNotificacion` y `consultarEstado`, como pide el SPEC para enchufar después Macro Click de Pago. Hoy está la
  **pasarela de prueba** (`/pasarela/<id>`): hace de banco, no pide datos de tarjeta y deja aprobar, simular un
  rechazo o cancelar.
- **Se acredita solo con el aviso del banco** (servidor a servidor, `POST /api/v1/pagos/notificacion/<proveedor>`,
  firmado) **o consultándole el estado** cuando el socio vuelve. La vuelta del navegador nunca acredita.
- **Nada se cobra dos veces:** el intento es el «TransaccionComercioId»; se bloquea al acreditar y el pago guarda su id
  (único). Un aviso repetido o apretar dos veces «Pagar» no hacen nada.
- Un intento vence a los 30 minutos sin respuesta. Si el banco aprobó, se acredita igual aunque haya vencido.
- Si una factura se pagó por otro lado mientras tanto (en la caja), lo cobrado de más queda **a favor del socio** y
  el recibo lo dice.
- Un pago online es un `pago` más (origen `online`, sin caja), con su recibo numerado y aviso por email.

## Reclamos y cortes

- **El socio reclama** desde la app en pocos toques: qué servicio, qué pasa (en sus palabras, con un consejo antes
  cuando corresponde: «fijate si saltó la llave térmica»), una foto y su ubicación (o la de su casa). Sigue el reclamo
  paso a paso; ve lo que la cooperativa deja visible, nunca los nombres del personal.
- **La oficina** (Reclamos: administración atiende, gerencia mira) toma reclamos por teléfono, ve lo urgente y lo más
  viejo primero, asigna la cuadrilla, lo marca en curso y lo resuelve contando qué se hizo. Cada paso queda en el
  historial y le llega un aviso al socio. Notas internas, que el socio no ve.
- **Cortes programados:** por zona o en toda la localidad, con día, horario y motivo. Al cargarlo se avisa por email a
  los socios de la zona con ese servicio, y aparece en el inicio de su app. Se puede cancelar.
- Simulados: los avisos quedan en la tabla `notificaciones` (no se envían). Las cuadrillas son una lista de ejemplo.

Pendiente de estos módulos: el proveedor real de pagos (falta la documentación técnica y las credenciales de prueba
de Macro, como dice el SPEC) y la conciliación con su liquidación; devolver o aplicar el saldo a favor; avisar la
cancelación de un corte; cargar la foto de un reclamo desde
la oficina; los reclamos y cortes en el mapa (Fase 8); energía prepago.

## Tablero e informes

Tablero (`/gerencia`): gerencia y administración. Informes (`/informes`): también facturación.

**Qué cuenta cada indicador** (las definiciones están en `api/src/shared/tablero.ts`; el criterio del SPEC es que cada
uno coincida con una consulta directa a la base, y `api/tests/tablero.test.ts` lo comprueba calculándolos por otro
camino):

| Indicador | Qué es |
|---|---|
| Facturado | Total de las facturas del mes elegido (emitidas o pagas; las anuladas no cuentan) |
| Cobrado | Lo que ya se pagó **de esas facturas**, se haya cobrado cuando se haya cobrado |
| Cobrabilidad | Cobrado / facturado |
| Deuda | Saldo de todas las facturas sin pagar **a hoy**, de cualquier mes. «Vencida»: las que pasaron su vencimiento. «Socios en mora»: los que tienen al menos una vencida |
| Consumo | kWh y m³ facturados en el mes elegido |
| Reclamos abiertos | Los que hoy no están resueltos |

- Sin elegir mes, muestra **el último facturado** (el que está en lectura tendría todo en cero); se puede elegir
  cualquiera. Los filtros de mes, servicio y zona van en la dirección de la página: se puede compartir el enlace.
- **Recaudación** es otra cosa que «cobrado»: lo que entró en el mes calendario por fecha de cobro (facturas de
  cualquier mes y ventas de mostrador). Con filtro de servicio o zona, solo lo aplicado a esas facturas.
- Gráficos: facturado y cobrado de 12 meses, deuda por antigüedad, recaudación por medio de pago y por cajero, consumo
  por zona, conexiones por escalón de consumo (los escalones son los de la tarifa residencial de ese mes), avance de
  lecturas, reclamos por tipo con su tiempo de resolución y balance de energía. Cada uno se baja en CSV y los de
  columnas tienen su tabla.
- Se actualiza solo cada 20 segundos: un cobro de la caja o una lectura del operario aparecen sin recargar.
- **Balance de energía:** energía que entró a la red (comprada + generada) contra la facturada; la diferencia son las
  pérdidas. Administración carga o corrige los kWh de cada mes desde la misma tarjeta (queda en auditoría). Los nombres
  («EMSA», «El Saltito») salen de la configuración de la cooperativa (`config.energia`).
- Colores de las series: los dos primeros de la paleta validada para visión de colores reducida (`--serie-1`,
  `--serie-2` en `client/src/styles.css`), con su versión para el tema oscuro.

**Informes** (`api/src/lib/informes.ts`): deuda por socio, cortes sugeridos, libro de ventas, recaudación diaria,
lecturas del mes, consumos por zona y padrón. En pantalla van las primeras 200 filas con los totales del informe
completo; el archivo las trae todas.

- Excel (`exceljs`): importes y fechas como números y fechas de verdad, con filtro y encabezado fijo. CSV: punto y
  coma y coma decimal, como lo abre el Excel en español. PDF: A4 apaisado con el encabezado en cada hoja.
- Un texto que empieza con `=`, `+`, `-` o `@` sale con un apóstrofo adelante: un nombre no puede terminar siendo una
  fórmula al abrir el archivo.
- Cada exportación queda en auditoría (quién, qué informe, con qué filtros, cuántas filas).
- **Cortes sugeridos:** servicios activos con tantas facturas vencidas como fija la cooperativa (2 por defecto). Es una
  lista para decidir; el sistema nunca corta solo.
- **Libro de ventas:** por fecha de emisión. La columna «IVA» suma los conceptos cuyo código empieza con `IVA`: es
  una convención, a revisar si la cooperativa nombra distinto sus conceptos.

Pendiente de este módulo: comparar contra el mismo mes del año anterior; elegir un rango de fechas libre; programar
el envío de un informe por email; libro de ventas con el formato de importación de ARCA; pérdidas de energía por zona
(hace falta medir cada alimentador).

## Mapa

`client/src/features/mapa/`. MapLibre GL JS con:
- mapa base vectorial de **OpenFreeMap** (datos de OpenStreetMap; sin clave ni registro, uso comercial permitido, con
  atribución, que MapLibre muestra sola) y relieve de **AWS Terrain Tiles**;
- un estilo propio (`estilo.ts`) cuyos colores salen de una paleta día / atardecer / noche. La fase se calcula con la
  posición real del sol en la cooperativa (`sol.ts`), así el mapa se ve de día o de noche según la hora;
- las conexiones en una sola capa (casas 3D de cerca, puntos de lejos y grupos con su cantidad más lejos todavía): no
  hay un marcador por punto.

Si algún día hace falta no depender de servidores de terceros, OpenFreeMap se puede alojar por cuenta propia.

**De qué color va cada casa** (`api/src/shared/mapa.ts`, la regla es una sola para el mapa, la API y los tests):

| Color | Situación | Qué es |
|---|---|---|
| Verde | Al día | No debe nada |
| Ámbar | Con deuda | Debe algo, sin llegar a la cantidad de facturas vencidas del corte sugerido |
| Rojo | En mora | Llegó a esa cantidad (2 por defecto): son las mismas casas del informe de cortes sugeridos |
| Gris | Cortado | El servicio está cortado, deba lo que deba |

Con un servicio elegido, la situación es la de ese servicio; con «Todas», la más urgente de la casa (mora, después
deuda, después corte). Los tonos son los mismos de día, al atardecer y de noche —más claros de noche—: el color
significa lo mismo a cualquier hora, y de noche las casas con luz se ven encendidas por su halo.

- **Dos pedidos separados:** `/mapa/conexiones` trae las casas (cambian poco) y `/mapa/capas` lo que se pinta encima
  —deuda y consumo por casa, reclamos abiertos, cortes programados—, que se vuelve a pedir cada 30 segundos.
- **Filtros:** servicio, situación (tocando la leyenda, que muestra cuántas casas hay de cada color), zona, categoría
  y rango de consumo del último mes facturado. Abajo dice cuántas casas se ven y cuánto deben.
- **Capas:** reclamos abiertos (un punto que late; los urgentes, más grandes), cortes programados (la zona marcada con
  su cartel), rutas de lectura, zonas, relieve y mapa de calor de deuda o de consumo.
- **Ficha de una casa:** titular, situación, lo que debe, servicios, consumo de 12 meses, última lectura, reclamos
  abiertos y los accesos «Ver ficha», «Cobrar» y «Crear reclamo» (cada uno solo para quien puede hacerlo). Se puede
  llegar directo con `/mapa?conexion=<id>`.
- **Dibujar un área:** clic para cada vértice; doble clic, Enter o el botón la cierran; Escape cancela. El resumen
  (deuda, conexiones, en mora, consumo, reclamos) es de las casas que quedaron adentro **con los filtros puestos**, y
  esa lista se baja en Excel, CSV o PDF (queda en auditoría). El mapa decide qué casas entran y manda sus ids; la API
  responde solo por las de la cooperativa.
- **Lecturas en vivo:** las casas pasan a verde a medida que la cuadrilla carga lecturas (se consulta cada 5
  segundos); las recién leídas destellan unos segundos. Ámbar: leída con una novedad o anomalía sin revisar.
- Las cuentas se hacen sobre columnas (`vista.ts`): la vista entera se rehace con cada filtro y cada dato nuevo.

Con 10.000 casas inventadas, rehacer la vista tarda unos 28 ms por cada cambio de filtro (medido en una PC de
escritorio). Lo que no se midió es el dibujo en pantalla con esa cantidad: la demo tiene 2.000.

Pendiente de este módulo: verlo dibujado con 10.000 puntos reales; guardar un área dibujada con nombre;
editar los vértices después de cerrarla; ver en el mapa la posición de las cuadrillas.

## Tutoriales con Solvix

Solvix es el astronauta de SRV. La primera vez que alguien entra, se presenta solo; después, cada tutorial lleva a la
pantalla que corresponde, ilumina el elemento del que habla y lo explica. Se pueden omitir siempre y volver a ver desde
el menú del usuario → **Tutoriales**.

- `client/src/features/tutoriales/`: `catalogo.ts` (qué dice cada paso y para qué rol; el orden es el recorrido
  sugerido), `TutorialHost.tsx` (el motor, montado una vez en `App`), `estado.ts` (`iniciarTutorial(id)` desde cualquier
  pantalla) y `Solvix.tsx` (el dibujo, animado con CSS en `styles.css`).
- Un enlace con `?tutorial=<id>` abre ese tutorial.
- Cada paso señala su elemento con un selector CSS. Si la pantalla cambia y el elemento ya no está, Solvix lo explica
  igual en el centro: **al tocar una pantalla, conviene repasar su tutorial**.
- El avance (hechos y omitidos) se guarda en la cuenta: `usuarios.tutoriales_json`, `GET`/`PUT /auth/tutoriales`.
- En la demo, los usuarios de prueba se comparten: después de mostrarla, «Empezar de cero» (en Tutoriales) hace que
  Solvix vuelva a presentarse. `npm run db:reset` también.

## Manual de uso

`docs/GestionCoop-Manual.pdf` (22 páginas, no va al repo) explica cada sección, quién ve qué y con qué datos entrar a la demo. Se arma
desde `docs/manual/` (`index.html`, `contratapa.html`, `manual.css`, `img/`):

```
python docs/manual/build.py      # necesita Google Chrome y PyMuPDF (pip install pymupdf)
```

Las capturas de `img/` son de la base de prueba. Si cambia una pantalla, hay que volver a sacarlas a mano.

## Imagen de la cooperativa

En **Cooperativa** (`/cooperativa`), gerencia y administración suben el logo o una foto. La pantalla la recorta en
cuadrado (512 px, tomando el centro) antes de mandarla; aparece en la pantalla de ingreso y arriba de cada pantalla.

- `PUT` y `DELETE /mi-cooperativa/imagen` (gerencia y administración). Se acepta JPG, PNG o WebP, y se mira el
  contenido del archivo además de lo que dice ser. Cada cambio queda en la auditoría.
- La imagen se guarda en la base (`cooperativa_imagenes`) y se sirve sin sesión, porque la muestra la pantalla de
  ingreso: `GET /publico/cooperativas/<id>/imagen?v=<marca>`. La dirección cambia con cada imagen.
- No hay un rol «presidencia»: hoy la cambia quien tenga el rol de gerencia.
- El logo de Dos de Mayo en la demo es el que publica la cooperativa en su sitio (coopaye.coop.ar). Está en
  `api/src/seed/data/marcas` y el seed lo carga si la cooperativa no tiene uno: la parte «AyE» como isotipo de la app y
  el logo completo para la factura.

## Panel de SRV: comisión y diseño de la factura

El superadmin (SRV) ve en **Cooperativas** (`/superadmin`) cuánto le cobra a cada cooperativa en el mes, y en
**Comisión y factura** (`/superadmin/cooperativas/<id>`) maneja las dos cosas de cada una.

**Comisión por factura** (`api/src/lib/srv.ts`, tabla `comisiones_srv`):

- Un porcentaje de cada factura que emite la cooperativa (la propuesta inicial es **0,8 %**) y, si se quiere, un
  monto fijo por factura. Se cambia cuando se quiera (1 %, 0,5 %…).
- Va por **vigencias**, como las tarifas: un cambio rige desde una fecha (hoy o más adelante) y cada factura paga la
  comisión que regía el día en que se emitió. Una comisión que todavía no rige se puede borrar; las que ya rigieron
  quedan en el historial. Cada cambio queda en la auditoría.
- Cuentan las facturas y notas de débito emitidas. Las **notas de crédito descuentan** el porcentaje de lo que acreditan
  (el fijo no se devuelve): una factura anulada no termina cobrándose. Se calcula factura por factura y se redondea el
  total del mes.
- **No cambia la factura del socio:** es lo que SRV le cobra a la cooperativa. Si la cooperativa quisiera trasladarlo,
  se cargaría como un concepto más en Tarifas, pero en energía y agua las tarifas son reguladas: primero hay que
  consultarlo con el ente y con un contador.
- En la demo, las dos cooperativas tienen 0,8 % desde enero de 2025 (lo carga el seed), así la liquidación tiene meses
  para mostrar. `api/tests/srv.test.ts` vuelve a calcular cada número factura por factura.

**Diseño de la factura** (`config_json.factura` de la cooperativa; el PDF en `api/src/lib/pdf-comprobante.ts`):

- Logo propio de la factura (PNG o JPG, con sus proporciones; si no hay, va el isotipo), color, hasta tres renglones
  extra en el encabezado (ingresos brutos, inicio de actividades…), un aviso destacado para todos los socios y un texto
  legal al pie.
- «Ver cómo queda» arma la última factura emitida con los cambios todavía sin guardar. Al guardar, todas las facturas
  que se abran desde ese momento (también las del portal del socio) salen con el diseño nuevo: el PDF se arma al
  pedirlo, con lo que la factura tiene guardado.
- Rutas: `GET /cooperativas/<id>`, `POST /cooperativas/<id>/comisiones`, `DELETE /cooperativas/<id>/comisiones/<id>`,
  `GET /cooperativas/liquidacion?anio=&mes=`, `PUT /cooperativas/<id>/factura`, `PUT|DELETE|GET /cooperativas/<id>/factura/logo`,
  `POST /cooperativas/<id>/factura/muestra`. Solo el superadmin.

## Presentación y videos para la cooperativa

En `docs/presentacion/` están las fuentes del material para mostrarle la plataforma a una cooperativa. Lo generado va
a la carpeta **«GestionCoop - material para la cooperativa»**, al lado del proyecto (fuera del repo):

```
node docs/presentacion/capturas.mjs     # capturas en tema claro (escritorio y celular)
python docs/presentacion/build.py       # presentación en PDF y una imagen por diapositiva
node docs/presentacion/videos.mjs       # cuatro videos (vecino, operario, oficina, gerencia) y uno que los une
```

Usan Chrome sin ventana por el protocolo de DevTools (`cdp.mjs`, sin dependencias) y ffmpeg. Necesitan la API y el
cliente corriendo. No escriben en la base: no confirman pagos ni lecturas y no abren la caja; el avance de tutoriales de
cada usuario de prueba queda como estaba. **No usar capturas de la caja**: pueden mostrar cajas de prueba de personas
reales. `panel-srv.mjs` saca capturas del panel de SRV para revisarlo (entra como superadmin con los datos de
`api/.env`, sin mostrarlos).

## Pulido y accesibilidad

- **Recorrido de la demo:** `api/tests/demo.test.ts` hace los siete flujos de la sección 11 del SPEC encadenados y en
  orden, contra la API: lo que carga el operario llega al mapa y a la factura, la socia ve y paga esa factura, el cobro
  de la caja y el pago online aparecen en el tablero, y la segunda cooperativa no ve nada de eso.
- **Contraste (AA):** se midieron los pares de color de `styles.css` en claro y en oscuro. Se corrigieron el verde de
  éxito, el botón principal al pasar el mouse en oscuro, el texto de ayuda de los campos, el borde de los campos
  (token `--campo`, 3 a 1 contra el fondo) y el anillo de foco (token `--foco`).
- **Teclado y lector de pantalla** (`client/src/lib/pagina.tsx`): cada pantalla pone su título en la pestaña, el
  primer Tab ofrece «Saltar al contenido» y, al cambiar de pantalla, el foco va al contenido nuevo (salvo que la
  pantalla ya lo haya puesto en un campo propio, como el buscador de la caja).
- **Objetivos táctiles:** se revisaron todas las pantallas buscando botones y campos de menos de 44 px. El portal del
  socio no tenía ninguno; se agrandaron los del mapa, las pestañas del tablero y la barra del operario.
- **Pantalla de error:** si una pantalla se rompe por un error nuestro, se muestra un mensaje con cómo seguir en
  lugar de quedar en blanco (`client/src/components/ErrorBoundary.tsx`). Si es una pestaña vieja después de publicar
  una versión nueva, lo dice.
- **Animaciones:** las transiciones duran entre 150 y 250 ms y tienen un motivo (entrar a una pantalla, confirmar).
  Lo que late —la carga, los reclamos del mapa— es más lento a propósito. Con «reducir movimiento» activado en el
  sistema, se apagan.

**Lighthouse** (SPEC 12: 90 o más en celular para el portal del socio y el operario) **no está medido.** Para medirlo:
`npm run build` y `npx vite preview` en `client/`, abrir la pantalla en Chrome, F12 → Lighthouse → «Móvil». Conviene
hacerlo sobre la versión publicada, que es la que va a usar la gente.

## Qué falta para usarla de verdad

En orden de lo que destraba más:

1. **Publicarla** (Railway + Netlify, con https). Recién ahí se puede probar en celulares reales: instalar la app,
   trabajar sin señal después de cerrarla, GPS y cámara. También ahí se mide Lighthouse.
2. **Datos reales de la cooperativa:** padrón, tarifas vigentes de todas las categorías y la migración desde el
   sistema actual (hay que relevar en qué formato exporta).
3. **Facturación electrónica** con ARCA (hoy simulada): hace falta el certificado de la cooperativa.
4. **Pago online real** con Macro Click de Pago (hoy simulado): hace falta la documentación técnica y las
   credenciales de prueba del banco. Después, la conciliación con su liquidación.
5. **Avisos reales** por email o WhatsApp (hoy quedan guardados y no se envían).
   Y decidir con la cooperativa si el ingreso del socio con los datos de la factura alcanza (ver «Usuarios»).
6. Lo pendiente de cada módulo, que está al final de su sección en este documento.
7. **Nombre definitivo** del producto (por ahora, GestiónCoop): se cambia en un solo lugar (`api/src/shared/constants.ts`).

## Comandos de la API

| Comando | Qué hace |
|---|---|
| `npm run dev` | Base local + migraciones + seed + API con recarga |
| `npm test` | Tests (Vitest). Usan la base `coopgestion_test`, que se vacía en cada corrida |
| `npm run test:motor` | Tests del motor de cálculo con cobertura (mínimo 95 %) |
| `npm run typecheck` / `lint` / `build` | Chequeo de tipos / ESLint / build de producción |
| `npm run migrate` / `migrate:undo` | Aplica / deshace migraciones |
| `npm run seed` | Carga los datos iniciales que falten (no pisa nada) |
| `npm run db:reset` | **Borra todos los datos** y deja la base como recién instalada |
| `npm run db:stop` | Apaga la base local (se vuelve a prender sola con `npm run dev`) |

Con Docker en lugar de la base automática: `docker compose up -d` dentro de `api/`.

## Multi-cooperativa: cómo se aíslan los datos

Cada tabla de negocio lleva `cooperativa_id`. El filtro no depende de que cada consulta se acuerde de ponerlo:

1. `authenticate` (`api/src/middlewares/auth.ts`) lee la cooperativa del token y la deja en el contexto del pedido.
2. Los modelos registrados en `SCOPED_MODELS` (`api/src/models/index.ts`) se filtran solos (`api/src/lib/tenant.ts`):
   leen y escriben únicamente filas de esa cooperativa, y **fallan** si no hay cooperativa en el contexto.
3. `api/tests/isolation.test.ts` verifica que un usuario de la cooperativa A no puede leer ni tocar datos de la B, y
   que ninguna tabla con `cooperativa_id` quede sin aislar.

**Al agregar un modelo de negocio:** sumarlo a `SCOPED_MODELS`. Si se usa SQL crudo (`sequelize.query`), poner siempre
`cooperativa_id = :cooperativaId` a mano: el SQL crudo no pasa por el filtro automático.

## Marca y tema

La interfaz usa el sistema visual de **SRV** (negro, azul `#0B78FB`, naranja `#F6950A`, tipografía del sistema), igual
que Sentryx, con modo claro y oscuro (`client/src/lib/theme.ts`; sin preferencia guardada sigue al sistema). Los colores
se usan siempre por token (`bg-superficie`, `text-tinta`, `border-linea`… definidos en `client/src/styles.css`), nunca
fijos. La cooperativa conserva su nombre y su isotipo con su color; el resto es la marca de la plataforma, con el
crédito "Powered by SRV".

El tema se elige en un solo lugar: el menú del usuario, con un selector Claro / Oscuro / Auto que muestra cuál está
puesto. La pantalla de ingreso tiene su propio botón de sol y luna porque ahí todavía no hay menú.

## Convenciones

- Respuestas de la API: siempre `{ data, error }`. Los errores llevan `code` y un `message` apto para el usuario;
  el detalle técnico va solo al log del servidor.
- Textos en español rioplatense con voseo. Formato es-AR con las funciones de `api/src/shared/format.ts`.
- Dinero: `DECIMAL(14,2)` en la base y `decimal.js` en los cálculos. Nunca `float`.
- Todo lo que toca dinero, tarifas o padrón deja registro con `writeAudit` (`api/src/lib/audit.ts`).

## Deploy

- **API en Railway:** el `Procfile` instala, compila, migra, corre el seed inicial y arranca. Variables: las de
  `api/.env.example` (`NODE_ENV=production`, `DATABASE_URL`, `JWT_SECRET` de 32+ caracteres, `APP_URL` con la dirección
  del front, `TRUST_PROXY=2`, `DEMO_MODE`, `DEMO_ACCESO_RAPIDO`, `SUPERADMIN_*`).
- **Client en Netlify:** Base directory `client`. Definir `API_URL` con la dirección de la API en Railway: el build
  genera el proxy de `/api`, así el navegador ve un solo dominio y las cookies funcionan sin CORS.
