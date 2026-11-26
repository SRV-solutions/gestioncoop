// Puente entre la base y el motor de cálculo: lee cuadros, conceptos y parámetros de la cooperativa
// en curso y los deja en la forma que el motor espera.
import Decimal from 'decimal.js';
import { Op } from 'sequelize';
import {
  PARAMETROS_FACTURACION_DEFECTO,
  TIMEZONE,
  type ConceptoDetalle,
  type ConfigCooperativa,
  type CuadroDetalle,
  type ParametrosFacturacion,
} from '../shared';
import { Concepto, Cooperativa, CuadroTarifario, Escalon } from '../models';
import { requireCooperativaId } from './tenant';

/** Hoy en la Argentina, como `aaaa-mm-dd`. El motor no lo usa: la fecha siempre se le pasa. */
export function hoy(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(new Date());
}

/** `"2606.168800"` → `"2606.1688"`: sin ceros de relleno, sin notación científica. */
const limpio = (v: string) => new Decimal(v).toFixed();

export function toCuadro(c: CuadroTarifario, fechaHoy = hoy()): CuadroDetalle {
  return {
    id: c.id,
    servicio: c.servicio,
    categoria: c.categoria,
    conSubsidio: c.conSubsidio,
    vigenteDesde: c.vigenteDesde,
    vigenteHasta: c.vigenteHasta,
    cargoFijo: new Decimal(c.cargoFijo).toFixed(2),
    nota: c.nota,
    creadoEl: c.creadoEl.toISOString(),
    futuro: c.vigenteDesde > fechaHoy,
    escalones: [...(c.escalones ?? [])]
      .sort((a, b) => Number(a.desde) - Number(b.desde))
      .map((e) => ({
        desde: limpio(e.desde),
        hasta: e.hasta === null ? null : limpio(e.hasta),
        precio: new Decimal(e.precioUnitario).toFixed(4),
        subsidiado: e.subsidiado,
        exentoDe: e.exentoDe ?? [],
      })),
  };
}

export function toConcepto(c: Concepto, fechaHoy = hoy()): ConceptoDetalle {
  return {
    id: c.id,
    codigo: c.codigo,
    nombre: c.nombre,
    tipo: c.tipo,
    valor: limpio(c.valor),
    base: c.base,
    grupo: c.grupo,
    servicio: c.aplicaA,
    categorias: c.categorias,
    condicionesIva: c.condicionesIva,
    orden: c.orden,
    vigenteDesde: c.vigenteDesde,
    vigenteHasta: c.vigenteHasta,
    creadoEl: c.creadoEl.toISOString(),
    futuro: c.vigenteDesde > fechaHoy,
  };
}

/** Filtro: vigente en algún día entre `desde` y `hasta`. */
const vigenteEntre = (desde: string, hasta: string) => ({
  vigenteDesde: { [Op.lte]: hasta },
  [Op.or]: [{ vigenteHasta: null }, { vigenteHasta: { [Op.gte]: desde } }],
});

/** Cuadros de la cooperativa; con `rango`, solo los que rigen algún día de ese rango. */
export async function cargarCuadros(rango?: { desde: string; hasta: string }): Promise<CuadroDetalle[]> {
  const cuadros = await CuadroTarifario.findAll({
    where: rango ? vigenteEntre(rango.desde, rango.hasta) : {},
    include: [{ model: Escalon, as: 'escalones' }],
    order: [
      ['servicio', 'ASC'],
      ['categoria', 'ASC'],
      ['conSubsidio', 'ASC'],
      ['vigenteDesde', 'DESC'],
    ],
  });
  const fechaHoy = hoy();
  return cuadros.map((c) => toCuadro(c, fechaHoy));
}

export async function cargarConceptos(rango?: { desde: string; hasta: string }): Promise<ConceptoDetalle[]> {
  const conceptos = await Concepto.findAll({
    where: rango ? vigenteEntre(rango.desde, rango.hasta) : {},
    order: [
      ['orden', 'ASC'],
      ['codigo', 'ASC'],
      ['vigenteDesde', 'DESC'],
    ],
  });
  const fechaHoy = hoy();
  return conceptos.map((c) => toConcepto(c, fechaHoy));
}

export function parametrosDe(config: ConfigCooperativa): ParametrosFacturacion {
  return { ...PARAMETROS_FACTURACION_DEFECTO, ...config.facturacion };
}

/** Vencimientos, mora y regla de corte de la cooperativa en curso. */
export async function cargarParametros(): Promise<ParametrosFacturacion> {
  const coop = await Cooperativa.findByPk(requireCooperativaId());
  return parametrosDe(coop!.configJson);
}
