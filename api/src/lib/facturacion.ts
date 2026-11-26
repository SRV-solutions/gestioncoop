// Facturación del mes: arma la entrada del motor para cada servicio de cada conexión, guarda las
// pre-facturas (borradores) y, al emitir, las numera. Todo en lotes y con SQL crudo —son miles de
// filas—, así que cada consulta lleva su filtro por cooperativa escrito a mano.
import Decimal from 'decimal.js';
import { QueryTypes, type Transaction } from 'sequelize';
import {
  formatComprobante,
  formatDate,
  formatMoney,
  letraDe,
  nombreDeMes,
  SERVICIO_ETIQUETA,
  SERVICIOS_MEDIDOS,
  TIMEZONE,
  VARIACION_RARA,
  type Categoria,
  type CondicionIva,
  type ConceptoDetalle,
  type CuadroDetalle,
  type DeudaVencida,
  type EntradaFactura,
  type FacturaCalculada,
  type MotivoLecturaMenor,
  type MotivoRara,
  type ParametrosFacturacion,
  type ServicioConexion,
  type ServicioMedido,
  type SnapshotComprobante,
  type TipoComprobante,
  type TipoProceso,
  type TramoLectura,
} from '../shared';
import { sequelize } from '../db';
import { Cooperativa, Periodo, Plan, ProcesoFacturacionModel } from '../models';
import { calcularFactura, ErrorDeCalculo, mesCompleto, sumarDias } from '../motor';
import type { ComprobanteAAutorizar } from '../proveedores/fiscal';
import { proveedorNotificaciones, type AvisoAlSocio } from '../proveedores/notificaciones';
import { ErrorArca } from './arca/transporte';
import { currentContext, requestContext } from './context';
import { conflict, HttpError } from './errors';
import { proveedorFiscalActual } from './fiscal';
import { sellarComprobantes } from './integridad';
import { cargarConceptos, cargarCuadros, parametrosDe } from './tarifas';
import { requireCooperativaId } from './tenant';

const LOTE = 250;
const esMedido = (s: string): s is ServicioMedido => (SERVICIOS_MEDIDOS as readonly string[]).includes(s);
const mesNumero = (anio: number, mes: number) => anio * 12 + mes;

/** Consulta con parámetros `$nombre` (viajan aparte del SQL: sirve para mandar miles de filas como JSON). */
function consulta<T extends object>(sql: string, bind: Record<string, unknown>, transaction?: Transaction): Promise<T[]> {
  return sequelize.query<T>(sql, { bind, type: QueryTypes.SELECT, transaction });
}
async function ejecutar(sql: string, bind: Record<string, unknown>, transaction?: Transaction): Promise<void> {
  await sequelize.query(sql, { bind, type: QueryTypes.RAW, transaction });
}

/* ───────────────────────── Lo que se lee de la base ───────────────────────── */

interface FilaServicio {
  id: number;
  servicio: ServicioConexion;
  categoria: Categoria | null;
  fecha_alta: string;
  fecha_baja: string | null;
  tiene_subsidio: boolean;
  plan_id: number | null;
  conexion_id: number;
  conexion_numero: number;
  direccion: string;
  zona: string | null;
  socio_id: number;
  socio_numero: number;
  nombre: string;
  tipo_doc: string;
  nro_doc: string;
  condicion_iva: CondicionIva;
}

interface FilaMedidor {
  servicio_conexion_id: number;
  numero: string;
  factor: string;
  digitos: number;
  lectura_id: number | null;
  valor: string | null;
  anterior: string | null;
  tipo: 'real' | 'estimada' | null;
  motivo: MotivoLecturaMenor | null;
  tipo_anterior: 'real' | 'estimada' | null;
}

interface FilaAnterior {
  servicio_conexion_id: number;
  anio: number;
  mes: number;
  total_servicio: string;
  a_favor: string;
  emitido_el: string;
  /** Tuvo el servicio todo el mes (sin prorrateo por alta o baja). */
  completo: boolean;
}

interface FilaDeuda {
  servicio_conexion_id: number;
  letra: string;
  punto_venta: number;
  numero: number;
  saldo: string;
  vence_el: string;
}

/** Parte de una factura que se pagó después de su vencimiento. */
interface FilaPagoTardio extends FilaDeuda {
  pagado_el: string;
}

/** Una pre-factura lista para guardar. */
interface Borrador {
  letra: string;
  socio_id: number;
  conexion_id: number;
  servicio_conexion_id: number;
  servicio: ServicioConexion;
  periodo_id: number | null;
  orden: number;
  total: string;
  total_servicio: string;
  consumo: string | null;
  a_favor: string;
  estimada: boolean;
  rara: MotivoRara | null;
  total_anterior: string | null;
  variacion: string | null;
  error: string | null;
  snapshot: SnapshotComprobante;
  renglones: FacturaCalculada['renglones'];
}

export interface OpcionesPrefactura {
  anio: number;
  mes: number;
  /** Día hasta el que se calculan los intereses por mora: la fecha en que se piensa emitir. */
  fechaEmision: string;
  /**
   * Carga del historial de prueba: un medidor que ese mes no tiene lectura (todavía no estaba
   * colocado) no se factura, en lugar de salir marcado para revisar.
   */
  historial?: boolean;
  alAvanzar?: (hechas: number, total: number) => Promise<void>;
}

/**
 * Calcula todas las pre-facturas de un mes y las guarda como borradores (reemplaza las que hubiera).
 * Una por servicio de cada conexión: energía (con el sepelio adentro), agua, internet y TV.
 * Lo que el motor no puede calcular queda como borrador con su explicación en `error`.
 */
export async function calcularPrefacturas(o: OpcionesPrefactura): Promise<{ cantidad: number; errores: number }> {
  const cooperativaId = requireCooperativaId();
  const usuarioId = currentContext()?.userId ?? null;
  const rango = mesCompleto(o.anio, o.mes);
  const n = mesNumero(o.anio, o.mes);
  const base = { cooperativaId, anio: o.anio, mes: o.mes };

  const [coop, cuadros, conceptos, planes, periodos, servicios, medidores, adherentes, anteriores, deudas, pagosTardios, yaFacturados] = await Promise.all([
    Cooperativa.findByPk(cooperativaId),
    cargarCuadros(rango),
    cargarConceptos(rango),
    Plan.findAll(),
    Periodo.findAll({ where: { anio: o.anio, mes: o.mes } }),
    consulta<FilaServicio>(
      `SELECT sc.id, sc.servicio, sc.categoria, to_char(sc.fecha_alta, 'YYYY-MM-DD') AS fecha_alta, to_char(sc.fecha_baja, 'YYYY-MM-DD') AS fecha_baja,
              sc.tiene_subsidio, sc.plan_id, c.id AS conexion_id, c.numero AS conexion_numero, c.direccion, z.nombre AS zona,
              s.id AS socio_id, s.numero AS socio_numero, s.nombre, s.tipo_doc, s.nro_doc, s.condicion_iva
       FROM servicios_conexion sc
       JOIN conexiones c ON c.id = sc.conexion_id AND c.eliminado_el IS NULL
       JOIN socios s ON s.id = c.socio_id
       LEFT JOIN zonas z ON z.id = c.zona_id
       WHERE sc.cooperativa_id = $cooperativaId AND sc.estado <> 'baja' AND sc.fecha_alta <= $hasta
         -- energía y agua se facturan aunque estén cortadas (cargo fijo); internet y TV, solo activos
         AND (sc.servicio IN ('energia', 'agua', 'sepelio') OR sc.estado = 'activo')
       ORDER BY c.ruta_id NULLS LAST, c.orden_ruta NULLS LAST, c.id, sc.servicio`,
      { cooperativaId, hasta: rango.hasta },
    ),
    // Medidores colocados, con su lectura del mes (si la hay) y si la del mes anterior fue estimada.
    consulta<FilaMedidor>(
      `SELECT m.servicio_conexion_id, m.numero, m.factor_mult AS factor, m.digitos,
              l.id AS lectura_id, l.valor, l.anterior, l.tipo, l.motivo, lp.tipo AS tipo_anterior
       FROM medidores m
       JOIN servicios_conexion sc ON sc.id = m.servicio_conexion_id
       LEFT JOIN periodos p ON p.cooperativa_id = m.cooperativa_id AND p.servicio = sc.servicio AND p.anio = $anio AND p.mes = $mes
       LEFT JOIN lecturas l ON l.periodo_id = p.id AND l.medidor_id = m.id
       LEFT JOIN periodos pp ON pp.cooperativa_id = m.cooperativa_id AND pp.servicio = sc.servicio AND (pp.anio * 12 + pp.mes) = $n - 1
       LEFT JOIN lecturas lp ON lp.periodo_id = pp.id AND lp.medidor_id = m.id
       WHERE m.cooperativa_id = $cooperativaId AND m.retirado_el IS NULL
       ORDER BY m.id`,
      { ...base, n },
    ),
    consulta<{ socio_id: number; n: string }>(
      `SELECT socio_id, count(*) AS n FROM beneficiarios_sepelio WHERE cooperativa_id = $cooperativaId AND alta_el <= $hasta GROUP BY socio_id`,
      { cooperativaId, hasta: rango.hasta },
    ),
    // La última factura de cada servicio: contra ella se compara, y trae el consumo que quedó a favor.
    consulta<FilaAnterior>(
      `SELECT DISTINCT ON (servicio_conexion_id) servicio_conexion_id, anio, mes, total_servicio, a_favor, to_char(emitido_el, 'YYYY-MM-DD') AS emitido_el,
              (snapshot_json->>'diasActivos') = (snapshot_json->>'dias') AS completo
       FROM comprobantes
       WHERE cooperativa_id = $cooperativaId AND tipo = 'factura' AND estado IN ('emitido', 'pagado') AND (anio * 12 + mes) < $n
       ORDER BY servicio_conexion_id, anio DESC, mes DESC`,
      { cooperativaId, n },
    ),
    consulta<FilaDeuda>(
      `SELECT servicio_conexion_id, letra, punto_venta, numero, saldo, to_char(vence_el, 'YYYY-MM-DD') AS vence_el
       FROM comprobantes
       WHERE cooperativa_id = $cooperativaId AND tipo = 'factura' AND estado = 'emitido' AND saldo > 0 AND vence_el < $fecha
       ORDER BY vence_el, id`,
      { cooperativaId, fecha: o.fechaEmision },
    ),
    // Lo que se pagó fuera de término: el interés corre hasta el día del pago y se cobra en la factura siguiente.
    consulta<FilaPagoTardio>(
      `SELECT c.servicio_conexion_id, c.letra, c.punto_venta, c.numero, a.importe AS saldo, to_char(c.vence_el, 'YYYY-MM-DD') AS vence_el,
              to_char(p.cobrado_el AT TIME ZONE '${TIMEZONE}', 'YYYY-MM-DD') AS pagado_el
       FROM pago_aplicaciones a
       JOIN pagos p ON p.id = a.pago_id AND p.estado = 'acreditado'
       JOIN comprobantes c ON c.id = a.comprobante_id AND c.tipo = 'factura'
       WHERE a.cooperativa_id = $cooperativaId
         AND CAST(p.cobrado_el AT TIME ZONE '${TIMEZONE}' AS date) > c.vence_el
         AND CAST(p.cobrado_el AT TIME ZONE '${TIMEZONE}' AS date) <= CAST($fecha AS date)
       ORDER BY c.vence_el, c.id, p.cobrado_el`,
      { cooperativaId, fecha: o.fechaEmision },
    ),
    // Si la emisión se interrumpió, lo que ya salió con número no se vuelve a calcular.
    consulta<{ servicio_conexion_id: number }>(
      `SELECT servicio_conexion_id FROM comprobantes
       WHERE cooperativa_id = $cooperativaId AND anio = $anio AND mes = $mes AND tipo = 'factura' AND estado IN ('emitido', 'pagado')`,
      base,
    ),
  ]);

  const parametros: ParametrosFacturacion = parametrosDe(coop!.configJson);
  const puntoVenta = coop!.configJson.puntoVenta;
  const planPorId = new Map(planes.map((p) => [p.id, p]));
  const periodoDe = new Map(periodos.map((p) => [p.servicio as string, p.id]));
  const adherentesDe = new Map(adherentes.map((a) => [a.socio_id, Number(a.n)]));
  const anteriorDe = new Map(anteriores.map((a) => [a.servicio_conexion_id, a]));
  const facturados = new Set(yaFacturados.map((f) => f.servicio_conexion_id));
  const medidoresDe = new Map<number, FilaMedidor[]>();
  for (const m of medidores) medidoresDe.set(m.servicio_conexion_id, [...(medidoresDe.get(m.servicio_conexion_id) ?? []), m]);
  const deudasDe = new Map<number, FilaDeuda[]>();
  for (const d of deudas) deudasDe.set(d.servicio_conexion_id, [...(deudasDe.get(d.servicio_conexion_id) ?? []), d]);
  const tardiosDe = new Map<number, FilaPagoTardio[]>();
  for (const p of pagosTardios) tardiosDe.set(p.servicio_conexion_id, [...(tardiosDe.get(p.servicio_conexion_id) ?? []), p]);

  // El sepelio va como adicional en la factura de energía de su conexión; si la conexión no tiene
  // energía, sale en una factura propia.
  const sepelioDe = new Map<number, FilaServicio>();
  const conEnergia = new Set<number>();
  for (const s of servicios) {
    if (s.servicio === 'sepelio') sepelioDe.set(s.conexion_id, s);
    if (s.servicio === 'energia') conEnergia.add(s.conexion_id);
  }

  const borradores: Borrador[] = [];
  for (const s of servicios) {
    if (facturados.has(s.id)) continue;
    if (s.servicio === 'sepelio' && conEnergia.has(s.conexion_id)) continue;
    if (s.fecha_baja !== null && s.fecha_baja < rango.desde) continue;

    const titular: SnapshotComprobante['titular'] = { numero: s.socio_numero, nombre: s.nombre, tipoDoc: s.tipo_doc, nroDoc: s.nro_doc, condicionIva: s.condicion_iva };
    const conexion: SnapshotComprobante['conexion'] = { numero: s.conexion_numero, direccion: s.direccion, zona: s.zona };
    const plan = s.plan_id === null ? undefined : planPorId.get(s.plan_id);
    const comun = {
      letra: letraDe(s.condicion_iva),
      socio_id: s.socio_id,
      conexion_id: s.conexion_id,
      servicio_conexion_id: s.id,
      servicio: s.servicio,
      periodo_id: periodoDe.get(s.servicio) ?? null,
      orden: borradores.length + 1,
    };

    let tramos: TramoLectura[] | undefined;
    let sinLectura = false;
    if (esMedido(s.servicio)) {
      const lista = medidoresDe.get(s.id) ?? [];
      // Sin medidor colocado no hay qué medir: ese servicio no se factura.
      if (lista.length === 0) continue;
      tramos = [];
      for (const m of lista) {
        const tramo = tramoDe(m);
        if (tramo) tramos.push(tramo);
        else {
          sinLectura = true;
          tramos.push({ medidor: m.numero, anterior: m.anterior ?? '0', actual: m.anterior ?? '0', factor: m.factor });
        }
      }
      if (sinLectura && o.historial) continue;
    }

    const sepelio = s.servicio === 'energia' ? sepelioDe.get(s.conexion_id) : undefined;
    const previa = anteriorDe.get(s.id);
    const entrada: EntradaFactura = {
      servicio: s.servicio,
      periodo: { anio: o.anio, mes: o.mes, ...rango },
      condicionIva: s.condicion_iva,
      suministro: { categoria: s.categoria, tieneSubsidio: s.tiene_subsidio, fechaAlta: s.fecha_alta, fechaBaja: s.fecha_baja },
      lecturas: tramos,
      consumoAFavor: previa && Number(previa.a_favor) > 0 ? previa.a_favor : undefined,
      cuadros,
      plan: plan ? { nombre: plan.nombre, precio: plan.precio } : undefined,
      sepelio:
        s.servicio === 'sepelio'
          ? { adherentes: adherentesDe.get(s.socio_id) ?? 0 }
          : sepelio
            ? { adherentes: adherentesDe.get(s.socio_id) ?? 0, fechaAlta: sepelio.fecha_alta, fechaBaja: sepelio.fecha_baja }
            : undefined,
      conceptos,
      deudaVencida: [
        ...(deudasDe.get(s.id) ?? []).map(
          (d): DeudaVencida => ({
            referencia: formatComprobante(d.letra, d.punto_venta, d.numero),
            saldo: d.saldo,
            venceEl: d.vence_el,
            // La factura anterior ya cobró los intereses hasta su fecha.
            interesDesde: previa?.emitido_el,
          }),
        ),
        // Pagos fuera de término posteriores a la factura anterior (los de antes ya los cobró ella).
        ...(tardiosDe.get(s.id) ?? [])
          .filter((p) => !previa || p.pagado_el > previa.emitido_el)
          .map(
            (p): DeudaVencida => ({
              referencia: formatComprobante(p.letra, p.punto_venta, p.numero),
              saldo: p.saldo,
              venceEl: p.vence_el,
              interesDesde: previa?.emitido_el,
              interesHasta: p.pagado_el,
            }),
          ),
      ],
      fechaEmision: o.fechaEmision,
      parametros,
    };

    const snapshotBase = { titular, conexion, categoria: s.categoria, tieneSubsidio: s.tiene_subsidio, plan: plan?.nombre ?? null, periodo: rango };
    try {
      const f = calcularFactura(entrada);
      const totalServicio = new Decimal(f.totales.servicio);
      // Solo se compara contra el mes inmediatamente anterior, y solo si los dos meses son completos:
      // después de un alta a mitad de mes, la primera factura entera siempre «sube» muchísimo.
      const comparable =
        previa && previa.completo && f.diasActivos === f.dias && mesNumero(previa.anio, previa.mes) === n - 1 && Number(previa.total_servicio) > 0
          ? new Decimal(previa.total_servicio)
          : null;
      const variacion = comparable ? totalServicio.minus(comparable).div(comparable).mul(100).toDecimalPlaces(1) : null;
      const rara: MotivoRara | null = sinLectura
        ? 'sin_lectura'
        : new Decimal(f.totales.total).isZero()
          ? 'importe_cero'
          : variacion && variacion.abs().gt(VARIACION_RARA)
            ? 'variacion'
            : null;
      borradores.push({
        ...comun,
        total: f.totales.total,
        total_servicio: f.totales.servicio,
        consumo: f.consumo?.facturado ?? null,
        a_favor: f.consumo?.aFavorPendiente ?? '0',
        estimada: f.estimada,
        rara,
        total_anterior: comparable ? comparable.toFixed(2) : null,
        variacion: variacion ? variacion.toFixed(1) : null,
        error: null,
        snapshot: {
          ...snapshotBase,
          dias: f.dias,
          diasActivos: f.diasActivos,
          consumo: f.consumo,
          avisos: f.avisos,
          totales: f.totales,
          tarifas: {
            cuadros: f.snapshot.cuadros.map((c) => (c as CuadroDetalle).id),
            conceptos: f.snapshot.conceptos.map((c) => (c as ConceptoDetalle).codigo),
            moraTasaDiaria: parametros.moraTasaDiaria,
          },
        },
        renglones: f.renglones,
      });
    } catch (err) {
      if (!(err instanceof ErrorDeCalculo)) throw err;
      // Fuera del período de servicio no hay nada que cobrar: no es un error.
      if (err.codigo === 'sin_servicio') continue;
      const cero = '0.00';
      borradores.push({
        ...comun,
        total: cero,
        total_servicio: cero,
        consumo: null,
        a_favor: '0',
        estimada: false,
        rara: null,
        total_anterior: null,
        variacion: null,
        error: err.message.slice(0, 300),
        snapshot: {
          ...snapshotBase,
          dias: 0,
          diasActivos: 0,
          consumo: null,
          avisos: [],
          totales: { basico: cero, subtotal: cero, gravamenes: cero, servicio: cero, adicionales: cero, recargos: cero, total: cero },
          tarifas: { cuadros: [], conceptos: [], moraTasaDiaria: parametros.moraTasaDiaria },
        },
        renglones: [],
      });
    }
  }

  // Se reemplazan los borradores del mes (los renglones se van con ellos).
  await ejecutar(`DELETE FROM comprobantes WHERE cooperativa_id = $cooperativaId AND anio = $anio AND mes = $mes AND estado = 'borrador'`, base);
  await o.alAvanzar?.(0, borradores.length);

  for (let i = 0; i < borradores.length; i += LOTE) {
    const lote = borradores.slice(i, i + LOTE);
    await sequelize.transaction(async (transaction) => {
      // Los ids se reservan antes para poder guardar los renglones en la misma pasada.
      const ids = await consulta<{ id: string }>(`SELECT nextval(pg_get_serial_sequence('comprobantes', 'id')) AS id FROM generate_series(1, CAST($n AS int))`, { n: lote.length }, transaction);
      const filas = lote.map(({ renglones: _renglones, ...b }, j) => ({ ...b, id: Number(ids[j]!.id) }));
      await ejecutar(
        `INSERT INTO comprobantes (id, cooperativa_id, tipo, letra, punto_venta, socio_id, conexion_id, servicio_conexion_id, servicio, anio, mes,
                                   periodo_id, orden, estado, total, saldo, total_servicio, consumo, a_favor, estimada, rara, total_anterior,
                                   variacion, error, snapshot_json, creado_por)
         SELECT x.id, CAST($cooperativaId AS int), 'factura', x.letra, CAST($puntoVenta AS int), x.socio_id, x.conexion_id, x.servicio_conexion_id, x.servicio,
                CAST($anio AS int), CAST($mes AS int), x.periodo_id, x.orden, 'borrador', x.total, 0, x.total_servicio, x.consumo, x.a_favor, x.estimada, x.rara,
                x.total_anterior, x.variacion, x.error, x.snapshot, CAST($usuarioId AS int)
         FROM jsonb_to_recordset(CAST($datos AS jsonb)) AS x(
           id int, letra text, socio_id int, conexion_id int, servicio_conexion_id int, servicio text, periodo_id int, orden int, total numeric,
           total_servicio numeric, consumo numeric, a_favor numeric, estimada boolean, rara text, total_anterior numeric, variacion numeric,
           error text, snapshot jsonb)`,
        { ...base, puntoVenta, usuarioId, datos: JSON.stringify(filas) },
        transaction,
      );
      const renglones = lote.flatMap((b, j) =>
        b.renglones.map((r, k) => ({
          comprobante_id: filas[j]!.id,
          orden: k + 1,
          grupo: r.grupo,
          codigo: r.codigo,
          servicio: r.servicio,
          descripcion: r.descripcion.slice(0, 200),
          cantidad: r.cantidad,
          unitario: r.unitario,
          porcentaje: r.porcentaje,
          base: r.base,
          importe: r.importe,
          subsidiado: r.subsidiado ?? false,
          nota: r.nota?.slice(0, 200) ?? null,
        })),
      );
      if (renglones.length) {
        await ejecutar(
          `INSERT INTO comprobante_renglones (cooperativa_id, comprobante_id, orden, grupo, codigo, servicio, descripcion, cantidad, unitario, porcentaje, base, importe, subsidiado, nota)
           SELECT CAST($cooperativaId AS int), x.comprobante_id, x.orden, x.grupo, x.codigo, x.servicio, x.descripcion, x.cantidad, x.unitario, x.porcentaje, x.base, x.importe, x.subsidiado, x.nota
           FROM jsonb_to_recordset(CAST($datos AS jsonb)) AS x(
             comprobante_id int, orden int, grupo text, codigo text, servicio text, descripcion text, cantidad numeric, unitario numeric,
             porcentaje numeric, base numeric, importe numeric, subsidiado boolean, nota text)`,
          { cooperativaId, datos: JSON.stringify(renglones) },
          transaction,
        );
      }
    });
    await o.alAvanzar?.(Math.min(i + LOTE, borradores.length), borradores.length);
  }

  return { cantidad: borradores.length, errores: borradores.filter((b) => b.error !== null).length };
}

/** Lo que marcó un medidor en el mes, en la forma que espera el motor. `null` = no hay lectura que sirva. */
function tramoDe(m: FilaMedidor): TramoLectura | null {
  if (m.lectura_id === null || m.valor === null) return null;
  const comun = { medidor: m.numero, factor: m.factor, tipo: m.tipo ?? 'real' };
  // Primera lectura de un medidor: es el punto de partida, todavía no hay consumo.
  if (m.anterior === null) return { ...comun, anterior: m.valor, actual: m.valor };
  // Medidor nuevo: arranca de cero.
  if (m.motivo === 'cambio_medidor') return { ...comun, anterior: '0', actual: m.valor };
  if (m.motivo === 'vuelta_contador') return { ...comun, anterior: m.anterior, actual: m.valor, vueltaDeContador: true, digitos: m.digitos };
  return { ...comun, anterior: m.anterior, actual: m.valor, anteriorEstimada: m.tipo_anterior === 'estimada' };
}

/* ───────────────────────── Numeración ───────────────────────── */

/**
 * Reserva `cantidad` números seguidos y devuelve el primero. Bloquea la fila del numerador hasta
 * que termine la transacción: dos emisiones a la vez nunca reciben el mismo número, y si la
 * transacción se cae los números no se pierden (SPEC 6.5: correlativa y sin huecos).
 */
export async function reservarNumeros(clave: { tipo: TipoComprobante | 'reclamo'; letra: string; puntoVenta: number }, cantidad: number, transaction: Transaction): Promise<number> {
  const bind = { cooperativaId: requireCooperativaId(), ...clave };
  await ejecutar(
    `INSERT INTO numeradores (cooperativa_id, tipo, letra, punto_venta, ultimo)
     VALUES (CAST($cooperativaId AS int), $tipo, $letra, CAST($puntoVenta AS int), 0)
     ON CONFLICT (cooperativa_id, tipo, letra, punto_venta) DO NOTHING`,
    bind,
    transaction,
  );
  const [fila] = await consulta<{ id: number; ultimo: number }>(
    `SELECT id, ultimo FROM numeradores WHERE cooperativa_id = $cooperativaId AND tipo = $tipo AND letra = $letra AND punto_venta = $puntoVenta FOR UPDATE`,
    bind,
    transaction,
  );
  await ejecutar(`UPDATE numeradores SET ultimo = ultimo + CAST($cantidad AS int), actualizado_el = now() WHERE id = $id`, { id: fila!.id, cantidad }, transaction);
  return fila!.ultimo + 1;
}

/* ───────────────────────── Emisión ───────────────────────── */

export interface OpcionesEmision {
  anio: number;
  mes: number;
  fechaEmision: string;
  diasVencimiento: number;
  alAvanzar?: (hechas: number, total: number) => Promise<void>;
}

/**
 * Emite las pre-facturas del mes: les pone número, fecha, vencimiento y CAE, y deja la deuda cargada.
 * Va por lotes, cada uno en su transacción: si se corta, lo emitido queda emitido y al reintentar
 * sigue desde donde quedó, sin saltear ni repetir números.
 *
 * Si ARCA rechaza una factura, las anteriores del lote quedan emitidas (ya están autorizadas), esa
 * vuelve a pre-factura con el motivo para corregirla, y la numeración se ajusta para seguir sin huecos.
 */
export async function emitirBorradores(o: OpcionesEmision): Promise<{ emitidas: number; rechazadas: number }> {
  const cooperativaId = requireCooperativaId();
  const base = { cooperativaId, anio: o.anio, mes: o.mes };
  const venceEl = sumarDias(o.fechaEmision, o.diasVencimiento);
  const [{ n }] = (await consulta<{ n: string }>(
    `SELECT count(*) AS n FROM comprobantes WHERE cooperativa_id = $cooperativaId AND anio = $anio AND mes = $mes AND tipo = 'factura' AND estado = 'borrador' AND error IS NULL`,
    base,
  )) as [{ n: string }];
  const total = Number(n);
  const proveedor = await proveedorFiscalActual();
  let emitidas = 0;
  let rechazadas = 0;
  await o.alAvanzar?.(0, total);

  for (;;) {
    const hechas = await sequelize.transaction(async (transaction) => {
      const lote = await consulta<{ id: number; letra: string; punto_venta: number; total: string }>(
        `SELECT id, letra, punto_venta, total FROM comprobantes
         WHERE cooperativa_id = $cooperativaId AND anio = $anio AND mes = $mes AND tipo = 'factura' AND estado = 'borrador' AND error IS NULL
         ORDER BY orden, id LIMIT ${LOTE} FOR UPDATE`,
        base,
        transaction,
      );
      if (lote.length === 0) return null;

      const numerados: ComprobanteAAutorizar[] = [];
      const talonarios: { letra: string; puntoVenta: number; primero: number; ids: number[] }[] = [];
      const claves = [...new Set(lote.map((c) => `${c.letra}|${c.punto_venta}`))].sort();
      for (const clave of claves) {
        const [letra, pv] = clave.split('|') as [string, string];
        const grupo = lote.filter((c) => c.letra === letra && c.punto_venta === Number(pv));
        const primero = await reservarNumeros({ tipo: 'factura', letra, puntoVenta: Number(pv) }, grupo.length, transaction);
        talonarios.push({ letra, puntoVenta: Number(pv), primero, ids: grupo.map((c) => c.id) });
        grupo.forEach((c, i) =>
          numerados.push({ id: c.id, tipo: 'factura', letra, puntoVenta: Number(pv), numero: primero + i, total: c.total, fecha: o.fechaEmision, venceEl }),
        );
      }
      const { autorizados, rechazo } = await proveedor.autorizar(numerados, transaction);
      const emitidos = numerados.filter((c) => autorizados.has(c.id));

      if (emitidos.length < numerados.length) {
        // Lo autorizado es el principio de cada talonario: el numerador vuelve al último que se usó.
        for (const t of talonarios) {
          const usados = t.ids.filter((id) => autorizados.has(id)).length;
          if (t.ids.slice(0, usados).some((id) => !autorizados.has(id))) throw new Error('ARCA autorizó facturas salteadas: no se puede seguir sin huecos.');
          await ejecutar(
            `UPDATE numeradores SET ultimo = CAST($ultimo AS int), actualizado_el = now()
             WHERE cooperativa_id = $cooperativaId AND tipo = 'factura' AND letra = $letra AND punto_venta = $puntoVenta`,
            { cooperativaId, letra: t.letra, puntoVenta: t.puntoVenta, ultimo: t.primero - 1 + usados },
            transaction,
          );
        }
      }
      if (emitidos.length) {
        await ejecutar(
          `UPDATE comprobantes c
           SET numero = x.numero, emitido_el = CAST($fecha AS date), vence_el = CAST($vence AS date), saldo = GREATEST(c.total, 0),
               estado = CASE WHEN c.total > 0 THEN 'emitido' ELSE 'pagado' END, cae = x.cae, cae_vence = CAST(x.cae_vence AS date),
               cae_ambiente = x.ambiente, actualizado_el = now()
           FROM jsonb_to_recordset(CAST($datos AS jsonb)) AS x(id int, numero int, cae text, cae_vence text, ambiente text)
           WHERE c.id = x.id AND c.cooperativa_id = $cooperativaId`,
          {
            cooperativaId,
            fecha: o.fechaEmision,
            vence: venceEl,
            datos: JSON.stringify(
              emitidos.map((c) => {
                const a = autorizados.get(c.id)!;
                return { id: c.id, numero: c.numero, cae: a.cae, cae_vence: a.caeVence, ambiente: a.ambiente };
              }),
            ),
          },
          transaction,
        );
        await sellarComprobantes(
          emitidos.map((c) => c.id),
          transaction,
        );
      }
      if (rechazo) {
        await ejecutar(`UPDATE comprobantes SET error = $motivo, actualizado_el = now() WHERE id = $id AND cooperativa_id = $cooperativaId`, {
          cooperativaId,
          id: rechazo.id,
          motivo: rechazo.motivo.slice(0, 300),
        }, transaction);
      }
      return { emitidas: emitidos.length, rechazadas: rechazo ? 1 : 0 };
    });
    if (hechas === null) break;
    // Un lote sin ninguna emitida ni rechazada no avanza: se corta para no quedar dando vueltas.
    if (hechas.emitidas === 0 && hechas.rechazadas === 0) break;
    emitidas += hechas.emitidas;
    rechazadas += hechas.rechazadas;
    await o.alAvanzar?.(Math.min(emitidas + rechazadas, total), total);
  }
  return { emitidas, rechazadas };
}

/** Deja un aviso por cada factura recién emitida a los socios que tienen email cargado. */
export async function avisarFacturas(anio: number, mes: number): Promise<number> {
  const filas = await consulta<{ id: number; socio_id: number; email: string; nombre: string; servicio: ServicioConexion; total: string; vence_el: string }>(
    `SELECT c.id, c.socio_id, s.email, s.nombre, c.servicio, c.total, to_char(c.vence_el, 'YYYY-MM-DD') AS vence_el
     FROM comprobantes c
     JOIN socios s ON s.id = c.socio_id AND s.email IS NOT NULL AND s.email <> ''
     WHERE c.cooperativa_id = $cooperativaId AND c.anio = $anio AND c.mes = $mes AND c.tipo = 'factura' AND c.estado = 'emitido'
       AND NOT EXISTS (SELECT 1 FROM notificaciones n WHERE n.comprobante_id = c.id)
     ORDER BY c.orden, c.id`,
    { cooperativaId: requireCooperativaId(), anio, mes },
  );
  const avisos: AvisoAlSocio[] = filas.map((f) => ({
    socioId: f.socio_id,
    comprobanteId: f.id,
    canal: 'email',
    destino: f.email,
    asunto: `Tu factura de ${SERVICIO_ETIQUETA[f.servicio].toLowerCase()} de ${nombreDeMes(anio, mes)}`,
    cuerpo: `Hola. Ya está tu factura de ${SERVICIO_ETIQUETA[f.servicio].toLowerCase()} de ${nombreDeMes(anio, mes)}: ${formatMoney(f.total)}. Vence el ${formatDate(f.vence_el)}. Podés verla y pagarla desde la app.`,
  }));
  return proveedorNotificaciones.enviar(avisos);
}

/** Último día ya facturado: una tarifa nueva no puede regir desde antes (cambiaría facturas emitidas). */
export async function ultimoDiaFacturado(): Promise<{ anio: number; mes: number; hasta: string } | null> {
  const [fila] = await consulta<{ n: number | null }>(
    `SELECT max(anio * 12 + mes) AS n FROM comprobantes WHERE cooperativa_id = $cooperativaId AND tipo = 'factura' AND estado <> 'borrador'`,
    { cooperativaId: requireCooperativaId() },
  );
  if (!fila || fila.n === null) return null;
  const anio = Math.floor((Number(fila.n) - 1) / 12);
  const mes = Number(fila.n) - anio * 12;
  return { anio, mes, hasta: mesCompleto(anio, mes).hasta };
}

/* ───────────────────────── Trabajos en segundo plano ───────────────────────── */

const corriendo = new Set<Promise<void>>();

/**
 * Arranca un trabajo largo (pre-facturar, emitir) y vuelve enseguida: el pedido contesta y la
 * pantalla sigue el avance consultando `procesos_facturacion`. Uno solo a la vez por cooperativa.
 */
export async function lanzarProceso(
  tipo: TipoProceso,
  mes: { anio: number; mes: number },
  trabajo: (avanzar: (hechas: number, total: number) => Promise<void>) => Promise<void>,
): Promise<ProcesoFacturacionModel> {
  const ctx = currentContext()!;
  let proceso: ProcesoFacturacionModel;
  try {
    proceso = await ProcesoFacturacionModel.create({ tipo, anio: mes.anio, mes: mes.mes, usuarioId: ctx.userId });
  } catch (err) {
    if ((err as { name?: string }).name === 'SequelizeUniqueConstraintError') throw conflict('Ya hay un trabajo de facturación en marcha. Esperá a que termine.');
    throw err;
  }
  const cerrar = (datos: { estado: 'terminado' | 'fallido'; error?: string }) =>
    ProcesoFacturacionModel.update({ ...datos, terminadoEl: new Date() }, { where: { id: proceso.id } });

  // Corre con el mismo usuario y la misma cooperativa del pedido que lo lanzó.
  const tarea = requestContext.run({ ...ctx }, async () => {
    try {
      await trabajo(async (hechas, total) => {
        await ProcesoFacturacionModel.update({ hechas, total }, { where: { id: proceso.id } });
      });
      await cerrar({ estado: 'terminado' });
    } catch (err) {
      const esperado = err instanceof HttpError || err instanceof ErrorDeCalculo || err instanceof ErrorArca;
      if (!esperado) console.error(`[FACTURACION] ${tipo} ${mes.mes}/${mes.anio}`, err);
      await cerrar({ estado: 'fallido', error: esperado ? err.message.slice(0, 300) : 'Se interrumpió por un problema nuestro. Probá de nuevo.' }).catch(() => undefined);
    }
  });
  corriendo.add(tarea);
  void tarea.finally(() => corriendo.delete(tarea));
  return proceso;
}

/** Espera a que terminen los trabajos lanzados en este proceso (para los tests y el cierre ordenado). */
export async function esperarProcesos(): Promise<void> {
  await Promise.all([...corriendo]);
}

/** Al arrancar la API: un trabajo que quedó "en curso" murió con el proceso anterior. */
export async function cerrarProcesosHuerfanos(): Promise<void> {
  await sequelize.query(
    `UPDATE procesos_facturacion SET estado = 'fallido', error = 'El servidor se reinició en medio del trabajo. Volvé a intentarlo: sigue desde donde quedó.', terminado_el = now()
     WHERE estado = 'en_curso'`,
  );
}
