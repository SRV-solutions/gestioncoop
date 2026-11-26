// Tablas de ARCA (factura electrónica, WSFEv1) y direcciones de sus servicios.
import type { CondicionIva, TipoComprobante } from '../../shared';

export type AmbienteArca = 'homologacion' | 'produccion';

export const URLS: Record<AmbienteArca, { wsaa: string; wsfe: string }> = {
  homologacion: {
    wsaa: process.env.ARCA_WSAA_URL_HOMOLOGACION ?? 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms',
    wsfe: process.env.ARCA_WSFE_URL_HOMOLOGACION ?? 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx',
  },
  produccion: {
    wsaa: process.env.ARCA_WSAA_URL_PRODUCCION ?? 'https://wsaa.afip.gov.ar/ws/services/LoginCms',
    wsfe: process.env.ARCA_WSFE_URL_PRODUCCION ?? 'https://servicios1.afip.gov.ar/wsfev1/service.asmx',
  },
};

/** Tipo de comprobante de ARCA según el tipo y la letra. */
const CBTE_TIPO: Record<Exclude<TipoComprobante, 'recibo'>, Record<string, number>> = {
  factura: { A: 1, B: 6, C: 11 },
  nota_debito: { A: 2, B: 7, C: 12 },
  nota_credito: { A: 3, B: 8, C: 13 },
};

export function cbteTipo(tipo: TipoComprobante, letra: string): number {
  const codigo = tipo === 'recibo' ? undefined : CBTE_TIPO[tipo][letra];
  if (codigo === undefined) throw new Error(`No hay tipo de comprobante de ARCA para ${tipo} ${letra}`);
  return codigo;
}

/** Tipo de documento del receptor. Lo que no se reconoce va como «sin identificar» (99). */
export function docTipo(tipoDoc: string | null | undefined): number {
  const t = (tipoDoc ?? '').toUpperCase().replace(/[^A-Z]/g, '');
  const tabla: Record<string, number> = { CUIT: 80, CUIL: 86, CDI: 87, LE: 89, LC: 90, CI: 91, PASAPORTE: 94, PAS: 94, DNI: 96 };
  return tabla[t] ?? 99;
}

/** Condición frente al IVA del receptor (obligatoria desde la RG 5616). */
export const CONDICION_IVA_RECEPTOR: Record<CondicionIva, number> = {
  responsable_inscripto: 1,
  exento: 4,
  consumidor_final: 5,
  monotributo: 6,
};

/** Código de alícuota de IVA de ARCA según el porcentaje. */
export function alicuotaIva(porcentaje: string | number): number {
  const p = Number(porcentaje);
  const tabla: [number, number][] = [
    [0, 3],
    [2.5, 9],
    [5, 8],
    [10.5, 4],
    [21, 5],
    [27, 6],
  ];
  const fila = tabla.find(([valor]) => Math.abs(valor - p) < 0.001);
  if (!fila) throw new Error(`ARCA no tiene una alícuota de IVA del ${p} %`);
  return fila[1];
}

/** «Servicios»: llevan período facturado y vencimiento de pago. Es lo que factura una cooperativa. */
export const CONCEPTO_SERVICIOS = 2;

/** Fecha `AAAA-MM-DD` → `AAAAMMDD` (el formato de ARCA). */
export const fechaArca = (fecha: string) => fecha.slice(0, 10).replace(/-/g, '');
/** `AAAAMMDD` → `AAAA-MM-DD`. */
export const fechaIso = (fecha: string) => `${fecha.slice(0, 4)}-${fecha.slice(4, 6)}-${fecha.slice(6, 8)}`;
