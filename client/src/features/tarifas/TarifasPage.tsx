import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Calculator, Layers, Percent, Wifi, type LucideIcon } from 'lucide-react';
import type { TarifasResumen } from '@shared';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { cn } from '../../lib/cn';
import { ErrorState, PageHeader, Skeleton } from '../../components/ui';
import { Conceptos } from './Conceptos';
import { Cuadros } from './Cuadros';
import { PlanesYMora } from './PlanesYMora';
import { Simulador } from './Simulador';

const VISTAS = [
  { id: 'cuadros', etiqueta: 'Cuadros tarifarios', icon: Layers },
  { id: 'conceptos', etiqueta: 'Impuestos y cargos', icon: Percent },
  { id: 'planes', etiqueta: 'Planes y mora', icon: Wifi },
  { id: 'simulador', etiqueta: 'Simulador', icon: Calculator },
] as const satisfies readonly { id: string; etiqueta: string; icon: LucideIcon }[];
type Vista = (typeof VISTAS)[number]['id'];

export function TarifasPage() {
  const { hasRole } = useAuth();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const pedida = params.get('vista');
  const vista: Vista = VISTAS.find((v) => v.id === pedida)?.id ?? 'cuadros';

  const consulta = useQuery({ queryKey: ['tarifas'], queryFn: () => api.get<TarifasResumen>('/tarifas') });
  const puedeEditar = hasRole('admin') || hasRole('superadmin');
  /** Después de un cambio: se vuelven a pedir las tarifas y se descartan las simulaciones viejas. */
  const alCambiar = () => {
    void qc.invalidateQueries({ queryKey: ['tarifas'] });
    qc.removeQueries({ queryKey: ['simulacion'] });
  };

  return (
    <>
      <PageHeader
        title="Tarifas"
        description={
          puedeEditar
            ? 'Qué se cobra y desde cuándo. Cada cambio queda con su fecha: las facturas ya emitidas no se tocan.'
            : 'Qué se cobra y desde cuándo. Solo administración puede cambiarlas.'
        }
      />

      <div role="tablist" aria-label="Secciones de tarifas" className="mb-6 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-linea">
        {VISTAS.map((v) => (
          <button
            key={v.id}
            type="button"
            role="tab"
            id={`pestana-${v.id}`}
            aria-selected={vista === v.id}
            aria-controls="panel-tarifas"
            onClick={() => setParams(v.id === 'cuadros' ? {} : { vista: v.id }, { replace: true })}
            className={cn(
              '-mb-px inline-flex min-h-12 shrink-0 items-center gap-2 border-b-2 px-3.5 text-[0.9375rem] font-semibold transition-colors duration-150',
              vista === v.id ? 'border-marca text-marca-texto' : 'border-transparent text-tinta-suave hover:text-tinta',
            )}
          >
            <v.icon className="size-4" aria-hidden />
            {v.etiqueta}
          </button>
        ))}
      </div>

      <div role="tabpanel" id="panel-tarifas" aria-labelledby={`pestana-${vista}`}>
        {consulta.isPending ? (
          <div className="grid gap-4 xl:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-64 rounded-2xl" />
            ))}
          </div>
        ) : consulta.isError ? (
          <ErrorState message={errorMessage(consulta.error)} onRetry={() => void consulta.refetch()} />
        ) : vista === 'cuadros' ? (
          <Cuadros datos={consulta.data} puedeEditar={puedeEditar} alCambiar={alCambiar} />
        ) : vista === 'conceptos' ? (
          <Conceptos datos={consulta.data} puedeEditar={puedeEditar} alCambiar={alCambiar} />
        ) : vista === 'planes' ? (
          <PlanesYMora datos={consulta.data} puedeEditar={puedeEditar} alCambiar={alCambiar} />
        ) : (
          <Simulador datos={consulta.data} />
        )}
      </div>
    </>
  );
}
