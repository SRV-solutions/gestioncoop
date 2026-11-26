// Factura electrónica (SPEC 6.5): la app habla con esta interfaz y no con ARCA directamente.
// Hoy la única implementación es la simulada; la real se enchufa acá sin tocar la facturación.
import { sumarDias } from '../motor';
import type { TipoComprobante } from '../shared';

export interface ComprobanteAAutorizar {
  id: number;
  tipo: TipoComprobante;
  letra: string;
  puntoVenta: number;
  numero: number;
  total: string;
  fecha: string;
}

export interface Autorizacion {
  /** Código de autorización del comprobante. */
  cae: string;
  caeVence: string;
}

export interface ProveedorFiscal {
  nombre: string;
  /** `true` = los comprobantes no tienen validez fiscal y el PDF lo dice bien grande. */
  simulado: boolean;
  /** Autoriza un lote ya numerado. Devuelve una autorización por comprobante. */
  autorizar(comprobantes: ComprobanteAAutorizar[]): Promise<Map<number, Autorizacion>>;
}

/** No habla con nadie: inventa un código con forma de CAE para que la demo se vea completa. */
export const fiscalSimulado: ProveedorFiscal = {
  nombre: 'Simulado',
  simulado: true,
  async autorizar(comprobantes) {
    const out = new Map<number, Autorizacion>();
    for (const c of comprobantes) {
      const cuerpo = `${String(c.puntoVenta).padStart(4, '0')}${String(c.numero).padStart(8, '0')}`;
      // Empieza con 00: un CAE real nunca empieza así.
      out.set(c.id, { cae: `00${cuerpo}`, caeVence: sumarDias(c.fecha, 10) });
    }
    return out;
  },
};

export const proveedorFiscal: ProveedorFiscal = fiscalSimulado;
