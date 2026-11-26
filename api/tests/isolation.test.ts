// Aislamiento entre cooperativas (SPEC sección 7): un usuario de la cooperativa A no puede
// leer ni tocar datos de la B. Se prueba por la API y directo sobre los modelos.
import jwt from 'jsonwebtoken';
import { QueryTypes } from 'sequelize';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config } from '../src/config';
import { sequelize } from '../src/db';
import { requestContext, runInCooperativa, runUnscoped } from '../src/lib/context';
import { HttpError } from '../src/lib/errors';
import { ACCESS_COOKIE } from '../src/lib/session';
import { TenantIsolationError } from '../src/lib/tenant';
import { Auditoria, SCOPED_MODELS, Usuario } from '../src/models';
import { app, loginAs, request, resetWorld } from './helpers';

let w: Awaited<ReturnType<typeof resetWorld>>;

beforeAll(async () => {
  w = await resetWorld();
});
afterAll(() => sequelize.close());

describe('por la API', () => {
  it('el admin de A lista solo usuarios de A', async () => {
    const agent = await loginAs('admin@a.test');
    const res = await agent.get('/api/v1/users');
    expect(res.status).toBe(200);
    const emails = res.body.data.map((u: { email: string }) => u.email).sort();
    expect(emails).toEqual(['admin@a.test', 'caja@a.test', 'demo@a.test']);
  });

  it('el admin de A no puede abrir un usuario de B: para él no existe', async () => {
    const agent = await loginAs('admin@a.test');
    const res = await agent.get(`/api/v1/users/${w.adminB.id}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ data: null, error: expect.objectContaining({ code: 'not_found' }) });
    // ...y sí puede abrir uno propio
    expect((await agent.get(`/api/v1/users/${w.cajeroA.id}`)).status).toBe(200);
  });

  it('el superadmin (usuario del proveedor) no aparece en ninguna cooperativa', async () => {
    const agent = await loginAs('admin@b.test');
    const res = await agent.get('/api/v1/users');
    const emails = res.body.data.map((u: { email: string }) => u.email).sort();
    expect(emails).toEqual(['admin@b.test', 'socio@b.test']);
  });

  it('cada sesión ve su propia cooperativa', async () => {
    const a = await (await loginAs('admin@a.test')).get('/api/v1/auth/me');
    const b = await (await loginAs('admin@b.test')).get('/api/v1/auth/me');
    expect(a.body.data.cooperativa.subdominio).toBe('coop-a');
    expect(b.body.data.cooperativa.subdominio).toBe('coop-b');
  });

  it('un token firmado con otra clave no sirve para cambiarse de cooperativa', async () => {
    const forged = jwt.sign({ coop: w.b.id, roles: ['admin'], sid: 'x' }, 'otra-clave-que-no-es-la-del-servidor', {
      subject: String(w.adminA.id),
    });
    const res = await request(app).get('/api/v1/users').set('Cookie', `${ACCESS_COOKIE}=${forged}`);
    expect(res.status).toBe(401);
  });

  it('en la dirección de la cooperativa B no entra gente de A', async () => {
    const host = `coop-b.${config.dominioBase}`;
    const wrong = await request(app).post('/api/v1/auth/login').set('Host', host).send({ email: 'admin@a.test', password: 'clave-de-prueba-123' });
    expect(wrong.status).toBe(401);
    const right = await request(app).post('/api/v1/auth/login').set('Host', host).send({ email: 'admin@b.test', password: 'clave-de-prueba-123' });
    expect(right.status).toBe(200);

    // Una sesión de A, llevada a la dirección de B, tampoco sirve.
    const agentA = await loginAs('admin@a.test');
    expect((await agentA.get('/api/v1/users').set('Host', host)).status).toBe(403);
  });

  it('el superadmin sin cooperativa elegida no ve datos de negocio; al elegir una, ve solo esa', async () => {
    const agent = await loginAs('super@proveedor.test');
    const none = await agent.get('/api/v1/users');
    expect(none.status).toBe(400);
    expect(none.body.error.code).toBe('no_cooperativa');

    const chosen = await agent.post('/api/v1/auth/cooperativa').send({ cooperativaId: w.b.id });
    expect(chosen.body.data.cooperativa.subdominio).toBe('coop-b');
    const res = await agent.get('/api/v1/users');
    expect(res.body.data.map((u: { email: string }) => u.email).sort()).toEqual(['admin@b.test', 'socio@b.test']);
  });

  it('solo el superadmin puede listar cooperativas o cambiar de cooperativa', async () => {
    const agent = await loginAs('admin@a.test');
    expect((await agent.get('/api/v1/cooperativas')).status).toBe(403);
    expect((await agent.post('/api/v1/auth/cooperativa').send({ cooperativaId: w.b.id })).status).toBe(403);
    // sigue en la suya
    expect((await agent.get('/api/v1/auth/me')).body.data.cooperativa.subdominio).toBe('coop-a');
  });
});

describe('en los modelos', () => {
  const enA = <T>(fn: () => T) => runInCooperativa(w.a.id, fn);

  it('las lecturas se filtran solas', async () => {
    await enA(async () => {
      expect(await Usuario.findByPk(w.adminB.id)).toBeNull();
      expect(await Usuario.findOne({ where: { email: 'admin@b.test' } })).toBeNull();
      expect(await Usuario.count()).toBe(3);
      expect((await Usuario.findAndCountAll()).count).toBe(3);
      // sum/min/max también: el id más alto de A, no el del último usuario de la base
      expect(await Usuario.max('id')).toBe(w.demoA.id);
    });
  });

  it('las escrituras masivas no alcanzan filas de otra cooperativa', async () => {
    await enA(async () => {
      const [changed] = await Usuario.update({ nombre: 'Hackeado' }, { where: { id: w.adminB.id } });
      expect(changed).toBe(0);
      expect(await Usuario.destroy({ where: { id: w.adminB.id } })).toBe(0);
    });
    const intact = await runUnscoped(() => Usuario.findByPk(w.adminB.id));
    expect(intact?.nombre).toBe('Persona admin');
  });

  it('no se puede crear ni guardar una fila de otra cooperativa', async () => {
    const deB = await runUnscoped(() => Usuario.findByPk(w.socioB.id));
    await enA(async () => {
      await expect(Usuario.create({ cooperativaId: w.b.id, email: 'x@b.test', nombre: 'X', hash: 'x' })).rejects.toThrow(TenantIsolationError);
      await expect(Usuario.bulkCreate([{ cooperativaId: w.b.id, email: 'y@b.test', nombre: 'Y', hash: 'y' }])).rejects.toThrow(TenantIsolationError);
      deB!.nombre = 'Cambiado desde A';
      await expect(deB!.save()).rejects.toThrow(TenantIsolationError);
      await expect(deB!.destroy()).rejects.toThrow(TenantIsolationError);
    });
  });

  it('no se puede mover una fila a otra cooperativa', async () => {
    await enA(async () => {
      const propio = await Usuario.findByPk(w.cajeroA.id);
      propio!.cooperativaId = w.b.id;
      await expect(propio!.save()).rejects.toThrow(TenantIsolationError);
      await expect(Usuario.update({ cooperativaId: w.b.id }, { where: { id: w.cajeroA.id } })).rejects.toThrow(TenantIsolationError);
    });
  });

  it('una fila nueva toma sola la cooperativa del pedido', async () => {
    const nueva = await enA(() => Auditoria.create({ cooperativaId: null, usuarioId: null, accion: 'probar', entidad: 'test', entidadId: null, antesJson: null, despuesJson: null, ip: null }));
    expect(nueva.cooperativaId).toBe(w.a.id);
  });

  it('falla cerrado: sin contexto o sin cooperativa no se puede consultar', async () => {
    // fuera de cualquier contexto (un script que se olvidó de declararlo)
    await expect(requestContext.exit(() => Usuario.findAll())).rejects.toThrow(TenantIsolationError);
    // un pedido sin cooperativa (por ejemplo, alguien sin sesión)
    const sinCooperativa = { userId: null, ip: null, roles: [], cooperativaId: null, unscoped: false };
    await expect(requestContext.run(sinCooperativa, () => Usuario.findAll())).rejects.toThrow(HttpError);
  });
});

describe('cobertura', () => {
  it('toda tabla con cooperativa_id tiene su modelo aislado', async () => {
    const rows = await sequelize.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'cooperativa_id'",
      { type: QueryTypes.SELECT },
    );
    const scoped = new Set<string>(SCOPED_MODELS.map((m) => m.tableName));
    const missing = rows.map((r) => r.table_name).filter((t) => !scoped.has(t));
    expect(missing, `Tablas sin aislar: agregá su modelo a SCOPED_MODELS (${missing.join(', ')})`).toEqual([]);
  });

  it('todo modelo con cooperativaId está en SCOPED_MODELS', () => {
    const scoped = new Set<unknown>(SCOPED_MODELS);
    const missing = Object.values(sequelize.models)
      .filter((m) => 'cooperativaId' in m.getAttributes() && !scoped.has(m))
      .map((m) => m.name);
    expect(missing).toEqual([]);
  });
});
