// Vocabulario del tablero de gerencia y de los informes (Fase 7), compartido entre la API y el client.
//
// Qué cuenta cada indicador (SPEC 6.9; cada uno tiene que coincidir con una consulta directa a la base):
// - Facturado: total de las facturas del mes elegido (emitidas o pagas; las anuladas no cuentan).
// - Cobrado: lo que ya se pagó DE ESAS facturas, se haya cobrado cuando se haya cobrado.
// - Cobrabilidad: cobrado / facturado.
// - Deuda: saldo de todas las facturas sin pagar a hoy (de cualquier mes). Vencida: las que ya pasaron
//   su vencimiento. Socios en mora: los que tienen al menos una vencida.
// - Consumo: kWh y m³ facturados en el mes elegido.
// - Reclamos abiertos: los que hoy no están resueltos.
// - Recaudación: lo que entró en el mes calendario elegido, por fecha de cobro (puede incluir
//   facturas de otros meses y ventas de mostrador). Con filtro de servicio o zona, solo lo aplicado
//   a facturas de ese servicio o zona.
import { z } from 'zod';
import type { MedioPago } from './caja';
import { SERVICIOS_CONEXION, type ServicioConexion, type TipoZona } from './padron';
import type { ServicioReclamo } from './reclamos';
import type { ServicioMedido } from './tarifas';

/* ───────────────────────── Filtros ───────────────────────── */

const filtros = {
  anio: z.coerce.number().int().min(2000).max(2100).optional(),
  mes: z.coerce.number().int().min(1).max(12).optional(),
  servicio: z.enum(SERVICIOS_CONEXION).optional(),
  zona: z.coerce.number().int().positive().max(2_000_000_000).optional(),
};

export const tableroQuerySchema = z.object(filtros).refine((f) => (f.anio === undefined) === (f.mes === undefined), { path: ['mes'], message: 'Elegí el mes y el año' });
export type TableroQuery = z.infer<typeof tableroQuerySchema>;

export interface FiltrosTablero {
  servicio: ServicioConexion | null;
  zona: { id: number; nombre: string } | null;
}

/** `emitido`: ya tiene facturas. `en_lectura`: se está leyendo. `sin_emitir`: leído, todavía sin facturar. */
export type EstadoMesTablero = 'emitido' | 'en_lectura' | 'sin_emitir';

export interface MesTablero {
  anio: number;
  mes: number;
  estado: EstadoMesTablero;
}

/* ───────────────────────── Tablero ───────────────────────── */

export const TRAMOS_ANTIGUEDAD = ['sin_vencer', 'd30', 'd60', 'd90', 'mas90'] as const;
export type TramoAntiguedad = (typeof TRAMOS_ANTIGUEDAD)[number];
export const TRAMO_ANTIGUEDAD_ETIQUETA: Record<TramoAntiguedad, string> = {
  sin_vencer: 'Todavía no venció',
  d30: 'Hasta 30 días',
  d60: '31 a 60 días',
  d90: '61 a 90 días',
  mas90: 'Más de 90 días',
};

export interface IndicadoresTablero {
  facturado: string;
  facturas: number;
  cobrado: string;
  /** Porcentaje con un decimal; `null` si el mes no tiene nada facturado. */
  cobrabilidad: number | null;
  deuda: string;
  deudaVencida: string;
  sociosConDeuda: number;
  /** Socios con al menos una factura vencida sin pagar. */
  morosos: number;
  /** kWh y m³ facturados en el mes; `null` si el filtro deja afuera ese servicio. */
  consumo: { energia: string | null; agua: string | null };
  reclamosAbiertos: number;
  reclamosUrgentes: number;
}

export interface MesFacturado {
  anio: number;
  mes: number;
  facturado: string;
  cobrado: string;
  energia: string;
  agua: string;
}

export interface TramoDeuda {
  tramo: TramoAntiguedad;
  facturas: number;
  socios: number;
  importe: string;
}

export interface ConsumoZona {
  zona: { id: number; nombre: string; tipo: TipoZona } | null;
  energia: string;
  conexionesEnergia: number;
  agua: string;
  conexionesAgua: number;
}

export interface BandaConsumo {
  /** La banda va de más de `desde` hasta `hasta` inclusive; `hasta` nulo = sin tope. */
  desde: number;
  hasta: number | null;
  conexiones: number;
  consumo: string;
}

export interface EscalonesServicio {
  servicio: ServicioMedido;
  unidad: string;
  bandas: BandaConsumo[];
}

export interface RecaudacionTablero {
  total: string;
  cobros: number;
  porMedio: { medio: MedioPago; cobros: number; total: string }[];
  /** `cajeroId` nulo = pago online. */
  porCajero: { cajeroId: number | null; nombre: string; cobros: number; total: string }[];
  /** Con filtro de servicio o zona: solo lo aplicado a esas facturas (sin ventas de mostrador). */
  soloFacturas: boolean;
}

export interface LecturasTablero {
  /** El mes que se está leyendo; `null` si no hay ninguno abierto. */
  periodo: { anio: number; mes: number } | null;
  total: number;
  leidos: number;
  estimados: number;
  rutas: { id: number; nombre: string; zona: string; medidores: number; leidos: number; ultimaEl: string | null }[];
}

export interface MesBalance {
  anio: number;
  mes: number;
  /** kWh; `null` si todavía no se cargó la energía de ese mes. */
  comprada: string | null;
  generada: string | null;
  facturada: string;
  /** `null` si falta cargar la energía o si el mes todavía no se facturó. */
  perdidas: string | null;
  /** Pérdidas sobre lo que entró a la red, en porcentaje con un decimal. */
  porcentaje: number | null;
  /** Aclaración de quien lo cargó («Dato ilustrativo de la demo»). */
  nota: string | null;
}

export interface OrigenEnergia {
  /** A quién le compra la energía. */
  mayorista: string;
  /** Su generación propia; `null` si no tiene. */
  generacion: string | null;
}

/** Si la cooperativa no cargó los suyos. */
export const ORIGEN_ENERGIA_DEFECTO: OrigenEnergia = { mayorista: 'el distribuidor mayorista', generacion: null };

export interface ReclamosTablero {
  total: number;
  resueltos: number;
  /** Horas desde que entró hasta que se resolvió, en promedio (solo los resueltos). */
  horasResolucion: number | null;
  porTipo: { servicio: ServicioReclamo; tipo: string; nombre: string; cantidad: number; abiertos: number; horasResolucion: number | null }[];
}

export interface Tablero {
  hoy: string;
  generadoEl: string;
  periodo: MesTablero;
  /** Meses que se pueden elegir, del más nuevo al más viejo. */
  periodos: MesTablero[];
  zonas: { id: number; nombre: string; tipo: TipoZona }[];
  servicios: ServicioConexion[];
  filtros: FiltrosTablero;
  indicadores: IndicadoresTablero;
  /** Los 12 meses que terminan en el elegido, del más viejo al más nuevo. */
  porMes: MesFacturado[];
  antiguedad: TramoDeuda[];
  consumoPorZona: ConsumoZona[];
  escalones: EscalonesServicio[];
  recaudacion: RecaudacionTablero;
  lecturas: LecturasTablero;
  /** Balance de energía de los mismos 12 meses. No depende de los filtros de servicio ni de zona. */
  balance: MesBalance[];
  reclamos: ReclamosTablero;
  /** De dónde viene la energía, con los nombres que usa la cooperativa («EMSA», «El Saltito»). */
  energia: OrigenEnergia;
  puedeCargarBalance: boolean;
}

/** kWh ya normalizados («12500.5»): la pantalla convierte lo que tipea la persona. */
const kwh = (mensaje: string) =>
  z.preprocess(
    (v) => (typeof v === 'number' ? String(v) : typeof v === 'string' ? v.trim() : v),
    z.string({ error: mensaje }).regex(/^\d{1,11}(\.\d{1,2})?$/, mensaje),
  );

export const balanceSchema = z.object({
  anio: z.number().int().min(2000).max(2100),
  mes: z.number().int().min(1).max(12),
  compradaKwh: kwh('Escribí los kWh comprados'),
  generadaKwh: kwh('Escribí los kWh generados (0 si no hubo)'),
  nota: z.string().trim().max(200, 'Es demasiado largo').optional(),
});
export type BalanceInput = z.input<typeof balanceSchema>;

/* ───────────────────────── Informes ───────────────────────── */

export const INFORMES = ['padron', 'deuda', 'libro-ventas', 'recaudacion', 'lecturas', 'cortes', 'consumos-zona'] as const;
export type ClaveInforme = (typeof INFORMES)[number];

export type FiltroInforme = 'periodo' | 'servicio' | 'zona';

export interface InformeDef {
  clave: ClaveInforme;
  titulo: string;
  descripcion: string;
  filtros: FiltroInforme[];
}

/** SPEC 6.9: los siete informes exportables. */
export const INFORMES_DEF: InformeDef[] = [
  { clave: 'deuda', titulo: 'Deuda por socio', descripcion: 'Quién debe, cuánto, cuántas facturas y desde cuándo. Es el informe de morosos.', filtros: ['servicio', 'zona'] },
  { clave: 'cortes', titulo: 'Cortes sugeridos', descripcion: 'Conexiones que llegaron a la cantidad de facturas vencidas que fija la cooperativa. Nunca se corta solo: es una lista para decidir.', filtros: ['servicio', 'zona'] },
  { clave: 'libro-ventas', titulo: 'Libro de ventas', descripcion: 'Todos los comprobantes emitidos en el mes, con el neto, el IVA y los demás tributos.', filtros: ['periodo', 'servicio', 'zona'] },
  { clave: 'recaudacion', titulo: 'Recaudación diaria', descripcion: 'Lo que entró cada día del mes, por medio de pago.', filtros: ['periodo'] },
  { clave: 'lecturas', titulo: 'Lecturas del mes', descripcion: 'Cada medidor leído: anterior, actual, consumo, novedades y quién lo leyó.', filtros: ['periodo', 'servicio', 'zona'] },
  { clave: 'consumos-zona', titulo: 'Consumos por zona', descripcion: 'Energía y agua facturadas en el mes en cada barrio o paraje.', filtros: ['periodo', 'servicio', 'zona'] },
  { clave: 'padron', titulo: 'Padrón', descripcion: 'Socios y conexiones, con domicilio, zona, servicios y contacto.', filtros: ['servicio', 'zona'] },
];

export const FORMATOS_INFORME = ['json', 'xlsx', 'csv', 'pdf'] as const;
export type FormatoInforme = (typeof FORMATOS_INFORME)[number];

export const informeQuerySchema = z
  .object({ ...filtros, formato: z.enum(FORMATOS_INFORME).default('json') })
  .refine((f) => (f.anio === undefined) === (f.mes === undefined), { path: ['mes'], message: 'Elegí el mes y el año' });

/** Cómo se muestra y se exporta cada columna. Los importes viajan como texto con dos decimales. */
export type TipoColumna = 'texto' | 'entero' | 'numero' | 'dinero' | 'fecha' | 'fechahora';

export interface ColumnaInforme {
  clave: string;
  titulo: string;
  tipo: TipoColumna;
  /** Ancho relativo (para el PDF y el Excel). */
  ancho: number;
  /** La fila de totales suma esta columna. */
  suma?: boolean;
}

export type CeldaInforme = string | number | null;

export interface InformeDatos {
  clave: ClaveInforme;
  titulo: string;
  /** Con qué filtros se armó: «Octubre de 2026 · Energía eléctrica · Centro». */
  subtitulo: string;
  columnas: ColumnaInforme[];
  /** En pantalla van solo las primeras filas; el archivo exportado las trae todas. */
  filas: CeldaInforme[][];
  /** Filas que tiene el informe completo. */
  total: number;
  /** Totales de todo el informe (no solo de las filas que se muestran), alineados con las columnas. */
  totales: CeldaInforme[] | null;
  /** Aclaración al pie: de dónde sale el dato, qué no incluye. */
  nota: string | null;
  periodo: { anio: number; mes: number } | null;
  generadoEl: string;
}

/** Filas del informe que se muestran en pantalla. */
export const FILAS_EN_PANTALLA = 200;

export interface CatalogoInformes {
  informes: InformeDef[];
  periodos: MesTablero[];
  zonas: { id: number; nombre: string; tipo: TipoZona }[];
  servicios: ServicioConexion[];
}
