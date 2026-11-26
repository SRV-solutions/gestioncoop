import { useEffect, useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LoaderCircle, Search, X } from 'lucide-react';
import type { Page, SocioDetalle, SocioListado } from '@shared';
import { api, qs } from '../../lib/api';

interface Props {
  /** Se llama con la conexión elegida (la primera del socio que tenga ubicación). */
  onPick: (conexionId: number) => void;
}

/** Buscador del mapa: socio, dirección o medidor → el mapa vuela hasta la casa (SPEC 6.10). */
export function Buscador({ onPick }: Props) {
  const listId = useId();
  const [texto, setTexto] = useState('');
  const [q, setQ] = useState('');
  const [abierto, setAbierto] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [buscandoCasa, setBuscandoCasa] = useState(false);

  // Se espera a que la persona deje de tipear antes de consultar.
  useEffect(() => {
    const t = setTimeout(() => setQ(texto.trim()), 250);
    return () => clearTimeout(t);
  }, [texto]);

  const resultados = useQuery({
    queryKey: ['mapa-buscar', q],
    queryFn: () => api.get<Page<SocioListado>>(`/padron/socios${qs({ q, limit: 6 })}`),
    enabled: q.length >= 2,
    staleTime: 30_000,
  });

  const elegir = async (socio: SocioListado) => {
    setAbierto(false);
    setAviso(null);
    setBuscandoCasa(true);
    try {
      const ficha = await api.get<SocioDetalle>(`/padron/socios/${socio.id}`);
      const conexion = ficha.conexiones.find((c) => c.lat != null && c.lng != null);
      if (conexion) {
        setTexto(socio.nombre);
        onPick(conexion.id);
      } else {
        setAviso('Ese socio no tiene una conexión ubicada en el mapa.');
      }
    } catch {
      setAviso('No pudimos buscar esa casa. Probá de nuevo.');
    } finally {
      setBuscandoCasa(false);
    }
  };

  const items = resultados.data?.items ?? [];
  const mostrar = abierto && q.length >= 2;

  return (
    <div className="relative w-full sm:w-80">
      <div className="flex min-h-12 items-center gap-2 rounded-2xl border border-linea bg-superficie/95 pl-3.5 pr-1.5 shadow-lg shadow-black/10 backdrop-blur">
        {buscandoCasa || resultados.isFetching ? (
          <LoaderCircle className="size-5 shrink-0 animate-spin text-marca-texto" aria-hidden />
        ) : (
          <Search className="size-5 shrink-0 text-tinta-suave" aria-hidden />
        )}
        <input
          type="search"
          role="combobox"
          aria-expanded={mostrar}
          aria-controls={listId}
          aria-label="Buscar socio, dirección o medidor"
          placeholder="Buscar socio, dirección o medidor"
          autoComplete="off"
          value={texto}
          onChange={(e) => {
            setTexto(e.target.value);
            setAbierto(true);
            setAviso(null);
          }}
          onFocus={() => setAbierto(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setAbierto(false);
            if (e.key === 'Enter' && items[0]) void elegir(items[0]);
          }}
          className="min-h-11 min-w-0 flex-1 bg-transparent py-2 text-[0.9375rem] text-tinta placeholder:text-tinta-suave/80 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
        />
        {texto && (
          <button
            type="button"
            aria-label="Borrar búsqueda"
            onClick={() => {
              setTexto('');
              setAviso(null);
            }}
            className="grid size-9 place-items-center rounded-xl text-tinta-suave hover:bg-marca-tenue hover:text-marca-texto"
          >
            <X className="size-4" aria-hidden />
          </button>
        )}
      </div>

      {(mostrar || aviso) && (
        <div id={listId} className="absolute inset-x-0 top-full z-20 mt-2 overflow-hidden rounded-2xl border border-linea bg-superficie shadow-xl shadow-black/15">
          {aviso ? (
            <p className="px-4 py-3 text-sm text-tinta-suave">{aviso}</p>
          ) : resultados.isError ? (
            <p className="px-4 py-3 text-sm text-peligro">No pudimos buscar. Probá de nuevo.</p>
          ) : items.length === 0 ? (
            <p className="px-4 py-3 text-sm text-tinta-suave">{resultados.isPending ? 'Buscando…' : 'No encontramos nada con ese dato.'}</p>
          ) : (
            <ul>
              {items.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => void elegir(s)}
                    className="block w-full px-4 py-2.5 text-left hover:bg-marca-tenue focus-visible:bg-marca-tenue"
                  >
                    <span className="block truncate text-sm font-semibold text-tinta">{s.nombre}</span>
                    <span className="block truncate text-xs text-tinta-suave">
                      Socio {s.numero}
                      {s.direccion && <> · {s.direccion}</>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
