// Pago online (SPEC 6.6 y 6.6.1): la app habla con esta interfaz y no con el banco directamente.
// Hoy la única implementación es la simulada; Macro Click de Pago se enchufa acá sin tocar el resto.
//
// Reglas que tiene que cumplir cualquier proveedor:
// - El pago se da por acreditado SOLO con la notificación servidor a servidor o con la consulta de
//   estado. El regreso del navegador (`confirmarRetorno`) nunca acredita: solo dice qué intento era.
// - El id del intento es el «TransaccionComercioId»: reintentar o recibir dos veces el aviso no cobra dos veces.
// - Un ítem por factura, para que el socio y la conciliación vean qué se pagó.
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ItemIntento, RedireccionPago } from '../shared';
import { config } from '../config';
import { PasarelaSimulada } from '../models';

export interface ResultadoPago {
  intentoId: string;
  estado: 'pendiente' | 'aprobado' | 'rechazado' | 'cancelado';
  medio?: 'debito' | 'credito';
  /** Número de operación del banco. */
  referencia?: string;
  /** Lo que el banco dice que cobró. */
  importe?: string;
  /** Por qué no se aprobó, si lo dice. */
  motivo?: string;
}

export interface NuevoIntento {
  cooperativaId: number;
  socioId: number;
  intentoId: string;
  items: ItemIntento[];
  total: string;
  /** Adónde vuelve el navegador (CallbackSuccess / CallbackCancel). */
  retorno: { exito: string; cancelado: string };
  /** Adónde avisa el banco, servidor a servidor. */
  notificacion: string;
}

export interface ProveedorPagos {
  nombre: string;
  /** `true` = no se mueve plata de verdad (la pantalla lo dice). */
  simulado: boolean;
  crearIntento(input: NuevoIntento): Promise<{ redireccion: RedireccionPago }>;
  /** Vuelta del navegador: identifica el intento. No acredita nada. */
  confirmarRetorno(params: Record<string, string | undefined>): Promise<{ intentoId: string | null }>;
  /** Aviso servidor a servidor. Falla si la firma no es del proveedor. */
  procesarNotificacion(payload: unknown, firma: string | undefined): Promise<ResultadoPago>;
  consultarEstado(intentoId: string): Promise<ResultadoPago>;
}

export class FirmaInvalidaError extends Error {
  constructor() {
    super('La firma de la notificación no es válida');
    this.name = 'FirmaInvalidaError';
  }
}

/* ───────────────────────── Simulado ─────────────────────────
 * Hace de banco: tiene su propia pantalla (la «pasarela de prueba»), guarda lo que decidió en
 * `pasarela_simulada` y firma sus avisos con una clave propia, como haría el banco con la suya. */

const CLAVE = createHmac('sha256', config.jwtSecret).update('pasarela-simulada').digest();
const firmar = (texto: string) => createHmac('sha256', CLAVE).update(texto).digest('hex');
function firmaOk(texto: string, firma: string | undefined): boolean {
  if (!firma || !/^[0-9a-f]{64}$/.test(firma)) return false;
  return timingSafeEqual(Buffer.from(firmar(texto), 'hex'), Buffer.from(firma, 'hex'));
}

/** Firma con la que la pasarela de prueba reconoce un intento que le mandamos nosotros. */
export const firmaIntento = (intentoId: string) => firmar(`intento:${intentoId}`);
export const firmaIntentoOk = (intentoId: string, firma: string | undefined) => firmaOk(`intento:${intentoId}`, firma);

const MOTIVOS_RECHAZO = ['Fondos insuficientes', 'La tarjeta está vencida', 'El banco no autorizó la operación'];

const aResultado = (p: PasarelaSimulada): ResultadoPago => ({
  intentoId: p.intentoId,
  estado: p.estado,
  medio: p.medio ?? undefined,
  referencia: p.referencia ?? undefined,
  importe: p.importe,
  motivo: p.motivo ?? undefined,
});

export const pagosSimulados: ProveedorPagos & {
  /** Lo que hace el socio en la pantalla del «banco». Devuelve el aviso que el banco manda a nuestro servidor. */
  decidir(intentoId: string, decision: 'aprobar' | 'rechazar' | 'cancelar', medio: 'debito' | 'credito'): Promise<{ payload: ResultadoPago; firma: string }>;
  firmarNotificacion(payload: ResultadoPago): string;
} = {
  nombre: 'simulado',
  simulado: true,

  async crearIntento(input) {
    await PasarelaSimulada.create({ intentoId: input.intentoId, cooperativaId: input.cooperativaId, estado: 'pendiente', importe: input.total });
    // La pasarela real recibe un formulario POST con los datos cifrados; la de prueba vive en la app.
    return { redireccion: { url: `${config.appUrl}/pasarela/${input.intentoId}`, metodo: 'GET', campos: { firma: firmaIntento(input.intentoId) } } };
  },

  async confirmarRetorno(params) {
    const id = params.intento ?? null;
    return { intentoId: id && /^[0-9a-f-]{36}$/i.test(id) ? id : null };
  },

  async procesarNotificacion(payload, firma) {
    const texto = JSON.stringify(payload);
    if (!firmaOk(texto, firma)) throw new FirmaInvalidaError();
    const r = payload as ResultadoPago;
    if (typeof r?.intentoId !== 'string' || !['aprobado', 'rechazado', 'cancelado', 'pendiente'].includes(r.estado)) throw new FirmaInvalidaError();
    return r;
  },

  async consultarEstado(intentoId) {
    const p = await PasarelaSimulada.findByPk(intentoId);
    return p ? aResultado(p) : { intentoId, estado: 'pendiente' };
  },

  async decidir(intentoId, decision, medio) {
    const p = await PasarelaSimulada.findByPk(intentoId);
    if (!p) throw new Error('Operación desconocida');
    // Lo ya decidido no cambia: apretar dos veces «Pagar» no cobra dos veces.
    if (p.estado === 'pendiente') {
      if (decision === 'aprobar') {
        await p.update({ estado: 'aprobado', medio, referencia: `SIM-${String(Math.floor(100_000 + Math.random() * 900_000))}` });
      } else if (decision === 'rechazar') {
        await p.update({ estado: 'rechazado', medio, motivo: MOTIVOS_RECHAZO[Math.floor(Math.random() * MOTIVOS_RECHAZO.length)]! });
      } else {
        await p.update({ estado: 'cancelado' });
      }
    }
    const payload = aResultado(p);
    return { payload, firma: this.firmarNotificacion(payload) };
  },

  firmarNotificacion(payload) {
    return firmar(JSON.stringify(payload));
  },
};

export const proveedorPagos: ProveedorPagos = pagosSimulados;
