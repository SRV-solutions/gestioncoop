// Consumo del socio (SPEC 6.7): 12 meses por servicio, contra el mes anterior y contra el promedio
// de su zona. Barras para lo suyo, una línea gris para el promedio de la zona.
import { useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownRight, ArrowUpRight, ChartColumn, Minus } from 'lucide-react';
import { CATEGORIA_ETIQUETA, formatNumber, LOCALE, nombreDeMes, type ConsumoMes, type ConsumoServicio, type ConsumoSocio } from '@shared';
import { api, errorMessage } from '../../lib/api';
import { cn } from '../../lib/cn';
import { SERVICIO_CORTO, SERVICIO_ICON } from '../../components/servicios';
import { Card, Empty, ErrorState, Skeleton } from '../../components/ui';
import { Titulo } from './piezas';

const MES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const numero = (n: number) => formatNumber(n, n < 100 && n % 1 !== 0 ? 1 : 0);
/** «Mayo de 2026» (solo la primera letra en mayúscula). */
const mesLargo = (anio: number, mes: number) => {
  const t = nombreDeMes(anio, mes);
  return t.charAt(0).toUpperCase() + t.slice(1);
};

export function ConsumoPage() {
  const consulta = useQuery({ queryKey: ['socio', 'consumo'], queryFn: () => api.get<ConsumoSocio>('/socio/consumo') });
  const [elegido, setElegido] = useState(0);
  const d = consulta.data;
  const actual = d?.servicios[Math.min(elegido, (d?.servicios.length ?? 1) - 1)];

  return (
    <>
      <Titulo>Consumo</Titulo>
      {consulta.isPending ? (
        <Skeleton className="h-96 rounded-2xl" />
      ) : consulta.isError || !d ? (
        <ErrorState message={errorMessage(consulta.error)} onRetry={() => void consulta.refetch()} />
      ) : !actual ? (
        <Card>
          <Empty icon={ChartColumn} title="Todavía no hay consumos">
            Cuando se lea tu medidor, vas a ver acá cuánto consumís mes a mes.
          </Empty>
        </Card>
      ) : (
        <>
          {d.servicios.length > 1 && (
            <div role="tablist" aria-label="Servicio" className="mb-4 flex gap-2 overflow-x-auto">
              {d.servicios.map((s, i) => {
                const Icon = SERVICIO_ICON[s.servicio];
                const varias = d.servicios.filter((x) => x.servicio === s.servicio).length > 1;
                return (
                  <button
                    key={`${s.servicio}-${s.conexion.numero}`}
                    type="button"
                    role="tab"
                    aria-selected={actual === s}
                    onClick={() => setElegido(i)}
                    className={cn(
                      'inline-flex min-h-12 shrink-0 items-center gap-2 rounded-full border px-4 font-semibold transition-colors duration-150',
                      actual === s ? 'border-marca bg-marca text-white' : 'border-linea bg-superficie text-tinta hover:border-marca',
                    )}
                  >
                    <Icon className="size-5" aria-hidden />
                    {SERVICIO_CORTO[s.servicio]}
                    {varias && <span className="text-sm opacity-80">· {s.conexion.direccion}</span>}
                  </button>
                );
              })}
            </div>
          )}
          <Servicio key={`${actual.servicio}-${actual.conexion.numero}`} s={actual} />
        </>
      )}
    </>
  );
}

function Servicio({ s }: { s: ConsumoServicio }) {
  const conDato = s.meses.filter((m) => m.consumo !== null);
  const ultimo = conDato.at(-1);
  const anterior = conDato.at(-2);
  const variacion = ultimo && anterior && anterior.consumo! > 0 ? Math.round(((ultimo.consumo! - anterior.consumo!) / anterior.consumo!) * 100) : null;
  const zona = ultimo?.promedioZona ?? null;
  const contraZona = ultimo && zona ? Math.round(((ultimo.consumo! - zona) / zona) * 100) : null;
  const Flecha = variacion === null || Math.abs(variacion) < 3 ? Minus : variacion > 0 ? ArrowUpRight : ArrowDownRight;

  return (
    <div className="space-y-4">
      {ultimo && (
        <Card className="px-5 py-5">
          <p className="font-semibold text-tinta-suave">En {nombreDeMes(ultimo.anio, ultimo.mes)} consumiste</p>
          <p className="mt-1 text-5xl font-black tracking-tight text-tinta">
            {numero(ultimo.consumo!)} <span className="text-2xl font-bold">{s.unidad}</span>
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {variacion !== null && anterior && (
              <p className="flex items-center gap-2 rounded-xl bg-fondo px-3 py-2.5 text-tinta">
                <Flecha className="size-5 shrink-0 text-tinta-suave" aria-hidden />
                <span>
                  {Math.abs(variacion) < 3 ? 'Casi igual que' : `${Math.abs(variacion)} % ${variacion > 0 ? 'más' : 'menos'} que`} en {MES_CORTO[anterior.mes - 1]} ({numero(anterior.consumo!)} {s.unidad})
                </span>
              </p>
            )}
            {contraZona !== null && zona !== null && (
              <p className="flex items-center gap-2 rounded-xl bg-fondo px-3 py-2.5 text-tinta">
                <span aria-hidden className="h-0.5 w-5 shrink-0 rounded-full bg-(--grafico-referencia)" />
                <span>
                  {Math.abs(contraZona) < 5 ? 'Parecido al' : `${Math.abs(contraZona)} % ${contraZona > 0 ? 'más' : 'menos'} que el`} promedio de {s.zona ?? 'tu zona'} ({numero(zona)} {s.unidad})
                </span>
              </p>
            )}
          </div>
        </Card>
      )}

      <Card className="px-4 pb-4 pt-5">
        <h2 className="px-1 font-bold text-tinta">Tus últimos 12 meses</h2>
        <p className="px-1 text-sm text-tinta-suave">
          {s.conexion.direccion}
          {s.categoria && ` · ${CATEGORIA_ETIQUETA[s.categoria]}`}
        </p>
        <Grafico s={s} />
        {/* Leyenda: dos series, siempre a la vista. */}
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 px-1 text-sm text-tinta-suave">
          <span className="inline-flex items-center gap-2">
            <span aria-hidden className="size-3 rounded-sm bg-marca" />
            Tu consumo
          </span>
          <span className="inline-flex items-center gap-2">
            <span aria-hidden className="h-0.5 w-5 rounded-full bg-(--grafico-referencia)" />
            Promedio de {s.zona ?? 'tu zona'}
          </span>
        </div>
        <details className="mt-3 px-1">
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-marca-texto">Ver como tabla</summary>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-tinta-suave">
                <th className="py-1 font-semibold">Mes</th>
                <th className="py-1 text-right font-semibold">Tu consumo</th>
                <th className="py-1 text-right font-semibold">Promedio de la zona</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {[...s.meses].reverse().map((m) => (
                <tr key={`${m.anio}-${m.mes}`} className="border-t border-linea">
                  <td className="py-1.5">{mesLargo(m.anio, m.mes)}</td>
                  <td className="py-1.5 text-right">{m.consumo === null ? '—' : `${numero(m.consumo)} ${s.unidad}${m.estimada ? ' (estimado)' : ''}`}</td>
                  <td className="py-1.5 text-right">{m.promedioZona === null ? '—' : `${numero(m.promedioZona)} ${s.unidad}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </Card>
    </div>
  );
}

/* ───────────────────────── El gráfico ───────────────────────── */

const ALTO = 200;
const ARRIBA = 22; // lugar para el valor del último mes
const ABAJO = 22; // nombres de los meses
const IZQ = 34; // números del eje

/** Tope «redondo» del eje y sus marcas: 0 / 100 / 200 / 300. */
function escala(max: number): { tope: number; marcas: number[] } {
  if (max <= 0) return { tope: 1, marcas: [0] };
  const paso0 = max / 3;
  const potencia = 10 ** Math.floor(Math.log10(paso0));
  const paso = [1, 2, 2.5, 5, 10].map((m) => m * potencia).find((p) => p >= paso0) ?? potencia * 10;
  const tope = Math.ceil(max / paso) * paso;
  return { tope, marcas: Array.from({ length: Math.round(tope / paso) + 1 }, (_, i) => i * paso) };
}

function Grafico({ s }: { s: ConsumoServicio }) {
  const id = useId();
  const [foco, setFoco] = useState<number | null>(null);
  // Se dibuja al ancho real del contenedor: así la letra de los ejes tiene siempre el mismo tamaño.
  const caja = useRef<HTMLDivElement>(null);
  const [ancho, setAncho] = useState(340);
  useEffect(() => {
    const el = caja.current;
    if (!el) return;
    const medir = () => setAncho(Math.max(240, Math.round(el.clientWidth)));
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const max = Math.max(...s.meses.map((m) => Math.max(m.consumo ?? 0, m.promedioZona ?? 0)));
  const { tope, marcas } = escala(max);
  const banda = (ancho - IZQ) / s.meses.length;
  const barra = Math.min(24, banda * 0.62);
  const y = (v: number) => ARRIBA + (1 - v / tope) * (ALTO - ARRIBA - ABAJO);
  const x = (i: number) => IZQ + i * banda + banda / 2;
  const base = y(0);
  const ultimo = s.meses.reduce<number | null>((u, m, i) => (m.consumo !== null ? i : u), null);
  const puntosZona = s.meses.map((m, i) => (m.promedioZona === null ? null : ([x(i), y(m.promedioZona)] as const)));
  const tramos: string[] = [];
  let tramo = '';
  for (const p of puntosZona) {
    if (p === null) {
      if (tramo) tramos.push(tramo);
      tramo = '';
    } else tramo += `${tramo ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`;
  }
  if (tramo) tramos.push(tramo);
  const enFoco: ConsumoMes | null = foco === null ? null : s.meses[foco]!;
  const tick = new Intl.NumberFormat(LOCALE, { notation: tope >= 10_000 ? 'compact' : 'standard', maximumFractionDigits: 1 });

  return (
    <div ref={caja} className="relative mt-3">
      <svg viewBox={`0 0 ${ancho} ${ALTO}`} width={ancho} height={ALTO} className="block max-w-full" role="img" aria-labelledby={`${id}-t`} onMouseLeave={() => setFoco(null)}>
        <title id={`${id}-t`}>{`Consumo de ${SERVICIO_CORTO[s.servicio].toLowerCase()} de los últimos 12 meses, en ${s.unidad}. El detalle está en la tabla.`}</title>
        {/* Grilla y eje: finos y apagados. */}
        {marcas.map((m) => (
          <g key={m}>
            <line x1={IZQ} x2={ancho} y1={y(m)} y2={y(m)} stroke={m === 0 ? 'var(--grafico-eje)' : 'var(--grafico-grilla)'} strokeWidth={1} />
            <text x={IZQ - 6} y={y(m) + 4} textAnchor="end" fontSize={11} className="fill-tinta-suave tabular-nums">
              {tick.format(m)}
            </text>
          </g>
        ))}
        {/* Barras: hasta 24 px, punta redondeada de 4 px, recta sobre la base. */}
        {s.meses.map((m, i) => {
          if (m.consumo === null) return null;
          const alto = Math.max(base - y(m.consumo), 1);
          const r = Math.min(4, alto, barra / 2);
          const x0 = x(i) - barra / 2;
          const top = base - alto;
          const d = `M${x0},${base}V${top + r}Q${x0},${top} ${x0 + r},${top}H${x0 + barra - r}Q${x0 + barra},${top} ${x0 + barra},${top + r}V${base}Z`;
          return <path key={i} d={d} className={cn(i === ultimo || foco === i ? 'fill-marca' : 'fill-marca-claro', m.estimada && 'opacity-60')} />;
        })}
        {/* Promedio de la zona: línea de 2 px con sus puntos. */}
        {tramos.map((t) => (
          <path key={t} d={t} fill="none" stroke="var(--grafico-referencia)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {puntosZona.map((p, i) => p && <circle key={i} cx={p[0]} cy={p[1]} r={3.5} fill="var(--grafico-referencia)" stroke="var(--superficie)" strokeWidth={2} />)}
        {/* Solo el último mes lleva su número. */}
        {ultimo !== null && foco === null && (
          <text x={x(ultimo)} y={y(s.meses[ultimo]!.consumo!) - 6} textAnchor="end" fontSize={12} fontWeight={700} className="fill-tinta tabular-nums">
            {numero(s.meses[ultimo]!.consumo!)}
          </text>
        )}
        {s.meses.map((m, i) => (
          <text key={i} x={x(i)} y={ALTO - 6} textAnchor="middle" fontSize={11} className={cn(i === ultimo ? 'fill-tinta font-bold' : 'fill-tinta-suave')}>
            {MES_CORTO[m.mes - 1]}
          </text>
        ))}
        {/* Zonas de toque: toda la columna, más grande que la barra. */}
        {s.meses.map((_, i) => (
          <rect
            key={i}
            x={IZQ + i * banda}
            y={0}
            width={banda}
            height={ALTO}
            fill="transparent"
            onMouseEnter={() => setFoco(i)}
            onClick={() => setFoco((f) => (f === i ? null : i))}
          />
        ))}
      </svg>
      {enFoco && foco !== null && (
        <div
          role="status"
          className="pointer-events-none absolute top-0 z-10 w-44 -translate-x-1/2 rounded-xl border border-linea bg-superficie px-3 py-2 text-sm shadow-lg"
          style={{ left: `${Math.min(Math.max((x(foco) / ancho) * 100, 26), 74)}%` }}
        >
          <p className="font-bold text-tinta">{mesLargo(enFoco.anio, enFoco.mes)}</p>
          <p className="flex items-center gap-2 text-tinta">
            <span aria-hidden className="size-2.5 rounded-sm bg-marca" />
            {enFoco.consumo === null ? 'Sin lectura' : `${numero(enFoco.consumo)} ${s.unidad}${enFoco.estimada ? ' (estimado)' : ''}`}
          </p>
          {enFoco.promedioZona !== null && (
            <p className="flex items-center gap-2 text-tinta-suave">
              <span aria-hidden className="h-0.5 w-2.5 rounded-full bg-(--grafico-referencia)" />
              Zona: {numero(enFoco.promedioZona)} {s.unidad}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
