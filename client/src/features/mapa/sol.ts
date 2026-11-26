// Posición del sol para una fecha y un lugar (fórmulas astronómicas estándar, las mismas de SunCalc).
// Con esto el mapa sabe solo si en la cooperativa es de día, está atardeciendo o es de noche.

const RAD = Math.PI / 180;

export interface Sol {
  /** Grados sobre el horizonte (negativo = bajo el horizonte). */
  altitud: number;
  /** Grados desde el norte, en sentido horario. */
  azimut: number;
}

export function posicionDelSol(fecha: Date, lat: number, lng: number): Sol {
  const dias = fecha.getTime() / 86_400_000 - 10_957.5; // días desde el 1/1/2000 12:00 UTC
  const anomalia = RAD * (357.5291 + 0.98560028 * dias);
  const centro = RAD * (1.9148 * Math.sin(anomalia) + 0.02 * Math.sin(2 * anomalia) + 0.0003 * Math.sin(3 * anomalia));
  const longitud = anomalia + centro + RAD * 102.9372 + Math.PI;
  const oblicuidad = RAD * 23.4397;
  const declinacion = Math.asin(Math.sin(oblicuidad) * Math.sin(longitud));
  const ascension = Math.atan2(Math.sin(longitud) * Math.cos(oblicuidad), Math.cos(longitud));
  const horaSideral = RAD * (280.16 + 360.9856235 * dias) + RAD * lng;
  const angulo = horaSideral - ascension;
  const phi = RAD * lat;
  const altitud = Math.asin(Math.sin(phi) * Math.sin(declinacion) + Math.cos(phi) * Math.cos(declinacion) * Math.cos(angulo));
  const azimut = Math.atan2(Math.sin(angulo), Math.cos(angulo) * Math.sin(phi) - Math.tan(declinacion) * Math.cos(phi));
  return { altitud: altitud / RAD, azimut: (azimut / RAD + 180 + 360) % 360 };
}

/**
 * Fase del día según la altura del sol: 0 = pleno día, 0.5 = sol en el horizonte, 1 = noche cerrada.
 * La transición va de +8° a −8°, que es más o menos lo que dura la luz del amanecer y del atardecer.
 */
export function faseDelDia(altitud: number): number {
  return Math.min(1, Math.max(0, (8 - altitud) / 16));
}

// Argentina no cambia la hora: siempre UTC−3.
const DESFASE_AR_MS = -3 * 3_600_000;

/** Hora del día (0 a 24, con decimales) en Argentina. */
export function horaArgentina(fecha: Date): number {
  const local = new Date(fecha.getTime() + DESFASE_AR_MS);
  return local.getUTCHours() + local.getUTCMinutes() / 60 + local.getUTCSeconds() / 3600;
}

/** El día de hoy (en Argentina) a la hora indicada: para recorrer el día con el control deslizante. */
export function hoyALas(hora: number, referencia = new Date()): Date {
  const local = new Date(referencia.getTime() + DESFASE_AR_MS);
  const medianoche = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - DESFASE_AR_MS;
  return new Date(medianoche + hora * 3_600_000);
}

export function formatHora(hora: number): string {
  const h = Math.floor(hora) % 24;
  const m = Math.floor((hora % 1) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function nombreDeFase(fase: number, hora: number): 'Día' | 'Amanecer' | 'Atardecer' | 'Noche' {
  if (fase < 0.2) return 'Día';
  if (fase > 0.8) return 'Noche';
  return hora < 12 ? 'Amanecer' : 'Atardecer';
}
