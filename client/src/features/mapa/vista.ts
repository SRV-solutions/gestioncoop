// De qué color va cada casa y cuáles se ven, según lo que se esté mirando (deuda o lecturas en
// vivo) y los filtros puestos. Es una cuenta sobre columnas: con 10.000 casas tarda milisegundos,
// así que se rehace entera con cada filtro y con cada dato nuevo (SPEC 6.10).
import type { Feature, FeatureCollection, Point, Polygon } from 'geojson';
import { estadoEmpaquetado, peorSituacion, SERVICIOS_CONEXION, SITUACIONES, situacionDe, type MapaCapas, type MapaConexiones, type MapaLecturas, type ServicioConexion, type Situacion } from '@shared';
import type { DatosMapa } from './casas';

/** Qué cuenta el color de las casas. */
export type Modo = 'situacion' | 'lecturas';
export type FiltroServicio = 'todos' | 'energia' | 'agua' | 'internet' | 'tv';
export const FILTROS_SERVICIO: FiltroServicio[] = ['todos', 'energia', 'agua', 'internet', 'tv'];
export type Calor = 'no' | 'deuda' | 'consumo';

export interface Filtros {
  servicio: FiltroServicio;
  /** Colores apagados desde la leyenda (posición dentro de `COLORES`). */
  ocultos: ReadonlySet<number>;
  /** Posición de la zona dentro de `mapa.zonas`. */
  zona: number | null;
  /** Posición de la categoría dentro de CATEGORIAS (la del servicio de energía). */
  categoria: number | null;
  /** Consumo del último mes facturado: kWh, o m³ si el filtro de servicio es agua. */
  consumoMin: number | null;
  consumoMax: number | null;
}

export const SIN_FILTROS: Filtros = { servicio: 'todos', ocultos: new Set(), zona: null, categoria: null, consumoMin: null, consumoMax: null };

/**
 * Los cinco colores del mapa, en el orden en que los conoce el estilo (propiedad `e` de cada casa).
 * En «deuda» son las situaciones; en «lecturas» se reusan: verde = leída, ámbar = con novedad,
 * gris = falta leer.
 */
export const COLORES = ['alDia', 'conDeuda', 'mora', 'cortado', 'baja'] as const;
const VERDE = 0;
const AMBAR = 1;
const ROJO = 2;
const GRIS = 3;
export const SIN_SERVICIO = 4;

export interface Leyenda {
  color: number;
  nombre: string;
  ayuda: string;
}

export function leyendaDe(modo: Modo, facturasParaCorte: number): Leyenda[] {
  if (modo === 'lecturas') {
    return [
      { color: VERDE, nombre: 'Leída', ayuda: 'Ya se cargaron todos sus medidores este mes.' },
      { color: AMBAR, nombre: 'Con novedad', ayuda: 'Se cargó, pero con una novedad o una anomalía que la oficina todavía no miró.' },
      { color: GRIS, nombre: 'Falta leer', ayuda: 'Le falta al menos un medidor.' },
    ];
  }
  return [
    { color: VERDE, nombre: 'Al día', ayuda: 'No debe nada.' },
    { color: AMBAR, nombre: 'Con deuda', ayuda: `Debe algo, pero menos de ${facturasParaCorte} facturas vencidas.` },
    { color: ROJO, nombre: 'En mora', ayuda: `Tiene ${facturasParaCorte} o más facturas vencidas: figura en los cortes sugeridos.` },
    { color: GRIS, nombre: 'Cortado', ayuda: 'El servicio está cortado.' },
    // Solo aparece en la leyenda si hay alguna.
    { color: SIN_SERVICIO, nombre: 'De baja', ayuda: 'No le queda ningún servicio activo.' },
  ];
}

/* ───────────────────────── Datos por casa ───────────────────────── */

/** Las capas, puestas en columnas alineadas con las casas para leerlas sin buscar. */
export interface PorCasa {
  facturasParaCorte: number;
  /** Deuda y facturas vencidas de cada servicio (en el orden de SERVICIOS_CONEXION). */
  deuda: Float64Array[];
  vencidas: Uint16Array[];
  energia: Float64Array;
  agua: Float64Array;
}

export function porCasa(mapa: MapaConexiones, datos: DatosMapa, capas: MapaCapas | undefined): PorCasa {
  const n = mapa.ids.length;
  const out: PorCasa = {
    facturasParaCorte: capas?.facturasParaCorte ?? 2,
    deuda: SERVICIOS_CONEXION.map(() => new Float64Array(n)),
    vencidas: SERVICIOS_CONEXION.map(() => new Uint16Array(n)),
    energia: new Float64Array(n),
    agua: new Float64Array(n),
  };
  for (const [id, servicio, deuda, vencidas] of capas?.deudas ?? []) {
    const i = datos.indice.get(id);
    if (i === undefined || !out.deuda[servicio]) continue;
    out.deuda[servicio][i] = deuda;
    out.vencidas[servicio]![i] = vencidas;
  }
  for (const [id, energia, agua] of capas?.consumo.filas ?? []) {
    const i = datos.indice.get(id);
    if (i === undefined) continue;
    out.energia[i] = energia;
    out.agua[i] = agua;
  }
  return out;
}

/** Situación de una casa: la del servicio elegido o, con «todas», la más urgente de sus servicios. */
function situacionDeCasa(mapa: MapaConexiones, k: PorCasa, i: number, servicio: FiltroServicio): Situacion {
  const de = (s: ServicioConexion) => {
    const j = SERVICIOS_CONEXION.indexOf(s);
    return situacionDe({ estado: estadoEmpaquetado(mapa.estados[i]!, s), deuda: k.deuda[j]![i]!, vencidas: k.vencidas[j]![i]! }, k.facturasParaCorte);
  };
  return servicio === 'todos' ? peorSituacion(SERVICIOS_CONEXION.map(de)) : de(servicio);
}

/** Lo que debe una casa: de un servicio o de todos. */
export function deudaDeCasa(k: PorCasa, i: number, servicio: FiltroServicio): number {
  if (servicio !== 'todos') return k.deuda[SERVICIOS_CONEXION.indexOf(servicio)]![i]!;
  return k.deuda.reduce((t, columna) => t + columna[i]!, 0);
}

/* ───────────────────────── La vista ───────────────────────── */

export interface Vista {
  casas: FeatureCollection<Polygon>;
  puntos: FeatureCollection<Point>;
  /** Cuántas casas hay de cada color con los filtros puestos (sin contar lo apagado en la leyenda). */
  conteo: number[];
  /** Posición, dentro de las columnas del mapa, de cada casa que se ve. */
  visibles: number[];
  /** Deuda de las casas que se ven. */
  deuda: number;
}

export function armarVista(mapa: MapaConexiones, datos: DatosMapa, k: PorCasa, lecturas: MapaLecturas | undefined, modo: Modo, f: Filtros): Vista {
  const casas: Feature<Polygon>[] = [];
  const puntos: Feature<Point>[] = [];
  const conteo = COLORES.map(() => 0);
  const visibles: number[] = [];
  let deuda = 0;
  const leidas = modo === 'lecturas' ? new Map((lecturas?.conexiones ?? []).map((c) => [c[0], c])) : null;
  const consumo = f.servicio === 'agua' ? k.agua : k.energia;

  for (let i = 0; i < mapa.ids.length; i++) {
    const id = mapa.ids[i]!;
    if (f.servicio !== 'todos' && estadoEmpaquetado(mapa.estados[i]!, f.servicio) === null) continue;
    if (f.zona !== null && mapa.zona[i] !== f.zona) continue;
    if (f.categoria !== null && mapa.categoria[i] !== f.categoria) continue;
    if (f.consumoMin !== null && consumo[i]! < f.consumoMin) continue;
    if (f.consumoMax !== null && consumo[i]! > f.consumoMax) continue;

    let color: number;
    if (leidas) {
      const l = leidas.get(id);
      // Una casa sin medidores no entra en la lectura: no se dibuja en este modo.
      if (!l) continue;
      color = l[3] ? AMBAR : l[2] >= l[1] ? VERDE : GRIS;
    } else {
      color = SITUACIONES.indexOf(situacionDeCasa(mapa, k, i, f.servicio));
    }
    conteo[color]!++;
    if (f.ocultos.has(color)) continue;

    visibles.push(i);
    deuda += deudaDeCasa(k, i, f.servicio);
    const energia = estadoEmpaquetado(mapa.estados[i]!, 'energia');
    const properties = {
      id,
      e: color,
      h: datos.altos[i]!,
      // De noche se enciende la casa que tiene luz.
      l: energia === 'activo' || energia === 'suspendido' ? 1 : 0,
      // «Lo que hay que mirar» de cada modo: con eso se pintan los grupos al alejar el mapa.
      m: (leidas ? color === GRIS : color === ROJO) ? 1 : 0,
    };
    casas.push({ type: 'Feature', id, properties, geometry: { type: 'Polygon', coordinates: [datos.anillos[i]!] } });
    puntos.push({ type: 'Feature', id, properties, geometry: { type: 'Point', coordinates: [mapa.lng[i]!, mapa.lat[i]!] } });
  }
  return { casas: { type: 'FeatureCollection', features: casas }, puntos: { type: 'FeatureCollection', features: puntos }, conteo, visibles, deuda };
}

/** Puntos con peso para el mapa de calor: la deuda o el consumo de cada casa que se ve, de 0 a 1. */
export function armarCalor(mapa: MapaConexiones, k: PorCasa, vista: Vista, calor: Calor, servicio: FiltroServicio): FeatureCollection<Point> {
  if (calor === 'no') return { type: 'FeatureCollection', features: [] };
  const consumo = servicio === 'agua' ? k.agua : k.energia;
  const valores = vista.visibles.map((i) => (calor === 'deuda' ? deudaDeCasa(k, i, servicio) : consumo[i]!));
  // El tope es el valor que supera al 95 % de las casas: un solo consumo enorme no apaga a todo el resto.
  const positivos = valores.filter((v) => v > 0).sort((a, b) => a - b);
  const tope = positivos[Math.floor(positivos.length * 0.95)] ?? positivos.at(-1) ?? 1;
  const features: Feature<Point>[] = [];
  vista.visibles.forEach((i, j) => {
    if (valores[j]! > 0) features.push({ type: 'Feature', properties: { w: Math.min(valores[j]! / tope, 1) }, geometry: { type: 'Point', coordinates: [mapa.lng[i]!, mapa.lat[i]!] } });
  });
  return { type: 'FeatureCollection', features };
}
