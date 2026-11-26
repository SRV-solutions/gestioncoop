// Tarifas por la API: permisos, versionado, auditoría, aislamiento y el simulador.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConceptoDetalle, CuadroDetalle, FacturaCalculada, TarifasResumen } from '../src/shared';
import { sequelize } from '../src/db';
import { runInCooperativa } from '../src/lib/context';
import { hoy } from '../src/lib/tarifas';
import { Auditoria, Plan } from '../src/models';
import { sumarDias } from '../src/motor';
import { cargarTarifas } from '../src/seed/cargar-tarifas';
import { TARIFAS_ARROYO_DEL_MONTE, TARIFAS_DOS_DE_MAYO } from '../src/seed/tarifas';
import { createUser, loginAs, resetWorld } from './helpers';

let w: Awaited<ReturnType<typeof resetWorld>>;
let admin: Awaited<ReturnType<typeof loginAs>>;
let planId: number;

const HOY = hoy();
const MANANA = sumarDias(HOY, 1);
const EN_UN_MES = sumarDias(HOY, 30);

const resumen = async (agent = admin): Promise<TarifasResumen> => (await agent.get('/api/v1/tarifas')).body.data;
const cuadrosDe = (r: TarifasResumen, servicio: string, categoria: string | null, conSubsidio = false) =>
  r.cuadros.filter((c) => c.servicio === servicio && c.categoria === categoria && c.conSubsidio === conSubsidio);

const NUEVO_CUADRO = {
  servicio: 'agua',
  categoria: 'residencial',
  conSubsidio: false,
  cargoFijo: '1000',
  escalones: [
    { desde: '0', hasta: '10', precio: '3000' },
    { desde: '10', hasta: null, precio: '6000' },
  ],
};

beforeAll(async () => {
  w = await resetWorld();
  await createUser({ cooperativaId: w.a.id, email: 'facturacion@a.test', roles: ['facturacion'] });
  await cargarTarifas(w.a.id, TARIFAS_DOS_DE_MAYO);
  await cargarTarifas(w.b.id, TARIFAS_ARROYO_DEL_MONTE);
  planId = (await runInCooperativa(w.a.id, () => Plan.create({ servicio: 'internet', nombre: 'Internet 50 Mbps', precio: '26716.00' }))).id;
  admin = await loginAs('admin@a.test');
});
afterAll(() => sequelize.close());

describe('permisos', () => {
  it('administración, gerencia y facturación ven las tarifas; caja y socios no', async () => {
    expect((await admin.get('/api/v1/tarifas')).status).toBe(200);
    expect((await (await loginAs('demo@a.test')).get('/api/v1/tarifas')).status).toBe(200); // gerencia
    expect((await (await loginAs('facturacion@a.test')).get('/api/v1/tarifas')).status).toBe(200);
    expect((await (await loginAs('caja@a.test')).get('/api/v1/tarifas')).status).toBe(403);
    expect((await (await loginAs('socio@b.test')).get('/api/v1/tarifas')).status).toBe(403);
  });

  it('solo administración puede cambiarlas', async () => {
    const facturacion = await loginAs('facturacion@a.test');
    expect((await facturacion.post('/api/v1/tarifas/cuadros').send({ ...NUEVO_CUADRO, vigenteDesde: EN_UN_MES })).status).toBe(403);
    expect((await facturacion.post('/api/v1/tarifas/conceptos').send({})).status).toBe(403);
    expect((await facturacion.put('/api/v1/tarifas/parametros').send({})).status).toBe(403);
    expect((await facturacion.put(`/api/v1/tarifas/planes/${planId}`).send({ precio: '1' })).status).toBe(403);
    // ...pero sí puede simular
    expect((await facturacion.post('/api/v1/tarifas/simular').send({ servicio: 'agua', consumo: '10' })).status).toBe(200);
  });
});

describe('lo que devuelve', () => {
  it('cuadros con sus escalones, conceptos, planes y parámetros', async () => {
    const r = await resumen();
    expect(r.hoy).toBe(HOY);
    const [vigente, anterior] = cuadrosDe(r, 'agua', 'residencial');
    expect(vigente).toMatchObject({ vigenteDesde: '2026-07-01', vigenteHasta: null, cargoFijo: '866.20', futuro: false });
    expect(vigente!.escalones[1]).toEqual({ desde: '5', hasta: '10', precio: '2708.9944', subsidiado: false, exentoDe: ['DGR_AP'] });
    expect(vigente!.escalones.at(-1)).toMatchObject({ desde: '30', hasta: null });
    expect(anterior).toMatchObject({ vigenteDesde: '2026-01-01', vigenteHasta: '2026-06-30' });
    expect(r.conceptos.find((c) => c.codigo === 'LEY_3195')).toMatchObject({ tipo: 'porcentaje', valor: '3.31', base: 'basico', servicio: 'energia' });
    expect(r.planes).toEqual([expect.objectContaining({ nombre: 'Internet 50 Mbps', precio: '26716.00', conexiones: 0 })]);
    expect(r.parametros).toMatchObject({ moraTasaDiaria: '0.1', diasVencimiento: 10, facturasParaCorte: 2 });
  });

  it('cada cooperativa ve solo sus tarifas', async () => {
    const b = await resumen(await loginAs('admin@b.test'));
    expect(b.cuadros).toHaveLength(TARIFAS_ARROYO_DEL_MONTE.cuadros.length);
    expect(b.conceptos.map((c) => c.codigo).sort()).toEqual(['ALUMBRADO', 'IVA', 'IVA_RECARGOS']);
    expect(b.parametros.diasVencimiento).toBe(15);
    expect(b.planes).toEqual([]);

    // El admin de B no puede tocar ni borrar un cuadro de A: para él no existe.
    const deA = cuadrosDe(await resumen(), 'agua', 'residencial')[0]!;
    expect((await (await loginAs('admin@b.test')).delete(`/api/v1/tarifas/cuadros/${deA.id}`)).status).toBe(404);
  });
});

describe('cuadros: nunca se editan, se versionan', () => {
  let nuevoId: number;

  it('una versión nueva cierra la anterior el día antes y deja registro', async () => {
    const res = await admin.post('/api/v1/tarifas/cuadros').send({ ...NUEVO_CUADRO, vigenteDesde: EN_UN_MES, nota: 'Aumento de prueba' });
    expect(res.status).toBe(201);
    const creado: CuadroDetalle = res.body.data;
    nuevoId = creado.id;
    expect(creado).toMatchObject({ vigenteDesde: EN_UN_MES, vigenteHasta: null, cargoFijo: '1000.00', futuro: true, nota: 'Aumento de prueba' });
    expect(creado.escalones.map((e) => [e.desde, e.hasta, e.precio])).toEqual([
      ['0', '10', '3000.0000'],
      ['10', null, '6000.0000'],
    ]);

    const [futuro, vigente] = cuadrosDe(await resumen(), 'agua', 'residencial');
    expect(futuro!.id).toBe(nuevoId);
    expect(vigente).toMatchObject({ vigenteDesde: '2026-07-01', vigenteHasta: sumarDias(EN_UN_MES, -1) });

    const audit = await runInCooperativa(w.a.id, () => Auditoria.findOne({ where: { entidad: 'cuadro_tarifario', entidadId: String(nuevoId) } }));
    expect(audit).toMatchObject({ accion: 'crear', usuarioId: w.adminA.id, cooperativaId: w.a.id });
  });

  it('la versión nueva tiene que empezar después de la última', async () => {
    const res = await admin.post('/api/v1/tarifas/cuadros').send({ ...NUEVO_CUADRO, vigenteDesde: EN_UN_MES });
    expect(res.status).toBe(400);
    expect(res.body.error.fields.vigenteDesde).toMatch(/tiene que empezar después/);
  });

  it('rechaza escalones que no cubren todo el consumo', async () => {
    const con = (escalones: unknown) => admin.post('/api/v1/tarifas/cuadros').send({ ...NUEVO_CUADRO, categoria: 'comercial', vigenteDesde: EN_UN_MES, escalones });
    const hueco = await con([{ desde: '0', hasta: '10', precio: '1' }, { desde: '12', hasta: null, precio: '2' }]);
    expect(hueco.status).toBe(400);
    expect(hueco.body.error.fields.escalones).toMatch(/donde termina el anterior/);
    expect((await con([{ desde: '0', hasta: '10', precio: '1' }])).body.error.fields.escalones).toMatch(/no lleva tope/);
    expect((await con([{ desde: '5', hasta: null, precio: '1' }])).body.error.fields.escalones).toMatch(/arrancar en 0/);
    expect((await con([{ desde: '0', hasta: null, precio: '-3' }])).status).toBe(400);
    expect((await con([])).status).toBe(400);
  });

  it('valida servicio, categoría y fecha', async () => {
    const con = (cambios: object) => admin.post('/api/v1/tarifas/cuadros').send({ ...NUEVO_CUADRO, vigenteDesde: EN_UN_MES, ...cambios });
    expect((await con({ servicio: 'internet' })).status).toBe(400);
    expect((await con({ categoria: null })).body.error.fields.categoria).toBe('Elegí la categoría');
    expect((await con({ servicio: 'sepelio' })).body.error.fields.categoria).toBe('Sepelio no lleva categoría');
    expect((await con({ conSubsidio: true })).body.error.fields.conSubsidio).toBeDefined();
    expect((await con({ vigenteDesde: '2026-02-30' })).body.error.fields.vigenteDesde).toBe('Esa fecha no existe');
  });

  it('un cuadro que ya rige no se puede borrar', async () => {
    const vigente = cuadrosDe(await resumen(), 'agua', 'residencial')[1]!;
    const res = await admin.delete(`/api/v1/tarifas/cuadros/${vigente.id}`);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/creá una versión nueva/);
  });

  it('uno que todavía no entró en vigencia sí, y el anterior vuelve a quedar abierto', async () => {
    expect((await admin.delete(`/api/v1/tarifas/cuadros/${nuevoId}`)).status).toBe(200);
    const cuadros = cuadrosDe(await resumen(), 'agua', 'residencial');
    expect(cuadros.map((c) => [c.vigenteDesde, c.vigenteHasta])).toEqual([
      ['2026-07-01', null],
      ['2026-01-01', '2026-06-30'],
      ['2025-07-01', '2025-12-31'],
    ]);
    expect((await admin.delete(`/api/v1/tarifas/cuadros/${nuevoId}`)).status).toBe(404);
  });

  it('se puede crear el primer cuadro de una categoría que no tenía', async () => {
    const res = await admin.post('/api/v1/tarifas/cuadros').send({ ...NUEVO_CUADRO, categoria: 'rural', vigenteDesde: HOY });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ categoria: 'rural', futuro: false });
  });
});

describe('conceptos', () => {
  const ALUMBRADO = { codigo: 'alumbrado', nombre: 'Servicio de alumbrado', tipo: 'fijo', valor: '11500', grupo: 'gravamen', servicio: 'energia', orden: 30 };
  let nuevoId: number;

  it('un valor nuevo para un concepto cierra el anterior', async () => {
    const res = await admin.post('/api/v1/tarifas/conceptos').send({ ...ALUMBRADO, vigenteDesde: MANANA });
    expect(res.status).toBe(201);
    const creado: ConceptoDetalle = res.body.data;
    nuevoId = creado.id;
    expect(creado).toMatchObject({ codigo: 'ALUMBRADO', valor: '11500', base: null, vigenteDesde: MANANA, vigenteHasta: null, futuro: true });

    const versiones = (await resumen()).conceptos.filter((c) => c.codigo === 'ALUMBRADO');
    expect(versiones.map((c) => [c.valor, c.vigenteDesde, c.vigenteHasta])).toEqual([
      ['11500', MANANA, null],
      ['9000', '2026-05-01', HOY],
      ['7500', '2025-07-01', '2026-04-30'],
    ]);
    const audit = await runInCooperativa(w.a.id, () => Auditoria.findOne({ where: { entidad: 'concepto', entidadId: String(nuevoId) } }));
    expect(audit?.accion).toBe('cambiar_valor');
  });

  it('no acepta una fecha anterior o igual a la del último valor', async () => {
    const res = await admin.post('/api/v1/tarifas/conceptos').send({ ...ALUMBRADO, vigenteDesde: HOY });
    expect(res.status).toBe(400);
    expect(res.body.error.fields.vigenteDesde).toBeDefined();
  });

  it('borrar un valor futuro reabre el anterior; uno vigente no se borra', async () => {
    expect((await admin.delete(`/api/v1/tarifas/conceptos/${nuevoId}`)).status).toBe(200);
    const [vigente] = (await resumen()).conceptos.filter((c) => c.codigo === 'ALUMBRADO');
    expect(vigente).toMatchObject({ valor: '9000', vigenteHasta: null });
    expect((await admin.delete(`/api/v1/tarifas/conceptos/${vigente!.id}`)).status).toBe(409);
  });

  it('un concepto nuevo: un porcentaje necesita su base', async () => {
    const tasa = { codigo: 'TASA_MUNI', nombre: 'Tasa municipal', tipo: 'porcentaje', valor: '1.5', grupo: 'gravamen', servicio: 'energia', vigenteDesde: HOY };
    const sinBase = await admin.post('/api/v1/tarifas/conceptos').send(tasa);
    expect(sinBase.status).toBe(400);
    expect(sinBase.body.error.fields.base).toBe('Elegí sobre qué se calcula');
    expect((await admin.post('/api/v1/tarifas/conceptos').send({ ...tasa, base: 'basico', valor: '150' })).body.error.fields.valor).toMatch(/100/);
    expect((await admin.post('/api/v1/tarifas/conceptos').send({ ...tasa, base: 'subtotal', grupo: 'cargo' })).body.error.fields.base).toBeDefined();
    expect((await admin.post('/api/v1/tarifas/conceptos').send({ ...tasa, codigo: 'con espacios', base: 'basico' })).body.error.fields.codigo).toBeDefined();

    const res = await admin.post('/api/v1/tarifas/conceptos').send({ ...tasa, base: 'basico', categorias: ['comercial', 'industrial'] });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ codigo: 'TASA_MUNI', valor: '1.5', base: 'basico', categorias: ['comercial', 'industrial'], condicionesIva: null, orden: 100 });
  });

  it('se le puede poner fecha de fin, una sola vez y no antes de que empiece', async () => {
    const tasa = (await resumen()).conceptos.find((c) => c.codigo === 'TASA_MUNI')!;
    const antes = await admin.post(`/api/v1/tarifas/conceptos/${tasa.id}/fin`).send({ vigenteHasta: sumarDias(HOY, -1) });
    expect(antes.status).toBe(400);
    expect(antes.body.error.fields.vigenteHasta).toBeDefined();
    const res = await admin.post(`/api/v1/tarifas/conceptos/${tasa.id}/fin`).send({ vigenteHasta: EN_UN_MES });
    expect(res.body.data.vigenteHasta).toBe(EN_UN_MES);
    expect((await admin.post(`/api/v1/tarifas/conceptos/${tasa.id}/fin`).send({ vigenteHasta: EN_UN_MES })).status).toBe(409);
    expect((await admin.post('/api/v1/tarifas/conceptos/999999/fin').send({ vigenteHasta: EN_UN_MES })).status).toBe(404);
  });
});

describe('planes y parámetros', () => {
  it('cambiar el precio de un plan deja registro del valor anterior', async () => {
    const res = await admin.put(`/api/v1/tarifas/planes/${planId}`).send({ precio: '28900,50' });
    expect(res.status).toBe(200);
    expect(res.body.data.precio).toBe('28900.50');
    const audit = await runInCooperativa(w.a.id, () => Auditoria.findOne({ where: { entidad: 'plan', entidadId: String(planId) } }));
    expect(audit).toMatchObject({ accion: 'cambiar_precio', antesJson: { precio: '26716.00' }, despuesJson: { precio: '28900.50' } });
    expect((await admin.put(`/api/v1/tarifas/planes/${planId}`).send({ precio: '-1' })).status).toBe(400);
    expect((await admin.put('/api/v1/tarifas/planes/999999').send({ precio: '1' })).status).toBe(404);
  });

  it('los parámetros de mora y vencimiento se guardan por cooperativa', async () => {
    const nuevos = { moraTasaDiaria: '0.15', diasVencimiento: 12, segundoVencimientoDias: 7, recargoSegundoVencimiento: '2', facturasParaCorte: 3 };
    const res = await admin.put('/api/v1/tarifas/parametros').send(nuevos);
    expect(res.status).toBe(200);
    expect((await resumen()).parametros).toEqual(nuevos);
    expect((await resumen(await loginAs('admin@b.test'))).parametros.moraTasaDiaria).toBe('0.08');

    const mal = await admin.put('/api/v1/tarifas/parametros').send({ ...nuevos, moraTasaDiaria: '9', diasVencimiento: 0 });
    expect(mal.status).toBe(400);
    expect(Object.keys(mal.body.error.fields).sort()).toEqual(['diasVencimiento', 'moraTasaDiaria']);
  });
});

describe('simulador', () => {
  const simular = (body: object, agent = admin) => agent.post('/api/v1/tarifas/simular').send(body);

  it('66 m³ de agua residencial dan el total de la factura real', async () => {
    const res = await simular({ servicio: 'agua', categoria: 'residencial', consumo: '66' });
    expect(res.status).toBe(200);
    const f: FacturaCalculada = res.body.data;
    expect(f.totales).toMatchObject({ subtotal: '288345.84', gravamenes: '69648.54', servicio: '357994.38', total: '357994.38' });
    expect(f.consumo?.facturado).toBe('66');
  });

  it('energía con subsidio, sepelio y deuda vencida', async () => {
    const res = await simular({ servicio: 'energia', tieneSubsidio: true, consumo: 1176, adherentes: 2, deuda: { saldo: '100000', dias: 10 } });
    const f: FacturaCalculada = res.body.data;
    expect(f.totales.basico).toBe('252214.50');
    expect(f.renglones.filter((r) => r.servicio === 'sepelio').map((r) => r.importe)).toEqual(['4800.00', '4800.00']);
    // 100.000 × 0,15 % (la tasa que quedó guardada arriba) × 10 días
    expect(f.renglones.find((r) => r.codigo === 'MORA')?.importe).toBe('1500.00');
    expect(f.renglones.find((r) => r.codigo === 'IVA_RECARGOS')?.importe).toBe('315.00');
  });

  it('un responsable inscripto paga IVA del 27 %', async () => {
    const f: FacturaCalculada = (await simular({ servicio: 'energia', categoria: 'comercial', condicionIva: 'responsable_inscripto', consumo: '100' })).body.data;
    expect(f.renglones.map((r) => r.codigo)).toContain('IVA_EE_27');
    expect(f.renglones.map((r) => r.codigo)).not.toContain('IVA_EE');
  });

  it('internet por plan', async () => {
    const f: FacturaCalculada = (await simular({ servicio: 'internet', planId })).body.data;
    expect(f.renglones).toEqual([expect.objectContaining({ codigo: 'ABONO', importe: '28900.50' })]);
    expect((await simular({ servicio: 'internet' })).body.error.fields.planId).toBe('Elegí un plan');
    expect((await simular({ servicio: 'tv', planId })).status).toBe(400); // el plan es de internet
  });

  it('en un mes anterior usa la tarifa que regía entonces', async () => {
    const f: FacturaCalculada = (await simular({ servicio: 'agua', consumo: '66', periodo: '2026-03' })).body.data;
    expect(Number(f.totales.total)).toBeLessThan(357994.38);
    expect(f.snapshot.cuadros[0]).toMatchObject({ vigenteDesde: '2026-01-01', vigenteHasta: '2026-06-30' });
  });

  it('si falta el consumo o no hay tarifa para ese caso, lo explica', async () => {
    const sinConsumo = await simular({ servicio: 'agua' });
    expect(sinConsumo.status).toBe(400);
    expect(sinConsumo.body.error.fields.consumo).toBe('Escribí el consumo');

    const sinCuadro = await simular({ servicio: 'agua', consumo: '10', periodo: '2025-06' });
    expect(sinCuadro.status).toBe(422);
    expect(sinCuadro.body.error).toMatchObject({ code: 'calculo_sin_cuadro' });
    expect(sinCuadro.body.error.message).toMatch(/No hay un cuadro tarifario vigente/);
  });

  it('cada cooperativa simula con sus propias tarifas', async () => {
    const b: FacturaCalculada = (await simular({ servicio: 'agua', consumo: '66' }, await loginAs('admin@b.test'))).body.data;
    // Arroyo del Monte: cuota fija con 10 m³ incluidos + 56 m³ a $ 1.850, más IVA.
    expect(b.totales.basico).toBe('110000.00');
    expect(b.totales.total).toBe('133100.00');
  });
});
