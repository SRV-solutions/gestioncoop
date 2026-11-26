// Recorrido de una ruta de lectura: en qué orden conviene visitar las casas saliendo de un punto.
// Lo usa el teléfono del operario, también sin señal: es una cuenta, no una consulta.
//
// Las distancias son en línea recta. No conoce el sentido de las calles ni lo que no se puede
// cruzar (un arroyo, un alambrado): da un buen orden para caminar, no el camino exacto.

export interface Lugar {
  lat: number;
  lng: number;
}

export interface PuntoRecorrido extends Lugar {
  id: number;
}

export interface RecorridoArmado {
  /** Ids de los puntos, en el orden en que conviene visitarlos. */
  orden: number[];
  /** Largo del recorrido en metros, desde el punto de partida (y de vuelta a él, si se pidió). */
  metros: number;
}

const RADIO_TIERRA = 6_371_000;
const RAD = Math.PI / 180;

/** Metros entre dos puntos cercanos (a la escala de un pueblo alcanza con la aproximación plana). */
export function metrosEntre(a: Lugar, b: Lugar): number {
  const x = (b.lng - a.lng) * RAD * Math.cos(((a.lat + b.lat) / 2) * RAD);
  const y = (b.lat - a.lat) * RAD;
  return Math.sqrt(x * x + y * y) * RADIO_TIERRA;
}

/** Largo de un recorrido ya ordenado, saliendo de `inicio`. */
export function largoDelRecorrido(puntos: Lugar[], inicio: Lugar | null, volver = false): number {
  let metros = 0;
  let anterior = inicio;
  for (const p of puntos) {
    if (anterior) metros += metrosEntre(anterior, p);
    anterior = p;
  }
  if (volver && inicio && anterior && puntos.length > 0) metros += metrosEntre(anterior, inicio);
  return metros;
}

/** Con más puntos que esto no se afina el orden (tardaría demasiado en un teléfono): queda el del vecino más cercano. */
const MAXIMO_PARA_AFINAR = 1500;
const PASADAS = 40;

/**
 * Arma el recorrido saliendo de `inicio`. Primero va siempre a lo más cercano que falte; después
 * deshace los cruces (2-opt), que es lo que más camino ahorra. No garantiza el recorrido más corto
 * posible —eso no se puede calcular en un teléfono con cientos de casas—, pero queda cerca.
 * Con los mismos datos da siempre el mismo orden.
 */
export function armarRecorrido(puntos: PuntoRecorrido[], inicio: Lugar, opciones: { volver?: boolean } = {}): RecorridoArmado {
  const volver = opciones.volver ?? false;
  const n = puntos.length;
  if (n === 0) return { orden: [], metros: 0 };

  // Nodo 0 = punto de partida; 1..n = las casas.
  const nodos: Lugar[] = [inicio, ...puntos];
  const total = n + 1;
  const d = new Float64Array(total * total);
  for (let i = 0; i < total; i++) {
    for (let j = i + 1; j < total; j++) {
      const m = metrosEntre(nodos[i]!, nodos[j]!);
      d[i * total + j] = m;
      d[j * total + i] = m;
    }
  }
  const dist = (a: number, b: number) => d[a * total + b]!;

  // 1. Siempre a lo más cercano que falte.
  const camino = [0];
  const visitado = new Uint8Array(total);
  visitado[0] = 1;
  for (let paso = 0; paso < n; paso++) {
    const desde = camino[camino.length - 1]!;
    let mejor = -1;
    for (let j = 1; j < total; j++) {
      if (!visitado[j] && (mejor === -1 || dist(desde, j) < dist(desde, mejor))) mejor = j;
    }
    visitado[mejor] = 1;
    camino.push(mejor);
  }

  // 2. Deshacer cruces: dar vuelta un tramo cuando eso acorta el camino. La partida no se mueve.
  if (n <= MAXIMO_PARA_AFINAR) {
    for (let pasada = 0, mejoro = true; mejoro && pasada < PASADAS; pasada++) {
      mejoro = false;
      for (let i = 1; i < total - 1; i++) {
        for (let k = i + 1; k < total; k++) {
          const a = camino[i - 1]!;
          const b = camino[i]!;
          const c = camino[k]!;
          // Después del último no hay nada, salvo que haya que volver a la partida.
          const e = k + 1 < total ? camino[k + 1]! : volver ? 0 : -1;
          const ahora = dist(a, b) + (e === -1 ? 0 : dist(c, e));
          const dadoVuelta = dist(a, c) + (e === -1 ? 0 : dist(b, e));
          if (dadoVuelta < ahora - 1e-6) {
            for (let x = i, y = k; x < y; x++, y--) {
              const t = camino[x]!;
              camino[x] = camino[y]!;
              camino[y] = t;
            }
            mejoro = true;
          }
        }
      }
    }
  }

  let metros = 0;
  for (let i = 1; i < total; i++) metros += dist(camino[i - 1]!, camino[i]!);
  if (volver) metros += dist(camino[total - 1]!, 0);
  return { orden: camino.slice(1).map((i) => puntos[i - 1]!.id), metros };
}

/**
 * La calle (o el barrio) de una dirección, para agrupar: «Chile 353» → «Chile»;
 * «Barrio Sagrado Corazón de Jesús, Mz 52 Lote 22» → «Barrio Sagrado Corazón de Jesús».
 */
export function calleDe(direccion: string): string {
  const antesDeLaComa = direccion.split(',')[0]!.trim();
  const sinNumero = antesDeLaComa.replace(/\s+(?:n[°ºo]\.?\s*)?\d+[a-z]?\s*$/i, '').replace(/\s+s\/n\s*$/i, '');
  return sinNumero.trim() || antesDeLaComa;
}

/** «850 m», «3,2 km», «12 km». */
export function formatDistancia(metros: number): string {
  if (metros < 950) return `${Math.max(10, Math.round(metros / 10) * 10)} m`;
  const km = metros / 1000;
  return `${km < 10 ? km.toFixed(1).replace('.', ',') : Math.round(km).toLocaleString('es-AR')} km`;
}
