// Convierte las calles descargadas de OpenStreetMap en el archivo liviano que usa el seed para ubicar
// los hogares de prueba sobre la trama real de calles (SPEC sección 9).
//
// 1) Bajar las calles de la zona con Overpass (https://overpass-api.de/api/interpreter):
//      [out:json][timeout:120];way["highway"](SUR,OESTE,NORTE,ESTE);out geom;
// 2) node scripts/osm-import.mjs calles-crudas.json src/seed/data/dosdemayo.json
//
// Datos © colaboradores de OpenStreetMap, licencia ODbL (https://www.openstreetmap.org/copyright).
import { readFileSync, writeFileSync } from 'node:fs';

const [, , inputPath, outputPath] = process.argv;
if (!inputPath || !outputPath) {
  console.error('Uso: node scripts/osm-import.mjs <calles-crudas.json> <salida.json>');
  process.exit(1);
}

// ── Parámetros de Dos de Mayo (verificados con Nominatim el 20/11/2026) ──
const CENTRO = [-54.6842, -27.0289];
/** Límite de la localidad urbana según OSM: [oeste, sur, este, norte]. */
const URBANO = [-54.7017, -27.0449, -54.6735, -27.0131];
/** Barrios y parajes reales (nodos `place` de OSM) que hacen de centro de cada zona. */
const ZONAS = [
  { nombre: 'Centro', tipo: 'urbana', ancla: [-54.6849, -27.0287] },
  { nombre: 'San Antonio', tipo: 'urbana', ancla: [-54.6833, -27.0195] },
  { nombre: 'Las Naciones', tipo: 'urbana', ancla: [-54.6952, -27.022] },
  { nombre: 'Sagrado Corazón de Jesús', tipo: 'urbana', ancla: [-54.6938, -27.0273] },
  { nombre: 'Esfuerzo Solidario', tipo: 'urbana', ancla: [-54.6832, -27.0399] },
  { nombre: 'Néstor Kirchner', tipo: 'urbana', ancla: [-54.6790, -27.0281] },
  { nombre: 'Paraje Cascuda', tipo: 'rural', ancla: [-54.6424, -27.0555] },
  { nombre: 'Paraje Almafuerte', tipo: 'rural', ancla: [-54.6998, -26.9851] },
  { nombre: 'Paraje La Cordillera', tipo: 'rural', ancla: [-54.7298, -27.0271] },
  { nombre: 'Colonia 2 de Mayo', tipo: 'rural', ancla: [-54.6634, -26.9873] },
];
const RADIO_RURAL_M = 4500;
const TIPOS = new Set(['residential', 'unclassified', 'tertiary', 'secondary', 'primary', 'trunk', 'track']);
const TOLERANCIA_M = 2.5;

// ── Geometría plana alrededor del centro (alcanza de sobra para unos pocos kilómetros) ──
const KX = 111_320 * Math.cos((CENTRO[1] * Math.PI) / 180);
const KY = 110_540;
const toXY = ([lng, lat]) => [(lng - CENTRO[0]) * KX, (lat - CENTRO[1]) * KY];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Douglas-Peucker: saca puntos que no cambian la forma de la calle. */
function simplify(points) {
  if (points.length < 3) return points;
  const xy = points.map(toXY);
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = xy[a];
    const [bx, by] = xy[b];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    let worst = -1;
    let worstD = TOLERANCIA_M;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((by - ay) * xy[i][0] - (bx - ax) * xy[i][1] + bx * ay - by * ax) / len;
      if (d > worstD) {
        worstD = d;
        worst = i;
      }
    }
    if (worst > 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

const inUrban = ([lng, lat]) => lng >= URBANO[0] && lng <= URBANO[2] && lat >= URBANO[1] && lat <= URBANO[3];
const round = (n) => Math.round(n * 1e5) / 1e5;

const raw = JSON.parse(readFileSync(inputPath, 'utf8'));
const rurales = ZONAS.filter((z) => z.tipo === 'rural').map((z) => toXY(z.ancla));
const calles = [];
const km = { urbana: 0, rural: 0 };

for (const way of raw.elements) {
  const tipo = way.tags?.highway;
  if (way.type !== 'way' || !TIPOS.has(tipo) || !way.geometry || way.geometry.length < 2) continue;
  const points = way.geometry.map((p) => [p.lon, p.lat]);
  const mid = points[Math.floor(points.length / 2)];
  const urbana = inUrban(mid);
  if (!urbana && !rurales.some((r) => dist(r, toXY(mid)) <= RADIO_RURAL_M)) continue;
  const g = simplify(points).map(([lng, lat]) => [round(lng), round(lat)]);
  const largo = g.slice(1).reduce((t, p, i) => t + dist(toXY(g[i]), toXY(p)), 0);
  if (largo < 25) continue;
  km[urbana ? 'urbana' : 'rural'] += largo / 1000;
  calles.push({ n: way.tags.name?.trim() || way.tags.ref?.trim() || null, t: tipo, u: urbana ? 1 : 0, g });
}

// Orden estable: el seed tiene que dar siempre lo mismo.
calles.sort((a, b) => a.g[0][0] - b.g[0][0] || a.g[0][1] - b.g[0][1] || a.g.length - b.g.length);

const out = {
  fuente: '© colaboradores de OpenStreetMap (ODbL) — https://www.openstreetmap.org/copyright',
  centro: CENTRO,
  urbano: URBANO,
  zonas: ZONAS,
  calles,
};
writeFileSync(outputPath, JSON.stringify(out));
console.log(`✓ ${calles.length} calles (${km.urbana.toFixed(1)} km urbanos, ${km.rural.toFixed(1)} km rurales) → ${outputPath}`);
