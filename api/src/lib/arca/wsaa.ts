// WSAA: el permiso de acceso de ARCA. Se arma un pedido (TRA), se firma con el certificado de la
// cooperativa (CMS/PKCS#7, con el certificado adentro) y ARCA devuelve un token y una firma que valen
// unas 12 horas. Mientras siga vigente, ARCA no entrega otro: hay que guardarlo y reutilizarlo.
import { createPrivateKey, X509Certificate } from 'node:crypto';
import forge from 'node-forge';
import { URLS, type AmbienteArca } from './codigos';
import { ErrorArca, llamarSoap, type Transporte } from './transporte';
import { texto } from './xml';

export interface TicketAcceso {
  token: string;
  sign: string;
  vence: Date;
}

/** Fecha con la zona de Argentina, como la muestran los ejemplos de ARCA: 2026-11-26T03:00:00-03:00. */
function fechaArgentina(d: Date): string {
  const local = new Date(d.getTime() - 3 * 3600_000);
  return `${local.toISOString().slice(0, 19)}-03:00`;
}

/** El pedido de acceso para un servicio (`wsfe`), válido 10 minutos para cada lado de ahora. */
export function armarTra(servicio: string, ahora = new Date()): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?><loginTicketRequest version="1.0"><header>` +
    `<uniqueId>${Math.floor(ahora.getTime() / 1000)}</uniqueId>` +
    `<generationTime>${fechaArgentina(new Date(ahora.getTime() - 10 * 60_000))}</generationTime>` +
    `<expirationTime>${fechaArgentina(new Date(ahora.getTime() + 10 * 60_000))}</expirationTime>` +
    `</header><service>${servicio}</service></loginTicketRequest>`
  );
}

/** Lo que se puede leer del certificado y si la clave le corresponde. Falla con un mensaje claro. */
export function leerCertificado(certificadoPem: string, clavePem: string): { titular: string; vence: string; clavePkcs1: string } {
  let x509: X509Certificate;
  try {
    x509 = new X509Certificate(certificadoPem);
  } catch {
    throw new ErrorArca('No pudimos leer el certificado. Tiene que ser el archivo .crt (o .pem) que descargaste de ARCA.');
  }
  let clave;
  try {
    clave = createPrivateKey(clavePem);
  } catch {
    throw new ErrorArca('No pudimos leer la clave privada. Tiene que ser el archivo .key sin contraseña, el mismo con el que se pidió el certificado.');
  }
  if (!x509.checkPrivateKey(clave)) throw new ErrorArca('La clave privada no corresponde a ese certificado. Revisá que sean del mismo pedido.');
  return {
    // «C=AR, O=..., CN=gestioncoop, serialNumber=CUIT 30610990890»
    titular: x509.subject.replace(/\n/g, ', ').slice(0, 200),
    vence: new Date(x509.validTo).toISOString().slice(0, 10),
    clavePkcs1: clave.export({ type: 'pkcs1', format: 'pem' }).toString(),
  };
}

/** Firma el pedido de acceso: CMS con el contenido adentro, SHA-256 y el certificado incluido. Base64. */
export function firmarTra(tra: string, certificadoPem: string, clavePem: string): string {
  const { clavePkcs1 } = leerCertificado(certificadoPem, clavePem);
  const certificado = forge.pki.certificateFromPem(certificadoPem);
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(tra, 'utf8');
  p7.addCertificate(certificado);
  p7.addSigner({
    key: forge.pki.privateKeyFromPem(clavePkcs1),
    certificate: certificado,
    digestAlgorithm: forge.pki.oids.sha256!,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType!, value: forge.pki.oids.data! },
      { type: forge.pki.oids.messageDigest! },
      { type: forge.pki.oids.signingTime!, value: new Date() as unknown as string },
    ],
  });
  p7.sign();
  return forge.util.encode64(forge.asn1.toDer(p7.toAsn1()).getBytes());
}

/** Lo que dicen los errores más comunes de WSAA, en palabras que se entiendan. */
function explicar(codigo: string | null, mensaje: string): string {
  const c = (codigo ?? '').toLowerCase();
  if (c.includes('alreadyauthenticated'))
    return 'ARCA ya entregó un permiso de acceso que sigue vigente y no lo tenemos guardado. Dura hasta 12 horas: esperá a que venza y probá de nuevo.';
  if (c.includes('cert.untrusted') || c.includes('cms.cert'))
    return 'ARCA no reconoce el certificado. Revisá que sea del ambiente elegido (el de homologación no sirve en producción, ni al revés) y que no esté vencido.';
  if (c.includes('notauthorized')) return 'El certificado no está autorizado para la factura electrónica. En ARCA hay que asociarlo al servicio «wsfe».';
  if (c.includes('expired')) return 'El certificado está vencido. Hay que generar uno nuevo en ARCA.';
  return mensaje;
}

/** Pide un permiso de acceso nuevo. */
export async function pedirAcceso(o: { transporte: Transporte; ambiente: AmbienteArca; certificado: string; clave: string; servicio?: string }): Promise<TicketAcceso> {
  const cms = firmarTra(armarTra(o.servicio ?? 'wsfe'), o.certificado, o.clave);
  const sobre =
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">` +
    `<soapenv:Header/><soapenv:Body><wsaa:loginCms><wsaa:in0>${cms}</wsaa:in0></wsaa:loginCms></soapenv:Body></soapenv:Envelope>`;
  let respuesta: string;
  try {
    respuesta = await llamarSoap(o.transporte, { url: URLS[o.ambiente].wsaa, accion: '', cuerpo: sobre });
  } catch (err) {
    if (err instanceof ErrorArca) throw new ErrorArca(explicar(err.codigo, err.message), err.codigo);
    throw err;
  }
  const ticket = texto(respuesta, 'loginCmsReturn');
  const token = ticket && texto(ticket, 'token');
  const sign = ticket && texto(ticket, 'sign');
  const vence = ticket && texto(ticket, 'expirationTime');
  if (!token || !sign || !vence) throw new ErrorArca('ARCA respondió el pedido de acceso sin el permiso. Probá de nuevo en unos minutos.');
  return { token, sign, vence: new Date(vence) };
}
