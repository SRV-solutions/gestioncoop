// Integridad de los datos: si la cadena de facturas, cobros y registro de cambios está intacta, qué
// encontró la última verificación y el historial. Se verifica sola todos los días y se puede pedir ahora.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LoaderCircle, RefreshCw, ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react';
import {
  ESTADO_VERIFICACION_ETIQUETA,
  LIBRO_INTEGRIDAD_ETIQUETA,
  LIBROS_INTEGRIDAD,
  PROBLEMA_ETIQUETA,
  formatDateTime,
  type EstadoIntegridad,
  type EstadoVerificacion,
  type VerificacionVista,
} from '@shared';
import { api, errorMessage } from '../../lib/api';
import { cn } from '../../lib/cn';
import { Badge, Button, Card, Empty, ErrorState, FormAlert, PageHeader, Skeleton } from '../../components/ui';

const TONO: Record<EstadoVerificacion, 'exito' | 'peligro' | 'alerta' | 'neutral'> = { ok: 'exito', con_problemas: 'peligro', fallida: 'alerta', en_curso: 'neutral' };
const numero = (n: number) => n.toLocaleString('es-AR');

export function IntegridadPage() {
  const qc = useQueryClient();
  const consulta = useQuery({
    queryKey: ['integridad'],
    queryFn: () => api.get<EstadoIntegridad>('/integridad'),
    // Mientras verifica, se consulta seguido para mostrar el resultado apenas termina.
    refetchInterval: (q) => (q.state.data?.ultima?.estado === 'en_curso' ? 2000 : false),
  });
  const verificar = useMutation({
    mutationFn: () => api.post<VerificacionVista>('/integridad/verificar'),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['integridad'] }),
  });
  const e = consulta.data;
  const enCurso = e?.ultima?.estado === 'en_curso';

  return (
    <>
      <PageHeader
        title="Integridad de los datos"
        description="Controla que nadie haya cambiado, borrado o agregado facturas, cobros o registros por fuera de la app."
        actions={
          <Button icon={RefreshCw} loading={verificar.isPending || enCurso} onClick={() => verificar.mutate()}>
            Verificar ahora
          </Button>
        }
      />
      {verificar.isError && (
        <div className="mb-4">
          <FormAlert>{errorMessage(verificar.error)}</FormAlert>
        </div>
      )}
      {consulta.isPending ? (
        <div className="space-y-4">
          <Skeleton className="h-48 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      ) : consulta.isError || !e ? (
        <Card>
          <ErrorState message={errorMessage(consulta.error)} onRetry={() => void consulta.refetch()} />
        </Card>
      ) : (
        <div className="space-y-6">
          <Estado estado={e} />
          {e.ultima && e.ultima.problemas.length > 0 && <Problemas v={e.ultima} />}
          <ComoFunciona proxima={e.proximaAutomatica} />
          {e.historial.length > 0 && <Historial lista={e.historial} />}
        </div>
      )}
    </>
  );
}

function Estado({ estado }: { estado: EstadoIntegridad }) {
  const v = estado.ultima;
  if (!v) {
    return (
      <Card>
        <Empty icon={ShieldQuestion} title="Todavía no se verificó">
          La primera verificación automática corre esta madrugada. Si querés verla ahora, tocá «Verificar ahora».
        </Empty>
      </Card>
    );
  }
  const ok = v.estado === 'ok';
  const Icono = v.estado === 'en_curso' ? LoaderCircle : ok ? ShieldCheck : ShieldAlert;
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-start gap-4">
        <div className={cn('grid size-14 shrink-0 place-items-center rounded-2xl', ok ? 'bg-exito-tenue text-exito' : v.estado === 'en_curso' ? 'bg-marca-tenue text-marca-texto' : 'bg-peligro-tenue text-peligro')}>
          <Icono className={cn('size-7', v.estado === 'en_curso' && 'animate-spin')} aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-bold text-tinta" aria-live="polite">
            {v.estado === 'con_problemas' ? `Encontró ${v.totalProblemas === 1 ? '1 problema' : `${numero(v.totalProblemas)} problemas`}` : ESTADO_VERIFICACION_ETIQUETA[v.estado]}
          </h2>
          <p className="mt-1 text-tinta-suave">
            {v.origen === 'automatica' ? 'Verificación automática' : `Verificación pedida por ${v.usuario ?? 'alguien del equipo'}`} · {formatDateTime(v.iniciadaEl)}
          </p>
          {v.error && <p className="mt-2 font-medium text-alerta">{v.error}</p>}
        </div>
      </div>
      {v.resumen && (
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          {LIBROS_INTEGRIDAD.map((libro) => {
            const r = v.resumen![libro];
            return (
              <div key={libro} className={cn('rounded-xl border px-4 py-3', r.problemas ? 'border-peligro/40 bg-peligro-tenue' : 'border-linea bg-fondo')}>
                <p className="text-sm font-semibold text-tinta">{LIBRO_INTEGRIDAD_ETIQUETA[libro]}</p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-tinta">{numero(r.revisados)}</p>
                <p className={cn('text-sm', r.problemas ? 'font-semibold text-peligro' : 'text-tinta-suave')}>
                  {r.problemas ? `${numero(r.problemas)} con problemas` : 'revisados, todos en orden'}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function Problemas({ v }: { v: VerificacionVista }) {
  return (
    <Card className="p-5 sm:p-6">
      <h2 className="text-lg font-bold text-tinta">Qué encontró</h2>
      <div className="mt-2 rounded-xl bg-alerta-tenue px-4 py-3 text-sm font-medium text-tinta">
        No borres ni corrijas nada todavía: así se puede saber qué pasó, cuándo y quién. SRV ya recibió el aviso.
      </div>
      <ul className="mt-4 divide-y divide-linea">
        {v.problemas.map((p, i) => (
          <li key={`${p.tipo}-${p.referencia}-${i}`} className="flex flex-wrap items-start gap-x-4 gap-y-1 py-3">
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-tinta">{PROBLEMA_ETIQUETA[p.tipo].titulo}</p>
              <p className="text-sm text-tinta-suave">{p.detalle}</p>
            </div>
            <div className="text-right">
              <p className="font-mono text-sm font-semibold text-tinta">{p.referencia}</p>
              <p className="text-xs text-tinta-suave">{LIBRO_INTEGRIDAD_ETIQUETA[p.libro]}</p>
            </div>
          </li>
        ))}
      </ul>
      {v.totalProblemas > v.problemas.length && (
        <p className="mt-2 text-sm text-tinta-suave">
          Se muestran los primeros {numero(v.problemas.length)} de {numero(v.totalProblemas)}.
        </p>
      )}
    </Card>
  );
}

function ComoFunciona({ proxima }: { proxima: string | null }) {
  return (
    <Card className="p-5 sm:p-6">
      <h2 className="text-lg font-bold text-tinta">Cómo funciona</h2>
      <ul className="mt-3 list-disc space-y-1.5 pl-5 text-tinta-suave">
        <li>Cada factura, nota de crédito, recibo y registro de cambios lleva una huella digital que incluye la del anterior, como los eslabones de una cadena.</li>
        <li>Si alguien cambia un importe, borra un comprobante o agrega uno directamente en la base de datos, la cadena se corta justo ahí.</li>
        <li>La huella se firma con una clave que no está en la base: ni con acceso a la base se puede rehacer la cadena para tapar un cambio.</li>
        <li>Además se cruzan saldos, cobros y anulaciones: todo lo que figura anulado tiene que haberse anulado desde la app.</li>
        <li>
          Se verifica sola todos los días{proxima ? ` (la próxima: ${formatDateTime(proxima)})` : ''}. Si encuentra algo, avisa por mail y en la campana a la administración, a la
          gerencia y a SRV.
        </li>
      </ul>
    </Card>
  );
}

function Historial({ lista }: { lista: EstadoIntegridad['historial'] }) {
  return (
    <Card className="p-5 sm:p-6">
      <h2 className="text-lg font-bold text-tinta">Verificaciones anteriores</h2>
      <ul className="mt-3 divide-y divide-linea">
        {lista.map((v) => (
          <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
            <span className="text-tinta">
              {formatDateTime(v.iniciadaEl)} <span className="text-sm text-tinta-suave">· {v.origen === 'automatica' ? 'automática' : (v.usuario ?? 'manual')}</span>
            </span>
            <Badge tone={TONO[v.estado]}>
              {v.estado === 'con_problemas' ? (v.totalProblemas === 1 ? '1 problema' : `${numero(v.totalProblemas)} problemas`) : ESTADO_VERIFICACION_ETIQUETA[v.estado]}
            </Badge>
          </li>
        ))}
      </ul>
    </Card>
  );
}
