// La ruta en el mapa: el recorrido que falta dibujado en orden, el número de paso de cada casa,
// cuál sigue y dónde está el operario. Sin señal no bajan las calles, pero las casas, el recorrido
// y la posición se dibujan igual.
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';
import { Map as MapLibreMap, Marker, NavigationControl, setWorkerUrl, type GeoJSONSource, type LngLatBoundsLike } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { CornerUpRight, LocateFixed, MapPinOff } from 'lucide-react';
import { formatDistancia, largoDelRecorrido, metrosEntre, type CasaRuta, type Lugar } from '@shared';
import { Empty } from '../../components/ui';
import { crearEstilo } from '../mapa/estilo';
import { faseDelDia, posicionDelSol } from '../mapa/sol';
import { casaConNovedad, casaHecha, useGps } from './ruta';

setWorkerUrl(workerUrl);

const FUENTE = 'ruta-casas';
const FUENTE_LINEA = 'ruta-linea';
const FUENTE_TRAMO = 'ruta-tramo';
// Colores fijos (no del tema): se tienen que distinguir igual sobre el mapa de día y de noche.
const COLOR = { pendiente: '#f6950a', hecha: '#22a559', novedad: '#e5484d', proxima: '#0b78fb', recorrido: '#0b78fb' };

interface Props {
  /** Las casas a mostrar, en el orden del recorrido. */
  casas: CasaRuta[];
  /** Número de paso de cada casa en el recorrido completo (el mismo que muestra la lista). */
  pasos: Map<number, number>;
  proximaId: number | null;
  alElegir: (casa: CasaRuta) => void;
}

type Ubicada = CasaRuta & Lugar;
const ubicadas = (casas: CasaRuta[]) => casas.filter((c): c is Ubicada => c.lat !== null && c.lng !== null);
const coleccion = <T,>(features: T[]) => ({ type: 'FeatureCollection' as const, features });
const linea = (coordinates: number[][]) => coleccion(coordinates.length > 1 ? [{ type: 'Feature' as const, geometry: { type: 'LineString' as const, coordinates }, properties: {} }] : []);

function datosDe(casas: CasaRuta[], pasos: Map<number, number>, proximaId: number | null) {
  const conLugar = ubicadas(casas);
  const faltan = conLugar.filter((c) => !casaHecha(c));
  return {
    faltan,
    puntos: coleccion(
      conLugar.map((c) => ({
        type: 'Feature' as const,
        id: c.conexionId,
        geometry: { type: 'Point' as const, coordinates: [c.lng, c.lat] },
        properties: {
          paso: pasos.get(c.conexionId) ?? c.orden,
          falta: !casaHecha(c),
          estado: c.conexionId === proximaId ? 'proxima' : casaHecha(c) ? (casaConNovedad(c) ? 'novedad' : 'hecha') : 'pendiente',
        },
      })),
    ),
    // El recorrido que falta, en orden.
    recorrido: linea(faltan.map((c) => [c.lng, c.lat])),
  };
}

export function RutaMapa({ casas, pasos, proximaId, alElegir }: Props) {
  const contenedor = useRef<HTMLDivElement>(null);
  const mapa = useRef<MapLibreMap | null>(null);
  const yo = useRef<Marker | null>(null);
  const [listo, setListo] = useState(false);
  const [fallo, setFallo] = useState(false);
  /** Dónde está el operario, si el teléfono lo dice. */
  const [posicion, setPosicion] = useState<Lugar | null>(null);
  const elegir = useRef(alElegir);
  const lista = useRef(casas);
  useEffect(() => {
    elegir.current = alElegir;
    lista.current = casas;
  });

  const gps = useGps((p) => {
    setPosicion({ lat: p.lat, lng: p.lng });
    if (!mapa.current) return;
    if (!yo.current) {
      const punto = document.createElement('div');
      punto.className = 'marca-mapa';
      punto.style.background = COLOR.proxima;
      yo.current = new Marker({ element: punto }).setLngLat([p.lng, p.lat]).addTo(mapa.current);
    } else yo.current.setLngLat([p.lng, p.lat]);
  });

  const hayUbicadas = casas.some((c) => c.lat !== null && c.lng !== null);

  useEffect(() => {
    if (!contenedor.current || !hayUbicadas) return;
    // Se encuadra lo que falta; si no falta nada, todo.
    const todas = ubicadas(lista.current);
    const faltan = todas.filter((c) => !casaHecha(c));
    const aLaVista = faltan.length > 0 ? faltan : todas;
    const lng = aLaVista.map((c) => c.lng);
    const lat = aLaVista.map((c) => c.lat);
    const encuadre: LngLatBoundsLike = [
      [Math.min(...lng), Math.min(...lat)],
      [Math.max(...lng), Math.max(...lat)],
    ];
    let nuevo: MapLibreMap;
    try {
      const fase = faseDelDia(posicionDelSol(new Date(), lat[0]!, lng[0]!).altitud);
      nuevo = new MapLibreMap({
        container: contenedor.current,
        style: crearEstilo(fase),
        bounds: encuadre,
        fitBoundsOptions: { padding: 48, maxZoom: 17 },
        minZoom: 9,
        maxZoom: 19,
        attributionControl: { compact: true },
        dragRotate: false,
        pitchWithRotate: false,
      });
    } catch {
      // Sin WebGL (teléfono muy viejo) el mapa no puede dibujarse: se avisa y queda la lista.
      queueMicrotask(() => setFallo(true));
      return;
    }
    nuevo.touchZoomRotate.disableRotation();
    nuevo.addControl(new NavigationControl({ showCompass: false }), 'bottom-right');
    nuevo.on('load', () => {
      const vacio = coleccion([]);
      nuevo.addSource(FUENTE_LINEA, { type: 'geojson', data: vacio });
      nuevo.addSource(FUENTE_TRAMO, { type: 'geojson', data: vacio });
      nuevo.addSource(FUENTE, { type: 'geojson', data: vacio });
      const trazo = { 'line-cap': 'round', 'line-join': 'round' } as const;
      // El recorrido: una línea azul con borde blanco, para que se lea sobre cualquier fondo.
      nuevo.addLayer({ id: 'ruta-linea-borde', type: 'line', source: FUENTE_LINEA, layout: trazo, paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 3, 17, 7], 'line-opacity': 0.85 } });
      nuevo.addLayer({ id: 'ruta-linea', type: 'line', source: FUENTE_LINEA, layout: trazo, paint: { 'line-color': COLOR.recorrido, 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1.5, 17, 4], 'line-opacity': 0.9 } });
      // De donde está parado a la casa que sigue: punteada.
      nuevo.addLayer({ id: 'ruta-tramo', type: 'line', source: FUENTE_TRAMO, layout: trazo, paint: { 'line-color': COLOR.recorrido, 'line-width': 3, 'line-dasharray': [0.2, 2] } });
      nuevo.addLayer({
        id: 'ruta-proxima-halo',
        type: 'circle',
        source: FUENTE,
        filter: ['==', ['get', 'estado'], 'proxima'],
        paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 14, 17, 28], 'circle-color': COLOR.proxima, 'circle-opacity': 0.22 },
      });
      nuevo.addLayer({
        id: 'ruta-casas',
        type: 'circle',
        source: FUENTE,
        // Lo que falta se dibuja encima de lo hecho: en una ruta casi terminada, las pocas que quedan no se pierden.
        layout: { 'circle-sort-key': ['match', ['get', 'estado'], 'proxima', 3, 'pendiente', 2, 'novedad', 1, 0] },
        paint: {
          // Las hechas van más chicas y más apagadas: ya no hay que ir.
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            12,
            ['match', ['get', 'estado'], 'proxima', 7, 'pendiente', 4.5, 3],
            15,
            ['match', ['get', 'estado'], 'proxima', 12, 'pendiente', 8, 5],
            17,
            ['match', ['get', 'estado'], 'proxima', 16, 'pendiente', 12, 8],
          ],
          'circle-color': ['match', ['get', 'estado'], 'hecha', COLOR.hecha, 'novedad', COLOR.novedad, 'proxima', COLOR.proxima, COLOR.pendiente],
          'circle-opacity': ['match', ['get', 'estado'], 'hecha', 0.7, 1],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': ['match', ['get', 'estado'], 'proxima', 3, 'pendiente', 1.5, 0.75],
          'circle-stroke-opacity': ['match', ['get', 'estado'], 'hecha', 0.7, 1],
        },
      });
      // El número de paso, solo en las que faltan: las hechas ya no hace falta contarlas.
      nuevo.addLayer({
        id: 'ruta-orden',
        type: 'symbol',
        source: FUENTE,
        minzoom: 14.6,
        filter: ['get', 'falta'],
        layout: { 'text-field': ['to-string', ['get', 'paso']], 'text-font': ['Noto Sans Bold'], 'text-size': ['interpolate', ['linear'], ['zoom'], 14.6, 9, 17, 12], 'text-allow-overlap': true },
        paint: { 'text-color': '#ffffff' },
      });
      nuevo.on('click', 'ruta-casas', (e) => {
        const id = Number(e.features?.[0]?.id);
        const casa = lista.current.find((c) => c.conexionId === id);
        if (casa) elegir.current(casa);
      });
      nuevo.on('mouseenter', 'ruta-casas', () => (nuevo.getCanvas().style.cursor = 'pointer'));
      nuevo.on('mouseleave', 'ruta-casas', () => (nuevo.getCanvas().style.cursor = ''));
      // Los créditos del mapa arrancan desplegados y tapan la leyenda: se pliegan (quedan en el botón «i»).
      const creditos = nuevo.getContainer().querySelector('.maplibregl-ctrl-attrib');
      creditos?.classList.remove('maplibregl-compact-show');
      creditos?.removeAttribute('open');
      mapa.current = nuevo;
      setListo(true);
    });
    return () => {
      yo.current = null;
      mapa.current = null;
      setListo(false);
      nuevo.remove();
    };
  }, [hayUbicadas]);

  const proxima = ubicadas(casas).find((c) => c.conexionId === proximaId) ?? null;

  // Cambió el filtro, la búsqueda, el recorrido o se cargó una lectura: se vuelve a pintar.
  useEffect(() => {
    if (!listo || !mapa.current) return;
    const { puntos, recorrido } = datosDe(casas, pasos, proximaId);
    (mapa.current.getSource(FUENTE) as GeoJSONSource).setData(puntos);
    (mapa.current.getSource(FUENTE_LINEA) as GeoJSONSource).setData(recorrido);
  }, [listo, casas, pasos, proximaId]);

  // Se movió el operario o cambió la casa que sigue: el tramo punteado hasta ella.
  useEffect(() => {
    if (!listo || !mapa.current) return;
    (mapa.current.getSource(FUENTE_TRAMO) as GeoJSONSource).setData(
      linea(
        posicion && proxima
          ? [
              [posicion.lng, posicion.lat],
              [proxima.lng, proxima.lat],
            ]
          : [],
      ),
    );
  }, [listo, posicion, proxima]);

  if (!hayUbicadas) {
    return (
      <Empty icon={MapPinOff} title="Estas casas no están ubicadas en el mapa" className="rounded-2xl border-2 border-linea py-10">
        El padrón de esta cooperativa tiene las direcciones pero no la ubicación. Usá la lista, que está en orden de recorrido.
      </Empty>
    );
  }
  if (fallo) {
    return (
      <Empty icon={MapPinOff} title="Este teléfono no puede mostrar el mapa" className="rounded-2xl border-2 border-linea py-10">
        Usá la lista: está en el mismo orden de recorrido.
      </Empty>
    );
  }

  const irAMiPosicion = () => {
    const p = gps.actual();
    if (p) mapa.current?.easeTo({ center: [p.lng, p.lat], zoom: Math.max(mapa.current.getZoom(), 16.5) });
  };
  const irALaQueSigue = () => {
    if (proxima) mapa.current?.easeTo({ center: [proxima.lng, proxima.lat], zoom: Math.max(mapa.current.getZoom(), 16.5) });
  };

  const faltan = ubicadas(casas).filter((c) => !casaHecha(c));
  const metros = largoDelRecorrido(faltan, posicion);
  const boton = 'grid size-12 place-items-center rounded-xl border border-linea bg-superficie text-marca-texto shadow-lg disabled:text-tinta-suave disabled:opacity-70';

  return (
    // Ocupa lo que queda de la pantalla entre el buscador y el botón de «Seguir con…».
    <div className="relative h-[calc(100dvh-30rem)] min-h-72 overflow-hidden rounded-2xl border-2 border-linea">
      <div ref={contenedor} className="size-full" aria-label="Mapa de la ruta" role="application" />

      <div className="absolute left-3 top-3 flex flex-col gap-2">
        <button type="button" onClick={irAMiPosicion} disabled={!posicion} aria-label="Ir a mi posición" title={posicion ? 'Ir a mi posición' : 'El teléfono todavía no dio la ubicación'} className={boton}>
          <LocateFixed className="size-6" aria-hidden />
        </button>
        <button type="button" onClick={irALaQueSigue} disabled={!proxima} aria-label="Ir a la casa que sigue" title="Ir a la casa que sigue" className={boton}>
          <CornerUpRight className="size-6" aria-hidden />
        </button>
      </div>

      {/* Lo que falta, de un vistazo. Deja libre la esquina de arriba a la derecha solo lo justo. */}
      {faltan.length > 0 && (
        <div role="status" className="absolute right-3 top-3 max-w-[62%] rounded-xl border border-linea bg-superficie/95 px-3 py-2 text-right shadow-lg">
          <p className="text-sm font-bold tabular-nums text-tinta">
            {faltan.length} {faltan.length === 1 ? 'casa' : 'casas'} · {formatDistancia(metros)}
          </p>
          {posicion && proxima && <p className="text-xs font-semibold text-marca-texto">La que sigue, a {formatDistancia(metrosEntre(posicion, proxima))}</p>}
        </div>
      )}

      <ul className="absolute bottom-3 left-3 flex max-w-[calc(100%-4.5rem)] flex-wrap gap-x-3 gap-y-1 rounded-xl border border-linea bg-superficie/95 px-3 py-2 text-xs font-semibold text-tinta shadow-lg">
        {(
          [
            ['Sigue', COLOR.proxima],
            ['Falta', COLOR.pendiente],
            ['Hecha', COLOR.hecha],
            ['Novedad', COLOR.novedad],
          ] as const
        ).map(([nombre, color]) => (
          <li key={nombre} className="flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-full" style={{ backgroundColor: color }} />
            {nombre}
          </li>
        ))}
      </ul>
    </div>
  );
}
