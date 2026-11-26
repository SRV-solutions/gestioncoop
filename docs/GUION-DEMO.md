# Guion de la demo

Recorrido de unos 30 minutos para mostrarle la plataforma a la gerencia y al consejo de la cooperativa. Sigue los
siete flujos de la sección 11 del SPEC, en el orden en que pasan las cosas en un mes real: se lee, se factura, se
cobra y se mira el resultado.

La idea que tiene que quedar: **del medidor a la caja sin papeles ni planillas, y con todo a la vista.**

## Antes de empezar

Hacelo el día anterior y otra vez una hora antes.

1. **Dejá los datos como nuevos.** La demo emite las facturas de noviembre, y eso no se deshace: para repetirla hay
   que regenerar los datos. En `api/`: frená la API (Ctrl+C), corré `npm run db:reset` y volvé a levantarla con
   `npm run dev`. Tarda unos minutos y **borra todo lo que se haya cargado a mano**.
2. **Levantá las dos partes:** `npm run dev` en `api/` y en `client/`. La app queda en `http://localhost:5180`.
3. **Abrí tres ventanas de Chrome** y dejalas listas:
   - **Oficina**, en la pantalla grande: la pantalla de ingreso.
   - **Celular del operario:** otra ventana, con F12 → ícono de celular (vista de dispositivo), en `/login`.
   - **Celular de la socia:** una ventana de incógnito, también en vista de dispositivo (así las dos sesiones no se
     pisan).
4. **Ensayá una vez el recorrido completo**, sobre todo el paso sin señal y la emisión, para saber cuánto tardan en
   esa computadora. Después volvé al punto 1.

> **El celular de verdad todavía no.** Hasta que la plataforma esté publicada con https, un teléfono no puede
> instalar la app ni usar el GPS, y la computadora no acepta conexiones desde otros equipos. Por ahora el celular se
> muestra en la vista de dispositivo de Chrome. Decilo así: «esto mismo es lo que ve el operario en su teléfono».

Los usuarios de prueba entran como cualquier persona: el personal, en «Trabajo en la cooperativa», con su email y la
contraseña `demo1234`; la socia, en «Soy socio», con los tres datos de su factura.

| Quién es | Cómo entra | Para qué flujo |
|---|---|---|
| Ramón Sosa (operario) | `operario@dosdemayo.example` | 1 |
| Carlos Giménez (gerencia) | `gerencia@dosdemayo.example` | 2 y 6 |
| Silvia Rojas (facturación) | `facturacion@dosdemayo.example` | 3 |
| Marta Benítez (socia) | socio `1043`, conexión `1026`, DNI `99.658.939` | 4 |
| Claudia Wagner (caja) | `caja@dosdemayo.example` | 5 |
| Andrea Lukoski (administración) | `admin@dosdemayo.example` | reclamos, usuarios, cargar la energía comprada |

Para ensayar más rápido se pueden prender los botones de «Modo demo» (entran sin escribir nada) con
`DEMO_ACCESO_RAPIDO=true` en `api/.env`. Para mostrársela a la cooperativa, mejor apagados: así ven el ingreso real.

**Solvix** (el astronauta de los tutoriales) se presenta solo la primera vez que entra cada usuario. Mostralo una vez,
con el primero que entres, y en los demás tocá **Omitir**: lleva un segundo y no vuelve a aparecer.

Todas las personas, documentos y domicilios son inventados. Lo único real son las calles de Dos de Mayo y las
tarifas, que salen de dos facturas de la cooperativa.

## El recorrido

### 0. Apertura (1 minuto)

Mostrá la pantalla de ingreso: el nombre y el isotipo de la cooperativa, sus servicios.

> «Esta es la plataforma de la cooperativa. Cada persona entra y ve solo lo suyo: el vecino desde el celular, el
> lecturista en la calle, la caja, facturación y gerencia. Vamos a seguir un mes completo.»

### 1. El operario carga lecturas en la calle (5 minutos)

En la ventana del **celular del operario**:

1. Entrá como operario. Aparece «Mi ruta de hoy» con sus rutas y cuánto lleva de cada una.
2. Tocá **Ruta 4 · Sagrado Corazón de Jesús** (va por 36 de 160 casas). Antes de seguir, mostrá **Recorrido**:
   elegí una calle, la app ordena las casas que faltan y dice cuántos kilómetros se ahorran; aceptalo y abrí **Mapa**
   para ver el recorrido dibujado con el número de cada paso. Después tocá **Seguir**.
3. Cargá **cuatro lecturas** con el teclado grande de la pantalla. Después de confirmar, pasa sola a la casa
   siguiente.
4. En la quinta, escribí un número **mucho más alto** que el anterior. La app avisa que el consumo es raro y pide
   confirmar: confirmala.
5. **Sin señal:** en las herramientas de Chrome (F12 → Red), elegí «Sin conexión». La barra de arriba pasa a «Sin
   señal: se guarda en el teléfono». Cargá **dos lecturas más**: quedan como «2 por enviar».
6. Volvé a poner la conexión. Se envían solas y la barra dice «Todo enviado».

> «La app le arma el recorrido desde donde sale, para que camine menos. Una casa por pantalla, botones grandes, se
> usa con una mano. Si no hay señal, no se pierde nada: se guarda en el teléfono y sale sola cuando vuelve. Y si el
> número es raro, avisa en el momento, no un mes después.»

Si preguntan: el recorrido es en línea recta, no conoce los arroyos ni los alambrados; el operario siempre puede
abrir la casa que quiera.

### 2. Gerencia lo ve en el mapa, en vivo (3 minutos)

En la ventana de la **oficina**, mientras el operario sigue cargando:

1. Entrá como gerencia y abrí **Mapa**.
2. Tocá **Lecturas en vivo**. Las casas leídas están en verde y las que faltan en gris; abajo dice cuántos medidores
   van.
3. Acercá el mapa a Sagrado Corazón de Jesús y cargá una lectura más en el celular: a los pocos segundos esa casa
   pasa a verde y destella.
4. Opcional: mové la hora del día para mostrar el mapa de noche, y tocá una casa para ver su ficha.

> «Gerencia ve por dónde va la cuadrilla sin llamar a nadie. La casa que quedó en ámbar es la del consumo raro: la
> oficina la mira antes de facturar.»

### 3. Facturación emite el mes (6 minutos)

En la ventana de la oficina, salí y entrá como facturación. Abrí **Facturación**: es un asistente de cuatro
pasos (abrir la lectura, controlar lecturas, pre-facturar y revisar, emitir).

1. **Controlar lecturas:** muestra cuántos medidores faltan. Tocá **Estimar los …** (se estiman con el promedio de
   seis meses y quedan marcados como estimados).
2. Tocá **Cerrar la lectura y calcular**. Calcula todas las pre-facturas con barra de progreso.
3. **Pre-facturar y revisar:** el sistema separa las facturas «raras» (cambiaron más del 50 %, importe cero, sin
   lectura). Abrí la de la casa del consumo alto, mostrá el cálculo renglón por renglón y tocá **Está bien**.
4. Tocá **Emitir … facturas** y confirmá. Son más de 4.000 (energía, agua, internet y TV de 2.000 hogares), con barra de
   progreso, numeración correlativa y aviso al socio.
5. Abrí una factura cualquiera y su **PDF**: tiene el mismo formato que la de papel, con código de barras y QR.

> «Nada se emite a ciegas: primero la pre-factura, después lo raro, después todo junto. Una factura emitida no se
> edita nunca: si estuvo mal, se corrige con nota de crédito y queda registrado quién lo hizo.»

Si preguntan: la facturación electrónica está simulada (los comprobantes dicen «sin validez fiscal»). La conexión con
ARCA se hace con el certificado de la cooperativa.

### 4. La socia ve su factura y paga desde el celular (5 minutos)

En la ventana del **celular de la socia**:

1. Entrá como Marta Benítez **escribiendo sus tres datos** en «Soy socio».
   El inicio dice en grande cuánto debe y avisa del corte programado en su zona.
2. Abrí **Facturas** y tocá la de **energía de noviembre**.
3. En la misma pantalla está **¿Por qué pago esto?**: una barra muestra en qué se va la plata y hasta dónde llega
   el subsidio. Leé la frase: tiene subsidio en los primeros 120 kWh y consumió más; lo que se pasó se cobra sin
   subsidio.
4. Volvé al inicio y tocá **Pagar**. Elegí solo esa factura; el botón dice el importe exacto.
5. En la pasarela de prueba (hace de banco, no pide datos de tarjeta) tocá **Pagar $ …**. Vuelve con el recibo y con
   lo que le queda por pagar. Desde ahí mismo se puede mostrar un rechazo con **Simular un rechazo**.

> «Entra con los mismos tres datos de la factura que ya usa hoy, sin crear ninguna cuenta. Hoy aprieta un botón que
> dice "comprar" sin saber qué paga ni cuánto. Acá elige qué factura, ve el total y entiende de dónde sale. Y también
> puede pagar con el QR de la factura de papel, sin entrar a nada.»

Si preguntan por otras cuentas: en el menú del usuario está **Ver otra cuenta** (la de un familiar, la del negocio);
la sesión queda abierta tres meses en ese celular.

Si preguntan: el pago está simulado. La cooperativa ya cobra con Macro Click de Pago; para enchufarlo hacen falta la
documentación técnica y las credenciales de prueba del banco.

### 5. La caja cobra en el mostrador (4 minutos)

En la ventana de la oficina, salí y entrá como caja. No hace falta el mouse.

1. Escribí el **fondo inicial** y Enter: la caja queda abierta.
2. En el buscador (F2), escribí un apellido o un número de socio. Con el lector, alcanza con pasar el código de
   barras de la factura.
3. Elegí al socio: aparecen sus facturas, de la más vieja a la más nueva. Enter para cobrar la primera.
4. Medio de pago **efectivo** (tecla E), escribí con cuánto paga: el sistema dice «Dale de vuelto».
5. Enter: sale el recibo (ticket o A4).
6. Para cerrar el turno: **Cerrar la caja**, escribí lo que contaste. El sistema lo compara con lo que tenía que
   haber y muestra la diferencia.

> «Búsqueda, cobro, vuelto y recibo en menos de veinte segundos. Al cerrar, el arqueo sale solo.»

### 6. Gerencia mira el resultado (5 minutos)

En la ventana de la oficina, entrá como gerencia.

1. **Tablero:** muestra noviembre, recién facturado. Señalá lo facturado, lo ya cobrado (el pago de Marta) y, más
   abajo, la **recaudación del mes**, donde figuran el cobro de la caja y el pago online.
2. Bajá hasta el **balance de energía**: lo que entró a la red contra lo que se facturó. La diferencia son las
   pérdidas. (Las cantidades de la demo son de ejemplo.)
3. **Informes → Deuda por socio → Excel.** Abrí el archivo: quién debe, cuánto y desde cuándo, con totales.
4. **Mapa:** tocá **Energía** y, en la leyenda, apagá todo menos **En mora**. Quedan en rojo las casas con dos o
   más facturas vencidas.
5. Tocá **Dibujar área**, marcá un barrio con cuatro o cinco clics y cerralo con doble clic. A la derecha sale la
   deuda de ese pedazo del pueblo, cuántas conexiones son y cuánto consumen; se puede bajar la lista.
6. Opcional, si está la presidencia: **Cooperativa → Subir imagen**. Con el logo o una foto de la cooperativa, cambia
   en el momento arriba de la pantalla y en el ingreso. Llevá el archivo preparado.

> «Esto es lo que ninguna planilla les da hoy: cuánto se pierde de energía, quién debe y dónde está esa deuda en el
> mapa. Y cada número se abre hasta el detalle.»

### 7. Otra cooperativa, otros datos (1 minuto)

Salí, abrí `/login?coop=arroyodelmonte` (es la pantalla de ingreso de la otra cooperativa, con su marca) y entrá con
`gerencia@arroyodelmonte.example` y la misma contraseña.

> «La plataforma sirve a más de una cooperativa. Cada una ve su marca y solo sus datos: ni una consulta cruza de una
> a otra, y eso está probado de forma automática.»

Esa cooperativa tiene el padrón sin ubicaciones: el mapa lo dice en lugar de mostrarse vacío. Sirve para contar que
se puede arrancar con las direcciones y sumar el mapa después.

### Cierre (1 minuto)

Volvé al tablero de Dos de Mayo.

> «Lo que vieron funciona hoy con datos de prueba. Para usarlo de verdad hacen falta tres cosas de la cooperativa:
> el padrón real, el certificado de ARCA y las credenciales del banco.»

## Si algo falla

- **Una pantalla muestra «Esta pantalla tuvo un problema»:** tocá «Volver a cargar». Lo guardado no se pierde.
- **El mapa no carga:** necesita internet (las calles y el relieve se bajan de servidores públicos). Sin internet,
  mostrá el tablero y los informes, que no lo necesitan.
- **Las lecturas no se envían al volver la señal:** tocá «… por enviar» en la barra de arriba.
- **La emisión se corta:** volvé a tocar **Emitir**. Sigue desde donde quedó, sin repetir ni saltear números.
- **Alguien probó antes y los números no coinciden con este guion:** hay que regenerar los datos (punto 1 de «Antes
  de empezar»).

## Preguntas que suelen venir

- **¿Los datos son reales?** No. Personas, documentos y deudas son inventados. Las calles y las tarifas sí son las
  de la cooperativa.
- **¿Se puede migrar lo que tenemos hoy?** Sí, pero no está hecho: depende de en qué formato exporta el sistema
  actual. Es lo primero que hay que relevar.
- **¿Corta el servicio solo?** Nunca. La lista de cortes sugeridos es para que decida una persona.
- **¿El vecino necesita crear una cuenta?** No. Entra con el código de socio, el número de conexión y su documento.
- **¿Quién ve qué?** Cada rol ve lo suyo, y los permisos se controlan en el servidor. Todo lo que toca plata,
  tarifas o padrón queda en la auditoría con nombre y fecha.
- **¿Anda en cualquier celular?** Es una página web que se instala como app, sin tienda de aplicaciones. Falta
  probarla en teléfonos reales, que se hace cuando esté publicada.
