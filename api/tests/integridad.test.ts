// Integridad de los datos: con todo sellado la verificación da en orden; cada forma de tocar la base
// por fuera de la app (cambiar un importe, borrar una factura, anular un cobro a mano, borrar o
// cambiar el registro de cambios) se detecta en el lugar exacto, y se avisa a quien corresponde.
import { QueryTypes } from 'sequelize';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BandejaAlertas, EstadoIntegridad, TipoProblema } from '../src/shared';
import { sequelize } from '../src/db';
import { alertar } from '../src/lib/alertas';
import { writeAudit } from '../src/lib/audit';
import { runInCooperativa } from '../src/lib/context';
import { esperarVerificaciones, proximaHora, sellarPendientes, verificarIntegridad } from '../src/lib/integridad';
import { hoy } from '../src/lib/tarifas';
import { Alerta } from '../src/models';
import { correoResend, esDireccionDePrueba } from '../src/proveedores/correo';
import { callesInventadas } from '../src/seed/calles-inventadas';
import { cargarPagos, cargarProductos } from '../src/seed/cargar-caja';
import { cargarFacturas } from '../src/seed/cargar-facturas';
import { cargarLecturas } from '../src/seed/cargar-lecturas';
import { cargarPadron } from '../src/seed/cargar-padron';
import { cargarTarifas } from '../src/seed/cargar-tarifas';
import { generarPadron, PLANES } from '../src/seed/generar-padron';
import { TARIFAS_ARROYO_DEL_MONTE } from '../src/seed/tarifas';
import { createUser, loginAs, resetWorld } from './helpers';

let w: Awaited<ReturnType<typeof resetWorld>>;
type Agente = Awaited<ReturnType<typeof loginAs>>;
let admin: Agente;
const sql = <T extends object>(texto: string, bind: Record<string, unknown> = {}) => sequelize.query<T>(texto, { bind: { a: w.a.id, ...bind }, type: QueryTypes.SELECT });
const ejecutar = (texto: string, bind: Record<string, unknown> = {}) => sequelize.query(texto, { bind: { a: w.a.id, ...bind } });
const verificar = () => runInCooperativa(w.a.id, verificarIntegridad);
const tipos = (r: Awaited<ReturnType<typeof verificar>>) => r.problemas.map((p) => `${p.libro}:${p.tipo}`).sort();

beforeAll(async () => {
  w = await resetWorld();
  await cargarPadron(generarPadron(callesInventadas(), { hogares: 25, semilla: 31 }), {
    cooperativaId: w.a.id,
    planes: [
      { servicio: 'internet' as const, nombre: PLANES.internet50, precio: '20000.00' },
      { servicio: 'internet' as const, nombre: PLANES.internet100, precio: '30000.00' },
      { servicio: 'tv' as const, nombre: PLANES.tv, precio: '15000.00' },
    ],
  });
  await cargarTarifas(w.a.id, TARIFAS_ARROYO_DEL_MONTE);
  await cargarLecturas(w.a.id, { hoy: hoy(), semilla: 31, avance: [0.5, 0] });
  await cargarFacturas(w.a.id, { semilla: 31 });
  await cargarProductos(w.a.id, [{ nombre: 'Garrafa de 10 kg', precio: '18500.00', stock: 40 }]);
  await cargarPagos(w.a.id, { semilla: 31 });
  // Un par de registros de cambios, como deja el uso normal.
  for (const accion of ['crear', 'editar', 'cobrar']) await runInCooperativa(w.a.id, () => writeAudit({ accion, entidad: 'prueba', entidadId: 1, despues: { accion } }));
  await sellarPendientes(w.a.id);
  // La gerente tiene un mail de verdad (las direcciones .test no reciben nada).
  await createUser({ cooperativaId: w.a.id, email: 'gerente@cooperativa-a.com.ar', roles: ['gerencia'] });
  admin = await loginAs('admin@a.test');
}, 120_000);
afterAll(async () => {
  await esperarVerificaciones();
  await sequelize.close();
});

describe('con todo sellado', () => {
  it('la verificación da en orden y recorre todo', async () => {
    const r = await verificar();
    expect(r.problemas).toEqual([]);
    expect(r.resumen.facturas.revisados).toBeGreaterThan(100);
    expect(r.resumen.cobros.revisados).toBeGreaterThan(10);
    expect(r.resumen.auditoria.revisados).toBeGreaterThanOrEqual(3);
  });

  it('sellar de nuevo no cambia nada: nunca rehace un eslabón', async () => {
    const antes = await sql<{ h: string }>(`SELECT md5(string_agg(huella, '' ORDER BY id)) AS h FROM comprobantes WHERE cooperativa_id = $a`);
    expect(await sellarPendientes(w.a.id)).toEqual({ comprobantes: 0, pagos: 0, auditoria: 0 });
    expect(await sql(`SELECT md5(string_agg(huella, '' ORDER BY id)) AS h FROM comprobantes WHERE cooperativa_id = $a`)).toEqual(antes);
  });

  it('solo la ven la administración, la gerencia y SRV', async () => {
    expect((await (await loginAs('caja@a.test')).get('/api/v1/integridad')).status).toBe(403);
    const res = await admin.post('/api/v1/integridad/verificar');
    expect(res.status).toBe(202);
    expect(res.body.data).toMatchObject({ origen: 'manual', estado: 'en_curso' });
    // Mientras corre, no se puede pedir otra.
    expect((await admin.post('/api/v1/integridad/verificar')).status).toBe(409);
    await esperarVerificaciones();
    const e: EstadoIntegridad = (await admin.get('/api/v1/integridad')).body.data;
    expect(e.ultima).toMatchObject({ estado: 'ok', totalProblemas: 0, usuario: 'Persona admin' });
    expect(await runInCooperativa(w.a.id, () => Alerta.count())).toBe(0);
  });
});

describe('cuando alguien toca la base por fuera de la app', () => {
  let r: Awaited<ReturnType<typeof verificar>>;
  const ids: Record<string, number> = {};

  beforeAll(async () => {
    // 1. Le cambian el importe a una factura paga (y su renglón, para que el detalle «cierre»).
    const [paga] = await sql<{ id: number }>(`SELECT id FROM comprobantes WHERE cooperativa_id = $a AND estado = 'pagado' AND tipo = 'factura' ORDER BY id LIMIT 1`);
    ids.paga = paga!.id;
    await ejecutar(`UPDATE comprobantes SET total = total - 1000 WHERE id = $id`, { id: paga!.id });
    await ejecutar(`UPDATE comprobante_renglones SET importe = importe - 1000 WHERE id = (SELECT min(id) FROM comprobante_renglones WHERE comprobante_id = $id)`, { id: paga!.id });

    // 2. Le cambian la descripción de un renglón a otra (sin tocar importes).
    const [otra] = await sql<{ id: number }>(`SELECT id FROM comprobantes WHERE cooperativa_id = $a AND tipo = 'factura' AND id > $id ORDER BY id LIMIT 1 OFFSET 40`, { id: paga!.id });
    ids.texto = otra!.id;
    await ejecutar(`UPDATE comprobante_renglones SET descripcion = 'Otro concepto' WHERE id = (SELECT min(id) FROM comprobante_renglones WHERE comprobante_id = $id)`, { id: otra!.id });

    // 3. Borran una factura impaga (sin cobros) del medio de un talonario.
    const [impaga] = await sql<{ id: number; numero: number }>(
      `SELECT c.id, c.numero FROM comprobantes c WHERE c.cooperativa_id = $a AND c.estado = 'emitido' AND c.tipo = 'factura'
         AND NOT EXISTS (SELECT 1 FROM pago_aplicaciones pa WHERE pa.comprobante_id = c.id)
         AND EXISTS (SELECT 1 FROM comprobantes n WHERE n.cooperativa_id = c.cooperativa_id AND n.letra = c.letra AND n.punto_venta = c.punto_venta AND n.tipo = c.tipo AND n.numero = c.numero + 1)
       ORDER BY c.id LIMIT 1`,
    );
    ids.borrada = impaga!.numero;
    await ejecutar(`DELETE FROM notificaciones WHERE comprobante_id = $id`, { id: impaga!.id });
    await ejecutar(`DELETE FROM comprobantes WHERE id = $id`, { id: impaga!.id });

    // 4. Anulan un cobro a mano, sin pasar por la caja.
    const [cobro] = await sql<{ id: number }>(`SELECT id FROM pagos WHERE cooperativa_id = $a AND estado = 'acreditado' ORDER BY id LIMIT 1`);
    ids.anulado = cobro!.id;
    await ejecutar(`UPDATE pagos SET estado = 'anulado', anulado_el = now(), anulado_por = $cajero, motivo_anulacion = 'Error de caja' WHERE id = $id`, {
      id: cobro!.id,
      cajero: w.cajeroA.id,
    });

    // 5. Le bajan el importe a otro recibo.
    const [otroCobro] = await sql<{ id: number }>(`SELECT id FROM pagos WHERE cooperativa_id = $a AND estado = 'acreditado' ORDER BY id DESC LIMIT 1`);
    ids.recibo = otroCobro!.id;
    await ejecutar(`UPDATE pagos SET importe = importe - 1 WHERE id = $id`, { id: otroCobro!.id });

    // 6. Cambian un registro de cambios, borran otro y agregan uno falso.
    const registros = await sql<{ id: number }>(`SELECT id FROM auditoria WHERE cooperativa_id = $a AND sellado_n IS NOT NULL ORDER BY sellado_n`);
    await ejecutar(`UPDATE auditoria SET despues_json = '{"accion":"nada"}' WHERE id = $id`, { id: registros[0]!.id });
    await ejecutar(`DELETE FROM auditoria WHERE id = $id`, { id: registros[1]!.id });
    await ejecutar(
      `INSERT INTO auditoria (cooperativa_id, accion, entidad, entidad_id, creado_el) VALUES ($a, 'anular_cobro', 'pago', $pago, now() - interval '1 hour')`,
      { pago: ids.anulado },
    );

    r = await verificar();
  });

  const hay = (libro: string, tipo: TipoProblema, entidadId?: number) =>
    r.problemas.some((p) => p.libro === libro && p.tipo === tipo && (entidadId === undefined || p.entidadId === entidadId));

  it('detecta el importe cambiado (la huella no coincide) y el saldo que ya no cierra con sus cobros', () => {
    expect(hay('facturas', 'huella_no_coincide', ids.paga)).toBe(true);
    expect(hay('facturas', 'saldo_no_cierra', ids.paga)).toBe(true);
  });

  it('detecta el renglón cambiado aunque los importes sigan cerrando', () => {
    expect(hay('facturas', 'huella_no_coincide', ids.texto)).toBe(true);
    expect(hay('facturas', 'total_no_cierra', ids.texto)).toBe(false);
  });

  it('detecta la factura borrada: falta el número y el eslabón siguiente no cierra', () => {
    const falta = r.problemas.find((p) => p.tipo === 'numeracion_salteada' && p.libro === 'facturas');
    expect(falta?.detalle).toContain(String(ids.borrada).padStart(8, '0'));
  });

  it('detecta el cobro anulado a mano y el recibo cambiado', () => {
    expect(hay('cobros', 'anulacion_sin_registro', ids.anulado)).toBe(true);
    expect(hay('cobros', 'huella_no_coincide', ids.recibo)).toBe(true);
    expect(hay('cobros', 'cobro_no_cierra', ids.recibo)).toBe(true);
  });

  it('detecta el registro de cambios alterado, el borrado y el agregado a mano', () => {
    expect(hay('auditoria', 'huella_no_coincide')).toBe(true);
    expect(hay('auditoria', 'numeracion_salteada')).toBe(true);
    expect(hay('auditoria', 'sin_huella')).toBe(true);
    // El registro falso no alcanza para justificar la anulación: no está sellado.
    expect(hay('cobros', 'anulacion_sin_registro', ids.anulado)).toBe(true);
  });

  it('no inventa problemas: todo lo que marca es de lo que se tocó', () => {
    expect(new Set(tipos(r))).toEqual(
      new Set([
        'auditoria:huella_no_coincide',
        'auditoria:numeracion_salteada',
        'auditoria:sin_huella',
        'cobros:anulacion_sin_registro',
        'cobros:cobro_no_cierra',
        'cobros:huella_no_coincide',
        'facturas:huella_no_coincide',
        'facturas:numeracion_salteada',
        'facturas:saldo_no_cierra',
      ]),
    );
    // El cobro anulado a mano dejó saldos que ya no cierran: se cuentan, pero cada uno con su factura.
    expect(r.total).toBe(r.problemas.length);
  });

  it('avisa a la administración, a la gerencia y a SRV, con mail a quien tiene uno de verdad', async () => {
    expect((await admin.post('/api/v1/integridad/verificar')).status).toBe(202);
    await esperarVerificaciones();
    const e: EstadoIntegridad = (await admin.get('/api/v1/integridad')).body.data;
    expect(e.ultima).toMatchObject({ estado: 'con_problemas' });
    expect(e.ultima!.totalProblemas).toBe(r.total);
    expect(e.historial[0]).toMatchObject({ estado: 'ok' });

    const alertas = await runInCooperativa(w.a.id, () => Alerta.findAll({ order: [['usuarioId', 'ASC']] }));
    const porMail = new Map(alertas.map((a) => [a.usuarioId, a]));
    expect(alertas.every((a) => a.tipo === 'integridad' && a.enlace === '/integridad')).toBe(true);
    expect(porMail.get(w.adminA.id)?.correoEstado).toBe('sin_correo');
    expect(porMail.get(w.superadmin.id)).toBeDefined();
    // La de la gerente sí sale por mail (en los tests, simulado: no hay clave de Resend).
    const gerente = alertas.find((a) => a.correoDestino === 'gerente@cooperativa-a.com.ar');
    expect(gerente?.correoEstado).toBe('simulado');
    // A la caja no le llega: no es de administración ni de gerencia.
    expect(porMail.has(w.cajeroA.id)).toBe(false);
    expect(alertas[0]!.cuerpo).toMatch(/No borres ni corrijas nada todavía/);
  });

  it('cada uno ve las suyas en la campana y las marca como leídas; la otra cooperativa no ve nada', async () => {
    const bandeja: BandejaAlertas = (await admin.get('/api/v1/alertas')).body.data;
    expect(bandeja.sinLeer).toBe(1);
    expect(bandeja.alertas[0]).toMatchObject({ leida: false, cooperativa: { id: w.a.id } });
    expect((await admin.post(`/api/v1/alertas/${bandeja.alertas[0]!.id}/leida`)).status).toBe(200);
    expect((await admin.get('/api/v1/alertas')).body.data.sinLeer).toBe(0);

    const srv: BandejaAlertas = (await (await loginAs('super@proveedor.test')).get('/api/v1/alertas')).body.data;
    expect(srv.sinLeer).toBe(1);
    expect(srv.alertas[0]!.cooperativa.nombreCorto).toBe('Coop coop-a');

    const b = await loginAs('admin@b.test');
    expect((await b.get('/api/v1/alertas')).body.data.alertas).toEqual([]);
    // Ni puede marcar como leída una alerta ajena.
    expect((await b.post(`/api/v1/alertas/${bandeja.alertas[0]!.id}/leida`)).status).toBe(404);
  });
});

describe('mails y horario', () => {
  it('Resend: de a 100 por pedido, y un error no corta los demás', async () => {
    const pedidos: { url: string; cantidad: number }[] = [];
    let llamada = 0;
    const falso = (async (url: string, init: RequestInit) => {
      const cuerpo = JSON.parse(String(init.body)) as unknown[];
      pedidos.push({ url, cantidad: cuerpo.length });
      llamada += 1;
      if (llamada === 2) return new Response(JSON.stringify({ message: 'Límite superado' }), { status: 429 });
      return new Response(JSON.stringify({ data: cuerpo.map((_, i) => ({ id: `m${i}` })) }), { status: 200 });
    }) as unknown as typeof fetch;
    const resend = correoResend('re_prueba', 'GestiónCoop <avisos@prueba.ar>', falso);
    const correos = Array.from({ length: 150 }, (_, i) => ({ para: `p${i}@cooperativa.ar`, asunto: 'A', texto: 'T' }));
    const r = await resend.enviarLote(correos);
    expect(pedidos.map((p) => p.cantidad)).toEqual([100, 50]);
    expect(pedidos[0]!.url).toBe('https://api.resend.com/emails/batch');
    expect(r.filter((x) => x.estado === 'enviado')).toHaveLength(100);
    expect(r.slice(100).every((x) => x.estado === 'fallido' && x.error === 'Límite superado')).toBe(true);
  });

  it('a las direcciones de prueba no se les manda nada', () => {
    expect(['caja@dosdemayo.example', 'admin@a.test', 'x@example.com'].every(esDireccionDePrueba)).toBe(true);
    expect(esDireccionDePrueba('presidencia@ayedosdemayo.coop')).toBe(false);
  });

  it('una alerta sin destinatarios no deja nada', async () => {
    expect(await alertar(w.b.id, { roles: ['gerencia'], srv: false }, { tipo: 'x', titulo: 'x', cuerpo: 'x' })).toBe(0);
  });

  it('la verificación diaria cae a la hora de Argentina', () => {
    // 26/11 a las 02:00 de Argentina (05:00 UTC): la de las 03:30 es ese mismo día.
    expect(proximaHora(3, 30, new Date('2026-11-26T05:00:00Z')).toISOString()).toBe('2026-11-26T06:30:00.000Z');
    // A las 04:00 ya pasó: la próxima es al otro día.
    expect(proximaHora(3, 30, new Date('2026-11-26T07:00:00Z')).toISOString()).toBe('2026-11-27T06:30:00.000Z');
  });
});
