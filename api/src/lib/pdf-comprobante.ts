// PDF de un comprobante (SPEC 6.5): encabezado, datos del socio, total y vencimiento, lecturas,
// gráfico de consumo de los últimos meses, desglose del cálculo, código de barras y QR de pago.
// Se arma cada vez que se pide, siempre a partir de lo que el comprobante tiene guardado: un
// comprobante emitido no cambia, así que su PDF tampoco.
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import {
  CATEGORIA_ETIQUETA,
  CONDICION_IVA_ETIQUETA,
  formatCantidad,
  formatComprobante,
  formatCuit,
  formatDate,
  formatMoney,
  formatPeriodo,
  formatPorcentaje,
  formatPrecio,
  SERVICIO_ETIQUETA,
  TIPO_COMPROBANTE_ETIQUETA,
  type AmbienteFiscal,
  type ComprobanteDetalle,
  type ConfigCooperativa,
  type GrupoRenglon,
  type ModeloFactura,
  type Renglon,
} from '../shared';

export interface DatosPdf {
  cooperativa: {
    nombre: string;
    cuit: string;
    config: ConfigCooperativa;
    color: string;
    /** Diseño que cargó SRV para esta cooperativa. */
    modelo: ModeloFactura;
    /** Logo del encabezado (PNG o JPEG), o `null`. */
    logo: Buffer | null;
  };
  comprobante: ComprobanteDetalle;
  /** Consumo de los meses anteriores y de este, del más viejo al más nuevo. */
  historial: { anio: number; mes: number; consumo: number; estimada: boolean }[];
  /** Dirección que abre el QR; `null` = sin QR. */
  urlPago: string | null;
  /** Quién autorizó el comprobante: solo `produccion` tiene validez fiscal. */
  ambienteFiscal: AmbienteFiscal;
  /** QR de ARCA (RG 4892); `null` si el comprobante no lo autorizó ARCA. */
  qrFiscal: string | null;
}

const MARGEN = 36;
const ANCHO = 595.28;
const ALTO = 841.89;
const UTIL = ANCHO - MARGEN * 2;
const TINTA = '#111827';
const SUAVE = '#6b7280';
const LINEA = '#d1d5db';
const FONDO = '#f3f4f6';
const AZUL = '#0b6be0';
const NARANJA = '#f6950a';
const ROJO = '#c0392b';
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const HEX = /^#[0-9a-f]{6}$/i;

type Doc = InstanceType<typeof PDFDocument>;

/** El color mezclado con blanco: `t` = cuánto blanco (0 a 1). Para fondos suaves del color de la cooperativa. */
function aclarar(hex: string, t: number): string {
  const n = parseInt(hex.slice(1), 16);
  const canal = (c: number) => Math.round(c + (255 - c) * t).toString(16).padStart(2, '0');
  return `#${canal((n >> 16) & 255)}${canal((n >> 8) & 255)}${canal(n & 255)}`;
}

/** De dónde sale el importe de un renglón: «30 × $ 104,534» o «21 % de $ 288.345,84». */
function cuenta(r: Renglon): string {
  if (r.codigo === 'MORA') return r.nota ?? '';
  if (r.porcentaje !== null && r.base !== null) return `${formatPorcentaje(r.porcentaje)} de ${formatMoney(r.base)}`;
  const nota = r.nota?.replace('Proporcional: ', '') ?? '';
  if (r.cantidad !== null && r.unitario !== null && r.cantidad !== '1') {
    return `${formatCantidad(r.cantidad)} × ${formatPrecio(r.unitario, 6)}${nota ? ` · ${nota}` : ''}`;
  }
  return r.nota ?? '';
}

/* ───────────────────────── Código de barras (Interleaved 2 of 5) ───────────────────────── */

// Ancho de las 5 barras de cada dígito: 0 = angosta, 1 = ancha.
const ITF = ['00110', '10001', '01001', '11000', '00101', '10100', '01100', '00011', '10010', '01010'];

function codigoDeBarras(doc: Doc, digitos: string, x: number, y: number, alto: number, angosta = 0.82): number {
  const ancha = angosta * 3;
  let cx = x;
  const barra = (ancho: number, negra: boolean) => {
    if (negra) doc.rect(cx, y, ancho, alto).fill('#000000');
    cx += ancho;
  };
  // Arranque: angosta-angosta-angosta-angosta.
  barra(angosta, true);
  barra(angosta, false);
  barra(angosta, true);
  barra(angosta, false);
  for (let i = 0; i < digitos.length; i += 2) {
    const a = ITF[Number(digitos[i])]!;
    const b = ITF[Number(digitos[i + 1])]!;
    for (let j = 0; j < 5; j++) {
      barra(a[j] === '1' ? ancha : angosta, true);
      barra(b[j] === '1' ? ancha : angosta, false);
    }
  }
  // Cierre: ancha-angosta-angosta.
  barra(ancha, true);
  barra(angosta, false);
  barra(angosta, true);
  return cx - x;
}

function qr(doc: Doc, texto: string, x: number, y: number, lado: number): void {
  const { modules } = QRCode.create(texto, { errorCorrectionLevel: 'M' });
  const celda = lado / modules.size;
  for (let f = 0; f < modules.size; f++) {
    for (let c = 0; c < modules.size; c++) {
      if (modules.get(f, c)) doc.rect(x + c * celda, y + f * celda, celda + 0.2, celda + 0.2).fill('#000000');
    }
  }
}

/* ───────────────────────── El documento ───────────────────────── */

export function pdfComprobante(d: DatosPdf): Promise<Buffer> {
  const c = d.comprobante;
  const esBorrador = c.estado === 'borrador';
  const titulo = esBorrador ? 'PRE-FACTURA' : TIPO_COMPROBANTE_ETIQUETA[c.tipo].toUpperCase();
  const color = HEX.test(d.cooperativa.color) ? d.cooperativa.color : AZUL;
  const cfg = d.cooperativa.config;

  const doc = new PDFDocument({
    size: 'A4',
    margin: MARGEN,
    info: { Title: `${c.referencia} · ${c.titular.nombre}`, Author: d.cooperativa.nombre, Subject: `${SERVICIO_ETIQUETA[c.servicio]} ${formatPeriodo(c.mes, c.anio)}` },
  });
  const partes: Buffer[] = [];
  const listo = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (p: Buffer) => partes.push(p));
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.on('error', reject);
  });

  /** Con `width`, el texto se corta con puntos suspensivos al llegar a `lines` renglones (uno, si no se dice). */
  const texto = (t: string, x: number, y: number, o: { size?: number; bold?: boolean; color?: string; width?: number; align?: 'left' | 'right' | 'center'; lines?: number } = {}) => {
    const size = o.size ?? 9;
    doc
      .font(o.bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(size)
      .fillColor(o.color ?? TINTA)
      .text(t, x, y, { width: o.width, align: o.align ?? 'left', lineBreak: o.width !== undefined, ellipsis: true, height: o.width !== undefined ? size * 1.2 * (o.lines ?? 1) : undefined });
  };
  const derecha = MARGEN + UTIL;

  /* ── Encabezado: logo (si hay), nombre y datos; a la derecha, tipo y número ── */
  const modelo = d.cooperativa.modelo;
  const cajaX = derecha - 196;
  let xTexto = MARGEN + 14;
  if (d.cooperativa.logo) {
    try {
      doc.image(d.cooperativa.logo, MARGEN + 13, MARGEN + 2, { fit: [92, 70], align: 'center', valign: 'center' });
      xTexto = MARGEN + 13 + 92 + 10;
    } catch {
      // Una imagen que el PDF no puede leer: la factura sale igual, sin logo.
    }
  }
  const anchoTexto = cajaX - 10 - xTexto;
  // Con logo queda menos ancho: el nombre puede ir en tres renglones y el domicilio, en dos.
  const conLogo = xTexto > MARGEN + 14;
  texto(d.cooperativa.nombre, xTexto, MARGEN, { size: conLogo ? 10.5 : 11.5, bold: true, width: anchoTexto, lines: conLogo ? 3 : 2 });
  const yDatos = doc.y + 3;
  const lugar = `${cfg.localidad} (${cfg.codigoPostal}), ${cfg.provincia}`;
  const membrete = [
    `CUIT ${formatCuit(d.cooperativa.cuit)} · ${cfg.condicionIva}`,
    ...(conLogo ? [cfg.domicilio, lugar] : [`${cfg.domicilio} · ${lugar}`]),
    cfg.telefonos.length ? `Tel. ${cfg.telefonos.join(' / ')}` : null,
    ...modelo.membrete,
  ].filter((r): r is string => !!r);
  membrete.forEach((r, i) => texto(r, xTexto, yDatos + i * 11, { size: 8.5, color: SUAVE, width: anchoTexto }));
  const finEncabezado = Math.max(MARGEN + 74, yDatos + membrete.length * 11);
  doc.rect(MARGEN, MARGEN, 5, finEncabezado - MARGEN).fill(color);

  doc.roundedRect(cajaX, MARGEN, 196, 74, 6).lineWidth(0.8).stroke(LINEA);
  doc.roundedRect(cajaX + 10, MARGEN + 10, 34, 34, 4).lineWidth(1.2).stroke(TINTA);
  texto(c.letra, cajaX + 10, MARGEN + 15, { size: 24, bold: true, width: 34, align: 'center' });
  texto(titulo, cajaX + 54, MARGEN + 11, { size: 12, bold: true });
  texto(c.numero !== null ? `N° ${formatComprobante(c.letra, c.puntoVenta, c.numero).slice(2)}` : 'Sin número todavía', cajaX + 54, MARGEN + 27, { size: 10 });
  texto(`Emisión: ${c.emitidoEl ? formatDate(c.emitidoEl) : '—'}`, cajaX + 10, MARGEN + 51, { size: 8.5, color: SUAVE });
  texto(`Período ${formatPeriodo(c.mes, c.anio)}`, cajaX + 10, MARGEN + 51, { size: 8.5, color: SUAVE, width: 176, align: 'right' });

  let y = finEncabezado + 8;
  const sinValidez =
    d.ambienteFiscal === 'simulado' ? 'DEMO — sin validez fiscal' : d.ambienteFiscal === 'homologacion' ? 'PRUEBA DE ARCA (homologación) — sin validez fiscal' : null;
  const leyenda = esBorrador ? 'PRE-FACTURA — todavía no emitida, puede cambiar' : c.estado === 'anulado' ? 'ANULADA por nota de crédito' : sinValidez;
  if (leyenda) {
    doc.roundedRect(MARGEN, y, UTIL, 17, 4).fill('#fdecea');
    texto(leyenda, MARGEN, y + 4.5, { size: 8.5, bold: true, color: ROJO, width: UTIL, align: 'center' });
    y += 25;
  }
  // Aviso de la cooperativa para todos sus socios (hasta dos renglones).
  if (modelo.mensaje) {
    doc.font('Helvetica-Bold').fontSize(8.5);
    const renglones = Math.min(2, Math.ceil(doc.widthOfString(modelo.mensaje) / (UTIL - 24)));
    const alto = renglones > 1 ? 28 : 17;
    doc.roundedRect(MARGEN, y, UTIL, alto, 4).fill(aclarar(color, 0.86));
    texto(modelo.mensaje, MARGEN + 12, y + 4.5, { size: 8.5, bold: true, width: UTIL - 24, align: 'center', lines: 2 });
    y += alto + 8;
  }

  /* ── Socio y total ── */
  const altoBloque = 68;
  doc.roundedRect(MARGEN, y, UTIL - 206, altoBloque, 6).lineWidth(0.8).stroke(LINEA);
  texto(c.titular.nombre, MARGEN + 12, y + 9, { size: 11, bold: true, width: UTIL - 230 });
  texto(`Socio N° ${c.titular.numero} · ${c.titular.tipoDoc} ${c.titular.nroDoc} · ${CONDICION_IVA_ETIQUETA[c.titular.condicionIva]}`, MARGEN + 12, y + 24, { size: 8.5, color: SUAVE });
  texto(c.conexion.direccion, MARGEN + 12, y + 37, { size: 9.5, width: UTIL - 230 });
  const detalleServicio = [
    `Conexión N° ${c.conexion.numero}`,
    c.conexion.zona,
    c.categoria ? `${CATEGORIA_ETIQUETA[c.categoria]}${c.tieneSubsidio ? ' con subsidio' : ''}` : c.plan,
  ].filter(Boolean);
  texto(detalleServicio.join(' · '), MARGEN + 12, y + 51, { size: 8.5, color: SUAVE, width: UTIL - 230 });

  doc.roundedRect(cajaX, y, 196, altoBloque, 6).fill(FONDO);
  texto(c.tipo === 'nota_credito' ? 'Importe acreditado' : 'Total a pagar', cajaX + 12, y + 8, { size: 9, color: SUAVE });
  texto(formatMoney(c.total), cajaX + 12, y + 20, { size: 20, bold: true, width: 172 });
  texto(c.venceEl ? `Vence el ${formatDate(c.venceEl)}` : c.tipo === 'factura' ? 'Vencimiento: al emitir' : '', cajaX + 12, y + 48, { size: 10, bold: true, color: c.venceEl ? TINTA : SUAVE });
  y += altoBloque + 12;

  /* ── Lecturas y gráfico de consumo ── */
  const calculo = c.calculo;
  texto(`${SERVICIO_ETIQUETA[c.servicio]}`, MARGEN, y, { size: 11, bold: true });
  const referencia = [c.tipo === 'nota_credito' && c.relacionado ? `Anula ${c.relacionado.referencia}` : null, c.motivo ? `Motivo: ${c.motivo}` : null].filter(Boolean).join(' · ');
  if (referencia) texto(referencia, MARGEN + 150, y + 1.5, { size: 8.5, color: SUAVE, width: UTIL - 150, align: 'right' });
  y += 15;

  if (calculo?.consumo) {
    const con = calculo.consumo;
    const altoFila = 84;
    // Izquierda: lo que marcó el medidor.
    const anchoIzq = 232;
    texto('Consumo del período', MARGEN, y, { size: 8.5, color: SUAVE });
    texto(`${formatCantidad(con.facturado)} ${con.unidad}`, MARGEN, y + 11, { size: 17, bold: true });
    let yt = y + 33;
    const col = [MARGEN, MARGEN + 62, MARGEN + 112, MARGEN + 162, MARGEN + 190];
    ['Medidor', 'Anterior', 'Actual', 'Factor', 'Consumo'].forEach((t, i) => texto(t, col[i]!, yt, { size: 7.5, color: SUAVE, width: i === 0 ? 60 : i === 4 ? 42 : i === 3 ? 26 : 48, align: i === 0 ? 'left' : 'right' }));
    yt += 10;
    doc.moveTo(MARGEN, yt).lineTo(MARGEN + anchoIzq, yt).lineWidth(0.5).stroke(LINEA);
    yt += 3;
    for (const t of con.tramos.slice(0, 3)) {
      texto(String(Number(t.medidor ?? 0) || (t.medidor ?? '—')), col[0]!, yt, { size: 8.5, width: 60 });
      texto(formatCantidad(t.anterior), col[1]!, yt, { size: 8.5, width: 48, align: 'right' });
      texto(`${formatCantidad(t.actual)}${t.estimada ? ' *' : ''}`, col[2]!, yt, { size: 8.5, width: 48, align: 'right' });
      texto(formatCantidad(t.factor), col[3]!, yt, { size: 8.5, width: 26, align: 'right' });
      texto(formatCantidad(t.consumo), col[4]!, yt, { size: 8.5, bold: true, width: 42, align: 'right' });
      yt += 12;
    }
    if (calculo.estimada) texto('* Lectura estimada: se ajusta con la próxima lectura real.', MARGEN, yt + 1, { size: 7.5, color: SUAVE });

    // Derecha: los últimos meses.
    const gx = MARGEN + anchoIzq + 22;
    const gAncho = UTIL - anchoIzq - 22;
    texto(`Tu consumo de los últimos meses (${con.unidad})`, gx, y, { size: 8.5, color: SUAVE });
    const meses = d.historial.slice(-13);
    if (meses.length) {
      const gy = y + 22;
      const gAlto = altoFila - 42;
      const max = Math.max(...meses.map((m) => m.consumo), 1);
      const paso = gAncho / 13;
      const anchoBarra = Math.min(paso * 0.68, 22);
      doc.moveTo(gx, gy + gAlto).lineTo(gx + gAncho, gy + gAlto).lineWidth(0.6).stroke(LINEA);
      meses.forEach((m, i) => {
        const ultimo = i === meses.length - 1;
        const alto = Math.max((m.consumo / max) * gAlto, m.consumo > 0 ? 1.5 : 0);
        const bx = gx + (13 - meses.length + i) * paso + (paso - anchoBarra) / 2;
        doc.roundedRect(bx, gy + gAlto - alto, anchoBarra, alto, 1.5).fill(ultimo ? color : '#c5cad3');
        texto(formatCantidad(Math.round(m.consumo)), bx - 8, gy + gAlto - alto - 8, { size: 6, color: ultimo ? TINTA : SUAVE, bold: ultimo, width: anchoBarra + 16, align: 'center' });
        texto(`${MESES[m.mes - 1]}${m.estimada ? '*' : ''}`, bx - 8, gy + gAlto + 3, { size: 7, color: ultimo ? TINTA : SUAVE, bold: ultimo, width: anchoBarra + 16, align: 'center' });
      });
    } else {
      texto('Todavía no hay meses anteriores para comparar.', gx, y + 30, { size: 8.5, color: SUAVE });
    }
    y += altoFila + 4;
  }

  /* ── Desglose ── */
  const pie = 108; // lugar reservado abajo para el código de barras y el QR
  const limite = () => ALTO - MARGEN - pie;
  const saltarSiHaceFalta = (alto: number) => {
    if (y + alto <= limite()) return;
    doc.addPage();
    y = MARGEN;
  };
  const cabecera = (t: string) => {
    saltarSiHaceFalta(28);
    y += 2;
    texto(t.toUpperCase(), MARGEN, y, { size: 7.5, bold: true, color: SUAVE });
    y += 10;
    doc.moveTo(MARGEN, y).lineTo(derecha, y).lineWidth(0.5).stroke(LINEA);
    y += 3.5;
  };
  const fila = (r: Renglon) => {
    saltarSiHaceFalta(12);
    texto(r.descripcion + (r.subsidiado ? '  (con subsidio)' : ''), MARGEN, y, { size: 8.8, width: 256 });
    texto(cuenta(r), MARGEN + 262, y + 0.6, { size: 8, color: SUAVE, width: 166 });
    texto(formatMoney(r.importe), derecha - 96, y, { size: 8.8, width: 96, align: 'right' });
    y += 12;
  };
  const total = (etiqueta: string, importe: string, fuerte = false) => {
    saltarSiHaceFalta(fuerte ? 17 : 15);
    const alto = fuerte ? 16 : 14;
    doc.rect(MARGEN, y - 1, UTIL, alto).fill(fuerte ? TINTA : FONDO);
    texto(etiqueta, MARGEN + 8, y + alto / 2 - 4.5, { size: 9, bold: true, color: fuerte ? '#ffffff' : TINTA });
    texto(formatMoney(importe), derecha - 104, y + alto / 2 - 4.5, { size: 9, bold: true, color: fuerte ? '#ffffff' : TINTA, width: 96, align: 'right' });
    y += alto + 3;
  };

  if (calculo) {
    const de = (...grupos: GrupoRenglon[]) => calculo.renglones.filter((r) => grupos.includes(r.grupo));
    const servicio = SERVICIO_ETIQUETA[c.servicio].toLowerCase();
    cabecera('Detalle del cálculo');
    de('basico', 'cargo').forEach(fila);
    const gravamenes = de('gravamen');
    const adicionales = de('adicional');
    const recargos = de('recargo');
    if (gravamenes.length || adicionales.length || recargos.length) total(`Subtotal ${servicio}`, calculo.totales.subtotal);
    if (gravamenes.length) {
      cabecera('Impuestos y tasas');
      gravamenes.forEach(fila);
    }
    if (adicionales.length || recargos.length) total(`Total ${servicio}`, calculo.totales.servicio);
    if (adicionales.length) {
      cabecera('Adicionales');
      adicionales.forEach(fila);
    }
    if (recargos.length) {
      cabecera('Recargos por mora');
      recargos.forEach(fila);
    }
    y += 2;
    total(c.tipo === 'nota_credito' ? 'TOTAL ACREDITADO' : 'TOTAL A PAGAR', calculo.totales.total, true);

    /* ── En qué se va la factura ── */
    const partesTotal: { nombre: string; importe: number; color: string }[] = [
      { nombre: 'Cuota fija y consumo', importe: Number(calculo.totales.subtotal), color },
      { nombre: 'Impuestos y tasas', importe: Number(calculo.totales.gravamenes), color: '#9aa3b2' },
      { nombre: 'Adicionales', importe: Number(calculo.totales.adicionales), color: NARANJA },
      { nombre: 'Mora', importe: Number(calculo.totales.recargos), color: ROJO },
    ].filter((p) => p.importe > 0);
    const suma = partesTotal.reduce((t, p) => t + p.importe, 0);
    if (c.tipo === 'factura' && partesTotal.length > 1 && suma > 0) {
      saltarSiHaceFalta(38);
      y += 3;
      texto('¿En qué se va tu factura?', MARGEN, y, { size: 8.5, bold: true });
      y += 12;
      let bx = MARGEN;
      for (const p of partesTotal) {
        const ancho = (p.importe / suma) * UTIL;
        doc.rect(bx, y, ancho, 8).fill(p.color);
        bx += ancho;
      }
      y += 12;
      let lx = MARGEN;
      for (const p of partesTotal) {
        doc.circle(lx + 3, y + 3.5, 3).fill(p.color);
        const etiqueta = `${p.nombre} ${Math.round((p.importe / suma) * 100)} %`;
        texto(etiqueta, lx + 10, y, { size: 7.5, color: SUAVE });
        lx += doc.widthOfString(etiqueta) + 26;
      }
      y += 12;
    }

    for (const a of calculo.avisos) {
      saltarSiHaceFalta(13);
      texto(`• ${a.mensaje}`, MARGEN, y, { size: 8, color: SUAVE, width: UTIL, lines: 2 });
      y = doc.y + 2;
    }
  }

  /* ── Pie: código de barras, QR y datos fiscales ── */
  const yPie = ALTO - MARGEN - pie + 12;
  doc.moveTo(MARGEN, yPie - 8).lineTo(derecha, yPie - 8).dash(3, { space: 3 }).lineWidth(0.6).stroke(LINEA).undash();
  if (c.codigoDeBarras && c.tipo === 'factura') {
    texto('Para pagar en la caja o por la app', MARGEN, yPie, { size: 8, color: SUAVE });
    codigoDeBarras(doc, c.codigoDeBarras, MARGEN, yPie + 12, 36);
    texto(c.codigoDeBarras.replace(/(\d{4})(?=\d)/g, '$1 '), MARGEN, yPie + 51, { size: 8 });
  } else {
    texto(esBorrador ? 'El código de barras y el QR aparecen cuando la factura se emite.' : '', MARGEN, yPie + 20, { size: 8.5, color: SUAVE });
  }
  if (d.urlPago && c.tipo === 'factura' && !esBorrador) {
    qr(doc, d.urlPago, derecha - 74, yPie - 2, 74);
    texto('Escaneá y pagá\ndesde el celular', derecha - 186, yPie + 22, { size: 8.5, bold: true, width: 104, align: 'right', lines: 2 });
  }
  // QR de ARCA: entre el código de barras y el QR de pago (o donde iría el código de barras, en una nota de crédito).
  if (d.qrFiscal && !esBorrador) {
    const x = c.codigoDeBarras && c.tipo === 'factura' ? MARGEN + 256 : MARGEN;
    qr(doc, d.qrFiscal, x, yPie, 50);
    texto('Comprobante\nautorizado\npor ARCA', x + 54, yPie + 12, { size: 6.5, color: SUAVE, width: 48, lines: 3 });
  }
  const sufijo = d.ambienteFiscal === 'simulado' ? ' (simulado)' : d.ambienteFiscal === 'homologacion' ? ' (homologación)' : '';
  const fiscal = c.cae ? `CAE ${c.cae} · Vto. ${c.caeVence ? formatDate(c.caeVence) : '—'}${sufijo}` : '';
  const guardias = cfg.guardias.map((g) => `Guardia ${SERVICIO_ETIQUETA[g.servicio].toLowerCase()}: ${g.telefono}`).join(' · ');
  const datosPie = [fiscal, guardias].filter(Boolean).join('   ·   ');
  if (modelo.pie) {
    // Con texto legal: los datos fiscales en un renglón, la leyenda en dos y el crédito a la derecha.
    texto(datosPie, MARGEN, yPie + 61, { size: 7.5, color: SUAVE, width: UTIL - 96 });
    texto(modelo.pie, MARGEN, yPie + 71, { size: 6.8, color: SUAVE, width: UTIL - 150, lines: 2 });
    texto('Hecho con GestiónCoop · SRV', derecha - 140, yPie + 86, { size: 6.5, color: '#9ca3af', width: 140, align: 'right' });
  } else {
    texto(datosPie, MARGEN, yPie + 65, { size: 7.5, color: SUAVE, width: UTIL - 96, lines: 2 });
    texto('Hecho con GestiónCoop · SRV', MARGEN, yPie + 86, { size: 6.5, color: '#9ca3af' });
  }

  doc.end();
  return listo;
}
