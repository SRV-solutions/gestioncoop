// Control de lecturas desde la oficina: cuánto se leyó de cada ruta (se actualiza solo, a medida que
// los teléfonos sincronizan), qué lecturas hay que mirar y cuáles faltan o se pueden estimar.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, CircleCheck, Gauge, Radio } from 'lucide-react';
import {
  ANOMALIA_ETIQUETA,
  formatDateTime,
  formatNumber,
  MOTIVO_ETIQUETA,
  MOTIVOS_LECTURA_MENOR,
  NOVEDAD_ETIQUETA,
  nombreDeMes,
  UNIDAD_SERVICIO,
  type AvanceRuta,
  type ControlLecturas,
  type FilaControl,
  type FiltroControl,
  type MotivoLecturaMenor,
  type ResumenLecturas,
} from '@shared';
import { api, errorMessage, qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { cn } from '../../lib/cn';
import { Confirm, Modal } from '../../components/Modal';
import { SERVICIO_CORTO, SERVICIO_ICON } from '../../components/servicios';
import { Badge, Button, Card, Empty, ErrorState, FormAlert, PageHeader, Skeleton } from '../../components/ui';

const FILTROS: { id: FiltroControl; etiqueta: string; vacio: string }[] = [
  { id: 'anomalias', etiqueta: 'Para revisar', vacio: 'No hay lecturas raras sin revisar.' },
  { id: 'novedades', etiqueta: 'Novedades', vacio: 'Los operarios no dejaron novedades sin revisar.' },
  { id: 'pendientes', etiqueta: 'Sin leer', vacio: 'No queda ningún medidor sin leer.' },
  { id: 'estimadas', etiqueta: 'Estimadas', vacio: 'No se estimó ninguna lectura este mes.' },
];

export function LecturasPage() {
  const { hasRole } = useAuth();
  const qc = useQueryClient();
  const puedeEditar = hasRole('admin') || hasRole('facturacion') || hasRole('superadmin');
  // Cada 8 segundos: así se ve entrar lo que cargan los operarios.
  const resumen = useQuery({ queryKey: ['lecturas', 'resumen'], queryFn: () => api.get<ResumenLecturas>('/lecturas/resumen'), refetchInterval: 8000 });
  const refrescar = () => void qc.invalidateQueries({ queryKey: ['lecturas'] });

  const abrir = useMutation({
    mutationFn: (p: { anio: number; mes: number }) => api.post('/lecturas/periodos', p),
    onSuccess: refrescar,
  });
  const [confirmarApertura, setConfirmarApertura] = useState(false);

  if (resumen.isPending) {
    return (
      <>
        <PageHeader title="Lecturas" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="mt-6 h-80 rounded-2xl" />
      </>
    );
  }
  if (resumen.isError) {
    return (
      <>
        <PageHeader title="Lecturas" />
        <ErrorState message={errorMessage(resumen.error)} onRetry={() => void resumen.refetch()} />
      </>
    );
  }

  const r = resumen.data;
  if (!r.periodo && r.enFacturacion) {
    const mes = nombreDeMes(r.enFacturacion.anio, r.enFacturacion.mes);
    return (
      <>
        <PageHeader title="Lecturas" description={`La lectura de ${mes} está cerrada.`} />
        <Card>
          <Empty
            icon={Gauge}
            title={`Se está facturando ${mes}`}
            action={
              <Link to="/facturacion" className="inline-flex min-h-11 items-center rounded-lg bg-marca px-4 font-semibold text-white hover:bg-marca-fuerte">
                Ir a Facturación
              </Link>
            }
          >
            Ya no entran lecturas de ese mes. Cuando se emitan las facturas se puede abrir la lectura del mes siguiente; si hay que corregir algo, desde Facturación se puede reabrir.
          </Empty>
        </Card>
      </>
    );
  }
  if (!r.periodo) {
    const mes = nombreDeMes(r.proximo.anio, r.proximo.mes);
    return (
      <>
        <PageHeader title="Lecturas" description="Abrí la lectura del mes para que las rutas aparezcan en el teléfono de los operarios." />
        <Card>
          <Empty
            icon={Gauge}
            title="No hay ninguna lectura abierta"
            action={
              puedeEditar ? (
                <Button onClick={() => setConfirmarApertura(true)}>Abrir la lectura de {mes}</Button>
              ) : undefined
            }
          >
            {puedeEditar ? `Al abrirla, cada operario ve sus rutas de ${mes} con las casas en orden de recorrido.` : 'Administración o facturación la abren cuando empieza el mes.'}
          </Empty>
        </Card>
        {confirmarApertura && (
          <Modal
            title={`Abrir la lectura de ${mes}`}
            description="Se abre para energía y agua. Desde ese momento los operarios pueden cargar lecturas desde el teléfono."
            onClose={() => setConfirmarApertura(false)}
            footer={
              <>
                <Button variant="secondary" onClick={() => setConfirmarApertura(false)}>
                  Cancelar
                </Button>
                <Button loading={abrir.isPending} onClick={() => abrir.mutate(r.proximo, { onSuccess: () => setConfirmarApertura(false) })}>
                  Abrir la lectura
                </Button>
              </>
            }
          >
            {abrir.isError ? <FormAlert>{errorMessage(abrir.error)}</FormAlert> : <p className="text-tinta-suave">Los meses anteriores quedan como están.</p>}
          </Modal>
        )}
      </>
    );
  }

  const pendientes = r.total - r.leidos;
  const avance = r.total ? (r.leidos / r.total) * 100 : 0;

  return (
    <>
      <PageHeader
        title="Lecturas"
        description={`Lectura de ${nombreDeMes(r.periodo.anio, r.periodo.mes)}, energía y agua.`}
        actions={
          <span className="inline-flex items-center gap-2 rounded-full border border-linea bg-superficie px-3 py-1.5 text-sm font-semibold text-tinta-suave">
            <Radio className={cn('size-4 text-exito', resumen.isFetching && 'animate-latido')} aria-hidden />
            En vivo
          </span>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="px-5 py-4 sm:col-span-2">
          <p className="text-sm font-semibold text-tinta-suave">Medidores leídos</p>
          <p className="mt-1 text-tinta">
            <span className="text-3xl font-black tabular-nums">{formatNumber(r.leidos)}</span>
            <span className="text-lg font-semibold text-tinta-suave"> de {formatNumber(r.total)}</span>
            <span className="ml-2 text-lg font-bold text-marca-texto">{Math.floor(avance)} %</span>
          </p>
          <div role="progressbar" aria-label="Avance de la lectura" aria-valuemin={0} aria-valuemax={r.total} aria-valuenow={r.leidos} className="mt-2 h-3 overflow-hidden rounded-full bg-linea">
            <div className="h-full rounded-full bg-marca transition-[width] duration-500" style={{ width: `${avance}%` }} />
          </div>
          <p className="mt-2 text-sm text-tinta-suave">
            {pendientes === 0 ? 'No falta ninguno.' : `Faltan ${formatNumber(pendientes)}.`}
            {r.estimados > 0 && ` ${formatNumber(r.estimados)} ${r.estimados === 1 ? 'es estimada' : 'son estimadas'}.`}
          </p>
        </Card>
        <Indicador titulo="Para revisar" valor={r.anomalias} ayuda="Consumos raros o lecturas menores a la anterior" tono={r.anomalias ? 'alerta' : 'bien'} />
        <Indicador titulo="Novedades" valor={r.conNovedad} ayuda="Medidor roto, sin acceso, posible fraude…" tono={r.conNovedad ? 'alerta' : 'bien'} />
      </div>

      <h2 className="mb-2 mt-8 text-sm font-semibold uppercase tracking-wide text-tinta-suave">Avance por ruta</h2>
      <Card className="overflow-hidden">
        <ul className="divide-y divide-linea">
          {r.rutas.map((ruta) => (
            <FilaRuta key={ruta.id} ruta={ruta} rutas={r.rutas} operarios={r.operarios} puedeEditar={puedeEditar} alCambiar={refrescar} />
          ))}
        </ul>
      </Card>

      <Control resumen={r} puedeEditar={puedeEditar} alCambiar={refrescar} />
    </>
  );
}

function Indicador({ titulo, valor, ayuda, tono }: { titulo: string; valor: number; ayuda: string; tono: 'alerta' | 'bien' }) {
  return (
    <Card className="px-5 py-4">
      <p className="text-sm font-semibold text-tinta-suave">{titulo}</p>
      <p className={cn('mt-1 text-3xl font-black tabular-nums', tono === 'alerta' ? 'text-alerta' : 'text-exito')}>{formatNumber(valor)}</p>
      <p className="mt-1 text-sm text-tinta-suave">{ayuda}</p>
    </Card>
  );
}

/** Lo que tiene a cargo un operario entre todas sus rutas: es lo que él ve en «Mi ruta de hoy». */
function cargaDe(operarioId: number, rutas: AvanceRuta[]): string {
  const suyas = rutas.filter((x) => x.operario?.id === operarioId && x.medidores > 0);
  const faltan = suyas.reduce((n, x) => n + x.medidores - x.leidos, 0);
  const cuantas = `${suyas.length} ${suyas.length === 1 ? 'ruta' : 'rutas'}`;
  return faltan === 0 ? `${cuantas}, todo leído` : `${cuantas}, le faltan ${formatNumber(faltan)} ${faltan === 1 ? 'medidor' : 'medidores'}`;
}

/** Lo mismo, corto, para la lista desplegable: «faltan 92», «todo leído», «sin rutas». */
function faltanDe(operarioId: number, rutas: AvanceRuta[]): string {
  const suyas = rutas.filter((x) => x.operario?.id === operarioId && x.medidores > 0);
  const faltan = suyas.reduce((n, x) => n + x.medidores - x.leidos, 0);
  return suyas.length === 0 ? 'sin rutas' : faltan === 0 ? 'todo leído' : `faltan ${formatNumber(faltan)}`;
}

function FilaRuta({ ruta, rutas, operarios, puedeEditar, alCambiar }: { ruta: AvanceRuta; rutas: AvanceRuta[]; operarios: ResumenLecturas['operarios']; puedeEditar: boolean; alCambiar: () => void }) {
  const asignar = useMutation({
    mutationFn: (operarioId: number | null) => api.put(`/lecturas/rutas/${ruta.id}/operario`, { operarioId }),
    onSuccess: alCambiar,
  });
  const terminada = ruta.medidores > 0 && ruta.leidos === ruta.medidores;
  const avance = ruta.medidores ? (ruta.leidos / ruta.medidores) * 100 : 0;
  return (
    <li className="grid items-center gap-x-5 gap-y-2 px-5 py-3.5 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.2fr)]">
      <div className="min-w-0">
        <p className="truncate font-semibold text-tinta">{ruta.nombre}</p>
        <p className="text-sm text-tinta-suave">{ruta.ultimaEl ? `Última lectura: ${formatDateTime(ruta.ultimaEl)}` : 'Sin empezar'}</p>
      </div>
      <div className="min-w-0">
        {puedeEditar ? (
          <select
            aria-label={`Operario de ${ruta.nombre}`}
            value={ruta.operario?.id ?? ''}
            disabled={asignar.isPending}
            onChange={(e) => asignar.mutate(e.target.value === '' ? null : Number(e.target.value))}
            className="min-h-11 w-full rounded-lg border border-linea bg-superficie px-3 text-[0.9375rem] text-tinta hover:border-marca-claro focus:border-marca"
          >
            <option value="">Sin operario</option>
            {operarios.map((o) => (
              <option key={o.id} value={o.id}>
                {o.nombre} · {faltanDe(o.id, rutas)}
              </option>
            ))}
          </select>
        ) : (
          <p className="text-[0.9375rem] text-tinta">{ruta.operario?.nombre ?? 'Sin operario'}</p>
        )}
        {/* Lo que ve esa persona en su teléfono: así se sabe a quién conviene pasarle una ruta. */}
        {ruta.operario && <p className="mt-1 text-sm text-tinta-suave">En su teléfono: {cargaDe(ruta.operario.id, rutas)}</p>}
        {asignar.isError && <p className="mt-1 text-sm font-medium text-peligro">{errorMessage(asignar.error)}</p>}
      </div>
      <div>
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <span className="font-semibold tabular-nums text-tinta">
            {formatNumber(ruta.leidos)} de {formatNumber(ruta.medidores)} medidores
          </span>
          <span className={cn('font-bold tabular-nums', terminada ? 'text-exito' : 'text-tinta-suave')}>{terminada ? 'Completa' : `${Math.floor(avance)} %`}</span>
        </div>
        <div role="progressbar" aria-label={`Avance de ${ruta.nombre}`} aria-valuemin={0} aria-valuemax={ruta.medidores} aria-valuenow={ruta.leidos} className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-linea">
          <div className={cn('h-full rounded-full transition-[width] duration-500', terminada ? 'bg-exito' : 'bg-marca')} style={{ width: `${avance}%` }} />
        </div>
        <p className="mt-1 text-sm tabular-nums text-tinta-suave">
          {formatNumber(ruta.casasHechas)} de {formatNumber(ruta.casas)} casas
          {!terminada && ` · faltan ${formatNumber(ruta.medidores - ruta.leidos)} ${ruta.medidores - ruta.leidos === 1 ? 'medidor' : 'medidores'}`}
        </p>
      </div>
    </li>
  );
}

/* ───────────────────────── Lista de control ───────────────────────── */

function Control({ resumen, puedeEditar, alCambiar }: { resumen: ResumenLecturas; puedeEditar: boolean; alCambiar: () => void }) {
  const [filtro, setFiltro] = useState<FiltroControl>('anomalias');
  const [ruta, setRuta] = useState('');
  const [pagina, setPagina] = useState(1);
  const [foto, setFoto] = useState<FilaControl | null>(null);
  const [aEstimar, setAEstimar] = useState<FilaControl | null>(null);

  const consulta = useQuery({
    queryKey: ['lecturas', 'control', filtro, ruta, pagina],
    queryFn: () => api.get<ControlLecturas>(`/lecturas/control${qs({ filtro, ruta, pagina })}`),
    placeholderData: keepPreviousData,
    refetchInterval: 15_000,
  });
  const revisar = useMutation({ mutationFn: (id: number) => api.post(`/lecturas/${id}/revisar`), onSuccess: alCambiar });
  const aclarar = useMutation({
    mutationFn: (v: { id: number; motivo: MotivoLecturaMenor }) => api.post(`/lecturas/${v.id}/motivo`, { motivo: v.motivo }),
    onSuccess: alCambiar,
  });
  const estimar = useMutation({
    mutationFn: (f: FilaControl) => api.post('/lecturas/estimar', { periodoId: f.periodoId, medidorId: f.medidorId }),
    onSuccess: () => {
      setAEstimar(null);
      alCambiar();
    },
  });

  const cantidad: Record<FiltroControl, number> = {
    anomalias: resumen.anomalias,
    novedades: resumen.conNovedad,
    pendientes: resumen.total - resumen.leidos,
    estimadas: resumen.estimados,
  };
  const actual = FILTROS.find((f) => f.id === filtro)!;
  const datos = consulta.data;
  const paginas = datos ? Math.max(1, Math.ceil(datos.total / 50)) : 1;

  return (
    <section aria-labelledby="titulo-control" className="mt-8">
      <h2 id="titulo-control" className="mb-2 text-sm font-semibold uppercase tracking-wide text-tinta-suave">
        Control
      </h2>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Qué lecturas mostrar" className="flex flex-wrap gap-2">
          {FILTROS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filtro === f.id}
              onClick={() => (setFiltro(f.id), setPagina(1))}
              className={cn(
                'inline-flex min-h-11 items-center gap-2 rounded-xl border px-3.5 text-[0.9375rem] font-semibold transition-colors duration-150',
                filtro === f.id ? 'border-marca bg-marca text-white' : 'border-linea bg-superficie text-tinta hover:border-marca hover:text-marca-texto',
              )}
            >
              {f.etiqueta}
              <span className={cn('rounded-full px-2 py-0.5 text-xs font-bold tabular-nums', filtro === f.id ? 'bg-white/20' : 'bg-fondo text-tinta-suave')}>{formatNumber(cantidad[f.id])}</span>
            </button>
          ))}
        </div>
        <select
          aria-label="Ruta"
          value={ruta}
          onChange={(e) => (setRuta(e.target.value), setPagina(1))}
          className="min-h-11 rounded-xl border border-linea bg-superficie px-3 text-[0.9375rem] text-tinta hover:border-marca-claro focus:border-marca"
        >
          <option value="">Todas las rutas</option>
          {resumen.rutas.map((r) => (
            <option key={r.id} value={r.id}>
              {r.nombre}
            </option>
          ))}
        </select>
      </div>

      <Card className={cn('overflow-hidden transition-opacity duration-150', consulta.isPlaceholderData && 'opacity-60')}>
        {consulta.isPending ? (
          <div className="space-y-3 p-5">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        ) : consulta.isError ? (
          <ErrorState message={errorMessage(consulta.error)} onRetry={() => void consulta.refetch()} />
        ) : !datos || datos.filas.length === 0 ? (
          <Empty icon={CircleCheck} title="Nada por acá">
            {actual.vacio}
          </Empty>
        ) : (
          <ul className="divide-y divide-linea">
            {datos.filas.map((f) => (
              <Fila
                key={`${f.periodoId}-${f.medidorId}`}
                fila={f}
                puedeEditar={puedeEditar}
                revisando={revisar.isPending && revisar.variables === f.lectura?.id}
                alRevisar={() => f.lectura && revisar.mutate(f.lectura.id)}
                aclarando={aclarar.isPending && aclarar.variables?.id === f.lectura?.id}
                alAclarar={(motivo) => f.lectura && aclarar.mutate({ id: f.lectura.id, motivo })}
                alEstimar={() => (estimar.reset(), setAEstimar(f))}
                alVerFoto={() => setFoto(f)}
              />
            ))}
          </ul>
        )}
      </Card>
      {revisar.isError && <p className="mt-2 text-sm font-medium text-peligro">{errorMessage(revisar.error)}</p>}
      {aclarar.isError && <p className="mt-2 text-sm font-medium text-peligro">{errorMessage(aclarar.error)}</p>}

      {datos && paginas > 1 && (
        <nav aria-label="Páginas" className="mt-3 flex items-center justify-between gap-3">
          <Button variant="secondary" disabled={pagina === 1} onClick={() => setPagina((p) => p - 1)}>
            Anteriores
          </Button>
          <p className="text-sm text-tinta-suave">
            Página {pagina} de {paginas} · {formatNumber(datos.total)} en total
          </p>
          <Button variant="secondary" disabled={pagina >= paginas} onClick={() => setPagina((p) => p + 1)}>
            Siguientes
          </Button>
        </nav>
      )}

      {foto?.lectura && (
        <Modal title={`Foto · medidor ${Number(foto.medidor)}`} description={`${foto.direccion} · ${foto.titular}`} onClose={() => setFoto(null)} wide>
          <img src={`/api/v1/lecturas/${foto.lectura.id}/foto`} alt="Foto que sacó el operario" className="mx-auto max-h-[65dvh] rounded-xl" />
          {foto.lectura.nota && <p className="mt-3 text-tinta">“{foto.lectura.nota}”</p>}
        </Modal>
      )}

      {aEstimar && (
        <Confirm
          title="Estimar la lectura"
          confirmLabel="Estimar"
          variant="primary"
          loading={estimar.isPending}
          error={estimar.isError ? errorMessage(estimar.error) : null}
          onConfirm={() => estimar.mutate(aEstimar)}
          onClose={() => setAEstimar(null)}
        >
          <p>
            Medidor <strong>{Number(aEstimar.medidor)}</strong> ({SERVICIO_CORTO[aEstimar.servicio]}) · {aEstimar.direccion}.
          </p>
          {aEstimar.anterior !== null && aEstimar.promedio !== null ? (
            <p className="text-tinta-suave">
              Se toma la lectura anterior ({formatNumber(aEstimar.anterior)}) más el consumo promedio de los últimos 6 meses ({formatNumber(Math.round(aEstimar.promedio))} {UNIDAD_SERVICIO[aEstimar.servicio]}). La factura va a salir
              marcada como estimada y se ajusta sola con la próxima lectura real.
            </p>
          ) : (
            <p className="text-tinta-suave">Este medidor no tiene historial: no hay con qué estimar. Hay que ir a leerlo.</p>
          )}
        </Confirm>
      )}
    </section>
  );
}

interface FilaProps {
  fila: FilaControl;
  puedeEditar: boolean;
  revisando: boolean;
  aclarando: boolean;
  alRevisar: () => void;
  alAclarar: (motivo: MotivoLecturaMenor) => void;
  alEstimar: () => void;
  alVerFoto: () => void;
}

function Fila({ fila, puedeEditar, revisando, aclarando, alRevisar, alAclarar, alEstimar, alVerFoto }: FilaProps) {
  const Icon = SERVICIO_ICON[fila.servicio];
  const unidad = UNIDAD_SERVICIO[fila.servicio];
  const l = fila.lectura;
  const sinValor = !l || l.valor === null;
  // Dio menos que la anterior y nadie dijo por qué: sin eso no hay consumo que facturar.
  const faltaMotivo = l != null && l.valor !== null && l.anomalia === 'lectura_menor' && l.consumo === null;
  return (
    <li className="grid items-center gap-x-5 gap-y-2 px-5 py-3.5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1.3fr)_auto]">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-marca-tenue text-marca-texto">
          <Icon className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="truncate font-semibold text-tinta">{fila.direccion}</p>
          <p className="truncate text-sm text-tinta-suave">
            {fila.titular} · medidor {Number(fila.medidor)}
            {fila.ruta && ` · ${fila.ruta.split(' · ')[0]}`}
          </p>
        </div>
      </div>

      <div className="min-w-0 text-[0.9375rem]">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {l?.valor != null && <span className="font-bold tabular-nums text-tinta">{formatNumber(l.valor)}</span>}
          {l?.anomalia && <Badge tone={l.anomalia === 'sin_consumo' ? 'neutral' : 'alerta'}>{ANOMALIA_ETIQUETA[l.anomalia]}</Badge>}
          {l?.novedad && <Badge tone="peligro">{NOVEDAD_ETIQUETA[l.novedad]}</Badge>}
          {l?.tipo === 'estimada' && <Badge tone="marca">Estimada</Badge>}
          {!l && <Badge>Sin leer</Badge>}
        </div>
        <p className="mt-0.5 text-sm text-tinta-suave">
          {l?.consumo != null && `Consumo ${formatNumber(l.consumo)} ${unidad} · `}
          {fila.promedio !== null ? `promedio ${formatNumber(Math.round(fila.promedio))} ${unidad}` : 'sin historial'}
          {fila.anterior !== null && ` · anterior ${formatNumber(fila.anterior)}`}
          {l?.motivo && ` · ${MOTIVO_ETIQUETA[l.motivo].toLowerCase()}`}
        </p>
        {l?.nota && <p className="mt-0.5 text-sm text-tinta">“{l.nota}”</p>}
        {l && (
          <p className="mt-0.5 text-xs text-tinta-suave">
            {l.operario ?? 'Oficina'} · {formatDateTime(l.tomadaEl)}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 lg:justify-end">
        {l?.tieneFoto && (
          <Button variant="secondary" icon={Camera} onClick={alVerFoto}>
            Foto
          </Button>
        )}
        {puedeEditar && sinValor && (
          <Button variant="secondary" onClick={alEstimar}>
            Estimar
          </Button>
        )}
        {puedeEditar &&
          faltaMotivo &&
          MOTIVOS_LECTURA_MENOR.map((motivo) => (
            <Button key={motivo} variant="secondary" disabled={aclarando} onClick={() => alAclarar(motivo)}>
              {MOTIVO_ETIQUETA[motivo]}
            </Button>
          ))}
        {puedeEditar && l && !l.revisada && !faltaMotivo && (l.anomalia || l.novedad) && (
          <Button variant="secondary" icon={CircleCheck} loading={revisando} onClick={alRevisar}>
            Revisada
          </Button>
        )}
      </div>
    </li>
  );
}
