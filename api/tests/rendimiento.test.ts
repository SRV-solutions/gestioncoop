// Lo que hace que la API rinda más y aguante varios procesos: el logo del PDF preparado una sola vez,
// los resultados recordados unos minutos y los trabajos colgados que se cierran por silencio (no por
// estar «en curso», que con varios procesos puede ser de otro que sigue trabajando).
import { PNG } from 'pngjs';
import { QueryTypes } from 'sequelize';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sequelize } from '../src/db';
import { cerrarProcesosHuerfanos } from '../src/lib/facturacion';
import { logoParaPdf } from '../src/lib/imagenes';
import { cerrarVerificacionesHuerfanas } from '../src/lib/integridad';
import { olvidarTodo, recordar } from '../src/lib/memoria';
import { resetWorld } from './helpers';

/** Un PNG con transparencia: la mitad izquierda roja opaca, la derecha transparente. */
function pngConTransparencia(ancho: number, alto: number): Buffer {
  const png = new PNG({ width: ancho, height: alto });
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      const i = (y * ancho + x) * 4;
      const izquierda = x < ancho / 2;
      png.data.set(izquierda ? [200, 0, 0, 255] : [0, 0, 0, 0], i);
    }
  }
  return PNG.sync.write(png);
}

describe('logo para el PDF', () => {
  it('lo achica a lo que se imprime, sobre blanco y sin transparencia, una sola vez', () => {
    const original = pngConTransparencia(1000, 600);
    const listo = logoParaPdf(original);
    expect(listo[25]).toBe(2); // PNG RGB: el PDF lo copia tal cual
    const leido = PNG.sync.read(listo);
    expect(leido.width).toBeLessThanOrEqual(384);
    expect(leido.height).toBeLessThanOrEqual(292);
    expect(leido.width / leido.height).toBeCloseTo(1000 / 600, 1);
    expect([...leido.data.subarray(0, 3)]).toEqual([200, 0, 0]);
    const ultimo = (leido.width * leido.height - 1) * 4;
    expect([...leido.data.subarray(ultimo, ultimo + 3)]).toEqual([255, 255, 255]);
    expect(listo.length).toBeLessThan(original.length);
    expect(logoParaPdf(Buffer.from(original))).toBe(listo);
  });

  it('un JPEG o algo ilegible vuelve como vino', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    expect(logoParaPdf(jpeg)).toBe(jpeg);
    const roto = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('basura')]);
    expect(logoParaPdf(roto)).toBe(roto);
  });
});

describe('resultados recordados', () => {
  it('calcula una vez aunque lleguen juntos, y otra vez al vencer o si falló', async () => {
    olvidarTodo();
    let veces = 0;
    const calcular = async () => ++veces;
    const juntos = await Promise.all([recordar('x', 50, calcular), recordar('x', 50, calcular), recordar('x', 50, calcular)]);
    expect(juntos).toEqual([1, 1, 1]);
    await new Promise((r) => setTimeout(r, 60));
    expect(await recordar('x', 50, calcular)).toBe(2);

    await expect(recordar('y', 1000, () => Promise.reject(new Error('falló')))).rejects.toThrow('falló');
    expect(await recordar('y', 1000, async () => 'ahora sí')).toBe('ahora sí');
  });
});

describe('trabajos colgados', () => {
  let a = 0;
  const sql = <T extends object>(texto: string) => sequelize.query<T>(texto, { bind: { a }, type: QueryTypes.SELECT });
  beforeAll(async () => {
    a = (await resetWorld()).a.id;
  });
  afterAll(() => sequelize.close());

  it('cierra el que hace rato no da señales de vida y deja el que sigue trabajando', async () => {
    await sequelize.query(
      `INSERT INTO procesos_facturacion (cooperativa_id, tipo, anio, mes, estado, creado_el, actualizado_el)
       VALUES ($a, 'emision', 2026, 9, 'en_curso', now() - interval '1 hour', now() - interval '5 minutes')`,
      { bind: { a } },
    );
    await cerrarProcesosHuerfanos();
    const [muerto] = await sql<{ estado: string }>(`SELECT estado FROM procesos_facturacion WHERE cooperativa_id = $a`);
    expect(muerto!.estado).toBe('fallido');

    await sequelize.query(
      `INSERT INTO procesos_facturacion (cooperativa_id, tipo, anio, mes, estado, creado_el, actualizado_el)
       VALUES ($a, 'emision', 2026, 10, 'en_curso', now() - interval '1 hour', now() - interval '10 seconds')`,
      { bind: { a } },
    );
    await cerrarProcesosHuerfanos();
    const vivos = await sql<{ n: string }>(`SELECT count(*) AS n FROM procesos_facturacion WHERE cooperativa_id = $a AND estado = 'en_curso'`);
    expect(vivos[0]!.n).toBe('1');
  });

  it('las verificaciones de integridad se cierran después de media hora', async () => {
    await sequelize.query(
      `INSERT INTO verificaciones_integridad (cooperativa_id, origen, estado, iniciada_el) VALUES ($a, 'manual', 'en_curso', now() - interval '5 minutes')`,
      { bind: { a } },
    );
    await cerrarVerificacionesHuerfanas();
    expect((await sql<{ estado: string }>(`SELECT estado FROM verificaciones_integridad WHERE cooperativa_id = $a`))[0]!.estado).toBe('en_curso');
    await sequelize.query(`UPDATE verificaciones_integridad SET iniciada_el = now() - interval '31 minutes' WHERE cooperativa_id = $a`, { bind: { a } });
    await cerrarVerificacionesHuerfanas();
    expect((await sql<{ estado: string }>(`SELECT estado FROM verificaciones_integridad WHERE cooperativa_id = $a`))[0]!.estado).toBe('fallida');
  });
});
