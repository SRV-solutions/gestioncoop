import { AsyncLocalStorage } from 'node:async_hooks';
import type { Rol } from '../shared';

/**
 * Contexto del pedido en curso: quién lo hace y sobre qué cooperativa. Viaja solo por toda la
 * cadena async, así los modelos filtran por cooperativa sin que cada consulta tenga que acordarse
 * (ver lib/tenant.ts) y la auditoría sabe quién fue.
 */
export interface RequestContext {
  userId: number | null;
  ip: string | null;
  roles: Rol[];
  /** Cooperativa sobre la que se opera. `null` = ninguna (los modelos de negocio rechazan el pedido). */
  cooperativaId: number | null;
  /** Solo para código del sistema (login, seed, superadmin): desactiva el filtro por cooperativa. */
  unscoped: boolean;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

/** Contexto actual, o `undefined` si el código corre fuera de un pedido (scripts, tests). */
export function currentContext(): RequestContext | undefined {
  return requestContext.getStore();
}

function derive(overrides: Pick<RequestContext, 'cooperativaId' | 'unscoped'>): RequestContext {
  const now = requestContext.getStore();
  return { userId: now?.userId ?? null, ip: now?.ip ?? null, roles: now?.roles ?? [], ...overrides };
}

/** Ejecuta `fn` como si el pedido fuera de la cooperativa indicada. */
export function runInCooperativa<T>(cooperativaId: number, fn: () => T): T {
  return requestContext.run(derive({ cooperativaId, unscoped: false }), fn);
}

/**
 * Ejecuta `fn` sin filtro de cooperativa. Solo para código del sistema que necesita ver todas
 * (login por email, seed, panel del superadmin). Nunca dejar que un dato que manda el usuario
 * decida qué se consulta acá adentro.
 */
export function runUnscoped<T>(fn: () => T): T {
  return requestContext.run(derive({ cooperativaId: requestContext.getStore()?.cooperativaId ?? null, unscoped: true }), fn);
}
