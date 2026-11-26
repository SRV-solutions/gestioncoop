// Vocabulario de la facturación (Fase 4), compartido entre la API y el client: comprobantes,
// pre-facturas, el asistente del mes y el código de barras de la factura.
import { z } from 'zod';
import type { EstadoPago, MedioPago } from './caja';
import { formatComprobante } from './format';
import type { Anomalia, EstadoPeriodo, MotivoLecturaMenor, Novedad } from './lecturas';
import { SERVICIOS_CONEXION, type Categoria, type CondicionIva, type ServicioConexion } from './padron';
import type { Aviso, ConsumoCalculado, Renglon, TotalesFactura } from './tarifas';

/* ───────────────────────── Comprobantes ───────────────────────── */

export const TIPOS_COMPROBANTE = ['factura', 'nota_credito', 'nota_debito', 'recibo'] as const;
export type TipoComprobante = (typeof TIPOS_COMPROBANTE)[number];
export const TIPO_COMPROBANTE_ETIQUETA: Record<TipoComprobante, string> = {
  factura: 'Factura',
  nota_credito: 'Nota de crédito',
  nota_debito: 'Nota de débito',
  recibo: 'Recibo',
};
/** Como los imprime la cooperativa: «Fact B 0006-02043619», «Rcbo B 0006-02058983». */
export const TIPO_COMPROBANTE_ABREV: Record<TipoComprobante, string> = { factura: 'Fact', nota_credito: 'N.Cr', nota_debito: 'N.Db', recibo: 'Rcbo' };

/**
 * `borrador`: pre-factura, todavía sin número (se puede recalcular o borrar).
 * `emitido`: con número y deuda cargada. No se edita más: se corrige con nota de crédito.
 * `pagado`: saldo en cero. `anulado`: tiene una nota de crédito por el total.
 */
export const ESTADOS_COMPROBANTE = ['borrador', 'emitido', 'pagado', 'anulado'] as const;
export type EstadoComprobante = (typeof ESTADOS_COMPROBANTE)[number];
export const ESTADO_COMPROBANTE_ETIQUETA: Record<EstadoComprobante, string> = {
  borrador: 'Pre-factura',
  emitido: 'Sin pagar',
  pagado: 'Pagada',
  anulado: 'Anulada',
};

export type LetraComprobante = 'A' | 'B';
/** Letra del comprobante según la condición frente al IVA de quien lo recibe. */
export function letraDe(condicionIva: CondicionIva): LetraComprobante {
  return condicionIva === 'responsable_inscripto' ? 'A' : 'B';
}

/** «Fact B 0006-00001234»; una pre-factura todavía no tiene número. */
export function referenciaComprobante(c: { tipo: TipoComprobante; letra: string; puntoVenta: number; numero: number | null }): string {
  if (c.numero === null) return 'Pre-factura';
  return `${TIPO_COMPROBANTE_ABREV[c.tipo]} ${formatComprobante(c.letra, c.puntoVenta, c.numero)}`;
}

/** Por qué una pre-factura se separa para mirarla antes de emitir (SPEC 6.5). */
export const MOTIVOS_RARA = ['variacion', 'importe_cero', 'sin_lectura'] as const;
export type MotivoRara = (typeof MOTIVOS_RARA)[number];
export const RARA_ETIQUETA: Record<MotivoRara, string> = {
  variacion: 'Cambió más del 50 %',
  importe_cero: 'Importe cero',
  sin_lectura: 'Sin lectura',
};
/** Variación contra el mes anterior a partir de la cual una factura se considera rara. */
export const VARIACION_RARA = 50;

/* ───────────────────────── Código de barras ─────────────────────────
 * 32 dígitos: cooperativa (5) + comprobante (10) + vencimiento aammdd (6) + importe en centavos (10)
 * + dígito verificador. Lo lee la caja para encontrar la factura sin tipear nada. */

function verificador(digitos: string): number {
  // Módulo 10 con pesos 3-1 alternados desde la derecha (como en los códigos de cobranza).
  let suma = 0;
  for (let i = 0; i < digitos.length; i++) suma += Number(digitos[digitos.length - 1 - i]) * (i % 2 === 0 ? 3 : 1);
  return (10 - (suma % 10)) % 10;
}

export function codigoDeBarras(c: { cooperativaId: number; id: number; venceEl: string; total: string }): string {
  const centavos = c.total.replace('-', '').replace('.', '').padStart(10, '0').slice(-10);
  const vence = c.venceEl.slice(2).replace(/-/g, '');
  const cuerpo = `${String(c.cooperativaId).padStart(5, '0')}${String(c.id).padStart(10, '0')}${vence}${centavos}`;
  return `${cuerpo}${verificador(cuerpo)}`;
}

/** Devuelve el comprobante de un código leído, o `null` si no es un código nuestro o está mal leído. */
export function leerCodigoDeBarras(codigo: string): { cooperativaId: number; id: number } | null {
  const limpio = codigo.replace(/\s/g, '');
  if (!/^\d{32}$/.test(limpio)) return null;
  if (verificador(limpio.slice(0, 31)) !== Number(limpio[31])) return null;
  return { cooperativaId: Number(limpio.slice(0, 5)), id: Number(limpio.slice(5, 15)) };
}

/* ───────────────────────── Lo que guarda cada comprobante ───────────────────────── */

/**
 * Copia de los datos con los que se calculó (columna `snapshot_json`). Junto con los renglones
 * —que llevan cada precio, porcentaje y base usados— alcanza para explicar la factura y volver a
 * imprimirla aunque después cambien la tarifa, el domicilio o el titular.
 */
export interface SnapshotComprobante {
  titular: { numero: number; nombre: string; tipoDoc: string; nroDoc: string; condicionIva: CondicionIva };
  conexion: { numero: number; direccion: string; zona: string | null };
  categoria: Categoria | null;
  tieneSubsidio: boolean;
  plan: string | null;
  periodo: { desde: string; hasta: string };
  dias: number;
  diasActivos: number;
  consumo: ConsumoCalculado | null;
  avisos: Aviso[];
  totales: TotalesFactura;
  /** Versiones de tarifa usadas (los cuadros y conceptos en vigencia nunca se editan ni se borran). */
  tarifas: { cuadros: number[]; conceptos: string[]; moraTasaDiaria: string };
}

/** El cálculo de un comprobante con la forma que dibuja la pantalla de la factura. */
export interface CalculoComprobante {
  servicio: ServicioConexion;
  periodo: { anio: number; mes: number; desde: string; hasta: string };
  consumo: ConsumoCalculado | null;
  dias: number;
  diasActivos: number;
  estimada: boolean;
  renglones: Renglon[];
  totales: TotalesFactura;
  avisos: Aviso[];
}

export interface ComprobanteListado {
  id: number;
  tipo: TipoComprobante;
  letra: string;
  puntoVenta: number;
  numero: number | null;
  /** «Fact B 0006-00001234» o «Pre-factura». */
  referencia: string;
  servicio: ServicioConexion;
  anio: number;
  mes: number;
  socio: { id: number; numero: number; nombre: string };
  direccion: string | null;
  total: string;
  saldo: string;
  estado: EstadoComprobante;
  estimada: boolean;
  consumo: string | null;
  rara: MotivoRara | null;
  revisada: boolean;
  /** Total del servicio en la factura del mes anterior y cuánto cambió, en porcentaje. */
  totalAnterior: string | null;
  variacion: number | null;
  /** No se pudo calcular: dice qué falta. Mientras haya alguna así, el mes no se puede emitir. */
  error: string | null;
  emitidoEl: string | null;
  venceEl: string | null;
}

export interface ComprobanteDetalle extends ComprobanteListado {
  titular: SnapshotComprobante['titular'];
  conexion: SnapshotComprobante['conexion'];
  categoria: Categoria | null;
  tieneSubsidio: boolean;
  plan: string | null;
  calculo: CalculoComprobante | null;
  /** Lecturas del mes de los medidores de este servicio, para mirar la foto o la novedad. */
  lecturas: {
    id: number;
    medidor: string;
    valor: number | null;
    anterior: number | null;
    tipo: 'real' | 'estimada';
    motivo: MotivoLecturaMenor | null;
    anomalia: Anomalia | null;
    novedad: Novedad | null;
    nota: string | null;
    tieneFoto: boolean;
  }[];
  motivo: string | null;
  /** En una nota de crédito: la factura que anula. En una factura anulada: su nota de crédito. */
  relacionado: { id: number; referencia: string } | null;
  cae: string | null;
  caeVence: string | null;
  codigoDeBarras: string | null;
  /** Cobros aplicados a esta factura (los anulados también, marcados). */
  pagos: { id: number; referencia: string; cobradoEl: string; medio: MedioPago; estado: EstadoPago; importe: string }[];
}

export interface PaginaComprobantes {
  filas: ComprobanteListado[];
  total: number;
  porPagina: number;
}

export const VISTAS_COMPROBANTES = ['todas', 'por_revisar', 'raras', 'errores'] as const;
export type VistaComprobantes = (typeof VISTAS_COMPROBANTES)[number];

export const comprobantesQuerySchema = z.object({
  anio: z.coerce.number().int().min(2000).max(2100).optional(),
  mes: z.coerce.number().int().min(1).max(12).optional(),
  vista: z.enum(VISTAS_COMPROBANTES).default('todas'),
  servicio: z.enum(SERVICIOS_CONEXION).optional(),
  estado: z.enum(ESTADOS_COMPROBANTE).optional(),
  /** Nombre, número de socio, documento, domicilio o número de comprobante. */
  q: z.string().trim().max(80).optional(),
  pagina: z.coerce.number().int().min(1).default(1),
});

export const notaCreditoSchema = z.object({
  motivo: z.string({ error: 'Contá por qué se anula' }).trim().min(5, 'Contá por qué se anula').max(200, 'Es demasiado largo'),
});

/* ───────────────────────── El asistente del mes ───────────────────────── */

/** Qué falta para poder cerrar la lectura (paso 2 del asistente). */
export interface ControlCierre {
  total: number;
  leidos: number;
  /** Sin lectura pero con historial: se pueden estimar por promedio. */
  estimables: number;
  /** Sin lectura y sin historial: no hay con qué estimar; se facturan solo los cargos fijos. */
  sinHistorial: number;
  /** Lectura menor a la anterior sin aclarar si fue vuelta de contador o cambio de medidor. */
  sinResolver: number;
  estimadas: number;
  /** Anomalías y novedades que la oficina todavía no miró. Avisan, no frenan. */
  anomalias: number;
  novedades: number;
  /** Lo que impide cerrar: `estimables + sinResolver`. */
  bloqueantes: number;
}

export interface ResumenServicio {
  servicio: ServicioConexion;
  cantidad: number;
  total: string;
  /** Consumo facturado (kWh o m³); `null` en los servicios sin medidor. */
  consumo: string | null;
}

export interface ResumenPrefactura {
  cantidad: number;
  total: string;
  porServicio: ResumenServicio[];
  estimadas: number;
  raras: number;
  rarasSinRevisar: number;
  errores: number;
  calculadaEl: string | null;
}

export interface ResumenEmision {
  cantidad: number;
  total: string;
  porServicio: ResumenServicio[];
  emitidaEl: string | null;
  venceEl: string | null;
  /** Numeración usada, por letra. */
  rangos: { letra: string; puntoVenta: number; desde: number; hasta: number }[];
  /** Avisos al socio que dejó la emisión (simulados: quedan en la bandeja, no se envían). */
  avisos: number;
  /** Pre-facturas que quedaron sin emitir (solo si la emisión se interrumpió). */
  pendientes: number;
  /** Cuánto tardó la emisión, en segundos. */
  segundos: number | null;
}

export const TIPOS_PROCESO = ['prefactura', 'emision'] as const;
export type TipoProceso = (typeof TIPOS_PROCESO)[number];

/** Trabajo en segundo plano con su avance, para la barra de progreso. */
export interface ProcesoFacturacion {
  id: number;
  tipo: TipoProceso;
  estado: 'en_curso' | 'terminado' | 'fallido';
  total: number;
  hechas: number;
  error: string | null;
  iniciadoEl: string;
  terminadoEl: string | null;
}

export interface EstadoFacturacion {
  hoy: string;
  /** El último mes abierto y en qué paso está; `null` si la cooperativa nunca abrió una lectura. */
  mes: { anio: number; mes: number; estado: EstadoPeriodo } | null;
  /** Mes que se puede abrir cuando el actual ya está emitido. */
  proximo: { anio: number; mes: number };
  control: ControlCierre | null;
  prefactura: ResumenPrefactura | null;
  emision: ResumenEmision | null;
  /** El último trabajo del mes, si está corriendo o falló. */
  proceso: ProcesoFacturacion | null;
  diasVencimiento: number;
}
