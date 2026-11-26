// Piezas de los gráficos del tablero. Dos formas alcanzan para todo:
// - Columnas (agrupadas o apiladas) para lo que cambia mes a mes.
// - Barras en lista (nombre, barra, número) para comparar partes: zonas, medios de pago, tramos.
// Reglas que siguen todas: barras finas con la punta redondeada y apoyadas en la base, un solo eje,
// el color dice qué serie es (nunca el orden), los textos van en tinta y no en el color de la serie,
// y siempre hay una tabla o el número escrito al lado para no depender del color.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

/* ───────────────────────── Medidas ───────────────────────── */

/** Ancho real del contenedor: el gráfico se dibuja a ese tamaño y la letra de los ejes no se achica. */
function useAncho(inicial = 560) {
  const caja = useRef<HTMLDivElement>(null);
  const [ancho, setAncho] = useState(inicial);
  useEffect(() => {
    const el = caja.current;
    if (!el) return;
    const medir = () => setAncho(Math.max(260, Math.round(el.clientWidth)));
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [caja, ancho] as const;
}

/** Tope «redondo» del eje y sus marcas: 0 / 100 / 200 / 300. */
function escala(max: number): { tope: number; marcas: number[] } {
  if (max <= 0) return { tope: 1, marcas: [0] };
  // Hasta cinco tramos: el tope queda cerca del valor más alto y no sobra medio gráfico vacío.
  const paso0 = max / 5;
  const potencia = 10 ** Math.floor(Math.log10(paso0));
  const paso = [1, 2, 2.5, 5, 10].map((m) => m * potencia).find((p) => p >= paso0) ?? potencia * 10;
  const tope = Math.ceil(max / paso) * paso;
  return { tope, marcas: Array.from({ length: Math.round(tope / paso) + 1 }, (_, i) => i * paso) };
}

/* ───────────────────────── Leyenda ───────────────────────── */

export function Leyenda({ items }: { items: { nombre: string; color: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-tinta-suave">
      {items.map((i) => (
        <li key={i.nombre} className="inline-flex items-center gap-2">
          <span aria-hidden className="size-3 rounded-sm" style={{ background: i.color }} />
          {i.nombre}
        </li>
      ))}
    </ul>
  );
}

/* ───────────────────────── Columnas ───────────────────────── */

export interface Serie {
  nombre: string;
  /** Color de la serie (una variable CSS): sigue a la serie, no a su posición. */
  color: string;
  /** Un valor por columna; `null` = sin dato (no se dibuja). */
  valores: (number | null)[];
}

interface ColumnasProps {
  /** Qué muestra, para quien no ve el gráfico. */
  titulo: string;
  /** Texto bajo cada columna («oct») y su nombre completo para el cartel («Octubre de 2026»). */
  etiquetas: string[];
  nombres: string[];
  series: Serie[];
  /** Una sobre otra (partes de un todo) en lugar de una al lado de la otra. */
  apiladas?: boolean;
  /** Cómo se escribe un valor en el cartel y en las marcas del eje. */
  formato: (v: number) => string;
  eje: (v: number) => string;
  /** Renglones de más en el cartel de una columna. */
  extra?: (i: number) => ReactNode;
  /** Columna que se destaca (la del mes elegido). */
  elegida?: number;
}

const ALTO = 240;
const ARRIBA = 10;
const ABAJO = 26;
const SEPARACION = 2;

/** Rectángulo apoyado en la base, con la punta de arriba redondeada. */
function columna(x: number, base: number, ancho: number, alto: number, redonda: boolean): string {
  const r = redonda ? Math.min(4, alto, ancho / 2) : 0;
  const top = base - alto;
  return `M${x},${base}V${top + r}Q${x},${top} ${x + r},${top}H${x + ancho - r}Q${x + ancho},${top} ${x + ancho},${top + r}V${base}Z`;
}

export function Columnas({ titulo, etiquetas, nombres, series, apiladas = false, formato, eje, extra, elegida }: ColumnasProps) {
  const id = useId();
  const [caja, ancho] = useAncho();
  const [foco, setFoco] = useState<number | null>(null);
  const n = etiquetas.length;
  const total = (i: number) => series.reduce((t, s) => t + Math.max(s.valores[i] ?? 0, 0), 0);
  const max = Math.max(0, ...etiquetas.map((_, i) => (apiladas ? total(i) : Math.max(...series.map((s) => s.valores[i] ?? 0)))));
  const { tope, marcas } = escala(max);
  const izq = Math.max(...marcas.map((m) => eje(m).length)) * 6.4 + 12;
  const banda = (ancho - izq) / n;
  const y = (v: number) => ARRIBA + (1 - v / tope) * (ALTO - ARRIBA - ABAJO);
  const base = y(0);
  const centro = (i: number) => izq + i * banda + banda / 2;
  // Agrupadas: cada serie su barra, con 2 px entre una y otra. Apiladas: una sola barra por columna.
  const barra = apiladas ? Math.min(28, banda * 0.6) : Math.min(24, (banda * 0.72 - SEPARACION * (series.length - 1)) / series.length);
  const grupo = apiladas ? barra : barra * series.length + SEPARACION * (series.length - 1);
  // Si no entran todas las etiquetas, se saltean algunas (siempre queda la última).
  const cada = Math.ceil(34 / banda);

  return (
    <div ref={caja} className="relative">
      <svg viewBox={`0 0 ${ancho} ${ALTO}`} width={ancho} height={ALTO} className="block max-w-full" role="img" aria-labelledby={`${id}-t`} onMouseLeave={() => setFoco(null)}>
        <title id={`${id}-t`}>{`${titulo}. El detalle está en la tabla de abajo.`}</title>
        {marcas.map((m) => (
          <g key={m}>
            <line x1={izq} x2={ancho} y1={y(m)} y2={y(m)} stroke={m === 0 ? 'var(--grafico-eje)' : 'var(--grafico-grilla)'} strokeWidth={1} />
            <text x={izq - 6} y={y(m) + 4} textAnchor="end" fontSize={11} className="fill-tinta-suave tabular-nums">
              {eje(m)}
            </text>
          </g>
        ))}
        {etiquetas.map((_, i) => {
          const x0 = centro(i) - grupo / 2;
          const apagada = foco !== null && foco !== i;
          if (!apiladas) {
            return (
              <g key={i} opacity={apagada ? 0.45 : 1}>
                {series.map((s, k) => {
                  const v = s.valores[i];
                  if (v === null || v === undefined || v <= 0) return null;
                  return <path key={s.nombre} d={columna(x0 + k * (barra + SEPARACION), base, barra, Math.max(base - y(v), 1), true)} fill={s.color} />;
                })}
              </g>
            );
          }
          // Apiladas: de abajo hacia arriba, con una rendija del color del fondo entre un tramo y otro.
          const tramos = series.map((s) => Math.max(s.valores[i] ?? 0, 0));
          const ultimo = tramos.reduce((u, v, k) => (v > 0 ? k : u), -1);
          let acumulado = 0;
          return (
            <g key={i} opacity={apagada ? 0.45 : 1}>
              {series.map((s, k) => {
                const v = tramos[k]!;
                if (v <= 0) return null;
                const desde = y(acumulado);
                acumulado += v;
                const alto = Math.max(desde - y(acumulado) - (k === ultimo ? 0 : SEPARACION), 1);
                return <path key={s.nombre} d={columna(x0, desde, barra, alto, k === ultimo)} fill={s.color} />;
              })}
            </g>
          );
        })}
        {etiquetas.map((e, i) =>
          (n - 1 - i) % cada === 0 ? (
            <text key={i} x={centro(i)} y={ALTO - 8} textAnchor="middle" fontSize={11} className={cn(i === elegida ? 'fill-tinta font-bold' : 'fill-tinta-suave')}>
              {e}
            </text>
          ) : null,
        )}
        {/* Zona de toque: toda la columna, mucho más grande que la barra. */}
        {etiquetas.map((_, i) => (
          <rect key={i} x={izq + i * banda} y={0} width={banda} height={ALTO} fill="transparent" onMouseEnter={() => setFoco(i)} onClick={() => setFoco((f) => (f === i ? null : i))} />
        ))}
      </svg>
      {foco !== null && (
        <div
          role="status"
          // Al costado de la columna (del lado donde hay más lugar), para no taparla.
          className={cn('pointer-events-none absolute top-0 z-10 w-56 rounded-xl border border-linea bg-superficie px-3 py-2 text-sm shadow-lg', foco >= n / 2 && '-translate-x-full')}
          style={{ left: `${foco >= n / 2 ? Math.max(centro(foco) - banda / 2 - 4, 224) : Math.min(centro(foco) + banda / 2 + 4, ancho - 224)}px` }}
        >
          <p className="font-bold text-tinta">{nombres[foco]}</p>
          {series.map((s) => (
            <p key={s.nombre} className="flex items-baseline justify-between gap-3 text-tinta">
              <span className="inline-flex items-center gap-2 text-tinta-suave">
                <span aria-hidden className="size-2.5 shrink-0 rounded-sm" style={{ background: s.color }} />
                {s.nombre}
              </span>
              <span className="tabular-nums">{s.valores[foco] === null || s.valores[foco] === undefined ? 'Sin dato' : formato(s.valores[foco]!)}</span>
            </p>
          ))}
          {extra?.(foco)}
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── Barras en lista ───────────────────────── */

export interface FilaBarra {
  clave: string;
  etiqueta: string;
  valor: number;
  /** El número, ya escrito («$ 1.234» o «253 conexiones»). */
  texto: string;
  /** Dato secundario al lado del número («38 %»). */
  nota?: string;
}

/**
 * Una fila por parte: nombre, barra y número. Todas las barras arrancan del mismo borde, así que se
 * comparan a ojo; el número va escrito, así que no hace falta pasar el mouse para leerlo.
 */
export function Barras({ filas, color = 'var(--serie-1)', vacio = 'No hay datos para mostrar.', nombresLargos = false }: { filas: FilaBarra[]; color?: string; vacio?: string; nombresLargos?: boolean }) {
  const max = Math.max(0, ...filas.map((f) => f.valor));
  if (filas.length === 0) return <p className="py-6 text-center text-sm text-tinta-suave">{vacio}</p>;
  return (
    // Una sola grilla para toda la lista: la columna de las barras mide lo mismo en todas las filas
    // (si cada fila fuera su propia grilla, un número más largo le robaría lugar a su barra).
    <ul className={cn('grid grid-cols-[minmax(0,1fr)_auto] gap-x-3', nombresLargos ? 'sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto]' : 'sm:grid-cols-[minmax(0,10.5rem)_minmax(0,1fr)_auto]')}>
      {filas.map((f, i) => (
        <li key={f.clave} className={cn('col-span-full grid grid-cols-subgrid items-center gap-y-1 py-2', i > 0 && 'border-t border-linea/70')}>
          <span className="truncate text-sm font-medium text-tinta" title={f.etiqueta}>
            {f.etiqueta}
          </span>
          <span aria-hidden className="order-3 col-span-2 block h-2.5 sm:order-none sm:col-span-1">
            {f.valor > 0 && max > 0 && <span className="block h-full rounded-r-[4px]" style={{ width: `max(2px, ${(f.valor / max) * 100}%)`, background: color }} />}
          </span>
          <span className="whitespace-nowrap text-right text-sm tabular-nums text-tinta">
            {f.texto}
            {f.nota && <span className="text-tinta-suave"> · {f.nota}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Cuánto va de un total: la pista es un tono claro del mismo color, la parte hecha va llena. */
export function Medidor({ valor, total, color = 'var(--serie-1)', className }: { valor: number; total: number; color?: string; className?: string }) {
  const parte = total > 0 ? Math.min(Math.max(valor / total, 0), 1) : 0;
  return (
    <span aria-hidden className={cn('block h-2.5 overflow-hidden rounded-full', className)} style={{ background: `color-mix(in srgb, ${color} 20%, transparent)` }}>
      <span className="block h-full rounded-full transition-[width] duration-300" style={{ width: `${parte * 100}%`, background: color }} />
    </span>
  );
}
