// Una factura calculada, renglón por renglón, con la misma estructura que la factura impresa:
// básico → subtotal → gravámenes → total del servicio → adicionales → recargos → total.
import { Info } from 'lucide-react';
import {
  formatCantidad,
  formatMoney,
  formatPeriodo,
  formatPorcentaje,
  formatPrecio,
  SERVICIO_ETIQUETA,
  type FacturaCalculada,
  type GrupoRenglon,
  type Renglon,
} from '@shared';
import { cn } from '../../lib/cn';
import { Badge } from '../../components/ui';

/** De dónde sale el importe: «30 × $ 104,534» o «21 % de $ 288.345,84». */
function cuenta(r: Renglon): string | null {
  if (r.codigo === 'MORA') return r.nota ?? null;
  if (r.porcentaje !== null && r.base !== null) return `${formatPorcentaje(r.porcentaje)} de ${formatMoney(r.base)}`;
  if (r.cantidad !== null && r.unitario !== null && r.cantidad !== '1') return `${formatCantidad(r.cantidad)} × ${formatPrecio(r.unitario, 6)}`;
  return null;
}

function Fila({ r }: { r: Renglon }) {
  const detalle = cuenta(r);
  const nota = r.codigo === 'MORA' ? null : r.nota;
  return (
    <li className="flex items-start justify-between gap-4 py-2">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-tinta">
          {r.descripcion}
          {r.subsidiado && <Badge tone="exito">Con subsidio</Badge>}
        </p>
        {detalle && <p className="text-sm tabular-nums text-tinta-suave">{detalle}</p>}
        {nota && <p className="text-sm text-tinta-suave">{nota}</p>}
      </div>
      <p className="shrink-0 font-semibold tabular-nums text-tinta">{formatMoney(r.importe)}</p>
    </li>
  );
}

function Seccion({ titulo, renglones }: { titulo?: string; renglones: Renglon[] }) {
  if (!renglones.length) return null;
  return (
    <section className="px-5 py-3">
      {titulo && <h4 className="pb-1 text-xs font-semibold uppercase tracking-wide text-tinta-suave">{titulo}</h4>}
      <ul className="divide-y divide-linea/70">
        {renglones.map((r, i) => (
          <Fila key={`${r.codigo}-${i}`} r={r} />
        ))}
      </ul>
    </section>
  );
}

function Total({ etiqueta, importe, fuerte }: { etiqueta: string; importe: string; fuerte?: boolean }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-4 border-t border-linea px-5 py-2.5', fuerte ? 'bg-marca-tenue/60 font-bold' : 'bg-fondo/70 font-semibold')}>
      <span className="text-tinta">{etiqueta}</span>
      <span className="tabular-nums text-tinta">{formatMoney(importe)}</span>
    </div>
  );
}

/** Lo que hace falta para dibujarla: sirve una factura recién calculada o la que guarda un comprobante. */
type Dibujable = Pick<FacturaCalculada, 'servicio' | 'periodo' | 'consumo' | 'avisos' | 'renglones' | 'totales'>;

export function FacturaVista({ factura: f, className }: { factura: Dibujable; className?: string }) {
  const de = (...grupos: GrupoRenglon[]) => f.renglones.filter((r) => grupos.includes(r.grupo));
  const servicio = SERVICIO_ETIQUETA[f.servicio];
  const hayGravamenes = de('gravamen').length > 0;
  const hayExtras = de('adicional', 'recargo').length > 0;

  return (
    <div className={cn('overflow-hidden rounded-2xl border border-linea bg-superficie', className)}>
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-linea px-5 py-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-tinta-suave">Período {formatPeriodo(f.periodo.mes, f.periodo.anio)}</p>
          <h3 className="text-lg font-bold text-tinta">{servicio}</h3>
        </div>
        {f.consumo && (
          <p className="text-right">
            <span className="text-2xl font-bold tabular-nums text-tinta">{formatCantidad(f.consumo.facturado)}</span>{' '}
            <span className="font-semibold text-tinta-suave">{f.consumo.unidad}</span>
          </p>
        )}
      </header>

      {f.avisos.length > 0 && (
        <ul className="space-y-1.5 border-b border-linea bg-acento-tenue/50 px-5 py-3">
          {f.avisos.map((a) => (
            <li key={a.codigo} className="flex items-start gap-2 text-sm text-tinta">
              <Info className="mt-0.5 size-4 shrink-0 text-alerta" aria-hidden />
              {a.mensaje}
            </li>
          ))}
        </ul>
      )}

      <Seccion renglones={de('basico', 'cargo')} />
      {(hayGravamenes || hayExtras) && <Total etiqueta={`Subtotal ${servicio.toLowerCase()}`} importe={f.totales.subtotal} />}
      <Seccion titulo="Gravámenes" renglones={de('gravamen')} />
      {hayExtras && <Total etiqueta={`Total ${servicio.toLowerCase()}`} importe={f.totales.servicio} />}
      <Seccion titulo="Adicionales" renglones={de('adicional')} />
      <Seccion titulo="Recargos por mora" renglones={de('recargo')} />

      <div className="flex items-baseline justify-between gap-4 border-t-2 border-marca bg-marca-tenue px-5 py-4">
        <span className="text-lg font-bold text-marca-texto">Total a pagar</span>
        <span className="text-2xl font-bold tabular-nums text-marca-texto">{formatMoney(f.totales.total)}</span>
      </div>
    </div>
  );
}
