// Reclamos y cortes programados (SPEC 6.8): alta, cambios de estado con su historial, avisos al
// socio y la consulta con todo lo que hace falta para mostrarlos.
import { QueryTypes, type Transaction } from 'sequelize';
import {
  ESTADO_RECLAMO_ETIQUETA,
  ESTADO_RECLAMO_SOCIO,
  ESTADOS_RECLAMO,
  formatDateTime,
  referenciaReclamo,
  SERVICIO_ETIQUETA,
  tipoReclamo,
  type CorteProgramado,
  type EstadoReclamo,
  type EventoReclamo,
  type OrigenReclamo,
  type Prioridad,
  type ReclamoDetalle,
  type ReclamoListado,
  type ServicioReclamo,
} from '../shared';
import { sequelize } from '../db';
import { CorteProgramadoModel, Reclamo, ReclamoEvento, ReclamoFoto, Socio, Usuario, Zona } from '../models';
import { proveedorNotificaciones, type AvisoAlSocio } from '../proveedores/notificaciones';
import { writeAudit } from './audit';
import { runUnscoped } from './context';
import { badRequest, conflict } from './errors';
import { reservarNumeros } from './facturacion';
import { requireCooperativaId } from './tenant';

const FOTO = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/;
const orden = (e: EstadoReclamo) => ESTADOS_RECLAMO.indexOf(e);

/* ───────────────────────── Alta ───────────────────────── */

export interface NuevoReclamo {
  socioId: number | null;
  conexionId: number | null;
  servicio: ServicioReclamo;
  tipo: string;
  descripcion: string | null;
  prioridad?: Prioridad;
  origen: OrigenReclamo;
  direccion: string | null;
  lat: number | null;
  lng: number | null;
  contacto: string | null;
  foto: string | null;
  usuarioId: number | null;
}

export async function crearReclamo(d: NuevoReclamo): Promise<Reclamo> {
  const tipo = tipoReclamo(d.servicio, d.tipo);
  if (!tipo) throw badRequest('Revisá los datos marcados', { tipo: 'Elegí qué pasa' });
  const foto = d.foto ? FOTO.exec(d.foto) : null;
  return sequelize.transaction(async (transaction) => {
    const numero = await reservarNumeros({ tipo: 'reclamo', letra: 'R', puntoVenta: 0 }, 1, transaction);
    const reclamo = await Reclamo.create(
      {
        numero,
        socioId: d.socioId,
        conexionId: d.conexionId,
        servicio: d.servicio,
        tipo: d.tipo,
        descripcion: d.descripcion,
        prioridad: d.prioridad ?? tipo.prioridad,
        origen: d.origen,
        direccion: d.direccion,
        lat: d.lat === null ? null : d.lat.toFixed(6),
        lng: d.lng === null ? null : d.lng.toFixed(6),
        contacto: d.contacto,
        tieneFoto: foto !== null,
        creadoPor: d.usuarioId,
      },
      { transaction },
    );
    if (foto) await ReclamoFoto.create({ reclamoId: reclamo.id, mime: foto[1]!, contenido: Buffer.from(foto[2]!, 'base64') }, { transaction });
    await ReclamoEvento.create({ reclamoId: reclamo.id, estado: 'nuevo', usuarioId: d.usuarioId }, { transaction });
    await writeAudit({
      accion: 'crear_reclamo',
      entidad: 'reclamo',
      entidadId: reclamo.id,
      despues: { numero, servicio: d.servicio, tipo: d.tipo, origen: d.origen, socioId: d.socioId, conexionId: d.conexionId },
      transaction,
    });
    return reclamo;
  });
}

/* ───────────────────────── Cambios de estado ───────────────────────── */

async function avisarAlSocio(reclamo: Reclamo, texto: string, transaction: Transaction): Promise<void> {
  if (reclamo.socioId === null) return;
  const socio = await Socio.findByPk(reclamo.socioId, { attributes: ['id', 'email'], transaction });
  if (!socio?.email) return;
  const aviso: AvisoAlSocio = {
    socioId: socio.id,
    canal: 'email',
    destino: socio.email,
    asunto: `Tu reclamo ${referenciaReclamo(reclamo.numero)}: ${ESTADO_RECLAMO_ETIQUETA[reclamo.estado as EstadoReclamo].toLowerCase()}`,
    cuerpo: `Hola. ${texto} Podés seguirlo desde la app.`,
  };
  await proveedorNotificaciones.enviar([aviso], transaction);
}

/**
 * Avanza un reclamo. Se puede saltear un paso (resolver en la oficina un reclamo administrativo),
 * nunca volver atrás. Reasignar la cuadrilla deja el estado como está.
 */
export async function cambiarEstado(id: number, d: { estado: EstadoReclamo; cuadrilla?: string; nota?: string; resolucion?: string }, usuarioId: number): Promise<void> {
  await sequelize.transaction(async (transaction) => {
    const reclamo = await Reclamo.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!reclamo) throw conflict('No encontramos ese reclamo');
    if (reclamo.estado === 'resuelto') throw conflict('Ese reclamo ya está resuelto');
    const reasignar = d.estado === reclamo.estado && d.estado === 'asignado';
    if (!reasignar && orden(d.estado) <= orden(reclamo.estado)) throw conflict(`El reclamo ya está ${ESTADO_RECLAMO_ETIQUETA[reclamo.estado as EstadoReclamo].toLowerCase()}`);

    const cuadrilla = d.cuadrilla?.trim() || reclamo.cuadrilla;
    if ((d.estado === 'asignado' || d.estado === 'en_curso') && !cuadrilla) throw badRequest('Revisá los datos marcados', { cuadrilla: 'Elegí la cuadrilla' });
    if (reasignar && cuadrilla === reclamo.cuadrilla) throw badRequest('Revisá los datos marcados', { cuadrilla: 'Elegí otra cuadrilla' });

    const ahora = new Date();
    const antes = { estado: reclamo.estado, cuadrilla: reclamo.cuadrilla };
    await reclamo.update(
      {
        estado: d.estado,
        cuadrilla,
        asignadoEl: reclamo.asignadoEl ?? (orden(d.estado) >= orden('asignado') && cuadrilla ? ahora : null),
        iniciadoEl: reclamo.iniciadoEl ?? (orden(d.estado) >= orden('en_curso') ? ahora : null),
        resueltoEl: d.estado === 'resuelto' ? ahora : null,
        resolucion: d.estado === 'resuelto' ? d.resolucion!.trim() : reclamo.resolucion,
      },
      { transaction },
    );
    const nota = d.estado === 'resuelto' ? d.resolucion!.trim() : reasignar ? `Pasó a ${cuadrilla}.${d.nota ? ` ${d.nota}` : ''}` : d.nota?.trim() || null;
    await ReclamoEvento.create({ reclamoId: id, estado: d.estado, nota, usuarioId }, { transaction });
    await writeAudit({ accion: 'cambiar_estado_reclamo', entidad: 'reclamo', entidadId: id, antes, despues: { estado: d.estado, cuadrilla, nota }, transaction });
    if (!reasignar) await avisarAlSocio(reclamo, d.estado === 'resuelto' ? `Tu reclamo está resuelto: ${d.resolucion!.trim()}` : ESTADO_RECLAMO_SOCIO[d.estado], transaction);
  });
}

/* ───────────────────────── Consultas ───────────────────────── */

interface FilaReclamo {
  id: number;
  numero: number;
  servicio: ServicioReclamo;
  tipo: string;
  estado: EstadoReclamo;
  prioridad: Prioridad;
  origen: OrigenReclamo;
  socio_id: number | null;
  socio_numero: number | null;
  socio_nombre: string | null;
  direccion: string | null;
  zona: string | null;
  cuadrilla: string | null;
  tiene_foto: boolean;
  creado_el: Date;
  resuelto_el: Date | null;
  total_filas?: string;
}

export const COLUMNAS_RECLAMO = `r.id, r.numero, r.servicio, r.tipo, r.estado, r.prioridad, r.origen, r.socio_id, s.numero AS socio_numero, s.nombre AS socio_nombre,
  COALESCE(r.direccion, cx.direccion) AS direccion, z.nombre AS zona, r.cuadrilla, r.tiene_foto, r.creado_el, r.resuelto_el`;
export const DESDE_RECLAMO = `FROM reclamos r LEFT JOIN socios s ON s.id = r.socio_id LEFT JOIN conexiones cx ON cx.id = r.conexion_id LEFT JOIN zonas z ON z.id = cx.zona_id`;

export function toReclamoListado(f: FilaReclamo): ReclamoListado {
  return {
    id: f.id,
    numero: f.numero,
    referencia: referenciaReclamo(f.numero),
    servicio: f.servicio,
    tipo: f.tipo,
    tipoNombre: tipoReclamo(f.servicio, f.tipo)?.nombre ?? f.tipo,
    estado: f.estado,
    prioridad: f.prioridad,
    origen: f.origen,
    socio: f.socio_id !== null && f.socio_numero !== null ? { id: f.socio_id, numero: f.socio_numero, nombre: f.socio_nombre ?? '' } : null,
    direccion: f.direccion,
    zona: f.zona,
    cuadrilla: f.cuadrilla,
    tieneFoto: f.tiene_foto,
    creadoEl: f.creado_el.toISOString(),
    resueltoEl: f.resuelto_el ? f.resuelto_el.toISOString() : null,
  };
}

export async function filasReclamo(condicion: string, replacements: Record<string, unknown>, extra = 'ORDER BY r.creado_el DESC, r.id DESC'): Promise<FilaReclamo[]> {
  return sequelize.query<FilaReclamo>(`SELECT ${COLUMNAS_RECLAMO} ${DESDE_RECLAMO} WHERE r.cooperativa_id = :cooperativaId AND ${condicion} ${extra}`, {
    replacements: { ...replacements, cooperativaId: requireCooperativaId() },
    type: QueryTypes.SELECT,
  });
}

/**
 * Todo lo de un reclamo. `paraSocio`: solo las notas visibles, y sin nombres del personal
 * (al socio le llega «Cooperativa»).
 */
export async function detalleReclamo(reclamo: Reclamo, paraSocio: boolean): Promise<ReclamoDetalle> {
  const [[fila], eventos] = await Promise.all([
    filasReclamo('r.id = :id', { id: reclamo.id }, ''),
    ReclamoEvento.findAll({ where: { reclamoId: reclamo.id, ...(paraSocio ? { visibleSocio: true } : {}) }, order: [['creadoEl', 'ASC'], ['id', 'ASC']] }),
  ]);
  const autores = paraSocio
    ? new Map<number, string>()
    : new Map((await runUnscoped(() => Usuario.findAll({ where: { id: [...new Set(eventos.map((e) => e.usuarioId).filter((x): x is number => x != null))] }, attributes: ['id', 'nombre'] }))).map((u) => [u.id, u.nombre]));
  const conexion = reclamo.conexionId ? await sequelize.query<{ numero: number }>(`SELECT numero FROM conexiones WHERE id = :id AND cooperativa_id = :c`, { replacements: { id: reclamo.conexionId, c: requireCooperativaId() }, type: QueryTypes.SELECT }) : [];
  const autor = (e: ReclamoEvento): string | null => {
    if (!paraSocio) return e.usuarioId == null ? null : (autores.get(e.usuarioId) ?? null);
    // El que lo creó desde el portal es el socio mismo.
    return e.estado === 'nuevo' && reclamo.origen === 'portal' ? 'Vos' : 'Cooperativa';
  };
  const lista: EventoReclamo[] = eventos.map((e) => ({
    id: e.id,
    estado: e.estado,
    nota: e.nota,
    visibleSocio: e.visibleSocio,
    autor: autor(e),
    creadoEl: e.creadoEl.toISOString(),
  }));
  return {
    ...toReclamoListado(fila!),
    descripcion: reclamo.descripcion,
    contacto: paraSocio ? null : reclamo.contacto,
    conexion: reclamo.conexionId && conexion[0] ? { id: reclamo.conexionId, numero: conexion[0].numero } : null,
    lat: reclamo.lat === null ? null : Number(reclamo.lat),
    lng: reclamo.lng === null ? null : Number(reclamo.lng),
    asignadoEl: reclamo.asignadoEl ? reclamo.asignadoEl.toISOString() : null,
    iniciadoEl: reclamo.iniciadoEl ? reclamo.iniciadoEl.toISOString() : null,
    resolucion: reclamo.resolucion,
    eventos: lista,
  };
}

/* ───────────────────────── Cortes programados ───────────────────────── */

export function toCorte(c: CorteProgramadoModel): CorteProgramado {
  return {
    id: c.id,
    zona: c.zona ? { id: c.zona.id, nombre: c.zona.nombre } : null,
    servicio: c.servicio,
    desde: c.desde.toISOString(),
    hasta: c.hasta.toISOString(),
    motivo: c.motivo,
    avisados: c.avisados,
    cancelado: c.canceladoEl !== null,
    creadoEl: c.creadoEl.toISOString(),
  };
}

const horario = (desde: Date, hasta: Date) => {
  const d = formatDateTime(desde);
  const h = formatDateTime(hasta);
  return d.slice(0, 10) === h.slice(0, 10) ? `el ${d.slice(0, 10)} de ${d.slice(11)} a ${h.slice(11)}` : `del ${d} al ${h}`;
};

/** Carga un corte y avisa a los socios con ese servicio en la zona. */
export async function programarCorte(d: { zonaId: number | null; servicio: CorteProgramado['servicio']; desde: string; hasta: string; motivo: string }, usuarioId: number): Promise<CorteProgramadoModel> {
  return sequelize.transaction(async (transaction) => {
    const zona = d.zonaId === null ? null : await Zona.findByPk(d.zonaId, { transaction });
    if (d.zonaId !== null && !zona) throw badRequest('Revisá los datos marcados', { zonaId: 'Elegí una zona' });
    const corte = await CorteProgramadoModel.create(
      { zonaId: d.zonaId, servicio: d.servicio, desde: new Date(d.desde), hasta: new Date(d.hasta), motivo: d.motivo, creadoPor: usuarioId },
      { transaction },
    );
    const socios = await sequelize.query<{ id: number; email: string }>(
      `SELECT DISTINCT s.id, s.email FROM socios s
       JOIN conexiones c ON c.socio_id = s.id AND c.eliminado_el IS NULL
       JOIN servicios_conexion sc ON sc.conexion_id = c.id AND sc.servicio = :servicio AND sc.estado <> 'baja'
       WHERE s.cooperativa_id = :cooperativaId AND s.email IS NOT NULL AND s.email <> '' AND (CAST(:zonaId AS int) IS NULL OR c.zona_id = :zonaId)`,
      { replacements: { cooperativaId: requireCooperativaId(), servicio: d.servicio, zonaId: d.zonaId }, type: QueryTypes.SELECT, transaction },
    );
    const donde = zona ? `en ${zona.nombre}` : 'en toda la localidad';
    const avisados = await proveedorNotificaciones.enviar(
      socios.map((s) => ({
        socioId: s.id,
        canal: 'email' as const,
        destino: s.email,
        asunto: `Corte programado de ${SERVICIO_ETIQUETA[d.servicio].toLowerCase()} ${donde}`,
        cuerpo: `Hola. Va a haber un corte de ${SERVICIO_ETIQUETA[d.servicio].toLowerCase()} ${donde} ${horario(corte.desde, corte.hasta)}. Motivo: ${d.motivo}.`,
      })),
      transaction,
    );
    await corte.update({ avisados }, { transaction });
    await writeAudit({ accion: 'programar_corte', entidad: 'corte', entidadId: corte.id, despues: { ...d, avisados }, transaction });
    corte.zona = zona;
    return corte;
  });
}
