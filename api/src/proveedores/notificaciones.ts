// Avisos al socio (SPEC sección 14): interfaz + implementación simulada. La simulada no envía
// nada: deja cada aviso en la tabla `notificaciones`, que es la bandeja que se ve en la demo.
import type { Transaction } from 'sequelize';
import { Notificacion } from '../models';

export interface AvisoAlSocio {
  socioId: number;
  comprobanteId?: number | null;
  canal: 'email' | 'whatsapp';
  destino: string;
  asunto: string;
  cuerpo: string;
}

export interface ProveedorNotificaciones {
  nombre: string;
  /** Devuelve cuántos avisos quedaron enviados (o guardados, en el simulado). */
  enviar(avisos: AvisoAlSocio[], transaction?: Transaction): Promise<number>;
}

export const notificacionesSimuladas: ProveedorNotificaciones = {
  nombre: 'Simulado',
  async enviar(avisos, transaction) {
    const LOTE = 1000;
    for (let i = 0; i < avisos.length; i += LOTE) {
      await Notificacion.bulkCreate(
        avisos.slice(i, i + LOTE).map((a) => ({ ...a, comprobanteId: a.comprobanteId ?? null, estado: 'simulada' })),
        { transaction, validate: false },
      );
    }
    return avisos.length;
  },
};

export const proveedorNotificaciones: ProveedorNotificaciones = notificacionesSimuladas;
