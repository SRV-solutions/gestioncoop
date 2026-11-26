// Vocabulario de reclamos y cortes programados (Fase 6), compartido entre la API y el client.
import { z } from 'zod';

/* ───────────────────────── Reclamos ───────────────────────── */

/** SPEC 6.8: nuevo → asignado → en curso → resuelto. Se puede saltear un paso, nunca volver atrás. */
export const ESTADOS_RECLAMO = ['nuevo', 'asignado', 'en_curso', 'resuelto'] as const;
export type EstadoReclamo = (typeof ESTADOS_RECLAMO)[number];
export const ESTADO_RECLAMO_ETIQUETA: Record<EstadoReclamo, string> = {
  nuevo: 'Recibido',
  asignado: 'Asignado',
  en_curso: 'En curso',
  resuelto: 'Resuelto',
};
/** Cómo se lo cuenta al socio cada paso. */
export const ESTADO_RECLAMO_SOCIO: Record<EstadoReclamo, string> = {
  nuevo: 'La cooperativa recibió tu reclamo.',
  asignado: 'Ya hay una cuadrilla asignada.',
  en_curso: 'La cuadrilla está trabajando en tu reclamo.',
  resuelto: 'El reclamo está resuelto.',
};

export const PRIORIDADES = ['baja', 'media', 'alta', 'urgente'] as const;
export type Prioridad = (typeof PRIORIDADES)[number];
export const PRIORIDAD_ETIQUETA: Record<Prioridad, string> = { baja: 'Baja', media: 'Media', alta: 'Alta', urgente: 'Urgente' };

export const ORIGENES_RECLAMO = ['portal', 'telefono', 'oficina'] as const;
export type OrigenReclamo = (typeof ORIGENES_RECLAMO)[number];
export const ORIGEN_RECLAMO_ETIQUETA: Record<OrigenReclamo, string> = { portal: 'App del socio', telefono: 'Teléfono', oficina: 'En la oficina' };

export const SERVICIOS_RECLAMO = ['energia', 'agua', 'internet', 'tv', 'administrativo'] as const;
export type ServicioReclamo = (typeof SERVICIOS_RECLAMO)[number];
export const SERVICIO_RECLAMO_ETIQUETA: Record<ServicioReclamo, string> = {
  energia: 'Luz',
  agua: 'Agua',
  internet: 'Internet',
  tv: 'TV',
  administrativo: 'Factura o pagos',
};

export interface TipoReclamo {
  codigo: string;
  nombre: string;
  /** Prioridad con la que entra; la oficina la puede cambiar. */
  prioridad: Prioridad;
  /** Lo que conviene saber antes de reclamar (se muestra en el portal). */
  ayuda?: string;
}

/** Qué se puede reclamar de cada servicio, en las palabras del socio. */
export const TIPOS_RECLAMO: Record<ServicioReclamo, TipoReclamo[]> = {
  energia: [
    { codigo: 'sin_luz', nombre: 'No tengo luz', prioridad: 'alta', ayuda: 'Antes, fijate si saltó la llave térmica de tu casa.' },
    { codigo: 'baja_tension', nombre: 'La luz baja o parpadea', prioridad: 'media' },
    { codigo: 'cable_caido', nombre: 'Cable caído o poste dañado', prioridad: 'urgente', ayuda: 'No te acerques ni lo toques. Si es urgente, llamá a la guardia.' },
    { codigo: 'chispas', nombre: 'Chispas o humo en el medidor', prioridad: 'urgente', ayuda: 'Alejate del medidor. Si es urgente, llamá a la guardia.' },
    { codigo: 'alumbrado', nombre: 'Alumbrado público apagado', prioridad: 'baja' },
    { codigo: 'medidor', nombre: 'Problema con el medidor', prioridad: 'media' },
  ],
  agua: [
    { codigo: 'sin_agua', nombre: 'No tengo agua', prioridad: 'alta' },
    { codigo: 'poca_presion', nombre: 'Sale con poca presión', prioridad: 'media' },
    { codigo: 'perdida', nombre: 'Pérdida en la vereda o la calle', prioridad: 'alta' },
    { codigo: 'turbia', nombre: 'El agua sale turbia o con olor', prioridad: 'alta' },
    { codigo: 'medidor', nombre: 'Problema con el medidor', prioridad: 'media' },
  ],
  internet: [
    { codigo: 'sin_servicio', nombre: 'No tengo internet', prioridad: 'alta', ayuda: 'Antes, probá apagar el módem un minuto y volver a prenderlo.' },
    { codigo: 'lento', nombre: 'Anda lento o se corta', prioridad: 'media' },
  ],
  tv: [
    { codigo: 'sin_senal', nombre: 'No tengo señal', prioridad: 'media' },
    { codigo: 'canales', nombre: 'Faltan canales o se ve mal', prioridad: 'baja' },
  ],
  administrativo: [
    { codigo: 'factura', nombre: 'Mi factura está mal', prioridad: 'media' },
    { codigo: 'pago', nombre: 'Pagué y figura como deuda', prioridad: 'media' },
    { codigo: 'otro', nombre: 'Otra consulta', prioridad: 'baja' },
  ],
};

export function tipoReclamo(servicio: ServicioReclamo, codigo: string): TipoReclamo | undefined {
  return TIPOS_RECLAMO[servicio].find((t) => t.codigo === codigo);
}

/** Cuadrillas de la demo. Ilustrativas: cada cooperativa tiene las suyas. */
export const CUADRILLAS: Record<ServicioReclamo, string[]> = {
  energia: ['Cuadrilla de energía 1', 'Cuadrilla de energía 2', 'Guardia de energía'],
  agua: ['Cuadrilla de agua', 'Guardia de agua'],
  internet: ['Técnico de internet y TV'],
  tv: ['Técnico de internet y TV'],
  administrativo: ['Atención al socio'],
};

/** «R-00042» */
export const referenciaReclamo = (numero: number) => `R-${String(numero).padStart(5, '0')}`;

const FOTO_MAX = 1_000_000;
const fotoSchema = z
  .string()
  .max(FOTO_MAX, 'La foto es demasiado grande')
  .regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/, 'La foto no es válida')
  .nullable()
  .default(null);
const telefonoSchema = z
  .string()
  .trim()
  .max(40, 'Es demasiado largo')
  .regex(/^[\d\s()+-]*$/, 'Escribí solo números')
  .optional()
  .transform((v) => (v ? v : null));
const descripcionSchema = z
  .string()
  .trim()
  .max(500, 'Es demasiado largo: hasta 500 letras')
  .optional()
  .transform((v) => (v ? v : null));

function tipoValido(c: { servicio: ServicioReclamo; tipo: string }, ctx: z.RefinementCtx) {
  if (!tipoReclamo(c.servicio, c.tipo)) ctx.addIssue({ code: 'custom', path: ['tipo'], message: 'Elegí qué pasa' });
}

/** Reclamo que hace el socio desde el portal. */
export const reclamoSocioSchema = z
  .object({
    conexionId: z.int({ error: 'Elegí el domicilio' }).positive(),
    servicio: z.enum(SERVICIOS_RECLAMO, { error: 'Elegí el servicio' }),
    tipo: z.string({ error: 'Elegí qué pasa' }).max(24),
    descripcion: descripcionSchema,
    foto: fotoSchema,
    lat: z.number().min(-90).max(90).nullable().default(null),
    lng: z.number().min(-180).max(180).nullable().default(null),
    contacto: telefonoSchema,
  })
  .superRefine(tipoValido);
export type ReclamoSocioInput = z.input<typeof reclamoSocioSchema>;

/** Reclamo que toma la oficina (por teléfono o en el mostrador). */
export const reclamoOficinaSchema = z
  .object({
    socioId: z.int().positive().nullable().default(null),
    conexionId: z.int().positive().nullable().default(null),
    servicio: z.enum(SERVICIOS_RECLAMO, { error: 'Elegí el servicio' }),
    tipo: z.string({ error: 'Elegí qué pasa' }).max(24),
    descripcion: descripcionSchema,
    prioridad: z.enum(PRIORIDADES).optional(),
    origen: z.enum(['telefono', 'oficina']).default('telefono'),
    direccion: z.string().trim().max(200).optional().transform((v) => (v ? v : null)),
    contacto: telefonoSchema,
  })
  .superRefine((c, ctx) => {
    tipoValido(c, ctx);
    if (c.conexionId === null && !c.direccion) ctx.addIssue({ code: 'custom', path: ['direccion'], message: 'Elegí el socio o escribí dónde es' });
  });
export type ReclamoOficinaInput = z.input<typeof reclamoOficinaSchema>;

export const cambioEstadoSchema = z
  .object({
    estado: z.enum(ESTADOS_RECLAMO),
    cuadrilla: z.string().trim().max(60).optional(),
    nota: z.string().trim().max(500, 'Es demasiado largo').optional(),
    resolucion: z.string().trim().max(500, 'Es demasiado largo').optional(),
  })
  .superRefine((c, ctx) => {
    if (c.estado === 'resuelto' && (c.resolucion?.length ?? 0) < 5) ctx.addIssue({ code: 'custom', path: ['resolucion'], message: 'Contá qué se hizo' });
  });

export const notaReclamoSchema = z.object({
  nota: z.string({ error: 'Escribí la nota' }).trim().min(3, 'Escribí la nota').max(500, 'Es demasiado largo'),
  visibleSocio: z.boolean().default(true),
});

export const prioridadSchema = z.object({ prioridad: z.enum(PRIORIDADES) });

export const reclamosQuerySchema = z.object({
  estado: z.enum([...ESTADOS_RECLAMO, 'abiertos'] as const).default('abiertos'),
  servicio: z.enum(SERVICIOS_RECLAMO).optional(),
  q: z.string().trim().max(80).optional(),
  pagina: z.coerce.number().int().min(1).max(10_000).default(1),
});

export interface EventoReclamo {
  id: number;
  estado: EstadoReclamo | null;
  nota: string | null;
  visibleSocio: boolean;
  /** Quién lo hizo. Al socio solo le llega «Cooperativa» o «Vos». */
  autor: string | null;
  creadoEl: string;
}

export interface ReclamoListado {
  id: number;
  numero: number;
  /** «R-00042» */
  referencia: string;
  servicio: ServicioReclamo;
  tipo: string;
  tipoNombre: string;
  estado: EstadoReclamo;
  prioridad: Prioridad;
  origen: OrigenReclamo;
  socio: { id: number; numero: number; nombre: string } | null;
  direccion: string | null;
  zona: string | null;
  cuadrilla: string | null;
  tieneFoto: boolean;
  creadoEl: string;
  resueltoEl: string | null;
}

export interface ReclamoDetalle extends ReclamoListado {
  descripcion: string | null;
  contacto: string | null;
  conexion: { id: number; numero: number } | null;
  lat: number | null;
  lng: number | null;
  asignadoEl: string | null;
  iniciadoEl: string | null;
  resolucion: string | null;
  eventos: EventoReclamo[];
}

export interface PaginaReclamos {
  filas: ReclamoListado[];
  total: number;
  porPagina: number;
  /** Cuántos hay en cada estado (con los filtros de servicio y búsqueda, sin el de estado). */
  conteo: Record<EstadoReclamo, number>;
}

/* ───────────────────────── Cortes programados ───────────────────────── */

export const SERVICIOS_CORTE = ['energia', 'agua', 'internet', 'tv'] as const;
export type ServicioCorte = (typeof SERVICIOS_CORTE)[number];

export const corteSchema = z
  .object({
    /** `null` = toda la localidad. */
    zonaId: z.int().positive().nullable(),
    servicio: z.enum(SERVICIOS_CORTE, { error: 'Elegí el servicio' }),
    desde: z.iso.datetime({ offset: true, error: 'Elegí cuándo empieza' }),
    hasta: z.iso.datetime({ offset: true, error: 'Elegí cuándo termina' }),
    motivo: z.string({ error: 'Contá el motivo' }).trim().min(5, 'Contá el motivo').max(200, 'Es demasiado largo'),
  })
  .superRefine((c, ctx) => {
    if (Date.parse(c.hasta) <= Date.parse(c.desde)) ctx.addIssue({ code: 'custom', path: ['hasta'], message: 'Tiene que terminar después de empezar' });
    if (Date.parse(c.hasta) <= Date.now()) ctx.addIssue({ code: 'custom', path: ['hasta'], message: 'Ese horario ya pasó' });
  });
export type CorteInput = z.input<typeof corteSchema>;

export interface CorteProgramado {
  id: number;
  zona: { id: number; nombre: string } | null;
  servicio: ServicioCorte;
  desde: string;
  hasta: string;
  motivo: string;
  /** Socios a los que se les avisó al cargarlo. */
  avisados: number;
  cancelado: boolean;
  creadoEl: string;
}
