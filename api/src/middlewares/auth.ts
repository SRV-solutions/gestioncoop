import type { RequestHandler } from 'express';
import type { Rol } from '../shared';
import { config } from '../config';
import { currentContext } from '../lib/context';
import { findCooperativaBySubdominio, subdominioOf } from '../lib/cooperativas';
import { forbidden, HttpError, unauthorized } from '../lib/errors';
import { ACCESS_COOKIE, verifyAccess, type AuthInfo } from '../lib/session';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthInfo;
    }
  }
}

/**
 * Verifica el token de acceso (cookie httpOnly) y fija la cooperativa del pedido.
 * Desde acá, todo modelo de negocio queda filtrado por la cooperativa del usuario.
 */
export const authenticate: RequestHandler = async (req, _res, next) => {
  const token: unknown = req.cookies?.[ACCESS_COOKIE];
  const auth = typeof token === 'string' ? verifyAccess(token) : null;
  // Con 'token_expired' el client renueva la sesión solo; si no puede, manda al ingreso.
  if (!auth) throw unauthorized('Tu sesión venció. Ingresá de nuevo.', 'token_expired');

  // Si la dirección es la de una cooperativa, la sesión tiene que ser de esa cooperativa.
  const sub = subdominioOf(req);
  if (sub && !auth.roles.includes('superadmin')) {
    const coop = await findCooperativaBySubdominio(sub);
    if (!coop || coop.id !== auth.cooperativaId) throw forbidden();
  }

  req.auth = auth;
  const ctx = currentContext();
  if (ctx) {
    ctx.userId = auth.userId;
    ctx.roles = auth.roles;
    ctx.cooperativaId = auth.cooperativaId;
  }
  next();
};

/**
 * Deja pasar solo a quien tenga alguno de los roles. Va después de `authenticate`.
 * El superadmin (soporte del proveedor) pasa siempre, pero queda limitado a la cooperativa que
 * eligió: sin cooperativa activa los modelos de negocio rechazan el pedido.
 */
export function requireRole(...roles: Rol[]): RequestHandler {
  return (req, _res, next) => {
    const own = req.auth?.roles ?? [];
    if (!own.includes('superadmin') && !roles.some((r) => own.includes(r))) throw forbidden();
    next();
  };
}

/** Solo el proveedor. */
export const requireSuperadmin: RequestHandler = (req, _res, next) => {
  if (!req.auth?.roles.includes('superadmin')) throw forbidden();
  next();
};

/**
 * Defensa contra pedidos armados desde otro sitio (CSRF): toda escritura que venga de un
 * navegador tiene que salir de nuestra propia dirección. Se suma a las cookies SameSite=Lax.
 */
export const checkOrigin: RequestHandler = (req, _res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (!origin) return next(); // los clientes que no son navegadores no mandan cookies ajenas
  let host = '';
  try {
    host = new URL(origin).host.toLowerCase();
  } catch {
    /* origen ilegible: se rechaza abajo */
  }
  const allowed =
    host !== '' &&
    (host === new URL(config.appUrl).host ||
      host === req.get('host')?.toLowerCase() ||
      (config.dominioBase != null && host.endsWith(`.${config.dominioBase}`)));
  if (!allowed) throw new HttpError(403, 'No pudimos procesar el pedido', 'bad_origin');
  next();
};
