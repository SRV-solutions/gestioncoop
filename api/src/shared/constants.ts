/**
 * Nombre comercial del producto. Es provisorio: cuando se elija el definitivo
 * (SPEC sección 18) se cambia acá y en ningún otro lado.
 */
export const APP_NOMBRE = 'GestiónCoop';
export const APP_LEMA = 'Del medidor a la caja, sin papeles y sin planillas.';

export const TIMEZONE = 'America/Argentina/Buenos_Aires';
export const LOCALE = 'es-AR';

export const ROLES = ['socio', 'operario', 'cajero', 'facturacion', 'gerencia', 'admin', 'superadmin'] as const;
export type Rol = (typeof ROLES)[number];

export const ROL_ETIQUETA: Record<Rol, string> = {
  socio: 'Socio',
  operario: 'Operario',
  cajero: 'Caja',
  facturacion: 'Facturación',
  gerencia: 'Gerencia',
  admin: 'Administración',
  superadmin: 'Superadmin',
};

/** Ruta de inicio de cada rol dentro del client. */
export const ROL_RUTA: Record<Rol, string> = {
  socio: '/socio',
  operario: '/operario',
  cajero: '/caja',
  facturacion: '/facturacion',
  gerencia: '/gerencia',
  admin: '/admin',
  superadmin: '/superadmin',
};

/** Si un usuario tiene varios roles, entra por el primero de esta lista que tenga. */
export const ROL_PRIORIDAD: Rol[] = ['superadmin', 'gerencia', 'admin', 'facturacion', 'cajero', 'operario', 'socio'];

/** Ordena los roles de un usuario según la prioridad de arriba. */
export function sortRoles(roles: readonly Rol[]): Rol[] {
  return ROL_PRIORIDAD.filter((r) => roles.includes(r));
}

export const SERVICIOS = ['energia', 'agua', 'internet', 'tv', 'sepelio', 'gas'] as const;
export type Servicio = (typeof SERVICIOS)[number];

export const SERVICIO_ETIQUETA: Record<Servicio, string> = {
  energia: 'Energía eléctrica',
  agua: 'Agua potable',
  internet: 'Internet',
  tv: 'TV',
  sepelio: 'Sepelio',
  gas: 'Gas envasado',
};
