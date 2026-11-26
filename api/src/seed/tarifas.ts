// Tarifas iniciales de las cooperativas de la demo. Datos puros: los carga seed/cargar-tarifas.ts.
//
// Qué es real y qué no (Dos de Mayo):
// - REAL: energía residencial con subsidio (factura 06/2026), agua residencial (factura 08/2026) y los
//   gravámenes de esas dos facturas. Con estos valores el motor reproduce las dos facturas al centavo
//   (tests/motor-facturas-reales.test.ts).
// - ILUSTRATIVO, a reemplazar por los valores de la cooperativa: el resto de las categorías, las
//   versiones anteriores de cada cuadro, sepelio, el IVA del 27 % y la tasa de mora.
import Decimal from 'decimal.js';
import {
  PARAMETROS_FACTURACION_DEFECTO,
  type Categoria,
  type ConceptoTarifa,
  type CuadroTarifa,
  type EscalonTarifa,
  type ParametrosFacturacion,
  type ServicioConCuadro,
} from '../shared';

export interface TarifasSeed {
  cuadros: CuadroTarifa[];
  conceptos: ConceptoTarifa[];
  parametros: ParametrosFacturacion;
}

type Tramo = [hasta: number | null, precio: string, extra?: Partial<Pick<EscalonTarifa, 'subsidiado' | 'exentoDe'>>];

/** Arma escalones pegados a partir de sus topes: cada uno empieza donde termina el anterior. */
function escalones(...tramos: Tramo[]): EscalonTarifa[] {
  let desde = 0;
  return tramos.map(([hasta, precio, extra]) => {
    const e: EscalonTarifa = { desde: String(desde), hasta: hasta === null ? null : String(hasta), precio, subsidiado: false, exentoDe: [], ...extra };
    desde = hasta ?? desde;
    return e;
  });
}

function cuadro(
  servicio: ServicioConCuadro,
  categoria: Categoria | null,
  vigenteDesde: string,
  cargoFijo: string,
  tramos: Tramo[],
  conSubsidio = false,
): CuadroTarifa {
  return { servicio, categoria, conSubsidio, vigenteDesde, vigenteHasta: null, cargoFijo, escalones: escalones(...tramos) };
}

/** Día anterior a una fecha `aaaa-mm-dd`. */
const diaAnterior = (fecha: string) => new Date(new Date(`${fecha}T00:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10);

/**
 * Versión anterior de un cuadro, con precios más bajos: está para mostrar el historial y el
 * prorrateo por cambio de tarifa. Los valores son ilustrativos.
 */
function versionAnterior(actual: CuadroTarifa, desde: string, aumento: string): CuadroTarifa {
  const bajar = (v: string, decimales: number) => new Decimal(v).div(new Decimal(1).plus(new Decimal(aumento).div(100))).toFixed(decimales, Decimal.ROUND_HALF_UP);
  return {
    ...actual,
    vigenteDesde: desde,
    vigenteHasta: diaAnterior(actual.vigenteDesde),
    cargoFijo: bajar(actual.cargoFijo, 2),
    escalones: actual.escalones.map((e) => ({ ...e, exentoDe: [...e.exentoDe], precio: bajar(e.precio, 4) })),
  };
}

/** Desde cuándo hay tarifas cargadas: antes del primer mes del historial de prueba (12 meses de facturas). */
const INICIO = '2025-07-01';

/** Las dos versiones anteriores de un cuadro: la que regía desde enero de 2026 y la de 2025. */
function conHistorial(actuales: CuadroTarifa[], aumentoReciente: string, aumentoAnterior: string): CuadroTarifa[] {
  return actuales.flatMap((c) => {
    const enero = versionAnterior(c, '2026-01-01', aumentoReciente);
    return [c, enero, versionAnterior(enero, INICIO, aumentoAnterior)];
  });
}

function concepto(c: Pick<ConceptoTarifa, 'codigo' | 'nombre' | 'tipo' | 'valor' | 'grupo' | 'servicio' | 'orden'> & Partial<ConceptoTarifa>): ConceptoTarifa {
  return { base: null, categorias: null, condicionesIva: null, vigenteDesde: INICIO, vigenteHasta: null, ...c };
}

/* ───────────────────────── Dos de Mayo ───────────────────────── */

// Las lecturas de esas facturas van del 17/05 al 17/06 (energía) y del 14/07 al 14/08 (agua), con una
// sola tarifa cada una: el cuadro regía, como mínimo, desde antes de esas fechas.
const ENERGIA_DESDE = '2026-05-01';
const AGUA_DESDE = '2026-07-01';

const energiaDosDeMayo: CuadroTarifa[] = [
  // REAL — «RESIDENCIAL C SUBSIDIADO Seg.Tar. N1», factura 06/2026. La factura no dice qué tramos
  // llevan subsidio: se marcan los dos primeros (120 kWh al precio más bajo). A confirmar.
  cuadro(
    'energia',
    'residencial',
    ENERGIA_DESDE,
    '2640.90',
    [
      [30, '104.5340', { subsidiado: true }],
      [120, '104.5340', { subsidiado: true }],
      [370, '196.9430'],
      [520, '268.6410'],
      [600, '109.0250'],
      [700, '109.0250'],
      [null, '268.6410'],
    ],
    true,
  ),
  // Ilustrativos.
  cuadro('energia', 'residencial', ENERGIA_DESDE, '2640.90', [[120, '196.9430'], [520, '268.6410'], [null, '295.5051']]),
  cuadro('energia', 'comercial', ENERGIA_DESDE, '4850.00', [[500, '238.5000'], [null, '286.2000']]),
  cuadro('energia', 'industrial', ENERGIA_DESDE, '12400.00', [[2000, '221.4000'], [null, '254.6000']]),
  cuadro('energia', 'rural', ENERGIA_DESDE, '3120.00', [[200, '186.3000'], [null, '248.9000']]),
  cuadro('energia', 'oficial', ENERGIA_DESDE, '4850.00', [[null, '262.4000']]),
  cuadro('energia', 'bien_publico', ENERGIA_DESDE, '2640.90', [[300, '148.2000'], [null, '221.7000']]),
];

const aguaDosDeMayo: CuadroTarifa[] = [
  // REAL — «RESIDENCIAL», factura 08/2026. En esa factura la tasa D.G.R. del 3,31 % se calcula sobre
  // $ 274.800,87: es el subtotal menos el segundo escalón. Se respeta tal cual (ese escalón queda
  // exento de la tasa) y queda como pregunta para la cooperativa.
  cuadro('agua', 'residencial', AGUA_DESDE, '866.20', [
    [5, '2606.1688'],
    [10, '2708.9944', { exentoDe: ['DGR_AP'] }],
    [20, '2860.7666'],
    [30, '4007.6976'],
    [null, '5339.4216'],
  ]),
  // Ilustrativos.
  cuadro('agua', 'comercial', AGUA_DESDE, '1299.30', [[10, '3388.0194'], [30, '4291.1499'], [null, '6407.3059']]),
  cuadro('agua', 'industrial', AGUA_DESDE, '2165.50', [[50, '4291.1499'], [null, '6941.2481']]),
  cuadro('agua', 'oficial', AGUA_DESDE, '1299.30', [[null, '3388.0194']]),
  cuadro('agua', 'bien_publico', AGUA_DESDE, '866.20', [[20, '2606.1688'], [null, '3432.9199']]),
];

const IVA_COMUN = ['consumidor_final', 'exento'] as const;
const IVA_DIFERENCIAL = ['responsable_inscripto', 'monotributo'] as const;

export const TARIFAS_DOS_DE_MAYO: TarifasSeed = {
  cuadros: [
    ...conHistorial(energiaDosDeMayo, '12', '15'),
    ...conHistorial(aguaDosDeMayo, '9', '11'),
    // Ilustrativo: cuota del titular + cuota por adherente.
    cuadro('sepelio', null, INICIO, '4800.00', [[null, '2400.0000']]),
  ],
  conceptos: [
    // Energía — tal como figuran en la factura 06/2026.
    concepto({ codigo: 'CAP_ACCIONES', nombre: 'Capitalización de acciones', tipo: 'porcentaje', valor: '10', base: 'basico', grupo: 'gravamen', servicio: 'energia', orden: 10 }),
    concepto({ codigo: 'LEY_2620', nombre: 'Ley 2620', tipo: 'porcentaje', valor: '3', base: 'basico', grupo: 'gravamen', servicio: 'energia', orden: 20 }),
    // El importe anterior del alumbrado es ilustrativo: muestra cómo queda el historial de un concepto.
    concepto({ codigo: 'ALUMBRADO', nombre: 'Servicio de alumbrado', tipo: 'fijo', valor: '7500', grupo: 'gravamen', servicio: 'energia', orden: 30, vigenteHasta: '2026-04-30' }),
    concepto({ codigo: 'ALUMBRADO', nombre: 'Servicio de alumbrado', tipo: 'fijo', valor: '9000', grupo: 'gravamen', servicio: 'energia', orden: 30, vigenteDesde: ENERGIA_DESDE }),
    concepto({ codigo: 'LEY_3195', nombre: 'Ley 3.195 D.G.R.', tipo: 'porcentaje', valor: '3.31', base: 'basico', grupo: 'gravamen', servicio: 'energia', orden: 40 }),
    concepto({ codigo: 'IVA_EE', nombre: 'IVA 21 % (s/ E.E.)', tipo: 'porcentaje', valor: '21', base: 'subtotal', grupo: 'gravamen', servicio: 'energia', orden: 50, condicionesIva: [...IVA_COMUN] }),
    // Supuesto: a responsables inscriptos y monotributistas se les factura con la alícuota del 27 %.
    concepto({ codigo: 'IVA_EE_27', nombre: 'IVA 27 % (s/ E.E.)', tipo: 'porcentaje', valor: '27', base: 'subtotal', grupo: 'gravamen', servicio: 'energia', orden: 51, condicionesIva: [...IVA_DIFERENCIAL] }),
    // La factura lo muestra como un solo importe ($ 2.677,7068 para 1.176 kWh): acá va por kWh.
    concepto({ codigo: 'LEY_25957', nombre: 'Ley Nacional 25.957', tipo: 'por_unidad', valor: '2.276962', grupo: 'gravamen', servicio: 'energia', orden: 60 }),
    concepto({ codigo: 'BOMBEROS', nombre: 'Cuota Bombero', tipo: 'fijo', valor: '2252', grupo: 'adicional', servicio: 'energia', orden: 70 }),
    // Agua — factura 08/2026.
    concepto({ codigo: 'DGR_AP', nombre: 'Res. General 03/93 D.G.R. (AP)', tipo: 'porcentaje', valor: '3.31', base: 'basico', grupo: 'gravamen', servicio: 'agua', orden: 10 }),
    concepto({ codigo: 'IVA_AP', nombre: 'IVA 21 % s/ A.P.', tipo: 'porcentaje', valor: '21', base: 'subtotal', grupo: 'gravamen', servicio: 'agua', orden: 20, condicionesIva: [...IVA_COMUN] }),
    concepto({ codigo: 'IVA_AP_27', nombre: 'IVA 27 % s/ A.P.', tipo: 'porcentaje', valor: '27', base: 'subtotal', grupo: 'gravamen', servicio: 'agua', orden: 21, condicionesIva: [...IVA_DIFERENCIAL] }),
    // En todas las facturas con intereses por mora.
    concepto({ codigo: 'IVA_RECARGOS', nombre: 'IVA 21 % s/ recargos', tipo: 'porcentaje', valor: '21', base: 'recargos', grupo: 'adicional', servicio: null, orden: 90 }),
  ],
  // La tasa de mora de las facturas no se puede deducir (no dicen sobre qué saldo ni cuántos días): ilustrativa.
  parametros: { ...PARAMETROS_FACTURACION_DEFECTO },
};

/* ───────────────────────── Arroyo del Monte (cooperativa inventada) ───────────────────────── */

const ARROYO_DESDE = INICIO;

export const TARIFAS_ARROYO_DEL_MONTE: TarifasSeed = {
  cuadros: [
    cuadro('energia', 'residencial', ARROYO_DESDE, '1980.00', [[150, '92.0000', { subsidiado: true }], [null, '214.0000']], true),
    cuadro('energia', 'residencial', ARROYO_DESDE, '1980.00', [[150, '176.0000'], [null, '214.0000']]),
    cuadro('energia', 'comercial', ARROYO_DESDE, '3900.00', [[null, '231.0000']]),
    cuadro('energia', 'industrial', ARROYO_DESDE, '9800.00', [[null, '208.0000']]),
    cuadro('energia', 'rural', ARROYO_DESDE, '2450.00', [[null, '189.0000']]),
    cuadro('energia', 'oficial', ARROYO_DESDE, '3900.00', [[null, '231.0000']]),
    cuadro('energia', 'bien_publico', ARROYO_DESDE, '1980.00', [[null, '140.0000']]),
    cuadro('agua', 'residencial', ARROYO_DESDE, '6400.00', [[10, '0.0000'], [null, '1850.0000']]),
    cuadro('agua', 'comercial', ARROYO_DESDE, '9600.00', [[10, '0.0000'], [null, '2400.0000']]),
    cuadro('agua', 'industrial', ARROYO_DESDE, '14500.00', [[null, '2400.0000']]),
    cuadro('agua', 'oficial', ARROYO_DESDE, '9600.00', [[null, '1850.0000']]),
    cuadro('agua', 'bien_publico', ARROYO_DESDE, '6400.00', [[10, '0.0000'], [null, '1400.0000']]),
    cuadro('sepelio', null, ARROYO_DESDE, '3900.00', [[null, '1900.0000']]),
  ],
  conceptos: [
    concepto({ codigo: 'ALUMBRADO', nombre: 'Alumbrado público', tipo: 'fijo', valor: '6200', grupo: 'gravamen', servicio: 'energia', orden: 10 }),
    concepto({ codigo: 'IVA', nombre: 'IVA 21 %', tipo: 'porcentaje', valor: '21', base: 'subtotal', grupo: 'gravamen', servicio: null, orden: 50 }),
    concepto({ codigo: 'IVA_RECARGOS', nombre: 'IVA 21 % s/ recargos', tipo: 'porcentaje', valor: '21', base: 'recargos', grupo: 'adicional', servicio: null, orden: 90 }),
  ],
  parametros: { ...PARAMETROS_FACTURACION_DEFECTO, moraTasaDiaria: '0.08', diasVencimiento: 15 },
};
