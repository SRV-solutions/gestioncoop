// WSFEv1: la factura electrónica de ARCA. Solo lo que usa GestiónCoop: estado del servicio, último
// número autorizado, consulta de un comprobante y pedido de CAE.
import { fechaIso, URLS, type AmbienteArca } from './codigos';
import { ErrorArca, llamarSoap, type Transporte } from './transporte';
import { armar, bloque, mensajes, texto, todos, type NodoXml } from './xml';

const NS = 'http://ar.gov.afip.dif.FEV1/';

export interface Credenciales {
  token: string;
  sign: string;
  cuit: string;
}

export interface ClienteWsfe {
  transporte: Transporte;
  ambiente: AmbienteArca;
}

/** Un comprobante a autorizar, con los campos en el orden que exige ARCA. */
export interface DetalleCae {
  Concepto: number;
  DocTipo: number;
  DocNro: string;
  CbteDesde: number;
  CbteHasta: number;
  CbteFch: string;
  ImpTotal: string;
  ImpTotConc: string;
  ImpNeto: string;
  ImpOpEx: string;
  ImpTrib: string;
  ImpIVA: string;
  FchServDesde: string;
  FchServHasta: string;
  FchVtoPago: string;
  MonId: 'PES';
  MonCotiz: 1;
  CondicionIVAReceptorId: number;
  CbtesAsoc?: { CbteAsoc: { Tipo: number; PtoVta: number; Nro: number; Cuit: string; CbteFch: string }[] };
  Tributos?: { Tributo: { Id: number; Desc: string; BaseImp: string; Alic: string; Importe: string }[] };
  Iva?: { AlicIva: { Id: number; BaseImp: string; Importe: string }[] };
}

export interface ResultadoDetalle {
  numero: number;
  aprobado: boolean;
  cae: string | null;
  caeVence: string | null;
  observaciones: { codigo: string; mensaje: string }[];
}

const auth = (c: Credenciales) => ({ Auth: { Token: c.token, Sign: c.sign, Cuit: c.cuit } });

async function llamar(cliente: ClienteWsfe, metodo: string, contenido: NodoXml): Promise<string> {
  const cuerpo =
    `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="${NS}"><soap:Header/><soap:Body>` +
    `<ar:${metodo}>${armar(contenido, 'ar:')}</ar:${metodo}></soap:Body></soap:Envelope>`;
  const respuesta = await llamarSoap(cliente.transporte, { url: URLS[cliente.ambiente].wsfe, accion: `${NS}${metodo}`, cuerpo });
  const resultado = bloque(respuesta, `${metodo}Result`);
  if (resultado === null) throw new ErrorArca('ARCA respondió algo que no esperábamos. Probá de nuevo en unos minutos.');
  return resultado;
}

/** Errores del pedido entero: si vienen, no se procesó nada. */
function fallaSiHayErrores(resultado: string, que: string): void {
  const errores = mensajes(bloque(resultado, 'Errors'), 'Err');
  if (errores.length) throw new ErrorArca(`ARCA rechazó ${que}: ${errores.map((e) => `${e.codigo} ${e.mensaje}`).join(' · ')}`, errores[0]!.codigo);
}

/** Estado de los servidores de ARCA (no necesita permiso). */
export async function estadoServicio(cliente: ClienteWsfe): Promise<{ app: string; base: string; auth: string }> {
  const r = await llamar(cliente, 'FEDummy', null);
  return { app: texto(r, 'AppServer') ?? '?', base: texto(r, 'DbServer') ?? '?', auth: texto(r, 'AuthServer') ?? '?' };
}

/** Último número que ARCA autorizó en ese punto de venta y tipo (0 si ninguno). */
export async function ultimoAutorizado(cliente: ClienteWsfe, c: Credenciales, ptoVta: number, cbteTipo: number): Promise<number> {
  const r = await llamar(cliente, 'FECompUltimoAutorizado', { ...auth(c), PtoVta: ptoVta, CbteTipo: cbteTipo });
  fallaSiHayErrores(r, 'la consulta del último número');
  return Number(texto(r, 'CbteNro') ?? '0');
}

/** Un comprobante ya autorizado, o `null` si ARCA no lo tiene. */
export async function consultarComprobante(
  cliente: ClienteWsfe,
  c: Credenciales,
  ptoVta: number,
  cbteTipo: number,
  numero: number,
): Promise<{ cae: string; caeVence: string; docNro: string; total: string; fecha: string } | null> {
  const r = await llamar(cliente, 'FECompConsultar', { ...auth(c), FeCompConsReq: { CbteTipo: cbteTipo, CbteNro: numero, PtoVta: ptoVta } });
  const errores = mensajes(bloque(r, 'Errors'), 'Err');
  // 602: «No existen datos en nuestros registros».
  if (errores.some((e) => e.codigo === '602')) return null;
  fallaSiHayErrores(r, 'la consulta del comprobante');
  const datos = bloque(r, 'ResultGet');
  const cae = datos && texto(datos, 'CodAutorizacion');
  if (!datos || !cae) return null;
  return {
    cae,
    caeVence: fechaIso(texto(datos, 'FchVto') ?? ''),
    docNro: texto(datos, 'DocNro') ?? '',
    total: texto(datos, 'ImpTotal') ?? '',
    fecha: fechaIso(texto(datos, 'CbteFch') ?? ''),
  };
}

/**
 * Pide el CAE para un lote del mismo punto de venta y tipo, con números seguidos. ARCA procesa en orden:
 * si rechaza uno, los que siguen tampoco salen (el número tiene que ser el siguiente del último autorizado).
 */
export async function solicitarCae(cliente: ClienteWsfe, c: Credenciales, ptoVta: number, cbteTipo: number, detalles: DetalleCae[]): Promise<ResultadoDetalle[]> {
  const r = await llamar(cliente, 'FECAESolicitar', {
    ...auth(c),
    FeCAEReq: {
      FeCabReq: { CantReg: detalles.length, PtoVta: ptoVta, CbteTipo: cbteTipo },
      FeDetReq: { FECAEDetRequest: detalles as unknown as NodoXml[] },
    },
  });
  const respuestas = todos(r, 'FECAEDetResponse');
  if (respuestas.length === 0) fallaSiHayErrores(r, 'el pedido de CAE');
  if (respuestas.length === 0) throw new ErrorArca('ARCA no devolvió el resultado del pedido de CAE.');
  return respuestas.map((d) => {
    const cae = texto(d, 'CAE');
    const vence = texto(d, 'CAEFchVto');
    return {
      numero: Number(texto(d, 'CbteDesde')),
      aprobado: texto(d, 'Resultado') === 'A' && Boolean(cae),
      cae: cae || null,
      caeVence: vence ? fechaIso(vence) : null,
      observaciones: mensajes(bloque(d, 'Observaciones'), 'Obs'),
    };
  });
}
