// Videos de cómo se usa GestiónCoop: la app corre de verdad dentro de un escenario de 1920×1080,
// con Solvix explicando cada paso. Se graba con Chrome sin ventana y se arma el MP4 con ffmpeg.
// Uso (con la API y el cliente corriendo):  node docs/presentacion/videos.mjs [vecino] [operario] [oficina] [gerencia]
//
// No escribe nada en la base: no confirma pagos ni lecturas y no abre la caja. El avance de los
// tutoriales de cada usuario de prueba queda como estaba.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { abrirChrome, DEMO, esperar, RAIZ, SALIDA } from './cdp.mjs';

const DESTINO = join(SALIDA, 'videos');
const solo = process.argv.slice(2);
const toca = (v) => solo.length === 0 || solo.includes(v);

const imagen = (archivo) => `data:image/png;base64,${readFileSync(join(RAIZ, 'docs', 'manual', 'img', archivo)).toString('base64')}`;
const SOLVIX = { saluda: imagen('solvix-wave.png'), senala: imagen('solvix-point.png'), piensa: imagen('solvix-think.png'), festeja: imagen('solvix-cheer.png') };
const SRV = imagen('srv-logo-512.png');

/* ───────────────────────── El escenario ───────────────────────── */

function escenario(modo, ruta) {
  const celular = modo === 'celular';
  const css = `
    html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden; background: #0d0d0d; font-family: 'Segoe UI', system-ui, sans-serif; }
    * { box-sizing: border-box; }
    .anillos { position: absolute; right: -260px; top: -300px; width: 1100px; height: 1100px; pointer-events: none; }
    #telefono { position: absolute; left: 250px; top: 86px; width: 422px; height: 908px; border-radius: 56px; background: #1b1b1b; padding: 16px; box-shadow: 0 30px 80px rgba(0,0,0,.6), inset 0 0 0 2px #333; }
    #telefono iframe { width: 390px; height: 876px; border: 0; border-radius: 42px; background: #fff; display: block; }
    #pantalla { position: absolute; left: 0; top: 0; width: 1920px; height: 900px; border: 0; background: #fff; }
    #panel { position: absolute; ${celular ? 'left: 800px; right: 120px; top: 0; bottom: 0; display: flex; flex-direction: column; justify-content: center;' : 'left: 0; right: 0; bottom: 0; height: 180px; display: flex; align-items: center; gap: 32px; padding: 0 56px;'} color: #fff; }
    #solvix { ${celular ? 'width: 250px; height: 290px; margin-bottom: 26px;' : 'width: 128px; height: 150px; flex-shrink: 0;'} object-fit: contain; transition: transform .35s ease; }
    #textos { transition: opacity .3s ease; ${celular ? '' : 'flex: 1; min-width: 0;'} }
    #titulo { font-size: ${celular ? 60 : 36}px; font-weight: 800; letter-spacing: -.015em; line-height: 1.1; margin: 0 0 ${celular ? 22 : 8}px; }
    #detalle { font-size: ${celular ? 34 : 25}px; line-height: 1.4; color: #c9d1dc; margin: 0; max-width: ${celular ? 900 : 1400}px; }
    #marca { ${celular ? 'position: absolute; right: 120px; bottom: 70px;' : 'flex-shrink: 0;'} text-align: right; }
    .producto { font-size: 30px; font-weight: 900; color: #fff; letter-spacing: -.02em; }
    .producto i { font-style: normal; color: #f6950a; }
    .srv { margin-top: 8px; display: inline-flex; align-items: center; gap: 10px; padding: 6px 16px 6px 6px; border-radius: 999px; background: rgba(255,255,255,.1); font-size: 17px; color: #fff; }
    .srv img { width: 32px; height: 32px; border-radius: 50%; background: #fff; }
    .srv b { color: #f6950a; }
    #cursor { position: absolute; left: 960px; top: 1200px; width: 34px; height: 34px; margin: -17px 0 0 -17px; border-radius: 50%; background: rgba(246,149,10,.28); border: 3px solid #f6950a; box-shadow: 0 4px 14px rgba(0,0,0,.35); transition: left .7s cubic-bezier(.3,.7,.2,1), top .7s cubic-bezier(.3,.7,.2,1); pointer-events: none; z-index: 30; }
    #cursor.toca { animation: toca .45s ease-out; }
    @keyframes toca { 0% { transform: scale(1); } 40% { transform: scale(.7); background: rgba(246,149,10,.6); } 100% { transform: scale(1); } }
    #tapa { position: absolute; inset: 0; z-index: 40; background: #0d0d0d; color: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; transition: opacity .6s ease; }
    #tapa.fuera { opacity: 0; pointer-events: none; }
    #tapa .coop { width: 150px; height: 150px; border-radius: 34px; background: #fff; object-fit: cover; margin-bottom: 34px; box-shadow: 0 16px 50px rgba(0,0,0,.5); }
    #tapa .grande { font-size: 92px; font-weight: 900; letter-spacing: -.03em; margin: 0; }
    #tapa .grande i { font-style: normal; color: #f6950a; }
    #tapa .tema { font-size: 44px; font-weight: 700; margin: 18px 0 0; }
    #tapa .chico { font-size: 26px; color: #c9d1dc; margin: 14px 0 0; }
    #tapa .solvix { position: absolute; right: 180px; bottom: 120px; width: 250px; }
    #tapa .srv { margin-top: 40px; }`;
  const html = `
    <svg class="anillos" viewBox="0 0 600 600" aria-hidden="true">
      ${[110, 170, 230, 290].map((r) => `<circle cx="300" cy="300" r="${r}" fill="none" stroke="#fff" stroke-opacity=".06" stroke-width="1.5"/>`).join('')}
      <path d="M130 300 A170 170 0 0 0 300 470" fill="none" stroke="#f6950a" stroke-width="4" stroke-linecap="round" opacity=".8"/>
      <path d="M100.8 415 A230 230 0 0 0 185 499.2" fill="none" stroke="#5aa5fd" stroke-width="4" stroke-linecap="round" opacity=".7"/>
    </svg>
    ${celular ? `<div id="telefono"><iframe id="app" src="${ruta}"></iframe></div>` : `<iframe id="app" class="pantalla" src="${ruta}" style="position:absolute;left:0;top:0;width:1920px;height:900px;border:0;background:#fff"></iframe>`}
    <div id="panel">
      <img id="solvix" src="${SOLVIX.saluda}" alt="">
      <div id="textos"><p id="titulo"></p><p id="detalle"></p></div>
      <div id="marca"><div class="producto">GestiónCoop<i>.</i></div><div class="srv"><img src="${SRV}" alt="">Powered by <b>SRV</b></div></div>
    </div>
    <div id="cursor"></div>
    <div id="tapa"></div>`;
  return `(() => {
    document.title = 'GestiónCoop';
    document.head.innerHTML = '<meta charset="utf-8"><style>${css.replace(/\n\s*/g, ' ').replace(/'/g, "\\'")}</style>';
    document.body.innerHTML = ${JSON.stringify(html)};
    const SOLVIX = ${JSON.stringify(SOLVIX)};
    const app = () => document.getElementById('app');
    const doc = () => app().contentDocument;
    const cursor = document.getElementById('cursor');
    window.__decir = (titulo, detalle, pose = 'senala') => new Promise((ok) => {
      const t = document.getElementById('textos');
      t.style.opacity = 0;
      setTimeout(() => {
        document.getElementById('titulo').textContent = titulo;
        document.getElementById('detalle').textContent = detalle;
        const s = document.getElementById('solvix');
        s.src = SOLVIX[pose];
        s.style.transform = 'translateY(-10px)';
        setTimeout(() => (s.style.transform = ''), 350);
        t.style.opacity = 1;
        ok();
      }, 300);
    });
    const visible = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    window.__buscar = (selector, texto) => {
      const lista = [...doc().querySelectorAll(selector)].filter(visible);
      const el = texto ? lista.filter((e) => e.textContent.replace(/\\s+/g, ' ').includes(texto)).sort((a, b) => a.textContent.length - b.textContent.length)[0] : lista[0];
      if (!el) throw new Error('No encontré ' + selector + ' ' + (texto || ''));
      return el;
    };
    /** Lleva el cursor al elemento (dentro de la app) y lo toca. */
    window.__tocar = async (selector, texto, { tocar = true } = {}) => {
      const el = window.__buscar(selector, texto);
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      await new Promise((r) => setTimeout(r, 350));
      const caja = app().getBoundingClientRect();
      const r = el.getBoundingClientRect();
      cursor.style.left = caja.left + r.left + r.width / 2 + 'px';
      cursor.style.top = caja.top + r.top + r.height / 2 + 'px';
      await new Promise((ok) => setTimeout(ok, 800));
      if (!tocar) return;
      cursor.classList.remove('toca');
      void cursor.offsetWidth;
      cursor.classList.add('toca');
      await new Promise((ok) => setTimeout(ok, 180));
      el.click();
    };
    window.__esconderCursor = () => { cursor.style.top = '1200px'; };
    /** Escribe en un campo, letra por letra, como lo haría una persona. */
    window.__escribir = async (etiqueta, texto) => {
      const label = [...doc().querySelectorAll('label')].find((l) => l.textContent.trim() === etiqueta);
      const campo = doc().getElementById(label.htmlFor);
      await window.__tocar('#' + CSS.escape(campo.id), null);
      campo.focus();
      const set = Object.getOwnPropertyDescriptor(app().contentWindow.HTMLInputElement.prototype, 'value').set;
      let valor = '';
      for (const c of texto) {
        valor += c;
        set.call(campo, valor);
        campo.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((ok) => setTimeout(ok, 110));
      }
    };
    window.__deslizar = (y) => app().contentWindow.scrollTo({ top: y, behavior: 'smooth' });
    window.__deslizarHasta = (selector, texto) => { window.__buscar(selector, texto).scrollIntoView({ block: 'start', behavior: 'smooth' }); };
    window.__rango = (etiqueta, valor) => {
      const r = doc().querySelector('input[type=range][aria-label="' + etiqueta + '"]');
      const set = Object.getOwnPropertyDescriptor(app().contentWindow.HTMLInputElement.prototype, 'value').set;
      set.call(r, String(valor));
      r.dispatchEvent(new Event('input', { bubbles: true }));
    };
    window.__tapa = (html) => { const t = document.getElementById('tapa'); t.innerHTML = html; t.classList.remove('fuera'); };
    window.__sacarTapa = () => document.getElementById('tapa').classList.add('fuera');
  })()`;
}

const portada = (tema, detalle, logo) => `<img class="coop" src="${logo}" alt=""><p class="grande">GestiónCoop<i>.</i></p><p class="tema">${tema}</p><p class="chico">${detalle}</p><img class="solvix" src="${SOLVIX.saluda}" alt="">`;
const cierre = () =>
  `<p class="grande">GestiónCoop<i>.</i></p><p class="tema">Del medidor a la caja, sin papeles.</p><p class="chico">Cooperativa AyE Dos de Mayo · versión de demostración con datos de prueba</p><div class="srv"><img src="${SRV}" alt="">Powered by <b>SRV</b> · wearesrv.com</div><img class="solvix" src="${SOLVIX.festeja}" alt="">`;

/* ───────────────────────── Cada video ───────────────────────── */

/**
 * Abre Chrome, deja al usuario sin la bienvenida de Solvix (y la restaura al final), arma el escenario
 * y graba lo que hace `pasos`.
 */
async function grabarVideo({ nombre, modo, ruta, entrar, tema, detalle, pasos, portada: conPortada = true }) {
  const chrome = await abrirChrome({ ancho: 1920, alto: 1080, escala: 1 });
  let avanceAntes = null;
  try {
    await chrome.ir('/login', 300);
    await chrome.evaluar(`localStorage.setItem('coopgestion-tema', 'light'); localStorage.setItem('coopgestion-ingreso', 'socio')`);
    await chrome.entrar(entrar.datos);
    avanceAntes = (await chrome.api('GET', '/auth/tutoriales')).cuerpo.data;
    await chrome.api('PUT', '/auth/tutoriales', { hechos: [...new Set([...avanceAntes.hechos, 'bienvenida'])], omitidos: avanceAntes.omitidos });
    if (entrar.salirAntes) await chrome.api('POST', '/auth/logout', {});
    const logo = await chrome.evaluar(`fetch('/api/v1/auth/context?coop=dosdemayo').then((r) => r.json()).then((j) => j.data.cooperativa.tema.logoUrl)`);
    await chrome.ir('/login', 300);
    await chrome.evaluar(escenario(modo, ruta));
    await chrome.evaluar(conPortada ? `__tapa(${JSON.stringify(portada(tema, detalle, logo))})` : '__sacarTapa()');
    await esperar(modo === 'escritorio' && ruta.startsWith('/mapa') ? 16_000 : 4000);

    const terminar = await chrome.grabar();
    if (conPortada) {
      await esperar(3200);
      await chrome.evaluar('__sacarTapa()');
      await esperar(700);
    }
    const decir = async (titulo, texto, pose, pausa = 4500) => {
      await chrome.evaluar(`__decir(${JSON.stringify(titulo)}, ${JSON.stringify(texto)}, ${JSON.stringify(pose ?? 'senala')})`);
      await esperar(pausa);
    };
    const hacer = (codigo, pausa = 1200) => chrome.evaluar(codigo).then(() => esperar(pausa));
    await pasos({ decir, hacer, chrome });
    await chrome.evaluar('__esconderCursor()');
    await chrome.evaluar(`__tapa(${JSON.stringify(cierre())})`);
    await esperar(4200);
    const destino = join(DESTINO, `${nombre}.mp4`);
    const r = await terminar(destino);
    console.log(`${nombre}: ${r.segundos.toFixed(0)} s, ${r.cuadros} cuadros`);
    return destino;
  } finally {
    // De vuelta a como estaba (si para grabar se salió de la cuenta, se vuelve a entrar para restaurarlo).
    if (avanceAntes) {
      if ((await chrome.api('GET', '/auth/me').catch(() => ({ estado: 0 }))).estado !== 200) await chrome.entrar(entrar.datos).catch(() => {});
      await chrome.api('PUT', '/auth/tutoriales', avanceAntes).catch(() => {});
      await chrome.api('POST', '/auth/logout', {}).catch(() => {});
    }
    await chrome.cerrar();
  }
}

const tocar = (selector, texto) => `__tocar(${JSON.stringify(selector)}, ${JSON.stringify(texto ?? null)})`;
/** Lleva la hora del mapa de a poco (un atardecer en `ms`): de golpe, el mapa se repinta a parches. */
const animarHora = (hasta, ms) => `(async () => {
  const r = document.getElementById('app').contentDocument.querySelector('input[type=range][aria-label="Hora del día"]');
  const desde = Number(r.value), pasos = Math.round(${ms} / 90);
  for (let i = 1; i <= pasos; i++) {
    __rango('Hora del día', desde + (${hasta} - desde) * i / pasos);
    await new Promise((ok) => setTimeout(ok, 90));
  }
})()`;
const señalar = (selector, texto) => `__tocar(${JSON.stringify(selector)}, ${JSON.stringify(texto ?? null)}, { tocar: false })`;

const videos = [];

if (toca('vecino'))
  videos.push(
    await grabarVideo({
      nombre: '1 - El vecino consulta y paga',
      modo: 'celular',
      ruta: '/login',
      entrar: { datos: DEMO.socio, salirAntes: true },
      tema: 'El vecino, desde su celular',
      detalle: 'Consulta, entiende y paga sus facturas',
      pasos: async ({ decir, hacer }) => {
        await decir('Sin usuario ni contraseña', 'Entra con tres datos que están en su factura: código de socio, número de conexión y documento.', 'saluda', 2500);
        await hacer(`__escribir('Código de socio', '${DEMO.socio.socio}')`, 300);
        await hacer(`__escribir('Número de conexión', '${DEMO.socio.conexion}')`, 300);
        await hacer(`__escribir('DNI, CUIT o CUIL', '${DEMO.socio.documento}')`, 600);
        await hacer(tocar('button', 'Ver mi cuenta'), 3500);
        await decir('Cuánto debe, de un vistazo', 'Lo primero que ve es el total, si tiene facturas vencidas y el botón para pagar. La cuenta queda abierta tres meses en su teléfono.', 'senala', 5000);
        await hacer(`__deslizar(560)`, 2500);
        await decir('Avisos de la cooperativa', 'Si hay un corte programado en su zona, lo ve en el inicio, con día y horario.', 'piensa', 4000);
        await hacer(tocar('nav a', 'Facturas'), 1400);
        await decir('Todas sus facturas', 'De todos los servicios, con su estado y el PDF para descargar.', 'senala', 3500);
        await hacer(tocar('a', 'Energía'), 3000);
        await hacer(`__deslizarHasta('h2', 'Por qué pago esto')`, 2500);
        await decir('¿Por qué pago esto?', 'Cada factura explica en palabras simples en qué se va la plata: consumo, subsidio, impuestos y adicionales.', 'piensa', 6500);
        await hacer(tocar('nav a', 'Inicio'), 2500);
        await hacer(tocar('a', 'Pagar'), 1400);
        await decir('Pagar desde el celular', 'Elige qué facturas pagar y ve el total exacto antes de ir al banco. También puede pagar con el QR de la factura de papel.', 'senala', 6000);
        await hacer(tocar('nav a', 'Consumo'), 1800);
        await decir('Su consumo, mes a mes', 'Los últimos doce meses, comparados con el mes anterior y con el promedio de su barrio.', 'festeja', 5500);
      },
    }),
  );

if (toca('operario'))
  videos.push(
    await grabarVideo({
      nombre: '2 - El operario en la calle',
      modo: 'celular',
      ruta: '/operario',
      entrar: { datos: { email: `operario@${DEMO.dominio}`, password: DEMO.clave } },
      tema: 'El operario, en la calle',
      detalle: 'Carga las lecturas con el celular, con o sin señal',
      pasos: async ({ decir, hacer }) => {
        await decir('Mi ruta de hoy', 'Cada operario ve sus rutas, cuántos medidores lleva y cuántos le faltan. Son las mismas cuentas que ve la oficina.', 'saluda', 5500);
        await hacer(tocar('a[href="/operario/ruta/10"]'), 3000);
        await decir('Una ruta sin empezar', 'Ochenta y siete casas en la colonia. La app le puede armar el recorrido.', 'senala', 3500);
        await hacer(tocar('button', 'Recorrido'), 1500);
        await decir('Le dice de dónde sale', 'Desde donde está parado, desde una calle o desde una casa. La app ordena lo que falta para caminar menos.', 'piensa', 3500);
        await hacer(tocar('[role=dialog] button', 'Colonia 2 de Mayo'), 2000);
        await decir('Cuánto camina y cuánto ahorra', 'Antes de aceptar ve los kilómetros del recorrido nuevo y cuánto menos camina que con el orden anterior.', 'senala', 5500);
        await hacer(tocar('[role=dialog] button', 'Usar este recorrido'), 2000);
        await hacer(tocar('button', 'Mapa'), 12_000);
        await decir('El recorrido en el mapa', 'Cada casa con su número de paso, cuál sigue y cuántos kilómetros quedan.', 'senala', 5500);
        await hacer(tocar('button', 'Empezar por'), 3000);
        await decir('Una casa por pantalla', 'Dirección, medidor y lectura anterior, con un teclado grande para usar con una mano.', 'senala', 3000);
        for (const d of '4521') await hacer(tocar('button', d), 350);
        await decir('Si el número es raro, avisa', 'Un consumo fuera de lo normal se marca en el momento, no un mes después. Sin señal, la lectura se guarda en el teléfono y sale sola.', 'piensa', 7000);
      },
    }),
  );

if (toca('oficina'))
  videos.push(
    await grabarVideo({
      nombre: '3 - La oficina factura el mes',
      modo: 'escritorio',
      ruta: '/lecturas',
      entrar: { datos: { email: `facturacion@${DEMO.dominio}`, password: DEMO.clave } },
      tema: 'La oficina',
      detalle: 'Controla las lecturas, factura y cuida las tarifas',
      pasos: async ({ decir, hacer }) => {
        await decir('Las lecturas llegan solas', 'Lo que cargan los operarios aparece al instante: avance por ruta, consumos para revisar y novedades con su foto.', 'saluda', 6000);
        await hacer(`__deslizar(380)`, 3000);
        await hacer(`__deslizar(0)`, 1200);
        await hacer(tocar('nav a', 'Facturación'), 1800);
        await decir('Facturar en cuatro pasos', 'Abrir la lectura, controlar, pre-facturar y revisar las facturas raras, y emitir. No se emite nada a ciegas.', 'piensa', 7000);
        await hacer(señalar('button', 'Estimar'), 400);
        await decir('Lo que falta, resuelto', 'Los medidores sin leer se estiman con el promedio de seis meses y quedan marcados en la factura.', 'senala', 5500);
        await hacer(tocar('[role=tab], button', 'Comprobantes'), 1800);
        await decir('Cada comprobante, a mano', 'Facturas numeradas, su PDF con código de barras y QR, y los pagos que recibió. Una factura emitida no se edita: se corrige con nota de crédito.', 'senala', 7000);
        await hacer(tocar('nav a', 'Tarifas'), 1800);
        await decir('Tarifas con historia', 'Cuadros por servicio y categoría, impuestos y cargos. Un cambio rige desde una fecha y lo ya facturado no se toca.', 'festeja', 6500);
      },
    }),
  );

if (toca('gerencia'))
  videos.push(
    await grabarVideo({
      nombre: '4 - La gerencia mira el resultado',
      modo: 'escritorio',
      ruta: '/gerencia',
      entrar: { datos: { email: `gerencia@${DEMO.dominio}`, password: DEMO.clave } },
      tema: 'La gerencia',
      detalle: 'Los números del mes, los informes y el mapa',
      pasos: async ({ decir, hacer }) => {
        await decir('El tablero del mes', 'Facturado, cobrado, cobrabilidad, deuda, consumo y reclamos. Se filtra por mes, servicio y zona, y cada número se abre hasta el detalle.', 'saluda', 7000);
        await hacer(`__deslizar(820)`, 3500);
        await decir('Cómo viene cada mes', 'Lo facturado y lo cobrado, la deuda por antigüedad y el consumo por escalón y por barrio.', 'senala', 5500);
        await hacer(`__deslizar(0)`, 1200);
        await hacer(tocar('nav a', 'Informes'), 2500);
        await hacer(tocar('a', 'Deuda por socio'), 3500);
        await decir('Informes para bajar', 'Quién debe, cuánto y desde cuándo. Cada informe se baja en Excel, CSV o PDF.', 'senala', 6000);
        await hacer(tocar('nav a', 'Mapa'), 16_000);
        await tramoDelMapa({ decir, hacer }, 4000);
      },
    }),
  );

/** El mapa de la gerencia: la situación de cada casa, de día y de noche, y las lecturas en vivo. */
async function tramoDelMapa({ decir, hacer }, pausaInicial) {
  await decir('Toda la cooperativa en el mapa', 'Cada casa con su situación: al día, con deuda, en mora o cortada. Y los cortes programados de cada zona.', 'senala', pausaInicial);
  await decir('De día y de noche', 'El mapa sigue la hora real de Dos de Mayo. De noche, las casas se iluminan.', 'piensa', 600);
  await hacer(animarHora(13, 3000), 4500);
  await hacer(animarHora(21.5, 4500), 3500);
  await hacer(tocar('button', 'Lecturas en vivo'), 4000);
  await decir('Lecturas en vivo', 'Gerencia ve por dónde va la cuadrilla sin llamar a nadie: cada lectura que entra destella en el mapa.', 'festeja', 6000);
}

// Solo el tramo del mapa del video de la gerencia, ya cargado y sin portada: para reemplazar ese tramo
// sin volver a grabar el resto. Se pide explícitamente:  node docs/presentacion/videos.mjs gerencia-mapa
if (solo.includes('gerencia-mapa'))
  await grabarVideo({
    nombre: '4 - tramo del mapa',
    modo: 'escritorio',
    ruta: '/mapa',
    portada: false,
    entrar: { datos: { email: `gerencia@${DEMO.dominio}`, password: DEMO.clave } },
    pasos: (p) => tramoDelMapa(p, 7000),
  });

/* ───────────────────────── Todo junto ───────────────────────── */

if (solo.length === 0) {
  mkdirSync(DESTINO, { recursive: true });
  const lista = join(DESTINO, 'lista.txt');
  writeFileSync(lista, videos.map((v) => `file '${v.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'));
  const destino = join(DESTINO, 'GestionCoop - recorrido completo.mp4');
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', lista, '-c', 'copy', '-movflags', '+faststart', destino], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('No se pudo unir los videos');
  spawnSync(process.platform === 'win32' ? 'cmd' : 'rm', process.platform === 'win32' ? ['/c', 'del', lista.replace(/\//g, '\\')] : [lista]);
  console.log(`Recorrido completo: ${destino}`);
}
console.log(`Videos en ${DESTINO}`);
