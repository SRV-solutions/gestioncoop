import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sequelize } from '../src/db';
import { runInCooperativa } from '../src/lib/context';
import { Auditoria } from '../src/models';
import { app, loginAs, request, resetWorld } from './helpers';

let w: Awaited<ReturnType<typeof resetWorld>>;

beforeAll(async () => {
  w = await resetWorld();
});
afterAll(() => sequelize.close());

// Un PNG de 1×1, de verdad.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const imagen = `data:image/png;base64,${PNG}`;
const URL_IMAGEN = /^\/api\/v1\/publico\/cooperativas\/\d+\/imagen\?v=[0-9a-f]{12}$/;

describe('imagen de la cooperativa', () => {
  it('la cambia gerencia o administración; el resto del personal, no', async () => {
    const cajero = await loginAs('caja@a.test');
    expect((await cajero.put('/api/v1/mi-cooperativa/imagen').send({ imagen })).status).toBe(403);
    expect((await cajero.delete('/api/v1/mi-cooperativa/imagen')).status).toBe(403);
    expect((await request(app).put('/api/v1/mi-cooperativa/imagen').send({ imagen })).status).toBe(401);

    // demo@a.test es de gerencia.
    const gerencia = await loginAs('demo@a.test');
    const res = await gerencia.put('/api/v1/mi-cooperativa/imagen').send({ imagen });
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(w.a.id);
    expect(res.body.data.tema.logoUrl).toMatch(URL_IMAGEN);
    // El resto del tema queda como estaba.
    expect(res.body.data.tema.iniciales).toBe(w.a.temaJson.iniciales);

    expect((await (await loginAs('admin@a.test')).put('/api/v1/mi-cooperativa/imagen').send({ imagen })).status).toBe(200);
    expect(await runInCooperativa(w.a.id, () => Auditoria.count({ where: { accion: 'cambiar_imagen_cooperativa' } }))).toBe(2);
  });

  it('se ve sin sesión (pantalla de ingreso) y la ve todo el que entra', async () => {
    const admin = await loginAs('admin@a.test');
    const logo = (await admin.get('/api/v1/auth/me')).body.data.cooperativa.tema.logoUrl as string;
    expect(logo).toMatch(URL_IMAGEN);
    expect((await request(app).get('/api/v1/auth/context?coop=coop-a')).body.data.cooperativa.tema.logoUrl).toBe(logo);

    const foto = await request(app).get(logo);
    expect(foto.status).toBe(200);
    expect(foto.headers['content-type']).toBe('image/png');
    expect(foto.headers['x-content-type-options']).toBe('nosniff');
    expect(foto.headers['cache-control']).toContain('immutable');
    expect(Buffer.compare(foto.body as Buffer, Buffer.from(PNG, 'base64'))).toBe(0);
  });

  it('es de esa cooperativa y de ninguna otra', async () => {
    expect((await request(app).get('/api/v1/auth/context?coop=coop-b')).body.data.cooperativa.tema.logoUrl ?? null).toBeNull();
    expect((await request(app).get(`/api/v1/publico/cooperativas/${w.b.id}/imagen`)).status).toBe(404);
    expect((await request(app).get('/api/v1/publico/cooperativas/abc/imagen')).status).toBe(404);
  });

  it('no acepta lo que no es una imagen', async () => {
    const admin = await loginAs('admin@a.test');
    const antes = (await admin.get('/api/v1/auth/me')).body.data.cooperativa.tema.logoUrl;
    const texto = Buffer.from('<script>alert(1)</script>').toString('base64');
    for (const mala of [
      undefined,
      'hola',
      `data:image/svg+xml;base64,${texto}`,
      // Dice ser PNG pero adentro hay otra cosa.
      `data:image/png;base64,${texto}`,
      `data:image/jpeg;base64,${PNG}`,
      `data:image/png;base64,${'A'.repeat(700_000)}`,
    ]) {
      expect((await admin.put('/api/v1/mi-cooperativa/imagen').send({ imagen: mala })).status).toBe(400);
    }
    expect((await admin.get('/api/v1/auth/me')).body.data.cooperativa.tema.logoUrl).toBe(antes);
  });

  it('se puede quitar: vuelven las iniciales', async () => {
    const admin = await loginAs('admin@a.test');
    const logo = (await admin.get('/api/v1/auth/me')).body.data.cooperativa.tema.logoUrl as string;
    const res = await admin.delete('/api/v1/mi-cooperativa/imagen');
    expect(res.status).toBe(200);
    expect(res.body.data.tema.logoUrl).toBeNull();
    expect((await request(app).get(logo)).status).toBe(404);
    expect((await admin.get('/api/v1/auth/me')).body.data.cooperativa.tema.logoUrl).toBeNull();
    expect(await runInCooperativa(w.a.id, () => Auditoria.count({ where: { accion: 'quitar_imagen_cooperativa' } }))).toBe(1);
  });
});
