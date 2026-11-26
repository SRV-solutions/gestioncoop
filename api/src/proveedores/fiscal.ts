// Factura electrónica (SPEC 6.5): la app habla con esta interfaz y no con ARCA directamente.
// Hay dos implementaciones: la simulada (demo) y la de ARCA (lib/fiscal.ts), que se elige por
// cooperativa según su configuración fiscal.
import type { Transaction } from 'sequelize';
import type { AmbienteFiscal, TipoComprobante } from '../shared';
import { sumarDias } from '../motor';

export interface ComprobanteAAutorizar {
  id: number;
  tipo: TipoComprobante;
  letra: string;
  puntoVenta: number;
  numero: number;
  total: string;
  /** Fecha de emisión (AAAA-MM-DD). */
  fecha: string;
  /** Vencimiento de pago (facturas); `null` en las notas de crédito. */
  venceEl: string | null;
}

export interface Autorizacion {
  /** Código de autorización del comprobante. */
  cae: string;
  caeVence: string;
  ambiente: AmbienteFiscal;
}

export interface ResultadoAutorizacion {
  autorizados: Map<number, Autorizacion>;
  /**
   * El primero que no se pudo autorizar, con el motivo. Los que venían después en su talonario no se
   * mandaron (en ARCA cada número tiene que ser el siguiente del último autorizado).
   */
  rechazo: { id: number; motivo: string } | null;
}

export interface ProveedorFiscal {
  nombre: string;
  ambiente: AmbienteFiscal;
  /** `true` = los comprobantes no tienen validez fiscal y el PDF lo dice bien grande. */
  simulado: boolean;
  /**
   * Autoriza un lote ya numerado, en orden. Lo autorizado siempre es el principio de cada talonario:
   * si uno se rechaza, los siguientes de ese talonario quedan sin autorizar.
   */
  autorizar(comprobantes: ComprobanteAAutorizar[], transaction?: Transaction): Promise<ResultadoAutorizacion>;
}

/** No habla con nadie: inventa un código con forma de CAE para que la demo se vea completa. */
export const fiscalSimulado: ProveedorFiscal = {
  nombre: 'Simulado',
  ambiente: 'simulado',
  simulado: true,
  async autorizar(comprobantes) {
    const autorizados = new Map<number, Autorizacion>();
    for (const c of comprobantes) {
      const cuerpo = `${String(c.puntoVenta).padStart(4, '0')}${String(c.numero).padStart(8, '0')}`;
      // Empieza con 00: un CAE real nunca empieza así.
      autorizados.set(c.id, { cae: `00${cuerpo}`, caeVence: sumarDias(c.fecha, 10), ambiente: 'simulado' });
    }
    return { autorizados, rechazo: null };
  },
};
