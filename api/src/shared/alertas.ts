// Alertas al personal y a SRV: quedan en la campana de la app y salen por mail.

export const ESTADOS_CORREO_ALERTA = ['enviado', 'simulado', 'fallido', 'sin_correo'] as const;
export type EstadoCorreoAlerta = (typeof ESTADOS_CORREO_ALERTA)[number];

export interface AlertaVista {
  id: number;
  tipo: string;
  titulo: string;
  cuerpo: string;
  /** Dónde mirar el problema dentro de la app. */
  enlace: string | null;
  leida: boolean;
  creadaEl: string;
  cooperativa: { id: number; nombreCorto: string };
  correo: EstadoCorreoAlerta;
}

export interface BandejaAlertas {
  alertas: AlertaVista[];
  sinLeer: number;
}
