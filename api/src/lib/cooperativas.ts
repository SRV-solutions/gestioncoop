import type { Request } from 'express';
import type { CooperativaPublica } from '../shared';
import { config } from '../config';
import { Cooperativa } from '../models';

export function toCooperativaPublica(c: Cooperativa): CooperativaPublica {
  return {
    id: c.id,
    nombre: c.nombre,
    nombreCorto: c.nombreCorto,
    subdominio: c.subdominio,
    localidad: c.configJson.localidad ?? null,
    tema: c.temaJson,
    servicios: c.configJson.servicios ?? [],
  };
}

const RESERVED = new Set(['www', 'app', 'api']);

/**
 * Subdominio de cooperativa que trae la dirección del pedido (`dosdemayo.<DOMINIO_BASE>`),
 * o `null` si la app se abrió por la dirección general.
 */
export function subdominioOf(req: Request): string | null {
  const base = config.dominioBase;
  if (!base) return null;
  const host = req.hostname.toLowerCase();
  if (!host.endsWith(`.${base}`)) return null;
  const sub = host.slice(0, -(base.length + 1));
  return !sub || sub.includes('.') || RESERVED.has(sub) ? null : sub;
}

// Las cooperativas cambian muy poco y se consultan en casi todos los pedidos: caché corto en memoria.
const TTL_MS = 30_000;
const cache = new Map<string, { expires: number; value: Cooperativa | null }>();

export function clearCooperativaCache(): void {
  cache.clear();
}

async function cached(key: string, load: () => Promise<Cooperativa | null>): Promise<Cooperativa | null> {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = await load();
  cache.set(key, { expires: Date.now() + TTL_MS, value });
  return value;
}

export const findCooperativaBySubdominio = (subdominio: string) =>
  cached(`s:${subdominio}`, () => Cooperativa.findOne({ where: { subdominio } }));

export const findCooperativaById = (id: number) => cached(`i:${id}`, () => Cooperativa.findByPk(id));
