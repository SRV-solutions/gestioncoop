// Vocabulario del portal del socio (Fase 6), compartido entre la API y el client: inicio, facturas
// con «¿Por qué pago esto?», consumo, datos de contacto, pago online y el ingreso con DNI.
import { z } from 'zod';
import type { MedioPago } from './caja';
import type { CalculoComprobante, EstadoComprobante, TipoComprobante } from './facturacion';
import type { Categoria, ConexionDetalle, ServicioConexion, SocioDetalle } from './padron';
import { subdominioSchema } from './schemas';
import type { ServicioMedido } from './tarifas';

/* ───────────────────────── Facturas del socio ───────────────────────── */

export interface FacturaSocio {
  id: number;
  tipo: TipoComprobante;
  /** «Fact B 0006-00001234». */
  referencia: string;
  servicio: ServicioConexion;
  anio: number;
  mes: number;
  direccion: string | null;
  total: string;
  /** Lo que falta pagar. */
  saldo: string;
  estado: EstadoComprobante;
  emitidoEl: string | null;
  venceEl: string | null;
  vencida: boolean;
  /** Consumo facturado, con su unidad («290 kWh»); `null` en internet, TV y sepelio. */
  consumo: string | null;
  unidad: string | null;
}

export interface PaginaFacturasSocio {
  filas: FacturaSocio[];
  total: number;
  porPagina: number;
}

/** Una parte de la factura, para la barra de «¿Por qué pago esto?». */
export interface ParteFactura {
  clave: 'fijo' | 'subsidiado' | 'excedente' | 'consumo' | 'abono' | 'cargos' | 'impuestos' | 'adicionales' | 'mora';
  etiqueta: string;
  importe: string;
  /** Qué es, en una frase («120 kWh a $ 104,53»). */
  detalle: string | null;
}

/** El cálculo de la factura contado en lenguaje simple (SPEC 5 y 6.7). */
export interface PorQuePago {
  /** Las partes que suman el total, de la más fija a la más evitable. Solo las que tienen importe. */
  partes: ParteFactura[];
  /** Frases cortas, para leer de arriba abajo. */
  frases: string[];
  /** Solo si la conexión tiene subsidio en este servicio. */
  subsidio: {
    /** Hasta cuánto consumo se cobra con subsidio. */
    tope: number;
    unidad: string;
    consumo: number;
    /** Lo que entró en el tope y lo que se pasó. */
    dentro: number;
    fuera: number;
    /** Precio del consumo con subsidio y del primero sin subsidio, por unidad. */
    precioSubsidiado: string | null;
    precioPleno: string | null;
    /** Lo que se cobró por el consumo por encima del tope. */
    importeExcedente: string;
  } | null;
  /** Contra el mes anterior del mismo servicio. */
  comparacion: { anio: number; mes: number; consumo: number; variacion: number | null } | null;
}

export interface FacturaSocioDetalle extends FacturaSocio {
  conexion: { numero: number; direccion: string };
  categoria: Categoria | null;
  tieneSubsidio: boolean;
  plan: string | null;
  calculo: CalculoComprobante | null;
  porQue: PorQuePago | null;
  codigoDeBarras: string | null;
  pagos: { id: number; referencia: string; cobradoEl: string; importe: string; medio: MedioPago; online: boolean }[];
  /** En una nota de crédito, la factura que anula; en una factura anulada, su nota de crédito. */
  relacionado: { id: number; referencia: string } | null;
}

/* ───────────────────────── Inicio ───────────────────────── */

export interface CorteAviso {
  id: number;
  servicio: ServicioConexion;
  desde: string;
  hasta: string;
  motivo: string;
  /** `null` = en toda la localidad. */
  zona: string | null;
}

export interface InicioSocio {
  socio: { numero: number; nombre: string };
  /** Lo que debe hoy, sumando todas las facturas impagas. */
  deuda: string;
  pendientes: FacturaSocio[];
  vencidas: number;
  /** El vencimiento más cercano de lo que todavía no venció; `null` si todo está vencido o pago. */
  proximoVencimiento: string | null;
  cortes: CorteAviso[];
  reclamosAbiertos: number;
  ultimoPago: { id: number; referencia: string; cobradoEl: string; importe: string } | null;
  /** Un pago online que todavía no se confirmó (por ejemplo, si cerró la pestaña del banco). */
  pagoEnCurso: { intentoId: string; total: string } | null;
}

/* ───────────────────────── Consumo ───────────────────────── */

export interface ConsumoMes {
  anio: number;
  mes: number;
  /** `null` = ese mes no hay lectura (todavía no tenía el servicio, o el mes en curso sin leer). */
  consumo: number | null;
  estimada: boolean;
  /** Promedio de las conexiones de la misma zona, servicio y categoría ese mes. */
  promedioZona: number | null;
}

export interface ConsumoServicio {
  servicio: ServicioMedido;
  unidad: string;
  conexion: { numero: number; direccion: string };
  zona: string | null;
  categoria: Categoria | null;
  /** Los últimos 12 meses con lectura, del más viejo al más nuevo. */
  meses: ConsumoMes[];
}

export interface ConsumoSocio {
  servicios: ConsumoServicio[];
}

/* ───────────────────────── Mi cuenta ───────────────────────── */

export interface CuentaPortal extends SocioDetalle {
  facturaDigital: boolean;
}
export type { ConexionDetalle };

const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max, 'Es demasiado largo')
    .optional()
    .transform((v) => (v ? v : null));

export const contactoSchema = z
  .object({
    email: textoOpcional(200).refine((v) => v === null || z.email().safeParse(v).success, 'Ese email no parece completo'),
    telefono: textoOpcional(40).refine((v) => v === null || /^[\d\s()+-]{6,}$/.test(v), 'Escribí el número con su característica'),
    facturaDigital: z.boolean().default(false),
  })
  .superRefine((c, ctx) => {
    if (c.facturaDigital && !c.email) ctx.addIssue({ code: 'custom', path: ['email'], message: 'Para recibir la factura por email, cargá tu email' });
  });
export type ContactoInput = z.input<typeof contactoSchema>;

/* ───────────────────────── Pago online ───────────────────────── */

export const ESTADOS_INTENTO = ['pendiente', 'aprobado', 'rechazado', 'cancelado', 'vencido'] as const;
export type EstadoIntento = (typeof ESTADOS_INTENTO)[number];

/** Adónde se manda al socio para pagar: la pasarela del proveedor (Macro Click de Pago en la real). */
export interface RedireccionPago {
  url: string;
  metodo: 'GET' | 'POST';
  campos: Record<string, string>;
}

export const pagoSocioSchema = z.object({
  comprobantes: z
    .array(z.int().positive(), { error: 'Elegí qué facturas pagás' })
    .min(1, 'Elegí qué facturas pagás')
    .max(30)
    .refine((ids) => new Set(ids).size === ids.length, 'Hay una factura repetida'),
});

export interface ItemIntento {
  comprobanteId: number;
  descripcion: string;
  importe: string;
}

export interface IntentoCreado {
  intentoId: string;
  total: string;
  redireccion: RedireccionPago;
}

export interface EstadoPagoOnline {
  id: string;
  estado: EstadoIntento;
  total: string;
  items: ItemIntento[];
  medio: MedioPago | null;
  creadoEl: string;
  resueltoEl: string | null;
  /** Por qué se rechazó, si el banco lo dice. */
  motivo: string | null;
  recibo: { id: number; referencia: string } | null;
  /** Si una factura se había pagado por otro lado mientras tanto: lo que quedó a favor. */
  aFavor: string | null;
  /** Solo en el portal: lo que sigue debiendo después de este pago. */
  deudaRestante: string | null;
}

/** Lo que muestra la pasarela de prueba: lo mismo que mostraría la del banco. */
export interface PasarelaDatos {
  intentoId: string;
  comercio: string;
  items: { descripcion: string; importe: string }[];
  total: string;
  estado: 'pendiente' | 'aprobado' | 'rechazado' | 'cancelado' | 'vencido';
  retorno: { exito: string; cancelado: string };
}

export const pasarelaDecisionSchema = z.object({
  firma: z.string().regex(/^[0-9a-f]{64}$/),
  decision: z.enum(['aprobar', 'rechazar', 'cancelar']),
  medio: z.enum(['debito', 'credito']).default('debito'),
});

/** Factura abierta desde el QR del papel: sin datos personales, solo lo necesario para pagarla. */
export interface FacturaPublica {
  cooperativa: string;
  servicio: ServicioConexion;
  anio: number;
  mes: number;
  /** Para que quien paga reconozca la factura: «Socio N° 1043 · conexión 2381». */
  identificacion: string;
  total: string;
  saldo: string;
  venceEl: string | null;
  vencida: boolean;
  estado: 'pendiente' | 'pagada' | 'anulada';
}

/* ───────────────────────── Ingreso del socio ───────────────────────── */

/**
 * El socio no tiene usuario ni contraseña: entra con los tres datos de su factura, igual que en la
 * intranet que la cooperativa ya usa —código de socio, número de conexión y documento—.
 * Decisión de la cooperativa (el SPEC proponía una contraseña): prioriza que cualquier vecino
 * entre sin trámite. Lo protege que hacen falta los tres datos juntos y el límite de intentos.
 */
export const accesoSocioSchema = z.object({
  cooperativa: subdominioSchema.optional(),
  socio: z.coerce.number({ error: 'Escribí tu código de socio' }).int('Escribí tu código de socio').positive('Escribí tu código de socio').max(999_999_999, 'Escribí tu código de socio'),
  conexion: z.coerce.number({ error: 'Escribí el número de conexión' }).int('Escribí el número de conexión').positive('Escribí el número de conexión').max(99_999_999, 'Escribí el número de conexión'),
  documento: z
    .string({ error: 'Escribí tu DNI, CUIT o CUIL' })
    .transform((v) => v.replace(/\D/g, ''))
    .pipe(z.string().min(7, 'Escribí tu DNI, CUIT o CUIL').max(11, 'Escribí tu DNI, CUIT o CUIL')),
});
export type AccesoSocioInput = z.input<typeof accesoSocioSchema>;

/**
 * ¿El documento que escribió es el del socio? Vale el DNI o el CUIT/CUIL que lo contiene: quien
 * figura con DNI puede escribir su CUIL, y al revés.
 */
export function mismoDocumento(guardado: string, escrito: string): boolean {
  const [a, b] = [guardado.replace(/\D/g, ''), escrito.replace(/\D/g, '')];
  if (a === '' || b === '') return false;
  if (a === b) return true;
  const dni = (n: string) => (n.length === 11 ? n.slice(2, 10) : n).replace(/^0+/, '');
  return a.length !== b.length && dni(a) === dni(b);
}
