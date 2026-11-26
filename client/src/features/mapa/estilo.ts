// Estilo del mapa. Es propio (no uno prestado) para poder pasar de día a noche con suavidad:
// cada color sale de una paleta y la paleta se mezcla según la altura del sol.
//
// Datos del mapa base: teselas vectoriales de OpenFreeMap (esquema OpenMapTiles, datos de
// OpenStreetMap). Sin clave ni registro; la atribución la muestra MapLibre sola.
// Relieve: Terrain Tiles de AWS Open Data (formato "terrarium").
import type { GeoJSONSourceSpecification, LayerSpecification, LightSpecification, Map, RasterDEMSourceSpecification, SkySpecification, StyleSpecification } from 'maplibre-gl';
import type { Sol } from './sol';

type RGB = [number, number, number];

const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/** Colores del mapa en un momento del día. */
const PALETAS = {
  dia: {
    tierra: '#eef0e4',
    pasto: '#dfe9cf',
    monte: '#c5dbb6',
    urbano: '#ebe7dc',
    parque: '#cfe5bf',
    agua: '#a5d0e6',
    rutaBorde: '#d2ccbd',
    ruta: '#fffdf6',
    calleBorde: '#dcd7ca',
    calle: '#ffffff',
    senda: '#c4b79f',
    edificio: '#d9d2c2',
    texto: '#3a4740',
    textoSuave: '#6b766f',
    halo: '#fbfaf5',
    cielo: '#8ec9f5',
    horizonte: '#dcedf8',
    niebla: '#f1f6f2',
    relieveSombra: '#4f5f4b',
    relieveLuz: '#ffffff',
    luz: '#ffffff',
    zona: '#2d6a4f',
    // Casas y puntos según su situación (SPEC 6.10): al día, con deuda, en mora, cortado y de baja.
    // Son los mismos tonos en las tres fases del día, más claros de noche: el color significa lo mismo a cualquier hora.
    alDia: '#2f9e62',
    conDeuda: '#e8a13a',
    mora: '#d64545',
    cortado: '#7b8794',
    baja: '#b9c1c9',
    reclamo: '#6250d6',
    corte: '#0b6be0',
    recorrido: '#52514e',
    dibujo: '#f6950a',
  },
  atardecer: {
    tierra: '#e6d6c4',
    pasto: '#d5cfae',
    monte: '#aebb92',
    urbano: '#e4d2bf',
    parque: '#b9c79c',
    agua: '#d99a78',
    rutaBorde: '#c7ae93',
    ruta: '#fbe9d2',
    calleBorde: '#cfb89e',
    calle: '#f6e3cb',
    senda: '#b79a7c',
    edificio: '#d2b79b',
    texto: '#4a3a33',
    textoSuave: '#7a665b',
    halo: '#f6e6d2',
    cielo: '#5b6fa8',
    horizonte: '#f6a565',
    niebla: '#f3c9a0',
    relieveSombra: '#5a3f3a',
    relieveLuz: '#ffd9a8',
    luz: '#ffb37a',
    zona: '#8a4b2c',
    alDia: '#4f9d58',
    conDeuda: '#e0952f',
    mora: '#cf4a3d',
    cortado: '#75706f',
    baja: '#a89f98',
    reclamo: '#6a55c9',
    corte: '#2f6fc4',
    recorrido: '#5a4a40',
    dibujo: '#f6950a',
  },
  noche: {
    tierra: '#0c141d',
    pasto: '#0e1a1b',
    monte: '#0c1f18',
    urbano: '#131c27',
    parque: '#0f221a',
    agua: '#08202f',
    rutaBorde: '#1b232e',
    ruta: '#3a4352',
    calleBorde: '#141b24',
    calle: '#262f3c',
    senda: '#1d252f',
    edificio: '#1a2430',
    texto: '#c2ccd8',
    textoSuave: '#7f8c9b',
    halo: '#0a1118',
    cielo: '#040913',
    horizonte: '#15233a',
    niebla: '#0a1622',
    relieveSombra: '#02060b',
    relieveLuz: '#2d3d55',
    luz: '#7f95c4',
    zona: '#6fb6ff',
    // De noche las casas con luz se ven encendidas por su halo (capa «luces»); las cortadas quedan a oscuras.
    alDia: '#6fd596',
    conDeuda: '#ffb347',
    mora: '#ff6b5e',
    cortado: '#4a5563',
    baja: '#2a333e',
    reclamo: '#a99cf5',
    corte: '#6fb1ff',
    recorrido: '#9aa4b0',
    dibujo: '#ffa62b',
  },
} as const;

/** Luz cálida de una casa encendida de noche. */
const LUZ_DE_CASA = '#ffd98a';

type ClaveColor = keyof (typeof PALETAS)['dia'];
export type Colores = Record<ClaveColor, string>;

function mezcla(a: string, b: string, t: number): string {
  const x = hex(a);
  const y = hex(b);
  const c = x.map((v, i) => Math.round(v + (y[i]! - v) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

/** Paleta para una fase del día: 0 = día, 0.5 = atardecer/amanecer, 1 = noche. */
export function coloresPara(fase: number): Colores {
  const [desde, hasta, t] = fase <= 0.5 ? [PALETAS.dia, PALETAS.atardecer, fase * 2] : [PALETAS.atardecer, PALETAS.noche, (fase - 0.5) * 2];
  const out = {} as Colores;
  for (const clave of Object.keys(desde) as ClaveColor[]) out[clave] = mezcla(desde[clave], hasta[clave], t);
  return out;
}

/* ───────────────────────── Capas ───────────────────────── */

export const FUENTE_BASE = 'base';
export const FUENTE_CASAS = 'casas';
export const FUENTE_PUNTOS = 'puntos';
export const FUENTE_ZONAS = 'zonas';
/** Los mismos puntos que FUENTE_PUNTOS, pero sin agrupar: para el halo de luz de la noche. */
export const FUENTE_LUCES = 'luces';
export const FUENTE_CALOR = 'calor';
export const FUENTE_RUTAS = 'rutas';
export const FUENTE_CORTES = 'cortes';
export const FUENTE_RECLAMOS = 'reclamos';
export const FUENTE_DESTELLOS = 'destellos';
export const FUENTE_DIBUJO = 'dibujo';

/** Capas que se pueden tocar para elegir una casa. */
export const CAPAS_DE_CASAS = ['casas', 'puntos'];

/** Color de cada casa (propiedad `e`: posición dentro de COLORES, en vista.ts). */
const porEstado = (c: Colores) => ['match', ['get', 'e'], 0, c.alDia, 1, c.conDeuda, 2, c.mora, 3, c.cortado, c.baja] as unknown as string;

/**
 * Color de un grupo de casas (al alejar el mapa): según qué parte del grupo es «lo que hay que
 * mirar» —casas en mora, o casas sin leer en el modo de lecturas—. En deuda: verde con menos del
 * 8 % en mora, ámbar hasta el 25 % y rojo de ahí en más.
 */
const porGrupo = (c: Colores, lecturas: boolean) => {
  const parte = ['/', ['get', 'mal'], ['get', 'point_count']];
  return (lecturas ? ['step', parte, c.alDia, 0.02, c.conDeuda, 0.6, c.cortado] : ['step', parte, c.alDia, 0.08, c.conDeuda, 0.25, c.mora]) as unknown as string;
};

/** Del más frío al más caliente. La deuda va en rojos y el consumo en azules: un solo tono cada uno. */
export const rampaDeCalor = (calor: 'deuda' | 'consumo') =>
  (calor === 'deuda'
    ? ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(214,69,69,0)', 0.15, 'rgba(250,196,140,0.55)', 0.45, 'rgba(240,128,74,0.8)', 0.75, 'rgba(214,69,69,0.9)', 1, 'rgba(140,22,22,0.95)']
    : ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(42,120,214,0)', 0.15, 'rgba(158,197,244,0.55)', 0.45, 'rgba(85,152,231,0.8)', 0.75, 'rgba(37,106,191,0.9)', 1, 'rgba(13,54,107,0.95)']) as unknown as string;

/** Qué propiedad de qué capa se pinta con qué color: se usa al crear el estilo y al cambiar la hora. */
const PINTURA: [capa: string, propiedad: string, color: ClaveColor][] = [
  ['fondo', 'background-color', 'tierra'],
  ['pasto', 'fill-color', 'pasto'],
  ['monte', 'fill-color', 'monte'],
  ['urbano', 'fill-color', 'urbano'],
  ['parque', 'fill-color', 'parque'],
  ['agua', 'fill-color', 'agua'],
  ['rio', 'line-color', 'agua'],
  ['relieve', 'hillshade-shadow-color', 'relieveSombra'],
  ['relieve', 'hillshade-highlight-color', 'relieveLuz'],
  ['relieve', 'hillshade-accent-color', 'relieveSombra'],
  ['senda', 'line-color', 'senda'],
  ['calle-borde', 'line-color', 'calleBorde'],
  ['calle', 'line-color', 'calle'],
  ['ruta-borde', 'line-color', 'rutaBorde'],
  ['ruta', 'line-color', 'ruta'],
  ['zonas-relleno', 'fill-color', 'zona'],
  ['zonas-borde', 'line-color', 'zona'],
  ['edificios', 'fill-extrusion-color', 'edificio'],
  ['nombres-calles', 'text-color', 'textoSuave'],
  ['nombres-calles', 'text-halo-color', 'halo'],
  ['nombres-lugares', 'text-color', 'texto'],
  ['nombres-lugares', 'text-halo-color', 'halo'],
  ['nombres-zonas', 'text-color', 'zona'],
  ['nombres-zonas', 'text-halo-color', 'halo'],
  ['rutas', 'line-color', 'recorrido'],
  ['rutas-nombres', 'text-color', 'recorrido'],
  ['rutas-nombres', 'text-halo-color', 'halo'],
  ['cortes-relleno', 'fill-color', 'corte'],
  ['cortes-borde', 'line-color', 'corte'],
  ['cortes-nombres', 'text-color', 'corte'],
  ['cortes-nombres', 'text-halo-color', 'halo'],
  ['grupos', 'circle-stroke-color', 'halo'],
  ['reclamos-pulso', 'circle-color', 'reclamo'],
  ['reclamos', 'circle-color', 'reclamo'],
  ['reclamos', 'circle-stroke-color', 'halo'],
  ['destellos', 'circle-stroke-color', 'alDia'],
  ['dibujo-relleno', 'fill-color', 'dibujo'],
  ['dibujo-linea', 'line-color', 'dibujo'],
  ['dibujo-puntos', 'circle-color', 'dibujo'],
  ['dibujo-puntos', 'circle-stroke-color', 'halo'],
];

// Grosor de calles y rutas según el zoom. El borde es la misma curva, un poco más ancha
// (MapLibre exige que el zoom sea la entrada directa de la interpolación).
const grosor = (base: number, puntos: [zoom: number, ancho: number][], extra = 0) =>
  ['interpolate', ['exponential', base], ['zoom'], ...puntos.flatMap(([z, w]) => [z, w + extra])] as unknown as number;
const PUNTOS_CALLE: [number, number][] = [[11, 0.4], [14, 2.2], [16, 7], [18, 22]];
const PUNTOS_RUTA: [number, number][] = [[8, 0.8], [12, 2.2], [14, 4.5], [16, 12], [18, 30]];
const GROSOR_CALLE = grosor(1.6, PUNTOS_CALLE);
const GROSOR_RUTA = grosor(1.6, PUNTOS_RUTA);
const BORDE_CALLE = grosor(1.6, PUNTOS_CALLE, 1.6);
const BORDE_RUTA = grosor(1.6, PUNTOS_RUTA, 1.8);

/** Lo que late se anima cuadro por cuadro desde la página: el mapa no tiene que suavizarlo por su cuenta. */
const SIN_TRANSICION = { 'circle-radius-transition': { duration: 0 }, 'circle-opacity-transition': { duration: 0 } } as const;

const RUTAS = ['motorway', 'trunk', 'primary', 'secondary'];
const CALLES = ['tertiary', 'minor', 'service'];

export function crearEstilo(fase: number): StyleSpecification {
  const c = coloresPara(fase);
  const transporte = { source: FUENTE_BASE, 'source-layer': 'transportation' } as const;
  const linea = { 'line-cap': 'round', 'line-join': 'round' } as const;

  const capas: LayerSpecification[] = [
    { id: 'fondo', type: 'background', paint: {} },
    { id: 'pasto', type: 'fill', source: FUENTE_BASE, 'source-layer': 'landcover', filter: ['in', ['get', 'class'], ['literal', ['grass', 'farmland']]], paint: {} },
    { id: 'monte', type: 'fill', source: FUENTE_BASE, 'source-layer': 'landcover', filter: ['==', ['get', 'class'], 'wood'], paint: {} },
    { id: 'urbano', type: 'fill', source: FUENTE_BASE, 'source-layer': 'landuse', filter: ['in', ['get', 'class'], ['literal', ['residential', 'commercial', 'industrial']]], paint: {} },
    { id: 'parque', type: 'fill', source: FUENTE_BASE, 'source-layer': 'park', paint: {} },
    { id: 'agua', type: 'fill', source: FUENTE_BASE, 'source-layer': 'water', paint: {} },
    { id: 'rio', type: 'line', source: FUENTE_BASE, 'source-layer': 'waterway', layout: linea, paint: { 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.6, 16, 3] } },
    {
      id: 'relieve',
      type: 'hillshade',
      source: 'relieve-sombras',
      paint: { 'hillshade-exaggeration': 0.42, 'hillshade-illumination-anchor': 'map' },
    },
    { id: 'senda', type: 'line', ...transporte, filter: ['in', ['get', 'class'], ['literal', ['track', 'path']]], minzoom: 12, layout: linea, paint: { 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.6, 16, 2.5], 'line-dasharray': [2, 1.5] } },
    { id: 'calle-borde', type: 'line', ...transporte, filter: ['in', ['get', 'class'], ['literal', CALLES]], minzoom: 12, layout: linea, paint: { 'line-width': BORDE_CALLE } },
    { id: 'calle', type: 'line', ...transporte, filter: ['in', ['get', 'class'], ['literal', CALLES]], minzoom: 11, layout: linea, paint: { 'line-width': GROSOR_CALLE } },
    { id: 'ruta-borde', type: 'line', ...transporte, filter: ['in', ['get', 'class'], ['literal', RUTAS]], layout: linea, paint: { 'line-width': BORDE_RUTA } },
    { id: 'ruta', type: 'line', ...transporte, filter: ['in', ['get', 'class'], ['literal', RUTAS]], layout: linea, paint: { 'line-width': GROSOR_RUTA } },
    { id: 'zonas-relleno', type: 'fill', source: FUENTE_ZONAS, filter: ['==', ['geometry-type'], 'Polygon'], layout: { visibility: 'none' }, paint: { 'fill-opacity': 0.08 } },
    { id: 'zonas-borde', type: 'line', source: FUENTE_ZONAS, filter: ['==', ['geometry-type'], 'Polygon'], layout: { visibility: 'none', ...linea }, paint: { 'line-width': 2, 'line-dasharray': [3, 2], 'line-opacity': 0.75 } },
    // Cortes programados: la zona afectada, con borde punteado y su cartel
    { id: 'cortes-relleno', type: 'fill', source: FUENTE_CORTES, filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-opacity': 0.16 } },
    { id: 'cortes-borde', type: 'line', source: FUENTE_CORTES, filter: ['==', ['geometry-type'], 'Polygon'], layout: linea, paint: { 'line-width': 2.5, 'line-dasharray': [1.5, 1.5], 'line-opacity': 0.9 } },
    // Recorrido de cada ruta de lectura
    { id: 'rutas', type: 'line', source: FUENTE_RUTAS, layout: { visibility: 'none', ...linea }, paint: { 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1, 16, 3], 'line-opacity': 0.75, 'line-dasharray': [0.5, 1.6] } },
    // Mapa de calor de deuda o de consumo (apagado hasta que se elige)
    {
      id: 'calor',
      type: 'heatmap',
      source: FUENTE_CALOR,
      layout: { visibility: 'none' },
      paint: {
        'heatmap-weight': ['get', 'w'],
        'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 10, 0.5, 14, 1, 17, 1.6],
        'heatmap-radius': ['interpolate', ['exponential', 1.6], ['zoom'], 10, 5, 13, 22, 15, 46, 17, 90],
        'heatmap-opacity': 0.8,
      },
    },
    // Edificios reales dibujados en OpenStreetMap
    {
      id: 'edificios',
      type: 'fill-extrusion',
      source: FUENTE_BASE,
      'source-layer': 'building',
      minzoom: 14,
      paint: {
        'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 4],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
        'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0, 14.8, 0.9],
      },
    },
    // Halo de luz de cada casa: solo se ve de noche (su opacidad la maneja aplicarHora)
    {
      id: 'luces',
      type: 'circle',
      source: FUENTE_LUCES,
      paint: {
        'circle-radius': ['interpolate', ['exponential', 1.7], ['zoom'], 10, 2.5, 13, 6, 15, 16, 17, 46],
        'circle-blur': 1,
        'circle-opacity': 0,
        'circle-pitch-alignment': 'map',
      },
    },
    // Las conexiones de la cooperativa, como casas 3D al acercarse...
    {
      id: 'casas',
      type: 'fill-extrusion',
      source: FUENTE_CASAS,
      minzoom: 13.6,
      paint: {
        'fill-extrusion-height': ['get', 'h'],
        'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], 13.6, 0, 14.4, 1],
        'fill-extrusion-vertical-gradient': true,
      },
    },
    // ...como puntos al alejarse (10.000 puntos en una sola capa, no un marcador por punto)...
    {
      id: 'puntos',
      type: 'circle',
      source: FUENTE_PUNTOS,
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-radius': ['interpolate', ['exponential', 1.5], ['zoom'], 9, 1.2, 12, 2.4, 14, 4.2, 16, 6],
        'circle-opacity': ['interpolate', ['linear'], ['zoom'], 13.8, 1, 14.6, 0],
        'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 11, 0, 13, 1],
        'circle-stroke-opacity': ['interpolate', ['linear'], ['zoom'], 13.8, 0.9, 14.6, 0],
      },
    },
    // ...y agrupadas más lejos todavía: un círculo con la cantidad de casas (SPEC 6.10)
    {
      id: 'grupos',
      type: 'circle',
      source: FUENTE_PUNTOS,
      filter: ['has', 'point_count'],
      paint: {
        'circle-radius': ['step', ['get', 'point_count'], 13, 25, 16, 100, 20, 400, 25, 1500, 30],
        'circle-stroke-width': 2,
        'circle-opacity': 0.92,
      },
    },
    {
      id: 'grupos-numeros',
      type: 'symbol',
      source: FUENTE_PUNTOS,
      filter: ['has', 'point_count'],
      layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-allow-overlap': true },
      paint: { 'text-color': '#0d0d0d' },
    },
    // Reclamos sin resolver: un punto que late
    { id: 'reclamos-pulso', type: 'circle', source: FUENTE_RECLAMOS, paint: { 'circle-radius': 14, 'circle-opacity': 0.3, 'circle-pitch-alignment': 'map', ...SIN_TRANSICION } },
    {
      id: 'reclamos',
      type: 'circle',
      source: FUENTE_RECLAMOS,
      paint: { 'circle-radius': ['case', ['==', ['get', 'urgente'], 1], 7.5, 6], 'circle-stroke-width': 2.5 },
    },
    // Casas recién leídas (modo «Lecturas en vivo»): un anillo que se abre y se va
    { id: 'destellos', type: 'circle', source: FUENTE_DESTELLOS, paint: { 'circle-radius': 10, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-width': 3, 'circle-stroke-opacity': 0.9, ...SIN_TRANSICION, 'circle-stroke-opacity-transition': { duration: 0 } } },
    // Área que se está dibujando
    { id: 'dibujo-relleno', type: 'fill', source: FUENTE_DIBUJO, filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-opacity': 0.18 } },
    { id: 'dibujo-linea', type: 'line', source: FUENTE_DIBUJO, filter: ['==', ['geometry-type'], 'LineString'], layout: linea, paint: { 'line-width': 3 } },
    { id: 'dibujo-puntos', type: 'circle', source: FUENTE_DIBUJO, filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 5, 'circle-stroke-width': 2 } },
    {
      id: 'rutas-nombres',
      type: 'symbol',
      source: FUENTE_RUTAS,
      minzoom: 13,
      layout: { visibility: 'none', 'symbol-placement': 'line', 'text-field': ['get', 'nombre'], 'text-font': ['Noto Sans Bold'], 'text-size': 11, 'symbol-spacing': 420 },
      paint: { 'text-halo-width': 1.6 },
    },
    {
      id: 'nombres-calles',
      type: 'symbol',
      source: FUENTE_BASE,
      'source-layer': 'transportation_name',
      minzoom: 14,
      layout: { 'symbol-placement': 'line', 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 14, 10, 18, 14], 'text-max-angle': 30 },
      paint: { 'text-halo-width': 1.4 },
    },
    {
      id: 'nombres-zonas',
      type: 'symbol',
      source: FUENTE_ZONAS,
      filter: ['==', ['geometry-type'], 'Point'],
      layout: { visibility: 'none', 'text-field': ['get', 'nombre'], 'text-font': ['Noto Sans Bold'], 'text-size': 13, 'text-transform': 'uppercase', 'text-letter-spacing': 0.08 },
      paint: { 'text-halo-width': 1.6 },
    },
    {
      id: 'nombres-lugares',
      type: 'symbol',
      source: FUENTE_BASE,
      'source-layer': 'place',
      filter: ['in', ['get', 'class'], ['literal', ['city', 'town', 'village', 'hamlet', 'suburb', 'neighbourhood', 'quarter']]],
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['match', ['get', 'class'], ['city', 'town'], ['literal', ['Noto Sans Bold']], ['literal', ['Noto Sans Regular']]],
        'text-size': ['match', ['get', 'class'], ['city', 'town'], 17, ['village', 'hamlet'], 13, 11.5],
        'text-max-width': 8,
      },
      paint: { 'text-halo-width': 1.6 },
    },
    // El cartel de cada corte va último: tiene prioridad sobre los nombres de calles y barrios.
    {
      id: 'cortes-nombres',
      type: 'symbol',
      source: FUENTE_CORTES,
      filter: ['==', ['geometry-type'], 'Point'],
      layout: { 'text-field': ['get', 'cartel'], 'text-font': ['Noto Sans Bold'], 'text-size': 12.5, 'text-max-width': 12, 'text-allow-overlap': true },
      paint: { 'text-halo-width': 2 },
    },
  ];

  // Colores de la paleta
  for (const [capa, propiedad, color] of PINTURA) {
    const layer = capas.find((l) => l.id === capa) as { paint: Record<string, unknown> };
    layer.paint[propiedad] = c[color];
  }
  const pintura = (id: string) => (capas.find((l) => l.id === id) as { paint: Record<string, unknown> }).paint;
  pintura('casas')['fill-extrusion-color'] = porEstado(c);
  pintura('puntos')['circle-color'] = porEstado(c);
  pintura('puntos')['circle-stroke-color'] = c.halo;
  pintura('grupos')['circle-color'] = porGrupo(c, false);
  pintura('luces')['circle-color'] = LUZ_DE_CASA;

  const vacio = (): GeoJSONSourceSpecification => ({ type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  return {
    version: 8,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      [FUENTE_BASE]: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' },
      // Dos fuentes del mismo relieve: una levanta el terreno en 3D y la otra le da el sombreado.
      relieve: relieve(),
      'relieve-sombras': relieve(),
      [FUENTE_ZONAS]: vacio(),
      [FUENTE_CASAS]: vacio(),
      // Al alejar el mapa las casas se agrupan; cada grupo sabe cuántas de las suyas hay que mirar (`mal`).
      [FUENTE_PUNTOS]: { ...vacio(), cluster: true, clusterMaxZoom: 12, clusterRadius: 46, clusterProperties: { mal: ['+', ['get', 'm']] } },
      [FUENTE_LUCES]: vacio(),
      [FUENTE_CALOR]: vacio(),
      [FUENTE_RUTAS]: vacio(),
      [FUENTE_CORTES]: vacio(),
      [FUENTE_RECLAMOS]: vacio(),
      [FUENTE_DESTELLOS]: vacio(),
      [FUENTE_DIBUJO]: vacio(),
    },
    layers: capas,
    sky: cielo(c, fase),
    light: luz(c, fase, { altitud: 45, azimut: 300 }),
  };
}

function relieve(): RasterDEMSourceSpecification {
  return {
    type: 'raster-dem',
    tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
    encoding: 'terrarium',
    tileSize: 256,
    maxzoom: 14,
    attribution: 'Relieve: Mapzen · AWS Terrain Tiles',
  };
}

function cielo(c: Colores, fase: number): SkySpecification {
  return {
    'sky-color': c.cielo,
    'horizon-color': c.horizonte,
    'fog-color': c.niebla,
    'sky-horizon-blend': 0.7,
    'horizon-fog-blend': 0.6,
    // De noche la bruma tapa menos, para que se vean las luces a lo lejos.
    'fog-ground-blend': 0.55 + 0.3 * fase,
    'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 10, 0.9, 12, 0.4, 14, 0.1],
  };
}

function luz(c: Colores, fase: number, sol: Sol): LightSpecification {
  // De día la luz viene de donde está el sol; de noche, una luz tenue desde arriba.
  const polar = fase > 0.8 ? 35 : Math.min(82, Math.max(8, 90 - sol.altitud));
  return {
    anchor: 'map',
    position: [1.5, sol.azimut, polar],
    color: c.luz,
    intensity: 0.5 - 0.3 * fase,
  };
}

/**
 * Lleva el mapa a un momento del día. MapLibre anima solo cada cambio de color, así que
 * llamarlo varias veces por segundo se ve como una transición continua.
 */
export function aplicarHora(map: Map, fase: number, sol: Sol, lecturas = false): void {
  const c = coloresPara(fase);
  for (const [capa, propiedad, color] of PINTURA) {
    if (map.getLayer(capa)) map.setPaintProperty(capa, propiedad as never, c[color] as never);
  }
  map.setPaintProperty('casas', 'fill-extrusion-color', porEstado(c));
  map.setPaintProperty('puntos', 'circle-color', porEstado(c));
  map.setPaintProperty('puntos', 'circle-stroke-color', c.halo);
  map.setPaintProperty('grupos', 'circle-color', porGrupo(c, lecturas));
  // Las luces se encienden al caer el sol. Sin luz (cortada o sin el servicio), la casa queda a oscuras.
  const encendido = Math.max(0, (fase - 0.45) / 0.55);
  map.setPaintProperty('luces', 'circle-opacity', ['case', ['==', ['get', 'l'], 1], 0.45 * encendido, 0]);
  // La sombra del relieve acompaña al sol.
  map.setPaintProperty('relieve', 'hillshade-illumination-direction', Math.round(sol.azimut));
  map.setPaintProperty('relieve', 'hillshade-exaggeration', 0.42 - 0.12 * fase);
  map.setSky(cielo(c, fase));
  map.setLight(luz(c, fase, sol));
}
