// Fase 3: reglas de validación de una lectura, lecturas de prueba y la API que usan el teléfono y la oficina.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  estimarLectura,
  evaluarLectura,
  type ControlLecturas,
  type LecturaSyncEntrada,
  type MedidorRuta,
  type MisRutas,
  type ResultadoSync,
  type ResumenLecturas,
  type RutaDetalle,
} from '../src/shared';
import { sequelize } from '../src/db';
import { runInCooperativa } from '../src/lib/context';
import { Lectura, LecturaFoto, Periodo } from '../src/models';
import { callesInventadas } from '../src/seed/calles-inventadas';
import { cargarLecturas } from '../src/seed/cargar-lecturas';
import { cargarPadron } from '../src/seed/cargar-padron';
import { generarPadron } from '../src/seed/generar-padron';
import { createUser, loginAs, resetWorld } from './helpers';

describe('evaluarLectura', () => {
  const base = { anterior: 1000, promedio: 200, digitos: 5, factor: 1 };

  it('consumo normal: sin anomalía', () => {
    expect(evaluarLectura({ ...base, valor: 1210 })).toEqual({ consumo: 210, anomalia: null, faltaMotivo: false });
  });

  it('igual a la anterior: sin consumo', () => {
    expect(evaluarLectura({ ...base, valor: 1000 })).toEqual({ consumo: 0, anomalia: 'sin_consumo', faltaMotivo: false });
  });

  it('más de 3 veces el promedio: consumo alto; justo 3 veces, no', () => {
    expect(evaluarLectura({ ...base, valor: 1601 }).anomalia).toBe('consumo_alto');
    expect(evaluarLectura({ ...base, valor: 1600 }).anomalia).toBeNull();
  });

  it('menos de 0,2 veces el promedio: consumo bajo; justo 0,2, no', () => {
    expect(evaluarLectura({ ...base, valor: 1039 }).anomalia).toBe('consumo_bajo');
    expect(evaluarLectura({ ...base, valor: 1040 }).anomalia).toBeNull();
  });

  it('sin promedio (medidor con poco historial) no compara', () => {
    expect(evaluarLectura({ ...base, promedio: null, valor: 9000 })).toEqual({ consumo: 8000, anomalia: null, faltaMotivo: false });
    expect(evaluarLectura({ ...base, promedio: 0, valor: 9000 }).anomalia).toBeNull();
  });

  it('menor a la anterior sin motivo: no se puede guardar así', () => {
    expect(evaluarLectura({ ...base, valor: 900 })).toEqual({ consumo: null, anomalia: 'lectura_menor', faltaMotivo: true });
  });

  it('vuelta de contador: cuenta hasta el tope y sigue desde cero', () => {
    expect(evaluarLectura({ ...base, anterior: 99_950, valor: 120, motivo: 'vuelta_contador' })).toEqual({ consumo: 170, anomalia: 'lectura_menor', faltaMotivo: false });
    // con 7 dígitos el tope es otro
    expect(evaluarLectura({ ...base, digitos: 7, anterior: 9_999_950, valor: 120, motivo: 'vuelta_contador' }).consumo).toBe(170);
  });

  it('cambio de medidor: el nuevo arranca de cero', () => {
    expect(evaluarLectura({ ...base, valor: 35, motivo: 'cambio_medidor' })).toEqual({ consumo: 35, anomalia: 'lectura_menor', faltaMotivo: false });
  });

  it('el factor multiplica el consumo', () => {
    expect(evaluarLectura({ ...base, promedio: 8000, factor: 40, valor: 1200 }).consumo).toBe(8000);
  });

  it('primera lectura de un medidor: no hay consumo ni anomalía', () => {
    expect(evaluarLectura({ ...base, anterior: null, valor: 5 })).toEqual({ consumo: null, anomalia: null, faltaMotivo: false });
  });

  it('estimarLectura suma el promedio, en unidades del medidor, y da la vuelta si hace falta', () => {
    expect(estimarLectura({ anterior: 1000, promedio: 210.4, digitos: 5, factor: 1 })).toBe(1210);
    expect(estimarLectura({ anterior: 1000, promedio: 8000, digitos: 5, factor: 40 })).toBe(1200);
    expect(estimarLectura({ anterior: 99_900, promedio: 250, digitos: 5, factor: 1 })).toBe(150);
  });
});

/* ───────────────────────── API ───────────────────────── */

const api = '/api/v1/lecturas';
// PNG de 1×1
const FOTO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

let w: Awaited<ReturnType<typeof resetWorld>>;
type Agente = Awaited<ReturnType<typeof loginAs>>;
let operario: Agente;
let oficina: Agente;
let rutaId: number;
let ruta: RutaDetalle;

const lectura = (m: MedidorRuta, extra: Partial<LecturaSyncEntrada> = {}): LecturaSyncEntrada => ({
  uuid: randomUUID(),
  periodoId: m.periodoId,
  medidorId: m.medidorId,
  valor: (m.anterior?.valor ?? 0) + Math.round(m.promedio ?? 10),
  tomadaEl: new Date().toISOString(),
  ...extra,
});
const enviar = async (agente: Agente, lecturas: unknown[]): Promise<ResultadoSync[]> => {
  const res = await agente.post(`${api}/sync`).send({ lecturas });
  expect(res.status).toBe(200);
  return res.body.data.resultados;
};
const bajarRuta = async (): Promise<RutaDetalle> => (await operario.get(`${api}/rutas/${rutaId}`)).body.data;
/** Medidores de la ruta que todavía no tienen lectura, con historial para comparar. */
const pendientes = (r: RutaDetalle) => r.lista.flatMap((c) => c.medidores).filter((m) => m.lectura === null && m.anterior !== null && (m.promedio ?? 0) > 20);

beforeAll(async () => {
  w = await resetWorld();
  for (const [coop, sufijo, semilla] of [[w.a, 'a', 7], [w.b, 'b', 8]] as const) {
    // El operario se crea antes del padrón: así las rutas quedan a su nombre.
    await createUser({ cooperativaId: coop.id, email: `operario@${sufijo}.test`, roles: ['operario'] });
    await cargarPadron(generarPadron(callesInventadas(), { hogares: 40, semilla }), { cooperativaId: coop.id, planes: [] });
    await cargarLecturas(coop.id, { hoy: '2026-11-21', semilla, avance: [0.5, 0] });
  }
  await createUser({ cooperativaId: w.a.id, email: 'facturacion@a.test', roles: ['facturacion'] });
  operario = await loginAs('operario@a.test');
  oficina = await loginAs('facturacion@a.test');
  const mias: MisRutas = (await operario.get(`${api}/mis-rutas`)).body.data;
  rutaId = mias.rutas[0]!.id;
  ruta = await bajarRuta();
});
afterAll(() => sequelize.close());

describe('lecturas de prueba', () => {
  it('deja 12 meses cerrados y el actual en lectura, para energía y agua', async () => {
    const periodos = await runInCooperativa(w.a.id, () => Periodo.findAll({ order: [['anio', 'ASC'], ['mes', 'ASC']] }));
    expect(periodos).toHaveLength(26);
    expect(periodos.filter((p) => p.estado === 'en_lectura').map((p) => `${p.servicio} ${p.anio}-${p.mes}`).sort()).toEqual(['agua 2026-11', 'energia 2026-11']);
    expect(periodos.filter((p) => p.estado === 'cerrado')).toHaveLength(24);
    expect(periodos[0]).toMatchObject({ anio: 2025, mes: 11 });
  });

  it('no se cargan dos veces', async () => {
    expect(await cargarLecturas(w.a.id, { hoy: '2026-11-21', semilla: 7, avance: [1] })).toBeNull();
  });

  it('cada lectura del historial arranca donde terminó la anterior', async () => {
    const filas = await runInCooperativa(w.a.id, () => Lectura.findAll({ where: { medidorId: ruta.lista[0]!.medidores[0]!.medidorId }, order: [['tomadaEl', 'ASC']] }));
    expect(filas.length).toBeGreaterThan(6);
    filas.slice(1).forEach((l, i) => {
      if (l.valor === null) return;
      expect(l.anterior).toBe(filas[i]!.valor);
      expect(Number(l.consumo)).toBe(Number(l.valor) - Number(l.anterior));
    });
  });
});

describe('el operario', () => {
  it('ve solo sus rutas, con el avance del mes', async () => {
    const res = await operario.get(`${api}/mis-rutas`);
    const body: MisRutas = res.body.data;
    expect(body.periodo).toEqual({ anio: 2026, mes: 11 });
    expect(body.rutas.length).toBeGreaterThan(0);
    const total = body.rutas.reduce((n, r) => n + r.casas, 0);
    const hechas = body.rutas.reduce((n, r) => n + r.casasHechas, 0);
    expect(hechas).toBeGreaterThan(0);
    expect(hechas).toBeLessThan(total);
    for (const r of body.rutas) expect(r.medidoresLeidos).toBeLessThanOrEqual(r.medidores);
  });

  it('baja la ruta casa por casa, en orden, con la lectura anterior y el promedio', () => {
    expect(ruta.lista.length).toBe(ruta.casas);
    expect(ruta.lista.map((c) => c.orden)).toEqual([...ruta.lista.map((c) => c.orden)].sort((a, b) => a - b));
    const medidores = ruta.lista.flatMap((c) => c.medidores);
    expect(medidores).toHaveLength(ruta.medidores);
    const conHistorial = medidores.filter((m) => m.anterior !== null);
    expect(conHistorial.length).toBeGreaterThan(medidores.length * 0.8);
    for (const m of conHistorial.slice(0, 10)) expect(m.promedio).toBeGreaterThan(0);
    // la primera mitad del recorrido ya está leída; el resto, pendiente
    expect(ruta.lista[0]!.medidores.every((m) => m.lectura !== null)).toBe(true);
    expect(ruta.lista.at(-1)!.medidores.every((m) => m.lectura === null)).toBe(true);
    expect(ruta.lista[0]!.titular).toBeTruthy();
  });

  it('sincroniza una lectura y la API calcula el consumo', async () => {
    const m = pendientes(ruta)[0]!;
    const item = lectura(m, { valor: m.anterior!.valor + 37, lat: -27.02, lng: -54.68, precision: 8 });
    expect(await enviar(operario, [item])).toEqual([{ uuid: item.uuid, estado: 'guardada', anomalia: expect.anything() }]);
    const guardada = (await bajarRuta()).lista.flatMap((c) => c.medidores).find((x) => x.medidorId === m.medidorId)!.lectura!;
    expect(guardada).toMatchObject({ uuid: item.uuid, valor: m.anterior!.valor + 37, consumo: 37 * m.factor, tipo: 'real' });
  });

  it('reintentar el mismo envío no duplica la lectura', async () => {
    const m = pendientes(await bajarRuta())[0]!;
    const item = lectura(m);
    expect((await enviar(operario, [item]))[0]!.estado).toBe('guardada');
    expect((await enviar(operario, [item]))[0]!.estado).toBe('repetida');
    expect(await runInCooperativa(w.a.id, () => Lectura.count({ where: { medidorId: m.medidorId, periodoId: m.periodoId } }))).toBe(1);
  });

  it('una corrección (otro uuid, tomada después) reemplaza a la anterior; una más vieja no la pisa', async () => {
    const m = pendientes(await bajarRuta())[0]!;
    const primera = lectura(m, { tomadaEl: new Date(Date.now() - 60_000).toISOString() });
    const correccion = lectura(m, { valor: primera.valor! + 3 });
    const vieja = lectura(m, { valor: primera.valor! + 9, tomadaEl: new Date(Date.now() - 3_600_000).toISOString() });
    await enviar(operario, [primera]);
    expect((await enviar(operario, [correccion]))[0]!.estado).toBe('guardada');
    expect((await enviar(operario, [vieja]))[0]!.estado).toBe('repetida');
    const filas = await runInCooperativa(w.a.id, () => Lectura.findAll({ where: { medidorId: m.medidorId, periodoId: m.periodoId } }));
    expect(filas).toHaveLength(1);
    expect(Number(filas[0]!.valor)).toBe(correccion.valor);
    expect(filas[0]!.uuidDispositivo).toBe(correccion.uuid);
  });

  it('marca las anomalías: consumo alto, vuelta de contador y menor sin motivo', async () => {
    const [alto, vuelta, menor] = pendientes(await bajarRuta());
    const resultados = await enviar(operario, [
      lectura(alto!, { valor: alto!.anterior!.valor + Math.ceil((alto!.promedio! * 4) / alto!.factor) }),
      lectura(vuelta!, { valor: 12, motivo: 'vuelta_contador' }),
      lectura(menor!, { valor: 3 }),
    ]);
    expect(resultados.map((r) => [r.estado, r.anomalia])).toEqual([
      ['guardada', 'consumo_alto'],
      ['guardada', 'lectura_menor'],
      ['guardada', 'lectura_menor'],
    ]);
    const filas = await runInCooperativa(w.a.id, () => Lectura.findAll({ where: { medidorId: [vuelta!.medidorId, menor!.medidorId], periodoId: [vuelta!.periodoId, menor!.periodoId] } }));
    const deVuelta = filas.find((f) => f.medidorId === vuelta!.medidorId)!;
    expect(Number(deVuelta.consumo)).toBe((10 ** vuelta!.digitos - vuelta!.anterior!.valor + 12) * vuelta!.factor);
    // Lo que se tomó en la calle no se pierde: queda sin consumo, para que la oficina lo revise.
    expect(filas.find((f) => f.medidorId === menor!.medidorId)!.consumo).toBeNull();
  });

  it('guarda una novedad sin lectura, con foto y nota', async () => {
    const m = pendientes(await bajarRuta())[0]!;
    const item = lectura(m, { valor: null, novedad: 'perro', nota: '  Perro suelto  ', foto: FOTO });
    expect((await enviar(operario, [item]))[0]).toMatchObject({ estado: 'guardada', anomalia: null });
    const fila = await runInCooperativa(w.a.id, () => Lectura.findOne({ where: { uuidDispositivo: item.uuid } }));
    expect(fila).toMatchObject({ valor: null, consumo: null, novedad: 'perro', nota: 'Perro suelto', tieneFoto: true });
    const foto = await oficina.get(`${api}/${fila!.id}/foto`);
    expect(foto.status).toBe(200);
    expect(foto.headers['content-type']).toBe('image/png');
    expect(foto.body.length).toBeGreaterThan(50);
  });

  it('una lectura inválida no frena a las demás del lote', async () => {
    const [bien, mal] = pendientes(await bajarRuta());
    const resultados = await enviar(operario, [
      lectura(bien!),
      { ...lectura(mal!), valor: -5 },
      { ...lectura(mal!), valor: null }, // ni lectura ni novedad
      lectura(mal!, { valor: 10 ** mal!.digitos }),
      { ...lectura(mal!), medidorId: 999_999 },
      { ...lectura(mal!), foto: 'data:text/html;base64,PGI+' },
    ]);
    expect(resultados.map((r) => r.estado)).toEqual(['guardada', 'rechazada', 'rechazada', 'rechazada', 'rechazada', 'rechazada']);
    expect(resultados[3]!.error).toMatch(/dígitos/);
    expect(resultados[4]!.error).toMatch(/medidor/i);
  });

  it('no acepta lecturas de un mes que ya no está en lectura', async () => {
    const m = pendientes(await bajarRuta())[0]!;
    const cerrado = await runInCooperativa(w.a.id, () => Periodo.findOne({ where: { servicio: m.servicio, estado: 'cerrado' } }));
    const [r] = await enviar(operario, [{ ...lectura(m), periodoId: cerrado!.id }]);
    expect(r).toMatchObject({ estado: 'rechazada', error: expect.stringMatching(/cerrada/) });
  });

  it('otra cooperativa no puede leer la ruta ni cargarle lecturas', async () => {
    const ajeno = await loginAs('operario@b.test');
    expect((await ajeno.get(`${api}/rutas/${rutaId}`)).status).toBe(404);
    const m = pendientes(await bajarRuta())[0]!;
    const item = lectura(m);
    expect((await enviar(ajeno, [item]))[0]!.estado).toBe('rechazada');
    expect(await runInCooperativa(w.a.id, () => Lectura.count({ where: { uuidDispositivo: item.uuid } }))).toBe(0);
  });

  it('solo operarios y administración cargan lecturas; el control es de la oficina', async () => {
    const cajero = await loginAs('caja@a.test');
    expect((await cajero.get(`${api}/mis-rutas`)).status).toBe(403);
    expect((await oficina.post(`${api}/sync`).send({ lecturas: [{}] })).status).toBe(403);
    expect((await operario.get(`${api}/resumen`)).status).toBe(403);
    expect((await operario.post(`${api}/estimar`).send({ periodoId: 1, medidorId: 1 })).status).toBe(403);
  });
});

describe('la oficina', () => {
  it('ve el avance del mes por ruta', async () => {
    const body: ResumenLecturas = (await oficina.get(`${api}/resumen`)).body.data;
    expect(body.periodo).toEqual({ anio: 2026, mes: 11, estado: 'en_lectura' });
    expect(body.proximo).toEqual({ anio: 2026, mes: 12 });
    expect(body.leidos).toBeGreaterThan(0);
    expect(body.leidos).toBeLessThan(body.total);
    expect(body.rutas.reduce((n, r) => n + r.medidores, 0)).toBe(body.total);
    expect(body.rutas.reduce((n, r) => n + r.leidos, 0)).toBe(body.leidos);
    expect(body.rutas.find((r) => r.id === rutaId)!.operario?.nombre).toBe('Persona operario');
    expect(body.operarios.map((o) => o.nombre)).toEqual(['Persona operario']);
    expect(body.anomalias).toBeGreaterThanOrEqual(3);
    expect(body.conNovedad).toBeGreaterThanOrEqual(1);
  });

  it('lista las anomalías y las saca de la lista al revisarlas', async () => {
    const antes: ControlLecturas = (await oficina.get(`${api}/control?filtro=anomalias`)).body.data;
    expect(antes.total).toBe(antes.filas.length);
    const fila = antes.filas.find((f) => f.lectura?.anomalia === 'consumo_alto')!;
    expect(fila.lectura).toMatchObject({ operario: 'Persona operario', revisada: false });
    expect((await oficina.post(`${api}/${fila.lectura!.id}/revisar`)).status).toBe(200);
    const despues: ControlLecturas = (await oficina.get(`${api}/control?filtro=anomalias`)).body.data;
    expect(despues.total).toBe(antes.total - 1);
    expect(despues.filas.some((f) => f.lectura?.id === fila.lectura!.id)).toBe(false);
  });

  it('estima un medidor pendiente con el promedio y lo deja marcado', async () => {
    const pendientesAntes: ControlLecturas = (await oficina.get(`${api}/control?filtro=pendientes&ruta=${rutaId}`)).body.data;
    const fila = pendientesAntes.filas.find((f) => f.anterior !== null && f.promedio !== null)!;
    expect(fila.lectura).toBeNull();
    const res = await oficina.post(`${api}/estimar`).send({ periodoId: fila.periodoId, medidorId: fila.medidorId });
    expect(res.status).toBe(201);
    expect(res.body.data.valor).toBe(fila.anterior! + Math.round(fila.promedio!));
    const estimadas: ControlLecturas = (await oficina.get(`${api}/control?filtro=estimadas`)).body.data;
    expect(estimadas.filas.find((f) => f.medidorId === fila.medidorId)!.lectura).toMatchObject({ tipo: 'estimada', valor: res.body.data.valor });
    // ya tiene lectura: no se estima dos veces
    expect((await oficina.post(`${api}/estimar`).send({ periodoId: fila.periodoId, medidorId: fila.medidorId })).status).toBe(409);
    // gerencia mira pero no estima
    expect((await (await loginAs('demo@a.test')).post(`${api}/estimar`).send({ periodoId: fila.periodoId, medidorId: fila.medidorId })).status).toBe(403);
  });

  it('una novedad sin lectura se puede estimar y conserva la novedad', async () => {
    const novedades: ControlLecturas = (await oficina.get(`${api}/control?filtro=novedades`)).body.data;
    const fila = novedades.filas.find((f) => f.lectura?.novedad === 'perro')!;
    expect((await oficina.post(`${api}/estimar`).send({ periodoId: fila.periodoId, medidorId: fila.medidorId })).status).toBe(201);
    const guardada = await runInCooperativa(w.a.id, () => Lectura.findByPk(fila.lectura!.id));
    expect(guardada).toMatchObject({ tipo: 'estimada', novedad: 'perro', tieneFoto: true });
    expect(await runInCooperativa(w.a.id, () => LecturaFoto.count())).toBe(1);
  });

  it('cambia el operario de una ruta, y solo acepta operarios de la cooperativa', async () => {
    const otro = await createUser({ cooperativaId: w.a.id, email: 'operario2@a.test', roles: ['operario'] });
    expect((await oficina.put(`${api}/rutas/${rutaId}/operario`).send({ operarioId: w.cajeroA.id })).status).toBe(400);
    expect((await oficina.put(`${api}/rutas/${rutaId}/operario`).send({ operarioId: otro.id })).status).toBe(200);
    const mias: MisRutas = (await operario.get(`${api}/mis-rutas`)).body.data;
    expect(mias.rutas.some((r) => r.id === rutaId)).toBe(false);
    const delOtro: MisRutas = (await (await loginAs('operario2@a.test')).get(`${api}/mis-rutas`)).body.data;
    expect(delOtro.rutas.map((r) => r.id)).toEqual([rutaId]);
    // El operario nuevo ve las mismas cuentas que la oficina: medidores y casas, lo leído y lo que falta.
    const enOficina = ((await oficina.get(`${api}/resumen`)).body.data as ResumenLecturas).rutas.find((r) => r.id === rutaId)!;
    const enTelefono = delOtro.rutas[0]!;
    expect(enOficina.operario).toMatchObject({ id: otro.id });
    expect({ medidores: enOficina.medidores, leidos: enOficina.leidos, casas: enOficina.casas, casasHechas: enOficina.casasHechas }).toEqual({
      medidores: enTelefono.medidores,
      leidos: enTelefono.medidoresLeidos,
      casas: enTelefono.casas,
      casasHechas: enTelefono.casasHechas,
    });
    expect(enOficina.leidos).toBeGreaterThan(0);
    expect(enOficina.casas).toBeGreaterThan(0);
    expect((await oficina.put(`${api}/rutas/${rutaId}/operario`).send({ operarioId: null })).status).toBe(200);
  });

  it('no abre otro mes mientras haya uno en lectura, ni uno anterior al último', async () => {
    expect((await oficina.post(`${api}/periodos`).send({ anio: 2026, mes: 12 })).status).toBe(409);
    await runInCooperativa(w.a.id, () => Periodo.update({ estado: 'cerrado' }, { where: { estado: 'en_lectura' } }));
    expect((await operario.get(`${api}/mis-rutas`)).body.data).toEqual({ periodo: null, rutas: [] });
    expect((await oficina.post(`${api}/periodos`).send({ anio: 2026, mes: 11 })).status).toBe(409);
    expect((await oficina.post(`${api}/periodos`).send({ anio: 2026, mes: 12 })).status).toBe(201);
    const body: ResumenLecturas = (await oficina.get(`${api}/resumen`)).body.data;
    expect(body.periodo).toEqual({ anio: 2026, mes: 12, estado: 'en_lectura' });
    expect(body.leidos).toBe(0);
    expect(body.total).toBeGreaterThan(0);
  });
});
