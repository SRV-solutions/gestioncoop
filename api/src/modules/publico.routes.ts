// Lo que se usa sin sesión:
// - pagar una factura con el QR del papel (`/publico/pagar/:codigo`), sin tener cuenta;
// - ver cómo quedó un pago online al volver del banco;
// - la pasarela de prueba, que hace de banco en la demo;
// - el aviso servidor a servidor del proveedor de pagos (`/pagos/notificacion/:proveedor`).
// Cada pedido trabaja en la cooperativa que sale del código o del intento, nunca de un dato suelto.
import { Router, type Request, type RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { codigoDeBarras, leerCodigoDeBarras, pasarelaDecisionSchema, type EstadoPagoOnline, type FacturaPublica, type PasarelaDatos } from '../shared';
import { config } from '../config';
import { Comprobante, Conexion, Cooperativa, IntentoPago, PasarelaSimulada, Socio } from '../models';
import { runInCooperativa, runUnscoped } from '../lib/context';
import { findCooperativaBySubdominio, subdominioOf } from '../lib/cooperativas';
import { conflict, HttpError, notFound, ok, parse } from '../lib/errors';
import { crearIntentoPago, estadoIntento, recibirNotificacion } from '../lib/pagos-online';
import { hoy } from '../lib/tarifas';
import { FirmaInvalidaError, firmaIntentoOk, pagosSimulados, proveedorPagos } from '../proveedores/pagos';

export const publicoRouter = Router();
export const notificacionesPagoRouter = Router();

const limite = (limit: number) =>
  rateLimit({
    windowMs: 15 * 60_000,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => config.isTest,
    handler: (_req, _res, next) => next(new HttpError(429, 'Demasiados intentos. Probá de nuevo en unos minutos.', 'too_many_requests')),
  });
publicoRouter.use(limite(300));

/** La cooperativa de la dirección, si la dirección es de una: lo que se pide tiene que ser de ella. */
async function exigirMismaCooperativa(req: Request, cooperativaId: number): Promise<void> {
  const sub = subdominioOf(req);
  if (!sub) return;
  const coop = await findCooperativaBySubdominio(sub);
  if (!coop || coop.id !== cooperativaId) throw notFound();
}

/* ───────────────────────── Pagar con el QR de la factura ───────────────────────── */

/**
 * La factura de un código. Además del dígito verificador, el código tiene que coincidir entero
 * (vencimiento e importe): no alcanza con adivinar un número de comprobante.
 */
async function facturaDelCodigo(req: Request, codigo: string): Promise<{ factura: Comprobante; cooperativaId: number }> {
  const leido = leerCodigoDeBarras(codigo);
  if (!leido) throw notFound('Ese código no es válido. Revisá que esté completo.');
  await exigirMismaCooperativa(req, leido.cooperativaId);
  const coop = await runUnscoped(() => Cooperativa.findByPk(leido.cooperativaId));
  if (!coop?.activa) throw notFound('Ese código no es válido. Revisá que esté completo.');
  const factura = await runInCooperativa(coop.id, () => Comprobante.findByPk(leido.id));
  const coincide =
    factura?.tipo === 'factura' &&
    factura.venceEl !== null &&
    codigoDeBarras({ cooperativaId: coop.id, id: factura.id, venceEl: factura.venceEl, total: Number(factura.total).toFixed(2) }) === codigo.replace(/\s/g, '');
  if (!factura || !coincide) throw notFound('Ese código no es válido. Revisá que esté completo.');
  return { factura, cooperativaId: coop.id };
}

publicoRouter.get('/pagar/:codigo', async (req, res) => {
  const { factura, cooperativaId } = await facturaDelCodigo(req, String(req.params.codigo));
  const body = await runInCooperativa(cooperativaId, async (): Promise<FacturaPublica> => {
    const [coop, socio, conexion] = await Promise.all([
      Cooperativa.findByPk(cooperativaId),
      Socio.findByPk(factura.socioId, { attributes: ['numero'] }),
      factura.conexionId ? Conexion.findByPk(factura.conexionId, { attributes: ['numero'] }) : null,
    ]);
    return {
      cooperativa: coop!.nombreCorto,
      servicio: factura.servicio,
      anio: factura.anio,
      mes: factura.mes,
      identificacion: [`Socio N° ${socio?.numero ?? '—'}`, conexion ? `conexión ${conexion.numero}` : null].filter(Boolean).join(' · '),
      total: Number(factura.total).toFixed(2),
      saldo: Number(factura.saldo).toFixed(2),
      venceEl: factura.venceEl,
      vencida: factura.estado === 'emitido' && factura.venceEl !== null && factura.venceEl < hoy(),
      estado: factura.estado === 'pagado' ? 'pagada' : factura.estado === 'anulado' ? 'anulada' : 'pendiente',
    };
  });
  ok(res, body);
});

publicoRouter.post('/pagar/:codigo', limite(30), async (req, res) => {
  const { factura, cooperativaId } = await facturaDelCodigo(req, String(req.params.codigo));
  const creado = await runInCooperativa(cooperativaId, async () => {
    const socio = (await Socio.findByPk(factura.socioId))!;
    return crearIntentoPago({ socio, comprobanteIds: [factura.id], origen: 'qr', usuarioId: null });
  });
  ok(res, creado, 201);
});

/** El intento y su cooperativa. El id es un UUID: no se puede adivinar. */
async function intentoDe(req: Request): Promise<IntentoPago> {
  const { id } = parse(z.object({ id: z.uuid() }), req.params);
  const intento = await runUnscoped(() => IntentoPago.findByPk(id));
  if (!intento) throw notFound('No encontramos ese pago');
  await exigirMismaCooperativa(req, intento.cooperativaId);
  return intento;
}

/** Cómo quedó un pago hecho con el QR (la vuelta del banco, sin sesión). */
publicoRouter.get('/pagos/:id', async (req, res) => {
  const intento = await intentoDe(req);
  const estado = await runInCooperativa(intento.cooperativaId, async () => estadoIntento((await IntentoPago.findByPk(intento.id))!));
  const body: EstadoPagoOnline = { ...estado, deudaRestante: null };
  ok(res, body);
});

/* ───────────────────────── Pasarela de prueba ───────────────────────── */

const soloSimulada: RequestHandler = (_req, _res, next) => {
  if (!proveedorPagos.simulado) throw notFound();
  next();
};

const retornoDe = (i: IntentoPago) => {
  const vuelta = i.origen === 'portal' ? `${config.appUrl}/socio/pago/${i.id}` : `${config.appUrl}/pagar/resultado/${i.id}`;
  return { exito: vuelta, cancelado: `${vuelta}?cancelado=1` };
};

publicoRouter.get('/pasarela/:id', soloSimulada, async (req, res) => {
  const intento = await intentoDe(req);
  if (!firmaIntentoOk(intento.id, typeof req.query.firma === 'string' ? req.query.firma : undefined)) throw notFound('No encontramos esa operación');
  const body = await runInCooperativa(intento.cooperativaId, async (): Promise<PasarelaDatos> => {
    const [coop, banco] = await Promise.all([Cooperativa.findByPk(intento.cooperativaId), PasarelaSimulada.findByPk(intento.id)]);
    const vencido = banco?.estado === 'pendiente' && intento.venceEl.getTime() < Date.now();
    return {
      intentoId: intento.id,
      comercio: coop!.nombreCorto,
      items: intento.itemsJson.map((i) => ({ descripcion: i.descripcion, importe: i.importe })),
      total: Number(intento.total).toFixed(2),
      estado: vencido ? 'vencido' : (banco?.estado ?? 'pendiente'),
      retorno: retornoDe(intento),
    };
  });
  ok(res, body);
});

/**
 * Lo que hace el socio en la pantalla del «banco». El banco de prueba guarda su decisión y le avisa
 * a nuestro servidor —en la vida real por /pagos/notificacion, acá en el momento—; recién ese
 * aviso acredita el pago. Después, el navegador vuelve a la app.
 */
publicoRouter.post('/pasarela/:id', soloSimulada, limite(60), async (req, res) => {
  const { firma, decision, medio } = parse(pasarelaDecisionSchema, req.body);
  const intento = await intentoDe(req);
  if (!firmaIntentoOk(intento.id, firma)) throw notFound('No encontramos esa operación');
  const aviso = await runInCooperativa(intento.cooperativaId, async () => {
    const banco = await PasarelaSimulada.findByPk(intento.id);
    if (banco?.estado === 'pendiente' && intento.venceEl.getTime() < Date.now()) throw conflict('La operación venció. Volvé a la cooperativa y empezá el pago de nuevo.');
    return pagosSimulados.decidir(intento.id, decision, medio);
  });
  await recibirNotificacion(aviso.payload, aviso.firma);
  const retorno = retornoDe(intento);
  ok(res, { estado: aviso.payload.estado, redireccion: aviso.payload.estado === 'cancelado' ? retorno.cancelado : retorno.exito });
});

/* ───────────────────────── Aviso del proveedor, servidor a servidor ───────────────────────── */

notificacionesPagoRouter.post('/notificacion/:proveedor', limite(600), async (req, res) => {
  if (req.params.proveedor !== proveedorPagos.nombre) throw notFound();
  try {
    await recibirNotificacion(req.body, req.get('x-firma') ?? undefined);
  } catch (err) {
    if (err instanceof FirmaInvalidaError) throw new HttpError(401, 'Firma inválida', 'firma_invalida');
    throw err;
  }
  ok(res, { recibido: true });
});
