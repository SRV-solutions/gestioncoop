// Lo que el teléfono guarda para trabajar sin señal (SPEC 6.3): la copia de cada ruta y la cola de
// lecturas que todavía no llegaron al servidor. Todo en IndexedDB: sobrevive a cerrar la pestaña,
// a quedarse sin batería y a reiniciar el teléfono.
//
// Regla de oro: una lectura se escribe primero en el teléfono (en el instante) y recién después se
// intenta mandar. Sale de la cola solo cuando el servidor confirma que la recibió.
import { useSyncExternalStore } from 'react';
import { evaluarLectura, type LecturaCargada, type LecturaSyncEntrada, type ResultadoSync, type RutaDetalle } from '@shared';
import { api, ApiError } from '../../lib/api';

/** Lectura esperando para salir. `error` = el servidor la rechazó: no se reintenta sola. */
export interface EnCola extends LecturaSyncEntrada {
  rutaId: number;
  conexionId: number;
  error?: string;
}

/* ───────────────────────── IndexedDB ───────────────────────── */

const RUTAS = 'rutas';
const COLA = 'cola';
let usuarioId: number | null = null;
let abierta: Promise<IDBDatabase> | null = null;

const pedido = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB'));
  });
const terminada = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('IndexedDB'));
  });

function base(): Promise<IDBDatabase> {
  if (usuarioId === null) return Promise.reject(new Error('Almacén sin usuario'));
  // Una base por persona: si dos operarios comparten el teléfono, no se mezclan las colas.
  abierta ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(`coopgestion-operario-${usuarioId}`, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(RUTAS, { keyPath: 'id' });
      req.result.createObjectStore(COLA, { keyPath: 'uuid' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB'));
  });
  return abierta;
}

/* ───────────────────────── Estado que muestra la pantalla ───────────────────────── */

export interface EstadoCola {
  /** Lecturas guardadas en el teléfono que todavía no llegaron. */
  pendientes: number;
  /** Lecturas que el servidor no aceptó: hay que mirarlas. */
  rechazadas: number;
  enviando: boolean;
  /** Cambia cada vez que el servidor confirma algo: las pantallas lo usan para volver a pedir datos. */
  version: number;
}

let estado: EstadoCola = { pendientes: 0, rechazadas: 0, enviando: false, version: 0 };
const oyentes = new Set<() => void>();
function publicar(cambios: Partial<EstadoCola>) {
  estado = { ...estado, ...cambios };
  for (const avisar of oyentes) avisar();
}
const suscribir = (avisar: () => void) => {
  oyentes.add(avisar);
  return () => {
    oyentes.delete(avisar);
  };
};
export const useCola = (): EstadoCola => useSyncExternalStore(suscribir, () => estado);

async function contar(): Promise<void> {
  const cola = await leerCola();
  publicar({ pendientes: cola.filter((c) => !c.error).length, rechazadas: cola.filter((c) => c.error).length });
}

/** Se llama al entrar al área del operario: abre el almacén de esa persona y manda lo que haya quedado. */
export async function iniciarAlmacen(id: number): Promise<void> {
  if (usuarioId !== id) {
    usuarioId = id;
    abierta = null;
    estado = { pendientes: 0, rechazadas: 0, enviando: false, version: 0 };
  }
  // Le pide al teléfono que no borre estos datos aunque se quede sin espacio (sin esto, el navegador
  // puede vaciar el almacén de una página para hacer lugar, con lecturas sin mandar adentro).
  void navigator.storage?.persist?.().catch(() => false);
  await contar();
  void sincronizar();
}

/* ───────────────────────── Rutas ───────────────────────── */

export async function leerRuta(id: number): Promise<RutaDetalle | null> {
  const db = await base();
  return (await pedido<RutaDetalle | undefined>(db.transaction(RUTAS).objectStore(RUTAS).get(id))) ?? null;
}

export async function leerRutas(): Promise<RutaDetalle[]> {
  const db = await base();
  return pedido<RutaDetalle[]>(db.transaction(RUTAS).objectStore(RUTAS).getAll());
}

/** Saca del teléfono la copia de una ruta (la oficina se la pasó a otra persona). */
export async function borrarRuta(id: number): Promise<void> {
  const db = await base();
  const tx = db.transaction(RUTAS, 'readwrite');
  tx.objectStore(RUTAS).delete(id);
  await terminada(tx);
}

export async function leerCola(): Promise<EnCola[]> {
  const db = await base();
  return pedido<EnCola[]>(db.transaction(COLA).objectStore(COLA).getAll());
}

/** Cómo se ve en la lista una lectura que todavía está en el teléfono. */
function comoCargada(item: EnCola, ruta: RutaDetalle): LecturaCargada {
  const medidor = ruta.lista.flatMap((c) => c.medidores).find((m) => m.medidorId === item.medidorId && m.periodoId === item.periodoId);
  const evaluacion =
    item.valor == null || !medidor
      ? { consumo: null, anomalia: null }
      : evaluarLectura({ valor: item.valor, anterior: medidor.anterior?.valor ?? null, promedio: medidor.promedio, digitos: medidor.digitos, factor: medidor.factor, motivo: item.motivo });
  return {
    uuid: item.uuid,
    valor: item.valor ?? null,
    consumo: evaluacion.consumo,
    tipo: 'real',
    motivo: item.valor == null ? null : (item.motivo ?? null),
    novedad: item.novedad ?? null,
    anomalia: evaluacion.anomalia,
    nota: item.nota ?? null,
    tieneFoto: Boolean(item.foto),
    tomadaEl: item.tomadaEl,
  };
}

/** Pone sobre la copia de la ruta lo que está en la cola (lo del teléfono es más nuevo que lo del servidor). */
function conLoPendiente(ruta: RutaDetalle, cola: EnCola[]): RutaDetalle {
  const porMedidor = new Map(cola.filter((c) => c.rutaId === ruta.id && !c.error).map((c) => [`${c.periodoId}|${c.medidorId}`, c]));
  if (porMedidor.size === 0) return ruta;
  return {
    ...ruta,
    lista: ruta.lista.map((casa) => ({
      ...casa,
      medidores: casa.medidores.map((m) => {
        const item = porMedidor.get(`${m.periodoId}|${m.medidorId}`);
        return item ? { ...m, lectura: comoCargada(item, ruta) } : m;
      }),
    })),
  };
}

/**
 * La ruta para trabajar: con señal se baja de nuevo y se guarda; sin señal (o si el servidor no
 * contesta) se usa la copia del teléfono. Solo falla si no hay ni una cosa ni la otra.
 */
export async function obtenerRuta(id: number): Promise<RutaDetalle> {
  try {
    const fresca = await api.get<RutaDetalle>(`/lecturas/rutas/${id}`);
    const db = await base();
    const ruta = conLoPendiente(fresca, await leerCola());
    const tx = db.transaction(RUTAS, 'readwrite');
    tx.objectStore(RUTAS).put(ruta);
    await terminada(tx);
    return ruta;
  } catch (err) {
    // 4xx = el servidor contestó que no (ruta inexistente, lectura sin abrir): eso no se tapa con la copia.
    if (err instanceof ApiError && err.status >= 400 && err.status < 500) throw err;
    const guardada = await leerRuta(id);
    if (guardada) return guardada;
    throw err;
  }
}

/* ───────────────────────── Guardar una lectura ───────────────────────── */

/** UUID v4. `crypto.randomUUID` solo existe en https o localhost; en la red del local se arma a mano. */
function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export type DatosLectura = Pick<LecturaSyncEntrada, 'valor' | 'motivo' | 'novedad' | 'nota' | 'foto' | 'lat' | 'lng' | 'precision'>;

/**
 * Guarda la lectura en el teléfono —cola y copia de la ruta, en la misma transacción— y devuelve
 * la ruta actualizada. Después intenta mandarla, sin esperar: la pantalla ya puede pasar a la casa siguiente.
 */
export async function guardarLectura(ruta: RutaDetalle, conexionId: number, medidorId: number, periodoId: number, datos: DatosLectura): Promise<RutaDetalle> {
  const item: EnCola = { ...datos, uuid: uuid(), periodoId, medidorId, rutaId: ruta.id, conexionId, tomadaEl: new Date().toISOString() };
  const db = await base();
  const tx = db.transaction([RUTAS, COLA], 'readwrite');
  const cola = tx.objectStore(COLA);
  // Una corrección reemplaza a la lectura anterior del mismo medidor que todavía no salió.
  for (const viejo of await pedido<EnCola[]>(cola.getAll())) {
    if (viejo.medidorId === medidorId && viejo.periodoId === periodoId) cola.delete(viejo.uuid);
  }
  cola.put(item);
  const actualizada: RutaDetalle = {
    ...ruta,
    lista: ruta.lista.map((casa) =>
      casa.conexionId !== conexionId
        ? casa
        : { ...casa, medidores: casa.medidores.map((m) => (m.medidorId === medidorId && m.periodoId === periodoId ? { ...m, lectura: comoCargada(item, ruta) } : m)) },
    ),
  };
  tx.objectStore(RUTAS).put(actualizada);
  await terminada(tx);
  await contar();
  void sincronizar();
  return actualizada;
}

/** Saca de la cola una lectura rechazada (el operario ya vio por qué). */
export async function descartar(uuidLectura: string): Promise<void> {
  const db = await base();
  const tx = db.transaction(COLA, 'readwrite');
  tx.objectStore(COLA).delete(uuidLectura);
  await terminada(tx);
  await contar();
}

/* ───────────────────────── Sincronizar ───────────────────────── */

const LOTE = 25;
let enCurso: Promise<void> | null = null;

async function mandar(lote: EnCola[]): Promise<void> {
  // rutaId, conexionId y error son del teléfono: no viajan.
  const lecturas = lote.map(({ rutaId: _r, conexionId: _c, error: _e, ...l }) => l);
  const { resultados } = await api.post<{ resultados: ResultadoSync[] }>('/lecturas/sync', { lecturas });
  const db = await base();
  const tx = db.transaction(COLA, 'readwrite');
  const cola = tx.objectStore(COLA);
  for (const r of resultados) {
    const item = lote.find((l) => l.uuid === r.uuid);
    if (!item) continue;
    // Guardada o repetida: el servidor ya la tiene. Rechazada: queda en el teléfono, marcada, para que alguien la mire.
    if (r.estado === 'rechazada') cola.put({ ...item, error: r.error ?? 'El servidor no la aceptó' });
    else cola.delete(item.uuid);
  }
  await terminada(tx);
}

/**
 * Manda lo que haya en la cola. Se puede llamar las veces que sea: si ya está mandando, espera a
 * esa misma tanda. Si se corta la señal en el medio, lo que no salió sigue en la cola.
 */
export function sincronizar(): Promise<void> {
  if (usuarioId === null) return Promise.resolve();
  enCurso ??= (async () => {
    try {
      if (!navigator.onLine) return;
      const cola = (await leerCola()).filter((c) => !c.error).sort((a, b) => a.tomadaEl.localeCompare(b.tomadaEl));
      if (cola.length === 0) return;
      publicar({ enviando: true });
      // Las que llevan foto pesan: van de a una. El resto, en tandas.
      const sinFoto = cola.filter((c) => !c.foto);
      const lotes = [...Array.from({ length: Math.ceil(sinFoto.length / LOTE) }, (_, i) => sinFoto.slice(i * LOTE, (i + 1) * LOTE)), ...cola.filter((c) => c.foto).map((c) => [c])];
      for (const lote of lotes) {
        await mandar(lote);
        await contar();
        publicar({ version: estado.version + 1 });
      }
    } catch {
      // Sin señal o servidor caído: no se pierde nada, se reintenta más tarde.
    } finally {
      publicar({ enviando: false });
      await contar().catch(() => undefined);
      enCurso = null;
    }
  })();
  return enCurso;
}

// Vuelve la señal o se vuelve a mirar el teléfono: se intenta mandar. Además, un reintento cada 30 s.
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => void sincronizar());
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void sincronizar());
  setInterval(() => estado.pendientes > 0 && void sincronizar(), 30_000);
}
