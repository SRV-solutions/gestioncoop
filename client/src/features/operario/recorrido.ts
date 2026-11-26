// El recorrido que elige el operario para una ruta: en qué orden visita las casas que le faltan.
// Por defecto es el orden que cargó la oficina; él puede pedir que la app lo arme saliendo de donde
// está parado, de una calle o de una casa. Se guarda en el teléfono (anda sin señal) y es de cada
// persona: no cambia el orden de la oficina ni el de otro operario.
import { useSyncExternalStore } from 'react';
import { armarRecorrido, calleDe, largoDelRecorrido, metrosEntre, type CasaRuta, type Lugar, type RutaDetalle } from '@shared';

export interface RecorridoGuardado {
  /** Mes de la lectura para el que se armó: el del mes que viene arranca de cero. */
  anio: number;
  mes: number;
  desde: 'posicion' | 'calle' | 'casa';
  /** Cómo se lo nombra en pantalla: «donde estabas», «Chile», «Chile 353». */
  etiqueta: string;
  inicio: Lugar;
  /** Circuito: termina cerca de donde empieza. */
  volver: boolean;
  /** Conexiones, en el orden de visita. */
  orden: number[];
  armadoEl: string;
}

/* ───────────────────────── Guardado en el teléfono ───────────────────────── */

const clave = (usuarioId: number, rutaId: number) => `coopgestion-recorrido-${usuarioId}-${rutaId}`;
const oyentes = new Set<() => void>();
const suscribir = (avisar: () => void) => {
  oyentes.add(avisar);
  return () => void oyentes.delete(avisar);
};
// Si la app está abierta en otra pestaña y ahí se cambia el recorrido, esta también se entera.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === null || e.key.startsWith('coopgestion-recorrido-')) for (const avisar of oyentes) avisar();
  });
}
// useSyncExternalStore necesita el mismo objeto mientras el texto guardado no cambie.
const leidos = new Map<string, { texto: string | null; valor: RecorridoGuardado | null }>();

function leer(k: string): RecorridoGuardado | null {
  let texto: string | null = null;
  try {
    texto = localStorage.getItem(k);
  } catch {
    /* almacenamiento no disponible: se trabaja con el orden de la oficina */
  }
  const anterior = leidos.get(k);
  if (anterior && anterior.texto === texto) return anterior.valor;
  let valor: RecorridoGuardado | null;
  try {
    const dato = texto ? (JSON.parse(texto) as RecorridoGuardado) : null;
    valor = dato && Array.isArray(dato.orden) ? dato : null;
  } catch {
    valor = null;
  }
  leidos.set(k, { texto, valor });
  return valor;
}

export function guardarRecorrido(usuarioId: number, rutaId: number, recorrido: RecorridoGuardado | null): void {
  try {
    if (recorrido) localStorage.setItem(clave(usuarioId, rutaId), JSON.stringify(recorrido));
    else localStorage.removeItem(clave(usuarioId, rutaId));
  } catch {
    /* almacenamiento no disponible */
  }
  for (const avisar of oyentes) avisar();
}

/** El recorrido que esta persona eligió para esta ruta, o `null` si sigue el orden de la oficina. */
export function useRecorrido(usuarioId: number | null, rutaId: number): RecorridoGuardado | null {
  return useSyncExternalStore(suscribir, () => (usuarioId === null ? null : leer(clave(usuarioId, rutaId))));
}

/* ───────────────────────── Aplicarlo a la ruta ───────────────────────── */

export const casaLista = (casa: CasaRuta) => casa.medidores.every((m) => m.lectura !== null);
const ubicada = (casa: CasaRuta): casa is CasaRuta & Lugar => casa.lat !== null && casa.lng !== null;
const comoLaOficina = (a: CasaRuta, b: CasaRuta) => a.orden - b.orden || a.conexionId - b.conexionId;

/**
 * La ruta con las casas en el orden en que se van a visitar. Primero lo ya hecho que quedó fuera
 * del recorrido, después el recorrido, y al final lo que el recorrido no incluye (casas sin ubicar).
 * No toca el `orden` de cada casa, que sigue siendo el de la oficina: sirve para volver atrás.
 */
export function enOrden(ruta: RutaDetalle, recorrido: RecorridoGuardado | null): RutaDetalle {
  const oficina = [...ruta.lista].sort(comoLaOficina);
  if (!recorrido || recorrido.anio !== ruta.anio || recorrido.mes !== ruta.mes) return { ...ruta, lista: oficina };
  const lugar = new Map(recorrido.orden.map((id, i) => [id, i]));
  const adentro = oficina.filter((c) => lugar.has(c.conexionId)).sort((a, b) => lugar.get(a.conexionId)! - lugar.get(b.conexionId)!);
  const afuera = oficina.filter((c) => !lugar.has(c.conexionId));
  return { ...ruta, lista: [...afuera.filter(casaLista), ...adentro, ...afuera.filter((c) => !casaLista(c))] };
}

/** Las casas que faltan y están ubicadas en el mapa: con esas se arma un recorrido. */
export const porRecorrer = (ruta: RutaDetalle) => ruta.lista.filter((c): c is CasaRuta & Lugar => !casaLista(c) && ubicada(c));

/** Metros que quedan por caminar siguiendo la lista, en línea recta. `desde` = dónde está parado, si se sabe. */
export function metrosQueFaltan(ruta: RutaDetalle, desde: Lugar | null = null): number {
  return largoDelRecorrido(porRecorrer(ruta), desde);
}

export interface Propuesta {
  orden: number[];
  metros: number;
  /** La primera casa, para decirle por dónde arranca. */
  primera: CasaRuta | null;
  /** Metros desde el punto de partida hasta la primera casa. */
  hastaLaPrimera: number;
}

/** Arma el recorrido de lo que falta saliendo de `inicio`. */
export function proponer(ruta: RutaDetalle, inicio: Lugar, volver: boolean): Propuesta {
  const casas = porRecorrer(ruta);
  const { orden, metros } = armarRecorrido(
    casas.map((c) => ({ id: c.conexionId, lat: c.lat, lng: c.lng })),
    inicio,
    { volver },
  );
  const primera = casas.find((c) => c.conexionId === orden[0]) ?? null;
  return { orden, metros, primera, hastaLaPrimera: primera ? metrosEntre(inicio, primera) : 0 };
}

/* ───────────────────────── «Empiezo en tal calle» ───────────────────────── */

export interface CalleDeLaRuta {
  nombre: string;
  /** Casas que faltan en esa calle, ubicadas. */
  casas: (CasaRuta & Lugar)[];
}

/** Las calles (o barrios) donde todavía hay casas por leer, por orden alfabético. */
export function callesPorRecorrer(ruta: RutaDetalle): CalleDeLaRuta[] {
  const porNombre = new Map<string, (CasaRuta & Lugar)[]>();
  for (const casa of porRecorrer(ruta)) {
    const nombre = calleDe(casa.direccion);
    porNombre.set(nombre, [...(porNombre.get(nombre) ?? []), casa]);
  }
  return [...porNombre].map(([nombre, casas]) => ({ nombre, casas })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { numeric: true }));
}

/**
 * Por qué casa de la calle conviene arrancar: la punta que queda más lejos del resto de la ruta.
 * Así el recorrido barre hacia adentro en lugar de empezar por el medio y tener que volver.
 */
export function puntaDeLaCalle(calle: CalleDeLaRuta, ruta: RutaDetalle): CasaRuta & Lugar {
  const todas = porRecorrer(ruta);
  const centro = { lat: todas.reduce((s, c) => s + c.lat, 0) / todas.length, lng: todas.reduce((s, c) => s + c.lng, 0) / todas.length };
  return calle.casas.reduce((lejos, c) => (metrosEntre(centro, c) > metrosEntre(centro, lejos) ? c : lejos));
}
