// Generador del padrón de prueba (SPEC sección 9). Es una función pura y determinística: con los
// mismos datos de calles y la misma semilla devuelve siempre exactamente el mismo padrón, así la
// demo es igual en cada instalación. No toca la base: de eso se ocupa cargar-padron.ts.
import { normalizeText, type Categoria, type CondicionIva, type EstadoServicio, type ServicioConexion, type TipoZona } from '../shared';
import { APELLIDOS, COMERCIOS, ENTIDADES, FANTASIAS, NOMBRES_F, NOMBRES_M, PARENTESCOS, SANTOS } from './nombres';

/* ───────────────────────── Entrada y salida ───────────────────────── */

export interface DatosCalles {
  /** [lng, lat] del centro de la localidad. */
  centro: [number, number];
  zonas: { nombre: string; tipo: TipoZona; ancla: [number, number] }[];
  /** n = nombre, t = tipo de vía de OSM, u = 1 si es urbana, g = puntos [lng, lat]. */
  calles: { n: string | null; t: string; u: number; g: [number, number][] }[];
}

export interface OpcionesPadron {
  hogares: number;
  semilla: number;
  /** Proporción de hogares en zona urbana. */
  proporcionUrbana?: number;
  /** Fecha "de hoy" de la demo: ninguna fecha generada es posterior. */
  hoy?: string;
  /**
   * Socio para el usuario de prueba del portal: se le pone este nombre a un titular del centro que
   * tenga energía, agua, internet y sepelio, así su portal muestra un poco de todo.
   */
  socioDemo?: { nombre: string; email: string };
}

export interface MedidorGen {
  numero: string;
  tipo: string;
  factorMult: number;
  instaladoEl: string;
  retiradoEl: string | null;
}

export interface ServicioGen {
  servicio: ServicioConexion;
  categoria: Categoria | null;
  plan: string | null;
  estado: EstadoServicio;
  fechaAlta: string;
  fechaBaja: string | null;
  tieneSubsidio: boolean;
  /** El último es el que está colocado; los anteriores son el historial de cambios. */
  medidores: MedidorGen[];
}

export interface ConexionGen {
  numero: number;
  /** Índice en `socios`. */
  socio: number;
  direccion: string;
  /** Índice en `zonas`. */
  zona: number;
  ordenRuta: number;
  lat: number;
  lng: number;
  orientacion: number;
  servicios: ServicioGen[];
}

export interface SocioGen {
  numero: number;
  tipoDoc: 'DNI' | 'CUIT';
  nroDoc: string;
  nombre: string;
  condicionIva: CondicionIva;
  email: string | null;
  telefono: string | null;
  estado: 'activo' | 'baja';
  beneficiarios: { nombre: string; nroDoc: string; parentesco: string; altaEl: string }[];
}

export interface PadronGenerado {
  /** Índice en `socios` del titular elegido para el usuario de prueba, si se pidió uno. */
  socioDemo: number | null;
  zonas: { nombre: string; tipo: TipoZona; poligono: { type: 'Polygon'; coordinates: [number, number][][] } }[];
  socios: SocioGen[];
  conexiones: ConexionGen[];
}

export const PLANES = {
  internet50: 'Internet 50 Mbps',
  internet100: 'Internet 100 Mbps',
  tv: 'TV +80 canales',
} as const;

/* ───────────────────────── Azar con semilla ───────────────────────── */

/** mulberry32: generador chico y bueno; misma semilla → misma secuencia. */
function crearAzar(semilla: number) {
  let a = semilla >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    /** Entero entre min y max, los dos incluidos. */
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    chance: (p: number) => next() < p,
    pick: <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)] as T,
  };
}
type Azar = ReturnType<typeof crearAzar>;

/* ───────────────────────── Geometría plana ───────────────────────── */

type XY = [number, number];

function proyeccion(centro: [number, number]) {
  const kx = 111_320 * Math.cos((centro[1] * Math.PI) / 180);
  const ky = 110_540;
  return {
    toXY: ([lng, lat]: [number, number]): XY => [(lng - centro[0]) * kx, (lat - centro[1]) * ky],
    toLngLat: ([x, y]: XY): [number, number] => [round6(centro[0] + x / kx), round6(centro[1] + y / ky)],
  };
}
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
const dist = (a: XY, b: XY) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Envolvente convexa (cadena monótona de Andrew). */
function envolvente(points: XY[]): XY[] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: XY, a: XY, b: XY) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: XY[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: XY[] = [];
  for (const q of [...p].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 0) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/* ───────────────────────── Lugares posibles para una casa ───────────────────────── */

interface Lugar {
  xy: XY;
  calle: number;
  /** Metros desde el inicio de la vía. */
  avance: number;
  lado: 1 | -1;
  /** Rumbo de la calle, 0-179°. */
  rumbo: number;
  urbano: boolean;
  zona: number;
  peso: number;
}

const VIAS_URBANAS = new Set(['residential', 'unclassified', 'tertiary', 'secondary', 'primary', 'trunk']);
// En el campo no se ponen casas pegadas a las rutas nacionales o provinciales principales.
const VIAS_RURALES = new Set(['residential', 'unclassified', 'tertiary', 'secondary', 'track']);

function lugaresPosibles(datos: DatosCalles, azar: Azar, toXY: (p: [number, number]) => XY): Lugar[] {
  const anclas = datos.zonas.map((z) => toXY(z.ancla));
  const zonaMasCercana = (xy: XY, tipo: TipoZona) => {
    let best = -1;
    let bestD = Infinity;
    datos.zonas.forEach((z, i) => {
      if (z.tipo !== tipo) return;
      const d = dist(xy, anclas[i]!);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return { zona: best, d: bestD };
  };

  const lugares: Lugar[] = [];
  datos.calles.forEach((calle, index) => {
    const urbano = calle.u === 1;
    if (!(urbano ? VIAS_URBANAS : VIAS_RURALES).has(calle.t)) return;
    const paso = urbano ? 14 : 55;
    const margen = urbano ? 10 : 25;
    const puntos = calle.g.map(toXY);
    let avance = 0;
    let proximo = margen;
    const total = puntos.slice(1).reduce((t, p, i) => t + dist(puntos[i]!, p), 0);

    for (let i = 1; i < puntos.length; i++) {
      const a = puntos[i - 1]!;
      const b = puntos[i]!;
      const largo = dist(a, b);
      if (largo === 0) continue;
      const ux = (b[0] - a[0]) / largo;
      const uy = (b[1] - a[1]) / largo;
      // Rumbo geográfico (0° = norte, en sentido horario), sin distinguir ida de vuelta.
      const rumbo = (Math.round((Math.atan2(ux, uy) * 180) / Math.PI) + 360) % 180;
      while (proximo <= avance + largo && proximo <= total - margen) {
        const t = proximo - avance;
        for (const lado of [1, -1] as const) {
          const ancha = calle.t === 'trunk' || calle.t === 'primary';
          const retiro = urbano ? (ancha ? 22 : 12) + azar.next() * 5 : 22 + azar.next() * 25;
          const xy: XY = [a[0] + ux * t - uy * retiro * lado, a[1] + uy * t + ux * retiro * lado];
          const { zona, d } = zonaMasCercana(xy, urbano ? 'urbana' : 'rural');
          // Más casas cerca del centro de cada zona, como en un pueblo de verdad.
          const cercania = urbano ? 0.25 + Math.exp(-d / 700) : 0.12 + Math.exp(-d / 1400);
          const porVia = urbano ? (calle.t === 'residential' ? 1 : 0.55) : calle.t === 'residential' ? 3 : calle.t === 'track' ? 0.5 : 1;
          lugares.push({ xy, calle: index, avance: proximo, lado, rumbo, urbano, zona, peso: cercania * porVia });
        }
        proximo += paso;
      }
      avance += largo;
    }
  });
  return lugares;
}

/** Elige `cantidad` lugares al azar según su peso, sin que dos casas queden pegadas. */
function elegirLugares(lugares: Lugar[], cantidad: number, separacion: number, azar: Azar): Lugar[] {
  // Muestreo ponderado sin reposición (Efraimidis-Spirakis): se ordena por u^(1/peso).
  const orden = lugares.map((l) => ({ l, clave: Math.pow(azar.next(), 1 / l.peso) })).sort((a, b) => b.clave - a.clave);
  const celdas = new Map<string, XY[]>();
  const elegidos: Lugar[] = [];
  for (const { l } of orden) {
    if (elegidos.length >= cantidad) break;
    const cx = Math.floor(l.xy[0] / separacion);
    const cy = Math.floor(l.xy[1] / separacion);
    let libre = true;
    for (let dx = -1; dx <= 1 && libre; dx++) {
      for (let dy = -1; dy <= 1 && libre; dy++) {
        for (const otro of celdas.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (dist(otro, l.xy) < separacion) {
            libre = false;
            break;
          }
        }
      }
    }
    if (!libre) continue;
    const key = `${cx},${cy}`;
    celdas.set(key, [...(celdas.get(key) ?? []), l.xy]);
    elegidos.push(l);
  }
  if (elegidos.length < cantidad) {
    throw new Error(`No hay lugar para ${cantidad} hogares en las calles disponibles (entraron ${elegidos.length}).`);
  }
  return elegidos;
}

/* ───────────────────────── Fechas ───────────────────────── */

const DIA = 86_400_000;
const aFecha = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const fechaEntre = (azar: Azar, desde: string, hasta: string) => {
  const a = Date.parse(desde);
  const b = Math.max(a, Date.parse(hasta));
  return aFecha(a + Math.floor(azar.next() * ((b - a) / DIA + 1)) * DIA);
};
const posterior = (a: string, b: string) => (a > b ? a : b);

/* ───────────────────────── Personas, comercios e instituciones ───────────────────────── */

type TipoSocio = 'persona' | 'comercio' | 'entidad';

/** Dígito verificador de CUIT (módulo 11), para que los números de prueba tengan forma válida. */
function cuitConVerificador(base10: string): string {
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = [...base10].reduce((t, d, i) => t + Number(d) * pesos[i]!, 0);
  const resto = 11 - (suma % 11);
  return base10 + String(resto === 11 ? 0 : resto === 10 ? 9 : resto);
}

function generador(azar: Azar) {
  const documentos = new Set<string>();
  const unico = (crear: () => string) => {
    let doc = crear();
    while (documentos.has(doc)) doc = crear();
    documentos.add(doc);
    return doc;
  };
  // Rango 99.xxx.xxx: no corresponde a documentos reales emitidos.
  const dni = () => unico(() => `99${String(azar.int(0, 999_999)).padStart(6, '0')}`);
  const cuit = (prefijo: string) => unico(() => cuitConVerificador(`${prefijo}99${String(azar.int(0, 999_999)).padStart(6, '0')}`));

  const persona = () => {
    const mujer = azar.chance(0.5);
    const lista = mujer ? NOMBRES_F : NOMBRES_M;
    const primero = azar.pick(lista);
    const segundo = azar.chance(0.55) ? azar.pick(lista) : null;
    const nombres = segundo && segundo !== primero ? `${primero} ${segundo}` : primero;
    return { apellido: azar.pick(APELLIDOS), nombres, primero };
  };

  const rellenar = (plantilla: string) =>
    plantilla
      .replace('{a}', azar.pick(APELLIDOS))
      .replace('{n}', azar.pick(FANTASIAS))
      .replace('{s}', azar.pick(SANTOS))
      .replace('{num}', String(azar.int(900, 989)));

  return { dni, cuit, persona, rellenar };
}

/* ───────────────────────── El generador ───────────────────────── */

export function generarPadron(datos: DatosCalles, opciones: OpcionesPadron): PadronGenerado {
  const azar = crearAzar(opciones.semilla);
  const hoy = opciones.hoy ?? '2026-11-20';
  const { toXY, toLngLat } = proyeccion(datos.centro);
  const g = generador(azar);

  /* ── 1. Dónde va cada casa ── */
  const hayRural = datos.zonas.some((z) => z.tipo === 'rural');
  const urbanos = hayRural ? Math.round(opciones.hogares * (opciones.proporcionUrbana ?? 0.7)) : opciones.hogares;
  const todos = lugaresPosibles(datos, azar, toXY);
  const elegidos = [
    ...elegirLugares(todos.filter((l) => l.urbano), urbanos, 10, azar),
    ...elegirLugares(todos.filter((l) => !l.urbano), opciones.hogares - urbanos, 45, azar),
  ];

  /* ── 2. Orden de recorrido de cada zona: calle por calle, empezando por la más cercana al centro ── */
  const porZona = datos.zonas.map(() => [] as Lugar[]);
  for (const l of elegidos) porZona[l.zona]!.push(l);
  const ordenados: Lugar[][] = porZona.map((lista, z) => {
    const porCalle = new Map<number, Lugar[]>();
    for (const l of lista) porCalle.set(l.calle, [...(porCalle.get(l.calle) ?? []), l]);
    const tramos = [...porCalle.values()].map((casas) => {
      casas.sort((a, b) => a.avance - b.avance || a.lado - b.lado);
      return { casas, inicio: casas[0]!.xy, fin: casas[casas.length - 1]!.xy };
    });
    const recorrido: Lugar[] = [];
    let aca: XY = toXY(datos.zonas[z]!.ancla);
    while (tramos.length) {
      // Siguiente calle: la que tenga una punta más cerca de donde quedó parado el lecturista.
      let mejor = 0;
      let mejorD = Infinity;
      let invertir = false;
      tramos.forEach((t, i) => {
        const dInicio = dist(aca, t.inicio);
        const dFin = dist(aca, t.fin);
        if (Math.min(dInicio, dFin) < mejorD) {
          mejorD = Math.min(dInicio, dFin);
          mejor = i;
          invertir = dFin < dInicio;
        }
      });
      const [tramo] = tramos.splice(mejor, 1);
      const casas = invertir ? [...tramo!.casas].reverse() : tramo!.casas;
      recorrido.push(...casas);
      aca = casas[casas.length - 1]!.xy;
    }
    return recorrido;
  });

  /* ── 3. Direcciones ── */
  // Numeración por calle: crece con la distancia desde una punta, unos 100 números por cuadra.
  const ejes = new Map<string, { eje: 0 | 1; minimo: number }>();
  for (const calle of datos.calles) {
    if (!calle.n) continue;
    const puntos = calle.g.map(toXY);
    const previo = ejes.get(calle.n);
    const xs = puntos.map((p) => p[0]);
    const ys = puntos.map((p) => p[1]);
    if (!previo) {
      const eje = Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys) ? 0 : 1;
      ejes.set(calle.n, { eje, minimo: Math.min(...(eje === 0 ? xs : ys)) });
    } else {
      previo.minimo = Math.min(previo.minimo, ...(previo.eje === 0 ? xs : ys));
    }
  }
  const manzanas = new Map<number, number>(); // calle sin nombre → número de manzana
  const direccionDe = (l: Lugar, zona: string, lote: number): string => {
    const calle = datos.calles[l.calle]!;
    if (l.urbano) {
      if (calle.n) {
        const eje = ejes.get(calle.n)!;
        const pos = Math.max(0, l.xy[eje.eje] - eje.minimo);
        const altura = 100 + 2 * Math.round(pos / 2) + (l.lado === 1 ? 0 : 1);
        return `${calle.n} ${altura}`;
      }
      if (!manzanas.has(l.calle)) manzanas.set(l.calle, manzanas.size + 1);
      return `Barrio ${zona}, Mz ${manzanas.get(l.calle)} Lote ${lote}`;
    }
    return calle.n ? `${calle.n} s/n, Lote ${lote}` : `${zona}, Lote ${lote}`;
  };

  /* ── 4. Titulares: la mayoría tiene una conexión; algunos, dos o tres ── */
  interface Titular extends SocioGen {
    tipo: TipoSocio;
    categoriaEntidad?: 'oficial' | 'bien_publico';
    apellido?: string;
    conexiones: number;
  }
  const socios: Titular[] = [];
  let numeroSocio = 1000;
  const nuevoSocio = (): number => {
    numeroSocio += azar.int(1, 4);
    const r = azar.next();
    const tipo: TipoSocio = r < 0.91 ? 'persona' : r < 0.97 ? 'comercio' : 'entidad';
    const telefono = azar.chance(0.78) ? `3755-00${String(azar.int(0, 9999)).padStart(4, '0')}` : null;
    const base = { numero: numeroSocio, telefono, estado: (azar.chance(0.01) ? 'baja' : 'activo') as 'activo' | 'baja', beneficiarios: [], conexiones: 0 };
    if (tipo === 'persona') {
      const p = g.persona();
      const usuarioMail = normalizeText(`${p.primero} ${p.apellido}`).replace(/ /g, '.');
      socios.push({
        ...base,
        tipo,
        apellido: p.apellido,
        tipoDoc: 'DNI',
        nroDoc: g.dni(),
        nombre: `${p.apellido}, ${p.nombres}`,
        condicionIva: azar.chance(0.93) ? 'consumidor_final' : 'monotributo',
        // example.com: dominio reservado, nunca llega a una casilla real.
        email: azar.chance(0.42) ? `${usuarioMail}${azar.int(1, 99)}@example.com` : null,
      });
    } else if (tipo === 'comercio') {
      const sociedad = azar.chance(0.6);
      socios.push({
        ...base,
        tipo,
        tipoDoc: 'CUIT',
        nroDoc: g.cuit(sociedad ? '30' : azar.pick(['20', '27'])),
        nombre: g.rellenar(azar.pick(COMERCIOS)),
        condicionIva: sociedad ? 'responsable_inscripto' : 'monotributo',
        email: azar.chance(0.6) ? `contacto${azar.int(100, 999)}@example.com` : null,
      });
    } else {
      const entidad = azar.pick(ENTIDADES);
      socios.push({
        ...base,
        tipo,
        categoriaEntidad: entidad.categoria,
        tipoDoc: 'CUIT',
        nroDoc: g.cuit('30'),
        nombre: g.rellenar(entidad.nombre),
        condicionIva: 'exento',
        email: null,
      });
    }
    return socios.length - 1;
  };

  /* ── 5. Conexiones con sus servicios ── */
  let numeroConexion = 1000;
  let medidorEnergia = 100_000;
  let medidorAgua = 340_000;
  const conexiones: ConexionGen[] = [];
  const primeraConexion = new Map<number, number>(); // socio → su primera conexión

  const medidoresDe = (alta: string, tipo: string, factor: number, siguiente: () => string): MedidorGen[] => {
    const actual: MedidorGen = { numero: siguiente(), tipo, factorMult: factor, instaladoEl: alta, retiradoEl: null };
    // Una parte tuvo un cambio de medidor: queda el anterior como historial.
    if (alta < '2022-01-01' && azar.chance(0.12)) {
      const cambio = fechaEntre(azar, posterior(alta, '2015-01-01'), '2026-06-30');
      return [{ ...actual, retiradoEl: cambio }, { ...actual, numero: siguiente(), instaladoEl: cambio }];
    }
    return [actual];
  };

  ordenados.forEach((recorrido, zona) => {
    const info = datos.zonas[zona]!;
    recorrido.forEach((lugar, i) => {
      // ¿De quién es? Un 7,5 % va a alguien que ya tiene otra conexión (hasta 3).
      let socio = -1;
      if (socios.length > 20 && azar.chance(0.075)) {
        const candidato = azar.int(0, socios.length - 1);
        if (socios[candidato]!.conexiones < 3) socio = candidato;
      }
      if (socio < 0) socio = nuevoSocio();
      const titular = socios[socio]!;
      titular.conexiones++;
      const deBaja = titular.estado === 'baja';
      const urbano = info.tipo === 'urbana';

      // Energía: la tienen todas (SPEC: 100 %).
      let categoria: Categoria;
      if (titular.tipo === 'entidad') categoria = titular.categoriaEntidad!;
      else if (titular.tipo === 'comercio') categoria = azar.chance(0.12) ? 'industrial' : 'comercial';
      else if (!urbano && azar.chance(0.1)) categoria = 'rural';
      else categoria = azar.chance(0.05) ? 'comercial' : 'residencial';

      const altaEnergia = fechaEntre(azar, '1986-01-01', '2026-08-31');
      const e = azar.next();
      const estadoEnergia: EstadoServicio = deBaja || e < 0.005 ? 'baja' : e < 0.02 ? 'cortado' : e < 0.035 ? 'suspendido' : 'activo';
      const trifasico = categoria === 'industrial' || (categoria === 'comercial' ? azar.chance(0.45) : azar.chance(0.08));
      const factor = categoria === 'industrial' && azar.chance(0.7) ? azar.pick([20, 40]) : 1;
      const servicios: ServicioGen[] = [
        {
          servicio: 'energia',
          categoria,
          plan: null,
          estado: estadoEnergia,
          fechaAlta: altaEnergia,
          fechaBaja: estadoEnergia === 'baja' ? fechaEntre(azar, posterior(altaEnergia, '2024-01-01'), hoy) : null,
          tieneSubsidio: categoria === 'residencial' && azar.chance(0.6),
          medidores: medidoresDe(altaEnergia, trifasico ? 'Trifásico' : 'Monofásico', factor, () =>
            String((medidorEnergia += azar.int(1, 9))).padStart(10, '0'),
          ),
        },
      ];

      // Agua, internet y TV: solo donde llega la red (zona urbana).
      if (urbano && azar.chance(0.86)) {
        const alta = fechaEntre(azar, posterior(altaEnergia, '1988-01-01'), hoy);
        const a = azar.next();
        const estado: EstadoServicio = deBaja ? 'baja' : a < 0.015 ? 'cortado' : a < 0.025 ? 'suspendido' : 'activo';
        servicios.push({
          servicio: 'agua',
          categoria: categoria === 'rural' ? 'residencial' : categoria,
          plan: null,
          estado,
          fechaAlta: alta,
          fechaBaja: estado === 'baja' ? hoy : null,
          tieneSubsidio: false,
          medidores: medidoresDe(alta, 'Chorro múltiple ½"', 1, () => String((medidorAgua += azar.int(1, 9))).padStart(10, '0')),
        });
      }
      const conInternet = urbano && azar.chance(0.5);
      if (conInternet) {
        servicios.push({
          servicio: 'internet',
          categoria: null,
          plan: azar.chance(0.65) ? PLANES.internet50 : PLANES.internet100,
          estado: deBaja ? 'baja' : azar.chance(0.04) ? 'suspendido' : 'activo',
          fechaAlta: fechaEntre(azar, posterior(altaEnergia, '2019-03-01'), hoy),
          fechaBaja: deBaja ? hoy : null,
          tieneSubsidio: false,
          medidores: [],
        });
      }
      if (urbano && azar.chance(conInternet ? 0.55 : 0.09)) {
        servicios.push({
          servicio: 'tv',
          categoria: null,
          plan: PLANES.tv,
          estado: deBaja ? 'baja' : azar.chance(0.04) ? 'suspendido' : 'activo',
          fechaAlta: fechaEntre(azar, posterior(altaEnergia, '2012-01-01'), hoy),
          fechaBaja: deBaja ? hoy : null,
          tieneSubsidio: false,
          medidores: [],
        });
      }

      const { xy, rumbo } = lugar;
      const [lng, lat] = toLngLat(xy);
      numeroConexion += azar.int(1, 2);
      if (!primeraConexion.has(socio)) primeraConexion.set(socio, conexiones.length);
      conexiones.push({
        numero: numeroConexion,
        socio,
        direccion: direccionDe(lugar, info.nombre, i + 1),
        zona,
        ordenRuta: i + 1,
        lat,
        lng,
        orientacion: rumbo,
        servicios,
      });
    });
  });

  /* ── 6. Sepelio: algo más de la mitad de las personas, con 1 a 4 adherentes ── */
  socios.forEach((titular, index) => {
    if (titular.tipo !== 'persona' || titular.estado === 'baja' || !azar.chance(0.53)) return;
    const conexion = conexiones[primeraConexion.get(index)!]!;
    const alta = fechaEntre(azar, posterior(conexion.servicios[0]!.fechaAlta, '1995-01-01'), hoy);
    conexion.servicios.push({ servicio: 'sepelio', categoria: null, plan: null, estado: 'activo', fechaAlta: alta, fechaBaja: null, tieneSubsidio: false, medidores: [] });
    const cantidad = azar.pick([1, 1, 2, 2, 2, 3, 3, 4]);
    for (let i = 0; i < cantidad; i++) {
      const p = g.persona();
      const mismoApellido = azar.chance(0.75);
      titular.beneficiarios.push({
        nombre: `${mismoApellido ? titular.apellido! : p.apellido}, ${p.nombres}`,
        nroDoc: g.dni(),
        parentesco: azar.pick(PARENTESCOS),
        altaEl: fechaEntre(azar, alta, hoy),
      });
    }
  });

  /* ── 7. Socio del usuario de prueba ── */
  let socioDemo: number | null = null;
  if (opciones.socioDemo) {
    const tiene = (c: ConexionGen, servicio: ServicioConexion) => c.servicios.some((x) => x.servicio === servicio && x.estado === 'activo');
    const conexion = conexiones.find((c) => {
      const t = socios[c.socio]!;
      return c.zona === 0 && t.tipo === 'persona' && t.estado === 'activo' && t.conexiones === 1 && (['energia', 'agua', 'internet', 'sepelio'] as const).every((x) => tiene(c, x));
    });
    if (!conexion) throw new Error('No hay un titular que sirva como socio de prueba.');
    socioDemo = conexion.socio;
    const titular = socios[socioDemo]!;
    const apellido = opciones.socioDemo.nombre.split(',')[0]!.trim();
    titular.beneficiarios = titular.beneficiarios.map((b) => ({ ...b, nombre: b.nombre.replace(titular.apellido!, apellido) }));
    titular.nombre = opciones.socioDemo.nombre;
    titular.email = opciones.socioDemo.email;
    // Con subsidio en la energía: el portal muestra cuánto se pasa del tope (SPEC 11, flujo 4).
    for (const s of conexion.servicios) if (s.servicio === 'energia' && s.categoria === 'residencial') s.tieneSubsidio = true;
  }

  /* ── 8. Contorno de cada zona, para dibujarla en el mapa ── */
  const zonas = datos.zonas.map((z, i) => {
    const puntos = ordenados[i]!.map((l) => l.xy);
    const borde = envolvente(puntos);
    const cx = borde.reduce((t, p) => t + p[0], 0) / (borde.length || 1);
    const cy = borde.reduce((t, p) => t + p[1], 0) / (borde.length || 1);
    const margen = z.tipo === 'urbana' ? 60 : 180;
    const anillo = borde.map((p): [number, number] => {
      const d = dist(p, [cx, cy]) || 1;
      return toLngLat([p[0] + ((p[0] - cx) / d) * margen, p[1] + ((p[1] - cy) / d) * margen]);
    });
    if (anillo.length) anillo.push(anillo[0]!);
    return { nombre: z.nombre, tipo: z.tipo, poligono: { type: 'Polygon' as const, coordinates: [anillo] } };
  });

  return {
    socioDemo,
    zonas,
    socios: socios.map(({ tipo: _t, categoriaEntidad: _c, apellido: _a, conexiones: _n, ...socio }) => socio),
    conexiones,
  };
}
