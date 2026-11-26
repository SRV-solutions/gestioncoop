// Caja y cobranza (SPEC 6.6): abrir la caja, buscar al socio en un solo campo, cobrar, imprimir el
// recibo, anular un cobro (con permiso y motivo) y cerrar con arqueo.
import { Router } from 'express';
import { Op, QueryTypes } from 'sequelize';
import { z } from 'zod';
import {
  abrirCajaSchema,
  anularCobroSchema,
  cerrarCajaSchema,
  cobroSchema,
  FORMATOS_RECIBO,
  leerCodigoDeBarras,
  referenciaComprobante,
  type CajaDetalle,
  type CuentaSocio,
  type EstadoCaja,
  type FacturaPendiente,
  type PaginaCajas,
  type ProductoVenta,
  type ResultadoBusqueda,
  type ServicioConexion,
  type SocioEncontrado,
} from '../shared';
import { sequelize } from '../db';
import { Caja, Comprobante, Conexion, Producto, Socio } from '../models';
import { writeAudit } from '../lib/audit';
import { condicionDeBusqueda } from '../lib/busqueda';
import { anularCobro, cajaAbiertaDe, cerrarCaja, detalleRecibo, listarPagos, registrarCobro, resumirCajas } from '../lib/caja';
import { conflict, forbidden, idParam, notFound, ok, parse } from '../lib/errors';
import { reciboPdf } from '../lib/pdf-recibo';
import { enviarPdf } from './facturacion.routes';
import { hoy } from '../lib/tarifas';
import { requireCooperativaId } from '../lib/tenant';
import { requireRole } from '../middlewares/auth';
import { numeroDeDia } from '../motor';

export const cajaRouter = Router();
// Cobran el cajero y administración. Gerencia mira las cajas y los cobros. Anular: solo administración.
cajaRouter.use(requireRole('cajero', 'admin', 'gerencia'));
const quienCobra = requireRole('cajero', 'admin');
const quienAnula = requireRole('admin');

const POR_PAGINA = 30;
const tiene = (roles: readonly string[], ...buscados: string[]) => roles.includes('superadmin') || buscados.some((r) => roles.includes(r));

/* ───────────────────────── La caja de quien está sentado ───────────────────────── */

cajaRouter.get('/estado', async (req, res) => {
  const caja = await cajaAbiertaDe(req.auth!.userId);
  const [resumen] = await resumirCajas(caja ? [caja] : []);
  const body: EstadoCaja = {
    hoy: hoy(),
    caja: resumen ?? null,
    puedeCobrar: tiene(req.auth!.roles, 'cajero', 'admin'),
    puedeAnular: tiene(req.auth!.roles, 'admin'),
  };
  ok(res, body);
});

cajaRouter.post('/abrir', quienCobra, async (req, res) => {
  const { fondoInicial } = parse(abrirCajaSchema, req.body);
  const caja = await sequelize.transaction(async (transaction) => {
    if (await cajaAbiertaDe(req.auth!.userId, transaction)) throw conflict('Ya tenés una caja abierta');
    const creada = await Caja.create({ cajeroId: req.auth!.userId, fondoInicial }, { transaction });
    await writeAudit({ accion: 'abrir_caja', entidad: 'caja', entidadId: creada.id, despues: { fondoInicial }, transaction });
    return creada;
  });
  const [resumen] = await resumirCajas([caja]);
  ok(res, resumen, 201);
});

cajaRouter.post('/cerrar', quienCobra, async (req, res) => {
  const caja = await cerrarCaja(req.auth!.userId, parse(cerrarCajaSchema, req.body));
  const [resumen] = await resumirCajas([caja]);
  ok(res, resumen);
});

/* ───────────────────────── Buscar al socio ───────────────────────── */

interface FilaSocio {
  id: number;
  numero: number;
  nombre: string;
  tipo_doc: string;
  nro_doc: string;
  direccion: string | null;
  deuda: string | null;
  pendientes: string;
  vencidas: string;
}

/** Socios que cumplen la condición, con lo que deben. Primero el número exacto, después por nombre. */
async function sociosCon(condicion: string, params: Record<string, unknown>, limite = 8): Promise<SocioEncontrado[]> {
  const filas = await sequelize.query<FilaSocio>(
    `SELECT s.id, s.numero, s.nombre, s.tipo_doc, s.nro_doc,
            (SELECT c.direccion FROM conexiones c WHERE c.socio_id = s.id AND c.cooperativa_id = :cooperativaId AND c.eliminado_el IS NULL ORDER BY c.numero LIMIT 1) AS direccion,
            d.deuda, d.pendientes, d.vencidas
     FROM socios s
     LEFT JOIN LATERAL (
       SELECT sum(f.saldo) AS deuda, count(*) AS pendientes, count(*) FILTER (WHERE f.vence_el < :hoy) AS vencidas
       FROM comprobantes f
       WHERE f.socio_id = s.id AND f.cooperativa_id = :cooperativaId AND f.tipo = 'factura' AND f.estado = 'emitido' AND f.saldo > 0
     ) d ON TRUE
     WHERE s.cooperativa_id = :cooperativaId AND s.eliminado_el IS NULL AND ${condicion}
     ORDER BY (s.numero = :exacto) DESC, s.nombre_norm, s.id
     LIMIT :limite`,
    { replacements: { exacto: -1, ...params, cooperativaId: requireCooperativaId(), hoy: hoy(), limite }, type: QueryTypes.SELECT },
  );
  return filas.map((f) => ({
    id: f.id,
    numero: f.numero,
    nombre: f.nombre,
    tipoDoc: f.tipo_doc,
    nroDoc: f.nro_doc,
    direccion: f.direccion,
    deuda: Number(f.deuda ?? 0).toFixed(2),
    pendientes: Number(f.pendientes),
    vencidas: Number(f.vencidas),
  }));
}

/**
 * Un solo campo (SPEC 5): el código de barras de la factura —lo tipea el lector—, o nombre,
 * documento, número de socio, de conexión o de medidor.
 */
cajaRouter.get('/buscar', async (req, res) => {
  const { q } = parse(z.object({ q: z.string().trim().min(1).max(80) }), req.query);
  const vacio: ResultadoBusqueda = { socios: [], comprobanteId: null, aviso: null };

  const codigo = leerCodigoDeBarras(q);
  if (codigo) {
    if (codigo.cooperativaId !== requireCooperativaId()) return ok(res, { ...vacio, aviso: 'Ese código de barras es de otra cooperativa.' });
    const factura = await Comprobante.findByPk(codigo.id);
    if (!factura || factura.tipo !== 'factura') return ok(res, { ...vacio, aviso: 'No encontramos la factura de ese código de barras.' });
    const socios = await sociosCon('s.id = :socioId', { socioId: factura.socioId });
    const ref = referenciaComprobante(factura);
    const aviso = factura.estado === 'pagado' ? `${ref} ya está pagada.` : factura.estado === 'anulado' ? `${ref} está anulada.` : null;
    return ok(res, { socios, comprobanteId: aviso ? null : factura.id, aviso } satisfies ResultadoBusqueda);
  }
  if (/^\d{20,}$/.test(q.replace(/\s/g, ''))) return ok(res, { ...vacio, aviso: 'El código de barras se leyó mal. Probá de nuevo o buscá por nombre.' });

  const busqueda = condicionDeBusqueda(q);
  const exacto = typeof busqueda.params.numero === 'number' ? busqueda.params.numero : -1;
  ok(res, { ...vacio, socios: await sociosCon(busqueda.sql, { ...busqueda.params, exacto }) } satisfies ResultadoBusqueda);
});

/** Lo que debe un socio, de la factura más vieja a la más nueva, y sus últimos pagos. */
cajaRouter.get('/socios/:id', async (req, res) => {
  const id = idParam(req);
  const socio = await Socio.findByPk(id);
  if (!socio) throw notFound('No encontramos ese socio');
  const fecha = hoy();
  const [conexion, filas, ultimosPagos] = await Promise.all([
    Conexion.findOne({ where: { socioId: id }, order: [['numero', 'ASC']], attributes: ['direccion'] }),
    sequelize.query<{ id: number; letra: string; punto_venta: number; numero: number; servicio: ServicioConexion; anio: number; mes: number; direccion: string | null; total: string; saldo: string; vence_el: string }>(
      `SELECT c.id, c.letra, c.punto_venta, c.numero, c.servicio, c.anio, c.mes, cx.direccion, c.total, c.saldo, to_char(c.vence_el, 'YYYY-MM-DD') AS vence_el
       FROM comprobantes c LEFT JOIN conexiones cx ON cx.id = c.conexion_id
       WHERE c.cooperativa_id = :cooperativaId AND c.socio_id = :id AND c.tipo = 'factura' AND c.estado = 'emitido' AND c.saldo > 0
       ORDER BY c.vence_el, c.anio, c.mes, c.id`,
      { replacements: { cooperativaId: requireCooperativaId(), id }, type: QueryTypes.SELECT },
    ),
    listarPagos('socio', id, 5),
  ]);
  const pendientes: FacturaPendiente[] = filas.map((f) => ({
    id: f.id,
    referencia: referenciaComprobante({ tipo: 'factura', letra: f.letra, puntoVenta: f.punto_venta, numero: f.numero }),
    servicio: f.servicio,
    anio: f.anio,
    mes: f.mes,
    direccion: f.direccion,
    total: Number(f.total).toFixed(2),
    saldo: Number(f.saldo).toFixed(2),
    venceEl: f.vence_el,
    diasAtraso: Math.max(numeroDeDia(fecha) - numeroDeDia(f.vence_el), 0),
  }));
  const body: CuentaSocio = {
    socio: { id: socio.id, numero: socio.numero, nombre: socio.nombre, tipoDoc: socio.tipoDoc, nroDoc: socio.nroDoc, direccion: conexion?.direccion ?? null, telefono: socio.telefono },
    pendientes,
    // Suma en centavos: sin decimales flotantes.
    deuda: (filas.reduce((t, f) => t + Math.round(Number(f.saldo) * 100), 0) / 100).toFixed(2),
    ultimosPagos,
  };
  ok(res, body);
});

cajaRouter.get('/productos', async (_req, res) => {
  const productos = await Producto.findAll({ where: { activo: true }, order: [['nombre', 'ASC']] });
  const body: ProductoVenta[] = productos.map((p) => ({ id: p.id, nombre: p.nombre, precio: Number(p.precio).toFixed(2), stock: p.stock }));
  ok(res, body);
});

/* ───────────────────────── Cobros ───────────────────────── */

cajaRouter.post('/cobros', quienCobra, async (req, res) => {
  const { id, repetido } = await registrarCobro(parse(cobroSchema, req.body), req.auth!.userId);
  ok(res, await detalleRecibo(id), repetido ? 200 : 201);
});

cajaRouter.get('/cobros/:id', async (req, res) => {
  const recibo = await detalleRecibo(idParam(req));
  if (!recibo) throw notFound('No encontramos ese cobro');
  ok(res, recibo);
});

cajaRouter.get('/cobros/:id/recibo', async (req, res) => {
  const { formato } = parse(z.object({ formato: z.enum(FORMATOS_RECIBO).default('ticket') }), req.query);
  const r = await reciboPdf(idParam(req), formato);
  if (!r) throw notFound('No encontramos ese cobro');
  enviarPdf(res, r.pdf, r.nombre);
});

/** Anular un cobro: solo con permiso y motivo; queda en auditoría (SPEC 6.6). */
cajaRouter.post('/cobros/:id/anular', quienAnula, async (req, res) => {
  const { motivo } = parse(anularCobroSchema, req.body);
  const id = idParam(req);
  await anularCobro(id, motivo, req.auth!.userId);
  ok(res, await detalleRecibo(id));
});

/* ───────────────────────── Cajas anteriores ───────────────────────── */

cajaRouter.get('/cajas', async (req, res) => {
  const { pagina } = parse(z.object({ pagina: z.coerce.number().int().min(1).max(10_000).default(1) }), req.query);
  // El cajero ve sus propias cajas; administración y gerencia, las de todos.
  const where = tiene(req.auth!.roles, 'admin', 'gerencia') ? {} : { cajeroId: req.auth!.userId };
  const { rows, count } = await Caja.findAndCountAll({
    where,
    order: [[sequelize.literal('cerrada_el IS NULL'), 'DESC'], ['abiertaEl', 'DESC'], ['id', 'DESC']],
    limit: POR_PAGINA,
    offset: (pagina - 1) * POR_PAGINA,
  });
  const body: PaginaCajas = { filas: await resumirCajas(rows), total: count, porPagina: POR_PAGINA };
  ok(res, body);
});

cajaRouter.get('/cajas/:id', async (req, res) => {
  const caja = await Caja.findOne({ where: { id: idParam(req), ...(tiene(req.auth!.roles, 'admin', 'gerencia') ? {} : { cajeroId: { [Op.eq]: req.auth!.userId } }) } });
  if (!caja) {
    // Existe pero es de otro cajero: se dice que no tiene permiso; si no existe, que no está.
    if (await Caja.count({ where: { id: idParam(req) } })) throw forbidden();
    throw notFound('No encontramos esa caja');
  }
  const [[resumen], pagos] = await Promise.all([resumirCajas([caja]), listarPagos('caja', caja.id)]);
  const body: CajaDetalle = { ...resumen!, pagos };
  ok(res, body);
});
