import { describe, expect, it } from 'vitest';
import { armarRecorrido, calleDe, formatDistancia, largoDelRecorrido, metrosEntre, type PuntoRecorrido } from '../src/shared';

// Dos de Mayo queda cerca de 27° S, 54,7° O.
const BASE = { lat: -27.02, lng: -54.68 };
/** Punto a `x` metros al este y `y` al norte de la base. */
const en = (id: number, x: number, y: number): PuntoRecorrido => ({ id, lat: BASE.lat + y / 111_195, lng: BASE.lng + x / (111_195 * Math.cos((BASE.lat * Math.PI) / 180)) });

/** Números al azar, pero siempre los mismos. */
function azar(semilla: number) {
  let s = semilla;
  return () => {
    s = (s * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return s / 4_294_967_296;
  };
}
function pueblo(cantidad: number, semilla: number): PuntoRecorrido[] {
  const r = azar(semilla);
  return Array.from({ length: cantidad }, (_, i) => en(i + 1, Math.round(r() * 2000), Math.round(r() * 1500)));
}

describe('recorrido de una ruta', () => {
  it('mide en metros', () => {
    expect(metrosEntre(BASE, en(1, 1000, 0))).toBeCloseTo(1000, 0);
    expect(metrosEntre(BASE, en(1, 300, 400))).toBeCloseTo(500, 0);
    expect(metrosEntre(BASE, BASE)).toBe(0);
  });

  it('pasa una sola vez por cada casa; si se parte de una casa, esa es la primera', () => {
    const casas = pueblo(120, 7);
    const inicio = en(0, 2100, 1600);
    const { orden, metros } = armarRecorrido(casas, inicio);
    expect([...orden].sort((a, b) => a - b)).toEqual(casas.map((c) => c.id));
    // «Empiezo en esta casa»: la partida es la casa misma.
    for (const elegida of [casas[0]!, casas[57]!, casas[119]!]) {
      expect(armarRecorrido(casas, elegida).orden[0]).toBe(elegida.id);
    }
    // El largo informado es el del orden devuelto.
    const porId = new Map(casas.map((c) => [c.id, c]));
    expect(metros).toBeCloseTo(largoDelRecorrido(orden.map((id) => porId.get(id)!), inicio), 3);
  });

  it('acorta el camino contra un orden cualquiera, y contra ir siempre a lo más cercano', () => {
    for (const semilla of [1, 2, 3, 4, 5]) {
      const casas = pueblo(200, semilla);
      const inicio = en(0, 0, 0);
      const { metros } = armarRecorrido(casas, inicio);
      const comoVienen = largoDelRecorrido(casas, inicio);
      expect(metros).toBeLessThan(comoVienen * 0.25);

      // Vecino más cercano, sin deshacer cruces.
      const faltan = [...casas];
      let desde: { lat: number; lng: number } = inicio;
      let largo = 0;
      while (faltan.length > 0) {
        faltan.sort((a, b) => metrosEntre(desde, a) - metrosEntre(desde, b));
        const sigue = faltan.shift()!;
        largo += metrosEntre(desde, sigue);
        desde = sigue;
      }
      expect(metros).toBeLessThanOrEqual(largo + 0.001);
    }
  });

  it('una cuadra se camina de punta a punta, sin ir y volver', () => {
    // Diez casas en fila, cada 20 m, dadas en desorden. Saliendo de una punta, el recorrido es la fila.
    const fila = [5, 2, 9, 0, 7, 3, 8, 1, 6, 4].map((i) => en(i + 1, i * 20, 0));
    const { orden, metros } = armarRecorrido(fila, en(0, -10, 0));
    expect(orden).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(metros).toBeCloseTo(190, 0);
  });

  it('con «volver», cuenta la vuelta a la partida y cierra el circuito', () => {
    // Cuatro esquinas de una manzana de 100 m.
    const manzana = [en(1, 0, 0), en(2, 100, 100), en(3, 100, 0), en(4, 0, 100)];
    const ida = armarRecorrido(manzana, en(0, 0, 0));
    const idaYVuelta = armarRecorrido(manzana, en(0, 0, 0), { volver: true });
    expect(ida.metros).toBeCloseTo(300, 0);
    expect(idaYVuelta.metros).toBeCloseTo(400, 0);
    expect(idaYVuelta.orden[0]).toBe(1);
  });

  it('da siempre el mismo orden con los mismos datos, y aguanta los casos chicos', () => {
    const casas = pueblo(80, 11);
    expect(armarRecorrido(casas, BASE)).toEqual(armarRecorrido(casas, BASE));
    expect(armarRecorrido([], BASE)).toEqual({ orden: [], metros: 0 });
    expect(armarRecorrido([en(9, 30, 40)], BASE).orden).toEqual([9]);
    expect(armarRecorrido([en(9, 30, 40)], BASE).metros).toBeCloseTo(50, 0);
    // Dos casas en el mismo lugar (dos medidores de un mismo lote) no lo rompen.
    expect(armarRecorrido([en(1, 10, 0), en(2, 10, 0), en(3, 50, 0)], BASE).orden).toEqual([1, 2, 3]);
  });

  it('termina rápido con una ruta grande', () => {
    const casas = pueblo(600, 3);
    const antes = performance.now();
    const { orden } = armarRecorrido(casas, BASE);
    expect(orden).toHaveLength(600);
    expect(performance.now() - antes).toBeLessThan(3000);
  });

  it('saca la calle o el barrio de una dirección', () => {
    expect(calleDe('Chile 353')).toBe('Chile');
    expect(calleDe('Avenida del Colono 727')).toBe('Avenida del Colono');
    expect(calleDe('Barrio Sagrado Corazón de Jesús, Mz 52 Lote 22')).toBe('Barrio Sagrado Corazón de Jesús');
    expect(calleDe('Colonia 2 de Mayo, Lote 17')).toBe('Colonia 2 de Mayo');
    expect(calleDe('25 de Mayo 1040')).toBe('25 de Mayo');
    expect(calleDe('Ruta 14 s/n')).toBe('Ruta 14');
    expect(calleDe('El Lapacho N° 342')).toBe('El Lapacho');
    expect(calleDe('1420')).toBe('1420');
  });

  it('escribe las distancias como se dicen', () => {
    expect(formatDistancia(4)).toBe('10 m');
    expect(formatDistancia(123)).toBe('120 m');
    expect(formatDistancia(949)).toBe('950 m');
    expect(formatDistancia(3240)).toBe('3,2 km');
    expect(formatDistancia(12_600)).toBe('13 km');
  });
});
