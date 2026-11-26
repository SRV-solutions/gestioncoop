// Vocabulario del mapa interactivo (Fase 8), compartido entre la API y el client: de qué color va
// cada casa, las capas (deuda, consumo, reclamos, cortes, lecturas en vivo), la ficha de una
// conexión y el resumen de un área dibujada.
import { z } from 'zod';
import { CATEGORIAS, SERVICIOS_CONEXION, type Categoria, type ConexionFicha, type EstadoServicio, type ServicioConexion } from './padron';
import type { EstadoReclamo, Prioridad, ServicioCorte, ServicioReclamo } from './reclamos';
import type { FormatoInforme } from './tablero';
import type { ServicioMedido } from './tarifas';

/* ───────────────────────── Situación: el color de cada casa ───────────────────────── */

/**
 * SPEC 6.10: al día (verde), con deuda (ámbar), en mora o corte sugerido (rojo), cortado (gris).
 * El orden es el de los colores del mapa: no cambiarlo sin cambiar el estilo.
 */
export const SITUACIONES = ['al_dia', 'con_deuda', 'en_mora', 'cortado', 'baja'] as const;
export type Situacion = (typeof SITUACIONES)[number];
export const SITUACION_ETIQUETA: Record<Situacion, string> = {
  al_dia: 'Al día',
  con_deuda: 'Con deuda',
  en_mora: 'En mora',
  cortado: 'Cortado',
  baja: 'De baja',
};

/**
 * Situación de un servicio. «En mora» es haber llegado a la cantidad de facturas vencidas con la
 * que la cooperativa sugiere el corte (la misma regla del informe de cortes sugeridos); «con
 * deuda», deber algo sin llegar a eso. Un servicio ya cortado se muestra cortado, deba lo que deba.
 */
export function situacionDe(s: { estado: EstadoServicio | null; deuda: number; vencidas: number }, facturasParaCorte: number): Situacion {
  if (s.estado === null || s.estado === 'baja') return 'baja';
  if (s.estado === 'cortado') return 'cortado';
  if (s.vencidas >= facturasParaCorte) return 'en_mora';
  return s.deuda > 0 ? 'con_deuda' : 'al_dia';
}

/** La de la conexión entera: lo más urgente de sus servicios (mora, después deuda, después corte). */
export function peorSituacion(situaciones: Situacion[]): Situacion {
  for (const s of ['en_mora', 'con_deuda', 'cortado', 'al_dia'] as const) if (situaciones.includes(s)) return s;
  return 'baja';
}

/* ───────────────────────── Estado de cada servicio, empaquetado ───────────────────────── */

/** 2 bits por servicio, en el orden de SERVICIOS_CONEXION: 0 no tiene (o de baja), 1 activo, 2 suspendido, 3 cortado. */
const CODIGO_ESTADO: Record<EstadoServicio, number> = { baja: 0, activo: 1, suspendido: 2, cortado: 3 };
const ESTADO_DE_CODIGO: (EstadoServicio | null)[] = [null, 'activo', 'suspendido', 'cortado'];

export function empaquetarEstados(servicios: { servicio: ServicioConexion; estado: EstadoServicio }[]): number {
  let bits = 0;
  for (const s of servicios) bits |= CODIGO_ESTADO[s.estado] << (SERVICIOS_CONEXION.indexOf(s.servicio) * 2);
  return bits;
}

/** Estado de un servicio dentro del número empaquetado; `null` si la conexión no lo tiene. */
export function estadoEmpaquetado(bits: number, servicio: ServicioConexion): EstadoServicio | null {
  return ESTADO_DE_CODIGO[(bits >> (SERVICIOS_CONEXION.indexOf(servicio) * 2)) & 3] ?? null;
}

/* ───────────────────────── Capas que cambian ───────────────────────── */

export interface ReclamoMapa {
  id: number;
  /** «R-00042» */
  referencia: string;
  servicio: ServicioReclamo;
  tipoNombre: string;
  prioridad: Prioridad;
  estado: EstadoReclamo;
  lng: number;
  lat: number;
  conexionId: number | null;
  direccion: string | null;
  creadoEl: string;
}

export interface CorteMapa {
  id: number;
  /** `null` = toda la localidad. */
  zonaId: number | null;
  zona: string | null;
  servicio: ServicioCorte;
  desde: string;
  hasta: string;
  motivo: string;
}

/** Lo que se pinta encima de las casas y cambia durante el día. Se vuelve a pedir cada tanto. */
export interface MapaCapas {
  hoy: string;
  /** Facturas vencidas con las que un servicio pasa a «en mora» (corte sugerido). */
  facturasParaCorte: number;
  /** Solo lo que debe algo: [conexión, índice del servicio en SERVICIOS_CONEXION, deuda, facturas vencidas]. */
  deudas: [conexionId: number, servicio: number, deuda: number, vencidas: number][];
  /** Consumo del último mes facturado: [conexión, kWh, m³]. */
  consumo: { periodo: { anio: number; mes: number } | null; filas: [conexionId: number, energia: number, agua: number][] };
  /** Reclamos sin resolver que se pueden ubicar (por su punto o por el de su conexión). */
  reclamos: ReclamoMapa[];
  /** Cortes programados que todavía no terminaron. */
  cortes: CorteMapa[];
}

/** Avance de la lectura del mes, casa por casa. Se pide cada pocos segundos en el modo «Lecturas en vivo». */
export interface MapaLecturas {
  periodo: { anio: number; mes: number } | null;
  total: number;
  leidos: number;
  /** [conexión, medidores a leer, medidores ya leídos, con novedad o anomalía sin revisar (0 o 1)]. */
  conexiones: [conexionId: number, medidores: number, leidos: number, novedad: number][];
  generadoEl: string;
}

/* ───────────────────────── Ficha de una casa ───────────────────────── */

export interface FichaMapa extends ConexionFicha {
  telefono: string | null;
  situacion: Situacion;
  deuda: { total: string; facturas: number; vencidas: number; masVieja: string | null };
  /** Últimos 12 meses facturados de cada servicio con medidor. */
  consumo: { servicio: ServicioMedido; unidad: string; meses: { anio: number; mes: number; consumo: number | null }[] }[];
  /** Última lectura de cada medidor colocado. */
  lecturas: { servicio: ServicioMedido; medidor: string; valor: number | null; consumo: number | null; tomadaEl: string; estimada: boolean; delMesEnLectura: boolean }[];
  /** En el mes que se está leyendo: `null` si no hay mes abierto o la casa no tiene medidores. */
  lecturaDelMes: 'leida' | 'pendiente' | null;
  reclamos: { id: number; referencia: string; tipoNombre: string; estado: EstadoReclamo; prioridad: Prioridad; creadoEl: string }[];
}

/* ───────────────────────── Área dibujada ───────────────────────── */

export const FORMATOS_AREA = ['json', 'xlsx', 'csv', 'pdf'] as const satisfies readonly FormatoInforme[];

/**
 * El mapa decide qué casas quedaron adentro del dibujo (con los filtros que tenga puestos) y manda
 * sus ids; la API responde solo por las que son de la cooperativa.
 */
export const areaSchema = z.object({
  ids: z.array(z.int().positive()).min(1, 'No quedó ninguna conexión adentro del área').max(20_000),
  /** Si el mapa está filtrado por un servicio, la deuda y la situación son las de ese servicio. */
  servicio: z.enum(SERVICIOS_CONEXION).optional(),
  formato: z.enum(FORMATOS_AREA).default('json'),
});
export type AreaInput = z.input<typeof areaSchema>;

export interface ResumenArea {
  conexiones: number;
  socios: number;
  /** Conexiones con cada servicio (sin contar los dados de baja). */
  porServicio: Record<ServicioConexion, number>;
  situacion: Record<Situacion, number>;
  deuda: string;
  deudaVencida: string;
  /** Consumo del último mes facturado. */
  consumo: { periodo: { anio: number; mes: number } | null; energia: string; agua: string };
  reclamosAbiertos: number;
  servicio: ServicioConexion | null;
}

/* ───────────────────────── Geometría ───────────────────────── */

type Punto = readonly [lng: number, lat: number];

/** ¿El punto está adentro del polígono? (cuenta los cruces de una semirrecta con los lados). */
export function puntoEnPoligono(p: Punto, anillo: readonly Punto[]): boolean {
  let adentro = false;
  for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
    const [xi, yi] = anillo[i]!;
    const [xj, yj] = anillo[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) adentro = !adentro;
  }
  return adentro;
}

/** Superficie de un polígono chico, en hectáreas (alcanza con tratar la zona como plana). */
export function superficieHa(anillo: readonly Punto[]): number {
  if (anillo.length < 3) return 0;
  const lat0 = anillo.reduce((t, p) => t + p[1], 0) / anillo.length;
  const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110_540;
  let doble = 0;
  for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) doble += anillo[j]![0] * kx * (anillo[i]![1] * ky) - anillo[i]![0] * kx * (anillo[j]![1] * ky);
  return Math.abs(doble) / 2 / 10_000;
}

export const categoriaDeIndice = (i: number): Categoria | null => CATEGORIAS[i] ?? null;
