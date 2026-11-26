// Portal del socio (SPEC 6.7): todo lo que ve y hace el socio desde el celular. Cada pedido se
// limita al socio vinculado con el usuario que entró: nunca se toma un id de socio del pedido.
import Decimal from 'decimal.js';
import { Router, type Request } from 'express';
import { Op, QueryTypes } from 'sequelize';
import { z } from 'zod';
import {
  codigoDeBarras,
  contactoSchema,
  FORMATOS_RECIBO,
  pagoSocioSchema,
  reclamoSocioSchema,
  referenciaComprobante,
  SERVICIOS_MEDIDOS,
  UNIDAD_SERVICIO,
  type Categoria,
  type ConsumoServicio,
  type CorteAviso,
  type EstadoComprobante,
  type EstadoPagoOnline,
  type FacturaSocio,
  type FacturaSocioDetalle,
  type InicioSocio,
  type MedioPago,
  type PaginaFacturasSocio,
  type ServicioConexion,
  type ServicioMedido,
  type TipoComprobante,
} from '../shared';
import { sequelize } from '../db';
import { Comprobante, ComprobanteRenglon, Conexion, CuadroTarifario, Escalon, IntentoPago, Reclamo, ReclamoFoto, ServicioConexionModel, Socio } from '../models';
import { writeAudit } from '../lib/audit';
import { listarPagos, referenciaRecibo } from '../lib/caja';
import { conflict, idParam, notFound, ok, parse } from '../lib/errors';
import { explicarFactura } from '../lib/explicar';
import { crearIntentoPago, estadoIntento } from '../lib/pagos-online';
import { reciboPdf } from '../lib/pdf-recibo';
import { crearReclamo, detalleReclamo, filasReclamo } from '../lib/reclamos';
import { hoy, toCuadro } from '../lib/tarifas';
import { requireCooperativaId } from '../lib/tenant';
import { requireRole } from '../middlewares/auth';
import { calculoDe, enviarPdf, pdfDeComprobante } from './facturacion.routes';
import { detalleSocio } from './padron.routes';

export const socioRouter = Router();
socioRouter.use(requireRole('socio'));

const POR_PAGINA = 20;
const MAX_RECLAMOS_ABIERTOS = 10;
const centavos = (v: string) => Math.round(Number(v) * 100);
const deCentavos = (c: number) => (c / 100).toFixed(2);

/** El socio vinculado al usuario que entró. */
async function socioDe(req: Request): Promise<Socio> {
  const socio = await Socio.findOne({ where: { usuarioId: req.auth!.userId } });
  if (!socio) throw notFound('Tu usuario no está vinculado a ningún socio. Acercate a la cooperativa para revisarlo.');
  return socio;
}

/* ───────────────────────── Facturas ───────────────────────── */

interface FilaFactura {
  id: number;
  tipo: TipoComprobante;
  letra: string;
  punto_venta: number;
  numero: number;
  servicio: ServicioConexion;
  anio: number;
  mes: number;
  direccion: string | null;
  total: string;
  saldo: string;
  estado: EstadoComprobante;
  emitido_el: string | null;
  vence_el: string | null;
  consumo: string | null;
  total_filas?: string;
}

function toFactura(f: FilaFactura, fecha: string): FacturaSocio {
  const medido = (SERVICIOS_MEDIDOS as readonly string[]).includes(f.servicio);
  return {
    id: f.id,
    tipo: f.tipo,
    referencia: referenciaComprobante({ tipo: f.tipo, letra: f.letra, puntoVenta: f.punto_venta, numero: f.numero }),
    servicio: f.servicio,
    anio: f.anio,
    mes: f.mes,
    direccion: f.direccion,
    total: Number(f.total).toFixed(2),
    saldo: Number(f.saldo).toFixed(2),
    estado: f.estado,
    emitidoEl: f.emitido_el,
    venceEl: f.vence_el,
    vencida: f.estado === 'emitido' && f.vence_el !== null && f.vence_el < fecha,
    consumo: medido && f.consumo !== null ? new Decimal(f.consumo).toFixed() : null,
    unidad: medido ? UNIDAD_SERVICIO[f.servicio as ServicioMedido] : null,
  };
}

// Condiciones fijas: nunca se arman con texto del pedido.
const FILTRO_FACTURAS = {
  todas: `c.estado <> 'borrador'`,
  pendientes: `c.tipo = 'factura' AND c.estado = 'emitido' AND c.saldo > 0`,
  una: `c.id = :id AND c.estado <> 'borrador'`,
} as const;

function facturasDe(socioId: number, filtro: keyof typeof FILTRO_FACTURAS, extra: { id?: number; pagina?: number } = {}): Promise<FilaFactura[]> {
  const orden = filtro === 'pendientes' ? 'c.vence_el, c.anio, c.mes, c.id' : 'c.anio DESC, c.mes DESC, c.emitido_el DESC, c.servicio, c.id DESC';
  return sequelize.query<FilaFactura>(
    `SELECT c.id, c.tipo, c.letra, c.punto_venta, c.numero, c.servicio, c.anio, c.mes, cx.direccion, c.total, c.saldo, c.estado,
            to_char(c.emitido_el, 'YYYY-MM-DD') AS emitido_el, to_char(c.vence_el, 'YYYY-MM-DD') AS vence_el, c.consumo, count(*) OVER () AS total_filas
     FROM comprobantes c LEFT JOIN conexiones cx ON cx.id = c.conexion_id
     WHERE c.cooperativa_id = :cooperativaId AND c.socio_id = :socioId AND ${FILTRO_FACTURAS[filtro]}
     ORDER BY ${orden}
     LIMIT :limite OFFSET :desde`,
    {
      replacements: { cooperativaId: requireCooperativaId(), socioId, id: extra.id ?? null, limite: extra.pagina ? POR_PAGINA : 200, desde: extra.pagina ? (extra.pagina - 1) * POR_PAGINA : 0 },
      type: QueryTypes.SELECT,
    },
  );
}

/** Cortes programados que le tocan al socio: de sus zonas (o de toda la localidad) y de sus servicios. */
async function cortesDe(socioId: number): Promise<CorteAviso[]> {
  const filas = await sequelize.query<{ id: number; servicio: ServicioConexion; desde: Date; hasta: Date; motivo: string; zona: string | null }>(
    `SELECT DISTINCT cp.id, cp.servicio, cp.desde, cp.hasta, cp.motivo, z.nombre AS zona
     FROM cortes_programados cp
     LEFT JOIN zonas z ON z.id = cp.zona_id
     JOIN conexiones c ON c.socio_id = :socioId AND c.cooperativa_id = :cooperativaId AND c.eliminado_el IS NULL AND (cp.zona_id IS NULL OR cp.zona_id = c.zona_id)
     JOIN servicios_conexion sc ON sc.conexion_id = c.id AND sc.servicio = cp.servicio AND sc.estado <> 'baja'
     WHERE cp.cooperativa_id = :cooperativaId AND cp.cancelado_el IS NULL AND cp.hasta > now()
     ORDER BY cp.desde, cp.id`,
    { replacements: { cooperativaId: requireCooperativaId(), socioId }, type: QueryTypes.SELECT },
  );
  return filas.map((f) => ({ id: f.id, servicio: f.servicio, desde: f.desde.toISOString(), hasta: f.hasta.toISOString(), motivo: f.motivo, zona: f.zona }));
}

socioRouter.get('/inicio', async (req, res) => {
  const socio = await socioDe(req);
  const fecha = hoy();
  const [pendientes, cortes, reclamosAbiertos, pagos, enCurso] = await Promise.all([
    facturasDe(socio.id, 'pendientes'),
    cortesDe(socio.id),
    Reclamo.count({ where: { socioId: socio.id, estado: { [Op.ne]: 'resuelto' } } }),
    listarPagos('socio', socio.id, 5),
    IntentoPago.findOne({ where: { socioId: socio.id, estado: 'pendiente', venceEl: { [Op.gt]: new Date() } }, order: [['creadoEl', 'DESC']] }),
  ]);
  const facturas = pendientes.map((f) => toFactura(f, fecha));
  const futuros = facturas.map((f) => f.venceEl).filter((v): v is string => v !== null && v >= fecha);
  const ultimo = pagos.find((p) => p.estado === 'acreditado');
  const body: InicioSocio = {
    socio: { numero: socio.numero, nombre: socio.nombre },
    deuda: deCentavos(facturas.reduce((t, f) => t + centavos(f.saldo), 0)),
    pendientes: facturas,
    vencidas: facturas.filter((f) => f.vencida).length,
    proximoVencimiento: futuros.length ? futuros.sort()[0]! : null,
    cortes,
    reclamosAbiertos,
    ultimoPago: ultimo ? { id: ultimo.id, referencia: ultimo.referencia, cobradoEl: ultimo.cobradoEl, importe: ultimo.importe } : null,
    pagoEnCurso: enCurso ? { intentoId: enCurso.id, total: Number(enCurso.total).toFixed(2) } : null,
  };
  ok(res, body);
});

socioRouter.get('/facturas', async (req, res) => {
  const { pagina } = parse(z.object({ pagina: z.coerce.number().int().min(1).max(1000).default(1) }), req.query);
  const socio = await socioDe(req);
  const filas = await facturasDe(socio.id, 'todas', { pagina });
  const fecha = hoy();
  const body: PaginaFacturasSocio = { filas: filas.map((f) => toFactura(f, fecha)), total: Number(filas[0]?.total_filas ?? 0), porPagina: POR_PAGINA };
  ok(res, body);
});

socioRouter.get('/facturas/:id', async (req, res) => {
  const socio = await socioDe(req);
  const id = idParam(req);
  const [fila] = await facturasDe(socio.id, 'una', { id });
  const comprobante = fila ? await Comprobante.findByPk(id) : null;
  if (!fila || !comprobante) throw notFound('No encontramos esa factura');

  const snap = comprobante.snapshotJson;
  const n = comprobante.anio * 12 + comprobante.mes;
  const [renglones, cuadros, anterior, pagos, relacionado] = await Promise.all([
    ComprobanteRenglon.findAll({ where: { comprobanteId: id }, order: [['orden', 'ASC']] }),
    snap.tarifas.cuadros.length ? CuadroTarifario.findAll({ where: { id: snap.tarifas.cuadros }, include: [{ model: Escalon, as: 'escalones' }] }) : [],
    comprobante.servicioConexionId === null
      ? null
      : Comprobante.findOne({
          where: {
            servicioConexionId: comprobante.servicioConexionId,
            tipo: 'factura',
            estado: { [Op.in]: ['emitido', 'pagado'] },
            [Op.and]: [sequelize.where(sequelize.literal('anio * 12 + mes'), n - 1)],
          },
          attributes: ['anio', 'mes', 'consumo'],
        }),
    sequelize.query<{ id: number; letra: string; punto_venta: number; numero: number; cobrado_el: Date; importe: string; medio: MedioPago; origen: string }>(
      `SELECT p.id, p.letra, p.punto_venta, p.numero, p.cobrado_el, a.importe, p.medio, p.origen
       FROM pago_aplicaciones a JOIN pagos p ON p.id = a.pago_id AND p.estado = 'acreditado'
       WHERE a.cooperativa_id = :cooperativaId AND a.comprobante_id = :id ORDER BY p.cobrado_el`,
      { replacements: { cooperativaId: requireCooperativaId(), id }, type: QueryTypes.SELECT },
    ),
    comprobante.origenId !== null ? Comprobante.findByPk(comprobante.origenId) : Comprobante.findOne({ where: { origenId: id } }),
  ]);
  const calculo = calculoDe(comprobante, renglones);
  const porQue =
    calculo && comprobante.tipo === 'factura'
      ? explicarFactura({
          servicio: comprobante.servicio,
          categoria: snap.categoria,
          tieneSubsidio: snap.tieneSubsidio,
          renglones: calculo.renglones,
          totales: calculo.totales,
          consumo: calculo.consumo,
          avisos: calculo.avisos,
          cuadros: cuadros.map((c) => toCuadro(c)),
          anterior: anterior?.consumo != null ? { anio: anterior.anio, mes: anterior.mes, consumo: Number(anterior.consumo) } : null,
        })
      : null;
  const factura = toFactura(fila, hoy());
  const body: FacturaSocioDetalle = {
    ...factura,
    conexion: snap.conexion,
    categoria: snap.categoria as Categoria | null,
    tieneSubsidio: snap.tieneSubsidio,
    plan: snap.plan,
    calculo,
    porQue,
    codigoDeBarras:
      comprobante.tipo === 'factura' && comprobante.venceEl ? codigoDeBarras({ cooperativaId: comprobante.cooperativaId, id: comprobante.id, venceEl: comprobante.venceEl, total: factura.total }) : null,
    pagos: pagos.map((p) => ({
      id: p.id,
      referencia: referenciaRecibo({ letra: p.letra, puntoVenta: p.punto_venta, numero: p.numero }),
      cobradoEl: p.cobrado_el.toISOString(),
      importe: Number(p.importe).toFixed(2),
      medio: p.medio,
      online: p.origen === 'online',
    })),
    relacionado: relacionado ? { id: relacionado.id, referencia: referenciaComprobante(relacionado) } : null,
  };
  ok(res, body);
});

socioRouter.get('/facturas/:id/pdf', async (req, res) => {
  const socio = await socioDe(req);
  const id = idParam(req);
  const propia = await Comprobante.count({ where: { id, socioId: socio.id, estado: { [Op.ne]: 'borrador' } } });
  const r = propia ? await pdfDeComprobante(id) : null;
  if (!r) throw notFound('No encontramos esa factura');
  enviarPdf(res, r.pdf, r.nombre);
});

/* ───────────────────────── Consumo ───────────────────────── */

socioRouter.get('/consumo', async (req, res) => {
  const socio = await socioDe(req);
  const cooperativaId = requireCooperativaId();
  const servicios = await ServicioConexionModel.findAll({
    where: { servicio: [...SERVICIOS_MEDIDOS], estado: { [Op.ne]: 'baja' } },
    include: [{ model: Conexion, as: 'conexion', where: { socioId: socio.id }, required: true, include: [{ association: 'zona' }] }],
    order: [[{ model: Conexion, as: 'conexion' }, 'numero', 'ASC']],
  });
  // Primero la energía, después el agua.
  servicios.sort((a, b) => SERVICIOS_MEDIDOS.indexOf(a.servicio as ServicioMedido) - SERVICIOS_MEDIDOS.indexOf(b.servicio as ServicioMedido));

  const resultado: ConsumoServicio[] = [];
  for (const sc of servicios) {
    const conexion = (sc as unknown as { conexion: Conexion & { zona?: { nombre: string } | null } }).conexion;
    const propios = await sequelize.query<{ n: number; consumo: string; estimada: boolean }>(
      `SELECT p.anio * 12 + p.mes AS n, sum(l.consumo) AS consumo, bool_or(l.tipo = 'estimada') AS estimada
       FROM lecturas l JOIN medidores m ON m.id = l.medidor_id JOIN periodos p ON p.id = l.periodo_id
       WHERE l.cooperativa_id = :cooperativaId AND m.servicio_conexion_id = :sc AND l.consumo IS NOT NULL
       GROUP BY p.anio, p.mes ORDER BY n DESC LIMIT 12`,
      { replacements: { cooperativaId, sc: sc.id }, type: QueryTypes.SELECT },
    );
    if (propios.length === 0) continue;
    const hasta = Number(propios[0]!.n);
    const desde = hasta - 11;
    // Promedio de las conexiones de la misma zona, servicio y categoría, mes por mes.
    const zona = conexion.zonaId
      ? await sequelize.query<{ n: number; promedio: string }>(
          `SELECT t.n, avg(t.consumo) AS promedio FROM (
             SELECT p.anio * 12 + p.mes AS n, m.servicio_conexion_id, sum(l.consumo) AS consumo
             FROM lecturas l
             JOIN medidores m ON m.id = l.medidor_id
             JOIN servicios_conexion sc ON sc.id = m.servicio_conexion_id AND sc.servicio = :servicio AND sc.categoria IS NOT DISTINCT FROM :categoria
             JOIN conexiones c ON c.id = sc.conexion_id AND c.zona_id = :zona
             JOIN periodos p ON p.id = l.periodo_id
             WHERE l.cooperativa_id = :cooperativaId AND l.consumo IS NOT NULL AND (p.anio * 12 + p.mes) BETWEEN :desde AND :hasta
             GROUP BY 1, 2) t
           GROUP BY t.n`,
          { replacements: { cooperativaId, servicio: sc.servicio, categoria: sc.categoria, zona: conexion.zonaId, desde, hasta }, type: QueryTypes.SELECT },
        )
      : [];
    const propioDe = new Map(propios.map((p) => [Number(p.n), p]));
    const zonaDe = new Map(zona.map((z) => [Number(z.n), Number(z.promedio)]));
    resultado.push({
      servicio: sc.servicio as ServicioMedido,
      unidad: UNIDAD_SERVICIO[sc.servicio as ServicioMedido],
      conexion: { numero: conexion.numero, direccion: conexion.direccion },
      zona: conexion.zona?.nombre ?? null,
      categoria: sc.categoria,
      meses: Array.from({ length: 12 }, (_, i) => {
        const n = desde + i;
        const anio = Math.floor((n - 1) / 12);
        const p = propioDe.get(n);
        const promedio = zonaDe.get(n);
        return { anio, mes: n - anio * 12, consumo: p ? Number(p.consumo) : null, estimada: p?.estimada ?? false, promedioZona: promedio === undefined ? null : Math.round(promedio * 10) / 10 };
      }),
    });
  }
  ok(res, { servicios: resultado });
});

/* ───────────────────────── Mi cuenta ───────────────────────── */

socioRouter.get('/cuenta', async (req, res) => {
  const socio = await socioDe(req);
  ok(res, await detalleSocio(socio.id));
});

socioRouter.put('/contacto', async (req, res) => {
  const datos = parse(contactoSchema, req.body);
  const socio = await socioDe(req);
  const antes = { email: socio.email, telefono: socio.telefono, facturaDigital: socio.facturaDigital };
  await socio.update({ email: datos.email, telefono: datos.telefono, facturaDigital: datos.facturaDigital });
  await writeAudit({ accion: 'actualizar_contacto', entidad: 'socio', entidadId: socio.id, antes, despues: datos });
  ok(res, await detalleSocio(socio.id));
});

/* ───────────────────────── Pagos ───────────────────────── */

socioRouter.get('/pagos', async (req, res) => {
  const socio = await socioDe(req);
  ok(res, (await listarPagos('socio', socio.id, 50)).filter((p) => p.estado === 'acreditado'));
});

socioRouter.get('/pagos/:id/recibo', async (req, res) => {
  const { formato } = parse(z.object({ formato: z.enum(FORMATOS_RECIBO).default('a4') }), req.query);
  const socio = await socioDe(req);
  const r = await reciboPdf(idParam(req), formato);
  if (!r || r.socioId !== socio.id) throw notFound('No encontramos ese recibo');
  enviarPdf(res, r.pdf, r.nombre);
});

/** El socio elige qué facturas paga: se crea el intento y se lo manda a la pasarela. */
socioRouter.post('/pagos', async (req, res) => {
  const { comprobantes } = parse(pagoSocioSchema, req.body);
  const socio = await socioDe(req);
  ok(res, await crearIntentoPago({ socio, comprobanteIds: comprobantes, origen: 'portal', usuarioId: req.auth!.userId }), 201);
});

/** Cómo quedó un pago online. Si el banco todavía no avisó, se le pregunta. */
socioRouter.get('/pagos/intentos/:id', async (req, res) => {
  const { id } = parse(z.object({ id: z.uuid() }), req.params);
  const socio = await socioDe(req);
  const intento = await IntentoPago.findOne({ where: { id, socioId: socio.id } });
  if (!intento) throw notFound('No encontramos ese pago');
  const estado = await estadoIntento(intento);
  const pendientes = await facturasDe(socio.id, 'pendientes');
  const body: EstadoPagoOnline = { ...estado, deudaRestante: deCentavos(pendientes.reduce((t, f) => t + centavos(f.saldo), 0)) };
  ok(res, body);
});

/* ───────────────────────── Reclamos ───────────────────────── */

socioRouter.get('/reclamos', async (req, res) => {
  const socio = await socioDe(req);
  const filas = await filasReclamo('r.socio_id = :socioId', { socioId: socio.id }, 'ORDER BY (r.estado = \'resuelto\'), r.creado_el DESC LIMIT 30');
  const reclamos = await Reclamo.findAll({ where: { id: filas.map((f) => f.id) } });
  const porId = new Map(reclamos.map((r) => [r.id, r]));
  ok(res, await Promise.all(filas.map((f) => detalleReclamo(porId.get(f.id)!, true))));
});

socioRouter.post('/reclamos', async (req, res) => {
  const d = parse(reclamoSocioSchema, req.body);
  const socio = await socioDe(req);
  const conexion = await Conexion.findOne({ where: { id: d.conexionId, socioId: socio.id } });
  if (!conexion) throw notFound('No encontramos ese domicilio');
  if ((await Reclamo.count({ where: { socioId: socio.id, estado: { [Op.ne]: 'resuelto' } } })) >= MAX_RECLAMOS_ABIERTOS) {
    throw conflict('Ya tenés muchos reclamos abiertos. Esperá a que se resuelvan o llamá a la cooperativa.');
  }
  const reclamo = await crearReclamo({
    socioId: socio.id,
    conexionId: conexion.id,
    servicio: d.servicio,
    tipo: d.tipo,
    descripcion: d.descripcion,
    origen: 'portal',
    direccion: conexion.direccion,
    // Si el teléfono mandó dónde está, ese punto; si no, el de la casa.
    lat: d.lat ?? (conexion.lat === null ? null : Number(conexion.lat)),
    lng: d.lng ?? (conexion.lng === null ? null : Number(conexion.lng)),
    contacto: d.contacto ?? socio.telefono,
    foto: d.foto,
    usuarioId: req.auth!.userId,
  });
  ok(res, await detalleReclamo(reclamo, true), 201);
});

socioRouter.get('/reclamos/:id/foto', async (req, res) => {
  const socio = await socioDe(req);
  const reclamo = await Reclamo.findOne({ where: { id: idParam(req), socioId: socio.id } });
  const foto = reclamo ? await ReclamoFoto.findByPk(reclamo.id) : null;
  if (!foto) throw notFound('Ese reclamo no tiene foto');
  res.setHeader('Content-Type', foto.mime);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(foto.contenido);
});
