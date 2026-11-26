// Tema claro / oscuro (mismo esquema que sentryx y ALCOMBAR): data-theme en <html> y las variables
// de styles.css hacen el resto. Sin preferencia guardada, sigue al sistema del celular o la compu.
// index.html aplica el tema antes de pintar, para que no haya un destello blanco en modo oscuro.
import { useSyncExternalStore } from 'react';

export type Tema = 'light' | 'dark';
export type PreferenciaTema = Tema | 'system';

const CLAVE = 'coopgestion-tema';
const oyentes = new Set<() => void>();
const sistemaOscuro = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

function leerPreferencia(): PreferenciaTema {
  try {
    const v = localStorage.getItem(CLAVE);
    if (v === 'light' || v === 'dark') return v;
  } catch {
    /* almacenamiento no disponible */
  }
  return 'system';
}

let preferencia: PreferenciaTema = leerPreferencia();

const temaActual = (): Tema => (preferencia === 'system' ? (sistemaOscuro?.matches ? 'dark' : 'light') : preferencia);

function aplicar(): void {
  document.documentElement.dataset.theme = temaActual();
  for (const avisar of oyentes) avisar();
}

sistemaOscuro?.addEventListener('change', aplicar);
aplicar();

export function setPreferenciaTema(p: PreferenciaTema): void {
  preferencia = p;
  try {
    if (p === 'system') localStorage.removeItem(CLAVE);
    else localStorage.setItem(CLAVE, p);
  } catch {
    /* noop */
  }
  aplicar();
}

function suscribir(avisar: () => void) {
  oyentes.add(avisar);
  return () => {
    oyentes.delete(avisar);
  };
}

/** Tema que se está viendo, qué eligió la persona (claro, oscuro o el del sistema) y cómo cambiarlo. */
export function useTema(): { tema: Tema; preferencia: PreferenciaTema; elegir: (p: PreferenciaTema) => void; alternar: () => void } {
  const tema = useSyncExternalStore(suscribir, temaActual, () => 'light' as Tema);
  const elegida = useSyncExternalStore(
    suscribir,
    () => preferencia,
    () => 'system' as PreferenciaTema,
  );
  return { tema, preferencia: elegida, elegir: setPreferenciaTema, alternar: () => setPreferenciaTema(tema === 'dark' ? 'light' : 'dark') };
}
