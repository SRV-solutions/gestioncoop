// Reclamos del socio (SPEC 6.7 y 6.8): hacer uno en pocos toques —qué servicio, qué pasa, una foto y
// dónde— y seguir cómo va, paso por paso.
import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, Check, ChevronDown, CircleCheck, Droplets, LocateFixed, MessageSquareWarning, Plus, ReceiptText, Trash2, TriangleAlert, Tv, Wifi, Zap, type LucideIcon } from 'lucide-react';
import {
  ESTADO_RECLAMO_ETIQUETA,
  ESTADO_RECLAMO_SOCIO,
  ESTADOS_RECLAMO,
  formatDateTime,
  SERVICIO_RECLAMO_ETIQUETA,
  TIPOS_RECLAMO,
  type CuentaPortal,
  type ReclamoDetalle,
  type ReclamoSocioInput,
  type ServicioReclamo,
} from '@shared';
import { api, ApiError, errorMessage } from '../../lib/api';
import { cn } from '../../lib/cn';
import { achicarFoto } from '../../lib/foto';
import { Badge, Button, Card, Empty, ErrorState, FormAlert, Skeleton } from '../../components/ui';
import { SubPagina } from './piezas';

const ICONO: Record<ServicioReclamo, LucideIcon> = { energia: Zap, agua: Droplets, internet: Wifi, tv: Tv, administrativo: ReceiptText };
const TONO = { nuevo: 'alerta', asignado: 'marca', en_curso: 'marca', resuelto: 'exito' } as const;

/* ───────────────────────── Mis reclamos ───────────────────────── */

export function ReclamosSocioPage() {
  const consulta = useQuery({ queryKey: ['socio', 'reclamos'], queryFn: () => api.get<ReclamoDetalle[]>('/socio/reclamos') });
  const [abierto, setAbierto] = useState<number | null>(null);
  const lista = consulta.data;

  return (
    <SubPagina
      titulo="Reclamos"
      volver={{ to: '/socio/mas', texto: 'Más' }}
      accion={
        <Link to="/socio/mas/reclamos/nuevo" className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-marca px-4 font-bold text-white hover:bg-marca-fuerte">
          <Plus className="size-5" aria-hidden />
          Nuevo
        </Link>
      }
    >
      {consulta.isPending ? (
        <Skeleton className="h-72 rounded-2xl" />
      ) : consulta.isError || !lista ? (
        <ErrorState message={errorMessage(consulta.error)} onRetry={() => void consulta.refetch()} />
      ) : lista.length === 0 ? (
        <Card>
          <Empty
            icon={MessageSquareWarning}
            title="No hiciste reclamos"
            action={
              <Link to="/socio/mas/reclamos/nuevo" className="inline-flex min-h-12 items-center rounded-xl bg-marca px-5 font-bold text-white hover:bg-marca-fuerte">
                Hacer un reclamo
              </Link>
            }
          >
            Si tenés un problema con la luz, el agua o internet, avisanos desde acá y seguí cómo se resuelve.
          </Empty>
        </Card>
      ) : (
        <ul className="space-y-3">
          {lista.map((r) => {
            const Icon = ICONO[r.servicio];
            const ver = abierto === r.id || (abierto === null && r.estado !== 'resuelto' && r === lista[0]);
            return (
              <li key={r.id}>
                <Card className="overflow-hidden">
                  <button
                    type="button"
                    aria-expanded={ver}
                    onClick={() => setAbierto(ver ? -1 : r.id)}
                    className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-marca-tenue/30"
                  >
                    <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-marca-tenue text-marca-texto">
                      <Icon className="size-5" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-bold text-tinta">{r.tipoNombre}</span>
                      <span className="block text-sm text-tinta-suave">
                        {r.referencia} · {formatDateTime(r.creadoEl)}
                      </span>
                    </span>
                    <Badge tone={TONO[r.estado]}>{ESTADO_RECLAMO_ETIQUETA[r.estado]}</Badge>
                    <ChevronDown className={cn('size-5 shrink-0 text-tinta-suave transition-transform duration-150', ver && 'rotate-180')} aria-hidden />
                  </button>
                  {ver && <Seguimiento r={r} />}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </SubPagina>
  );
}

/** Los cuatro pasos, con los hechos marcados y lo que dijo la cooperativa en cada uno. */
function Seguimiento({ r }: { r: ReclamoDetalle }) {
  const hecho = (e: (typeof ESTADOS_RECLAMO)[number]) => ESTADOS_RECLAMO.indexOf(e) <= ESTADOS_RECLAMO.indexOf(r.estado);
  return (
    <div className="border-t border-linea px-4 py-4">
      {r.descripcion && <p className="mb-3 rounded-xl bg-fondo px-3 py-2 text-tinta">“{r.descripcion}”</p>}
      {r.tieneFoto && <img src={`/api/v1/socio/reclamos/${r.id}/foto`} alt="La foto que mandaste" className="mb-3 max-h-56 w-full rounded-xl object-cover" loading="lazy" />}
      <ol className="space-y-0">
        {ESTADOS_RECLAMO.map((e, i) => {
          const evento = [...r.eventos].reverse().find((x) => x.estado === e);
          return (
            <li key={e} className="relative flex gap-3 pb-4 last:pb-0">
              {i < ESTADOS_RECLAMO.length - 1 && <span aria-hidden className={cn('absolute left-[0.9rem] top-8 h-[calc(100%-2rem)] w-0.5', hecho(ESTADOS_RECLAMO[i + 1]!) ? 'bg-exito' : 'bg-linea')} />}
              <span className={cn('grid size-7 shrink-0 place-items-center rounded-full', hecho(e) ? 'bg-exito text-sobre-estado' : 'border-2 border-linea bg-superficie')}>
                {hecho(e) && <Check className="size-4" aria-hidden />}
              </span>
              <div className="min-w-0 pt-0.5">
                <p className={cn('font-semibold', hecho(e) ? 'text-tinta' : 'text-tinta-suave')}>
                  {ESTADO_RECLAMO_ETIQUETA[e]}
                  <span className="sr-only">{hecho(e) ? ' (hecho)' : ' (todavía no)'}</span>
                </p>
                {evento && <p className="text-sm text-tinta-suave">{formatDateTime(evento.creadoEl)}</p>}
                {evento && e === r.estado && e !== 'resuelto' && <p className="text-sm text-tinta">{ESTADO_RECLAMO_SOCIO[e]}</p>}
                {evento?.nota && <p className="text-sm text-tinta">{evento.nota}</p>}
              </div>
            </li>
          );
        })}
      </ol>
      {/* Notas sueltas que la cooperativa dejó visibles. */}
      {r.eventos
        .filter((x) => x.estado === null && x.nota)
        .map((x) => (
          <p key={x.id} className="mt-3 rounded-xl bg-marca-tenue px-3 py-2 text-sm text-tinta">
            <strong>Cooperativa:</strong> {x.nota} <span className="text-tinta-suave">· {formatDateTime(x.creadoEl)}</span>
          </p>
        ))}
    </div>
  );
}

/* ───────────────────────── Nuevo reclamo ───────────────────────── */

export function NuevoReclamoPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const cuenta = useQuery({ queryKey: ['socio', 'cuenta'], queryFn: () => api.get<CuentaPortal>('/socio/cuenta') });
  const [conexionId, setConexionId] = useState<number | null>(null);
  const [servicio, setServicio] = useState<ServicioReclamo | null>(null);
  const [tipo, setTipo] = useState<string | null>(null);
  const [descripcion, setDescripcion] = useState('');
  const [foto, setFoto] = useState<string | null>(null);
  const [fotoError, setFotoError] = useState<string | null>(null);
  const [ubicacion, setUbicacion] = useState<{ lat: number; lng: number } | null>(null);
  const [ubicando, setUbicando] = useState(false);
  const [creado, setCreado] = useState<ReclamoDetalle | null>(null);

  const conexiones = cuenta.data?.conexiones ?? [];
  const conexion = conexiones.length === 1 ? conexiones[0]! : (conexiones.find((c) => c.id === conexionId) ?? null);
  const servicios: ServicioReclamo[] = conexion
    ? [...(['energia', 'agua', 'internet', 'tv'] as const).filter((s) => conexion.servicios.some((x) => x.servicio === s && x.estado !== 'baja')), 'administrativo']
    : [];
  const tipoElegido = servicio && tipo ? TIPOS_RECLAMO[servicio].find((t) => t.codigo === tipo) : undefined;

  const enviar = useMutation({
    mutationFn: () =>
      api.post<ReclamoDetalle>('/socio/reclamos', {
        conexionId: conexion!.id,
        servicio: servicio!,
        tipo: tipo!,
        descripcion: descripcion.trim() || undefined,
        foto,
        lat: ubicacion?.lat ?? null,
        lng: ubicacion?.lng ?? null,
      } satisfies ReclamoSocioInput),
    onSuccess: (r) => {
      setCreado(r);
      void qc.invalidateQueries({ queryKey: ['socio'] });
    },
  });

  const elegirFoto = async (archivo: File | undefined) => {
    if (!archivo) return;
    setFotoError(null);
    try {
      setFoto(await achicarFoto(archivo));
    } catch {
      setFotoError('No pudimos usar esa foto. Probá con otra.');
    }
  };
  const ubicar = () => {
    if (!navigator.geolocation) return;
    setUbicando(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setUbicacion({ lat: p.coords.latitude, lng: p.coords.longitude });
        setUbicando(false);
      },
      () => setUbicando(false),
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  };

  if (creado) {
    return (
      <Card className="mt-4 px-5 py-8 text-center">
        <div role="status">
          <div className="mx-auto grid size-16 place-items-center rounded-full bg-exito-tenue text-exito">
            <CircleCheck className="size-9" aria-hidden />
          </div>
          <h1 className="mt-4 text-2xl font-black tracking-tight">Recibimos tu reclamo</h1>
          <p className="mt-1 text-tinta-suave">
            Es el <strong className="text-tinta">{creado.referencia}</strong>. Te vamos a avisar cuando haya novedades{cuenta.data?.email ? ' por email' : ''}.
          </p>
        </div>
        <div className="mt-6 space-y-2">
          <Button size="lg" className="w-full" onClick={() => navigate('/socio/mas/reclamos')}>
            Ver cómo va
          </Button>
          <Link to="/socio" className="inline-flex min-h-11 items-center font-semibold text-marca-texto hover:underline">
            Ir al inicio
          </Link>
        </div>
      </Card>
    );
  }

  return (
    <SubPagina titulo="Nuevo reclamo" volver={{ to: '/socio/mas/reclamos', texto: 'Reclamos' }}>
      {cuenta.isPending ? (
        <Skeleton className="h-72 rounded-2xl" />
      ) : cuenta.isError ? (
        <ErrorState message={errorMessage(cuenta.error)} onRetry={() => void cuenta.refetch()} />
      ) : (
        <div className="space-y-6">
          {conexiones.length > 1 && (
            <Paso numero={1} titulo="¿Dónde?">
              <div className="grid gap-2">
                {conexiones.map((c) => (
                  <Opcion key={c.id} activa={conexion?.id === c.id} onClick={() => (setConexionId(c.id), setServicio(null), setTipo(null))}>
                    {c.direccion}
                  </Opcion>
                ))}
              </div>
            </Paso>
          )}

          {conexion && (
            <Paso numero={conexiones.length > 1 ? 2 : 1} titulo="¿Con qué?">
              <div className="grid grid-cols-2 gap-2">
                {servicios.map((s) => {
                  const Icon = ICONO[s];
                  return (
                    <Opcion key={s} activa={servicio === s} onClick={() => (setServicio(s), setTipo(null))} alto>
                      <Icon className="size-6" aria-hidden />
                      {SERVICIO_RECLAMO_ETIQUETA[s]}
                    </Opcion>
                  );
                })}
              </div>
            </Paso>
          )}

          {servicio && (
            <Paso numero={conexiones.length > 1 ? 3 : 2} titulo="¿Qué pasa?">
              <div className="grid gap-2">
                {TIPOS_RECLAMO[servicio].map((t) => (
                  <Opcion key={t.codigo} activa={tipo === t.codigo} onClick={() => setTipo(t.codigo)}>
                    {t.nombre}
                  </Opcion>
                ))}
              </div>
              {tipoElegido?.ayuda && (
                <p className="mt-3 flex items-start gap-2.5 rounded-xl bg-acento-tenue px-4 py-3 text-tinta">
                  <TriangleAlert className="mt-0.5 size-5 shrink-0 text-alerta" aria-hidden />
                  <span>
                    {tipoElegido.ayuda}
                    {tipoElegido.prioridad === 'urgente' && ' La guardia atiende las 24 horas.'}
                  </span>
                </p>
              )}
            </Paso>
          )}

          {tipo && (
            <Paso numero={conexiones.length > 1 ? 4 : 3} titulo="Contanos un poco más" opcional>
              <label htmlFor="reclamo-descripcion" className="sr-only">
                Descripción
              </label>
              <textarea
                id="reclamo-descripcion"
                value={descripcion}
                onChange={(e) => setDescripcion(e.target.value)}
                maxLength={500}
                rows={3}
                placeholder="Por ejemplo: desde anoche, en toda la cuadra"
                className="block w-full rounded-xl border border-linea bg-superficie px-4 py-3 text-base text-tinta placeholder:text-tinta-suave/80 hover:border-marca-claro focus:border-marca"
              />
              <div className="mt-3 grid grid-cols-2 gap-2">
                {foto ? (
                  <div className="relative col-span-2">
                    <img src={foto} alt="La foto que vas a mandar" className="max-h-56 w-full rounded-xl object-cover" />
                    <Button variant="secondary" icon={Trash2} className="absolute right-2 top-2" onClick={() => setFoto(null)}>
                      Sacarla
                    </Button>
                  </div>
                ) : (
                  <label className="flex min-h-14 cursor-pointer items-center justify-center gap-2 rounded-xl border border-linea bg-superficie font-semibold text-tinta hover:border-marca has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-marca-claro">
                    <Camera className="size-5 text-marca-texto" aria-hidden />
                    Sumar una foto
                    <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => void elegirFoto(e.target.files?.[0])} />
                  </label>
                )}
                {!foto && (
                  <Button variant="secondary" icon={LocateFixed} loading={ubicando} onClick={ubicar} className="min-h-14">
                    {ubicacion ? 'Ubicación lista' : 'Mi ubicación'}
                  </Button>
                )}
              </div>
              {fotoError && <p className="mt-2 text-sm font-medium text-peligro">{fotoError}</p>}
              <p className="mt-2 text-sm text-tinta-suave">
                {ubicacion ? 'Vamos a usar el lugar donde estás ahora.' : `Si no mandás tu ubicación, usamos la de ${conexion?.direccion}.`}
              </p>
            </Paso>
          )}

          {tipo && (
            <div className="space-y-2">
              {enviar.isError && <FormAlert>{enviar.error instanceof ApiError && enviar.error.fields ? Object.values(enviar.error.fields)[0] : errorMessage(enviar.error)}</FormAlert>}
              <Button size="xl" className="w-full" loading={enviar.isPending} onClick={() => enviar.mutate()}>
                Enviar el reclamo
              </Button>
            </div>
          )}
        </div>
      )}
    </SubPagina>
  );
}

function Paso({ numero, titulo, opcional, children }: { numero: number; titulo: string; opcional?: boolean; children: ReactNode }) {
  return (
    <section className="animate-aparecer">
      <h2 className="mb-2.5 flex items-center gap-2.5 text-lg font-bold">
        <span className="grid size-7 place-items-center rounded-full bg-marca text-sm text-white">{numero}</span>
        {titulo}
        {opcional && <span className="text-sm font-normal text-tinta-suave">(si querés)</span>}
      </h2>
      {children}
    </section>
  );
}

function Opcion({ activa, onClick, alto, children }: { activa: boolean; onClick: () => void; alto?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={activa}
      onClick={onClick}
      className={cn(
        'flex items-center gap-3 rounded-xl border-2 px-4 text-left font-semibold transition-colors duration-150',
        alto ? 'min-h-20 flex-col justify-center gap-1.5 text-center' : 'min-h-14',
        activa ? 'border-marca bg-marca-tenue text-marca-texto' : 'border-linea bg-superficie text-tinta hover:border-marca-claro',
      )}
    >
      {children}
    </button>
  );
}
