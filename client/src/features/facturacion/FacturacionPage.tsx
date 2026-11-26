// Facturación del mes como asistente de 4 pasos (SPEC 6.5): abrir la lectura → controlarla →
// pre-facturar y revisar → emitir. Cada paso muestra una sola decisión; lo largo (calcular y
// emitir) corre en segundo plano con su barra de avance. Aparte, el buscador de comprobantes.
import { useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CircleAlert, CircleCheck, FileSearch, FileText, Info, LoaderCircle, PartyPopper, Search, Send, type LucideIcon } from 'lucide-react';
import {
  ESTADOS_COMPROBANTE,
  formatCantidad,
  formatComprobante,
  formatDate,
  formatMoney,
  formatNumber,
  nombreDeMes,
  SERVICIOS_CONEXION,
  UNIDAD_SERVICIO,
  type ControlCierre,
  type EstadoFacturacion,
  type ProcesoFacturacion,
  type ResumenServicio,
  type ServicioConCuadro,
} from '@shared';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { cn } from '../../lib/cn';
import { Confirm } from '../../components/Modal';
import { SERVICIO_CORTO, SERVICIO_ICON } from '../../components/servicios';
import { Button, Card, Empty, ErrorState, FormAlert, PageHeader, Skeleton } from '../../components/ui';
import { ListaComprobantes, type FiltroComprobantes } from './Comprobantes';

const sumarDias = (fecha: string, dias: number) => new Date(new Date(`${fecha}T12:00:00Z`).getTime() + dias * 86_400_000).toISOString().slice(0, 10);
const mayuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const plural = (n: number, uno: string, varios: string) => `${formatNumber(n)} ${n === 1 ? uno : varios}`;

export function FacturacionPage() {
  const { hasRole } = useAuth();
  const [params, setParams] = useSearchParams();
  const vista = params.get('vista') === 'comprobantes' ? 'comprobantes' : 'mes';
  const puedeOperar = hasRole('admin') || hasRole('facturacion') || hasRole('superadmin');

  const consulta = useQuery({
    queryKey: ['facturacion', 'estado'],
    queryFn: () => api.get<EstadoFacturacion>('/facturacion/estado'),
    // Con un trabajo en marcha se sigue de cerca; con la lectura abierta, cada tanto (entran lecturas del teléfono).
    refetchInterval: (q) => (q.state.data?.proceso?.estado === 'en_curso' ? 700 : q.state.data?.mes?.estado === 'en_lectura' ? 10_000 : false),
  });
  const e = consulta.data;

  return (
    <>
      <PageHeader title="Facturación" description={e?.mes ? `${mayuscula(nombreDeMes(e.mes.anio, e.mes.mes))} · energía, agua, internet y TV` : 'Del control de lecturas a la emisión del mes.'} />

      <div role="tablist" aria-label="Secciones de facturación" className="mb-6 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-linea">
        {(
          [
            ['mes', 'Facturar el mes', Send],
            ['comprobantes', 'Comprobantes', FileSearch],
          ] as const
        ).map(([id, etiqueta, Icon]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={vista === id}
            onClick={() => setParams(id === 'mes' ? {} : { vista: id }, { replace: true })}
            className={cn(
              '-mb-px inline-flex min-h-12 shrink-0 items-center gap-2 border-b-2 px-3.5 text-[0.9375rem] font-semibold transition-colors duration-150',
              vista === id ? 'border-marca text-marca-texto' : 'border-transparent text-tinta-suave hover:text-tinta',
            )}
          >
            <Icon className="size-4" aria-hidden />
            {etiqueta}
          </button>
        ))}
      </div>

      {consulta.isPending ? (
        <div className="space-y-4">
          <Skeleton className="h-20 rounded-2xl" />
          <Skeleton className="h-72 rounded-2xl" />
        </div>
      ) : consulta.isError || !e ? (
        <ErrorState message={errorMessage(consulta.error)} onRetry={() => void consulta.refetch()} />
      ) : vista === 'comprobantes' ? (
        <Buscador estado={e} puedeOperar={puedeOperar} />
      ) : (
        <Asistente estado={e} puedeOperar={puedeOperar} />
      )}
    </>
  );
}

/* ───────────────────────── Los 4 pasos ───────────────────────── */

const PASOS = ['Abrir la lectura', 'Controlar lecturas', 'Pre-facturar y revisar', 'Emitir'];

function Pasos({ actual, terminado }: { actual: number; terminado: boolean }) {
  return (
    <ol className="mb-6 grid gap-2 sm:grid-cols-4">
      {PASOS.map((nombre, i) => {
        const n = i + 1;
        const hecho = n < actual || terminado;
        const enCurso = n === actual && !terminado;
        return (
          <li
            key={nombre}
            aria-current={enCurso ? 'step' : undefined}
            className={cn(
              'flex items-center gap-3 rounded-xl border px-3.5 py-2.5',
              enCurso ? 'border-marca bg-marca-tenue' : 'border-linea bg-superficie',
            )}
          >
            <span
              className={cn(
                'grid size-8 shrink-0 place-items-center rounded-full text-sm font-bold',
                hecho ? 'bg-exito text-sobre-estado' : enCurso ? 'bg-marca text-white' : 'bg-fondo text-tinta-suave',
              )}
            >
              {hecho ? <Check className="size-4" aria-hidden /> : n}
            </span>
            <span className={cn('text-[0.9375rem] font-semibold leading-tight', enCurso ? 'text-marca-texto' : hecho ? 'text-tinta' : 'text-tinta-suave')}>
              {nombre}
              <span className="sr-only">{hecho ? ' (hecho)' : enCurso ? ' (paso actual)' : ''}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Asistente({ estado: e, puedeOperar }: { estado: EstadoFacturacion; puedeOperar: boolean }) {
  const qc = useQueryClient();
  const refrescar = () => void qc.invalidateQueries({ queryKey: ['facturacion'] });
  const abrir = useMutation({ mutationFn: (p: { anio: number; mes: number }) => api.post('/lecturas/periodos', p), onSuccess: refrescar });
  const [confirmarApertura, setConfirmarApertura] = useState(false);

  const proximo = nombreDeMes(e.proximo.anio, e.proximo.mes);
  const apertura = confirmarApertura && (
    <Confirm
      title={`Abrir la lectura de ${proximo}`}
      confirmLabel="Abrir la lectura"
      variant="primary"
      loading={abrir.isPending}
      error={abrir.isError ? errorMessage(abrir.error) : null}
      onConfirm={() => abrir.mutate(e.proximo, { onSuccess: () => setConfirmarApertura(false) })}
      onClose={() => setConfirmarApertura(false)}
    >
      <p>Se abre para energía y agua. Desde ese momento cada operario ve sus rutas en el teléfono y puede empezar a cargar.</p>
      {e.mes && <p className="text-tinta-suave">{mayuscula(nombreDeMes(e.mes.anio, e.mes.mes))} queda cerrado.</p>}
    </Confirm>
  );

  if (!e.mes) {
    return (
      <>
        <Pasos actual={1} terminado={false} />
        <Card>
          <Empty
            icon={FileText}
            title="Todavía no se abrió ninguna lectura"
            action={puedeOperar ? <Button onClick={() => setConfirmarApertura(true)}>Abrir la lectura de {proximo}</Button> : undefined}
          >
            La facturación de cada mes empieza abriendo su lectura: los operarios cargan los medidores y después se calcula todo.
          </Empty>
        </Card>
        {apertura}
      </>
    );
  }

  const mes = nombreDeMes(e.mes.anio, e.mes.mes);
  const trabajando = e.proceso?.estado === 'en_curso';
  const paso = e.mes.estado === 'en_lectura' || e.mes.estado === 'abierto' ? 2 : e.mes.estado === 'prefacturado' ? (e.proceso?.tipo === 'emision' && trabajando ? 4 : 3) : 4;
  const terminado = e.mes.estado === 'emitido' || e.mes.estado === 'cerrado';

  return (
    <>
      <Pasos actual={paso} terminado={terminado} />
      {trabajando ? (
        <Avance proceso={e.proceso!} mes={mes} />
      ) : terminado ? (
        <Emitido estado={e} puedeOperar={puedeOperar} alAbrir={() => (abrir.reset(), setConfirmarApertura(true))} />
      ) : e.mes.estado === 'prefacturado' ? (
        <Prefactura estado={e} puedeOperar={puedeOperar} alCambiar={refrescar} />
      ) : (
        <Control estado={e} control={e.control!} puedeOperar={puedeOperar} alCambiar={refrescar} />
      )}
      {apertura}
    </>
  );
}

/* ───────────────────────── Trabajo en marcha ───────────────────────── */

function Avance({ proceso: p, mes }: { proceso: ProcesoFacturacion; mes: string }) {
  const emision = p.tipo === 'emision';
  const parte = p.total ? (p.hechas / p.total) * 100 : 0;
  return (
    <Card className="px-6 py-8" >
      <div role="status" aria-live="polite" className="mx-auto max-w-xl text-center">
        <LoaderCircle className="mx-auto size-8 animate-spin text-marca-texto" aria-hidden />
        <h2 className="mt-3 text-xl font-bold text-tinta">{emision ? `Emitiendo las facturas de ${mes}` : `Calculando las facturas de ${mes}`}</h2>
        <p className="mt-1 text-tinta-suave">
          {p.total ? `${formatNumber(p.hechas)} de ${formatNumber(p.total)}` : 'Preparando…'} · podés dejar esta pantalla: sigue solo.
        </p>
        <div role="progressbar" aria-label={emision ? 'Avance de la emisión' : 'Avance del cálculo'} aria-valuemin={0} aria-valuemax={p.total} aria-valuenow={p.hechas} className="mt-5 h-3.5 overflow-hidden rounded-full bg-linea">
          <div className="h-full rounded-full bg-marca transition-[width] duration-500" style={{ width: `${parte}%` }} />
        </div>
        <p className="mt-2 text-sm font-bold tabular-nums text-marca-texto">{Math.floor(parte)} %</p>
      </div>
    </Card>
  );
}

/** Un trabajo que se cortó: qué pasó y cómo seguir. */
function Fallo({ proceso, children }: { proceso: ProcesoFacturacion | null; children?: ReactNode }) {
  if (proceso?.estado !== 'fallido') return null;
  return (
    <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-peligro bg-peligro-tenue px-5 py-4">
      <p className="flex items-start gap-2.5 text-sm font-medium text-tinta">
        <CircleAlert className="mt-0.5 size-5 shrink-0 text-peligro" aria-hidden />
        <span>
          {proceso.tipo === 'emision' ? 'La emisión se interrumpió' : 'El cálculo se interrumpió'}
          {proceso.total > 0 && ` en ${formatNumber(proceso.hechas)} de ${formatNumber(proceso.total)}`}. {proceso.error}
        </span>
      </p>
      {children}
    </div>
  );
}

/* ───────────────────────── Paso 2: controlar la lectura ───────────────────────── */

type Tono = 'bien' | 'frena' | 'aviso';
const TONO: Record<Tono, { icon: LucideIcon; clase: string }> = {
  bien: { icon: CircleCheck, clase: 'text-exito' },
  frena: { icon: CircleAlert, clase: 'text-peligro' },
  aviso: { icon: Info, clase: 'text-alerta' },
};

function Chequeo({ tono, titulo, children, acciones }: { tono: Tono; titulo: string; children?: ReactNode; acciones?: ReactNode }) {
  const { icon: Icon, clase } = TONO[tono];
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4">
      <Icon className={cn('size-6 shrink-0', clase)} aria-hidden />
      <div className="min-w-0 flex-1 basis-64">
        <p className="font-semibold text-tinta">{titulo}</p>
        {children && <p className="mt-0.5 text-sm text-tinta-suave">{children}</p>}
      </div>
      {acciones && <div className="flex flex-wrap items-center gap-2">{acciones}</div>}
    </li>
  );
}

const enlace = 'inline-flex min-h-11 items-center rounded-lg border border-linea bg-superficie px-4 text-[0.9375rem] font-semibold text-tinta transition-colors duration-150 hover:border-marca hover:text-marca-texto';

function Control({ estado: e, control: c, puedeOperar, alCambiar }: { estado: EstadoFacturacion; control: ControlCierre; puedeOperar: boolean; alCambiar: () => void }) {
  const mes = nombreDeMes(e.mes!.anio, e.mes!.mes);
  const [confirmar, setConfirmar] = useState<'estimar' | 'cerrar' | null>(null);
  const estimar = useMutation({
    mutationFn: () => api.post<{ estimadas: number }>('/lecturas/estimar-pendientes'),
    onSuccess: () => {
      setConfirmar(null);
      alCambiar();
    },
  });
  const cerrar = useMutation({
    mutationFn: () => api.post('/facturacion/prefacturar'),
    onSuccess: () => {
      setConfirmar(null);
      alCambiar();
    },
  });
  const avance = c.total ? (c.leidos / c.total) * 100 : 0;
  const listo = c.bloqueantes === 0 && c.total > 0;
  const porMirar = c.anomalias + c.novedades;

  return (
    <>
      <Fallo proceso={e.proceso} />
      <Card className="overflow-hidden">
        <div className="border-b border-linea px-5 py-5">
          <p className="text-sm font-semibold text-tinta-suave">Medidores con lectura</p>
          <p className="mt-1 text-tinta">
            <span className="text-3xl font-black tabular-nums">{formatNumber(c.leidos)}</span>
            <span className="text-lg font-semibold text-tinta-suave"> de {formatNumber(c.total)}</span>
            <span className="ml-2 text-lg font-bold text-marca-texto">{Math.floor(avance)} %</span>
          </p>
          <div role="progressbar" aria-label="Medidores con lectura" aria-valuemin={0} aria-valuemax={c.total} aria-valuenow={c.leidos} className="mt-2 h-3 overflow-hidden rounded-full bg-linea">
            <div className={cn('h-full rounded-full transition-[width] duration-500', listo ? 'bg-exito' : 'bg-marca')} style={{ width: `${avance}%` }} />
          </div>
        </div>

        <ul className="divide-y divide-linea">
          {c.estimables > 0 ? (
            <Chequeo
              tono="frena"
              titulo={`Faltan ${plural(c.estimables, 'medidor', 'medidores')} por leer`}
              acciones={
                <>
                  <Link to="/lecturas" className={enlace}>
                    Ver el avance
                  </Link>
                  {puedeOperar && (
                    <Button variant="secondary" onClick={() => (estimar.reset(), setConfirmar('estimar'))}>
                      Estimar {c.estimables === 1 ? 'el que falta' : `los ${formatNumber(c.estimables)}`}
                    </Button>
                  )}
                </>
              }
            >
              Los operarios todavía pueden cargarlos desde el teléfono. Los que no se vayan a leer se estiman con el promedio de los últimos 6 meses.
            </Chequeo>
          ) : (
            <Chequeo tono="bien" titulo="No falta leer ningún medidor">
              {c.estimadas > 0 ? `${plural(c.estimadas, 'lectura es estimada', 'lecturas son estimadas')}: su factura sale marcada y se ajusta con la próxima lectura real.` : 'Todas las lecturas son reales.'}
            </Chequeo>
          )}

          {c.sinResolver > 0 && (
            <Chequeo
              tono="frena"
              titulo={`${plural(c.sinResolver, 'lectura dio', 'lecturas dieron')} menos que la anterior y falta aclarar por qué`}
              acciones={
                <Link to="/lecturas" className={enlace}>
                  Resolver en Lecturas
                </Link>
              }
            >
              Hay que decir si fue una vuelta de contador o un cambio de medidor: sin eso no se puede calcular el consumo.
            </Chequeo>
          )}

          {c.sinHistorial > 0 && (
            <Chequeo tono="aviso" titulo={`${plural(c.sinHistorial, 'medidor nuevo', 'medidores nuevos')} sin lectura`}>
              No tienen historial para estimar. Si no se leen, se cobran solo los cargos fijos y la factura queda separada para revisar.
            </Chequeo>
          )}

          {porMirar > 0 ? (
            <Chequeo
              tono="aviso"
              titulo={`${plural(porMirar, 'lectura', 'lecturas')} para mirar antes de cerrar`}
              acciones={
                <Link to="/lecturas" className={enlace}>
                  Revisarlas
                </Link>
              }
            >
              {[c.anomalias > 0 && plural(c.anomalias, 'consumo raro', 'consumos raros'), c.novedades > 0 && plural(c.novedades, 'novedad de los operarios', 'novedades de los operarios')].filter(Boolean).join(' y ')}. No frenan el cierre.
            </Chequeo>
          ) : (
            <Chequeo tono="bien" titulo="No quedan lecturas raras ni novedades sin revisar" />
          )}
        </ul>

        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-linea bg-fondo/60 px-5 py-4">
          <p className="max-w-xl text-sm text-tinta-suave">
            {!puedeOperar
              ? 'Facturación o administración cierran la lectura cuando está completa.'
              : listo
                ? 'Está todo para cerrar. Vas a ver cada factura calculada antes de emitir nada.'
                : 'Para cerrar la lectura, primero resolvé lo marcado en rojo.'}
          </p>
          {puedeOperar && (
            <Button size="lg" disabled={!listo} onClick={() => (cerrar.reset(), setConfirmar('cerrar'))}>
              Cerrar la lectura y calcular
            </Button>
          )}
        </div>
      </Card>

      {confirmar === 'estimar' && (
        <Confirm
          title={`Estimar ${plural(c.estimables, 'lectura', 'lecturas')}`}
          confirmLabel="Estimar"
          variant="primary"
          loading={estimar.isPending}
          error={estimar.isError ? errorMessage(estimar.error) : null}
          onConfirm={() => estimar.mutate()}
          onClose={() => setConfirmar(null)}
        >
          <p>A cada medidor sin leer se le pone la lectura anterior más su consumo promedio de los últimos 6 meses.</p>
          <p className="text-tinta-suave">La factura sale marcada como estimada y se ajusta sola con la próxima lectura real. Si el operario llega a cargar una lectura antes del cierre, reemplaza a la estimación.</p>
        </Confirm>
      )}
      {confirmar === 'cerrar' && (
        <Confirm
          title={`Cerrar la lectura de ${mes}`}
          confirmLabel="Cerrar y calcular"
          variant="primary"
          loading={cerrar.isPending}
          error={cerrar.isError ? errorMessage(cerrar.error) : null}
          onConfirm={() => cerrar.mutate()}
          onClose={() => setConfirmar(null)}
        >
          <p>Los operarios ya no van a poder cargar lecturas de {mes}, y el sistema calcula la factura de cada servicio.</p>
          <p className="text-tinta-suave">Todavía no se emite nada: primero las revisás. Si hace falta, la lectura se puede reabrir.</p>
        </Confirm>
      )}
    </>
  );
}

/* ───────────────────────── Paso 3: pre-facturar y revisar ───────────────────────── */

function Indicador({ titulo, valor, ayuda, tono }: { titulo: string; valor: string; ayuda?: string; tono?: 'alerta' | 'bien' }) {
  return (
    <Card className="px-5 py-4">
      <p className="text-sm font-semibold text-tinta-suave">{titulo}</p>
      <p className={cn('mt-1 text-2xl font-black tabular-nums', tono === 'alerta' ? 'text-alerta' : tono === 'bien' ? 'text-exito' : 'text-tinta')}>{valor}</p>
      {ayuda && <p className="mt-1 text-sm text-tinta-suave">{ayuda}</p>}
    </Card>
  );
}

function PorServicio({ filas }: { filas: ResumenServicio[] }) {
  return (
    <Card className="overflow-hidden">
      <table className="w-full text-[0.9375rem]">
        <thead>
          <tr className="border-b border-linea text-left text-xs font-semibold uppercase tracking-wide text-tinta-suave">
            <th scope="col" className="px-5 py-2.5">Servicio</th>
            <th scope="col" className="px-3 py-2.5 text-right">Facturas</th>
            <th scope="col" className="hidden px-3 py-2.5 text-right sm:table-cell">Consumo</th>
            <th scope="col" className="px-5 py-2.5 text-right">Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-linea">
          {filas.map((f) => {
            const Icon = SERVICIO_ICON[f.servicio];
            const unidad = UNIDAD_SERVICIO[f.servicio as ServicioConCuadro];
            return (
              <tr key={f.servicio}>
                <th scope="row" className="px-5 py-3 text-left font-semibold text-tinta">
                  <span className="flex items-center gap-2.5">
                    <Icon className="size-4 text-marca-texto" aria-hidden />
                    {SERVICIO_CORTO[f.servicio]}
                  </span>
                </th>
                <td className="px-3 py-3 text-right tabular-nums text-tinta">{formatNumber(f.cantidad)}</td>
                <td className="hidden px-3 py-3 text-right tabular-nums text-tinta-suave sm:table-cell">{f.consumo !== null && f.servicio !== 'sepelio' ? `${formatCantidad(Math.round(Number(f.consumo)))} ${unidad}` : '—'}</td>
                <td className="px-5 py-3 text-right font-semibold tabular-nums text-tinta">{formatMoney(f.total)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

type VistaRevision = 'por_revisar' | 'raras' | 'todas';

function Prefactura({ estado: e, puedeOperar, alCambiar }: { estado: EstadoFacturacion; puedeOperar: boolean; alCambiar: () => void }) {
  const p = e.prefactura!;
  const { anio, mes: numeroMes } = e.mes!;
  const mes = nombreDeMes(anio, numeroMes);
  const [vista, setVista] = useState<VistaRevision>('por_revisar');
  const [confirmar, setConfirmar] = useState<'emitir' | 'recalcular' | 'reabrir' | null>(null);
  const cerrarYRefrescar = () => {
    setConfirmar(null);
    alCambiar();
  };
  const emitir = useMutation({ mutationFn: () => api.post('/facturacion/emitir'), onSuccess: cerrarYRefrescar });
  const recalcular = useMutation({ mutationFn: () => api.post('/facturacion/prefacturar'), onSuccess: cerrarYRefrescar });
  const reabrir = useMutation({ mutationFn: () => api.post('/facturacion/reabrir'), onSuccess: cerrarYRefrescar });

  // Una emisión que se cortó a mitad de camino: ya hay facturas con número y quedan pre-facturas por emitir.
  const aMedias = e.emision !== null && e.emision.cantidad > 0;
  const aEmitir = p.cantidad - p.errores;
  const version = `${p.calculadaEl}|${p.cantidad}|${p.rarasSinRevisar}`;
  const filtro: FiltroComprobantes = { anio, mes: numeroMes, estado: 'borrador', vista };
  const chips: { id: VistaRevision; etiqueta: string; cantidad: number }[] = [
    { id: 'por_revisar', etiqueta: 'Sin revisar', cantidad: p.rarasSinRevisar },
    { id: 'raras', etiqueta: 'Todas las raras', cantidad: p.raras },
    { id: 'todas', etiqueta: 'Todas', cantidad: p.cantidad },
  ];

  return (
    <>
      <Fallo proceso={e.proceso} />
      {aMedias && (
        <p role="status" className="mb-4 flex items-start gap-2.5 rounded-2xl bg-acento-tenue px-5 py-4 text-sm font-medium text-tinta">
          <Info className="mt-0.5 size-5 shrink-0 text-alerta" aria-hidden />
          Ya se emitieron {plural(e.emision!.cantidad, 'factura', 'facturas')} de {mes} y quedan {formatNumber(aEmitir)} por emitir. Al continuar, la numeración sigue donde quedó.
        </p>
      )}

      {p.cantidad === 0 ? (
        <Card>
          <Empty icon={FileText} title="No hay pre-facturas calculadas" action={puedeOperar ? <Button loading={recalcular.isPending} onClick={() => recalcular.mutate()}>Calcular ahora</Button> : undefined}>
            La lectura de {mes} está cerrada pero el cálculo no llegó a terminar.
          </Empty>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Indicador titulo={aMedias ? 'Falta emitir' : 'Facturas a emitir'} valor={formatNumber(aEmitir)} ayuda={p.estimadas ? `${plural(p.estimadas, 'estimada', 'estimadas')}` : 'Ninguna estimada'} />
            <Indicador titulo="Total a facturar" valor={formatMoney(p.total, { cents: false })} ayuda={`Vencen el ${formatDate(sumarDias(e.hoy, e.diasVencimiento))} si se emiten hoy`} />
            <Indicador
              titulo="Para revisar"
              valor={formatNumber(p.rarasSinRevisar)}
              tono={p.rarasSinRevisar ? 'alerta' : 'bien'}
              ayuda={p.raras ? `de ${plural(p.raras, 'factura rara', 'facturas raras')}` : 'Ninguna cambió más del 50 %'}
            />
            <Indicador titulo="No se pudieron calcular" valor={formatNumber(p.errores)} tono={p.errores ? 'alerta' : 'bien'} ayuda={p.errores ? 'Hay que resolverlas antes de emitir' : 'Todas se calcularon bien'} />
          </div>

          {p.errores > 0 && (
            <section aria-labelledby="titulo-errores" className="mt-6">
              <h2 id="titulo-errores" className="mb-2 text-sm font-semibold uppercase tracking-wide text-peligro">
                No se pudieron calcular
              </h2>
              <ListaComprobantes
                filtro={{ anio, mes: numeroMes, estado: 'borrador', vista: 'errores' }}
                hoy={e.hoy}
                version={version}
                puedeOperar={puedeOperar}
                vacio={{ titulo: 'Nada por acá', texto: 'Todas las facturas se calcularon bien.' }}
              />
              <p className="mt-2 text-sm text-tinta-suave">Cada una dice qué le falta (un plan, un cuadro tarifario…). Corregilo y tocá «Volver a calcular».</p>
            </section>
          )}

          <section aria-labelledby="titulo-revision" className="mt-6">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 id="titulo-revision" className="text-sm font-semibold uppercase tracking-wide text-tinta-suave">
                Revisión
              </h2>
              <div role="group" aria-label="Qué pre-facturas mostrar" className="flex flex-wrap gap-2">
                {chips.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={vista === c.id}
                    onClick={() => setVista(c.id)}
                    className={cn(
                      'inline-flex min-h-11 items-center gap-2 rounded-xl border px-3.5 text-[0.9375rem] font-semibold transition-colors duration-150',
                      vista === c.id ? 'border-marca bg-marca text-white' : 'border-linea bg-superficie text-tinta hover:border-marca hover:text-marca-texto',
                    )}
                  >
                    {c.etiqueta}
                    <span className={cn('rounded-full px-2 py-0.5 text-xs font-bold tabular-nums', vista === c.id ? 'bg-white/20' : 'bg-fondo text-tinta-suave')}>{formatNumber(c.cantidad)}</span>
                  </button>
                ))}
              </div>
            </div>
            <ListaComprobantes
              filtro={filtro}
              hoy={e.hoy}
              version={version}
              puedeOperar={puedeOperar}
              vacio={
                vista === 'por_revisar'
                  ? { titulo: 'No queda nada por revisar', texto: p.raras ? 'Ya miraste todas las facturas raras.' : 'Ninguna factura cambió más del 50 % contra el mes pasado ni dio cero.' }
                  : { titulo: 'Nada por acá', texto: 'No hay pre-facturas en esta vista.' }
              }
            />
          </section>

          <h2 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wide text-tinta-suave">Por servicio</h2>
          <PorServicio filas={p.porServicio} />
        </>
      )}

      {puedeOperar && p.cantidad > 0 && (
        <Card className="sticky bottom-3 mt-6 flex flex-wrap items-center justify-between gap-3 px-5 py-4 shadow-lg shadow-black/10">
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => (recalcular.reset(), setConfirmar('recalcular'))}>
              Volver a calcular
            </Button>
            {!aMedias && (
              <Button variant="ghost" onClick={() => (reabrir.reset(), setConfirmar('reabrir'))}>
                Reabrir la lectura
              </Button>
            )}
          </div>
          <Button size="lg" icon={Send} disabled={p.errores > 0 || aEmitir === 0} onClick={() => (emitir.reset(), setConfirmar('emitir'))}>
            {aMedias ? 'Continuar la emisión' : `Emitir ${plural(aEmitir, 'factura', 'facturas')}`}
          </Button>
        </Card>
      )}

      {confirmar === 'emitir' && (
        <Confirm
          title={`Emitir las facturas de ${mes}`}
          confirmLabel={`Emitir ${plural(aEmitir, 'factura', 'facturas')}`}
          variant="primary"
          loading={emitir.isPending}
          error={emitir.isError ? errorMessage(emitir.error) : null}
          onConfirm={() => emitir.mutate()}
          onClose={() => setConfirmar(null)}
        >
          <p>
            Se numeran {plural(aEmitir, 'factura', 'facturas')} por <strong className="tabular-nums">{formatMoney(p.total)}</strong> y quedan como deuda de cada socio.
          </p>
          <p>
            Fecha de emisión: <strong>{formatDate(e.hoy)}</strong> · Vencimiento: <strong>{formatDate(sumarDias(e.hoy, e.diasVencimiento))}</strong>
          </p>
          {p.rarasSinRevisar > 0 && <FormAlert>Todavía hay {plural(p.rarasSinRevisar, 'factura rara', 'facturas raras')} sin revisar.</FormAlert>}
          <p className="text-tinta-suave">Una factura emitida no se edita: si después hay que corregir alguna, se anula con una nota de crédito.</p>
        </Confirm>
      )}
      {confirmar === 'recalcular' && (
        <Confirm
          title="Volver a calcular"
          confirmLabel="Calcular de nuevo"
          variant="primary"
          loading={recalcular.isPending}
          error={recalcular.isError ? errorMessage(recalcular.error) : null}
          onConfirm={() => recalcular.mutate()}
          onClose={() => setConfirmar(null)}
        >
          <p>Se descartan las pre-facturas y se calculan otra vez con las tarifas y los datos del padrón como están ahora.</p>
          <p className="text-tinta-suave">Las que ya habías marcado como revisadas vuelven a aparecer para revisar.</p>
        </Confirm>
      )}
      {confirmar === 'reabrir' && (
        <Confirm
          title={`Reabrir la lectura de ${mes}`}
          confirmLabel="Reabrir la lectura"
          loading={reabrir.isPending}
          error={reabrir.isError ? errorMessage(reabrir.error) : null}
          onConfirm={() => reabrir.mutate()}
          onClose={() => setConfirmar(null)}
        >
          <p>Se borran las pre-facturas y los operarios vuelven a poder cargar o corregir lecturas de {mes}.</p>
          <p className="text-tinta-suave">Las lecturas no se tocan. Cuando esté lista, se cierra y se calcula de nuevo.</p>
        </Confirm>
      )}
    </>
  );
}

/* ───────────────────────── Paso 4: emitido ───────────────────────── */

function Emitido({ estado: e, puedeOperar, alAbrir }: { estado: EstadoFacturacion; puedeOperar: boolean; alAbrir: () => void }) {
  const { anio, mes: numeroMes, estado } = e.mes!;
  const mes = nombreDeMes(anio, numeroMes);
  const em = e.emision;
  if (!em) {
    return (
      <Card>
        <Empty icon={FileText} title={`${mayuscula(mes)} no tiene facturas`}>
          El mes quedó cerrado sin facturas emitidas.
        </Empty>
      </Card>
    );
  }
  return (
    <>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-4 border-b border-linea bg-exito-tenue px-5 py-5">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-exito text-sobre-estado">
            <PartyPopper className="size-6" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-bold text-tinta">{mayuscula(mes)} está emitido</h2>
            <p className="mt-0.5 text-tinta">
              {plural(em.cantidad, 'factura', 'facturas')} por <strong className="tabular-nums">{formatMoney(em.total)}</strong>
              {em.emitidaEl && ` · emitidas el ${formatDate(em.emitidaEl)}`}
              {em.segundos !== null && ` en ${formatNumber(em.segundos, em.segundos < 10 ? 1 : 0)} s`}
              {em.venceEl && ` · vencen el ${formatDate(em.venceEl)}`}
            </p>
          </div>
          {puedeOperar && estado === 'emitido' && (
            <Button size="lg" onClick={alAbrir}>
              Abrir la lectura de {nombreDeMes(e.proximo.anio, e.proximo.mes)}
            </Button>
          )}
        </div>
        <dl className="grid gap-x-8 gap-y-3 px-5 py-4 text-[0.9375rem] sm:grid-cols-2">
          <div>
            <dt className="text-sm font-semibold text-tinta-suave">Numeración usada</dt>
            <dd className="mt-0.5 space-y-0.5 tabular-nums text-tinta">
              {em.rangos.map((r) => (
                <p key={r.letra}>
                  {formatComprobante(r.letra, r.puntoVenta, r.desde)} <span className="text-tinta-suave">a</span> {String(r.hasta).padStart(8, '0')}
                </p>
              ))}
            </dd>
          </div>
          <div>
            <dt className="text-sm font-semibold text-tinta-suave">Avisos a los socios</dt>
            <dd className="mt-0.5 text-tinta">
              {em.avisos > 0 ? `${plural(em.avisos, 'aviso quedó listo', 'avisos quedaron listos')} para los socios con email.` : 'Ningún socio tiene email cargado.'}{' '}
              <span className="text-tinta-suave">En la demo no se envían.</span>
            </dd>
          </div>
        </dl>
      </Card>

      <h2 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wide text-tinta-suave">Por servicio</h2>
      <PorServicio filas={em.porServicio} />

      <p className="mt-4 text-sm text-tinta-suave">
        Para ver una factura, su PDF o anularla con nota de crédito, buscala en{' '}
        <Link to="/facturacion?vista=comprobantes" className="font-semibold text-marca-texto underline-offset-2 hover:underline">
          Comprobantes
        </Link>
        .
      </p>
    </>
  );
}

/* ───────────────────────── Buscador de comprobantes ───────────────────────── */

const campo = 'min-h-11 rounded-xl border border-linea bg-superficie px-3 text-[0.9375rem] text-tinta hover:border-marca-claro focus:border-marca';
const ESTADO_FILTRO: Record<(typeof ESTADOS_COMPROBANTE)[number], string> = { borrador: 'Pre-facturas', emitido: 'Sin pagar', pagado: 'Pagadas', anulado: 'Anuladas' };

function Buscador({ estado: e, puedeOperar }: { estado: EstadoFacturacion; puedeOperar: boolean }) {
  const [texto, setTexto] = useState('');
  const [q, setQ] = useState('');
  const [periodo, setPeriodo] = useState('');
  const [servicio, setServicio] = useState('');
  const [estadoFiltro, setEstadoFiltro] = useState('');

  // Los últimos 13 meses, del más nuevo al más viejo.
  const base = e.mes ?? { anio: Number(e.hoy.slice(0, 4)), mes: Number(e.hoy.slice(5, 7)) };
  const meses = Array.from({ length: 13 }, (_, i) => {
    const n = base.anio * 12 + (base.mes - 1) - i;
    return { anio: Math.floor(n / 12), mes: (n % 12) + 1 };
  });
  const [anio, mes] = periodo ? periodo.split('-').map(Number) : [undefined, undefined];
  const filtro: FiltroComprobantes = { anio, mes, servicio: servicio || undefined, estado: estadoFiltro || undefined, q: q || undefined };

  return (
    <>
      <form
        role="search"
        className="mb-4 flex flex-wrap items-center gap-2"
        onSubmit={(ev) => {
          ev.preventDefault();
          setQ(texto.trim());
        }}
      >
        <div className="relative min-w-64 flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-tinta-suave" aria-hidden />
          <input
            type="search"
            value={texto}
            onChange={(ev) => {
              setTexto(ev.target.value);
              if (ev.target.value === '') setQ('');
            }}
            aria-label="Buscar comprobantes"
            placeholder="Nombre, número de socio, documento, domicilio o número de factura"
            className="block min-h-12 w-full rounded-xl border border-linea bg-superficie pl-11 pr-4 text-base text-tinta placeholder:text-tinta-suave/80 hover:border-marca-claro focus:border-marca"
          />
        </div>
        <Button type="submit" variant="secondary" size="lg">
          Buscar
        </Button>
        <select aria-label="Mes" value={periodo} onChange={(ev) => setPeriodo(ev.target.value)} className={campo}>
          <option value="">Todos los meses</option>
          {meses.map((m) => (
            <option key={`${m.anio}-${m.mes}`} value={`${m.anio}-${m.mes}`}>
              {mayuscula(nombreDeMes(m.anio, m.mes))}
            </option>
          ))}
        </select>
        <select aria-label="Servicio" value={servicio} onChange={(ev) => setServicio(ev.target.value)} className={campo}>
          <option value="">Todos los servicios</option>
          {SERVICIOS_CONEXION.map((s) => (
            <option key={s} value={s}>
              {SERVICIO_CORTO[s]}
            </option>
          ))}
        </select>
        <select aria-label="Estado" value={estadoFiltro} onChange={(ev) => setEstadoFiltro(ev.target.value)} className={campo}>
          <option value="">Todos los estados</option>
          {ESTADOS_COMPROBANTE.map((s) => (
            <option key={s} value={s}>
              {ESTADO_FILTRO[s]}
            </option>
          ))}
        </select>
      </form>

      <ListaComprobantes
        filtro={filtro}
        hoy={e.hoy}
        version={`${e.emision?.cantidad ?? 0}|${e.prefactura?.calculadaEl ?? ''}`}
        puedeOperar={puedeOperar}
        conMes
        vacio={q ? { titulo: 'No encontramos comprobantes', texto: `Nada coincide con «${q}». Probá con el número de socio o parte del apellido.` } : { titulo: 'Todavía no hay comprobantes', texto: 'Aparecen acá cuando se calcula o se emite un mes.' }}
      />
    </>
  );
}
