// Pagar online (SPEC 6.6.1, «mejora de experiencia»): el socio elige qué facturas paga, ve el total y
// un botón «Pagar $ X»; va a la pasarela y, al volver, ve el comprobante y lo que sigue debiendo.
// La pantalla de vuelta nunca da el pago por hecho: le pregunta al servidor, que le pregunta al banco.
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, CircleX, FileDown, Hourglass, LockKeyhole } from 'lucide-react';
import { aCentavos, deCentavos, formatDate, formatMoney, MEDIO_PAGO_ETIQUETA, type EstadoPagoOnline, type InicioSocio, type IntentoCreado } from '@shared';
import { abrirPdf, api, errorMessage } from '../../lib/api';
import { cn } from '../../lib/cn';
import { Button, Card, Empty, ErrorState, FormAlert, Skeleton } from '../../components/ui';
import { EstadoFactura, irAPasarela, NombreFactura, SubPagina } from './piezas';

/* ───────────────────────── Elegir qué paga ───────────────────────── */

export function PagarPage() {
  const [params] = useSearchParams();
  const soloUna = Number(params.get('factura')) || null;
  const consulta = useQuery({ queryKey: ['socio', 'inicio'], queryFn: () => api.get<InicioSocio>('/socio/inicio') });
  const pendientes = consulta.data?.pendientes ?? [];
  // Llega todo marcado (o la factura desde la que se vino); se puede desmarcar.
  const [elegidas, setElegidas] = useState<Set<number> | null>(null);
  const marcadas = elegidas ?? new Set(pendientes.filter((f) => soloUna === null || f.id === soloUna).map((f) => f.id));
  const total = pendientes.filter((f) => marcadas.has(f.id)).reduce((t, f) => t + aCentavos(f.saldo), 0);

  const pagar = useMutation({
    mutationFn: () => api.post<IntentoCreado>('/socio/pagos', { comprobantes: pendientes.filter((f) => marcadas.has(f.id)).map((f) => f.id) }),
    onSuccess: (c) => irAPasarela(c.redireccion),
  });
  const alternar = (id: number) => {
    const nuevo = new Set(marcadas);
    if (nuevo.has(id)) nuevo.delete(id);
    else nuevo.add(id);
    setElegidas(nuevo);
  };

  return (
    <SubPagina titulo="Pagar" volver={{ to: '/socio', texto: 'Inicio' }}>
      {consulta.isPending ? (
        <Skeleton className="h-80 rounded-2xl" />
      ) : consulta.isError ? (
        <ErrorState message={errorMessage(consulta.error)} onRetry={() => void consulta.refetch()} />
      ) : pendientes.length === 0 ? (
        <Card>
          <Empty icon={CircleCheck} title="Estás al día" action={<Link to="/socio" className="font-semibold text-marca-texto underline">Volver al inicio</Link>}>
            No tenés facturas para pagar.
          </Empty>
        </Card>
      ) : (
        <>
          <p className="mb-3 text-tinta-suave">Elegí qué querés pagar.</p>
          <Card className="overflow-hidden">
            <ul className="divide-y divide-linea">
              {pendientes.map((f) => (
                <li key={f.id}>
                  <label className={cn('flex cursor-pointer items-center gap-3 px-4 py-3.5', marcadas.has(f.id) && 'bg-marca-tenue/40')}>
                    <input type="checkbox" checked={marcadas.has(f.id)} onChange={() => alternar(f.id)} className="size-6 shrink-0 rounded accent-(--marca)" />
                    <NombreFactura f={f} className="flex min-w-0 flex-1 items-center gap-3" />
                    <span className="shrink-0 text-right">
                      <span className="block text-lg font-bold tabular-nums text-tinta">{formatMoney(f.saldo)}</span>
                      <EstadoFactura f={f} />
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </Card>

          <div className="sticky bottom-20 z-10 mt-4 rounded-2xl border border-linea bg-superficie p-4 shadow-lg shadow-black/5">
            {pagar.isError && (
              <div className="mb-3">
                <FormAlert>{errorMessage(pagar.error)}</FormAlert>
              </div>
            )}
            <Button size="xl" className="w-full" disabled={total === 0} loading={pagar.isPending || pagar.isSuccess} onClick={() => pagar.mutate()}>
              {total === 0 ? 'Elegí al menos una' : `Pagar ${formatMoney(deCentavos(total))}`}
            </Button>
            <p className="mt-2 flex items-center justify-center gap-1.5 text-sm text-tinta-suave">
              <LockKeyhole className="size-4" aria-hidden />
              Te llevamos a la página del banco para pagar con tarjeta.
            </p>
          </div>
        </>
      )}
    </SubPagina>
  );
}

/* ───────────────────────── Cómo quedó ───────────────────────── */

/**
 * Sigue el estado de un pago hasta que el banco responde. Mientras está pendiente pregunta cada
 * 2 segundos; después de un minuto deja de insistir y ofrece consultar de nuevo.
 */
export function useEstadoPago(ruta: string) {
  const [desde] = useState(() => Date.now());
  return useQuery({
    queryKey: ['pago-online', ruta],
    queryFn: () => api.get<EstadoPagoOnline>(ruta),
    refetchInterval: (q) => (q.state.data?.estado === 'pendiente' && Date.now() - desde < 60_000 ? 2000 : false),
  });
}

/** Lo que se ve al volver del banco: aprobado (con el recibo), rechazado, cancelado, vencido o esperando. */
export function ResultadoPago({ estado: e, cancelado, recibo, despues }: { estado: EstadoPagoOnline; cancelado: boolean; recibo?: ReactNode; despues: ReactNode }) {
  const pendiente = e.estado === 'pendiente';
  const titulo =
    e.estado === 'aprobado'
      ? `Pagaste ${formatMoney(e.total)}`
      : e.estado === 'rechazado'
        ? 'El banco no aprobó el pago'
        : e.estado === 'vencido'
          ? 'El pago no se completó a tiempo'
          : e.estado === 'cancelado' || cancelado
            ? 'Cancelaste el pago'
            : 'Estamos esperando la respuesta del banco';
  const Icono = e.estado === 'aprobado' ? CircleCheck : pendiente && !cancelado ? Hourglass : CircleX;
  return (
    <Card className="px-5 py-7 text-center">
      <div role="status" aria-live="polite">
        <div
          className={cn(
            'mx-auto grid size-16 place-items-center rounded-full',
            e.estado === 'aprobado' ? 'bg-exito-tenue text-exito' : pendiente && !cancelado ? 'bg-marca-tenue text-marca-texto' : 'bg-peligro-tenue text-peligro',
          )}
        >
          <Icono className={cn('size-9', pendiente && !cancelado && 'animate-latido')} aria-hidden />
        </div>
        <h2 className="mt-4 text-2xl font-black tracking-tight text-tinta">{titulo}</h2>
        <p className="mt-1.5 text-tinta-suave">
          {e.estado === 'aprobado'
            ? `${e.medio ? `Con ${MEDIO_PAGO_ETIQUETA[e.medio].toLowerCase()}` : 'Pago online'}${e.recibo ? ` · recibo ${e.recibo.referencia}` : ''}.`
            : e.estado === 'rechazado'
              ? `${e.motivo ?? 'No se cobró nada.'}${e.motivo ? '. No se cobró nada.' : ''} Podés probar con otra tarjeta.`
              : e.estado === 'vencido'
                ? 'Pasó el tiempo para pagar en el banco y no se cobró nada. Podés volver a intentarlo.'
                : e.estado === 'cancelado' || cancelado
                  ? 'No se cobró nada.'
                  : 'Apenas el banco confirme, el pago aparece acá. No hace falta que pagues de nuevo.'}
        </p>
      </div>

      {e.aFavor && (
        <p className="mx-auto mt-4 max-w-sm rounded-xl bg-alerta-tenue px-4 py-3 text-sm text-tinta">
          Una de las facturas ya estaba paga cuando llegó este pago: te quedan <strong>{formatMoney(e.aFavor)}</strong> a favor. La cooperativa te los descuenta o te los devuelve.
        </p>
      )}

      <ul className="mx-auto mt-5 max-w-sm divide-y divide-linea rounded-2xl border border-linea text-left text-sm">
        {e.items.map((i) => (
          <li key={i.comprobanteId} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <span className="min-w-0 text-tinta">{i.descripcion.split(' · ')[0]}</span>
            <span className="shrink-0 font-bold tabular-nums text-tinta">{formatMoney(i.importe)}</span>
          </li>
        ))}
      </ul>

      {e.estado === 'aprobado' && recibo}
      <div className="mt-6">{despues}</div>
    </Card>
  );
}

export function PagoResultadoPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const consulta = useEstadoPago(`/socio/pagos/intentos/${id}`);
  const recibo = useMutation({ mutationFn: (pagoId: number) => abrirPdf(`/socio/pagos/${pagoId}/recibo`) });
  const e = consulta.data;

  // Cuando se resuelve, lo demás (deuda, facturas) se vuelve a pedir.
  useEffect(() => {
    if (e && e.estado !== 'pendiente') void qc.invalidateQueries({ queryKey: ['socio'] });
  }, [e, qc]);

  if (consulta.isPending) return <Skeleton className="mt-6 h-96 rounded-2xl" />;
  if (consulta.isError || !e) return <ErrorState message={errorMessage(consulta.error)} onRetry={() => void consulta.refetch()} />;

  return (
    <div className="pt-2">
      <ResultadoPago
        estado={e}
        cancelado={params.get('cancelado') === '1'}
        recibo={
          e.recibo && (
            <div className="mt-4">
              <Button variant="secondary" size="lg" icon={FileDown} loading={recibo.isPending} onClick={() => recibo.mutate(e.recibo!.id)}>
                Descargar el recibo
              </Button>
              {recibo.isError && <p className="mt-2 text-sm font-medium text-peligro">{errorMessage(recibo.error)}</p>}
            </div>
          )
        }
        despues={
          <div className="space-y-3">
            {e.deudaRestante !== null && e.estado === 'aprobado' && (
              <p className="text-lg font-bold text-tinta">
                {Number(e.deudaRestante) > 0 ? (
                  <>
                    Te queda por pagar <span className="whitespace-nowrap">{formatMoney(e.deudaRestante)}</span>
                  </>
                ) : (
                  'Quedaste al día'
                )}
              </p>
            )}
            {e.estado === 'pendiente' && !consulta.isFetching && (
              <Button variant="secondary" onClick={() => void consulta.refetch()}>
                Consultar de nuevo
              </Button>
            )}
            {(e.estado === 'rechazado' || e.estado === 'vencido' || e.estado === 'cancelado') && (
              <Link to="/socio/pagar" className="flex min-h-14 items-center justify-center rounded-2xl bg-marca px-5 text-lg font-bold text-white hover:bg-marca-fuerte">
                Volver a intentar
              </Link>
            )}
            <Link to="/socio" className="inline-flex min-h-11 items-center font-semibold text-marca-texto hover:underline">
              Ir al inicio
            </Link>
            {e.resueltoEl && <p className="text-xs text-tinta-suave">{formatDate(e.resueltoEl)}</p>}
          </div>
        }
      />
    </div>
  );
}
