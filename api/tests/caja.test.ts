// Fase 5: caja y cobranza por la API —abrir, buscar, cobrar, recibo, anular, cerrar con arqueo—,
// los pagos del historial de prueba, el recargo por pago fuera de término y el aislamiento.
import { randomUUID } from 'node:crypto';
import { QueryTypes } from 'sequelize';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  aCentavos,
  codigoDeBarras,
  deCentavos,
  leerImporte,
  repartirPago,
  type CajaDetalle,
  type CuentaSocio,
  type EstadoCaja,
  type PaginaCajas,
  type ProductoVenta,
  type ReciboDetalle,
  type ResultadoBusqueda,
} from '../src/shared';
import { sequelize } from '../src/db';
import { runInCooperativa } from '../src/lib/context';
import { calcularPrefacturas } from '../src/lib/facturacion';
import { sellarPendientes, verificarIntegridad } from '../src/lib/integridad';
import { hoy } from '../src/lib/tarifas';
import { Auditoria, Pago } from '../src/models';
import { callesInventadas } from '../src/seed/calles-inventadas';
import { cargarPagos, cargarProductos } from '../src/seed/cargar-caja';
import { cargarFacturas } from '../src/seed/cargar-facturas';
import { cargarLecturas } from '../src/seed/cargar-lecturas';
import { cargarPadron } from '../src/seed/cargar-padron';
import { cargarTarifas } from '../src/seed/cargar-tarifas';
import { generarPadron, PLANES } from '../src/seed/generar-padron';
import { TARIFAS_ARROYO_DEL_MONTE } from '../src/seed/tarifas';
import { createUser, loginAs, resetWorld } from './helpers';

const api = '/api/v1/caja';
const HOY = hoy();
const ANIO = Number(HOY.slice(0, 4));
const MES = Number(HOY.slice(5, 7));
const PLANES_PRUEBA = [
  { servicio: 'internet' as const, nombre: PLANES.internet50, precio: '20000.00' },
  { servicio: 'internet' as const, nombre: PLANES.internet100, precio: '30000.00' },
  { servicio: 'tv' as const, nombre: PLANES.tv, precio: '15000.00' },
];

let w: Awaited<ReturnType<typeof resetWorld>>;
type Agente = Awaited<ReturnType<typeof loginAs>>;
let caja: Agente;
let caja2: Agente;
let admin: Agente;
let gerencia: Agente;
let adminB: Agente;

interface Deudor {
  socio_id: number;
  numero: number;
  nombre: string;
  nro_doc: string;
}

const sql = <T extends object>(texto: string, replacements: Record<string, unknown> = {}) =>
  sequelize.query<T>(texto, { replacements: { a: w.a.id, b: w.b.id, ...replacements }, type: QueryTypes.SELECT });
const estado = async (agente: Agente = caja): Promise<EstadoCaja> => (await agente.get(`${api}/estado`)).body.data;
const cuenta = async (socioId: number, agente: Agente = caja): Promise<CuentaSocio> => (await agente.get(`${api}/socios/${socioId}`)).body.data;
const buscar = async (q: string, agente: Agente = caja): Promise<ResultadoBusqueda> => (await agente.get(`${api}/buscar?q=${encodeURIComponent(q)}`)).body.data;
const cobrar = (datos: Record<string, unknown>, agente: Agente = caja) => agente.post(`${api}/cobros`).send({ clave: randomUUID(), socioId: null, aplicaciones: [], items: [], medio: 'efectivo', ...datos });
const factura = async (id: number) => (await sql<{ estado: string; saldo: string; total: string }>(`SELECT estado, saldo, total FROM comprobantes WHERE id = :id`, { id }))[0]!;
const suma = (...importes: string[]) => deCentavos(importes.reduce((t, i) => t + aCentavos(i), 0));
/** Un socio de A que ahora mismo debe enteras al menos `facturas` facturas (cada test va gastando las suyas). */
async function deudor(facturas = 1): Promise<Deudor> {
  const debe = `(SELECT count(*) FROM comprobantes c WHERE c.socio_id = s.id AND c.tipo = 'factura' AND c.estado = 'emitido' AND c.saldo = c.total)`;
  const [d] = await sql<Deudor>(
    `SELECT s.id AS socio_id, s.numero, s.nombre, s.nro_doc FROM socios s WHERE s.cooperativa_id = :a AND ${debe} >= :facturas ORDER BY ${debe} DESC, s.id LIMIT 1`,
    { facturas },
  );
  if (!d) throw new Error(`No queda ningún socio que deba ${facturas} facturas`);
  return d;
}

beforeAll(async () => {
  w = await resetWorld();
  await createUser({ cooperativaId: w.a.id, email: 'caja2@a.test', roles: ['cajero'] });
  await createUser({ cooperativaId: w.a.id, email: 'operario@a.test', roles: ['operario'] });
  await createUser({ cooperativaId: w.a.id, email: 'facturacion@a.test', roles: ['facturacion'] });
  for (const [coop, semilla] of [[w.a, 7], [w.b, 8]] as const) {
    await cargarPadron(generarPadron(callesInventadas(), { hogares: 40, semilla }), { cooperativaId: coop.id, planes: PLANES_PRUEBA });
    await cargarTarifas(coop.id, TARIFAS_ARROYO_DEL_MONTE);
    await cargarLecturas(coop.id, { hoy: HOY, semilla, avance: [0.5, 0] });
    await cargarFacturas(coop.id, { semilla });
    await cargarPagos(coop.id, { semilla });
  }
  await cargarProductos(w.a.id, [
    { nombre: 'Garrafa de 10 kg', precio: '18500.00', stock: 5 },
    { nombre: 'Reconexión del servicio', precio: '12000.00', stock: null },
  ]);
  // El historial de prueba entra directo a la base: se sella, como en el seed.
  for (const coop of [w.a, w.b]) await sellarPendientes(coop.id);
  caja = await loginAs('caja@a.test');
  caja2 = await loginAs('caja2@a.test');
  admin = await loginAs('admin@a.test');
  gerencia = await loginAs('demo@a.test');
  adminB = await loginAs('admin@b.test');
}, 120_000);
afterAll(() => sequelize.close());

describe('importes', () => {
  it('lee lo que tipea una persona, con punto o coma', () => {
    expect(leerImporte('50000')).toBe('50000.00');
    expect(leerImporte('50.000')).toBe('50000.00');
    expect(leerImporte('$ 1.250.300,5')).toBe('1250300.50');
    expect(leerImporte('1500,50')).toBe('1500.50');
    expect(leerImporte('1500.50')).toBe('1500.50');
    expect(leerImporte('0')).toBe('0.00');
    for (const malo of ['', 'abc', '12,345', '1.2.3', '-50', '1e5']) expect(leerImporte(malo)).toBeNull();
  });

  it('suma en centavos, sin decimales flotantes', () => {
    expect(aCentavos('0.10') + aCentavos('0.20')).toBe(30);
    expect(deCentavos(aCentavos('161724.49'))).toBe('161724.49');
    expect(deCentavos(5)).toBe('0.05');
    expect(aCentavos('12.5')).toBe(1250);
  });

  it('reparte un pago de la factura más vieja a la más nueva', () => {
    const facturas = [{ id: 1, saldo: 10_000 }, { id: 2, saldo: 5_000 }, { id: 3, saldo: 8_000 }];
    expect(repartirPago(23_000, facturas)).toEqual([{ comprobanteId: 1, importe: 10_000 }, { comprobanteId: 2, importe: 5_000 }, { comprobanteId: 3, importe: 8_000 }]);
    expect(repartirPago(12_000, facturas)).toEqual([{ comprobanteId: 1, importe: 10_000 }, { comprobanteId: 2, importe: 2_000 }]);
    expect(repartirPago(0, facturas)).toEqual([]);
  });
});

describe('pagos del historial de prueba', () => {
  it('el saldo de cada factura es su total menos los pagos acreditados que se le aplicaron', async () => {
    const [r] = await sql<{ facturas: string; mal: string }>(
      `SELECT count(*) AS facturas,
              count(*) FILTER (WHERE GREATEST(c.total, 0) - c.saldo <> COALESCE((
                SELECT sum(a.importe) FROM pago_aplicaciones a JOIN pagos p ON p.id = a.pago_id AND p.estado = 'acreditado' WHERE a.comprobante_id = c.id), 0)) AS mal
       FROM comprobantes c WHERE c.tipo = 'factura' AND c.estado IN ('emitido', 'pagado')`,
    );
    expect(Number(r!.facturas)).toBeGreaterThan(2 * 12 * 40);
    expect(Number(r!.mal)).toBe(0);
  });

  it('cada pago vale lo que suman sus facturas y sus productos', async () => {
    const [r] = await sql<{ pagos: string; mal: string }>(
      `SELECT count(*) AS pagos,
              count(*) FILTER (WHERE p.importe <> COALESCE((SELECT sum(importe) FROM pago_aplicaciones a WHERE a.pago_id = p.id), 0)
                                               + COALESCE((SELECT sum(importe) FROM pago_items i WHERE i.pago_id = p.id), 0)) AS mal
       FROM pagos p`,
    );
    expect(Number(r!.pagos)).toBeGreaterThan(300);
    expect(Number(r!.mal)).toBe(0);
  });

  it('los recibos van numerados sin huecos y el numerador sigue desde el último', async () => {
    const filas = await sql<{ n: string; desde: number; hasta: number; ultimo: number }>(
      `SELECT count(*) AS n, min(p.numero) AS desde, max(p.numero) AS hasta, max(nu.ultimo) AS ultimo
       FROM pagos p JOIN numeradores nu ON nu.cooperativa_id = p.cooperativa_id AND nu.tipo = 'recibo' AND nu.letra = p.letra AND nu.punto_venta = p.punto_venta
       GROUP BY p.cooperativa_id, p.letra`,
    );
    expect(filas.length).toBeGreaterThanOrEqual(2);
    for (const f of filas) expect(f).toMatchObject({ desde: 1, hasta: Number(f.n), ultimo: Number(f.n) });
  });

  it('cada día de cobro de un cajero es una caja cerrada que esperaba fondo + efectivo', async () => {
    const [r] = await sql<{ cajas: string; abiertas: string; mal: string; con_diferencia_sin_nota: string }>(
      `SELECT count(*) AS cajas, count(*) FILTER (WHERE c.cerrada_el IS NULL) AS abiertas,
              count(*) FILTER (WHERE c.total_esperado <> c.fondo_inicial + COALESCE((SELECT sum(importe) FROM pagos p WHERE p.caja_id = c.id AND p.medio = 'efectivo'), 0)) AS mal,
              count(*) FILTER (WHERE c.total_contado <> c.total_esperado AND c.nota IS NULL) AS con_diferencia_sin_nota
       FROM cajas c WHERE c.cooperativa_id = :a`,
    );
    expect(Number(r!.cajas)).toBeGreaterThan(20);
    expect(r).toMatchObject({ abiertas: '0', mal: '0', con_diferencia_sin_nota: '0' });
    // B no tiene cajeros: todos sus pagos entraron por el pago online, sin caja.
    const [b] = await sql<{ cajas: string; pagos: string; online: string }>(
      `SELECT (SELECT count(*) FROM cajas WHERE cooperativa_id = :b) AS cajas, count(*) AS pagos, count(*) FILTER (WHERE origen = 'online' AND caja_id IS NULL) AS online FROM pagos WHERE cooperativa_id = :b`,
    );
    expect(b!.cajas).toBe('0');
    expect(Number(b!.pagos)).toBeGreaterThan(0);
    expect(b!.online).toBe(b!.pagos);
  });

  it('no se cargan dos veces', async () => {
    expect(await cargarPagos(w.a.id, { semilla: 7 })).toBeNull();
  });
});

describe('permisos', () => {
  it('operarios y facturación no entran; gerencia mira pero no cobra', async () => {
    expect((await (await loginAs('operario@a.test')).get(`${api}/estado`)).status).toBe(403);
    expect((await (await loginAs('facturacion@a.test')).get(`${api}/estado`)).status).toBe(403);
    expect(await estado(gerencia)).toMatchObject({ caja: null, puedeCobrar: false, puedeAnular: false });
    expect(await estado(caja)).toMatchObject({ puedeCobrar: true, puedeAnular: false });
    expect(await estado(admin)).toMatchObject({ puedeCobrar: true, puedeAnular: true });
    expect((await gerencia.post(`${api}/abrir`).send({ fondoInicial: '1000' })).status).toBe(403);
    expect((await cobrar({}, gerencia)).status).toBe(403);
  });
});

describe('abrir la caja', () => {
  it('sin caja abierta no se puede cobrar', async () => {
    const d = await deudor();
    const { pendientes } = await cuenta(d.socio_id);
    const res = await cobrar({ socioId: d.socio_id, aplicaciones: [{ comprobanteId: pendientes[0]!.id, importe: pendientes[0]!.saldo }] });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe('Primero abrí la caja');
  });

  it('se abre con un fondo inicial, y una sola por cajero', async () => {
    const mal = await caja.post(`${api}/abrir`).send({ fondoInicial: 'veinte mil' });
    expect(mal.status).toBe(400);
    expect(mal.body.error.fields.fondoInicial).toBeTruthy();

    const res = await caja.post(`${api}/abrir`).send({ fondoInicial: '20000' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ fondoInicial: '20000.00', cobros: 0, total: '0.00', efectivoEsperado: '20000.00', cerradaEl: null, contado: null, diferencia: null });
    expect((await caja.post(`${api}/abrir`).send({ fondoInicial: '5000' })).status).toBe(409);
    expect((await estado()).caja).toMatchObject({ id: res.body.data.id, cajero: { id: w.cajeroA.id } });
    expect(await runInCooperativa(w.a.id, () => Auditoria.count({ where: { accion: 'abrir_caja', entidadId: String(res.body.data.id) } }))).toBe(1);
  });
});

describe('buscar al socio en un solo campo', () => {
  it('por número de socio, apellido, documento y medidor', async () => {
    const d = await deudor(2);
    const porNumero = await buscar(String(d.numero));
    expect(porNumero.socios[0]).toMatchObject({ id: d.socio_id, nombre: d.nombre });
    expect(porNumero.socios[0]!.pendientes).toBeGreaterThanOrEqual(2);
    expect(Number(porNumero.socios[0]!.deuda)).toBeGreaterThan(0);
    expect(porNumero.socios[0]!.vencidas).toBe(porNumero.socios[0]!.pendientes);

    const apellido = d.nombre.split(',')[0]!.toUpperCase();
    expect((await buscar(apellido)).socios.map((s) => s.id)).toContain(d.socio_id);
    expect((await buscar(d.nro_doc)).socios.map((s) => s.id)).toContain(d.socio_id);

    const [medidor] = await sql<{ numero: string }>(
      `SELECT m.numero FROM medidores m JOIN servicios_conexion sc ON sc.id = m.servicio_conexion_id JOIN conexiones c ON c.id = sc.conexion_id WHERE c.socio_id = :id LIMIT 1`,
      { id: d.socio_id },
    );
    expect((await buscar(medidor!.numero)).socios.map((s) => s.id)).toContain(d.socio_id);
    expect((await buscar('zzzzqqq')).socios).toEqual([]);
    expect((await caja.get(`${api}/buscar?q=`)).status).toBe(400);
  });

  it('por el código de barras de la factura: trae al socio con esa factura', async () => {
    const d = await deudor();
    const f = (await cuenta(d.socio_id)).pendientes[0]!;
    const codigo = codigoDeBarras({ cooperativaId: w.a.id, id: f.id, venceEl: f.venceEl, total: f.total });
    expect(await buscar(codigo)).toMatchObject({ comprobanteId: f.id, aviso: null, socios: [{ id: d.socio_id }] });

    // Mal leído, de otra cooperativa o de una factura que ya está paga: avisa en lugar de traer cualquier cosa.
    const malLeido = codigo.slice(0, 31) + String((Number(codigo[31]) + 1) % 10);
    expect(await buscar(malLeido)).toMatchObject({ socios: [], comprobanteId: null, aviso: expect.stringMatching(/se leyó mal/) });
    const [deB] = await sql<{ id: number; vence_el: string; total: string }>(
      `SELECT id, to_char(vence_el, 'YYYY-MM-DD') AS vence_el, total FROM comprobantes WHERE cooperativa_id = :b AND tipo = 'factura' AND estado = 'emitido' LIMIT 1`,
    );
    expect(await buscar(codigoDeBarras({ cooperativaId: w.b.id, id: deB!.id, venceEl: deB!.vence_el, total: deB!.total }))).toMatchObject({
      socios: [],
      comprobanteId: null,
      aviso: expect.stringMatching(/otra cooperativa/),
    });
    const [pagada] = await sql<{ id: number; vence_el: string; total: string }>(
      `SELECT id, to_char(vence_el, 'YYYY-MM-DD') AS vence_el, total FROM comprobantes WHERE cooperativa_id = :a AND tipo = 'factura' AND estado = 'pagado' AND total > 0 LIMIT 1`,
    );
    const yaPaga = await buscar(codigoDeBarras({ cooperativaId: w.a.id, id: pagada!.id, venceEl: pagada!.vence_el, total: pagada!.total }));
    expect(yaPaga).toMatchObject({ comprobanteId: null, aviso: expect.stringMatching(/ya está pagada/) });
    expect(yaPaga.socios).toHaveLength(1);
  });
});

describe('cobrar', () => {
  let primerRecibo: ReciboDetalle;

  it('la cuenta del socio trae lo que debe, de lo más viejo a lo más nuevo', async () => {
    const d = await deudor(2);
    const c = await cuenta(d.socio_id);
    expect(c.socio).toMatchObject({ id: d.socio_id, numero: d.numero });
    expect(c.pendientes.length).toBeGreaterThanOrEqual(2);
    expect(c.pendientes.map((p) => p.venceEl)).toEqual([...c.pendientes.map((p) => p.venceEl)].sort());
    expect(c.deuda).toBe(suma(...c.pendientes.map((p) => p.saldo)));
    for (const p of c.pendientes) {
      expect(p.referencia).toMatch(/^Fact [AB] 0001-\d{8}$/);
      expect(p.diasAtraso).toBeGreaterThan(0);
    }
    expect((await caja.get(`${api}/socios/999999`)).status).toBe(404);
  });

  it('una factura en efectivo: calcula el vuelto, numera el recibo y la factura queda paga', async () => {
    const d = await deudor();
    const f = (await cuenta(d.socio_id)).pendientes[0]!;
    const recibido = deCentavos(Math.ceil(aCentavos(f.saldo) / 100_000) * 100_000 + 100_000);
    const [{ ultimo }] = (await sql<{ ultimo: number }>(`SELECT COALESCE(max(numero), 0) AS ultimo FROM pagos WHERE cooperativa_id = :a AND letra = :letra`, { letra: f.referencia.split(' ')[1] })) as [{ ultimo: number }];

    const res = await cobrar({ socioId: d.socio_id, aplicaciones: [{ comprobanteId: f.id, importe: f.saldo }], recibido });
    expect(res.status).toBe(201);
    primerRecibo = res.body.data;
    expect(primerRecibo).toMatchObject({
      numero: ultimo + 1,
      medio: 'efectivo',
      origen: 'mostrador',
      estado: 'acreditado',
      importe: f.saldo,
      recibido,
      vuelto: deCentavos(aCentavos(recibido) - aCentavos(f.saldo)),
      titular: { numero: d.numero, nombre: d.nombre },
      socio: { id: d.socio_id },
      concepto: '1 factura',
      aplicaciones: [{ comprobanteId: f.id, referencia: f.referencia, importe: f.saldo, saldoDespues: '0.00' }],
      items: [],
      anulacion: null,
    });
    expect(primerRecibo.referencia).toMatch(/^Rcbo [AB] 0001-\d{8}$/);
    expect(await factura(f.id)).toMatchObject({ estado: 'pagado', saldo: '0.00' });
    expect((await cuenta(d.socio_id)).pendientes.map((p) => p.id)).not.toContain(f.id);
    expect((await estado()).caja).toMatchObject({ cobros: 1, total: f.saldo, efectivoEsperado: suma('20000.00', f.saldo) });
    const registro = await runInCooperativa(w.a.id, () => Auditoria.findAll({ where: { accion: 'cobrar', entidadId: String(primerRecibo.id) } }));
    expect(registro).toHaveLength(1);
    expect((registro[0]!.despuesJson as { recibo: string }).recibo).toBe(primerRecibo.referencia);
  });

  it('el mismo pedido repetido (doble Enter) no cobra dos veces', async () => {
    const d = await deudor();
    const f = (await cuenta(d.socio_id)).pendientes[0]!;
    const pedido = { clave: randomUUID(), socioId: d.socio_id, aplicaciones: [{ comprobanteId: f.id, importe: f.saldo }], items: [], medio: 'efectivo' };
    const [uno, dos] = await Promise.all([caja.post(`${api}/cobros`).send(pedido), caja.post(`${api}/cobros`).send(pedido)]);
    expect([uno.status, dos.status].sort()).toEqual([200, 201]);
    expect(uno.body.data.id).toBe(dos.body.data.id);
    const otra = await caja.post(`${api}/cobros`).send(pedido);
    expect(otra.status).toBe(200);
    expect(otra.body.data.id).toBe(uno.body.data.id);
    expect(await runInCooperativa(w.a.id, () => Pago.count({ where: { clave: pedido.clave } }))).toBe(1);
    // Sin decir con cuánto paga, es pago justo.
    expect(uno.body.data).toMatchObject({ recibido: f.saldo, vuelto: '0.00' });
  });

  it('pago parcial: baja el saldo y la factura se sigue debiendo; después se cancela con otro medio', async () => {
    const d = await deudor();
    const f = (await cuenta(d.socio_id)).pendientes.find((p) => p.saldo === p.total)!;
    const parte = deCentavos(Math.floor(aCentavos(f.saldo) / 3));
    const resto = deCentavos(aCentavos(f.saldo) - aCentavos(parte));

    const parcial = await cobrar({ socioId: d.socio_id, aplicaciones: [{ comprobanteId: f.id, importe: parte }] });
    expect(parcial.status).toBe(201);
    expect(parcial.body.data.aplicaciones[0]).toMatchObject({ importe: parte, saldoDespues: resto });
    expect(await factura(f.id)).toMatchObject({ estado: 'emitido', saldo: resto });
    expect((await cuenta(d.socio_id)).pendientes.find((p) => p.id === f.id)).toMatchObject({ saldo: resto, total: f.total });

    const final = await cobrar({ socioId: d.socio_id, aplicaciones: [{ comprobanteId: f.id, importe: resto }], medio: 'debito', referencia: 'Cupón 4471' });
    expect(final.status).toBe(201);
    expect(final.body.data).toMatchObject({ medio: 'debito', recibido: null, vuelto: null, referenciaPago: 'Cupón 4471' });
    expect(await factura(f.id)).toMatchObject({ estado: 'pagado', saldo: '0.00' });
    expect((await cuenta(d.socio_id)).ultimosPagos.map((p) => p.id).slice(0, 2)).toEqual([final.body.data.id, parcial.body.data.id]);
  });

  it('varias facturas en un solo cobro', async () => {
    const d = await deudor(2);
    const { pendientes } = await cuenta(d.socio_id);
    const dos = pendientes.slice(0, 2);
    const res = await cobrar({ socioId: d.socio_id, aplicaciones: dos.map((p) => ({ comprobanteId: p.id, importe: p.saldo })), medio: 'transferencia' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ importe: suma(...dos.map((p) => p.saldo)), concepto: '2 facturas' });
    for (const p of dos) expect(await factura(p.id)).toMatchObject({ estado: 'pagado' });
  });

  it('no cobra de más, ni con efectivo que no alcanza, ni facturas de otro socio, ni lo ya pagado, ni nada', async () => {
    const d = await deudor();
    const f = (await cuenta(d.socio_id)).pendientes[0]!;
    const [otroSocio] = await sql<{ id: number }>(`SELECT id FROM socios WHERE cooperativa_id = :a AND id <> :id ORDER BY id LIMIT 1`, { id: d.socio_id });
    const antes = await runInCooperativa(w.a.id, () => Pago.count());

    const deMas = await cobrar({ socioId: d.socio_id, aplicaciones: [{ comprobanteId: f.id, importe: suma(f.saldo, '0.01') }] });
    expect(deMas.status).toBe(409);
    expect(deMas.body.error.message).toMatch(/no se puede cobrar/);

    const noAlcanza = await cobrar({ socioId: d.socio_id, aplicaciones: [{ comprobanteId: f.id, importe: f.saldo }], recibido: '1.00' });
    expect(noAlcanza.status).toBe(409);
    expect(noAlcanza.body.error.message).toMatch(/no alcanza/);

    const deOtro = await cobrar({ socioId: otroSocio!.id, aplicaciones: [{ comprobanteId: f.id, importe: f.saldo }] });
    expect(deOtro.status).toBe(409);
    expect(deOtro.body.error.message).toMatch(/no es de este socio/);

    const yaPaga = await cobrar({ socioId: primerRecibo.socio!.id, aplicaciones: [{ comprobanteId: primerRecibo.aplicaciones[0]!.comprobanteId, importe: '1.00' }] });
    expect(yaPaga.status).toBe(409);
    expect(yaPaga.body.error.message).toMatch(/ya está pagada/);

    expect((await cobrar({ socioId: d.socio_id })).status).toBe(400);
    expect((await cobrar({ socioId: null, aplicaciones: [{ comprobanteId: f.id, importe: f.saldo }] })).status).toBe(400);
    expect((await cobrar({ socioId: d.socio_id, aplicaciones: [{ comprobanteId: f.id, importe: '0' }] })).status).toBe(409);
    expect((await cobrar({ socioId: d.socio_id, aplicaciones: [{ comprobanteId: f.id, importe: f.saldo }], medio: 'cheque' })).status).toBe(400);
    expect((await cobrar({ socioId: d.socio_id, aplicaciones: [{ comprobanteId: f.id, importe: f.saldo }], clave: 'no-es-una-clave' })).status).toBe(400);

    expect(await runInCooperativa(w.a.id, () => Pago.count())).toBe(antes);
    expect(await factura(f.id)).toMatchObject({ estado: 'emitido', saldo: f.saldo });
  });

  it('dos cajeros cobrando la misma factura a la vez: cobra uno solo', async () => {
    expect((await caja2.post(`${api}/abrir`).send({ fondoInicial: '10000' })).status).toBe(201);
    const d = await deudor();
    const f = (await cuenta(d.socio_id)).pendientes[0]!;
    const pedido = { socioId: d.socio_id, aplicaciones: [{ comprobanteId: f.id, importe: f.saldo }] };
    const [uno, dos] = await Promise.all([cobrar(pedido, caja), cobrar(pedido, caja2)]);
    expect([uno.status, dos.status].sort()).toEqual([201, 409]);
    expect(await factura(f.id)).toMatchObject({ estado: 'pagado', saldo: '0.00' });
    const [r] = await sql<{ n: string }>(`SELECT count(*) AS n FROM pago_aplicaciones WHERE comprobante_id = :id`, { id: f.id });
    expect(r!.n).toBe('1');
  });

  it('venta de mostrador: gas y otros conceptos, con o sin socio, y descuenta el stock', async () => {
    const productos: ProductoVenta[] = (await caja.get(`${api}/productos`)).body.data;
    const garrafa = productos.find((p) => p.nombre.startsWith('Garrafa'))!;
    const reconexion = productos.find((p) => p.stock === null)!;
    expect(garrafa).toMatchObject({ precio: '18500.00', stock: 5 });

    const sinSocio = await cobrar({ items: [{ productoId: garrafa.id, cantidad: 2 }], recibido: '40000' });
    expect(sinSocio.status).toBe(201);
    expect(sinSocio.body.data).toMatchObject({
      socio: null,
      titular: null,
      importe: '37000.00',
      vuelto: '3000.00',
      concepto: '2 × Garrafa de 10 kg',
      items: [{ descripcion: 'Garrafa de 10 kg', cantidad: 2, unitario: '18500.00', importe: '37000.00' }],
    });
    expect(sinSocio.body.data.referencia).toMatch(/^Rcbo B /);

    // Junto con una factura, en el mismo recibo.
    const d = await deudor();
    const f = (await cuenta(d.socio_id)).pendientes[0]!;
    const mixto = await cobrar({ socioId: d.socio_id, aplicaciones: [{ comprobanteId: f.id, importe: f.saldo }], items: [{ productoId: garrafa.id, cantidad: 1 }, { productoId: reconexion.id, cantidad: 1 }], medio: 'qr' });
    expect(mixto.status).toBe(201);
    expect(mixto.body.data).toMatchObject({ importe: suma(f.saldo, '18500.00', '12000.00'), concepto: '1 factura + Garrafa de 10 kg, Reconexión del servicio' });

    const despues: ProductoVenta[] = (await caja.get(`${api}/productos`)).body.data;
    expect(despues.find((p) => p.id === garrafa.id)!.stock).toBe(2);
    expect(despues.find((p) => p.id === reconexion.id)!.stock).toBeNull();

    const sinStock = await cobrar({ items: [{ productoId: garrafa.id, cantidad: 3 }] });
    expect(sinStock.status).toBe(409);
    expect(sinStock.body.error.message).toBe('De Garrafa de 10 kg quedan 2, no 3');
    expect((await cobrar({ items: [{ productoId: 999999, cantidad: 1 }] })).status).toBe(409);
  });

  it('el recibo se imprime como ticket de 80 mm o en A4', async () => {
    const ticket = await caja.get(`${api}/cobros/${primerRecibo.id}/recibo`).buffer(true).parse((res, cb) => {
      const partes: Buffer[] = [];
      res.on('data', (p: Buffer) => partes.push(p));
      res.on('end', () => cb(null, Buffer.concat(partes)));
    });
    expect(ticket.status).toBe(200);
    expect(ticket.headers['content-type']).toBe('application/pdf');
    expect((ticket.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    // 80 mm de ancho = 226,77 puntos.
    expect((ticket.body as Buffer).toString('latin1')).toMatch(/MediaBox \[0 0 226\.77 \d+/);

    const a4 = await caja.get(`${api}/cobros/${primerRecibo.id}/recibo?formato=a4`).buffer(true).parse((res, cb) => {
      const partes: Buffer[] = [];
      res.on('data', (p: Buffer) => partes.push(p));
      res.on('end', () => cb(null, Buffer.concat(partes)));
    });
    expect(a4.status).toBe(200);
    expect((a4.body as Buffer).toString('latin1')).toMatch(/MediaBox \[0 0 595\.28 841\.89\]/);
    expect((await caja.get(`${api}/cobros/${primerRecibo.id}/recibo?formato=carta`)).status).toBe(400);
    expect((await caja.get(`${api}/cobros/999999/recibo`)).status).toBe(404);
  });
});

describe('anular un cobro', () => {
  it('solo administración, con motivo: la factura vuelve a deberse y queda en auditoría', async () => {
    const d = await deudor();
    const f = (await cuenta(d.socio_id)).pendientes[0]!;
    const productos: ProductoVenta[] = (await caja.get(`${api}/productos`)).body.data;
    const garrafa = productos.find((p) => p.nombre.startsWith('Garrafa'))!;
    const cobro = await cobrar({ socioId: d.socio_id, aplicaciones: [{ comprobanteId: f.id, importe: f.saldo }], items: [{ productoId: garrafa.id, cantidad: 1 }] });
    expect(cobro.status).toBe(201);
    const id: number = cobro.body.data.id;
    const antes = (await estado()).caja!;

    expect((await caja.post(`${api}/cobros/${id}/anular`).send({ motivo: 'Me equivoqué de socio' })).status).toBe(403);
    expect((await gerencia.post(`${api}/cobros/${id}/anular`).send({ motivo: 'Me equivoqué de socio' })).status).toBe(403);
    const sinMotivo = await admin.post(`${api}/cobros/${id}/anular`).send({ motivo: ' ' });
    expect(sinMotivo.status).toBe(400);
    expect(sinMotivo.body.error.fields.motivo).toBeTruthy();

    const res = await admin.post(`${api}/cobros/${id}/anular`).send({ motivo: 'Se cobró al socio equivocado' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ estado: 'anulado', anulacion: { motivo: 'Se cobró al socio equivocado', por: 'Persona admin' } });
    expect(await factura(f.id)).toMatchObject({ estado: 'emitido', saldo: f.saldo });
    expect(((await caja.get(`${api}/productos`)).body.data as ProductoVenta[]).find((p) => p.id === garrafa.id)!.stock).toBe(garrafa.stock);

    // El efectivo esperado de la caja abierta ya no cuenta ese cobro.
    const despues = (await estado()).caja!;
    expect(despues).toMatchObject({ cobros: antes.cobros - 1, anulados: antes.anulados + 1 });
    expect(despues.efectivoEsperado).toBe(deCentavos(aCentavos(antes.efectivoEsperado) - aCentavos(cobro.body.data.importe)));

    const [registro] = await runInCooperativa(w.a.id, () => Auditoria.findAll({ where: { accion: 'anular_cobro', entidadId: String(id) } }));
    expect(registro).toMatchObject({ usuarioId: w.adminA.id, despuesJson: { estado: 'anulado', motivo: 'Se cobró al socio equivocado' } });

    expect((await admin.post(`${api}/cobros/${id}/anular`).send({ motivo: 'Otra vez lo mismo' })).status).toBe(409);
    expect((await admin.post(`${api}/cobros/999999/anular`).send({ motivo: 'No existe ese cobro' })).status).toBe(404);
    // El recibo anulado se puede volver a ver, y la factura se puede cobrar de nuevo.
    expect((await caja.get(`${api}/cobros/${id}`)).body.data.estado).toBe('anulado');
    expect((await cobrar({ socioId: d.socio_id, aplicaciones: [{ comprobanteId: f.id, importe: f.saldo }], medio: 'credito' })).status).toBe(201);
  });
});

describe('recargo por pago fuera de término', () => {
  it('lo que se pagó vencido trae su interés en la factura siguiente, contado hasta el día del pago', async () => {
    // Las facturas cobradas hoy en estos tests estaban todas vencidas.
    const pagadas = await sql<{ servicio_conexion_id: number; numero: number; importe: string }>(
      `SELECT c.servicio_conexion_id, c.numero, a.importe FROM pago_aplicaciones a
       JOIN pagos p ON p.id = a.pago_id AND p.estado = 'acreditado' AND p.origen = 'mostrador' AND p.caja_id IN (SELECT id FROM cajas WHERE cerrada_el IS NULL)
       JOIN comprobantes c ON c.id = a.comprobante_id WHERE a.cooperativa_id = :a`,
    );
    expect(pagadas.length).toBeGreaterThan(5);
    await runInCooperativa(w.a.id, () => calcularPrefacturas({ anio: ANIO, mes: MES, fechaEmision: HOY }));
    const recargos = await sql<{ servicio_conexion_id: number; descripcion: string; base: string; nota: string; importe: string }>(
      `SELECT c.servicio_conexion_id, r.descripcion, r.base, r.nota, r.importe FROM comprobante_renglones r
       JOIN comprobantes c ON c.id = r.comprobante_id AND c.estado = 'borrador' AND c.anio = :anio AND c.mes = :mes
       WHERE r.cooperativa_id = :a AND r.codigo = 'MORA' AND r.descripcion LIKE 'Recargo por pago fuera de término%'`,
      { anio: ANIO, mes: MES },
    );
    const dia = `${HOY.slice(8, 10)}/${HOY.slice(5, 7)}/${HOY.slice(0, 4)}`;
    for (const p of pagadas) {
      const r = recargos.find((x) => x.servicio_conexion_id === p.servicio_conexion_id && x.descripcion.includes(String(p.numero).padStart(8, '0')) && Number(x.base) === Number(p.importe));
      expect(r, `falta el recargo de la factura ${p.numero}`).toBeDefined();
      expect(Number(r!.importe)).toBeGreaterThan(0);
      expect(r!.nota).toContain(`se pagó el ${dia}`);
    }
    // Lo anulado no cuenta como pago: esa factura sigue como deuda, no como pago tardío.
    expect(recargos.length).toBe(pagadas.length);
    await sql(`DELETE FROM comprobantes WHERE cooperativa_id = :a AND estado = 'borrador' RETURNING id`);
  });
});

describe('cerrar la caja con arqueo', () => {
  it('si lo contado no coincide, pide explicar la diferencia', async () => {
    const abierta = (await estado()).caja!;
    const falta = deCentavos(aCentavos(abierta.efectivoEsperado) - 50_000);
    const res = await caja.post(`${api}/cerrar`).send({ contado: falta });
    expect(res.status).toBe(400);
    expect(res.body.error.fields.nota).toMatch(/^Faltan \$ 500,00/);
    expect((await caja.post(`${api}/cerrar`).send({ contado: 'mucho' })).status).toBe(400);
    expect((await estado()).caja).not.toBeNull();

    const conNota = await caja2.post(`${api}/cerrar`).send({ contado: deCentavos(aCentavos((await estado(caja2)).caja!.efectivoEsperado) + 20_000), nota: 'Sobraron $200: vuelto mal dado' });
    expect(conNota.status).toBe(200);
    expect(conNota.body.data).toMatchObject({ diferencia: '200.00', nota: 'Sobraron $200: vuelto mal dado' });
  });

  it('esperado = fondo + efectivo cobrado; al cerrar ya no se cobra, y se puede abrir otra', async () => {
    const abierta = (await estado()).caja!;
    const efectivo = abierta.porMedio.find((m) => m.medio === 'efectivo')!;
    expect(abierta.efectivoEsperado).toBe(suma(abierta.fondoInicial, efectivo.total));
    expect(abierta.total).toBe(suma(...abierta.porMedio.map((m) => m.total)));
    expect(abierta.porMedio.filter((m) => m.cantidad > 0).map((m) => m.medio).sort()).toEqual(['credito', 'debito', 'efectivo', 'qr', 'transferencia']);

    const res = await caja.post(`${api}/cerrar`).send({ contado: abierta.efectivoEsperado });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: abierta.id, contado: abierta.efectivoEsperado, diferencia: '0.00', nota: null });
    expect(res.body.data.cerradaEl).not.toBeNull();
    expect((await estado()).caja).toBeNull();
    expect((await caja.post(`${api}/cerrar`).send({ contado: '0' })).status).toBe(409);
    expect((await cobrar({ items: [{ productoId: 1, cantidad: 1 }] })).status).toBe(409);
    expect(await runInCooperativa(w.a.id, () => Auditoria.count({ where: { accion: 'cerrar_caja', entidadId: String(abierta.id) } }))).toBe(1);

    // Anular un cobro de una caja ya cerrada no cambia su arqueo.
    const detalle: CajaDetalle = (await admin.get(`${api}/cajas/${abierta.id}`)).body.data;
    const enEfectivo = detalle.pagos.find((p) => p.medio === 'efectivo' && p.estado === 'acreditado')!;
    expect((await admin.post(`${api}/cobros/${enEfectivo.id}/anular`).send({ motivo: 'Billete falso detectado al depositar' })).status).toBe(200);
    expect((await admin.get(`${api}/cajas/${abierta.id}`)).body.data).toMatchObject({ efectivoEsperado: abierta.efectivoEsperado, diferencia: '0.00', anulados: detalle.anulados + 1 });

    expect((await caja.post(`${api}/abrir`).send({ fondoInicial: '15000.50' })).status).toBe(201);
    expect((await estado()).caja).toMatchObject({ fondoInicial: '15000.50', cobros: 0 });
  });

  it('el cajero ve sus cajas; administración y gerencia, las de todos', async () => {
    const propias: PaginaCajas = (await caja2.get(`${api}/cajas`)).body.data;
    expect(propias.total).toBeGreaterThan(0);
    expect(new Set(propias.filas.map((c) => c.cajero.nombre))).toEqual(new Set(['Persona caja2']));

    const todas: PaginaCajas = (await gerencia.get(`${api}/cajas`)).body.data;
    expect(todas.total).toBeGreaterThan(propias.total);
    // Primero la que está abierta.
    expect(todas.filas[0]).toMatchObject({ cerradaEl: null, cajero: { nombre: 'Persona caja' } });
    expect(new Set(todas.filas.map((c) => c.cajero.nombre)).size).toBeGreaterThan(1);

    const ajena = todas.filas.find((c) => c.cajero.nombre === 'Persona caja' && c.cerradaEl !== null)!;
    expect((await caja2.get(`${api}/cajas/${ajena.id}`)).status).toBe(403);
    const detalle: CajaDetalle = (await gerencia.get(`${api}/cajas/${ajena.id}`)).body.data;
    expect(detalle.pagos.length).toBe(detalle.cobros + detalle.anulados);
    expect((await gerencia.get(`${api}/cajas/999999`)).status).toBe(404);
  });
});

describe('aislamiento', () => {
  it('la cooperativa B no ve ni toca las cajas, los cobros ni los socios de A', async () => {
    const [pagoA] = await sql<{ id: number; caja_id: number }>(`SELECT id, caja_id FROM pagos WHERE cooperativa_id = :a AND caja_id IS NOT NULL ORDER BY id DESC LIMIT 1`);
    expect((await adminB.get(`${api}/cobros/${pagoA!.id}`)).status).toBe(404);
    expect((await adminB.get(`${api}/cobros/${pagoA!.id}/recibo`)).status).toBe(404);
    expect((await adminB.post(`${api}/cobros/${pagoA!.id}/anular`).send({ motivo: 'No es de mi cooperativa' })).status).toBe(404);
    expect((await adminB.get(`${api}/cajas/${pagoA!.caja_id}`)).status).toBe(404);
    const d = await deudor();
    expect((await adminB.get(`${api}/socios/${d.socio_id}`)).status).toBe(404);
    expect((await adminB.get(`${api}/cajas`)).body.data.total).toBe(0);
    expect((await adminB.get(`${api}/productos`)).body.data).toEqual([]);

    // Con su propia caja abierta, tampoco puede cobrar una factura ni vender un producto de A.
    expect((await adminB.post(`${api}/abrir`).send({ fondoInicial: '0' })).status).toBe(201);
    const f = (await cuenta(d.socio_id)).pendientes[0]!;
    expect((await cobrar({ socioId: d.socio_id, aplicaciones: [{ comprobanteId: f.id, importe: f.saldo }] }, adminB)).status).toBe(404);
    const [socioB] = await sql<{ id: number }>(`SELECT id FROM socios WHERE cooperativa_id = :b LIMIT 1`);
    expect((await cobrar({ socioId: socioB!.id, aplicaciones: [{ comprobanteId: f.id, importe: f.saldo }] }, adminB)).status).toBe(409);
    const [productoA] = await sql<{ id: number }>(`SELECT id FROM productos WHERE cooperativa_id = :a LIMIT 1`);
    expect((await cobrar({ items: [{ productoId: productoA!.id, cantidad: 1 }] }, adminB)).status).toBe(409);
    expect(await factura(f.id)).toMatchObject({ estado: 'emitido', saldo: f.saldo });
  });
});

describe('integridad', () => {
  it('cada cobro y cada anulación de estas pruebas quedó encadenado: la verificación da en orden', async () => {
    for (const coop of [w.a, w.b]) {
      const r = await runInCooperativa(coop.id, verificarIntegridad);
      expect(r.problemas).toEqual([]);
    }
  });
});
