// «Armar el recorrido»: el operario le dice a la app de dónde sale —de donde está parado, de una
// calle o de una casa— y la app ordena las casas que faltan para caminar lo menos posible.
// Todo se calcula en el teléfono: anda sin señal.
import { useMemo, useState } from 'react';
import { ChevronRight, House, ListOrdered, LoaderCircle, LocateFixed, MapPin, Route, Search } from 'lucide-react';
import { formatDistancia, normalizeText, type Lugar, type RutaDetalle } from '@shared';
import { cn } from '../../lib/cn';
import { Modal } from '../../components/Modal';
import { Button, Check, FormAlert } from '../../components/ui';
import { callesPorRecorrer, metrosQueFaltan, porRecorrer, proponer, puntaDeLaCalle, type RecorridoGuardado } from './recorrido';
import { pedirPosicion } from './ruta';

interface Partida {
  desde: RecorridoGuardado['desde'];
  etiqueta: string;
  inicio: Lugar;
}

/** «Desde donde estabas», «Desde Chile», «Desde Chile 353». */
export const nombreDelRecorrido = (r: Pick<RecorridoGuardado, 'desde' | 'etiqueta'>) => (r.desde === 'posicion' ? 'Desde donde estabas' : `Desde ${r.etiqueta}`);

interface Props {
  ruta: RutaDetalle;
  actual: RecorridoGuardado | null;
  alGuardar: (recorrido: RecorridoGuardado | null) => void;
  alCerrar: () => void;
}

const opcion = 'flex min-h-14 w-full items-center gap-3 rounded-2xl border-2 border-linea bg-superficie px-3.5 py-2 text-left transition-colors duration-150 active:bg-marca-tenue';

export function ArmarRecorrido({ ruta, actual, alGuardar, alCerrar }: Props) {
  const [partida, setPartida] = useState<Partida | null>(null);
  const [volver, setVolver] = useState(actual?.volver ?? false);
  const [texto, setTexto] = useState('');
  const [buscandoGps, setBuscandoGps] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const faltan = useMemo(() => porRecorrer(ruta), [ruta]);
  const sinUbicar = ruta.lista.filter((c) => c.medidores.some((m) => m.lectura === null) && (c.lat === null || c.lng === null)).length;
  const calles = useMemo(() => callesPorRecorrer(ruta), [ruta]);
  const hoy = useMemo(() => metrosQueFaltan(ruta), [ruta]);
  const propuesta = useMemo(() => (partida ? proponer(ruta, partida.inicio, volver) : null), [ruta, partida, volver]);

  const q = normalizeText(texto);
  const callesVisibles = q ? calles.filter((c) => normalizeText(c.nombre).includes(q)) : calles;
  // Con dos letras o más también se ofrecen casas sueltas (por dirección o por titular).
  const casasVisibles = q.length >= 2 ? faltan.filter((c) => normalizeText(c.direccion).includes(q) || normalizeText(c.titular).includes(q)).slice(0, 8) : [];

  const desdeDondeEstoy = async () => {
    setError(null);
    setBuscandoGps(true);
    try {
      const p = await pedirPosicion();
      setPartida({ desde: 'posicion', etiqueta: 'donde estás', inicio: { lat: p.lat, lng: p.lng } });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo saber dónde estás.');
    } finally {
      setBuscandoGps(false);
    }
  };

  const guardar = () => {
    if (!partida || !propuesta) return;
    alGuardar({ anio: ruta.anio, mes: ruta.mes, desde: partida.desde, etiqueta: partida.etiqueta, inicio: partida.inicio, volver, orden: propuesta.orden, armadoEl: new Date().toISOString() });
  };

  if (faltan.length === 0) {
    return (
      <Modal title="Armar el recorrido" onClose={alCerrar} footer={<Button onClick={alCerrar}>Entendido</Button>}>
        <p className="text-tinta">
          {sinUbicar > 0
            ? 'Las casas que faltan no están ubicadas en el mapa, así que la app no puede ordenarlas. Seguí la lista: está en el orden de la oficina.'
            : 'No queda ninguna casa por leer en esta ruta.'}
        </p>
      </Modal>
    );
  }

  // Segundo paso: se eligió de dónde sale. Se muestra cómo queda y se confirma.
  if (partida && propuesta) {
    const ahorro = hoy - propuesta.metros;
    return (
      <Modal
        title="Así queda el recorrido"
        onClose={alCerrar}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPartida(null)}>
              Elegir otra partida
            </Button>
            <Button onClick={guardar}>Usar este recorrido</Button>
          </>
        }
      >
        <div className="rounded-2xl bg-marca-tenue px-4 py-3.5">
          <p className="text-sm font-semibold text-marca-texto">Saliendo de {partida.etiqueta}</p>
          <p className="mt-0.5 text-3xl font-black tabular-nums text-tinta">{formatDistancia(propuesta.metros)}</p>
          <p className="text-tinta">
            para las {faltan.length} {faltan.length === 1 ? 'casa que falta' : 'casas que faltan'}
            {volver ? ', con la vuelta' : ''}.
          </p>
        </div>
        <dl className="mt-4 space-y-2 text-tinta">
          {propuesta.primera && (
            <div className="flex items-start gap-2.5">
              <MapPin className="mt-0.5 size-5 shrink-0 text-marca-texto" aria-hidden />
              <div>
                <dt className="text-sm text-tinta-suave">Empezás por</dt>
                <dd className="font-bold">
                  {propuesta.primera.direccion}
                  {partida.desde === 'posicion' && <span className="font-normal text-tinta-suave"> · a {formatDistancia(propuesta.hastaLaPrimera)} de vos</span>}
                </dd>
              </div>
            </div>
          )}
          <div className="flex items-start gap-2.5">
            <Route className="mt-0.5 size-5 shrink-0 text-marca-texto" aria-hidden />
            <div>
              <dt className="text-sm text-tinta-suave">Con el orden que tenías</dt>
              <dd>
                <span className="font-bold tabular-nums">{formatDistancia(hoy)}</span>
                {!volver && ahorro > 50 && <span className="font-semibold text-exito"> · caminás {formatDistancia(ahorro)} menos</span>}
              </dd>
            </div>
          </div>
        </dl>
        <div className="mt-4">
          <Check label="Terminar cerca de donde empiezo (dejé el vehículo ahí)" checked={volver} onChange={(e) => setVolver(e.target.checked)} />
        </div>
        <p className="mt-3 text-sm text-tinta-suave">
          Las distancias son en línea recta: la app no conoce los arroyos ni los alambrados. Si algo no se puede cruzar, abrí la casa que quieras desde la lista o el mapa.
          {sinUbicar > 0 && ` ${sinUbicar === 1 ? 'Hay 1 casa sin ubicación: queda' : `Hay ${sinUbicar} casas sin ubicación: quedan`} al final.`}
        </p>
      </Modal>
    );
  }

  return (
    <Modal title="Armar el recorrido" description={`Te faltan ${faltan.length} ${faltan.length === 1 ? 'casa' : 'casas'}. Decime de dónde salís y las ordeno para que camines menos.`} onClose={alCerrar}>
      <div className="space-y-2.5">
        <button type="button" onClick={() => void desdeDondeEstoy()} disabled={buscandoGps} className={cn(opcion, 'border-marca')}>
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-marca text-white">
            {buscandoGps ? <LoaderCircle className="size-5 animate-spin" aria-hidden /> : <LocateFixed className="size-5" aria-hidden />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[1.0625rem] font-bold text-tinta">Desde donde estoy</span>
            <span className="block text-sm text-tinta-suave">{buscandoGps ? 'Buscando tu ubicación…' : 'Con la ubicación del teléfono'}</span>
          </span>
          <ChevronRight className="size-5 shrink-0 text-tinta-suave" aria-hidden />
        </button>
        {error && <FormAlert>{error}</FormAlert>}

        {actual && (
          <button type="button" onClick={() => alGuardar(null)} className={opcion}>
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-linea/70 text-tinta">
              <ListOrdered className="size-5" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[1.0625rem] font-bold text-tinta">Volver al orden de la oficina</span>
              <span className="block text-sm text-tinta-suave">Como venía la ruta</span>
            </span>
          </button>
        )}
      </div>

      <h3 className="mb-2 mt-5 font-bold text-tinta">O empiezo en una calle o una casa</h3>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-tinta-suave" aria-hidden />
        <input
          type="search"
          inputMode="search"
          aria-label="Buscar una calle, una dirección o un titular"
          placeholder="Calle, dirección o titular"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          className="min-h-12 w-full rounded-xl border-2 border-linea bg-superficie pl-11 pr-3 text-base text-tinta placeholder:text-tinta-suave/80 focus:border-marca [&::-webkit-search-cancel-button]:hidden"
        />
      </div>
      <ul className="mt-2 max-h-[38dvh] space-y-1.5 overflow-y-auto pr-0.5">
        {casasVisibles.map((c) => (
          <li key={`casa-${c.conexionId}`}>
            <button type="button" onClick={() => setPartida({ desde: 'casa', etiqueta: c.direccion, inicio: { lat: c.lat, lng: c.lng } })} className={cn(opcion, 'min-h-12')}>
              <House className="size-5 shrink-0 text-tinta-suave" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-tinta">{c.direccion}</span>
                <span className="block truncate text-sm text-tinta-suave">{c.titular}</span>
              </span>
            </button>
          </li>
        ))}
        {callesVisibles.map((calle) => (
          <li key={`calle-${calle.nombre}`}>
            <button
              type="button"
              onClick={() => {
                const punta = puntaDeLaCalle(calle, ruta);
                setPartida({ desde: 'calle', etiqueta: calle.nombre, inicio: { lat: punta.lat, lng: punta.lng } });
              }}
              className={cn(opcion, 'min-h-12')}
            >
              <MapPin className="size-5 shrink-0 text-tinta-suave" aria-hidden />
              <span className="min-w-0 flex-1 truncate font-semibold text-tinta">{calle.nombre}</span>
              <span className="shrink-0 text-sm tabular-nums text-tinta-suave">
                {calle.casas.length} {calle.casas.length === 1 ? 'casa' : 'casas'}
              </span>
            </button>
          </li>
        ))}
        {callesVisibles.length === 0 && casasVisibles.length === 0 && <li className="px-1 py-3 text-tinta-suave">Ninguna calle ni casa de las que faltan coincide.</li>}
      </ul>
    </Modal>
  );
}
