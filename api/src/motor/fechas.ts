// Cuentas con días de calendario ("2026-08-14"), sin horas ni husos: el motor nunca mira el reloj.
import { ErrorDeCalculo } from './errores';

const FORMA = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_POR_DIA = 86_400_000;

/** Días desde 1970 para una fecha de calendario. Falla si la fecha no existe. */
export function numeroDeDia(fecha: string): number {
  const m = FORMA.exec(fecha);
  const ms = m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN;
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== fecha) {
    throw new ErrorDeCalculo('dato_invalido', `La fecha «${fecha}» no es válida`);
  }
  return ms / MS_POR_DIA;
}

/** Cantidad de días entre dos fechas, contando las dos puntas (del 1 al 31 = 31). */
export function diasEntre(desde: string, hasta: string): number {
  return numeroDeDia(hasta) - numeroDeDia(desde) + 1;
}

export function sumarDias(fecha: string, dias: number): string {
  return new Date((numeroDeDia(fecha) + dias) * MS_POR_DIA).toISOString().slice(0, 10);
}

/** `2026-08-14` → `14/08/2026` */
export function fechaCorta(fecha: string): string {
  return `${fecha.slice(8, 10)}/${fecha.slice(5, 7)}/${fecha.slice(0, 4)}`;
}

/** Primer y último día de un mes. */
export function mesCompleto(anio: number, mes: number): { desde: string; hasta: string } {
  const desde = `${anio}-${String(mes).padStart(2, '0')}-01`;
  const hasta = new Date(Date.UTC(anio, mes, 0)).toISOString().slice(0, 10);
  return { desde, hasta };
}

/** Los días en que dos rangos coinciden, o `null` si no se tocan. `hasta` nulo = sin fin. */
export function interseccion(
  a: { desde: string; hasta: string | null },
  b: { desde: string; hasta: string | null },
): { desde: string; hasta: string } | null {
  const desde = a.desde > b.desde ? a.desde : b.desde;
  const hasta = a.hasta === null ? b.hasta : b.hasta === null || a.hasta < b.hasta ? a.hasta : b.hasta;
  if (hasta === null) throw new ErrorDeCalculo('dato_invalido', 'Falta la fecha de cierre del período');
  // Valida las dos fechas de paso.
  return numeroDeDia(desde) <= numeroDeDia(hasta) ? { desde, hasta } : null;
}
