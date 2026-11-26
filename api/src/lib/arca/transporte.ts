// Envío de los pedidos SOAP a ARCA. Se puede reemplazar (los tests usan un ARCA de mentira).
import https from 'node:https';
import { config } from '../../config';
import { texto } from './xml';

export interface PedidoSoap {
  url: string;
  /** Cabecera SOAPAction (vacía en WSAA). */
  accion: string;
  cuerpo: string;
}

export interface RespuestaSoap {
  status: number;
  cuerpo: string;
}

export type Transporte = (pedido: PedidoSoap) => Promise<RespuestaSoap>;

/** Problema hablando con ARCA: sin conexión, timeout, error del servidor o rechazo del pedido entero. */
export class ErrorArca extends Error {
  constructor(
    message: string,
    /** Código de ARCA (o de la falla SOAP), si vino uno. */
    readonly codigo: string | null = null,
  ) {
    super(message);
    this.name = 'ErrorArca';
  }
}

const TIEMPO = 45_000;
let agente: https.Agent | null = null;
const agenteArca = () =>
  (agente ??= new https.Agent({
    keepAlive: true,
    // Algunos servidores de ARCA negocian claves que OpenSSL 3 rechaza por defecto.
    ...(config.arcaTlsLegacy ? { ciphers: 'DEFAULT@SECLEVEL=1' } : {}),
  }));

export const transporteHttps: Transporte = (p) =>
  new Promise((resolve, reject) => {
    const url = new URL(p.url);
    const cuerpo = Buffer.from(p.cuerpo, 'utf8');
    const req = https.request(
      {
        method: 'POST',
        hostname: url.hostname,
        path: url.pathname + url.search,
        port: url.port || 443,
        agent: agenteArca(),
        headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `"${p.accion}"`, 'Content-Length': cuerpo.length, 'User-Agent': 'GestionCoop' },
        timeout: TIEMPO,
      },
      (res) => {
        const partes: Buffer[] = [];
        res.on('data', (d: Buffer) => partes.push(d));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, cuerpo: Buffer.concat(partes).toString('utf8') }));
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new ErrorArca('ARCA no respondió a tiempo. Probá de nuevo en unos minutos.')));
    req.on('error', (err) => reject(err instanceof ErrorArca ? err : new ErrorArca(`No pudimos conectarnos con ARCA (${(err as Error).message}).`)));
    req.end(cuerpo);
  });

/** Manda el pedido y devuelve la respuesta, o una falla SOAP como ErrorArca. */
export async function llamarSoap(transporte: Transporte, pedido: PedidoSoap): Promise<string> {
  const r = await transporte(pedido);
  const falla = texto(r.cuerpo, 'faultstring');
  if (falla !== null) throw new ErrorArca(`ARCA rechazó el pedido: ${falla}`, texto(r.cuerpo, 'faultcode'));
  if (r.status >= 400) throw new ErrorArca(`ARCA respondió con un error (${r.status}).`);
  return r.cuerpo;
}
