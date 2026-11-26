import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { Op } from 'sequelize';
import { accesoSocioSchema, avanceTutorialesSchema, cooperativaActivaSchema, demoLoginSchema, loginSchema, mismoDocumento, SIN_TUTORIALES, subdominioSchema, type LoginContext, type Rol } from '../shared';
import { config } from '../config';
import { sequelize } from '../db';
import { Conexion, Cooperativa, RolUsuario, Socio, Usuario } from '../models';
import { writeAudit } from '../lib/audit';
import { runInCooperativa } from '../lib/context';
import { findCooperativaBySubdominio, subdominioOf, toCooperativaPublica } from '../lib/cooperativas';
import { conflict, HttpError, notFound, ok, parse, unauthorized } from '../lib/errors';
import { dummyHash, hashPassword, randomToken, verifyPassword } from '../lib/security';
import { buildMe, canSignIn, endSession, findUserForAuth, refreshSession, setActiveCooperativa, startSession } from '../lib/session';
// (findUserForAuth busca en todas las cooperativas: solo se usa con el email que la persona escribe para entrar)
import { authenticate, requireSuperadmin } from '../middlewares/auth';

export const authRouter = Router();

const limiter = (limit: number) =>
  rateLimit({
    windowMs: 15 * 60_000,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => config.isTest,
    handler: (_req, _res, next) =>
      next(new HttpError(429, 'Demasiados intentos. Probá de nuevo en unos minutos.', 'too_many_requests')),
  });
const loginLimiter = limiter(20);
const sessionLimiter = limiter(300);

/**
 * Cooperativa de la pantalla de ingreso: la del subdominio; si no hay, la que se pidió por
 * parámetro (solo en modo demo) o la cooperativa por defecto.
 */
async function loginCooperativa(req: Request, requested?: string): Promise<Cooperativa> {
  const sub = subdominioOf(req) ?? (config.demoMode ? requested : undefined) ?? config.cooperativaPorDefecto;
  const coop = await findCooperativaBySubdominio(sub);
  if (!coop || !coop.activa) throw notFound('No encontramos esa cooperativa');
  return coop;
}

const DEMO_ORDER: Rol[] = ['socio', 'operario', 'cajero', 'facturacion', 'gerencia', 'admin'];

/** Usuarios de prueba de una cooperativa, en el orden en que se crearon. */
function demoUsers(cooperativaId: number): Promise<Usuario[]> {
  return runInCooperativa(cooperativaId, () =>
    Usuario.findAll({
      where: { esDemo: true, activo: true },
      include: [{ model: RolUsuario, as: 'roles' }],
      order: [['id', 'ASC']],
    }),
  );
}

/** Datos para pintar la pantalla de ingreso: cooperativa, tema y opciones de demo. */
authRouter.get('/context', async (req, res) => {
  const requested = subdominioSchema.safeParse(req.query.coop);
  const coop = await loginCooperativa(req, requested.success ? requested.data : undefined);
  // Los botones de la demo: solo con DEMO_ACCESO_RAPIDO. Sin ellos, los usuarios de prueba entran con su contraseña.
  const botones = config.demoMode && config.demoAccesoRapido;
  const demo: LoginContext['demo'] = { activo: botones, opciones: [], cooperativas: [] };

  if (botones) {
    const users = await demoUsers(coop.id);
    for (const rol of DEMO_ORDER) {
      const user = users.find((u) => u.rolesList.includes(rol));
      if (user) demo.opciones.push({ rol, nombre: user.nombre });
    }
    // Si la dirección ya fija la cooperativa, no se ofrece cambiarla.
    if (!subdominioOf(req)) {
      const all = await Cooperativa.findAll({ where: { activa: true }, order: [['id', 'ASC']] });
      demo.cooperativas = all.map((c) => ({ subdominio: c.subdominio, nombreCorto: c.nombreCorto }));
    }
  }

  const body: LoginContext = { cooperativa: toCooperativaPublica(coop), demo };
  ok(res, body);
});

authRouter.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = parse(loginSchema, req.body);
  // Con email y contraseña entra el personal. El socio no tiene contraseña: entra por /acceso-socio.
  const user = email.includes('@') ? await findUserForAuth({ email: email.toLowerCase() }) : null;
  const passwordOk = await verifyPassword(password, user?.hash ?? (await dummyHash()));
  // Un solo mensaje para todos los casos: no se revela si el usuario existe o está desactivado.
  if (!user || !passwordOk || !(await canSignIn(user, req))) throw unauthorized('El email o la contraseña no son correctos', 'invalid_credentials');
  ok(res, await buildMe(await startSession(user, req, res)));
});

/** «Benítez, Marta» → «Marta Benítez» (así lo saluda la app). Las razones sociales quedan como están. */
const nombreParaUsuario = (nombre: string) => {
  const [apellido, nombres] = nombre.split(',').map((p) => p.trim());
  return nombres ? `${nombres} ${apellido}` : nombre;
};

/**
 * Ingreso del socio, sin usuario ni contraseña: código de socio, número de una de sus conexiones y
 * su documento (los tres están en la factura). Mismo mensaje para cualquier dato que no coincida:
 * no se revela cuál está mal ni si ese socio existe. Pocos intentos por conexión de internet.
 * La primera vez se le arma su usuario por dentro, para que tenga sesión como cualquier otro.
 */
authRouter.post('/acceso-socio', limiter(15), async (req, res) => {
  const d = parse(accesoSocioSchema, req.body);
  const coop = await loginCooperativa(req, d.cooperativa);
  const noCoincide = new HttpError(401, 'Esos datos no coinciden con los de la cooperativa. Están en tu factura: revisalos y probá de nuevo.', 'datos_no_coinciden');

  const usuarioId = await runInCooperativa(coop.id, async () => {
    const socio = await Socio.findOne({ where: { numero: d.socio, estado: 'activo' } });
    const conexion = socio ? await Conexion.findOne({ where: { socioId: socio.id, numero: d.conexion } }) : null;
    if (!socio || !conexion || !mismoDocumento(socio.nroDoc, d.documento)) throw noCoincide;
    if (socio.usuarioId) return socio.usuarioId;

    return sequelize.transaction(async (transaction) => {
      // La contraseña es un valor al azar que nadie conoce: este usuario solo entra por acá.
      const nuevo = await Usuario.create({ email: null, nombre: nombreParaUsuario(socio.nombre), hash: await hashPassword(randomToken()) }, { transaction });
      await RolUsuario.create({ usuarioId: nuevo.id, rol: 'socio' }, { transaction });
      // Si en el medio otro pedido ya lo vinculó, se usa ese y este se descarta.
      const [vinculados] = await Socio.update({ usuarioId: nuevo.id }, { where: { id: socio.id, usuarioId: { [Op.is]: null } }, transaction });
      if (vinculados !== 1) throw conflict('Probá de nuevo en un momento.');
      await writeAudit({ accion: 'crear_cuenta_socio', entidad: 'socio', entidadId: socio.id, usuarioId: nuevo.id, despues: { usuarioId: nuevo.id }, transaction });
      return nuevo.id;
    });
  });
  const user = await findUserForAuth({ id: usuarioId });
  if (!user || !(await canSignIn(user, req))) throw noCoincide;
  ok(res, await buildMe(await startSession(user, req, res)));
});

/** Modo demo: entra con el usuario de prueba de ese rol, sin contraseña. */
authRouter.post('/demo', sessionLimiter, async (req, res) => {
  if (!config.demoMode || !config.demoAccesoRapido) throw notFound();
  const { rol, cooperativa } = parse(demoLoginSchema, req.body);
  const coop = await loginCooperativa(req, cooperativa);
  const user = (await demoUsers(coop.id)).find((u) => u.rolesList.includes(rol));
  if (!user || !(await canSignIn(user, req))) throw notFound('No hay un usuario de prueba para ese rol');
  ok(res, await buildMe(await startSession(user, req, res)));
});

authRouter.post('/refresh', sessionLimiter, async (req, res) => {
  ok(res, await buildMe(await refreshSession(req, res)));
});

authRouter.post('/logout', async (req, res) => {
  await endSession(req, res);
  ok(res, { ok: true });
});

authRouter.get('/me', authenticate, async (req, res) => {
  ok(res, await buildMe(req.auth!));
});

/**
 * Tutoriales con Solvix: cuáles hizo y cuáles omitió quien está usando la app. Se guarda en su
 * cuenta para que la presentación no se repita en cada dispositivo.
 */
authRouter.get('/tutoriales', authenticate, async (req, res) => {
  const user = await Usuario.findByPk(req.auth!.userId, { attributes: ['id', 'tutorialesJson'] });
  ok(res, user?.tutorialesJson ?? SIN_TUTORIALES);
});

authRouter.put('/tutoriales', authenticate, async (req, res) => {
  const avance = parse(avanceTutorialesSchema, req.body);
  await Usuario.update({ tutorialesJson: avance }, { where: { id: req.auth!.userId } });
  ok(res, avance);
});

/** El superadmin entra a una cooperativa (o sale, con `null`). */
authRouter.post('/cooperativa', authenticate, requireSuperadmin, async (req, res) => {
  const { cooperativaId } = parse(cooperativaActivaSchema, req.body);
  if (cooperativaId != null && !(await Cooperativa.findByPk(cooperativaId))) {
    throw notFound('No encontramos esa cooperativa');
  }
  ok(res, await buildMe(await setActiveCooperativa(req.auth!, cooperativaId, res)));
});
