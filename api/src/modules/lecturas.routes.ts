import { Router } from 'express';
import { Op, QueryTypes } from 'sequelize';
import {
  abrirPeriodoSchema,
  asignarOperarioSchema,
  controlQuerySchema,
  estimarSchema,
  evaluarLectura,
  motivoSchema,
  nombreDeMes,
  SERVICIOS_MEDIDOS,
  syncSchema,
  type AvanceRuta,
  type CasaRuta,
  type ControlLecturas,
  type FiltroControl,
  type MisRutas,
  type ResultadoSync,
  type ResumenLecturas,
  type RutaDetalle,
  type RutaResumen,
} from '../shared';
import { sequelize } from '../db';
import { Lectura, LecturaFoto, Periodo, RolUsuario, Ruta, Usuario, Zona } from '../models';
import { writeAudit } from '../lib/audit';
import { badRequest, conflict, idParam, notFound, ok, parse } from '../lib/errors';
import { DESDE_PUNTOS, DONDE_PUNTOS, ESTIMABLE, estimarPunto, guardarLectura, lecturaDe, puntosDeLectura } from '../lib/lecturas';
import { hoy } from '../lib/tarifas';
import { requireCooperativaId } from '../lib/tenant';
import { requireRole } from '../middlewares/auth';

export const lecturasRouter = Router();
// En la calle: operarios. En la oficina: quienes controlan la lectura antes de facturar.
lecturasRouter.use(requireRole('operario', 'admin', 'facturacion', 'gerencia'));
const oficina = requireRole('admin', 'facturacion', 'gerencia');
const quienFactura = requireRole('admin', 'facturacion');

const numero = (v: string | null): number | null => (v === null ? null : Number(v));

/** Mes que está en lectura (el mismo para energía y agua: se leen en la misma pasada). */
async function periodoEnLectura(): Promise<Periodo | null> {
  return Periodo.findOne({ where: { estado: 'en_lectura' }, order: [['anio', 'DESC'], ['mes', 'DESC']] });
}

interface AvancePorRuta {
  ruta_id: number | null;
  medidores: string;
  leidos: string;
  casas: string;
  casas_hechas: string;
  ultima_el: Date | null;
}

/** Cuánto se leyó de cada ruta: medidores y casas (una casa está hecha cuando no le falta ningún medidor). */
async function avancePorRuta(): Promise<Map<number | null, AvancePorRuta>> {
  const filas = await sequelize.query<AvancePorRuta>(
    `SELECT ruta_id, sum(medidores) AS medidores, sum(leidos) AS leidos, count(*) AS casas,
            count(*) FILTER (WHERE leidos = medidores) AS casas_hechas, max(ultima_el) AS ultima_el
     FROM (
       SELECT c.ruta_id, c.id, count(*) AS medidores, count(l.id) AS leidos, max(l.tomada_el) AS ultima_el
       ${DESDE_PUNTOS}
       WHERE ${DONDE_PUNTOS}
       GROUP BY c.ruta_id, c.id
     ) casas
     GROUP BY ruta_id`,
    { replacements: { cooperativaId: requireCooperativaId() }, type: QueryTypes.SELECT },
  );
  return new Map(filas.map((f) => [f.ruta_id, f]));
}

/* ───────────────────────── Operario ───────────────────────── */

/** "Mi ruta de hoy": las rutas del operario con su avance. Quien no es operario (soporte, administración) ve todas. */
lecturasRouter.get('/mis-rutas', async (req, res) => {
  const periodo = await periodoEnLectura();
  if (!periodo) return ok<MisRutas>(res, { periodo: null, rutas: [] });

  const esOperario = req.auth!.roles.includes('operario');
  const [rutas, avance] = await Promise.all([
    Ruta.findAll({
      where: esOperario ? { operarioId: req.auth!.userId } : {},
      include: [{ model: Zona, as: 'zona', attributes: ['nombre'] }],
      order: [['id', 'ASC']],
    }),
    avancePorRuta(),
  ]);
  const lista: RutaResumen[] = rutas
    .map((r) => {
      const a = avance.get(r.id);
      return {
        id: r.id,
        nombre: r.nombre,
        zona: (r as Ruta & { zona?: Zona }).zona?.nombre ?? '',
        anio: periodo.anio,
        mes: periodo.mes,
        casas: Number(a?.casas ?? 0),
        casasHechas: Number(a?.casas_hechas ?? 0),
        medidores: Number(a?.medidores ?? 0),
        medidoresLeidos: Number(a?.leidos ?? 0),
      };
    })
    .filter((r) => r.medidores > 0);
  ok<MisRutas>(res, { periodo: { anio: periodo.anio, mes: periodo.mes }, rutas: lista });
});

/** La ruta completa, casa por casa: es lo que el teléfono guarda para trabajar sin señal. */
lecturasRouter.get('/rutas/:id', async (req, res) => {
  const ruta = await Ruta.findByPk(idParam(req), { include: [{ model: Zona, as: 'zona', attributes: ['nombre'] }] });
  if (!ruta) throw notFound('No encontramos esa ruta');
  const periodo = await periodoEnLectura();
  if (!periodo) throw conflict('Administración todavía no abrió la lectura de este mes');

  const puntos = await puntosDeLectura({ rutaId: ruta.id });
  const casas = new Map<number, CasaRuta>();
  for (const p of puntos) {
    let casa = casas.get(p.conexion_id);
    if (!casa) {
      casa = {
        conexionId: p.conexion_id,
        numero: p.conexion_numero,
        orden: p.orden_ruta ?? casas.size + 1,
        direccion: p.direccion,
        titular: p.titular,
        lat: numero(p.lat),
        lng: numero(p.lng),
        medidores: [],
      };
      casas.set(p.conexion_id, casa);
    }
    casa.medidores.push({
      medidorId: p.medidor_id,
      periodoId: p.periodo_id,
      servicio: p.servicio,
      numero: p.medidor,
      digitos: p.digitos,
      factor: Number(p.factor),
      anterior: p.anterior === null ? null : { valor: Number(p.anterior), fecha: p.anterior_el!.toISOString() },
      promedio: numero(p.promedio),
      lectura: lecturaDe(p),
    });
  }
  const lista = [...casas.values()];
  const body: RutaDetalle = {
    id: ruta.id,
    nombre: ruta.nombre,
    zona: (ruta as Ruta & { zona?: Zona }).zona?.nombre ?? '',
    anio: periodo.anio,
    mes: periodo.mes,
    casas: lista.length,
    medidores: puntos.length,
    descargadaEl: new Date().toISOString(),
    lista,
  };
  ok(res, body);
});

/**
 * El teléfono manda las lecturas que tenía guardadas. Cada una se resuelve por separado: una que
 * falla no frena a las demás, y el teléfono sabe cuáles puede borrar de su cola.
 */
lecturasRouter.post('/sync', requireRole('operario', 'admin'), async (req, res) => {
  const { lecturas } = parse(syncSchema, req.body);
  const operarioId = req.auth!.userId;
  const resultados: ResultadoSync[] = [];
  for (const item of lecturas) resultados.push(await guardarLectura(item, operarioId));
  ok(res, { resultados });
});

lecturasRouter.get('/:id/foto', async (req, res) => {
  const foto = await LecturaFoto.findByPk(idParam(req));
  if (!foto) throw notFound('Esa lectura no tiene foto');
  res.setHeader('Content-Type', foto.mime);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(foto.contenido);
});

/* ───────────────────────── Oficina: control de la lectura ───────────────────────── */

lecturasRouter.get('/resumen', oficina, async (_req, res) => {
  const cooperativaId = requireCooperativaId();
  const [periodo, ultimo, rutas, avance, totales, operarios] = await Promise.all([
    periodoEnLectura(),
    Periodo.findOne({ order: [['anio', 'DESC'], ['mes', 'DESC']] }),
    Ruta.findAll({
      include: [
        { model: Zona, as: 'zona', attributes: ['nombre'] },
        { model: Usuario, as: 'operario', attributes: ['id', 'nombre'] },
      ],
      order: [['id', 'ASC']],
    }),
    avancePorRuta(),
    sequelize.query<{ total: string; leidos: string; estimados: string; novedades: string; anomalias: string }>(
      `SELECT count(*) AS total, count(l.id) AS leidos,
              count(*) FILTER (WHERE l.tipo = 'estimada') AS estimados,
              count(*) FILTER (WHERE l.novedad IS NOT NULL AND l.revisada_el IS NULL) AS novedades,
              count(*) FILTER (WHERE l.anomalia IS NOT NULL AND l.revisada_el IS NULL) AS anomalias
       ${DESDE_PUNTOS}
       WHERE ${DONDE_PUNTOS}`,
      { replacements: { cooperativaId }, type: QueryTypes.SELECT },
    ),
    Usuario.findAll({
      attributes: ['id', 'nombre'],
      where: { activo: true },
      include: [{ model: RolUsuario, as: 'roles', where: { rol: 'operario' }, required: true, attributes: [] }],
      order: [['nombre', 'ASC']],
    }),
  ]);

  // Mes que sigue al último que existe; si no hay ninguno, el mes en curso.
  const fecha = hoy();
  const proximo = ultimo
    ? { anio: ultimo.mes === 12 ? ultimo.anio + 1 : ultimo.anio, mes: ultimo.mes === 12 ? 1 : ultimo.mes + 1 }
    : { anio: Number(fecha.slice(0, 4)), mes: Number(fecha.slice(5, 7)) };

  const t = totales[0];
  const body: ResumenLecturas = {
    periodo: periodo ? { anio: periodo.anio, mes: periodo.mes, estado: periodo.estado } : null,
    proximo,
    enFacturacion: ultimo?.estado === 'prefacturado' ? { anio: ultimo.anio, mes: ultimo.mes } : null,
    total: Number(t?.total ?? 0),
    leidos: Number(t?.leidos ?? 0),
    estimados: Number(t?.estimados ?? 0),
    conNovedad: Number(t?.novedades ?? 0),
    anomalias: Number(t?.anomalias ?? 0),
    rutas: rutas.map((r): AvanceRuta => {
      const a = avance.get(r.id);
      const operario = (r as Ruta & { operario?: Usuario | null }).operario;
      return {
        id: r.id,
        nombre: r.nombre,
        zona: (r as Ruta & { zona?: Zona }).zona?.nombre ?? '',
        operario: operario ? { id: operario.id, nombre: operario.nombre } : null,
        medidores: Number(a?.medidores ?? 0),
        leidos: Number(a?.leidos ?? 0),
        casas: Number(a?.casas ?? 0),
        casasHechas: Number(a?.casas_hechas ?? 0),
        ultimaEl: a?.ultima_el ? a.ultima_el.toISOString() : null,
      };
    }),
    operarios: operarios.map((o) => ({ id: o.id, nombre: o.nombre })),
  };
  ok(res, body);
});

const POR_PAGINA = 50;
// Texto fijo, nunca armado con datos del pedido.
const CONDICION: Record<FiltroControl, string> = {
  anomalias: 'l.anomalia IS NOT NULL AND l.revisada_el IS NULL',
  novedades: 'l.novedad IS NOT NULL AND l.revisada_el IS NULL',
  pendientes: 'l.id IS NULL',
  estimadas: "l.tipo = 'estimada'",
};

lecturasRouter.get('/control', oficina, async (req, res) => {
  const q = parse(controlQuerySchema, req.query);
  const puntos = await puntosDeLectura({ rutaId: q.ruta, condicion: CONDICION[q.filtro], limite: POR_PAGINA, desde: (q.pagina - 1) * POR_PAGINA });
  const body: ControlLecturas = {
    total: Number(puntos[0]?.total ?? 0),
    filas: puntos.map((p) => {
      const lectura = lecturaDe(p);
      return {
        medidorId: p.medidor_id,
        periodoId: p.periodo_id,
        servicio: p.servicio,
        medidor: p.medidor,
        socioId: p.socio_id,
        titular: p.titular,
        direccion: p.direccion,
        ruta: p.ruta,
        anterior: numero(p.anterior),
        promedio: numero(p.promedio),
        lectura: lectura ? { ...lectura, id: p.lectura_id!, operario: p.operario, revisada: p.revisada_el !== null } : null,
      };
    }),
  };
  ok(res, body);
});

/** No se pudo leer: se estima con el promedio de los últimos meses y queda marcada como estimada (SPEC 6.3). */
lecturasRouter.post('/estimar', quienFactura, async (req, res) => {
  const input = parse(estimarSchema, req.body);
  const [punto] = await puntosDeLectura(input);
  if (!punto) throw notFound('Ese medidor no está en la lectura de este mes');
  if (punto.valor !== null) throw conflict('Ese medidor ya tiene lectura');
  if (punto.anterior === null || punto.promedio === null) throw conflict('Ese medidor no tiene historial: no hay con qué estimar');

  const estimada = await sequelize.transaction(async (transaction) => {
    const e = await estimarPunto(punto, transaction);
    await writeAudit({ accion: 'estimar', entidad: 'lectura', entidadId: e.id, despues: { medidor: punto.medidor, valor: e.valor, consumo: e.consumo }, transaction });
    return e;
  });
  ok(res, estimada, 201);
});

/** Estima de una vez todo lo que quedó sin leer y tiene historial. Es el último paso antes de cerrar la lectura. */
lecturasRouter.post('/estimar-pendientes', quienFactura, async (_req, res) => {
  const puntos = await puntosDeLectura({ condicion: ESTIMABLE });
  await sequelize.transaction(async (transaction) => {
    for (const punto of puntos) await estimarPunto(punto, transaction);
    if (puntos.length) await writeAudit({ accion: 'estimar_pendientes', entidad: 'periodo', entidadId: puntos[0]!.periodo_id, despues: { medidores: puntos.length }, transaction });
  });
  ok(res, { estimadas: puntos.length });
});

/** La lectura dio menos que la anterior y el operario no aclaró por qué: lo resuelve la oficina. */
lecturasRouter.post('/:id/motivo', quienFactura, async (req, res) => {
  const { motivo } = parse(motivoSchema, req.body);
  const lectura = await Lectura.findByPk(idParam(req));
  if (!lectura) throw notFound('No encontramos esa lectura');
  const [punto] = await puntosDeLectura({ medidorId: lectura.medidorId, periodoId: lectura.periodoId });
  if (!punto) throw conflict('La lectura de ese mes ya está cerrada');
  if (lectura.valor === null || lectura.anterior === null || Number(lectura.valor) >= Number(lectura.anterior)) {
    throw conflict('Esa lectura no es menor a la anterior: no hace falta aclarar nada');
  }
  const { consumo } = evaluarLectura({ valor: Number(lectura.valor), anterior: Number(lectura.anterior), promedio: null, digitos: punto.digitos, factor: Number(punto.factor), motivo });
  const antes = { motivo: lectura.motivo, consumo: lectura.consumo };
  await sequelize.transaction(async (transaction) => {
    await lectura.update({ motivo, consumo: consumo === null ? null : String(consumo), revisadaEl: new Date(), revisadaPor: req.auth!.userId }, { transaction });
    await writeAudit({ accion: 'aclarar_lectura_menor', entidad: 'lectura', entidadId: lectura.id, antes, despues: { motivo, consumo }, transaction });
  });
  ok(res, { id: lectura.id, motivo, consumo });
});

/** La oficina ya miró la anomalía o la novedad: sale de la lista de cosas por revisar. */
lecturasRouter.post('/:id/revisar', quienFactura, async (req, res) => {
  const lectura = await Lectura.findByPk(idParam(req));
  if (!lectura) throw notFound('No encontramos esa lectura');
  if (!lectura.revisadaEl) {
    await sequelize.transaction(async (transaction) => {
      await lectura.update({ revisadaEl: new Date(), revisadaPor: req.auth!.userId }, { transaction });
      await writeAudit({ accion: 'revisar', entidad: 'lectura', entidadId: lectura.id, despues: { anomalia: lectura.anomalia, novedad: lectura.novedad }, transaction });
    });
  }
  ok(res, { id: lectura.id });
});

lecturasRouter.put('/rutas/:id/operario', quienFactura, async (req, res) => {
  const { operarioId } = parse(asignarOperarioSchema, req.body);
  const ruta = await Ruta.findByPk(idParam(req));
  if (!ruta) throw notFound('No encontramos esa ruta');
  if (operarioId !== null) {
    const operario = await Usuario.findOne({
      where: { id: operarioId, activo: true },
      include: [{ model: RolUsuario, as: 'roles', where: { rol: 'operario' }, required: true }],
    });
    if (!operario) throw badRequest('Revisá los datos marcados', { operarioId: 'Esa persona no es operario de la cooperativa' });
  }
  const antes = ruta.operarioId;
  await sequelize.transaction(async (transaction) => {
    await ruta.update({ operarioId }, { transaction });
    await writeAudit({ accion: 'asignar_operario', entidad: 'ruta', entidadId: ruta.id, antes: { operarioId: antes }, despues: { operarioId }, transaction });
  });
  ok(res, { id: ruta.id, operarioId });
});

/** Abre la lectura de un mes: desde ese momento las rutas aparecen en el teléfono de los operarios. */
lecturasRouter.post('/periodos', quienFactura, async (req, res) => {
  const { anio, mes } = parse(abrirPeriodoSchema, req.body);
  const sinTerminar = await Periodo.findOne({ where: { estado: { [Op.in]: ['abierto', 'en_lectura', 'prefacturado'] } }, order: [['anio', 'DESC'], ['mes', 'DESC']] });
  if (sinTerminar) {
    throw conflict(
      sinTerminar.estado === 'prefacturado'
        ? `Primero hay que emitir las facturas de ${nombreDeMes(sinTerminar.anio, sinTerminar.mes)}`
        : `Todavía está abierta la lectura de ${nombreDeMes(sinTerminar.anio, sinTerminar.mes)}`,
    );
  }
  const posterior = await Periodo.findOne({ where: { [Op.or]: [{ anio: { [Op.gt]: anio } }, { anio, mes: { [Op.gte]: mes } }] } });
  if (posterior) throw conflict(`Ya existe ${nombreDeMes(posterior.anio, posterior.mes)}: el mes nuevo tiene que ser posterior`);

  await sequelize.transaction(async (transaction) => {
    // Lo emitido queda cerrado: el mes que se abre pasa a ser el de trabajo.
    await Periodo.update({ estado: 'cerrado' }, { where: { estado: 'emitido' }, transaction });
    for (const servicio of SERVICIOS_MEDIDOS) {
      const p = await Periodo.create({ servicio, anio, mes, estado: 'en_lectura' }, { transaction });
      await writeAudit({ accion: 'abrir_lectura', entidad: 'periodo', entidadId: p.id, despues: { servicio, anio, mes }, transaction });
    }
  });
  ok(res, { anio, mes }, 201);
});
