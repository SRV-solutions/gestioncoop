// Piezas que comparten las pantallas del operario: la ruta (con o sin señal), el GPS y la foto.
import { useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { normalizeText, type CasaRuta, type MedidorRuta, type RutaDetalle, type RutaResumen } from '@shared';
import { useAuth } from '../../lib/auth';
import { obtenerRuta, useCola } from './almacen';
import { enOrden, useRecorrido } from './recorrido';

export const casaHecha = (casa: CasaRuta) => casa.medidores.every((m) => m.lectura !== null);
export const casaConNovedad = (casa: CasaRuta) => casa.medidores.some((m) => m.lectura?.novedad);

export function resumenDe(ruta: RutaDetalle): RutaResumen {
  const medidores = ruta.lista.flatMap((c) => c.medidores);
  return {
    id: ruta.id,
    nombre: ruta.nombre,
    zona: ruta.zona,
    anio: ruta.anio,
    mes: ruta.mes,
    casas: ruta.lista.length,
    casasHechas: ruta.lista.filter(casaHecha).length,
    medidores: medidores.length,
    medidoresLeidos: medidores.filter((m) => m.lectura !== null).length,
  };
}

/** La próxima casa sin terminar, siguiendo el recorrido desde `desde` (y dando la vuelta al llegar al final). */
export function siguientePendiente(ruta: RutaDetalle, desde?: number): CasaRuta | null {
  const i = desde === undefined ? -1 : ruta.lista.findIndex((c) => c.conexionId === desde);
  const orden = [...ruta.lista.slice(i + 1), ...ruta.lista.slice(0, i + 1)];
  return orden.find((c) => c.conexionId !== desde && !casaHecha(c)) ?? null;
}

/** Busca por dirección, titular, número de conexión o número de medidor. */
export function coincide(casa: CasaRuta, texto: string): boolean {
  const q = normalizeText(texto);
  if (!q) return true;
  return (
    normalizeText(casa.direccion).includes(q) ||
    normalizeText(casa.titular).includes(q) ||
    String(casa.numero).includes(q) ||
    casa.medidores.some((m) => m.numero.includes(q) || String(Number(m.numero)).includes(q))
  );
}

export const claveRuta = (id: number) => ['operario', 'ruta', id] as const;

/**
 * La ruta, desde el servidor o desde el teléfono. `networkMode: 'always'` porque sin señal la
 * consulta igual tiene que correr: es la que lee la copia guardada.
 * Las casas salen en el orden del recorrido que eligió el operario (o en el de la oficina).
 */
export function useRuta(id: number) {
  const qc = useQueryClient();
  const { version } = useCola();
  const { me } = useAuth();
  const recorrido = useRecorrido(me?.user.id ?? null, id);
  const consulta = useQuery({
    queryKey: claveRuta(id),
    queryFn: () => obtenerRuta(id),
    networkMode: 'always',
    staleTime: 5 * 60_000,
    retry: false,
  });
  // Cuando el servidor confirma lecturas, la próxima vez que se pida la ruta se baja de nuevo.
  useEffect(() => {
    if (version > 0) void qc.invalidateQueries({ queryKey: claveRuta(id), refetchType: 'none' });
  }, [version, id, qc]);
  const data = useMemo(() => (consulta.data ? enOrden(consulta.data, recorrido) : undefined), [consulta.data, recorrido]);
  return { ...consulta, data, recorrido, actualizar: (ruta: RutaDetalle) => qc.setQueryData(claveRuta(id), ruta) };
}

export const etiquetaMedidor = (m: MedidorRuta) => String(Number(m.numero) || m.numero);

/* ───────────────────────── GPS ───────────────────────── */

export interface Posicion {
  lat: number;
  lng: number;
  precision: number;
  cuando: number;
}

/**
 * Sigue la posición mientras la pantalla está abierta y devuelve la última conocida.
 * Si el teléfono no da permiso (o la página no es https), simplemente no hay posición: la lectura se guarda igual.
 */
export function useGps(alCambiar?: (p: Posicion) => void): { actual: () => Posicion | null } {
  const ultima = useRef<Posicion | null>(null);
  const aviso = useRef(alCambiar);
  useEffect(() => {
    aviso.current = alCambiar;
  });
  useEffect(() => {
    if (!('geolocation' in navigator)) return;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        ultima.current = { lat: p.coords.latitude, lng: p.coords.longitude, precision: p.coords.accuracy, cuando: Date.now() };
        aviso.current?.(ultima.current);
      },
      () => undefined,
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);
  // Una posición de hace más de 3 minutos ya no dice dónde se tomó la lectura.
  return { actual: () => (ultima.current && Date.now() - ultima.current.cuando < 180_000 ? ultima.current : null) };
}

/**
 * La posición ahora, una sola vez (para «armar el recorrido desde donde estoy»). Si el teléfono no
 * la da —sin permiso, sin GPS o tarda demasiado— avisa con un mensaje para mostrar.
 */
export function pedirPosicion(): Promise<Posicion> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('Este teléfono no tiene ubicación.'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, precision: p.coords.accuracy, cuando: Date.now() }),
      (e) => reject(new Error(e.code === e.PERMISSION_DENIED ? 'El teléfono no dio permiso para usar la ubicación. Elegí una calle o una casa.' : 'No se pudo saber dónde estás. Probá de nuevo al aire libre, o elegí una calle.')),
      { enableHighAccuracy: true, maximumAge: 20_000, timeout: 12_000 },
    );
  });
}

/* ───────────────────────── Foto ───────────────────────── */

/** Achica la foto (está en lib/foto: la usan también los reclamos del socio). */
export { achicarFoto } from '../../lib/foto';
