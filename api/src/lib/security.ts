import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import argon2 from 'argon2';

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

let dummy: Promise<string> | null = null;
/**
 * Hash de mentira para verificar cuando el usuario no existe: así el login tarda lo mismo
 * exista o no el email, y no se puede averiguar quién tiene cuenta midiendo el tiempo.
 */
export function dummyHash(): Promise<string> {
  dummy ??= hashPassword('sin-usuario');
  return dummy;
}

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
