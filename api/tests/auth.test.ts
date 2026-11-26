import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config } from '../src/config';
import { sequelize } from '../src/db';
import { runUnscoped } from '../src/lib/context';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '../src/lib/session';
import { Auditoria, Sesion, Usuario } from '../src/models';
import { app, createUser, loginAs, PASSWORD, request, resetWorld } from './helpers';

let w: Awaited<ReturnType<typeof resetWorld>>;

beforeAll(async () => {
  w = await resetWorld();
});
afterAll(() => sequelize.close());

const cookiesOf = (res: { headers: Record<string, unknown> }) => (res.headers['set-cookie'] as string[] | undefined) ?? [];
/** "nombre=valor" de una cookie, listo para mandarlo en el encabezado Cookie. */
const pairOf = (cookies: string[], name: string) => cookies.find((c) => c.startsWith(`${name}=`))!.split(';')[0]!;

async function loginCookies(email: string) {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
  return { access: pairOf(cookiesOf(res), ACCESS_COOKIE), refresh: pairOf(cookiesOf(res), REFRESH_COOKIE) };
}

describe('ingreso', () => {
  it('con email y contraseña correctos abre sesión con cookies httpOnly', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email: '  Admin@A.test ', password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.error).toBeNull();
    expect(res.body.data.user).toMatchObject({ email: 'admin@a.test', roles: ['admin'] });
    expect(res.body.data.cooperativa.subdominio).toBe('coop-a');
    expect(JSON.stringify(res.body)).not.toContain('hash');

    const cookies = cookiesOf(res);
    const access = cookies.find((c) => c.startsWith(`${ACCESS_COOKIE}=`));
    const refresh = cookies.find((c) => c.startsWith(`${REFRESH_COOKIE}=`));
    expect(access).toMatch(/HttpOnly/i);
    expect(access).toMatch(/SameSite=Lax/i);
    expect(refresh).toMatch(/HttpOnly/i);
    // el token de renovación solo viaja a /auth
    expect(refresh).toMatch(/Path=\/api\/v1\/auth/);
  });

  it('responde lo mismo si la contraseña está mal, el email no existe o el usuario está desactivado', async () => {
    await createUser({ cooperativaId: w.a.id, email: 'baja@a.test', roles: ['cajero'], activo: false });
    const casos = [
      { email: 'admin@a.test', password: 'incorrecta' },
      { email: 'nadie@a.test', password: PASSWORD },
      { email: 'baja@a.test', password: PASSWORD },
    ];
    for (const body of casos) {
      const res = await request(app).post('/api/v1/auth/login').send(body);
      expect(res.status).toBe(401);
      expect(res.body).toEqual({
        data: null,
        error: { code: 'invalid_credentials', message: 'El email o la contraseña no son correctos' },
      });
      expect(cookiesOf(res)).toEqual([]);
    }
  });

  it('valida los datos y contesta con el detalle por campo', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.fields).toMatchObject({ email: 'Escribí tu email', password: 'Escribí tu contraseña' });
  });

  it('no entra nadie de una cooperativa desactivada', async () => {
    const { createCooperativa } = await import('./helpers');
    const baja = await createCooperativa('coop-baja', false);
    await createUser({ cooperativaId: baja.id, email: 'admin@baja.test', roles: ['admin'] });
    const res = await request(app).post('/api/v1/auth/login').send({ email: 'admin@baja.test', password: PASSWORD });
    expect(res.status).toBe(401);
  });

  it('deja registrado el ingreso en la auditoría', async () => {
    await loginAs('caja@a.test');
    const fila = await runUnscoped(() => Auditoria.findOne({ where: { accion: 'ingresar', usuarioId: w.cajeroA.id } }));
    expect(fila).toMatchObject({ cooperativaId: w.a.id, entidad: 'usuario' });
  });
});

describe('sesión', () => {
  it('sin sesión, la API pide ingresar', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('token_expired');
    expect((await request(app).get('/api/v1/users')).status).toBe(401);
  });

  it('cuando vence el token de acceso se renueva con el de renovación', async () => {
    const { refresh } = await loginCookies('admin@a.test');
    // A los 15 minutos el navegador descarta la cookie de acceso: solo queda la de renovación.
    const renovada = await request(app).post('/api/v1/auth/refresh').set('Cookie', refresh);
    expect(renovada.status).toBe(200);
    expect(renovada.body.data.user.email).toBe('admin@a.test');

    const nuevoAcceso = pairOf(cookiesOf(renovada), ACCESS_COOKIE);
    expect((await request(app).get('/api/v1/auth/me').set('Cookie', nuevoAcceso)).status).toBe(200);
  });

  it('al renovar se releen los permisos: un usuario desactivado pierde la sesión', async () => {
    const user = await createUser({ cooperativaId: w.a.id, email: 'temporal@a.test', roles: ['cajero'] });
    const agent = await loginAs('temporal@a.test');
    await runUnscoped(() => Usuario.update({ activo: false }, { where: { id: user.id } }));

    expect((await agent.post('/api/v1/auth/refresh')).status).toBe(401);
    const sesion = await Sesion.findOne({ where: { usuarioId: user.id } });
    expect(sesion?.revocadaEl).not.toBeNull();
  });

  it('al salir, la sesión queda cerrada del lado del servidor', async () => {
    const { access, refresh } = await loginCookies('admin@a.test');
    const salida = await request(app).post('/api/v1/auth/logout').set('Cookie', `${access}; ${refresh}`);
    expect(salida.status).toBe(200);
    // el servidor le pide al navegador que borre las dos cookies
    expect(cookiesOf(salida).filter((c) => /Expires=Thu, 01 Jan 1970/.test(c))).toHaveLength(2);
    // Aunque alguien se haya guardado el token de renovación, ya no sirve.
    expect((await request(app).post('/api/v1/auth/refresh').set('Cookie', refresh)).status).toBe(401);
  });

  it('un token de renovación inventado no sirve', async () => {
    const sesion = await Sesion.findOne({ where: { usuarioId: w.adminA.id, revocadaEl: null } });
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', `${REFRESH_COOKIE}=${sesion!.id}.${'a'.repeat(43)}`);
    expect(res.status).toBe(401);
  });
});

describe('permisos', () => {
  it('los roles se validan en el servidor', async () => {
    const cajero = await loginAs('caja@a.test');
    const res = await cajero.get('/api/v1/users');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
  });

  it('rechaza escrituras que vienen de otro sitio (CSRF)', async () => {
    const agent = await loginAs('admin@a.test');
    const ajeno = await agent.post('/api/v1/auth/logout').set('Origin', 'https://sitio-malicioso.example');
    expect(ajeno.status).toBe(403);
    expect(ajeno.body.error.code).toBe('bad_origin');
    // la sesión sigue viva
    expect((await agent.get('/api/v1/auth/me')).status).toBe(200);
    // desde nuestra dirección sí
    expect((await agent.post('/api/v1/auth/logout').set('Origin', config.appUrl)).status).toBe(200);
  });

  it('una dirección que no existe responde con la forma de siempre', async () => {
    const agent = await loginAs('admin@a.test');
    const res = await agent.get('/api/v1/no-existe');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ data: null, error: expect.objectContaining({ code: 'not_found' }) });
  });
});

describe('modo demo', () => {
  it('la pantalla de ingreso recibe la cooperativa, su tema y los usuarios de prueba', async () => {
    const res = await request(app).get('/api/v1/auth/context');
    expect(res.status).toBe(200);
    expect(res.body.data.cooperativa).toMatchObject({ subdominio: 'coop-a', tema: { iniciales: 'T' } });
    expect(res.body.data.demo.activo).toBe(true);
    expect(res.body.data.demo.opciones).toEqual([{ rol: 'gerencia', nombre: 'Persona demo' }]);
    expect(res.body.data.demo.cooperativas.map((c: { subdominio: string }) => c.subdominio)).toContain('coop-b');
  });

  it('entra como el usuario de prueba del rol pedido', async () => {
    const agent = request.agent(app);
    const res = await agent.post('/api/v1/auth/demo').send({ rol: 'gerencia' });
    expect(res.status).toBe(200);
    expect(res.body.data.user).toMatchObject({ email: 'demo@a.test', esDemo: true, roles: ['gerencia'] });
    expect((await agent.get('/api/v1/auth/me')).status).toBe(200);
  });

  it('nunca da acceso de superadmin ni usa cuentas que no sean de prueba', async () => {
    expect((await request(app).post('/api/v1/auth/demo').send({ rol: 'superadmin' })).status).toBe(400);
    // admin@a.test existe pero no es usuario de prueba
    expect((await request(app).post('/api/v1/auth/demo').send({ rol: 'admin' })).status).toBe(404);
  });

  it('con el modo demo apagado no hay botones ni entran los usuarios de prueba', async () => {
    const mutable = config as { demoMode: boolean };
    mutable.demoMode = false;
    try {
      expect((await request(app).post('/api/v1/auth/demo').send({ rol: 'gerencia' })).status).toBe(404);
      const ctx = await request(app).get('/api/v1/auth/context');
      expect(ctx.body.data.demo).toEqual({ activo: false, opciones: [], cooperativas: [] });
      const conClave = await request(app).post('/api/v1/auth/login').send({ email: 'demo@a.test', password: PASSWORD });
      expect(conClave.status).toBe(401);
    } finally {
      mutable.demoMode = true;
    }
  });

  it('sin los botones (DEMO_ACCESO_RAPIDO apagado), los usuarios de prueba entran con su contraseña', async () => {
    const mutable = config as { demoAccesoRapido: boolean };
    mutable.demoAccesoRapido = false;
    try {
      expect((await request(app).post('/api/v1/auth/demo').send({ rol: 'gerencia' })).status).toBe(404);
      const ctx = await request(app).get('/api/v1/auth/context');
      expect(ctx.body.data.demo).toEqual({ activo: false, opciones: [], cooperativas: [] });
      const conClave = await request(app).post('/api/v1/auth/login').send({ email: 'demo@a.test', password: PASSWORD });
      expect(conClave.status).toBe(200);
      expect(conClave.body.data.user).toMatchObject({ email: 'demo@a.test', esDemo: true });
    } finally {
      mutable.demoAccesoRapido = true;
    }
  });
});

describe('tutoriales con Solvix', () => {
  it('cada persona guarda cuáles hizo y cuáles omitió, y los encuentra al volver a entrar', async () => {
    const admin = await loginAs('admin@a.test');
    expect((await admin.get('/api/v1/auth/tutoriales')).body.data).toEqual({ hechos: [], omitidos: [] });

    const guardado = await admin.put('/api/v1/auth/tutoriales').send({ hechos: ['bienvenida', 'bienvenida'], omitidos: ['caja-cobrar'] });
    expect(guardado.status).toBe(200);
    // Los repetidos se guardan una sola vez.
    expect(guardado.body.data).toEqual({ hechos: ['bienvenida'], omitidos: ['caja-cobrar'] });

    // Otra sesión de la misma persona lo ve; otra persona, no.
    expect((await (await loginAs('admin@a.test')).get('/api/v1/auth/tutoriales')).body.data).toEqual({ hechos: ['bienvenida'], omitidos: ['caja-cobrar'] });
    expect((await (await loginAs('caja@a.test')).get('/api/v1/auth/tutoriales')).body.data).toEqual({ hechos: [], omitidos: [] });
  });

  it('el superadmin también, aunque todavía no haya elegido cooperativa', async () => {
    const superadmin = await loginAs('super@proveedor.test');
    expect((await superadmin.get('/api/v1/auth/tutoriales')).body.data).toEqual({ hechos: [], omitidos: [] });
    expect((await superadmin.put('/api/v1/auth/tutoriales').send({ hechos: ['bienvenida'], omitidos: [] })).status).toBe(200);
    expect((await superadmin.get('/api/v1/auth/tutoriales')).body.data.hechos).toEqual(['bienvenida']);
  });

  it('pide sesión y no acepta cualquier cosa', async () => {
    expect((await request(app).get('/api/v1/auth/tutoriales')).status).toBe(401);
    expect((await request(app).put('/api/v1/auth/tutoriales').send({ hechos: [], omitidos: [] })).status).toBe(401);
    const admin = await loginAs('admin@a.test');
    for (const cuerpo of [{}, { hechos: 'bienvenida', omitidos: [] }, { hechos: ['<script>'], omitidos: [] }, { hechos: Array.from({ length: 61 }, (_, i) => `t-${i}`), omitidos: [] }]) {
      expect((await admin.put('/api/v1/auth/tutoriales').send(cuerpo)).status).toBe(400);
    }
    // Nada de lo rechazado pisó lo guardado.
    expect((await admin.get('/api/v1/auth/tutoriales')).body.data.hechos).toEqual(['bienvenida']);
  });
});
