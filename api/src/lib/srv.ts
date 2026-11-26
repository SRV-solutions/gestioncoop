// Lo que SRV le cobra a cada cooperativa: un porcentaje de cada factura que emite (y, si se quiere,
// un monto fijo por factura), con la comisión que regía el día en que se emitió cada una.
//
// Qué cuenta:
// - Facturas y notas de débito emitidas (no los borradores ni los recibos): porcentaje del total + fijo.
// - Notas de crédito: descuentan el porcentaje de lo que acreditan (el fijo no se devuelve). Así una
//   factura anulada no termina cobrándose.
// - Una factura emitida antes de la primera comisión cargada no paga nada.
// El cálculo es por factura y se redondea el total del mes, a dos decimales.
import { QueryTypes } from 'sequelize';
import type { ComisionVigencia, LiquidacionMes } from '../shared';
import { sequelize } from '../db';
import type { ComisionSrv } from '../models';

/** Texto fijo: los únicos datos que entran son por `replacements`. */
const LIQUIDACION = `
  FROM comprobantes c
  LEFT JOIN LATERAL (
    SELECT s.porcentaje, s.fijo_por_factura FROM comisiones_srv s
    WHERE s.cooperativa_id = c.cooperativa_id AND s.desde <= c.emitido_el
    ORDER BY s.desde DESC LIMIT 1
  ) v ON true
  WHERE c.tipo IN ('factura', 'nota_debito', 'nota_credito') AND c.estado <> 'borrador' AND c.emitido_el IS NOT NULL`;

const COLUMNAS = `
  EXTRACT(YEAR FROM c.emitido_el)::int AS anio, EXTRACT(MONTH FROM c.emitido_el)::int AS mes,
  count(*) FILTER (WHERE c.tipo <> 'nota_credito') AS facturas,
  count(*) FILTER (WHERE c.tipo = 'nota_credito') AS notas_credito,
  COALESCE(sum(c.total) FILTER (WHERE c.tipo <> 'nota_credito'), 0) AS facturado,
  COALESCE(sum(c.total) FILTER (WHERE c.tipo = 'nota_credito'), 0) AS acreditado,
  COALESCE(sum(CASE WHEN c.tipo = 'nota_credito' THEN -c.total ELSE c.total END), 0) AS neto,
  round(COALESCE(sum(CASE WHEN c.tipo = 'nota_credito' THEN -c.total * COALESCE(v.porcentaje, 0) / 100
                          ELSE c.total * COALESCE(v.porcentaje, 0) / 100 + COALESCE(v.fijo_por_factura, 0) END), 0), 2) AS comision`;

interface FilaLiquidacion {
  cooperativa_id: number;
  anio: number;
  mes: number;
  facturas: string;
  notas_credito: string;
  facturado: string;
  acreditado: string;
  neto: string;
  comision: string;
}

/** Decimal de Postgres → texto con dos decimales, sin pasar por números de coma flotante. */
function dosDecimales(v: string | number): string {
  const s = String(v);
  const negativo = s.startsWith('-');
  const [entero = '0', fraccion = ''] = (negativo ? s.slice(1) : s).split('.');
  const t = `${entero}.${(fraccion + '00').slice(0, 2)}`;
  return negativo && Number(t) !== 0 ? `-${t}` : t;
}

const aMes = (f: FilaLiquidacion): LiquidacionMes => ({
  anio: f.anio,
  mes: f.mes,
  facturas: Number(f.facturas),
  notasCredito: Number(f.notas_credito),
  facturado: dosDecimales(f.facturado),
  acreditado: dosDecimales(f.acreditado),
  neto: dosDecimales(f.neto),
  comision: dosDecimales(f.comision),
});

/** Los meses de una cooperativa, del más nuevo al más viejo (12 como mucho). */
export async function liquidacionDeCooperativa(cooperativaId: number): Promise<LiquidacionMes[]> {
  const filas = await sequelize.query<FilaLiquidacion>(
    `SELECT c.cooperativa_id, ${COLUMNAS} ${LIQUIDACION} AND c.cooperativa_id = :cooperativaId
     GROUP BY c.cooperativa_id, 2, 3 ORDER BY 2 DESC, 3 DESC LIMIT 12`,
    { replacements: { cooperativaId }, type: QueryTypes.SELECT },
  );
  return filas.map(aMes);
}

/** Un mes, cooperativa por cooperativa. */
export async function liquidacionDelMes(anio: number, mes: number): Promise<(LiquidacionMes & { cooperativaId: number })[]> {
  const filas = await sequelize.query<FilaLiquidacion>(
    `SELECT c.cooperativa_id, ${COLUMNAS} ${LIQUIDACION}
       AND c.emitido_el >= make_date(:anio, :mes, 1) AND c.emitido_el < make_date(:anio, :mes, 1) + interval '1 month'
     GROUP BY c.cooperativa_id, 2, 3`,
    { replacements: { anio, mes }, type: QueryTypes.SELECT },
  );
  return filas.map((f) => ({ ...aMes(f), cooperativaId: f.cooperativa_id }));
}

/** Los meses que tienen facturas en alguna cooperativa, del más nuevo al más viejo. */
export async function mesesConFacturas(): Promise<{ anio: number; mes: number }[]> {
  return sequelize.query<{ anio: number; mes: number }>(
    `SELECT DISTINCT EXTRACT(YEAR FROM c.emitido_el)::int AS anio, EXTRACT(MONTH FROM c.emitido_el)::int AS mes ${LIQUIDACION}
     ORDER BY 1 DESC, 2 DESC LIMIT 24`,
    { type: QueryTypes.SELECT },
  );
}

export const aVigencia = (c: ComisionSrv & { cargador?: { nombre: string } | null }): ComisionVigencia => ({
  id: c.id,
  desde: c.desde,
  porcentaje: String(Number(c.porcentaje)),
  fijoPorFactura: dosDecimales(c.fijoPorFactura),
  nota: c.nota,
  cargadoPor: c.cargador?.nombre ?? null,
  creadoEl: c.creadoEl.toISOString(),
});

/** La que rige un día dado (las vigencias vienen ordenadas de la más nueva a la más vieja). */
export const vigenteEl = <T extends { desde: string }>(vigencias: T[], dia: string): T | null => vigencias.find((v) => v.desde <= dia) ?? null;
