// Mails (alertas al personal y, si se activa, avisos a los socios). Con RESEND_API_KEY salen por Resend;
// sin clave, no sale nada y queda registrado como simulado (la demo nunca le manda un mail a nadie).
import { config } from '../config';

export interface Correo {
  para: string;
  asunto: string;
  texto: string;
}

export interface ResultadoCorreo {
  estado: 'enviado' | 'simulado' | 'fallido';
  id?: string;
  error?: string;
}

export interface ProveedorCorreo {
  nombre: string;
  /** `false` = no manda nada. */
  real: boolean;
  enviar(correo: Correo): Promise<ResultadoCorreo>;
  /** Varios a la vez (Resend acepta hasta 100 por pedido). Devuelve un resultado por mail, en el mismo orden. */
  enviarLote(correos: Correo[]): Promise<ResultadoCorreo[]>;
}

export const correoSimulado: ProveedorCorreo = {
  nombre: 'Simulado',
  real: false,
  async enviar() {
    return { estado: 'simulado' };
  },
  async enviarLote(correos) {
    return correos.map(() => ({ estado: 'simulado' as const }));
  },
};

/** Direcciones que no existen (las de los datos de prueba): nunca se les manda nada. */
export function esDireccionDePrueba(email: string): boolean {
  return /\.(example|test|invalid|localhost)$/i.test(email.trim()) || /@example\.(com|org|net)$/i.test(email.trim());
}

const LOTE_RESEND = 100;
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
const mensajeDe = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 300);

export function correoResend(apiKey: string, remitente: string, fetcher: typeof fetch = fetch): ProveedorCorreo {
  const llamar = async (ruta: string, cuerpo: unknown): Promise<unknown> => {
    const res = await fetcher(`https://api.resend.com${ruta}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'User-Agent': 'GestionCoop' },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(15_000),
    });
    const datos = (await res.json().catch(() => null)) as { message?: string } | null;
    if (!res.ok) throw new Error(datos?.message ?? `Resend respondió ${res.status}`);
    return datos;
  };
  const cuerpo = (c: Correo) => ({ from: remitente, to: [c.para], subject: c.asunto, text: c.texto });

  return {
    nombre: 'Resend',
    real: true,
    async enviar(c) {
      try {
        const datos = (await llamar('/emails', cuerpo(c))) as { id?: string } | null;
        return { estado: 'enviado', id: datos?.id };
      } catch (err) {
        return { estado: 'fallido', error: mensajeDe(err) };
      }
    },
    async enviarLote(correos) {
      const out: ResultadoCorreo[] = [];
      for (let i = 0; i < correos.length; i += LOTE_RESEND) {
        const lote = correos.slice(i, i + LOTE_RESEND);
        try {
          const datos = (await llamar('/emails/batch', lote.map(cuerpo))) as { data?: { id?: string }[] } | null;
          lote.forEach((_, j) => out.push({ estado: 'enviado', id: datos?.data?.[j]?.id }));
        } catch (err) {
          const error = mensajeDe(err);
          lote.forEach(() => out.push({ estado: 'fallido', error }));
        }
        // Resend admite pocos pedidos por segundo: entre lote y lote, una pausa.
        if (i + LOTE_RESEND < correos.length) await esperar(600);
      }
      return out;
    },
  };
}

export const proveedorCorreo: ProveedorCorreo = config.resendApiKey ? correoResend(config.resendApiKey, config.correoRemitente) : correoSimulado;
