import type { CookieOptions, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { ROLES, sortRoles, type Me, type Rol } from '../shared';
import { config } from '../config';
import { RolUsuario, Sesion, Usuario } from '../models';
import { writeAudit } from './audit';
import { runUnscoped } from './context';
import { findCooperativaById, findCooperativaBySubdominio, subdominioOf, toCooperativaPublica } from './cooperativas';
import { unauthorized } from './errors';
import { randomToken, safeEqualHex, sha256 } from './security';

export const ACCESS_COOKIE = 'cg_access';
export const REFRESH_COOKIE = 'cg_refresh';
const REFRESH_PATH = '/api/v1/auth';

/** Lo que viaja firmado en el token de acceso. */
export interface AuthInfo {
  userId: number;
  /** Cooperativa sobre la que opera (para el superadmin, la que eligió; puede ser null). */
  cooperativaId: number | null;
  roles: Rol[];
  sessionId: string;
}

const WITH_ROLES = { model: RolUsuario, as: 'roles' } as const;

/* ───────────────────────── Tokens y cookies ───────────────────────── */

export function signAccess(auth: AuthInfo): string {
  return jwt.sign({ coop: auth.cooperativaId, roles: auth.roles, sid: auth.sessionId }, config.jwtSecret, {
    algorithm: 'HS256',
    subject: String(auth.userId),
    expiresIn: config.accessTokenMinutes * 60,
  });
}

export function verifyAccess(token: string): AuthInfo | null {
  try {
    const p = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    if (typeof p === 'string') return null;
    const userId = Number(p.sub);
    const coop: unknown = p.coop;
    if (!Number.isInteger(userId) || typeof p.sid !== 'string') return null;
    if (coop !== null && !Number.isInteger(coop)) return null;
    const roles = Array.isArray(p.roles) ? (p.roles as unknown[]).filter((r): r is Rol => ROLES.includes(r as Rol)) : [];
    return { userId, cooperativaId: coop as number | null, roles, sessionId: p.sid };
  } catch {
    return null;
  }
}

const cookieBase = (): CookieOptions => ({ httpOnly: true, sameSite: 'lax', secure: config.isProd });

function setAccessCookie(res: Response, auth: AuthInfo): void {
  res.cookie(ACCESS_COOKIE, signAccess(auth), { ...cookieBase(), path: '/', maxAge: config.accessTokenMinutes * 60_000 });
}

/** Días que dura la sesión sin usarse: 90 para quien solo es socio, 30 para el personal. */
export const diasDeSesion = (roles: readonly Rol[]) => (roles.length > 0 && roles.every((r) => r === 'socio') ? config.refreshTokenDaysSocio : config.refreshTokenDays);

function setRefreshCookie(res: Response, sessionId: string, token: string, dias: number): void {
  // Solo se manda a /auth: el resto de la API nunca ve el token de renovación.
  res.cookie(REFRESH_COOKIE, `${sessionId}.${token}`, {
    ...cookieBase(),
    path: REFRESH_PATH,
    maxAge: dias * 86_400_000,
  });
}

function clearCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, { ...cookieBase(), path: '/' });
  res.clearCookie(REFRESH_COOKIE, { ...cookieBase(), path: REFRESH_PATH });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readRefreshCookie(req: Request): { sessionId: string; token: string } | null {
  const raw: unknown = req.cookies?.[REFRESH_COOKIE];
  if (typeof raw !== 'string') return null;
  const cut = raw.indexOf('.');
  if (cut < 0) return null;
  const sessionId = raw.slice(0, cut);
  const token = raw.slice(cut + 1);
  return UUID.test(sessionId) && token.length >= 20 && token.length <= 200 ? { sessionId, token } : null;
}

const refreshExpiry = (dias: number) => new Date(Date.now() + dias * 86_400_000);

/* ───────────────────────── Reglas de acceso ───────────────────────── */

/** Busca un usuario con sus roles, de cualquier cooperativa (código del sistema). */
export function findUserForAuth(where: { id: number } | { email: string }): Promise<Usuario | null> {
  return runUnscoped(() => Usuario.findOne({ where, include: [WITH_ROLES] }));
}

/** Lo que tiene que cumplir un usuario para tener sesión. */
export async function canSignIn(user: Usuario, req: Request): Promise<boolean> {
  if (!user.activo || user.rolesList.length === 0) return false;
  if (user.esDemo && !config.demoMode) return false;
  const isSuperadmin = user.rolesList.includes('superadmin');
  if (user.cooperativaId == null) return isSuperadmin;
  const coop = await findCooperativaById(user.cooperativaId);
  if (!coop?.activa) return false;
  // Si la dirección es la de una cooperativa, solo entra su gente (o el superadmin).
  const sub = subdominioOf(req);
  if (sub && !isSuperadmin) {
    const fromAddress = await findCooperativaBySubdominio(sub);
    if (!fromAddress || fromAddress.id !== user.cooperativaId) return false;
  }
  return true;
}

/* ───────────────────────── Ciclo de vida de la sesión ───────────────────────── */

export async function startSession(user: Usuario, req: Request, res: Response): Promise<AuthInfo> {
  const token = randomToken();
  const dias = diasDeSesion(user.rolesList);
  const session = await Sesion.create({
    usuarioId: user.id,
    tokenHash: sha256(token),
    cooperativaActivaId: null,
    expiraEl: refreshExpiry(dias),
    userAgent: req.get('user-agent')?.slice(0, 300) ?? null,
    ip: req.ip?.slice(0, 64) ?? null,
  });
  const auth: AuthInfo = {
    userId: user.id,
    cooperativaId: user.cooperativaId,
    roles: user.rolesList,
    sessionId: session.id,
  };
  setAccessCookie(res, auth);
  setRefreshCookie(res, session.id, token, dias);
  await runUnscoped(() => user.update({ ultimoIngresoEl: new Date() }));
  await writeAudit({
    accion: 'ingresar',
    entidad: 'usuario',
    entidadId: user.id,
    cooperativaId: user.cooperativaId,
    usuarioId: user.id,
  });
  return auth;
}

/**
 * Renueva el token de acceso. Roles y cooperativa se releen de la base, así un cambio de
 * permisos (o desactivar a alguien) rige como mucho a los 15 minutos. Cada uso vuelve a contar el
 * plazo entero (30 días el personal, 90 el socio).
 */
export async function refreshSession(req: Request, res: Response): Promise<AuthInfo> {
  const cookie = readRefreshCookie(req);
  if (!cookie) throw unauthorized();

  const session = await Sesion.findByPk(cookie.sessionId);
  const valid =
    session != null &&
    session.revocadaEl == null &&
    session.expiraEl.getTime() > Date.now() &&
    safeEqualHex(session.tokenHash, sha256(cookie.token));
  if (!session || !valid) {
    clearCookies(res);
    throw unauthorized();
  }

  const user = await findUserForAuth({ id: session.usuarioId });
  if (!user || !(await canSignIn(user, req))) {
    await session.update({ revocadaEl: new Date() });
    clearCookies(res);
    throw unauthorized();
  }

  const auth: AuthInfo = {
    userId: user.id,
    cooperativaId: user.rolesList.includes('superadmin') ? session.cooperativaActivaId : user.cooperativaId,
    roles: user.rolesList,
    sessionId: session.id,
  };
  const dias = diasDeSesion(user.rolesList);
  await session.update({ usadoEl: new Date(), expiraEl: refreshExpiry(dias) });
  setAccessCookie(res, auth);
  setRefreshCookie(res, session.id, cookie.token, dias);
  return auth;
}

export async function endSession(req: Request, res: Response): Promise<void> {
  const cookie = readRefreshCookie(req);
  if (cookie) {
    await Sesion.update(
      { revocadaEl: new Date() },
      { where: { id: cookie.sessionId, tokenHash: sha256(cookie.token), revocadaEl: null } },
    );
  }
  clearCookies(res);
}

/** El superadmin elige en qué cooperativa trabajar (o vuelve a su panel con `null`). */
export async function setActiveCooperativa(auth: AuthInfo, cooperativaId: number | null, res: Response): Promise<AuthInfo> {
  await Sesion.update({ cooperativaActivaId: cooperativaId }, { where: { id: auth.sessionId, usuarioId: auth.userId } });
  const next: AuthInfo = { ...auth, cooperativaId };
  setAccessCookie(res, next);
  await writeAudit({
    accion: 'elegir_cooperativa',
    entidad: 'cooperativa',
    entidadId: cooperativaId,
    cooperativaId,
    usuarioId: auth.userId,
  });
  return next;
}

/** Arma la respuesta de "quién soy" para el client. */
export async function buildMe(auth: AuthInfo): Promise<Me> {
  const user = await findUserForAuth({ id: auth.userId });
  if (!user || !user.activo) throw unauthorized();
  const coop = auth.cooperativaId != null ? await findCooperativaById(auth.cooperativaId) : null;
  return {
    user: { id: user.id, nombre: user.nombre, email: user.email, roles: sortRoles(user.rolesList), esDemo: user.esDemo },
    cooperativa: coop ? toCooperativaPublica(coop) : null,
  };
}
