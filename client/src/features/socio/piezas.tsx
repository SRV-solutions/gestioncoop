// Piezas que comparten las pantallas del portal del socio.
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { formatDate, nombreDeMes, type FacturaSocio, type RedireccionPago } from '@shared';
import { SERVICIO_CORTO, SERVICIO_ICON } from '../../components/servicios';
import { Badge } from '../../components/ui';

/** Segundo nivel (SPEC 5: como mucho dos): un título y la flecha para volver. */
export function SubPagina({ titulo, volver, children, accion }: { titulo: string; volver: { to: string; texto: string }; children: ReactNode; accion?: ReactNode }) {
  return (
    <>
      <Link to={volver.to} className="-ml-2 mb-2 inline-flex min-h-11 items-center gap-1 rounded-lg px-2 font-semibold text-marca-texto hover:bg-marca-tenue">
        <ChevronLeft className="size-5" aria-hidden />
        {volver.texto}
      </Link>
      <div className="mb-4 flex items-start justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{titulo}</h1>
        {accion}
      </div>
      {children}
    </>
  );
}

export function Titulo({ children }: { children: ReactNode }) {
  return <h1 className="mb-4 text-2xl font-bold tracking-tight">{children}</h1>;
}

/** Cómo está una factura, en palabras del socio. */
export function EstadoFactura({ f }: { f: Pick<FacturaSocio, 'tipo' | 'estado' | 'vencida' | 'venceEl' | 'saldo' | 'total'> }) {
  if (f.tipo === 'nota_credito') return <Badge tone="marca">Nota de crédito</Badge>;
  if (f.estado === 'anulado') return <Badge>Anulada</Badge>;
  if (f.estado === 'pagado') return <Badge tone="exito">Pagada</Badge>;
  if (f.vencida) return <Badge tone="peligro">Vencida</Badge>;
  if (f.saldo !== f.total) return <Badge tone="alerta">Pagaste una parte</Badge>;
  return <Badge tone="alerta">{f.venceEl ? `Vence el ${formatDate(f.venceEl)}` : 'Sin pagar'}</Badge>;
}

/** «Energía · octubre de 2026», con su ícono. */
export function NombreFactura({ f, className }: { f: Pick<FacturaSocio, 'servicio' | 'anio' | 'mes'>; className?: string }) {
  const Icon = SERVICIO_ICON[f.servicio];
  return (
    <span className={className}>
      <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-marca-tenue text-marca-texto">
        <Icon className="size-5" aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block break-words font-bold text-tinta">{SERVICIO_CORTO[f.servicio]}</span>
        <span className="block leading-snug text-tinta-suave">{nombreDeMes(f.anio, f.mes)}</span>
      </span>
    </span>
  );
}

/**
 * Manda al socio a la pasarela de pago. La de prueba se abre con un enlace; la real (Macro Click de
 * Pago) recibe un formulario POST con sus campos: se arma y se envía.
 */
export function irAPasarela(r: RedireccionPago): void {
  if (r.metodo === 'GET') {
    const url = new URL(r.url, window.location.origin);
    for (const [k, v] of Object.entries(r.campos)) url.searchParams.set(k, v);
    window.location.assign(url.toString());
    return;
  }
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = r.url;
  for (const [k, v] of Object.entries(r.campos)) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = k;
    input.value = v;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}
