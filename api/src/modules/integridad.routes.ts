// Integridad de los datos: el estado de la cadena de la cooperativa, verificar ahora y el detalle de una
// verificación. Lo ven la administración, la gerencia y SRV.
import { Router } from 'express';
import type { EstadoIntegridad, VerificacionVista } from '../shared';
import { Usuario, VerificacionIntegridad } from '../models';
import { idParam, notFound, ok } from '../lib/errors';
import { lanzarVerificacion, proximaVerificacion } from '../lib/integridad';
import { requireRole } from '../middlewares/auth';

export const integridadRouter = Router();
integridadRouter.use(requireRole('admin', 'gerencia'));

const CON_USUARIO = { model: Usuario, as: 'usuario', attributes: ['nombre'] };

function vista(v: VerificacionIntegridad): VerificacionVista {
  return {
    id: v.id,
    origen: v.origen,
    estado: v.estado,
    iniciadaEl: v.iniciadaEl.toISOString(),
    terminadaEl: v.terminadaEl?.toISOString() ?? null,
    usuario: v.usuario?.nombre ?? null,
    resumen: v.resumenJson ?? null,
    totalProblemas: v.problemasJson?.total ?? 0,
    problemas: v.problemasJson?.lista ?? [],
    error: v.error ?? null,
  };
}

integridadRouter.get('/', async (_req, res) => {
  const recientes = await VerificacionIntegridad.findAll({ include: [CON_USUARIO], order: [['iniciadaEl', 'DESC'], ['id', 'DESC']], limit: 11 });
  const [ultima, ...anteriores] = recientes;
  const body: EstadoIntegridad = {
    ultima: ultima ? vista(ultima) : null,
    historial: anteriores.map((v) => {
      const { problemas: _p, ...resto } = vista(v);
      return resto;
    }),
    proximaAutomatica: proximaVerificacion()?.toISOString() ?? null,
  };
  ok(res, body);
});

/** Verificar ahora: corre en segundo plano y la pantalla consulta cómo va. */
integridadRouter.post('/verificar', async (req, res) => {
  const v = await lanzarVerificacion('manual', req.auth!.userId);
  ok(res, vista(v), 202);
});

integridadRouter.get('/verificaciones/:id', async (req, res) => {
  const v = await VerificacionIntegridad.findByPk(idParam(req), { include: [CON_USUARIO] });
  if (!v) throw notFound('No encontramos esa verificación');
  ok(res, vista(v));
});
