// Lecturas en campo (Fase 3): tipos, reglas de validación y esquemas que comparten la API y el celular
// del operario. Las reglas viven acá —y no en la pantalla— porque el teléfono las aplica sin conexión
// y la API las vuelve a aplicar cuando la lectura llega.
import { z } from 'zod';
import type { ServicioMedido } from './tarifas';

/* ───────────────────────── Períodos ───────────────────────── */

export const ESTADOS_PERIODO = ['abierto', 'en_lectura', 'prefacturado', 'emitido', 'cerrado'] as const;
export type EstadoPeriodo = (typeof ESTADOS_PERIODO)[number];

export const ESTADO_PERIODO_ETIQUETA: Record<EstadoPeriodo, string> = {
  abierto: 'Abierto',
  en_lectura: 'En lectura',
  prefacturado: 'Prefacturado',
  emitido: 'Emitido',
  cerrado: 'Cerrado',
};

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
/** "noviembre de 2026" */
export const nombreDeMes = (anio: number, mes: number): string => `${MESES[mes - 1] ?? '?'} de ${anio}`;

/* ───────────────────────── Novedades y anomalías ───────────────────────── */

export const NOVEDADES = ['medidor_roto', 'sin_acceso', 'perro', 'casa_cerrada', 'posible_fraude', 'perdida_visible'] as const;
export type Novedad = (typeof NOVEDADES)[number];

export const NOVEDAD_ETIQUETA: Record<Novedad, string> = {
  medidor_roto: 'Medidor roto',
  sin_acceso: 'Sin acceso',
  perro: 'Perro suelto',
  casa_cerrada: 'Casa cerrada',
  posible_fraude: 'Posible fraude',
  perdida_visible: 'Pérdida visible',
};

/** Novedades con las que igual se puede anotar la lectura (las demás son "no pude leer"). */
export const NOVEDADES_CON_LECTURA: readonly Novedad[] = ['posible_fraude', 'perdida_visible'];

export const MOTIVOS_LECTURA_MENOR = ['vuelta_contador', 'cambio_medidor'] as const;
export type MotivoLecturaMenor = (typeof MOTIVOS_LECTURA_MENOR)[number];

export const MOTIVO_ETIQUETA: Record<MotivoLecturaMenor, string> = {
  vuelta_contador: 'Vuelta de contador',
  cambio_medidor: 'Cambio de medidor',
};

export const ANOMALIAS = ['lectura_menor', 'consumo_alto', 'consumo_bajo', 'sin_consumo'] as const;
export type Anomalia = (typeof ANOMALIAS)[number];

export const ANOMALIA_ETIQUETA: Record<Anomalia, string> = {
  lectura_menor: 'Lectura menor a la anterior',
  consumo_alto: 'Consumo muy alto',
  consumo_bajo: 'Consumo muy bajo',
  sin_consumo: 'Sin consumo',
};

/** Consumo mayor a 3 veces el promedio, o menor a 0,2 veces: se pide confirmación y foto (SPEC 6.3). */
export const FACTOR_CONSUMO_ALTO = 3;
export const FACTOR_CONSUMO_BAJO = 0.2;
/** Meses que entran en el consumo promedio y en la estimación. */
export const MESES_PROMEDIO = 6;

export interface EvaluacionLectura {
  /** Consumo del período en la unidad facturada (ya multiplicado por el factor). `null` si no se puede saber. */
  consumo: number | null;
  anomalia: Anomalia | null;
  /** La lectura es menor a la anterior y falta decir por qué: no se puede guardar así. */
  faltaMotivo: boolean;
}

/**
 * Qué significa una lectura frente a la anterior y al promedio. Función pura: es la misma regla
 * en el teléfono (sin conexión) y en la API.
 */
export function evaluarLectura(e: {
  valor: number;
  anterior: number | null;
  promedio: number | null;
  digitos: number;
  factor: number;
  motivo?: MotivoLecturaMenor | null;
}): EvaluacionLectura {
  // Medidor sin lectura previa: no hay con qué comparar.
  if (e.anterior === null) return { consumo: null, anomalia: null, faltaMotivo: false };

  if (e.valor < e.anterior) {
    if (!e.motivo) return { consumo: null, anomalia: 'lectura_menor', faltaMotivo: true };
    const unidades = e.motivo === 'vuelta_contador' ? 10 ** e.digitos - e.anterior + e.valor : e.valor;
    return { consumo: redondear(unidades * e.factor), anomalia: 'lectura_menor', faltaMotivo: false };
  }

  const consumo = redondear((e.valor - e.anterior) * e.factor);
  if (consumo === 0) return { consumo, anomalia: 'sin_consumo', faltaMotivo: false };
  if (e.promedio !== null && e.promedio > 0) {
    if (consumo > e.promedio * FACTOR_CONSUMO_ALTO) return { consumo, anomalia: 'consumo_alto', faltaMotivo: false };
    if (consumo < e.promedio * FACTOR_CONSUMO_BAJO) return { consumo, anomalia: 'consumo_bajo', faltaMotivo: false };
  }
  return { consumo, anomalia: null, faltaMotivo: false };
}

const redondear = (n: number) => Math.round(n * 100) / 100;

/** Lectura estimada: la anterior más el consumo promedio (llevado a unidades del medidor). */
export function estimarLectura(e: { anterior: number; promedio: number; digitos: number; factor: number }): number {
  const unidades = Math.round(e.promedio / (e.factor || 1));
  return (e.anterior + unidades) % 10 ** e.digitos;
}

/* ───────────────────────── Lo que baja al teléfono ───────────────────────── */

/** Lectura ya cargada de un medidor en el período (del servidor o todavía en la cola del teléfono). */
export interface LecturaCargada {
  uuid: string;
  valor: number | null;
  consumo: number | null;
  tipo: 'real' | 'estimada';
  motivo: MotivoLecturaMenor | null;
  novedad: Novedad | null;
  anomalia: Anomalia | null;
  nota: string | null;
  tieneFoto: boolean;
  tomadaEl: string;
}

export interface MedidorRuta {
  medidorId: number;
  periodoId: number;
  servicio: ServicioMedido;
  numero: string;
  digitos: number;
  factor: number;
  anterior: { valor: number; fecha: string } | null;
  /** Consumo promedio de los últimos meses, en la unidad facturada. */
  promedio: number | null;
  lectura: LecturaCargada | null;
}

export interface CasaRuta {
  conexionId: number;
  numero: number;
  orden: number;
  direccion: string;
  titular: string;
  lat: number | null;
  lng: number | null;
  medidores: MedidorRuta[];
}

export interface RutaResumen {
  id: number;
  nombre: string;
  zona: string;
  anio: number;
  mes: number;
  casas: number;
  casasHechas: number;
  medidores: number;
  medidoresLeidos: number;
}

export interface RutaDetalle extends Omit<RutaResumen, 'casasHechas' | 'medidoresLeidos'> {
  /** Cuándo se armó esta copia (el teléfono la guarda para trabajar sin señal). */
  descargadaEl: string;
  lista: CasaRuta[];
}

export interface MisRutas {
  /** `null` = administración todavía no abrió la lectura del mes. */
  periodo: { anio: number; mes: number } | null;
  rutas: RutaResumen[];
}

/* ───────────────────────── Sincronización ───────────────────────── */

/** Foto como data URL (JPEG achicado en el teléfono). ~700 KB como mucho. */
const FOTO_MAX = 1_000_000;

export const lecturaSyncSchema = z
  .object({
    /** Lo genera el teléfono: reintentar el envío nunca duplica la lectura. */
    uuid: z.uuid(),
    periodoId: z.int().positive(),
    medidorId: z.int().positive(),
    valor: z.int().min(0).max(999_999_999).nullable(),
    motivo: z.enum(MOTIVOS_LECTURA_MENOR).nullable().default(null),
    novedad: z.enum(NOVEDADES).nullable().default(null),
    nota: z.string().trim().max(300).nullable().default(null),
    foto: z
      .string()
      .max(FOTO_MAX, 'La foto es demasiado grande')
      .regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/, 'La foto no es válida')
      .nullable()
      .default(null),
    lat: z.number().min(-90).max(90).nullable().default(null),
    lng: z.number().min(-180).max(180).nullable().default(null),
    precision: z.number().min(0).max(100_000).nullable().default(null),
    tomadaEl: z.iso.datetime(),
  })
  .refine((l) => l.valor !== null || l.novedad !== null, { message: 'Falta la lectura o la novedad', path: ['valor'] });
export type LecturaSyncInput = z.infer<typeof lecturaSyncSchema>;
export type LecturaSyncEntrada = z.input<typeof lecturaSyncSchema>;

export const syncSchema = z.object({ lecturas: z.array(z.unknown()).min(1).max(50) });

export interface ResultadoSync {
  uuid: string;
  /** `guardada`: entró. `repetida`: ya había llegado antes (no pasa nada). `rechazada`: no se puede guardar; `error` dice por qué. */
  estado: 'guardada' | 'repetida' | 'rechazada';
  error?: string;
  anomalia?: Anomalia | null;
}

/* ───────────────────────── Control desde la oficina ───────────────────────── */

export interface AvanceRuta {
  id: number;
  nombre: string;
  zona: string;
  operario: { id: number; nombre: string } | null;
  medidores: number;
  leidos: number;
  /** Las mismas cuentas que ve el operario en su teléfono: una casa está hecha cuando no le falta ningún medidor. */
  casas: number;
  casasHechas: number;
  /** Última lectura recibida de esa ruta. */
  ultimaEl: string | null;
}

export interface ResumenLecturas {
  periodo: { anio: number; mes: number; estado: EstadoPeriodo } | null;
  /** Mes que se puede abrir si no hay ninguno en lectura. */
  proximo: { anio: number; mes: number };
  /** Mes con la lectura ya cerrada que todavía no se emitió: hasta que se emita no se abre el siguiente. */
  enFacturacion: { anio: number; mes: number } | null;
  total: number;
  leidos: number;
  estimados: number;
  conNovedad: number;
  anomalias: number;
  rutas: AvanceRuta[];
  operarios: { id: number; nombre: string }[];
}

export const FILTROS_CONTROL = ['anomalias', 'novedades', 'pendientes', 'estimadas'] as const;
export type FiltroControl = (typeof FILTROS_CONTROL)[number];

export interface FilaControl {
  medidorId: number;
  periodoId: number;
  servicio: ServicioMedido;
  medidor: string;
  socioId: number;
  titular: string;
  direccion: string;
  ruta: string | null;
  anterior: number | null;
  promedio: number | null;
  lectura: (LecturaCargada & { id: number; operario: string | null; revisada: boolean }) | null;
}

export interface ControlLecturas {
  filas: FilaControl[];
  total: number;
}

export const controlQuerySchema = z.object({
  filtro: z.enum(FILTROS_CONTROL).default('anomalias'),
  ruta: z.coerce.number().int().positive().optional(),
  pagina: z.coerce.number().int().min(1).default(1),
});

export const estimarSchema = z.object({ periodoId: z.int().positive(), medidorId: z.int().positive() });
export const motivoSchema = z.object({ motivo: z.enum(MOTIVOS_LECTURA_MENOR) });
export const asignarOperarioSchema = z.object({ operarioId: z.int().positive().nullable() });
export const abrirPeriodoSchema = z.object({ anio: z.int().min(2020).max(2100), mes: z.int().min(1).max(12) });
