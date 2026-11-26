// Pagar con el QR de la factura de papel, sin tener cuenta: el código lleva a la factura y desde acá
// se va a la pasarela. Muestra lo justo para reconocerla —nada de nombres ni domicilios— y, al
// volver del banco, cómo quedó el pago.
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CircleCheck, LockKeyhole, SearchX } from 'lucide-react';
import { formatDate, formatMoney, nombreDeMes, SERVICIO_ETIQUETA, type FacturaPublica, type IntentoCreado } from '@shared';
import { api, errorMessage } from '../../lib/api';
import { PoweredBy } from '../../components/Logo';
import { SERVICIO_ICON } from '../../components/servicios';
import { Badge, Button, Card, Empty, FormAlert, Skeleton } from '../../components/ui';
import { irAPasarela } from '../socio/piezas';
import { ResultadoPago, useEstadoPago } from '../socio/pago';

/** Igual que el portal del socio: letra base de 18 px. */
export function Marco({ children }: { children: ReactNode }) {
  useEffect(() => {
    document.documentElement.classList.add('letra-grande');
    return () => document.documentElement.classList.remove('letra-grande');
  }, []);
  return (
    <div className="min-h-dvh bg-fondo">
      <main className="mx-auto max-w-md px-4 py-8">{children}</main>
      <div className="flex justify-center pb-8">
        <PoweredBy />
      </div>
    </div>
  );
}

export function PagarCodigoPage() {
  const { codigo = '' } = useParams();
  const consulta = useQuery({ queryKey: ['publico', 'pagar', codigo], queryFn: () => api.get<FacturaPublica>(`/publico/pagar/${encodeURIComponent(codigo)}`), retry: false });
  const pagar = useMutation({
    mutationFn: () => api.post<IntentoCreado>(`/publico/pagar/${encodeURIComponent(codigo)}`),
    onSuccess: (c) => {
      // Para ofrecer «volver a intentar» si el banco no aprueba.
      try {
        sessionStorage.setItem(`pago-qr-${c.intentoId}`, codigo);
      } catch {
        /* sin almacenamiento: solo se pierde el atajo */
      }
      irAPasarela(c.redireccion);
    },
  });
  const f = consulta.data;

  return (
    <Marco>
      {consulta.isPending ? (
        <Skeleton className="h-80 rounded-3xl" />
      ) : consulta.isError || !f ? (
        <Card>
          <Empty icon={SearchX} title="No encontramos esa factura">
            {errorMessage(consulta.error)} Si el código está gastado, podés pagar en la caja de la cooperativa.
          </Empty>
        </Card>
      ) : (
        <Card className="px-5 py-6">
          <p className="text-center font-bold text-tinta">{f.cooperativa}</p>
          <div className="mt-5 flex items-center gap-3">
            {(() => {
              const Icon = SERVICIO_ICON[f.servicio];
              return (
                <span className="grid size-12 place-items-center rounded-2xl bg-marca-tenue text-marca-texto">
                  <Icon className="size-6" aria-hidden />
                </span>
              );
            })()}
            <div className="min-w-0">
              <p className="font-bold text-tinta">
                {SERVICIO_ETIQUETA[f.servicio]} · {nombreDeMes(f.anio, f.mes)}
              </p>
              <p className="text-tinta-suave">{f.identificacion}</p>
            </div>
          </div>

          {f.estado === 'pendiente' ? (
            <>
              <p className="mt-6 text-center font-semibold text-tinta-suave">A pagar</p>
              <p className="text-center text-5xl font-black tracking-tight text-tinta">{formatMoney(f.saldo)}</p>
              {f.venceEl && (
                <p className="mt-1 text-center">
                  <Badge tone={f.vencida ? 'peligro' : 'alerta'}>{f.vencida ? `Venció el ${formatDate(f.venceEl)}` : `Vence el ${formatDate(f.venceEl)}`}</Badge>
                </p>
              )}
              {pagar.isError && (
                <div className="mt-4">
                  <FormAlert>{errorMessage(pagar.error)}</FormAlert>
                </div>
              )}
              <Button size="xl" className="mt-6 w-full" loading={pagar.isPending || pagar.isSuccess} onClick={() => pagar.mutate()}>
                Pagar {formatMoney(f.saldo)}
              </Button>
              <p className="mt-2 flex items-center justify-center gap-1.5 text-sm text-tinta-suave">
                <LockKeyhole className="size-4" aria-hidden />
                Pagás en la página del banco, con tarjeta.
              </p>
            </>
          ) : (
            <div className="mt-6 text-center">
              <div className="mx-auto grid size-14 place-items-center rounded-full bg-exito-tenue text-exito">
                <CircleCheck className="size-8" aria-hidden />
              </div>
              <p className="mt-3 text-2xl font-black text-tinta">{f.estado === 'pagada' ? 'Esta factura ya está pagada' : 'Esta factura está anulada'}</p>
            </div>
          )}
          <p className="mt-6 text-center text-sm text-tinta-suave">
            ¿Sos socio? <Link to="/login" className="font-semibold text-marca-texto underline">Entrá a tu cuenta</Link> para ver todas tus facturas.
          </p>
        </Card>
      )}
    </Marco>
  );
}

export function ResultadoPublicoPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const consulta = useEstadoPago(`/publico/pagos/${id}`);
  const e = consulta.data;
  const [codigo] = useState(() => {
    try {
      return sessionStorage.getItem(`pago-qr-${id}`);
    } catch {
      return null;
    }
  });
  return (
    <Marco>
      {consulta.isPending ? (
        <Skeleton className="h-96 rounded-3xl" />
      ) : consulta.isError || !e ? (
        <Card>
          <Empty icon={SearchX} title="No encontramos ese pago">
            {errorMessage(consulta.error)}
          </Empty>
        </Card>
      ) : (
        <ResultadoPago
          estado={e}
          cancelado={params.get('cancelado') === '1'}
          despues={
            <div className="space-y-2">
              {e.estado === 'pendiente' && !consulta.isFetching && (
                <Button variant="secondary" onClick={() => void consulta.refetch()}>
                  Consultar de nuevo
                </Button>
              )}
              {codigo && (e.estado === 'rechazado' || e.estado === 'cancelado' || e.estado === 'vencido') && (
                <Link to={`/pagar/${codigo}`} className="flex min-h-14 items-center justify-center rounded-2xl bg-marca px-5 text-lg font-bold text-white hover:bg-marca-fuerte">
                  Volver a intentar
                </Link>
              )}
              {e.estado === 'aprobado' && <p className="text-tinta-suave">Guardá esta pantalla: es tu comprobante. El recibo también está en la app, entrando a tu cuenta.</p>}
              <Link to="/login" className="inline-flex min-h-11 items-center font-semibold text-marca-texto hover:underline">
                Entrar a mi cuenta
              </Link>
            </div>
          }
        />
      )}
    </Marco>
  );
}
