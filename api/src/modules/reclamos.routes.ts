// Reclamos y cortes programados desde la oficina (SPEC 6.8). Administración atiende (asigna,
// avanza, resuelve, carga cortes); gerencia mira.
import { Router } from 'express';
import { Op, QueryTypes } from 'sequelize';
import {
  cambioEstadoSchema,
  corteSchema,
  ESTADOS_RECLAMO,
  normalizeText,
  notaReclamoSchema,
  prioridadSchema,
  reclamoOficinaSchema,
  reclamosQuerySchema,
  type EstadoReclamo,
  type PaginaReclamos,
} from '../shared';
import { sequelize } from '../db';
import { Conexion, CorteProgramadoModel, Reclamo, ReclamoEvento, ReclamoFoto, Socio, Zona } from '../models';
import { writeAudit } from '../lib/audit';
import { conflict, idParam, notFound, ok, parse } from '../lib/errors';
import { cambiarEstado, crearReclamo, detalleReclamo, filasReclamo, programarCorte, toCorte, toReclamoListado } from '../lib/reclamos';
import { requireCooperativaId } from '../lib/tenant';
import { requireRole } from '../middlewares/auth';

export const reclamosRouter = Router();
reclamosRouter.use(requireRole('admin', 'gerencia'));
const quienAtiende = requireRole('admin');
const POR_PAGINA = 30;

reclamosRouter.get('/', async (req, res) => {
  const q = parse(reclamosQuerySchema, req.query);
  const donde: string[] = [];
  if (q.servicio) donde.push('r.servicio = :servicio');
  // Un solo campo: número de reclamo o de socio si son cifras; si no, nombre o domicilio.
  const texto = q.q ? normalizeText(q.q) : '';
  const cifras = /^[\d\sR-]+$/i.test(q.q ?? '') ? (q.q ?? '').replace(/\D/g, '') : '';
  if (cifras) donde.push('(r.numero = :numero OR s.numero = :numero)');
  else if (texto) donde.push(`(s.nombre_norm LIKE :texto OR cx.direccion_norm LIKE :texto OR lower(COALESCE(r.direccion, '')) LIKE :texto)`);
  const base = donde.length ? donde.join(' AND ') : 'TRUE';
  const replacements = { servicio: q.servicio ?? null, numero: cifras ? Number(cifras.slice(-9)) : null, texto: `%${texto}%` };
  // Condiciones fijas: nunca se arman con texto del pedido.
  const porEstado = q.estado === 'abiertos' ? `r.estado <> 'resuelto'` : 'r.estado = :estado';
  // Lo urgente y lo más viejo, primero; lo resuelto, por fecha de resolución.
  const orden =
    q.estado === 'resuelto'
      ? 'ORDER BY r.resuelto_el DESC, r.id DESC'
      : `ORDER BY CASE r.prioridad WHEN 'urgente' THEN 0 WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END, r.creado_el, r.id`;

  const [filas, conteos] = await Promise.all([
    filasReclamo(`${base} AND ${porEstado}`, { ...replacements, estado: q.estado }, `${orden} LIMIT ${POR_PAGINA} OFFSET ${(q.pagina - 1) * POR_PAGINA}`),
    sequelize.query<{ estado: EstadoReclamo; n: string }>(
      `SELECT r.estado, count(*) AS n FROM reclamos r LEFT JOIN socios s ON s.id = r.socio_id LEFT JOIN conexiones cx ON cx.id = r.conexion_id
       WHERE r.cooperativa_id = :cooperativaId AND ${base} GROUP BY r.estado`,
      { replacements: { ...replacements, cooperativaId: requireCooperativaId() }, type: QueryTypes.SELECT },
    ),
  ]);
  const conteo = Object.fromEntries(ESTADOS_RECLAMO.map((e) => [e, Number(conteos.find((c) => c.estado === e)?.n ?? 0)])) as PaginaReclamos['conteo'];
  const total = q.estado === 'abiertos' ? conteo.nuevo + conteo.asignado + conteo.en_curso : conteo[q.estado];
  const body: PaginaReclamos = { filas: filas.map(toReclamoListado), total, porPagina: POR_PAGINA, conteo };
  ok(res, body);
});

reclamosRouter.get('/:id', async (req, res) => {
  const reclamo = await Reclamo.findByPk(idParam(req));
  if (!reclamo) throw notFound('No encontramos ese reclamo');
  ok(res, await detalleReclamo(reclamo, false));
});

reclamosRouter.get('/:id/foto', async (req, res) => {
  const foto = await ReclamoFoto.findByPk(idParam(req));
  if (!foto) throw notFound('Ese reclamo no tiene foto');
  res.setHeader('Content-Type', foto.mime);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(foto.contenido);
});

/** Reclamo tomado por teléfono o en la oficina. */
reclamosRouter.post('/', quienAtiende, async (req, res) => {
  const d = parse(reclamoOficinaSchema, req.body);
  const conexion = d.conexionId === null ? null : await Conexion.findByPk(d.conexionId);
  if (d.conexionId !== null && !conexion) throw notFound('No encontramos esa conexión');
  if (conexion && d.socioId !== null && conexion.socioId !== d.socioId) throw conflict('Esa conexión no es de ese socio');
  const socioId = conexion?.socioId ?? d.socioId;
  if (socioId !== null && !(await Socio.findByPk(socioId))) throw notFound('No encontramos ese socio');
  const reclamo = await crearReclamo({
    socioId,
    conexionId: conexion?.id ?? null,
    servicio: d.servicio,
    tipo: d.tipo,
    descripcion: d.descripcion,
    prioridad: d.prioridad,
    origen: d.origen,
    direccion: d.direccion ?? conexion?.direccion ?? null,
    lat: conexion?.lat == null ? null : Number(conexion.lat),
    lng: conexion?.lng == null ? null : Number(conexion.lng),
    contacto: d.contacto,
    foto: null,
    usuarioId: req.auth!.userId,
  });
  ok(res, await detalleReclamo(reclamo, false), 201);
});

reclamosRouter.post('/:id/estado', quienAtiende, async (req, res) => {
  const d = parse(cambioEstadoSchema, req.body);
  const id = idParam(req);
  if (!(await Reclamo.count({ where: { id } }))) throw notFound('No encontramos ese reclamo');
  await cambiarEstado(id, d, req.auth!.userId);
  ok(res, await detalleReclamo((await Reclamo.findByPk(id))!, false));
});

reclamosRouter.post('/:id/nota', quienAtiende, async (req, res) => {
  const { nota, visibleSocio } = parse(notaReclamoSchema, req.body);
  const reclamo = await Reclamo.findByPk(idParam(req));
  if (!reclamo) throw notFound('No encontramos ese reclamo');
  await ReclamoEvento.create({ reclamoId: reclamo.id, nota, visibleSocio, usuarioId: req.auth!.userId });
  ok(res, await detalleReclamo(reclamo, false), 201);
});

reclamosRouter.post('/:id/prioridad', quienAtiende, async (req, res) => {
  const { prioridad } = parse(prioridadSchema, req.body);
  const reclamo = await Reclamo.findByPk(idParam(req));
  if (!reclamo) throw notFound('No encontramos ese reclamo');
  if (reclamo.prioridad !== prioridad) {
    const antes = reclamo.prioridad;
    await sequelize.transaction(async (transaction) => {
      await reclamo.update({ prioridad }, { transaction });
      await ReclamoEvento.create({ reclamoId: reclamo.id, nota: `Prioridad: ${antes} → ${prioridad}`, visibleSocio: false, usuarioId: req.auth!.userId }, { transaction });
      await writeAudit({ accion: 'priorizar_reclamo', entidad: 'reclamo', entidadId: reclamo.id, antes: { prioridad: antes }, despues: { prioridad }, transaction });
    });
  }
  ok(res, await detalleReclamo(reclamo, false));
});

/* ───────────────────────── Cortes programados ───────────────────────── */

export const cortesRouter = Router();
cortesRouter.use(requireRole('admin', 'gerencia'));

cortesRouter.get('/', async (_req, res) => {
  const [proximos, pasados] = await Promise.all([
    CorteProgramadoModel.findAll({ where: { hasta: { [Op.gt]: new Date() } }, include: [{ model: Zona, as: 'zona' }], order: [['desde', 'ASC'], ['id', 'ASC']] }),
    CorteProgramadoModel.findAll({ where: { hasta: { [Op.lte]: new Date() } }, include: [{ model: Zona, as: 'zona' }], order: [['desde', 'DESC'], ['id', 'DESC']], limit: 20 }),
  ]);
  ok(res, { proximos: proximos.map(toCorte), pasados: pasados.map(toCorte) });
});

cortesRouter.post('/', requireRole('admin'), async (req, res) => {
  const d = parse(corteSchema, req.body);
  ok(res, toCorte(await programarCorte(d, req.auth!.userId)), 201);
});

cortesRouter.post('/:id/cancelar', requireRole('admin'), async (req, res) => {
  const corte = await CorteProgramadoModel.findByPk(idParam(req), { include: [{ model: Zona, as: 'zona' }] });
  if (!corte) throw notFound('No encontramos ese corte');
  if (corte.canceladoEl) throw conflict('Ese corte ya está cancelado');
  if (corte.hasta.getTime() <= Date.now()) throw conflict('Ese corte ya pasó');
  await sequelize.transaction(async (transaction) => {
    await corte.update({ canceladoEl: new Date() }, { transaction });
    await writeAudit({ accion: 'cancelar_corte', entidad: 'corte', entidadId: corte.id, transaction });
  });
  ok(res, toCorte(corte));
});
