// Cifrado de secretos que se guardan en la base: la clave privada del certificado de ARCA de cada
// cooperativa y el permiso de acceso que entrega ARCA. AES-256-GCM con CLAVE_CIFRADO, que no está en la
// base: quien solo tenga acceso a la base no puede leerlos.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { config } from '../config';

const VERSION = 'v1';
const clave = () => createHash('sha256').update(config.claveCifrado).digest();

export function cifrar(texto: string): string {
  const iv = randomBytes(12);
  const cifrador = createCipheriv('aes-256-gcm', clave(), iv);
  const cuerpo = Buffer.concat([cifrador.update(texto, 'utf8'), cifrador.final()]);
  return `${VERSION}:${Buffer.concat([iv, cifrador.getAuthTag(), cuerpo]).toString('base64')}`;
}

/** Falla si el texto fue alterado o se cifró con otra clave. */
export function descifrar(cifrado: string): string {
  const [version, datos] = cifrado.split(':');
  if (version !== VERSION || !datos) throw new Error('Formato de cifrado desconocido');
  const b = Buffer.from(datos, 'base64');
  const descifrador = createDecipheriv('aes-256-gcm', clave(), b.subarray(0, 12));
  descifrador.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([descifrador.update(b.subarray(28)), descifrador.final()]).toString('utf8');
}
