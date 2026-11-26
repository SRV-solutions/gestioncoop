// Después del build: genera dist/sw.js con la lista de archivos de la app, para que el operario pueda
// abrirla sin señal (SPEC 6.3). Sin dependencias: la lista sale de recorrer dist/.
//
// Qué hace el service worker:
// - Al instalarse guarda toda la app (HTML, JS, CSS, íconos). Los nombres llevan hash: si cambia el
//   contenido cambia el nombre, y la versión de la caché sale del hash de esa lista.
// - Navegación: primero la red (para tomar versiones nuevas); sin señal, la app guardada.
// - /api nunca se guarda acá: los datos del operario viven en IndexedDB, con sus propias reglas.
import { createHash } from 'node:crypto';
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist', import.meta.url));

function archivos(dir) {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    return statSync(ruta).isDirectory() ? archivos(ruta) : [ruta];
  });
}

const lista = archivos(dist)
  .map((f) => '/' + relative(dist, f).split(sep).join('/'))
  // Los mapas de código y los archivos de Netlify no hacen falta sin conexión.
  .filter((f) => !f.endsWith('.map') && !['/sw.js', '/_redirects', '/_headers'].includes(f))
  .sort();
const version = createHash('sha256').update(lista.join('\n')).digest('hex').slice(0, 12);

const sw = `// Generado por scripts/service-worker.mjs: no editar a mano.
const CACHE = 'coopgestion-${version}';
const ARCHIVOS = ${JSON.stringify(lista)};

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(claves.filter((c) => c.startsWith('coopgestion-') && c !== CACHE).map((c) => caches.delete(c))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (req.mode === 'navigate') {
    // Con señal, la versión del servidor; sin señal, la app guardada (las rutas las resuelve el navegador).
    event.respondWith(fetch(req).catch(() => caches.match('/index.html', { cacheName: CACHE })));
    return;
  }
  event.respondWith(caches.match(req, { cacheName: CACHE }).then((guardado) => guardado || fetch(req)));
});
`;

writeFileSync(join(dist, 'sw.js'), sw);
console.log(`✓ sw.js: ${lista.length} archivos para usar sin conexión (versión ${version})`);
