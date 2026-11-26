// Tablero de gerencia e informes exportables (SPEC 6.9). Miran gerencia y administración; los
// informes también los usa facturación. Cargar la energía comprada del mes: solo administración.
import { Router, type Response } from 'express';
import { z } from 'zod';
import {
  balanceSchema,
  FILAS_EN_PANTALLA,
  INFORMES,
  INFORMES_DEF,
  informeQuerySchema,
  tableroQuerySchema,
  type CatalogoInformes,
  type InformeDatos,
} from '../shared';
import { sequelize } from '../db';
import { BalanceEnergia, Cooperativa, Usuario } from '../models';
import { writeAudit } from '../lib/audit';
import { notFound, ok, parse } from '../lib/errors';
import { exportarInforme, type Archivo } from '../lib/exportar';
import { armarInforme } from '../lib/informes';
import { armarTablero, resolverSeleccion } from '../lib/tablero';
import { requireCooperativaId } from '../lib/tenant';
import { requireRole } from '../middlewares/auth';

const tiene = (roles: readonly string[], ...buscados: string[]) => roles.includes('superadmin') || buscados.some((r) => roles.includes(r));

/* ───────────────────────── Tablero ───────────────────────── */

export const tableroRouter = Router();
tableroRouter.use(requireRole('gerencia', 'admin'));

tableroRouter.get('/', async (req, res) => {
  const q = parse(tableroQuerySchema, req.query);
  ok(res, await armarTablero(q, tiene(req.auth!.roles, 'admin')));
});

/** Energía que entró a la red en un mes (comprada + generada). Se puede corregir: queda en auditoría. */
tableroRouter.put('/balance', requireRole('admin'), async (req, res) => {
  const d = parse(balanceSchema, req.body);
  const fila = await sequelize.transaction(async (transaction) => {
    const anterior = await BalanceEnergia.findOne({ where: { anio: d.anio, mes: d.mes }, transaction, lock: transaction.LOCK.UPDATE });
    const datos = { compradaKwh: d.compradaKwh, generadaKwh: d.generadaKwh, nota: d.nota || null, cargadoPor: req.auth!.userId };
    const antes = anterior ? { compradaKwh: anterior.compradaKwh, generadaKwh: anterior.generadaKwh } : null;
    const guardada = anterior ? await anterior.update(datos, { transaction }) : await BalanceEnergia.create({ anio: d.anio, mes: d.mes, ...datos }, { transaction });
    await writeAudit({ accion: 'cargar_balance_energia', entidad: 'balance_energia', entidadId: guardada.id, antes, despues: { anio: d.anio, mes: d.mes, compradaKwh: d.compradaKwh, generadaKwh: d.generadaKwh }, transaction });
    return guardada;
  });
  ok(res, { anio: fila.anio, mes: fila.mes, compradaKwh: fila.compradaKwh, generadaKwh: fila.generadaKwh });
});

/* ───────────────────────── Informes ───────────────────────── */

export const informesRouter = Router();
informesRouter.use(requireRole('gerencia', 'admin', 'facturacion'));

informesRouter.get('/', async (_req, res) => {
  const s = await resolverSeleccion({});
  const body: CatalogoInformes = { informes: INFORMES_DEF, periodos: s.periodos, zonas: s.zonas, servicios: s.servicios };
  ok(res, body);
});

function enviarArchivo(res: Response, archivo: Archivo): void {
  res.setHeader('Content-Type', archivo.mime);
  res.setHeader('Content-Disposition', `attachment; filename="${archivo.nombre}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(archivo.contenido);
}

informesRouter.get('/:clave', async (req, res) => {
  const clave = z.enum(INFORMES).safeParse(req.params.clave);
  if (!clave.success) throw notFound('Ese informe no existe');
  const { formato, ...q } = parse(informeQuerySchema, req.query);
  const seleccion = await resolverSeleccion(q);
  const informe = await armarInforme(clave.data, seleccion);

  if (formato === 'json') {
    const body: InformeDatos = { ...informe, filas: informe.filas.slice(0, FILAS_EN_PANTALLA) };
    return ok(res, body);
  }
  const [coop, usuario] = await Promise.all([Cooperativa.findByPk(requireCooperativaId()), Usuario.findByPk(req.auth!.userId, { attributes: ['nombre'] })]);
  const archivo = await exportarInforme(informe, formato, { cooperativa: coop?.nombre ?? '', usuario: usuario?.nombre ?? null }, seleccion.hoy);
  // Sacar datos de la cooperativa en un archivo queda registrado: quién, qué informe y con qué filtros.
  await writeAudit({ accion: 'exportar_informe', entidad: 'informe', entidadId: clave.data, despues: { formato, filtros: informe.subtitulo, filas: informe.total } });
  enviarArchivo(res, archivo);
});
