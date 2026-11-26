// Chrome sin ventana, manejado por el protocolo de DevTools. Sin dependencias: usa el WebSocket de Node 22.
// Sirve para sacar las capturas de la presentación y grabar los videos (con ffmpeg).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
export const RAIZ = resolve(AQUI, '..', '..');
const CHROME = process.env.CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
export const APP = process.env.APP_URL ?? 'http://localhost:5180';
/** Lo generado (PDF, imágenes, videos) va fuera del repo. */
export const SALIDA = process.env.SALIDA ?? resolve(RAIZ, '..', 'GestionCoop - material para la cooperativa');
export const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/** Usuarios de prueba. La clave del personal de la demo es la de DEMO_PASSWORD. */
export const DEMO = { clave: 'demo1234', dominio: 'dosdemayo.example', socio: { socio: '1043', conexion: '1026', documento: '99.658.939' } };

/** Lee una variable de api/.env sin mostrarla en ningún lado. */
export function variableDeEntorno(nombre) {
  const archivo = join(RAIZ, 'api', '.env');
  if (!existsSync(archivo)) return null;
  for (const linea of readFileSync(archivo, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(linea);
    if (m && m[1] === nombre) return m[2].replace(/^["']|["']$/g, '');
  }
  return null;
}

export async function abrirChrome({ ancho = 1920, alto = 1080, escala = 1, movil = false } = {}) {
  const perfil = mkdtempSync(join(tmpdir(), 'gestioncoop-chrome-'));
  const puerto = 9400 + Math.floor(Math.random() * 400);
  const proceso = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${puerto}`,
      `--user-data-dir=${perfil}`,
      `--window-size=${ancho},${alto}`,
      '--hide-scrollbars',
      '--mute-audio',
      '--no-first-run',
      '--no-default-browser-check',
      '--enable-unsafe-swiftshader',
      '--lang=es-AR',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  let lista = null;
  for (let i = 0; i < 60 && !lista; i++) {
    try {
      lista = await (await fetch(`http://127.0.0.1:${puerto}/json/list`)).json();
    } catch {
      await esperar(250);
    }
  }
  if (!lista) throw new Error('Chrome no arrancó');
  const pagina = lista.find((t) => t.type === 'page');
  const ws = new WebSocket(pagina.webSocketDebuggerUrl);
  await new Promise((ok, mal) => {
    ws.onopen = ok;
    ws.onerror = mal;
  });
  let id = 0;
  const pendientes = new Map();
  const oyentes = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pendientes.has(m.id)) {
      const { ok, mal } = pendientes.get(m.id);
      pendientes.delete(m.id);
      if (m.error) mal(new Error(`${m.error.message} ${m.error.data ?? ''}`));
      else ok(m.result);
    } else if (m.method) for (const f of oyentes.get(m.method) ?? []) f(m.params);
  };
  const send = (method, params = {}) =>
    new Promise((ok, mal) => {
      const n = ++id;
      pendientes.set(n, { ok, mal });
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  const on = (metodo, f) => oyentes.set(metodo, [...(oyentes.get(metodo) ?? []), f]);
  const off = (metodo) => oyentes.delete(metodo);

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: ancho, height: alto, deviceScaleFactor: escala, mobile: movil });
  if (movil) await send('Emulation.setTouchEmulationEnabled', { enabled: true });

  /** Corre código en la página y devuelve el resultado (espera las promesas). */
  async function evaluar(codigo) {
    const r = await send('Runtime.evaluate', { expression: codigo, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) throw new Error(`En la página: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result?.value;
  }

  async function ir(url, espera = 1500) {
    const cargada = new Promise((ok) => {
      const f = () => {
        off('Page.loadEventFired');
        ok();
      };
      on('Page.loadEventFired', f);
    });
    await send('Page.navigate', { url: url.startsWith('http') ? url : `${APP}${url}` });
    await Promise.race([cargada, esperar(15_000)]);
    await esperar(espera);
  }

  async function captura(ruta, recorte) {
    const r = await send('Page.captureScreenshot', { format: 'png', ...(recorte ? { clip: { ...recorte, scale: 1 } } : {}) });
    mkdirSync(dirname(ruta), { recursive: true });
    writeFileSync(ruta, Buffer.from(r.data, 'base64'));
  }

  /** Entra con email y contraseña (personal) o con los datos de la factura (socio). Deja la sesión en el navegador. */
  async function entrar(datos) {
    await ir('/login', 400);
    const ruta = datos.email ? '/api/v1/auth/login' : '/api/v1/auth/acceso-socio';
    const estado = await evaluar(`fetch(${JSON.stringify(ruta)}, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: ${JSON.stringify(JSON.stringify({ ...datos, cooperativa: 'dosdemayo' }))} }).then((r) => r.status)`);
    if (estado !== 200) throw new Error(`No se pudo entrar (${estado})`);
  }

  async function api(metodo, ruta, cuerpo) {
    return evaluar(`fetch('/api/v1${ruta}', { method: '${metodo}', credentials: 'include', headers: { 'Content-Type': 'application/json' }${cuerpo === undefined ? '' : `, body: ${JSON.stringify(JSON.stringify(cuerpo))}`} }).then(async (r) => ({ estado: r.status, cuerpo: await r.json().catch(() => null) }))`);
  }

  /** Mueve y toca con el "mouse" de verdad (sirve para el mapa, que es un lienzo). */
  async function tocar(x, y, { doble = false } = {}) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    for (const clickCount of doble ? [1, 2] : [1]) {
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount });
    }
  }

  /** Graba lo que muestra la pantalla. Devuelve `terminar(rutaMp4)`. */
  async function grabar() {
    const carpeta = mkdtempSync(join(tmpdir(), 'gestioncoop-video-'));
    const cuadros = [];
    on('Page.screencastFrame', (p) => {
      const n = cuadros.length;
      const archivo = join(carpeta, `c${String(n).padStart(6, '0')}.jpg`);
      writeFileSync(archivo, Buffer.from(p.data, 'base64'));
      cuadros.push({ archivo, t: p.metadata.timestamp });
      void send('Page.screencastFrameAck', { sessionId: p.sessionId });
    });
    await send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: ancho, maxHeight: alto, everyNthFrame: 1 });
    return async function terminar(destino) {
      const fin = Date.now() / 1000;
      await send('Page.stopScreencast');
      off('Page.screencastFrame');
      if (cuadros.length < 2) throw new Error('No se grabó nada');
      // Cada cuadro dura hasta que llega el siguiente (Chrome manda cuadros solo cuando algo cambia).
      const lineas = ['ffconcat version 1.0'];
      cuadros.forEach((c, i) => {
        const hasta = i + 1 < cuadros.length ? cuadros[i + 1].t : Math.max(c.t + 0.04, fin);
        lineas.push(`file '${c.archivo.replace(/\\/g, '/')}'`, `duration ${Math.max(0.001, hasta - c.t).toFixed(4)}`);
      });
      lineas.push(`file '${cuadros.at(-1).archivo.replace(/\\/g, '/')}'`);
      const lista = join(carpeta, 'lista.txt');
      writeFileSync(lista, lineas.join('\n'));
      mkdirSync(dirname(destino), { recursive: true });
      const r = spawnSync(
        'ffmpeg',
        ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', lista, '-vf', `fps=30,scale=${ancho}:${alto}:flags=lanczos,format=yuv420p`, '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-movflags', '+faststart', destino],
        { stdio: 'inherit' },
      );
      rmSync(carpeta, { recursive: true, force: true });
      if (r.status !== 0) throw new Error('ffmpeg no pudo armar el video');
      return { cuadros: cuadros.length, segundos: fin - cuadros[0].t };
    };
  }

  async function cerrar() {
    try {
      await send('Browser.close');
    } catch {
      /* ya estaba cerrado */
    }
    ws.close();
    proceso.kill();
    await esperar(500);
    rmSync(perfil, { recursive: true, force: true, maxRetries: 3 });
  }

  return { send, on, evaluar, ir, captura, entrar, api, tocar, grabar, cerrar };
}
