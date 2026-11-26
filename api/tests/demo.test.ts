// Fase 9: el recorrido de la demo (SPEC sección 11), de punta a punta y en orden, contra la API.
// Cada flujo ya tiene sus tests propios; acá se comprueba que encadenados no se pisan: lo que carga
// el operario llega al mapa y a la factura, la factura nueva la ve y la paga el socio, el cobro de
// la caja y el pago online aparecen en el tablero, y la segunda cooperativa no ve nada de eso.
import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { QueryTypes } from 'sequelize';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  aCentavos,
  deCentavos,
  estadoEmpaquetado,
  situacionDe,
  type CasaRuta,
  type CuentaSocio,
  type EstadoCaja,
  type EstadoFacturacion,
  type EstadoPagoOnline,
  type FacturaSocioDetalle,
  type InformeDatos,
  type InicioSocio,
  type IntentoCreado,
  type MapaCapas,
  type MapaConexiones,
  type MapaLecturas,
  type Me,
  type MedidorRuta,
  type MisRutas,
  type PaginaComprobantes,
  type ReciboDetalle,
  type ResultadoBusqueda,
  type ResultadoSync,
  type ResumenArea,
  type RutaDetalle,
  type Tablero,
} from '../src/shared';
import { sequelize } from '../src/db';
import { esperarProcesos } from '../src/lib/facturacion';
import { hoy } from '../src/lib/tarifas';
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
import { app, createUser, loginAs, request, resetWorld } from './helpers';

const HOY = hoy();
const M = { anio: Number(HOY.slice(0, 4)), mes: Number(HOY.slice(5, 7)) };
const PLANES_PRUEBA = [
  { servicio: 'internet' as const, nombre: PLANES.internet50, precio: '20000.00' },
  { servicio: 'internet' as const, nombre: PLANES.internet100, precio: '30000.00' },
  { servicio: 'tv' as const, nombre: PLANES.tv, precio: '15000.00' },
];

let w: Awaited<ReturnType<typeof resetWorld>>;
type Agente = Awaited<ReturnType<typeof loginAs>>;
let operario: Agente;
let oficina: Agente;
let socio: Agente;
let caja: Agente;
let gerencia: Agente;

const sql = <T extends object>(texto: string, replacements: Record<string, unknown> = {}) =>
  sequelize.query<T>(texto, { replacements: { a: w.a.id, b: w.b.id, hoy: HOY, ...replacements }, type: QueryTypes.SELECT });
const suma = (...importes: (string | number)[]) => deCentavos(importes.reduce<number>((t, i) => t + (typeof i === 'number' ? Math.round(i * 100) : aCentavos(i)), 0));
const tablero = async (agente: Agente = gerencia, consulta = ''): Promise<Tablero> => (await agente.get(`/api/v1/tablero${consulta}`)).body.data;
const lecturasDelMapa = async (): Promise<MapaLecturas> => (await gerencia.get('/api/v1/mapa/lecturas')).body.data;

/** Lo que cada flujo le deja al siguiente. */
const recorrido: { leidas: number[]; conAnomalia: number; pagadoOnline: string; cobradoEnCaja: string } = { leidas: [], conAnomalia: 0, pagadoOnline: '0.00', cobradoEnCaja: '0.00' };

beforeAll(async () => {
  w = await resetWorld();
  // El operario se crea antes del padrón: así las rutas quedan a su nombre.
  await createUser({ cooperativaId: w.a.id, email: 'operario@a.test', roles: ['operario'] });
  await createUser({ cooperativaId: w.a.id, email: 'socio@a.test', roles: ['socio'] });
  await createUser({ cooperativaId: w.a.id, email: 'facturacion@a.test', roles: ['facturacion'] });
  await cargarPadron(generarPadron(callesInventadas(), { hogares: 40, semilla: 7, proporcionUrbana: 0.75, socioDemo: { nombre: 'Prueba, Socia', email: 'socia@a.test' } }), {
    cooperativaId: w.a.id,
    planes: PLANES_PRUEBA,
    emailSocioDemo: 'socio@a.test',
  });
  await cargarPadron(generarPadron(callesInventadas(), { hogares: 40, semilla: 8 }), { cooperativaId: w.b.id, planes: PLANES_PRUEBA });
  for (const [coop, semilla] of [[w.a, 7], [w.b, 8]] as const) {
    await cargarTarifas(coop.id, TARIFAS_ARROYO_DEL_MONTE);
    await cargarLecturas(coop.id, { hoy: HOY, semilla, avance: [0.5, 0] });
    await cargarFacturas(coop.id, { semilla });
    await cargarPagos(coop.id, { semilla });
    await cargarReclamos(coop.id, { semilla, hoy: HOY, cantidad: 12 });
    await cargarBalance(coop.id, { semilla, generacionPropia: false });
  }
  await cargarProductos(w.a.id, [{ nombre: 'Garrafa de 10 kg', precio: '18500.00', stock: 5 }]);
  operario = await loginAs('operario@a.test');
  oficina = await loginAs('facturacion@a.test');
  socio = await loginAs('socio@a.test');
  caja = await loginAs('caja@a.test');
  gerencia = await loginAs('demo@a.test');
}, 180_000);
afterAll(() => sequelize.close());

describe('recorrido de la demo (SPEC 11)', () => {
  it('1 y 2 · el operario carga lecturas (una con anomalía, dos sin señal) y el mapa de gerencia las ve', async () => {
    const mias: MisRutas = (await operario.get('/api/v1/lecturas/mis-rutas')).body.data;
    expect(mias.periodo).toEqual(M);
    // Una ruta con al menos siete casas enteras por leer (todos sus medidores sin lectura y con historial).
    let casas: CasaRuta[] = [];
    for (const r of mias.rutas) {
      const ruta: RutaDetalle = (await operario.get(`/api/v1/lecturas/rutas/${r.id}`)).body.data;
      casas = ruta.lista.filter((c) => c.medidores.some((m) => m.servicio === 'energia') && c.medidores.every((m) => m.lectura === null && m.anterior !== null && (m.promedio ?? 0) > 0)).slice(0, 7);
      if (casas.length === 7) break;
    }
    expect(casas).toHaveLength(7);
    const lectura = (m: MedidorRuta, veces = 1) => ({ uuid: randomUUID(), periodoId: m.periodoId, medidorId: m.medidorId, valor: Math.round(m.anterior!.valor + m.promedio! * veces), tomadaEl: new Date().toISOString() });
    const deCasa = (c: CasaRuta, vecesEnergia = 1) => c.medidores.map((m) => lectura(m, m.servicio === 'energia' ? vecesEnergia : 1));
    const enviar = async (lecturas: unknown[]): Promise<ResultadoSync[]> => (await operario.post('/api/v1/lecturas/sync').send({ lecturas })).body.data.resultados;
    const antes = await lecturasDelMapa();

    // Con señal: cinco casas, una con un consumo de energía cinco veces mayor al de siempre.
    const normales = casas.slice(0, 4).flatMap((c) => deCasa(c));
    const rara = deCasa(casas[4]!, 5);
    const primero = await enviar([...normales, ...rara]);
    expect(primero.every((r) => r.estado === 'guardada')).toBe(true);
    expect(primero.slice(0, normales.length).every((r) => !r.anomalia)).toBe(true);
    expect(primero.slice(normales.length).some((r) => r.anomalia)).toBe(true);

    // «Modo avión»: dos casas más quedan en el teléfono y salen juntas al volver la señal. Si el
    // teléfono reintenta lo que ya había mandado, no se duplica nada.
    const sinSenal = casas.slice(5, 7).flatMap((c) => deCasa(c));
    const segundo = await enviar([...sinSenal, normales[0]]);
    expect(segundo.slice(0, sinSenal.length).every((r) => r.estado === 'guardada')).toBe(true);
    expect(segundo.at(-1)!.estado).toBe('repetida');

    // Flujo 2: en el mapa, esas siete casas pasaron a leídas; la de la anomalía queda marcada.
    const despues = await lecturasDelMapa();
    expect(despues.leidos).toBe(antes.leidos + casas.reduce((t, c) => t + c.medidores.length, 0));
    for (const c of casas) expect(despues.conexiones.find((x) => x[0] === c.conexionId)!.slice(1, 3)).toEqual([c.medidores.length, c.medidores.length]);
    expect(despues.conexiones.find((x) => x[0] === casas[4]!.conexionId)![3]).toBe(1);
    expect(despues.conexiones.find((x) => x[0] === casas[0]!.conexionId)![3]).toBe(0);
    recorrido.leidas = casas.map((c) => c.conexionId);
    recorrido.conAnomalia = casas[4]!.conexionId;
  });

  it('3 · facturación cierra la lectura, pre-factura, revisa una rara y emite el mes completo', async () => {
    const estado = async (): Promise<EstadoFacturacion> => (await oficina.get('/api/v1/facturacion/estado')).body.data;
    expect((await estado()).mes).toMatchObject({ ...M, estado: 'en_lectura' });
    // Lo que no se llegó a leer se estima; con eso la lectura se puede cerrar.
    expect((await oficina.post('/api/v1/lecturas/estimar-pendientes')).status).toBe(200);
    expect((await oficina.post('/api/v1/facturacion/prefacturar')).status).toBe(202);
    await esperarProcesos();
    const pre = await estado();
    expect(pre.mes!.estado).toBe('prefacturado');
    expect(pre.proceso?.estado ?? 'terminado').toBe('terminado');
    expect(pre.prefactura!.cantidad).toBeGreaterThan(40);
    expect(pre.prefactura!.errores).toBe(0);

    // La casa del consumo ×5 sale separada para mirarla antes de emitir.
    const raras: PaginaComprobantes = (await oficina.get(`/api/v1/facturacion/comprobantes?anio=${M.anio}&mes=${M.mes}&vista=raras`)).body.data;
    const [laRara] = await sql<{ id: number }>(`SELECT id FROM comprobantes WHERE cooperativa_id = :a AND conexion_id = :c AND anio = :anio AND mes = :mes AND servicio IN ('energia', 'agua') AND rara IS NOT NULL`, { c: recorrido.conAnomalia, ...M });
    expect(raras.filas.map((f) => f.id)).toContain(laRara!.id);
    expect((await oficina.post(`/api/v1/facturacion/comprobantes/${laRara!.id}/revisar`)).status).toBe(200);
    expect((await estado()).prefactura!.rarasSinRevisar).toBe(pre.prefactura!.rarasSinRevisar - 1);

    expect((await oficina.post('/api/v1/facturacion/emitir')).status).toBe(202);
    await esperarProcesos();
    const emitido = await estado();
    expect(emitido.mes!.estado).toBe('emitido');
    expect(emitido.emision!.cantidad).toBe(pre.prefactura!.cantidad);
    expect(emitido.emision!.pendientes).toBe(0);
    expect(emitido.emision!.total).toBe(pre.prefactura!.total);

    // Criterios del SPEC 12 sobre todo lo emitido: los renglones suman el total y el saldo es total menos pagos.
    const [control] = await sql<{ facturas: string; renglones_mal: string; saldo_mal: string }>(
      `SELECT count(*) AS facturas,
              count(CASE WHEN c.total <> (SELECT COALESCE(sum(r.importe), 0) FROM comprobante_renglones r WHERE r.comprobante_id = c.id) THEN 1 END) AS renglones_mal,
              count(CASE WHEN GREATEST(c.total, 0) - c.saldo <> COALESCE((SELECT sum(x.importe) FROM pago_aplicaciones x JOIN pagos p ON p.id = x.pago_id AND p.estado = 'acreditado' WHERE x.comprobante_id = c.id), 0) THEN 1 END) AS saldo_mal
       FROM comprobantes c WHERE c.cooperativa_id = :a AND c.tipo = 'factura' AND c.estado IN ('emitido', 'pagado')`,
    );
    expect(Number(control!.facturas)).toBeGreaterThan(500);
    expect(Number(control!.renglones_mal)).toBe(0);
    expect(Number(control!.saldo_mal)).toBe(0);
  });

  it('4 · el socio ve la factura nueva, entiende por qué paga eso y la paga online', async () => {
    const inicio: InicioSocio = (await socio.get('/api/v1/socio/inicio')).body.data;
    const nueva = inicio.pendientes.find((f) => f.anio === M.anio && f.mes === M.mes && f.servicio === 'energia')!;
    expect(nueva).toBeTruthy();
    expect(nueva.estado).toBe('emitido');

    const detalle: FacturaSocioDetalle = (await socio.get(`/api/v1/socio/facturas/${nueva.id}`)).body.data;
    const porQue = detalle.porQue!;
    expect(deCentavos(porQue.partes.reduce((t, p) => t + aCentavos(p.importe), 0))).toBe(detalle.total);
    // La socia de la demo tiene subsidio y consume por encima del tope: eso es lo que se le explica.
    expect(porQue.subsidio).not.toBeNull();
    expect(porQue.subsidio!.fuera).toBeGreaterThan(0);
    expect(porQue.frases[0]).toMatch(/^Tenés subsidio en los primeros \d+ kWh/);
    expect((await socio.get(`/api/v1/socio/facturas/${nueva.id}/pdf`)).status).toBe(200);

    const intento: IntentoCreado = (await socio.post('/api/v1/socio/pagos').send({ comprobantes: [nueva.id] })).body.data;
    expect(intento.total).toBe(nueva.saldo);
    // La pasarela de prueba hace de banco: aprueba, y la API acredita por el aviso, no por la vuelta del navegador.
    const banco = await request(app).post(`/api/v1/publico/pasarela/${intento.intentoId}`).send({ firma: intento.redireccion.campos.firma, decision: 'aprobar', medio: 'debito' });
    expect(banco.body.data.estado).toBe('aprobado');
    const pago: EstadoPagoOnline = (await socio.get(`/api/v1/socio/pagos/intentos/${intento.intentoId}`)).body.data;
    expect(pago.estado).toBe('aprobado');
    expect(pago.recibo!.referencia).toMatch(/^Rcbo /);

    const despues: InicioSocio = (await socio.get('/api/v1/socio/inicio')).body.data;
    expect(suma(despues.deuda, nueva.saldo)).toBe(inicio.deuda);
    expect(despues.pendientes.map((f) => f.id)).not.toContain(nueva.id);
    expect(despues.ultimoPago!.importe).toBe(nueva.saldo);
    recorrido.pagadoOnline = nueva.saldo;
  });

  it('5 · otro socio paga en efectivo en el mostrador; la caja cierra con su arqueo', async () => {
    const [deudor] = await sql<{ id: number; numero: number }>(
      `SELECT s.id, s.numero FROM socios s WHERE s.cooperativa_id = :a AND s.usuario_id IS NULL
         AND EXISTS (SELECT 1 FROM comprobantes c WHERE c.socio_id = s.id AND c.tipo = 'factura' AND c.estado = 'emitido' AND c.saldo = c.total AND c.vence_el < CAST(:hoy AS date))
       ORDER BY s.id LIMIT 1`,
    );
    expect((await caja.post('/api/v1/caja/abrir').send({ fondoInicial: '20000' })).status).toBe(201);
    // Un solo campo: alcanza con el número de socio.
    const encontrado: ResultadoBusqueda = (await caja.get(`/api/v1/caja/buscar?q=${deudor!.numero}`)).body.data;
    expect(encontrado.socios[0]!.id).toBe(deudor!.id);
    const cuenta: CuentaSocio = (await caja.get(`/api/v1/caja/socios/${deudor!.id}`)).body.data;
    const factura = cuenta.pendientes[0]!;
    // Paga con billetes: se redondea para arriba y el sistema calcula el vuelto.
    const recibido = deCentavos(Math.ceil(aCentavos(factura.saldo) / 100_000) * 100_000);
    const cobro = await caja.post('/api/v1/caja/cobros').send({ clave: randomUUID(), socioId: deudor!.id, aplicaciones: [{ comprobanteId: factura.id, importe: factura.saldo }], items: [], medio: 'efectivo', recibido });
    expect(cobro.status).toBe(201);
    const recibo: ReciboDetalle = cobro.body.data;
    expect(recibo.importe).toBe(factura.saldo);
    expect(suma(recibo.vuelto!, factura.saldo)).toBe(recibido);
    expect((await caja.get(`/api/v1/caja/cobros/${recibo.id}/recibo?formato=ticket`)).status).toBe(200);
    expect((await caja.get(`/api/v1/caja/cobros/${recibo.id}/recibo?formato=a4`)).status).toBe(200);

    const abierta: EstadoCaja = (await caja.get('/api/v1/caja/estado')).body.data;
    expect(abierta.caja!.efectivoEsperado).toBe(suma('20000.00', factura.saldo));
    const cierre = await caja.post('/api/v1/caja/cerrar').send({ contado: abierta.caja!.efectivoEsperado });
    expect(cierre.status).toBe(200);
    expect(cierre.body.data.diferencia).toBe('0.00');
    expect(((await caja.get('/api/v1/caja/estado')).body.data as EstadoCaja).caja).toBeNull();
    recorrido.cobradoEnCaja = factura.saldo;
  });

  it('6 · gerencia: el tablero refleja lo cobrado, exporta los morosos a Excel y ve la deuda de un área del mapa', async () => {
    const t = await tablero();
    // El mes recién emitido es el que muestra el tablero, con el pago online ya contado.
    expect(t.periodo).toEqual({ ...M, estado: 'emitido' });
    expect(Number(t.indicadores.facturado)).toBeGreaterThan(0);
    expect(aCentavos(t.indicadores.cobrado)).toBeGreaterThanOrEqual(aCentavos(recorrido.pagadoOnline));
    // Lo que entró hoy, por la caja y por el pago online.
    expect(aCentavos(t.recaudacion.total)).toBeGreaterThanOrEqual(aCentavos(suma(recorrido.pagadoOnline, recorrido.cobradoEnCaja)));
    expect(t.recaudacion.porCajero.some((c) => c.cajeroId === w.cajeroA.id)).toBe(true);
    expect(t.recaudacion.porCajero.some((c) => c.cajeroId === null)).toBe(true);
    expect(t.lecturas.periodo).toBeNull();

    // El informe de morosos, en Excel: su total es la deuda del tablero.
    const informe: InformeDatos = (await gerencia.get('/api/v1/informes/deuda')).body.data;
    const xlsx = await gerencia.get('/api/v1/informes/deuda?formato=xlsx').responseType('blob');
    expect(xlsx.status).toBe(200);
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(xlsx.body as Parameters<ExcelJS.Workbook['xlsx']['load']>[0]);
    const debe = informe.columnas.findIndex((c) => c.clave === 'deuda') + 1;
    expect(libro.worksheets[0]!.getRow(6 + informe.total).getCell(debe).value).toBeCloseTo(Number(t.indicadores.deuda), 2);

    // El mapa, filtrado por «energía + en mora», y un área con algunas de esas casas.
    const casas: MapaConexiones = (await gerencia.get('/api/v1/mapa/conexiones')).body.data;
    const capas: MapaCapas = (await gerencia.get('/api/v1/mapa/capas')).body.data;
    const ENERGIA = 0;
    const enMora = capas.deudas.filter(([id, servicio, deuda, vencidas]) => servicio === ENERGIA && situacionDe({ estado: estadoEmpaquetado(casas.estados[casas.ids.indexOf(id)]!, 'energia'), deuda, vencidas }, capas.facturasParaCorte) === 'en_mora');
    expect(enMora.length).toBeGreaterThan(0);
    const delArea = enMora.slice(0, 3);
    const area: ResumenArea = (await gerencia.post('/api/v1/mapa/area').send({ ids: delArea.map((d) => d[0]), servicio: 'energia' })).body.data;
    expect(area.conexiones).toBe(delArea.length);
    expect(area.situacion.en_mora).toBe(delArea.length);
    expect(area.deuda).toBe(suma(...delArea.map((d) => d[2])));
    expect((await gerencia.post('/api/v1/mapa/area').send({ ids: delArea.map((d) => d[0]), servicio: 'energia', formato: 'xlsx' })).status).toBe(200);
  });

  it('7 · el proveedor cambia a la segunda cooperativa y ve otra marca y otros datos', async () => {
    const proveedor = await loginAs('super@proveedor.test');
    expect(((await proveedor.get('/api/v1/auth/me')).body.data as Me).cooperativa).toBeNull();
    const enA: Me = (await proveedor.post('/api/v1/auth/cooperativa').send({ cooperativaId: w.a.id })).body.data;
    expect(enA.cooperativa!.nombreCorto).toBe(w.a.nombreCorto);
    const [tA, casasA] = [await tablero(proveedor), (await proveedor.get('/api/v1/mapa/conexiones')).body.data as MapaConexiones];

    const enB: Me = (await proveedor.post('/api/v1/auth/cooperativa').send({ cooperativaId: w.b.id })).body.data;
    expect(enB.cooperativa).toMatchObject({ id: w.b.id, nombreCorto: w.b.nombreCorto, subdominio: 'coop-b' });
    const [tB, casasB] = [await tablero(proveedor), (await proveedor.get('/api/v1/mapa/conexiones')).body.data as MapaConexiones];
    // En B nadie emitió el mes ni cobró nada hoy: sigue en lectura, con su propio historial.
    expect(tB.periodo.estado).toBe('emitido');
    expect(tB.periodo).not.toMatchObject(M);
    expect(tB.lecturas.periodo).toEqual(M);
    expect(tB.indicadores.deuda).not.toBe(tA.indicadores.deuda);
    expect(tB.recaudacion.porCajero.every((c) => c.cajeroId !== w.cajeroA.id)).toBe(true);
    expect(casasB.ids.some((id) => casasA.ids.includes(id))).toBe(false);
    const [deB] = await sql<{ deuda: string }>(`SELECT CAST(COALESCE(sum(saldo), 0) AS numeric(16,2)) AS deuda FROM comprobantes WHERE cooperativa_id = :b AND tipo = 'factura' AND estado = 'emitido' AND saldo > 0`);
    expect(tB.indicadores.deuda).toBe(deB!.deuda);
  });
});
