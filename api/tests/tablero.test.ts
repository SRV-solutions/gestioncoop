// Fase 7: tablero de gerencia e informes. El criterio del SPEC es que cada indicador coincida con
// una consulta directa a la base: acá cada número del tablero se vuelve a calcular por otro camino
// (el facturado, sumando renglones; el cobrado, por el saldo; la recaudación, por fecha con otra
// fórmula) y tiene que dar igual. También: filtros, que el tablero refleje un cobro recién hecho,
// los siete informes, la exportación a Excel, CSV y PDF, permisos y aislamiento entre cooperativas.
import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { QueryTypes } from 'sequelize';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  aCentavos,
  deCentavos,
  INFORMES,
  TRAMOS_ANTIGUEDAD,
  type CatalogoInformes,
  type ClaveInforme,
  type InformeDatos,
  type ResumenLecturas,
  type Tablero,
} from '../src/shared';
import { sequelize } from '../src/db';
import { hoy } from '../src/lib/tarifas';
import { Auditoria } from '../src/models';
import { runUnscoped } from '../src/lib/context';
import { callesInventadas } from '../src/seed/calles-inventadas';
import { cargarBalance } from '../src/seed/cargar-balance';
import { cargarPagos, cargarProductos } from '../src/seed/cargar-caja';
import { cargarFacturas } from '../src/seed/cargar-facturas';
import { cargarLecturas } from '../src/seed/cargar-lecturas';
import { cargarPadron } from '../src/seed/cargar-padron';
import { cargarReclamos } from '../src/seed/cargar-reclamos';
import { cargarTarifas } from '../src/seed/cargar-tarifas';
import { generarPadron, PLANES } from '../src/seed/generar-padron';
import { TARIFAS_ARROYO_DEL_MONTE } from '../src/seed/tarifas';
import { createUser, loginAs, request, app, resetWorld } from './helpers';

const HOY = hoy();
const TZ = 'America/Argentina/Buenos_Aires';
const PLANES_PRUEBA = [
  { servicio: 'internet' as const, nombre: PLANES.internet50, precio: '20000.00' },
  { servicio: 'internet' as const, nombre: PLANES.internet100, precio: '30000.00' },
  { servicio: 'tv' as const, nombre: PLANES.tv, precio: '15000.00' },
];

let w: Awaited<ReturnType<typeof resetWorld>>;
type Agente = Awaited<ReturnType<typeof loginAs>>;
let gerencia: Agente;
let admin: Agente;
let caja: Agente;
let facturacion: Agente;
let adminB: Agente;
/** Último mes facturado (el que el tablero muestra si no se elige otro) y el mes en curso. */
let P: { anio: number; mes: number };
const M = { anio: Number(HOY.slice(0, 4)), mes: Number(HOY.slice(5, 7)) };

const sql = <T extends object>(texto: string, replacements: Record<string, unknown> = {}) =>
  sequelize.query<T>(texto, { replacements: { a: w.a.id, b: w.b.id, hoy: HOY, ...replacements }, type: QueryTypes.SELECT });
/** Un solo valor, como texto (los importes, con dos decimales). */
const valor = async (texto: string, replacements: Record<string, unknown> = {}) => (await sql<{ v: string }>(texto, replacements))[0]!.v;
const qs = (params: Record<string, unknown>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};
const tablero = async (params: Record<string, unknown> = {}, agente: Agente = gerencia): Promise<Tablero> => {
  const res = await agente.get(`/api/v1/tablero${qs(params)}`);
  if (res.status !== 200) throw new Error(`tablero ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data;
};
const informe = async (clave: ClaveInforme, params: Record<string, unknown> = {}, agente: Agente = gerencia): Promise<InformeDatos> => {
  const res = await agente.get(`/api/v1/informes/${clave}${qs(params)}`);
  if (res.status !== 200) throw new Error(`informe ${clave} ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data;
};
const columna = (i: InformeDatos, clave: string) => {
  const n = i.columnas.findIndex((c) => c.clave === clave);
  if (n < 0) throw new Error(`El informe ${i.clave} no tiene la columna ${clave}`);
  return n;
};
/** exceljs declara su propio `Buffer`, distinto del de Node: es el mismo objeto. */
const aExcel = (cuerpo: unknown) => cuerpo as Parameters<ExcelJS.Workbook['xlsx']['load']>[0];
const suma = (...importes: string[]) => deCentavos(importes.reduce((t, i) => t + aCentavos(i), 0));
const FACTURAS = `c.cooperativa_id = :coop AND c.tipo = 'factura' AND c.estado IN ('emitido', 'pagado')`;
const DEUDA = `c.cooperativa_id = :coop AND c.tipo = 'factura' AND c.estado = 'emitido' AND c.saldo > 0`;

beforeAll(async () => {
  w = await resetWorld();
  await createUser({ cooperativaId: w.a.id, email: 'facturacion@a.test', roles: ['facturacion'] });
  for (const [coop, semilla] of [[w.a, 7], [w.b, 8]] as const) {
    await cargarPadron(generarPadron(callesInventadas(), { hogares: 40, semilla }), { cooperativaId: coop.id, planes: PLANES_PRUEBA });
    await cargarTarifas(coop.id, TARIFAS_ARROYO_DEL_MONTE);
    await cargarLecturas(coop.id, { hoy: HOY, semilla, avance: [0.5, 0] });
    await cargarFacturas(coop.id, { semilla });
    await cargarPagos(coop.id, { semilla });
    await cargarReclamos(coop.id, { semilla, hoy: HOY, cantidad: 16 });
    await cargarBalance(coop.id, { semilla, generacionPropia: coop.id === w.a.id });
  }
  await cargarProductos(w.a.id, [{ nombre: 'Garrafa de 10 kg', precio: '18500.00', stock: 5 }]);
  gerencia = await loginAs('demo@a.test');
  admin = await loginAs('admin@a.test');
  caja = await loginAs('caja@a.test');
  facturacion = await loginAs('facturacion@a.test');
  adminB = await loginAs('admin@b.test');
  const n = Number(await valor(`SELECT max(c.anio * 12 + c.mes) AS v FROM comprobantes c WHERE ${FACTURAS}`, { coop: w.a.id }));
  P = { anio: Math.floor((n - 1) / 12), mes: ((n - 1) % 12) + 1 };
}, 180_000);
afterAll(() => sequelize.close());

describe('permisos', () => {
  it('el tablero es de gerencia y administración; los informes, también de facturación', async () => {
    expect((await request(app).get('/api/v1/tablero')).status).toBe(401);
    expect((await gerencia.get('/api/v1/tablero')).status).toBe(200);
    expect((await admin.get('/api/v1/tablero')).status).toBe(200);
    for (const agente of [caja, facturacion]) expect((await agente.get('/api/v1/tablero')).status).toBe(403);
    expect((await facturacion.get('/api/v1/informes/deuda')).status).toBe(200);
    expect((await caja.get('/api/v1/informes/deuda')).status).toBe(403);
    expect((await caja.get('/api/v1/informes')).status).toBe(403);
    const socio = await loginAs('socio@b.test');
    expect((await socio.get('/api/v1/tablero')).status).toBe(403);
    expect((await socio.get('/api/v1/informes/padron')).status).toBe(403);
  });

  it('solo administración carga la energía comprada', async () => {
    const datos = { anio: M.anio, mes: M.mes, compradaKwh: '1000', generadaKwh: '0' };
    expect((await gerencia.put('/api/v1/tablero/balance').send(datos)).status).toBe(403);
    expect((await facturacion.put('/api/v1/tablero/balance').send(datos)).status).toBe(403);
    expect((await tablero()).puedeCargarBalance).toBe(false);
    expect((await tablero({}, admin)).puedeCargarBalance).toBe(true);
  });
});

describe('qué mes muestra', () => {
  it('sin elegir, el último mes facturado (no el que está en lectura)', async () => {
    const t = await tablero();
    expect(t.hoy).toBe(HOY);
    expect(t.periodo).toEqual({ ...P, estado: 'emitido' });
    // El mes en curso está en lectura: se puede elegir, y va primero en la lista.
    expect(t.periodos[0]).toEqual({ ...M, estado: 'en_lectura' });
    expect(t.periodos).toHaveLength(13);
    expect(t.zonas.length).toBeGreaterThan(0);
    expect(t.servicios).toEqual(['energia', 'agua']);
  });

  it('un mes sin facturas da todo en cero, sin romperse', async () => {
    const t = await tablero(M);
    expect(t.periodo.estado).toBe('en_lectura');
    expect(t.indicadores.facturado).toBe('0.00');
    expect(t.indicadores.cobrado).toBe('0.00');
    expect(t.indicadores.cobrabilidad).toBeNull();
    expect(t.indicadores.consumo).toEqual({ energia: '0', agua: '0' });
    // La deuda y los reclamos son «a hoy»: no dependen del mes elegido.
    expect(t.indicadores.deuda).toBe((await tablero()).indicadores.deuda);
  });

  it('rechaza filtros mal formados o de otra cooperativa', async () => {
    const [zonaB] = await sql<{ id: number }>(`SELECT id FROM zonas WHERE cooperativa_id = :b LIMIT 1`);
    expect((await gerencia.get(`/api/v1/tablero?zona=${zonaB!.id}`)).status).toBe(400);
    expect((await gerencia.get('/api/v1/tablero?servicio=gas')).status).toBe(400);
    expect((await gerencia.get('/api/v1/tablero?anio=2026')).status).toBe(400);
    expect((await gerencia.get('/api/v1/tablero?anio=2026&mes=13')).status).toBe(400);
    expect((await gerencia.get(`/api/v1/informes/deuda?zona=${zonaB!.id}`)).status).toBe(400);
  });
});

describe('los indicadores coinciden con la base', () => {
  it('facturado: es la suma de los renglones de las facturas del mes', async () => {
    const t = await tablero();
    const porRenglones = await valor(
      `SELECT CAST(sum(r.importe) AS numeric(16,2)) AS v FROM comprobante_renglones r JOIN comprobantes c ON c.id = r.comprobante_id
       WHERE ${FACTURAS} AND c.anio = :anio AND c.mes = :mes`,
      { coop: w.a.id, ...P },
    );
    expect(t.indicadores.facturado).toBe(porRenglones);
    expect(Number(t.indicadores.facturado)).toBeGreaterThan(0);
    expect(t.indicadores.facturas).toBe(Number(await valor(`SELECT count(*) AS v FROM comprobantes c WHERE ${FACTURAS} AND c.anio = :anio AND c.mes = :mes`, { coop: w.a.id, ...P })));
  });

  it('cobrado: es lo que bajó el saldo de esas facturas; cobrabilidad = cobrado / facturado', async () => {
    const t = await tablero();
    const porSaldo = await valor(`SELECT CAST(sum(GREATEST(c.total, 0) - c.saldo) AS numeric(16,2)) AS v FROM comprobantes c WHERE ${FACTURAS} AND c.anio = :anio AND c.mes = :mes`, { coop: w.a.id, ...P });
    expect(t.indicadores.cobrado).toBe(porSaldo);
    expect(t.indicadores.cobrabilidad).toBe(Math.round((Number(porSaldo) / Number(t.indicadores.facturado)) * 1000) / 10);
    expect(t.indicadores.cobrabilidad!).toBeGreaterThan(50);
    expect(t.indicadores.cobrabilidad!).toBeLessThan(100);
  });

  it('deuda, deuda vencida y socios en mora', async () => {
    const t = await tablero();
    const [d] = await sql<{ deuda: string; vencida: string; con_deuda: string; morosos: string }>(
      `SELECT CAST(COALESCE(sum(c.saldo), 0) AS numeric(16,2)) AS deuda,
              CAST(COALESCE(sum(CASE WHEN c.vence_el < CAST(:hoy AS date) THEN c.saldo END), 0) AS numeric(16,2)) AS vencida,
              count(DISTINCT c.socio_id) AS con_deuda,
              (SELECT count(*) FROM socios s WHERE EXISTS (SELECT 1 FROM comprobantes c WHERE c.socio_id = s.id AND ${DEUDA} AND c.vence_el < CAST(:hoy AS date))) AS morosos
       FROM comprobantes c WHERE ${DEUDA}`,
      { coop: w.a.id },
    );
    expect(t.indicadores.deuda).toBe(d!.deuda);
    expect(t.indicadores.deudaVencida).toBe(d!.vencida);
    expect(t.indicadores.sociosConDeuda).toBe(Number(d!.con_deuda));
    expect(t.indicadores.morosos).toBe(Number(d!.morosos));
    expect(t.indicadores.morosos).toBeGreaterThan(0);
  });

  it('consumo: los kWh y m³ que cada factura guardó como facturados', async () => {
    const t = await tablero();
    for (const servicio of ['energia', 'agua'] as const) {
      const facturado = Number(await valor(`SELECT COALESCE(sum(CAST(c.snapshot_json->'consumo'->>'facturado' AS numeric)), 0) AS v FROM comprobantes c WHERE ${FACTURAS} AND c.anio = :anio AND c.mes = :mes AND c.servicio = :servicio`, { coop: w.a.id, ...P, servicio }));
      expect(Number(t.indicadores.consumo[servicio])).toBe(facturado);
      expect(facturado).toBeGreaterThan(0);
    }
  });

  it('reclamos abiertos', async () => {
    const t = await tablero();
    const [r] = await sql<{ abiertos: string; urgentes: string }>(
      `SELECT count(*) AS abiertos, count(CASE WHEN prioridad = 'urgente' THEN 1 END) AS urgentes FROM reclamos WHERE cooperativa_id = :a AND estado IN ('nuevo', 'asignado', 'en_curso')`,
    );
    expect(t.indicadores.reclamosAbiertos).toBe(Number(r!.abiertos));
    expect(t.indicadores.reclamosUrgentes).toBe(Number(r!.urgentes));
    expect(t.indicadores.reclamosAbiertos).toBeGreaterThan(0);
  });
});

describe('gráficos', () => {
  it('facturado y cobrado de los 12 meses, del más viejo al elegido', async () => {
    const t = await tablero();
    expect(t.porMes).toHaveLength(12);
    expect(t.porMes.at(-1)).toMatchObject({ ...P, facturado: t.indicadores.facturado, cobrado: t.indicadores.cobrado });
    const filas = await sql<{ anio: number; mes: number; facturado: string; cobrado: string }>(
      `SELECT c.anio, c.mes, CAST(sum(c.total) AS numeric(16,2)) AS facturado, CAST(sum(GREATEST(c.total, 0) - c.saldo) AS numeric(16,2)) AS cobrado
       FROM comprobantes c WHERE ${FACTURAS} GROUP BY c.anio, c.mes ORDER BY c.anio, c.mes`,
      { coop: w.a.id },
    );
    expect(filas).toHaveLength(12);
    expect(t.porMes.map(({ anio, mes, facturado, cobrado }) => ({ anio, mes, facturado, cobrado }))).toEqual(filas);
    // Con el mes en curso elegido, la serie se corre un mes y el último queda en cero.
    const corrido = await tablero(M);
    expect(corrido.porMes.at(-1)).toMatchObject({ ...M, facturado: '0.00', cobrado: '0.00' });
    expect(corrido.porMes.at(-2)).toMatchObject({ ...P, facturado: t.indicadores.facturado });
  });

  it('deuda por antigüedad: los tramos suman la deuda y cada uno coincide', async () => {
    const t = await tablero();
    expect(t.antiguedad.map((x) => x.tramo)).toEqual([...TRAMOS_ANTIGUEDAD]);
    expect(suma(...t.antiguedad.map((x) => x.importe))).toBe(t.indicadores.deuda);
    const limites: Record<string, string> = {
      sin_vencer: `c.vence_el >= CAST(:hoy AS date)`,
      d30: `c.vence_el < CAST(:hoy AS date) AND c.vence_el >= CAST(:hoy AS date) - 30`,
      d60: `c.vence_el < CAST(:hoy AS date) - 30 AND c.vence_el >= CAST(:hoy AS date) - 60`,
      d90: `c.vence_el < CAST(:hoy AS date) - 60 AND c.vence_el >= CAST(:hoy AS date) - 90`,
      mas90: `c.vence_el < CAST(:hoy AS date) - 90`,
    };
    for (const tramo of t.antiguedad) {
      const [d] = await sql<{ importe: string; facturas: string; socios: string }>(
        `SELECT CAST(COALESCE(sum(c.saldo), 0) AS numeric(16,2)) AS importe, count(*) AS facturas, count(DISTINCT c.socio_id) AS socios FROM comprobantes c WHERE ${DEUDA} AND ${limites[tramo.tramo]}`,
        { coop: w.a.id },
      );
      expect(tramo).toEqual({ tramo: tramo.tramo, importe: d!.importe, facturas: Number(d!.facturas), socios: Number(d!.socios) });
    }
    expect(t.antiguedad.filter((x) => x.facturas > 0).length).toBeGreaterThan(1);
  });

  it('consumo por zona y por escalón: suman el consumo del mes', async () => {
    const t = await tablero();
    expect(t.consumoPorZona.reduce((s, z) => s + Number(z.energia), 0)).toBe(Number(t.indicadores.consumo.energia));
    expect(t.consumoPorZona.reduce((s, z) => s + Number(z.agua), 0)).toBe(Number(t.indicadores.consumo.agua));
    expect(t.escalones.map((e) => e.servicio)).toEqual(['energia', 'agua']);
    for (const e of t.escalones) {
      expect(e.bandas.reduce((s, b) => s + Number(b.consumo), 0)).toBe(Number(t.indicadores.consumo[e.servicio]));
      expect(e.bandas.at(-1)!.hasta).toBeNull();
      // Cada banda, contada a mano: más que el corte de abajo y hasta el de arriba inclusive.
      for (const b of e.bandas) {
        const n = await valor(
          `SELECT count(*) AS v FROM comprobantes c WHERE ${FACTURAS} AND c.anio = :anio AND c.mes = :mes AND c.servicio = :servicio AND c.consumo IS NOT NULL
             AND (c.consumo > :desde OR (:desde = 0 AND c.consumo = 0)) AND (CAST(:hasta AS numeric) IS NULL OR c.consumo <= CAST(:hasta AS numeric))`,
          { coop: w.a.id, ...P, servicio: e.servicio, desde: b.desde, hasta: b.hasta },
        );
        expect(b.conexiones).toBe(Number(n));
      }
    }
  });

  it('recaudación: lo que entró en el mes calendario, por medio y por cajero', async () => {
    const t = await tablero();
    const directo = await valor(
      `SELECT CAST(COALESCE(sum(p.importe), 0) AS numeric(16,2)) AS v FROM pagos p
       WHERE p.cooperativa_id = :a AND p.estado = 'acreditado' AND to_char(p.cobrado_el AT TIME ZONE '${TZ}', 'YYYY-MM') = :ym`,
      { ym: `${P.anio}-${String(P.mes).padStart(2, '0')}` },
    );
    expect(t.recaudacion.total).toBe(directo);
    expect(Number(directo)).toBeGreaterThan(0);
    expect(t.recaudacion.soloFacturas).toBe(false);
    expect(suma(...t.recaudacion.porMedio.map((m) => m.total))).toBe(directo);
    expect(suma(...t.recaudacion.porCajero.map((c) => c.total))).toBe(directo);
    expect(t.recaudacion.porMedio.reduce((s, m) => s + m.cobros, 0)).toBe(t.recaudacion.cobros);
    expect(t.recaudacion.porCajero.some((c) => c.cajeroId === null && c.nombre === 'Pago online')).toBe(true);
  });

  it('lecturas en vivo: lo mismo que ve la oficina en Lecturas', async () => {
    const t = await tablero();
    const resumen: ResumenLecturas = (await admin.get('/api/v1/lecturas/resumen')).body.data;
    expect(t.lecturas.periodo).toEqual(M);
    expect(t.lecturas.total).toBe(resumen.total);
    expect(t.lecturas.leidos).toBe(resumen.leidos);
    expect(t.lecturas.total).toBeGreaterThan(t.lecturas.leidos);
    expect(t.lecturas.rutas.map((r) => [r.id, r.medidores, r.leidos])).toEqual(resumen.rutas.filter((r) => r.medidores > 0).map((r) => [r.id, r.medidores, r.leidos]));
  });

  it('balance de energía: pérdidas = comprada + generada − facturada', async () => {
    const t = await tablero();
    expect(t.balance).toHaveLength(12);
    expect(t.energia).toEqual({ mayorista: 'el distribuidor mayorista', generacion: null });
    for (const m of t.balance) {
      const [fila] = await sql<{ comprada: string; generada: string }>(`SELECT comprada_kwh AS comprada, generada_kwh AS generada FROM balance_energia WHERE cooperativa_id = :a AND anio = :anio AND mes = :mes`, { anio: m.anio, mes: m.mes });
      const facturada = Number(await valor(`SELECT COALESCE(sum(c.consumo), 0) AS v FROM comprobantes c WHERE ${FACTURAS} AND c.servicio = 'energia' AND c.anio = :anio AND c.mes = :mes`, { coop: w.a.id, ...m }));
      expect(Number(m.facturada)).toBe(facturada);
      expect(Number(m.comprada)).toBe(Number(fila!.comprada));
      expect(Number(m.generada)).toBe(Number(fila!.generada));
      const entrada = Number(fila!.comprada) + Number(fila!.generada);
      expect(Number(m.perdidas)).toBeCloseTo(entrada - facturada, 2);
      expect(m.porcentaje).toBeCloseTo(((entrada - facturada) / entrada) * 100, 1);
      expect(m.porcentaje!).toBeGreaterThan(8);
      expect(m.porcentaje!).toBeLessThan(16);
    }
    // El mes en curso todavía no tiene la energía cargada: figura sin dato, no en cero.
    const actual = (await tablero(M)).balance.at(-1)!;
    expect(actual).toMatchObject({ ...M, comprada: null, generada: null, perdidas: null, porcentaje: null });
  });

  it('administración carga y corrige la energía de un mes; queda en auditoría', async () => {
    const mal = await admin.put('/api/v1/tablero/balance').send({ ...M, compradaKwh: '-5', generadaKwh: '0' });
    expect(mal.status).toBe(400);
    expect(mal.body.error.fields.compradaKwh).toBeTruthy();
    expect((await admin.put('/api/v1/tablero/balance').send({ ...M, compradaKwh: '10000', generadaKwh: '2500.5' })).status).toBe(200);
    // El mes en curso no tiene nada facturado: se guarda lo cargado, pero todavía no hay pérdidas que calcular.
    let actual = (await tablero(M)).balance.at(-1)!;
    expect(actual).toMatchObject({ comprada: '10000', generada: '2500.5', facturada: '0', perdidas: null, porcentaje: null });
    expect((await admin.put('/api/v1/tablero/balance').send({ ...M, compradaKwh: 9000, generadaKwh: 0 })).status).toBe(200);
    actual = (await tablero(M)).balance.at(-1)!;
    expect(actual).toMatchObject({ comprada: '9000', generada: '0' });
    expect(Number(await valor(`SELECT count(*) AS v FROM balance_energia WHERE cooperativa_id = :a AND anio = :anio AND mes = :mes`, M))).toBe(1);
    const rastros = await runUnscoped(() => Auditoria.findAll({ where: { accion: 'cargar_balance_energia', cooperativaId: w.a.id }, order: [['id', 'ASC']] }));
    expect(rastros).toHaveLength(2);
    expect(rastros[1]!.antesJson).toMatchObject({ compradaKwh: '10000.00' });
  });

  it('reclamos del mes por tipo, con el tiempo medio de resolución', async () => {
    const t = await tablero(M);
    const filas = await sql<{ servicio: string; tipo: string; cantidad: string; abiertos: string; horas: string | null }>(
      `SELECT servicio, tipo, count(*) AS cantidad, count(CASE WHEN estado <> 'resuelto' THEN 1 END) AS abiertos,
              avg(CASE WHEN estado = 'resuelto' THEN EXTRACT(EPOCH FROM (resuelto_el - creado_el)) / 3600 END) AS horas
       FROM reclamos WHERE cooperativa_id = :a AND to_char(creado_el AT TIME ZONE '${TZ}', 'YYYY-MM') = :ym GROUP BY servicio, tipo`,
      { ym: HOY.slice(0, 7) },
    );
    expect(t.reclamos.total).toBe(filas.reduce((s, f) => s + Number(f.cantidad), 0));
    expect(t.reclamos.porTipo).toHaveLength(filas.length);
    for (const f of filas) {
      const fila = t.reclamos.porTipo.find((x) => x.servicio === f.servicio && x.tipo === f.tipo)!;
      expect(fila.cantidad).toBe(Number(f.cantidad));
      expect(fila.abiertos).toBe(Number(f.abiertos));
      if (f.horas === null) expect(fila.horasResolucion).toBeNull();
      else expect(fila.horasResolucion).toBeCloseTo(Number(f.horas), 1);
      expect(fila.nombre).not.toBe(f.tipo);
    }
  });
});

describe('filtros por servicio y por zona', () => {
  it('lo de cada servicio suma el total', async () => {
    const todo = await tablero();
    const partes = await Promise.all((['energia', 'agua', 'internet', 'tv', 'sepelio'] as const).map((servicio) => tablero({ servicio })));
    expect(suma(...partes.map((t) => t.indicadores.facturado))).toBe(todo.indicadores.facturado);
    expect(suma(...partes.map((t) => t.indicadores.cobrado))).toBe(todo.indicadores.cobrado);
    expect(suma(...partes.map((t) => t.indicadores.deuda))).toBe(todo.indicadores.deuda);
    expect(partes.reduce((s, t) => s + t.indicadores.facturas, 0)).toBe(todo.indicadores.facturas);

    const agua = partes[1]!;
    expect(agua.filtros.servicio).toBe('agua');
    expect(agua.indicadores.consumo).toEqual({ energia: null, agua: todo.indicadores.consumo.agua });
    expect(agua.escalones.map((e) => e.servicio)).toEqual(['agua']);
    expect(agua.indicadores.facturado).toBe(await valor(`SELECT CAST(sum(c.total) AS numeric(16,2)) AS v FROM comprobantes c WHERE ${FACTURAS} AND c.anio = :anio AND c.mes = :mes AND c.servicio = 'agua'`, { coop: w.a.id, ...P }));
    // La recaudación con filtro es solo lo aplicado a facturas de ese servicio.
    expect(agua.recaudacion.soloFacturas).toBe(true);
    expect(suma(...partes.map((t) => t.recaudacion.total))).toBe(todo.recaudacion.total);
    // Internet no tiene medidores: no hay lecturas que mostrar.
    expect(partes[2]!.lecturas.total).toBe(0);
    expect(agua.lecturas.total + partes[0]!.lecturas.total).toBe(todo.lecturas.total);
    // El balance de energía no depende de los filtros.
    expect(agua.balance).toEqual(todo.balance);
  });

  it('lo de cada zona suma el total', async () => {
    const todo = await tablero();
    const partes = await Promise.all(todo.zonas.map((z) => tablero({ zona: z.id })));
    expect(suma(...partes.map((t) => t.indicadores.facturado))).toBe(todo.indicadores.facturado);
    expect(suma(...partes.map((t) => t.indicadores.deuda))).toBe(todo.indicadores.deuda);
    expect(partes.reduce((s, t) => s + t.lecturas.total, 0)).toBe(todo.lecturas.total);
    expect(partes.reduce((s, t) => s + t.indicadores.reclamosAbiertos, 0)).toBeLessThanOrEqual(todo.indicadores.reclamosAbiertos);
    expect(partes[0]!.filtros.zona).toEqual({ id: todo.zonas[0]!.id, nombre: todo.zonas[0]!.nombre });
    expect(partes[0]!.consumoPorZona.map((z) => z.zona?.id)).toEqual([todo.zonas[0]!.id]);
  });
});

describe('el tablero refleja lo cobrado', () => {
  it('un cobro en la caja baja la deuda, sube lo cobrado de ese mes y entra en la recaudación de hoy; anularlo lo deshace', async () => {
    const [f] = await sql<{ id: number; socio_id: number; anio: number; mes: number; saldo: string }>(
      `SELECT c.id, c.socio_id, c.anio, c.mes, c.saldo FROM comprobantes c WHERE ${DEUDA} AND c.saldo = c.total ORDER BY c.anio DESC, c.mes DESC, c.id LIMIT 1`,
      { coop: w.a.id },
    );
    const mesFactura = { anio: f!.anio, mes: f!.mes };
    const [antes, antesHoy] = [await tablero(mesFactura), await tablero(M)];
    const porServicios = async () => suma(...(await Promise.all((['energia', 'agua', 'internet', 'tv', 'sepelio'] as const).map((servicio) => tablero({ ...M, servicio })))).map((t) => t.recaudacion.total));
    const antesPorServicios = await porServicios();
    const de = (t: Tablero) => ({
      efectivo: t.recaudacion.porMedio.find((m) => m.medio === 'efectivo')?.total ?? '0.00',
      cajero: t.recaudacion.porCajero.find((c) => c.cajeroId === w.cajeroA.id) ?? { cobros: 0, total: '0.00' },
    });

    expect((await caja.post('/api/v1/caja/abrir').send({ fondoInicial: '1000' })).status).toBe(201);
    const cobro = await caja.post('/api/v1/caja/cobros').send({ clave: randomUUID(), socioId: f!.socio_id, aplicaciones: [{ comprobanteId: f!.id, importe: f!.saldo }], items: [], medio: 'efectivo', recibido: f!.saldo });
    expect(cobro.status).toBe(201);

    const [despues, despuesHoy] = [await tablero(mesFactura), await tablero(M)];
    expect(despues.indicadores.cobrado).toBe(suma(antes.indicadores.cobrado, f!.saldo));
    expect(despues.indicadores.facturado).toBe(antes.indicadores.facturado);
    expect(despues.indicadores.cobrabilidad!).toBeGreaterThan(antes.indicadores.cobrabilidad!);
    expect(suma(despues.indicadores.deuda, f!.saldo)).toBe(antes.indicadores.deuda);
    expect(despuesHoy.recaudacion.total).toBe(suma(antesHoy.recaudacion.total, f!.saldo));
    expect(despuesHoy.recaudacion.cobros).toBe(antesHoy.recaudacion.cobros + 1);
    expect(de(despuesHoy).efectivo).toBe(suma(de(antesHoy).efectivo, f!.saldo));
    expect(de(despuesHoy).cajero).toMatchObject({ cobros: de(antesHoy).cajero.cobros + 1, total: suma(de(antesHoy).cajero.total, f!.saldo) });
    // Se pagó tarde: lo cobrado de ese mes ya no coincide con lo que entró en ese mes calendario.
    expect(despues.recaudacion.total).toBe(antes.recaudacion.total);

    // Una venta de mostrador entra en la recaudación, pero no es cobro de facturas.
    const [producto] = await sql<{ id: number }>(`SELECT id FROM productos WHERE cooperativa_id = :a LIMIT 1`);
    expect((await caja.post('/api/v1/caja/cobros').send({ clave: randomUUID(), socioId: null, aplicaciones: [], items: [{ productoId: producto!.id, cantidad: 2 }], medio: 'qr' })).status).toBe(201);
    const conVenta = await tablero(M);
    expect(conVenta.recaudacion.total).toBe(suma(despuesHoy.recaudacion.total, '37000.00'));
    // Con filtro de servicio la venta no cuenta: solo lo aplicado a facturas.
    expect(await porServicios()).toBe(suma(antesPorServicios, f!.saldo));
    expect((await tablero(mesFactura)).indicadores.cobrado).toBe(despues.indicadores.cobrado);

    const anulado = await admin.post(`/api/v1/caja/cobros/${cobro.body.data.id}/anular`).send({ motivo: 'Prueba del tablero: se deshace el cobro' });
    expect(anulado.status).toBe(200);
    const deshecho = await tablero(mesFactura);
    expect(deshecho.indicadores.cobrado).toBe(antes.indicadores.cobrado);
    expect(deshecho.indicadores.deuda).toBe(antes.indicadores.deuda);
    expect((await tablero(M)).recaudacion.total).toBe(suma(antesHoy.recaudacion.total, '37000.00'));
  });

  it('resolver un reclamo lo saca de los abiertos', async () => {
    const antes = (await tablero()).indicadores.reclamosAbiertos;
    const [r] = await sql<{ id: number }>(`SELECT id FROM reclamos WHERE cooperativa_id = :a AND estado <> 'resuelto' ORDER BY id LIMIT 1`);
    expect((await admin.post(`/api/v1/reclamos/${r!.id}/estado`).send({ estado: 'resuelto', resolucion: 'Se arregló en el momento.' })).status).toBe(200);
    expect((await tablero()).indicadores.reclamosAbiertos).toBe(antes - 1);
  });
});

describe('informes', () => {
  it('el catálogo trae los siete informes del SPEC y lo que se puede elegir', async () => {
    const c: CatalogoInformes = (await gerencia.get('/api/v1/informes')).body.data;
    expect(c.informes.map((i) => i.clave).sort()).toEqual([...INFORMES].sort());
    expect(c.periodos[0]).toMatchObject(M);
    expect(c.zonas.length).toBeGreaterThan(0);
    expect((await gerencia.get('/api/v1/informes/inventado')).status).toBe(404);
    expect((await gerencia.get('/api/v1/informes/deuda?formato=doc')).status).toBe(400);
  });

  it('deuda por socio: el total es la deuda del tablero, con y sin filtros', async () => {
    const t = await tablero();
    const i = await informe('deuda');
    expect(i.total).toBe(t.indicadores.sociosConDeuda);
    expect(i.filas).toHaveLength(i.total);
    expect(i.totales![columna(i, 'deuda')]).toBe(t.indicadores.deuda);
    expect(i.totales![columna(i, 'vencida')]).toBe(t.indicadores.deudaVencida);
    expect(i.totales![columna(i, 'facturas')]).toBe(t.antiguedad.reduce((s, x) => s + x.facturas, 0));
    expect(i.subtitulo).toBe('Toda la cooperativa');
    expect(i.periodo).toBeNull();
    // Del que más debe al que menos.
    const deudas = i.filas.map((f) => Number(f[columna(i, 'deuda')]));
    expect(deudas).toEqual([...deudas].sort((a, b) => b - a));
    // Cada fila, contra la base.
    const primero = i.filas[0]!;
    const [d] = await sql<{ deuda: string; n: string; vence: string }>(
      `SELECT CAST(sum(c.saldo) AS numeric(16,2)) AS deuda, count(*) AS n, to_char(min(c.vence_el), 'YYYY-MM-DD') AS vence
       FROM comprobantes c JOIN socios s ON s.id = c.socio_id WHERE ${DEUDA} AND s.numero = :numero`,
      { coop: w.a.id, numero: primero[columna(i, 'socio')] },
    );
    expect(primero[columna(i, 'deuda')]).toBe(d!.deuda);
    expect(primero[columna(i, 'facturas')]).toBe(Number(d!.n));
    expect(primero[columna(i, 'masVieja')]).toBe(d!.vence);

    const zona = t.zonas[0]!;
    const filtrado = await informe('deuda', { zona: zona.id, servicio: 'energia' });
    expect(filtrado.subtitulo).toBe(`Energía eléctrica · ${zona.nombre}`);
    expect(filtrado.totales?.[columna(filtrado, 'deuda')] ?? '0.00').toBe((await tablero({ zona: zona.id, servicio: 'energia' })).indicadores.deuda);
  });

  it('cortes sugeridos: solo servicios activos con dos o más facturas vencidas', async () => {
    const i = await informe('cortes');
    const esperados = await sql<{ id: number }>(
      `SELECT c.servicio_conexion_id AS id FROM comprobantes c JOIN servicios_conexion sc ON sc.id = c.servicio_conexion_id
       WHERE ${DEUDA} AND c.vence_el < CAST(:hoy AS date) AND sc.estado IN ('activo', 'suspendido') GROUP BY c.servicio_conexion_id HAVING count(*) >= 2`,
      { coop: w.a.id },
    );
    expect(i.total).toBe(esperados.length);
    expect(i.total).toBeGreaterThan(0);
    for (const f of i.filas) expect(Number(f[columna(i, 'vencidas')])).toBeGreaterThanOrEqual(2);
    expect(i.nota).toContain('nunca corta solo');
  });

  it('libro de ventas: suma lo facturado del mes y cada fila cierra; una nota de crédito resta', async () => {
    const t = await tablero();
    const i = await informe('libro-ventas');
    expect(i.periodo).toEqual(P);
    expect(i.total).toBe(t.indicadores.facturas);
    expect(i.totales![columna(i, 'total')]).toBe(t.indicadores.facturado);
    const partes = ['neto', 'ivaImporte', 'tributos', 'adicionales', 'recargos'].map((c) => columna(i, c));
    for (const f of i.filas) expect(suma(...partes.map((p) => String(f[p])))).toBe(f[columna(i, 'total')]);
    expect(Number(i.totales![columna(i, 'ivaImporte')])).toBeGreaterThan(0);

    // Se anula una factura sin pagos: sale del facturado de su mes y la nota figura hoy, restando.
    const [f] = await sql<{ id: number; anio: number; mes: number; total: string }>(
      `SELECT c.id, c.anio, c.mes, c.total FROM comprobantes c WHERE ${DEUDA} AND c.saldo = c.total ORDER BY c.anio DESC, c.mes DESC, c.id DESC LIMIT 1`,
      { coop: w.a.id },
    );
    const antes = await tablero({ anio: f!.anio, mes: f!.mes });
    expect((await facturacion.post(`/api/v1/facturacion/comprobantes/${f!.id}/nota-credito`).send({ motivo: 'Prueba: factura mal emitida' })).status).toBe(201);
    const despues = await tablero({ anio: f!.anio, mes: f!.mes });
    expect(suma(despues.indicadores.facturado, f!.total)).toBe(antes.indicadores.facturado);
    expect(suma(despues.indicadores.deuda, f!.total)).toBe(antes.indicadores.deuda);
    const hoyLibro = await informe('libro-ventas', M);
    expect(hoyLibro.total).toBe(1);
    expect(hoyLibro.filas[0]![columna(hoyLibro, 'comprobante')]).toMatch(/^N\.Cr /);
    expect(hoyLibro.filas[0]![columna(hoyLibro, 'total')]).toBe(`-${f!.total}`);
    // En el libro de su mes la factura sigue, marcada como anulada: el libro no pierde comprobantes.
    const libroMes = await informe('libro-ventas', { anio: f!.anio, mes: f!.mes });
    expect(libroMes.filas.some((x) => x[columna(libroMes, 'estado')] === 'Anulada')).toBe(true);
    expect(libroMes.totales![columna(libroMes, 'total')]).toBe(antes.indicadores.facturado);
  });

  it('recaudación diaria: suma la recaudación del mes del tablero', async () => {
    const t = await tablero();
    const i = await informe('recaudacion');
    expect(i.totales![columna(i, 'total')]).toBe(t.recaudacion.total);
    expect(i.totales![columna(i, 'cobros')]).toBe(t.recaudacion.cobros);
    for (const m of t.recaudacion.porMedio) expect(i.totales![columna(i, m.medio)]).toBe(m.total);
    const dias = i.filas.map((f) => String(f[columna(i, 'dia')]));
    expect(dias).toEqual([...dias].sort());
    expect(dias.every((d) => d.startsWith(`${P.anio}-${String(P.mes).padStart(2, '0')}`))).toBe(true);
    // El mes en curso: el cobro anulado del test anterior figura como anulado y no suma.
    const actual = await informe('recaudacion', M);
    expect(actual.totales![columna(actual, 'anulados')]).toBe(1);
    expect(actual.totales![columna(actual, 'total')]).toBe((await tablero(M)).recaudacion.total);
  });

  it('lecturas, consumos por zona y padrón', async () => {
    const t = await tablero();
    const lecturas = await informe('lecturas', M);
    expect(lecturas.total).toBe(Number(await valor(`SELECT count(*) AS v FROM lecturas l JOIN periodos p ON p.id = l.periodo_id WHERE l.cooperativa_id = :a AND p.anio = :anio AND p.mes = :mes`, M)));
    expect(lecturas.total).toBe(t.lecturas.leidos);
    expect((await informe('lecturas', { ...M, servicio: 'agua' })).total + (await informe('lecturas', { ...M, servicio: 'energia' })).total).toBe(lecturas.total);

    const consumos = await informe('consumos-zona');
    const energia = consumos.filas.filter((f) => f[columna(consumos, 'unidad')] === 'kWh').reduce((s, f) => s + Number(f[columna(consumos, 'consumo')]), 0);
    expect(energia).toBe(Number(t.indicadores.consumo.energia));
    expect(consumos.totales![columna(consumos, 'facturado')]).toBe(suma((await tablero({ servicio: 'energia' })).indicadores.facturado, (await tablero({ servicio: 'agua' })).indicadores.facturado));

    const padron = await informe('padron');
    expect(padron.total).toBe(Number(await valor(`SELECT count(*) AS v FROM conexiones WHERE cooperativa_id = :a AND eliminado_el IS NULL`)));
    expect(padron.totales).toBeNull();
    expect(String(padron.filas[0]![columna(padron, 'servicios')])).toContain('Energía eléctrica');
    const conAgua = await informe('padron', { servicio: 'agua' });
    expect(conAgua.total).toBeLessThan(padron.total);
    expect(conAgua.filas.every((f) => String(f[columna(conAgua, 'servicios')]).includes('Agua potable'))).toBe(true);
  });
});

describe('exportar', () => {
  it('Excel: mismos datos, con los importes como números', async () => {
    const i = await informe('deuda');
    const res = await gerencia.get('/api/v1/informes/deuda?formato=xlsx').responseType('blob');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="deuda-por-socio-\d{4}-\d{2}-\d{2}\.xlsx"$/);
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(aExcel(res.body));
    const hoja = libro.worksheets[0]!;
    expect(hoja.getCell(1, 1).value).toBe(w.a.nombre);
    expect(hoja.getCell(2, 1).value).toBe('Deuda por socio');
    expect(hoja.getRow(5).values).toEqual([undefined, ...i.columnas.map((c) => c.titulo)]);
    const debe = columna(i, 'deuda') + 1;
    expect(hoja.getCell(6, debe).value).toBe(Number(i.filas[0]![debe - 1]));
    expect(hoja.getCell(6, columna(i, 'nombre') + 1).value).toBe(i.filas[0]![columna(i, 'nombre')]);
    expect(hoja.getCell(6, columna(i, 'masVieja') + 1).value).toBeInstanceOf(Date);
    const total = hoja.getRow(6 + i.total);
    expect(total.getCell(1).value).toBe('Total');
    expect(total.getCell(debe).value).toBeCloseTo(Number(i.totales![debe - 1]), 2);
  });

  it('CSV: punto y coma, coma decimal y acentos que Excel lee bien; un nombre no puede ser una fórmula', async () => {
    const i = await informe('deuda');
    const numero = i.filas[0]![columna(i, 'socio')];
    await sequelize.query(`UPDATE socios SET nombre = '=HYPERLINK("http://malo.example";"clic")' WHERE cooperativa_id = :a AND numero = :numero`, { replacements: { a: w.a.id, numero } });
    const res = await gerencia.get('/api/v1/informes/deuda?formato=csv').responseType('blob');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    const texto = (res.body as Buffer).toString('utf8');
    expect(texto.charCodeAt(0)).toBe(0xfeff);
    const lineas = texto.slice(1).trimEnd().split('\r\n');
    expect(lineas).toHaveLength(1 + i.total + 1);
    expect(lineas[0]).toBe(i.columnas.map((c) => c.titulo).join(';'));
    expect(lineas[1]).toContain(`"'=HYPERLINK(""http://malo.example"";""clic"")"`);
    expect(lineas[1]).toContain(String(i.filas[0]![columna(i, 'deuda')]).replace('.', ','));
    expect(lineas[1]).toMatch(/;\d{2}\/\d{2}\/\d{4};/);
    expect(lineas.at(-1)!.startsWith('Total;')).toBe(true);
    // El Excel tampoco lo toma como fórmula.
    const xlsx = await gerencia.get('/api/v1/informes/deuda?formato=xlsx').responseType('blob');
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(aExcel(xlsx.body));
    expect(String(libro.worksheets[0]!.getCell(6, columna(i, 'nombre') + 1).value).startsWith(`'=`)).toBe(true);
  });

  it('PDF: de todos los informes, y queda registrado quién exportó qué', async () => {
    const antes = await runUnscoped(() => Auditoria.count({ where: { accion: 'exportar_informe' } }));
    for (const clave of INFORMES) {
      const res = await gerencia.get(`/api/v1/informes/${clave}?formato=pdf`).responseType('blob');
      expect(res.status, clave).toBe(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
      expect((res.body as Buffer).length).toBeGreaterThan(1500);
    }
    // Un informe corto entra en una sola hoja: el pie con el número de hoja no agrega una de más.
    const corto = await gerencia.get('/api/v1/informes/consumos-zona?formato=pdf').responseType('blob');
    expect((corto.body as Buffer).toString('latin1').match(/\/Type \/Page\b/g)).toHaveLength(1);
    // Un informe sin filas también sale (con el aviso), no rompe.
    const vacio = await gerencia.get(`/api/v1/informes/libro-ventas?formato=pdf&anio=2001&mes=1`).responseType('blob');
    expect(vacio.status).toBe(200);
    const rastros = await runUnscoped(() => Auditoria.findAll({ where: { accion: 'exportar_informe' }, order: [['id', 'ASC']] }));
    expect(rastros.length - antes).toBe(INFORMES.length + 2);
    expect(rastros.at(-1)).toMatchObject({ cooperativaId: w.a.id, usuarioId: w.demoA.id, entidadId: 'libro-ventas' });
    expect(rastros.at(-1)!.despuesJson).toMatchObject({ formato: 'pdf', filas: 0 });
    // Mirar en pantalla no deja rastro.
    await informe('padron');
    expect(await runUnscoped(() => Auditoria.count({ where: { accion: 'exportar_informe' } }))).toBe(rastros.length);
  });
});

describe('aislamiento', () => {
  it('cada cooperativa ve su tablero y sus informes', async () => {
    const [a, b] = [await tablero(), await tablero({}, adminB)];
    expect(b.indicadores.facturado).toBe(await valor(`SELECT CAST(sum(c.total) AS numeric(16,2)) AS v FROM comprobantes c WHERE ${FACTURAS} AND c.anio = :anio AND c.mes = :mes`, { coop: w.b.id, ...b.periodo }));
    expect(b.indicadores.facturado).not.toBe(a.indicadores.facturado);
    expect(b.indicadores.deuda).toBe(await valor(`SELECT CAST(COALESCE(sum(c.saldo), 0) AS numeric(16,2)) AS v FROM comprobantes c WHERE ${DEUDA}`, { coop: w.b.id }));
    expect(b.zonas.every((z) => !a.zonas.some((x) => x.id === z.id))).toBe(true);
    expect(b.recaudacion.porCajero.every((c) => c.cajeroId === null || c.cajeroId !== w.cajeroA.id)).toBe(true);
    const padronB = await informe('padron', {}, adminB);
    expect(padronB.total).toBe(Number(await valor(`SELECT count(*) AS v FROM conexiones WHERE cooperativa_id = :b AND eliminado_el IS NULL`)));
    // El socio de A que se renombró más arriba está en el padrón de A y no en el de B.
    const esElDeA = (f: InformeDatos['filas'][number]) => String(f[1]).includes('HYPERLINK');
    expect((await informe('padron')).filas.some(esElDeA)).toBe(true);
    expect(padronB.filas.some(esElDeA)).toBe(false);
    // La energía que cargó A en el mes en curso no aparece en B.
    expect((await tablero(M, adminB)).balance.at(-1)!.comprada).toBeNull();
  });
});
