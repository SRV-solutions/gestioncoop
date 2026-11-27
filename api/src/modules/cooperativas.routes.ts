// Panel del proveedor (SRV): todas las cooperativas de la plataforma, lo que se le cobra a cada una
// por las facturas que emite y el diseño de su factura. Solo el superadmin.
import { Router, type Response } from 'express';
import { col, fn, Op } from 'sequelize';
import {
  certificadoFiscalSchema,
  comisionSchema,
  configFiscalSchema,
  leerImagen,
  logoFacturaSchema,
  MODELO_FACTURA_BASE,
  modeloFacturaSchema,
  type ComisionCooperativa,
  type CooperativaResumen,
  type CooperativaSrv,
  type DisenoFactura,
  type LiquidacionPlataforma,
} from '../shared';
import { sequelize } from '../db';
import { ComisionSrv, Comprobante, Cooperativa, CooperativaImagen, Usuario } from '../models';
import { writeAudit } from '../lib/audit';
import { runInCooperativa, runUnscoped } from '../lib/context';
import { clearCooperativaCache, toCooperativaPublica } from '../lib/cooperativas';
import { badRequest, conflict, idParam, notFound, ok, parse } from '../lib/errors';
import { borrarCertificado, guardarCertificado, guardarConfigFiscal, probarConexion, sincronizarNumeracion, vistaConfigFiscal } from '../lib/fiscal';
import { emitirFacturasDePrueba } from '../lib/fiscal-prueba';
import { esImagen, sirveParaPdf } from '../lib/imagenes';
import { aVigencia, liquidacionDeCooperativa, liquidacionDelMes, mesesConFacturas, vigenteEl } from '../lib/srv';
import { hoy } from '../lib/tarifas';
import { requireSuperadmin } from '../middlewares/auth';
import { enviarPdf, pdfDeComprobante } from './facturacion.routes';

export const cooperativasRouter = Router();
cooperativasRouter.use(requireSuperadmin);

const CON_CARGADOR = { model: Usuario, as: 'cargador', attributes: ['nombre'] };

/** Las comisiones de una cooperativa, de la más nueva a la más vieja. */
const vigenciasDe = (cooperativaId: number) =>
  runInCooperativa(cooperativaId, () => ComisionSrv.findAll({ include: [CON_CARGADOR], order: [['desde', 'DESC']] }));

async function cooperativaOFalla(id: number): Promise<Cooperativa> {
  const coop = await Cooperativa.findByPk(id);
  if (!coop) throw notFound('No encontramos esa cooperativa');
  return coop;
}

cooperativasRouter.get('/', async (_req, res) => {
  const dia = hoy();
  const [cooperativas, counts, comisiones] = await Promise.all([
    Cooperativa.findAll({ order: [['id', 'ASC']] }),
    runUnscoped(() =>
      Usuario.findAll({
        attributes: ['cooperativaId', [fn('count', col('id')), 'cantidad']],
        group: ['cooperativaId'],
        raw: true,
      }),
    ) as unknown as Promise<{ cooperativaId: number | null; cantidad: string }[]>,
    runUnscoped(() => ComisionSrv.findAll({ where: { desde: { [Op.lte]: dia } }, order: [['desde', 'DESC']] })),
  ]);
  const byCooperativa = new Map(counts.map((c) => [c.cooperativaId, Number(c.cantidad)]));

  const body: CooperativaResumen[] = cooperativas.map((c) => {
    const vigente = comisiones.find((x) => x.cooperativaId === c.id);
    return {
      ...toCooperativaPublica(c),
      cuit: c.cuit,
      activa: c.activa,
      usuarios: byCooperativa.get(c.id) ?? 0,
      comision: vigente ? { porcentaje: String(Number(vigente.porcentaje)), fijoPorFactura: Number(vigente.fijoPorFactura).toFixed(2) } : null,
    };
  });
  ok(res, body);
});

/* ───────────────────────── Lo que se le cobra a cada cooperativa ───────────────────────── */

/** Un mes: lo que emitió cada cooperativa y lo que le corresponde a SRV. Por defecto, el último mes con facturas. */
cooperativasRouter.get('/liquidacion', async (req, res) => {
  const meses = await mesesConFacturas();
  const anio = Number(req.query.anio) || meses[0]?.anio || Number(hoy().slice(0, 4));
  const mes = Number(req.query.mes) || meses[0]?.mes || Number(hoy().slice(5, 7));
  if (!Number.isInteger(anio) || !Number.isInteger(mes) || mes < 1 || mes > 12 || anio < 2000 || anio > 2100) throw badRequest('Elegí un mes válido');

  // La comisión que se muestra es la que regía el último día del mes.
  const ultimoDia = new Date(Date.UTC(anio, mes, 0)).toISOString().slice(0, 10);
  const [cooperativas, filas, comisiones] = await Promise.all([
    Cooperativa.findAll({ order: [['id', 'ASC']] }),
    liquidacionDelMes(anio, mes),
    runUnscoped(() => ComisionSrv.findAll({ where: { desde: { [Op.lte]: ultimoDia } }, order: [['desde', 'DESC']] })),
  ]);
  let total = 0n;
  const body: LiquidacionPlataforma = {
    anio,
    mes,
    meses,
    filas: cooperativas.map((c) => {
      const fila = filas.find((f) => f.cooperativaId === c.id);
      const vigente = comisiones.find((x) => x.cooperativaId === c.id);
      const comision = fila?.comision ?? '0.00';
      total += BigInt(comision.replace('.', ''));
      return {
        cooperativa: { id: c.id, nombreCorto: c.nombreCorto },
        porcentaje: vigente ? String(Number(vigente.porcentaje)) : null,
        fijoPorFactura: vigente ? Number(vigente.fijoPorFactura).toFixed(2) : null,
        anio,
        mes,
        facturas: fila?.facturas ?? 0,
        notasCredito: fila?.notasCredito ?? 0,
        facturado: fila?.facturado ?? '0.00',
        acreditado: fila?.acreditado ?? '0.00',
        neto: fila?.neto ?? '0.00',
        comision,
      };
    }),
    total: `${total < 0n ? '-' : ''}${(total < 0n ? -total : total).toString().padStart(3, '0').replace(/(\d{2})$/, '.$1')}`,
  };
  ok(res, body);
});

/* ───────────────────────── Una cooperativa ───────────────────────── */

async function disenoDe(coop: Cooperativa): Promise<DisenoFactura> {
  const [imagenes, muestra] = await runInCooperativa(coop.id, () =>
    Promise.all([
      CooperativaImagen.findAll({ attributes: ['tipo'] }),
      Comprobante.count({ where: { tipo: 'factura', estado: { [Op.in]: ['emitido', 'pagado'] } } }),
    ]),
  );
  return {
    modelo: { ...MODELO_FACTURA_BASE, ...coop.configJson.factura },
    logoFactura: imagenes.some((i) => i.tipo === 'factura'),
    isotipo: imagenes.some((i) => i.tipo === 'isotipo'),
    colorMarca: coop.temaJson.colores.primario,
    hayMuestra: muestra > 0,
  };
}

async function comisionDe(coop: Cooperativa): Promise<ComisionCooperativa> {
  const dia = hoy();
  const [vigencias, meses] = await Promise.all([vigenciasDe(coop.id), liquidacionDeCooperativa(coop.id)]);
  const historial = vigencias.map(aVigencia);
  const proxima = [...historial].reverse().find((v) => v.desde > dia) ?? null;
  return { vigente: vigenteEl(historial, dia), proxima, historial, meses };
}

async function detalle(coop: Cooperativa): Promise<CooperativaSrv> {
  const [comision, factura] = await Promise.all([comisionDe(coop), disenoDe(coop)]);
  return { id: coop.id, nombre: coop.nombre, nombreCorto: coop.nombreCorto, subdominio: coop.subdominio, comision, factura };
}

cooperativasRouter.get('/:id', async (req, res) => {
  ok(res, await detalle(await cooperativaOFalla(idParam(req))));
});

/**
 * Comisión nueva, desde una fecha (hoy o después): lo ya emitido conserva la comisión de su día.
 * Una por fecha; para corregir una que todavía no rige, se borra y se carga otra.
 */
cooperativasRouter.post('/:id/comisiones', async (req, res) => {
  const coop = await cooperativaOFalla(idParam(req));
  const d = parse(comisionSchema, req.body);
  if (d.desde < hoy()) throw badRequest('Revisá los datos marcados', { desde: 'Tiene que regir desde hoy o más adelante: lo ya facturado no cambia' });
  await sequelize.transaction(async (transaction) => {
    const repetida = await runInCooperativa(coop.id, () => ComisionSrv.findOne({ where: { desde: d.desde }, transaction }));
    if (repetida) throw conflict('Ya hay una comisión cargada desde ese día. Borrala y cargá la nueva.');
    const nueva = await runInCooperativa(coop.id, () =>
      ComisionSrv.create(
        { cooperativaId: coop.id, desde: d.desde, porcentaje: String(d.porcentaje), fijoPorFactura: d.fijoPorFactura.toFixed(2), nota: d.nota, cargadoPor: req.auth!.userId },
        { transaction },
      ),
    );
    await writeAudit({
      accion: 'cargar_comision_srv',
      entidad: 'cooperativa',
      entidadId: coop.id,
      cooperativaId: coop.id,
      despues: { id: nueva.id, desde: d.desde, porcentaje: d.porcentaje, fijoPorFactura: d.fijoPorFactura },
      transaction,
    });
  });
  ok(res, await comisionDe(coop), 201);
});

/** Borra una comisión que todavía no rige (las que ya rigieron quedan: con ellas se liquidó). */
cooperativasRouter.delete('/:id/comisiones/:comisionId', async (req, res) => {
  const coop = await cooperativaOFalla(idParam(req));
  const comisionId = Number(req.params.comisionId);
  const comision = Number.isSafeInteger(comisionId) ? await runInCooperativa(coop.id, () => ComisionSrv.findByPk(comisionId)) : null;
  if (!comision) throw notFound('No encontramos esa comisión');
  if (comision.desde <= hoy()) throw conflict('Esa comisión ya rige: queda en el historial. Para cambiarla, cargá una nueva desde hoy.');
  await sequelize.transaction(async (transaction) => {
    await runInCooperativa(coop.id, () => comision.destroy({ transaction }));
    await writeAudit({ accion: 'borrar_comision_srv', entidad: 'cooperativa', entidadId: coop.id, cooperativaId: coop.id, antes: aVigencia(comision), transaction });
  });
  ok(res, await comisionDe(coop));
});

/* ───────────────────────── Diseño de la factura ───────────────────────── */

cooperativasRouter.put('/:id/factura', async (req, res) => {
  const coop = await cooperativaOFalla(idParam(req));
  const modelo = parse(modeloFacturaSchema, req.body);
  const antes = coop.configJson.factura ?? null;
  await sequelize.transaction(async (transaction) => {
    await coop.update({ configJson: { ...coop.configJson, factura: modelo } }, { transaction });
    await writeAudit({ accion: 'cambiar_diseno_factura', entidad: 'cooperativa', entidadId: coop.id, cooperativaId: coop.id, antes, despues: modelo, transaction });
  });
  clearCooperativaCache();
  ok(res, await disenoDe(coop));
});

/** El logo de la factura: PNG o JPEG, con sus proporciones (no se recorta). */
cooperativasRouter.put('/:id/factura/logo', async (req, res) => {
  const coop = await cooperativaOFalla(idParam(req));
  const { imagen } = parse(logoFacturaSchema, req.body);
  const leida = leerImagen(imagen);
  const contenido = leida ? Buffer.from(leida.base64, 'base64') : null;
  if (!leida || !contenido || !esImagen(leida.mime, contenido)) throw badRequest('Ese archivo no es una imagen que podamos usar. Probá con un PNG o un JPG.');
  await sequelize.transaction(async (transaction) => {
    await runInCooperativa(coop.id, async () => {
      const actual = await CooperativaImagen.findOne({ where: { tipo: 'factura' }, transaction });
      if (actual) await actual.update({ mime: leida.mime, contenido }, { transaction });
      else await CooperativaImagen.create({ cooperativaId: coop.id, tipo: 'factura', mime: leida.mime, contenido }, { transaction });
    });
    await writeAudit({ accion: 'cambiar_logo_factura', entidad: 'cooperativa', entidadId: coop.id, cooperativaId: coop.id, transaction });
  });
  ok(res, await disenoDe(coop));
});

cooperativasRouter.delete('/:id/factura/logo', async (req, res) => {
  const coop = await cooperativaOFalla(idParam(req));
  await sequelize.transaction(async (transaction) => {
    await runInCooperativa(coop.id, () => CooperativaImagen.destroy({ where: { cooperativaId: coop.id, tipo: 'factura' }, transaction }));
    await writeAudit({ accion: 'quitar_logo_factura', entidad: 'cooperativa', entidadId: coop.id, cooperativaId: coop.id, transaction });
  });
  ok(res, await disenoDe(coop));
});

/** El logo de la factura, para verlo en el panel. */
cooperativasRouter.get('/:id/factura/logo', async (req, res) => {
  const coop = await cooperativaOFalla(idParam(req));
  const logo = await runInCooperativa(coop.id, () => CooperativaImagen.findOne({ where: { tipo: 'factura' } }));
  if (!logo || !sirveParaPdf(logo.contenido)) throw notFound('Esta cooperativa no tiene logo de factura');
  res.setHeader('Content-Type', logo.mime);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(logo.contenido);
});

/**
 * Cómo queda: la última factura emitida de la cooperativa, con el diseño que se manda (todavía sin
 * guardar) o, sin cuerpo, con el guardado. No cambia nada.
 */
cooperativasRouter.post('/:id/factura/muestra', async (req, res: Response) => {
  const coop = await cooperativaOFalla(idParam(req));
  const modelo = req.body && Object.keys(req.body as object).length ? parse(modeloFacturaSchema, req.body) : undefined;
  const r = await runInCooperativa(coop.id, async () => {
    const ultima = await Comprobante.findOne({
      where: { tipo: 'factura', estado: { [Op.in]: ['emitido', 'pagado'] } },
      order: [['emitidoEl', 'DESC'], ['id', 'DESC']],
      attributes: ['id'],
    });
    return ultima ? pdfDeComprobante(ultima.id, { modelo }) : null;
  });
  if (!r) throw conflict('Esta cooperativa todavía no emitió ninguna factura para mostrar de muestra.');
  enviarPdf(res, r.pdf, `muestra-${coop.subdominio}.pdf`);
});

/* ───────────────────────── Factura electrónica (ARCA) ───────────────────────── */

/** Con qué se conecta la cooperativa a ARCA: ambiente, CUIT, punto de venta, certificado y conceptos. */
cooperativasRouter.get('/:id/fiscal', async (req, res) => {
  const coop = await cooperativaOFalla(idParam(req));
  ok(res, await runInCooperativa(coop.id, vistaConfigFiscal));
});

cooperativasRouter.put('/:id/fiscal', async (req, res) => {
  const coop = await cooperativaOFalla(idParam(req));
  const datos = parse(configFiscalSchema, req.body);
  ok(res, await runInCooperativa(coop.id, async () => {
    await guardarConfigFiscal(datos, req.auth!.userId);
    return vistaConfigFiscal();
  }));
});

/** El certificado (.crt) y su clave privada (.key). La clave se guarda cifrada y nunca vuelve a salir. */
cooperativasRouter.put('/:id/fiscal/certificado', async (req, res) => {
  const coop = await cooperativaOFalla(idParam(req));
  const datos = parse(certificadoFiscalSchema, req.body);
  ok(res, await runInCooperativa(coop.id, async () => {
    await guardarCertificado(datos, req.auth!.userId);
    return vistaConfigFiscal();
  }));
});

cooperativasRouter.delete('/:id/fiscal/certificado', async (req, res) => {
  const coop = await cooperativaOFalla(idParam(req));
  ok(res, await runInCooperativa(coop.id, async () => {
    await borrarCertificado(req.auth!.userId);
    return vistaConfigFiscal();
  }));
});

/** Prueba de punta a punta con ARCA. No emite nada. */
cooperativasRouter.post('/:id/fiscal/probar', async (req, res) => {
  const coop = await cooperativaOFalla(idParam(req));
  ok(res, await runInCooperativa(coop.id, probarConexion));
});

/** Solo en homologación: pide a ARCA el CAE de unas pocas facturas reales, sin tocarlas en la app. */
cooperativasRouter.post('/:id/fiscal/facturas-prueba', async (req, res) => {
  const coop = await cooperativaOFalla(idParam(req));
  ok(res, await runInCooperativa(coop.id, emitirFacturasDePrueba));
});

/** Lleva la numeración de GestiónCoop hasta la de ARCA (nunca para atrás). */
cooperativasRouter.post('/:id/fiscal/sincronizar', async (req, res) => {
  const coop = await cooperativaOFalla(idParam(req));
  ok(res, await runInCooperativa(coop.id, sincronizarNumeracion));
});
