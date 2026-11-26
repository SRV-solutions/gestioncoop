// Después del build: si hay API_URL (variable de entorno de Netlify), genera dist/_redirects para que
// /api/* vaya a la API en Railway como proxy (mismo dominio para el navegador → cookies sin CORS).
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const api = (process.env.API_URL || '').trim().replace(/\/+$/, '');
const out = fileURLToPath(new URL('../dist/_redirects', import.meta.url));
if (!api) {
  console.log('· API_URL no está definida: no se genera _redirects (en local el proxy lo hace Vite).');
} else if (!/^https:\/\//.test(api)) {
  console.error(`✗ API_URL tiene que empezar con https:// (vino "${api}")`);
  process.exit(1);
} else {
  // Las dos reglas van acá porque, si existe _redirects, tiene prioridad sobre netlify.toml.
  writeFileSync(out, `/api/*  ${api}/api/:splat  200!\n/*  /index.html  200\n`);
  console.log(`✓ _redirects: /api/* → ${api}/api/*`);
}
