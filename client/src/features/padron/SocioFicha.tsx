import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Banknote, HeartHandshake, Mail, Phone, X } from 'lucide-react';
import { CONDICION_IVA_ETIQUETA, formatCuit, formatDate, formatNumber, type SocioDetalle } from '@shared';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Badge, ErrorState, Skeleton } from '../../components/ui';
import { ConexionCard } from './ConexionCard';

/** Ficha del socio: panel que entra desde la derecha, sin sacar a la persona de la lista. */
export function SocioFicha({ id, onClose }: { id: number; onClose: () => void }) {
  const query = useQuery({ queryKey: ['socio', id], queryFn: () => api.get<SocioDetalle>(`/padron/socios/${id}`) });
  const cerrar = useRef<HTMLButtonElement>(null);
  const { hasRole } = useAuth();
  const puedeCobrar = hasRole('cajero') || hasRole('admin') || hasRole('superadmin');

  // Escape cierra; el foco entra al panel para que el teclado y el lector de pantalla lo sigan.
  // onClose va por referencia: así el foco se mueve una sola vez por ficha, no en cada redibujo de la lista.
  const alCerrar = useRef(onClose);
  useEffect(() => {
    alCerrar.current = onClose;
  });
  useEffect(() => {
    cerrar.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && alCerrar.current();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [id]);

  const s = query.data;
  // En <body> (portal): dentro de la página la animación de entrada la encerraba en la columna de contenido.
  return createPortal(
    <>
      <div aria-hidden onClick={onClose} className="fixed inset-0 z-[60] bg-black/55 backdrop-blur-[2px]" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={s ? `Ficha de ${s.nombre}` : 'Ficha del socio'}
        className="fixed inset-y-0 right-0 z-[61] flex w-full max-w-xl animate-aparecer flex-col border-l border-linea bg-fondo shadow-2xl"
      >
        <header className="flex items-start gap-3 border-b border-linea bg-superficie px-5 py-4">
          <div className="min-w-0 flex-1">
            {s ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-bold leading-tight text-tinta">{s.nombre}</h2>
                  {s.estado === 'baja' && <Badge>De baja</Badge>}
                </div>
                <p className="mt-0.5 text-sm text-tinta-suave">
                  Socio <span className="font-semibold tabular-nums text-tinta">{s.numero}</span> · {s.tipoDoc}{' '}
                  <span className="tabular-nums">{s.tipoDoc === 'DNI' ? formatNumber(s.nroDoc) : formatCuit(s.nroDoc)}</span> ·{' '}
                  {CONDICION_IVA_ETIQUETA[s.condicionIva]}
                </p>
              </>
            ) : (
              <Skeleton className="h-12 w-64" />
            )}
          </div>
          <button
            ref={cerrar}
            type="button"
            aria-label="Cerrar ficha"
            onClick={onClose}
            className="grid size-11 shrink-0 place-items-center rounded-xl text-tinta-suave hover:bg-marca-tenue hover:text-marca-texto"
          >
            <X className="size-5" aria-hidden />
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {query.isPending ? (
            <>
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-40 w-full rounded-2xl" />
              <Skeleton className="h-28 w-full rounded-2xl" />
            </>
          ) : query.isError ? (
            <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
          ) : (
            s && (
              <>
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                  <p className="flex items-center gap-2 text-tinta">
                    <Phone className="size-4 text-tinta-suave" aria-hidden />
                    {s.telefono ?? <span className="text-tinta-suave">Sin teléfono cargado</span>}
                  </p>
                  <p className="flex min-w-0 items-center gap-2 text-tinta">
                    <Mail className="size-4 shrink-0 text-tinta-suave" aria-hidden />
                    <span className="truncate">{s.email ?? <span className="text-tinta-suave">Sin email cargado</span>}</span>
                  </p>
                  {puedeCobrar && (
                    <Link
                      to={`/caja?socio=${s.id}`}
                      className="ml-auto inline-flex min-h-11 items-center gap-2 rounded-lg bg-marca px-4 text-[0.9375rem] font-semibold text-white shadow-sm transition-colors duration-150 hover:bg-marca-fuerte"
                    >
                      <Banknote className="size-[1.15em]" aria-hidden />
                      Cobrar
                    </Link>
                  )}
                </div>

                <section aria-labelledby="ficha-conexiones" className="space-y-3">
                  <h3 id="ficha-conexiones" className="text-sm font-semibold uppercase tracking-wide text-tinta-suave">
                    {s.conexiones.length === 1 ? 'Conexión' : `${s.conexiones.length} conexiones`}
                  </h3>
                  {s.conexiones.map((c) => (
                    <ConexionCard key={c.id} conexion={c} />
                  ))}
                </section>

                {s.beneficiarios.length > 0 && (
                  <section aria-labelledby="ficha-sepelio" className="space-y-3">
                    <h3 id="ficha-sepelio" className="text-sm font-semibold uppercase tracking-wide text-tinta-suave">
                      Sepelio · {s.beneficiarios.length} {s.beneficiarios.length === 1 ? 'adherente' : 'adherentes'}
                    </h3>
                    <ul className="divide-y divide-linea rounded-2xl border border-linea bg-superficie px-4">
                      {s.beneficiarios.map((b) => (
                        <li key={b.id} className="flex items-center gap-3 py-3">
                          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-marca-tenue text-marca-texto">
                            <HeartHandshake className="size-[1.1rem]" aria-hidden />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-semibold text-tinta">{b.nombre}</p>
                            <p className="text-sm text-tinta-suave">
                              {b.parentesco} · DNI <span className="tabular-nums">{formatNumber(b.nroDoc)}</span> · Desde el {formatDate(b.altaEl)}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </>
            )
          )}
        </div>
      </aside>
    </>,
    document.body,
  );
}
