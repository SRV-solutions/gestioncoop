import type { DatosCalles } from './generar-padron';

/**
 * Calles inventadas para la segunda cooperativa: una cuadrícula de 5 × 5 y dos caminos rurales.
 * Solo sirven para armar direcciones; esa cooperativa se carga sin coordenadas.
 */
export function callesInventadas(): DatosCalles {
  const centro: [number, number] = [-54.95, -27.33];
  const m = (x: number, y: number): [number, number] => [centro[0] + x / 99_000, centro[1] + y / 110_540];
  const esteOeste = ['Av. San Martín', 'Belgrano', 'Sarmiento', 'Los Lapachos', '9 de Julio'];
  const norteSur = ['Misiones', 'Güemes', '25 de Mayo', 'Mitre', 'Los Cedros'];
  return {
    centro,
    zonas: [
      { nombre: 'Pueblo', tipo: 'urbana', ancla: centro },
      { nombre: 'Colonia Norte', tipo: 'rural', ancla: m(0, 2500) },
    ],
    calles: [
      ...esteOeste.map((n, i) => ({ n, t: 'residential', u: 1, g: [m(-250, -200 + i * 100), m(250, -200 + i * 100)] })),
      ...norteSur.map((n, i) => ({ n, t: 'residential', u: 1, g: [m(-200 + i * 100, -250), m(-200 + i * 100, 250)] })),
      { n: 'Picada Norte', t: 'unclassified', u: 0, g: [m(0, 1200), m(150, 2500), m(0, 3800)] },
      { n: null, t: 'track', u: 0, g: [m(-1500, 2500), m(1500, 2600)] },
    ],
  };
}
