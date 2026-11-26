// Facturación (SPEC 6.5): el asistente del mes —cerrar la lectura, pre-facturar, revisar, emitir—,
// la consulta de comprobantes, su PDF y la nota de crédito.
import Decimal from 'decimal.js';
import { Router, type Response } from 'express';
import { Op, QueryTypes } from 'sequelize';
import {
  codigoDeBarras,
  comprobantesQuerySchema,
  MODELO_FACTURA_BASE,
  nombreDeMes,
  normalizeText,
  notaCreditoSchema,
  referenciaComprobante,
  type CalculoComprobante,
  type ComprobanteDetalle,
  type ComprobanteListado,
  type EstadoComprobante,
  type EstadoFacturacion,
  type EstadoPago,
  type MedioPago,
  type Anomalia,
  type MotivoLecturaMenor,
  type MotivoRara,
  type Novedad,
  type PaginaComprobantes,
  type ProcesoFacturacion,
  type Renglon,
  type ResumenEmision,
  type ResumenPrefactura,
  type ResumenServicio,
  type ServicioConexion,
  type TipoComprobante,
  type ModeloFactura,
} from '../shared';
import { config } from '../config';
import { sequelize } from '../db';
import { Comprobante, ComprobanteRenglon, Cooperativa, CooperativaImagen, Periodo, ProcesoFacturacionModel } from '../models';
import { writeAudit } from '../lib/audit';
import { conflict, idParam, notFound, ok, parse } from '../lib/errors';
import { avisarFacturas, calcularPrefacturas, emitirBorradores, lanzarProceso, reservarNumeros } from '../lib/facturacion';
import { sirveParaPdf } from '../lib/imagenes';
import { controlDeCierre } from '../lib/lecturas';
import { pdfComprobante } from '../lib/pdf-comprobante';
import { cargarParametros, hoy } from '../lib/tarifas';
import { requireCooperativaId } from '../lib/tenant';
import { requireRole } from '../middlewares/auth';
import { proveedorFiscal } from '../proveedores/fiscal';

export const facturacionRouter = Router();
// Ver: quienes facturan o deciden. Cerrar, calcular, emitir y anular: facturación y administración.
facturacionRouter.use(requireRole('admin', 'facturacion', 'gerencia'));
const quienFactura = requireRole('admin', 'facturacion');

const POR_PAGINA = 50;
const limpio = (v: string | null) => (v === null ? null : new Decimal(v).toFixed());
const dinero = (v: string) => new Decimal(v).toFixed(2);

/** El último mes abierto: es el que se está trabajando (energía y agua avanzan juntas). */
async function mesDeTrabajo(): Promise<Periodo | null> {
  return Periodo.findOne({ order: [['anio', 'DESC'], ['mes', 'DESC']] });
}

function toProceso(p: ProcesoFacturacionModel): ProcesoFacturacion {
  return {
    id: p.id,
    tipo: p.tipo,
    estado: p.estado,
    total: p.total,
    hechas: p.hechas,
    error: p.error,
    iniciadoEl: p.creadoEl.toISOString(),
    terminadoEl: p.terminadoEl ? p.terminadoEl.toISOString() : null,
  };
}

/* ───────────────────────── El asistente: en qué paso está el mes ───────────────────────── */

interface FilaResumen {
  servicio: ServicioConexion;
  borrador: boolean;
  cantidad: string;
  total: string;
  consumo: string | null;
  estimadas: string;
  raras: string;
  sin_revisar: string;
  errores: string;
  calculada_el: Date | null;
  emitida_el: string | null;
  vence_el: string | null;
}

async function estadoDelMes(): Promise<EstadoFacturacion> {
  const cooperativaId = requireCooperativaId();
  const [periodo, parametros] = await Promise.all([mesDeTrabajo(), cargarParametros()]);
  const fecha = hoy();
  const base = { hoy: fecha, diasVencimiento: parametros.diasVencimiento };
  if (!periodo) {
    return { ...base, mes: null, proximo: { anio: Number(fecha.slice(0, 4)), mes: Number(fecha.slice(5, 7)) }, control: null, prefactura: null, emision: null, proceso: null };
  }
  const { anio, mes } = periodo;
  const replacements = { cooperativaId, anio, mes };

  const [filas, rangos, avisos, proceso, emisionHecha, control] = await Promise.all([
    sequelize.query<FilaResumen>(
      `SELECT servicio, (estado = 'borrador') AS borrador, count(*) AS cantidad, sum(total) AS total, sum(consumo) AS consumo,
              count(*) FILTER (WHERE estimada) AS estimadas,
              count(*) FILTER (WHERE rara IS NOT NULL) AS raras,
              count(*) FILTER (WHERE rara IS NOT NULL AND revisada_el IS NULL) AS sin_revisar,
              count(*) FILTER (WHERE error IS NOT NULL) AS errores,
              max(creado_el) AS calculada_el, to_char(max(emitido_el), 'YYYY-MM-DD') AS emitida_el, to_char(max(vence_el), 'YYYY-MM-DD') AS vence_el
       FROM comprobantes
       WHERE cooperativa_id = :cooperativaId AND anio = :anio AND mes = :mes AND tipo = 'factura'
       GROUP BY servicio, (estado = 'borrador')
       ORDER BY servicio`,
      { replacements, type: QueryTypes.SELECT },
    ),
    sequelize.query<{ letra: string; punto_venta: number; desde: number; hasta: number }>(
      `SELECT letra, punto_venta, min(numero) AS desde, max(numero) AS hasta FROM comprobantes
       WHERE cooperativa_id = :cooperativaId AND anio = :anio AND mes = :mes AND tipo = 'factura' AND numero IS NOT NULL
       GROUP BY letra, punto_venta ORDER BY letra`,
      { replacements, type: QueryTypes.SELECT },
    ),
    sequelize.query<{ n: string }>(
      `SELECT count(*) AS n FROM notificaciones n JOIN comprobantes c ON c.id = n.comprobante_id
       WHERE n.cooperativa_id = :cooperativaId AND c.anio = :anio AND c.mes = :mes`,
      { replacements, type: QueryTypes.SELECT },
    ),
    ProcesoFacturacionModel.findOne({ where: { anio, mes }, order: [['id', 'DESC']] }),
    ProcesoFacturacionModel.findOne({ where: { anio, mes, tipo: 'emision', estado: 'terminado' }, order: [['id', 'DESC']] }),
    periodo.estado === 'en_lectura' ? controlDeCierre() : null,
  ]);

  const resumen = (borrador: boolean) => {
    const propias = filas.filter((f) => f.borrador === borrador);
    const porServicio: ResumenServicio[] = propias.map((f) => ({ servicio: f.servicio, cantidad: Number(f.cantidad), total: dinero(f.total), consumo: limpio(f.consumo) }));
    const suma = (clave: 'cantidad' | 'estimadas' | 'raras' | 'sin_revisar' | 'errores') => propias.reduce((t, f) => t + Number(f[clave]), 0);
    return { propias, porServicio, suma, total: propias.reduce((t, f) => t.plus(f.total), new Decimal(0)).toFixed(2) };
  };
  const b = resumen(true);
  const e = resumen(false);

  const prefactura: ResumenPrefactura | null =
    periodo.estado === 'prefacturado'
      ? {
          cantidad: b.suma('cantidad'),
          total: b.total,
          porServicio: b.porServicio,
          estimadas: b.suma('estimadas'),
          raras: b.suma('raras'),
          rarasSinRevisar: b.suma('sin_revisar'),
          errores: b.suma('errores'),
          calculadaEl: b.propias.reduce<Date | null>((ultima, f) => (f.calculada_el && (!ultima || f.calculada_el > ultima) ? f.calculada_el : ultima), null)?.toISOString() ?? null,
        }
      : null;
  const emision: ResumenEmision | null =
    e.suma('cantidad') > 0
      ? {
          cantidad: e.suma('cantidad'),
          total: e.total,
          porServicio: e.porServicio,
          emitidaEl: e.propias.reduce<string | null>((ultima, f) => (f.emitida_el && (!ultima || f.emitida_el > ultima) ? f.emitida_el : ultima), null),
          venceEl: e.propias.reduce<string | null>((ultima, f) => (f.vence_el && (!ultima || f.vence_el > ultima) ? f.vence_el : ultima), null),
          rangos: rangos.map((r) => ({ letra: r.letra, puntoVenta: r.punto_venta, desde: r.desde, hasta: r.hasta })),
          avisos: Number(avisos[0]?.n ?? 0),
          pendientes: b.suma('cantidad') - b.suma('errores'),
          segundos: emisionHecha?.terminadoEl ? Math.max((emisionHecha.terminadoEl.getTime() - emisionHecha.creadoEl.getTime()) / 1000, 0.1) : null,
        }
      : null;

  return {
    ...base,
    mes: { anio, mes, estado: periodo.estado },
    proximo: { anio: mes === 12 ? anio + 1 : anio, mes: mes === 12 ? 1 : mes + 1 },
    control,
    prefactura,
    emision,
    // Un trabajo terminado ya no hace falta mostrarlo: se ve su resultado.
    proceso: proceso && proceso.estado !== 'terminado' ? toProceso(proceso) : null,
  };
}

facturacionRouter.get('/estado', async (_req, res) => {
  ok(res, await estadoDelMes());
});

/* ───────────────────────── Pasos 2 y 3: cerrar la lectura y calcular ───────────────────────── */

/**
 * Cierra la lectura del mes y calcula todas las pre-facturas en segundo plano. Con el mes ya
 * pre-facturado, vuelve a calcular (por ejemplo, después de corregir una tarifa).
 */
facturacionRouter.post('/prefacturar', quienFactura, async (_req, res) => {
  const periodo = await mesDeTrabajo();
  if (!periodo || (periodo.estado !== 'en_lectura' && periodo.estado !== 'prefacturado')) throw conflict('No hay ningún mes con la lectura abierta para facturar');
  const { anio, mes } = periodo;

  if (periodo.estado === 'en_lectura') {
    const control = await controlDeCierre();
    if (control.total === 0) throw conflict('Este mes no tiene medidores para leer');
    if (control.bloqueantes > 0) {
      throw conflict(
        control.estimables > 0
          ? `Todavía faltan ${control.estimables} medidores por leer. Estimalos o esperá a que los operarios terminen.`
          : `Hay ${control.sinResolver} lecturas menores a la anterior sin aclarar. Resolvelas en Lecturas.`,
      );
    }
  }

  const proceso = await lanzarProceso('prefactura', { anio, mes }, async (avanzar) => {
    if (periodo.estado === 'en_lectura') {
      // La lectura se cierra antes de calcular: lo que llegue después del teléfono ya no entra.
      await sequelize.transaction(async (transaction) => {
        await Periodo.update({ estado: 'prefacturado' }, { where: { anio, mes, estado: 'en_lectura' }, transaction });
        await writeAudit({ accion: 'cerrar_lectura', entidad: 'periodo', entidadId: periodo.id, despues: { anio, mes }, transaction });
      });
    }
    const r = await calcularPrefacturas({ anio, mes, fechaEmision: hoy(), alAvanzar: avanzar });
    await writeAudit({ accion: 'prefacturar', entidad: 'periodo', entidadId: periodo.id, despues: { anio, mes, ...r } });
  });
  ok(res, toProceso(proceso), 202);
});

/** Vuelve atrás: borra las pre-facturas y reabre la lectura (para corregir o completar lecturas). */
facturacionRouter.post('/reabrir', quienFactura, async (_req, res) => {
  const periodo = await mesDeTrabajo();
  if (!periodo || periodo.estado !== 'prefacturado') throw conflict('Ese mes no está pre-facturado');
  const { anio, mes } = periodo;
  if (await ProcesoFacturacionModel.count({ where: { estado: 'en_curso' } })) throw conflict('Hay un trabajo de facturación en marcha. Esperá a que termine.');
  if (await Comprobante.count({ where: { anio, mes, tipo: 'factura', estado: { [Op.ne]: 'borrador' } } })) {
    throw conflict(`Ya hay facturas emitidas de ${nombreDeMes(anio, mes)}: la lectura no se puede reabrir`);
  }
  await sequelize.transaction(async (transaction) => {
    const borradas = await Comprobante.destroy({ where: { anio, mes, estado: 'borrador' }, transaction });
    await Periodo.update({ estado: 'en_lectura' }, { where: { anio, mes }, transaction });
    await writeAudit({ accion: 'reabrir_lectura', entidad: 'periodo', entidadId: periodo.id, antes: { prefacturas: borradas }, despues: { anio, mes }, transaction });
  });
  ok(res, { anio, mes });
});

/* ───────────────────────── Paso 4: emitir ───────────────────────── */

facturacionRouter.post('/emitir', quienFactura, async (_req, res) => {
  const periodo = await mesDeTrabajo();
  if (!periodo || periodo.estado !== 'prefacturado') throw conflict('Primero hay que cerrar la lectura y calcular las pre-facturas');
  const { anio, mes } = periodo;
  const [conError, listas] = await Promise.all([
    Comprobante.count({ where: { anio, mes, estado: 'borrador', error: { [Op.ne]: null } } }),
    Comprobante.count({ where: { anio, mes, estado: 'borrador', error: null } }),
  ]);
  if (conError > 0) throw conflict(`Hay ${conError} ${conError === 1 ? 'factura que no se pudo' : 'facturas que no se pudieron'} calcular. Resolvelas y volvé a calcular antes de emitir.`);
  if (listas === 0) throw conflict('No hay pre-facturas para emitir. Volvé a calcular.');

  const parametros = await cargarParametros();
  const fechaEmision = hoy();
  const proceso = await lanzarProceso('emision', { anio, mes }, async (avanzar) => {
    const { emitidas } = await emitirBorradores({ anio, mes, fechaEmision, diasVencimiento: parametros.diasVencimiento, alAvanzar: avanzar });
    await Periodo.update({ estado: 'emitido' }, { where: { anio, mes, estado: 'prefacturado' } });
    const avisos = await avisarFacturas(anio, mes);
    await writeAudit({ accion: 'emitir', entidad: 'periodo', entidadId: periodo.id, despues: { anio, mes, emitidas, avisos, fechaEmision } });
  });
  ok(res, toProceso(proceso), 202);
});

/* ───────────────────────── Comprobantes ───────────────────────── */

interface FilaComprobante {
  id: number;
  cooperativa_id: number;
  tipo: TipoComprobante;
  letra: string;
  punto_venta: number;
  numero: number | null;
  servicio: ServicioConexion;
  anio: number;
  mes: number;
  socio_id: number;
  socio_numero: number;
  socio_nombre: string;
  direccion: string | null;
  total: string;
  saldo: string;
  estado: EstadoComprobante;
  estimada: boolean;
  consumo: string | null;
  rara: MotivoRara | null;
  revisada_el: Date | null;
  total_anterior: string | null;
  variacion: string | null;
  error: string | null;
  emitido_el: string | null;
  vence_el: string | null;
  total_filas: string;
}

const COLUMNAS = `c.id, c.cooperativa_id, c.tipo, c.letra, c.punto_venta, c.numero, c.servicio, c.anio, c.mes, c.socio_id, s.numero AS socio_numero,
  s.nombre AS socio_nombre, cx.direccion, c.total, c.saldo, c.estado, c.estimada, c.consumo, c.rara, c.revisada_el, c.total_anterior, c.variacion,
  c.error, to_char(c.emitido_el, 'YYYY-MM-DD') AS emitido_el, to_char(c.vence_el, 'YYYY-MM-DD') AS vence_el`;
const DESDE = `FROM comprobantes c JOIN socios s ON s.id = c.socio_id LEFT JOIN conexiones cx ON cx.id = c.conexion_id`;

function toListado(f: FilaComprobante): ComprobanteListado {
  const numeracion = { tipo: f.tipo, letra: f.letra, puntoVenta: f.punto_venta, numero: f.numero };
  return {
    id: f.id,
    ...numeracion,
    referencia: referenciaComprobante(numeracion),
    servicio: f.servicio,
    anio: f.anio,
    mes: f.mes,
    socio: { id: f.socio_id, numero: f.socio_numero, nombre: f.socio_nombre },
    direccion: f.direccion,
    total: dinero(f.total),
    saldo: dinero(f.saldo),
    estado: f.estado,
    estimada: f.estimada,
    consumo: limpio(f.consumo),
    rara: f.rara,
    revisada: f.revisada_el !== null,
    totalAnterior: f.total_anterior === null ? null : dinero(f.total_anterior),
    variacion: f.variacion === null ? null : Number(f.variacion),
    error: f.error,
    emitidoEl: f.emitido_el,
    venceEl: f.vence_el,
  };
}

// Condiciones fijas: nunca se arman con texto del pedido.
const VISTA = {
  todas: '',
  por_revisar: 'AND c.rara IS NOT NULL AND c.revisada_el IS NULL',
  raras: 'AND c.rara IS NOT NULL',
  errores: 'AND c.error IS NOT NULL',
} as const;

facturacionRouter.get('/comprobantes', async (req, res) => {
  const q = parse(comprobantesQuerySchema, req.query);
  const donde = ['c.cooperativa_id = :cooperativaId'];
  if (q.anio !== undefined) donde.push('c.anio = :anio');
  if (q.mes !== undefined) donde.push('c.mes = :mes');
  if (q.servicio) donde.push('c.servicio = :servicio');
  if (q.estado) donde.push('c.estado = :estado');

  // Un solo campo de búsqueda: número de socio, documento o comprobante si son cifras; si no, nombre o domicilio.
  const texto = q.q ? normalizeText(q.q) : '';
  const cifras = q.q ? q.q.replace(/\D/g, '') : '';
  let numero: number | null = null;
  if (q.q && cifras && /^[\d\s.-]+$/.test(q.q)) {
    // "0006-00001234" → el número es lo que viene después del guion.
    const n = Number(q.q.includes('-') ? q.q.split('-').pop()!.replace(/\D/g, '') : cifras);
    numero = Number.isSafeInteger(n) && n < 2_000_000_000 ? n : -1;
    donde.push(`(s.numero = :numero OR c.numero = :numero OR s.nro_doc = :cifras)`);
  } else if (texto) {
    donde.push(`(s.nombre_norm LIKE :texto OR cx.direccion_norm LIKE :texto)`);
  }

  const filas = await sequelize.query<FilaComprobante>(
    `SELECT ${COLUMNAS}, count(*) OVER () AS total_filas
     ${DESDE}
     WHERE ${donde.join(' AND ')} ${VISTA[q.vista]}
     ORDER BY ${q.vista === 'todas' ? 'c.anio DESC, c.mes DESC, c.orden, c.id' : 'abs(c.variacion) DESC NULLS LAST, c.id'}
     LIMIT :limite OFFSET :desde`,
    {
      replacements: {
        cooperativaId: requireCooperativaId(),
        anio: q.anio ?? null,
        mes: q.mes ?? null,
        servicio: q.servicio ?? null,
        estado: q.estado ?? null,
        numero,
        cifras,
        texto: `%${texto.replace(/[%_\\]/g, '')}%`,
        limite: POR_PAGINA,
        desde: (q.pagina - 1) * POR_PAGINA,
      },
      type: QueryTypes.SELECT,
    },
  );
  const body: PaginaComprobantes = { filas: filas.map(toListado), total: Number(filas[0]?.total_filas ?? 0), porPagina: POR_PAGINA };
  ok(res, body);
});

/** El cálculo guardado de un comprobante, en la forma que lo dibuja la pantalla. `null` si no se pudo calcular. */
export function calculoDe(comprobante: Comprobante, renglones: ComprobanteRenglon[]): CalculoComprobante | null {
  if (comprobante.error) return null;
  const snap = comprobante.snapshotJson;
  return {
    servicio: comprobante.servicio,
    periodo: { anio: comprobante.anio, mes: comprobante.mes, ...snap.periodo },
    consumo: snap.consumo,
    dias: snap.dias,
    diasActivos: snap.diasActivos,
    estimada: comprobante.estimada,
    avisos: snap.avisos,
    totales: snap.totales,
    renglones: renglones.map(
      (r): Renglon => ({
        grupo: r.grupo,
        codigo: r.codigo,
        servicio: r.servicio,
        descripcion: r.descripcion,
        cantidad: limpio(r.cantidad ?? null),
        unitario: limpio(r.unitario ?? null),
        porcentaje: limpio(r.porcentaje ?? null),
        base: r.base == null ? null : dinero(r.base),
        importe: dinero(r.importe),
        ...(r.subsidiado ? { subsidiado: true } : {}),
        ...(r.nota ? { nota: r.nota } : {}),
      }),
    ),
  };
}

/** Todo lo que se sabe de un comprobante: lo guardado en él más sus renglones. */
async function detalleDe(id: number): Promise<{ detalle: ComprobanteDetalle; comprobante: Comprobante } | null> {
  const cooperativaId = requireCooperativaId();
  const comprobante = await Comprobante.findByPk(id);
  if (!comprobante) return null;
  const [filas, renglones, relacionado, lecturas, pagos] = await Promise.all([
    sequelize.query<FilaComprobante>(`SELECT ${COLUMNAS}, 1 AS total_filas ${DESDE} WHERE c.cooperativa_id = :cooperativaId AND c.id = :id`, {
      replacements: { cooperativaId, id },
      type: QueryTypes.SELECT,
    }),
    ComprobanteRenglon.findAll({ where: { comprobanteId: id }, order: [['orden', 'ASC']] }),
    comprobante.origenId !== null ? Comprobante.findByPk(comprobante.origenId) : Comprobante.findOne({ where: { origenId: id }, order: [['id', 'DESC']] }),
    comprobante.periodoId === null || comprobante.servicioConexionId === null
      ? []
      : sequelize.query<{
          id: number;
          medidor: string;
          valor: string | null;
          anterior: string | null;
          tipo: 'real' | 'estimada';
          motivo: MotivoLecturaMenor | null;
          anomalia: Anomalia | null;
          novedad: Novedad | null;
          nota: string | null;
          tiene_foto: boolean;
        }>(
          `SELECT l.id, m.numero AS medidor, l.valor, l.anterior, l.tipo, l.motivo, l.anomalia, l.novedad, l.nota, l.tiene_foto
           FROM lecturas l JOIN medidores m ON m.id = l.medidor_id
           WHERE l.cooperativa_id = :cooperativaId AND l.periodo_id = :periodoId AND m.servicio_conexion_id = :servicioConexionId
           ORDER BY m.id`,
          { replacements: { cooperativaId, periodoId: comprobante.periodoId, servicioConexionId: comprobante.servicioConexionId }, type: QueryTypes.SELECT },
        ),
    sequelize.query<{ id: number; letra: string; punto_venta: number; numero: number; cobrado_el: Date; medio: MedioPago; estado: EstadoPago; importe: string }>(
      `SELECT p.id, p.letra, p.punto_venta, p.numero, p.cobrado_el, p.medio, p.estado, a.importe
       FROM pago_aplicaciones a JOIN pagos p ON p.id = a.pago_id
       WHERE a.cooperativa_id = :cooperativaId AND a.comprobante_id = :id ORDER BY p.cobrado_el, p.id`,
      { replacements: { cooperativaId, id }, type: QueryTypes.SELECT },
    ),
  ]);
  const listado = toListado(filas[0]!);
  const snap = comprobante.snapshotJson;
  const calculo = calculoDe(comprobante, renglones);
  const detalle: ComprobanteDetalle = {
    ...listado,
    titular: snap.titular,
    conexion: snap.conexion,
    categoria: snap.categoria,
    tieneSubsidio: snap.tieneSubsidio,
    plan: snap.plan,
    calculo,
    lecturas: lecturas.map((l) => ({
      id: l.id,
      medidor: l.medidor,
      valor: l.valor === null ? null : Number(l.valor),
      anterior: l.anterior === null ? null : Number(l.anterior),
      tipo: l.tipo,
      motivo: l.motivo,
      anomalia: l.anomalia,
      novedad: l.novedad,
      nota: l.nota,
      tieneFoto: l.tiene_foto,
    })),
    motivo: comprobante.motivo,
    relacionado: relacionado
      ? { id: relacionado.id, referencia: referenciaComprobante({ tipo: relacionado.tipo, letra: relacionado.letra, puntoVenta: relacionado.puntoVenta, numero: relacionado.numero }) }
      : null,
    cae: comprobante.cae,
    caeVence: comprobante.caeVence,
    codigoDeBarras:
      comprobante.tipo === 'factura' && comprobante.venceEl ? codigoDeBarras({ cooperativaId: comprobante.cooperativaId, id: comprobante.id, venceEl: comprobante.venceEl, total: listado.total }) : null,
    pagos: pagos.map((p) => ({
      id: p.id,
      referencia: referenciaComprobante({ tipo: 'recibo', letra: p.letra, puntoVenta: p.punto_venta, numero: p.numero }),
      cobradoEl: p.cobrado_el.toISOString(),
      medio: p.medio,
      estado: p.estado,
      importe: dinero(p.importe),
    })),
  };
  return { detalle, comprobante };
}

facturacionRouter.get('/comprobantes/:id', async (req, res) => {
  const r = await detalleDe(idParam(req));
  if (!r) throw notFound('No encontramos ese comprobante');
  ok(res, r.detalle);
});

/** La persona de facturación ya miró esa pre-factura rara: sale de la lista de pendientes. */
facturacionRouter.post('/comprobantes/:id/revisar', quienFactura, async (req, res) => {
  const comprobante = await Comprobante.findByPk(idParam(req));
  if (!comprobante) throw notFound('No encontramos ese comprobante');
  if (comprobante.estado !== 'borrador') throw conflict('Esa factura ya está emitida');
  if (!comprobante.revisadaEl) await comprobante.update({ revisadaEl: new Date(), revisadaPor: req.auth!.userId });
  ok(res, { id: comprobante.id });
});

/**
 * El PDF de un comprobante, armado con lo que tiene guardado. `null` si no existe en esta cooperativa.
 * `modelo` reemplaza el diseño guardado (para la vista previa del panel de SRV).
 */
export async function pdfDeComprobante(id: number, opciones: { modelo?: ModeloFactura } = {}): Promise<{ pdf: Buffer; nombre: string } | null> {
  const r = await detalleDe(id);
  if (!r) return null;
  const { detalle, comprobante } = r;
  const cooperativaId = requireCooperativaId();
  const n = comprobante.anio * 12 + comprobante.mes;
  const [coop, imagenes, historial] = await Promise.all([
    Cooperativa.findByPk(cooperativaId),
    CooperativaImagen.findAll({ attributes: ['tipo', 'contenido'] }),
    comprobante.servicioConexionId === null || detalle.calculo?.consumo == null
      ? []
      : sequelize.query<{ anio: number; mes: number; consumo: string; estimada: boolean }>(
          `SELECT p.anio, p.mes, sum(l.consumo) AS consumo, bool_or(l.tipo = 'estimada') AS estimada
           FROM lecturas l JOIN periodos p ON p.id = l.periodo_id JOIN medidores m ON m.id = l.medidor_id
           WHERE l.cooperativa_id = :cooperativaId AND m.servicio_conexion_id = :servicioConexionId AND l.consumo IS NOT NULL
             AND (p.anio * 12 + p.mes) BETWEEN :n - 12 AND :n
           GROUP BY p.anio, p.mes ORDER BY p.anio, p.mes`,
          { replacements: { cooperativaId, servicioConexionId: comprobante.servicioConexionId, n }, type: QueryTypes.SELECT },
        ),
  ]);
  const modelo = opciones.modelo ?? coop!.configJson.factura ?? MODELO_FACTURA_BASE;
  // El logo propio de la factura; si no hay, el isotipo de la app.
  const imagen = (tipo: string) => imagenes.find((i) => i.tipo === tipo)?.contenido;
  const logo = modelo.conLogo ? ([imagen('factura'), imagen('isotipo')].find(sirveParaPdf) ?? null) : null;
  const pdf = await pdfComprobante({
    cooperativa: { nombre: coop!.nombre, cuit: coop!.cuit, config: coop!.configJson, color: modelo.color ?? coop!.temaJson.colores.primario, modelo, logo },
    comprobante: detalle,
    historial: historial.map((h) => ({ anio: h.anio, mes: h.mes, consumo: Number(h.consumo), estimada: h.estimada })),
    urlPago: detalle.codigoDeBarras ? `${config.appUrl}/pagar/${detalle.codigoDeBarras}` : null,
    simulado: proveedorFiscal.simulado,
  });
  return { pdf, nombre: `${detalle.referencia.replace(/[^\w-]+/g, '-')}.pdf` };
}

/** Manda un PDF para ver en el navegador. */
export function enviarPdf(res: Response, pdf: Buffer, nombre: string): void {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${nombre}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(pdf);
}

facturacionRouter.get('/comprobantes/:id/pdf', async (req, res) => {
  const r = await pdfDeComprobante(idParam(req));
  if (!r) throw notFound('No encontramos ese comprobante');
  enviarPdf(res, r.pdf, r.nombre);
});

/**
 * Una factura emitida no se edita: se anula con una nota de crédito por el total (SPEC 6.5).
 * Solo si todavía no tiene pagos; con pagos, primero hay que anular el cobro (Caja).
 */
facturacionRouter.post('/comprobantes/:id/nota-credito', quienFactura, async (req, res) => {
  const { motivo } = parse(notaCreditoSchema, req.body);
  const id = idParam(req);
  const fecha = hoy();

  const nota = await sequelize.transaction(async (transaction) => {
    const factura = await Comprobante.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!factura) throw notFound('No encontramos ese comprobante');
    if (factura.tipo !== 'factura') throw conflict('Solo se puede anular una factura');
    if (factura.estado === 'borrador') throw conflict('Esa factura todavía no está emitida: volvé a calcular en lugar de anularla');
    if (factura.estado === 'anulado') throw conflict('Esa factura ya está anulada');
    if (factura.estado === 'pagado' || !new Decimal(factura.saldo).eq(factura.total)) throw conflict('Esa factura ya tiene pagos: no se puede anular desde acá');

    const numero = await reservarNumeros({ tipo: 'nota_credito', letra: factura.letra, puntoVenta: factura.puntoVenta }, 1, transaction);
    const autorizacion = (await proveedorFiscal.autorizar([{ id: 0, tipo: 'nota_credito', letra: factura.letra, puntoVenta: factura.puntoVenta, numero, total: factura.total, fecha }])).get(0);
    const creada = await Comprobante.create(
      {
        tipo: 'nota_credito',
        letra: factura.letra,
        puntoVenta: factura.puntoVenta,
        numero,
        socioId: factura.socioId,
        conexionId: factura.conexionId,
        servicioConexionId: factura.servicioConexionId,
        servicio: factura.servicio,
        anio: factura.anio,
        mes: factura.mes,
        periodoId: factura.periodoId,
        estado: 'emitido',
        emitidoEl: fecha,
        total: factura.total,
        saldo: '0',
        totalServicio: factura.totalServicio,
        consumo: factura.consumo,
        estimada: factura.estimada,
        origenId: factura.id,
        motivo,
        cae: autorizacion?.cae ?? null,
        caeVence: autorizacion?.caeVence ?? null,
        snapshotJson: factura.snapshotJson,
        creadoPor: req.auth!.userId,
      },
      { transaction },
    );
    const renglones = await ComprobanteRenglon.findAll({ where: { comprobanteId: factura.id }, order: [['orden', 'ASC']], transaction });
    await ComprobanteRenglon.bulkCreate(
      renglones.map((r) => {
        const { id: _id, comprobanteId: _c, ...resto } = r.get({ plain: true });
        return { ...resto, comprobanteId: creada.id };
      }),
      { transaction },
    );
    const antes = { estado: factura.estado, saldo: factura.saldo };
    await factura.update({ estado: 'anulado', saldo: '0' }, { transaction });
    await writeAudit({
      accion: 'anular_factura',
      entidad: 'comprobante',
      entidadId: factura.id,
      antes,
      despues: { notaCredito: creada.id, numero, motivo, total: factura.total },
      transaction,
    });
    return creada;
  });
  ok(res, { id: nota.id, referencia: referenciaComprobante({ tipo: nota.tipo, letra: nota.letra, puntoVenta: nota.puntoVenta, numero: nota.numero }) }, 201);
});
