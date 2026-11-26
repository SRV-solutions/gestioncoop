// Reclamos y cortes programados desde la oficina (SPEC 6.8). Administración atiende —toma reclamos
// por teléfono, asigna la cuadrilla, avanza y resuelve, programa cortes—; gerencia mira.
import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, CircleCheck, MapPin, MessageSquarePlus, MessageSquareWarning, Phone, Plus, PowerOff, Search, UserRound, Wrench } from 'lucide-react';
import {
  CUADRILLAS,
  ESTADO_RECLAMO_ETIQUETA,
  formatDateTime,
  ORIGEN_RECLAMO_ETIQUETA,
  PRIORIDAD_ETIQUETA,
  PRIORIDADES,
  SERVICIO_ETIQUETA,
  SERVICIO_RECLAMO_ETIQUETA,
  SERVICIOS_CORTE,
  SERVICIOS_RECLAMO,
  TIPOS_RECLAMO,
  type CorteProgramado,
  type EstadoReclamo,
  type PadronResumen,
  type Page,
  type PaginaReclamos,
  type Prioridad,
  type ReclamoDetalle,
  type ReclamoListado,
  type ServicioReclamo,
  type SocioDetalle,
  type SocioListado,
} from '@shared';
import { api, ApiError, errorMessage, qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { cn } from '../../lib/cn';
import { Modal } from '../../components/Modal';
import { Badge, Button, Card, Check, Empty, ErrorState, Field, FormAlert, PageHeader, SelectField, Skeleton } from '../../components/ui';

const TONO_ESTADO = { nuevo: 'alerta', asignado: 'marca', en_curso: 'marca', resuelto: 'exito' } as const;
const TONO_PRIORIDAD = { urgente: 'peligro', alta: 'alerta', media: 'neutral', baja: 'neutral' } as const;

/** «hace 3 h», «hace 2 días». */
function hace(iso: string): string {
  const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} días`;
}
/** «2 h 15 min», «3 días». */
function duracion(desde: string, hasta: string): string {
  const min = Math.max(0, Math.round((Date.parse(hasta) - Date.parse(desde)) / 60_000));
  if (min < 60) return `${min} min`;
  if (min < 48 * 60) return `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}`;
  return `${Math.round(min / 1440)} días`;
}

export function ReclamosPage() {
  const { hasRole } = useAuth();
  const [params, setParams] = useSearchParams();
  const vista = params.get('vista') === 'cortes' ? 'cortes' : 'reclamos';
  const atiende = hasRole('admin') || hasRole('superadmin');
  // Desde el mapa se llega con ?nuevo=1&socio=…&conexion=… (tomar un reclamo de esa casa) o con ?ver=… (abrir uno).
  const [desdeAfuera] = useState(() => ({
    nuevo: params.get('nuevo') === '1',
    socioId: Number(params.get('socio')) || null,
    conexionId: Number(params.get('conexion')) || null,
    ver: Number(params.get('ver')) || null,
  }));
  const [nuevo, setNuevo] = useState(desdeAfuera.nuevo && atiende);
  const [nuevoCorte, setNuevoCorte] = useState(false);

  return (
    <>
      <PageHeader
        title="Reclamos"
        description="Lo que avisan los socios, quién lo atiende y cuándo se resolvió. Y los cortes programados."
        actions={
          atiende &&
          (vista === 'reclamos' ? (
            <Button icon={Plus} onClick={() => setNuevo(true)}>
              Tomar un reclamo
            </Button>
          ) : (
            <Button icon={Plus} onClick={() => setNuevoCorte(true)}>
              Programar un corte
            </Button>
          ))
        }
      />
      <div role="tablist" aria-label="Secciones" className="mb-6 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-linea">
        {(
          [
            ['reclamos', 'Reclamos', MessageSquareWarning],
            ['cortes', 'Cortes programados', PowerOff],
          ] as const
        ).map(([id, etiqueta, Icon]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={vista === id}
            onClick={() => setParams(id === 'reclamos' ? {} : { vista: id }, { replace: true })}
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
      {vista === 'reclamos' ? <Reclamos atiende={atiende} abrir={desdeAfuera.ver} /> : <Cortes atiende={atiende} />}
      {nuevo && <NuevoReclamo inicial={desdeAfuera.nuevo ? desdeAfuera : undefined} onClose={() => setNuevo(false)} />}
      {nuevoCorte && <NuevoCorte onClose={() => setNuevoCorte(false)} />}
    </>
  );
}

/* ───────────────────────── Lista ───────────────────────── */

type FiltroEstado = EstadoReclamo | 'abiertos';

function Reclamos({ atiende, abrir }: { atiende: boolean; abrir: number | null }) {
  const [estado, setEstado] = useState<FiltroEstado>('abiertos');
  const [servicio, setServicio] = useState<ServicioReclamo | ''>('');
  const [q, setQ] = useState('');
  const [buscar, setBuscar] = useState('');
  const [pagina, setPagina] = useState(1);
  const [abierto, setAbierto] = useState<number | null>(abrir);
  const consulta = useQuery({
    queryKey: ['reclamos', estado, servicio, buscar, pagina],
    queryFn: () => api.get<PaginaReclamos>(`/reclamos${qs({ estado, servicio, q: buscar, pagina })}`),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });
  const d = consulta.data;
  const paginas = d ? Math.max(1, Math.ceil(d.total / d.porPagina)) : 1;
  const filtros: { id: FiltroEstado; etiqueta: string; n: number | undefined }[] = [
    { id: 'abiertos', etiqueta: 'Abiertos', n: d ? d.conteo.nuevo + d.conteo.asignado + d.conteo.en_curso : undefined },
    { id: 'nuevo', etiqueta: 'Sin asignar', n: d?.conteo.nuevo },
    { id: 'asignado', etiqueta: 'Asignados', n: d?.conteo.asignado },
    { id: 'en_curso', etiqueta: 'En curso', n: d?.conteo.en_curso },
    { id: 'resuelto', etiqueta: 'Resueltos', n: d?.conteo.resuelto },
  ];

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div role="group" aria-label="Estado" className="flex flex-wrap gap-1.5">
          {filtros.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={estado === f.id}
              onClick={() => (setEstado(f.id), setPagina(1))}
              className={cn(
                'inline-flex min-h-11 items-center gap-2 rounded-full border px-3.5 text-sm font-semibold transition-colors duration-150',
                estado === f.id ? 'border-marca bg-marca text-white' : 'border-linea bg-superficie text-tinta hover:border-marca',
              )}
            >
              {f.etiqueta}
              {f.n !== undefined && <span className={cn('tabular-nums', estado === f.id ? 'text-white/85' : 'text-tinta-suave')}>{f.n}</span>}
            </button>
          ))}
        </div>
        <form
          className="ml-auto flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setBuscar(q.trim());
            setPagina(1);
          }}
        >
          <div className="w-44">
            <SelectField label="Servicio" value={servicio} onChange={(e) => (setServicio(e.target.value as ServicioReclamo | ''), setPagina(1))}>
              <option value="">Todos</option>
              {SERVICIOS_RECLAMO.map((s) => (
                <option key={s} value={s}>
                  {SERVICIO_RECLAMO_ETIQUETA[s]}
                </option>
              ))}
            </SelectField>
          </div>
          <div className="w-60">
            <Field label="Buscar" placeholder="N° de reclamo, socio, calle" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Button type="submit" variant="secondary" icon={Search} aria-label="Buscar" />
        </form>
      </div>

      <Card className={cn('overflow-hidden transition-opacity duration-150', consulta.isPlaceholderData && 'opacity-60')}>
        {consulta.isPending ? (
          <div className="space-y-3 p-5">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : consulta.isError || !d ? (
          <ErrorState message={errorMessage(consulta.error)} onRetry={() => void consulta.refetch()} />
        ) : d.filas.length === 0 ? (
          <Empty icon={CircleCheck} title={estado === 'abiertos' && !buscar ? 'No hay reclamos abiertos' : 'No hay reclamos con ese filtro'}>
            {estado === 'abiertos' && !buscar ? 'Todo lo que avisaron los socios está resuelto.' : 'Probá con otro estado o servicio.'}
          </Empty>
        ) : (
          <ul className="divide-y divide-linea">
            {d.filas.map((r) => (
              <Fila key={r.id} r={r} alAbrir={() => setAbierto(r.id)} />
            ))}
          </ul>
        )}
      </Card>
      {d && paginas > 1 && (
        <nav aria-label="Páginas" className="mt-3 flex items-center justify-between gap-3">
          <Button variant="secondary" disabled={pagina === 1} onClick={() => setPagina((p) => p - 1)}>
            Anteriores
          </Button>
          <p className="text-sm text-tinta-suave">
            Página {pagina} de {paginas} · {d.total} reclamos
          </p>
          <Button variant="secondary" disabled={pagina >= paginas} onClick={() => setPagina((p) => p + 1)}>
            Siguientes
          </Button>
        </nav>
      )}
      {abierto !== null && <ReclamoModal key={abierto} id={abierto} atiende={atiende} onClose={() => setAbierto(null)} />}
    </>
  );
}

function Fila({ r, alAbrir }: { r: ReclamoListado; alAbrir: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={alAbrir}
        className="grid w-full items-center gap-x-5 gap-y-1 px-5 py-3 text-left transition-colors duration-100 hover:bg-marca-tenue/50 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto]"
      >
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-semibold text-tinta">{r.tipoNombre}</span>
            {r.prioridad !== 'media' && r.prioridad !== 'baja' && <Badge tone={TONO_PRIORIDAD[r.prioridad]}>{PRIORIDAD_ETIQUETA[r.prioridad]}</Badge>}
            {r.tieneFoto && <Camera className="size-4 text-tinta-suave" aria-label="Con foto" />}
          </span>
          <span className="block truncate text-sm text-tinta-suave">
            {r.referencia} · {SERVICIO_RECLAMO_ETIQUETA[r.servicio]} · {r.socio ? r.socio.nombre : 'Sin socio'}
          </span>
        </span>
        <span className="min-w-0 text-sm text-tinta-suave">
          <span className="block truncate">
            {r.direccion ?? '—'}
            {r.zona && ` · ${r.zona}`}
          </span>
          <span className="block truncate">{r.cuadrilla ?? 'Sin cuadrilla'}</span>
        </span>
        <span className="flex items-center gap-3 md:flex-col md:items-end md:gap-1">
          <Badge tone={TONO_ESTADO[r.estado]}>{ESTADO_RECLAMO_ETIQUETA[r.estado]}</Badge>
          <span className="text-sm tabular-nums text-tinta-suave">{r.resueltoEl ? `en ${duracion(r.creadoEl, r.resueltoEl)}` : hace(r.creadoEl)}</span>
        </span>
      </button>
    </li>
  );
}

/* ───────────────────────── Ficha de un reclamo ───────────────────────── */

function ReclamoModal({ id, atiende, onClose }: { id: number; atiende: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const consulta = useQuery({ queryKey: ['reclamo', id], queryFn: () => api.get<ReclamoDetalle>(`/reclamos/${id}`) });
  const r = consulta.data;
  const [accion, setAccion] = useState<'asignar' | 'resolver' | 'nota' | null>(null);
  const [cuadrilla, setCuadrilla] = useState('');
  const [texto, setTexto] = useState('');
  const [visible, setVisible] = useState(true);
  const actualizar = (nuevo: ReclamoDetalle) => {
    qc.setQueryData(['reclamo', id], nuevo);
    void qc.invalidateQueries({ queryKey: ['reclamos'] });
    setAccion(null);
    setTexto('');
  };
  const cambiar = useMutation({
    mutationFn: (d: { estado: EstadoReclamo; cuadrilla?: string; resolucion?: string; nota?: string }) => api.post<ReclamoDetalle>(`/reclamos/${id}/estado`, d),
    onSuccess: actualizar,
  });
  const nota = useMutation({ mutationFn: () => api.post<ReclamoDetalle>(`/reclamos/${id}/nota`, { nota: texto, visibleSocio: visible }), onSuccess: actualizar });
  const prioridad = useMutation({ mutationFn: (p: Prioridad) => api.post<ReclamoDetalle>(`/reclamos/${id}/prioridad`, { prioridad: p }), onSuccess: actualizar });
  const error = cambiar.error ?? nota.error ?? prioridad.error;
  const campos = error instanceof ApiError ? (error.fields ?? {}) : {};

  const cuadrillas = r ? [...new Set([...CUADRILLAS[r.servicio], ...Object.values(CUADRILLAS).flat()])] : [];
  const abrir = (a: typeof accion) => {
    cambiar.reset();
    nota.reset();
    setAccion(a);
    setCuadrilla(r?.cuadrilla ?? cuadrillas[0] ?? '');
  };

  return (
    <Modal
      wide
      title={r ? `${r.referencia} · ${r.tipoNombre}` : 'Reclamo'}
      description={r ? `${SERVICIO_RECLAMO_ETIQUETA[r.servicio]} · ${ORIGEN_RECLAMO_ETIQUETA[r.origen]} · ${formatDateTime(r.creadoEl)}` : undefined}
      onClose={onClose}
      footer={
        r && atiende && r.estado !== 'resuelto' && accion === null ? (
          <>
            <Button variant="ghost" icon={MessageSquarePlus} className="mr-auto" onClick={() => abrir('nota')}>
              Agregar una nota
            </Button>
            {r.estado === 'nuevo' && <Button onClick={() => abrir('asignar')}>Asignar una cuadrilla</Button>}
            {r.estado === 'asignado' && (
              <>
                <Button variant="secondary" onClick={() => abrir('asignar')}>
                  Cambiar la cuadrilla
                </Button>
                <Button icon={Wrench} loading={cambiar.isPending} onClick={() => cambiar.mutate({ estado: 'en_curso' })}>
                  La cuadrilla empezó
                </Button>
              </>
            )}
            {r.estado === 'en_curso' && (
              <Button icon={CircleCheck} onClick={() => abrir('resolver')}>
                Resolver
              </Button>
            )}
          </>
        ) : (
          accion === null && (
            <Button variant="secondary" onClick={onClose}>
              Cerrar
            </Button>
          )
        )
      }
    >
      {consulta.isPending ? (
        <div className="space-y-3">
          <Skeleton className="h-20" />
          <Skeleton className="h-52" />
        </div>
      ) : consulta.isError || !r ? (
        <ErrorState message={errorMessage(consulta.error)} onRetry={() => void consulta.refetch()} />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={TONO_ESTADO[r.estado]}>{ESTADO_RECLAMO_ETIQUETA[r.estado]}</Badge>
            {atiende && r.estado !== 'resuelto' ? (
              <label className="inline-flex items-center gap-2 text-sm text-tinta-suave">
                Prioridad
                <select
                  value={r.prioridad}
                  onChange={(e) => prioridad.mutate(e.target.value as Prioridad)}
                  className="min-h-9 rounded-lg border border-linea bg-superficie px-2 text-sm font-semibold text-tinta"
                >
                  {PRIORIDADES.map((p) => (
                    <option key={p} value={p}>
                      {PRIORIDAD_ETIQUETA[p]}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <Badge tone={TONO_PRIORIDAD[r.prioridad]}>Prioridad {PRIORIDAD_ETIQUETA[r.prioridad].toLowerCase()}</Badge>
            )}
            {r.cuadrilla && <Badge>{r.cuadrilla}</Badge>}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <p className="flex items-start gap-2.5 text-tinta">
              <UserRound className="mt-0.5 size-4 shrink-0 text-tinta-suave" aria-hidden />
              <span>{r.socio ? `${r.socio.nombre} · socio ${r.socio.numero}` : 'Sin socio'}</span>
            </p>
            <p className="flex items-start gap-2.5 text-tinta">
              <MapPin className="mt-0.5 size-4 shrink-0 text-tinta-suave" aria-hidden />
              <span>
                {r.direccion ?? '—'}
                {r.zona && ` · ${r.zona}`}
                {/* Si es de una casa del padrón, se abre en el mapa de la cooperativa; si es un punto suelto, en uno público. */}
                {r.conexion ? (
                  <Link to={`/mapa?conexion=${r.conexion.id}`} className="ml-2 font-semibold text-marca-texto underline">
                    Ver en el mapa
                  </Link>
                ) : (
                  r.lat !== null &&
                  r.lng !== null && (
                    <a
                      href={`https://www.openstreetmap.org/?mlat=${r.lat}&mlon=${r.lng}#map=18/${r.lat}/${r.lng}`}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="ml-2 font-semibold text-marca-texto underline"
                    >
                      Ver en el mapa
                    </a>
                  )
                )}
              </span>
            </p>
            {r.contacto && (
              <p className="flex items-start gap-2.5 text-tinta">
                <Phone className="mt-0.5 size-4 shrink-0 text-tinta-suave" aria-hidden />
                <a href={`tel:${r.contacto.replace(/[^\d+]/g, '')}`} className="underline">
                  {r.contacto}
                </a>
              </p>
            )}
          </div>
          {r.descripcion && <p className="rounded-xl bg-fondo px-4 py-3 text-tinta">“{r.descripcion}”</p>}
          {r.tieneFoto && <img src={`/api/v1/reclamos/${r.id}/foto`} alt="Foto que mandó el socio" className="max-h-72 w-full rounded-xl object-contain" loading="lazy" />}

          {/* Historial */}
          <ol className="space-y-3 border-l-2 border-linea pl-4">
            {r.eventos.map((e) => (
              <li key={e.id} className="relative">
                <span aria-hidden className={cn('absolute -left-[1.4rem] top-1.5 size-3 rounded-full border-2 border-superficie', e.estado ? 'bg-marca' : 'bg-linea')} />
                <p className="text-sm text-tinta">
                  <strong>{e.estado ? ESTADO_RECLAMO_ETIQUETA[e.estado] : 'Nota'}</strong>
                  <span className="text-tinta-suave">
                    {' '}
                    · {formatDateTime(e.creadoEl)}
                    {e.autor && ` · ${e.autor}`}
                    {!e.visibleSocio && ' · solo la oficina'}
                  </span>
                </p>
                {e.nota && <p className="text-sm text-tinta">{e.nota}</p>}
              </li>
            ))}
          </ol>
          {r.resueltoEl && <p className="text-sm text-tinta-suave">Resuelto en {duracion(r.creadoEl, r.resueltoEl)}.</p>}

          {accion && (
            <form
              className="space-y-3 rounded-2xl border border-linea p-4"
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                if (accion === 'asignar') cambiar.mutate({ estado: 'asignado', cuadrilla });
                else if (accion === 'resolver') cambiar.mutate({ estado: 'resuelto', resolucion: texto });
                else nota.mutate();
              }}
            >
              {accion === 'asignar' && (
                <SelectField label="Cuadrilla" value={cuadrilla} onChange={(e) => setCuadrilla(e.target.value)} error={campos.cuadrilla} autoFocus>
                  {cuadrillas.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </SelectField>
              )}
              {accion !== 'asignar' && (
                <div className="space-y-1.5">
                  <label htmlFor="reclamo-texto" className="block text-sm font-semibold text-tinta">
                    {accion === 'resolver' ? '¿Qué se hizo?' : 'Nota'}
                  </label>
                  <textarea
                    id="reclamo-texto"
                    autoFocus
                    rows={3}
                    maxLength={500}
                    value={texto}
                    onChange={(e) => setTexto(e.target.value)}
                    placeholder={accion === 'resolver' ? 'Por ejemplo: se cambió el fusible de la bajada' : ''}
                    className="block w-full rounded-xl border border-linea bg-superficie px-4 py-3 text-base text-tinta hover:border-marca-claro focus:border-marca"
                  />
                  {(campos.resolucion || campos.nota) && <p className="text-sm font-medium text-peligro">{campos.resolucion ?? campos.nota}</p>}
                  <p className="text-sm text-tinta-suave">{accion === 'resolver' ? 'Lo ve el socio en la app y le llega por email.' : ''}</p>
                </div>
              )}
              {accion === 'nota' && <Check label="Que la vea el socio" checked={visible} onChange={(e) => setVisible(e.target.checked)} />}
              {error && !Object.keys(campos).length && <FormAlert>{errorMessage(error)}</FormAlert>}
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setAccion(null)}>
                  Volver
                </Button>
                <Button type="submit" loading={cambiar.isPending || nota.isPending}>
                  {accion === 'asignar' ? 'Asignar' : accion === 'resolver' ? 'Marcar como resuelto' : 'Guardar la nota'}
                </Button>
              </div>
            </form>
          )}
          {!accion && error && <FormAlert>{errorMessage(error)}</FormAlert>}
        </div>
      )}
    </Modal>
  );
}

/* ───────────────────────── Tomar un reclamo (teléfono u oficina) ───────────────────────── */

function NuevoReclamo({ onClose, inicial }: { onClose: () => void; inicial?: { socioId: number | null; conexionId: number | null } }) {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [buscado, setBuscado] = useState('');
  const [socioId, setSocioId] = useState<number | null>(inicial?.socioId ?? null);
  const [conexionId, setConexionId] = useState<number | null>(inicial?.conexionId ?? null);
  const [direccion, setDireccion] = useState('');
  const [servicio, setServicio] = useState<ServicioReclamo>('energia');
  const [tipo, setTipo] = useState(TIPOS_RECLAMO.energia[0]!.codigo);
  const [descripcion, setDescripcion] = useState('');
  const [origen, setOrigen] = useState<'telefono' | 'oficina'>('telefono');
  const [contacto, setContacto] = useState('');
  const socios = useQuery({ queryKey: ['padron', 'buscar', buscado], queryFn: () => api.get<Page<SocioListado>>(`/padron/socios${qs({ q: buscado, limit: 6 })}`), enabled: buscado.length >= 2 });
  const socio = useQuery({ queryKey: ['socio', socioId], queryFn: () => api.get<SocioDetalle>(`/padron/socios/${socioId}`), enabled: socioId !== null });
  const crear = useMutation({
    mutationFn: () =>
      api.post<ReclamoDetalle>('/reclamos', {
        socioId,
        conexionId,
        servicio,
        tipo,
        descripcion: descripcion || undefined,
        origen,
        direccion: conexionId ? undefined : direccion || undefined,
        contacto: contacto || undefined,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['reclamos'] });
      onClose();
    },
  });
  const campos = crear.error instanceof ApiError ? (crear.error.fields ?? {}) : {};
  const conexiones = socio.data?.conexiones ?? [];

  return (
    <Modal
      wide
      title="Tomar un reclamo"
      description="Por teléfono o en la oficina."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="form-nuevo-reclamo" loading={crear.isPending}>
            Cargar el reclamo
          </Button>
        </>
      }
    >
      <form
        id="form-nuevo-reclamo"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          crear.mutate();
        }}
      >
        {socioId === null ? (
          <div className="space-y-2">
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Field
                  label="Socio"
                  placeholder="Nombre, DNI o número de socio"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      setBuscado(q.trim());
                    }
                  }}
                  autoFocus
                />
              </div>
              <Button variant="secondary" icon={Search} onClick={() => setBuscado(q.trim())}>
                Buscar
              </Button>
            </div>
            {socios.data && (
              <ul className="divide-y divide-linea rounded-xl border border-linea">
                {socios.data.items.length === 0 && <li className="px-4 py-3 text-sm text-tinta-suave">No encontramos a nadie.</li>}
                {socios.data.items.map((s) => (
                  <li key={s.id}>
                    <button type="button" onClick={() => setSocioId(s.id)} className="w-full px-4 py-2.5 text-left hover:bg-marca-tenue/50">
                      <span className="block font-semibold text-tinta">{s.nombre}</span>
                      <span className="block text-sm text-tinta-suave">
                        Socio {s.numero}
                        {s.direccion && ` · ${s.direccion}`}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <Field label="O escribí dónde es (sin socio)" placeholder="Por ejemplo: esquina de la plaza" value={direccion} onChange={(e) => setDireccion(e.target.value)} error={campos.direccion} />
          </div>
        ) : (
          <div className="space-y-2 rounded-xl bg-fondo px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold text-tinta">{socio.data?.nombre ?? '…'}</p>
              <Button variant="ghost" onClick={() => (setSocioId(null), setConexionId(null))}>
                Cambiar
              </Button>
            </div>
            {conexiones.length > 0 && (
              <SelectField label="Domicilio" value={conexionId ?? ''} onChange={(e) => setConexionId(Number(e.target.value) || null)}>
                <option value="">Elegí el domicilio</option>
                {conexiones.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.direccion}
                  </option>
                ))}
              </SelectField>
            )}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            label="Servicio"
            value={servicio}
            onChange={(e) => {
              const s = e.target.value as ServicioReclamo;
              setServicio(s);
              setTipo(TIPOS_RECLAMO[s][0]!.codigo);
            }}
          >
            {SERVICIOS_RECLAMO.map((s) => (
              <option key={s} value={s}>
                {SERVICIO_RECLAMO_ETIQUETA[s]}
              </option>
            ))}
          </SelectField>
          <SelectField label="¿Qué pasa?" value={tipo} onChange={(e) => setTipo(e.target.value)} error={campos.tipo}>
            {TIPOS_RECLAMO[servicio].map((t) => (
              <option key={t.codigo} value={t.codigo}>
                {t.nombre}
              </option>
            ))}
          </SelectField>
          <SelectField label="Cómo llegó" value={origen} onChange={(e) => setOrigen(e.target.value as 'telefono' | 'oficina')}>
            <option value="telefono">Por teléfono</option>
            <option value="oficina">En la oficina</option>
          </SelectField>
          <Field label="Teléfono para avisarle" type="tel" value={contacto} onChange={(e) => setContacto(e.target.value)} error={campos.contacto} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="nuevo-reclamo-descripcion" className="block text-sm font-semibold text-tinta">
            Lo que cuenta
          </label>
          <textarea
            id="nuevo-reclamo-descripcion"
            rows={3}
            maxLength={500}
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            className="block w-full rounded-xl border border-linea bg-superficie px-4 py-3 text-base text-tinta hover:border-marca-claro focus:border-marca"
          />
        </div>
        {crear.isError && !Object.keys(campos).length && <FormAlert>{errorMessage(crear.error)}</FormAlert>}
      </form>
    </Modal>
  );
}

/* ───────────────────────── Cortes programados ───────────────────────── */

function Cortes({ atiende }: { atiende: boolean }) {
  const qc = useQueryClient();
  const consulta = useQuery({ queryKey: ['cortes'], queryFn: () => api.get<{ proximos: CorteProgramado[]; pasados: CorteProgramado[] }>('/cortes') });
  const cancelar = useMutation({ mutationFn: (id: number) => api.post(`/cortes/${id}/cancelar`), onSuccess: () => qc.invalidateQueries({ queryKey: ['cortes'] }) });
  const d = consulta.data;
  if (consulta.isPending) return <Skeleton className="h-60 rounded-2xl" />;
  if (consulta.isError || !d) return <ErrorState message={errorMessage(consulta.error)} onRetry={() => void consulta.refetch()} />;

  const lista = (cortes: CorteProgramado[], pasados: boolean) => (
    <ul className="divide-y divide-linea">
      {cortes.map((c) => (
        <li key={c.id} className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3', (c.cancelado || pasados) && 'opacity-70')}>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-tinta">
                {SERVICIO_ETIQUETA[c.servicio]} · {c.zona ? c.zona.nombre : 'Toda la localidad'}
              </span>
              {c.cancelado && <Badge>Cancelado</Badge>}
            </span>
            <span className="block text-sm text-tinta-suave">
              {formatDateTime(c.desde)} a {formatDateTime(c.hasta).slice(11)} · {c.motivo}
            </span>
          </span>
          <span className="text-sm text-tinta-suave">{c.avisados} socios avisados</span>
          {atiende && !pasados && !c.cancelado && (
            <Button variant="ghost" loading={cancelar.isPending && cancelar.variables === c.id} onClick={() => cancelar.mutate(c.id)}>
              Cancelar
            </Button>
          )}
        </li>
      ))}
    </ul>
  );

  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-2 font-bold text-tinta">Próximos</h2>
        <Card className="overflow-hidden">
          {d.proximos.length === 0 ? (
            <Empty icon={PowerOff} title="No hay cortes programados">
              Cuando programes uno, les avisamos por email a los socios de esa zona y lo ven en la app.
            </Empty>
          ) : (
            lista(d.proximos, false)
          )}
        </Card>
      </section>
      {d.pasados.length > 0 && (
        <section>
          <h2 className="mb-2 font-bold text-tinta">Anteriores</h2>
          <Card className="overflow-hidden">{lista(d.pasados, true)}</Card>
        </section>
      )}
      {cancelar.isError && <FormAlert>{errorMessage(cancelar.error)}</FormAlert>}
    </div>
  );
}

function NuevoCorte({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const zonas = useQuery({ queryKey: ['padron', 'resumen'], queryFn: () => api.get<PadronResumen>('/padron/resumen') });
  const [manana] = useState(() => new Date(Date.now() + 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }));
  const [zonaId, setZonaId] = useState<string>('');
  const [servicio, setServicio] = useState<(typeof SERVICIOS_CORTE)[number]>('energia');
  const [fecha, setFecha] = useState(manana);
  const [desde, setDesde] = useState('08:00');
  const [hasta, setHasta] = useState('12:00');
  const [motivo, setMotivo] = useState('');
  const crear = useMutation({
    mutationFn: () =>
      api.post<CorteProgramado>('/cortes', {
        zonaId: zonaId ? Number(zonaId) : null,
        servicio,
        desde: `${fecha}T${desde}:00-03:00`,
        hasta: `${fecha}T${hasta}:00-03:00`,
        motivo,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cortes'] });
      onClose();
    },
  });
  const campos = crear.error instanceof ApiError ? (crear.error.fields ?? {}) : {};
  return (
    <Modal
      title="Programar un corte"
      description="Les avisamos por email a los socios de la zona con ese servicio, y lo ven en el inicio de la app."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="form-corte" loading={crear.isPending}>
            Programar y avisar
          </Button>
        </>
      }
    >
      <form
        id="form-corte"
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          crear.mutate();
        }}
      >
        <SelectField label="Servicio" value={servicio} onChange={(e) => setServicio(e.target.value as typeof servicio)}>
          {SERVICIOS_CORTE.map((s) => (
            <option key={s} value={s}>
              {SERVICIO_ETIQUETA[s]}
            </option>
          ))}
        </SelectField>
        <SelectField label="Zona" value={zonaId} onChange={(e) => setZonaId(e.target.value)} error={campos.zonaId}>
          <option value="">Toda la localidad</option>
          {zonas.data?.zonas.map((z) => (
            <option key={z.id} value={z.id}>
              {z.nombre}
            </option>
          ))}
        </SelectField>
        <Field label="Día" type="date" value={fecha} min={manana} onChange={(e) => setFecha(e.target.value)} />
        <div className="grid grid-cols-2 gap-2">
          <Field label="Desde" type="time" value={desde} onChange={(e) => setDesde(e.target.value)} error={campos.desde} />
          <Field label="Hasta" type="time" value={hasta} onChange={(e) => setHasta(e.target.value)} error={campos.hasta} />
        </div>
        <div className="sm:col-span-2">
          <Field label="Motivo" placeholder="Por ejemplo: cambio de transformador" value={motivo} onChange={(e) => setMotivo(e.target.value)} error={campos.motivo} />
        </div>
        {crear.isError && !Object.keys(campos).length && (
          <div className="sm:col-span-2">
            <FormAlert>{errorMessage(crear.error)}</FormAlert>
          </div>
        )}
      </form>
    </Modal>
  );
}
