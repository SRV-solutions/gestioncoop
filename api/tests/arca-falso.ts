// Un ARCA de mentira para los tests: habla SOAP como el real (WSAA y WSFEv1), lleva la numeración de
// cada talonario, controla que los importes cierren y que cada número sea el siguiente, y se le puede
// pedir que rechace un número.
import { generateKeyPairSync } from 'node:crypto';
import forge from 'node-forge';
import type { PedidoSoap, RespuestaSoap, Transporte } from '../src/lib/arca/transporte';
import { escapar, texto, todos } from '../src/lib/arca/xml';

const NS = 'http://ar.gov.afip.dif.FEV1/';

/** Certificado y clave de prueba (autofirmados), como los que entrega ARCA en homologación. */
export function certificadoDePrueba(cuit = '30000000007'): { certificado: string; clave: string } {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.publicKeyFromPem(publicKey.export({ type: 'spki', format: 'pem' }).toString());
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 24 * 3600_000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 24 * 3600_000);
  const sujeto = [
    { name: 'countryName', value: 'AR' },
    { name: 'organizationName', value: 'Cooperativa de prueba' },
    { name: 'commonName', value: 'gestioncoop' },
    { name: 'serialNumber', value: `CUIT ${cuit}` },
  ];
  cert.setSubject(sujeto);
  cert.setIssuer(sujeto);
  const clavePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  cert.sign(forge.pki.privateKeyFromPem(privateKey.export({ type: 'pkcs1', format: 'pem' }).toString()), forge.md.sha256.create());
  return { certificado: forge.pki.certificateToPem(cert), clave: clavePem };
}

interface Autorizado {
  cae: string;
  caeVence: string;
  docNro: string;
  total: string;
  fecha: string;
}

const sobre = (metodo: string, resultado: string) =>
  `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>` +
  `<${metodo}Response xmlns="${NS}"><${metodo}Result>${resultado}</${metodo}Result></${metodo}Response></soap:Body></soap:Envelope>`;

const centavos = (v: string | null) => Math.round(Number(v ?? '0') * 100);

export class ArcaFalso {
  /** Último número autorizado por `pv|tipo`. */
  ultimos = new Map<string, number>();
  autorizados = new Map<string, Autorizado>();
  /** Documentos de receptor que va a rechazar (como si fueran inválidos). */
  rechazarDocs = new Set<string>();
  logins = 0;
  /** Contenido firmado de cada pedido de acceso (el TRA). */
  tras: string[] = [];
  pedidosCae: { pv: number; tipo: number; detalles: string[] }[] = [];
  private cae = 70000000000000;

  ultimo(pv: number, tipo: number): number {
    return this.ultimos.get(`${pv}|${tipo}`) ?? 0;
  }

  /** Como si otro sistema (o un intento anterior) ya hubiera autorizado ese número. */
  yaAutorizado(pv: number, tipo: number, numero: number, datos: Omit<Autorizado, 'cae' | 'caeVence'>): string {
    const cae = String(++this.cae);
    this.autorizados.set(`${pv}|${tipo}|${numero}`, { ...datos, cae, caeVence: '2099-12-31' });
    this.ultimos.set(`${pv}|${tipo}`, Math.max(this.ultimo(pv, tipo), numero));
    return cae;
  }

  transporte: Transporte = async (p: PedidoSoap): Promise<RespuestaSoap> => {
    if (p.accion === '') return this.wsaa(p.cuerpo);
    const metodo = p.accion.replace(NS, '');
    const c = p.cuerpo;
    if (metodo === 'FEDummy') return { status: 200, cuerpo: sobre(metodo, '<AppServer>OK</AppServer><DbServer>OK</DbServer><AuthServer>OK</AuthServer>') };
    if (texto(c, 'Token') !== 'TOKEN-PRUEBA') return { status: 200, cuerpo: sobre(metodo, '<Errors><Err><Code>600</Code><Msg>ValidacionDeToken: No validaron las credenciales</Msg></Err></Errors>') };

    if (metodo === 'FECompUltimoAutorizado') {
      const pv = Number(texto(c, 'PtoVta'));
      const tipo = Number(texto(c, 'CbteTipo'));
      return { status: 200, cuerpo: sobre(metodo, `<PtoVta>${pv}</PtoVta><CbteTipo>${tipo}</CbteTipo><CbteNro>${this.ultimo(pv, tipo)}</CbteNro>`) };
    }
    if (metodo === 'FECompConsultar') {
      const a = this.autorizados.get(`${texto(c, 'PtoVta')}|${texto(c, 'CbteTipo')}|${texto(c, 'CbteNro')}`);
      if (!a) return { status: 200, cuerpo: sobre(metodo, '<Errors><Err><Code>602</Code><Msg>No existen datos en nuestros registros</Msg></Err></Errors>') };
      return {
        status: 200,
        cuerpo: sobre(
          metodo,
          `<ResultGet><DocNro>${a.docNro}</DocNro><CbteFch>${a.fecha.replace(/-/g, '')}</CbteFch><ImpTotal>${a.total}</ImpTotal>` +
            `<Resultado>A</Resultado><CodAutorizacion>${a.cae}</CodAutorizacion><FchVto>${a.caeVence.replace(/-/g, '')}</FchVto></ResultGet>`,
        ),
      };
    }
    if (metodo === 'FECAESolicitar') return this.solicitar(c);
    return { status: 500, cuerpo: `<soap:Envelope><soap:Body><soap:Fault><faultcode>soap:Client</faultcode><faultstring>Método desconocido ${metodo}</faultstring></soap:Fault></soap:Body></soap:Envelope>` };
  };

  private wsaa(cuerpo: string): RespuestaSoap {
    this.logins += 1;
    const cms = texto(cuerpo, 'in0') ?? '';
    const p7 = forge.pkcs7.messageFromAsn1(forge.asn1.fromDer(forge.util.decode64(cms))) as forge.pkcs7.PkcsSignedData & {
      rawCapture?: { content?: { value?: { value?: unknown }[] } };
    };
    if (p7.certificates.length !== 1) throw new Error('El pedido de acceso tiene que llevar el certificado adentro');
    // En un SignedData leído, forge deja el contenido en rawCapture: [0] EXPLICIT → OCTET STRING(s).
    const bytes = (p7.rawCapture?.content?.value ?? []).map((o) => (typeof o.value === 'string' ? o.value : '')).join('');
    this.tras.push(forge.util.decodeUtf8(bytes));
    const vence = new Date(Date.now() + 12 * 3600_000).toISOString();
    const ticket = `<loginTicketResponse version="1.0"><header><expirationTime>${vence}</expirationTime></header><credentials><token>TOKEN-PRUEBA</token><sign>FIRMA-PRUEBA</sign></credentials></loginTicketResponse>`;
    return {
      status: 200,
      cuerpo: `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><loginCmsResponse><loginCmsReturn>${escapar(ticket)}</loginCmsReturn></loginCmsResponse></soapenv:Body></soapenv:Envelope>`,
    };
  }

  private solicitar(c: string): RespuestaSoap {
    const cab = todos(c, 'FeCabReq')[0] ?? '';
    const pv = Number(texto(cab, 'PtoVta'));
    const tipo = Number(texto(cab, 'CbteTipo'));
    const detalles = todos(c, 'FECAEDetRequest');
    this.pedidosCae.push({ pv, tipo, detalles });
    const respuestas = detalles.map((d) => {
      const numero = Number(texto(d, 'CbteDesde'));
      const obs: string[] = [];
      if (numero !== this.ultimo(pv, tipo) + 1) obs.push(`<Obs><Code>10016</Code><Msg>El numero de comprobante debe ser el siguiente al ultimo autorizado</Msg></Obs>`);
      if (this.rechazarDocs.has(texto(d, 'DocNro') ?? '')) obs.push(`<Obs><Code>10015</Code><Msg>Campo DocNro invalido</Msg></Obs>`);
      // Las sumas que controla ARCA.
      const total = centavos(texto(d, 'ImpTotal'));
      const partes = ['ImpTotConc', 'ImpNeto', 'ImpOpEx', 'ImpTrib', 'ImpIVA'].reduce((t, k) => t + centavos(texto(d, k)), 0);
      if (total !== partes) obs.push(`<Obs><Code>10048</Code><Msg>ImpTotal no coincide con la suma de los importes</Msg></Obs>`);
      const ivas = todos(d, 'AlicIva');
      if (ivas.reduce((t, a) => t + centavos(texto(a, 'Importe')), 0) !== centavos(texto(d, 'ImpIVA'))) obs.push(`<Obs><Code>10051</Code><Msg>ImpIVA no coincide con el detalle</Msg></Obs>`);
      if (ivas.reduce((t, a) => t + centavos(texto(a, 'BaseImp')), 0) !== centavos(texto(d, 'ImpNeto'))) obs.push(`<Obs><Code>10061</Code><Msg>ImpNeto no coincide con las bases de IVA</Msg></Obs>`);
      const tributos = todos(d, 'Tributo').reduce((t, x) => t + centavos(texto(x, 'Importe')), 0);
      if (tributos !== centavos(texto(d, 'ImpTrib'))) obs.push(`<Obs><Code>10062</Code><Msg>ImpTrib no coincide con el detalle</Msg></Obs>`);
      if (obs.length) return `<FECAEDetResponse><CbteDesde>${numero}</CbteDesde><Resultado>R</Resultado><Observaciones>${obs.join('')}</Observaciones><CAE></CAE><CAEFchVto></CAEFchVto></FECAEDetResponse>`;
      const fecha = texto(d, 'CbteFch')!;
      const cae = this.yaAutorizado(pv, tipo, numero, { docNro: texto(d, 'DocNro') ?? '0', total: texto(d, 'ImpTotal')!, fecha: `${fecha.slice(0, 4)}-${fecha.slice(4, 6)}-${fecha.slice(6)}` });
      return `<FECAEDetResponse><CbteDesde>${numero}</CbteDesde><CbteHasta>${numero}</CbteHasta><Resultado>A</Resultado><CAE>${cae}</CAE><CAEFchVto>20991231</CAEFchVto></FECAEDetResponse>`;
    });
    const resultado = respuestas.every((r) => r.includes('<Resultado>A')) ? 'A' : respuestas.some((r) => r.includes('<Resultado>A')) ? 'P' : 'R';
    return {
      status: 200,
      cuerpo: sobre('FECAESolicitar', `<FeCabResp><PtoVta>${pv}</PtoVta><CbteTipo>${tipo}</CbteTipo><Resultado>${resultado}</Resultado></FeCabResp><FeDetResp>${respuestas.join('')}</FeDetResp>`),
    };
  }
}
