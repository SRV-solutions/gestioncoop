// Pasarela de prueba: hace de «banco» en la demo (en producción, la de Macro Click de Pago).
// A propósito no se parece a la app: es otra empresa. No pide datos de tarjeta —no se cobra nada—:
// solo deja elegir qué pasa (aprobar, rechazar, cancelar) para mostrar cada caso.
import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CreditCard, Landmark, LoaderCircle, LockKeyhole, ShieldAlert } from 'lucide-react';
import { formatMoney, type PasarelaDatos } from '@shared';
import { api, errorMessage } from '../../lib/api';
import { cn } from '../../lib/cn';

export function PasarelaPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const firma = params.get('firma') ?? '';
  const [medio, setMedio] = useState<'debito' | 'credito'>('debito');
  const consulta = useQuery({ queryKey: ['pasarela', id], queryFn: () => api.get<PasarelaDatos>(`/publico/pasarela/${id}?firma=${encodeURIComponent(firma)}`), retry: false });
  const decidir = useMutation({
    mutationFn: (decision: 'aprobar' | 'rechazar' | 'cancelar') => api.post<{ estado: string; redireccion: string }>(`/publico/pasarela/${id}`, { firma, decision, medio }),
    // Igual que el banco: termina y devuelve al comercio.
    onSuccess: (r) => setTimeout(() => window.location.assign(r.redireccion), 600),
  });
  const d = consulta.data;
  const trabajando = decidir.isPending || decidir.isSuccess;

  return (
    <div className="min-h-dvh bg-[#eef1f4] text-[#1b2430]">
      <header className="bg-[#1b2430] text-white">
        <div className="mx-auto flex h-14 max-w-lg items-center gap-2.5 px-4">
          <Landmark className="size-6" aria-hidden />
          <span className="font-bold tracking-tight">Pasarela de pago</span>
          <span className="ml-auto inline-flex items-center gap-1 text-xs text-white/70">
            <LockKeyhole className="size-3.5" aria-hidden />
            Conexión segura
          </span>
        </div>
      </header>
      <div className="bg-[#fff4d6] text-[#5a4200]">
        <p className="mx-auto flex max-w-lg items-start gap-2 px-4 py-2.5 text-sm font-semibold">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          Pasarela de prueba de la demo: no se cobra nada. No escribas datos de tarjetas reales en ningún lado.
        </p>
      </div>

      <main className="mx-auto max-w-lg px-4 py-6">
        {consulta.isPending ? (
          <div className="grid place-items-center py-24">
            <LoaderCircle className="size-8 animate-spin text-[#1b2430]/60" aria-label="Cargando" />
          </div>
        ) : consulta.isError || !d ? (
          <div className="rounded-xl bg-white p-6 text-center shadow-sm">
            <p className="text-lg font-bold">No encontramos esta operación</p>
            <p className="mt-1 text-[#1b2430]/70">{errorMessage(consulta.error)}</p>
          </div>
        ) : d.estado !== 'pendiente' ? (
          <div className="rounded-xl bg-white p-6 text-center shadow-sm">
            <p className="text-lg font-bold">{d.estado === 'vencido' ? 'La operación venció' : 'Esta operación ya terminó'}</p>
            <a href={d.estado === 'aprobado' ? d.retorno.exito : d.retorno.cancelado} className="mt-4 inline-flex min-h-12 items-center rounded-lg bg-[#1b2430] px-5 font-semibold text-white">
              Volver a {d.comercio}
            </a>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl bg-white shadow-sm">
            <div className="border-b border-[#e3e8ee] px-5 py-4">
              <p className="text-sm text-[#1b2430]/60">Pagás a</p>
              <p className="text-lg font-bold">{d.comercio}</p>
            </div>
            <ul className="divide-y divide-[#e3e8ee] px-5">
              {d.items.map((i) => (
                <li key={i.descripcion} className="flex items-start justify-between gap-3 py-3 text-sm">
                  <span>{i.descripcion}</span>
                  <span className="shrink-0 font-semibold tabular-nums">{formatMoney(i.importe)}</span>
                </li>
              ))}
            </ul>
            <div className="flex items-baseline justify-between border-t border-[#e3e8ee] bg-[#f7f9fb] px-5 py-4">
              <span className="font-semibold">Total</span>
              <span className="text-2xl font-black tabular-nums">{formatMoney(d.total)}</span>
            </div>

            <fieldset className="mt-5 px-5" disabled={trabajando}>
              <legend className="mb-2 text-sm font-semibold">Pagar con</legend>
              <div className="grid grid-cols-2 gap-2">
                {(['debito', 'credito'] as const).map((m) => (
                  <label
                    key={m}
                    className={cn(
                      'flex min-h-14 cursor-pointer items-center gap-2.5 rounded-lg border-2 px-3 font-semibold',
                      medio === m ? 'border-[#1b2430] bg-[#f2f5f8]' : 'border-[#e3e8ee]',
                    )}
                  >
                    <input type="radio" name="medio" value={m} checked={medio === m} onChange={() => setMedio(m)} className="sr-only" />
                    <CreditCard className="size-5" aria-hidden />
                    Tarjeta de {m === 'debito' ? 'débito' : 'crédito'}
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="space-y-2 px-5 py-5">
              {decidir.isError && <p className="rounded-lg bg-[#fdecea] px-3 py-2 text-sm font-semibold text-[#a12622]">{errorMessage(decidir.error)}</p>}
              <button
                type="button"
                disabled={trabajando}
                onClick={() => decidir.mutate('aprobar')}
                className="flex min-h-14 w-full items-center justify-center gap-2 rounded-lg bg-[#1b7f3b] px-5 text-lg font-bold text-white hover:bg-[#166a31] disabled:opacity-60"
              >
                {trabajando && decidir.variables === 'aprobar' && <LoaderCircle className="size-5 animate-spin" aria-hidden />}
                Pagar {formatMoney(d.total)}
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={trabajando}
                  onClick={() => decidir.mutate('rechazar')}
                  className="min-h-12 rounded-lg border border-[#e3e8ee] px-3 text-sm font-semibold text-[#a12622] hover:bg-[#fdecea] disabled:opacity-60"
                >
                  Simular un rechazo
                </button>
                <button
                  type="button"
                  disabled={trabajando}
                  onClick={() => decidir.mutate('cancelar')}
                  className="min-h-12 rounded-lg border border-[#e3e8ee] px-3 text-sm font-semibold hover:bg-[#f2f5f8] disabled:opacity-60"
                >
                  Cancelar y volver
                </button>
              </div>
              {decidir.isSuccess && (
                <p role="status" className="pt-1 text-center text-sm text-[#1b2430]/70">
                  Listo. Te llevamos de vuelta a {d.comercio}…
                </p>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
