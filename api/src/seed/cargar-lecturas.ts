// Lecturas de prueba (SPEC sección 9): 12 meses de historial por medidor y el mes actual a medio leer
// (≈85 % cargado, el resto pendiente para mostrar la carga en vivo), con ≈2 % de anomalías y novedades.
// Se cargan una sola vez, cuando la cooperativa todavía no tiene ningún período. Todo es inventado.
import { randomUUID } from 'node:crypto';
import { QueryTypes, type CreationAttributes } from 'sequelize';
import { evaluarLectura, SERVICIOS_MEDIDOS, type Categoria, type MotivoLecturaMenor, type Novedad, type ServicioMedido } from '../shared';
import { sequelize } from '../db';
import { Lectura, Medidor, Periodo } from '../models';
import { runInCooperativa } from '../lib/context';

export interface OpcionesLecturas {
  /** Fecha del día (aaaa-mm-dd): el mes actual es el que queda en lectura. */
  hoy: string;
  semilla: number;
  /** Parte de cada ruta que ya se leyó este mes, en orden de ruta (se repite si hay más rutas). */
  avance: number[];
}

/** mulberry32: misma semilla → mismos datos. */
export function crearAzar(semilla: number) {
  let a = semilla >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, entre: (min: number, max: number) => min + next() * (max - min), chance: (p: number) => next() < p };
}

interface MedidorFila {
  id: number;
  factor: string;
  instalado_el: string;
  servicio: ServicioMedido;
  categoria: Categoria | null;
  conexion_id: number;
  ruta_id: number | null;
  operario_id: number | null;
  lat: string | null;
  lng: string | null;
  /** Es el medidor del socio de la demo. */
  demo: boolean;
}

/** Consumo mensual típico (mínimo y máximo) por servicio y categoría, en kWh o m³. */
const CONSUMO: Record<ServicioMedido, Record<Categoria, [number, number]>> = {
  energia: {
    residencial: [110, 460],
    comercial: [380, 1900],
    industrial: [2800, 9500],
    rural: [140, 620],
    oficial: [300, 1500],
    bien_publico: [150, 900],
  },
  agua: {
    residencial: [6, 26],
    comercial: [12, 60],
    industrial: [40, 180],
    rural: [8, 30],
    oficial: [15, 80],
    bien_publico: [10, 50],
  },
};

/** En Misiones el verano pesa: aire acondicionado y más agua. */
function estacion(servicio: ServicioMedido, mes: number): number {
  const verano = mes === 12 || mes <= 3;
  if (servicio === 'energia') return verano ? 1.28 : mes === 6 || mes === 7 ? 1.1 : 1;
  return verano ? 1.18 : 1;
}

const NOVEDADES_SIN_LECTURA: { novedad: Novedad; nota: string }[] = [
  { novedad: 'casa_cerrada', nota: 'No atiende nadie, portón con candado.' },
  { novedad: 'perro', nota: 'Perro suelto en el patio, no se pudo entrar.' },
  { novedad: 'sin_acceso', nota: 'Medidor tapado por la maleza.' },
  { novedad: 'medidor_roto', nota: 'Vidrio roto, no se leen los números.' },
];

export async function cargarLecturas(cooperativaId: number, opciones: OpcionesLecturas): Promise<{ periodos: number; lecturas: number } | null> {
  return runInCooperativa(cooperativaId, async () => {
    if ((await Periodo.count()) > 0) return null;

    const medidores = await sequelize.query<MedidorFila>(
      `SELECT m.id, m.factor_mult AS factor, m.instalado_el, sc.servicio, sc.categoria, c.id AS conexion_id, c.ruta_id, r.operario_id, c.lat, c.lng,
              (s.usuario_id IS NOT NULL) AS demo
       FROM medidores m
       JOIN servicios_conexion sc ON sc.id = m.servicio_conexion_id AND sc.estado <> 'baja' AND sc.servicio IN ('energia', 'agua')
       JOIN conexiones c ON c.id = sc.conexion_id AND c.eliminado_el IS NULL
       JOIN socios s ON s.id = c.socio_id
       LEFT JOIN rutas r ON r.id = c.ruta_id
       WHERE m.cooperativa_id = :cooperativaId AND m.retirado_el IS NULL
       ORDER BY c.ruta_id NULLS LAST, c.orden_ruta NULLS LAST, c.id, sc.servicio`,
      { replacements: { cooperativaId }, type: QueryTypes.SELECT },
    );
    if (medidores.length === 0) return null;

    const azar = crearAzar(opciones.semilla);
    const anioHoy = Number(opciones.hoy.slice(0, 4));
    const mesHoy = Number(opciones.hoy.slice(5, 7));
    const diaHoy = Number(opciones.hoy.slice(8, 10));
    // 12 meses cerrados + el actual.
    const meses = Array.from({ length: 13 }, (_, i) => {
      const n = anioHoy * 12 + (mesHoy - 1) - (12 - i);
      return { anio: Math.floor(n / 12), mes: (n % 12) + 1, actual: i === 12 };
    });

    return sequelize.transaction(async (transaction) => {
      const periodoId = new Map<string, number>();
      for (const m of meses) {
        for (const servicio of SERVICIOS_MEDIDOS) {
          const p = await Periodo.create({ servicio, anio: m.anio, mes: m.mes, estado: m.actual ? 'en_lectura' : 'cerrado' }, { transaction });
          periodoId.set(`${servicio}|${m.anio}|${m.mes}`, p.id);
        }
      }

      // Qué casas de cada ruta ya se leyeron este mes: las primeras del recorrido.
      const rutas = [...new Set(medidores.map((m) => m.ruta_id))];
      const casasDeRuta = new Map<number | null, number[]>();
      for (const m of medidores) {
        const lista = casasDeRuta.get(m.ruta_id) ?? [];
        if (lista.at(-1) !== m.conexion_id) lista.push(m.conexion_id);
        casasDeRuta.set(m.ruta_id, lista);
      }
      const leidaEsteMes = new Map<number, number>(); // conexión → posición dentro de lo leído (0..1)
      rutas.forEach((ruta, i) => {
        const casas = casasDeRuta.get(ruta)!;
        const parte = opciones.avance[i % opciones.avance.length] ?? 1;
        const hasta = Math.round(casas.length * parte);
        casas.slice(0, hasta).forEach((id, j) => leidaEsteMes.set(id, hasta > 1 ? j / (hasta - 1) : 0));
      });
      const indiceDeRuta = new Map(rutas.map((r, i) => [r, i]));

      const filas: CreationAttributes<Lectura>[] = [];
      const conMasDigitos: number[] = [];

      for (const m of medidores) {
        const factor = Number(m.factor) || 1;
        const [min, max] = CONSUMO[m.servicio][m.categoria ?? 'residencial'];
        // Cada medidor tiene su consumo "de siempre"; la mayoría, más cerca del mínimo que del máximo.
        const sorteado = min + (max - min) * azar.next() ** 1.8;
        // El socio de la demo consume por encima del tope subsidiado: así el portal tiene qué explicar.
        const base = m.demo && m.servicio === 'energia' ? 260 : sorteado;
        const ruta = indiceDeRuta.get(m.ruta_id) ?? 0;
        // Si en 14 meses pasaría los 5 dígitos, es un medidor de 7 (grandes consumos).
        const digitos = (base / factor) * 1.5 * 14 > 60_000 ? 7 : 5;
        if (digitos !== 5) conMasDigitos.push(m.id);
        let valor = Math.round(azar.entre(150, 10 ** digitos * 0.25));
        // El medidor ya venía andando: la primera lectura del historial tiene contra qué compararse,
        // así el primer mes también se factura con consumo.
        let anterior: number | null = valor;
        const consumos: number[] = [];
        const lat = m.lat === null ? null : Number(m.lat);
        const lng = m.lng === null ? null : Number(m.lng);

        for (const mes of meses) {
          // La ruta se lee siempre más o menos el mismo día del mes.
          const dia = Math.min(4 + (ruta % 8) + (mes.actual ? 0 : Math.floor(azar.entre(0, 2))), 27);
          let tomadaEl = new Date(Date.UTC(mes.anio, mes.mes - 1, dia, 11 + Math.floor(azar.entre(0, 8)), Math.floor(azar.entre(0, 60))));
          if (tomadaEl.toISOString().slice(0, 10) < m.instalado_el) continue; // todavía no estaba colocado

          let motivo: MotivoLecturaMenor | null = null;
          let novedad: Novedad | null = null;
          let nota: string | null = null;
          let leido: number | null;
          const normal = Math.max(1, Math.round((base * estacion(m.servicio, mes.mes) * azar.entre(0.86, 1.15)) / factor));

          if (mes.actual) {
            const posicion = leidaEsteMes.get(m.conexion_id);
            if (posicion === undefined) continue; // pendiente: es lo que se carga en la demo
            // Lo leído este mes se reparte en los últimos días, en el orden del recorrido.
            const atras = Math.max(1, Math.min(diaHoy - 1, 2 + (ruta % 5)));
            const minutos = Math.round((1 - posicion) * 6 * 60);
            tomadaEl = new Date(Date.UTC(mes.anio, mes.mes - 1, diaHoy - atras, 18, 0) - minutos * 60_000);

            const suerte = azar.next();
            if (suerte < 0.007) {
              ({ novedad, nota } = NOVEDADES_SIN_LECTURA[Math.floor(azar.next() * NOVEDADES_SIN_LECTURA.length)]!);
              leido = null;
            } else if (suerte < 0.012 && anterior !== null) {
              leido = valor + normal * 5; // consumo ×5
            } else if (suerte < 0.016 && anterior !== null) {
              leido = Math.round(azar.entre(8, 90)); // medidor cambiado: arranca de cero
              motivo = 'cambio_medidor';
            } else if (suerte < 0.02 && anterior !== null) {
              leido = valor; // casa vacía
            } else {
              leido = valor + normal;
            }
          } else {
            leido = valor + normal;
          }

          const evaluacion =
            leido === null
              ? { consumo: null, anomalia: null }
              : evaluarLectura({
                  valor: leido,
                  anterior,
                  promedio: consumos.length ? consumos.slice(-6).reduce((a, b) => a + b, 0) / Math.min(consumos.length, 6) : null,
                  digitos,
                  factor,
                  motivo,
                });
          filas.push({
            uuidDispositivo: randomUUID(),
            periodoId: periodoId.get(`${m.servicio}|${mes.anio}|${mes.mes}`)!,
            medidorId: m.id,
            valor: leido === null ? null : String(leido),
            anterior: anterior === null ? null : String(anterior),
            consumo: evaluacion.consumo === null ? null : String(evaluacion.consumo),
            tipo: 'real',
            motivo,
            novedad,
            anomalia: evaluacion.anomalia,
            nota,
            lat: lat === null ? null : (lat + azar.entre(-0.00004, 0.00004)).toFixed(6),
            lng: lng === null ? null : (lng + azar.entre(-0.00004, 0.00004)).toFixed(6),
            precisionM: lat === null ? null : Math.round(azar.entre(4, 18)),
            tomadaEl,
            operarioId: m.operario_id,
            sincronizadaEl: new Date(tomadaEl.getTime() + Math.round(azar.entre(1, 40)) * 60_000),
          });
          if (leido !== null) {
            if (evaluacion.consumo !== null) consumos.push(evaluacion.consumo);
            anterior = leido;
            valor = leido;
          }
        }
      }

      if (conMasDigitos.length) await Medidor.update({ digitos: 7 }, { where: { id: conMasDigitos }, transaction });
      const LOTE = 2000;
      for (let i = 0; i < filas.length; i += LOTE) await Lectura.bulkCreate(filas.slice(i, i + LOTE), { transaction, validate: false });
      return { periodos: periodoId.size, lecturas: filas.length };
    });
  });
}
