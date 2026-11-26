// Tablero de gerencia (SPEC 6.9): indicadores y series, cada uno con una consulta que se puede
// repetir a mano contra la base. Qué cuenta cada número está escrito en shared/tablero.ts.
// Todo va con SQL crudo —son agregados sobre decenas de miles de filas—, así que cada consulta
// lleva su filtro por cooperativa escrito a mano.
import Decimal from 'decimal.js';
import { QueryTypes } from 'sequelize';
import {
  ORIGEN_ENERGIA_DEFECTO,
  SERVICIOS_CONEXION,
  SERVICIOS_MEDIDOS,
  TIMEZONE,
  tipoReclamo,
  TRAMOS_ANTIGUEDAD,
  UNIDAD_SERVICIO,
  type BandaConsumo,
  type ConsumoZona,
  type EscalonesServicio,
  type EstadoMesTablero,
  type FiltrosTablero,
  type IndicadoresTablero,
  type LecturasTablero,
  type MedioPago,
  type MesBalance,
  type MesFacturado,
  type MesTablero,
  type OrigenEnergia,
  type RecaudacionTablero,
  type ReclamosTablero,
  type ServicioConexion,
  type ServicioMedido,
  type ServicioReclamo,
  type Tablero,
  type TableroQuery,
  type TipoZona,
  type TramoAntiguedad,
  type TramoDeuda,
} from '../shared';
import { sequelize } from '../db';
import { BalanceEnergia, Cooperativa, Periodo, Zona } from '../models';
import { mesCompleto } from '../motor';
import { badRequest } from './errors';
import { DESDE_PUNTOS, DONDE_PUNTOS } from './lecturas';
import { hoy } from './tarifas';
import { requireCooperativaId } from './tenant';

/** Facturas que cuentan: emitidas o pagas. Las anuladas (con su nota de crédito) quedan afuera. */
export const FACTURAS_VALIDAS = `c.tipo = 'factura' AND c.estado IN ('emitido', 'pagado')`;
const MESES_SERIE = 12;

export interface FiltroDatos {
  servicio: ServicioConexion | null;
  zonaId: number | null;
}

/** Condición extra sobre `c` (comprobantes) y `cx` (su conexión), según los filtros elegidos. */
export const filtroFacturas = (f: FiltroDatos) => `${f.servicio ? ' AND c.servicio = :servicio' : ''}${f.zonaId ? ' AND cx.zona_id = :zonaId' : ''}`;

/** Un día de calendario argentino como instante: sirve para buscar por fecha usando el índice. */
const instante = (param: string) => `(CAST(:${param} AS timestamp) AT TIME ZONE '${TIMEZONE}')`;
/** Condición «ocurrió entre `:desde` y `:hasta`» (días argentinos, los dos incluidos) sobre una columna con hora. */
export const entreDias = (columna: string) => `${columna} >= ${instante('desde')} AND ${columna} < ${instante('hasta')} + interval '1 day'`;

const dinero = (v: string | number | null | undefined) => new Decimal(v ?? 0).toFixed(2);
const cantidad = (v: string | number | null | undefined) => new Decimal(v ?? 0).toDecimalPlaces(2).toFixed();
const mesNumero = (anio: number, mes: number) => anio * 12 + mes;
const deNumero = (n: number) => ({ anio: Math.floor((n - 1) / 12), mes: ((n - 1) % 12) + 1 });

function consulta<T extends object>(sql: string, replacements: Record<string, unknown>): Promise<T[]> {
  return sequelize.query<T>(sql, { replacements, type: QueryTypes.SELECT });
}

/* ───────────────────────── Meses, zonas y servicios que se pueden elegir ───────────────────────── */

export async function mesesDisponibles(): Promise<MesTablero[]> {
  const cooperativaId = requireCooperativaId();
  const [periodos, facturados] = await Promise.all([
    consulta<{ anio: number; mes: number; abierto: boolean }>(
      `SELECT anio, mes, bool_or(estado IN ('abierto', 'en_lectura')) AS abierto FROM periodos WHERE cooperativa_id = :cooperativaId GROUP BY anio, mes`,
      { cooperativaId },
    ),
    consulta<{ anio: number; mes: number }>(`SELECT DISTINCT c.anio, c.mes FROM comprobantes c WHERE c.cooperativa_id = :cooperativaId AND ${FACTURAS_VALIDAS}`, { cooperativaId }),
  ]);
  const meses = new Map<number, EstadoMesTablero>();
  for (const p of periodos) meses.set(mesNumero(p.anio, p.mes), p.abierto ? 'en_lectura' : 'sin_emitir');
  for (const f of facturados) meses.set(mesNumero(f.anio, f.mes), 'emitido');
  return [...meses]
    .sort(([a], [b]) => b - a)
    .slice(0, 36)
    .map(([n, estado]) => ({ ...deNumero(n), estado }));
}

export interface Seleccion {
  hoy: string;
  periodo: MesTablero;
  periodos: MesTablero[];
  zonas: { id: number; nombre: string; tipo: TipoZona }[];
  servicios: ServicioConexion[];
  filtros: FiltrosTablero;
  datos: FiltroDatos;
  energia: OrigenEnergia;
}

/**
 * Resuelve lo que se eligió: sin mes, va el último facturado (el tablero arranca mostrando números,
 * no un mes en lectura con todo en cero). Una zona de otra cooperativa no existe.
 */
export async function resolverSeleccion(q: TableroQuery): Promise<Seleccion> {
  const cooperativaId = requireCooperativaId();
  const fecha = hoy();
  const [periodos, zonas, coop] = await Promise.all([mesesDisponibles(), Zona.findAll({ order: [['nombre', 'ASC']] }), Cooperativa.findByPk(cooperativaId)]);
  const zona = q.zona === undefined ? null : zonas.find((z) => z.id === q.zona);
  if (zona === undefined) throw badRequest('Revisá los datos marcados', { zona: 'Esa zona no existe' });

  const elegido = q.anio !== undefined && q.mes !== undefined ? { anio: q.anio, mes: q.mes } : null;
  const actual = { anio: Number(fecha.slice(0, 4)), mes: Number(fecha.slice(5, 7)) };
  const periodo: MesTablero = elegido
    ? (periodos.find((p) => p.anio === elegido.anio && p.mes === elegido.mes) ?? { ...elegido, estado: 'sin_emitir' })
    : (periodos.find((p) => p.estado === 'emitido') ?? periodos[0] ?? { ...actual, estado: 'sin_emitir' });

  const presta = coop?.configJson.servicios ?? [];
  return {
    hoy: fecha,
    periodo,
    periodos: periodos.some((p) => p.anio === periodo.anio && p.mes === periodo.mes) ? periodos : [periodo, ...periodos],
    zonas: zonas.map((z) => ({ id: z.id, nombre: z.nombre, tipo: z.tipo })),
    servicios: SERVICIOS_CONEXION.filter((s) => presta.includes(s)),
    filtros: { servicio: q.servicio ?? null, zona: zona ? { id: zona.id, nombre: zona.nombre } : null },
    datos: { servicio: q.servicio ?? null, zonaId: zona?.id ?? null },
    energia: coop?.configJson.energia ?? ORIGEN_ENERGIA_DEFECTO,
  };
}

/* ───────────────────────── Facturado y cobrado, mes por mes ───────────────────────── */

/** Los 12 meses que terminan en el elegido: lo facturado, lo ya cobrado de esas facturas y el consumo. */
export async function facturadoPorMes(periodo: { anio: number; mes: number }, f: FiltroDatos): Promise<(MesFacturado & { facturas: number })[]> {
  const hasta = mesNumero(periodo.anio, periodo.mes);
  const params = { cooperativaId: requireCooperativaId(), desde: hasta - MESES_SERIE + 1, hasta, servicio: f.servicio, zonaId: f.zonaId };
  const [facturado, cobrado] = await Promise.all([
    consulta<{ anio: number; mes: number; facturado: string; facturas: string; energia: string; agua: string }>(
      `SELECT c.anio, c.mes, sum(c.total) AS facturado, count(*) AS facturas,
              COALESCE(sum(c.consumo) FILTER (WHERE c.servicio = 'energia'), 0) AS energia,
              COALESCE(sum(c.consumo) FILTER (WHERE c.servicio = 'agua'), 0) AS agua
       FROM comprobantes c LEFT JOIN conexiones cx ON cx.id = c.conexion_id
       WHERE c.cooperativa_id = :cooperativaId AND ${FACTURAS_VALIDAS} AND (c.anio * 12 + c.mes) BETWEEN :desde AND :hasta${filtroFacturas(f)}
       GROUP BY c.anio, c.mes`,
      params,
    ),
    // Lo cobrado sale de los pagos, no del saldo: son dos caminos distintos que tienen que dar lo mismo.
    consulta<{ anio: number; mes: number; cobrado: string }>(
      `SELECT c.anio, c.mes, sum(a.importe) AS cobrado
       FROM pago_aplicaciones a
       JOIN pagos p ON p.id = a.pago_id AND p.estado = 'acreditado'
       JOIN comprobantes c ON c.id = a.comprobante_id
       LEFT JOIN conexiones cx ON cx.id = c.conexion_id
       WHERE a.cooperativa_id = :cooperativaId AND ${FACTURAS_VALIDAS} AND (c.anio * 12 + c.mes) BETWEEN :desde AND :hasta${filtroFacturas(f)}
       GROUP BY c.anio, c.mes`,
      params,
    ),
  ]);
  const deFacturado = new Map(facturado.map((x) => [mesNumero(x.anio, x.mes), x]));
  const deCobrado = new Map(cobrado.map((x) => [mesNumero(x.anio, x.mes), x.cobrado]));
  return Array.from({ length: MESES_SERIE }, (_, i) => {
    const n = hasta - MESES_SERIE + 1 + i;
    const fila = deFacturado.get(n);
    return {
      ...deNumero(n),
      facturado: dinero(fila?.facturado),
      facturas: Number(fila?.facturas ?? 0),
      cobrado: dinero(deCobrado.get(n)),
      energia: cantidad(fila?.energia),
      agua: cantidad(fila?.agua),
    };
  });
}

export function cobrabilidadDe(facturado: string, cobrado: string): number | null {
  const base = new Decimal(facturado);
  return base.gt(0) ? new Decimal(cobrado).div(base).mul(100).toDecimalPlaces(1).toNumber() : null;
}

/* ───────────────────────── Deuda ───────────────────────── */

const TRAMO_SQL = `CASE WHEN c.vence_el >= CAST(:hoy AS date) THEN 'sin_vencer'
                        WHEN CAST(:hoy AS date) - c.vence_el <= 30 THEN 'd30'
                        WHEN CAST(:hoy AS date) - c.vence_el <= 60 THEN 'd60'
                        WHEN CAST(:hoy AS date) - c.vence_el <= 90 THEN 'd90'
                        ELSE 'mas90' END`;
const DEUDA = `c.tipo = 'factura' AND c.estado = 'emitido' AND c.saldo > 0`;

export async function deudaHoy(fecha: string, f: FiltroDatos) {
  const params = { cooperativaId: requireCooperativaId(), hoy: fecha, servicio: f.servicio, zonaId: f.zonaId };
  const desde = `FROM comprobantes c LEFT JOIN conexiones cx ON cx.id = c.conexion_id WHERE c.cooperativa_id = :cooperativaId AND ${DEUDA}${filtroFacturas(f)}`;
  const [[total], tramos] = await Promise.all([
    consulta<{ deuda: string | null; vencida: string | null; con_deuda: string; morosos: string }>(
      `SELECT sum(c.saldo) AS deuda, sum(c.saldo) FILTER (WHERE c.vence_el < CAST(:hoy AS date)) AS vencida,
              count(DISTINCT c.socio_id) AS con_deuda, count(DISTINCT c.socio_id) FILTER (WHERE c.vence_el < CAST(:hoy AS date)) AS morosos
       ${desde}`,
      params,
    ),
    consulta<{ tramo: TramoAntiguedad; facturas: string; socios: string; importe: string }>(
      `SELECT ${TRAMO_SQL} AS tramo, count(*) AS facturas, count(DISTINCT c.socio_id) AS socios, sum(c.saldo) AS importe ${desde} GROUP BY 1`,
      params,
    ),
  ]);
  const porTramo = new Map(tramos.map((t) => [t.tramo, t]));
  const antiguedad: TramoDeuda[] = TRAMOS_ANTIGUEDAD.map((tramo) => {
    const t = porTramo.get(tramo);
    return { tramo, facturas: Number(t?.facturas ?? 0), socios: Number(t?.socios ?? 0), importe: dinero(t?.importe) };
  });
  return {
    deuda: dinero(total?.deuda),
    deudaVencida: dinero(total?.vencida),
    sociosConDeuda: Number(total?.con_deuda ?? 0),
    morosos: Number(total?.morosos ?? 0),
    antiguedad,
  };
}

/* ───────────────────────── Consumo ───────────────────────── */

export async function consumoPorZona(periodo: { anio: number; mes: number }, f: FiltroDatos): Promise<ConsumoZona[]> {
  const filas = await consulta<{ id: number | null; nombre: string | null; tipo: TipoZona | null; energia: string; n_energia: string; agua: string; n_agua: string }>(
    `SELECT z.id, z.nombre, z.tipo,
            COALESCE(sum(c.consumo) FILTER (WHERE c.servicio = 'energia'), 0) AS energia, count(*) FILTER (WHERE c.servicio = 'energia') AS n_energia,
            COALESCE(sum(c.consumo) FILTER (WHERE c.servicio = 'agua'), 0) AS agua, count(*) FILTER (WHERE c.servicio = 'agua') AS n_agua
     FROM comprobantes c LEFT JOIN conexiones cx ON cx.id = c.conexion_id LEFT JOIN zonas z ON z.id = cx.zona_id
     WHERE c.cooperativa_id = :cooperativaId AND ${FACTURAS_VALIDAS} AND c.anio = :anio AND c.mes = :mes AND c.servicio IN ('energia', 'agua')${filtroFacturas(f)}
     GROUP BY z.id, z.nombre, z.tipo
     ORDER BY z.nombre NULLS LAST`,
    { cooperativaId: requireCooperativaId(), ...periodo, servicio: f.servicio, zonaId: f.zonaId },
  );
  return filas.map((z) => ({
    zona: z.id === null ? null : { id: z.id, nombre: z.nombre!, tipo: z.tipo! },
    energia: cantidad(z.energia),
    conexionesEnergia: Number(z.n_energia),
    agua: cantidad(z.agua),
    conexionesAgua: Number(z.n_agua),
  }));
}

/**
 * Cuántas conexiones cayeron en cada escalón de consumo. Los cortes son los de la tarifa residencial
 * que regía ese mes (con y sin subsidio); si la cooperativa no tiene, los de todas las categorías.
 */
export async function distribucionPorEscalon(periodo: { anio: number; mes: number }, f: FiltroDatos): Promise<EscalonesServicio[]> {
  const cooperativaId = requireCooperativaId();
  const { hasta } = mesCompleto(periodo.anio, periodo.mes);
  const servicios = SERVICIOS_MEDIDOS.filter((s) => f.servicio === null || f.servicio === s);
  if (servicios.length === 0) return [];
  const cortes = await consulta<{ servicio: ServicioMedido; categoria: string | null; hasta: string }>(
    `SELECT DISTINCT ct.servicio, ct.categoria, e.hasta
     FROM cuadros_tarifarios ct JOIN escalones e ON e.cuadro_id = ct.id
     WHERE ct.cooperativa_id = :cooperativaId AND ct.servicio IN (:servicios) AND e.hasta IS NOT NULL
       AND ct.vigente_desde <= :hasta AND (ct.vigente_hasta IS NULL OR ct.vigente_hasta >= :hasta)`,
    { cooperativaId, servicios, hasta },
  );
  const out: EscalonesServicio[] = [];
  for (const servicio of servicios) {
    const propios = cortes.filter((c) => c.servicio === servicio);
    const residenciales = propios.filter((c) => c.categoria === 'residencial');
    const topes = [...new Set((residenciales.length ? residenciales : propios).map((c) => Number(c.hasta)))].sort((a, b) => a - b).slice(0, 8);
    // Banda = cuántos cortes quedaron por debajo del consumo: «hasta 120» incluye el kWh 120.
    const banda = topes.length ? `(SELECT count(*) FROM unnest(CAST(ARRAY[:topes] AS numeric[])) AS t(tope) WHERE c.consumo > t.tope)` : '0';
    const filas = await consulta<{ banda: string; conexiones: string; consumo: string }>(
      `SELECT ${banda} AS banda, count(*) AS conexiones, COALESCE(sum(c.consumo), 0) AS consumo
       FROM comprobantes c LEFT JOIN conexiones cx ON cx.id = c.conexion_id
       WHERE c.cooperativa_id = :cooperativaId AND ${FACTURAS_VALIDAS} AND c.anio = :anio AND c.mes = :mes AND c.servicio = :medido AND c.consumo IS NOT NULL${f.zonaId ? ' AND cx.zona_id = :zonaId' : ''}
       GROUP BY 1`,
      { cooperativaId, ...periodo, medido: servicio, topes, zonaId: f.zonaId },
    );
    const porBanda = new Map(filas.map((x) => [Number(x.banda), x]));
    const bandas: BandaConsumo[] = Array.from({ length: topes.length + 1 }, (_, i) => ({
      desde: i === 0 ? 0 : topes[i - 1]!,
      hasta: topes[i] ?? null,
      conexiones: Number(porBanda.get(i)?.conexiones ?? 0),
      consumo: cantidad(porBanda.get(i)?.consumo),
    }));
    out.push({ servicio, unidad: UNIDAD_SERVICIO[servicio], bandas });
  }
  return out;
}

/* ───────────────────────── Recaudación ───────────────────────── */

/** Lo que entró en el mes calendario, por fecha de cobro. Con filtro, solo lo aplicado a esas facturas. */
export async function recaudacionDelMes(periodo: { anio: number; mes: number }, f: FiltroDatos): Promise<RecaudacionTablero> {
  const soloFacturas = f.servicio !== null || f.zonaId !== null;
  const params = { cooperativaId: requireCooperativaId(), ...mesCompleto(periodo.anio, periodo.mes), servicio: f.servicio, zonaId: f.zonaId };
  const filas = await consulta<{ medio: MedioPago; cajero_id: number | null; nombre: string | null; cobros: string; total: string }>(
    soloFacturas
      ? `SELECT p.medio, p.cajero_id, u.nombre, count(DISTINCT p.id) AS cobros, sum(a.importe) AS total
         FROM pagos p
         JOIN pago_aplicaciones a ON a.pago_id = p.id
         JOIN comprobantes c ON c.id = a.comprobante_id
         LEFT JOIN conexiones cx ON cx.id = c.conexion_id
         LEFT JOIN usuarios u ON u.id = p.cajero_id
         WHERE p.cooperativa_id = :cooperativaId AND p.estado = 'acreditado' AND ${entreDias('p.cobrado_el')}${filtroFacturas(f)}
         GROUP BY p.medio, p.cajero_id, u.nombre`
      : `SELECT p.medio, p.cajero_id, u.nombre, count(*) AS cobros, sum(p.importe) AS total
         FROM pagos p LEFT JOIN usuarios u ON u.id = p.cajero_id
         WHERE p.cooperativa_id = :cooperativaId AND p.estado = 'acreditado' AND ${entreDias('p.cobrado_el')}
         GROUP BY p.medio, p.cajero_id, u.nombre`,
    params,
  );
  const sumar = <K>(clave: (x: (typeof filas)[number]) => K) => {
    const grupos = new Map<K, { cobros: number; total: Decimal }>();
    for (const x of filas) {
      const g = grupos.get(clave(x)) ?? { cobros: 0, total: new Decimal(0) };
      g.cobros += Number(x.cobros);
      g.total = g.total.plus(x.total);
      grupos.set(clave(x), g);
    }
    return [...grupos].sort(([, a], [, b]) => b.total.cmp(a.total));
  };
  const nombres = new Map(filas.map((x) => [x.cajero_id, x.nombre]));
  return {
    total: filas.reduce((t, x) => t.plus(x.total), new Decimal(0)).toFixed(2),
    // Cada cobro tiene un solo medio y un solo cajero: sumar los grupos no cuenta ninguno dos veces.
    cobros: sumar((x) => x.cajero_id).reduce((t, [, g]) => t + g.cobros, 0),
    porMedio: sumar((x) => x.medio).map(([medio, g]) => ({ medio, cobros: g.cobros, total: g.total.toFixed(2) })),
    porCajero: sumar((x) => x.cajero_id).map(([cajeroId, g]) => ({
      cajeroId,
      nombre: cajeroId === null ? 'Pago online' : (nombres.get(cajeroId) ?? 'Sin nombre'),
      cobros: g.cobros,
      total: g.total.toFixed(2),
    })),
    soloFacturas,
  };
}

/* ───────────────────────── Lecturas en vivo ───────────────────────── */

export async function avanceDeLecturas(f: FiltroDatos): Promise<LecturasTablero> {
  const medido = f.servicio !== null && (SERVICIOS_MEDIDOS as readonly string[]).includes(f.servicio);
  const [periodo, rutas] = await Promise.all([
    Periodo.findOne({ where: { estado: 'en_lectura' }, order: [['anio', 'DESC'], ['mes', 'DESC']] }),
    // Un filtro por internet, TV o sepelio no tiene medidores: no hay nada que mostrar.
    f.servicio !== null && !medido
      ? Promise.resolve([])
      : consulta<{ id: number | null; nombre: string | null; zona: string | null; medidores: string; leidos: string; estimados: string; ultima_el: Date | null }>(
          `SELECT r.id, r.nombre, z.nombre AS zona, count(*) AS medidores, count(l.id) AS leidos,
                  count(*) FILTER (WHERE l.tipo = 'estimada') AS estimados, max(l.tomada_el) AS ultima_el
           ${DESDE_PUNTOS}
           LEFT JOIN rutas r ON r.id = c.ruta_id
           LEFT JOIN zonas z ON z.id = r.zona_id
           WHERE ${DONDE_PUNTOS}${f.servicio ? ' AND sc.servicio = :servicio' : ''}${f.zonaId ? ' AND c.zona_id = :zonaId' : ''}
           GROUP BY r.id, r.nombre, z.nombre
           ORDER BY r.id NULLS LAST`,
          { cooperativaId: requireCooperativaId(), servicio: f.servicio, zonaId: f.zonaId },
        ),
  ]);
  return {
    periodo: periodo ? { anio: periodo.anio, mes: periodo.mes } : null,
    total: rutas.reduce((t, r) => t + Number(r.medidores), 0),
    leidos: rutas.reduce((t, r) => t + Number(r.leidos), 0),
    estimados: rutas.reduce((t, r) => t + Number(r.estimados), 0),
    rutas: rutas.map((r) => ({
      id: r.id ?? 0,
      nombre: r.nombre ?? 'Sin ruta',
      zona: r.zona ?? '',
      medidores: Number(r.medidores),
      leidos: Number(r.leidos),
      ultimaEl: r.ultima_el ? r.ultima_el.toISOString() : null,
    })),
  };
}

/* ───────────────────────── Balance de energía ───────────────────────── */

/** Energía que entró a la red (comprada + generada) contra la facturada. La diferencia son las pérdidas. */
export async function balanceDeEnergia(periodo: { anio: number; mes: number }): Promise<MesBalance[]> {
  const cooperativaId = requireCooperativaId();
  const hasta = mesNumero(periodo.anio, periodo.mes);
  const desde = hasta - MESES_SERIE + 1;
  const [cargas, facturada] = await Promise.all([
    BalanceEnergia.findAll(),
    consulta<{ anio: number; mes: number; kwh: string }>(
      `SELECT c.anio, c.mes, COALESCE(sum(c.consumo), 0) AS kwh
       FROM comprobantes c
       WHERE c.cooperativa_id = :cooperativaId AND ${FACTURAS_VALIDAS} AND c.servicio = 'energia' AND (c.anio * 12 + c.mes) BETWEEN :desde AND :hasta
       GROUP BY c.anio, c.mes`,
      { cooperativaId, desde, hasta },
    ),
  ]);
  const deCarga = new Map(cargas.map((b) => [mesNumero(b.anio, b.mes), b]));
  const deFacturada = new Map(facturada.map((x) => [mesNumero(x.anio, x.mes), x.kwh]));
  return Array.from({ length: MESES_SERIE }, (_, i) => {
    const n = desde + i;
    const carga = deCarga.get(n);
    const kwh = new Decimal(deFacturada.get(n) ?? 0);
    const entrada = carga ? new Decimal(carga.compradaKwh).plus(carga.generadaKwh) : null;
    // Sin nada facturado todavía (el mes está en lectura) no hay pérdidas que calcular: no son «el 100 %».
    const perdidas = entrada && kwh.gt(0) ? entrada.minus(kwh) : null;
    return {
      ...deNumero(n),
      comprada: carga ? cantidad(carga.compradaKwh) : null,
      generada: carga ? cantidad(carga.generadaKwh) : null,
      facturada: cantidad(kwh.toFixed(4)),
      perdidas: perdidas ? cantidad(perdidas.toFixed(4)) : null,
      porcentaje: perdidas && entrada!.gt(0) ? perdidas.div(entrada!).mul(100).toDecimalPlaces(1).toNumber() : null,
      nota: carga?.nota ?? null,
    };
  });
}

/* ───────────────────────── Reclamos ───────────────────────── */

const filtroReclamos = (f: FiltroDatos) => `${f.servicio ? ' AND r.servicio = :servicio' : ''}${f.zonaId ? ' AND cx.zona_id = :zonaId' : ''}`;

export async function reclamosAbiertos(f: FiltroDatos): Promise<{ abiertos: number; urgentes: number }> {
  const [fila] = await consulta<{ abiertos: string; urgentes: string }>(
    `SELECT count(*) AS abiertos, count(*) FILTER (WHERE r.prioridad = 'urgente') AS urgentes
     FROM reclamos r LEFT JOIN conexiones cx ON cx.id = r.conexion_id
     WHERE r.cooperativa_id = :cooperativaId AND r.estado <> 'resuelto'${filtroReclamos(f)}`,
    { cooperativaId: requireCooperativaId(), servicio: f.servicio, zonaId: f.zonaId },
  );
  return { abiertos: Number(fila?.abiertos ?? 0), urgentes: Number(fila?.urgentes ?? 0) };
}

/** Reclamos que entraron en el mes calendario, por tipo, con cuánto se tardó en resolverlos. */
export async function reclamosDelMes(periodo: { anio: number; mes: number }, f: FiltroDatos): Promise<ReclamosTablero> {
  const filas = await consulta<{ servicio: ServicioReclamo; tipo: string; cantidad: string; abiertos: string; resueltos: string; horas: string | null }>(
    `SELECT r.servicio, r.tipo, count(*) AS cantidad, count(*) FILTER (WHERE r.estado <> 'resuelto') AS abiertos,
            count(*) FILTER (WHERE r.estado = 'resuelto' AND r.resuelto_el IS NOT NULL) AS resueltos,
            sum(EXTRACT(EPOCH FROM (r.resuelto_el - r.creado_el)) / 3600) FILTER (WHERE r.estado = 'resuelto' AND r.resuelto_el IS NOT NULL) AS horas
     FROM reclamos r LEFT JOIN conexiones cx ON cx.id = r.conexion_id
     WHERE r.cooperativa_id = :cooperativaId AND ${entreDias('r.creado_el')}${filtroReclamos(f)}
     GROUP BY r.servicio, r.tipo
     ORDER BY count(*) DESC, r.servicio, r.tipo`,
    { cooperativaId: requireCooperativaId(), ...mesCompleto(periodo.anio, periodo.mes), servicio: f.servicio, zonaId: f.zonaId },
  );
  const media = (horas: number, n: number) => (n > 0 ? Math.round((horas / n) * 10) / 10 : null);
  const resueltos = filas.reduce((t, x) => t + Number(x.resueltos), 0);
  return {
    total: filas.reduce((t, x) => t + Number(x.cantidad), 0),
    resueltos,
    horasResolucion: media(filas.reduce((t, x) => t + Number(x.horas ?? 0), 0), resueltos),
    porTipo: filas.map((x) => ({
      servicio: x.servicio,
      tipo: x.tipo,
      nombre: tipoReclamo(x.servicio, x.tipo)?.nombre ?? x.tipo,
      cantidad: Number(x.cantidad),
      abiertos: Number(x.abiertos),
      horasResolucion: media(Number(x.horas ?? 0), Number(x.resueltos)),
    })),
  };
}

/* ───────────────────────── Todo junto ───────────────────────── */

export async function armarTablero(q: TableroQuery, puedeCargarBalance: boolean): Promise<Tablero> {
  const s = await resolverSeleccion(q);
  const f = s.datos;
  const [porMes, deuda, porZona, escalones, recaudacion, lecturas, balance, abiertos, reclamos] = await Promise.all([
    facturadoPorMes(s.periodo, f),
    deudaHoy(s.hoy, f),
    consumoPorZona(s.periodo, f),
    distribucionPorEscalon(s.periodo, f),
    recaudacionDelMes(s.periodo, f),
    avanceDeLecturas(f),
    balanceDeEnergia(s.periodo),
    reclamosAbiertos(f),
    reclamosDelMes(s.periodo, f),
  ]);
  const mes = porMes.at(-1)!;
  const mide = (servicio: ServicioMedido) => f.servicio === null || f.servicio === servicio;
  const indicadores: IndicadoresTablero = {
    facturado: mes.facturado,
    facturas: mes.facturas,
    cobrado: mes.cobrado,
    cobrabilidad: cobrabilidadDe(mes.facturado, mes.cobrado),
    deuda: deuda.deuda,
    deudaVencida: deuda.deudaVencida,
    sociosConDeuda: deuda.sociosConDeuda,
    morosos: deuda.morosos,
    consumo: { energia: mide('energia') ? mes.energia : null, agua: mide('agua') ? mes.agua : null },
    reclamosAbiertos: abiertos.abiertos,
    reclamosUrgentes: abiertos.urgentes,
  };
  return {
    hoy: s.hoy,
    generadoEl: new Date().toISOString(),
    periodo: s.periodo,
    periodos: s.periodos,
    zonas: s.zonas,
    servicios: s.servicios,
    filtros: s.filtros,
    indicadores,
    porMes: porMes.map(({ facturas: _facturas, ...m }) => m),
    antiguedad: deuda.antiguedad,
    consumoPorZona: porZona,
    escalones,
    recaudacion,
    lecturas,
    balance,
    reclamos,
    energia: s.energia,
    puedeCargarBalance,
  };
}
