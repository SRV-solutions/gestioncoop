// Fase 1: el generador del padrón de prueba y las rutas de padrón y mapa.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MapaConexiones, Page, PadronResumen, SocioDetalle, SocioListado } from '../src/shared';
import { sequelize } from '../src/db';
import { runInCooperativa } from '../src/lib/context';
import { Conexion, Socio } from '../src/models';
import { callesInventadas } from '../src/seed/calles-inventadas';
import { cargarPadron } from '../src/seed/cargar-padron';
import callesDosDeMayo from '../src/seed/data/dosdemayo.json';
import { generarPadron, type DatosCalles, type PadronGenerado } from '../src/seed/generar-padron';
import { createUser, loginAs, resetWorld } from './helpers';

const calles = callesDosDeMayo as unknown as DatosCalles;
const OPCIONES = { hogares: 2000, semilla: 20261120 };

describe('generador del padrón de prueba', () => {
  let padron: PadronGenerado;
  beforeAll(() => {
    padron = generarPadron(calles, OPCIONES);
  });

  it('es determinístico: misma semilla, mismo padrón', () => {
    expect(JSON.stringify(generarPadron(calles, OPCIONES))).toBe(JSON.stringify(padron));
    expect(JSON.stringify(generarPadron(calles, { ...OPCIONES, semilla: 1 }))).not.toBe(JSON.stringify(padron));
  });

  it('respeta las cantidades del SPEC (sección 9)', () => {
    const con = (servicio: string) => padron.conexiones.filter((c) => c.servicios.some((s) => s.servicio === servicio)).length;
    expect(padron.conexiones).toHaveLength(2000);
    expect(con('energia')).toBe(2000);
    expect(con('agua')).toBeGreaterThan(1100);
    expect(con('agua')).toBeLessThan(1300);
    expect(con('internet')).toBeGreaterThan(620);
    expect(con('internet')).toBeLessThan(780);
    expect(con('tv')).toBeGreaterThan(390);
    expect(con('tv')).toBeLessThan(520);
    expect(con('sepelio')).toBeGreaterThan(800);
    expect(con('sepelio')).toBeLessThan(1000);
    expect(padron.zonas.filter((z) => z.tipo === 'urbana')).toHaveLength(6);
    expect(padron.zonas.filter((z) => z.tipo === 'rural')).toHaveLength(4);

    const energia = padron.conexiones.map((c) => c.servicios.find((s) => s.servicio === 'energia')!);
    const residencial = energia.filter((s) => s.categoria === 'residencial');
    expect(residencial.length / 2000).toBeGreaterThan(0.8);
    expect(residencial.length / 2000).toBeLessThan(0.9);
    const conSubsidio = residencial.filter((s) => s.tieneSubsidio).length / residencial.length;
    expect(conSubsidio).toBeGreaterThan(0.55);
    expect(conSubsidio).toBeLessThan(0.65);
    // el subsidio es solo residencial
    expect(energia.filter((s) => s.tieneSubsidio && s.categoria !== 'residencial')).toHaveLength(0);
  });

  it('ubica cada casa cerca de Dos de Mayo y sin encimarlas', () => {
    const claves = new Set<string>();
    for (const c of padron.conexiones) {
      expect(c.lat).toBeGreaterThan(-27.13);
      expect(c.lat).toBeLessThan(-26.93);
      expect(c.lng).toBeGreaterThan(-54.8);
      expect(c.lng).toBeLessThan(-54.57);
      expect(c.orientacion).toBeGreaterThanOrEqual(0);
      expect(c.orientacion).toBeLessThan(180);
      claves.add(`${c.lat},${c.lng}`);
    }
    expect(claves.size).toBe(2000);
  });

  it('el recorrido de cada zona va del 1 al último, sin saltos', () => {
    padron.zonas.forEach((_, zona) => {
      const ordenes = padron.conexiones.filter((c) => c.zona === zona).map((c) => c.ordenRuta);
      expect(ordenes).toEqual(ordenes.map((_, i) => i + 1));
    });
  });

  it('no usa documentos de rangos reales ni repite números', () => {
    const docs = [...padron.socios.map((s) => s.nroDoc), ...padron.socios.flatMap((s) => s.beneficiarios.map((b) => b.nroDoc))];
    expect(new Set(docs).size).toBe(docs.length);
    for (const s of padron.socios) {
      expect(s.nroDoc).toMatch(s.tipoDoc === 'DNI' ? /^99\d{6}$/ : /^\d{2}99\d{7}$/);
      if (s.email) expect(s.email).toMatch(/@example\.com$/);
      if (s.telefono) expect(s.telefono).toMatch(/^3755-00\d{4}$/);
    }
    expect(new Set(padron.socios.map((s) => s.numero)).size).toBe(padron.socios.length);
    expect(new Set(padron.conexiones.map((c) => c.numero)).size).toBe(2000);
    const medidores = padron.conexiones.flatMap((c) => c.servicios.flatMap((s) => s.medidores.map((m) => m.numero)));
    expect(new Set(medidores).size).toBe(medidores.length);
  });

  it('las fechas son coherentes', () => {
    for (const c of padron.conexiones) {
      for (const s of c.servicios) {
        expect(s.fechaAlta <= '2026-11-20').toBe(true);
        if (s.fechaBaja) expect(s.fechaBaja >= s.fechaAlta).toBe(true);
        expect(s.estado === 'baja').toBe(s.fechaBaja != null);
        // exactamente un medidor colocado en energía y agua; ninguno en el resto
        const colocados = s.medidores.filter((m) => !m.retiradoEl).length;
        expect(colocados).toBe(s.servicio === 'energia' || s.servicio === 'agua' ? 1 : 0);
      }
    }
  });
});

describe('API de padrón y mapa', () => {
  let w: Awaited<ReturnType<typeof resetWorld>>;
  let a: PadronGenerado;
  let agent: Awaited<ReturnType<typeof loginAs>>;

  beforeAll(async () => {
    w = await resetWorld();
    await createUser({ cooperativaId: w.a.id, email: 'operario@a.test', roles: ['operario'] });
    // A: 120 hogares con ubicación. B: 30 hogares sin coordenadas.
    a = generarPadron(callesInventadas(), { hogares: 120, semilla: 11, proporcionUrbana: 0.8 });
    await cargarPadron(a, { cooperativaId: w.a.id, planes: [{ servicio: 'internet', nombre: 'Internet 50 Mbps', precio: '100.00' }, { servicio: 'internet', nombre: 'Internet 100 Mbps', precio: '200.00' }, { servicio: 'tv', nombre: 'TV +80 canales', precio: '50.00' }] });
    await cargarPadron(generarPadron(callesInventadas(), { hogares: 30, semilla: 22 }), { cooperativaId: w.b.id, planes: [], sinUbicacion: true });
    agent = await loginAs('admin@a.test');
  });
  afterAll(() => sequelize.close());

  const lista = async (query: string) => (await agent.get(`/api/v1/padron/socios${query}`)).body.data as Page<SocioListado>;

  it('el resumen cuenta socios, conexiones, servicios y zonas', async () => {
    const res = await agent.get('/api/v1/padron/resumen');
    expect(res.status).toBe(200);
    const r = res.body.data as PadronResumen;
    expect(r.socios).toBe(a.socios.length);
    expect(r.conexiones).toBe(120);
    expect(r.porServicio.energia).toBe(a.conexiones.filter((c) => c.servicios[0]!.estado !== 'baja').length);
    expect(r.zonas.map((z) => z.nombre).sort()).toEqual(['Colonia Norte', 'Pueblo']);
    expect(r.zonas.reduce((t, z) => t + z.conexiones, 0)).toBe(120);
  });

  it('pagina por cursor sin repetir ni saltear socios', async () => {
    const vistos: number[] = [];
    let cursor: string | null = '';
    let total = -1;
    while (cursor !== null) {
      const pagina: Page<SocioListado> = await lista(`?limit=25${cursor ? `&cursor=${cursor}` : ''}`);
      expect(pagina.items.length).toBeLessThanOrEqual(25);
      vistos.push(...pagina.items.map((s) => s.numero));
      total = pagina.total;
      cursor = pagina.nextCursor;
    }
    expect(vistos).toEqual(a.socios.map((s) => s.numero).sort((x, y) => x - y));
    expect(total).toBe(a.socios.length);
  });

  it('busca por nombre sin importar acentos ni mayúsculas', async () => {
    const socio = a.socios.find((s) => /[áéíóú]/.test(s.nombre) && s.tipoDoc === 'DNI')!;
    const sinAcentos = socio.nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(',', '').toUpperCase();
    const r = await lista(`?q=${encodeURIComponent(sinAcentos)}`);
    expect(r.items.map((s) => s.numero)).toContain(socio.numero);
  });

  it('busca por documento, número de socio, conexión, medidor y dirección, todo en el mismo campo', async () => {
    const conexion = a.conexiones.find((c) => /^[A-Z].* \d+$/.test(c.direccion))!;
    const socio = a.socios[conexion.socio]!;
    const medidor = conexion.servicios[0]!.medidores.at(-1)!.numero;

    expect((await lista(`?q=${socio.nroDoc}`)).items.map((s) => s.numero)).toEqual([socio.numero]);
    expect((await lista(`?q=${socio.numero}`)).items.map((s) => s.numero)).toContain(socio.numero);
    expect((await lista(`?q=${conexion.numero}`)).items.map((s) => s.numero)).toContain(socio.numero);
    expect((await lista(`?q=${medidor}`)).items.map((s) => s.numero)).toEqual([socio.numero]);
    // el lector de código de barras o el cajero pueden tipear el medidor sin los ceros de adelante
    expect((await lista(`?q=${Number(medidor)}`)).items.map((s) => s.numero)).toContain(socio.numero);
    expect((await lista(`?q=${encodeURIComponent(conexion.direccion)}`)).items.map((s) => s.numero)).toContain(socio.numero);
    expect((await lista('?q=zzzzzz')).items).toEqual([]);
  });

  it('una búsqueda con caracteres raros no rompe nada', async () => {
    for (const q of ["' OR 1=1 --", '%_%', '"; DROP TABLE socios; --', '\\', '😀', 'a'.repeat(80)]) {
      const res = await agent.get(`/api/v1/padron/socios?q=${encodeURIComponent(q)}`);
      // Se buscan solo letras y números: los símbolos se descartan y la consulta nunca se arma con el texto crudo.
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data.items)).toBe(true);
    }
    // solo símbolos = búsqueda vacía = lista completa
    expect((await lista(`?q=${encodeURIComponent('%_%')}`)).total).toBe(a.socios.length);
    expect((await lista(`?q=${'a'.repeat(80)}`)).items).toEqual([]);
    expect(await runInCooperativa(w.a.id, () => Socio.count())).toBe(a.socios.length);
  });

  it('filtra por zona', async () => {
    const resumen = (await agent.get('/api/v1/padron/resumen')).body.data as PadronResumen;
    const colonia = resumen.zonas.find((z) => z.nombre === 'Colonia Norte')!;
    const r = await lista(`?zona=${colonia.id}&limit=100`);
    expect(r.total).toBeGreaterThan(0);
    expect(r.total).toBeLessThan(a.socios.length);
    expect(r.items.length).toBe(r.total);
  });

  it('la ficha del socio trae conexiones, servicios, medidores y beneficiarios', async () => {
    const index = a.socios.findIndex((s) => s.beneficiarios.length > 0);
    const esperado = a.socios[index]!;
    const fila = (await lista(`?q=${esperado.nroDoc}`)).items[0]!;
    const res = await agent.get(`/api/v1/padron/socios/${fila.id}`);
    expect(res.status).toBe(200);
    const ficha = res.body.data as SocioDetalle;
    expect(ficha).toMatchObject({ numero: esperado.numero, nombre: esperado.nombre, nroDoc: esperado.nroDoc });
    expect(ficha.beneficiarios).toHaveLength(esperado.beneficiarios.length);
    const propias = a.conexiones.filter((c) => c.socio === index);
    expect(ficha.conexiones.map((c) => c.numero)).toEqual(propias.map((c) => c.numero).sort((x, y) => x - y));
    const energia = ficha.conexiones[0]!.servicios[0]!;
    expect(energia.servicio).toBe('energia');
    expect(energia.medidores[0]!.retiradoEl).toBeNull();
    expect(typeof ficha.conexiones[0]!.lat).toBe('number');
  });

  it('el mapa entrega todas las conexiones ubicadas, en columnas del mismo largo', async () => {
    const res = await agent.get('/api/v1/mapa/conexiones');
    expect(res.status).toBe(200);
    const m = res.body.data as MapaConexiones;
    expect(m.ids).toHaveLength(120);
    for (const columna of [m.lng, m.lat, m.zona, m.estado, m.servicios, m.orientacion]) expect(columna).toHaveLength(120);
    expect(m.sinUbicacion).toBe(0);
    expect(m.zonas).toHaveLength(2);
    expect(m.zonas[0]!.poligono).toMatchObject({ type: 'Polygon' });
    // energía activa = bit 1; el estado coincide con el generado
    const cortadas = a.conexiones.filter((c) => c.servicios.some((s) => (s.servicio === 'energia' || s.servicio === 'agua') && s.estado === 'cortado')).length;
    expect(m.estado.filter((e) => e === 2).length).toBe(cortadas);
    expect(m.servicios.filter((s) => s & 1).length).toBe(a.conexiones.filter((c) => c.servicios[0]!.estado === 'activo').length);
  });

  it('una cooperativa sin padrón georreferenciado no rompe el mapa', async () => {
    const b = await loginAs('admin@b.test');
    const m = (await b.get('/api/v1/mapa/conexiones')).body.data as MapaConexiones;
    expect(m.ids).toEqual([]);
    expect(m.sinUbicacion).toBe(30);
  });

  it('aislamiento: la cooperativa A no ve ni busca socios, conexiones ni puntos de la B', async () => {
    const deB = await runInCooperativa(w.b.id, async () => ({ socio: await Socio.findOne(), conexion: await Conexion.findOne() }));
    expect((await agent.get(`/api/v1/padron/socios/${deB.socio!.id}`)).status).toBe(404);
    expect((await agent.get(`/api/v1/padron/conexiones/${deB.conexion!.id}`)).status).toBe(404);
    // la búsqueda en SQL crudo tampoco cruza: el documento de un socio de B no aparece desde A
    expect((await lista(`?q=${deB.socio!.nroDoc}`)).items).toEqual([]);
    expect((await lista(`?q=${deB.socio!.numero}`)).items.every((s) => a.socios.some((x) => x.numero === s.numero))).toBe(true);
    const mapa = (await agent.get('/api/v1/mapa/conexiones')).body.data as MapaConexiones;
    expect(mapa.ids).not.toContain(deB.conexion!.id);
  });

  it('el padrón y el mapa no son para socios ni operarios', async () => {
    const operario = await loginAs('operario@a.test');
    expect((await operario.get('/api/v1/padron/socios')).status).toBe(403);
    expect((await operario.get('/api/v1/padron/resumen')).status).toBe(403);
    expect((await operario.get('/api/v1/mapa/conexiones')).status).toBe(403);
    // el cajero busca en el padrón pero no entra al mapa
    const cajero = await loginAs('caja@a.test');
    expect((await cajero.get('/api/v1/padron/socios')).status).toBe(200);
    expect((await cajero.get('/api/v1/mapa/conexiones')).status).toBe(403);
  });
});
