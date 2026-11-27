// La cooperativa que se abrió con su link (gestioncoop.wearesrv.com/dosdemayo). Se recuerda en el
// dispositivo: al cerrar sesión o al abrir la app instalada, el ingreso vuelve a mostrar la suya y no
// la de por defecto.
const CLAVE = 'coopgestion-cooperativa';

export function cooperativaElegida(): string | undefined {
  try {
    return localStorage.getItem(CLAVE) ?? undefined;
  } catch {
    return undefined;
  }
}

export function elegirCooperativa(subdominio: string): void {
  try {
    localStorage.setItem(CLAVE, subdominio);
  } catch {
    /* almacenamiento no disponible: no se recuerda, y nada más */
  }
}

export function olvidarCooperativa(): void {
  try {
    localStorage.removeItem(CLAVE);
  } catch {
    /* almacenamiento no disponible */
  }
}
