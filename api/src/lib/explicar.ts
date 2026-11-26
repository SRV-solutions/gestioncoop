// «¿Por qué pago esto?» (SPEC 5 y 6.7): el cálculo de una factura contado en lenguaje simple, a
// partir de lo que la factura tiene guardado (sus renglones y los cuadros con que se calculó).
// Función pura: no lee la base, así se prueba sola.
import Decimal from 'decimal.js';
import {
  formatMoney,
  formatPrecio,
  nombreDeMes,
  SERVICIO_ETIQUETA,
  type Aviso,
  type Categoria,
  type ConsumoCalculado,
  type EscalonTarifa,
  type ParteFactura,
  type PorQuePago,
  type Renglon,
  type ServicioConexion,
  type TotalesFactura,
} from '../shared';

export interface DatosExplicacion {
  servicio: ServicioConexion;
  categoria: Categoria | null;
  tieneSubsidio: boolean;
  renglones: Renglon[];
  totales: TotalesFactura;
  consumo: ConsumoCalculado | null;
  avisos: Aviso[];
  /** Escalones de los cuadros con que se calculó (para saber hasta dónde llega el subsidio). */
  cuadros: { conSubsidio: boolean; escalones: EscalonTarifa[] }[];
  /** Consumo facturado el mes anterior en el mismo servicio. */
  anterior: { anio: number; mes: number; consumo: number } | null;
}

const CERO = new Decimal(0);
const suma = (rs: Renglon[]) => rs.reduce((t, r) => t.plus(r.importe), CERO);
const cantidad = (rs: Renglon[]) => rs.reduce((t, r) => t.plus(r.cantidad ?? 0), CERO);
const numero = (n: Decimal.Value) => new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(Number(n));
/** Los nombres de los renglones, sin repetir: «IVA 21 %, Tasa municipal». «Sepelio · cuota del titular» y «Sepelio · 2 adherentes» son «Sepelio». */
const nombresDe = (rs: Renglon[]) => [...new Set(rs.map((r) => r.descripcion.split(' · ')[0]!.replace(/\s*\(.*\)$/, '').trim()))];
const nombres = (rs: Renglon[]) => nombresDe(rs).join(', ');
/** «sepelio y cuota bombero» */
const enumerar = (lista: string[]) => (lista.length <= 1 ? (lista[0] ?? '') : `${lista.slice(0, -1).join(', ')} y ${lista.at(-1)}`);

export function explicarFactura(d: DatosExplicacion): PorQuePago {
  const r = d.renglones;
  const basicos = r.filter((x) => x.grupo === 'basico');
  const fijo = basicos.filter((x) => x.codigo === 'CARGO_FIJO');
  const escalones = basicos.filter((x) => x.codigo === 'ESCALON');
  const abono = basicos.filter((x) => x.codigo !== 'CARGO_FIJO' && x.codigo !== 'ESCALON');
  const cargos = r.filter((x) => x.grupo === 'cargo');
  const impuestos = r.filter((x) => x.grupo === 'gravamen');
  const adicionales = r.filter((x) => x.grupo === 'adicional');
  const mora = r.filter((x) => x.grupo === 'recargo');
  const unidad = d.consumo?.unidad ?? '';
  const total = new Decimal(d.totales.total);

  // Subsidio: el tope es el último escalón subsidiado del cuadro con que se calculó.
  const cuadroSubsidiado = d.tieneSubsidio ? d.cuadros.find((c) => c.conSubsidio && c.escalones.some((e) => e.subsidiado)) : undefined;
  let subsidio: PorQuePago['subsidio'] = null;
  if (cuadroSubsidiado && d.consumo) {
    const subsidiados = cuadroSubsidiado.escalones.filter((e) => e.subsidiado);
    const tope = Math.max(...subsidiados.map((e) => Number(e.hasta ?? 0)));
    const consumo = Number(d.consumo.facturado);
    const pleno = cuadroSubsidiado.escalones.find((e) => !e.subsidiado && Number(e.desde) >= tope);
    subsidio = {
      tope,
      unidad,
      consumo,
      dentro: Math.min(consumo, tope),
      fuera: Math.max(consumo - tope, 0),
      precioSubsidiado: subsidiados[0]?.precio ?? null,
      precioPleno: pleno?.precio ?? null,
      importeExcedente: suma(escalones.filter((x) => !x.subsidiado)).toFixed(2),
    };
  }

  /* ── Las partes, de la más fija a la más evitable ── */
  const partes: ParteFactura[] = [];
  const agregar = (clave: ParteFactura['clave'], etiqueta: string, rs: Renglon[], detalle: string | null) => {
    const importe = suma(rs);
    if (!importe.isZero()) partes.push({ clave, etiqueta, importe: importe.toFixed(2), detalle });
  };
  agregar('fijo', 'Cuota fija', fijo, 'Se paga aunque no consumas');
  if (subsidio) {
    const con = escalones.filter((x) => x.subsidiado);
    const sin = escalones.filter((x) => !x.subsidiado);
    agregar('subsidiado', 'Consumo con subsidio', con, `${numero(cantidad(con))} ${unidad}${con[0]?.unitario ? ` a ${formatPrecio(con[0].unitario, 2)}` : ''}`);
    agregar('excedente', 'Consumo sin subsidio', sin, `${numero(cantidad(sin))} ${unidad} por encima del tope`);
  } else {
    agregar('consumo', 'Consumo', escalones, d.consumo ? `${numero(d.consumo.facturado)} ${unidad}` : null);
  }
  agregar('abono', d.servicio === 'sepelio' ? 'Cuota de sepelio' : 'Abono del plan', abono, null);
  agregar('cargos', 'Otros cargos', cargos, nombres(cargos) || null);
  agregar('impuestos', 'Impuestos y tasas', impuestos, nombres(impuestos) || null);
  agregar('adicionales', 'Adicionales', adicionales, nombres(adicionales) || null);
  agregar('mora', 'Intereses por pagar tarde', mora, null);

  /* ── Las frases ── */
  const frases: string[] = [];
  const porcentaje = (importe: Decimal.Value) => (total.gt(0) ? Math.round(new Decimal(importe).div(total).mul(100).toNumber()) : 0);
  if (subsidio) {
    if (subsidio.fuera > 0) {
      const precios = subsidio.precioPleno && subsidio.precioSubsidiado ? ` (desde ${formatPrecio(subsidio.precioPleno, 2)} el ${unidad} en lugar de ${formatPrecio(subsidio.precioSubsidiado, 2)})` : '';
      frases.push(
        `Tenés subsidio en los primeros ${numero(subsidio.tope)} ${unidad}. Este mes consumiste ${numero(subsidio.consumo)} ${unidad}: ${numero(subsidio.fuera)} ${unidad} quedaron por encima del tope y se cobran sin subsidio${precios}.`,
      );
      frases.push(`Ese consumo de más es ${formatMoney(subsidio.importeExcedente)}: el ${porcentaje(subsidio.importeExcedente)} % de esta factura.`);
    } else {
      frases.push(`Tenés subsidio en los primeros ${numero(subsidio.tope)} ${unidad} y este mes consumiste ${numero(subsidio.consumo)} ${unidad}: todo tu consumo se cobró con subsidio.`);
    }
  } else if (d.servicio === 'energia' && d.categoria === 'residencial') {
    frases.push('Tu conexión no tiene subsidio: todo el consumo se cobra a precio pleno. Si creés que te corresponde, consultá en la cooperativa.');
  }

  let comparacion: PorQuePago['comparacion'] = null;
  if (d.anterior && d.consumo) {
    const ahora = Number(d.consumo.facturado);
    const variacion = d.anterior.consumo > 0 ? Math.round(((ahora - d.anterior.consumo) / d.anterior.consumo) * 100) : null;
    comparacion = { ...d.anterior, variacion };
    const mes = nombreDeMes(d.anterior.anio, d.anterior.mes);
    if (variacion !== null && Math.abs(variacion) >= 3) {
      frases.push(`Consumiste ${Math.abs(variacion)} % ${variacion > 0 ? 'más' : 'menos'} que en ${mes} (${numero(d.anterior.consumo)} ${unidad}).`);
    } else if (variacion !== null) {
      frases.push(`Consumiste casi lo mismo que en ${mes}.`);
    }
  }

  const importeFijo = suma(fijo);
  if (!importeFijo.isZero() && d.consumo) frases.push(`La cuota fija (${formatMoney(importeFijo.toFixed(2))}) se paga aunque no consumas.`);
  const importeImpuestos = suma(impuestos);
  if (importeImpuestos.gt(0) && total.gt(0)) frases.push(`De cada $ 100 de esta factura, $ ${porcentaje(importeImpuestos)} son impuestos y tasas.`);
  const importeAdicionales = suma(adicionales);
  if (!importeAdicionales.isZero()) {
    const lista = nombresDe(adicionales).map((n) => n.charAt(0).toLowerCase() + n.slice(1));
    frases.push(
      `También incluye ${enumerar(lista)} (${formatMoney(importeAdicionales.toFixed(2))}): ${lista.length === 1 ? 'no es parte' : 'no son parte'} del servicio de ${SERVICIO_ETIQUETA[d.servicio].toLowerCase()}.`,
    );
  }
  const importeMora = suma(mora);
  if (!importeMora.isZero()) {
    frases.push(`Incluye ${formatMoney(importeMora.toFixed(2))} de intereses por facturas que se pagaron tarde o que siguen sin pagar. Pagando antes del vencimiento, no se cobran.`);
  }
  for (const a of d.avisos) if (a.codigo !== 'consumo_cero' || !d.consumo) frases.push(a.mensaje);

  return { partes, frases, subsidio, comparacion };
}
