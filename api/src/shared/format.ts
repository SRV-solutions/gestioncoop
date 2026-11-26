// Formato es-AR para mostrar. Los cálculos de dinero NO se hacen con estos números (ver motor de cálculo).
import { LOCALE, TIMEZONE } from './constants';

const NBSP = /[\u00a0\u202f]/g;

const moneyFmt = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: 'ARS', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const moneyFmtNoCents = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
const dateFmt = new Intl.DateTimeFormat(LOCALE, { timeZone: TIMEZONE, day: '2-digit', month: '2-digit', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIMEZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

type Numeric = number | string;
const toNumber = (v: Numeric) => (typeof v === 'number' ? v : Number(v));

/** `161724.49` → `$ 161.724,49` */
export function formatMoney(value: Numeric, opts: { cents?: boolean } = {}): string {
  return (opts.cents === false ? moneyFmtNoCents : moneyFmt).format(toNumber(value)).replace(NBSP, ' ');
}

/** Precio por unidad: 2 decimales como mínimo y hasta 4 (o los que se pidan), como en la factura. `104.534` → `$ 104,534` */
export function formatPrecio(value: Numeric, maxDecimals = 4): string {
  return new Intl.NumberFormat(LOCALE, { style: 'currency', currency: 'ARS', minimumFractionDigits: 2, maximumFractionDigits: maxDecimals })
    .format(toNumber(value))
    .replace(NBSP, ' ');
}

/** Cantidad consumida: hasta 4 decimales, sin ceros de relleno. `54.8387` → `54,8387`; `1176` → `1.176` */
export function formatCantidad(value: Numeric): string {
  return new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 4 }).format(toNumber(value));
}

/** `3.31` → `3,31 %` */
export function formatPorcentaje(value: Numeric): string {
  return `${new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 4 }).format(toNumber(value))} %`;
}

/** `1234.5` → `1.234,5` */
export function formatNumber(value: Numeric, decimals = 0): string {
  return new Intl.NumberFormat(LOCALE, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(toNumber(value));
}

function toDate(value: Date | string): Date {
  if (value instanceof Date) return value;
  // Una fecha sin hora ("2026-11-05") es un día del calendario argentino, no la medianoche UTC.
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00-03:00`) : new Date(value);
}

/** `dd/mm/aaaa` en hora de Argentina. */
export function formatDate(value: Date | string): string {
  return dateFmt.format(toDate(value));
}

/** `dd/mm/aaaa hh:mm` en hora de Argentina. */
export function formatDateTime(value: Date | string): string {
  return dateTimeFmt.format(toDate(value)).replace(',', '');
}

/** `(11, 2026)` → `11/2026` */
export function formatPeriodo(mes: number, anio: number): string {
  return `${String(mes).padStart(2, '0')}/${anio}`;
}

/** `('B', 6, 2043619)` → `B 0006-02043619` */
export function formatComprobante(letra: string, puntoVenta: number, numero: number): string {
  return `${letra} ${String(puntoVenta).padStart(4, '0')}-${String(numero).padStart(8, '0')}`;
}

/** `30610990890` → `30-61099089-0` */
export function formatCuit(cuit: string): string {
  const d = cuit.replace(/\D/g, '');
  return d.length === 11 ? `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}` : cuit;
}

/** `20123456` → `20.123.456` */
export function formatDni(dni: Numeric): string {
  return formatNumber(String(dni).replace(/\D/g, ''));
}

/** Iniciales para avatares: "Ana María Pérez" → "AP" */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}
