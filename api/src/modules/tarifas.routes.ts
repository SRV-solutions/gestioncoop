import { Router } from 'express';
import { col, fn, Op, type Transaction } from 'sequelize';
import {
  conceptoFinSchema,
  conceptoNuevoSchema,
  cuadroNuevoSchema,
  parametrosFacturacionSchema,
  planPrecioSchema,
  SERVICIOS_MEDIDOS,
  simulacionSchema,
  nombreDeMes,
  type EntradaFactura,
  type PlanDetalle,
  type TarifasResumen,
} from '../shared';
import { sequelize } from '../db';
import { Concepto, Cooperativa, CuadroTarifario, Escalon, Plan, ServicioConexionModel } from '../models';
import { writeAudit } from '../lib/audit';
import { clearCooperativaCache } from '../lib/cooperativas';
import { badRequest, conflict, idParam, notFound, ok, parse } from '../lib/errors';
import { ultimoDiaFacturado } from '../lib/facturacion';
import { cargarConceptos, cargarCuadros, cargarParametros, hoy, parametrosDe, toConcepto, toCuadro } from '../lib/tarifas';
import { requireCooperativaId } from '../lib/tenant';
import { requireRole } from '../middlewares/auth';
import { calcularFactura, fechaCorta, mesCompleto, sumarDias } from '../motor';

export const tarifasRouter = Router();
// Ver las tarifas y simular: quienes facturan o deciden. Cambiarlas: solo administración (SPEC sección 4).
tarifasRouter.use(requireRole('admin', 'gerencia', 'facturacion'));
const soloAdmin = requireRole('admin');

const CON_ESCALONES = { model: Escalon, as: 'escalones' } as const;

async function listarPlanes(): Promise<PlanDetalle[]> {
  const [planes, uso] = await Promise.all([
    Plan.findAll({ order: [['servicio', 'ASC'], ['precio', 'ASC']] }),
    ServicioConexionModel.findAll({
      attributes: ['planId', [fn('count', col('id')), 'n']],
      where: { planId: { [Op.ne]: null }, estado: { [Op.ne]: 'baja' } },
      group: ['planId'],
      raw: true,
    }) as unknown as Promise<{ planId: number; n: string }[]>,
  ]);
  const conexiones = new Map(uso.map((u) => [u.planId, Number(u.n)]));
  return planes.map((p) => ({ id: p.id, servicio: p.servicio, nombre: p.nombre, precio: p.precio, activo: p.activo, conexiones: conexiones.get(p.id) ?? 0 }));
}

/* ───────────────────────── Todo lo que muestra la pantalla ───────────────────────── */

tarifasRouter.get('/', async (_req, res) => {
  const [cuadros, conceptos, planes, parametros] = await Promise.all([cargarCuadros(), cargarConceptos(), listarPlanes(), cargarParametros()]);
  const body: TarifasResumen = { hoy: hoy(), cuadros, conceptos, planes, parametros };
  ok(res, body);
});

/* ───────────────────────── Versionado ─────────────────────────
 * Un cuadro o un concepto no se edita: se agrega una versión con otra fecha y la anterior se cierra
 * el día antes. Así cada factura se puede recalcular con la tarifa que regía en su momento. */

/** Cierra la versión anterior el día antes de que empiece la nueva. */
async function cerrarAnterior<T extends CuadroTarifario | Concepto>(anterior: T | null, desde: string, transaction: Transaction): Promise<void> {
  if (!anterior || (anterior.vigenteHasta !== null && anterior.vigenteHasta < desde)) return;
  anterior.vigenteHasta = sumarDias(desde, -1);
  await anterior.save({ transaction });
}

/** Si se borra una versión futura, la anterior vuelve a quedar sin fecha de fin. */
async function reabrirAnterior<T extends CuadroTarifario | Concepto>(anterior: T | null, desde: string, transaction: Transaction): Promise<void> {
  if (!anterior || anterior.vigenteHasta !== sumarDias(desde, -1)) return;
  anterior.vigenteHasta = null;
  await anterior.save({ transaction });
}

/**
 * Una tarifa nueva no puede regir desde un mes que ya se facturó: esas facturas quedarían
 * calculadas con un precio distinto del que muestra el sistema.
 */
async function exigirNoRetroactiva(fecha: string, campo: 'vigenteDesde' | 'vigenteHasta'): Promise<void> {
  const ultimo = await ultimoDiaFacturado();
  if (!ultimo) return;
  const limite = campo === 'vigenteDesde' ? fecha <= ultimo.hasta : fecha < ultimo.hasta;
  if (!limite) return;
  const desde = fechaCorta(campo === 'vigenteDesde' ? sumarDias(ultimo.hasta, 1) : ultimo.hasta);
  throw badRequest('Revisá los datos marcados', {
    [campo]: `Ya se emitieron las facturas de ${nombreDeMes(ultimo.anio, ultimo.mes)}: ${campo === 'vigenteDesde' ? 'el cambio puede regir' : 'puede terminar'} desde el ${desde}`,
  });
}

const fechaPosterior = (ultima: string) =>
  badRequest('Revisá los datos marcados', { vigenteDesde: `Ya hay una versión que rige desde el ${fechaCorta(ultima)}: la nueva tiene que empezar después` });

/* ───────────────────────── Cuadros ───────────────────────── */

tarifasRouter.post('/cuadros', soloAdmin, async (req, res) => {
  const input = parse(cuadroNuevoSchema, req.body);
  await exigirNoRetroactiva(input.vigenteDesde, 'vigenteDesde');
  const clave = { servicio: input.servicio, categoria: input.categoria, conSubsidio: input.conSubsidio };

  const id = await sequelize.transaction(async (transaction) => {
    const ultimo = await CuadroTarifario.findOne({ where: clave, order: [['vigenteDesde', 'DESC']], transaction, lock: transaction.LOCK.UPDATE });
    if (ultimo && input.vigenteDesde <= ultimo.vigenteDesde) throw fechaPosterior(ultimo.vigenteDesde);
    await cerrarAnterior(ultimo, input.vigenteDesde, transaction);

    const cuadro = await CuadroTarifario.create(
      { ...clave, vigenteDesde: input.vigenteDesde, cargoFijo: input.cargoFijo, nota: input.nota, creadoPor: req.auth!.userId },
      { transaction },
    );
    await Escalon.bulkCreate(
      input.escalones.map((e) => ({ cuadroId: cuadro.id, desde: e.desde, hasta: e.hasta, precioUnitario: e.precio, subsidiado: e.subsidiado, exentoDe: e.exentoDe })),
      { transaction },
    );
    await writeAudit({ accion: 'crear', entidad: 'cuadro_tarifario', entidadId: cuadro.id, antes: ultimo ? { reemplazaA: ultimo.id } : null, despues: input, transaction });
    return cuadro.id;
  });

  const creado = await CuadroTarifario.findByPk(id, { include: [CON_ESCALONES] });
  ok(res, toCuadro(creado!), 201);
});

tarifasRouter.delete('/cuadros/:id', soloAdmin, async (req, res) => {
  const cuadro = await CuadroTarifario.findByPk(idParam(req), { include: [CON_ESCALONES] });
  if (!cuadro) throw notFound('No encontramos ese cuadro tarifario');
  if (cuadro.vigenteDesde <= hoy()) {
    throw conflict('Este cuadro ya está en vigencia y no se puede borrar. Para cambiar la tarifa, creá una versión nueva.');
  }
  await sequelize.transaction(async (transaction) => {
    const anterior = await CuadroTarifario.findOne({
      where: { servicio: cuadro.servicio, categoria: cuadro.categoria, conSubsidio: cuadro.conSubsidio, vigenteDesde: { [Op.lt]: cuadro.vigenteDesde } },
      order: [['vigenteDesde', 'DESC']],
      transaction,
    });
    await writeAudit({ accion: 'borrar', entidad: 'cuadro_tarifario', entidadId: cuadro.id, antes: toCuadro(cuadro), transaction });
    await cuadro.destroy({ transaction });
    await reabrirAnterior(anterior, cuadro.vigenteDesde, transaction);
  });
  ok(res, { ok: true });
});

/* ───────────────────────── Conceptos ───────────────────────── */

tarifasRouter.post('/conceptos', soloAdmin, async (req, res) => {
  const input = parse(conceptoNuevoSchema, req.body);
  await exigirNoRetroactiva(input.vigenteDesde, 'vigenteDesde');

  const creado = await sequelize.transaction(async (transaction) => {
    const ultimo = await Concepto.findOne({ where: { codigo: input.codigo }, order: [['vigenteDesde', 'DESC']], transaction, lock: transaction.LOCK.UPDATE });
    if (ultimo && input.vigenteDesde <= ultimo.vigenteDesde) throw fechaPosterior(ultimo.vigenteDesde);
    await cerrarAnterior(ultimo, input.vigenteDesde, transaction);

    const { servicio, ...resto } = input;
    const concepto = await Concepto.create({ ...resto, aplicaA: servicio, creadoPor: req.auth!.userId }, { transaction });
    await writeAudit({
      accion: ultimo ? 'cambiar_valor' : 'crear',
      entidad: 'concepto',
      entidadId: concepto.id,
      antes: ultimo ? toConcepto(ultimo) : null,
      despues: input,
      transaction,
    });
    return concepto;
  });
  ok(res, toConcepto(creado), 201);
});

/** Deja de cobrarse desde una fecha (el historial queda). */
tarifasRouter.post('/conceptos/:id/fin', soloAdmin, async (req, res) => {
  const { vigenteHasta } = parse(conceptoFinSchema, req.body);
  await exigirNoRetroactiva(vigenteHasta, 'vigenteHasta');
  const concepto = await Concepto.findByPk(idParam(req));
  if (!concepto) throw notFound('No encontramos ese concepto');
  if (concepto.vigenteHasta !== null) throw conflict('Ese valor ya tiene fecha de fin');
  if (vigenteHasta < concepto.vigenteDesde) {
    throw badRequest('Revisá los datos marcados', { vigenteHasta: `No puede terminar antes de empezar (rige desde el ${fechaCorta(concepto.vigenteDesde)})` });
  }
  const antes = toConcepto(concepto);
  await sequelize.transaction(async (transaction) => {
    concepto.vigenteHasta = vigenteHasta;
    await concepto.save({ transaction });
    await writeAudit({ accion: 'finalizar', entidad: 'concepto', entidadId: concepto.id, antes, despues: { vigenteHasta }, transaction });
  });
  ok(res, toConcepto(concepto));
});

tarifasRouter.delete('/conceptos/:id', soloAdmin, async (req, res) => {
  const concepto = await Concepto.findByPk(idParam(req));
  if (!concepto) throw notFound('No encontramos ese concepto');
  if (concepto.vigenteDesde <= hoy()) {
    throw conflict('Este valor ya está en vigencia y no se puede borrar. Podés cargar un valor nuevo o ponerle fecha de fin.');
  }
  await sequelize.transaction(async (transaction) => {
    const anterior = await Concepto.findOne({
      where: { codigo: concepto.codigo, vigenteDesde: { [Op.lt]: concepto.vigenteDesde } },
      order: [['vigenteDesde', 'DESC']],
      transaction,
    });
    await writeAudit({ accion: 'borrar', entidad: 'concepto', entidadId: concepto.id, antes: toConcepto(concepto), transaction });
    await concepto.destroy({ transaction });
    await reabrirAnterior(anterior, concepto.vigenteDesde, transaction);
  });
  ok(res, { ok: true });
});

/* ───────────────────────── Planes y parámetros ───────────────────────── */

tarifasRouter.put('/planes/:id', soloAdmin, async (req, res) => {
  const { precio } = parse(planPrecioSchema, req.body);
  const plan = await Plan.findByPk(idParam(req));
  if (!plan) throw notFound('No encontramos ese plan');
  const antes = { precio: plan.precio };
  await sequelize.transaction(async (transaction) => {
    plan.precio = precio;
    await plan.save({ transaction });
    await writeAudit({ accion: 'cambiar_precio', entidad: 'plan', entidadId: plan.id, antes, despues: { precio }, transaction });
  });
  ok(res, (await listarPlanes()).find((p) => p.id === plan.id));
});

tarifasRouter.put('/parametros', soloAdmin, async (req, res) => {
  const input = parse(parametrosFacturacionSchema, req.body);
  const coop = await Cooperativa.findByPk(requireCooperativaId());
  const antes = parametrosDe(coop!.configJson);
  await sequelize.transaction(async (transaction) => {
    coop!.configJson = { ...coop!.configJson, facturacion: input };
    await coop!.save({ transaction });
    await writeAudit({ accion: 'cambiar', entidad: 'parametros_facturacion', entidadId: coop!.id, antes, despues: input, transaction });
  });
  clearCooperativaCache();
  ok(res, input);
});

/* ───────────────────────── Simulador ───────────────────────── */

tarifasRouter.post('/simular', async (req, res) => {
  const s = parse(simulacionSchema, req.body);
  const [anio, mes] = (s.periodo ?? hoy().slice(0, 7)).split('-').map(Number) as [number, number];
  const rango = mesCompleto(anio, mes);
  const medido = (SERVICIOS_MEDIDOS as readonly string[]).includes(s.servicio);
  if (medido && s.consumo === undefined) throw badRequest('Revisá los datos marcados', { consumo: 'Escribí el consumo' });

  let plan: EntradaFactura['plan'];
  if (s.servicio === 'internet' || s.servicio === 'tv') {
    const elegido = s.planId ? await Plan.findOne({ where: { id: s.planId, servicio: s.servicio } }) : null;
    if (!elegido) throw badRequest('Revisá los datos marcados', { planId: 'Elegí un plan' });
    plan = { nombre: elegido.nombre, precio: elegido.precio };
  }

  const [cuadros, conceptos, parametros] = await Promise.all([cargarCuadros(rango), cargarConceptos(rango), cargarParametros()]);
  const entrada: EntradaFactura = {
    servicio: s.servicio,
    periodo: { anio, mes, ...rango },
    condicionIva: s.condicionIva,
    suministro: { categoria: medido ? s.categoria : null, tieneSubsidio: s.servicio === 'energia' && s.tieneSubsidio, fechaAlta: '2000-01-01', fechaBaja: null },
    lecturas: medido ? [{ anterior: '0', actual: s.consumo! }] : undefined,
    cuadros,
    conceptos,
    plan,
    sepelio: s.servicio === 'sepelio' || s.adherentes !== null ? { adherentes: s.adherentes ?? 0 } : undefined,
    deudaVencida: s.deuda ? [{ referencia: 'de la factura anterior', saldo: s.deuda.saldo, venceEl: sumarDias(rango.hasta, -s.deuda.dias) }] : undefined,
    fechaEmision: rango.hasta,
    parametros,
  };
  // Si no se puede calcular (falta un cuadro, por ejemplo), el error sale con su explicación: ver app.ts.
  ok(res, calcularFactura(entrada));
});
