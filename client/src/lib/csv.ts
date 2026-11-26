// Exporta a CSV lo que ya está en pantalla (los datos de un gráfico del tablero), sin ir a la API.
// Mismo formato que los informes: punto y coma, coma decimal y la marca que hace que Excel lea los acentos.
import { guardarArchivo } from './api';

type Celda = string | number | null | undefined;

const MARCA_UTF8 = String.fromCharCode(0xfeff);
const FIN_DE_LINEA = String.fromCharCode(13, 10);

function celda(v: Celda): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v).replace('.', ',');
  // Un texto que empieza con =, +, - o @ se ejecutaría como fórmula al abrir el archivo.
  const seguro = /^[=+\-@]/.test(v) ? `'${v}` : v;
  return /[";\r\n]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro;
}

/** Los importes van como número (`1234.5`), no como texto con formato: así Excel los suma. */
export function descargarCsv(nombre: string, encabezados: string[], filas: Celda[][]): void {
  const lineas = [encabezados, ...filas].map((f) => f.map(celda).join(';') + FIN_DE_LINEA);
  guardarArchivo(new Blob([MARCA_UTF8 + lineas.join('')], { type: 'text/csv;charset=utf-8' }), `${nombre}.csv`);
}
