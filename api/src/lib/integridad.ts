// Integridad de los datos. Cada factura, nota de crédito y recibo emitido lleva una huella: una firma
// HMAC de sus datos (con su detalle) más la huella del anterior de su mismo talonario. El registro de
// cambios (auditoría) va encadenado igual, en el orden en que se sella. La clave de la firma no está en
// la base (CLAVE_INTEGRIDAD): quien cambie, borre o agregue una fila directamente en la base no puede
// rehacer la cadena, y la verificación marca el lugar exacto.
//
// Qué entra en la huella: solo lo que no cambia nunca después de emitir. El saldo y el estado de una
// factura cambian con cada cobro (y el estado de un recibo, al anularlo): esos se controlan aparte,
// cruzándolos con los cobros y con el registro de cambios.
import { createHmac } from 'node:crypto';
import { QueryTypes, type Transaction } from 'sequelize';
import {
  PROBLEMA_ETIQUETA,
  referenciaComprobante,
  type LibroIntegridad,
  type ProblemaIntegridad,
  type ResumenIntegridad,
  type TipoComprobante,
  type TipoProblema,
} from '../shared';
import { config } from '../config';
import { sequelize } from '../db';
import { Cooperativa, VerificacionIntegridad } from '../models';
import { alertar } from './alertas';
import { runInCooperativa } from './context';
import { conflict } from './errors';
import { requireCooperativaId } from './tenant';

const VERSION = 'v1';
const firmar = (texto: string) => createHmac('sha256', config.claveIntegridad).update(texto).digest('hex');
/** Primer eslabón de una cadena: depende de la cadena, así no se puede mover una fila de un talonario a otro. */
const inicio = (cadena: string) => firmar(`${VERSION}|inicio|${cadena}`);
const eslabon = (anterior: string, canon: string) => firmar(`${VERSION}|${anterior}|${canon}`);

function consulta<T extends object>(sql: string, bind: Record<string, unknown>, transaction?: Transaction): Promise<T[]> {
  return sequelize.query<T>(sql, { bind, type: QueryTypes.SELECT, transaction });
}
async function ejecutar(sql: string, bind: Record<string, unknown>, transaction?: Transaction): Promise<void> {
  await sequelize.query(sql, { bind, type: QueryTypes.RAW, transaction });
}
/** Huella SHA-256 de un texto, calculada en la base (así el detalle no viaja entero). */
const sha = (expr: string) => `encode(sha256(convert_to(${expr}, 'UTF8')), 'hex')`;

/* ───────────────────────── Qué se firma de cada cosa ───────────────────────── */

interface FilaComprobante {
  id: number;
  numero: number;
  huella: string | null;
  cooperativa_id: number;
  tipo: TipoComprobante;
  letra: string;
  punto_venta: number;
  socio_id: number;
  conexion_id: number | null;
  servicio: string;
  anio: number;
  mes: number;
  emitido_el: string | null;
  vence_el: string | null;
  total: string;
  cae: string | null;
  cae_vence: string | null;
  cae_ambiente: string | null;
  origen_id: number | null;
  snapshot: string;
  renglones: string;
}

const COLUMNAS_COMPROBANTE = `
  c.id, c.numero, c.huella, c.cooperativa_id, c.tipo, c.letra, c.punto_venta, c.socio_id, c.conexion_id, c.servicio, c.anio, c.mes,
  to_char(c.emitido_el, 'YYYY-MM-DD') AS emitido_el, to_char(c.vence_el, 'YYYY-MM-DD') AS vence_el, c.total::text AS total,
  c.cae, to_char(c.cae_vence, 'YYYY-MM-DD') AS cae_vence, c.cae_ambiente, c.origen_id,
  ${sha('c.snapshot_json::text')} AS snapshot,
  ${sha(`coalesce((SELECT json_agg(json_build_array(r.orden, r.grupo, r.codigo, r.servicio, r.descripcion, r.cantidad::text, r.unitario::text,
           r.porcentaje::text, r.base::text, r.importe::text, r.subsidiado, r.nota) ORDER BY r.orden, r.id)
         FROM comprobante_renglones r WHERE r.comprobante_id = c.id)::text, '[]')`)} AS renglones`;

const canonComprobante = (f: FilaComprobante) =>
  JSON.stringify([
    'comprobante', f.id, f.cooperativa_id, f.tipo, f.letra, f.punto_venta, f.numero, f.socio_id, f.conexion_id, f.servicio, f.anio, f.mes,
    f.emitido_el, f.vence_el, f.total, f.cae, f.cae_vence, f.cae_ambiente, f.origen_id, f.snapshot, f.renglones,
  ]);
const cadenaComprobantes = (f: { cooperativa_id: number; tipo: string; letra: string; punto_venta: number }) =>
  `comprobantes|${f.cooperativa_id}|${f.tipo}|${f.letra}|${f.punto_venta}`;

interface FilaPago {
  id: number;
  numero: number;
  huella: string | null;
  cooperativa_id: number;
  letra: string;
  punto_venta: number;
  caja_id: number | null;
  cajero_id: number | null;
  socio_id: number | null;
  medio: string;
  origen: string;
  importe: string;
  recibido: string | null;
  vuelto: string | null;
  a_favor: string;
  cobrado_el: string;
  ref_externa: string | null;
  clave: string | null;
  intento_id: string | null;
  snapshot: string;
  detalle: string;
}

const COLUMNAS_PAGO = `
  p.id, p.numero, p.huella, p.cooperativa_id, p.letra, p.punto_venta, p.caja_id, p.cajero_id, p.socio_id, p.medio, p.origen,
  p.importe::text AS importe, p.recibido::text AS recibido, p.vuelto::text AS vuelto, p.a_favor::text AS a_favor,
  to_char(p.cobrado_el AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS cobrado_el, p.ref_externa, p.clave::text AS clave, p.intento_id::text AS intento_id,
  ${sha('p.snapshot_json::text')} AS snapshot,
  ${sha(`json_build_array(
      (SELECT json_agg(json_build_array(a.comprobante_id, a.importe::text, a.saldo_despues::text) ORDER BY a.id) FROM pago_aplicaciones a WHERE a.pago_id = p.id),
      (SELECT json_agg(json_build_array(i.producto_id, i.descripcion, i.cantidad, i.unitario::text, i.importe::text) ORDER BY i.id) FROM pago_items i WHERE i.pago_id = p.id)
    )::text`)} AS detalle`;

const canonPago = (f: FilaPago) =>
  JSON.stringify([
    'pago', f.id, f.cooperativa_id, f.letra, f.punto_venta, f.numero, f.caja_id, f.cajero_id, f.socio_id, f.medio, f.origen, f.importe,
    f.recibido, f.vuelto, f.a_favor, f.cobrado_el, f.ref_externa, f.clave, f.intento_id, f.snapshot, f.detalle,
  ]);
const cadenaPagos = (f: { cooperativa_id: number; letra: string; punto_venta: number }) => `pagos|${f.cooperativa_id}|${f.letra}|${f.punto_venta}`;

interface FilaAuditoria {
  id: number;
  sellado_n: string | null;
  huella: string | null;
  cooperativa_id: number | null;
  usuario_id: number | null;
  accion: string;
  entidad: string;
  entidad_id: string | null;
  ip: string | null;
  creado_el: string;
  datos: string;
}

const COLUMNAS_AUDITORIA = `
  a.id, a.sellado_n, a.huella, a.cooperativa_id, a.usuario_id, a.accion, a.entidad, a.entidad_id, a.ip,
  to_char(a.creado_el AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS creado_el,
  ${sha('json_build_array(a.antes_json, a.despues_json)::text')} AS datos`;

const canonAuditoria = (f: FilaAuditoria, n: string) =>
  JSON.stringify(['auditoria', f.id, n, f.cooperativa_id, f.usuario_id, f.accion, f.entidad, f.entidad_id, f.ip, f.creado_el, f.datos]);
const cadenaAuditoria = (cooperativaId: number | null) => `auditoria|${cooperativaId ?? 'srv'}`;

/* ───────────────────────── Sellar ───────────────────────── */

interface Tabla<F extends { id: number; numero: number; huella: string | null }> {
  nombre: 'comprobantes' | 'pagos';
  alias: 'c' | 'p';
  columnas: string;
  canon: (f: F) => string;
  cadena: (f: F) => string;
  /** Condición «mismo talonario» para la fila `f`, con sus parámetros. */
  talonario: (f: F) => { sql: string; bind: Record<string, unknown> };
}

const COMPROBANTES: Tabla<FilaComprobante> = {
  nombre: 'comprobantes',
  alias: 'c',
  columnas: COLUMNAS_COMPROBANTE,
  canon: canonComprobante,
  cadena: cadenaComprobantes,
  talonario: (f) => ({ sql: 'c.tipo = $tipo AND c.letra = $letra AND c.punto_venta = $puntoVenta', bind: { tipo: f.tipo, letra: f.letra, puntoVenta: f.punto_venta } }),
};

const PAGOS: Tabla<FilaPago> = {
  nombre: 'pagos',
  alias: 'p',
  columnas: COLUMNAS_PAGO,
  canon: canonPago,
  cadena: cadenaPagos,
  talonario: (f) => ({ sql: 'p.letra = $letra AND p.punto_venta = $puntoVenta', bind: { letra: f.letra, puntoVenta: f.punto_venta } }),
};

/**
 * Pone la huella a filas recién numeradas. Va dentro de la misma transacción que les reservó el número:
 * el numerador queda bloqueado hasta el final, así que nadie más escribe en ese talonario mientras tanto.
 */
async function sellar<F extends { id: number; numero: number; huella: string | null }>(t: Tabla<F>, ids: number[], transaction: Transaction): Promise<void> {
  if (ids.length === 0) return;
  const cooperativaId = requireCooperativaId();
  const filas = await consulta<F>(
    `SELECT ${t.columnas} FROM ${t.nombre} ${t.alias} WHERE ${t.alias}.cooperativa_id = $cooperativaId AND ${t.alias}.id = ANY($ids) AND ${t.alias}.numero IS NOT NULL`,
    { cooperativaId, ids },
    transaction,
  );
  const porCadena = new Map<string, F[]>();
  for (const f of filas) porCadena.set(t.cadena(f), [...(porCadena.get(t.cadena(f)) ?? []), f]);

  const nuevas: { id: number; huella: string }[] = [];
  for (const [cadena, grupo] of porCadena) {
    grupo.sort((a, b) => a.numero - b.numero || a.id - b.id);
    const primero = grupo[0]!;
    const ultimo = grupo[grupo.length - 1]!;
    const { sql, bind } = t.talonario(primero);
    const base = { cooperativaId, ...bind, desde: primero.numero, hasta: ultimo.numero };
    // El eslabón anterior al primero y, por las dudas, cualquier fila del talonario que esté en el medio.
    const [antes] = await consulta<{ huella: string | null }>(
      `SELECT ${t.alias}.huella FROM ${t.nombre} ${t.alias}
       WHERE ${t.alias}.cooperativa_id = $cooperativaId AND ${sql} AND ${t.alias}.numero < $desde
       ORDER BY ${t.alias}.numero DESC, ${t.alias}.id DESC LIMIT 1`,
      base,
      transaction,
    );
    const enRango = await consulta<{ id: number; huella: string | null }>(
      `SELECT ${t.alias}.id, ${t.alias}.huella FROM ${t.nombre} ${t.alias}
       WHERE ${t.alias}.cooperativa_id = $cooperativaId AND ${sql} AND ${t.alias}.numero BETWEEN $desde AND $hasta
       ORDER BY ${t.alias}.numero, ${t.alias}.id`,
      base,
      transaction,
    );
    const delLote = new Map(grupo.map((f) => [f.id, f]));
    let anterior = antes?.huella ?? inicio(cadena);
    for (const fila of enRango) {
      const propia = delLote.get(fila.id);
      if (!propia) {
        anterior = fila.huella ?? inicio(cadena);
        continue;
      }
      const huella = eslabon(anterior, t.canon(propia));
      nuevas.push({ id: propia.id, huella });
      anterior = huella;
    }
  }
  if (nuevas.length) {
    await ejecutar(
      `UPDATE ${t.nombre} SET huella = x.huella FROM jsonb_to_recordset(CAST($datos AS jsonb)) AS x(id int, huella text)
       WHERE ${t.nombre}.id = x.id AND ${t.nombre}.cooperativa_id = $cooperativaId`,
      { cooperativaId, datos: JSON.stringify(nuevas) },
      transaction,
    );
  }
}

/** Facturas o notas de crédito recién emitidas (ya con número, CAE y renglones). */
export const sellarComprobantes = (ids: number[], transaction: Transaction) => sellar(COMPROBANTES, ids, transaction);
/** Recibos recién cobrados (ya con sus aplicaciones e ítems). */
export const sellarPagos = (ids: number[], transaction: Transaction) => sellar(PAGOS, ids, transaction);

/**
 * Sella un registro de cambios ya confirmado. Corre en una transacción corta propia, con un turno por
 * cooperativa: el registro se encadena en el orden en que se sella (`sellado_n`). Solo sella la fila que
 * le pasan: una fila agregada a mano en la base nunca recibe huella.
 */
export async function sellarAuditoria(id: number, cooperativaId: number | null): Promise<void> {
  await sequelize.transaction(async (transaction) => {
    await ejecutar(`SELECT pg_advisory_xact_lock(hashtext($cadena))`, { cadena: cadenaAuditoria(cooperativaId) }, transaction);
    const [fila] = await consulta<FilaAuditoria>(`SELECT ${COLUMNAS_AUDITORIA} FROM auditoria a WHERE a.id = $id`, { id }, transaction);
    if (!fila || fila.sellado_n !== null) return;
    const [ultimo] = await consulta<{ sellado_n: string; huella: string | null }>(
      `SELECT a.sellado_n, a.huella FROM auditoria a
       WHERE COALESCE(a.cooperativa_id, 0) = $coop AND a.sellado_n IS NOT NULL ORDER BY a.sellado_n DESC LIMIT 1`,
      { coop: cooperativaId ?? 0 },
      transaction,
    );
    const n = String(ultimo ? BigInt(ultimo.sellado_n) + 1n : 1n);
    const huella = eslabon(ultimo?.huella ?? inicio(cadenaAuditoria(cooperativaId)), canonAuditoria(fila, n));
    await ejecutar(`UPDATE auditoria SET sellado_n = CAST($n AS bigint), huella = $huella WHERE id = $id`, { id, n, huella }, transaction);
  });
}

/**
 * Sella todo lo que todavía no tiene huella, en orden. Solo para datos que existían antes de la cadena:
 * el seed de la demo y la puesta en marcha (una sola vez). En el uso normal la app sella al emitir.
 * Nunca rehace un eslabón ya sellado.
 */
export async function sellarPendientes(cooperativaId: number): Promise<{ comprobantes: number; pagos: number; auditoria: number }> {
  return runInCooperativa(cooperativaId, async () => {
    const contar = { comprobantes: 0, pagos: 0, auditoria: 0 };
    for (const [t, clave] of [
      [COMPROBANTES, 'comprobantes'],
      [PAGOS, 'pagos'],
    ] as const) {
      // En orden de número dentro de cada talonario: cada tanda empieza donde terminó la anterior.
      const talonario = t.nombre === 'comprobantes' ? 'x.tipo, x.letra, x.punto_venta' : 'x.letra, x.punto_venta';
      const pendientes = await consulta<{ id: number }>(
        `SELECT x.id FROM ${t.nombre} x WHERE x.cooperativa_id = $cooperativaId AND x.numero IS NOT NULL AND x.huella IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM ${t.nombre} y WHERE y.cooperativa_id = x.cooperativa_id AND y.huella IS NOT NULL AND y.letra = x.letra AND y.punto_venta = x.punto_venta
               ${t.nombre === 'comprobantes' ? 'AND y.tipo = x.tipo' : ''} AND (y.numero, y.id) > (x.numero, x.id))
         ORDER BY ${talonario}, x.numero, x.id`,
        { cooperativaId },
      );
      const LOTE = 2000;
      for (let i = 0; i < pendientes.length; i += LOTE) {
        await sequelize.transaction((transaction) =>
          (t === COMPROBANTES ? sellarComprobantes : sellarPagos)(
            pendientes.slice(i, i + LOTE).map((p) => p.id),
            transaction,
          ),
        );
      }
      contar[clave] = pendientes.length;
    }
    const registros = await consulta<{ id: number }>(`SELECT a.id FROM auditoria a WHERE a.cooperativa_id = $cooperativaId AND a.sellado_n IS NULL ORDER BY a.id`, { cooperativaId });
    for (const r of registros) await sellarAuditoria(r.id, cooperativaId);
    contar.auditoria = registros.length;
    return contar;
  });
}

/* ───────────────────────── Verificar ───────────────────────── */

const LIMITE_PROBLEMAS = 200;
const PAGINA = 2000;

class Anotador {
  lista: ProblemaIntegridad[] = [];
  total = 0;
  porLibro: Record<LibroIntegridad, number> = { facturas: 0, cobros: 0, auditoria: 0 };
  anotar(libro: LibroIntegridad, tipo: TipoProblema, referencia: string, entidadId: number | null, detalle?: string) {
    this.total += 1;
    this.porLibro[libro] += 1;
    if (this.lista.length < LIMITE_PROBLEMAS) this.lista.push({ tipo, libro, referencia, entidadId, detalle: detalle ?? PROBLEMA_ETIQUETA[tipo].explicacion });
  }
}

/** Recorre una cadena de punta a punta, de a páginas, y anota cada eslabón que no cierra. */
async function recorrerTalonarios<F extends { id: number; numero: number; huella: string | null }>(
  t: Tabla<F>,
  libro: LibroIntegridad,
  referencia: (f: F, numero?: number) => string,
  a: Anotador,
): Promise<number> {
  const cooperativaId = requireCooperativaId();
  const claves = t.nombre === 'comprobantes' ? 'tipo, letra, punto_venta' : 'letra, punto_venta';
  const talonarios = await consulta<F>(
    `SELECT DISTINCT ${claves}, cooperativa_id FROM ${t.nombre} WHERE cooperativa_id = $cooperativaId AND numero IS NOT NULL ORDER BY ${claves}`,
    { cooperativaId },
  );
  let revisados = 0;
  for (const tal of talonarios) {
    const cadena = t.cadena(tal);
    const { sql, bind } = t.talonario(tal);
    let anterior = inicio(cadena);
    let numeroAnterior: number | null = null;
    let cursor = { numero: -1, id: 0 };
    for (;;) {
      const filas = await consulta<F>(
        `SELECT ${t.columnas} FROM ${t.nombre} ${t.alias}
         WHERE ${t.alias}.cooperativa_id = $cooperativaId AND ${sql} AND ${t.alias}.numero IS NOT NULL
           AND (${t.alias}.numero, ${t.alias}.id) > ($numero, $id)
         ORDER BY ${t.alias}.numero, ${t.alias}.id LIMIT ${PAGINA}`,
        { cooperativaId, ...bind, ...cursor },
      );
      for (const f of filas) {
        revisados += 1;
        if (numeroAnterior !== null && f.numero === numeroAnterior) a.anotar(libro, 'numero_repetido', referencia(f), f.id);
        else if (numeroAnterior !== null && f.numero > numeroAnterior + 1) {
          const desde = numeroAnterior + 1;
          const hasta = f.numero - 1;
          a.anotar(libro, 'numeracion_salteada', referencia(f, desde), null, desde === hasta ? `Falta el ${referencia(f, desde)}.` : `Faltan del ${referencia(f, desde)} al ${referencia(f, hasta)}.`);
        }
        if (f.huella === null) a.anotar(libro, 'sin_huella', referencia(f), f.id);
        else if (f.huella !== eslabon(anterior, t.canon(f))) a.anotar(libro, 'huella_no_coincide', referencia(f), f.id);
        anterior = f.huella ?? inicio(cadena);
        numeroAnterior = f.numero;
      }
      if (filas.length < PAGINA) break;
      const ultima = filas[filas.length - 1]!;
      cursor = { numero: ultima.numero, id: ultima.id };
    }
  }
  return revisados;
}

async function recorrerAuditoria(a: Anotador): Promise<number> {
  const cooperativaId = requireCooperativaId();
  const cadena = cadenaAuditoria(cooperativaId);
  let anterior = inicio(cadena);
  let nAnterior: bigint | null = null;
  let cursor = '0';
  let revisados = 0;
  for (;;) {
    const filas = await consulta<FilaAuditoria>(
      `SELECT ${COLUMNAS_AUDITORIA} FROM auditoria a
       WHERE a.cooperativa_id = $cooperativaId AND a.sellado_n IS NOT NULL AND a.sellado_n > CAST($cursor AS bigint)
       ORDER BY a.sellado_n LIMIT ${PAGINA}`,
      { cooperativaId, cursor },
    );
    for (const f of filas) {
      revisados += 1;
      const n = BigInt(f.sellado_n!);
      const ref = `Registro n.º ${f.sellado_n}`;
      const esperado = nAnterior === null ? 1n : nAnterior + 1n;
      if (n > esperado) {
        a.anotar('auditoria', 'numeracion_salteada', ref, null, n - esperado === 1n ? `Falta el registro n.º ${esperado}: fue borrado.` : `Faltan los registros del n.º ${esperado} al ${n - 1n}: fueron borrados.`);
      }
      if (f.huella === null || f.huella !== eslabon(anterior, canonAuditoria(f, f.sellado_n!))) a.anotar('auditoria', 'huella_no_coincide', ref, f.id);
      anterior = f.huella ?? inicio(cadena);
      nAnterior = n;
    }
    if (filas.length < PAGINA) break;
    cursor = filas[filas.length - 1]!.sellado_n!;
  }
  // Registros sin sellar: nunca pasaron por la app. (Se deja un minuto de margen al que se está sellando ahora.)
  const sinSellar = await consulta<{ id: number }>(
    `SELECT a.id FROM auditoria a WHERE a.cooperativa_id = $cooperativaId AND a.sellado_n IS NULL AND a.creado_el < now() - interval '1 minute' ORDER BY a.id`,
    { cooperativaId },
  );
  for (const f of sinSellar) a.anotar('auditoria', 'sin_huella', `Registro sin sellar (id ${f.id})`, f.id);
  return revisados + sinSellar.length;
}

const refComprobante = (f: { tipo: TipoComprobante; letra: string; punto_venta: number; numero: number }, numero = f.numero) =>
  referenciaComprobante({ tipo: f.tipo, letra: f.letra, puntoVenta: f.punto_venta, numero });
const refPago = (f: { letra: string; punto_venta: number; numero: number }, numero = f.numero) =>
  referenciaComprobante({ tipo: 'recibo', letra: f.letra, puntoVenta: f.punto_venta, numero });

/** Lo que no entra en la huella porque cambia con el uso: saldos, estados y anulaciones. */
async function controlar(a: Anotador): Promise<void> {
  const cooperativaId = requireCooperativaId();
  type Fila = { id: number; tipo: TipoComprobante; letra: string; punto_venta: number; numero: number } & Record<string, string | number>;
  const facturas = async (tipo: TipoProblema, sql: string, detalle?: (f: Fila) => string) => {
    for (const f of await consulta<Fila>(sql, { cooperativaId })) a.anotar('facturas', tipo, refComprobante(f), f.id, detalle?.(f));
  };

  await facturas(
    'total_no_cierra',
    `SELECT c.id, c.tipo, c.letra, c.punto_venta, c.numero, c.total::text AS total, COALESCE(r.suma, 0)::text AS suma
     FROM comprobantes c
     LEFT JOIN LATERAL (SELECT sum(x.importe) AS suma FROM comprobante_renglones x WHERE x.comprobante_id = c.id) r ON TRUE
     WHERE c.cooperativa_id = $cooperativaId AND c.numero IS NOT NULL AND c.total <> COALESCE(r.suma, 0)
     ORDER BY c.id`,
    (f) => `El total es ${f.total} y el detalle suma ${f.suma}.`,
  );
  await facturas(
    'saldo_no_cierra',
    `SELECT c.id, c.tipo, c.letra, c.punto_venta, c.numero, c.saldo::text AS saldo, (GREATEST(c.total, 0) - COALESCE(x.cobrado, 0))::text AS esperado
     FROM comprobantes c
     LEFT JOIN LATERAL (
       SELECT sum(pa.importe) AS cobrado FROM pago_aplicaciones pa JOIN pagos p ON p.id = pa.pago_id
       WHERE pa.comprobante_id = c.id AND p.estado = 'acreditado'
     ) x ON TRUE
     WHERE c.cooperativa_id = $cooperativaId AND c.tipo = 'factura' AND c.estado IN ('emitido', 'pagado')
       AND c.saldo <> GREATEST(c.total, 0) - COALESCE(x.cobrado, 0)
     ORDER BY c.id`,
    (f) => `Figura un saldo de ${f.saldo} y, por los cobros, debería ser ${f.esperado}.`,
  );
  await facturas(
    'estado_no_cierra',
    `SELECT c.id, c.tipo, c.letra, c.punto_venta, c.numero, c.estado, c.saldo::text AS saldo FROM comprobantes c
     WHERE c.cooperativa_id = $cooperativaId AND c.tipo = 'factura' AND c.numero IS NOT NULL
       AND ((c.estado = 'pagado' AND c.saldo <> 0) OR (c.estado = 'emitido' AND c.saldo <= 0 AND c.total > 0) OR (c.estado = 'anulado' AND c.saldo <> 0))
     ORDER BY c.id`,
    (f) => `Figura «${f.estado}» con un saldo de ${f.saldo}.`,
  );
  await facturas(
    'anulada_sin_nota',
    `SELECT c.id, c.tipo, c.letra, c.punto_venta, c.numero FROM comprobantes c
     WHERE c.cooperativa_id = $cooperativaId AND c.tipo = 'factura' AND c.estado = 'anulado'
       AND NOT EXISTS (SELECT 1 FROM comprobantes n WHERE n.cooperativa_id = c.cooperativa_id AND n.tipo = 'nota_credito' AND n.origen_id = c.id AND n.numero IS NOT NULL)
     ORDER BY c.id`,
  );
  await facturas(
    'anulacion_sin_registro',
    `SELECT c.id, c.tipo, c.letra, c.punto_venta, c.numero FROM comprobantes c
     WHERE c.cooperativa_id = $cooperativaId AND c.tipo = 'factura' AND c.estado = 'anulado'
       AND NOT EXISTS (SELECT 1 FROM auditoria x WHERE x.cooperativa_id = c.cooperativa_id AND x.accion = 'anular_factura' AND x.entidad_id = c.id::text AND x.sellado_n IS NOT NULL)
     ORDER BY c.id`,
  );

  type RefPago = { id: number; letra: string; punto_venta: number; numero: number } & Record<string, string | number>;
  for (const f of await consulta<RefPago>(
    `SELECT p.id, p.letra, p.punto_venta, p.numero FROM pagos p
     WHERE p.cooperativa_id = $cooperativaId AND p.estado = 'anulado'
       AND NOT EXISTS (SELECT 1 FROM auditoria x WHERE x.cooperativa_id = p.cooperativa_id AND x.accion = 'anular_cobro' AND x.entidad_id = p.id::text AND x.sellado_n IS NOT NULL)
     ORDER BY p.id`,
    { cooperativaId },
  )) {
    a.anotar('cobros', 'anulacion_sin_registro', refPago(f), f.id);
  }
  for (const f of await consulta<RefPago>(
    `SELECT p.id, p.letra, p.punto_venta, p.numero, p.importe::text AS importe, (COALESCE(ap.s, 0) + COALESCE(it.s, 0) + p.a_favor)::text AS suma
     FROM pagos p
     LEFT JOIN LATERAL (SELECT sum(importe) AS s FROM pago_aplicaciones WHERE pago_id = p.id) ap ON TRUE
     LEFT JOIN LATERAL (SELECT sum(importe) AS s FROM pago_items WHERE pago_id = p.id) it ON TRUE
     WHERE p.cooperativa_id = $cooperativaId AND p.importe <> COALESCE(ap.s, 0) + COALESCE(it.s, 0) + p.a_favor
     ORDER BY p.id`,
    { cooperativaId },
  )) {
    a.anotar('cobros', 'cobro_no_cierra', refPago(f), f.id, `El recibo es por ${f.importe} y lo que paga suma ${f.suma}.`);
  }
}

/** Revisa toda la cooperativa en curso: las tres cadenas y los controles de saldos y anulaciones. */
export async function verificarIntegridad(): Promise<{ resumen: ResumenIntegridad; total: number; problemas: ProblemaIntegridad[] }> {
  const a = new Anotador();
  const facturas = await recorrerTalonarios(COMPROBANTES, 'facturas', refComprobante, a);
  const cobros = await recorrerTalonarios(PAGOS, 'cobros', refPago, a);
  const auditoria = await recorrerAuditoria(a);
  await controlar(a);
  return {
    resumen: {
      facturas: { revisados: facturas, problemas: a.porLibro.facturas },
      cobros: { revisados: cobros, problemas: a.porLibro.cobros },
      auditoria: { revisados: auditoria, problemas: a.porLibro.auditoria },
    },
    total: a.total,
    problemas: a.lista,
  };
}

/* ───────────────────────── Verificación en segundo plano y avisos ───────────────────────── */

const corriendo = new Set<Promise<void>>();

/** Arranca una verificación de la cooperativa en curso y vuelve enseguida. Una sola a la vez por cooperativa. */
export async function lanzarVerificacion(origen: 'manual' | 'automatica', usuarioId: number | null): Promise<VerificacionIntegridad> {
  const cooperativaId = requireCooperativaId();
  let registro: VerificacionIntegridad;
  try {
    registro = await VerificacionIntegridad.create({ origen, usuarioId });
  } catch (err) {
    if ((err as { name?: string }).name === 'SequelizeUniqueConstraintError') throw conflict('Ya hay una verificación en marcha. Esperá a que termine.');
    throw err;
  }
  const tarea = runInCooperativa(cooperativaId, async () => {
    try {
      const r = await verificarIntegridad();
      await VerificacionIntegridad.update(
        { estado: r.total === 0 ? 'ok' : 'con_problemas', resumenJson: r.resumen, problemasJson: { total: r.total, lista: r.problemas }, terminadaEl: new Date() },
        { where: { id: registro.id } },
      );
      if (r.total > 0) await avisarProblemas(cooperativaId, r.total, r.resumen, r.problemas);
    } catch (err) {
      console.error(`[INTEGRIDAD] cooperativa ${cooperativaId}`, err);
      await VerificacionIntegridad.update({ estado: 'fallida', error: 'Se interrumpió por un problema nuestro. Probá de nuevo.', terminadaEl: new Date() }, { where: { id: registro.id } }).catch(() => undefined);
      await alertar(cooperativaId, { roles: [], srv: true }, {
        tipo: 'integridad_fallida',
        titulo: 'La verificación de integridad no pudo terminar',
        cuerpo: `La verificación ${origen === 'automatica' ? 'automática' : 'manual'} se cortó con un error. Revisá el registro del servidor.`,
        enlace: '/integridad',
      }).catch(() => undefined);
    }
  });
  corriendo.add(tarea);
  void tarea.finally(() => corriendo.delete(tarea));
  return registro;
}

async function avisarProblemas(cooperativaId: number, total: number, resumen: ResumenIntegridad, problemas: ProblemaIntegridad[]): Promise<void> {
  const tipos = [...new Set(problemas.map((p) => PROBLEMA_ETIQUETA[p.tipo].titulo))];
  const ejemplos = problemas.slice(0, 5).map((p) => `- ${PROBLEMA_ETIQUETA[p.tipo].titulo}: ${p.referencia}`);
  const cuerpo = [
    `La verificación de integridad encontró ${total === 1 ? '1 problema' : `${total} problemas`} en los datos.`,
    `Facturas: ${resumen.facturas.problemas} · Cobros: ${resumen.cobros.problemas} · Registro de cambios: ${resumen.auditoria.problemas}.`,
    `Qué encontró: ${tipos.join(', ')}.`,
    ejemplos.join('\n') + (total > ejemplos.length ? `\n- …y ${total - ejemplos.length} más.` : ''),
    'Puede ser un cambio hecho directamente en la base de datos, por fuera de la app. No borres ni corrijas nada todavía: el detalle sirve para saber qué pasó.',
  ].join('\n\n');
  await alertar(cooperativaId, { roles: ['admin', 'gerencia'], srv: true }, { tipo: 'integridad', titulo: 'Atención: la verificación de integridad encontró problemas', cuerpo, enlace: '/integridad' });
}

/** Espera a que terminen las verificaciones lanzadas en este proceso (para los tests y el cierre ordenado). */
export async function esperarVerificaciones(): Promise<void> {
  await Promise.all([...corriendo]);
}

/** Al arrancar la API: una verificación que quedó «en curso» murió con el proceso anterior. */
export async function cerrarVerificacionesHuerfanas(): Promise<void> {
  await sequelize.query(
    `UPDATE verificaciones_integridad SET estado = 'fallida', error = 'El servidor se reinició en medio de la verificación. Volvé a pedirla.', terminada_el = now()
     WHERE estado = 'en_curso'`,
  );
}

/* ───────────────────────── Todos los días ───────────────────────── */

let proxima: Date | null = null;

/** Cuándo corre la próxima verificación automática (`null` = no está programada en este servidor). */
export const proximaVerificacion = (): Date | null => proxima;

/** Próxima vez que el reloj de Argentina (UTC−3, sin horario de verano) marca esa hora. */
export function proximaHora(hora: number, minuto: number, desde = new Date()): Date {
  const enArgentina = new Date(desde.getTime() - 3 * 3600_000);
  const objetivo = Date.UTC(enArgentina.getUTCFullYear(), enArgentina.getUTCMonth(), enArgentina.getUTCDate(), hora + 3, minuto);
  return new Date(objetivo > desde.getTime() ? objetivo : objetivo + 24 * 3600_000);
}

/** Verifica todas las cooperativas activas, una por una. */
export async function verificarTodas(): Promise<void> {
  const cooperativas = await Cooperativa.findAll({ where: { activa: true }, attributes: ['id'], order: [['id', 'ASC']] });
  for (const c of cooperativas) {
    try {
      await runInCooperativa(c.id, () => lanzarVerificacion('automatica', null));
      await esperarVerificaciones();
    } catch (err) {
      console.error(`[INTEGRIDAD] no se pudo verificar la cooperativa ${c.id}`, err);
    }
  }
}

/** Deja programada la verificación diaria (en el servidor; en los tests no corre). */
export function programarVerificacionDiaria(): void {
  if (!config.horaVerificacion) return;
  const { hora, minuto } = config.horaVerificacion;
  const siguiente = () => {
    proxima = proximaHora(hora, minuto);
    const timer = setTimeout(() => {
      void verificarTodas().finally(siguiente);
    }, proxima.getTime() - Date.now());
    timer.unref();
  };
  siguiente();
}
