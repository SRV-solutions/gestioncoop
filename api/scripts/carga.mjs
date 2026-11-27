// Prueba de carga del portal del socio: simula N personas usando la app al mismo tiempo (por ejemplo,
// la semana del vencimiento) y mide cuánto tarda la API, cuántos pedidos aguanta y dónde se satura.
// Solo hace pedidos de lectura: no paga, no reclama, no cambia nada. Entra una vez por escalón con
// los datos de un socio de prueba (los de la factura) y reutiliza esa sesión.
//
// Uso:
//   node scripts/carga.mjs --url https://<api> --socio <n> --conexion <n> --documento <dni>
//        [--personas 5000,10000,20000,35000,50000] [--segundos 60] [--cada 15] [--conexiones 1500]
//        [--pausa 20] [--sin-pdf] [--entrar https://<app>] [--salida resultado.json]
//
// Modelo: cada persona conectada hace en promedio un pedido cada `--cada` segundos (mira el inicio,
// sus facturas, el consumo, baja el PDF...): 5.000 personas cada 15 s = 333 pedidos por segundo.
// Los pedidos salen a ritmo fijo, lleguen o no las respuestas, como pasa con gente de verdad: si la
// API se atrasa, se acumulan y se nota. Si hay `--conexiones` pedidos esperando respuesta, el que
// sigue no sale y cuenta como fallido. Corta cuando un escalón falla más del 5 % o el 95 % de los
// pedidos tarda más de 3 segundos.
import http from 'node:http';
import https from 'node:https';
import { writeFileSync } from 'node:fs';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith('--')) continue;
  const siguiente = process.argv[i + 1];
  args[a.slice(2)] = siguiente === undefined || siguiente.startsWith('--') ? 'true' : (i++, siguiente);
}
const opt = {
  url: (args.url ?? '').replace(/\/$/, ''),
  personas: (args.personas ?? '5000,10000,20000,35000,50000').split(',').map(Number),
  segundos: Number(args.segundos ?? 60),
  cada: Number(args.cada ?? 15),
  conexiones: Number(args.conexiones ?? 1500),
  pausa: Number(args.pausa ?? 20),
  sinPdf: args['sin-pdf'] === 'true',
  salida: args.salida,
};
if (!opt.url || !args.socio || !args.conexion || !args.documento) {
  console.error('Uso: node scripts/carga.mjs --url https://<api> --socio <n> --conexion <n> --documento <dni> [--personas 5000,10000] [--segundos 60] [--cada 15]');
  process.exit(1);
}

const base = new URL(opt.url);
const mod = base.protocol === 'https:' ? https : http;
const agente = new mod.Agent({ keepAlive: true, maxSockets: opt.conexiones, maxFreeSockets: opt.conexiones });
const LIMITE_MS = 20_000;

function pedir(metodo, ruta, o = {}) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const datos = o.cuerpo ? Buffer.from(JSON.stringify(o.cuerpo)) : null;
    const req = mod.request(
      {
        method: metodo,
        hostname: base.hostname,
        port: base.port || undefined,
        path: `/api/v1${ruta}`,
        agent: agente,
        headers: {
          'User-Agent': 'GestionCoop-carga',
          Accept: 'application/json',
          ...(o.cookie ? { Cookie: o.cookie } : {}),
          ...(datos ? { 'Content-Type': 'application/json', 'Content-Length': datos.length } : {}),
        },
      },
      (res) => {
        let bytes = 0;
        const partes = o.guardar ? [] : null;
        res.on('data', (d) => {
          bytes += d.length;
          partes?.push(d);
        });
        res.on('end', () => resolve({ status: res.statusCode, bytes, ms: performance.now() - t0, headers: res.headers, cuerpo: partes ? Buffer.concat(partes).toString() : null }));
        res.on('error', () => resolve({ status: 0, bytes, ms: performance.now() - t0, error: 'respuesta cortada' }));
      },
    );
    req.setTimeout(LIMITE_MS, () => req.destroy(new Error('timeout')));
    req.on('error', (e) => resolve({ status: 0, bytes: 0, ms: performance.now() - t0, error: e.message === 'timeout' ? 'timeout' : (e.code ?? e.message) }));
    req.end(datos);
  });
}

/**
 * Entra como el socio de prueba y devuelve la cookie de sesión. Con `--entrar` se entra por la dirección
 * de la app (la que dice de qué cooperativa es) y la carga va directo a la API.
 */
async function entrar() {
  const cuerpo = Buffer.from(JSON.stringify({ socio: args.socio, conexion: args.conexion, documento: args.documento }));
  const r = args.entrar
    ? await fetch(`${args.entrar.replace(/\/$/, '')}/api/v1/auth/acceso-socio`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'GestionCoop-carga' }, body: cuerpo }).then(
        async (x) => ({ status: x.status, headers: { 'set-cookie': x.headers.getSetCookie() }, cuerpo: await x.text() }),
      )
    : await pedir('POST', '/auth/acceso-socio', { cuerpo: JSON.parse(cuerpo.toString()), guardar: true });
  if (r.status !== 200) throw new Error(`No se pudo entrar como socio (${r.status}): ${(r.cuerpo ?? r.error ?? '').slice(0, 200)}`);
  return []
    .concat(r.headers['set-cookie'] ?? [])
    .map((c) => c.split(';')[0])
    .join('; ');
}

const azar = (lista) => lista[Math.floor(Math.random() * lista.length)];

function mezcla(ids) {
  // Lo que hace la gente en el portal la semana del vencimiento.
  const tipos = [
    ['inicio', 30, () => '/socio/inicio'],
    ['facturas', 18, () => '/socio/facturas'],
    ['factura', 20, () => `/socio/facturas/${azar(ids)}`],
    ['consumo', 12, () => '/socio/consumo'],
    ['pagos', 8, () => '/socio/pagos'],
    ['cuenta', 7, () => '/socio/cuenta'],
    ['pdf', 5, () => `/socio/facturas/${azar(ids)}/pdf`],
  ].filter(([t]) => !(opt.sinPdf && t === 'pdf'));
  const total = tipos.reduce((s, [, p]) => s + p, 0);
  return () => {
    let x = Math.random() * total;
    for (const t of tipos) if ((x -= t[1]) < 0) return t;
    return tipos[0];
  };
}

const percentil = (ordenados, p) => (ordenados.length ? ordenados[Math.min(ordenados.length - 1, Math.floor((p / 100) * ordenados.length))] : 0);

async function escalon(personas, cookie, elegir) {
  const ritmo = personas / opt.cada;
  const s = { mandados: 0, descartados: 0, ok: 0, codigos: {}, errores: {}, bytes: 0, lat: [], porTipo: {} };
  const pendientes = new Set();
  let enVuelo = 0;
  const lag = monitorEventLoopDelay({ resolution: 10 });
  lag.enable();
  const t0 = performance.now();
  await new Promise((fin) => {
    const tick = setInterval(() => {
      const t = (performance.now() - t0) / 1000;
      if (t >= opt.segundos) {
        clearInterval(tick);
        fin();
        return;
      }
      const objetivo = Math.floor(ritmo * t);
      while (s.mandados + s.descartados < objetivo) {
        if (enVuelo >= opt.conexiones) {
          s.descartados++;
          continue;
        }
        const [tipo, , ruta] = elegir();
        s.mandados++;
        enVuelo++;
        const p = pedir('GET', ruta(), { cookie }).then((r) => {
          enVuelo--;
          s.bytes += r.bytes;
          s.codigos[r.status] = (s.codigos[r.status] ?? 0) + 1;
          if (r.error) s.errores[r.error] = (s.errores[r.error] ?? 0) + 1;
          const pt = (s.porTipo[tipo] ??= { n: 0, ok: 0, lat: [] });
          pt.n++;
          if (r.status >= 200 && r.status < 300) {
            s.ok++;
            pt.ok++;
            s.lat.push(r.ms);
            pt.lat.push(r.ms);
          }
        });
        pendientes.add(p);
        void p.finally(() => pendientes.delete(p));
      }
    }, 20);
  });
  const enviando = (performance.now() - t0) / 1000;
  await Promise.all(pendientes);
  lag.disable();

  s.lat.sort((a, b) => a - b);
  const intentos = s.mandados + s.descartados;
  const fallas = intentos - s.ok;
  const resumen = {
    personas,
    pedidosPorSegundo: Math.round(ritmo),
    logradosPorSegundo: Math.round(s.ok / enviando),
    intentos,
    ok: s.ok,
    fallas,
    fallasPct: intentos ? +((100 * fallas) / intentos).toFixed(2) : 0,
    sinSalir: s.descartados,
    codigos: s.codigos,
    errores: s.errores,
    p50: Math.round(percentil(s.lat, 50)),
    p95: Math.round(percentil(s.lat, 95)),
    p99: Math.round(percentil(s.lat, 99)),
    mbPorSegundo: +(s.bytes / enviando / 1e6).toFixed(2),
    // Si la máquina que genera la carga se atrasa, los números no son de la API sino de ella.
    demoraGeneradorMs: Math.round(lag.percentile(99) / 1e6),
    porTipo: Object.fromEntries(
      Object.entries(s.porTipo).map(([t, v]) => {
        v.lat.sort((a, b) => a - b);
        return [t, { pedidos: v.n, ok: v.ok, p50: Math.round(percentil(v.lat, 50)), p95: Math.round(percentil(v.lat, 95)) }];
      }),
    ),
  };
  return resumen;
}

const pausa = (seg) => new Promise((r) => setTimeout(r, seg * 1000));
const fila = (r) =>
  [
    String(r.personas).padStart(8),
    `${String(r.pedidosPorSegundo).padStart(6)} → ${String(r.logradosPorSegundo).padEnd(6)}`,
    `${String(r.fallasPct).padStart(6)} %`,
    `${String(r.p50).padStart(6)} ms`,
    `${String(r.p95).padStart(6)} ms`,
    `${String(r.p99).padStart(6)} ms`,
    `${String(r.mbPorSegundo).padStart(6)} MB/s`,
    `${String(r.demoraGeneradorMs).padStart(5)} ms`,
  ].join('  ');

console.log(`Prueba de carga contra ${base.host} · un pedido cada ${opt.cada} s por persona · ${opt.segundos} s por escalón${opt.sinPdf ? ' · sin PDF' : ''}`);
let cookie = await entrar();
const lista = await pedir('GET', '/socio/facturas', { cookie, guardar: true });
const ids = JSON.parse(lista.cuerpo).data.filas.map((f) => f.id).slice(0, 12);
if (!ids.length) throw new Error('El socio de prueba no tiene facturas');
const elegir = mezcla(ids);

console.log(' Personas   Pedidos/s pedidos → logrados  Fallas      p50        p95        p99      Datos       Generador');
const resultados = [];
for (const [i, personas] of opt.personas.entries()) {
  if (i > 0) {
    await pausa(opt.pausa);
    // La sesión dura 15 minutos: se entra de nuevo en cada escalón.
    cookie = await entrar();
  }
  const r = await escalon(personas, cookie, elegir);
  resultados.push(r);
  console.log(fila(r));
  if (r.demoraGeneradorMs > 200) console.log('          ⚠ La máquina que genera la carga se atrasó: este escalón mide más a ella que a la API.');
  if (r.fallasPct > 5 || r.p95 > 3000) {
    console.log(`          ✗ Se saturó con ${personas} personas (fallas ${r.fallasPct} %, p95 ${r.p95} ms). No se sigue subiendo.`);
    console.log('          Códigos:', JSON.stringify(r.codigos), 'Errores:', JSON.stringify(r.errores));
    break;
  }
}
console.log('\nPor tipo de pedido (último escalón):');
for (const [t, v] of Object.entries(resultados.at(-1).porTipo)) console.log(`  ${t.padEnd(9)} ${String(v.pedidos).padStart(7)} pedidos · ok ${v.ok} · p50 ${v.p50} ms · p95 ${v.p95} ms`);
if (opt.salida) writeFileSync(opt.salida, JSON.stringify({ fecha: new Date().toISOString(), url: base.host, opciones: { ...opt, url: undefined }, resultados }, null, 2));
agente.destroy();
