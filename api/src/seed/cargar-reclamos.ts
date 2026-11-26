// Reclamos y cortes programados de prueba (SPEC sección 9: 60 reclamos, 15 abiertos, repartidos en
// el mapa; 2 cortes futuros). Cada reclamo trae su historial con tiempos creíbles: lo urgente se
// atiende en horas, lo administrativo en días. El socio de la demo tiene uno viejo, ya resuelto.
// Se cargan una sola vez. Todo es inventado.
import { QueryTypes } from 'sequelize';
import { CUADRILLAS, TIPOS_RECLAMO, type EstadoReclamo, type OrigenReclamo, type ServicioReclamo } from '../shared';
import { sequelize } from '../db';
import { runInCooperativa } from '../lib/context';
import { CorteProgramadoModel, Reclamo } from '../models';
import { crearAzar } from './cargar-lecturas';

export interface OpcionesReclamos {
  semilla: number;
  hoy: string;
  cantidad: number;
}

interface ConexionFila {
  id: number;
  socio_id: number;
  telefono: string | null;
  direccion: string;
  zona_id: number | null;
  lat: string | null;
  lng: string | null;
  servicios: string[];
  demo: boolean;
}

const HORA = 3_600_000;

// Lo que cuenta quien reclama (a veces nada) y lo que anota la cuadrilla al terminar.
const DESCRIPCIONES: Record<string, string[]> = {
  sin_luz: ['Se cortó la luz en toda la cuadra.', 'Solo en mi casa, los vecinos tienen.', 'Desde anoche que no hay luz.'],
  baja_tension: ['La heladera hace ruido y las luces bajan a la noche.', 'Parpadea la luz cuando llueve.'],
  cable_caido: ['Hay un cable colgando sobre la vereda, cerca de la escuela.', 'Se cayó una rama sobre los cables.'],
  chispas: ['Sale olor a quemado del medidor.'],
  alumbrado: ['La luz de la esquina está apagada hace una semana.'],
  medidor: ['El vidrio del medidor está roto.', 'El medidor no marca nada.'],
  sin_agua: ['No sale agua desde la mañana.', 'Sin agua en todo el barrio.'],
  poca_presion: ['A la tarde casi no sale agua.', 'No llega agua al tanque.'],
  perdida: ['Sale agua de la vereda hace dos días.', 'Hay una pérdida grande en la esquina.'],
  turbia: ['El agua sale marrón.', 'El agua tiene olor raro.'],
  sin_servicio: ['El módem tiene la luz roja.', 'Sin internet desde ayer.'],
  lento: ['A la noche se corta todo el tiempo.'],
  sin_senal: ['No se ve ningún canal.'],
  canales: ['Se pixelan los canales de aire.'],
  factura: ['Me vino el doble que el mes pasado y no estuvimos en casa.', 'Me cobraron un servicio que di de baja.'],
  pago: ['Pagué por transferencia y me sigue figurando la deuda.'],
  otro: ['Quiero cambiar el titular de la conexión.', 'Quiero saber cómo adherirme al sepelio.'],
};
const RESOLUCIONES: Record<ServicioReclamo, string[]> = {
  energia: ['Se reemplazó el fusible de la bajada.', 'Se ajustó la conexión en el poste.', 'Se cambió el seccionador del transformador.', 'Se repuso la lámpara.', 'Se reemplazó el medidor.'],
  agua: ['Se reparó la cañería en la vereda.', 'Se purgó la red y se normalizó la presión.', 'Se cambió la llave de paso.', 'Se limpió el tanque de reserva del barrio.'],
  internet: ['Se reconfiguró el módem.', 'Se cambió el conector de la antena.'],
  tv: ['Se reemplazó el decodificador.', 'Se reorientó la antena.'],
  administrativo: ['Se revisó la lectura: estaba bien tomada. Se le explicó el cálculo.', 'Se encontró el pago y se aplicó a la factura.', 'Se le explicó el trámite y los requisitos.'],
};

export async function cargarReclamos(cooperativaId: number, o: OpcionesReclamos): Promise<{ reclamos: number; cortes: number } | null> {
  return runInCooperativa(cooperativaId, async () => {
    if ((await Reclamo.count()) > 0) return null;
    const conexiones = await sequelize.query<ConexionFila>(
      `SELECT c.id, c.socio_id, s.telefono, c.direccion, c.zona_id, c.lat, c.lng, (s.usuario_id IS NOT NULL) AS demo,
              array_agg(sc.servicio) FILTER (WHERE sc.estado = 'activo') AS servicios
       FROM conexiones c JOIN socios s ON s.id = c.socio_id JOIN servicios_conexion sc ON sc.conexion_id = c.id
       WHERE c.cooperativa_id = :cooperativaId AND c.eliminado_el IS NULL
       GROUP BY c.id, s.id ORDER BY c.id`,
      { replacements: { cooperativaId }, type: QueryTypes.SELECT },
    );
    if (conexiones.length === 0) return null;
    const [admin] = await sequelize.query<{ id: number }>(
      `SELECT u.id FROM usuarios u JOIN roles_usuario r ON r.usuario_id = u.id AND r.rol = 'admin' WHERE u.cooperativa_id = :cooperativaId ORDER BY u.id LIMIT 1`,
      { replacements: { cooperativaId }, type: QueryTypes.SELECT },
    );
    const azar = crearAzar(o.semilla + 606);
    const elegir = <T>(lista: readonly T[]): T => lista[Math.floor(azar.next() * lista.length)]!;
    // El mediodía de hoy, o ahora si todavía no llegó (a la madrugada, el mediodía queda en el futuro).
    const ahora = Math.min(Date.parse(`${o.hoy}T11:30:00-03:00`), Date.now());

    const abiertos = Math.round(o.cantidad * 0.25);
    const porEstado = (i: number): EstadoReclamo =>
      i < Math.round(abiertos * 0.33) ? 'nuevo' : i < Math.round(abiertos * 0.6) ? 'asignado' : i < abiertos ? 'en_curso' : 'resuelto';

    interface Generado {
      socio_id: number;
      conexion_id: number;
      servicio: ServicioReclamo;
      tipo: string;
      descripcion: string | null;
      prioridad: string;
      estado: EstadoReclamo;
      origen: OrigenReclamo;
      cuadrilla: string | null;
      direccion: string;
      lat: string | null;
      lng: string | null;
      contacto: string | null;
      creado: number;
      asignado: number | null;
      iniciado: number | null;
      resuelto: number | null;
      resolucion: string | null;
    }
    const generados: Generado[] = [];
    const demo = conexiones.find((c) => c.demo);

    for (let i = 0; i < o.cantidad; i++) {
      const estado = porEstado(i);
      // El último reclamo resuelto es el del socio de la demo: tiene un historial para ver.
      const conexion = i === o.cantidad - 1 && demo ? demo : elegir(conexiones);
      const suerte = azar.next();
      let servicio: ServicioReclamo = suerte < 0.55 ? 'energia' : suerte < 0.83 ? 'agua' : suerte < 0.9 ? 'internet' : suerte < 0.93 ? 'tv' : 'administrativo';
      if (servicio !== 'administrativo' && !(conexion.servicios ?? []).includes(servicio)) servicio = 'energia';
      if (i === o.cantidad - 1 && demo) servicio = 'energia';
      const tipos = TIPOS_RECLAMO[servicio];
      // Los primeros de cada lista son los más comunes.
      const tipo = i === o.cantidad - 1 && demo ? tipos.find((t) => t.codigo === 'baja_tension')! : tipos[Math.min(Math.floor(azar.next() ** 1.7 * tipos.length), tipos.length - 1)]!;
      const urgente = tipo.prioridad === 'urgente' || tipo.prioridad === 'alta';
      const administrativo = servicio === 'administrativo';

      // Lo abierto es reciente; lo resuelto se reparte en los últimos 4 meses.
      const haceHoras = estado === 'nuevo' ? azar.entre(0.3, 9) : estado === 'asignado' ? azar.entre(2, 30) : estado === 'en_curso' ? azar.entre(3, 40) : azar.entre(48, 120 * 24);
      const creado = ahora - (i === o.cantidad - 1 && demo ? 52 * 24 : haceHoras) * HORA;
      const paso = (min: number, max: number) => (urgente ? azar.entre(min, max) : azar.entre(min * 3, max * 4)) * HORA;
      let asignado: number | null = null;
      let iniciado: number | null = null;
      let resuelto: number | null = null;
      if (administrativo) {
        if (estado !== 'nuevo') asignado = creado + paso(1, 6);
        if (estado === 'en_curso' || estado === 'resuelto') iniciado = asignado! + paso(1, 12);
        if (estado === 'resuelto') resuelto = iniciado! + paso(2, 30);
      } else {
        if (estado !== 'nuevo') asignado = creado + paso(0.2, 2.5);
        if (estado === 'en_curso' || estado === 'resuelto') iniciado = asignado! + paso(0.3, 5);
        if (estado === 'resuelto') resuelto = iniciado! + paso(0.4, 6);
      }
      // Nada pasa en el futuro: si el último paso quedó después de ahora, se achican los tiempos en proporción.
      const ultimo = resuelto ?? iniciado ?? asignado;
      if (ultimo !== null && ultimo > ahora - 5 * 60_000) {
        const escala = (ahora - 5 * 60_000 - creado) / (ultimo - creado);
        const ajustar = (v: number | null) => (v === null ? null : creado + (v - creado) * escala);
        [asignado, iniciado, resuelto] = [ajustar(asignado), ajustar(iniciado), ajustar(resuelto)];
      }

      const origen: OrigenReclamo = i === o.cantidad - 1 && demo ? 'portal' : elegir(['portal', 'portal', 'portal', 'telefono', 'telefono', 'telefono', 'oficina'] as const);
      const textos = DESCRIPCIONES[tipo.codigo] ?? [];
      generados.push({
        socio_id: conexion.socio_id,
        conexion_id: conexion.id,
        servicio,
        tipo: tipo.codigo,
        descripcion: textos.length && azar.next() < 0.75 ? elegir(textos) : null,
        prioridad: tipo.prioridad,
        estado,
        origen,
        cuadrilla: asignado !== null ? elegir(CUADRILLAS[servicio]) : null,
        direccion: conexion.direccion,
        lat: conexion.lat,
        lng: conexion.lng,
        contacto: conexion.telefono,
        creado,
        asignado,
        iniciado,
        resuelto,
        resolucion: resuelto !== null ? elegir(RESOLUCIONES[servicio]) : null,
      });
    }
    // Se numeran en el orden en que entraron.
    generados.sort((a, b) => a.creado - b.creado);
    const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

    await sequelize.transaction(async (transaction) => {
      const ids = (
        await sequelize.query<{ id: string }>(`SELECT nextval(pg_get_serial_sequence('reclamos', 'id')) AS id FROM generate_series(1, CAST($n AS int))`, {
          bind: { n: generados.length },
          type: QueryTypes.SELECT,
          transaction,
        })
      ).map((r) => Number(r.id));
      const filas = generados.map((g, i) => ({
        ...g,
        id: ids[i]!,
        numero: i + 1,
        creado_el: iso(g.creado),
        asignado_el: iso(g.asignado),
        iniciado_el: iso(g.iniciado),
        resuelto_el: iso(g.resuelto),
        actualizado_el: iso(g.resuelto ?? g.iniciado ?? g.asignado ?? g.creado),
      }));
      await sequelize.query(
        `INSERT INTO reclamos (id, cooperativa_id, numero, socio_id, conexion_id, servicio, tipo, descripcion, prioridad, estado, origen, cuadrilla, direccion,
                               lat, lng, contacto, asignado_el, iniciado_el, resuelto_el, resolucion, creado_el, actualizado_el)
         SELECT x.id, CAST($cooperativaId AS int), x.numero, x.socio_id, x.conexion_id, x.servicio, x.tipo, x.descripcion, x.prioridad, x.estado, x.origen, x.cuadrilla,
                x.direccion, x.lat, x.lng, x.contacto, CAST(x.asignado_el AS timestamptz), CAST(x.iniciado_el AS timestamptz), CAST(x.resuelto_el AS timestamptz), x.resolucion,
                CAST(x.creado_el AS timestamptz), CAST(x.actualizado_el AS timestamptz)
         FROM jsonb_to_recordset(CAST($datos AS jsonb)) AS x(
           id int, numero int, socio_id int, conexion_id int, servicio text, tipo text, descripcion text, prioridad text, estado text, origen text, cuadrilla text,
           direccion text, lat numeric, lng numeric, contacto text, asignado_el text, iniciado_el text, resuelto_el text, resolucion text, creado_el text, actualizado_el text)`,
        { bind: { cooperativaId, datos: JSON.stringify(filas) }, type: QueryTypes.RAW, transaction },
      );
      const eventos = filas.flatMap((f) => [
        { reclamo_id: f.id, estado: 'nuevo', nota: null, creado_el: f.creado_el, usuario_id: null },
        ...(f.asignado_el ? [{ reclamo_id: f.id, estado: 'asignado', nota: null, creado_el: f.asignado_el, usuario_id: admin?.id ?? null }] : []),
        ...(f.iniciado_el ? [{ reclamo_id: f.id, estado: 'en_curso', nota: null, creado_el: f.iniciado_el, usuario_id: admin?.id ?? null }] : []),
        ...(f.resuelto_el ? [{ reclamo_id: f.id, estado: 'resuelto', nota: f.resolucion, creado_el: f.resuelto_el, usuario_id: admin?.id ?? null }] : []),
      ]);
      await sequelize.query(
        `INSERT INTO reclamo_eventos (cooperativa_id, reclamo_id, estado, nota, visible_socio, usuario_id, creado_el)
         SELECT CAST($cooperativaId AS int), x.reclamo_id, x.estado, x.nota, TRUE, x.usuario_id, CAST(x.creado_el AS timestamptz)
         FROM jsonb_to_recordset(CAST($datos AS jsonb)) AS x(reclamo_id int, estado text, nota text, usuario_id int, creado_el text)`,
        { bind: { cooperativaId, datos: JSON.stringify(eventos) }, type: QueryTypes.RAW, transaction },
      );
      await sequelize.query(
        `INSERT INTO numeradores (cooperativa_id, tipo, letra, punto_venta, ultimo) VALUES (CAST($cooperativaId AS int), 'reclamo', 'R', 0, CAST($n AS int))
         ON CONFLICT (cooperativa_id, tipo, letra, punto_venta) DO UPDATE SET ultimo = GREATEST(numeradores.ultimo, EXCLUDED.ultimo)`,
        { bind: { cooperativaId, n: filas.length }, type: QueryTypes.RAW, transaction },
      );
    });

    /* ── Cortes programados: dos que vienen (uno en la zona del socio de la demo) y uno que ya pasó ── */
    let cortes = 0;
    if ((await CorteProgramadoModel.count()) === 0) {
      const zonas = [...new Set(conexiones.map((c) => c.zona_id).filter((z): z is number => z !== null))];
      const zonaDemo = demo?.zona_id ?? zonas[0] ?? null;
      const otraZona = zonas.find((z) => z !== zonaDemo) ?? null;
      const dia = (dias: number, hora: string) => new Date(Date.parse(`${o.hoy}T${hora}:00-03:00`) + dias * 24 * HORA);
      const lista = [
        { zonaId: zonaDemo, servicio: 'energia' as const, desde: dia(3, '08:00'), hasta: dia(3, '12:00'), motivo: 'Cambio de transformador y poda preventiva sobre la línea de media tensión' },
        ...(otraZona !== null ? [{ zonaId: otraZona, servicio: 'agua' as const, desde: dia(6, '14:00'), hasta: dia(6, '17:30'), motivo: 'Conexión de la cañería nueva sobre la calle principal' }] : []),
        { zonaId: null, servicio: 'energia' as const, desde: dia(-20, '06:00'), hasta: dia(-20, '07:30'), motivo: 'Mantenimiento de la subestación' },
      ];
      for (const c of lista) {
        const [{ n }] = (await sequelize.query<{ n: string }>(
          `SELECT count(DISTINCT s.id) AS n FROM socios s JOIN conexiones cx ON cx.socio_id = s.id JOIN servicios_conexion sc ON sc.conexion_id = cx.id AND sc.servicio = :servicio
           WHERE s.cooperativa_id = :cooperativaId AND s.email IS NOT NULL AND (CAST(:zona AS int) IS NULL OR cx.zona_id = :zona)`,
          { replacements: { cooperativaId, servicio: c.servicio, zona: c.zonaId }, type: QueryTypes.SELECT },
        )) as [{ n: string }];
        await CorteProgramadoModel.create({ ...c, avisados: Number(n), creadoPor: admin?.id ?? null });
        cortes++;
      }
    }
    return { reclamos: generados.length, cortes };
  });
}
