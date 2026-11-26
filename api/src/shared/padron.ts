// Vocabulario del padrón, compartido entre la API y el client.
import type { Servicio } from './constants';

/** Servicios que se asocian a una conexión (el gas se vende por mostrador, no va en el padrón). */
export const SERVICIOS_CONEXION = ['energia', 'agua', 'internet', 'tv', 'sepelio'] as const satisfies readonly Servicio[];
export type ServicioConexion = (typeof SERVICIOS_CONEXION)[number];

export const ESTADOS_SERVICIO = ['activo', 'suspendido', 'cortado', 'baja'] as const;
export type EstadoServicio = (typeof ESTADOS_SERVICIO)[number];
export const ESTADO_SERVICIO_ETIQUETA: Record<EstadoServicio, string> = {
  activo: 'Activo',
  suspendido: 'Suspendido',
  cortado: 'Cortado',
  baja: 'De baja',
};

/** Categorías tarifarias (SPEC 6.4). El subsidio va aparte, en `tieneSubsidio`. */
export const CATEGORIAS = ['residencial', 'comercial', 'industrial', 'rural', 'oficial', 'bien_publico'] as const;
export type Categoria = (typeof CATEGORIAS)[number];
export const CATEGORIA_ETIQUETA: Record<Categoria, string> = {
  residencial: 'Residencial',
  comercial: 'Comercial',
  industrial: 'Industrial',
  rural: 'Rural',
  oficial: 'Oficial',
  bien_publico: 'Entidad de bien público',
};

export const CONDICIONES_IVA = ['consumidor_final', 'monotributo', 'responsable_inscripto', 'exento'] as const;
export type CondicionIva = (typeof CONDICIONES_IVA)[number];
export const CONDICION_IVA_ETIQUETA: Record<CondicionIva, string> = {
  consumidor_final: 'Consumidor final',
  monotributo: 'Monotributo',
  responsable_inscripto: 'Responsable inscripto',
  exento: 'Exento',
};

export type TipoZona = 'urbana' | 'rural';

/** Para buscar sin importar mayúsculas ni acentos: "Benítez" → "benitez". */
export function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ───────────────────────── Lo que viaja por la API ───────────────────────── */

export interface ZonaResumen {
  id: number;
  nombre: string;
  tipo: TipoZona;
  conexiones: number;
}

export interface PadronResumen {
  socios: number;
  conexiones: number;
  /** Conexiones con cada servicio (sin contar los dados de baja). */
  porServicio: Record<ServicioConexion, number>;
  zonas: ZonaResumen[];
}

/** Fila de la lista del padrón. */
export interface SocioListado {
  id: number;
  numero: number;
  nombre: string;
  tipoDoc: string;
  nroDoc: string;
  estado: 'activo' | 'baja';
  conexiones: number;
  /** Domicilio y zona de su primera conexión. */
  direccion: string | null;
  zona: string | null;
  servicios: ServicioConexion[];
}

export interface Page<T> {
  items: T[];
  /** Pasarlo como `cursor` para traer la página siguiente; `null` si no hay más. */
  nextCursor: string | null;
  total: number;
}

export interface MedidorDetalle {
  id: number;
  numero: string;
  tipo: string;
  factorMult: string;
  instaladoEl: string;
  retiradoEl: string | null;
}

export interface ServicioDetalle {
  id: number;
  servicio: ServicioConexion;
  categoria: Categoria | null;
  plan: string | null;
  estado: EstadoServicio;
  fechaAlta: string;
  fechaBaja: string | null;
  tieneSubsidio: boolean;
  medidores: MedidorDetalle[];
}

export interface ConexionDetalle {
  id: number;
  numero: number;
  direccion: string;
  zona: string | null;
  tipoZona: TipoZona | null;
  ruta: string | null;
  ordenRuta: number | null;
  lat: number | null;
  lng: number | null;
  servicios: ServicioDetalle[];
}

export interface BeneficiarioDetalle {
  id: number;
  nombre: string;
  nroDoc: string;
  parentesco: string;
  altaEl: string;
}

export interface SocioDetalle {
  id: number;
  numero: number;
  nombre: string;
  tipoDoc: string;
  nroDoc: string;
  condicionIva: CondicionIva;
  email: string | null;
  telefono: string | null;
  estado: 'activo' | 'baja';
  conexiones: ConexionDetalle[];
  beneficiarios: BeneficiarioDetalle[];
}

/** Ficha corta que abre el mapa al tocar una casa. */
export interface ConexionFicha extends ConexionDetalle {
  socio: { id: number; numero: number; nombre: string };
}

/* ───────────────────────── Mapa ───────────────────────── */

/** Estado con el que se pinta una conexión en el mapa (el peor de sus servicios medidos). */
export type EstadoMapa = 'activo' | 'suspendido' | 'cortado' | 'baja';

/**
 * Conexiones para el mapa, en columnas paralelas para que 10.000 puntos pesen poco:
 * la conexión `i` está en `ids[i]`, `lng[i]`, `lat[i]`...
 */
export interface MapaConexiones {
  ids: number[];
  lng: number[];
  lat: number[];
  /** Índice dentro de `zonas`. */
  zona: number[];
  /** Índice dentro de ESTADOS_SERVICIO. */
  estado: number[];
  /** Bits de servicios activos, en el orden de SERVICIOS_CONEXION (energía = 1, agua = 2, internet = 4...). */
  servicios: number[];
  /** Rumbo de la calle (0-179°) para dibujar la casa alineada. */
  orientacion: number[];
  /** Estado de cada servicio, empaquetado (ver `estadoEmpaquetado` en mapa.ts). */
  estados: number[];
  /** Categoría del servicio de energía: índice dentro de CATEGORIAS, o -1 si no tiene. */
  categoria: number[];
  /** Ruta de lectura (índice dentro de `rutas`, -1 si no tiene) y su parada dentro de la ruta. */
  ruta: number[];
  orden: number[];
  zonas: { id: number; nombre: string; tipo: TipoZona; poligono: unknown }[];
  rutas: { id: number; nombre: string }[];
  /** Conexiones de la cooperativa que todavía no tienen ubicación cargada. */
  sinUbicacion: number;
}
