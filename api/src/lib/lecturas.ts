// Lecturas: la consulta de "puntos de lectura" (cada medidor que hay que leer en el mes, con su
// lectura anterior, su consumo promedio y lo que ya se cargó) y el guardado de una lectura que llega
// del teléfono. SQL crudo, con el filtro por cooperativa escrito a mano.
import { randomUUID } from 'node:crypto';
import { QueryTypes, type Transaction } from 'sequelize';
import {
  estimarLectura,
  evaluarLectura,
  lecturaSyncSchema,
  MESES_PROMEDIO,
  type Anomalia,
  type ControlCierre,
  type LecturaCargada,
  type MotivoLecturaMenor,
  type Novedad,
  type ResultadoSync,
  type ServicioMedido,
} from '../shared';
import { sequelize } from '../db';
import { Lectura, LecturaFoto, Periodo } from '../models';
import { zodFieldErrors } from './errors';
import { requireCooperativaId } from './tenant';

export interface Punto {
  medidor_id: number;
  medidor: string;
  digitos: number;
  factor: string;
  servicio: ServicioMedido;
  periodo_id: number;
  conexion_id: number;
  conexion_numero: number;
  direccion: string;
  orden_ruta: number | null;
  ruta_id: number | null;
  ruta: string | null;
  lat: string | null;
  lng: string | null;
  socio_id: number;
  titular: string;
  anterior: string | null;
  anterior_el: Date | null;
  promedio: string | null;
  lectura_id: number | null;
  uuid: string | null;
  valor: string | null;
  consumo: string | null;
  tipo: 'real' | 'estimada' | null;
  motivo: MotivoLecturaMenor | null;
  novedad: Novedad | null;
  anomalia: Anomalia | null;
  nota: string | null;
  tiene_foto: boolean | null;
  tomada_el: Date | null;
  revisada_el: Date | null;
  operario: string | null;
  total: string;
}

/** Medidores colocados, de servicios que no están de baja, en los períodos que están en lectura. */
export const DESDE_PUNTOS = `
  FROM medidores m
  JOIN servicios_conexion sc ON sc.id = m.servicio_conexion_id AND sc.estado <> 'baja'
  JOIN conexiones c ON c.id = sc.conexion_id AND c.eliminado_el IS NULL
  JOIN socios s ON s.id = c.socio_id
  JOIN periodos p ON p.cooperativa_id = m.cooperativa_id AND p.servicio = sc.servicio AND p.estado = 'en_lectura'
  LEFT JOIN lecturas l ON l.periodo_id = p.id AND l.medidor_id = m.id`;
export const DONDE_PUNTOS = `m.cooperativa_id = :cooperativaId AND m.retirado_el IS NULL`;

interface Filtro {
  rutaId?: number;
  medidorId?: number;
  periodoId?: number;
  /** Condición extra sobre `l` (la lectura del mes) ya escrita en SQL. Nunca armarla con datos del usuario. */
  condicion?: string;
  limite?: number;
  desde?: number;
}

export async function puntosDeLectura(filtro: Filtro = {}): Promise<Punto[]> {
  const cooperativaId = requireCooperativaId();
  const donde = [DONDE_PUNTOS];
  if (filtro.rutaId != null) donde.push('c.ruta_id = :rutaId');
  if (filtro.medidorId != null) donde.push('m.id = :medidorId');
  if (filtro.periodoId != null) donde.push('p.id = :periodoId');
  if (filtro.condicion) donde.push(`(${filtro.condicion})`);
  return sequelize.query<Punto>(
    `SELECT m.id AS medidor_id, m.numero AS medidor, m.digitos, m.factor_mult AS factor, sc.servicio, p.id AS periodo_id,
            c.id AS conexion_id, c.numero AS conexion_numero, c.direccion, c.orden_ruta, c.ruta_id, r.nombre AS ruta, c.lat, c.lng,
            s.id AS socio_id, s.nombre AS titular,
            ant.valor AS anterior, ant.tomada_el AS anterior_el, prom.promedio,
            l.id AS lectura_id, l.uuid_dispositivo AS uuid, l.valor, l.consumo, l.tipo, l.motivo, l.novedad, l.anomalia, l.nota,
            l.tiene_foto, l.tomada_el, l.revisada_el, u.nombre AS operario,
            count(*) OVER () AS total
     ${DESDE_PUNTOS}
     LEFT JOIN rutas r ON r.id = c.ruta_id
     LEFT JOIN usuarios u ON u.id = l.operario_id
     -- última lectura real o estimada de un mes anterior
     LEFT JOIN LATERAL (
       SELECT a.valor, a.tomada_el FROM lecturas a JOIN periodos pa ON pa.id = a.periodo_id
       WHERE a.medidor_id = m.id AND a.valor IS NOT NULL AND (pa.anio * 12 + pa.mes) < (p.anio * 12 + p.mes)
       ORDER BY pa.anio DESC, pa.mes DESC LIMIT 1
     ) ant ON true
     -- consumo promedio de los últimos meses
     LEFT JOIN LATERAL (
       SELECT round(avg(x.consumo), 2) AS promedio FROM (
         SELECT a.consumo FROM lecturas a JOIN periodos pa ON pa.id = a.periodo_id
         WHERE a.medidor_id = m.id AND a.consumo IS NOT NULL AND (pa.anio * 12 + pa.mes) < (p.anio * 12 + p.mes)
         ORDER BY pa.anio DESC, pa.mes DESC LIMIT ${MESES_PROMEDIO}
       ) x
     ) prom ON true
     WHERE ${donde.join(' AND ')}
     ORDER BY c.ruta_id NULLS LAST, c.orden_ruta NULLS LAST, c.id, sc.servicio DESC
     ${filtro.limite != null ? 'LIMIT :limite OFFSET :desde' : ''}`,
    {
      replacements: {
        cooperativaId,
        rutaId: filtro.rutaId ?? null,
        medidorId: filtro.medidorId ?? null,
        periodoId: filtro.periodoId ?? null,
        limite: filtro.limite ?? null,
        desde: filtro.desde ?? 0,
      },
      type: QueryTypes.SELECT,
    },
  );
}

const numero = (v: string | null): number | null => (v === null ? null : Number(v));

export function lecturaDe(p: Punto): LecturaCargada | null {
  if (p.lectura_id === null) return null;
  return {
    uuid: p.uuid!,
    valor: numero(p.valor),
    consumo: numero(p.consumo),
    tipo: p.tipo ?? 'real',
    motivo: p.motivo,
    novedad: p.novedad,
    anomalia: p.anomalia,
    nota: p.nota,
    tieneFoto: p.tiene_foto ?? false,
    tomadaEl: p.tomada_el!.toISOString(),
  };
}

/* ───────────────────────── Guardar una lectura del teléfono ───────────────────────── */

const FOTO = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/;

/**
 * Guarda una lectura que llega del teléfono. Idempotente: el mismo `uuid` nunca entra dos veces.
 * Una lectura tomada en la calle no se rechaza por "rara": se guarda marcada como anomalía y la
 * oficina la revisa. Solo se rechaza lo que no se puede guardar (medidor inexistente, mes cerrado).
 */
export async function guardarLectura(crudo: unknown, operarioId: number | null): Promise<ResultadoSync> {
  const uuidCrudo = typeof (crudo as { uuid?: unknown })?.uuid === 'string' ? (crudo as { uuid: string }).uuid : '';
  const leido = lecturaSyncSchema.safeParse(crudo);
  if (!leido.success) {
    return { uuid: uuidCrudo, estado: 'rechazada', error: Object.values(zodFieldErrors(leido.error))[0] ?? 'Datos inválidos' };
  }
  const item = leido.data;

  if (await Lectura.findOne({ where: { uuidDispositivo: item.uuid }, attributes: ['id'] })) return { uuid: item.uuid, estado: 'repetida' };

  const [punto] = await puntosDeLectura({ medidorId: item.medidorId, periodoId: item.periodoId });
  if (!punto) {
    const periodo = await Periodo.findByPk(item.periodoId, { attributes: ['estado'] });
    const error = periodo && periodo.estado !== 'en_lectura' ? 'La lectura de ese mes ya está cerrada' : 'Ese medidor ya no está para leer';
    return { uuid: item.uuid, estado: 'rechazada', error };
  }
  if (item.valor !== null && item.valor >= 10 ** punto.digitos) {
    return { uuid: item.uuid, estado: 'rechazada', error: `El medidor tiene ${punto.digitos} dígitos` };
  }

  const tomadaEl = new Date(Math.min(new Date(item.tomadaEl).getTime(), Date.now()));
  // Ya hay una lectura más nueva de ese medidor (otra corrección llegó antes): esta no la pisa.
  if (punto.lectura_id !== null && punto.tipo === 'real' && punto.tomada_el! > tomadaEl) return { uuid: item.uuid, estado: 'repetida' };

  const evaluacion =
    item.valor === null
      ? { consumo: null, anomalia: null }
      : evaluarLectura({
          valor: item.valor,
          anterior: numero(punto.anterior),
          promedio: numero(punto.promedio),
          digitos: punto.digitos,
          factor: Number(punto.factor),
          motivo: item.motivo,
        });
  const foto = item.foto ? FOTO.exec(item.foto) : null;

  await sequelize.transaction(async (transaction) => {
    const datos = {
      uuidDispositivo: item.uuid,
      periodoId: punto.periodo_id,
      medidorId: punto.medidor_id,
      valor: item.valor === null ? null : String(item.valor),
      anterior: punto.anterior,
      consumo: evaluacion.consumo === null ? null : String(evaluacion.consumo),
      tipo: 'real' as const,
      motivo: item.valor === null ? null : item.motivo,
      novedad: item.novedad,
      anomalia: evaluacion.anomalia,
      nota: item.nota || null,
      tieneFoto: foto !== null,
      lat: item.lat === null ? null : item.lat.toFixed(6),
      lng: item.lng === null ? null : item.lng.toFixed(6),
      precisionM: item.precision === null ? null : Math.round(item.precision),
      tomadaEl,
      operarioId,
      sincronizadaEl: new Date(),
      revisadaEl: null,
      revisadaPor: null,
    };
    let lectura = punto.lectura_id === null ? null : await Lectura.findByPk(punto.lectura_id, { transaction, lock: transaction.LOCK.UPDATE });
    if (lectura) await lectura.update(datos, { transaction });
    else lectura = await Lectura.create(datos, { transaction });

    await LecturaFoto.destroy({ where: { lecturaId: lectura.id }, transaction });
    if (foto) await LecturaFoto.create({ lecturaId: lectura.id, mime: foto[1]!, contenido: Buffer.from(foto[2]!, 'base64') }, { transaction });
  });

  return { uuid: item.uuid, estado: 'guardada', anomalia: evaluacion.anomalia };
}

export const nuevoUuid = randomUUID;

/* ───────────────────────── Estimar ───────────────────────── */

/**
 * No se pudo leer: guarda una lectura estimada (la anterior más el promedio de los últimos meses).
 * Si el operario había dejado una novedad ("casa cerrada"), se conserva junto con la estimación.
 * El punto tiene que tener historial (`anterior` y `promedio`).
 */
export async function estimarPunto(punto: Punto, transaction: Transaction): Promise<{ id: number; valor: number; consumo: number | null }> {
  const digitos = punto.digitos;
  const factor = Number(punto.factor);
  const anterior = Number(punto.anterior);
  const valor = estimarLectura({ anterior, promedio: Number(punto.promedio), digitos, factor });
  const motivo = valor < anterior ? ('vuelta_contador' as const) : null;
  const { consumo } = evaluarLectura({ valor, anterior, promedio: null, digitos, factor, motivo });
  const datos = { valor: String(valor), anterior: punto.anterior, consumo: consumo === null ? null : String(consumo), tipo: 'estimada' as const, motivo, anomalia: null };
  let lectura = punto.lectura_id === null ? null : await Lectura.findByPk(punto.lectura_id, { transaction });
  if (lectura) await lectura.update(datos, { transaction });
  else {
    lectura = await Lectura.create(
      { ...datos, uuidDispositivo: randomUUID(), periodoId: punto.periodo_id, medidorId: punto.medidor_id, tomadaEl: new Date(), operarioId: null },
      { transaction },
    );
  }
  return { id: lectura.id, valor, consumo };
}

/* ───────────────────────── Antes de cerrar la lectura ───────────────────────── */

/** Lectura menor a la anterior sin motivo. No cuenta si la anterior fue estimada: ahí la real manda y la diferencia queda a favor. */
export const SIN_RESOLVER = `l.valor IS NOT NULL AND l.consumo IS NULL AND l.anterior IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM lecturas lp JOIN periodos pp ON pp.id = lp.periodo_id
    WHERE lp.medidor_id = m.id AND lp.tipo = 'estimada' AND (pp.anio * 12 + pp.mes) = (p.anio * 12 + p.mes) - 1)`;
/** Tiene meses anteriores con consumo: se puede estimar. */
const CON_HISTORIAL = `EXISTS (
    SELECT 1 FROM lecturas a JOIN periodos pa ON pa.id = a.periodo_id
    WHERE a.medidor_id = m.id AND a.consumo IS NOT NULL AND (pa.anio * 12 + pa.mes) < (p.anio * 12 + p.mes))`;
export const ESTIMABLE = `l.valor IS NULL AND ${CON_HISTORIAL}`;

type Conteos = Omit<ControlCierre, 'bloqueantes'>;

/** Qué falta para poder cerrar la lectura del mes que está abierto. */
export async function controlDeCierre(): Promise<ControlCierre> {
  const [f] = await sequelize.query<Record<keyof Conteos, string>>(
    `SELECT count(*) AS total,
            count(*) FILTER (WHERE l.valor IS NOT NULL) AS leidos,
            count(*) FILTER (WHERE ${ESTIMABLE}) AS estimables,
            count(*) FILTER (WHERE l.valor IS NULL AND NOT ${CON_HISTORIAL}) AS "sinHistorial",
            count(*) FILTER (WHERE ${SIN_RESOLVER}) AS "sinResolver",
            count(*) FILTER (WHERE l.tipo = 'estimada') AS estimadas,
            count(*) FILTER (WHERE l.anomalia IS NOT NULL AND l.revisada_el IS NULL) AS anomalias,
            count(*) FILTER (WHERE l.novedad IS NOT NULL AND l.revisada_el IS NULL) AS novedades
     ${DESDE_PUNTOS}
     WHERE ${DONDE_PUNTOS}`,
    { replacements: { cooperativaId: requireCooperativaId() }, type: QueryTypes.SELECT },
  );
  const n = (clave: keyof Conteos) => Number(f?.[clave] ?? 0);
  const control: Conteos = {
    total: n('total'),
    leidos: n('leidos'),
    estimables: n('estimables'),
    sinHistorial: n('sinHistorial'),
    sinResolver: n('sinResolver'),
    estimadas: n('estimadas'),
    anomalias: n('anomalias'),
    novedades: n('novedades'),
  };
  return { ...control, bloqueantes: control.estimables + control.sinResolver };
}
