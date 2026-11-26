// Inicio del socio (SPEC 5 y 6.7): un número grande —«Debés $ X» o «Estás al día»—, el
// vencimiento, el botón para pagar y los avisos que le tocan (cortes de su zona, reclamos abiertos).
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, ChevronRight, CircleCheck, Hourglass, MessageSquareWarning, PowerOff, ReceiptText } from 'lucide-react';
import { formatDate, formatDateTime, formatMoney, LOCALE, SERVICIO_ETIQUETA, TIMEZONE, type CorteAviso, type InicioSocio } from '@shared';
import { api, errorMessage } from '../../lib/api';
import { cn } from '../../lib/cn';
import { Card, ErrorState, Skeleton } from '../../components/ui';
import { EstadoFactura, NombreFactura } from './piezas';

const diaFmt = new Intl.DateTimeFormat(LOCALE, { timeZone: TIMEZONE, weekday: 'long', day: 'numeric', month: 'long' });
const horaFmt = new Intl.DateTimeFormat(LOCALE, { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false });

/** «el jueves 26 de noviembre, de 08:00 a 12:00» */
function cuando(c: CorteAviso): string {
  const desde = new Date(c.desde);
  const hasta = new Date(c.hasta);
  const mismoDia = diaFmt.format(desde) === diaFmt.format(hasta);
  return mismoDia ? `el ${diaFmt.format(desde)}, de ${horaFmt.format(desde)} a ${horaFmt.format(hasta)}` : `del ${formatDateTime(c.desde)} al ${formatDateTime(c.hasta)}`;
}

export function InicioPage() {
  const consulta = useQuery({ queryKey: ['socio', 'inicio'], queryFn: () => api.get<InicioSocio>('/socio/inicio') });
  const i = consulta.data;

  if (consulta.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-56 rounded-3xl" />
        <Skeleton className="h-24 rounded-2xl" />
      </div>
    );
  }
  if (consulta.isError || !i) return <ErrorState message={errorMessage(consulta.error)} onRetry={() => void consulta.refetch()} />;

  const debe = i.pendientes.length > 0;
  return (
    <div className="space-y-4">
      {/* Lo que debe: la respuesta a la única pregunta de esta pantalla. */}
      <div data-tour="deuda">
      <Card className={cn('overflow-hidden', debe && i.vencidas > 0 && 'border-peligro/40')}>
        <div className="px-5 pb-5 pt-6 text-center">
          {debe ? (
            <>
              <p className="font-semibold text-tinta-suave">Debés</p>
              <p className="mt-1 whitespace-nowrap text-[2.5rem] font-black leading-tight tracking-tight text-tinta sm:text-5xl">{formatMoney(i.deuda)}</p>
              <p className={cn('mt-2 font-semibold', i.vencidas > 0 ? 'text-peligro' : 'text-tinta-suave')}>
                {i.vencidas > 0
                  ? i.vencidas === i.pendientes.length
                    ? `${i.vencidas === 1 ? 'Tu factura está vencida' : `Tus ${i.vencidas} facturas están vencidas`}`
                    : `${i.vencidas} vencida${i.vencidas === 1 ? '' : 's'}${i.proximoVencimiento ? ` · la próxima vence el ${formatDate(i.proximoVencimiento)}` : ''}`
                  : i.proximoVencimiento && `Vence el ${formatDate(i.proximoVencimiento)}`}
              </p>
              <Link
                to="/socio/pagar"
                className="mt-5 flex min-h-16 w-full items-center justify-center gap-2 rounded-2xl bg-marca px-6 text-xl font-bold text-white shadow-sm transition-colors duration-150 hover:bg-marca-fuerte"
              >
                Pagar {formatMoney(i.deuda)}
              </Link>
              {i.vencidas > 0 && <p className="mt-3 text-sm text-tinta-suave">Lo vencido suma intereses en la próxima factura. Pagando hoy, dejan de correr.</p>}
            </>
          ) : (
            <>
              <div className="mx-auto grid size-16 place-items-center rounded-full bg-exito-tenue text-exito">
                <CircleCheck className="size-9" aria-hidden />
              </div>
              <p className="mt-3 text-3xl font-black tracking-tight text-tinta">Estás al día</p>
              <p className="mt-1 text-tinta-suave">No tenés facturas para pagar.</p>
            </>
          )}
          {i.ultimoPago && (
            <p className="mt-4 text-sm text-tinta-suave">
              Último pago: {formatMoney(i.ultimoPago.importe)} el {formatDate(i.ultimoPago.cobradoEl)}
            </p>
          )}
        </div>
        {i.pagoEnCurso && (
          <Link to={`/socio/pago/${i.pagoEnCurso.intentoId}`} className="flex items-center gap-3 border-t border-linea bg-alerta-tenue px-5 py-3 text-tinta">
            <Hourglass className="size-5 shrink-0 text-alerta" aria-hidden />
            <span className="flex-1 text-sm">
              Tenés un pago de <strong>{formatMoney(i.pagoEnCurso.total)}</strong> sin terminar. Tocá para ver cómo quedó.
            </span>
            <ChevronRight className="size-5 text-tinta-suave" aria-hidden />
          </Link>
        )}
      </Card>
      </div>

      {/* Cortes programados en su zona */}
      {i.cortes.map((c) => (
        <div key={c.id} role="status" className="flex items-start gap-3 rounded-2xl border border-acento/50 bg-acento-tenue px-4 py-3.5">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-superficie text-alerta">
            <PowerOff className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="font-bold text-tinta">
              Corte de {SERVICIO_ETIQUETA[c.servicio].toLowerCase()} {cuando(c)}
            </p>
            <p className="text-tinta-suave">
              {c.zona ? `En ${c.zona}` : 'En toda la localidad'}. {c.motivo}.
            </p>
          </div>
        </div>
      ))}

      {/* Lo que debe, factura por factura */}
      {debe && (
        <section aria-labelledby="pendientes-titulo">
          <h2 id="pendientes-titulo" className="mb-2 mt-6 text-lg font-bold">
            Lo que debés
          </h2>
          <Card className="overflow-hidden">
            <ul className="divide-y divide-linea">
              {i.pendientes.map((f) => (
                <li key={f.id}>
                  <Link to={`/socio/facturas/${f.id}`} className="flex items-center gap-3 px-4 py-3.5 transition-colors duration-100 hover:bg-marca-tenue/40">
                    <NombreFactura f={f} className="flex min-w-0 flex-1 items-center gap-3" />
                    <span className="shrink-0 text-right">
                      <span className="block text-lg font-bold tabular-nums text-tinta">{formatMoney(f.saldo)}</span>
                      <EstadoFactura f={f} />
                    </span>
                    <ChevronRight className="size-5 shrink-0 text-tinta-suave" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
          <p className="mt-2 text-sm text-tinta-suave">Tocá una factura para ver por qué pagás lo que pagás.</p>
        </section>
      )}

      {/* Accesos */}
      <div className="grid grid-cols-2 gap-3 pt-2">
        <Link to="/socio/mas/reclamos/nuevo" className="flex min-h-24 flex-col justify-between rounded-2xl border border-linea bg-superficie p-4 transition-colors duration-150 hover:border-marca">
          <MessageSquareWarning className="size-6 text-marca-texto" aria-hidden />
          <span className="font-bold text-tinta">Hacer un reclamo</span>
        </Link>
        <Link to="/socio/mas/reclamos" className="flex min-h-24 flex-col justify-between rounded-2xl border border-linea bg-superficie p-4 transition-colors duration-150 hover:border-marca">
          {i.reclamosAbiertos > 0 ? <CalendarClock className="size-6 text-alerta" aria-hidden /> : <ReceiptText className="size-6 text-marca-texto" aria-hidden />}
          <span className="font-bold text-tinta">{i.reclamosAbiertos > 0 ? `${i.reclamosAbiertos} reclamo${i.reclamosAbiertos === 1 ? '' : 's'} en curso` : 'Mis reclamos'}</span>
        </Link>
      </div>
    </div>
  );
}
