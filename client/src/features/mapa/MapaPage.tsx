// Mapa interactivo (SPEC 6.10): una casa por conexión, pintada según su deuda o según la lectura
// del mes, con capas (reclamos, cortes, rutas, zonas, mapa de calor), filtros, ficha de cada casa
// y un área que se dibuja a mano para ver cuánto debe y cuánto consume ese pedazo del pueblo.
// De qué color va cada casa lo decide vista.ts; cómo se dibuja, estilo.ts.
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Map as MapLibreMap, Marker, NavigationControl, setWorkerUrl, type GeoJSONSource, type MapLayerMouseEvent, type MapMouseEvent } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import type { Feature, FeatureCollection, Polygon } from 'geojson';
import { ChevronDown, ChevronUp, Layers, MapPinOff, Moon, Pause, PenLine, Play, Plane, SlidersHorizontal, Sun, Sunrise, Sunset, Undo2 } from 'lucide-react';
import { formatNumber, LOCALE, puntoEnPoligono, superficieHa, TIMEZONE, type MapaCapas, type MapaConexiones, type MapaLecturas } from '@shared';
import { api, errorMessage } from '../../lib/api';
import { cn } from '../../lib/cn';
import { SERVICIO_CORTO } from '../../components/servicios';
import { Button, Empty, ErrorState, Skeleton } from '../../components/ui';
import { Buscador } from './Buscador';
import { construirDatos, medioDe, type DatosMapa } from './casas';
import { BotonCapa, filtrosActivos, PanelCapas, PanelFiltros, tarjeta, TarjetaLeyenda, type Capas } from './controles';
import {
  aplicarHora,
  CAPAS_DE_CASAS,
  coloresPara,
  crearEstilo,
  FUENTE_CALOR,
  FUENTE_CASAS,
  FUENTE_CORTES,
  FUENTE_DESTELLOS,
  FUENTE_DIBUJO,
  FUENTE_LUCES,
  FUENTE_PUNTOS,
  FUENTE_RECLAMOS,
  FUENTE_RUTAS,
  FUENTE_ZONAS,
  rampaDeCalor,
} from './estilo';
import { FichaCasa, FichaReclamo, ResumenDeArea } from './paneles';
import { faseDelDia, formatHora, horaArgentina, hoyALas, nombreDeFase, posicionDelSol } from './sol';
import { armarCalor, armarVista, COLORES, leyendaDe, porCasa, SIN_FILTROS, type Calor, type Filtros, type Modo } from './vista';

// El motor del mapa dibuja en un hilo aparte; hay que decirle dónde quedó ese archivo después del build.
setWorkerUrl(workerUrl);

const sinAnimaciones = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
type Lugar = [number, number];
/** Cuánto dura el anillo que marca una casa recién leída. */
const DESTELLO_MS = 9000;
const dia = new Intl.DateTimeFormat(LOCALE, { timeZone: TIMEZONE, weekday: 'short', day: '2-digit', month: '2-digit' });
const hora24 = new Intl.DateTimeFormat(LOCALE, { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false });
const fuente = (map: MapLibreMap, nombre: string) => map.getSource(nombre) as GeoJSONSource;
const coleccion = (features: Feature[]): FeatureCollection => ({ type: 'FeatureCollection', features });

export function MapaPage() {
  const query = useQuery({ queryKey: ['mapa'], queryFn: () => api.get<MapaConexiones>('/mapa/conexiones'), staleTime: 60_000 });

  if (query.isPending) return <Skeleton className="size-full rounded-none" />;
  if (query.isError) {
    return (
      <div className="grid size-full place-items-center">
        <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
      </div>
    );
  }
  if (query.data.ids.length === 0) {
    return (
      <div className="grid size-full place-items-center">
        <Empty icon={MapPinOff} title="Todavía no hay conexiones ubicadas en el mapa">
          {query.data.sinUbicacion > 0
            ? `Esta cooperativa tiene ${formatNumber(query.data.sinUbicacion)} conexiones cargadas con su dirección, pero sin coordenadas. Cuando se les cargue la ubicación van a aparecer acá.`
            : 'Cuando se carguen conexiones con su ubicación van a aparecer acá.'}
        </Empty>
      </div>
    );
  }
  return <MapaVivo mapa={query.data} />;
}

/** Los cortes programados, como contornos de las zonas afectadas más un cartel en el medio de cada una. */
function cortesComoCapa(mapa: MapaConexiones, cortes: MapaCapas['cortes']): FeatureCollection {
  const features: Feature[] = [];
  for (const c of cortes) {
    const cartel = `Corte de ${SERVICIO_CORTO[c.servicio].toLowerCase()}\n${dia.format(new Date(c.desde))} · ${hora24.format(new Date(c.desde))} a ${hora24.format(new Date(c.hasta))}`;
    // Sin zona es toda la localidad: se marcan todas.
    for (const z of mapa.zonas.filter((x) => x.poligono && (c.zonaId === null || x.id === c.zonaId))) {
      const contorno = z.poligono as Polygon;
      features.push({ type: 'Feature', properties: { id: c.id }, geometry: contorno }, { type: 'Feature', properties: { id: c.id, cartel }, geometry: { type: 'Point', coordinates: medioDe(contorno) } });
    }
  }
  return coleccion(features);
}

function MapaVivo({ mapa }: { mapa: MapaConexiones }) {
  const datos: DatosMapa = useMemo(() => construirDatos(mapa), [mapa]);
  const centro = datos.centro!;
  const contenedor = useRef<HTMLDivElement>(null);
  const marcador = useRef<Marker | null>(null);
  /** El mapa, recién cuando terminó de cargar su estilo. Antes de eso (o si se desmontó) es null. */
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const listo = map != null;
  const [fallo, setFallo] = useState(false);

  /* ── Hora del día: por defecto, la de ahora en la cooperativa ── */
  const [enVivo, setEnVivo] = useState(true);
  const [hora, setHora] = useState(() => horaArgentina(new Date()));
  const [recorriendo, setRecorriendo] = useState(false);
  /** En el celular, el panel de la hora arranca plegado en un botón chico. */
  const [horaAbierta, setHoraAbierta] = useState(false);
  const sol = useMemo(() => posicionDelSol(hoyALas(hora), centro[1], centro[0]), [hora, centro]);
  const fase = faseDelDia(sol.altitud);
  const faseRef = useRef(fase);

  /* ── Qué se mira y con qué filtros ── */
  const [modo, setModo] = useState<Modo>('situacion');
  const [filtros, setFiltros] = useState<Filtros>(SIN_FILTROS);
  const [capas, setCapas] = useState<Capas>({ relieve: true, zonas: false, rutas: false, reclamos: true, cortes: true });
  const [calor, setCalor] = useState<Calor>('no');
  const [abierto, setAbierto] = useState<'capas' | 'filtros' | null>(null);
  const [sobrevolando, setSobrevolando] = useState(false);
  // Se puede llegar con ?conexion=… (desde un reclamo, por ejemplo): esa casa arranca elegida.
  const [seleccion, setSeleccion] = useState<number | null>(() => Number(new URLSearchParams(window.location.search).get('conexion')) || null);
  const [reclamoId, setReclamoId] = useState<number | null>(null);

  /* ── Lo que cambia durante el día: deuda, reclamos y cortes cada medio minuto; las lecturas, cada 5 segundos ── */
  const consultaCapas = useQuery({ queryKey: ['mapa', 'capas'], queryFn: () => api.get<MapaCapas>('/mapa/capas'), refetchInterval: 30_000 });
  /** Casas que se leyeron entre una consulta y la siguiente: destellan un rato en el mapa. */
  const leidasAntes = useRef<Map<number, number> | null>(null);
  const [destellos, setDestellos] = useState<{ id: number; hasta: number }[]>([]);
  const consultaLecturas = useQuery({
    queryKey: ['mapa', 'lecturas'],
    queryFn: async () => {
      const l = await api.get<MapaLecturas>('/mapa/lecturas');
      const antes = leidasAntes.current;
      leidasAntes.current = new Map(l.conexiones.map((c) => [c[0], c[2]]));
      const nuevas = antes ? l.conexiones.filter((c) => c[2] > (antes.get(c[0]) ?? c[2])).map((c) => c[0]) : [];
      if (nuevas.length) setDestellos((d) => [...d.filter((x) => x.hasta > Date.now() && !nuevas.includes(x.id)), ...nuevas.map((id) => ({ id, hasta: Date.now() + DESTELLO_MS }))]);
      return l;
    },
    enabled: modo === 'lecturas',
    refetchInterval: 5_000,
  });
  const datosCapas = consultaCapas.data;
  const lecturas = modo === 'lecturas' ? consultaLecturas.data : undefined;
  // Hasta que llegan las lecturas, el mapa sigue pintando la situación: si no, las casas desaparecían un momento.
  const modoVisto: Modo = modo === 'lecturas' && !lecturas ? 'situacion' : modo;

  const k = useMemo(() => porCasa(mapa, datos, datosCapas), [mapa, datos, datosCapas]);
  const vista = useMemo(() => armarVista(mapa, datos, k, lecturas, modoVisto, filtros), [mapa, datos, k, lecturas, modoVisto, filtros]);
  const puntosDeCalor = useMemo(() => armarCalor(mapa, k, vista, calor, filtros.servicio), [mapa, k, vista, calor, filtros.servicio]);
  const reclamos = useMemo(() => datosCapas?.reclamos ?? [], [datosCapas]);
  const cortes = useMemo(() => datosCapas?.cortes ?? [], [datosCapas]);

  /* ── Dibujar un área ── */
  const [dibujando, setDibujando] = useState(false);
  const [trazo, setTrazo] = useState<Lugar[]>([]);
  const [area, setArea] = useState<Lugar[] | null>(null);
  const cursor = useRef<Lugar | null>(null);
  const cerrarArea = () => {
    if (trazo.length < 3) return;
    setArea(trazo);
    setTrazo([]);
    setDibujando(false);
    setSeleccion(null);
    setReclamoId(null);
  };
  // El mapa registra sus eventos una sola vez: lo que necesitan del último redibujo les llega por referencia.
  const dibujandoRef = useRef(false);
  const cerrarAreaRef = useRef(cerrarArea);
  useEffect(() => {
    faseRef.current = fase;
    dibujandoRef.current = dibujando;
    cerrarAreaRef.current = cerrarArea;
  });
  const elegirCasa = (id: number) => {
    setReclamoId(null);
    setSobrevolando(false);
    setSeleccion(id);
  };
  const empezarDibujo = () => {
    setArea(null);
    setTrazo([]);
    setSobrevolando(false);
    setAbierto(null);
    setDibujando(true);
  };

  /* ── Crear el mapa ── */
  useEffect(() => {
    if (!contenedor.current || !datos.encuadre) return;
    let nuevo: MapLibreMap;
    try {
      nuevo = new MapLibreMap({
        container: contenedor.current,
        style: crearEstilo(faseRef.current),
        bounds: datos.encuadre,
        fitBoundsOptions: { padding: 50 },
        minZoom: 8,
        maxZoom: 19,
        maxPitch: 75,
        attributionControl: { compact: true },
      });
    } catch {
      // Sin WebGL (equipo muy viejo o bloqueado) el mapa no puede dibujarse.
      queueMicrotask(() => setFallo(true));
      return;
    }
    nuevo.addControl(new NavigationControl({ visualizePitch: true }), 'bottom-right');

    nuevo.on('load', () => {
      fuente(nuevo, FUENTE_ZONAS).setData(datos.zonas);
      fuente(nuevo, FUENTE_RUTAS).setData(datos.rutas);
      setMap(nuevo);
      // En el celular, los créditos del mapa arrancan desplegados y tapan la leyenda: se pliegan
      // (quedan a un toque, en el botón «i»).
      if (window.innerWidth < 640) {
        const creditos = nuevo.getContainer().querySelector('.maplibregl-ctrl-attrib');
        creditos?.classList.remove('maplibregl-compact-show');
        creditos?.removeAttribute('open');
      }
      // Vuelo de entrada: de la vista desde arriba a una vista inclinada sobre el pueblo.
      const vistaInicial = { pitch: 58, bearing: -18, zoom: nuevo.getZoom() + 0.8 };
      if (sinAnimaciones()) nuevo.jumpTo(vistaInicial);
      else nuevo.easeTo({ ...vistaInicial, duration: 3200, easing: (t) => 1 - Math.pow(1 - t, 3) });
    });

    // Mientras se dibuja un área, tocar una casa marca un vértice: no abre su ficha.
    const tocarCasa = (e: MapLayerMouseEvent) => {
      const id = Number(e.features?.[0]?.properties?.id);
      if (dibujandoRef.current || !Number.isFinite(id)) return;
      setReclamoId(null);
      setSobrevolando(false);
      setSeleccion(id);
    };
    const elegirReclamo = (e: MapLayerMouseEvent) => {
      const id = Number(e.features?.[0]?.properties?.id);
      if (dibujandoRef.current || !Number.isFinite(id)) return;
      setSeleccion(null);
      setReclamoId(id);
    };
    // Un grupo de casas se abre acercando el mapa hasta que se separa.
    const abrirGrupo = (e: MapLayerMouseEvent) => {
      const grupo = e.features?.[0];
      if (dibujandoRef.current || !grupo || grupo.geometry.type !== 'Point') return;
      const lugar = grupo.geometry.coordinates as Lugar;
      void fuente(nuevo, FUENTE_PUNTOS)
        .getClusterExpansionZoom(Number(grupo.properties?.cluster_id))
        .then((zoom) => nuevo.easeTo({ center: lugar, zoom: zoom + 0.3, duration: sinAnimaciones() ? 0 : 600 }))
        .catch(() => undefined);
    };
    const manito = () => {
      if (!dibujandoRef.current) nuevo.getCanvas().style.cursor = 'pointer';
    };
    const flecha = () => {
      if (!dibujandoRef.current) nuevo.getCanvas().style.cursor = '';
    };
    for (const capa of CAPAS_DE_CASAS) nuevo.on('click', capa, tocarCasa);
    nuevo.on('click', 'reclamos', elegirReclamo);
    nuevo.on('click', 'grupos', abrirGrupo);
    for (const capa of [...CAPAS_DE_CASAS, 'reclamos', 'grupos']) {
      nuevo.on('mouseenter', capa, manito);
      nuevo.on('mouseleave', capa, flecha);
    }

    // Dibujo: cada clic suma un vértice; el doble clic cierra el área.
    const sumarVertice = (e: MapMouseEvent) => {
      // El segundo clic de un doble clic no suma otro vértice en el mismo lugar.
      if (!dibujandoRef.current || e.originalEvent.detail > 1) return;
      setTrazo((t) => [...t, [e.lngLat.lng, e.lngLat.lat]]);
    };
    const terminar = (e: MapMouseEvent) => {
      if (!dibujandoRef.current) return;
      e.preventDefault();
      cerrarAreaRef.current();
    };
    const seguirCursor = (e: MapMouseEvent) => {
      if (dibujandoRef.current) cursor.current = [e.lngLat.lng, e.lngLat.lat];
    };
    nuevo.on('click', sumarVertice);
    nuevo.on('dblclick', terminar);
    nuevo.on('mousemove', seguirCursor);

    return () => {
      marcador.current?.remove();
      marcador.current = null;
      setMap((actual) => (actual === nuevo ? null : actual));
      nuevo.remove();
    };
  }, [datos]);

  /* ── Las casas: se vuelven a pintar con cada filtro y cada dato nuevo ── */
  useEffect(() => {
    if (!map) return;
    fuente(map, FUENTE_CASAS).setData(vista.casas);
    fuente(map, FUENTE_PUNTOS).setData(vista.puntos);
    fuente(map, FUENTE_LUCES).setData(vista.puntos);
  }, [map, vista]);

  /* ── Día y noche ── */
  useEffect(() => {
    if (map) aplicarHora(map, fase, sol, modoVisto === 'lecturas');
  }, [map, fase, sol, modoVisto]);

  // En vivo: el reloj avanza solo.
  useEffect(() => {
    if (!enVivo) return;
    const t = setInterval(() => setHora(horaArgentina(new Date())), 30_000);
    return () => clearInterval(t);
  }, [enVivo]);

  // "Recorrer el día": las 24 horas en unos 24 segundos.
  useEffect(() => {
    if (!recorriendo) return;
    let frame = 0;
    let anterior = performance.now();
    let acumulado = 0;
    const paso = (ahora: number) => {
      acumulado += (ahora - anterior) / 1000;
      anterior = ahora;
      if (acumulado >= 0.1) {
        const avance = acumulado;
        acumulado = 0;
        setHora((h) => (h + avance) % 24);
      }
      frame = requestAnimationFrame(paso);
    };
    frame = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(frame);
  }, [recorriendo]);

  /* ── Capas ── */
  useEffect(() => {
    if (!map) return;
    const ver = (ids: string[], visible: boolean) => ids.forEach((id) => map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none'));
    ver(['zonas-relleno', 'zonas-borde', 'nombres-zonas'], capas.zonas);
    ver(['rutas', 'rutas-nombres'], capas.rutas);
    ver(['reclamos', 'reclamos-pulso'], capas.reclamos);
    ver(['cortes-relleno', 'cortes-borde', 'cortes-nombres'], capas.cortes);
    // El relieve real de Misiones, exagerado un poco para que se note la sierra.
    map.setTerrain(capas.relieve ? { source: 'relieve', exaggeration: 1.6 } : null);
  }, [map, capas]);

  useEffect(() => {
    if (!map) return;
    fuente(map, FUENTE_RECLAMOS).setData(coleccion(reclamos.map((r) => ({ type: 'Feature', id: r.id, properties: { id: r.id, urgente: r.prioridad === 'urgente' ? 1 : 0 }, geometry: { type: 'Point', coordinates: [r.lng, r.lat] } }))));
  }, [map, reclamos]);

  useEffect(() => {
    if (map) fuente(map, FUENTE_CORTES).setData(cortesComoCapa(mapa, cortes));
  }, [map, mapa, cortes]);

  useEffect(() => {
    if (!map) return;
    fuente(map, FUENTE_CALOR).setData(puntosDeCalor);
    map.setLayoutProperty('calor', 'visibility', calor === 'no' ? 'none' : 'visible');
    if (calor !== 'no') map.setPaintProperty('calor', 'heatmap-color', rampaDeCalor(calor) as never);
  }, [map, puntosDeCalor, calor]);

  /* ── Sobrevolar: la cámara gira despacio alrededor del pueblo hasta que alguien toca el mapa ── */
  useEffect(() => {
    const lienzo = contenedor.current;
    if (!sobrevolando || !map || !lienzo) return;
    let frame = 0;
    let anterior = performance.now();
    const girar = (ahora: number) => {
      map.setBearing(map.getBearing() + ((ahora - anterior) / 1000) * 5);
      anterior = ahora;
      frame = requestAnimationFrame(girar);
    };
    frame = requestAnimationFrame(girar);
    const frenar = () => setSobrevolando(false);
    lienzo.addEventListener('pointerdown', frenar);
    lienzo.addEventListener('wheel', frenar, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      lienzo.removeEventListener('pointerdown', frenar);
      lienzo.removeEventListener('wheel', frenar);
    };
  }, [sobrevolando, map]);

  /* ── Casa elegida: marca que late y vuelo hasta ahí ── */
  useEffect(() => {
    if (!map) return;
    marcador.current?.remove();
    marcador.current = null;
    if (seleccion == null) return;
    const i = datos.indice.get(seleccion);
    if (i === undefined) return;
    const lugar: Lugar = [mapa.lng[i]!, mapa.lat[i]!];
    const el = document.createElement('div');
    el.className = 'marca-mapa';
    marcador.current = new Marker({ element: el }).setLngLat(lugar).addTo(map);
    const destino = { center: lugar, zoom: Math.max(map.getZoom(), 16.8), pitch: 60, padding: { right: window.innerWidth >= 1024 ? 380 : 0, bottom: window.innerWidth >= 1024 ? 0 : 260 } };
    if (sinAnimaciones()) map.jumpTo(destino);
    else map.flyTo({ ...destino, duration: 1800, essential: true });
  }, [map, seleccion, mapa, datos]);

  /* ── Lecturas en vivo: las casas recién leídas destellan un rato y después se apagan solas ── */
  useEffect(() => {
    if (!destellos.length) return;
    const t = setTimeout(() => setDestellos((d) => d.filter((x) => x.hasta > Date.now())), Math.max(200, Math.min(...destellos.map((x) => x.hasta)) - Date.now()));
    return () => clearTimeout(t);
  }, [destellos]);
  useEffect(() => {
    if (!map) return;
    const features: Feature[] = [];
    for (const d of modo === 'lecturas' ? destellos : []) {
      const i = datos.indice.get(d.id);
      if (i !== undefined) features.push({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [mapa.lng[i]!, mapa.lat[i]!] } });
    }
    fuente(map, FUENTE_DESTELLOS).setData(coleccion(features));
  }, [map, destellos, modo, datos, mapa]);

  /* ── Lo que late: los reclamos abiertos y las casas recién leídas ── */
  const late = (capas.reclamos && reclamos.length > 0) || (modo === 'lecturas' && destellos.length > 0);
  useEffect(() => {
    if (!map || !late) return;
    if (sinAnimaciones()) {
      // Sin animaciones queda un anillo quieto alrededor de cada punto.
      map.setPaintProperty('reclamos-pulso', 'circle-radius', 13);
      map.setPaintProperty('reclamos-pulso', 'circle-opacity', 0.3);
      map.setPaintProperty('destellos', 'circle-radius', 14);
      return;
    }
    let frame = 0;
    let ultimo = 0;
    const paso = (ahora: number) => {
      // Unas 20 veces por segundo alcanza para que se vea continuo sin recargar la máquina.
      if (ahora - ultimo > 48) {
        ultimo = ahora;
        const t = (ahora % 1800) / 1800;
        map.setPaintProperty('reclamos-pulso', 'circle-radius', 7 + 20 * t);
        map.setPaintProperty('reclamos-pulso', 'circle-opacity', 0.5 * (1 - t));
        map.setPaintProperty('destellos', 'circle-radius', 6 + 28 * t);
        map.setPaintProperty('destellos', 'circle-stroke-opacity', 1 - t);
      }
      frame = requestAnimationFrame(paso);
    };
    frame = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(frame);
  }, [map, late]);

  /* ── Dibujo: el contorno que se va marcando (con una línea que sigue al cursor) o el área ya cerrada ── */
  useEffect(() => {
    if (!map) return;
    const pintar = (puntos: Lugar[], cerrado: boolean, punta: Lugar | null) => {
      const features: Feature[] = puntos.map((p) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: p } }));
      const linea = punta ? [...puntos, punta] : puntos;
      if (cerrado && puntos.length >= 3) {
        const anillo = [...puntos, puntos[0]!];
        features.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [anillo] } }, { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: anillo } });
      } else if (linea.length >= 2) {
        features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: linea } });
        if (puntos.length >= 3) features.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...puntos, puntos[0]!]] } });
      }
      fuente(map, FUENTE_DIBUJO).setData(coleccion(features));
    };
    if (!dibujando) {
      pintar(area ?? [], true, null);
      return;
    }
    pintar(trazo, false, cursor.current);
    let frame = 0;
    let anterior: Lugar | null = cursor.current;
    const seguir = () => {
      if (cursor.current !== anterior) {
        anterior = cursor.current;
        pintar(trazo, false, anterior);
      }
      frame = requestAnimationFrame(seguir);
    };
    frame = requestAnimationFrame(seguir);
    return () => cancelAnimationFrame(frame);
  }, [map, dibujando, trazo, area]);

  // Mientras se dibuja: cursor de cruz, sin acercar con doble clic, y Escape cancela.
  useEffect(() => {
    if (!map || !dibujando) return;
    map.doubleClickZoom.disable();
    map.getCanvas().style.cursor = 'crosshair';
    cursor.current = null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDibujando(false);
        setTrazo([]);
      } else if (e.key === 'Enter') cerrarAreaRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      map.getCanvas().style.cursor = '';
      // Se vuelve a activar un instante después: si no, el doble clic que cierra el área también acerca el mapa.
      setTimeout(() => map.doubleClickZoom.enable(), 300);
    };
  }, [map, dibujando]);

  /** Casas que quedaron adentro del área, de las que se ven con los filtros puestos. */
  const idsDelArea = useMemo(() => (area ? vista.visibles.filter((i) => puntoEnPoligono([mapa.lng[i]!, mapa.lat[i]!], area)).map((i) => mapa.ids[i]!) : []), [area, vista, mapa]);
  const hectareas = useMemo(() => (area ? superficieHa(area) : 0), [area]);

  const colores = coloresPara(fase);
  const coloresDeCasa = COLORES.map((c) => colores[c]);
  const leyenda = leyendaDe(modoVisto, k.facturasParaCorte);
  const nombreFase = nombreDeFase(fase, hora);
  const IconoFase = { Día: Sun, Amanecer: Sunrise, Atardecer: Sunset, Noche: Moon }[nombreFase];
  const reclamoElegido = reclamoId === null ? undefined : reclamos.find((r) => r.id === reclamoId);
  const cambiarFiltros = (cambios: Partial<Filtros>) => setFiltros((f) => ({ ...f, ...cambios }));
  const conFiltros = filtros.ocultos.size > 0 || filtrosActivos(filtros) > 0;

  if (fallo) {
    return (
      <div className="grid size-full place-items-center">
        <ErrorState message="Este equipo no puede mostrar el mapa en 3D. Probá con otro navegador o actualizalo." />
      </div>
    );
  }

  return (
    <div className="relative size-full overflow-hidden">
      {/* El estilo de MapLibre le pone position: relative a su contenedor: por eso va adentro de otro que fija el tamaño. */}
      <div className="absolute inset-0">
        <div ref={contenedor} className="size-full" aria-label="Mapa de conexiones" role="application" />
      </div>
      {!listo && <Skeleton className="absolute inset-0 rounded-none" />}

      {/* Arriba: buscador y hora del día */}
      {/* Van los dos a la izquierda: la derecha queda libre para la ficha de la casa elegida. */}
      <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-wrap items-start gap-3 max-sm:gap-2 [&>*]:pointer-events-auto">
        <Buscador onPick={elegirCasa} />

        {/* En el celular la hora es un botón chico; el panel entero se abre al tocarlo. */}
        <button
          type="button"
          aria-expanded={horaAbierta}
          aria-label={`Hora del mapa: ${formatHora(hora)}, ${nombreFase}. ${horaAbierta ? 'Ocultar' : 'Cambiar la hora'}`}
          onClick={() => setHoraAbierta((v) => !v)}
          className={cn(tarjeta, 'flex min-h-11 items-center gap-2 px-3 text-sm font-bold tabular-nums text-tinta sm:hidden', horaAbierta && 'hidden')}
        >
          <IconoFase className={cn('size-4', fase > 0.5 ? 'text-marca-texto' : 'text-alerta')} aria-hidden />
          {formatHora(hora)}
          <span className="font-semibold text-tinta-suave">· {nombreFase}</span>
          <ChevronDown className="size-4 text-tinta-suave" aria-hidden />
        </button>

        <section aria-label="Hora del día" className={cn(tarjeta, 'w-full p-3 sm:w-80', !horaAbierta && 'max-sm:hidden')}>
          <div className="flex items-center gap-3">
            <span className={cn('grid size-10 shrink-0 place-items-center rounded-xl transition-colors duration-500', fase > 0.5 ? 'bg-barra text-acento' : 'bg-acento-tenue text-alerta')}>
              <IconoFase className="size-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-lg font-bold leading-tight tabular-nums text-tinta">
                {formatHora(hora)} <span className="text-sm font-semibold text-tinta-suave">· {nombreFase}</span>
              </p>
              <p className="truncate text-xs text-tinta-suave">{enVivo ? 'Hora actual en la cooperativa' : 'Hora elegida a mano'}</p>
            </div>
            <button
              type="button"
              aria-pressed={enVivo}
              onClick={() => {
                setRecorriendo(false);
                setHora(horaArgentina(new Date()));
                setEnVivo(true);
              }}
              className={cn('min-h-11 rounded-lg px-3 text-sm font-semibold transition-colors duration-150', enVivo ? 'bg-marca text-white' : 'border border-linea text-tinta-suave hover:border-marca hover:text-marca-texto')}
            >
              Ahora
            </button>
            <button
              type="button"
              aria-label="Ocultar la hora"
              onClick={() => setHoraAbierta(false)}
              className="grid size-11 shrink-0 place-items-center rounded-lg text-tinta-suave hover:bg-marca-tenue hover:text-marca-texto sm:hidden"
            >
              <ChevronUp className="size-5" aria-hidden />
            </button>
          </div>
          <div className="mt-2.5 flex items-center gap-2">
            <button
              type="button"
              aria-label={recorriendo ? 'Pausar el recorrido del día' : 'Recorrer el día completo'}
              title={recorriendo ? 'Pausar' : 'Recorrer el día completo'}
              onClick={() => {
                setEnVivo(false);
                setRecorriendo((v) => !v);
              }}
              className="grid size-11 shrink-0 place-items-center rounded-lg bg-marca-tenue text-marca-texto hover:bg-marca hover:text-white"
            >
              {recorriendo ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
            </button>
            <input
              type="range"
              min={0}
              max={24}
              step={0.25}
              value={hora}
              aria-label="Hora del día"
              aria-valuetext={`${formatHora(hora)}, ${nombreFase}`}
              onChange={(e) => {
                setEnVivo(false);
                setRecorriendo(false);
                setHora(Math.min(23.99, Number(e.target.value)));
              }}
              className="h-11 min-w-0 flex-1 accent-[var(--marca)]"
            />
          </div>
        </section>

        {/* Mientras se dibuja: qué hacer y cómo terminar. */}
        {dibujando && (
          <section aria-label="Dibujar un área" role="status" className={cn(tarjeta, 'flex w-full flex-wrap items-center gap-2 border-acento p-3 sm:w-auto')}>
            <p className="min-w-0 flex-1 text-sm font-semibold text-tinta sm:max-w-64">
              {trazo.length < 3 ? `Tocá el mapa para marcar el contorno (${trazo.length} de 3 puntos como mínimo).` : 'Seguí marcando o cerrá el área. También con doble clic.'}
            </p>
            <Button variant="ghost" icon={Undo2} disabled={trazo.length === 0} onClick={() => setTrazo((t) => t.slice(0, -1))}>
              Deshacer
            </Button>
            <Button disabled={trazo.length < 3} onClick={cerrarArea}>
              Cerrar el área
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setDibujando(false);
                setTrazo([]);
              }}
            >
              Cancelar
            </Button>
          </section>
        )}
      </div>

      {/* Abajo a la izquierda: capas, filtros y leyenda */}
      <div className="pointer-events-none absolute bottom-3 left-3 right-16 flex flex-col items-start gap-2 [&>*]:pointer-events-auto">
        {abierto === 'capas' && <PanelCapas capas={capas} cambiar={(clave) => setCapas((c) => ({ ...c, [clave]: !c[clave] }))} calor={calor} setCalor={setCalor} reclamos={reclamos.length} cortes={cortes.length} />}
        {abierto === 'filtros' && <PanelFiltros mapa={mapa} filtros={filtros} cambiar={cambiarFiltros} periodoConsumo={datosCapas?.consumo.periodo ?? null} />}
        <div className="flex flex-wrap gap-2 max-sm:gap-1.5">
          <BotonCapa activo={abierto === 'capas'} onClick={() => setAbierto((a) => (a === 'capas' ? null : 'capas'))} icon={Layers}>
            Capas
          </BotonCapa>
          <BotonCapa activo={abierto === 'filtros'} onClick={() => setAbierto((a) => (a === 'filtros' ? null : 'filtros'))} icon={SlidersHorizontal} cuenta={filtrosActivos(filtros)}>
            Filtros
          </BotonCapa>
          <BotonCapa activo={dibujando || area !== null} onClick={() => (dibujando ? (setDibujando(false), setTrazo([])) : empezarDibujo())} icon={PenLine}>
            Dibujar área
          </BotonCapa>
          <BotonCapa activo={sobrevolando} onClick={() => setSobrevolando((v) => !v)} icon={Plane}>
            Sobrevolar
          </BotonCapa>
        </div>
        <TarjetaLeyenda
          modo={modo}
          setModo={(m) => {
            setModo(m);
            // Los colores apagados son de la otra leyenda: no se arrastran. Y la comparación de lecturas arranca de cero.
            cambiarFiltros({ ocultos: new Set() });
            leidasAntes.current = null;
            setDestellos([]);
          }}
          filtros={filtros}
          cambiar={cambiarFiltros}
          leyenda={leyenda}
          conteo={vista.conteo}
          colores={coloresDeCasa}
          visibles={vista.visibles.length}
          deuda={vista.deuda}
          lecturas={lecturas}
          calor={calor}
        />
      </div>

      {/* A la derecha: la casa elegida, un reclamo o el área dibujada */}
      {seleccion != null ? (
        <FichaCasa key={seleccion} id={seleccion} onClose={() => setSeleccion(null)} />
      ) : reclamoElegido ? (
        <FichaReclamo
          r={reclamoElegido}
          onClose={() => setReclamoId(null)}
          onVerCasa={elegirCasa}
        />
      ) : area ? (
        <ResumenDeArea ids={idsDelArea} hectareas={hectareas} servicio={filtros.servicio === 'todos' ? null : filtros.servicio} filtrada={conFiltros} onClose={() => setArea(null)} />
      ) : null}
    </div>
  );
}
