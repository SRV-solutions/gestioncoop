// Pasa un informe (columnas + filas + totales) a Excel, CSV o PDF (SPEC 6.9).
// - Excel: los importes van como números, para poder sumar y filtrar.
// - CSV: separado por punto y coma y con coma decimal, que es como lo abre el Excel en español.
// - PDF: A4 apaisado, con el encabezado de la cooperativa repetido en cada hoja.
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { APP_NOMBRE, formatDate, formatDateTime, formatMoney, formatNumber, type CeldaInforme, type ColumnaInforme, type FormatoInforme, type InformeDatos } from '../shared';

export interface Archivo {
  contenido: Buffer;
  nombre: string;
  mime: string;
}

/** Lo que hace falta para exportar una tabla: un informe o cualquier otra lista (las casas de un área del mapa). */
export type TablaExportable = Pick<InformeDatos, 'titulo' | 'subtitulo' | 'columnas' | 'filas' | 'totales' | 'nota' | 'periodo' | 'generadoEl'>;

export interface Membrete {
  cooperativa: string;
  /** Quién lo pidió: queda escrito en el archivo. */
  usuario: string | null;
}

const MIME: Record<Exclude<FormatoInforme, 'json'>, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv; charset=utf-8',
  pdf: 'application/pdf',
};

const esNumerica = (c: ColumnaInforme) => c.tipo === 'dinero' || c.tipo === 'entero' || c.tipo === 'numero';
/** «2026-11-05» → fecha a medianoche UTC: Excel la muestra como ese día, sin corrimientos por zona horaria. */
const aFecha = (dia: string) => new Date(`${dia}T00:00:00Z`);

/** Cómo se lee una celda en un texto (PDF y CSV). */
function comoTexto(valor: CeldaInforme, c: ColumnaInforme, csv = false): string {
  if (valor === null || valor === '') return '';
  switch (c.tipo) {
    case 'dinero':
      return csv ? String(valor).replace('.', ',') : formatMoney(valor);
    case 'entero':
      return csv ? String(valor) : formatNumber(valor);
    case 'numero':
      return csv ? String(valor).replace('.', ',') : new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(Number(valor));
    case 'fecha':
      return formatDate(String(valor));
    case 'fechahora':
      return formatDateTime(String(valor));
    default:
      return String(valor);
  }
}

function pie(informe: TablaExportable, m: Membrete): string {
  return `Generado el ${formatDateTime(informe.generadoEl)}${m.usuario ? ` por ${m.usuario}` : ''} · ${APP_NOMBRE}`;
}

/* ───────────────────────── CSV ───────────────────────── */

function celdaCsv(texto: string, esTexto: boolean): string {
  // Una celda de texto que empieza con =, +, - o @ se ejecutaría como fórmula al abrir el archivo.
  const seguro = esTexto && /^[=+\-@\t\r]/.test(texto) ? `'${texto}` : texto;
  return /[";\r\n]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro;
}

/** Marca de orden de bytes: con ella Excel lee bien los acentos. */
const MARCA_UTF8 = String.fromCharCode(0xfeff);
/** Retorno de carro + salto de línea, como espera Excel en Windows. */
const FIN_DE_LINEA = String.fromCharCode(13, 10);

function aCsv(informe: TablaExportable): Buffer {
  const linea = (celdas: CeldaInforme[]) => celdas.map((v, i) => celdaCsv(comoTexto(v, informe.columnas[i]!, true), informe.columnas[i]!.tipo === 'texto')).join(';');
  const lineas = [informe.columnas.map((c) => celdaCsv(c.titulo, true)).join(';'), ...informe.filas.map(linea)];
  if (informe.totales) lineas.push(informe.totales.map((v, i) => (i === 0 && typeof v === 'string' ? v : celdaCsv(comoTexto(v, informe.columnas[i]!, true), false))).join(';'));
  return Buffer.from(MARCA_UTF8 + lineas.map((l) => l + FIN_DE_LINEA).join(''), 'utf8');
}

/* ───────────────────────── Excel ───────────────────────── */

const FORMATO_EXCEL: Partial<Record<ColumnaInforme['tipo'], string>> = {
  dinero: '"$" #,##0.00;[Red]-"$" #,##0.00',
  entero: '#,##0',
  numero: '#,##0.##',
  fecha: 'dd/mm/yyyy',
};

function celdaExcel(valor: CeldaInforme, c: ColumnaInforme): string | number | Date | null {
  if (valor === null || valor === '') return null;
  if (esNumerica(c)) return Number(valor);
  if (c.tipo === 'fecha') return aFecha(String(valor));
  if (c.tipo === 'fechahora') return formatDateTime(String(valor));
  // Igual que en el CSV: un texto no puede terminar siendo una fórmula.
  const texto = String(valor);
  return /^[=+\-@]/.test(texto) ? `'${texto}` : texto;
}

async function aExcel(informe: TablaExportable, m: Membrete): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();
  libro.creator = APP_NOMBRE;
  libro.created = new Date(informe.generadoEl);
  const hoja = libro.addWorksheet(informe.titulo.slice(0, 31), { views: [{ state: 'frozen', ySplit: 5 }] });
  const n = informe.columnas.length;

  hoja.addRow([m.cooperativa]).font = { bold: true, size: 12 };
  hoja.addRow([informe.titulo]).font = { bold: true, size: 14 };
  hoja.addRow([informe.subtitulo]);
  hoja.addRow([pie(informe, m)]).font = { color: { argb: 'FF6B7280' }, size: 9 };
  for (let fila = 1; fila <= 4; fila++) hoja.mergeCells(fila, 1, fila, n);

  const cabecera = hoja.addRow(informe.columnas.map((c) => c.titulo));
  cabecera.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  cabecera.alignment = { vertical: 'middle', wrapText: true };
  cabecera.height = 30;
  cabecera.eachCell((celda) => {
    celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D0D0D' } };
  });

  for (const fila of informe.filas) hoja.addRow(fila.map((v, i) => celdaExcel(v, informe.columnas[i]!)));
  if (informe.totales) {
    const total = hoja.addRow(informe.totales.map((v, i) => (i === 0 && typeof v === 'string' ? v : celdaExcel(v, informe.columnas[i]!))));
    total.font = { bold: true };
    total.eachCell((celda) => {
      celda.border = { top: { style: 'thin' } };
    });
  }
  informe.columnas.forEach((c, i) => {
    const columna = hoja.getColumn(i + 1);
    columna.width = Math.max(8, Math.round(c.ancho * 1.25));
    if (FORMATO_EXCEL[c.tipo]) columna.numFmt = FORMATO_EXCEL[c.tipo]!;
    if (esNumerica(c)) columna.alignment = { horizontal: 'right' };
  });
  // Las cuatro filas del encabezado son texto: sin formato de número ni alineación a la derecha.
  for (let fila = 1; fila <= 4; fila++) hoja.getCell(fila, 1).alignment = { horizontal: 'left' };
  if (informe.filas.length) hoja.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5 + informe.filas.length, column: n } };
  if (informe.nota) {
    hoja.addRow([]);
    const nota = hoja.addRow([informe.nota]);
    nota.font = { italic: true, color: { argb: 'FF6B7280' }, size: 9 };
    nota.getCell(1).alignment = { horizontal: 'left' };
  }
  return Buffer.from(await libro.xlsx.writeBuffer());
}

/* ───────────────────────── PDF ───────────────────────── */

const TINTA = '#111827';
const SUAVE = '#6b7280';
const LINEA = '#d1d5db';
const FONDO = '#f3f4f6';
const MARGEN = 28;
const ALTO_FILA = 13;
const LETRA = 7;

function aPdf(informe: TablaExportable, m: Membrete): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: MARGEN, bufferPages: true, info: { Title: `${informe.titulo} — ${m.cooperativa}`, Author: APP_NOMBRE } });
  const partes: Buffer[] = [];
  const listo = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (p: Buffer) => partes.push(p));
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.on('error', reject);
  });

  const ancho = doc.page.width - MARGEN * 2;
  const fondo = doc.page.height - MARGEN - 16;
  const pesos = informe.columnas.reduce((t, c) => t + c.ancho, 0);
  const anchos = informe.columnas.map((c) => (c.ancho / pesos) * ancho);
  const xs = anchos.map((_, i) => MARGEN + anchos.slice(0, i).reduce((t, a) => t + a, 0));

  /** Texto en una sola línea: si no entra en la columna, se corta con puntos suspensivos. */
  const escribir = (texto: string, i: number, y: number, negrita = false, color = TINTA) => {
    if (!texto) return;
    const lugar = anchos[i]! - 6;
    doc.font(negrita ? 'Helvetica-Bold' : 'Helvetica').fontSize(LETRA).fillColor(color);
    let t = texto;
    let largo = doc.widthOfString(t);
    if (largo > lugar) {
      t = t.slice(0, Math.max(1, Math.floor((t.length * lugar) / largo)));
      while (t.length > 1 && doc.widthOfString(`${t}…`) > lugar) t = t.slice(0, -1);
      t = `${t.trimEnd()}…`;
      largo = doc.widthOfString(t);
    }
    // Se ubica a mano y sin ancho: con ancho, PDFKit parte el texto en dos renglones y pisa la fila de abajo.
    const x = esNumerica(informe.columnas[i]!) ? xs[i]! + anchos[i]! - 3 - largo : xs[i]! + 3;
    doc.text(t, x, y + 3.5, { lineBreak: false });
  };

  let y = MARGEN;
  const encabezado = (primera: boolean) => {
    y = MARGEN;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(SUAVE).text(m.cooperativa, MARGEN, y, { width: ancho, lineBreak: false });
    y += 13;
    doc.font('Helvetica-Bold').fontSize(primera ? 15 : 11).fillColor(TINTA).text(informe.titulo, MARGEN, y, { width: ancho, lineBreak: false });
    y += primera ? 19 : 14;
    doc.font('Helvetica').fontSize(8.5).fillColor(SUAVE).text(informe.subtitulo, MARGEN, y, { width: ancho, lineBreak: false });
    y += 15;
    // Cabecera de la tabla: en cada hoja. Los títulos largos van en dos renglones.
    const alto = 22;
    doc.rect(MARGEN, y, ancho, alto).fill(FONDO);
    informe.columnas.forEach((c, i) => {
      doc.font('Helvetica-Bold').fontSize(LETRA).fillColor(TINTA);
      doc.text(c.titulo, xs[i]! + 3, y + 4, { width: anchos[i]! - 6, height: alto - 5, align: esNumerica(c) ? 'right' : 'left', lineGap: -0.5, ellipsis: true });
    });
    y += alto;
  };

  encabezado(true);
  const fila = (celdas: CeldaInforme[], negrita = false) => {
    if (y + ALTO_FILA > fondo) {
      doc.addPage();
      encabezado(false);
    }
    celdas.forEach((v, i) => escribir(i === 0 && negrita && typeof v === 'string' ? v : comoTexto(v, informe.columnas[i]!), i, y, negrita));
    y += ALTO_FILA;
    doc.moveTo(MARGEN, y).lineTo(MARGEN + ancho, y).lineWidth(0.4).strokeColor(LINEA).stroke();
  };
  if (informe.filas.length === 0) {
    doc.font('Helvetica').fontSize(10).fillColor(SUAVE).text('No hay nada para mostrar con estos filtros.', MARGEN, y + 14, { width: ancho });
    y += 40;
  }
  for (const f of informe.filas) fila(f);
  if (informe.totales) {
    doc.moveTo(MARGEN, y).lineTo(MARGEN + ancho, y).lineWidth(1).strokeColor(TINTA).stroke();
    fila(informe.totales, true);
  }
  if (informe.nota) {
    if (y + 30 > fondo) {
      doc.addPage();
      encabezado(false);
    }
    doc.font('Helvetica-Oblique').fontSize(7.5).fillColor(SUAVE).text(informe.nota, MARGEN, y + 8, { width: ancho });
  }

  // Pie con el número de hoja: se escribe al final, cuando ya se sabe cuántas son.
  const hojas = doc.bufferedPageRange();
  for (let i = 0; i < hojas.count; i++) {
    doc.switchToPage(hojas.start + i);
    // El pie va dentro del margen de abajo: sin anularlo, PDFKit lo mandaría a una hoja nueva.
    doc.page.margins.bottom = 0;
    const base = doc.page.height - MARGEN - 8;
    const hoja = `Hoja ${i + 1} de ${hojas.count}`;
    doc.font('Helvetica').fontSize(7).fillColor(SUAVE);
    doc.text(pie(informe, m), MARGEN, base, { lineBreak: false });
    doc.text(hoja, MARGEN + ancho - doc.widthOfString(hoja), base, { lineBreak: false });
  }
  doc.end();
  return listo;
}

/* ───────────────────────── Entrada ───────────────────────── */

/** «Deuda por socio» + «Octubre de 2026» → `deuda-por-socio-octubre-de-2026`. Solo letras sin acento, números y guiones. */
function nombreDeArchivo(informe: TablaExportable, dia: string): string {
  const base = `${informe.titulo}${informe.periodo ? ` ${informe.subtitulo.split(' · ')[0]}` : ` ${dia}`}`;
  return base
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export async function exportarInforme(informe: TablaExportable, formato: Exclude<FormatoInforme, 'json'>, m: Membrete, dia: string): Promise<Archivo> {
  const contenido = formato === 'xlsx' ? await aExcel(informe, m) : formato === 'csv' ? aCsv(informe) : await aPdf(informe, m);
  return { contenido, nombre: `${nombreDeArchivo(informe, dia)}.${formato}`, mime: MIME[formato] };
}
