// Fase 6: portal del socio —inicio, facturas con «¿Por qué pago esto?», consumo, datos—, pago online
// con la pasarela de prueba (y con el QR de la factura), cuenta del socio con su DNI, reclamos y
// cortes programados, y el aislamiento entre socios y entre cooperativas.
import { randomUUID } from 'node:crypto';
import { QueryTypes } from 'sequelize';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  aCentavos,
  codigoDeBarras,
  deCentavos,
  formatMoney,
  mismoDocumento,
  type ConsumoSocio,
  type CuentaPortal,
  type EstadoPagoOnline,
  type FacturaSocioDetalle,
  type InicioSocio,
  type IntentoCreado,
  type PaginaFacturasSocio,
  type PaginaReclamos,
  type PasarelaDatos,
  type ReclamoDetalle,
} from '../src/shared';
import { sequelize } from '../src/db';
import { runInCooperativa } from '../src/lib/context';
import { explicarFactura } from '../src/lib/explicar';
import { sellarPendientes, verificarIntegridad } from '../src/lib/integridad';
import { hoy } from '../src/lib/tarifas';
import { Auditoria, IntentoPago, Notificacion, Pago } from '../src/models';
import { pagosSimulados } from '../src/proveedores/pagos';
import { callesInventadas } from '../src/seed/calles-inventadas';
import { cargarPagos } from '../src/seed/cargar-caja';
import { cargarFacturas } from '../src/seed/cargar-facturas';
import { cargarLecturas } from '../src/seed/cargar-lecturas';
import { cargarPadron } from '../src/seed/cargar-padron';
import { cargarReclamos } from '../src/seed/cargar-reclamos';
import { cargarTarifas } from '../src/seed/cargar-tarifas';
import { generarPadron, PLANES } from '../src/seed/generar-padron';
import { TARIFAS_ARROYO_DEL_MONTE } from '../src/seed/tarifas';
import { app, createUser, loginAs, PASSWORD, resetWorld } from './helpers';

const HOY = hoy();
const PLANES_PRUEBA = [
  { servicio: 'internet' as const, nombre: PLANES.internet50, precio: '20000.00' },
  { servicio: 'internet' as const, nombre: PLANES.internet100, precio: '30000.00' },
  { servicio: 'tv' as const, nombre: PLANES.tv, precio: '15000.00' },
];
const FOTO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

let w: Awaited<ReturnType<typeof resetWorld>>;
type Agente = Awaited<ReturnType<typeof loginAs>>;
let socio: Agente;
let socioB: Agente;
let admin: Agente;
let gerencia: Agente;
let caja: Agente;
let adminB: Agente;
let socioA: { id: number; numero: number; nro_doc: string; zona_id: number };

const sql = <T extends object>(texto: string, replacements: Record<string, unknown> = {}) =>
  sequelize.query<T>(texto, { replacements: { a: w.a.id, b: w.b.id, ...replacements }, type: QueryTypes.SELECT });
const inicio = async (agente: Agente = socio): Promise<InicioSocio> => (await agente.get('/api/v1/socio/inicio')).body.data;
const intento = async (id: string, agente: Agente = socio): Promise<EstadoPagoOnline> => (await agente.get(`/api/v1/socio/pagos/intentos/${id}`)).body.data;
const firmaDe = (c: IntentoCreado) => c.redireccion.campos.firma!;
const pasarela = (c: IntentoCreado, decision: 'aprobar' | 'rechazar' | 'cancelar', medio: 'debito' | 'credito' = 'debito') =>
  request(app).post(`/api/v1/publico/pasarela/${c.intentoId}`).send({ firma: firmaDe(c), decision, medio });
const pagar = async (ids: number[], agente: Agente = socio): Promise<IntentoCreado> => {
  const res = await agente.post('/api/v1/socio/pagos').send({ comprobantes: ids });
  expect(res.status).toBe(201);
  return res.body.data;
};
const factura = async (id: number) => (await sql<{ estado: string; saldo: string; total: string }>(`SELECT estado, saldo, total FROM comprobantes WHERE id = :id`, { id }))[0]!;
/** Recibos a los que estas pruebas les sacan a mano lo que pagaban, para cargarle al socio una deuda nueva. */
const tocadosAMano = new Set<number>();
const sacarCobros = async (comprobanteId: number) => {
  for (const r of await sql<{ pago_id: number }>(`SELECT pago_id FROM pago_aplicaciones WHERE comprobante_id = :id`, { id: comprobanteId })) tocadosAMano.add(r.pago_id);
  await sequelize.query(`DELETE FROM pago_aplicaciones WHERE comprobante_id = :id`, { replacements: { id: comprobanteId } });
};

beforeAll(async () => {
  w = await resetWorld();
  await createUser({ cooperativaId: w.a.id, email: 'socio@a.test', roles: ['socio'] });
  // Como Arroyo del Monte en el seed: con un socio de prueba vinculado al usuario socio@a.test.
  await cargarPadron(generarPadron(callesInventadas(), { hogares: 40, semilla: 7, proporcionUrbana: 0.75, socioDemo: { nombre: 'Prueba, Socia', email: 'socia@a.test' } }), {
    cooperativaId: w.a.id,
    planes: PLANES_PRUEBA,
    emailSocioDemo: 'socio@a.test',
  });
  await cargarPadron(generarPadron(callesInventadas(), { hogares: 40, semilla: 8 }), { cooperativaId: w.b.id, planes: PLANES_PRUEBA });
  // En B, el usuario socio@b.test queda vinculado a un socio cualquiera.
  await sequelize.query(`UPDATE socios SET usuario_id = :u WHERE id = (SELECT min(id) FROM socios WHERE cooperativa_id = :b)`, { replacements: { u: w.socioB.id, b: w.b.id } });
  for (const [coop, semilla] of [[w.a, 7], [w.b, 8]] as const) {
    await cargarTarifas(coop.id, TARIFAS_ARROYO_DEL_MONTE);
    await cargarLecturas(coop.id, { hoy: HOY, semilla, avance: [1, 1] });
    await cargarFacturas(coop.id, { semilla });
    await cargarPagos(coop.id, { semilla });
    await cargarReclamos(coop.id, { semilla, hoy: HOY, cantidad: 20 });
    // El historial de prueba entra directo a la base: se sella, como en el seed.
    await sellarPendientes(coop.id);
  }
  socio = await loginAs('socio@a.test');
  socioB = await loginAs('socio@b.test');
  admin = await loginAs('admin@a.test');
  gerencia = await loginAs('demo@a.test');
  caja = await loginAs('caja@a.test');
  adminB = await loginAs('admin@b.test');
  [socioA] = (await sql<typeof socioA>(
    `SELECT s.id, s.numero, s.nro_doc, c.zona_id FROM socios s JOIN conexiones c ON c.socio_id = s.id WHERE s.cooperativa_id = :a AND s.usuario_id IS NOT NULL LIMIT 1`,
  )) as [typeof socioA];
}, 120_000);
afterAll(() => sequelize.close());

describe('acceso', () => {
  it('solo el socio entra al portal; el socio no entra a la oficina', async () => {
    expect((await admin.get('/api/v1/socio/inicio')).status).toBe(403);
    expect((await socio.get('/api/v1/reclamos')).status).toBe(403);
    expect((await socio.get('/api/v1/facturacion/estado')).status).toBe(403);
    expect((await socio.get('/api/v1/caja/estado')).status).toBe(403);
  });

  it('el personal entra con email y contraseña; un documento en ese campo no entra', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email: socioA.nro_doc, password: PASSWORD });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('El email o la contraseña no son correctos');
  });
});

describe('ingreso del socio con los datos de su factura', () => {
  let datos: { documento: string; numero: number; conexion: number };
  const entrar = (cuerpo: Record<string, unknown>, agente = request(app)) => agente.post('/api/v1/auth/acceso-socio').send(cuerpo);

  beforeAll(async () => {
    [datos] = (await sql<typeof datos>(
      `SELECT s.nro_doc AS documento, s.numero, cx.numero AS conexion FROM socios s JOIN conexiones cx ON cx.socio_id = s.id
       WHERE s.cooperativa_id = :a AND s.usuario_id IS NULL AND s.estado = 'activo' AND s.tipo_doc = 'DNI' ORDER BY s.id LIMIT 1`,
    )) as [typeof datos];
  });

  it('reglas del documento: vale el DNI o el CUIT/CUIL que lo contiene', () => {
    expect(mismoDocumento('99123456', '99.123.456')).toBe(true);
    expect(mismoDocumento('99123456', '20-99123456-7')).toBe(true);
    expect(mismoDocumento('20991234567', '99123456')).toBe(true);
    expect(mismoDocumento('5123456', '27-05123456-1')).toBe(true);
    expect(mismoDocumento('99123456', '99123457')).toBe(false);
    expect(mismoDocumento('99123456', '20991234577')).toBe(false);
    expect(mismoDocumento('30999888777', '30999888778')).toBe(false);
    expect(mismoDocumento('99123456', '')).toBe(false);
  });

  it('con un dato que no coincide no entra, y no dice cuál está mal', async () => {
    const bien = { socio: datos.numero, conexion: datos.conexion, documento: datos.documento };
    for (const mal of [{ ...bien, documento: '99999999' }, { ...bien, conexion: datos.conexion + 99_999 }, { ...bien, socio: datos.numero + 99_999 }]) {
      const res = await entrar(mal);
      expect(res.status).toBe(401);
      expect(res.body.error).toMatchObject({ code: 'datos_no_coinciden', message: 'Esos datos no coinciden con los de la cooperativa. Están en tu factura: revisalos y probá de nuevo.' });
      expect(res.headers['set-cookie']).toBeUndefined();
    }
    // Los mismos datos, en la otra cooperativa, no son este socio.
    expect((await entrar({ ...bien, cooperativa: 'coop-b' })).status).toBe(401);
    const vacio = await entrar({ socio: '', conexion: 'abc', documento: '12' });
    expect(vacio.status).toBe(400);
    expect(Object.keys(vacio.body.error.fields).sort()).toEqual(['conexion', 'documento', 'socio']);
    expect((await sql<{ n: string }>(`SELECT count(*) AS n FROM socios WHERE cooperativa_id = :a AND numero = :n AND usuario_id IS NOT NULL`, { n: datos.numero }))[0]!.n).toBe('0');
  });

  it('con código de socio, conexión y documento entra directo, sin usuario ni contraseña', async () => {
    const agente = request.agent(app);
    // Como lo escribe la gente: con puntos, o el CUIL en lugar del DNI.
    const conPuntos = `${datos.documento.slice(0, 2)}.${datos.documento.slice(2, 5)}.${datos.documento.slice(5)}`;
    const res = await entrar({ socio: String(datos.numero), conexion: String(datos.conexion), documento: conPuntos }, agente);
    expect(res.status).toBe(200);
    expect(res.body.data.user).toMatchObject({ email: null, roles: ['socio'] });
    expect((await agente.get('/api/v1/socio/inicio')).body.data.socio.numero).toBe(datos.numero);

    // La sesión del socio dura 3 meses (la del personal, uno) y se renueva sola.
    const dias = async (id: number) => Number((await sql<{ d: string }>(`SELECT round(EXTRACT(EPOCH FROM (max(expira_el) - now())) / 86400) AS d FROM sesiones WHERE usuario_id = :id`, { id }))[0]!.d);
    expect(await dias(res.body.data.user.id)).toBe(90);
    expect(await dias(w.adminA.id)).toBe(30);
    expect((await agente.post('/api/v1/auth/refresh')).status).toBe(200);
    expect(await dias(res.body.data.user.id)).toBe(90);

    // Otra vez, ahora con el CUIL: es la misma cuenta, no se crea otra.
    const otra = await entrar({ socio: datos.numero, conexion: datos.conexion, documento: `20${datos.documento}7` });
    expect(otra.status).toBe(200);
    expect(otra.body.data.user.id).toBe(res.body.data.user.id);
    expect(await runInCooperativa(w.a.id, () => Auditoria.count({ where: { accion: 'crear_cuenta_socio' } }))).toBe(1);
  });

  it('cinco fallos seguidos con un mismo código de socio pausan el ingreso con ese código, aunque se cambie de conexión', async () => {
    const [otro] = await sql<typeof datos>(
      `SELECT s.nro_doc AS documento, s.numero, cx.numero AS conexion FROM socios s JOIN conexiones cx ON cx.socio_id = s.id
       WHERE s.cooperativa_id = :a AND s.estado = 'activo' AND s.tipo_doc = 'DNI' AND s.numero <> :n ORDER BY s.id LIMIT 1`,
      { n: datos.numero },
    );
    const bien = { socio: otro!.numero, conexion: otro!.conexion, documento: otro!.documento };
    for (let i = 0; i < 5; i++) expect((await entrar({ ...bien, documento: String(10_000_000 + i) })).status).toBe(401);
    // Ahora, ni con los datos correctos: el código quedó en pausa.
    const pausado = await entrar(bien);
    expect(pausado.status).toBe(429);
    expect(pausado.body.error).toMatchObject({ code: 'ingreso_pausado' });
    expect(pausado.body.error.message).toMatch(/15 minutos/);
    expect(await runInCooperativa(w.a.id, () => Auditoria.count({ where: { accion: 'pausar_ingreso_socio', entidadId: String(otro!.numero) } }))).toBe(1);
    // Los demás socios siguen entrando con normalidad.
    expect((await entrar({ socio: datos.numero, conexion: datos.conexion, documento: datos.documento })).status).toBe(200);
    // Pasada la pausa, entra; y el contador vuelve a cero.
    await sequelize.query(`UPDATE intentos_acceso_socio SET bloqueado_hasta = now() - interval '1 minute' WHERE cooperativa_id = :a AND clave = :clave`, {
      replacements: { a: w.a.id, clave: String(otro!.numero) },
    });
    expect((await entrar(bien)).status).toBe(200);
    expect((await sql<{ n: string }>(`SELECT count(*) AS n FROM intentos_acceso_socio WHERE cooperativa_id = :a AND clave = :clave`, { clave: String(otro!.numero) }))[0]!.n).toBe('0');
  });

  it('sale y entra con otra cuenta desde el mismo dispositivo', async () => {
    const [otro] = await sql<typeof datos>(
      `SELECT s.nro_doc AS documento, s.numero, cx.numero AS conexion FROM socios s JOIN conexiones cx ON cx.socio_id = s.id
       WHERE s.cooperativa_id = :a AND s.estado = 'activo' AND s.numero <> :n ORDER BY s.id DESC LIMIT 1`,
      { n: datos.numero },
    );
    const agente = request.agent(app);
    expect((await entrar({ socio: datos.numero, conexion: datos.conexion, documento: datos.documento }, agente)).status).toBe(200);
    expect((await agente.get('/api/v1/socio/inicio')).body.data.socio.numero).toBe(datos.numero);
    expect((await agente.post('/api/v1/auth/logout')).status).toBe(200);
    expect((await agente.get('/api/v1/socio/inicio')).status).toBe(401);
    expect((await entrar({ socio: otro!.numero, conexion: otro!.conexion, documento: otro!.documento }, agente)).status).toBe(200);
    expect((await agente.get('/api/v1/socio/inicio')).body.data.socio.numero).toBe(otro!.numero);
  });
});

describe('inicio y facturas', () => {
  it('el inicio dice cuánto debe, cuándo vence y sus cortes programados', async () => {
    const i = await inicio();
    expect(i.socio.numero).toBe(socioA.numero);
    expect(i.pendientes.length).toBeGreaterThan(0);
    expect(i.deuda).toBe(deCentavos(i.pendientes.reduce((t, f) => t + aCentavos(f.saldo), 0)));
    expect(i.pendientes.every((f) => f.estado === 'emitido' && f.tipo === 'factura')).toBe(true);
    // El seed deja un corte de energía en su zona, dentro de 3 días.
    expect(i.cortes.some((c) => c.servicio === 'energia' && c.desde > new Date().toISOString())).toBe(true);
  });

  it('la lista trae solo sus comprobantes, de lo más nuevo a lo más viejo', async () => {
    const p: PaginaFacturasSocio = (await socio.get('/api/v1/socio/facturas')).body.data;
    expect(p.total).toBeGreaterThan(12);
    const [{ n }] = (await sql<{ n: string }>(`SELECT count(*) AS n FROM comprobantes WHERE socio_id = :s AND estado <> 'borrador'`, { s: socioA.id })) as [{ n: string }];
    expect(p.total).toBe(Number(n));
    expect(p.filas.map((f) => f.anio * 12 + f.mes)).toEqual([...p.filas.map((f) => f.anio * 12 + f.mes)].sort((x, y) => y - x));
  });

  it('«¿Por qué pago esto?»: el subsidio hasta el tope y lo que se pasó, en partes que suman el total', async () => {
    const energia = (await inicio()).pendientes.find((f) => f.servicio === 'energia')!;
    const d: FacturaSocioDetalle = (await socio.get(`/api/v1/socio/facturas/${energia.id}`)).body.data;
    expect(d.tieneSubsidio).toBe(true);
    const s = d.porQue!.subsidio!;
    // Arroyo del Monte: subsidio en los primeros 150 kWh; el socio de prueba consume más.
    expect(s).toMatchObject({ tope: 150, unidad: 'kWh', dentro: 150, precioSubsidiado: '92.0000', precioPleno: '214.0000' });
    expect(s.fuera).toBe(s.consumo - 150);
    expect(s.fuera).toBeGreaterThan(0);
    expect(d.porQue!.partes.map((p) => p.clave)).toEqual(expect.arrayContaining(['fijo', 'subsidiado', 'excedente']));
    expect(deCentavos(d.porQue!.partes.reduce((t, p) => t + aCentavos(p.importe), 0))).toBe(d.total);
    expect(d.porQue!.frases[0]).toMatch(/^Tenés subsidio en los primeros 150 kWh\. Este mes consumiste \d+ kWh: \d+ kWh quedaron por encima del tope/);
    expect(d.porQue!.comparacion).not.toBeNull();
    expect(d.codigoDeBarras).toMatch(/^\d{32}$/);
    expect((await socio.get(`/api/v1/socio/facturas/${energia.id}/pdf`)).headers['content-type']).toBe('application/pdf');
  });

  it('sin subsidio, lo dice; y una comparación con el mes anterior en palabras', () => {
    const e = explicarFactura({
      servicio: 'energia',
      categoria: 'residencial',
      tieneSubsidio: false,
      renglones: [
        { grupo: 'basico', codigo: 'CARGO_FIJO', servicio: 'energia', descripcion: 'Cuota fija', cantidad: '1', unitario: '2000', porcentaje: null, base: null, importe: '2000.00' },
        { grupo: 'basico', codigo: 'ESCALON', servicio: 'energia', descripcion: 'Consumo', cantidad: '200', unitario: '100', porcentaje: null, base: null, importe: '20000.00' },
        { grupo: 'gravamen', codigo: 'IVA', servicio: 'energia', descripcion: 'IVA 21 %', cantidad: null, unitario: null, porcentaje: '21', base: '22000.00', importe: '4620.00' },
        { grupo: 'adicional', codigo: 'SEPELIO_TITULAR', servicio: 'sepelio', descripcion: 'Sepelio · cuota del titular', cantidad: '1', unitario: '3000', porcentaje: null, base: null, importe: '3000.00' },
      ],
      totales: { basico: '22000.00', subtotal: '22000.00', gravamenes: '4620.00', servicio: '26620.00', adicionales: '3000.00', recargos: '0.00', total: '29620.00' },
      consumo: { unidad: 'kWh', medido: '200', aFavorAplicado: '0', facturado: '200', aFavorPendiente: '0', tramos: [] },
      avisos: [],
      cuadros: [],
      anterior: { anio: 2026, mes: 9, consumo: 160 },
    });
    expect(e.subsidio).toBeNull();
    expect(e.partes.map((p) => [p.clave, p.importe])).toEqual([['fijo', '2000.00'], ['consumo', '20000.00'], ['impuestos', '4620.00'], ['adicionales', '3000.00']]);
    expect(e.frases).toContain('Tu conexión no tiene subsidio: todo el consumo se cobra a precio pleno. Si creés que te corresponde, consultá en la cooperativa.');
    expect(e.frases).toContain('Consumiste 25 % más que en septiembre de 2026 (160 kWh).');
    expect(e.frases).toContain('De cada $ 100 de esta factura, $ 16 son impuestos y tasas.');
    expect(e.comparacion).toEqual({ anio: 2026, mes: 9, consumo: 160, variacion: 25 });
  });

  it('el consumo de 12 meses, con el promedio de su zona', async () => {
    const c: ConsumoSocio = (await socio.get('/api/v1/socio/consumo')).body.data;
    const energia = c.servicios.find((s) => s.servicio === 'energia')!;
    expect(energia.meses).toHaveLength(12);
    expect(energia.meses.at(-1)!.consumo).toBeGreaterThan(150);
    expect(energia.meses.filter((m) => m.promedioZona !== null).length).toBeGreaterThan(6);
  });

  it('sus datos de contacto y la factura digital', async () => {
    const cuenta: CuentaPortal = (await socio.get('/api/v1/socio/cuenta')).body.data;
    expect(cuenta.id).toBe(socioA.id);
    expect(cuenta.conexiones.length).toBeGreaterThan(0);
    const sinEmail = await socio.put('/api/v1/socio/contacto').send({ email: '', telefono: '3755 123456', facturaDigital: true });
    expect(sinEmail.status).toBe(400);
    expect(sinEmail.body.error.fields.email).toMatch(/cargá tu email/);
    const res = await socio.put('/api/v1/socio/contacto').send({ email: 'Socia@Correo.example', telefono: '3755 123456', facturaDigital: true });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ email: 'Socia@Correo.example', telefono: '3755 123456', facturaDigital: true });
    expect(await runInCooperativa(w.a.id, () => Auditoria.count({ where: { accion: 'actualizar_contacto', entidadId: String(socioA.id) } }))).toBe(1);
  });
});

describe('pago online', () => {
  it('rechazado por el banco: no se acredita nada y se puede volver a intentar', async () => {
    const { pendientes } = await inicio();
    const c = await pagar([pendientes[0]!.id]);
    expect(c.redireccion).toMatchObject({ metodo: 'GET', url: expect.stringMatching(new RegExp(`/pasarela/${c.intentoId}$`)) });
    expect((await request(app).get(`/api/v1/publico/pasarela/${c.intentoId}?firma=${'0'.repeat(64)}`)).status).toBe(404);
    const datos: PasarelaDatos = (await request(app).get(`/api/v1/publico/pasarela/${c.intentoId}?firma=${firmaDe(c)}`)).body.data;
    expect(datos).toMatchObject({ total: pendientes[0]!.saldo, estado: 'pendiente', items: [{ importe: pendientes[0]!.saldo }] });

    const res = await pasarela(c, 'rechazar');
    expect(res.body.data).toMatchObject({ estado: 'rechazado', redireccion: expect.stringMatching(new RegExp(`/socio/pago/${c.intentoId}$`)) });
    expect(await intento(c.intentoId)).toMatchObject({ estado: 'rechazado', recibo: null, motivo: expect.any(String) });
    expect(await factura(pendientes[0]!.id)).toMatchObject({ estado: 'emitido', saldo: pendientes[0]!.saldo });
  });

  it('cancelado en el banco: vuelve a la página de cancelado', async () => {
    const c = await pagar([(await inicio()).pendientes[0]!.id]);
    const res = await pasarela(c, 'cancelar');
    expect(res.body.data.redireccion).toMatch(/\?cancelado=1$/);
    expect((await intento(c.intentoId)).estado).toBe('cancelado');
  });

  it('aprobado: el aviso del banco acredita, numera el recibo y deja las facturas pagas', async () => {
    const antes = await inicio();
    const ids = antes.pendientes.map((f) => f.id);
    const c = await pagar(ids);
    expect(c.total).toBe(antes.deuda);
    expect((await intento(c.intentoId)).estado).toBe('pendiente');
    expect((await inicio()).pagoEnCurso).toEqual({ intentoId: c.intentoId, total: c.total });

    const res = await pasarela(c, 'aprobar', 'credito');
    expect(res.body.data.estado).toBe('aprobado');
    const e = await intento(c.intentoId);
    expect(e).toMatchObject({ estado: 'aprobado', medio: 'credito', aFavor: null, deudaRestante: '0.00', recibo: { referencia: expect.stringMatching(/^Rcbo [AB] 0001-\d{8}$/) } });
    for (const id of ids) expect(await factura(id)).toMatchObject({ estado: 'pagado', saldo: '0.00' });
    const pago = (await runInCooperativa(w.a.id, () => Pago.findByPk(e.recibo!.id)))!;
    expect(pago).toMatchObject({ origen: 'online', cajaId: null, medio: 'credito', importe: c.total, intentoId: c.intentoId, socioId: socioA.id });
    expect((await inicio()).deuda).toBe('0.00');
    // El recibo lo ve el socio, y le llegó el aviso.
    expect((await socio.get(`/api/v1/socio/pagos/${pago.id}/recibo`)).headers['content-type']).toBe('application/pdf');
    expect(await runInCooperativa(w.a.id, () => Notificacion.count({ where: { socioId: socioA.id, asunto: `Recibimos tu pago de ${formatMoney(c.total)}` } }))).toBe(1);

    // Apretar dos veces «Pagar» o recibir dos veces el aviso no cobra dos veces.
    expect((await pasarela(c, 'aprobar')).body.data.estado).toBe('aprobado');
    const aviso = await runInCooperativa(w.a.id, () => pagosSimulados.consultarEstado(c.intentoId));
    const repetido = await request(app).post('/api/v1/pagos/notificacion/simulado').set('X-Firma', pagosSimulados.firmarNotificacion(aviso)).send(aviso);
    expect(repetido.status).toBe(200);
    expect(await runInCooperativa(w.a.id, () => Pago.count({ where: { intentoId: c.intentoId } }))).toBe(1);
    // Un aviso con firma falsa no se toma.
    const falso = await request(app).post('/api/v1/pagos/notificacion/simulado').set('X-Firma', 'f'.repeat(64)).send({ ...aviso, importe: '1.00' });
    expect(falso.status).toBe(401);
    expect((await request(app).post('/api/v1/pagos/notificacion/otro').send(aviso)).status).toBe(404);
  });

  it('si el aviso del banco no llegó, al volver se le consulta el estado y se acredita igual', async () => {
    // Le cargamos una deuda nueva al socio: otra factura impaga de las de su historial.
    const [f] = await sql<{ id: number; total: string }>(`SELECT id, total FROM comprobantes WHERE socio_id = :s AND estado = 'pagado' AND total > 0 ORDER BY id LIMIT 1`, { s: socioA.id });
    await sacarCobros(f!.id);
    await sequelize.query(`UPDATE comprobantes SET estado = 'emitido', saldo = total WHERE id = :id`, { replacements: { id: f!.id } });
    const c = await pagar([f!.id]);
    // El banco aprueba pero el aviso se pierde.
    await runInCooperativa(w.a.id, () => pagosSimulados.decidir(c.intentoId, 'aprobar', 'debito'));
    expect(await factura(f!.id)).toMatchObject({ estado: 'emitido' });
    expect(await intento(c.intentoId)).toMatchObject({ estado: 'aprobado', medio: 'debito' });
    expect(await factura(f!.id)).toMatchObject({ estado: 'pagado', saldo: '0.00' });
  });

  it('si la factura se pagó en la caja mientras pagaba online, lo cobrado queda a su favor', async () => {
    const [f] = await sql<{ id: number; total: string }>(`SELECT id, total FROM comprobantes WHERE socio_id = :s AND estado = 'pagado' AND total > 0 ORDER BY id LIMIT 1 OFFSET 1`, { s: socioA.id });
    await sacarCobros(f!.id);
    await sequelize.query(`UPDATE comprobantes SET estado = 'emitido', saldo = total WHERE id = :id`, { replacements: { id: f!.id } });
    const c = await pagar([f!.id]);
    expect((await caja.post('/api/v1/caja/abrir').send({ fondoInicial: '0' })).status).toBe(201);
    expect((await caja.post('/api/v1/caja/cobros').send({ clave: randomUUID(), socioId: socioA.id, aplicaciones: [{ comprobanteId: f!.id, importe: f!.total }], items: [], medio: 'efectivo' })).status).toBe(201);
    await pasarela(c, 'aprobar');
    const e = await intento(c.intentoId);
    expect(e).toMatchObject({ estado: 'aprobado', aFavor: c.total });
    const recibo = (await caja.get(`/api/v1/caja/cobros/${e.recibo!.id}`)).body.data;
    expect(recibo).toMatchObject({ importe: c.total, aFavor: c.total, aplicaciones: [] });
    expect(await factura(f!.id)).toMatchObject({ estado: 'pagado', saldo: '0.00' });
  });

  it('un intento que pasó su vigencia vence y el banco ya no lo acepta', async () => {
    const [f] = await sql<{ id: number }>(`SELECT id FROM comprobantes WHERE socio_id = :s AND estado = 'pagado' AND total > 0 ORDER BY id LIMIT 1 OFFSET 2`, { s: socioA.id });
    await sacarCobros(f!.id);
    await sequelize.query(`UPDATE comprobantes SET estado = 'emitido', saldo = total WHERE id = :id`, { replacements: { id: f!.id } });
    const c = await pagar([f!.id]);
    await runInCooperativa(w.a.id, () => IntentoPago.update({ venceEl: new Date(Date.now() - 60_000) }, { where: { id: c.intentoId } }));
    expect((await pasarela(c, 'aprobar')).status).toBe(409);
    expect((await intento(c.intentoId)).estado).toBe('vencido');
  });

  it('no paga lo que no es suyo, ni lo ya pagado', async () => {
    const [ajena] = await sql<{ id: number }>(`SELECT id FROM comprobantes WHERE cooperativa_id = :a AND socio_id <> :s AND estado = 'emitido' LIMIT 1`, { s: socioA.id });
    expect((await socio.post('/api/v1/socio/pagos').send({ comprobantes: [ajena!.id] })).status).toBe(404);
    const [paga] = await sql<{ id: number }>(`SELECT id FROM comprobantes WHERE socio_id = :s AND estado = 'pagado' ORDER BY id DESC LIMIT 1`, { s: socioA.id });
    expect((await socio.post('/api/v1/socio/pagos').send({ comprobantes: [paga!.id] })).status).toBe(409);
    expect((await socio.post('/api/v1/socio/pagos').send({ comprobantes: [] })).status).toBe(400);
  });
});

describe('pagar con el QR de la factura, sin cuenta', () => {
  it('el código lleva a la factura; un código cambiado, no', async () => {
    const [f] = await sql<{ id: number; vence_el: string; total: string; socio_id: number }>(
      `SELECT id, to_char(vence_el, 'YYYY-MM-DD') AS vence_el, total, socio_id FROM comprobantes WHERE cooperativa_id = :a AND estado = 'emitido' AND socio_id <> :s ORDER BY id LIMIT 1`,
      { s: socioA.id },
    );
    const codigo = codigoDeBarras({ cooperativaId: w.a.id, id: f!.id, venceEl: f!.vence_el, total: f!.total });
    const ver = await request(app).get(`/api/v1/publico/pagar/${codigo}`);
    expect(ver.status).toBe(200);
    expect(ver.body.data).toMatchObject({ saldo: Number(f!.total).toFixed(2), estado: 'pendiente', identificacion: expect.stringMatching(/^Socio N° \d+/) });
    expect(JSON.stringify(ver.body.data)).not.toMatch(/nombre/);
    // Mismo comprobante, otro importe (con su dígito verificador bien calculado): no sirve.
    const otro = codigoDeBarras({ cooperativaId: w.a.id, id: f!.id, venceEl: f!.vence_el, total: '1.00' });
    expect((await request(app).get(`/api/v1/publico/pagar/${otro}`)).status).toBe(404);

    const creado = await request(app).post(`/api/v1/publico/pagar/${codigo}`);
    expect(creado.status).toBe(201);
    const c: IntentoCreado = creado.body.data;
    const res = await pasarela(c, 'aprobar');
    expect(res.body.data.redireccion).toMatch(new RegExp(`/pagar/resultado/${c.intentoId}$`));
    const e: EstadoPagoOnline = (await request(app).get(`/api/v1/publico/pagos/${c.intentoId}`)).body.data;
    expect(e).toMatchObject({ estado: 'aprobado', deudaRestante: null, recibo: { referencia: expect.stringMatching(/^Rcbo/) } });
    expect(await factura(f!.id)).toMatchObject({ estado: 'pagado' });
    expect((await request(app).get(`/api/v1/publico/pagar/${codigo}`)).body.data.estado).toBe('pagada');
    expect((await request(app).post(`/api/v1/publico/pagar/${codigo}`)).status).toBe(409);
  });
});

describe('reclamos', () => {
  let reclamoId: number;

  it('el socio reclama con foto desde su domicilio; ve su historial', async () => {
    const cuenta: CuentaPortal = (await socio.get('/api/v1/socio/cuenta')).body.data;
    const conexionId = cuenta.conexiones[0]!.id;
    const malTipo = await socio.post('/api/v1/socio/reclamos').send({ conexionId, servicio: 'agua', tipo: 'sin_luz' });
    expect(malTipo.status).toBe(400);
    const [ajena] = await sql<{ id: number }>(`SELECT id FROM conexiones WHERE cooperativa_id = :a AND socio_id <> :s LIMIT 1`, { s: socioA.id });
    expect((await socio.post('/api/v1/socio/reclamos').send({ conexionId: ajena!.id, servicio: 'energia', tipo: 'sin_luz' })).status).toBe(404);

    const res = await socio.post('/api/v1/socio/reclamos').send({ conexionId, servicio: 'energia', tipo: 'sin_luz', descripcion: 'Se cortó en toda la cuadra', foto: FOTO, lat: -27.28, lng: -54.98 });
    expect(res.status).toBe(201);
    const r: ReclamoDetalle = res.body.data;
    reclamoId = r.id;
    expect(r).toMatchObject({ estado: 'nuevo', prioridad: 'alta', origen: 'portal', tieneFoto: true, tipoNombre: 'No tengo luz', lat: -27.28, eventos: [{ estado: 'nuevo', autor: 'Vos' }] });
    expect(r.referencia).toMatch(/^R-\d{5}$/);
    expect(r.contacto).toBeNull();
    expect((await socio.get(`/api/v1/socio/reclamos/${r.id}/foto`)).headers['content-type']).toBe('image/png');
    expect((await inicio()).reclamosAbiertos).toBeGreaterThan(0);
  });

  it('la oficina lo asigna, lo trabaja y lo resuelve; el socio se entera de cada paso', async () => {
    const lista: PaginaReclamos = (await admin.get('/api/v1/reclamos?estado=nuevo')).body.data;
    expect(lista.filas.map((f) => f.id)).toContain(reclamoId);
    expect(lista.conteo.nuevo).toBe(lista.total);
    expect((await gerencia.get(`/api/v1/reclamos/${reclamoId}`)).status).toBe(200);
    expect((await gerencia.post(`/api/v1/reclamos/${reclamoId}/estado`).send({ estado: 'asignado', cuadrilla: 'Cuadrilla de energía 1' })).status).toBe(403);

    const sinCuadrilla = await admin.post(`/api/v1/reclamos/${reclamoId}/estado`).send({ estado: 'asignado' });
    expect(sinCuadrilla.body.error.fields.cuadrilla).toBeTruthy();
    expect((await admin.post(`/api/v1/reclamos/${reclamoId}/estado`).send({ estado: 'asignado', cuadrilla: 'Cuadrilla de energía 1' })).status).toBe(200);
    expect((await admin.post(`/api/v1/reclamos/${reclamoId}/estado`).send({ estado: 'asignado', cuadrilla: 'Guardia de energía' })).body.data.cuadrilla).toBe('Guardia de energía');
    expect((await admin.post(`/api/v1/reclamos/${reclamoId}/nota`).send({ nota: 'El vecino tiene perro bravo', visibleSocio: false })).status).toBe(201);
    expect((await admin.post(`/api/v1/reclamos/${reclamoId}/estado`).send({ estado: 'en_curso' })).status).toBe(200);
    expect((await admin.post(`/api/v1/reclamos/${reclamoId}/estado`).send({ estado: 'resuelto' })).body.error.fields.resolucion).toBeTruthy();
    const resuelto = await admin.post(`/api/v1/reclamos/${reclamoId}/estado`).send({ estado: 'resuelto', resolucion: 'Se cambió el fusible de la bajada' });
    expect(resuelto.body.data).toMatchObject({ estado: 'resuelto', resolucion: 'Se cambió el fusible de la bajada' });
    expect((await admin.post(`/api/v1/reclamos/${reclamoId}/estado`).send({ estado: 'en_curso' })).status).toBe(409);

    const visto = ((await socio.get('/api/v1/socio/reclamos')).body.data as ReclamoDetalle[]).find((x) => x.id === reclamoId)!;
    expect(visto.eventos.map((e) => [e.estado, e.autor])).toEqual([
      ['nuevo', 'Vos'],
      ['asignado', 'Cooperativa'],
      ['asignado', 'Cooperativa'],
      ['en_curso', 'Cooperativa'],
      ['resuelto', 'Cooperativa'],
    ]);
    expect(JSON.stringify(visto)).not.toMatch(/perro bravo|Persona admin/);
    const deOficina: ReclamoDetalle = (await admin.get(`/api/v1/reclamos/${reclamoId}`)).body.data;
    expect(deOficina.eventos.some((e) => e.nota === 'El vecino tiene perro bravo' && e.autor === 'Persona admin')).toBe(true);
    // Le llegó un aviso por cada paso (no por la reasignación).
    const avisos = await sql<{ asunto: string }>(`SELECT asunto FROM notificaciones WHERE socio_id = :s AND asunto LIKE 'Tu reclamo%' ORDER BY id`, { s: socioA.id });
    expect(avisos.map((a) => a.asunto.split(': ')[1])).toEqual(['asignado', 'en curso', 'resuelto']);
  });

  it('la oficina toma un reclamo por teléfono, sin socio', async () => {
    const res = await admin.post('/api/v1/reclamos').send({ servicio: 'energia', tipo: 'alumbrado', direccion: 'Esquina de la plaza', origen: 'telefono' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ socio: null, direccion: 'Esquina de la plaza', origen: 'telefono', prioridad: 'baja' });
    expect((await admin.post('/api/v1/reclamos').send({ servicio: 'energia', tipo: 'alumbrado' })).body.error.fields.direccion).toBeTruthy();
  });

  it('los reclamos de prueba tienen tiempos en orden y nada en el futuro', async () => {
    const [r] = await sql<{ n: string; abiertos: string; mal: string; eventos_mal: string }>(
      `SELECT count(*) AS n, count(*) FILTER (WHERE estado <> 'resuelto') AS abiertos,
              count(*) FILTER (WHERE asignado_el < creado_el OR iniciado_el < asignado_el OR resuelto_el < iniciado_el OR GREATEST(creado_el, asignado_el, iniciado_el, resuelto_el) > now()) AS mal,
              count(*) FILTER (WHERE (SELECT count(*) FROM reclamo_eventos e WHERE e.reclamo_id = r.id AND e.estado IS NOT NULL) <> 1 + (asignado_el IS NOT NULL)::int + (iniciado_el IS NOT NULL)::int + (resuelto_el IS NOT NULL)::int) AS eventos_mal
       FROM reclamos r WHERE cooperativa_id = :b`,
    );
    expect(r).toMatchObject({ n: '20', abiertos: '5', mal: '0', eventos_mal: '0' });
  });
});

describe('cortes programados', () => {
  it('administración carga un corte en una zona: avisa a los socios y aparece en su inicio', async () => {
    const desde = new Date(Date.now() + 2 * 86_400_000);
    const hasta = new Date(desde.getTime() + 3 * 3_600_000);
    expect((await admin.post('/api/v1/cortes').send({ zonaId: socioA.zona_id, servicio: 'agua', desde: hasta.toISOString(), hasta: desde.toISOString(), motivo: 'Al revés' })).body.error.fields.hasta).toBeTruthy();
    expect((await gerencia.post('/api/v1/cortes').send({ zonaId: socioA.zona_id, servicio: 'energia', desde: desde.toISOString(), hasta: hasta.toISOString(), motivo: 'Poda' })).status).toBe(403);
    const res = await admin.post('/api/v1/cortes').send({ zonaId: socioA.zona_id, servicio: 'energia', desde: desde.toISOString(), hasta: hasta.toISOString(), motivo: 'Poda de árboles sobre la línea' });
    expect(res.status).toBe(201);
    expect(res.body.data.avisados).toBeGreaterThan(0);
    expect((await inicio()).cortes.map((c) => c.id)).toContain(res.body.data.id);

    // Uno en otra zona no le aparece; uno cancelado, tampoco.
    const [otra] = await sql<{ id: number }>(`SELECT id FROM zonas WHERE cooperativa_id = :a AND id <> :z LIMIT 1`, { z: socioA.zona_id });
    const ajeno = await admin.post('/api/v1/cortes').send({ zonaId: otra!.id, servicio: 'energia', desde: desde.toISOString(), hasta: hasta.toISOString(), motivo: 'Cambio de postes' });
    expect((await inicio()).cortes.map((c) => c.id)).not.toContain(ajeno.body.data.id);
    expect((await admin.post(`/api/v1/cortes/${res.body.data.id}/cancelar`)).status).toBe(200);
    expect((await inicio()).cortes.map((c) => c.id)).not.toContain(res.body.data.id);
    expect((await admin.post(`/api/v1/cortes/${res.body.data.id}/cancelar`)).status).toBe(409);
  });
});

describe('aislamiento', () => {
  it('un socio no ve lo de otro socio, ni de otra cooperativa', async () => {
    const [deB] = await sql<{ id: number }>(`SELECT id FROM comprobantes WHERE cooperativa_id = :b AND estado <> 'borrador' LIMIT 1`);
    const [ajenaA] = await sql<{ id: number }>(`SELECT id FROM comprobantes WHERE cooperativa_id = :a AND socio_id <> :s AND estado <> 'borrador' LIMIT 1`, { s: socioA.id });
    expect((await socio.get(`/api/v1/socio/facturas/${deB!.id}`)).status).toBe(404);
    expect((await socio.get(`/api/v1/socio/facturas/${ajenaA!.id}`)).status).toBe(404);
    expect((await socio.get(`/api/v1/socio/facturas/${ajenaA!.id}/pdf`)).status).toBe(404);
    expect((await socioB.get('/api/v1/socio/inicio')).body.data.socio.numero).not.toBe(socioA.numero);
    const [reclamoA] = await sql<{ id: number }>(`SELECT id FROM reclamos WHERE cooperativa_id = :a LIMIT 1`);
    expect((await adminB.get(`/api/v1/reclamos/${reclamoA!.id}`)).status).toBe(404);
    expect(((await adminB.get('/api/v1/reclamos?estado=resuelto')).body.data as PaginaReclamos).filas.every((f) => f.id !== reclamoA!.id)).toBe(true);
    const [pagoA] = await sql<{ id: number }>(`SELECT id FROM pagos WHERE cooperativa_id = :a AND socio_id = :s LIMIT 1`, { s: socioA.id });
    expect((await socioB.get(`/api/v1/socio/pagos/${pagoA!.id}/recibo`)).status).toBe(404);
  });

  it('en la dirección de otra cooperativa, el QR y la pasarela no responden', async () => {
    const [f] = await sql<{ id: number; vence_el: string; total: string }>(`SELECT id, to_char(vence_el, 'YYYY-MM-DD') AS vence_el, total FROM comprobantes WHERE cooperativa_id = :a AND estado = 'emitido' LIMIT 1`);
    const codigo = codigoDeBarras({ cooperativaId: w.a.id, id: f!.id, venceEl: f!.vence_el, total: f!.total });
    expect((await request(app).get(`/api/v1/publico/pagar/${codigo}`).set('Host', 'coop-b.coopgestion.test')).status).toBe(404);
  });
});

describe('integridad', () => {
  it('cada pago online de estas pruebas quedó encadenado, y lo único que marca es lo que se tocó a mano en la base', async () => {
    expect(tocadosAMano.size).toBe(3);
    const a = await runInCooperativa(w.a.id, verificarIntegridad);
    // Los recibos a los que se les sacó lo que pagaban: la huella ya no coincide y el importe no cierra.
    expect(a.problemas.every((p) => p.libro === 'cobros' && ['huella_no_coincide', 'cobro_no_cierra'].includes(p.tipo))).toBe(true);
    expect(new Set(a.problemas.map((p) => p.entidadId))).toEqual(tocadosAMano);
    expect((await runInCooperativa(w.b.id, verificarIntegridad)).problemas).toEqual([]);
  });
});
