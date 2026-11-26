// Facturas del socio: la lista y cada factura con «¿Por qué pago esto?» (SPEC 5 y 6.7): el cálculo
// en partes, con una barra que muestra en qué se va la plata y frases cortas en lenguaje simple.
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, FileDown, Lightbulb, Receipt } from 'lucide-react';
import {
  formatCantidad,
  formatDate,
  formatMoney,
  formatNumber,
  MEDIO_PAGO_ETIQUETA,
  nombreDeMes,
  SERVICIO_ETIQUETA,
  type FacturaSocioDetalle,
  type PaginaFacturasSocio,
  type ParteFactura,
  type PorQuePago,
} from '@shared';
import { abrirPdf, api, errorMessage } from '../../lib/api';
import { cn } from '../../lib/cn';
import { Badge, Button, Card, Empty, ErrorState, Skeleton } from '../../components/ui';
import { FacturaVista } from '../tarifas/FacturaVista';
import { EstadoFactura, NombreFactura, SubPagina, Titulo } from './piezas';

/* ───────────────────────── Lista ───────────────────────── */

export function FacturasPage() {
  const [pagina, setPagina] = useState(1);
  const consulta = useQuery({
    queryKey: ['socio', 'facturas', pagina],
    queryFn: () => api.get<PaginaFacturasSocio>(`/socio/facturas?pagina=${pagina}`),
    placeholderData: keepPreviousData,
  });
  const d = consulta.data;
  const paginas = d ? Math.max(1, Math.ceil(d.total / d.porPagina)) : 1;

  return (
    <>
      <Titulo>Facturas</Titulo>
      {consulta.isPending ? (
        <Skeleton className="h-96 rounded-2xl" />
      ) : consulta.isError || !d ? (
        <ErrorState message={errorMessage(consulta.error)} onRetry={() => void consulta.refetch()} />
      ) : d.filas.length === 0 ? (
        <Card>
          <Empty icon={Receipt} title="Todavía no tenés facturas">
            Cuando la cooperativa emita tu primera factura, la vas a ver acá.
          </Empty>
        </Card>
      ) : (
        <>
          <Card className={cn('overflow-hidden transition-opacity duration-150', consulta.isPlaceholderData && 'opacity-60')}>
            <ul className="divide-y divide-linea">
              {d.filas.map((f) => (
                <li key={f.id}>
                  <Link to={`/socio/facturas/${f.id}`} className="flex items-center gap-3 px-4 py-3.5 transition-colors duration-100 hover:bg-marca-tenue/40">
                    <NombreFactura f={f} className="flex min-w-0 flex-1 items-center gap-3" />
                    <span className="shrink-0 text-right">
                      <span className={cn('block text-lg font-bold tabular-nums', f.estado === 'anulado' ? 'text-tinta-suave line-through' : 'text-tinta')}>{formatMoney(f.total)}</span>
                      <EstadoFactura f={f} />
                    </span>
                    <ChevronRight className="size-5 shrink-0 text-tinta-suave" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
          {paginas > 1 && (
            <nav aria-label="Páginas" className="mt-3 flex items-center justify-between gap-2">
              <Button variant="secondary" disabled={pagina === 1} onClick={() => setPagina((p) => p - 1)}>
                Más nuevas
              </Button>
              <span className="text-sm text-tinta-suave">
                {pagina} de {paginas}
              </span>
              <Button variant="secondary" disabled={pagina >= paginas} onClick={() => setPagina((p) => p + 1)}>
                Más viejas
              </Button>
            </nav>
          )}
        </>
      )}
    </>
  );
}

/* ───────────────────────── Una factura ───────────────────────── */

export function FacturaPage() {
  const { id } = useParams();
  const consulta = useQuery({ queryKey: ['socio', 'factura', id], queryFn: () => api.get<FacturaSocioDetalle>(`/socio/facturas/${id}`) });
  const pdf = useMutation({ mutationFn: () => abrirPdf(`/socio/facturas/${id}/pdf`) });
  const [detalle, setDetalle] = useState(false);
  const f = consulta.data;

  return (
    <SubPagina titulo={f ? `${SERVICIO_ETIQUETA[f.servicio]}` : 'Factura'} volver={{ to: '/socio/facturas', texto: 'Facturas' }}>
      {consulta.isPending ? (
        <div className="space-y-4">
          <Skeleton className="h-44 rounded-2xl" />
          <Skeleton className="h-72 rounded-2xl" />
        </div>
      ) : consulta.isError || !f ? (
        <ErrorState message={errorMessage(consulta.error)} onRetry={() => void consulta.refetch()} />
      ) : (
        <div className="space-y-4">
          <Card className="px-5 py-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold text-tinta-suave">{nombreDeMes(f.anio, f.mes)}</p>
              <EstadoFactura f={f} />
            </div>
            <p className={cn('mt-1 text-4xl font-black tracking-tight', f.estado === 'anulado' ? 'text-tinta-suave line-through' : 'text-tinta')}>{formatMoney(f.total)}</p>
            {f.estado === 'emitido' && f.saldo !== f.total && <p className="font-semibold text-tinta">Te falta pagar {formatMoney(f.saldo)}</p>}
            <p className="mt-1 text-tinta-suave">
              {f.conexion.direccion}
              {f.venceEl && f.estado === 'emitido' && ` · vence el ${formatDate(f.venceEl)}`}
            </p>
            <p className="text-sm text-tinta-suave">{f.referencia}</p>
            {f.relacionado && (
              <p className="mt-2 text-sm text-tinta">
                {f.tipo === 'nota_credito' ? 'Anula la factura' : 'La anuló la nota de crédito'} {f.relacionado.referencia}.
              </p>
            )}
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {f.estado === 'emitido' && f.tipo === 'factura' && (
                <Link
                  to={`/socio/pagar?factura=${f.id}`}
                  className="flex min-h-14 items-center justify-center rounded-2xl bg-marca px-5 text-lg font-bold text-white shadow-sm transition-colors duration-150 hover:bg-marca-fuerte"
                >
                  Pagar {formatMoney(f.saldo)}
                </Link>
              )}
              <Button variant="secondary" size="lg" icon={FileDown} loading={pdf.isPending} onClick={() => pdf.mutate()} className={cn('min-h-14', f.estado !== 'emitido' && 'sm:col-span-2')}>
                Descargar el PDF
              </Button>
            </div>
            {pdf.isError && <p className="mt-2 text-sm font-medium text-peligro">{errorMessage(pdf.error)}</p>}
          </Card>

          {f.porQue && <PorQuePagoCard porQue={f.porQue} total={f.total} consumo={f.calculo?.consumo ? `${formatCantidad(f.calculo.consumo.facturado)} ${f.calculo.consumo.unidad}` : null} />}

          {f.calculo && (
            <Card className="overflow-hidden">
              <button
                type="button"
                aria-expanded={detalle}
                onClick={() => setDetalle((v) => !v)}
                className="flex min-h-14 w-full items-center justify-between gap-3 px-5 text-left font-bold text-tinta hover:bg-marca-tenue/30"
              >
                Ver la factura renglón por renglón
                <ChevronDown className={cn('size-5 text-tinta-suave transition-transform duration-150', detalle && 'rotate-180')} aria-hidden />
              </button>
              {detalle && (
                <div className="border-t border-linea px-5 py-4">
                  <FacturaVista factura={f.calculo} />
                </div>
              )}
            </Card>
          )}

          {f.pagos.length > 0 && (
            <Card className="overflow-hidden">
              <p className="border-b border-linea px-5 py-3 font-bold text-tinta">Pagos</p>
              <ul className="divide-y divide-linea">
                {f.pagos.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <span className="min-w-0">
                      <span className="block font-semibold text-tinta">{formatDate(p.cobradoEl)}</span>
                      <span className="block text-sm text-tinta-suave">
                        {p.online ? 'Online' : 'En la caja'} · {MEDIO_PAGO_ETIQUETA[p.medio]} · {p.referencia}
                      </span>
                    </span>
                    <span className="font-bold tabular-nums text-tinta">{formatMoney(p.importe)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}
    </SubPagina>
  );
}

/* ───────────────────────── ¿Por qué pago esto? ───────────────────────── */

/**
 * Color de cada parte. Fijo por parte, no por posición: la misma parte tiene el mismo color en
 * todas las facturas. Validado (claro y oscuro, también en las combinaciones en que falta alguna
 * parte) para que dos partes vecinas se distingan con cualquier tipo de visión.
 */
const COLOR_PARTE: Record<string, string> = {
  fijo: 'var(--parte-fijo)',
  consumo: 'var(--parte-consumo)',
  excedente: 'var(--parte-excedente)',
  impuestos: 'var(--parte-impuestos)',
  adicionales: 'var(--parte-adicionales)',
  mora: 'var(--parte-mora)',
};
/** Texto dentro de cada bloque: blanco, salvo sobre el amarillo. */
const TINTA_PARTE: Record<string, string> = { adicionales: '#0b0b0b' };

interface Bloque {
  clave: keyof typeof COLOR_PARTE;
  etiqueta: string;
  importe: number;
}

/** Las partes de la barra: el consumo con subsidio, sin medidor o del plan van juntos; los otros cargos, con los impuestos. */
function bloquesDe(partes: ParteFactura[]): Bloque[] {
  const grupo: Record<ParteFactura['clave'], keyof typeof COLOR_PARTE> = {
    fijo: 'fijo',
    subsidiado: 'consumo',
    consumo: 'consumo',
    abono: 'consumo',
    excedente: 'excedente',
    cargos: 'impuestos',
    impuestos: 'impuestos',
    adicionales: 'adicionales',
    mora: 'mora',
  };
  const out: Bloque[] = [];
  for (const p of partes) {
    const clave = grupo[p.clave];
    const importe = Number(p.importe);
    if (importe <= 0) continue;
    const previo = out.find((b) => b.clave === clave);
    if (previo) {
      previo.importe += importe;
      previo.etiqueta = clave === 'impuestos' ? 'Impuestos y otros cargos' : previo.etiqueta;
    } else {
      out.push({ clave, etiqueta: p.clave === 'subsidiado' ? 'Consumo con subsidio' : p.etiqueta, importe });
    }
  }
  return out;
}

function PorQuePagoCard({ porQue, total, consumo }: { porQue: PorQuePago; total: string; consumo: string | null }) {
  const bloques = bloquesDe(porQue.partes);
  const suma = bloques.reduce((t, b) => t + b.importe, 0);
  const s = porQue.subsidio;
  const pct = (n: number) => (suma > 0 ? Math.round((n / suma) * 100) : 0);

  return (
    <Card className="px-5 py-5">
      <h2 className="text-xl font-bold tracking-tight text-tinta">¿Por qué pago esto?</h2>
      {consumo && <p className="mt-0.5 text-tinta-suave">Este mes consumiste {consumo}.</p>}

      {/* Barra: el total partido en sus partes. 28 px, 2 px de aire entre bloques, el % adentro si entra. */}
      <div
        role="img"
        aria-label={`En qué se va tu factura de ${formatMoney(total)}: ${bloques.map((b) => `${b.etiqueta} ${formatMoney(b.importe)} (${pct(b.importe)} %)`).join(', ')}`}
        className="parte-barra mt-4 flex h-7 gap-0.5"
      >
        {bloques.map((b) => (
          <div
            key={b.clave}
            title={`${b.etiqueta}: ${formatMoney(b.importe)} (${pct(b.importe)} %)`}
            className="flex min-w-1 items-center whitespace-nowrap rounded px-1.5 text-xs font-bold"
            style={{ flexGrow: b.importe, flexBasis: 0, background: COLOR_PARTE[b.clave], color: TINTA_PARTE[b.clave] ?? '#ffffff' }}
          >
            {/* El porcentaje se imprime solo si el bloque es ancho: si no, queda en la lista de abajo. */}
            {pct(b.importe) >= 15 && <span aria-hidden>{pct(b.importe)} %</span>}
          </div>
        ))}
      </div>

      {/* La lista hace de leyenda: cada parte con su color, su importe y qué es. */}
      <ul className="mt-4 space-y-2.5">
        {porQue.partes
          .filter((p) => Number(p.importe) !== 0)
          .map((p) => {
            const clave = bloquesDe([{ ...p, importe: '1' }])[0]?.clave ?? 'impuestos';
            return (
              <li key={p.clave} className="flex items-start gap-3">
                <span aria-hidden className="mt-1.5 size-3 shrink-0 rounded-sm" style={{ background: COLOR_PARTE[clave] }} />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-tinta">
                    {p.etiqueta}
                    {p.clave === 'excedente' && (
                      <span className="ml-2 align-middle">
                        <Badge tone="alerta">Depende de tu consumo</Badge>
                      </span>
                    )}
                  </span>
                  {p.detalle && <span className="block text-sm text-tinta-suave">{p.detalle}</span>}
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-bold tabular-nums text-tinta">{formatMoney(p.importe)}</span>
                  <span className="block text-xs tabular-nums text-tinta-suave">{pct(Number(p.importe))} %</span>
                </span>
              </li>
            );
          })}
      </ul>

      {/* El tope del subsidio, dibujado: cuánto entró y cuánto se pasó. */}
      {s && (
        <div className="mt-5 rounded-2xl bg-fondo px-4 py-3.5">
          <p className="font-semibold text-tinta">
            Tope con subsidio: {formatNumber(s.tope)} {s.unidad}
          </p>
          <div className="mt-2 flex h-3 gap-0.5" aria-hidden>
            <div className="rounded-full" style={{ flexGrow: s.dentro, flexBasis: 0, background: COLOR_PARTE.consumo }} />
            {s.fuera > 0 && <div className="rounded-full" style={{ flexGrow: s.fuera, flexBasis: 0, background: COLOR_PARTE.excedente }} />}
          </div>
          <p className="mt-2 text-sm text-tinta-suave">
            {s.fuera > 0
              ? `${formatNumber(s.dentro)} ${s.unidad} con subsidio y ${formatNumber(s.fuera)} ${s.unidad} sin subsidio.`
              : `Todo tu consumo (${formatNumber(s.consumo)} ${s.unidad}) entró en el tope.`}
          </p>
        </div>
      )}

      <div className="mt-5 space-y-2.5">
        {porQue.frases.map((frase, i) => (
          <p key={i} className="flex items-start gap-2.5 text-tinta">
            <Lightbulb className="mt-1 size-4 shrink-0 text-marca-texto" aria-hidden />
            {/* «$ 100» no se parte entre dos renglones. */}
            <span>{frase.replace(/\$ /g, '$ ')}</span>
          </p>
        ))}
      </div>
    </Card>
  );
}
