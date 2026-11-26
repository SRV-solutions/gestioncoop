import type { Rol, Servicio } from './constants';
import type { ParametrosFacturacion } from './tarifas';

/** Forma única de toda respuesta de la API: `{ data, error }`. */
export interface ApiErrorBody {
  /** Código estable para que el client decida qué hacer (ej. `token_expired`). */
  code: string;
  /** Mensaje apto para mostrarle al usuario. */
  message: string;
  /** Errores por campo en validaciones de formulario. */
  fields?: Record<string, string>;
}
export type ApiResponse<T> = { data: T; error: null } | { data: null; error: ApiErrorBody };

/** Tema visual de la cooperativa (columna `tema_json`). */
export interface TemaCooperativa {
  colores: {
    primario: string;
    primarioOscuro: string;
    primarioClaro: string;
    acento: string;
    fondo: string;
  };
  /** Texto corto del isotipo cuando no hay logo cargado (ej. "AyE"). */
  iniciales: string;
  logoUrl?: string | null;
  lema?: string | null;
}

/** Parámetros de la cooperativa (columna `config_json`). Crece con cada módulo. */
export interface ConfigCooperativa {
  domicilio: string;
  localidad: string;
  provincia: string;
  codigoPostal: string;
  condicionIva: string;
  telefonos: string[];
  guardias: { servicio: Servicio; telefono: string }[];
  /** Servicios que la cooperativa presta (habilita o esconde módulos). */
  servicios: Servicio[];
  /** Punto de venta con el que numera sus comprobantes. */
  puntoVenta: number;
  /** Vencimientos, mora y regla de corte. Si falta, rigen los valores por defecto. */
  facturacion?: ParametrosFacturacion;
  /** De dónde viene la energía (para el balance del tablero). */
  energia?: { mayorista: string; generacion: string | null };
  /** Diseño de la factura (lo carga SRV). Si falta, el de siempre. */
  factura?: import('./srv').ModeloFactura;
}

export interface CooperativaPublica {
  id: number;
  nombre: string;
  nombreCorto: string;
  subdominio: string;
  localidad: string | null;
  tema: TemaCooperativa;
  servicios: Servicio[];
}

export interface CooperativaResumen extends CooperativaPublica {
  cuit: string;
  activa: boolean;
  usuarios: number;
  /** Comisión de SRV que rige hoy. `null` = todavía no se cargó. */
  comision: { porcentaje: string; fijoPorFactura: string } | null;
}

/** Quién está usando la app (GET /auth/me). */
export interface Me {
  user: {
    id: number;
    nombre: string;
    /** `null` en el socio que entra con su DNI. */
    email: string | null;
    roles: Rol[];
    esDemo: boolean;
  };
  /** Cooperativa en la que está trabajando. `null` solo para un superadmin que todavía no eligió. */
  cooperativa: CooperativaPublica | null;
}

/** Datos para pintar la pantalla de ingreso (GET /auth/context). */
export interface LoginContext {
  cooperativa: CooperativaPublica;
  demo: {
    activo: boolean;
    opciones: { rol: Rol; nombre: string }[];
    cooperativas: { subdominio: string; nombreCorto: string }[];
  };
}

export interface UsuarioListado {
  id: number;
  nombre: string;
  email: string | null;
  roles: Rol[];
  activo: boolean;
  esDemo: boolean;
  ultimoIngresoEl: string | null;
}
