import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { ChevronRight, Search, SearchX, Users, X } from 'lucide-react';
import { formatNumber, SERVICIOS_CONEXION, type Page, type PadronResumen, type SocioListado } from '@shared';
import { api, errorMessage, qs } from '../../lib/api';
import { cn } from '../../lib/cn';
import { SERVICIO_CORTO, SERVICIO_ICON, ServicioIcons } from '../../components/servicios';
import { Badge, Button, Card, Empty, ErrorState, PageHeader, Skeleton } from '../../components/ui';
import { SocioFicha } from './SocioFicha';

const formatDoc = (s: SocioListado) => `${s.tipoDoc} ${s.tipoDoc === 'DNI' ? formatNumber(s.nroDoc) : s.nroDoc}`;

export function PadronPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const zona = params.get('zona') ?? '';
  const socioId = Number(params.get('socio')) || null;

  /** Cambia un parámetro de la dirección sin perder los otros (así una búsqueda se puede compartir o recargar). */
  const setParam = (name: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    setParams(next, { replace: true });
  };

  // El campo responde al instante; la consulta espera a que se deje de tipear.
  const [texto, setTexto] = useState(q);
  useEffect(() => {
    if (texto.trim() === q) return;
    const t = setTimeout(() => setParam('q', texto.trim() || null), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texto]);

  const resumen = useQuery({ queryKey: ['padron-resumen'], queryFn: () => api.get<PadronResumen>('/padron/resumen'), staleTime: 60_000 });
  const lista = useInfiniteQuery({
    queryKey: ['padron-socios', q, zona],
    queryFn: ({ pageParam }) => api.get<Page<SocioListado>>(`/padron/socios${qs({ q, zona, cursor: pageParam, limit: 50 })}`),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: keepPreviousData,
  });
  const socios = lista.data?.pages.flatMap((p) => p.items) ?? [];
  const total = lista.data?.pages[0]?.total ?? 0;
  const filtrando = q !== '' || zona !== '';

  return (
    <>
      <PageHeader title="Padrón" description="Socios, conexiones y servicios de la cooperativa." />

      {/* Resumen */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {resumen.isPending ? (
          [0, 1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} className="h-[4.5rem] rounded-2xl" />)
        ) : resumen.isError ? null : (
          <>
            <Dato etiqueta="Socios" valor={resumen.data.socios} />
            <Dato etiqueta="Conexiones" valor={resumen.data.conexiones} />
            {SERVICIOS_CONEXION.map((s) => {
              const Icon = SERVICIO_ICON[s];
              return <Dato key={s} etiqueta={SERVICIO_CORTO[s]} valor={resumen.data.porServicio[s]} icon={<Icon className="size-4" aria-hidden />} />;
            })}
          </>
        )}
      </div>

      {/* Búsqueda */}
      <div className="mb-4 flex flex-wrap gap-3">
        <div className="relative min-w-0 flex-1 basis-72">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-tinta-suave" aria-hidden />
          <input
            type="search"
            autoFocus
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            aria-label="Buscar en el padrón"
            placeholder="Buscar por nombre, DNI, número de socio, medidor o dirección"
            className="min-h-12 w-full rounded-xl border border-linea bg-superficie pl-12 pr-11 text-base text-tinta placeholder:text-tinta-suave/80 hover:border-marca-claro focus:border-marca [&::-webkit-search-cancel-button]:hidden"
          />
          {texto && (
            <button
              type="button"
              aria-label="Borrar búsqueda"
              onClick={() => setTexto('')}
              className="absolute right-1.5 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-lg text-tinta-suave hover:bg-marca-tenue hover:text-marca-texto"
            >
              <X className="size-4" aria-hidden />
            </button>
          )}
        </div>
        <select
          aria-label="Zona"
          value={zona}
          onChange={(e) => setParam('zona', e.target.value || null)}
          className="min-h-12 rounded-xl border border-linea bg-superficie px-3.5 text-base text-tinta hover:border-marca-claro focus:border-marca"
        >
          <option value="">Todas las zonas</option>
          {resumen.data?.zonas.map((z) => (
            <option key={z.id} value={z.id}>
              {z.nombre} ({formatNumber(z.conexiones)})
            </option>
          ))}
        </select>
      </div>

      <Card className="overflow-hidden">
        {lista.isPending ? (
          <ul aria-label="Cargando el padrón" className="divide-y divide-linea">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
              <li key={i} className="flex items-center gap-4 px-5 py-4">
                <Skeleton className="h-4 w-14" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-52" />
                  <Skeleton className="h-3 w-72" />
                </div>
              </li>
            ))}
          </ul>
        ) : lista.isError ? (
          <ErrorState message={errorMessage(lista.error)} onRetry={() => void lista.refetch()} />
        ) : socios.length === 0 ? (
          filtrando ? (
            <Empty
              icon={SearchX}
              title="No encontramos a nadie con ese dato"
              action={
                <Button
                  variant="secondary"
                  onClick={() => {
                    setTexto('');
                    setParams(new URLSearchParams(), { replace: true });
                  }}
                >
                  Borrar la búsqueda
                </Button>
              }
            >
              Probá con el apellido, el DNI, el número de socio o el número de medidor.
            </Empty>
          ) : (
            <Empty icon={Users} title="El padrón está vacío">
              Cuando se carguen socios y conexiones van a aparecer acá.
            </Empty>
          )
        ) : (
          <ul className={cn('divide-y divide-linea transition-opacity duration-150', lista.isPlaceholderData && 'opacity-60')}>
            {socios.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => setParam('socio', String(s.id))}
                  aria-current={socioId === s.id || undefined}
                  className={cn(
                    'flex w-full items-center gap-4 px-4 py-3.5 text-left transition-colors duration-150 hover:bg-marca-tenue/60 sm:px-5',
                    socioId === s.id && 'bg-marca-tenue',
                  )}
                >
                  <span className="hidden w-14 shrink-0 text-sm font-semibold tabular-nums text-tinta-suave sm:block">{s.numero}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="truncate font-semibold text-tinta">{s.nombre}</span>
                      {s.estado === 'baja' && <Badge>De baja</Badge>}
                      {s.conexiones > 1 && <Badge tone="marca">{s.conexiones} conexiones</Badge>}
                    </span>
                    <span className="block truncate text-sm text-tinta-suave">
                      <span className="sm:hidden">Socio {s.numero} · </span>
                      {formatDoc(s)}
                      {s.direccion && <> · {s.direccion}</>}
                      {s.zona && <span className="max-md:hidden"> · {s.zona}</span>}
                    </span>
                  </span>
                  <ServicioIcons servicios={s.servicios} className="max-md:hidden" />
                  <ChevronRight className="size-5 shrink-0 text-tinta-suave" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {socios.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-tinta-suave" role="status">
            Mostrando {formatNumber(socios.length)} de {formatNumber(total)} {total === 1 ? 'socio' : 'socios'}
          </p>
          {lista.hasNextPage && (
            <Button variant="secondary" loading={lista.isFetchingNextPage} onClick={() => void lista.fetchNextPage()}>
              Mostrar más
            </Button>
          )}
        </div>
      )}

      {socioId && <SocioFicha id={socioId} onClose={() => setParam('socio', null)} />}
    </>
  );
}

function Dato({ etiqueta, valor, icon }: { etiqueta: string; valor: number; icon?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-linea bg-superficie px-4 py-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-tinta-suave">
        {icon}
        {etiqueta}
      </p>
      <p className="mt-0.5 text-2xl font-bold tabular-nums text-tinta">{formatNumber(valor)}</p>
    </div>
  );
}
