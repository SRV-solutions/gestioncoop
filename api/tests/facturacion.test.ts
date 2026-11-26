// Fase 4: historial de facturas de prueba y el recorrido completo del mes por la API
// —controlar la lectura, cerrarla, pre-facturar, revisar, emitir—, más PDF, nota de crédito y aislamiento.
import { randomUUID } from 'node:crypto';
import { QueryTypes } from 'sequelize';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  codigoDeBarras,
  leerCodigoDeBarras,
  letraDe,
  referenciaComprobante,
  type ComprobanteDetalle,
  type EstadoFacturacion,
  type PaginaComprobantes,
  type RutaDetalle,
} from '../src/shared';
import { sequelize } from '../src/db';
import { runInCooperativa } from '../src/lib/context';
import { esperarProcesos, reservarNumeros } from '../src/lib/facturacion';
import { hoy } from '../src/lib/tarifas';
import { Auditoria, Comprobante, Notificacion, Periodo, ServicioConexionModel } from '../src/models';
import { sumarDias } from '../src/motor';
import { callesInventadas } from '../src/seed/calles-inventadas';
import { cargarFacturas } from '../src/seed/cargar-facturas';
import { cargarLecturas } from '../src/seed/cargar-lecturas';
import { cargarPadron } from '../src/seed/cargar-padron';
import { cargarTarifas } from '../src/seed/cargar-tarifas';
import { generarPadron, PLANES } from '../src/seed/generar-padron';
import { TARIFAS_ARROYO_DEL_MONTE } from '../src/seed/tarifas';
import { createUser, loginAs, resetWorld } from './helpers';

const api = '/api/v1/facturacion';
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
let oficina: Agente;
let gerencia: Agente;
let admin: Agente;
let operario: Agente;

const estado = async (agente: Agente = oficina): Promise<EstadoFacturacion> => (await agente.get(`${api}/estado`)).body.data;
const lista = async (params: string, agente: Agente = oficina): Promise<PaginaComprobantes> => (await agente.get(`${api}/comprobantes?${params}`)).body.data;
const detalle = async (id: number): Promise<ComprobanteDetalle> => (await oficina.get(`${api}/comprobantes/${id}`)).body.data;
const sql = <T extends object>(texto: string, replacements: Record<string, unknown> = {}) =>
  sequelize.query<T>(texto, { replacements: { a: w.a.id, b: w.b.id, anio: ANIO, mes: MES, ...replacements }, type: QueryTypes.SELECT });
/** Lanza un trabajo en segundo plano y espera a que termine. */
const correr = async (ruta: 'prefacturar' | 'emitir', agente: Agente = oficina) => {
  const res = await agente.post(`${api}/${ruta}`);
  await esperarProcesos();
  return res;
};

beforeAll(async () => {
  w = await resetWorld();
  for (const [coop, sufijo, semilla] of [[w.a, 'a', 7], [w.b, 'b', 8]] as const) {
    await createUser({ cooperativaId: coop.id, email: `operario@${sufijo}.test`, roles: ['operario'] });
    await cargarPadron(generarPadron(callesInventadas(), { hogares: 40, semilla }), { cooperativaId: coop.id, planes: PLANES_PRUEBA });
    await cargarTarifas(coop.id, TARIFAS_ARROYO_DEL_MONTE);
    await cargarLecturas(coop.id, { hoy: HOY, semilla, avance: [0.5, 0] });
    await cargarFacturas(coop.id, { semilla });
  }
  await createUser({ cooperativaId: w.a.id, email: 'facturacion@a.test', roles: ['facturacion'] });
  oficina = await loginAs('facturacion@a.test');
  gerencia = await loginAs('demo@a.test');
  admin = await loginAs('admin@a.test');
  operario = await loginAs('operario@a.test');
}, 120_000);
afterAll(async () => {
  await esperarProcesos();
  await sequelize.close();
});

describe('código de barras', () => {
  const datos = { cooperativaId: 12, id: 4567, venceEl: '2026-12-03', total: '161724.49' };

  it('lleva cooperativa, comprobante, vencimiento e importe, y se puede volver a leer', () => {
    const codigo = codigoDeBarras(datos);
    expect(codigo).toMatch(/^\d{32}$/);
    expect(codigo.slice(0, 31)).toBe('00012' + '0000004567' + '261203' + '0016172449');
    expect(leerCodigoDeBarras(codigo)).toEqual({ cooperativaId: 12, id: 4567 });
    expect(leerCodigoDeBarras(`${codigo.slice(0, 16)} ${codigo.slice(16)}`)).toEqual({ cooperativaId: 12, id: 4567 });
  });

  it('un dígito mal leído no pasa', () => {
    const codigo = codigoDeBarras(datos);
    const cambiado = codigo.slice(0, 10) + String((Number(codigo[10]) + 1) % 10) + codigo.slice(11);
    expect(leerCodigoDeBarras(cambiado)).toBeNull();
    expect(leerCodigoDeBarras('1234')).toBeNull();
  });

  it('la letra sale de la condición frente al IVA', () => {
    expect(letraDe('responsable_inscripto')).toBe('A');
    expect(letraDe('consumidor_final')).toBe('B');
    expect(letraDe('monotributo')).toBe('B');
    expect(referenciaComprobante({ tipo: 'factura', letra: 'B', puntoVenta: 6, numero: 2043619 })).toBe('Fact B 0006-02043619');
    expect(referenciaComprobante({ tipo: 'factura', letra: 'B', puntoVenta: 6, numero: null })).toBe('Pre-factura');
  });
});

describe('historial de prueba', () => {
  it('deja 12 meses emitidos, sin borradores, y no se carga dos veces', async () => {
    const [r] = await sql<{ meses: string; facturas: string; borradores: string }>(
      `SELECT count(DISTINCT anio * 12 + mes) AS meses, count(*) AS facturas, count(*) FILTER (WHERE estado = 'borrador') AS borradores FROM comprobantes WHERE cooperativa_id = :a`,
    );
    expect(Number(r!.meses)).toBe(12);
    expect(Number(r!.facturas)).toBeGreaterThan(12 * 40);
    expect(Number(r!.borradores)).toBe(0);
    expect(await cargarFacturas(w.a.id, { semilla: 7 })).toBeNull();
  });

  it('en cada comprobante, la suma de los renglones es igual al total', async () => {
    const [r] = await sql<{ n: string }>(
      `SELECT count(*) AS n FROM comprobantes c WHERE c.total <> COALESCE((SELECT sum(importe) FROM comprobante_renglones r WHERE r.comprobante_id = c.id), 0)`,
    );
    expect(Number(r!.n)).toBe(0);
  });

  it('la numeración es correlativa y sin huecos, por cooperativa y letra', async () => {
    const filas = await sql<{ n: string; desde: number; hasta: number }>(
      `SELECT count(*) AS n, min(numero) AS desde, max(numero) AS hasta FROM comprobantes WHERE tipo = 'factura' GROUP BY cooperativa_id, letra`,
    );
    expect(filas.length).toBeGreaterThanOrEqual(2);
    for (const f of filas) {
      expect(f.desde).toBe(1);
      expect(f.hasta).toBe(Number(f.n));
    }
  });

  it('hay socios con deuda, y sus facturas siguientes traen el interés por mora', async () => {
    const [deuda] = await sql<{ socios: string }>(`SELECT count(DISTINCT socio_id) AS socios FROM comprobantes WHERE cooperativa_id = :a AND estado = 'emitido'`);
    expect(Number(deuda!.socios)).toBeGreaterThan(0);
    const [mora] = await sql<{ n: string }>(
      `SELECT count(*) AS n FROM comprobante_renglones r JOIN comprobantes c ON c.id = r.comprobante_id WHERE c.cooperativa_id = :a AND r.codigo = 'MORA' AND r.importe > 0`,
    );
    expect(Number(mora!.n)).toBeGreaterThan(0);
    // Lo pagado quedó con saldo cero; lo impago, con el saldo igual al total.
    const [mal] = await sql<{ n: string }>(
      `SELECT count(*) AS n FROM comprobantes WHERE (estado = 'pagado' AND saldo <> 0) OR (estado = 'emitido' AND saldo <> total)`,
    );
    expect(Number(mal!.n)).toBe(0);
  });
});

describe('dos emisiones a la vez', () => {
  it('nunca reciben el mismo número', async () => {
    const clave = { tipo: 'recibo' as const, letra: 'B', puntoVenta: 9 };
    const primeros = await runInCooperativa(w.a.id, () =>
      Promise.all([1, 2, 3, 4].map(() => sequelize.transaction((t) => reservarNumeros(clave, 5, t)))),
    );
    expect([...primeros].sort((x, y) => x - y)).toEqual([1, 6, 11, 16]);
  });
});

describe('permisos', () => {
  it('caja y operarios no entran; gerencia mira pero no opera', async () => {
    expect((await (await loginAs('caja@a.test')).get(`${api}/estado`)).status).toBe(403);
    expect((await operario.get(`${api}/estado`)).status).toBe(403);
    expect((await gerencia.get(`${api}/estado`)).status).toBe(200);
    expect((await gerencia.post(`${api}/prefacturar`)).status).toBe(403);
    expect((await gerencia.post(`${api}/emitir`)).status).toBe(403);
    expect((await gerencia.post(`${api}/reabrir`)).status).toBe(403);
  });
});

describe('paso 2: controlar la lectura', () => {
  it('con medidores sin leer no deja cerrar', async () => {
    const e = await estado();
    expect(e.mes).toEqual({ anio: ANIO, mes: MES, estado: 'en_lectura' });
    expect(e.control!.estimables).toBeGreaterThan(0);
    expect(e.control!.bloqueantes).toBe(e.control!.estimables + e.control!.sinResolver);
    expect(e.prefactura).toBeNull();
    const res = await oficina.post(`${api}/prefacturar`);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/faltan \d+ medidores/);
  });

  it('una lectura menor a la anterior sin motivo queda para resolver', async () => {
    const mias = (await operario.get('/api/v1/lecturas/mis-rutas')).body.data.rutas as { id: number }[];
    const ruta: RutaDetalle = (await operario.get(`/api/v1/lecturas/rutas/${mias[0]!.id}`)).body.data;
    const m = ruta.lista.flatMap((c) => c.medidores).find((x) => x.lectura === null && x.anterior !== null && x.anterior.valor > 50)!;
    const envio = await operario.post('/api/v1/lecturas/sync').send({
      lecturas: [{ uuid: randomUUID(), periodoId: m.periodoId, medidorId: m.medidorId, valor: m.anterior!.valor - 40, tomadaEl: new Date().toISOString() }],
    });
    expect(envio.body.data.resultados[0]).toMatchObject({ estado: 'guardada', anomalia: 'lectura_menor' });
    expect((await estado()).control!.sinResolver).toBe(1);

    const [fila] = await sql<{ id: number }>(`SELECT id FROM lecturas WHERE cooperativa_id = :a AND medidor_id = :medidor AND periodo_id = :periodo`, { medidor: m.medidorId, periodo: m.periodoId });
    expect((await gerencia.post(`/api/v1/lecturas/${fila!.id}/motivo`).send({ motivo: 'cambio_medidor' })).status).toBe(403);
    const res = await oficina.post(`/api/v1/lecturas/${fila!.id}/motivo`).send({ motivo: 'cambio_medidor' });
    expect(res.status).toBe(200);
    // Medidor nuevo: arranca de cero, el consumo es lo que marca.
    expect(res.body.data.consumo).toBe((m.anterior!.valor - 40) * m.factor);
    expect((await estado()).control!.sinResolver).toBe(0);
  });

  it('estima de una vez todo lo que falta y tiene historial', async () => {
    const antes = (await estado()).control!;
    const res = await oficina.post('/api/v1/lecturas/estimar-pendientes');
    expect(res.status).toBe(200);
    expect(res.body.data.estimadas).toBe(antes.estimables);
    const despues = (await estado()).control!;
    expect(despues).toMatchObject({ estimables: 0, bloqueantes: 0 });
    expect(despues.estimadas).toBe(antes.estimadas + antes.estimables);
    expect(despues.leidos).toBe(despues.total - despues.sinHistorial);
  });
});

describe('paso 3: pre-facturar', () => {
  it('cierra la lectura y calcula todas las pre-facturas en segundo plano', async () => {
    const res = await correr('prefacturar');
    expect(res.status).toBe(202);
    expect(res.body.data).toMatchObject({ tipo: 'prefactura', estado: 'en_curso' });

    const e = await estado();
    expect(e.mes!.estado).toBe('prefacturado');
    expect(e.control).toBeNull();
    expect(e.proceso).toBeNull();
    expect(e.prefactura!.cantidad).toBeGreaterThan(40);
    expect(e.prefactura!.errores).toBe(0);
    expect(e.prefactura!.estimadas).toBeGreaterThan(0);
    expect(e.prefactura!.porServicio.map((s) => s.servicio)).toEqual(expect.arrayContaining(['energia', 'agua']));
    expect(e.emision).toBeNull();

    const [r] = await sql<{ n: string; numeradas: string; descuadradas: string }>(
      `SELECT count(*) AS n, count(numero) AS numeradas,
              count(*) FILTER (WHERE total <> COALESCE((SELECT sum(importe) FROM comprobante_renglones r WHERE r.comprobante_id = c.id), 0)) AS descuadradas
       FROM comprobantes c WHERE cooperativa_id = :a AND anio = :anio AND mes = :mes AND estado = 'borrador'`,
    );
    expect(Number(r!.n)).toBe(e.prefactura!.cantidad);
    expect(Number(r!.numeradas)).toBe(0);
    expect(Number(r!.descuadradas)).toBe(0);
  });

  it('con la lectura cerrada, el teléfono ya no puede cargar lecturas de ese mes', async () => {
    const [p] = await sql<{ id: number; medidor_id: number }>(
      `SELECT p.id, l.medidor_id FROM periodos p JOIN lecturas l ON l.periodo_id = p.id WHERE p.cooperativa_id = :a AND p.anio = :anio AND p.mes = :mes LIMIT 1`,
    );
    const res = await operario.post('/api/v1/lecturas/sync').send({
      lecturas: [{ uuid: randomUUID(), periodoId: p!.id, medidorId: p!.medidor_id, valor: 99, tomadaEl: new Date().toISOString() }],
    });
    expect(res.body.data.resultados[0]).toMatchObject({ estado: 'rechazada', error: 'La lectura de ese mes ya está cerrada' });
  });

  it('las estimadas salen marcadas y con su aviso', async () => {
    const pagina = await lista(`anio=${ANIO}&mes=${MES}&estado=borrador`);
    expect(pagina.total).toBeGreaterThan(0);
    const estimada = pagina.filas.find((f) => f.estimada) ?? (await lista(`anio=${ANIO}&mes=${MES}&estado=borrador&pagina=2`)).filas.find((f) => f.estimada)!;
    const d = await detalle(estimada.id);
    expect(d.referencia).toBe('Pre-factura');
    expect(d.numero).toBeNull();
    expect(d.calculo!.avisos.map((a) => a.codigo)).toContain('estimada');
    expect(d.lecturas.some((l) => l.tipo === 'estimada')).toBe(true);
    expect(d.codigoDeBarras).toBeNull();
  });

  it('las raras se pueden listar y marcar como revisadas', async () => {
    // Se fabrica una: la factura de un servicio pasa a compararse contra un mes anterior muy distinto.
    const [f] = await sql<{ id: number; total_servicio: string }>(
      `SELECT id, total_servicio FROM comprobantes WHERE cooperativa_id = :a AND anio = :anio AND mes = :mes AND estado = 'borrador' AND total > 0 ORDER BY id LIMIT 1`,
    );
    await sequelize.query(`UPDATE comprobantes SET rara = 'variacion', variacion = 180, total_anterior = total_servicio / 2.8 WHERE id = :id`, { replacements: { id: f!.id } });

    const antes = await estado();
    expect(antes.prefactura!.rarasSinRevisar).toBeGreaterThan(0);
    const porRevisar = await lista(`anio=${ANIO}&mes=${MES}&vista=por_revisar`);
    expect(porRevisar.filas.map((x) => x.id)).toContain(f!.id);
    expect(porRevisar.filas.every((x) => x.rara !== null && !x.revisada)).toBe(true);

    expect((await gerencia.post(`${api}/comprobantes/${f!.id}/revisar`)).status).toBe(403);
    expect((await oficina.post(`${api}/comprobantes/${f!.id}/revisar`)).status).toBe(200);
    expect((await estado()).prefactura!.rarasSinRevisar).toBe(antes.prefactura!.rarasSinRevisar - 1);
    expect((await lista(`anio=${ANIO}&mes=${MES}&vista=por_revisar`)).filas.map((x) => x.id)).not.toContain(f!.id);
    expect((await lista(`anio=${ANIO}&mes=${MES}&vista=raras`)).filas.map((x) => x.id)).toContain(f!.id);
  });

  it('el PDF de una pre-factura se puede ver antes de emitir', async () => {
    const { filas } = await lista(`anio=${ANIO}&mes=${MES}&estado=borrador&servicio=energia`);
    const res = await oficina.get(`${api}/comprobantes/${filas[0]!.id}/pdf`).responseType('blob');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('se puede reabrir la lectura: las pre-facturas se borran', async () => {
    const res = await oficina.post(`${api}/reabrir`);
    expect(res.status).toBe(200);
    const e = await estado();
    expect(e.mes!.estado).toBe('en_lectura');
    expect(e.prefactura).toBeNull();
    expect(await runInCooperativa(w.a.id, () => Comprobante.count({ where: { estado: 'borrador' } }))).toBe(0);
    expect((await oficina.post(`${api}/reabrir`)).status).toBe(409);
  });

  it('lo que no se puede calcular queda explicado y frena la emisión', async () => {
    // Un servicio de internet se queda sin plan: no hay con qué calcular su abono.
    const internet = await runInCooperativa(w.a.id, () => ServicioConexionModel.findOne({ where: { servicio: 'internet', estado: 'activo' } }));
    const planId = internet!.planId;
    await runInCooperativa(w.a.id, () => internet!.update({ planId: null }));

    await correr('prefacturar');
    const e = await estado();
    expect(e.prefactura!.errores).toBe(1);
    const conError = await lista(`anio=${ANIO}&mes=${MES}&vista=errores`);
    expect(conError.filas).toHaveLength(1);
    expect(conError.filas[0]!.error).toMatch(/no tiene un plan/);
    const emision = await oficina.post(`${api}/emitir`);
    expect(emision.status).toBe(409);
    expect(emision.body.error.message).toMatch(/no se pudo calcular/);

    // Se corrige y se vuelve a calcular (con el mes ya pre-facturado).
    await runInCooperativa(w.a.id, () => internet!.update({ planId }));
    expect((await correr('prefacturar')).status).toBe(202);
    expect((await estado()).prefactura!.errores).toBe(0);
  });

  it('no deja abrir el mes siguiente con este sin emitir', async () => {
    const { proximo } = await estado();
    const res = await oficina.post('/api/v1/lecturas/periodos').send(proximo);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/Primero hay que emitir/);
  });
});

describe('paso 4: emitir', () => {
  let antes: EstadoFacturacion;
  let ultimoB: number;

  it('numera todo siguiendo la numeración anterior, carga la deuda y avisa', async () => {
    antes = await estado();
    ultimoB = Number((await sql<{ n: number }>(`SELECT COALESCE(max(numero), 0) AS n FROM comprobantes WHERE cooperativa_id = :a AND tipo = 'factura' AND letra = 'B'`))[0]!.n);

    const res = await correr('emitir');
    expect(res.status).toBe(202);
    const e = await estado();
    expect(e.mes!.estado).toBe('emitido');
    expect(e.prefactura).toBeNull();
    expect(e.proceso).toBeNull();
    expect(e.emision).toMatchObject({ cantidad: antes.prefactura!.cantidad, total: antes.prefactura!.total, emitidaEl: HOY, venceEl: sumarDias(HOY, e.diasVencimiento), pendientes: 0 });
    const b = e.emision!.rangos.find((r) => r.letra === 'B')!;
    expect(b.desde).toBe(ultimoB + 1);

    const [r] = await sql<{ n: string; mal: string; desde: number; hasta: number }>(
      `SELECT count(*) AS n, min(numero) AS desde, max(numero) AS hasta,
              count(*) FILTER (WHERE NOT ((estado = 'emitido' AND saldo = total AND total > 0) OR (estado = 'pagado' AND total <= 0)) OR cae IS NULL) AS mal
       FROM comprobantes WHERE cooperativa_id = :a AND anio = :anio AND mes = :mes AND tipo = 'factura' AND letra = 'B'`,
    );
    expect(Number(r!.mal)).toBe(0);
    expect(r!.hasta - r!.desde + 1).toBe(Number(r!.n));

    const [conEmail] = await sql<{ n: string }>(
      `SELECT count(*) AS n FROM comprobantes c JOIN socios s ON s.id = c.socio_id AND s.email IS NOT NULL AND s.email <> ''
       WHERE c.cooperativa_id = :a AND c.anio = :anio AND c.mes = :mes AND c.estado = 'emitido'`,
    );
    expect(e.emision!.avisos).toBe(Number(conEmail!.n));
    expect(await runInCooperativa(w.a.id, () => Notificacion.count())).toBe(e.emision!.avisos);

    const periodos = await runInCooperativa(w.a.id, () => Periodo.findAll({ where: { anio: ANIO, mes: MES } }));
    expect(periodos.map((p) => p.estado)).toEqual(['emitido', 'emitido']);
    const auditoria = await runInCooperativa(w.a.id, () => Auditoria.findOne({ where: { accion: 'emitir' } }));
    expect(auditoria?.despuesJson).toMatchObject({ emitidas: antes.prefactura!.cantidad });
  });

  it('no se puede emitir dos veces', async () => {
    expect((await oficina.post(`${api}/emitir`)).status).toBe(409);
    expect((await oficina.post(`${api}/prefacturar`)).status).toBe(409);
    expect((await oficina.post(`${api}/reabrir`)).status).toBe(409);
  });

  it('quien debía de meses anteriores paga interés por mora en la factura nueva', async () => {
    const filas = await sql<{ id: number }>(
      `SELECT DISTINCT c.id FROM comprobantes c JOIN comprobante_renglones r ON r.comprobante_id = c.id AND r.codigo = 'MORA'
       WHERE c.cooperativa_id = :a AND c.anio = :anio AND c.mes = :mes LIMIT 1`,
    );
    expect(filas).toHaveLength(1);
    const d = await detalle(filas[0]!.id);
    const mora = d.calculo!.renglones.filter((r) => r.codigo === 'MORA');
    expect(mora.length).toBeGreaterThan(0);
    expect(Number(d.calculo!.totales.recargos)).toBeGreaterThan(0);
    const suma = d.calculo!.renglones.reduce((t, r) => t + Math.round(Number(r.importe) * 100), 0);
    expect(suma).toBe(Math.round(Number(d.total) * 100));
  });

  it('se busca por número de socio, por nombre y por número de comprobante', async () => {
    const { filas } = await lista(`anio=${ANIO}&mes=${MES}`);
    const una = filas[0]!;
    const porSocio = await lista(`q=${una.socio.numero}&anio=${ANIO}&mes=${MES}`);
    expect(porSocio.filas.length).toBeGreaterThan(0);
    expect(porSocio.filas.every((f) => f.socio.numero === una.socio.numero || f.numero === una.socio.numero)).toBe(true);
    const porNombre = await lista(`q=${encodeURIComponent(una.socio.nombre.split(',')[0]!.toUpperCase())}&anio=${ANIO}&mes=${MES}`);
    expect(porNombre.filas.map((f) => f.id)).toContain(una.id);
    const porNumero = await lista(`q=${encodeURIComponent(una.referencia.split(' ').pop()!)}`);
    expect(porNumero.filas.map((f) => f.id)).toContain(una.id);
  });

  it('el PDF de la factura emitida trae su número', async () => {
    const { filas } = await lista(`anio=${ANIO}&mes=${MES}&servicio=energia`);
    const d = await detalle(filas[0]!.id);
    expect(d.referencia).toMatch(/^Fact [AB] 0001-\d{8}$/);
    expect(leerCodigoDeBarras(d.codigoDeBarras!)).toEqual({ cooperativaId: w.a.id, id: d.id });
    const res = await oficina.get(`${api}/comprobantes/${d.id}/pdf`).responseType('blob');
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain(d.referencia.replace(/ /g, '-'));
    expect((res.body as Buffer).length).toBeGreaterThan(3000);
  });
});

describe('nota de crédito', () => {
  let facturaId: number;

  it('anula una factura impaga por el total y queda en auditoría', async () => {
    const { filas } = await lista(`anio=${ANIO}&mes=${MES}&estado=emitido`);
    facturaId = filas[0]!.id;
    expect((await gerencia.post(`${api}/comprobantes/${facturaId}/nota-credito`).send({ motivo: 'Lectura mal tomada' })).status).toBe(403);
    const sinMotivo = await oficina.post(`${api}/comprobantes/${facturaId}/nota-credito`).send({ motivo: '' });
    expect(sinMotivo.status).toBe(400);
    expect(sinMotivo.body.error.fields.motivo).toBeTruthy();

    const res = await oficina.post(`${api}/comprobantes/${facturaId}/nota-credito`).send({ motivo: 'Lectura mal tomada' });
    expect(res.status).toBe(201);
    expect(res.body.data.referencia).toMatch(/^N\.Cr [AB] 0001-00000001$/);

    const factura = await detalle(facturaId);
    expect(factura).toMatchObject({ estado: 'anulado', saldo: '0.00', relacionado: { id: res.body.data.id } });
    const nota = await detalle(res.body.data.id);
    expect(nota).toMatchObject({ tipo: 'nota_credito', total: factura.total, motivo: 'Lectura mal tomada', relacionado: { id: facturaId } });
    expect(nota.calculo!.renglones).toEqual(factura.calculo!.renglones);
    expect(await runInCooperativa(w.a.id, () => Auditoria.count({ where: { accion: 'anular_factura', entidadId: String(facturaId) } }))).toBe(1);
  });

  it('no se anula dos veces, ni una ya pagada, ni una nota de crédito', async () => {
    expect((await oficina.post(`${api}/comprobantes/${facturaId}/nota-credito`).send({ motivo: 'De nuevo' })).status).toBe(409);
    const [pagada] = await sql<{ id: number }>(`SELECT id FROM comprobantes WHERE cooperativa_id = :a AND tipo = 'factura' AND estado = 'pagado' LIMIT 1`);
    const res = await oficina.post(`${api}/comprobantes/${pagada!.id}/nota-credito`).send({ motivo: 'No corresponde' });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/ya tiene pagos/);
    const [nota] = await sql<{ id: number }>(`SELECT id FROM comprobantes WHERE cooperativa_id = :a AND tipo = 'nota_credito' LIMIT 1`);
    expect((await oficina.post(`${api}/comprobantes/${nota!.id}/nota-credito`).send({ motivo: 'No corresponde' })).status).toBe(409);
  });
});

describe('tarifas y meses ya facturados', () => {
  const cuadro = { servicio: 'agua', categoria: 'residencial', conSubsidio: false, cargoFijo: '7000', escalones: [{ desde: '0', hasta: null, precio: '2000' }] };

  it('una tarifa nueva no puede regir desde un mes que ya se emitió', async () => {
    const primerDia = `${HOY.slice(0, 7)}-01`;
    const res = await admin.post('/api/v1/tarifas/cuadros').send({ ...cuadro, vigenteDesde: primerDia });
    expect(res.status).toBe(400);
    expect(res.body.error.fields.vigenteDesde).toMatch(/Ya se emitieron las facturas/);
  });

  it('sí puede regir desde el mes siguiente', async () => {
    const { proximo } = await estado();
    const res = await admin.post('/api/v1/tarifas/cuadros').send({ ...cuadro, vigenteDesde: `${proximo.anio}-${String(proximo.mes).padStart(2, '0')}-01` });
    expect(res.status).toBe(201);
  });
});

describe('el mes siguiente', () => {
  it('al abrir su lectura, el mes emitido queda cerrado', async () => {
    const { proximo } = await estado();
    const res = await oficina.post('/api/v1/lecturas/periodos').send(proximo);
    expect(res.status).toBe(201);
    const e = await estado();
    expect(e.mes).toEqual({ ...proximo, estado: 'en_lectura' });
    expect(e.emision).toBeNull();
    expect(e.control!.total).toBeGreaterThan(0);
    const anteriores = await runInCooperativa(w.a.id, () => Periodo.findAll({ where: { anio: ANIO, mes: MES } }));
    expect(anteriores.map((p) => p.estado)).toEqual(['cerrado', 'cerrado']);
  });
});

describe('aislamiento', () => {
  it('la cooperativa B no ve ni toca los comprobantes de A', async () => {
    const b = await loginAs('admin@b.test');
    const [deA] = await sql<{ id: number }>(`SELECT id FROM comprobantes WHERE cooperativa_id = :a AND estado = 'emitido' LIMIT 1`);
    expect((await b.get(`${api}/comprobantes/${deA!.id}`)).status).toBe(404);
    expect((await b.get(`${api}/comprobantes/${deA!.id}/pdf`)).status).toBe(404);
    expect((await b.post(`${api}/comprobantes/${deA!.id}/nota-credito`).send({ motivo: 'No es mío' })).status).toBe(404);

    const propios = await lista('', b);
    const [totalB] = await sql<{ n: string }>(`SELECT count(*) AS n FROM comprobantes WHERE cooperativa_id = :b`);
    expect(propios.total).toBe(Number(totalB!.n));
    // B sigue con su mes en lectura: lo que hizo A no lo movió.
    expect((await estado(b)).mes).toEqual({ anio: ANIO, mes: MES, estado: 'en_lectura' });
  });
});
