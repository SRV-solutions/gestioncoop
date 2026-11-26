// Una ruta: las casas en orden de recorrido —el de la oficina o el que arma la app desde donde
// sale el operario—, con búsqueda por medidor o dirección y vista en mapa.
import { lazy, Suspense, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, CircleCheck, List, Map as MapIcon, Route, Search, TriangleAlert, X } from 'lucide-react';
import { formatDistancia, NOVEDAD_ETIQUETA, type CasaRuta } from '@shared';
import { errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { cn } from '../../lib/cn';
import { SERVICIO_ICON } from '../../components/servicios';
import { Empty, ErrorState, Skeleton } from '../../components/ui';
import { ArmarRecorrido, nombreDelRecorrido } from './ArmarRecorrido';
import { guardarRecorrido, metrosQueFaltan } from './recorrido';
import { casaConNovedad, casaHecha, coincide, resumenDe, siguientePendiente, useRuta } from './ruta';

const RutaMapa = lazy(() => import('./RutaMapa').then((m) => ({ default: m.RutaMapa })));

const FILTROS = [
  { id: 'pendientes', etiqueta: 'Faltan' },
  { id: 'hechas', etiqueta: 'Hechas' },
  { id: 'todas', etiqueta: 'Todas' },
] as const;
type Filtro = (typeof FILTROS)[number]['id'];

export function RutaPage() {
  const id = Number(useParams().rutaId);
  const navigate = useNavigate();
  const consulta = useRuta(id);
  const [texto, setTexto] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('pendientes');
  const [vista, setVista] = useState<'lista' | 'mapa'>('lista');
  const [armando, setArmando] = useState(false);
  const { me } = useAuth();
  const ruta = consulta.data;
  const recorrido = consulta.recorrido;

  // El número de paso de cada casa en el recorrido: el mismo en la lista y en el mapa.
  const pasos = useMemo(() => new Map((ruta?.lista ?? []).map((c, i) => [c.conexionId, i + 1])), [ruta]);

  const visibles = useMemo(() => {
    if (!ruta) return [];
    return ruta.lista.filter((c) => (filtro === 'todas' || (filtro === 'hechas') === casaHecha(c)) && coincide(c, texto));
  }, [ruta, filtro, texto]);
  // En el mapa van todas (el color dice cuáles faltan); la búsqueda sí achica lo que se ve.
  const enElMapa = useMemo(() => (ruta ? ruta.lista.filter((c) => coincide(c, texto)) : []), [ruta, texto]);
  const enMapa = vista === 'mapa';

  if (consulta.isPending) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 rounded-2xl" />
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-20 rounded-2xl" />
        ))}
      </div>
    );
  }
  if (consulta.isError || !ruta) {
    return <ErrorState message={errorMessage(consulta.error)} onRetry={() => void consulta.refetch()} />;
  }

  const r = resumenDe(ruta);
  const proxima = siguientePendiente(ruta);
  const terminada = r.casasHechas === r.casas;
  const abrir = (casa: CasaRuta) => navigate(`/operario/ruta/${ruta.id}/casa/${casa.conexionId}`);

  return (
    <div className={cn('pb-24', enMapa ? 'space-y-2.5' : 'space-y-4')}>
      <header>
        <Link to="/operario" className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-[0.9375rem] font-semibold text-marca-texto">
          <ArrowLeft className="size-4" aria-hidden />
          Mis rutas
        </Link>
        <h1 className="text-xl font-black leading-tight tracking-tight text-tinta">{ruta.nombre}</h1>
        {/* En el mapa, el avance va en una línea: el lugar es para el mapa. */}
        {enMapa && (
          <p className="mt-0.5 text-sm font-semibold text-tinta-suave">
            {r.medidoresLeidos} de {r.medidores} medidores · {r.casasHechas} de {r.casas} casas
          </p>
        )}
        {/* Las mismas cuentas que ve la oficina: medidores primero, casas al lado. */}
        <div className={cn('mt-2 flex items-baseline justify-between gap-3', enMapa && 'hidden')}>
          <p className="text-tinta">
            <span className="text-2xl font-black tabular-nums">{r.medidoresLeidos}</span>
            <span className="font-semibold text-tinta-suave"> de {r.medidores} medidores</span>
          </p>
          <p className="text-sm text-tinta-suave">
            {r.casasHechas} de {r.casas} casas
          </p>
        </div>
        <div role="progressbar" aria-label="Avance de la ruta" aria-valuemin={0} aria-valuemax={r.medidores} aria-valuenow={r.medidoresLeidos} className={cn('mt-1.5 h-3 overflow-hidden rounded-full bg-linea', enMapa && 'hidden')}>
          <div className={cn('h-full rounded-full transition-[width] duration-300', terminada ? 'bg-exito' : 'bg-marca')} style={{ width: `${r.medidores ? (r.medidoresLeidos / r.medidores) * 100 : 0}%` }} />
        </div>
        {!terminada && !enMapa && (
          <p className="mt-1.5 text-sm font-semibold text-tinta">
            Te faltan {r.medidores - r.medidoresLeidos} {r.medidores - r.medidoresLeidos === 1 ? 'medidor' : 'medidores'} en {r.casas - r.casasHechas} {r.casas - r.casasHechas === 1 ? 'casa' : 'casas'}
          </p>
        )}
      </header>

      {!terminada && (
        <button
          type="button"
          onClick={() => setArmando(true)}
          className={cn('flex min-h-14 w-full items-center gap-3 rounded-2xl border-2 bg-superficie px-3.5 py-2 text-left transition-colors duration-150 active:bg-marca-tenue', recorrido ? 'border-marca' : 'border-linea')}
        >
          <span className={cn('grid size-10 shrink-0 place-items-center rounded-xl', recorrido ? 'bg-marca text-white' : 'bg-marca-tenue text-marca-texto')}>
            <Route className="size-5" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm text-tinta-suave">Recorrido · unos {formatDistancia(metrosQueFaltan(ruta))} a pie</span>
            <span className="block truncate text-[1.0625rem] font-bold leading-tight text-tinta">{recorrido ? nombreDelRecorrido(recorrido) : 'En el orden de la oficina'}</span>
          </span>
          <span className="shrink-0 text-[0.9375rem] font-bold text-marca-texto">{recorrido ? 'Cambiar' : 'Armar'}</span>
        </button>
      )}

      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-tinta-suave" aria-hidden />
          <input
            type="search"
            inputMode="search"
            enterKeyHint="search"
            aria-label="Buscar por medidor, dirección o titular"
            placeholder="Medidor, dirección o titular"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            className="min-h-12 w-full rounded-xl border-2 border-linea bg-superficie pl-11 pr-11 text-base text-tinta placeholder:text-tinta-suave/80 focus:border-marca [&::-webkit-search-cancel-button]:hidden"
          />
          {texto && (
            <button type="button" aria-label="Borrar la búsqueda" onClick={() => setTexto('')} className="absolute right-1 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-lg text-tinta-suave">
              <X className="size-5" aria-hidden />
            </button>
          )}
        </div>
        <button
          type="button"
          aria-pressed={vista === 'mapa'}
          onClick={() => setVista(vista === 'mapa' ? 'lista' : 'mapa')}
          className="inline-flex min-h-12 shrink-0 items-center gap-2 rounded-xl border-2 border-linea bg-superficie px-3.5 font-semibold text-tinta"
        >
          {vista === 'mapa' ? <List className="size-5" aria-hidden /> : <MapIcon className="size-5" aria-hidden />}
          {vista === 'mapa' ? 'Lista' : 'Mapa'}
        </button>
      </div>

      <div role="group" aria-label="Qué casas mostrar" className={cn('grid grid-cols-3 gap-1 rounded-xl bg-linea/60 p-1', enMapa && 'hidden')}>
        {FILTROS.map((f) => {
          const cantidad = f.id === 'todas' ? r.casas : f.id === 'hechas' ? r.casasHechas : r.casas - r.casasHechas;
          return (
            <button
              key={f.id}
              type="button"
              aria-pressed={filtro === f.id}
              onClick={() => setFiltro(f.id)}
              className={cn('min-h-11 rounded-lg text-[0.9375rem] font-bold transition-colors duration-150', filtro === f.id ? 'bg-superficie text-tinta shadow-sm' : 'text-tinta-suave')}
            >
              {f.etiqueta} <span className="tabular-nums opacity-70">{cantidad}</span>
            </button>
          );
        })}
      </div>

      {enMapa ? (
        <Suspense fallback={<Skeleton className="h-[50dvh] rounded-2xl" />}>
          <RutaMapa casas={enElMapa} pasos={pasos} proximaId={proxima?.conexionId ?? null} alElegir={abrir} />
        </Suspense>
      ) : visibles.length === 0 ? (
        <Empty icon={texto ? Search : CircleCheck} title={texto ? 'Ninguna casa coincide' : filtro === 'pendientes' ? '¡Ruta terminada!' : 'Todavía no cargaste ninguna'} className="rounded-2xl border-2 border-linea py-10">
          {texto
            ? 'Probá con otra parte de la dirección o con el número de medidor.'
            : filtro === 'pendientes'
              ? 'No queda ninguna casa por leer en esta ruta.'
              : 'Las casas que vayas leyendo aparecen acá, por si hay que corregir alguna.'}
        </Empty>
      ) : (
        <ol className="space-y-2">
          {visibles.map((casa) => (
            <li key={casa.conexionId}>
              <FilaCasa casa={casa} paso={pasos.get(casa.conexionId) ?? casa.orden} proxima={casa.conexionId === proxima?.conexionId} alAbrir={() => abrir(casa)} />
            </li>
          ))}
        </ol>
      )}

      {proxima && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-linea bg-superficie/95 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur">
          <button
            type="button"
            onClick={() => abrir(proxima)}
            className="mx-auto flex min-h-16 w-full max-w-xl items-center justify-between gap-3 rounded-2xl bg-marca px-5 text-left text-white active:bg-marca-fuerte"
          >
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-white/80">{r.casasHechas === 0 ? 'Empezar por' : 'Seguir con'}</span>
              <span className="block truncate text-lg font-bold leading-tight">{proxima.direccion}</span>
            </span>
            <ArrowRight className="size-7 shrink-0" aria-hidden />
          </button>
        </div>
      )}

      {armando && (
        <ArmarRecorrido
          ruta={ruta}
          actual={recorrido}
          alCerrar={() => setArmando(false)}
          alGuardar={(nuevo) => {
            if (me) guardarRecorrido(me.user.id, ruta.id, nuevo);
            setArmando(false);
            // El recorrido nuevo se ve desde el principio: lo que falta, en su orden.
            setFiltro('pendientes');
            setTexto('');
          }}
        />
      )}
    </div>
  );
}

function FilaCasa({ casa, paso, proxima, alAbrir }: { casa: CasaRuta; paso: number; proxima: boolean; alAbrir: () => void }) {
  const hecha = casaHecha(casa);
  const novedad = casaConNovedad(casa);
  return (
    <button
      type="button"
      onClick={alAbrir}
      className={cn(
        'flex min-h-20 w-full items-center gap-3 rounded-2xl border-2 bg-superficie px-3.5 py-2.5 text-left transition-colors duration-150 active:bg-marca-tenue',
        proxima ? 'border-marca' : 'border-linea',
      )}
    >
      <span
        className={cn(
          'grid size-11 shrink-0 place-items-center rounded-xl text-[0.9375rem] font-black tabular-nums',
          hecha ? (novedad ? 'bg-alerta-tenue text-alerta' : 'bg-exito-tenue text-exito') : 'bg-linea/70 text-tinta',
        )}
      >
        {hecha ? novedad ? <TriangleAlert className="size-5" aria-label="Con novedad" /> : <Check className="size-5" aria-label="Hecha" /> : paso}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[1.0625rem] font-bold leading-tight text-tinta">{casa.direccion}</span>
        <span className="block truncate text-sm text-tinta-suave">{casa.titular}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        {casa.medidores.map((m) => {
          const Icon = SERVICIO_ICON[m.servicio];
          const l = m.lectura;
          return (
            <span
              key={`${m.periodoId}-${m.medidorId}`}
              className={cn('flex items-center gap-1 text-sm font-semibold tabular-nums', l ? (l.novedad ? 'text-alerta' : 'text-exito') : 'text-tinta-suave')}
              title={l?.novedad ? NOVEDAD_ETIQUETA[l.novedad] : undefined}
            >
              <Icon className="size-4" aria-hidden />
              {l ? (l.valor ?? 'Novedad') : '—'}
            </span>
          );
        })}
      </span>
    </button>
  );
}
