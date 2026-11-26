// Vocabulario de la caja (Fase 5), compartido entre la API y el client: apertura y cierre con
// arqueo, cobros en el mostrador, recibos y venta de productos.
import { z } from 'zod';
import type { ServicioConexion } from './padron';

/* ───────────────────────── Dinero sin decimales flotantes ───────────────────────── */

/** `"1234.50"` → `123450`. Para sumar y restar en la pantalla sin errores de redondeo. */
export function aCentavos(importe: string): number {
  const [entero = '0', decimales = ''] = importe.replace('-', '').split('.');
  const centavos = Number(entero) * 100 + Number(decimales.padEnd(2, '0').slice(0, 2));
  return importe.startsWith('-') ? -centavos : centavos;
}

/** `123450` → `"1234.50"`. */
export function deCentavos(centavos: number): string {
  const abs = Math.abs(Math.round(centavos));
  return `${centavos < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/**
 * Lee un importe como lo tipea una persona: «50000», «50.000», «50.000,5», «1500,50» o «1500.50».
 * Devuelve `"50000.00"`, o `null` si no es un importe.
 */
export function leerImporte(texto: string): string | null {
  let t = texto.replace(/[\s$]/g, '');
  if (!t) return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  // Sin coma: un punto seguido de tres cifras separa miles; si no, es el decimal.
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  if (!/^\d{1,11}(\.\d{1,2})?$/.test(t)) return null;
  return deCentavos(aCentavos(t));
}

/* ───────────────────────── Medios y estados ───────────────────────── */

export const MEDIOS_PAGO = ['efectivo', 'transferencia', 'debito', 'credito', 'qr'] as const;
export type MedioPago = (typeof MEDIOS_PAGO)[number];
export const MEDIO_PAGO_ETIQUETA: Record<MedioPago, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  debito: 'Débito',
  credito: 'Crédito',
  qr: 'QR',
};
/** Tecla que elige cada medio en la pantalla de cobro. */
export const MEDIO_PAGO_TECLA: Record<MedioPago, string> = { efectivo: 'E', transferencia: 'T', debito: 'D', credito: 'C', qr: 'Q' };

export const ORIGENES_PAGO = ['mostrador', 'online'] as const;
export type OrigenPago = (typeof ORIGENES_PAGO)[number];

/** Un cobro no se edita ni se borra: si estuvo mal, se anula (con permiso y motivo). */
export const ESTADOS_PAGO = ['acreditado', 'anulado'] as const;
export type EstadoPago = (typeof ESTADOS_PAGO)[number];

/* ───────────────────────── Lo que manda la pantalla ───────────────────────── */

const dinero = (mensaje: string) =>
  z.preprocess(
    (v) => (typeof v === 'number' ? String(v) : typeof v === 'string' ? v.trim() : v),
    z.string({ error: mensaje }).regex(/^\d{1,11}(\.\d{1,2})?$/, mensaje),
  );

export const abrirCajaSchema = z.object({
  fondoInicial: dinero('Escribí con cuánto efectivo arranca la caja'),
});

export const cerrarCajaSchema = z.object({
  contado: dinero('Escribí cuánto efectivo contaste'),
  nota: z.string().trim().max(200, 'Es demasiado largo').optional(),
});

export const cobroSchema = z
  .object({
    /** La genera la pantalla una vez por cobro: si el pedido se repite, no se cobra dos veces. */
    clave: z.uuid(),
    /** `null` = venta de mostrador a alguien que no es socio. */
    socioId: z.number().int().positive().nullable(),
    /** Qué facturas se pagan y cuánto de cada una (menos que el saldo = pago parcial). */
    aplicaciones: z
      .array(z.object({ comprobanteId: z.number().int().positive(), importe: dinero('Importe inválido') }))
      .max(60)
      .default([]),
    /** Gas y otros conceptos que se venden en el mostrador. */
    items: z
      .array(z.object({ productoId: z.number().int().positive(), cantidad: z.number().int().min(1).max(99) }))
      .max(20)
      .default([]),
    medio: z.enum(MEDIOS_PAGO, { error: 'Elegí el medio de pago' }),
    /** Solo en efectivo: con cuánto paga, para calcular el vuelto. */
    recibido: dinero('Escribí con cuánto paga').optional(),
    /** Número de operación, cupón o lo que identifique el pago con tarjeta o transferencia. */
    referencia: z.string().trim().max(60, 'Es demasiado largo').optional(),
  })
  .superRefine((c, ctx) => {
    if (c.aplicaciones.length + c.items.length === 0) ctx.addIssue({ code: 'custom', path: ['aplicaciones'], message: 'Elegí al menos una factura o un producto' });
    if (c.aplicaciones.length > 0 && c.socioId === null) ctx.addIssue({ code: 'custom', path: ['socioId'], message: 'Falta el socio' });
    if (new Set(c.aplicaciones.map((a) => a.comprobanteId)).size !== c.aplicaciones.length) ctx.addIssue({ code: 'custom', path: ['aplicaciones'], message: 'Hay una factura repetida' });
    if (new Set(c.items.map((i) => i.productoId)).size !== c.items.length) ctx.addIssue({ code: 'custom', path: ['items'], message: 'Hay un producto repetido' });
  });
export type CobroInput = z.infer<typeof cobroSchema>;

export const anularCobroSchema = z.object({
  motivo: z.string({ error: 'Contá por qué se anula' }).trim().min(5, 'Contá por qué se anula').max(200, 'Es demasiado largo'),
});

export const FORMATOS_RECIBO = ['ticket', 'a4'] as const;
export type FormatoRecibo = (typeof FORMATOS_RECIBO)[number];

/* ───────────────────────── Lo que devuelve la API ───────────────────────── */

export interface TotalPorMedio {
  medio: MedioPago;
  cantidad: number;
  total: string;
}

export interface CajaResumen {
  id: number;
  cajero: { id: number; nombre: string };
  abiertaEl: string;
  cerradaEl: string | null;
  fondoInicial: string;
  /** Cobros acreditados y su total (todos los medios). */
  cobros: number;
  total: string;
  anulados: number;
  porMedio: TotalPorMedio[];
  /** Efectivo que tiene que haber: fondo inicial + lo cobrado en efectivo. */
  efectivoEsperado: string;
  /** Arqueo: `null` mientras la caja está abierta. Diferencia = contado − esperado. */
  contado: string | null;
  diferencia: string | null;
  nota: string | null;
}

export interface EstadoCaja {
  hoy: string;
  /** La caja abierta de quien pregunta, si tiene. */
  caja: CajaResumen | null;
  puedeCobrar: boolean;
  puedeAnular: boolean;
}

export interface SocioEncontrado {
  id: number;
  numero: number;
  nombre: string;
  tipoDoc: string;
  nroDoc: string;
  direccion: string | null;
  deuda: string;
  pendientes: number;
  vencidas: number;
}

export interface ResultadoBusqueda {
  socios: SocioEncontrado[];
  /** Si lo buscado era el código de barras de una factura: cuál. */
  comprobanteId: number | null;
  /** Algo que conviene decirle al cajero (el código es de otra cooperativa, la factura ya está paga…). */
  aviso: string | null;
}

export interface FacturaPendiente {
  id: number;
  /** «Fact B 0006-00001234». */
  referencia: string;
  servicio: ServicioConexion;
  anio: number;
  mes: number;
  direccion: string | null;
  total: string;
  saldo: string;
  venceEl: string;
  /** Días de atraso; 0 si todavía no venció. */
  diasAtraso: number;
}

export interface PagoListado {
  id: number;
  /** «Rcbo B 0006-00000123». */
  referencia: string;
  cobradoEl: string;
  socio: { id: number; numero: number; nombre: string } | null;
  medio: MedioPago;
  origen: OrigenPago;
  importe: string;
  estado: EstadoPago;
  cajero: string | null;
  /** Qué se cobró, en pocas palabras: «2 facturas», «Garrafa 10 kg». */
  concepto: string;
}

export interface CuentaSocio {
  socio: { id: number; numero: number; nombre: string; tipoDoc: string; nroDoc: string; direccion: string | null; telefono: string | null };
  pendientes: FacturaPendiente[];
  deuda: string;
  ultimosPagos: PagoListado[];
}

export interface ProductoVenta {
  id: number;
  nombre: string;
  precio: string;
  /** `null` = no lleva control de stock (un derecho de conexión, por ejemplo). */
  stock: number | null;
}

/** Quién pagó, tal como figuraba ese día (el recibo no cambia aunque después cambie el padrón). */
export interface TitularRecibo {
  numero: number;
  nombre: string;
  tipoDoc: string;
  nroDoc: string;
  direccion: string | null;
}

export interface ReciboDetalle extends PagoListado {
  letra: string;
  puntoVenta: number;
  numero: number;
  cajaId: number | null;
  titular: TitularRecibo | null;
  recibido: string | null;
  vuelto: string | null;
  referenciaPago: string | null;
  aplicaciones: {
    comprobanteId: number;
    referencia: string;
    servicio: ServicioConexion;
    anio: number;
    mes: number;
    importe: string;
    /** Lo que quedó debiendo de esa factura después de este pago. */
    saldoDespues: string;
  }[];
  items: { descripcion: string; cantidad: number; unitario: string; importe: string }[];
  /** Pago online que no se pudo aplicar entero (una factura ya estaba paga): queda a favor del socio. */
  aFavor: string | null;
  anulacion: { motivo: string; fecha: string; por: string | null } | null;
}

export interface CajaDetalle extends CajaResumen {
  pagos: PagoListado[];
}

export interface PaginaCajas {
  filas: CajaResumen[];
  total: number;
  porPagina: number;
}

/* ───────────────────────── Reparto de un pago entre facturas ───────────────────────── */

/**
 * Reparte un importe entre las facturas elegidas, de la más vieja a la más nueva: paga cada una
 * entera hasta que la plata se termina (la última puede quedar con pago parcial).
 * Los importes van en centavos. Lo que sobre no se aplica a nada.
 */
export function repartirPago(importe: number, facturas: { id: number; saldo: number }[]): { comprobanteId: number; importe: number }[] {
  const out: { comprobanteId: number; importe: number }[] = [];
  let resto = importe;
  for (const f of facturas) {
    if (resto <= 0) break;
    const parte = Math.min(resto, f.saldo);
    if (parte > 0) out.push({ comprobanteId: f.id, importe: parte });
    resto -= parte;
  }
  return out;
}
