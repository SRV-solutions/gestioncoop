// Lo que se abre a la derecha del mapa: la ficha de una casa, un reclamo o el resumen de un área
// dibujada (SPEC 6.10). Cada panel responde una pregunta y ofrece los accesos para seguir.
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Banknote, FileSpreadsheet, FileText, FileType, Gauge, MapPin, MessageSquareWarning, Trash2, X, type LucideIcon } from 'lucide-react';
import {
  ESTADO_RECLAMO_ETIQUETA,
  formatDate,
  formatMoney,
  formatNumber,
  nombreDeMes,
  PRIORIDAD_ETIQUETA,
  SERVICIO_ETIQUETA,
  SERVICIO_RECLAMO_ETIQUETA,
  SITUACION_ETIQUETA,
  type FichaMapa,
  type FormatoInforme,
  type ReclamoMapa,
  type ResumenArea,
  type ServicioConexion,
  type Situacion,
} from '@shared';
import { api, descargar, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { cn } from '../../lib/cn';
import { EstadoServicioBadge, SERVICIO_CORTO, SERVICIO_ICON } from '../../components/servicios';
import { Badge, Button, ErrorState, FormAlert, Skeleton } from '../../components/ui';

const MES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const TONO: Record<Situacion, 'exito' | 'alerta' | 'peligro' | 'neutral'> = { al_dia: 'exito', con_deuda: 'alerta', en_mora: 'peligro', cortado: 'neutral', baja: 'neutral' };

/** «hace 3 h», «hace 2 días». */
function hace(iso: string): string {
  const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (min < 60) return `hace ${min} min`;
  if (min < 48 * 60) return `hace ${Math.floor(min / 60)} h`;
  return `hace ${Math.round(min / 1440)} días`;
}

/** Marco común: en la PC va a la derecha; en pantallas chicas sube desde abajo. */
export function Panel({ etiqueta, titulo, subtitulo, onClose, pie, children }: { etiqueta: string; titulo: ReactNode; subtitulo?: ReactNode; onClose: () => void; pie?: ReactNode; children: ReactNode }) {
  return (
    <aside
      aria-label={etiqueta}
      // En escritorio no llega hasta abajo: la atribución del mapa (obligatoria) tiene que quedar a la vista.
      className={cn(
        'absolute z-10 flex animate-aparecer flex-col overflow-hidden border-linea bg-superficie shadow-2xl shadow-black/20',
        'inset-x-0 bottom-0 max-h-[60%] rounded-t-3xl border-t lg:inset-x-auto lg:bottom-12 lg:right-3 lg:top-3 lg:max-h-none lg:w-[23rem] lg:rounded-3xl lg:border',
      )}
    >
      <header className="flex items-start gap-3 border-b border-linea px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-lg font-bold leading-tight text-tinta">{titulo}</div>
          {subtitulo && <div className="mt-0.5 text-sm text-tinta-suave">{subtitulo}</div>}
        </div>
        <button type="button" aria-label="Cerrar" onClick={onClose} className="grid size-11 shrink-0 place-items-center rounded-xl text-tinta-suave hover:bg-marca-tenue hover:text-marca-texto">
          <X className="size-5" aria-hidden />
        </button>
      </header>
      <div className="flex-1 overflow-y-auto px-4 py-3">{children}</div>
      {pie && <footer className="border-t border-linea p-3">{pie}</footer>}
    </aside>
  );
}

const Titulo = ({ children }: { children: ReactNode }) => <h3 className="mb-1.5 mt-4 text-xs font-bold uppercase tracking-wide text-tinta-suave first:mt-0">{children}</h3>;
const enlace = 'flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 font-semibold transition-colors duration-150';

/* ───────────────────────── Ficha de una casa ───────────────────────── */

export function FichaCasa({ id, onClose }: { id: number; onClose: () => void }) {
  const { hasRole } = useAuth();
  const ficha = useQuery({ queryKey: ['mapa', 'ficha', id], queryFn: () => api.get<FichaMapa>(`/mapa/conexiones/${id}`), refetchInterval: 30_000 });
  const f = ficha.data;
  const cobra = hasRole('cajero') || hasRole('admin') || hasRole('superadmin');
  const atiende = hasRole('admin') || hasRole('superadmin');
  return (
    <Panel
      etiqueta="Conexión elegida"
      onClose={onClose}
      titulo={f ? f.socio.nombre : <Skeleton className="h-6 w-48" />}
      subtitulo={
        f && (
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            Socio <span className="tabular-nums">{f.socio.numero}</span>
            <Badge tone={TONO[f.situacion]}>{SITUACION_ETIQUETA[f.situacion]}</Badge>
          </span>
        )
      }
      pie={
        f && (
          <div className="grid gap-2">
            <Link to={`/padron?socio=${f.socio.id}`} className={cn(enlace, 'bg-marca text-white hover:bg-marca-fuerte')}>
              Ver ficha del socio
              <ArrowRight className="size-4" aria-hidden />
            </Link>
            {(cobra || atiende) && (
              <div className="grid grid-cols-2 gap-2">
                {cobra && (
                  <Link to={`/caja?socio=${f.socio.id}`} className={cn(enlace, 'border border-linea text-tinta hover:border-marca hover:text-marca-texto', !atiende && 'col-span-2')}>
                    <Banknote className="size-4" aria-hidden />
                    Cobrar
                  </Link>
                )}
                {atiende && (
                  <Link to={`/reclamos?nuevo=1&socio=${f.socio.id}&conexion=${f.id}`} className={cn(enlace, 'border border-linea text-tinta hover:border-marca hover:text-marca-texto', !cobra && 'col-span-2')}>
                    <MessageSquareWarning className="size-4" aria-hidden />
                    Crear reclamo
                  </Link>
                )}
              </div>
            )}
          </div>
        )
      }
    >
      {ficha.isPending ? (
        <div className="space-y-3">
          <Skeleton className="h-5 w-56" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : ficha.isError || !f ? (
        <ErrorState message={errorMessage(ficha.error)} onRetry={() => void ficha.refetch()} className="py-6" />
      ) : (
        <>
          <p className="flex items-start gap-2 font-semibold text-tinta">
            <MapPin className="mt-0.5 size-4 shrink-0 text-marca-texto" aria-hidden />
            {f.direccion}
          </p>
          <p className="pl-6 text-sm text-tinta-suave">
            Conexión <span className="tabular-nums">{f.numero}</span>
            {f.zona && ` · ${f.zona}`}
            {f.telefono && ` · ${f.telefono}`}
          </p>

          <div className={cn('mt-3 rounded-2xl px-4 py-3', Number(f.deuda.total) > 0 ? 'bg-peligro-tenue' : 'bg-exito-tenue')}>
            {Number(f.deuda.total) > 0 ? (
              <>
                <p className="text-sm font-semibold text-tinta-suave">Debe</p>
                <p className="text-2xl font-black tracking-tight text-tinta">{formatMoney(f.deuda.total)}</p>
                <p className="text-sm text-tinta">
                  {f.deuda.facturas} {f.deuda.facturas === 1 ? 'factura' : 'facturas'}
                  {f.deuda.vencidas > 0 ? `, ${f.deuda.vencidas} ${f.deuda.vencidas === 1 ? 'vencida' : 'vencidas'}` : ', todavía sin vencer'}
                  {f.deuda.masVieja && f.deuda.vencidas > 0 && ` · la más vieja venció el ${formatDate(f.deuda.masVieja)}`}
                </p>
              </>
            ) : (
              <p className="font-bold text-tinta">Está al día: no debe nada.</p>
            )}
          </div>

          <Titulo>Servicios</Titulo>
          <ul className="space-y-1.5">
            {f.servicios.map((s) => {
              const Icon = SERVICIO_ICON[s.servicio];
              return (
                <li key={s.id} className="flex items-center gap-2.5">
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-marca-tenue text-marca-texto">
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-tinta">
                    {SERVICIO_ETIQUETA[s.servicio]}
                    {s.plan && <span className="font-normal text-tinta-suave"> · {s.plan}</span>}
                  </span>
                  <EstadoServicioBadge estado={s.estado} />
                </li>
              );
            })}
          </ul>

          {f.consumo.map((c) => (
            <Consumo key={c.servicio} c={c} />
          ))}

          {f.lecturas.length > 0 && (
            <>
              <Titulo>Última lectura</Titulo>
              <ul className="space-y-1.5">
                {f.lecturas.map((l) => (
                  <li key={l.medidor} className="flex items-start gap-2 text-sm text-tinta">
                    <Gauge className="mt-0.5 size-4 shrink-0 text-tinta-suave" aria-hidden />
                    <span>
                      {SERVICIO_CORTO[l.servicio]}: {l.valor === null ? 'no se pudo leer' : <strong className="tabular-nums">{formatNumber(l.valor)}</strong>}
                      <span className="text-tinta-suave">
                        {' '}
                        · {formatDate(l.tomadaEl)}
                        {l.estimada && ' · estimada'}
                        {l.delMesEnLectura ? ' · es la de este mes' : ''}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
              {f.lecturaDelMes === 'pendiente' && <p className="mt-1.5 text-sm font-semibold text-alerta">Todavía falta leerla este mes.</p>}
            </>
          )}

          <Titulo>Reclamos abiertos</Titulo>
          {f.reclamos.length === 0 ? (
            <p className="text-sm text-tinta-suave">No tiene ninguno.</p>
          ) : (
            <ul className="space-y-1.5">
              {f.reclamos.map((r) => (
                <li key={r.id}>
                  <Link to={`/reclamos?ver=${r.id}`} className="block rounded-xl border border-linea px-3 py-2 text-sm hover:border-marca">
                    <span className="font-semibold text-tinta">{r.tipoNombre}</span>
                    <span className="block text-tinta-suave">
                      {r.referencia} · {ESTADO_RECLAMO_ETIQUETA[r.estado]} · {hace(r.creadoEl)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Panel>
  );
}

/** Mini gráfico de 12 meses: barras finas, el último mes destacado y su número escrito. */
function Consumo({ c }: { c: FichaMapa['consumo'][number] }) {
  const max = Math.max(1, ...c.meses.map((m) => m.consumo ?? 0));
  const ultimo = [...c.meses].reverse().find((m) => m.consumo !== null);
  const ANCHO = 300;
  const ALTO = 56;
  const banda = ANCHO / c.meses.length;
  return (
    <>
      <Titulo>
        Consumo de {SERVICIO_CORTO[c.servicio].toLowerCase()}, últimos 12 meses
      </Titulo>
      {ultimo && (
        <p className="text-sm text-tinta">
          <strong className="tabular-nums">
            {formatNumber(Math.round(ultimo.consumo!))} {c.unidad}
          </strong>{' '}
          en {nombreDeMes(ultimo.anio, ultimo.mes).split(' ')[0]}
        </p>
      )}
      <svg viewBox={`0 0 ${ANCHO} ${ALTO + 14}`} className="mt-1 block w-full" role="img" aria-label={`Consumo de ${SERVICIO_CORTO[c.servicio].toLowerCase()} de los últimos 12 meses, en ${c.unidad}: ${c.meses.map((m) => `${MES_CORTO[m.mes - 1]} ${m.consumo === null ? 'sin dato' : Math.round(m.consumo)}`).join(', ')}`}>
        <line x1={0} x2={ANCHO} y1={ALTO} y2={ALTO} stroke="var(--grafico-eje)" strokeWidth={1} />
        {c.meses.map((m, i) => {
          const alto = m.consumo === null ? 0 : Math.max((m.consumo / max) * (ALTO - 4), 1);
          const x = i * banda + banda / 2;
          return (
            <g key={`${m.anio}-${m.mes}`}>
              {m.consumo !== null && (
                <rect x={x - 6} y={ALTO - alto} width={12} height={alto} rx={Math.min(3, alto / 2)} className={m === ultimo ? 'fill-marca' : 'fill-marca-claro'}>
                  <title>{`${nombreDeMes(m.anio, m.mes)}: ${formatNumber(Math.round(m.consumo))} ${c.unidad}`}</title>
                </rect>
              )}
              <text x={x} y={ALTO + 11} textAnchor="middle" fontSize={9} className={m === ultimo ? 'fill-tinta font-bold' : 'fill-tinta-suave'}>
                {MES_CORTO[m.mes - 1]![0]!.toUpperCase()}
              </text>
            </g>
          );
        })}
      </svg>
    </>
  );
}

/* ───────────────────────── Un reclamo ───────────────────────── */

export function FichaReclamo({ r, onClose, onVerCasa }: { r: ReclamoMapa; onClose: () => void; onVerCasa: (conexionId: number) => void }) {
  return (
    <Panel
      etiqueta="Reclamo elegido"
      onClose={onClose}
      titulo={r.tipoNombre}
      subtitulo={`${r.referencia} · ${SERVICIO_RECLAMO_ETIQUETA[r.servicio]}`}
      pie={
        <div className="grid gap-2">
          <Link to={`/reclamos?ver=${r.id}`} className={cn(enlace, 'bg-marca text-white hover:bg-marca-fuerte')}>
            Abrir el reclamo
            <ArrowRight className="size-4" aria-hidden />
          </Link>
          {r.conexionId !== null && (
            <Button variant="secondary" onClick={() => onVerCasa(r.conexionId!)}>
              Ver la casa
            </Button>
          )}
        </div>
      }
    >
      <div className="flex flex-wrap gap-2">
        <Badge tone={r.estado === 'nuevo' ? 'alerta' : 'marca'}>{ESTADO_RECLAMO_ETIQUETA[r.estado]}</Badge>
        <Badge tone={r.prioridad === 'urgente' ? 'peligro' : r.prioridad === 'alta' ? 'alerta' : 'neutral'}>Prioridad {PRIORIDAD_ETIQUETA[r.prioridad].toLowerCase()}</Badge>
      </div>
      {r.direccion && (
        <p className="mt-3 flex items-start gap-2 font-semibold text-tinta">
          <MapPin className="mt-0.5 size-4 shrink-0 text-marca-texto" aria-hidden />
          {r.direccion}
        </p>
      )}
      <p className="mt-2 text-sm text-tinta-suave">Entró {hace(r.creadoEl)}.</p>
    </Panel>
  );
}

/* ───────────────────────── Área dibujada ───────────────────────── */

const FORMATOS: { formato: Exclude<FormatoInforme, 'json'>; texto: string; icon: LucideIcon }[] = [
  { formato: 'xlsx', texto: 'Excel', icon: FileSpreadsheet },
  { formato: 'csv', texto: 'CSV', icon: FileType },
  { formato: 'pdf', texto: 'PDF', icon: FileText },
];

interface AreaProps {
  /** Casas que quedaron adentro (con los filtros que tenga el mapa). */
  ids: number[];
  hectareas: number;
  servicio: ServicioConexion | null;
  /** Dice con qué filtros se armó, si hay alguno. */
  filtrada: boolean;
  onClose: () => void;
}

export function ResumenDeArea({ ids, hectareas, servicio, filtrada, onClose }: AreaProps) {
  // La clave cambia si cambian las casas: alcanza con la cantidad y la suma de sus ids.
  const huella = ids.reduce((t, id) => (t + id) % 2_147_483_647, 0);
  const consulta = useQuery({
    queryKey: ['mapa', 'area', servicio, ids.length, huella],
    queryFn: () => api.post<ResumenArea>('/mapa/area', { ids, servicio: servicio ?? undefined }),
    enabled: ids.length > 0,
  });
  const [bajando, setBajando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bajar = async (formato: Exclude<FormatoInforme, 'json'>) => {
    setBajando(formato);
    setError(null);
    try {
      await descargar('/mapa/area', { ids, servicio: servicio ?? undefined, formato });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBajando(null);
    }
  };
  const r = consulta.data;
  const superficie = hectareas >= 100 ? `${formatNumber(hectareas / 100, 1)} km²` : `${formatNumber(hectareas, hectareas < 10 ? 1 : 0)} ha`;
  return (
    <Panel
      etiqueta="Área dibujada"
      onClose={onClose}
      titulo="Área dibujada"
      subtitulo={`${superficie}${servicio ? ` · ${SERVICIO_ETIQUETA[servicio]}` : ''}${filtrada ? ' · con los filtros del mapa' : ''}`}
      pie={
        <div className="space-y-2">
          {error && <FormAlert>{error}</FormAlert>}
          <div className="grid grid-cols-3 gap-2" role="group" aria-label="Exportar las conexiones del área">
            {FORMATOS.map((f, i) => (
              <Button key={f.formato} variant={i === 0 ? 'primary' : 'secondary'} icon={f.icon} loading={bajando === f.formato} disabled={bajando !== null || !r || r.conexiones === 0} onClick={() => void bajar(f.formato)}>
                {f.texto}
              </Button>
            ))}
          </div>
          <Button variant="ghost" icon={Trash2} onClick={onClose} className="w-full">
            Borrar el área
          </Button>
        </div>
      }
    >
      {ids.length === 0 ? (
        <p className="py-6 text-center text-tinta-suave">No quedó ninguna casa adentro del área{filtrada ? ' con los filtros que tiene el mapa' : ''}. Probá con un área más grande.</p>
      ) : consulta.isPending ? (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : consulta.isError || !r ? (
        <ErrorState message={errorMessage(consulta.error)} onRetry={() => void consulta.refetch()} className="py-6" />
      ) : (
        <>
          <div className={cn('rounded-2xl px-4 py-3', Number(r.deuda) > 0 ? 'bg-peligro-tenue' : 'bg-exito-tenue')}>
            <p className="text-sm font-semibold text-tinta-suave">Deuda del área</p>
            <p className="text-2xl font-black tracking-tight text-tinta">{formatMoney(r.deuda)}</p>
            <p className="text-sm text-tinta">{Number(r.deuda) === 0 ? 'Nadie debe nada.' : r.deudaVencida === r.deuda ? 'Toda vencida.' : `${formatMoney(r.deudaVencida)} ya vencido.`}</p>
          </div>

          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
            <Dato nombre="Conexiones" valor={formatNumber(r.conexiones)} detalle={`${formatNumber(r.socios)} ${r.socios === 1 ? 'socio' : 'socios'}`} />
            <Dato nombre="En mora" valor={formatNumber(r.situacion.en_mora)} detalle={`${formatNumber(r.situacion.con_deuda)} con deuda`} />
            <Dato nombre="Energía" valor={`${formatNumber(Math.round(Number(r.consumo.energia)))} kWh`} detalle={r.consumo.periodo ? `en ${nombreDeMes(r.consumo.periodo.anio, r.consumo.periodo.mes).split(' ')[0]}` : 'sin facturar'} />
            <Dato nombre="Agua" valor={`${formatNumber(Math.round(Number(r.consumo.agua)))} m³`} detalle={r.consumo.periodo ? `en ${nombreDeMes(r.consumo.periodo.anio, r.consumo.periodo.mes).split(' ')[0]}` : 'sin facturar'} />
            <Dato nombre="Cortadas" valor={formatNumber(r.situacion.cortado)} detalle={`${formatNumber(r.situacion.al_dia)} al día`} />
            <Dato nombre="Reclamos abiertos" valor={formatNumber(r.reclamosAbiertos)} />
          </dl>

          <Titulo>Conexiones por servicio</Titulo>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-tinta">
            {(Object.keys(r.porServicio) as ServicioConexion[])
              .filter((s) => r.porServicio[s] > 0)
              .map((s) => (
                <li key={s}>
                  {SERVICIO_CORTO[s]} <strong className="tabular-nums">{formatNumber(r.porServicio[s])}</strong>
                </li>
              ))}
          </ul>
        </>
      )}
    </Panel>
  );
}

function Dato({ nombre, valor, detalle }: { nombre: string; valor: string; detalle?: string }) {
  return (
    <div>
      <dt className="text-sm text-tinta-suave">{nombre}</dt>
      <dd className="text-lg font-black leading-tight tracking-tight text-tinta">{valor}</dd>
      {detalle && <dd className="text-xs text-tinta-suave">{detalle}</dd>}
    </div>
  );
}
