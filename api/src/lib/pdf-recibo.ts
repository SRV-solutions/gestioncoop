// PDF del recibo de un cobro (SPEC 6.6), en dos tamaños: ticket de 80 mm para la impresora del
// mostrador y A4 para la común. Se arma al pedirlo, siempre con lo que el cobro tiene guardado.
import PDFDocument from 'pdfkit';
import { Cooperativa } from '../models';
import { proveedorFiscalActual } from './fiscal';
import { detalleRecibo } from './caja';
import { requireCooperativaId } from './tenant';
import {
  formatCuit,
  formatDateTime,
  formatDni,
  formatMoney,
  formatPeriodo,
  MEDIO_PAGO_ETIQUETA,
  SERVICIO_ETIQUETA,
  type ConfigCooperativa,
  type FormatoRecibo,
  type ReciboDetalle,
} from '../shared';

export interface DatosRecibo {
  cooperativa: { nombre: string; nombreCorto: string; cuit: string; config: ConfigCooperativa; color: string };
  recibo: ReciboDetalle;
  /** Sin validez fiscal (proveedor fiscal simulado). */
  simulado: boolean;
}

const TINTA = '#111827';
const SUAVE = '#6b7280';
const LINEA = '#d1d5db';
const FONDO = '#f3f4f6';
const ROJO = '#c0392b';
const AZUL = '#0b6be0';
const HEX = /^#[0-9a-f]{6}$/i;

type Doc = InstanceType<typeof PDFDocument>;
/** «DNI 99.758.144», «CUIT 30-61099089-0». */
const documento = (tipo: string, numero: string) => `${tipo} ${tipo === 'DNI' ? formatDni(numero) : formatCuit(numero)}`;
interface Estilo {
  size?: number;
  bold?: boolean;
  color?: string;
  width?: number;
  align?: 'left' | 'right' | 'center';
}

function escribir(doc: Doc, t: string, x: number, y: number, o: Estilo = {}): number {
  doc
    .font(o.bold ? 'Helvetica-Bold' : 'Helvetica')
    .fontSize(o.size ?? 9)
    .fillColor(o.color ?? TINTA)
    .text(t, x, y, { width: o.width, align: o.align ?? 'left', lineBreak: o.width !== undefined });
  return doc.y;
}

function terminar(doc: Doc): Promise<Buffer> {
  const partes: Buffer[] = [];
  const listo = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (p: Buffer) => partes.push(p));
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.on('error', reject);
  });
  doc.end();
  return listo;
}

/** Leyenda bien visible: un recibo anulado o de demostración no puede pasar por bueno. */
function leyendaDe(d: DatosRecibo): string | null {
  if (d.recibo.anulacion) return 'ANULADO';
  return d.simulado ? 'DEMO — sin validez fiscal' : null;
}

/* ───────────────────────── Ticket de 80 mm ───────────────────────── */

const ANCHO_TICKET = 226.77; // 80 mm
const MARGEN_TICKET = 11;

function dibujarTicket(doc: Doc, d: DatosRecibo): number {
  const r = d.recibo;
  const cfg = d.cooperativa.config;
  const x = MARGEN_TICKET;
  const w = ANCHO_TICKET - MARGEN_TICKET * 2;
  let y = MARGEN_TICKET;
  const centro = (t: string, o: Estilo = {}) => (y = escribir(doc, t, x, y, { width: w, align: 'center', ...o }) + 1);
  const raya = () => {
    y += 3;
    doc.moveTo(x, y).lineTo(x + w, y).dash(1.5, { space: 1.5 }).lineWidth(0.6).stroke('#000000').undash();
    y += 5;
  };
  /** Texto a la izquierda e importe a la derecha, en el mismo renglón. */
  const par = (izquierda: string, derecha: string, o: Estilo = {}) => {
    const anchoImporte = 74;
    escribir(doc, derecha, x + w - anchoImporte, y, { ...o, width: anchoImporte, align: 'right' });
    y = escribir(doc, izquierda, x, y, { ...o, width: w - anchoImporte - 4 }) + 1.5;
  };

  centro(d.cooperativa.nombreCorto, { size: 11, bold: true });
  centro(`CUIT ${formatCuit(d.cooperativa.cuit)} · ${cfg.condicionIva}`, { size: 7 });
  centro(`${cfg.domicilio} · ${cfg.localidad}`, { size: 7 });
  raya();
  centro(`RECIBO ${r.letra} ${String(r.puntoVenta).padStart(4, '0')}-${String(r.numero).padStart(8, '0')}`, { size: 10, bold: true });
  centro(formatDateTime(r.cobradoEl), { size: 8 });
  if (r.cajero) centro(`Atendió: ${r.cajero}`, { size: 7.5 });
  const leyenda = leyendaDe(d);
  if (leyenda) centro(leyenda, { size: 8.5, bold: true });
  if (r.anulacion) centro(`Motivo: ${r.anulacion.motivo}`, { size: 7.5 });
  raya();

  if (r.titular) {
    y = escribir(doc, r.titular.nombre, x, y, { size: 9, bold: true, width: w }) + 1;
    y = escribir(doc, `Socio N° ${r.titular.numero} · ${documento(r.titular.tipoDoc, r.titular.nroDoc)}`, x, y, { size: 7.5, width: w }) + 1;
    if (r.titular.direccion) y = escribir(doc, r.titular.direccion, x, y, { size: 7.5, width: w }) + 1;
  } else {
    y = escribir(doc, 'Venta de mostrador', x, y, { size: 9, bold: true, width: w }) + 1;
  }
  raya();

  for (const a of r.aplicaciones) {
    par(a.referencia, formatMoney(a.importe), { size: 8.5 });
    const resta = Number(a.saldoDespues) > 0 ? ` · pago parcial, resta ${formatMoney(a.saldoDespues)}` : '';
    y = escribir(doc, `${SERVICIO_ETIQUETA[a.servicio]} ${formatPeriodo(a.mes, a.anio)}${resta}`, x, y, { size: 7, width: w }) + 3;
  }
  for (const i of r.items) {
    par(`${i.cantidad} × ${i.descripcion}`, formatMoney(i.importe), { size: 8.5 });
    if (i.cantidad > 1) y = escribir(doc, `${formatMoney(i.unitario)} c/u`, x, y, { size: 7, width: w }) + 3;
    else y += 1.5;
  }
  raya();

  par('TOTAL', formatMoney(r.importe), { size: 12, bold: true });
  y += 2;
  par('Medio de pago', MEDIO_PAGO_ETIQUETA[r.medio], { size: 8.5 });
  if (r.recibido !== null && r.vuelto !== null && Number(r.vuelto) > 0) {
    par('Recibido', formatMoney(r.recibido), { size: 8.5 });
    par('Vuelto', formatMoney(r.vuelto), { size: 8.5, bold: true });
  }
  if (r.referenciaPago) par('Operación', r.referenciaPago, { size: 8 });
  if (r.aFavor) par('Queda a tu favor', formatMoney(r.aFavor), { size: 8.5, bold: true });
  raya();
  centro('Gracias por su pago', { size: 8.5 });
  centro('Hecho con GestiónCoop · SRV', { size: 6.5 });
  return y + MARGEN_TICKET;
}

function pdfTicket(d: DatosRecibo): Promise<Buffer> {
  const opciones = { margin: 0, info: { Title: d.recibo.referencia, Author: d.cooperativa.nombre } };
  // El papel es continuo: primero se mide cuánto ocupa y después se arma la página de ese alto.
  const alto = dibujarTicket(new PDFDocument({ ...opciones, size: [ANCHO_TICKET, 3000] }), d);
  const doc = new PDFDocument({ ...opciones, size: [ANCHO_TICKET, Math.ceil(alto)] });
  dibujarTicket(doc, d);
  return terminar(doc);
}

/* ───────────────────────── A4 ───────────────────────── */

const MARGEN = 36;
const ANCHO = 595.28;
const UTIL = ANCHO - MARGEN * 2;

function pdfA4(d: DatosRecibo): Promise<Buffer> {
  const r = d.recibo;
  const cfg = d.cooperativa.config;
  const color = HEX.test(d.cooperativa.color) ? d.cooperativa.color : AZUL;
  const doc = new PDFDocument({ size: 'A4', margin: MARGEN, info: { Title: `${r.referencia}${r.titular ? ` · ${r.titular.nombre}` : ''}`, Author: d.cooperativa.nombre } });
  const derecha = MARGEN + UTIL;
  const t = (texto: string, x: number, y: number, o: Estilo = {}) => escribir(doc, texto, x, y, o);

  /* ── Encabezado ── */
  doc.rect(MARGEN, MARGEN, 5, 74).fill(color);
  const yDatos = t(d.cooperativa.nombre, MARGEN + 14, MARGEN, { size: 11.5, bold: true, width: 300 }) + 3;
  t(`CUIT ${formatCuit(d.cooperativa.cuit)} · ${cfg.condicionIva}`, MARGEN + 14, yDatos, { size: 8.5, color: SUAVE });
  t(`${cfg.domicilio} · ${cfg.localidad} (${cfg.codigoPostal}), ${cfg.provincia}`, MARGEN + 14, yDatos + 11, { size: 8.5, color: SUAVE });
  if (cfg.telefonos.length) t(`Tel. ${cfg.telefonos.join(' / ')}`, MARGEN + 14, yDatos + 22, { size: 8.5, color: SUAVE });

  const cajaX = derecha - 196;
  doc.roundedRect(cajaX, MARGEN, 196, 74, 6).lineWidth(0.8).stroke(LINEA);
  doc.roundedRect(cajaX + 10, MARGEN + 10, 34, 34, 4).lineWidth(1.2).stroke(TINTA);
  t(r.letra, cajaX + 10, MARGEN + 15, { size: 24, bold: true, width: 34, align: 'center' });
  t('RECIBO', cajaX + 54, MARGEN + 11, { size: 12, bold: true });
  t(`N° ${String(r.puntoVenta).padStart(4, '0')}-${String(r.numero).padStart(8, '0')}`, cajaX + 54, MARGEN + 27, { size: 10 });
  t(formatDateTime(r.cobradoEl), cajaX + 10, MARGEN + 51, { size: 8.5, color: SUAVE });
  if (r.cajero) t(`Atendió: ${r.cajero}`, cajaX + 10, MARGEN + 62, { size: 7.5, color: SUAVE, width: 176 });

  let y = MARGEN + 82;
  const leyenda = leyendaDe(d);
  if (leyenda) {
    doc.roundedRect(MARGEN, y, UTIL, 17, 4).fill('#fdecea');
    t(r.anulacion ? `ANULADO · ${r.anulacion.motivo}` : leyenda, MARGEN + 8, y + 4.5, { size: 8.5, bold: true, color: ROJO, width: UTIL - 16, align: 'center' });
    y += 25;
  }

  /* ── Quién pagó y cuánto ── */
  const altoBloque = 60;
  doc.roundedRect(MARGEN, y, UTIL - 206, altoBloque, 6).lineWidth(0.8).stroke(LINEA);
  if (r.titular) {
    t('Recibimos de', MARGEN + 12, y + 8, { size: 8.5, color: SUAVE });
    t(r.titular.nombre, MARGEN + 12, y + 20, { size: 11, bold: true, width: UTIL - 230 });
    t([`Socio N° ${r.titular.numero}`, documento(r.titular.tipoDoc, r.titular.nroDoc), r.titular.direccion].filter(Boolean).join(' · '), MARGEN + 12, y + 37, { size: 8.5, color: SUAVE, width: UTIL - 230 });
  } else {
    t('Venta de mostrador', MARGEN + 12, y + 22, { size: 11, bold: true });
  }
  doc.roundedRect(cajaX, y, 196, altoBloque, 6).fill(FONDO);
  t('Total cobrado', cajaX + 12, y + 8, { size: 9, color: SUAVE });
  t(formatMoney(r.importe), cajaX + 12, y + 20, { size: 20, bold: true, width: 172 });
  t(MEDIO_PAGO_ETIQUETA[r.medio] + (r.referenciaPago ? ` · op. ${r.referenciaPago}` : ''), cajaX + 12, y + 45, { size: 9, width: 172 });
  y += altoBloque + 16;

  /* ── Detalle ── */
  const col = { concepto: MARGEN, detalle: MARGEN + 170, resta: derecha - 200, importe: derecha - 96 };
  t('CONCEPTO', col.concepto, y, { size: 7.5, bold: true, color: SUAVE });
  t('DETALLE', col.detalle, y, { size: 7.5, bold: true, color: SUAVE });
  t('QUEDA DEBIENDO', col.resta, y, { size: 7.5, bold: true, color: SUAVE, width: 96, align: 'right' });
  t('IMPORTE', col.importe, y, { size: 7.5, bold: true, color: SUAVE, width: 96, align: 'right' });
  y += 11;
  doc.moveTo(MARGEN, y).lineTo(derecha, y).lineWidth(0.5).stroke(LINEA);
  y += 5;
  for (const a of r.aplicaciones) {
    t(a.referencia, col.concepto, y, { size: 9 });
    t(`${SERVICIO_ETIQUETA[a.servicio]} · ${formatPeriodo(a.mes, a.anio)}`, col.detalle, y, { size: 9, color: SUAVE });
    t(Number(a.saldoDespues) > 0 ? formatMoney(a.saldoDespues) : '—', col.resta, y, { size: 9, color: SUAVE, width: 96, align: 'right' });
    t(formatMoney(a.importe), col.importe, y, { size: 9, width: 96, align: 'right' });
    y += 14;
  }
  for (const i of r.items) {
    t(i.descripcion, col.concepto, y, { size: 9, width: 164 });
    t(`${i.cantidad} × ${formatMoney(i.unitario)}`, col.detalle, y, { size: 9, color: SUAVE });
    t(formatMoney(i.importe), col.importe, y, { size: 9, width: 96, align: 'right' });
    y += 14;
  }
  y += 2;
  doc.rect(MARGEN, y, UTIL, 18).fill(TINTA);
  t('TOTAL COBRADO', MARGEN + 8, y + 5, { size: 9.5, bold: true, color: '#ffffff' });
  t(formatMoney(r.importe), col.importe - 8, y + 5, { size: 9.5, bold: true, color: '#ffffff', width: 96, align: 'right' });
  y += 26;
  if (r.aFavor) {
    t(`Quedan ${formatMoney(r.aFavor)} a favor del socio: una factura ya estaba paga cuando llegó este pago.`, MARGEN, y, { size: 9, color: SUAVE, width: UTIL, align: 'right' });
    y += 14;
  }
  if (r.recibido !== null && r.vuelto !== null && Number(r.vuelto) > 0) {
    t(`Recibido: ${formatMoney(r.recibido)}   ·   Vuelto: ${formatMoney(r.vuelto)}`, MARGEN, y, { size: 9, color: SUAVE, width: UTIL, align: 'right' });
    y += 14;
  }

  y += 40;
  doc.moveTo(derecha - 180, y).lineTo(derecha, y).lineWidth(0.6).stroke(TINTA);
  t('Firma y sello', derecha - 180, y + 4, { size: 8, color: SUAVE, width: 180, align: 'center' });
  t('Hecho con GestiónCoop · SRV', MARGEN, y + 4, { size: 6.5, color: '#9ca3af' });

  return terminar(doc);
}

export function pdfRecibo(d: DatosRecibo, formato: FormatoRecibo): Promise<Buffer> {
  return formato === 'a4' ? pdfA4(d) : pdfTicket(d);
}

/** El recibo de un cobro de esta cooperativa, en PDF. `null` si no existe. */
export async function reciboPdf(id: number, formato: FormatoRecibo): Promise<{ pdf: Buffer; nombre: string; socioId: number | null } | null> {
  const recibo = await detalleRecibo(id);
  if (!recibo) return null;
  const [coop, proveedor] = await Promise.all([Cooperativa.findByPk(requireCooperativaId()), proveedorFiscalActual()]);
  const pdf = await pdfRecibo(
    {
      cooperativa: { nombre: coop!.nombre, nombreCorto: coop!.nombreCorto, cuit: coop!.cuit, config: coop!.configJson, color: coop!.temaJson.colores.primario },
      recibo,
      // El recibo no pasa por ARCA: dice «demo» mientras la cooperativa no facture en producción.
      simulado: proveedor.simulado,
    },
    formato,
  );
  return { pdf, nombre: `${recibo.referencia.replace(/[^\w-]+/g, '-')}.pdf`, socioId: recibo.socio?.id ?? null };
}
