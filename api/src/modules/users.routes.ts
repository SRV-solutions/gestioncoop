import { Router } from 'express';
import { sortRoles, type UsuarioListado } from '../shared';
import { RolUsuario, Usuario } from '../models';
import { idParam, notFound, ok } from '../lib/errors';
import { requireRole } from '../middlewares/auth';

export const usersRouter = Router();
usersRouter.use(requireRole('admin'));

const WITH_ROLES = { model: RolUsuario, as: 'roles' } as const;

function toListado(u: Usuario): UsuarioListado {
  return {
    id: u.id,
    nombre: u.nombre,
    email: u.email,
    roles: sortRoles(u.rolesList),
    activo: u.activo,
    esDemo: u.esDemo,
    ultimoIngresoEl: u.ultimoIngresoEl ? u.ultimoIngresoEl.toISOString() : null,
  };
}

// Ninguna de estas consultas filtra por cooperativa a mano: lo hace el modelo (lib/tenant.ts).

usersRouter.get('/', async (_req, res) => {
  const users = await Usuario.findAll({ include: [WITH_ROLES], order: [['nombre', 'ASC']] });
  ok(res, users.map(toListado));
});

usersRouter.get('/:id', async (req, res) => {
  const user = await Usuario.findByPk(idParam(req), { include: [WITH_ROLES] });
  if (!user) throw notFound('No encontramos ese usuario');
  ok(res, toListado(user));
});
