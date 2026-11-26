// "Mi ruta de hoy": las rutas del operario con su avance. Con señal las baja y las guarda en el
// teléfono; sin señal muestra las que ya tiene guardadas.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, CircleCheck, CloudDownload, Route, Smartphone, TriangleAlert } from 'lucide-react';
import { nombreDeMes, type MisRutas, type RutaResumen } from '@shared';
import { api, ApiError, errorMessage } from '../../lib/api';
import { cn } from '../../lib/cn';
import { useOnline } from '../../lib/useOnline';
import { Button, Empty, ErrorState, Skeleton } from '../../components/ui';
import { borrarRuta, descartar, leerCola, leerRutas, obtenerRuta, useCola, type EnCola } from './almacen';
import { claveRuta, resumenDe } from './ruta';

interface Inicio extends MisRutas {
  /** Rutas que ya están guardadas en el teléfono. */
  guardadas: number[];
  /** La lista salió del teléfono porque no hay señal. */
  sinSenal: boolean;
}

async function cargarInicio(): Promise<Inicio> {
  const locales = await leerRutas().catch(() => []);
  try {
    const remoto = await api.get<MisRutas>('/lecturas/mis-rutas');
    const cola = await leerCola().catch(() => []);
    const guardadas: number[] = [];
    const rutas = remoto.rutas.map((r) => {
      const local = locales.find((l) => l.id === r.id && l.anio === r.anio && l.mes === r.mes);
      if (!local) return r;
      const enTelefono = resumenDe(local);
      // La copia del teléfono solo puede saber más que el servidor por lo que todavía no envió. Si el
      // servidor tiene lecturas que la copia no —las cargó otro operario antes de que la oficina le
      // pasara la ruta, o la oficina estimó— o cambió la cantidad de medidores, la copia quedó vieja:
      // se muestra lo del servidor (lo mismo que ve la oficina) y se baja de nuevo.
      if (enTelefono.medidores !== r.medidores || enTelefono.medidoresLeidos < r.medidoresLeidos) return r;
      guardadas.push(r.id);
      // El avance de una ruta guardada sale del teléfono: incluye lo que todavía no se envió.
      return enTelefono;
    });
    // Rutas que ya no son de esta persona: fuera del teléfono, salvo que tengan lecturas sin enviar.
    for (const l of locales) {
      if (!remoto.rutas.some((r) => r.id === l.id) && !cola.some((c) => c.rutaId === l.id)) await borrarRuta(l.id).catch(() => undefined);
    }
    return { periodo: remoto.periodo, rutas, guardadas, sinSenal: false };
  } catch (err) {
    if (err instanceof ApiError && err.status >= 400 && err.status < 500) throw err;
    if (locales.length === 0) throw err;
    const rutas = locales.map(resumenDe);
    return { periodo: { anio: rutas[0]!.anio, mes: rutas[0]!.mes }, rutas, guardadas: locales.map((r) => r.id), sinSenal: true };
  }
}

export function OperarioHomePage() {
  const qc = useQueryClient();
  const online = useOnline();
  const cola = useCola();
  // Se vuelve a pedir cada minuto y al volver a mirar el teléfono: si la oficina le pasa una ruta (o se la saca), aparece sola.
  const consulta = useQuery({ queryKey: ['operario', 'inicio'], queryFn: cargarInicio, networkMode: 'always', retry: false, refetchInterval: online ? 60_000 : false, refetchOnWindowFocus: true });
  const [fallidas, setFallidas] = useState<number[]>([]);
  const datos = consulta.data;

  // Con señal: baja al teléfono cada ruta que falte, de a una, para poder salir a la calle sin conexión.
  const bajando = datos && !datos.sinSenal ? (datos.rutas.find((r) => !datos.guardadas.includes(r.id) && !fallidas.includes(r.id))?.id ?? null) : null;
  useEffect(() => {
    if (bajando === null) return;
    obtenerRuta(bajando)
      .then((ruta) => {
        qc.setQueryData(claveRuta(ruta.id), ruta);
        qc.setQueryData<Inicio>(['operario', 'inicio'], (v) => (v ? { ...v, guardadas: [...v.guardadas, ruta.id] } : v));
      })
      // No se pudo: se sigue con la próxima y esta se reintenta al volver a entrar.
      .catch(() => setFallidas((v) => [...v, bajando]));
  }, [bajando, qc]);

  // Volvió la señal o el servidor confirmó lecturas: se actualiza la lista.
  useEffect(() => {
    if (online) void qc.invalidateQueries({ queryKey: ['operario', 'inicio'] });
  }, [online, cola.version, qc]);

  if (consulta.isPending) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-56" />
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-32 rounded-2xl" />
        ))}
      </div>
    );
  }
  if (consulta.isError) {
    return (
      <ErrorState
        message={online ? errorMessage(consulta.error) : 'No hay señal y este teléfono todavía no tiene ninguna ruta guardada. Conectate una vez para bajarlas.'}
        onRetry={() => void consulta.refetch()}
      />
    );
  }
  if (!datos) return null;

  if (!datos.periodo || datos.rutas.length === 0) {
    return (
      <Empty icon={Route} title={datos.periodo ? 'No tenés rutas asignadas' : 'Todavía no hay lectura abierta'} className="rounded-2xl border-2 border-linea py-10">
        {datos.periodo
          ? 'Pedile a administración que te asigne una ruta: aparece acá con las casas en orden de recorrido.'
          : 'Cuando administración abra la lectura del mes, tus rutas aparecen acá con las casas en orden de recorrido.'}
      </Empty>
    );
  }

  const medidores = datos.rutas.reduce((n, r) => n + r.medidores, 0);
  const leidos = datos.rutas.reduce((n, r) => n + r.medidoresLeidos, 0);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-black tracking-tight text-tinta">Mi ruta de hoy</h1>
        <p className="mt-0.5 text-tinta-suave">
          Lectura de {nombreDeMes(datos.periodo.anio, datos.periodo.mes)} · {leidos} de {medidores} medidores
        </p>
        {medidores > leidos && (
          <p className="mt-0.5 font-semibold text-tinta">
            Te faltan {medidores - leidos} {medidores - leidos === 1 ? 'medidor' : 'medidores'}
          </p>
        )}
      </header>

      {datos.sinSenal && (
        <p role="status" className="flex items-start gap-2.5 rounded-xl bg-acento-tenue px-4 py-3 text-sm font-medium text-tinta">
          <Smartphone className="mt-0.5 size-4 shrink-0" aria-hidden />
          Sin señal: estás viendo las rutas guardadas en el teléfono. Podés cargar lecturas igual.
        </p>
      )}

      <Rechazadas visible={cola.rechazadas > 0} />

      <ul className="space-y-3">
        {datos.rutas.map((r) => (
          <li key={r.id}>
            <TarjetaRuta ruta={r} guardada={datos.guardadas.includes(r.id)} bajando={bajando === r.id} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function TarjetaRuta({ ruta, guardada, bajando }: { ruta: RutaResumen; guardada: boolean; bajando: boolean }) {
  // Las mismas cuentas que ve la oficina: el avance va por medidores.
  const terminada = ruta.medidoresLeidos === ruta.medidores;
  const empezada = ruta.medidoresLeidos > 0;
  const avance = ruta.medidores ? (ruta.medidoresLeidos / ruta.medidores) * 100 : 0;
  const faltan = ruta.medidores - ruta.medidoresLeidos;
  const casasQueFaltan = ruta.casas - ruta.casasHechas;
  return (
    <Link
      to={`/operario/ruta/${ruta.id}`}
      className={cn(
        'block rounded-2xl border-2 bg-superficie p-4 transition-colors duration-150 active:bg-marca-tenue',
        terminada ? 'border-linea' : 'border-marca',
      )}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-lg font-bold leading-tight text-tinta">{ruta.nombre}</p>
          <p className="mt-1 text-[0.9375rem] text-tinta-suave">
            {ruta.medidores} {ruta.medidores === 1 ? 'medidor' : 'medidores'} en {ruta.casas} casas
          </p>
        </div>
        {terminada ? <CircleCheck className="size-7 shrink-0 text-exito" aria-label="Terminada" /> : <ChevronRight className="size-7 shrink-0 text-marca-texto" aria-hidden />}
      </div>

      <div className="mt-4 flex items-end justify-between gap-3">
        <p className="text-tinta">
          <span className="text-3xl font-black tabular-nums">{ruta.medidoresLeidos}</span>
          <span className="text-lg font-semibold text-tinta-suave"> de {ruta.medidores}</span>
        </p>
        <p className={cn('text-[0.9375rem] font-bold', terminada ? 'text-exito' : 'text-marca-texto')}>{terminada ? 'Terminada' : empezada ? 'Seguir' : 'Empezar'}</p>
      </div>
      <div
        role="progressbar"
        aria-label={`Avance de ${ruta.nombre}`}
        aria-valuemin={0}
        aria-valuemax={ruta.medidores}
        aria-valuenow={ruta.medidoresLeidos}
        className="mt-2 h-3 overflow-hidden rounded-full bg-linea"
      >
        <div className={cn('h-full rounded-full transition-[width] duration-300', terminada ? 'bg-exito' : 'bg-marca')} style={{ width: `${avance}%` }} />
      </div>

      {!terminada && (
        <p className="mt-2 text-[0.9375rem] font-semibold text-tinta">
          Faltan {faltan} {faltan === 1 ? 'medidor' : 'medidores'} en {casasQueFaltan} {casasQueFaltan === 1 ? 'casa' : 'casas'}
        </p>
      )}

      <p className="mt-3 flex items-center gap-1.5 text-sm text-tinta-suave">
        {guardada ? (
          <>
            <Smartphone className="size-4 text-exito" aria-hidden />
            Guardada en el teléfono: anda sin señal
          </>
        ) : (
          <>
            <CloudDownload className={cn('size-4', bajando && 'animate-latido')} aria-hidden />
            {bajando ? 'Guardando en el teléfono…' : 'Todavía no está en el teléfono'}
          </>
        )}
      </p>
    </Link>
  );
}

/** Lecturas que el servidor no aceptó. Casi nunca pasa (por ejemplo, la oficina cerró la lectura antes de que llegaran). */
function Rechazadas({ visible }: { visible: boolean }) {
  const [lista, setLista] = useState<EnCola[]>([]);
  useEffect(() => {
    if (visible) void leerCola().then((c) => setLista(c.filter((x) => x.error)));
  }, [visible]);
  if (!visible || lista.length === 0) return null;
  return (
    <section aria-label="Lecturas que no se pudieron enviar" className="rounded-2xl border-2 border-peligro bg-peligro-tenue p-4">
      <h2 className="flex items-center gap-2 font-bold text-peligro">
        <TriangleAlert className="size-5" aria-hidden />
        {lista.length === 1 ? '1 lectura no se pudo enviar' : `${lista.length} lecturas no se pudieron enviar`}
      </h2>
      <ul className="mt-2 space-y-2">
        {lista.map((l) => (
          <li key={l.uuid} className="flex items-center justify-between gap-3 text-sm text-tinta">
            <span>
              {l.valor != null ? `Lectura ${l.valor}` : 'Novedad'}: {l.error}
            </span>
            <Button variant="secondary" onClick={() => void descartar(l.uuid).then(() => setLista((v) => v.filter((x) => x.uuid !== l.uuid)))}>
              Descartar
            </Button>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-sm text-tinta-suave">Avisale a la oficina antes de descartarlas.</p>
    </section>
  );
}
