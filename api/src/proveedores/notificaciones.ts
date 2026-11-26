// Avisos al socio (SPEC sección 14): interfaz + dos implementaciones. Las dos dejan cada aviso en la
// tabla `notificaciones` (la bandeja que se ve en la app). La simulada no envía nada; la de correo
// (AVISOS_SOCIOS_POR_CORREO=true y Resend configurado) manda los avisos por mail de verdad.
import type { Transaction } from 'sequelize';
import { config } from '../config';
import { Notificacion } from '../models';
import { esDireccionDePrueba, proveedorCorreo } from './correo';

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

const LOTE = 1000;

async function guardar(filas: (AvisoAlSocio & { estado: string })[], transaction?: Transaction): Promise<void> {
  for (let i = 0; i < filas.length; i += LOTE) {
    await Notificacion.bulkCreate(
      filas.slice(i, i + LOTE).map((a) => ({ ...a, comprobanteId: a.comprobanteId ?? null })),
      { transaction, validate: false },
    );
  }
}

export const notificacionesSimuladas: ProveedorNotificaciones = {
  nombre: 'Simulado',
  async enviar(avisos, transaction) {
    await guardar(
      avisos.map((a) => ({ ...a, estado: 'simulada' })),
      transaction,
    );
    return avisos.length;
  },
};

/** Los avisos por mail salen por Resend; los de WhatsApp (todavía sin proveedor) y las direcciones de prueba quedan simulados. */
export const notificacionesPorCorreo: ProveedorNotificaciones = {
  nombre: 'Correo (Resend)',
  async enviar(avisos, transaction) {
    const porMail = avisos.filter((a) => a.canal === 'email' && !esDireccionDePrueba(a.destino));
    const resultados = await proveedorCorreo.enviarLote(porMail.map((a) => ({ para: a.destino, asunto: a.asunto, texto: a.cuerpo })));
    const estadoDe = new Map(porMail.map((a, i) => [a, resultados[i]!.estado]));
    const estado = (a: AvisoAlSocio) => {
      const e = estadoDe.get(a);
      return e === 'enviado' ? 'enviada' : e === 'fallido' ? 'fallida' : 'simulada';
    };
    await guardar(
      avisos.map((a) => ({ ...a, estado: estado(a) })),
      transaction,
    );
    return avisos.filter((a) => estado(a) === 'enviada').length;
  },
};

export const proveedorNotificaciones: ProveedorNotificaciones =
  config.avisosSociosPorCorreo && proveedorCorreo.real ? notificacionesPorCorreo : notificacionesSimuladas;
