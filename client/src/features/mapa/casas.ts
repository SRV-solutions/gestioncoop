// Lo que no cambia mientras el mapa está abierto: dónde está cada casa y qué forma tiene, los
// contornos de las zonas y el recorrido de las rutas de lectura. De qué color va cada casa lo
// decide vista.ts, que se vuelve a calcular con cada filtro y con cada dato nuevo.
import type { Feature, FeatureCollection, LineString, Polygon, Position } from 'geojson';
import type { MapaConexiones } from '@shared';

export interface DatosMapa {
  /** Contorno de cada casa (un rectángulo alineado con su calle) y su altura, en el orden de `mapa.ids`. */
  anillos: Position[][];
  altos: number[];
  /** Posición de cada conexión dentro de las columnas, por su id. */
  indice: Map<number, number>;
  zonas: FeatureCollection;
  rutas: FeatureCollection<LineString>;
  /** [[oeste, sur], [este, norte]] del casco urbano, para el encuadre inicial. */
  encuadre: [[number, number], [number, number]] | null;
  /** Centro del encuadre: desde ahí se calcula la posición del sol. */
  centro: [number, number] | null;
}

/** Punto del medio de un contorno, para colgarle un nombre. */
export function medioDe(contorno: Polygon): Position {
  const anillo = contorno.coordinates[0] ?? [];
  return [anillo.reduce((t, p) => t + p[0]!, 0) / (anillo.length || 1), anillo.reduce((t, p) => t + p[1]!, 0) / (anillo.length || 1)];
}

export function construirDatos(m: MapaConexiones): DatosMapa {
  const anillos: Position[][] = [];
  const altos: number[] = [];
  const indice = new Map<number, number>();
  const urbanos: [number, number][] = [];
  const paradas = new Map<number, { orden: number; lugar: Position }[]>();

  for (let i = 0; i < m.ids.length; i++) {
    const id = m.ids[i]!;
    const lng = m.lng[i]!;
    const lat = m.lat[i]!;
    indice.set(id, i);
    if (m.zonas[m.zona[i]!]?.tipo !== 'rural') urbanos.push([lng, lat]);
    if (m.ruta[i]! >= 0) paradas.set(m.ruta[i]!, [...(paradas.get(m.ruta[i]!) ?? []), { orden: m.orden[i]!, lugar: [lng, lat] }]);

    // Cada casa tiene un tamaño apenas distinto (sale de su id, así no cambia entre cargas).
    const frente = 8 + (id % 5);
    const fondo = 7 + (id % 3);
    altos.push(3.2 + (id % 4) * 0.55);

    // Rectángulo alineado con el rumbo de la calle (0° = norte, en sentido horario).
    const rumbo = (m.orientacion[i]! * Math.PI) / 180;
    const u: [number, number] = [Math.sin(rumbo), Math.cos(rumbo)];
    const v: [number, number] = [Math.cos(rumbo), -Math.sin(rumbo)];
    const kx = 111_320 * Math.cos((lat * Math.PI) / 180);
    const ky = 110_540;
    const esquina = (a: number, b: number): Position => [lng + (u[0] * a * frente + v[0] * b * fondo) / 2 / kx, lat + (u[1] * a * frente + v[1] * b * fondo) / 2 / ky];
    anillos.push([esquina(-1, -1), esquina(1, -1), esquina(1, 1), esquina(-1, 1), esquina(-1, -1)]);
  }

  // Cada zona va dos veces: su contorno y un punto en el medio para el nombre (si el nombre se
  // colgara del contorno, el mapa lo repetiría en cada tesela).
  const zonas: Feature[] = m.zonas
    .filter((z) => z.poligono)
    .flatMap((z): Feature[] => {
      const contorno = z.poligono as Polygon;
      const properties = { nombre: z.nombre, tipo: z.tipo };
      return [
        { type: 'Feature', properties, geometry: contorno },
        { type: 'Feature', properties, geometry: { type: 'Point', coordinates: medioDe(contorno) } },
      ];
    });

  // Cada ruta de lectura, como una línea que une sus casas en el orden en que se recorren.
  const rutas: Feature<LineString>[] = [...paradas]
    .filter(([, lista]) => lista.length > 1)
    .map(([ruta, lista]) => ({
      type: 'Feature',
      properties: { nombre: m.rutas[ruta]?.nombre ?? '' },
      geometry: { type: 'LineString', coordinates: lista.sort((a, b) => a.orden - b.orden).map((p) => p.lugar) },
    }));

  // El encuadre inicial es el casco urbano; si la cooperativa es toda rural, todas sus conexiones.
  const base = urbanos.length ? urbanos : m.ids.map((_, i): [number, number] => [m.lng[i]!, m.lat[i]!]);
  let encuadre: DatosMapa['encuadre'] = null;
  if (base.length) {
    let [oeste, sur, este, norte] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [x, y] of base) {
      oeste = Math.min(oeste, x);
      este = Math.max(este, x);
      sur = Math.min(sur, y);
      norte = Math.max(norte, y);
    }
    encuadre = [
      [oeste, sur],
      [este, norte],
    ];
  }
  return {
    anillos,
    altos,
    indice,
    zonas: { type: 'FeatureCollection', features: zonas },
    rutas: { type: 'FeatureCollection', features: rutas },
    encuadre,
    centro: encuadre ? [(encuadre[0][0] + encuadre[1][0]) / 2, (encuadre[0][1] + encuadre[1][1]) / 2] : null,
  };
}
