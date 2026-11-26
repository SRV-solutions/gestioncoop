// Factura electrónica con ARCA: cómo se conecta cada cooperativa y cómo se informa cada concepto.
import { z } from 'zod';

export const AMBIENTES_FISCALES = ['simulado', 'homologacion', 'produccion'] as const;
export type AmbienteFiscal = (typeof AMBIENTES_FISCALES)[number];
export const AMBIENTE_FISCAL_ETIQUETA: Record<AmbienteFiscal, string> = {
  simulado: 'Simulada (demo, sin ARCA)',
  homologacion: 'Homologación (pruebas de ARCA, sin validez fiscal)',
  produccion: 'Producción (facturas con validez fiscal)',
};

/**
 * Cómo va a ARCA cada concepto de la tarifa que no es IVA. Lo define el contador de la cooperativa:
 * - `tributo`: impuesto o tasa (Ley provincial, alumbrado, fondos), con el código de tributo de ARCA.
 * - `no_gravado`: no lleva IVA y no es un tributo (capitalización de acciones, cuota de bomberos).
 * - `exento`: operación exenta de IVA.
 */
export const TRATAMIENTOS_FISCALES = ['tributo', 'no_gravado', 'exento'] as const;
export type TratamientoFiscal = (typeof TRATAMIENTOS_FISCALES)[number];
export const TRATAMIENTO_FISCAL_ETIQUETA: Record<TratamientoFiscal, string> = {
  tributo: 'Tributo',
  no_gravado: 'No gravado',
  exento: 'Exento de IVA',
};

/** Códigos de tributo de ARCA (tabla FEParamGetTiposTributos). */
export const TRIBUTOS_ARCA = [
  { id: 1, nombre: 'Impuestos nacionales' },
  { id: 2, nombre: 'Impuestos provinciales' },
  { id: 3, nombre: 'Impuestos municipales' },
  { id: 4, nombre: 'Impuestos internos' },
  { id: 5, nombre: 'Ingresos brutos' },
  { id: 99, nombre: 'Otros tributos' },
] as const;

export interface TratamientoConcepto {
  tratamiento: TratamientoFiscal;
  /** Solo para `tributo`. */
  tributoId: number | null;
}

export interface ConceptoFiscal {
  codigo: string;
  nombre: string;
  grupo: string;
  /** Lo que se usa si el contador no definió otra cosa. */
  sugerido: TratamientoConcepto;
}

export interface ConfigFiscalVista {
  ambiente: AmbienteFiscal;
  /** El CUIT con el que se factura (el propio, si se cargó uno distinto, o el de la cooperativa). */
  cuit: string;
  cuitPropio: string | null;
  puntoVenta: number;
  certificado: { titular: string; vence: string; vencido: boolean } | null;
  tratamientos: Record<string, TratamientoConcepto>;
  /** Conceptos de la tarifa de la cooperativa que no son IVA. */
  conceptos: ConceptoFiscal[];
  ultimaPrueba: { el: string; ok: boolean; detalle: string } | null;
  /** Pre-facturas sin emitir: mientras haya, no se cambia el punto de venta ni la numeración. */
  borradoresPendientes: number;
}

export interface PasoPruebaArca {
  nombre: string;
  ok: boolean;
  detalle: string;
}

export interface NumeracionArca {
  tipo: 'factura' | 'nota_credito';
  letra: string;
  puntoVenta: number;
  /** Último número que autorizó ARCA; `null` si no se pudo consultar. */
  enArca: number | null;
  /** Último número que usó GestiónCoop. */
  enApp: number;
}

export interface PruebaArca {
  ok: boolean;
  pasos: PasoPruebaArca[];
  numeracion: NumeracionArca[];
}

/** Dígito verificador del CUIT (módulo 11). */
export function cuitValido(cuit: string): boolean {
  if (!/^\d{11}$/.test(cuit)) return false;
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((t, p, i) => t + p * Number(cuit[i]), 0);
  const resto = 11 - (suma % 11);
  const dv = resto === 11 ? 0 : resto === 10 ? 9 : resto;
  return dv === Number(cuit[10]);
}

const codigoConcepto = z.string().regex(/^[A-Z0-9_]{2,24}$/);
export const tratamientoConceptoSchema = z
  .object({ tratamiento: z.enum(TRATAMIENTOS_FISCALES), tributoId: z.number().int().nullable().default(null) })
  .refine((t) => t.tratamiento !== 'tributo' || TRIBUTOS_ARCA.some((x) => x.id === t.tributoId), { message: 'Elegí el tipo de tributo', path: ['tributoId'] });

export const configFiscalSchema = z.object({
  ambiente: z.enum(AMBIENTES_FISCALES),
  cuit: z
    .string()
    .trim()
    .transform((v) => v.replace(/\D/g, ''))
    .refine((v) => v === '' || cuitValido(v), 'Ese CUIT no es válido: revisá los 11 números')
    .transform((v) => v || null)
    .nullable()
    .default(null),
  puntoVenta: z.number({ error: 'Poné el punto de venta' }).int().min(1, 'Del 1 al 99998').max(99998, 'Del 1 al 99998'),
  tratamientos: z.record(codigoConcepto, tratamientoConceptoSchema).default({}),
  /** Para pasar a producción hay que confirmarlo: desde ahí las facturas tienen validez fiscal. */
  confirmarProduccion: z.boolean().optional(),
});
export type ConfigFiscalInput = z.input<typeof configFiscalSchema>;
export type ConfigFiscalDatos = z.output<typeof configFiscalSchema>;

const pem = (tipo: string) =>
  z
    .string()
    .trim()
    .max(20_000, 'El archivo es demasiado grande')
    .refine((v) => v.includes('-----BEGIN') && v.includes(tipo), `No parece un archivo ${tipo === 'CERTIFICATE' ? 'de certificado (.crt o .pem)' : 'de clave privada (.key)'}`);

export const certificadoFiscalSchema = z.object({
  certificado: pem('CERTIFICATE'),
  clave: pem('PRIVATE KEY'),
});
export type CertificadoFiscalInput = z.input<typeof certificadoFiscalSchema>;
