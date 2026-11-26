// Vocabulario de tarifas y del motor de cálculo, compartido entre la API y el client.
// Importes, precios y cantidades viajan como texto ("2606.1688"): nunca como número con coma flotante.
import { z } from 'zod';
import { CATEGORIAS, CONDICIONES_IVA, SERVICIOS_CONEXION, type Categoria, type CondicionIva, type ServicioConexion } from './padron';

/* ───────────────────────── Cuadros tarifarios ───────────────────────── */

/** Servicios que se cobran con un cuadro (cargo fijo + escalones). Internet y TV van por plan. */
export const SERVICIOS_CON_CUADRO = ['energia', 'agua', 'sepelio'] as const satisfies readonly ServicioConexion[];
export type ServicioConCuadro = (typeof SERVICIOS_CON_CUADRO)[number];

/** Servicios con medidor. */
export const SERVICIOS_MEDIDOS = ['energia', 'agua'] as const satisfies readonly ServicioConCuadro[];
export type ServicioMedido = (typeof SERVICIOS_MEDIDOS)[number];

/** En qué se mide lo que cobra cada cuadro. En sepelio, el «consumo» es la cantidad de adherentes. */
export const UNIDAD_SERVICIO: Record<ServicioConCuadro, string> = { energia: 'kWh', agua: 'm³', sepelio: 'adherentes' };

export interface EscalonTarifa {
  /** Desde qué consumo rige (el primero arranca en 0). */
  desde: string;
  /** Hasta qué consumo; `null` = sin tope (el excedente). */
  hasta: string | null;
  /** Precio por unidad, con 4 decimales como en la factura. */
  precio: string;
  /** Tramo con precio subsidiado: sirve para explicarle al socio qué parte paga plena. */
  subsidiado: boolean;
  /** Códigos de conceptos que no se calculan sobre este escalón. */
  exentoDe: string[];
}

/** Número para leer: hasta 4 decimales, sin ceros de relleno, con coma y punto de miles. */
const legible = (n: number) => new Intl.NumberFormat('es-AR', { maximumFractionDigits: 4 }).format(n);

/** Nombre de un escalón como en la factura: «Primeros 30 kWh», «Siguientes 90 kWh», «Excedente de 700 kWh». */
export function etiquetaEscalon(e: Pick<EscalonTarifa, 'desde' | 'hasta'>, unidad: string): string {
  const desde = Number(e.desde);
  if (e.hasta === null) return desde === 0 ? 'Consumo' : `Excedente de ${legible(desde)} ${unidad}`;
  const hasta = Number(e.hasta);
  return desde === 0 ? `Primeros ${legible(hasta)} ${unidad}` : `Siguientes ${legible(hasta - desde)} ${unidad}`;
}

export interface CuadroTarifa {
  servicio: ServicioConCuadro;
  /** `null` en sepelio, que no tiene categorías. */
  categoria: Categoria | null;
  conSubsidio: boolean;
  vigenteDesde: string;
  /** Último día en que rige; `null` = sigue vigente. */
  vigenteHasta: string | null;
  cargoFijo: string;
  escalones: EscalonTarifa[];
}

export interface CuadroDetalle extends CuadroTarifa {
  id: number;
  nota: string | null;
  creadoEl: string;
  /** Todavía no entró en vigencia: es el único caso en que se puede borrar. */
  futuro: boolean;
}

/* ───────────────────────── Conceptos (impuestos, tasas y cargos) ───────────────────────── */

export const TIPOS_CONCEPTO = ['porcentaje', 'fijo', 'por_unidad'] as const;
export type TipoConcepto = (typeof TIPOS_CONCEPTO)[number];
export const TIPO_CONCEPTO_ETIQUETA: Record<TipoConcepto, string> = {
  porcentaje: 'Porcentaje',
  fijo: 'Monto fijo',
  por_unidad: 'Monto por unidad consumida',
};

/** Sobre qué se calcula un porcentaje. */
export const BASES_CONCEPTO = ['basico', 'subtotal', 'recargos'] as const;
export type BaseConcepto = (typeof BASES_CONCEPTO)[number];
export const BASE_CONCEPTO_ETIQUETA: Record<BaseConcepto, string> = {
  basico: 'Cuota fija + consumo',
  subtotal: 'Subtotal del servicio',
  recargos: 'Intereses por mora',
};

/** En qué parte de la factura se imprime. Un «cargo» entra en el subtotal del servicio. */
export const GRUPOS_CONCEPTO = ['cargo', 'gravamen', 'adicional'] as const;
export type GrupoConcepto = (typeof GRUPOS_CONCEPTO)[number];
export const GRUPO_CONCEPTO_ETIQUETA: Record<GrupoConcepto, string> = {
  cargo: 'Cargo del servicio (entra en el subtotal)',
  gravamen: 'Gravamen (impuesto o tasa)',
  adicional: 'Adicional (fuera del total del servicio)',
};

export interface ConceptoTarifa {
  codigo: string;
  nombre: string;
  tipo: TipoConcepto;
  /** Porcentaje (21 = 21 %), monto fijo o monto por unidad, según el tipo. */
  valor: string;
  /** Solo para porcentajes. */
  base: BaseConcepto | null;
  grupo: GrupoConcepto;
  /** Servicio en cuya factura aparece; `null` = en todas. */
  servicio: ServicioConexion | null;
  /** Categorías a las que se les cobra; `null` = a todas. */
  categorias: Categoria[] | null;
  /** Condiciones frente al IVA a las que se les cobra; `null` = a todas. */
  condicionesIva: CondicionIva[] | null;
  /** Orden en la factura. */
  orden: number;
  vigenteDesde: string;
  vigenteHasta: string | null;
}

export interface ConceptoDetalle extends ConceptoTarifa {
  id: number;
  creadoEl: string;
  futuro: boolean;
}

/* ───────────────────────── Parámetros de facturación ───────────────────────── */

/** Reglas de vencimiento, mora y corte de la cooperativa (dentro de `config_json`). */
export interface ParametrosFacturacion {
  /** Interés por día de atraso sobre el saldo vencido, en porcentaje (0.1 = 0,1 % diario). */
  moraTasaDiaria: string;
  /** Días entre la emisión y el vencimiento. */
  diasVencimiento: number;
  /** Días entre el primer y el segundo vencimiento; `null` = hay un solo vencimiento. */
  segundoVencimientoDias: number | null;
  /** Recargo del segundo vencimiento, en porcentaje. */
  recargoSegundoVencimiento: string;
  /** Con cuántas facturas impagas una conexión entra en la lista de cortes sugeridos. Nunca se corta solo. */
  facturasParaCorte: number;
}

/** Valores ilustrativos hasta que la cooperativa confirme los suyos. */
export const PARAMETROS_FACTURACION_DEFECTO: ParametrosFacturacion = {
  moraTasaDiaria: '0.1',
  diasVencimiento: 10,
  segundoVencimientoDias: null,
  recargoSegundoVencimiento: '0',
  facturasParaCorte: 2,
};

export interface PlanDetalle {
  id: number;
  servicio: ServicioConexion;
  nombre: string;
  precio: string;
  activo: boolean;
  /** Conexiones que lo tienen contratado. */
  conexiones: number;
}

/* ───────────────────────── Motor de cálculo: lo que entra ───────────────────────── */

/** Lo que marcó un medidor entre dos lecturas. Un cambio de medidor son dos tramos. */
export interface TramoLectura {
  medidor?: string;
  anterior: string;
  actual: string;
  /** Factor multiplicador del medidor (1 si no se indica). */
  factor?: string;
  /** `estimada`: no se pudo leer y se calculó por promedio. La factura sale marcada. */
  tipo?: 'real' | 'estimada';
  /** El contador llegó al tope y volvió a cero. */
  vueltaDeContador?: boolean;
  /** Cifras del contador (5 = llega a 99.999). Hace falta para calcular una vuelta. */
  digitos?: number;
  /** La lectura anterior fue estimada: si la real quedó por debajo, la diferencia queda a favor del socio. */
  anteriorEstimada?: boolean;
}

/** Cargo o descuento propio de una conexión (ej. un programa transitorio, una cuota de un plan de pago). */
export interface CargoParticular {
  codigo?: string;
  descripcion: string;
  importe: string;
  /** `cargo` entra en el subtotal; `recargo` va con los intereses por mora. */
  grupo: 'cargo' | 'adicional' | 'recargo';
}

export interface DeudaVencida {
  /** Comprobante impago, ej. "B 0006-02028266". */
  referencia: string;
  saldo: string;
  venceEl: string;
  /**
   * Desde qué día se cuentan los intereses, si no es desde el vencimiento: la fecha de la factura
   * anterior, cuando esa factura ya cobró los intereses hasta ese día.
   */
  interesDesde?: string;
  /**
   * Hasta qué día se cuentan, si no es hasta la emisión: el día en que se pagó. Así una factura
   * pagada fuera de término trae su recargo en la factura siguiente (`saldo` es lo que se pagó tarde).
   */
  interesHasta?: string;
}

export interface EntradaFactura {
  servicio: ServicioConexion;
  /** `desde` y `hasta` son el primer y el último día que se facturan (los dos incluidos). */
  periodo: { anio: number; mes: number; desde: string; hasta: string };
  condicionIva: CondicionIva;
  suministro: {
    categoria: Categoria | null;
    tieneSubsidio: boolean;
    fechaAlta: string;
    /** Último día con servicio. */
    fechaBaja: string | null;
  };
  /** Energía y agua. */
  lecturas?: TramoLectura[];
  /** Consumo ya cobrado de más por una estimación anterior: se descuenta de este período. */
  consumoAFavor?: string;
  /** Todos los cuadros que podrían aplicar: el motor elige por categoría, subsidio y fecha. */
  cuadros?: CuadroTarifa[];
  /** Internet y TV. */
  plan?: { nombre: string; precio: string };
  /**
   * Sepelio. En la factura de otro servicio agrega sus renglones como adicionales (con sus propias
   * fechas de alta y baja); en una factura de sepelio, alcanza con la cantidad de adherentes.
   */
  sepelio?: { adherentes: number; fechaAlta?: string; fechaBaja?: string | null };
  conceptos: ConceptoTarifa[];
  cargosParticulares?: CargoParticular[];
  deudaVencida?: DeudaVencida[];
  /** Hasta qué día se calculan los intereses. Obligatoria si hay deuda vencida. */
  fechaEmision?: string;
  parametros: Pick<ParametrosFacturacion, 'moraTasaDiaria'>;
}

/* ───────────────────────── Motor de cálculo: lo que sale ───────────────────────── */

/**
 * Parte de la factura donde va un renglón:
 * `basico` (cuota fija, consumo o abono) + `cargo` = subtotal; + `gravamen` = total del servicio;
 * `adicional` y `recargo` se suman aparte.
 */
export type GrupoRenglon = 'basico' | 'cargo' | 'gravamen' | 'adicional' | 'recargo';

export interface Renglon {
  grupo: GrupoRenglon;
  /** `CARGO_FIJO`, `ESCALON`, `ABONO`, `SEPELIO_TITULAR`, `SEPELIO_ADHERENTES`, `MORA` o el código del concepto. */
  codigo: string;
  servicio: ServicioConexion;
  descripcion: string;
  cantidad: string | null;
  unitario: string | null;
  /** En porcentajes: la tasa y el importe sobre el que se aplicó. */
  porcentaje: string | null;
  base: string | null;
  /** Siempre con 2 decimales, redondeado medio hacia arriba. */
  importe: string;
  subsidiado?: boolean;
  /** Códigos de conceptos que no se calcularon sobre este renglón. */
  exentoDe?: string[];
  /** Aclaración para la persona (prorrateos, vigencias). */
  nota?: string;
}

export type CodigoAviso =
  | 'estimada'
  | 'consumo_cero'
  | 'prorrateo'
  | 'cambio_tarifa'
  | 'cambio_medidor'
  | 'vuelta_contador'
  | 'consumo_a_favor'
  | 'ajuste_estimacion';

export interface Aviso {
  codigo: CodigoAviso;
  mensaje: string;
}

export interface ConsumoCalculado {
  unidad: string;
  /** Lo que marcaron los medidores. */
  medido: string;
  /** Lo que se descontó por estimaciones anteriores. */
  aFavorAplicado: string;
  facturado: string;
  /** Lo que sigue a favor del socio para el período siguiente. */
  aFavorPendiente: string;
  tramos: { medidor: string | null; anterior: string; actual: string; factor: string; consumo: string; estimada: boolean }[];
}

export interface TotalesFactura {
  basico: string;
  /** Básico + cargos: lo que la factura imprime como «Subtotal». */
  subtotal: string;
  gravamenes: string;
  /** Subtotal + gravámenes. */
  servicio: string;
  adicionales: string;
  recargos: string;
  total: string;
}

export interface FacturaCalculada {
  servicio: ServicioConexion;
  periodo: EntradaFactura['periodo'];
  /** `null` en los servicios sin medidor. */
  consumo: ConsumoCalculado | null;
  /** Días del período y cuántos de ellos tuvo servicio. */
  dias: number;
  diasActivos: number;
  estimada: boolean;
  renglones: Renglon[];
  totales: TotalesFactura;
  avisos: Aviso[];
  /** Copia de las tarifas con las que se calculó: se guarda con la factura para poder explicarla después. */
  snapshot: { cuadros: CuadroTarifa[]; conceptos: ConceptoTarifa[]; parametros: EntradaFactura['parametros'] };
}

/* ───────────────────────── Validaciones de lo que entra por la API ───────────────────────── */

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
/** Una fecha de calendario que existe (rechaza 2026-02-30). */
export const fechaSchema = z
  .string({ error: 'Elegí una fecha' })
  .regex(FECHA, 'Elegí una fecha')
  .refine((f) => {
    const d = new Date(`${f}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === f;
  }, 'Esa fecha no existe');

/** Número no negativo escrito como texto o número, con hasta `decimales` decimales. Devuelve texto. */
function decimalSchema(decimales: number, mensaje = 'Escribí un número') {
  const forma = new RegExp(`^\\d{1,9}(\\.\\d{1,${decimales}})?$`);
  return z.preprocess(
    (v) => (typeof v === 'number' ? String(v) : typeof v === 'string' ? v.trim().replace(',', '.') : v),
    z.string({ error: mensaje }).regex(forma, mensaje),
  );
}

const escalonSchema = z.object({
  desde: decimalSchema(4),
  hasta: decimalSchema(4).nullable(),
  precio: decimalSchema(4, 'Escribí el precio'),
  subsidiado: z.boolean().default(false),
  exentoDe: z.array(z.string().trim().min(1).max(24)).max(20).default([]),
});

/** Los escalones tienen que cubrir todo el consumo posible: arrancan en 0, van pegados y el último no tiene tope. */
export function errorDeEscalones(escalones: { desde: string; hasta: string | null }[]): string | null {
  if (!escalones.length) return 'Cargá al menos un escalón';
  let esperado = 0;
  for (let i = 0; i < escalones.length; i++) {
    const e = escalones[i]!;
    const ultimo = i === escalones.length - 1;
    if (Number(e.desde) !== esperado) return i === 0 ? 'El primer escalón tiene que arrancar en 0' : 'Cada escalón tiene que empezar donde termina el anterior';
    if (ultimo) return e.hasta === null ? null : 'El último escalón no lleva tope: es el excedente';
    if (e.hasta === null) return 'Solo el último escalón puede quedar sin tope';
    if (Number(e.hasta) <= esperado) return 'Cada escalón tiene que terminar más arriba de donde empieza';
    esperado = Number(e.hasta);
  }
  return null;
}

/** Nueva versión de un cuadro (un cuadro vigente nunca se edita). */
export const cuadroNuevoSchema = z
  .object({
    servicio: z.enum(SERVICIOS_CON_CUADRO),
    categoria: z.enum(CATEGORIAS).nullable(),
    conSubsidio: z.boolean().default(false),
    vigenteDesde: fechaSchema,
    cargoFijo: decimalSchema(2, 'Escribí la cuota fija'),
    escalones: z.array(escalonSchema).min(1, 'Cargá al menos un escalón').max(20),
    nota: z.string().trim().max(200).nullable().default(null),
  })
  .superRefine((c, ctx) => {
    const error = errorDeEscalones(c.escalones);
    if (error) ctx.addIssue({ code: 'custom', path: ['escalones'], message: error });
    if (c.servicio === 'sepelio' && c.categoria !== null) ctx.addIssue({ code: 'custom', path: ['categoria'], message: 'Sepelio no lleva categoría' });
    if (c.servicio !== 'sepelio' && c.categoria === null) ctx.addIssue({ code: 'custom', path: ['categoria'], message: 'Elegí la categoría' });
    if (c.servicio !== 'energia' && c.conSubsidio) ctx.addIssue({ code: 'custom', path: ['conSubsidio'], message: 'Solo la energía tiene cuadro con subsidio' });
  });
export type CuadroNuevoInput = z.infer<typeof cuadroNuevoSchema>;

/** Concepto nuevo, o un valor nuevo para un concepto que ya existe (mismo código, otra fecha). */
export const conceptoNuevoSchema = z
  .object({
    codigo: z
      .string({ error: 'Escribí un código' })
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9_]{2,24}$/, 'Usá letras, números y guion bajo (ej. IVA_EE)'),
    nombre: z.string({ error: 'Escribí el nombre' }).trim().min(2, 'Escribí el nombre').max(80, 'Es demasiado largo'),
    tipo: z.enum(TIPOS_CONCEPTO),
    valor: decimalSchema(6, 'Escribí el valor'),
    base: z.enum(BASES_CONCEPTO).nullable().default(null),
    grupo: z.enum(GRUPOS_CONCEPTO),
    servicio: z.enum(SERVICIOS_CONEXION).nullable().default(null),
    categorias: z.array(z.enum(CATEGORIAS)).min(1).nullable().default(null),
    condicionesIva: z.array(z.enum(CONDICIONES_IVA)).min(1).nullable().default(null),
    orden: z.number().int().min(0).max(999).default(100),
    vigenteDesde: fechaSchema,
  })
  .superRefine((c, ctx) => {
    if (c.tipo === 'porcentaje' && !c.base) ctx.addIssue({ code: 'custom', path: ['base'], message: 'Elegí sobre qué se calcula' });
    if (c.tipo === 'porcentaje' && Number(c.valor) > 100) ctx.addIssue({ code: 'custom', path: ['valor'], message: 'Un porcentaje no puede pasar de 100' });
    // Un cargo entra en el subtotal: no puede calcularse sobre el subtotal ni sobre los recargos.
    if (c.tipo === 'porcentaje' && c.grupo === 'cargo' && c.base && c.base !== 'basico')
      ctx.addIssue({ code: 'custom', path: ['base'], message: 'Un cargo del servicio solo puede calcularse sobre cuota fija + consumo' });
  })
  .transform((c) => ({ ...c, base: c.tipo === 'porcentaje' ? c.base : null }));
export type ConceptoNuevoInput = z.infer<typeof conceptoNuevoSchema>;

export const conceptoFinSchema = z.object({ vigenteHasta: fechaSchema });

export const parametrosFacturacionSchema = z.object({
  moraTasaDiaria: decimalSchema(4, 'Escribí la tasa').refine((v) => Number(v) <= 5, 'Es demasiado alta: no puede pasar de 5 % por día'),
  diasVencimiento: z.number({ error: 'Escribí los días' }).int('Tiene que ser un número entero').min(1, 'Como mínimo 1 día').max(90, 'Como máximo 90 días'),
  segundoVencimientoDias: z.number().int('Tiene que ser un número entero').min(1, 'Como mínimo 1 día').max(90, 'Como máximo 90 días').nullable(),
  recargoSegundoVencimiento: decimalSchema(4, 'Escribí el recargo').refine((v) => Number(v) <= 100, 'No puede pasar de 100 %'),
  facturasParaCorte: z.number({ error: 'Escribí la cantidad' }).int('Tiene que ser un número entero').min(1, 'Como mínimo 1').max(24, 'Como máximo 24'),
});

export const planPrecioSchema = z.object({ precio: decimalSchema(2, 'Escribí el precio') });

/** Simulador: «¿cuánto pagaría una conexión así con las tarifas de este mes?». */
export const simulacionSchema = z.object({
  servicio: z.enum(SERVICIOS_CONEXION),
  categoria: z.enum(CATEGORIAS).default('residencial'),
  tieneSubsidio: z.boolean().default(false),
  condicionIva: z.enum(CONDICIONES_IVA).default('consumidor_final'),
  /** Mes que se factura, `aaaa-mm`. Por defecto, el actual. */
  periodo: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Elegí el mes')
    .optional(),
  consumo: decimalSchema(2, 'Escribí el consumo').optional(),
  planId: z.number().int().positive().optional(),
  /** Con sepelio: cantidad de adherentes (0 = solo el titular). */
  adherentes: z.number().int().min(0).max(30).nullable().default(null),
  deuda: z
    .object({ saldo: decimalSchema(2, 'Escribí el saldo'), dias: z.number().int().min(1).max(3650) })
    .nullable()
    .default(null),
});
export type SimulacionInput = z.input<typeof simulacionSchema>;

/** Todo lo que muestra la pantalla de tarifas. */
export interface TarifasResumen {
  hoy: string;
  cuadros: CuadroDetalle[];
  conceptos: ConceptoDetalle[];
  planes: PlanDetalle[];
  parametros: ParametrosFacturacion;
}
