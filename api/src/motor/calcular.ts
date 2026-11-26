// Motor de cálculo (SPEC 6.4). Función pura: no toca la base ni mira la fecha de hoy.
// Con las mismas entradas devuelve siempre los mismos renglones, así cualquier factura se puede
// volver a explicar a partir de su snapshot.
//
// Reglas:
// - Dinero con decimal.js, nunca float. Cada renglón se redondea a 2 decimales, medio hacia arriba,
//   y el total es la suma de los renglones ya redondeados.
// - La estructura sale de las facturas reales de la cooperativa: cuota fija + escalones = básico;
//   + cargos = subtotal; + gravámenes = total del servicio; aparte, adicionales y recargos por mora.
import Decimal from 'decimal.js';
import {
  errorDeEscalones,
  etiquetaEscalon,
  SERVICIO_ETIQUETA,
  SERVICIOS_MEDIDOS,
  UNIDAD_SERVICIO,
  type Aviso,
  type ConceptoTarifa,
  type ConsumoCalculado,
  type CuadroTarifa,
  type EntradaFactura,
  type EscalonTarifa,
  type FacturaCalculada,
  type GrupoRenglon,
  type Renglon,
  type ServicioMedido,
} from '../shared';
import { ErrorDeCalculo } from './errores';
import { diasEntre, fechaCorta, interseccion, numeroDeDia, sumarDias } from './fechas';

const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
const CERO = new D(0);

function dec(valor: string | number | undefined, campo: string): Decimal {
  let d: Decimal;
  try {
    d = new D(valor as string);
  } catch {
    d = new D(NaN);
  }
  if (!d.isFinite()) throw new ErrorDeCalculo('dato_invalido', `El dato «${campo}» no es un número`);
  return d;
}

function noNegativo(valor: string | number | undefined, campo: string): Decimal {
  const d = dec(valor, campo);
  if (d.isNegative() && !d.isZero()) throw new ErrorDeCalculo('dato_invalido', `El dato «${campo}» no puede ser negativo`);
  return d;
}

/** La única regla de redondeo del sistema: 2 decimales, medio hacia arriba. */
export function redondear(importe: Decimal.Value): Decimal {
  return new D(importe).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}
const dinero = (d: Decimal) => redondear(d).toFixed(2);
/** Cantidades y precios: hasta 4 decimales, sin ceros de relleno. */
const numero = (d: Decimal, decimales = 4) => d.toDecimalPlaces(decimales, Decimal.ROUND_HALF_UP).toFixed();
const legible = (d: Decimal) => numero(d).replace('.', ',');

const esMedido = (servicio: string): servicio is ServicioMedido => (SERVICIOS_MEDIDOS as readonly string[]).includes(servicio);

const ORDEN_GRUPO: Record<GrupoRenglon, number> = { basico: 0, cargo: 1, gravamen: 2, adicional: 3, recargo: 4 };

/* ───────────────────────── Escalones ───────────────────────── */

/**
 * Reparte un consumo entre los escalones de un cuadro. `parte` achica los escalones cuando el
 * cuadro rigió solo una fracción del período (cambio de tarifa a mitad de mes).
 */
function repartir(consumo: Decimal, cuadro: CuadroTarifa, parte: Decimal): { escalon: EscalonTarifa; cantidad: Decimal }[] {
  const error = errorDeEscalones(cuadro.escalones);
  if (error) {
    throw new ErrorDeCalculo('cuadro_incompleto', `El cuadro de ${SERVICIO_ETIQUETA[cuadro.servicio].toLowerCase()} vigente desde el ${fechaCorta(cuadro.vigenteDesde)} está mal armado: ${error}`);
  }
  const out: { escalon: EscalonTarifa; cantidad: Decimal }[] = [];
  for (const escalon of cuadro.escalones) {
    const desde = noNegativo(escalon.desde, 'escalón desde').mul(parte);
    const tope = escalon.hasta === null ? consumo : Decimal.min(consumo, noNegativo(escalon.hasta, 'escalón hasta').mul(parte));
    const cantidad = tope.minus(desde);
    if (cantidad.lte(0)) break;
    out.push({ escalon, cantidad });
  }
  return out;
}

/* ───────────────────────── Cuadros vigentes ───────────────────────── */

interface Segmento {
  cuadro: CuadroTarifa;
  desde: string;
  hasta: string;
  dias: number;
}

/** Qué cuadro rige cada día del rango. Si el cuadro cambió en el medio, devuelve un segmento por cuadro. */
function segmentosDeTarifa(e: EntradaFactura, servicio: ServicioMedido, rango: { desde: string; hasta: string }): Segmento[] {
  const { categoria, tieneSubsidio } = e.suministro;
  const candidatos = (e.cuadros ?? []).filter((c) => c.servicio === servicio && c.categoria === categoria);
  // Si la categoría no tiene cuadro con subsidio, se factura con el común.
  const conSubsidio = tieneSubsidio && candidatos.some((c) => c.conSubsidio);
  const familia = candidatos.filter((c) => c.conSubsidio === conSubsidio).sort((a, b) => a.vigenteDesde.localeCompare(b.vigenteDesde));

  const nombre = `${SERVICIO_ETIQUETA[servicio].toLowerCase()}, categoría ${categoria ?? 'sin definir'}${conSubsidio ? ' con subsidio' : ''}`;
  const segmentos: Segmento[] = [];
  let dia = rango.desde;
  for (const cuadro of familia) {
    const tramo = interseccion(rango, { desde: cuadro.vigenteDesde, hasta: cuadro.vigenteHasta });
    if (!tramo) continue;
    if (tramo.desde > dia) break; // hueco: lo informa el control de abajo
    if (tramo.desde < dia) {
      throw new ErrorDeCalculo('cuadros_superpuestos', `Hay dos cuadros tarifarios vigentes a la vez para ${nombre} el ${fechaCorta(tramo.desde)}`);
    }
    segmentos.push({ cuadro, desde: tramo.desde, hasta: tramo.hasta, dias: diasEntre(tramo.desde, tramo.hasta) });
    dia = sumarDias(tramo.hasta, 1);
  }
  if (dia <= rango.hasta) {
    throw new ErrorDeCalculo('sin_cuadro', `No hay un cuadro tarifario vigente para ${nombre} el ${fechaCorta(dia)}`);
  }
  return segmentos;
}

/* ───────────────────────── Consumo ───────────────────────── */

function calcularConsumo(e: EntradaFactura, unidad: string, avisos: Aviso[]): ConsumoCalculado & { valor: Decimal } {
  const lecturas = e.lecturas ?? [];
  if (!lecturas.length) throw new ErrorDeCalculo('sin_lecturas', 'Falta la lectura del medidor para este período');

  let medido = CERO;
  let aFavor = noNegativo(e.consumoAFavor ?? '0', 'consumo a favor');
  let estimada = false;
  let huboVuelta = false;
  const tramos: ConsumoCalculado['tramos'] = [];

  for (const t of lecturas) {
    const anterior = noNegativo(t.anterior, 'lectura anterior');
    const actual = noNegativo(t.actual, 'lectura actual');
    const factor = dec(t.factor ?? '1', 'factor multiplicador');
    if (factor.lte(0)) throw new ErrorDeCalculo('dato_invalido', 'El factor multiplicador tiene que ser mayor que cero');

    let diferencia = actual.minus(anterior);
    if (diferencia.isNegative()) {
      if (t.vueltaDeContador) {
        if (!Number.isInteger(t.digitos) || t.digitos! < 1 || t.digitos! > 12) {
          throw new ErrorDeCalculo('dato_invalido', 'Para calcular una vuelta de contador hace falta saber cuántas cifras tiene el medidor');
        }
        const tope = new D(10).pow(t.digitos!);
        if (anterior.gte(tope)) throw new ErrorDeCalculo('dato_invalido', `La lectura anterior no entra en un contador de ${t.digitos} cifras`);
        diferencia = tope.minus(anterior).plus(actual);
        huboVuelta = true;
      } else if (t.anteriorEstimada) {
        // Se había estimado de más: lo cobrado en exceso queda a favor, en unidades de consumo.
        aFavor = aFavor.plus(diferencia.abs().mul(factor));
        diferencia = CERO;
      } else {
        throw new ErrorDeCalculo(
          'lectura_menor',
          `La lectura actual (${legible(actual)}) es menor que la anterior (${legible(anterior)}). Indicá si hubo cambio de medidor o vuelta de contador`,
        );
      }
    }
    const consumo = diferencia.mul(factor);
    medido = medido.plus(consumo);
    if (t.tipo === 'estimada') estimada = true;
    tramos.push({
      medidor: t.medidor ?? null,
      anterior: numero(anterior),
      actual: numero(actual),
      factor: numero(factor),
      consumo: numero(consumo),
      estimada: t.tipo === 'estimada',
    });
  }

  const aplicado = Decimal.min(aFavor, medido);
  const facturado = medido.minus(aplicado);
  const pendiente = aFavor.minus(aplicado);

  if (estimada) avisos.push({ codigo: 'estimada', mensaje: 'Consumo estimado: no se pudo tomar la lectura. Se ajusta con la próxima lectura real.' });
  if (lecturas.length > 1) avisos.push({ codigo: 'cambio_medidor', mensaje: 'Hubo cambio de medidor: el consumo suma lo que marcó cada uno.' });
  if (huboVuelta) avisos.push({ codigo: 'vuelta_contador', mensaje: 'El contador llegó al tope y volvió a cero.' });
  if (aplicado.gt(0)) {
    avisos.push({ codigo: 'consumo_a_favor', mensaje: `Se descontaron ${legible(aplicado)} ${unidad} que ya se habían cobrado en una factura estimada.` });
  }
  if (pendiente.gt(0)) {
    avisos.push({ codigo: 'ajuste_estimacion', mensaje: `La estimación anterior fue mayor que el consumo real: quedan ${legible(pendiente)} ${unidad} a favor para el período siguiente.` });
  }
  if (facturado.isZero()) avisos.push({ codigo: 'consumo_cero', mensaje: 'Sin consumo en el período: se cobran solo los cargos fijos.' });

  return {
    unidad,
    medido: numero(medido),
    aFavorAplicado: numero(aplicado),
    facturado: numero(facturado),
    aFavorPendiente: numero(pendiente),
    tramos,
    valor: facturado,
  };
}

/* ───────────────────────── La factura ───────────────────────── */

export function calcularFactura(e: EntradaFactura): FacturaCalculada {
  const dias = diasEntre(e.periodo.desde, e.periodo.hasta);
  if (dias < 1) throw new ErrorDeCalculo('periodo_invalido', 'El período termina antes de empezar');
  const activo = interseccion(e.periodo, { desde: e.suministro.fechaAlta, hasta: e.suministro.fechaBaja });
  if (!activo) throw new ErrorDeCalculo('sin_servicio', 'La conexión no tuvo el servicio en ningún día del período');
  const diasActivos = diasEntre(activo.desde, activo.hasta);

  const renglones: Renglon[] = [];
  /** Renglones que nacen de un concepto: un porcentaje sobre recargos no se calcula sobre otro porcentaje. */
  const deConcepto = new Set<Renglon>();
  const avisos: Aviso[] = [];
  const cuadrosUsados: CuadroTarifa[] = [];
  let consumo: (ConsumoCalculado & { valor: Decimal }) | null = null;

  if (diasActivos < dias) {
    avisos.push({ codigo: 'prorrateo', mensaje: `Tuvo el servicio ${diasActivos} de los ${dias} días del período: los cargos fijos se cobran en proporción.` });
  }
  /** "1" si es el período entero; si no, la fracción con 4 decimales. */
  const fraccion = (n: number, total: number) => (n === total ? '1' : numero(new D(n).div(total)));

  /* ── Lo básico del servicio ── */
  if (esMedido(e.servicio)) {
    const unidad = UNIDAD_SERVICIO[e.servicio];
    consumo = calcularConsumo(e, unidad, avisos);
    const segmentos = segmentosDeTarifa(e, e.servicio, activo);
    const cambioDeTarifa = segmentos.length > 1;
    if (cambioDeTarifa) {
      avisos.push({ codigo: 'cambio_tarifa', mensaje: 'La tarifa cambió durante el período: el consumo se reparte por días entre los dos cuadros.' });
    }

    let restante = consumo.valor;
    segmentos.forEach((s, i) => {
      cuadrosUsados.push(s.cuadro);
      const parte = new D(s.dias).div(diasActivos);
      // El último segmento se lleva el resto: así la suma da exactamente el consumo facturado.
      const consumoSegmento = i === segmentos.length - 1 ? restante : consumo!.valor.mul(parte).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
      restante = restante.minus(consumoSegmento);
      const nota = cambioDeTarifa ? `Tarifa del ${fechaCorta(s.desde)} al ${fechaCorta(s.hasta)} (${s.dias} de ${diasActivos} días)` : undefined;

      const cargoFijo = noNegativo(s.cuadro.cargoFijo, 'cuota fija');
      if (!cargoFijo.isZero()) {
        renglones.push({
          grupo: 'basico',
          codigo: 'CARGO_FIJO',
          servicio: e.servicio,
          descripcion: `Cuota fija ${SERVICIO_ETIQUETA[e.servicio].toLowerCase()}`,
          cantidad: fraccion(s.dias, dias),
          unitario: numero(cargoFijo),
          porcentaje: null,
          base: null,
          importe: dinero(cargoFijo.mul(s.dias).div(dias)),
          nota: nota ?? (s.dias < dias ? `Proporcional: ${s.dias} de ${dias} días` : undefined),
        });
      }
      for (const { escalon, cantidad } of repartir(consumoSegmento, s.cuadro, parte)) {
        const precio = noNegativo(escalon.precio, 'precio del escalón');
        renglones.push({
          grupo: 'basico',
          codigo: 'ESCALON',
          servicio: e.servicio,
          descripcion: etiquetaEscalon(escalon, unidad),
          cantidad: numero(cantidad),
          unitario: numero(precio),
          porcentaje: null,
          base: null,
          importe: dinero(cantidad.mul(precio)),
          ...(escalon.subsidiado ? { subsidiado: true } : {}),
          ...(escalon.exentoDe.length ? { exentoDe: [...escalon.exentoDe] } : {}),
          ...(nota ? { nota } : {}),
        });
      }
    });
  } else if (e.servicio === 'sepelio') {
    if (!e.sepelio) throw new ErrorDeCalculo('dato_invalido', 'Falta la cantidad de adherentes de sepelio');
    renglones.push(...renglonesDeSepelio(e, 'basico', diasActivos, dias, cuadrosUsados));
  } else {
    if (!e.plan) throw new ErrorDeCalculo('sin_plan', `La conexión no tiene un plan de ${SERVICIO_ETIQUETA[e.servicio]} asignado`);
    const precio = noNegativo(e.plan.precio, 'precio del plan');
    renglones.push({
      grupo: 'basico',
      codigo: 'ABONO',
      servicio: e.servicio,
      descripcion: `Abono ${e.plan.nombre}`,
      cantidad: fraccion(diasActivos, dias),
      unitario: numero(precio),
      porcentaje: null,
      base: null,
      importe: dinero(precio.mul(diasActivos).div(dias)),
      ...(diasActivos < dias ? { nota: `Proporcional: ${diasActivos} de ${dias} días` } : {}),
    });
  }

  /* ── Sepelio dentro de la factura de otro servicio ── */
  if (e.sepelio && e.servicio !== 'sepelio') {
    const rango = interseccion(e.periodo, { desde: e.sepelio.fechaAlta ?? e.periodo.desde, hasta: e.sepelio.fechaBaja ?? null });
    if (rango) renglones.push(...renglonesDeSepelio(e, 'adicional', diasEntre(rango.desde, rango.hasta), dias, cuadrosUsados));
  }

  /* ── Cargos propios de la conexión ── */
  for (const c of e.cargosParticulares ?? []) {
    const importe = dec(c.importe, `importe de «${c.descripcion}»`);
    if (importe.isZero()) continue;
    renglones.push({
      grupo: c.grupo,
      codigo: c.codigo ?? 'PARTICULAR',
      servicio: e.servicio,
      descripcion: c.descripcion,
      cantidad: '1',
      unitario: numero(importe),
      porcentaje: null,
      base: null,
      importe: dinero(importe),
    });
  }

  /* ── Intereses por mora ── */
  if (e.deudaVencida?.length) {
    if (!e.fechaEmision) throw new ErrorDeCalculo('sin_fecha_emision', 'Falta la fecha de emisión para calcular los intereses por mora');
    const tasa = noNegativo(e.parametros.moraTasaDiaria, 'tasa de mora');
    const emision = numeroDeDia(e.fechaEmision);
    for (const deuda of e.deudaVencida) {
      // Si una factura anterior ya cobró intereses, se cuentan solo los días que pasaron desde esa factura.
      const desde = deuda.interesDesde && deuda.interesDesde > deuda.venceEl ? deuda.interesDesde : deuda.venceEl;
      // Lo que se pagó tarde deja de sumar interés el día del pago.
      const pagada = deuda.interesHasta !== undefined && deuda.interesHasta <= e.fechaEmision;
      const atraso = (pagada ? numeroDeDia(deuda.interesHasta!) : emision) - numeroDeDia(desde);
      const saldo = noNegativo(deuda.saldo, 'saldo vencido');
      const interes = redondear(saldo.mul(tasa).div(100).mul(Math.max(atraso, 0)));
      if (interes.isZero()) continue;
      renglones.push({
        grupo: 'recargo',
        codigo: 'MORA',
        servicio: e.servicio,
        descripcion: `${pagada ? 'Recargo por pago fuera de término' : 'Interés por mora'} ${deuda.referencia} (venció el ${fechaCorta(deuda.venceEl)})`,
        cantidad: String(atraso),
        unitario: null,
        porcentaje: numero(tasa, 6),
        base: dinero(saldo),
        importe: dinero(interes),
        nota: `${legible(tasa)} % por día × ${atraso} días${desde === deuda.venceEl ? ' de atraso' : ` (desde el ${fechaCorta(desde)})`}${pagada ? ` · se pagó el ${fechaCorta(deuda.interesHasta!)}` : ''}`,
      });
    }
  }

  /* ── Conceptos configurables: cargos primero (entran en el subtotal), después el resto ── */
  const conceptos = conceptosQueAplican(e);
  const suma = (filtro: (r: Renglon) => boolean) => renglones.filter(filtro).reduce((t, r) => t.plus(r.importe), CERO);
  const baseDe = (c: ConceptoTarifa): Decimal => {
    const noExento = (r: Renglon) => !r.exentoDe?.includes(c.codigo);
    if (c.base === 'recargos') return suma((r) => r.grupo === 'recargo' && !deConcepto.has(r));
    if (c.base === 'subtotal') return suma((r) => (r.grupo === 'basico' || r.grupo === 'cargo') && noExento(r));
    return suma((r) => r.grupo === 'basico' && noExento(r));
  };

  for (const c of [...conceptos.filter((x) => x.grupo === 'cargo'), ...conceptos.filter((x) => x.grupo !== 'cargo')]) {
    const valor = noNegativo(c.valor, `valor de «${c.nombre}»`);
    let renglon: Renglon | null = null;
    const comun = { codigo: c.codigo, servicio: e.servicio, descripcion: c.nombre };
    if (c.tipo === 'porcentaje') {
      const base = baseDe(c);
      const importe = redondear(base.mul(valor).div(100));
      if (!importe.isZero()) {
        renglon = { ...comun, grupo: c.base === 'recargos' ? 'recargo' : c.grupo, cantidad: null, unitario: null, porcentaje: numero(valor, 6), base: dinero(base), importe: dinero(importe) };
      }
    } else if (c.tipo === 'fijo') {
      if (!redondear(valor).isZero()) {
        renglon = { ...comun, grupo: c.grupo, cantidad: '1', unitario: numero(valor, 6), porcentaje: null, base: null, importe: dinero(valor) };
      }
    } else if (consumo && !redondear(consumo.valor.mul(valor)).isZero()) {
      renglon = { ...comun, grupo: c.grupo, cantidad: numero(consumo.valor), unitario: numero(valor, 6), porcentaje: null, base: null, importe: dinero(consumo.valor.mul(valor)) };
    }
    if (renglon) {
      renglones.push(renglon);
      deConcepto.add(renglon);
    }
  }

  /* ── Totales: siempre la suma de los renglones ya redondeados ── */
  renglones.sort((a, b) => ORDEN_GRUPO[a.grupo] - ORDEN_GRUPO[b.grupo]);
  const de = (...grupos: GrupoRenglon[]) => suma((r) => grupos.includes(r.grupo));
  const { valor: _valor, ...consumoPublico } = consumo ?? { valor: CERO };

  return {
    servicio: e.servicio,
    periodo: { ...e.periodo },
    consumo: consumo ? (consumoPublico as ConsumoCalculado) : null,
    dias,
    diasActivos,
    estimada: avisos.some((a) => a.codigo === 'estimada'),
    renglones,
    totales: {
      basico: dinero(de('basico')),
      subtotal: dinero(de('basico', 'cargo')),
      gravamenes: dinero(de('gravamen')),
      servicio: dinero(de('basico', 'cargo', 'gravamen')),
      adicionales: dinero(de('adicional')),
      recargos: dinero(de('recargo')),
      total: dinero(suma(() => true)),
    },
    avisos,
    snapshot: { cuadros: cuadrosUsados, conceptos, parametros: { moraTasaDiaria: e.parametros.moraTasaDiaria } },
  };
}

/* ───────────────────────── Sepelio ───────────────────────── */

/** Cuota del titular + cuota por adherente, con el cuadro vigente al cierre del período. */
function renglonesDeSepelio(e: EntradaFactura, grupo: 'basico' | 'adicional', diasActivos: number, dias: number, usados: CuadroTarifa[]): Renglon[] {
  const cierre = e.periodo.hasta;
  const cuadro = (e.cuadros ?? []).find((c) => c.servicio === 'sepelio' && c.vigenteDesde <= cierre && (c.vigenteHasta === null || c.vigenteHasta >= cierre));
  if (!cuadro) throw new ErrorDeCalculo('sin_cuadro', `No hay un cuadro de sepelio vigente el ${fechaCorta(cierre)}`);
  const adherentes = e.sepelio?.adherentes ?? 0;
  if (!Number.isInteger(adherentes) || adherentes < 0) throw new ErrorDeCalculo('dato_invalido', 'La cantidad de adherentes de sepelio no es válida');
  usados.push(cuadro);

  const proporcion = new D(diasActivos).div(dias);
  const nota = diasActivos < dias ? { nota: `Proporcional: ${diasActivos} de ${dias} días` } : {};
  const out: Renglon[] = [];
  const titular = noNegativo(cuadro.cargoFijo, 'cuota de sepelio');
  if (!titular.isZero()) {
    out.push({
      grupo,
      codigo: 'SEPELIO_TITULAR',
      servicio: 'sepelio',
      descripcion: 'Sepelio · cuota del titular',
      cantidad: '1',
      unitario: numero(titular),
      porcentaje: null,
      base: null,
      importe: dinero(titular.mul(proporcion)),
      ...nota,
    });
  }
  for (const { escalon, cantidad } of repartir(new D(adherentes), cuadro, new D(1))) {
    const precio = noNegativo(escalon.precio, 'cuota por adherente');
    out.push({
      grupo,
      codigo: 'SEPELIO_ADHERENTES',
      servicio: 'sepelio',
      descripcion: `Sepelio · ${cantidad.eq(1) ? '1 adherente' : `${legible(cantidad)} adherentes`}`,
      cantidad: numero(cantidad),
      unitario: numero(precio),
      porcentaje: null,
      base: null,
      importe: dinero(cantidad.mul(precio).mul(proporcion)),
      ...nota,
    });
  }
  return out;
}

/* ───────────────────────── Conceptos ───────────────────────── */

/** Los conceptos vigentes al cierre del período que le corresponden a esta conexión, en orden de factura. */
function conceptosQueAplican(e: EntradaFactura): ConceptoTarifa[] {
  const cierre = e.periodo.hasta;
  const { categoria } = e.suministro;
  const aplican = e.conceptos
    .filter(
      (c) =>
        c.vigenteDesde <= cierre &&
        (c.vigenteHasta === null || c.vigenteHasta >= cierre) &&
        (c.servicio === null || c.servicio === e.servicio) &&
        (c.categorias === null || (categoria !== null && c.categorias.includes(categoria))) &&
        (c.condicionesIva === null || c.condicionesIva.includes(e.condicionIva)),
    )
    .sort((a, b) => a.orden - b.orden || a.codigo.localeCompare(b.codigo));
  const vistos = new Set<string>();
  for (const c of aplican) {
    if (vistos.has(c.codigo)) throw new ErrorDeCalculo('concepto_duplicado', `El concepto ${c.codigo} tiene dos valores vigentes el ${fechaCorta(cierre)}`);
    vistos.add(c.codigo);
  }
  return aplican;
}

/* ───────────────────────── Mora ───────────────────────── */

/** Interés simple por los días de atraso. Sirve también para mostrarle al socio cuánto debe hoy. */
export function calcularInteresMora(saldo: string, venceEl: string, hasta: string, tasaDiaria: string): string {
  const atraso = Math.max(numeroDeDia(hasta) - numeroDeDia(venceEl), 0);
  return dinero(noNegativo(saldo, 'saldo vencido').mul(noNegativo(tasaDiaria, 'tasa de mora')).div(100).mul(atraso));
}
