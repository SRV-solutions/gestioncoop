// Datos del mapa interactivo (SPEC 6.10): lo que se pinta encima de las casas —deuda, consumo,
// reclamos, cortes, lecturas en vivo—, la ficha de una conexión y el resumen de un área dibujada.
// Usa las mismas reglas que el tablero y los informes: la deuda de todas las casas es la deuda del
// tablero, y «en mora» es la regla del informe de cortes sugeridos.
// SQL crudo, con el filtro por cooperativa escrito a mano.
import Decimal from 'decimal.js';
import { Op, QueryTypes } from 'sequelize';
import {
  ESTADO_SERVICIO_ETIQUETA,
  nombreDeMes,
  peorSituacion,
  referenciaReclamo,
  SERVICIO_ETIQUETA,
  SERVICIOS_CONEXION,
  SERVICIOS_MEDIDOS,
  SITUACION_ETIQUETA,
  SITUACIONES,
  situacionDe,
  tipoReclamo,
  UNIDAD_SERVICIO,
  type ColumnaInforme,
  type CorteMapa,
  type EstadoReclamo,
  type EstadoServicio,
  type FichaMapa,
  type MapaCapas,
  type MapaLecturas,
  type Prioridad,
  type ReclamoMapa,
  type ResumenArea,
  type ServicioConexion,
  type ServicioMedido,
  type ServicioReclamo,
  type Situacion,
} from '../shared';
import { sequelize } from '../db';
import { Conexion, CorteProgramadoModel, Periodo, Socio, Zona } from '../models';
import { CON_SERVICIOS, toConexionDetalle } from '../modules/padron.routes';
import type { TablaExportable } from './exportar';
import { DESDE_PUNTOS, DONDE_PUNTOS } from './lecturas';
import { FACTURAS_VALIDAS } from './tablero';
import { cargarParametros, hoy } from './tarifas';
import { requireCooperativaId } from './tenant';

function consulta<T extends object>(sql: string, replacements: Record<string, unknown>): Promise<T[]> {
  return sequelize.query<T>(sql, { replacements, type: QueryTypes.SELECT });
}

const DEUDA = `c.tipo = 'factura' AND c.estado = 'emitido' AND c.saldo > 0`;

/* ───────────────────────── Deuda y consumo por casa ───────────────────────── */

interface FilaDeuda {
  conexion_id: number;
  servicio: ServicioConexion;
  deuda: string;
  vencida: string | null;
  facturas: string;
  vencidas: string;
  mas_vieja: string;
}

/** Lo que debe cada servicio de cada conexión. `donde` acota a unas conexiones (ya escrito en SQL, nunca con datos del pedido). */
function deudasPorServicio(fecha: string, donde = '', params: Record<string, unknown> = {}): Promise<FilaDeuda[]> {
  return consulta<FilaDeuda>(
    `SELECT c.conexion_id, c.servicio, sum(c.saldo) AS deuda, sum(c.saldo) FILTER (WHERE c.vence_el < CAST(:hoy AS date)) AS vencida,
            count(*) AS facturas, count(*) FILTER (WHERE c.vence_el < CAST(:hoy AS date)) AS vencidas, to_char(min(c.vence_el), 'YYYY-MM-DD') AS mas_vieja
     FROM comprobantes c
     WHERE c.cooperativa_id = :cooperativaId AND ${DEUDA} AND c.conexion_id IS NOT NULL ${donde}
     GROUP BY c.conexion_id, c.servicio
     ORDER BY c.conexion_id, c.servicio`,
    { cooperativaId: requireCooperativaId(), hoy: fecha, ...params },
  );
}

/** Último mes con facturas: de ahí sale el consumo que muestra el mapa. */
async function ultimoMesFacturado(): Promise<{ anio: number; mes: number } | null> {
  const [fila] = await consulta<{ n: number | null }>(`SELECT max(c.anio * 12 + c.mes) AS n FROM comprobantes c WHERE c.cooperativa_id = :cooperativaId AND ${FACTURAS_VALIDAS}`, {
    cooperativaId: requireCooperativaId(),
  });
  if (!fila || fila.n === null) return null;
  const n = Number(fila.n);
  return { anio: Math.floor((n - 1) / 12), mes: ((n - 1) % 12) + 1 };
}

function consumoPorConexion(periodo: { anio: number; mes: number }, donde = '', params: Record<string, unknown> = {}) {
  return consulta<{ conexion_id: number; energia: string; agua: string }>(
    `SELECT c.conexion_id, COALESCE(sum(c.consumo) FILTER (WHERE c.servicio = 'energia'), 0) AS energia, COALESCE(sum(c.consumo) FILTER (WHERE c.servicio = 'agua'), 0) AS agua
     FROM comprobantes c
     WHERE c.cooperativa_id = :cooperativaId AND ${FACTURAS_VALIDAS} AND c.anio = :anio AND c.mes = :mes AND c.servicio IN ('energia', 'agua') AND c.conexion_id IS NOT NULL ${donde}
     GROUP BY c.conexion_id
     ORDER BY c.conexion_id`,
    { cooperativaId: requireCooperativaId(), ...periodo, ...params },
  );
}

/* ───────────────────────── Capas ───────────────────────── */

const UBICADAS = `AND c.conexion_id IN (SELECT id FROM conexiones WHERE cooperativa_id = :cooperativaId AND eliminado_el IS NULL AND lat IS NOT NULL AND lng IS NOT NULL)`;

export async function capasDelMapa(): Promise<MapaCapas> {
  const cooperativaId = requireCooperativaId();
  const fecha = hoy();
  const [parametros, deudas, periodo, reclamos, cortes] = await Promise.all([
    cargarParametros(),
    deudasPorServicio(fecha, UBICADAS),
    ultimoMesFacturado(),
    consulta<{ id: number; numero: number; servicio: ServicioReclamo; tipo: string; prioridad: Prioridad; estado: EstadoReclamo; lng: string; lat: string; conexion_id: number | null; direccion: string | null; creado_el: Date }>(
      `SELECT r.id, r.numero, r.servicio, r.tipo, r.prioridad, r.estado, COALESCE(r.lng, cx.lng) AS lng, COALESCE(r.lat, cx.lat) AS lat,
              r.conexion_id, COALESCE(r.direccion, cx.direccion) AS direccion, r.creado_el
       FROM reclamos r LEFT JOIN conexiones cx ON cx.id = r.conexion_id
       WHERE r.cooperativa_id = :cooperativaId AND r.estado <> 'resuelto' AND COALESCE(r.lng, cx.lng) IS NOT NULL AND COALESCE(r.lat, cx.lat) IS NOT NULL
       ORDER BY r.id`,
      { cooperativaId },
    ),
    CorteProgramadoModel.findAll({ where: { hasta: { [Op.gt]: new Date() }, canceladoEl: null }, include: [{ model: Zona, as: 'zona' }], order: [['desde', 'ASC'], ['id', 'ASC']] }),
  ]);
  const consumo = periodo ? await consumoPorConexion(periodo, UBICADAS) : [];
  return {
    hoy: fecha,
    facturasParaCorte: parametros.facturasParaCorte,
    deudas: deudas.map((d) => [d.conexion_id, SERVICIOS_CONEXION.indexOf(d.servicio), Number(d.deuda), Number(d.vencidas)]),
    consumo: { periodo, filas: consumo.map((c) => [c.conexion_id, Number(c.energia), Number(c.agua)]) },
    reclamos: reclamos.map(
      (r): ReclamoMapa => ({
        id: r.id,
        referencia: referenciaReclamo(r.numero),
        servicio: r.servicio,
        tipoNombre: tipoReclamo(r.servicio, r.tipo)?.nombre ?? r.tipo,
        prioridad: r.prioridad,
        estado: r.estado,
        lng: Number(r.lng),
        lat: Number(r.lat),
        conexionId: r.conexion_id,
        direccion: r.direccion,
        creadoEl: r.creado_el.toISOString(),
      }),
    ),
    cortes: cortes.map(
      (c): CorteMapa => ({ id: c.id, zonaId: c.zonaId, zona: c.zona?.nombre ?? null, servicio: c.servicio, desde: c.desde.toISOString(), hasta: c.hasta.toISOString(), motivo: c.motivo }),
    ),
  };
}

/* ───────────────────────── Lecturas en vivo ───────────────────────── */

export async function lecturasDelMapa(): Promise<MapaLecturas> {
  const [periodo, filas] = await Promise.all([
    Periodo.findOne({ where: { estado: 'en_lectura' }, order: [['anio', 'DESC'], ['mes', 'DESC']] }),
    consulta<{ id: number; medidores: string; leidos: string; novedades: string }>(
      `SELECT c.id, count(*) AS medidores, count(l.id) AS leidos,
              count(*) FILTER (WHERE (l.novedad IS NOT NULL OR l.anomalia IS NOT NULL) AND l.revisada_el IS NULL) AS novedades
       ${DESDE_PUNTOS}
       WHERE ${DONDE_PUNTOS} AND c.lat IS NOT NULL AND c.lng IS NOT NULL
       GROUP BY c.id
       ORDER BY c.id`,
      { cooperativaId: requireCooperativaId() },
    ),
  ]);
  return {
    periodo: periodo ? { anio: periodo.anio, mes: periodo.mes } : null,
    total: filas.reduce((t, f) => t + Number(f.medidores), 0),
    leidos: filas.reduce((t, f) => t + Number(f.leidos), 0),
    conexiones: filas.map((f) => [f.id, Number(f.medidores), Number(f.leidos), Number(f.novedades) > 0 ? 1 : 0]),
    generadoEl: new Date().toISOString(),
  };
}

/* ───────────────────────── Ficha de una casa ───────────────────────── */

const MESES_FICHA = 12;
const numero = (v: string | null) => (v === null ? null : Number(v));

export async function fichaDelMapa(id: number): Promise<FichaMapa | null> {
  const cooperativaId = requireCooperativaId();
  const conexion = await Conexion.findByPk(id, { include: [...CON_SERVICIOS, { model: Socio, as: 'socio', attributes: ['id', 'numero', 'nombre', 'telefono'] }] });
  if (!conexion || !conexion.socio) return null;
  const fecha = hoy();
  const [parametros, deudas, periodo, lecturas, delMes, reclamos] = await Promise.all([
    cargarParametros(),
    deudasPorServicio(fecha, 'AND c.conexion_id = :id', { id }),
    ultimoMesFacturado(),
    // La última lectura de cada medidor colocado, y si es del mes que se está leyendo.
    consulta<{ servicio: ServicioMedido; medidor: string; valor: string | null; consumo: string | null; tomada_el: Date; tipo: 'real' | 'estimada'; estado: string }>(
      `SELECT DISTINCT ON (m.id) sc.servicio, m.numero AS medidor, l.valor, l.consumo, l.tomada_el, l.tipo, p.estado
       FROM medidores m
       JOIN servicios_conexion sc ON sc.id = m.servicio_conexion_id
       JOIN lecturas l ON l.medidor_id = m.id
       JOIN periodos p ON p.id = l.periodo_id
       WHERE m.cooperativa_id = :cooperativaId AND sc.conexion_id = :id AND m.retirado_el IS NULL
       ORDER BY m.id, p.anio DESC, p.mes DESC`,
      { cooperativaId, id },
    ),
    consulta<{ medidores: string; leidos: string }>(`SELECT count(*) AS medidores, count(l.id) AS leidos ${DESDE_PUNTOS} WHERE ${DONDE_PUNTOS} AND c.id = :id`, { cooperativaId, id }),
    consulta<{ id: number; numero: number; servicio: ServicioReclamo; tipo: string; estado: EstadoReclamo; prioridad: Prioridad; creado_el: Date }>(
      `SELECT id, numero, servicio, tipo, estado, prioridad, creado_el FROM reclamos
       WHERE cooperativa_id = :cooperativaId AND conexion_id = :id AND estado <> 'resuelto' ORDER BY creado_el DESC`,
      { cooperativaId, id },
    ),
  ]);

  const hasta = periodo ? periodo.anio * 12 + periodo.mes : null;
  const facturado = hasta
    ? await consulta<{ servicio: ServicioMedido; anio: number; mes: number; consumo: string | null }>(
        `SELECT c.servicio, c.anio, c.mes, sum(c.consumo) AS consumo FROM comprobantes c
         WHERE c.cooperativa_id = :cooperativaId AND ${FACTURAS_VALIDAS} AND c.conexion_id = :id AND c.servicio IN ('energia', 'agua')
           AND (c.anio * 12 + c.mes) BETWEEN :desde AND :hasta
         GROUP BY c.servicio, c.anio, c.mes`,
        { cooperativaId, id, desde: hasta - MESES_FICHA + 1, hasta },
      )
    : [];

  const detalle = toConexionDetalle(conexion);
  const deudaDe = new Map(deudas.map((d) => [d.servicio, d]));
  const situaciones = detalle.servicios.map((s) => situacionDe({ estado: s.estado, deuda: Number(deudaDe.get(s.servicio)?.deuda ?? 0), vencidas: Number(deudaDe.get(s.servicio)?.vencidas ?? 0) }, parametros.facturasParaCorte));
  const medidores = Number(delMes[0]?.medidores ?? 0);
  return {
    ...detalle,
    socio: { id: conexion.socio.id, numero: conexion.socio.numero, nombre: conexion.socio.nombre },
    telefono: conexion.socio.telefono,
    situacion: peorSituacion(situaciones),
    deuda: {
      total: deudas.reduce((t, d) => t.plus(d.deuda), new Decimal(0)).toFixed(2),
      facturas: deudas.reduce((t, d) => t + Number(d.facturas), 0),
      vencidas: deudas.reduce((t, d) => t + Number(d.vencidas), 0),
      masVieja: deudas.length ? deudas.map((d) => d.mas_vieja).sort()[0]! : null,
    },
    consumo: SERVICIOS_MEDIDOS.filter((servicio) => facturado.some((f) => f.servicio === servicio)).map((servicio) => ({
      servicio,
      unidad: UNIDAD_SERVICIO[servicio],
      meses: Array.from({ length: MESES_FICHA }, (_, i) => {
        const n = hasta! - MESES_FICHA + 1 + i;
        const mes = { anio: Math.floor((n - 1) / 12), mes: ((n - 1) % 12) + 1 };
        const fila = facturado.find((f) => f.servicio === servicio && f.anio === mes.anio && f.mes === mes.mes);
        return { ...mes, consumo: fila ? numero(fila.consumo) : null };
      }),
    })),
    lecturas: lecturas.map((l) => ({
      servicio: l.servicio,
      medidor: l.medidor,
      valor: numero(l.valor),
      consumo: numero(l.consumo),
      tomadaEl: l.tomada_el.toISOString(),
      estimada: l.tipo === 'estimada',
      delMesEnLectura: l.estado === 'en_lectura',
    })),
    lecturaDelMes: medidores === 0 ? null : Number(delMes[0]!.leidos) >= medidores ? 'leida' : 'pendiente',
    reclamos: reclamos.map((r) => ({
      id: r.id,
      referencia: referenciaReclamo(r.numero),
      tipoNombre: tipoReclamo(r.servicio, r.tipo)?.nombre ?? r.tipo,
      estado: r.estado,
      prioridad: r.prioridad,
      creadoEl: r.creado_el.toISOString(),
    })),
  };
}

/* ───────────────────────── Área dibujada ───────────────────────── */

interface FilaArea {
  id: number;
  numero: number;
  direccion: string;
  zona: string | null;
  socio_id: number;
  socio: number;
  nombre: string;
  telefono: string | null;
  servicios: { servicio: ServicioConexion; estado: EstadoServicio }[] | null;
}

const col = (clave: string, titulo: string, tipo: ColumnaInforme['tipo'], ancho: number, suma = false): ColumnaInforme => ({ clave, titulo, tipo, ancho, ...(suma ? { suma } : {}) });
const ORDEN: ServicioConexion[] = ['energia', 'agua', 'internet', 'tv', 'sepelio'];

/**
 * Resumen y lista de las conexiones elegidas en el mapa. Con un servicio, la deuda y la situación
 * son las de ese servicio y solo cuentan las conexiones que lo tienen. Los ids que no son de la
 * cooperativa no aparecen: el filtro va en cada consulta.
 */
export async function resumirArea(ids: number[], servicio: ServicioConexion | null): Promise<{ resumen: ResumenArea; tabla: TablaExportable }> {
  const cooperativaId = requireCooperativaId();
  const fecha = hoy();
  const elegidas = [...new Set(ids)];
  const [parametros, periodo, conexiones, deudas, reclamos] = await Promise.all([
    cargarParametros(),
    ultimoMesFacturado(),
    consulta<FilaArea>(
      `SELECT cx.id, cx.numero, cx.direccion, z.nombre AS zona, s.id AS socio_id, s.numero AS socio, s.nombre, s.telefono,
              (SELECT json_agg(json_build_object('servicio', sc.servicio, 'estado', sc.estado)) FROM servicios_conexion sc WHERE sc.conexion_id = cx.id AND sc.estado <> 'baja') AS servicios
       FROM conexiones cx
       JOIN socios s ON s.id = cx.socio_id
       LEFT JOIN zonas z ON z.id = cx.zona_id
       WHERE cx.cooperativa_id = :cooperativaId AND cx.eliminado_el IS NULL AND cx.id IN (:ids)
         ${servicio ? `AND EXISTS (SELECT 1 FROM servicios_conexion sc WHERE sc.conexion_id = cx.id AND sc.servicio = :servicio AND sc.estado <> 'baja')` : ''}
       ORDER BY s.numero, cx.numero`,
      { cooperativaId, ids: elegidas, servicio },
    ),
    deudasPorServicio(fecha, `AND c.conexion_id IN (:ids)${servicio ? ' AND c.servicio = :servicio' : ''}`, { ids: elegidas, servicio }),
    consulta<{ n: string }>(`SELECT count(*) AS n FROM reclamos WHERE cooperativa_id = :cooperativaId AND estado <> 'resuelto' AND conexion_id IN (:ids)`, { cooperativaId, ids: elegidas }),
  ]);
  const adentro = new Set(conexiones.map((c) => c.id));
  const consumo = periodo && adentro.size ? await consumoPorConexion(periodo, 'AND c.conexion_id IN (:ids)', { ids: [...adentro] }) : [];
  const consumoDe = new Map(consumo.map((c) => [c.conexion_id, c]));
  const deudasDe = new Map<number, typeof deudas>();
  for (const d of deudas) if (adentro.has(d.conexion_id)) deudasDe.set(d.conexion_id, [...(deudasDe.get(d.conexion_id) ?? []), d]);

  const porServicio = Object.fromEntries(SERVICIOS_CONEXION.map((s) => [s, 0])) as Record<ServicioConexion, number>;
  const situacion = Object.fromEntries(SITUACIONES.map((s) => [s, 0])) as Record<Situacion, number>;
  let deuda = new Decimal(0);
  let vencida = new Decimal(0);
  let energia = new Decimal(0);
  let agua = new Decimal(0);
  const filas: TablaExportable['filas'] = conexiones.map((c) => {
    const servicios = [...(c.servicios ?? [])].sort((a, b) => ORDEN.indexOf(a.servicio) - ORDEN.indexOf(b.servicio));
    for (const s of servicios) porServicio[s.servicio]++;
    const propias = deudasDe.get(c.id) ?? [];
    const mirados = servicio ? servicios.filter((s) => s.servicio === servicio) : servicios;
    const sit = peorSituacion(
      mirados.map((s) => {
        const d = propias.find((x) => x.servicio === s.servicio);
        return situacionDe({ estado: s.estado, deuda: Number(d?.deuda ?? 0), vencidas: Number(d?.vencidas ?? 0) }, parametros.facturasParaCorte);
      }),
    );
    situacion[sit]++;
    const debe = propias.reduce((t, d) => t.plus(d.deuda), new Decimal(0));
    const vencido = propias.reduce((t, d) => t.plus(d.vencida ?? 0), new Decimal(0));
    deuda = deuda.plus(debe);
    vencida = vencida.plus(vencido);
    const k = consumoDe.get(c.id);
    energia = energia.plus(k?.energia ?? 0);
    agua = agua.plus(k?.agua ?? 0);
    return [
      c.socio,
      c.nombre,
      c.numero,
      c.direccion,
      c.zona,
      servicios.map((s) => `${SERVICIO_ETIQUETA[s.servicio]}${s.estado === 'activo' ? '' : ` (${ESTADO_SERVICIO_ETIQUETA[s.estado].toLowerCase()})`}`).join(', ') || null,
      SITUACION_ETIQUETA[sit],
      debe.toFixed(2),
      vencido.toFixed(2),
      propias.reduce((t, d) => t + Number(d.vencidas), 0),
      Number(k?.energia ?? 0),
      Number(k?.agua ?? 0),
      c.telefono,
    ];
  });

  const resumen: ResumenArea = {
    conexiones: conexiones.length,
    socios: new Set(conexiones.map((c) => c.socio_id)).size,
    porServicio,
    situacion,
    deuda: deuda.toFixed(2),
    deudaVencida: vencida.toFixed(2),
    consumo: { periodo, energia: energia.toDecimalPlaces(2).toFixed(), agua: agua.toDecimalPlaces(2).toFixed() },
    reclamosAbiertos: Number(reclamos[0]?.n ?? 0),
    servicio,
  };
  const columnas = [
    col('socio', 'Socio', 'entero', 6),
    col('nombre', 'Titular', 'texto', 20),
    col('conexion', 'Conexión', 'entero', 7),
    col('direccion', 'Domicilio', 'texto', 20),
    col('zona', 'Zona', 'texto', 13),
    col('servicios', 'Servicios', 'texto', 20),
    col('situacion', 'Situación', 'texto', 9),
    col('deuda', 'Debe', 'dinero', 12, true),
    col('vencida', 'De eso, vencido', 'dinero', 12, true),
    col('vencidas', 'Facturas vencidas', 'entero', 7, true),
    col('energia', 'Energía (kWh)', 'numero', 8, true),
    col('agua', 'Agua (m³)', 'numero', 7, true),
    col('telefono', 'Teléfono', 'texto', 11),
  ];
  const totales = filas.length
    ? columnas.map((c, i) => {
        if (!c.suma) return i === 0 ? 'Total' : null;
        const suma = filas.reduce((t, f) => t.plus(f[i] ?? 0), new Decimal(0));
        return c.tipo === 'dinero' ? suma.toFixed(2) : suma.toDecimalPlaces(2).toNumber();
      })
    : null;
  return {
    resumen,
    tabla: {
      titulo: 'Conexiones del área dibujada en el mapa',
      subtitulo: `${conexiones.length} ${conexiones.length === 1 ? 'conexión' : 'conexiones'} · ${servicio ? SERVICIO_ETIQUETA[servicio] : 'Todos los servicios'}`,
      columnas,
      filas,
      totales,
      nota: `Deuda al día de hoy. El consumo es el del último mes facturado${periodo ? ` (${nombreDeMes(periodo.anio, periodo.mes)})` : ''}. Tiene datos personales: usalo solo para la gestión de la cooperativa.`,
      periodo: null,
      generadoEl: new Date().toISOString(),
    },
  };
}
