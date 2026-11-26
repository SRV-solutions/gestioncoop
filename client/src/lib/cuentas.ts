// Cuentas de socio que se abrieron en este dispositivo. Sirve para volver a entrar o pasar de una a
// otra (la propia, la de la madre, la del local) escribiendo solo el documento.
// Se guarda el nombre, el código de socio y la conexión. El documento no se guarda nunca.

export interface CuentaRecordada {
  /** Subdominio de la cooperativa. */
  coop: string;
  nombre: string;
  socio: number;
  conexion: number;
}

const CLAVE = 'coopgestion-cuentas';
const MAXIMO = 6;

function leer(): CuentaRecordada[] {
  try {
    const guardado: unknown = JSON.parse(localStorage.getItem(CLAVE) ?? '[]');
    return Array.isArray(guardado) ? (guardado as CuentaRecordada[]).filter((c) => c && typeof c.socio === 'number' && typeof c.conexion === 'number') : [];
  } catch {
    return [];
  }
}

function guardar(cuentas: CuentaRecordada[]): void {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(cuentas.slice(0, MAXIMO)));
  } catch {
    /* almacenamiento no disponible: no se recuerda, y nada más */
  }
}

export const cuentasRecordadas = (coop: string | undefined): CuentaRecordada[] => (coop ? leer().filter((c) => c.coop === coop) : []);

const esLaMisma = (a: CuentaRecordada, b: Pick<CuentaRecordada, 'coop' | 'socio'>) => a.coop === b.coop && a.socio === b.socio;

/** La última que se abrió queda primera. */
export function recordarCuenta(cuenta: CuentaRecordada): void {
  guardar([cuenta, ...leer().filter((c) => !esLaMisma(c, cuenta))]);
}

export function olvidarCuenta(cuenta: Pick<CuentaRecordada, 'coop' | 'socio'>): void {
  guardar(leer().filter((c) => !esLaMisma(c, cuenta)));
}
