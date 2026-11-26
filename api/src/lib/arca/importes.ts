// De los renglones de una factura a los importes que pide ARCA. Tienen que cerrar al centavo:
//   ImpTotal = ImpNeto + ImpIVA + ImpTrib + ImpOpEx + ImpTotConc
//   ImpNeto  = suma de las bases de IVA;  ImpIVA = suma de los IVA
//
// - IVA: los conceptos cuyo código empieza con «IVA» (la misma regla del libro de ventas). Su base es lo
//   gravado: así el neto gravado sale de lo que la tarifa ya calculó, sin adivinar.
// - Tributos, no gravado y exento: lo define el contador para cada concepto (Panel de SRV). Si no lo
//   definió, un gravamen va como «otro tributo» y lo demás como no gravado.
// - Lo que no es IVA, ni base de IVA, ni tributo, ni exento, queda como no gravado (ImpTotConc).
import Decimal from 'decimal.js';
import type { GrupoRenglon, TratamientoConcepto } from '../../shared';
import { alicuotaIva } from './codigos';

export interface RenglonFiscal {
  grupo: GrupoRenglon;
  codigo: string;
  descripcion: string;
  porcentaje: string | null;
  base: string | null;
  importe: string;
}

export interface ImportesArca {
  ImpTotal: string;
  ImpTotConc: string;
  ImpNeto: string;
  ImpOpEx: string;
  ImpTrib: string;
  ImpIVA: string;
  iva: { Id: number; BaseImp: string; Importe: string }[];
  tributos: { Id: number; Desc: string; BaseImp: string; Alic: string; Importe: string }[];
}

export class ImportesNoCierran extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportesNoCierran';
  }
}

const esIva = (codigo: string) => codigo.toUpperCase().startsWith('IVA');
const plata = (d: Decimal) => d.toFixed(2);

/** Cómo va un concepto que no es IVA, si el contador no dijo otra cosa. */
export function tratamientoSugerido(grupo: string): TratamientoConcepto {
  return grupo === 'gravamen' ? { tratamiento: 'tributo', tributoId: 99 } : { tratamiento: 'no_gravado', tributoId: null };
}

/**
 * Importes de ARCA de un comprobante. `letra` C no discrimina IVA (emisor monotributista): todo lo que
 * no es tributo va al neto. Falla con un mensaje claro si los importes no cierran.
 */
export function importesArca(renglones: RenglonFiscal[], letra: string, tratamientos: Record<string, TratamientoConcepto>): ImportesArca {
  const total = renglones.reduce((t, r) => t.plus(r.importe), new Decimal(0));
  if (total.lte(0)) throw new ImportesNoCierran('ARCA no acepta comprobantes en cero o en negativo.');

  const tributos: ImportesArca['tributos'] = [];
  let trib = new Decimal(0);
  let exento = new Decimal(0);
  const porAlicuota = new Map<number, { base: Decimal; importe: Decimal }>();

  for (const r of renglones) {
    if (esIva(r.codigo)) {
      if (letra === 'C') throw new ImportesNoCierran(`Una factura C no lleva IVA y esta tiene «${r.descripcion}».`);
      if (r.porcentaje === null || r.base === null) throw new ImportesNoCierran(`El renglón «${r.descripcion}» es IVA pero no tiene alícuota o base.`);
      const id = alicuotaIva(r.porcentaje);
      const actual = porAlicuota.get(id) ?? { base: new Decimal(0), importe: new Decimal(0) };
      porAlicuota.set(id, { base: actual.base.plus(r.base), importe: actual.importe.plus(r.importe) });
      continue;
    }
    // Lo que forma el neto (básico, cargos, recargos) entra como base del IVA: no se clasifica acá.
    if (r.grupo === 'basico' || r.grupo === 'cargo' || r.grupo === 'recargo') continue;
    const t = tratamientos[r.codigo] ?? tratamientoSugerido(r.grupo);
    if (t.tratamiento === 'tributo') {
      trib = trib.plus(r.importe);
      tributos.push({
        Id: t.tributoId ?? 99,
        Desc: r.descripcion.slice(0, 80),
        BaseImp: plata(new Decimal(r.base ?? r.importe)),
        Alic: plata(new Decimal(r.porcentaje ?? 0)),
        Importe: plata(new Decimal(r.importe)),
      });
    } else if (t.tratamiento === 'exento') {
      exento = exento.plus(r.importe);
    }
  }

  const iva = [...porAlicuota.entries()].sort(([a], [b]) => a - b).map(([Id, v]) => ({ Id, BaseImp: plata(v.base), Importe: plata(v.importe) }));
  const neto = letra === 'C' ? total.minus(trib).minus(exento) : iva.reduce((t, a) => t.plus(a.BaseImp), new Decimal(0));
  const impIva = iva.reduce((t, a) => t.plus(a.Importe), new Decimal(0));
  const noGravado = total.minus(neto).minus(impIva).minus(trib).minus(exento);
  if (noGravado.lt(0)) {
    throw new ImportesNoCierran(
      `Los importes no cierran: el total es ${plata(total)} y lo gravado más el IVA y los tributos suman ${plata(neto.plus(impIva).plus(trib).plus(exento))}. Revisá qué conceptos llevan IVA.`,
    );
  }
  if (letra !== 'C' && iva.length === 0 && noGravado.plus(exento).isZero()) throw new ImportesNoCierran('La factura no tiene IVA ni importes no gravados o exentos.');

  return {
    ImpTotal: plata(total),
    ImpTotConc: plata(noGravado),
    ImpNeto: plata(neto),
    ImpOpEx: plata(exento),
    ImpTrib: plata(trib),
    ImpIVA: plata(impIva),
    iva,
    tributos,
  };
}
