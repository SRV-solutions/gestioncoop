// Fase 8: el mapa interactivo. Lo que se pinta encima de las casas sale de las mismas reglas que el
// tablero y los informes, así que acá se cruza todo: la deuda de todas las casas es la del tablero,
// las casas «en mora» son las del informe de cortes sugeridos, y un área que abarca todo da los
// totales de la cooperativa. También: lecturas en vivo (una lectura recién cargada cambia el punto),
// la ficha de una casa, exportar un área, permisos y aislamiento.
import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { QueryTypes } from 'sequelize';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  aCentavos,
  CATEGORIAS,
  deCentavos,
  empaquetarEstados,
  estadoEmpaquetado,
  peorSituacion,
  puntoEnPoligono,
  SERVICIOS_CONEXION,
  situacionDe,
  superficieHa,
  type EstadoServicio,
  type FichaMapa,
  type InformeDatos,
  type MapaCapas,
  type MapaConexiones,
  type MapaLecturas,
  type ResumenArea,
  type ResumenLecturas,
  type ServicioConexion,
  type Tablero,
} from '../src/shared';
import { sequelize } from '../src/db';
import { runUnscoped } from '../src/lib/context';
import { hoy } from '../src/lib/tarifas';
import { Auditoria } from '../src/models';
import { callesInventadas } from '../src/seed/calles-inventadas';
import { cargarPagos } from '../src/seed/cargar-caja';
import { cargarFacturas } from '../src/seed/cargar-facturas';
import { cargarLecturas } from '../src/seed/cargar-lecturas';
import { cargarPadron } from '../src/seed/cargar-padron';
import { cargarReclamos } from '../src/seed/cargar-reclamos';
import { cargarTarifas } from '../src/seed/cargar-tarifas';
import { generarPadron, PLANES } from '../src/seed/generar-padron';
import { TARIFAS_ARROYO_DEL_MONTE } from '../src/seed/tarifas';
import { createUser, loginAs, resetWorld } from './helpers';

const api = '/api/v1/mapa';
const HOY = hoy();
const PLANES_PRUEBA = [
  { servicio: 'internet' as const, nombre: PLANES.internet50, precio: '20000.00' },
  { servicio: 'internet' as const, nombre: PLANES.internet100, precio: '30000.00' },
  { servicio: 'tv' as const, nombre: PLANES.tv, precio: '15000.00' },
];

let w: Awaited<ReturnType<typeof resetWorld>>;
type Agente = Awaited<ReturnType<typeof loginAs>>;
let gerencia: Agente;
let admin: Agente;
let adminB: Agente;

const sql = <T extends object>(texto: string, replacements: Record<string, unknown> = {}) =>
  sequelize.query<T>(texto, { replacements: { a: w.a.id, b: w.b.id, hoy: HOY, ...replacements }, type: QueryTypes.SELECT });
const valor = async (texto: string, replacements: Record<string, unknown> = {}) => (await sql<{ v: string }>(texto, replacements))[0]!.v;
const suma = (...importes: (string | number)[]) => deCentavos(importes.reduce<number>((t, i) => t + (typeof i === 'number' ? Math.round(i * 100) : aCentavos(i)), 0));
const conexiones = async (agente: Agente = gerencia): Promise<MapaConexiones> => (await agente.get(`${api}/conexiones`)).body.data;
const capas = async (agente: Agente = gerencia): Promise<MapaCapas> => (await agente.get(`${api}/capas`)).body.data;
const lecturas = async (agente: Agente = gerencia): Promise<MapaLecturas> => (await agente.get(`${api}/lecturas`)).body.data;
const tablero = async (consulta = '', agente: Agente = gerencia): Promise<Tablero> => (await agente.get(`/api/v1/tablero${consulta}`)).body.data;
const area = async (cuerpo: Record<string, unknown>, agente: Agente = gerencia): Promise<ResumenArea> => {
  const res = await agente.post(`${api}/area`).send(cuerpo);
  if (res.status !== 200) throw new Error(`área ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data;
};
const DEUDA = `c.cooperativa_id = :coop AND c.tipo = 'factura' AND c.estado = 'emitido' AND c.saldo > 0`;

beforeAll(async () => {
  w = await resetWorld();
  await createUser({ cooperativaId: w.a.id, email: 'operario@a.test', roles: ['operario'] });
  for (const [coop, semilla] of [[w.a, 7], [w.b, 8]] as const) {
    await cargarPadron(generarPadron(callesInventadas(), { hogares: 40, semilla }), { cooperativaId: coop.id, planes: PLANES_PRUEBA });
    await cargarTarifas(coop.id, TARIFAS_ARROYO_DEL_MONTE);
    await cargarLecturas(coop.id, { hoy: HOY, semilla, avance: [0.5, 0] });
    await cargarFacturas(coop.id, { semilla });
    await cargarPagos(coop.id, { semilla });
    await cargarReclamos(coop.id, { semilla, hoy: HOY, cantidad: 16 });
  }
  gerencia = await loginAs('demo@a.test');
  admin = await loginAs('admin@a.test');
  adminB = await loginAs('admin@b.test');
}, 180_000);
afterAll(() => sequelize.close());

describe('reglas compartidas', () => {
  it('la situación de un servicio: cortado manda, después la mora, después la deuda', () => {
    expect(situacionDe({ estado: 'activo', deuda: 0, vencidas: 0 }, 2)).toBe('al_dia');
    expect(situacionDe({ estado: 'activo', deuda: 100, vencidas: 0 }, 2)).toBe('con_deuda');
    expect(situacionDe({ estado: 'activo', deuda: 100, vencidas: 1 }, 2)).toBe('con_deuda');
    expect(situacionDe({ estado: 'suspendido', deuda: 100, vencidas: 2 }, 2)).toBe('en_mora');
    expect(situacionDe({ estado: 'activo', deuda: 100, vencidas: 1 }, 1)).toBe('en_mora');
    expect(situacionDe({ estado: 'cortado', deuda: 900, vencidas: 5 }, 2)).toBe('cortado');
    expect(situacionDe({ estado: 'baja', deuda: 0, vencidas: 0 }, 2)).toBe('baja');
    expect(situacionDe({ estado: null, deuda: 0, vencidas: 0 }, 2)).toBe('baja');
  });

  it('la de la conexión es lo más urgente de sus servicios', () => {
    expect(peorSituacion(['al_dia', 'en_mora', 'cortado'])).toBe('en_mora');
    expect(peorSituacion(['al_dia', 'con_deuda'])).toBe('con_deuda');
    expect(peorSituacion(['al_dia', 'cortado', 'baja'])).toBe('cortado');
    expect(peorSituacion(['baja', 'al_dia'])).toBe('al_dia');
    expect(peorSituacion(['baja'])).toBe('baja');
    expect(peorSituacion([])).toBe('baja');
  });

  it('empaqueta y lee el estado de cada servicio', () => {
    const bits = empaquetarEstados([
      { servicio: 'energia', estado: 'cortado' },
      { servicio: 'agua', estado: 'activo' },
      { servicio: 'tv', estado: 'suspendido' },
      { servicio: 'sepelio', estado: 'baja' },
    ]);
    expect(estadoEmpaquetado(bits, 'energia')).toBe('cortado');
    expect(estadoEmpaquetado(bits, 'agua')).toBe('activo');
    expect(estadoEmpaquetado(bits, 'internet')).toBeNull();
    expect(estadoEmpaquetado(bits, 'tv')).toBe('suspendido');
    expect(estadoEmpaquetado(bits, 'sepelio')).toBeNull();
  });

  it('sabe si un punto está dentro de un polígono, y cuánto mide', () => {
    const cuadrado: [number, number][] = [[-54.69, -27.04], [-54.68, -27.04], [-54.68, -27.03], [-54.69, -27.03]];
    expect(puntoEnPoligono([-54.685, -27.035], cuadrado)).toBe(true);
    expect(puntoEnPoligono([-54.675, -27.035], cuadrado)).toBe(false);
    expect(puntoEnPoligono([-54.685, -27.045], cuadrado)).toBe(false);
    // Con forma de L: el hueco de la L queda afuera.
    const ele: [number, number][] = [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]];
    expect(puntoEnPoligono([0.5, 1.5], ele)).toBe(true);
    expect(puntoEnPoligono([1.5, 1.5], ele)).toBe(false);
    // 0,01° × 0,01° a esta latitud: unos 992 m × 1.105 m ≈ 110 hectáreas.
    expect(superficieHa(cuadrado)).toBeGreaterThan(105);
    expect(superficieHa(cuadrado)).toBeLessThan(115);
    expect(superficieHa(cuadrado.slice(0, 2))).toBe(0);
  });
});

describe('las casas', () => {
  it('trae el estado de cada servicio, la categoría y la ruta, en columnas del mismo largo', async () => {
    const m = await conexiones();
    expect(m.ids.length).toBeGreaterThan(30);
    for (const columna of [m.lng, m.lat, m.zona, m.estado, m.servicios, m.orientacion, m.estados, m.categoria, m.ruta, m.orden]) expect(columna).toHaveLength(m.ids.length);
    const filas = await sql<{ conexion_id: number; servicio: ServicioConexion; estado: EstadoServicio; categoria: string | null }>(
      `SELECT conexion_id, servicio, estado, categoria FROM servicios_conexion WHERE cooperativa_id = :a`,
    );
    for (const f of filas) {
      const i = m.ids.indexOf(f.conexion_id);
      expect(estadoEmpaquetado(m.estados[i]!, f.servicio)).toBe(f.estado === 'baja' ? null : f.estado);
      if (f.servicio === 'energia' && f.estado !== 'baja') expect(CATEGORIAS[m.categoria[i]!]).toBe(f.categoria);
    }
    const rutas = await sql<{ id: number; ruta_id: number | null; orden_ruta: number | null }>(`SELECT id, ruta_id, orden_ruta FROM conexiones WHERE cooperativa_id = :a`);
    for (const r of rutas) {
      const i = m.ids.indexOf(r.id);
      expect(m.rutas[m.ruta[i]!]?.id ?? null).toBe(r.ruta_id);
      expect(m.orden[i]).toBe(r.orden_ruta ?? 0);
    }
  });
});

describe('capas', () => {
  it('la deuda de todas las casas es la deuda del tablero, servicio por servicio', async () => {
    const [k, t] = [await capas(), await tablero()];
    expect(k.hoy).toBe(HOY);
    expect(k.facturasParaCorte).toBe(2);
    expect(suma(...k.deudas.map((d) => d[2]))).toBe(t.indicadores.deuda);
    for (const [i, servicio] of SERVICIOS_CONEXION.entries()) {
      expect(suma(...k.deudas.filter((d) => d[1] === i).map((d) => d[2]))).toBe((await tablero(`?servicio=${servicio}`)).indicadores.deuda);
    }
    // Una fila cualquiera, contra la base.
    const [conexionId, servicio, deuda, vencidas] = k.deudas[0]!;
    const [d] = await sql<{ deuda: string; vencidas: string }>(
      `SELECT CAST(sum(c.saldo) AS numeric(16,2)) AS deuda, count(CASE WHEN c.vence_el < CAST(:hoy AS date) THEN 1 END) AS vencidas
       FROM comprobantes c WHERE ${DEUDA} AND c.conexion_id = :conexionId AND c.servicio = :servicio`,
      { coop: w.a.id, conexionId, servicio: SERVICIOS_CONEXION[servicio] },
    );
    expect(deuda).toBe(Number(d!.deuda));
    expect(vencidas).toBe(Number(d!.vencidas));
  });

  it('las casas «en mora» son las del informe de cortes sugeridos', async () => {
    const [m, k] = [await conexiones(), await capas()];
    const enMora = k.deudas.filter(([conexionId, servicio, deuda, vencidas]) => {
      const estado = estadoEmpaquetado(m.estados[m.ids.indexOf(conexionId)]!, SERVICIOS_CONEXION[servicio]!);
      return situacionDe({ estado, deuda, vencidas }, k.facturasParaCorte) === 'en_mora';
    });
    const informe: InformeDatos = (await gerencia.get('/api/v1/informes/cortes')).body.data;
    expect(enMora.length).toBe(informe.total);
    expect(enMora.length).toBeGreaterThan(0);
  });

  it('el consumo es el del último mes facturado', async () => {
    const [k, t] = [await capas(), await tablero()];
    expect(k.consumo.periodo).toEqual({ anio: t.periodo.anio, mes: t.periodo.mes });
    expect(k.consumo.filas.reduce((s, f) => s + f[1], 0)).toBe(Number(t.indicadores.consumo.energia));
    expect(k.consumo.filas.reduce((s, f) => s + f[2], 0)).toBe(Number(t.indicadores.consumo.agua));
  });

  it('reclamos sin resolver y cortes que todavía no terminaron', async () => {
    let k = await capas();
    const abiertos = Number(await valor(`SELECT count(*) AS v FROM reclamos WHERE cooperativa_id = :a AND estado <> 'resuelto'`));
    expect(k.reclamos).toHaveLength(abiertos);
    expect(abiertos).toBeGreaterThan(0);
    for (const r of k.reclamos) {
      expect(r.referencia).toMatch(/^R-\d{5}$/);
      expect(Number.isFinite(r.lng) && Number.isFinite(r.lat)).toBe(true);
      expect(r.tipoNombre.length).toBeGreaterThan(3);
    }
    expect(k.cortes).toHaveLength(2);
    expect(k.cortes.every((c) => Date.parse(c.hasta) > Date.now())).toBe(true);

    // Resolver un reclamo y cancelar un corte los saca del mapa.
    expect((await admin.post(`/api/v1/reclamos/${k.reclamos[0]!.id}/estado`).send({ estado: 'resuelto', resolucion: 'Se arregló en el momento.' })).status).toBe(200);
    expect((await admin.post(`/api/v1/cortes/${k.cortes[0]!.id}/cancelar`)).status).toBe(200);
    k = await capas();
    expect(k.reclamos).toHaveLength(abiertos - 1);
    expect(k.cortes).toHaveLength(1);
  });
});

describe('lecturas en vivo', () => {
  it('muestra el mismo avance que ve la oficina', async () => {
    const l = await lecturas();
    const resumen: ResumenLecturas = (await admin.get('/api/v1/lecturas/resumen')).body.data;
    expect(l.periodo).toEqual({ anio: Number(HOY.slice(0, 4)), mes: Number(HOY.slice(5, 7)) });
    expect(l.total).toBe(resumen.total);
    expect(l.leidos).toBe(resumen.leidos);
    expect(l.conexiones.reduce((s, c) => s + c[1], 0)).toBe(l.total);
    expect(l.conexiones.reduce((s, c) => s + c[2], 0)).toBe(l.leidos);
    expect(l.conexiones.some((c) => c[2] === 0)).toBe(true);
  });

  it('una lectura recién cargada cambia el punto de esa casa (flujo 2 del SPEC)', async () => {
    const antes = await lecturas();
    // Dos casas con un solo medidor, todavía sin leer.
    const pendientes = antes.conexiones.filter((c) => c[1] === 1 && c[2] === 0).slice(0, 2);
    expect(pendientes).toHaveLength(2);
    const medidores = await sql<{ conexion_id: number; medidor_id: number; periodo_id: number; anterior: string | null; promedio: string | null }>(
      `SELECT sc.conexion_id, m.id AS medidor_id, p.id AS periodo_id, (SELECT max(x.valor) FROM lecturas x WHERE x.medidor_id = m.id) AS anterior,
              (SELECT avg(x.consumo) FROM lecturas x WHERE x.medidor_id = m.id AND x.consumo IS NOT NULL) AS promedio
       FROM medidores m JOIN servicios_conexion sc ON sc.id = m.servicio_conexion_id
       JOIN periodos p ON p.cooperativa_id = m.cooperativa_id AND p.servicio = sc.servicio AND p.estado = 'en_lectura'
       WHERE m.cooperativa_id = :a AND m.retirado_el IS NULL AND sc.estado <> 'baja' AND sc.conexion_id IN (:ids)`,
      { ids: pendientes.map((c) => c[0]) },
    );
    const de = (conexionId: number) => medidores.find((m) => m.conexion_id === conexionId)!;
    const [normal, conNovedad] = [de(pendientes[0]![0]), de(pendientes[1]![0])];
    const res = await admin.post('/api/v1/lecturas/sync').send({
      lecturas: [
        { uuid: randomUUID(), periodoId: normal.periodo_id, medidorId: normal.medidor_id, // Un consumo como el de siempre: no dispara ninguna anomalía.
          valor: Math.round(Number(normal.anterior ?? 0) + Number(normal.promedio ?? 10)), tomadaEl: new Date().toISOString() },
        { uuid: randomUUID(), periodoId: conNovedad.periodo_id, medidorId: conNovedad.medidor_id, valor: null, novedad: 'perro', tomadaEl: new Date().toISOString() },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.data.resultados.map((r: { estado: string }) => r.estado)).toEqual(['guardada', 'guardada']);

    const despues = await lecturas();
    expect(despues.leidos).toBe(antes.leidos + 2);
    expect(despues.conexiones.find((c) => c[0] === normal.conexion_id)).toEqual([normal.conexion_id, 1, 1, 0]);
    // La que no se pudo leer por una novedad queda marcada para que la oficina la mire.
    expect(despues.conexiones.find((c) => c[0] === conNovedad.conexion_id)).toEqual([conNovedad.conexion_id, 1, 1, 1]);
    // El resto no cambió.
    expect(despues.conexiones.filter((c) => c[2] !== antes.conexiones.find((x) => x[0] === c[0])![2])).toHaveLength(2);
  });
});

describe('ficha de una casa', () => {
  it('trae deuda, situación, consumo de 12 meses, última lectura y reclamos', async () => {
    const k = await capas();
    const conexionId = k.deudas[0]![0];
    const f: FichaMapa = (await gerencia.get(`${api}/conexiones/${conexionId}`)).body.data;
    const propias = k.deudas.filter((d) => d[0] === conexionId);
    expect(f.id).toBe(conexionId);
    expect(f.socio.nombre.length).toBeGreaterThan(2);
    expect(f.deuda.total).toBe(suma(...propias.map((d) => d[2])));
    expect(f.deuda.vencidas).toBe(propias.reduce((s, d) => s + d[3], 0));
    expect(f.deuda.facturas).toBe(Number(await valor(`SELECT count(*) AS v FROM comprobantes c WHERE ${DEUDA} AND c.conexion_id = :conexionId`, { coop: w.a.id, conexionId })));
    expect(f.deuda.masVieja).toBe(await valor(`SELECT to_char(min(c.vence_el), 'YYYY-MM-DD') AS v FROM comprobantes c WHERE ${DEUDA} AND c.conexion_id = :conexionId`, { coop: w.a.id, conexionId }));
    expect(['con_deuda', 'en_mora', 'cortado']).toContain(f.situacion);

    const energia = f.consumo.find((c) => c.servicio === 'energia')!;
    expect(energia.unidad).toBe('kWh');
    expect(energia.meses).toHaveLength(12);
    expect(energia.meses.at(-1)).toMatchObject(k.consumo.periodo!);
    expect(energia.meses.at(-1)!.consumo).toBe(k.consumo.filas.find((c) => c[0] === conexionId)![1]);
    expect(f.lecturas.length).toBeGreaterThan(0);
    expect(f.lecturas[0]!.medidor.length).toBeGreaterThan(3);
    expect(['leida', 'pendiente']).toContain(f.lecturaDelMes);
  });

  it('una casa al día, con un reclamo abierto', async () => {
    const k = await capas();
    const reclamo = k.reclamos.find((r) => r.conexionId !== null)!;
    const f: FichaMapa = (await gerencia.get(`${api}/conexiones/${reclamo.conexionId}`)).body.data;
    expect(f.reclamos.map((r) => r.id)).toContain(reclamo.id);
    expect(f.reclamos.find((r) => r.id === reclamo.id)).toMatchObject({ referencia: reclamo.referencia, tipoNombre: reclamo.tipoNombre, estado: reclamo.estado });

    const conDeuda = new Set(k.deudas.map((d) => d[0]));
    const m = await conexiones();
    const alDia = m.ids.find((id, i) => !conDeuda.has(id) && estadoEmpaquetado(m.estados[i]!, 'energia') === 'activo')!;
    const limpia: FichaMapa = (await gerencia.get(`${api}/conexiones/${alDia}`)).body.data;
    expect(limpia.deuda).toEqual({ total: '0.00', facturas: 0, vencidas: 0, masVieja: null });
    expect(['al_dia', 'cortado']).toContain(limpia.situacion);
  });

  it('una casa de otra cooperativa o que no existe: 404', async () => {
    const [deB] = await sql<{ id: number }>(`SELECT id FROM conexiones WHERE cooperativa_id = :b LIMIT 1`);
    expect((await gerencia.get(`${api}/conexiones/${deB!.id}`)).status).toBe(404);
    expect((await gerencia.get(`${api}/conexiones/999999`)).status).toBe(404);
    expect((await gerencia.get(`${api}/conexiones/abc`)).status).toBe(404);
  });
});

describe('área dibujada', () => {
  it('un área que abarca todo da los totales del tablero', async () => {
    const [m, t] = [await conexiones(), await tablero()];
    const r = await area({ ids: m.ids });
    expect(r.conexiones).toBe(m.ids.length);
    expect(r.socios).toBe(Number(await valor(`SELECT count(DISTINCT socio_id) AS v FROM conexiones WHERE cooperativa_id = :a AND eliminado_el IS NULL`)));
    expect(r.deuda).toBe(t.indicadores.deuda);
    expect(r.deudaVencida).toBe(t.indicadores.deudaVencida);
    expect(r.consumo).toEqual({ periodo: { anio: t.periodo.anio, mes: t.periodo.mes }, energia: t.indicadores.consumo.energia, agua: t.indicadores.consumo.agua });
    expect(Object.values(r.situacion).reduce((s, n) => s + n, 0)).toBe(r.conexiones);
    expect(r.situacion.en_mora).toBeGreaterThan(0);
    expect(r.porServicio.energia).toBe(Number(await valor(`SELECT count(*) AS v FROM servicios_conexion WHERE cooperativa_id = :a AND servicio = 'energia' AND estado <> 'baja'`)));
    expect(r.reclamosAbiertos).toBe(Number(await valor(`SELECT count(*) AS v FROM reclamos WHERE cooperativa_id = :a AND estado <> 'resuelto' AND conexion_id IS NOT NULL`)));
    expect(r.servicio).toBeNull();
  });

  it('con un servicio, la deuda y las conexiones son las de ese servicio', async () => {
    const m = await conexiones();
    const agua = await area({ ids: m.ids, servicio: 'agua' });
    expect(agua.servicio).toBe('agua');
    expect(agua.deuda).toBe((await tablero('?servicio=agua')).indicadores.deuda);
    expect(agua.conexiones).toBe(Number(await valor(`SELECT count(*) AS v FROM servicios_conexion WHERE cooperativa_id = :a AND servicio = 'agua' AND estado <> 'baja'`)));
    expect(agua.conexiones).toBeLessThan(m.ids.length);
  });

  it('un área chica suma solo sus casas; los ids ajenos o repetidos no cuentan', async () => {
    const k = await capas();
    const elegidas = [...new Set(k.deudas.map((d) => d[0]))].slice(0, 3);
    const esperado = suma(...k.deudas.filter((d) => elegidas.includes(d[0])).map((d) => d[2]));
    const r = await area({ ids: elegidas });
    expect(r.conexiones).toBe(3);
    expect(r.deuda).toBe(esperado);
    const deB = (await sql<{ id: number }>(`SELECT id FROM conexiones WHERE cooperativa_id = :b`)).map((c) => c.id);
    expect(await area({ ids: [...elegidas, ...elegidas, ...deB] })).toEqual(r);
    expect((await area({ ids: deB })).conexiones).toBe(0);
    expect((await gerencia.post(`${api}/area`).send({ ids: [] })).status).toBe(400);
    expect((await gerencia.post(`${api}/area`).send({ ids: elegidas, servicio: 'gas' })).status).toBe(400);
  });

  it('se exporta a Excel, CSV y PDF, y queda registrado', async () => {
    const k = await capas();
    const elegidas = [...new Set(k.deudas.map((d) => d[0]))].slice(0, 5);
    const r = await area({ ids: elegidas });
    const xlsx = await gerencia.post(`${api}/area`).send({ ids: elegidas, formato: 'xlsx' }).responseType('blob');
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers['content-disposition']).toMatch(/^attachment; filename="conexiones-del-area-dibujada-en-el-mapa-\d{4}-\d{2}-\d{2}\.xlsx"$/);
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(xlsx.body as Parameters<ExcelJS.Workbook['xlsx']['load']>[0]);
    const hoja = libro.worksheets[0]!;
    const titulos = (hoja.getRow(5).values as unknown[]).slice(1);
    const total = hoja.getRow(6 + elegidas.length);
    expect(total.getCell(1).value).toBe('Total');
    expect(total.getCell(titulos.indexOf('Debe') + 1).value).toBeCloseTo(Number(r.deuda), 2);
    expect(hoja.getCell(3, 1).value).toBe('5 conexiones · Todos los servicios');

    const csv = await gerencia.post(`${api}/area`).send({ ids: elegidas, formato: 'csv' }).responseType('blob');
    expect((csv.body as Buffer).toString('utf8').trimEnd().split('\r\n')).toHaveLength(1 + 5 + 1);
    const pdf = await gerencia.post(`${api}/area`).send({ ids: elegidas, servicio: 'energia', formato: 'pdf' }).responseType('blob');
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');

    const rastros = await runUnscoped(() => Auditoria.findAll({ where: { accion: 'exportar_area_mapa' }, order: [['id', 'ASC']] }));
    expect(rastros).toHaveLength(3);
    expect(rastros.at(-1)).toMatchObject({ cooperativaId: w.a.id, usuarioId: w.demoA.id });
    expect(rastros.at(-1)!.despuesJson).toMatchObject({ formato: 'pdf', conexiones: 5, servicio: 'energia' });
  });
});

describe('permisos y aislamiento', () => {
  it('el mapa no es para caja, operarios ni socios', async () => {
    const [m] = [await conexiones()];
    for (const email of ['caja@a.test', 'operario@a.test', 'socio@b.test']) {
      const agente = await loginAs(email);
      for (const ruta of ['capas', 'lecturas', `conexiones/${m.ids[0]}`]) expect((await agente.get(`${api}/${ruta}`)).status, `${email} ${ruta}`).toBe(403);
      expect((await agente.post(`${api}/area`).send({ ids: [m.ids[0]] })).status).toBe(403);
    }
  });

  it('cada cooperativa ve solo sus casas, su deuda, sus reclamos y sus lecturas', async () => {
    const [mA, mB, kB, lB] = [await conexiones(), await conexiones(adminB), await capas(adminB), await lecturas(adminB)];
    const deB = new Set(mB.ids);
    expect(mA.ids.some((id) => deB.has(id))).toBe(false);
    expect(kB.deudas.every((d) => deB.has(d[0]))).toBe(true);
    expect(kB.consumo.filas.every((c) => deB.has(c[0]))).toBe(true);
    expect(lB.conexiones.every((c) => deB.has(c[0]))).toBe(true);
    expect(suma(...kB.deudas.map((d) => d[2]))).toBe(await valor(`SELECT CAST(COALESCE(sum(c.saldo), 0) AS numeric(16,2)) AS v FROM comprobantes c WHERE ${DEUDA}`, { coop: w.b.id }));
    expect(kB.reclamos).toHaveLength(Number(await valor(`SELECT count(*) AS v FROM reclamos WHERE cooperativa_id = :b AND estado <> 'resuelto'`)));
  });
});
