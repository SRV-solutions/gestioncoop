// Caja (SPEC 6.6): abrir, cobrar con el teclado, ver lo cobrado y cerrar con arqueo.
// F2 lleva siempre al buscador, desde cualquier parte de la pantalla.
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Banknote, History, ListChecks, Lock, type LucideIcon } from 'lucide-react';
import { formatMoney, type CajaResumen, type EstadoCaja } from '@shared';
import { api, errorMessage } from '../../lib/api';
import { cn } from '../../lib/cn';
import { Button, ErrorState, PageHeader, Skeleton } from '../../components/ui';
import { AbrirCaja, CerrarCaja } from './Arqueo';
import { Cajas, Movimientos } from './Cajas';
import { Cobro } from './Cobro';
import { hora, Kbd, plural } from './piezas';

type Vista = 'cobrar' | 'movimientos' | 'cajas';
const VISTAS: { id: Vista; etiqueta: string; icon: LucideIcon }[] = [
  { id: 'cobrar', etiqueta: 'Cobrar', icon: Banknote },
  { id: 'movimientos', etiqueta: 'Cobros de esta caja', icon: ListChecks },
  { id: 'cajas', etiqueta: 'Cajas anteriores', icon: History },
];

export function CajaPage() {
  const [params, setParams] = useSearchParams();
  const consulta = useQuery({ queryKey: ['caja', 'estado'], queryFn: () => api.get<EstadoCaja>('/caja/estado') });
  const e = consulta.data;
  // Se guarda la caja tal como estaba al apretar «Cerrar»: cuando se cierra deja de venir en el estado, y el resultado tiene que seguir a la vista.
  const [cerrando, setCerrando] = useState<CajaResumen | null>(null);
  // Cada F2 arranca un cobro nuevo: el buscador vacío y con el foco.
  const [vuelta, setVuelta] = useState(0);
  // Se llega con ?socio=… desde la ficha del padrón: ese socio se abre una sola vez.
  const [socioInicial] = useState(() => {
    const id = Number(params.get('socio'));
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  });

  const puedeCobrar = e?.puedeCobrar ?? false;
  const pedida = params.get('vista');
  const vista: Vista = !puedeCobrar ? 'cajas' : pedida === 'cajas' ? 'cajas' : pedida === 'movimientos' && e?.caja ? 'movimientos' : 'cobrar';
  const ir = (v: Vista) => setParams(v === 'cobrar' ? {} : { vista: v }, { replace: true });

  useEffect(() => {
    if (!puedeCobrar) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'F2' || document.querySelector('[role="dialog"]')) return;
      ev.preventDefault();
      setParams({}, { replace: true });
      setVuelta((v) => v + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [puedeCobrar, setParams]);

  const descripcion = !e
    ? 'Cobro en el mostrador, todo con el teclado.'
    : e.caja
      ? `Abierta a las ${hora(e.caja.abiertaEl)} · ${plural(e.caja.cobros, 'cobro', 'cobros')} · ${formatMoney(e.caja.total)}`
      : puedeCobrar
        ? 'La caja está cerrada.'
        : 'Las cajas de cada cajero, con sus cobros y su arqueo.';

  return (
    <>
      <PageHeader
        title="Caja"
        description={descripcion}
        actions={
          e?.caja && puedeCobrar ? (
            <Button variant="secondary" icon={Lock} onClick={() => setCerrando(e.caja)}>
              Cerrar la caja
            </Button>
          ) : undefined
        }
      />

      {puedeCobrar && (
        <div role="tablist" aria-label="Secciones de la caja" className="mb-6 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-linea">
          {VISTAS.filter((v) => v.id !== 'movimientos' || e?.caja).map(({ id, etiqueta, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={vista === id}
              onClick={() => ir(id)}
              className={cn(
                '-mb-px inline-flex min-h-12 shrink-0 items-center gap-2 border-b-2 px-3.5 text-[0.9375rem] font-semibold transition-colors duration-150',
                vista === id ? 'border-marca text-marca-texto' : 'border-transparent text-tinta-suave hover:text-tinta',
              )}
            >
              <Icon className="size-4" aria-hidden />
              {etiqueta}
              {id === 'cobrar' && <Kbd>F2</Kbd>}
            </button>
          ))}
        </div>
      )}

      {consulta.isPending ? (
        <div className="space-y-4">
          <Skeleton className="h-20 rounded-2xl" />
          <Skeleton className="h-72 rounded-2xl" />
        </div>
      ) : consulta.isError || !e ? (
        <ErrorState message={errorMessage(consulta.error)} onRetry={() => void consulta.refetch()} />
      ) : vista === 'cajas' ? (
        <Cajas puedeAnular={e.puedeAnular} propias={puedeCobrar && !e.puedeAnular} />
      ) : !e.caja ? (
        // Mientras se muestra el resultado del cierre, atrás no hay nada que pueda tomar el foco.
        cerrando ? null : (
          <AbrirCaja />
        )
      ) : vista === 'movimientos' ? (
        <Movimientos cajaId={e.caja.id} puedeAnular={e.puedeAnular} />
      ) : (
        <Cobro key={vuelta} socioInicial={vuelta === 0 ? socioInicial : null} />
      )}

      {cerrando && <CerrarCaja caja={cerrando} onClose={() => setCerrando(null)} />}
    </>
  );
}
