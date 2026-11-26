// La campana de la app: las alertas de quien está usando la app. Para la gente de SRV, las de todas
// las cooperativas. Cada persona ve solo las suyas.
import { Router } from 'express';
import { Op } from 'sequelize';
import type { AlertaVista, BandejaAlertas } from '../shared';
import { Alerta, Cooperativa } from '../models';
import { runUnscoped } from '../lib/context';
import { idParam, notFound, ok } from '../lib/errors';

export const alertasRouter = Router();

// Son las filas de quien pregunta (sale de su sesión): sin filtro de cooperativa, así le llegan también
// a SRV, que no pertenece a ninguna.
const mias = <T>(fn: () => T) => runUnscoped(fn);

function vista(a: Alerta): AlertaVista {
  return {
    id: a.id,
    tipo: a.tipo,
    titulo: a.titulo,
    cuerpo: a.cuerpo,
    enlace: a.enlace ?? null,
    leida: a.leidaEl !== null,
    creadaEl: a.creadoEl.toISOString(),
    cooperativa: { id: a.cooperativaId, nombreCorto: a.cooperativa?.nombreCorto ?? '' },
    correo: a.correoEstado,
  };
}

alertasRouter.get('/', async (req, res) => {
  const usuarioId = req.auth!.userId;
  const [alertas, sinLeer] = await mias(() =>
    Promise.all([
      Alerta.findAll({ where: { usuarioId }, include: [{ model: Cooperativa, as: 'cooperativa', attributes: ['nombreCorto'] }], order: [['creadoEl', 'DESC'], ['id', 'DESC']], limit: 30 }),
      Alerta.count({ where: { usuarioId, leidaEl: { [Op.is]: null } } }),
    ]),
  );
  const body: BandejaAlertas = { alertas: alertas.map(vista), sinLeer };
  ok(res, body);
});

alertasRouter.post('/leer-todas', async (req, res) => {
  await mias(() => Alerta.update({ leidaEl: new Date() }, { where: { usuarioId: req.auth!.userId, leidaEl: { [Op.is]: null } } }));
  ok(res, { ok: true });
});

alertasRouter.post('/:id/leida', async (req, res) => {
  const [cambiadas] = await mias(() => Alerta.update({ leidaEl: new Date() }, { where: { id: idParam(req), usuarioId: req.auth!.userId, leidaEl: { [Op.is]: null } } }));
  if (cambiadas === 0) {
    const existe = await mias(() => Alerta.count({ where: { id: idParam(req), usuarioId: req.auth!.userId } }));
    if (!existe) throw notFound('No encontramos esa alerta');
  }
  ok(res, { ok: true });
});
