import type { ApiResponse } from '@shared';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}

let refreshing: Promise<boolean> | null = null;
let onSessionLost: (() => void) | null = null;
export function setSessionLostHandler(fn: () => void) {
  onSessionLost = fn;
}

/**
 * Renueva el token de acceso con el token de renovación (cookie). Un solo pedido aunque fallen
 * varios a la vez. Cada renovación suma otros 30 días de sesión.
 */
export function refreshSession(): Promise<boolean> {
  if (!refreshing) {
    refreshing = fetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'include' })
      .then((r) => r.ok)
      .catch(() => false)
      .finally(() => {
        setTimeout(() => (refreshing = null), 0);
      });
  }
  return refreshing;
}

const OFFLINE = 'No hay conexión con el servidor. Revisá tu señal y probá de nuevo.';
const GENERIC = 'Algo salió mal. Probá de nuevo en un momento.';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const doFetch = async () => {
    try {
      const res = await fetch(`/api/v1${path}`, {
        method,
        credentials: 'include',
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      // La API siempre contesta { data, error }. Si no es JSON (un proxy caído, por ejemplo), queda null.
      const json = (await res.json().catch(() => null)) as ApiResponse<T> | null;
      return { res, json };
    } catch {
      throw new ApiError(0, OFFLINE, 'offline');
    }
  };

  const isAuthCall = path.startsWith('/auth/');
  let { res, json } = await doFetch();
  if (res.status === 401 && !isAuthCall && json?.error?.code === 'token_expired' && (await refreshSession())) {
    ({ res, json } = await doFetch());
  }
  if (!res.ok || !json || json.error) {
    if (res.status === 401 && !isAuthCall) onSessionLost?.();
    // Nunca se muestra un error técnico: si la API no mandó un mensaje para el usuario, va uno genérico.
    throw new ApiError(res.status, json?.error?.message ?? GENERIC, json?.error?.code, json?.error?.fields);
  }
  return json.data;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
  del: <T>(path: string) => request<T>('DELETE', path),
};

/**
 * Abre un PDF de la API en otra pestaña. Va por `fetch` y no por un enlace directo: así se renueva
 * la sesión si hace falta y, si algo falla, se puede mostrar el motivo en lugar de una pestaña rota.
 */
export async function abrirPdf(path: string): Promise<void> {
  // La pestaña se abre ya, dentro del clic: si se abre después de esperar, el navegador la bloquea.
  const pestana = window.open('', '_blank');
  try {
    const pedir = () => fetch(`/api/v1${path}`, { credentials: 'include' });
    let res = await pedir().catch(() => {
      throw new ApiError(0, OFFLINE, 'offline');
    });
    if (res.status === 401 && (await refreshSession())) res = await pedir();
    if (!res.ok) {
      const json = (await res.json().catch(() => null)) as ApiResponse<never> | null;
      throw new ApiError(res.status, json?.error?.message ?? GENERIC, json?.error?.code);
    }
    const url = URL.createObjectURL(await res.blob());
    if (pestana) pestana.location.href = url;
    else window.location.assign(url);
    setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
  } catch (err) {
    pestana?.close();
    throw err;
  }
}

/** Guarda en la computadora un archivo que ya está en memoria. */
export function guardarArchivo(contenido: Blob, nombre: string): void {
  const url = URL.createObjectURL(contenido);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombre;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Baja un archivo de la API (un informe en Excel, CSV o PDF) con el nombre que le puso el servidor.
 * Va por `fetch` por lo mismo que `abrirPdf`: renueva la sesión y, si falla, se puede decir por qué.
 */
export async function descargar(path: string, cuerpo?: unknown): Promise<void> {
  const { contenido, nombre } = await pedirArchivo(path, cuerpo);
  guardarArchivo(contenido, nombre);
}

/** Un archivo de la API, en memoria (para mostrarlo en pantalla o guardarlo). */
export async function pedirArchivo(path: string, cuerpo?: unknown): Promise<{ contenido: Blob; nombre: string }> {
  // Con cuerpo va por POST: sirve cuando lo que se pide no entra en una dirección (las casas de un área del mapa).
  const pedir = () =>
    fetch(`/api/v1${path}`, {
      credentials: 'include',
      ...(cuerpo === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) }),
    });
  let res = await pedir().catch(() => {
    throw new ApiError(0, OFFLINE, 'offline');
  });
  if (res.status === 401 && (await refreshSession())) res = await pedir();
  if (!res.ok) {
    const json = (await res.json().catch(() => null)) as ApiResponse<never> | null;
    throw new ApiError(res.status, json?.error?.message ?? GENERIC, json?.error?.code);
  }
  const nombre = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'informe';
  return { contenido: await res.blob(), nombre };
}

/** Construye querystring ignorando vacíos. */
export function qs(params: Record<string, string | number | undefined | null>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (typeof err === 'string' && err.trim()) return err;
  return GENERIC;
}
