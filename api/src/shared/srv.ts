// Panel de SRV: lo que se le cobra a cada cooperativa y el diseño de su factura.
import { z } from 'zod';

/* ───────────────────────── Comisión por factura ───────────────────────── */

/** Lo que propone SRV al arrancar: 0,8 % de cada factura emitida, sin monto fijo. */
export const COMISION_INICIAL = { porcentaje: '0.8', fijoPorFactura: '0' } as const;

const fecha = z.string({ error: 'Elegí desde cuándo rige' }).regex(/^\d{4}-\d{2}-\d{2}$/, 'Elegí desde cuándo rige');
const decimales = (max: number) => (v: number) => Number.isInteger(Math.round(v * 10 ** max * 1e6) / 1e6);

export const comisionSchema = z.object({
  porcentaje: z.coerce
    .number({ error: 'Escribí el porcentaje' })
    .min(0, 'No puede ser negativo')
    .max(10, 'Como mucho 10 %')
    .refine(decimales(3), 'Hasta tres decimales'),
  fijoPorFactura: z.coerce
    .number({ error: 'Escribí el monto' })
    .min(0, 'No puede ser negativo')
    .max(100_000, 'Es demasiado')
    .refine(decimales(2), 'Hasta dos decimales')
    .default(0),
  desde: fecha,
  nota: z.string().trim().max(200, 'Es demasiado largo').nullish().transform((v) => v || null),
});
export type ComisionInput = z.input<typeof comisionSchema>;

export interface ComisionVigencia {
  id: number;
  desde: string;
  porcentaje: string;
  fijoPorFactura: string;
  nota: string | null;
  cargadoPor: string | null;
  creadoEl: string;
}

/** Un mes de lo que emitió una cooperativa y lo que le corresponde a SRV. */
export interface LiquidacionMes {
  anio: number;
  mes: number;
  /** Facturas y notas de débito emitidas. */
  facturas: number;
  notasCredito: number;
  facturado: string;
  acreditado: string;
  /** Facturado menos acreditado. */
  neto: string;
  comision: string;
}

export interface ComisionCooperativa {
  vigente: ComisionVigencia | null;
  /** Un cambio ya cargado que todavía no rige. */
  proxima: ComisionVigencia | null;
  historial: ComisionVigencia[];
  /** Últimos 12 meses con facturas, del más nuevo al más viejo. */
  meses: LiquidacionMes[];
}

/** Lo que SRV le cobra a cada cooperativa en un mes. */
export interface LiquidacionPlataforma {
  anio: number;
  mes: number;
  /** Meses con facturas, para elegir. */
  meses: { anio: number; mes: number }[];
  filas: (LiquidacionMes & { cooperativa: { id: number; nombreCorto: string }; porcentaje: string | null; fijoPorFactura: string | null })[];
  total: string;
}

/**
 * Cuánto le toca a SRV de una factura de ejemplo (para mostrar en pantalla, no para liquidar:
 * la liquidación la hace el servidor con decimales exactos).
 */
export const comisionDeEjemplo = (total: number, porcentaje: number, fijo = 0) => Math.round((total * porcentaje + fijo * 100)) / 100;

/* ───────────────────────── Diseño de la factura ───────────────────────── */

export interface ModeloFactura {
  /** Color de la franja y del gráfico; `null` = el de la marca de la cooperativa. */
  color: string | null;
  /** Logo en el encabezado (el de la factura; si no hay, el isotipo). */
  conLogo: boolean;
  /** Renglones extra del encabezado: ingresos brutos, inicio de actividades, sitio web… */
  membrete: string[];
  /** Aviso destacado para todos los socios, debajo del encabezado. */
  mensaje: string | null;
  /** Texto al pie: ente regulador, defensa del consumidor, leyendas legales. */
  pie: string | null;
}

export const MODELO_FACTURA_BASE: ModeloFactura = { color: null, conLogo: true, membrete: [], mensaje: null, pie: null };

const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Hasta ${max} letras`)
    .nullish()
    .transform((v) => v || null);

export const modeloFacturaSchema = z.object({
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Elegí un color')
    .nullish()
    .transform((v) => (v ? v.toLowerCase() : null)),
  conLogo: z.boolean().default(true),
  membrete: z
    .array(z.string().trim().max(90, 'Hasta 90 letras por renglón'))
    .max(3, 'Hasta 3 renglones')
    .default([])
    .transform((l) => l.filter(Boolean)),
  mensaje: textoOpcional(160),
  pie: textoOpcional(300),
});
export type ModeloFacturaInput = z.input<typeof modeloFacturaSchema>;

/** Logo de la factura: PNG o JPEG (los que puede dibujar el PDF), ya achicado por la pantalla. */
export const logoFacturaSchema = z.object({
  imagen: z
    .string({ error: 'Elegí una imagen' })
    .max(900_000, 'La imagen es demasiado grande')
    .regex(/^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/=]+$/, 'Usá una imagen PNG o JPG'),
});

export interface DisenoFactura {
  modelo: ModeloFactura;
  /** Hay un logo propio para la factura (si no, se usa el isotipo, si hay). */
  logoFactura: boolean;
  isotipo: boolean;
  /** Color de la marca, el que se usa si el modelo no elige otro. */
  colorMarca: string;
  /** Hay al menos una factura emitida para mostrar de muestra. */
  hayMuestra: boolean;
}

export interface CooperativaSrv {
  id: number;
  nombre: string;
  nombreCorto: string;
  subdominio: string;
  comision: ComisionCooperativa;
  factura: DisenoFactura;
}
