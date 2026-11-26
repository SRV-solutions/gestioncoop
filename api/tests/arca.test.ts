// Factura electrónica con ARCA: las piezas sueltas (XML, importes, certificado y firma del pedido de
// acceso) y el recorrido completo por la API contra un ARCA de mentira: configurar desde el Panel de
// SRV, probar la conexión, sincronizar la numeración, emitir el mes, un rechazo en el medio, la
// recuperación de lo ya autorizado y la nota de crédito.
import { QueryTypes } from 'sequelize';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConfigFiscalVista, PruebaArca, TratamientoConcepto } from '../src/shared';
import { sequelize } from '../src/db';
import { cbteTipo, docTipo } from '../src/lib/arca/codigos';
import { importesArca, ImportesNoCierran, type RenglonFiscal } from '../src/lib/arca/importes';
import { urlQrFiscal } from '../src/lib/arca/qr';
import { ErrorArca } from '../src/lib/arca/transporte';
import { armarTra, firmarTra, leerCertificado } from '../src/lib/arca/wsaa';
import { armar, escapar, texto } from '../src/lib/arca/xml';
import { runInCooperativa } from '../src/lib/context';
import { esperarProcesos } from '../src/lib/facturacion';
import { usarTransporteArca } from '../src/lib/fiscal';
import { sellarPendientes, verificarIntegridad } from '../src/lib/integridad';
import { hoy } from '../src/lib/tarifas';
import { callesInventadas } from '../src/seed/calles-inventadas';
import { cargarPagos, cargarProductos } from '../src/seed/cargar-caja';
import { cargarFacturas } from '../src/seed/cargar-facturas';
import { cargarLecturas } from '../src/seed/cargar-lecturas';
import { cargarPadron } from '../src/seed/cargar-padron';
import { cargarTarifas } from '../src/seed/cargar-tarifas';
import { generarPadron, PLANES } from '../src/seed/generar-padron';
import { TARIFAS_ARROYO_DEL_MONTE } from '../src/seed/tarifas';
import { ArcaFalso, certificadoDePrueba } from './arca-falso';
import { createUser, loginAs, resetWorld } from './helpers';

const HOY = hoy();
const renglon = (r: Partial<RenglonFiscal> & Pick<RenglonFiscal, 'codigo' | 'importe'>): RenglonFiscal => ({
  grupo: 'basico',
  descripcion: r.codigo,
  porcentaje: null,
  base: null,
  ...r,
});

/* ───────────────────────── Piezas sueltas ───────────────────────── */

describe('XML', () => {
  it('escapa lo que se manda y lee lo que vuelve, con o sin prefijo', () => {
    expect(armar({ Auth: { Token: 'a<b', Cuit: 30 }, Vacio: null, Lista: [{ N: 1 }, { N: 2 }] }, 'ar:')).toBe(
      '<ar:Auth><ar:Token>a&lt;b</ar:Token><ar:Cuit>30</ar:Cuit></ar:Auth><ar:Lista><ar:N>1</ar:N></ar:Lista><ar:Lista><ar:N>2</ar:N></ar:Lista>',
    );
    expect(texto('<x:Resp><x:Msg>Campo &quot;DocNro&quot; &amp; más</x:Msg></x:Resp>', 'Msg')).toBe('Campo "DocNro" & más');
    expect(texto(`<a>${escapar('<b>1</b>')}</a>`, 'a')).toBe('<b>1</b>');
    expect(texto('<a/>', 'b')).toBeNull();
  });

  it('las tablas de ARCA', () => {
    expect([cbteTipo('factura', 'A'), cbteTipo('factura', 'B'), cbteTipo('nota_credito', 'B')]).toEqual([1, 6, 8]);
    expect([docTipo('DNI'), docTipo('CUIT'), docTipo(null), docTipo('otro')]).toEqual([96, 80, 99, 99]);
  });
});

describe('importes para ARCA', () => {
  // Una factura de energía: cargo fijo y consumo (neto), IVA 21 % sobre eso, alumbrado y una ley provincial.
  const energia = [
    renglon({ codigo: 'CARGO_FIJO', importe: '1000.00' }),
    renglon({ codigo: 'ESCALON', importe: '5000.00' }),
    renglon({ codigo: 'ALUMBRADO', grupo: 'gravamen', importe: '6200.00' }),
    renglon({ codigo: 'LEY_3195', grupo: 'gravamen', porcentaje: '3.31', base: '6000.00', importe: '198.60' }),
    renglon({ codigo: 'IVA_EE', grupo: 'gravamen', porcentaje: '21', base: '6000.00', importe: '1260.00' }),
    renglon({ codigo: 'BOMBEROS', grupo: 'adicional', importe: '2252.00' }),
  ];

  it('separa neto, IVA, tributos y no gravado, y cierran al centavo', () => {
    const i = importesArca(energia, 'B', {});
    expect(i).toMatchObject({ ImpTotal: '15910.60', ImpNeto: '6000.00', ImpIVA: '1260.00', ImpTrib: '6398.60', ImpTotConc: '2252.00', ImpOpEx: '0.00' });
    expect(i.iva).toEqual([{ Id: 5, BaseImp: '6000.00', Importe: '1260.00' }]);
    expect(i.tributos.map((t) => [t.Id, t.Importe])).toEqual([
      [99, '6200.00'],
      [99, '198.60'],
    ]);
  });

  it('usa lo que definió el contador para cada concepto', () => {
    const tratamientos: Record<string, TratamientoConcepto> = {
      ALUMBRADO: { tratamiento: 'tributo', tributoId: 3 },
      LEY_3195: { tratamiento: 'tributo', tributoId: 2 },
      BOMBEROS: { tratamiento: 'exento', tributoId: null },
    };
    const i = importesArca(energia, 'B', tratamientos);
    expect(i.tributos.map((t) => t.Id)).toEqual([3, 2]);
    expect(i).toMatchObject({ ImpOpEx: '2252.00', ImpTotConc: '0.00' });
  });

  it('dos alícuotas van por separado; el IVA de los recargos suma a su base', () => {
    const i = importesArca(
      [
        renglon({ codigo: 'ESCALON', importe: '1000.00' }),
        renglon({ codigo: 'IVA_EE_27', grupo: 'gravamen', porcentaje: '27', base: '1000.00', importe: '270.00' }),
        renglon({ codigo: 'MORA', grupo: 'recargo', importe: '100.00' }),
        renglon({ codigo: 'IVA_RECARGOS', grupo: 'adicional', porcentaje: '21', base: '100.00', importe: '21.00' }),
      ],
      'A',
      {},
    );
    expect(i.iva).toEqual([
      { Id: 5, BaseImp: '100.00', Importe: '21.00' },
      { Id: 6, BaseImp: '1000.00', Importe: '270.00' },
    ]);
    expect(i).toMatchObject({ ImpNeto: '1100.00', ImpIVA: '291.00', ImpTotConc: '0.00', ImpTotal: '1391.00' });
  });

  it('si no cierran, lo dice en vez de mandar algo que ARCA va a rechazar', () => {
    expect(() => importesArca([renglon({ codigo: 'ESCALON', importe: '100.00' }), renglon({ codigo: 'IVA', porcentaje: '21', base: '500.00', importe: '105.00' })], 'B', {})).toThrow(
      ImportesNoCierran,
    );
    expect(() => importesArca([renglon({ codigo: 'ESCALON', importe: '0.00' })], 'B', {})).toThrow(/cero/);
    expect(() => importesArca([renglon({ codigo: 'IVA', porcentaje: '19', base: '100.00', importe: '19.00' })], 'B', {})).toThrow(/alícuota/);
  });

  it('el QR fiscal lleva los datos del comprobante', () => {
    const url = urlQrFiscal({ fecha: '2026-11-26', cuit: '30610990890', puntoVenta: 7, tipo: 'factura', letra: 'B', numero: 15, total: '121.50', tipoDoc: 'DNI', nroDoc: '20.123.456', cae: '70000000000001' });
    const datos = JSON.parse(Buffer.from(url.split('p=')[1]!, 'base64').toString());
    expect(datos).toEqual({ ver: 1, fecha: '2026-11-26', cuit: 30610990890, ptoVta: 7, tipoCmp: 6, nroCmp: 15, importe: 121.5, moneda: 'PES', ctz: 1, tipoDocRec: 96, nroDocRec: 20123456, tipoCodAut: 'E', codAut: 70000000000001 });
  });
});

describe('certificado y pedido de acceso', () => {
  const uno = certificadoDePrueba();
  const otro = certificadoDePrueba();

  it('lee el certificado y controla que la clave sea la suya', () => {
    const leido = leerCertificado(uno.certificado, uno.clave);
    expect(leido.titular).toContain('CUIT 30000000007');
    expect(leido.vence > HOY).toBe(true);
    expect(() => leerCertificado(uno.certificado, otro.clave)).toThrow(/no corresponde/);
    expect(() => leerCertificado('basura', uno.clave)).toThrow(ErrorArca);
  });

  it('firma el pedido con el certificado adentro', async () => {
    const tra = armarTra('wsfe', new Date('2026-11-26T12:00:00Z'));
    expect(tra).toContain('<service>wsfe</service>');
    expect(tra).toContain('<generationTime>2026-11-26T08:50:00-03:00</generationTime>');
    const falso = new ArcaFalso();
    // El ARCA de mentira abre el CMS: si la firma estuviera mal armada, no podría leer el contenido.
    await falso.transporte({ url: 'x', accion: '', cuerpo: `<in0>${firmarTra(tra, uno.certificado, uno.clave)}</in0>` });
    expect(falso.tras[0]).toBe(tra);
  });
});

/* ───────────────────────── Por la API ───────────────────────── */

let w: Awaited<ReturnType<typeof resetWorld>>;
type Agente = Awaited<ReturnType<typeof loginAs>>;
let srv: Agente;
let oficina: Agente;
const arca = new ArcaFalso();
const cert = certificadoDePrueba();
const fiscal = (id = w.a.id) => `/api/v1/cooperativas/${id}/fiscal`;
const sql = <T extends object>(texto: string, bind: Record<string, unknown> = {}) => sequelize.query<T>(texto, { bind: { a: w.a.id, ...bind }, type: QueryTypes.SELECT });
const estado = async () => (await oficina.get('/api/v1/facturacion/estado')).body.data;
const PV = 2;

beforeAll(async () => {
  w = await resetWorld();
  usarTransporteArca(arca.transporte);
  await cargarPadron(generarPadron(callesInventadas(), { hogares: 30, semilla: 21 }), {
    cooperativaId: w.a.id,
    planes: [
      { servicio: 'internet' as const, nombre: PLANES.internet50, precio: '20000.00' },
      { servicio: 'internet' as const, nombre: PLANES.internet100, precio: '30000.00' },
      { servicio: 'tv' as const, nombre: PLANES.tv, precio: '15000.00' },
    ],
  });
  await cargarTarifas(w.a.id, TARIFAS_ARROYO_DEL_MONTE);
  await cargarLecturas(w.a.id, { hoy: HOY, semilla: 21, avance: [0.5, 0] });
  await cargarFacturas(w.a.id, { semilla: 21 });
  // Los cobros del historial: sin ellos, las facturas pagas del historial no tendrían con qué cerrar su saldo.
  await cargarProductos(w.a.id, [{ nombre: 'Garrafa de 10 kg', precio: '18500.00', stock: 40 }]);
  await cargarPagos(w.a.id, { semilla: 21 });
  await sellarPendientes(w.a.id);
  await createUser({ cooperativaId: w.a.id, email: 'facturacion@a.test', roles: ['facturacion'] });
  srv = await loginAs('super@proveedor.test');
  oficina = await loginAs('facturacion@a.test');
}, 120_000);
afterAll(async () => {
  usarTransporteArca(null);
  await esperarProcesos();
  await sequelize.close();
});

describe('Panel de SRV: factura electrónica', () => {
  it('arranca simulada y solo la configura SRV', async () => {
    const res = await srv.get(fiscal());
    expect(res.status).toBe(200);
    const v: ConfigFiscalVista = res.body.data;
    expect(v).toMatchObject({ ambiente: 'simulado', cuit: '30000000007', cuitPropio: null, puntoVenta: 1, certificado: null });
    expect(v.conceptos.map((c) => c.codigo)).toEqual(expect.arrayContaining(['ALUMBRADO', 'SEPELIO_TITULAR']));
    expect(v.conceptos.every((c) => !c.codigo.startsWith('IVA'))).toBe(true);
    expect((await (await loginAs('admin@a.test')).get(fiscal())).status).toBe(403);
  });

  it('sin certificado no se puede pasar a ARCA; un archivo que no es certificado se rechaza', async () => {
    const res = await srv.put(fiscal()).send({ ambiente: 'homologacion', puntoVenta: 1 });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/certificado/);
    expect((await srv.put(`${fiscal()}/certificado`).send({ certificado: 'hola', clave: 'chau' })).status).toBe(400);
    const otro = certificadoDePrueba();
    const mezclado = await srv.put(`${fiscal()}/certificado`).send({ certificado: cert.certificado, clave: otro.clave });
    expect(mezclado.status).toBe(400);
    expect(mezclado.body.error.message).toMatch(/no corresponde/);
  });

  it('el CUIT se controla con su dígito verificador', async () => {
    const res = await srv.put(fiscal()).send({ ambiente: 'simulado', cuit: '30-61099089-1', puntoVenta: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error.fields.cuit).toMatch(/no es válido/);
  });

  it('guarda el certificado con la clave cifrada y nunca la devuelve', async () => {
    const res = await srv.put(`${fiscal()}/certificado`).send(cert);
    expect(res.status).toBe(200);
    expect(res.body.data.certificado).toMatchObject({ vencido: false });
    expect(res.body.data.certificado.titular).toContain('CUIT 30000000007');
    expect(JSON.stringify(res.body)).not.toContain('PRIVATE KEY');
    const [fila] = await sql<{ clave_cifrada: string }>(`SELECT clave_cifrada FROM config_fiscal WHERE cooperativa_id = $a`);
    expect(fila!.clave_cifrada).toMatch(/^v1:/);
    expect(fila!.clave_cifrada).not.toContain('PRIVATE KEY');
  });

  it('pasa a homologación con un punto de venta nuevo; producción hay que confirmarla', async () => {
    const res = await srv.put(fiscal()).send({ ambiente: 'homologacion', puntoVenta: PV, tratamientos: { ALUMBRADO: { tratamiento: 'tributo', tributoId: 3 } } });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ ambiente: 'homologacion', puntoVenta: PV });
    expect((await srv.put(fiscal()).send({ ambiente: 'produccion', puntoVenta: PV })).status).toBe(409);
  });

  it('prueba la conexión y marca la numeración desalineada; sincronizar la lleva hasta la de ARCA', async () => {
    // Otro sistema ya facturó B en este punto de venta, hasta el 5.
    arca.ultimos.set(`${PV}|6`, 5);
    const prueba: PruebaArca = (await srv.post(`${fiscal()}/probar`)).body.data;
    expect(prueba.pasos.slice(0, 2).every((p) => p.ok)).toBe(true);
    expect(prueba.ok).toBe(false);
    expect(prueba.numeracion.find((n) => n.tipo === 'factura' && n.letra === 'B')).toMatchObject({ enArca: 5, enApp: 0 });

    const sinc = await srv.post(`${fiscal()}/sincronizar`);
    expect(sinc.status).toBe(200);
    expect((await srv.post(`${fiscal()}/probar`)).body.data.ok).toBe(true);
    // El permiso de acceso se pidió una sola vez y se reutiliza.
    expect(arca.logins).toBe(1);
  });
});

describe('emitir el mes con ARCA', () => {
  it('prepara el mes', async () => {
    await oficina.post('/api/v1/lecturas/estimar-pendientes');
    await oficina.post('/api/v1/facturacion/prefacturar');
    await esperarProcesos();
    const e = await estado();
    expect(e.mes.estado).toBe('prefacturado');
    expect(e.prefactura.errores).toBe(0);
    const [r] = await sql<{ pv: number }>(`SELECT DISTINCT punto_venta AS pv FROM comprobantes WHERE cooperativa_id = $a AND estado = 'borrador'`);
    expect(r!.pv).toBe(PV);
  });

  let rechazadaId = 0;
  let total = 0;

  it('si ARCA rechaza una, las demás se emiten, esa queda con el motivo y no queda ningún hueco', async () => {
    const [{ n }] = (await sql<{ n: string }>(`SELECT count(*) AS n FROM comprobantes WHERE cooperativa_id = $a AND estado = 'borrador'`)) as [{ n: string }];
    total = Number(n);
    // El primer número B de esta emisión ya lo había autorizado ARCA en un intento que se cortó: se recupera.
    const [primera] = await sql<{ id: number; total: string; nro: string }>(
      `SELECT id, total::text AS total, snapshot_json->'titular'->>'nroDoc' AS nro FROM comprobantes
       WHERE cooperativa_id = $a AND estado = 'borrador' AND letra = 'B' ORDER BY orden, id LIMIT 1`,
    );
    const caeRecuperado = arca.yaAutorizado(PV, 6, 6, { docNro: primera!.nro.replace(/\D/g, ''), total: primera!.total, fecha: HOY });
    // Y va a rechazar el documento de un socio con una sola factura B en el mes, más adelante en el lote.
    const [mal] = await sql<{ nro: string }>(
      `SELECT snapshot_json->'titular'->>'nroDoc' AS nro FROM comprobantes WHERE cooperativa_id = $a AND estado = 'borrador' AND letra = 'B'
       GROUP BY 1 HAVING count(*) = 1 ORDER BY min(orden) OFFSET 3 LIMIT 1`,
    );
    arca.rechazarDocs.add(mal!.nro.replace(/\D/g, ''));

    await oficina.post('/api/v1/facturacion/emitir');
    await esperarProcesos();

    const e = await estado();
    expect(e.mes.estado).toBe('prefacturado');
    const [proceso] = await sql<{ estado: string; error: string }>(`SELECT estado, error FROM procesos_facturacion WHERE cooperativa_id = $a AND tipo = 'emision' ORDER BY id DESC LIMIT 1`);
    expect(proceso).toMatchObject({ estado: 'fallido' });
    expect(proceso!.error).toMatch(/ARCA rechazó 1 factura/);

    const [rechazada] = await sql<{ id: number; error: string; numero: number | null }>(`SELECT id, error, numero FROM comprobantes WHERE cooperativa_id = $a AND estado = 'borrador'`);
    expect(rechazada!.error).toMatch(/ARCA lo rechazó: 10015/);
    expect(rechazada!.numero).toBeNull();
    rechazadaId = rechazada!.id;

    const emitidas = await sql<{ id: number; letra: string; numero: number; cae: string; cae_ambiente: string }>(
      `SELECT id, letra, numero, cae, cae_ambiente FROM comprobantes WHERE cooperativa_id = $a AND anio * 12 + mes = (SELECT max(anio * 12 + mes) FROM comprobantes WHERE cooperativa_id = $a) AND estado <> 'borrador' ORDER BY letra, numero`,
    );
    expect(emitidas).toHaveLength(total - 1);
    expect(emitidas.every((f) => f.cae_ambiente === 'homologacion' && /^7\d{13}$/.test(f.cae))).toBe(true);
    const b = emitidas.filter((f) => f.letra === 'B').map((f) => f.numero);
    expect(b[0]).toBe(6);
    expect(b).toEqual(b.map((_, i) => 6 + i));
    expect(emitidas.find((f) => f.id === primera!.id)!.cae).toBe(caeRecuperado);
    // ARCA y GestiónCoop quedaron en el mismo número.
    const [num] = await sql<{ ultimo: number }>(`SELECT ultimo FROM numeradores WHERE cooperativa_id = $a AND tipo = 'factura' AND letra = 'B' AND punto_venta = ${PV}`);
    expect(num!.ultimo).toBe(arca.ultimo(PV, 6));
  });

  it('corregido el dato, se emite lo que faltaba y el mes queda emitido', async () => {
    arca.rechazarDocs.clear();
    await sequelize.query(`UPDATE comprobantes SET error = NULL WHERE id = $id`, { bind: { id: rechazadaId } });
    expect((await oficina.post('/api/v1/facturacion/emitir')).status).toBe(202);
    await esperarProcesos();
    expect((await estado()).mes.estado).toBe('emitido');
    const [r] = await sql<{ numero: number; cae_ambiente: string }>(`SELECT numero, cae_ambiente FROM comprobantes WHERE id = $id`, { id: rechazadaId });
    expect(r!.cae_ambiente).toBe('homologacion');
    // Toma el número siguiente al último que se emitió.
    expect(r!.numero).toBe(arca.ultimo(PV, cbteTipo('factura', 'B')));
  });

  it('la nota de crédito pide su propio CAE y lleva la factura asociada', async () => {
    const [f] = await sql<{ id: number; numero: number; letra: string }>(
      `SELECT id, numero, letra FROM comprobantes WHERE cooperativa_id = $a AND cae_ambiente = 'homologacion' AND estado = 'emitido' AND tipo = 'factura' ORDER BY id LIMIT 1`,
    );
    const res = await oficina.post(`/api/v1/facturacion/comprobantes/${f!.id}/nota-credito`).send({ motivo: 'Lectura mal tomada' });
    expect(res.status).toBe(201);
    const [nota] = await sql<{ cae_ambiente: string; numero: number }>(`SELECT cae_ambiente, numero FROM comprobantes WHERE origen_id = $id`, { id: f!.id });
    expect(nota).toMatchObject({ cae_ambiente: 'homologacion', numero: 1 });
    const pedido = arca.pedidosCae.at(-1)!;
    expect(pedido.tipo).toBe(cbteTipo('nota_credito', f!.letra));
    expect(texto(pedido.detalles[0]!, 'Nro')).toBe(String(f!.numero));
  });

  it('si ARCA rechaza la nota de crédito, no queda nada a medias', async () => {
    const [f] = await sql<{ id: number; nro: string }>(
      `SELECT id, snapshot_json->'titular'->>'nroDoc' AS nro FROM comprobantes
       WHERE cooperativa_id = $a AND cae_ambiente = 'homologacion' AND estado = 'emitido' AND tipo = 'factura' AND letra = 'B' ORDER BY id LIMIT 1`,
    );
    arca.rechazarDocs.add(f!.nro.replace(/\D/g, ''));
    const res = await oficina.post(`/api/v1/facturacion/comprobantes/${f!.id}/nota-credito`).send({ motivo: 'Prueba' });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/ARCA lo rechazó/);
    const [r] = await sql<{ estado: string; notas: string }>(`SELECT estado, (SELECT count(*) FROM comprobantes n WHERE n.origen_id = c.id) AS notas FROM comprobantes c WHERE id = $id`, { id: f!.id });
    expect(r).toEqual({ estado: 'emitido', notas: '0' });
    arca.rechazarDocs.clear();
  });

  it('si ARCA tiene otro comprobante con ese número, frena en vez de pisarlo', async () => {
    const [f] = await sql<{ id: number }>(`SELECT id FROM comprobantes WHERE cooperativa_id = $a AND cae_ambiente = 'homologacion' AND estado = 'emitido' AND tipo = 'factura' AND letra = 'B' ORDER BY id LIMIT 1`);
    const siguiente = arca.ultimo(PV, cbteTipo('nota_credito', 'B')) + 1;
    arca.yaAutorizado(PV, cbteTipo('nota_credito', 'B'), siguiente, { docNro: '1', total: '1.00', fecha: HOY });
    const res = await oficina.post(`/api/v1/facturacion/comprobantes/${f!.id}/nota-credito`).send({ motivo: 'Prueba' });
    expect(res.status).toBe(502);
    expect(res.body.error).toMatchObject({ code: 'arca' });
    expect(res.body.error.message).toMatch(/con otros datos/);
  });

  it('el permiso de acceso se pidió una sola vez en todo el recorrido', () => {
    expect(arca.logins).toBe(1);
  });

  it('todo lo emitido con ARCA quedó sellado: la integridad está en orden', async () => {
    const r = await runInCooperativa(w.a.id, verificarIntegridad);
    expect(r.problemas).toEqual([]);
    expect(r.resumen.facturas.revisados).toBeGreaterThan(total);
  });
});

describe('ARCA no responde', () => {
  it('la emisión falla con un mensaje claro y no emite nada', async () => {
    usarTransporteArca(async () => {
      throw new ErrorArca('No pudimos conectarnos con ARCA (prueba).');
    });
    try {
      const [f] = await sql<{ id: number }>(`SELECT id FROM comprobantes WHERE cooperativa_id = $a AND cae_ambiente = 'homologacion' AND estado = 'emitido' AND tipo = 'factura' ORDER BY id DESC LIMIT 1`);
      const nota = await oficina.post(`/api/v1/facturacion/comprobantes/${f!.id}/nota-credito`).send({ motivo: 'Sin conexión' });
      expect(nota.status).toBe(502);
      expect(nota.body.error.message).toMatch(/No pudimos conectarnos con ARCA/);
    } finally {
      usarTransporteArca(arca.transporte);
    }
  });
});
