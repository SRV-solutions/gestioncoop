// Panel de SRV: la comisión por factura de cada cooperativa (con vigencias) y el diseño de su
// factura. Cada número de la liquidación se vuelve a calcular con una consulta directa a la base.
import { QueryTypes } from 'sequelize';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CooperativaSrv, LiquidacionPlataforma } from '../src/shared';
import { sequelize } from '../src/db';
import { runInCooperativa } from '../src/lib/context';
import { hoy } from '../src/lib/tarifas';
import { Auditoria, ComisionSrv } from '../src/models';
import { callesInventadas } from '../src/seed/calles-inventadas';
import { cargarFacturas } from '../src/seed/cargar-facturas';
import { cargarLecturas } from '../src/seed/cargar-lecturas';
import { cargarPadron } from '../src/seed/cargar-padron';
import { cargarTarifas } from '../src/seed/cargar-tarifas';
import { generarPadron } from '../src/seed/generar-padron';
import { TARIFAS_ARROYO_DEL_MONTE } from '../src/seed/tarifas';
import { app, createCooperativa, createUser, loginAs, request, resetWorld } from './helpers';

const HOY = hoy();
const api = '/api/v1/cooperativas';
let w: Awaited<ReturnType<typeof resetWorld>>;
let srv: Awaited<ReturnType<typeof loginAs>>;
/** El último mes con facturas de la cooperativa A, y el primero del historial. */
let ultimo: { anio: number; mes: number };

// Un PNG de 1×1, de verdad.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const sql = <T extends object>(texto: string, replacements: Record<string, unknown> = {}) => sequelize.query<T>(texto, { replacements, type: QueryTypes.SELECT });

/**
 * La comisión de un mes calculada por otro camino: factura por factura, buscando a mano la vigencia
 * de cada una, en centavos.
 */
async function comisionEsperada(cooperativaId: number, anio: number, mes: number): Promise<string> {
  const [vigencias, comprobantes] = await Promise.all([
    sql<{ desde: string; porcentaje: string; fijo: string }>(`SELECT desde::text, porcentaje, fijo_por_factura AS fijo FROM comisiones_srv WHERE cooperativa_id = :c ORDER BY desde DESC`, { c: cooperativaId }),
    sql<{ tipo: string; total: string; emitido: string }>(
      `SELECT tipo, total, emitido_el::text AS emitido FROM comprobantes
       WHERE cooperativa_id = :c AND tipo IN ('factura', 'nota_debito', 'nota_credito') AND estado <> 'borrador'
         AND EXTRACT(YEAR FROM emitido_el) = :anio AND EXTRACT(MONTH FROM emitido_el) = :mes`,
      { c: cooperativaId, anio, mes },
    ),
  ]);
  // En diezmilésimos de centavo, para no perder nada antes de redondear el total.
  let total = 0;
  for (const c of comprobantes) {
    const v = vigencias.find((x) => x.desde <= c.emitido);
    if (!v) continue;
    const variable = Math.round(Number(c.total) * Number(v.porcentaje) * 10_000) / 100; // centavos × 100
    total += c.tipo === 'nota_credito' ? -variable : variable + Math.round(Number(v.fijo) * 100) * 100;
  }
  return (Math.round(total / 100) / 100).toFixed(2);
}

beforeAll(async () => {
  w = await resetWorld();
  await cargarPadron(generarPadron(callesInventadas(), { hogares: 30, semilla: 3 }), { cooperativaId: w.a.id, planes: [] });
  await cargarTarifas(w.a.id, TARIFAS_ARROYO_DEL_MONTE);
  await cargarLecturas(w.a.id, { hoy: HOY, semilla: 3, avance: [0.5, 0] });
  await cargarFacturas(w.a.id, { semilla: 3 });
  srv = await loginAs('super@proveedor.test');
  const [u] = await sql<{ anio: number; mes: number }>(
    `SELECT EXTRACT(YEAR FROM max(emitido_el))::int AS anio, EXTRACT(MONTH FROM max(emitido_el))::int AS mes FROM comprobantes WHERE cooperativa_id = :c AND tipo = 'factura'`,
    { c: w.a.id },
  );
  ultimo = u!;
}, 180_000);
afterAll(() => sequelize.close());

describe('quién entra', () => {
  it('solo el proveedor', async () => {
    expect((await request(app).get(`${api}/${w.a.id}`)).status).toBe(401);
    for (const email of ['admin@a.test', 'demo@a.test', 'caja@a.test']) {
      const agente = await loginAs(email);
      expect((await agente.get(`${api}/${w.a.id}`)).status).toBe(403);
      expect((await agente.get(`${api}/liquidacion`)).status).toBe(403);
      expect((await agente.post(`${api}/${w.a.id}/comisiones`).send({ porcentaje: 0, desde: HOY })).status).toBe(403);
      expect((await agente.put(`${api}/${w.a.id}/factura`).send({})).status).toBe(403);
    }
    expect((await srv.get(`${api}/${w.a.id}`)).status).toBe(200);
    expect((await srv.get(`${api}/9999`)).status).toBe(404);
  });
});

describe('comisión por factura', () => {
  it('sin comisión cargada no se cobra nada', async () => {
    const d: CooperativaSrv = (await srv.get(`${api}/${w.a.id}`)).body.data;
    expect(d.comision.vigente).toBeNull();
    expect(d.comision.meses.length).toBeGreaterThan(0);
    for (const m of d.comision.meses) expect(m.comision).toBe('0.00');
  });

  it('cada factura paga el porcentaje que regía el día en que se emitió, más el fijo', async () => {
    // Historial: 0,8 % desde siempre; desde el último mes, 1 % y $ 10 por factura. Se cargan directo
    // (por la API no se puede cargar una comisión con fecha pasada).
    const desdeUltimo = `${ultimo.anio}-${String(ultimo.mes).padStart(2, '0')}-01`;
    await runInCooperativa(w.a.id, async () => {
      await ComisionSrv.create({ cooperativaId: w.a.id, desde: '2020-01-01', porcentaje: '0.8' });
      await ComisionSrv.create({ cooperativaId: w.a.id, desde: desdeUltimo, porcentaje: '1', fijoPorFactura: '10' });
    });
    const d: CooperativaSrv = (await srv.get(`${api}/${w.a.id}`)).body.data;
    expect(d.comision.vigente).toMatchObject({ porcentaje: '1', fijoPorFactura: '10.00', desde: desdeUltimo });
    expect(d.comision.historial.map((v) => v.desde)).toEqual([desdeUltimo, '2020-01-01']);

    expect(d.comision.meses[0]).toMatchObject(ultimo);
    for (const m of d.comision.meses.slice(0, 4)) {
      expect(m.comision).toBe(await comisionEsperada(w.a.id, m.anio, m.mes));
      const [f] = await sql<{ n: string; total: string }>(
        `SELECT count(*) AS n, COALESCE(sum(total), 0)::text AS total FROM comprobantes WHERE cooperativa_id = :c AND tipo IN ('factura', 'nota_debito') AND estado <> 'borrador'
           AND EXTRACT(YEAR FROM emitido_el) = :anio AND EXTRACT(MONTH FROM emitido_el) = :mes`,
        { c: w.a.id, anio: m.anio, mes: m.mes },
      );
      expect(m.facturas).toBe(Number(f!.n));
      expect(Number(m.facturado)).toBeCloseTo(Number(f!.total), 2);
    }
    // El último mes, con el 1 % y el fijo; el anterior, con el 0,8 %.
    const [ult, ant] = d.comision.meses;
    expect(Number(ult!.comision)).toBeCloseTo(Number(ult!.facturado) * 0.01 + ult!.facturas * 10, 1);
    expect(Number(ant!.comision)).toBeCloseTo(Number(ant!.facturado) * 0.008, 1);
  });

  it('una nota de crédito devuelve el porcentaje de lo que acredita (el fijo, no)', async () => {
    const oficina = await createUser({ cooperativaId: w.a.id, email: 'facturacion@a.test', roles: ['facturacion'] }).then(() => loginAs('facturacion@a.test'));
    const [impaga] = await sql<{ id: number; total: string; anio: number; mes: number }>(
      `SELECT c.id, c.total, EXTRACT(YEAR FROM c.emitido_el)::int AS anio, EXTRACT(MONTH FROM c.emitido_el)::int AS mes FROM comprobantes c
       WHERE c.cooperativa_id = :c AND c.tipo = 'factura' AND c.estado = 'emitido'
         AND NOT EXISTS (SELECT 1 FROM pago_aplicaciones pa WHERE pa.comprobante_id = c.id)
       ORDER BY c.emitido_el DESC LIMIT 1`,
      { c: w.a.id },
    );
    const antes: CooperativaSrv = (await srv.get(`${api}/${w.a.id}`)).body.data;
    const res = await oficina.post(`/api/v1/facturacion/comprobantes/${impaga!.id}/nota-credito`).send({ motivo: 'Lectura mal tomada' });
    expect(res.status).toBe(201);
    const despues: CooperativaSrv = (await srv.get(`${api}/${w.a.id}`)).body.data;
    // La nota de crédito se emite hoy: ese mes descuenta el 1 % de lo acreditado.
    const mesHoy = { anio: Number(HOY.slice(0, 4)), mes: Number(HOY.slice(5, 7)) };
    const a = antes.comision.meses.find((m) => m.anio === mesHoy.anio && m.mes === mesHoy.mes);
    const b = despues.comision.meses.find((m) => m.anio === mesHoy.anio && m.mes === mesHoy.mes)!;
    expect(b.notasCredito).toBe((a?.notasCredito ?? 0) + 1);
    expect(Number(b.comision)).toBeCloseTo(Number(a?.comision ?? 0) - Number(impaga!.total) * 0.01, 1);
    expect(b.comision).toBe(await comisionEsperada(w.a.id, mesHoy.anio, mesHoy.mes));
  });

  it('un cambio rige desde hoy o más adelante, uno por día, y queda en la auditoría', async () => {
    const cargar = (cuerpo: Record<string, unknown>) => srv.post(`${api}/${w.a.id}/comisiones`).send(cuerpo);
    const ayer = new Date(Date.parse(`${HOY}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    const enUnMes = new Date(Date.parse(`${HOY}T12:00:00Z`) + 30 * 86_400_000).toISOString().slice(0, 10);

    const pasado = await cargar({ porcentaje: 1, desde: ayer });
    expect(pasado.status).toBe(400);
    expect(pasado.body.error.fields.desde).toMatch(/hoy o más adelante/);
    for (const mal of [{ porcentaje: 11, desde: HOY }, { porcentaje: -1, desde: HOY }, { porcentaje: 0.8125, desde: HOY }, { porcentaje: 1, fijoPorFactura: -5, desde: HOY }, { porcentaje: 1, desde: 'mañana' }]) {
      expect((await cargar(mal)).status).toBe(400);
    }

    const proxima = await cargar({ porcentaje: '1.2', fijoPorFactura: '0', desde: enUnMes, nota: 'Nuevo acuerdo' });
    expect(proxima.status).toBe(201);
    expect(proxima.body.data.proxima).toMatchObject({ porcentaje: '1.2', desde: enUnMes, nota: 'Nuevo acuerdo', cargadoPor: expect.any(String) });
    expect(proxima.body.data.vigente.porcentaje).toBe('1');
    expect((await cargar({ porcentaje: 2, desde: enUnMes })).status).toBe(409);

    // La que todavía no rige se puede borrar; la que ya rige, no.
    const id = proxima.body.data.proxima.id as number;
    expect((await srv.delete(`${api}/${w.a.id}/comisiones/${id}`)).body.data.proxima).toBeNull();
    const vigente = (await srv.get(`${api}/${w.a.id}`)).body.data.comision.vigente.id as number;
    expect((await srv.delete(`${api}/${w.a.id}/comisiones/${vigente}`)).status).toBe(409);

    const hoyMismo = await cargar({ porcentaje: 0.9, desde: HOY });
    expect(hoyMismo.body.data.vigente).toMatchObject({ porcentaje: '0.9', desde: HOY });

    const auditoria = await runInCooperativa(w.a.id, () => Auditoria.findAll({ where: { accion: ['cargar_comision_srv', 'borrar_comision_srv'] }, order: [['id', 'ASC']] }));
    expect(auditoria.map((a) => a.accion)).toEqual(['cargar_comision_srv', 'borrar_comision_srv', 'cargar_comision_srv']);
    expect(auditoria.every((a) => a.usuarioId === w.superadmin.id && a.cooperativaId === w.a.id)).toBe(true);
  });

  it('la liquidación del mes junta a todas las cooperativas, y el total es la suma', async () => {
    const l: LiquidacionPlataforma = (await srv.get(`${api}/liquidacion?anio=${ultimo.anio}&mes=${ultimo.mes}`)).body.data;
    expect(l).toMatchObject(ultimo);
    expect(l.meses[0]).toBeDefined();
    const a = l.filas.find((f) => f.cooperativa.id === w.a.id)!;
    const b = l.filas.find((f) => f.cooperativa.id === w.b.id)!;
    expect(a.comision).toBe(await comisionEsperada(w.a.id, ultimo.anio, ultimo.mes));
    // B no facturó nada ni tiene comisión cargada.
    expect(b).toMatchObject({ facturas: 0, comision: '0.00', porcentaje: null });
    expect(l.total).toBe((l.filas.reduce((t, f) => t + Math.round(Number(f.comision) * 100), 0) / 100).toFixed(2));
    expect((await srv.get(`${api}/liquidacion?anio=2026&mes=13`)).status).toBe(400);
    // En la lista de cooperativas, la comisión que rige hoy.
    const lista = (await srv.get(api)).body.data as { id: number; comision: unknown }[];
    expect(lista.find((c) => c.id === w.a.id)!.comision).toEqual({ porcentaje: '0.9', fijoPorFactura: '0.00' });
    expect(lista.find((c) => c.id === w.b.id)!.comision).toBeNull();
  });
});

describe('diseño de la factura', () => {
  it('se guarda el modelo y se valida', async () => {
    const mal = await srv.put(`${api}/${w.a.id}/factura`).send({ color: 'rojo', membrete: ['a', 'b', 'c', 'd'] });
    expect(mal.status).toBe(400);
    expect(Object.keys(mal.body.error.fields).sort()).toEqual(['color', 'membrete']);
    const modelo = { color: '#C8202A', conLogo: true, membrete: ['IIBB: exento', 'Inicio de actividades: 01/03/1962'], mensaje: 'Pagá antes del vencimiento y evitá recargos', pie: 'Ente regulador: EPRE' };
    const res = await srv.put(`${api}/${w.a.id}/factura`).send(modelo);
    expect(res.status).toBe(200);
    expect(res.body.data.modelo).toEqual({ ...modelo, color: '#c8202a' });
    const d: CooperativaSrv = (await srv.get(`${api}/${w.a.id}`)).body.data;
    expect(d.factura.modelo.pie).toBe('Ente regulador: EPRE');
    expect(await runInCooperativa(w.a.id, () => Auditoria.count({ where: { accion: 'cambiar_diseno_factura' } }))).toBe(1);
  });

  it('el logo de la factura acepta PNG y JPG de verdad, y se puede quitar', async () => {
    const texto = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64');
    for (const imagen of [`data:image/svg+xml;base64,${texto}`, `data:image/png;base64,${texto}`, `data:image/webp;base64,${PNG}`]) {
      expect((await srv.put(`${api}/${w.a.id}/factura/logo`).send({ imagen })).status).toBe(400);
    }
    const res = await srv.put(`${api}/${w.a.id}/factura/logo`).send({ imagen: `data:image/png;base64,${PNG}` });
    expect(res.status).toBe(200);
    expect(res.body.data.logoFactura).toBe(true);
    const logo = await srv.get(`${api}/${w.a.id}/factura/logo`);
    expect(logo.headers['content-type']).toBe('image/png');
    // El isotipo de la app es otra imagen: no se tocó.
    expect(res.body.data.isotipo).toBe(false);
  });

  it('la muestra es la última factura con el diseño, sin guardar nada', async () => {
    const guardada = await srv.post(`${api}/${w.a.id}/factura/muestra`).send({});
    expect(guardada.status).toBe(200);
    expect(guardada.headers['content-type']).toBe('application/pdf');
    expect((guardada.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    const otra = await srv.post(`${api}/${w.a.id}/factura/muestra`).send({ color: '#123456', conLogo: false, membrete: [], mensaje: null, pie: null });
    expect(otra.status).toBe(200);
    expect(Buffer.compare(otra.body as Buffer, guardada.body as Buffer)).not.toBe(0);
    // No se guardó: el modelo sigue siendo el de antes.
    expect(((await srv.get(`${api}/${w.a.id}`)).body.data as CooperativaSrv).factura.modelo.color).toBe('#c8202a');
    expect((await srv.post(`${api}/${w.a.id}/factura/muestra`).send({ color: 'nada' })).status).toBe(400);
    // El socio también baja su factura con el diseño (el PDF del portal es el mismo).
    const sinFacturas = await createCooperativa('coop-c');
    expect((await srv.post(`${api}/${sinFacturas.id}/factura/muestra`).send({})).status).toBe(409);
  });
});
