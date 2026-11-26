import { Router } from 'express';
import { col, fn, Op, QueryTypes } from 'sequelize';
import { z } from 'zod';
import {
  SERVICIOS_CONEXION,
  type ConexionDetalle,
  type ConexionFicha,
  type Page,
  type PadronResumen,
  type ServicioConexion,
  type SocioDetalle,
  type SocioListado,
} from '../shared';
import { sequelize } from '../db';
import { BeneficiarioSepelio, Conexion, Medidor, Plan, Ruta, ServicioConexionModel, Socio, Zona } from '../models';
import { condicionDeBusqueda } from '../lib/busqueda';
import { idParam, notFound, ok, parse } from '../lib/errors';
import { requireCooperativaId } from '../lib/tenant';
import { requireRole } from '../middlewares/auth';

export const padronRouter = Router();
padronRouter.use(requireRole('admin', 'gerencia', 'facturacion', 'cajero'));

const ORDEN_SERVICIOS = new Map<string, number>(SERVICIOS_CONEXION.map((s, i) => [s, i]));
const ordenarServicios = <T extends { servicio: string }>(lista: T[]): T[] =>
  [...lista].sort((a, b) => (ORDEN_SERVICIOS.get(a.servicio) ?? 9) - (ORDEN_SERVICIOS.get(b.servicio) ?? 9));

/* ───────────────────────── Resumen ───────────────────────── */

padronRouter.get('/resumen', async (_req, res) => {
  const [socios, conexiones, porServicio, zonas, porZona] = await Promise.all([
    Socio.count(),
    Conexion.count(),
    ServicioConexionModel.findAll({
      attributes: ['servicio', [fn('count', col('id')), 'n']],
      where: { estado: { [Op.ne]: 'baja' } },
      group: ['servicio'],
      raw: true,
    }) as unknown as Promise<{ servicio: ServicioConexion; n: string }[]>,
    Zona.findAll({ order: [['tipo', 'DESC'], ['nombre', 'ASC']] }),
    Conexion.findAll({ attributes: ['zonaId', [fn('count', col('id')), 'n']], group: ['zonaId'], raw: true }) as unknown as Promise<
      { zonaId: number | null; n: string }[]
    >,
  ]);
  const cantidadPorZona = new Map(porZona.map((r) => [r.zonaId, Number(r.n)]));
  const body: PadronResumen = {
    socios,
    conexiones,
    porServicio: Object.fromEntries(
      SERVICIOS_CONEXION.map((s) => [s, Number(porServicio.find((r) => r.servicio === s)?.n ?? 0)]),
    ) as PadronResumen['porServicio'],
    zonas: zonas.map((zona) => ({ id: zona.id, nombre: zona.nombre, tipo: zona.tipo, conexiones: cantidadPorZona.get(zona.id) ?? 0 })),
  };
  ok(res, body);
});

/* ───────────────────────── Lista con búsqueda ───────────────────────── */

const listQuery = z.object({
  q: z.string().trim().max(80).optional(),
  zona: z.coerce.number().int().positive().optional(),
  cursor: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

padronRouter.get('/socios', async (req, res) => {
  const { q, zona, cursor, limit } = parse(listQuery, req.query);
  const busqueda = condicionDeBusqueda(q);
  const filtros = `
    s.cooperativa_id = :cooperativaId AND s.eliminado_el IS NULL
    AND ${busqueda.sql}
    AND (:zona::int IS NULL OR EXISTS (
      SELECT 1 FROM conexiones cz
      WHERE cz.socio_id = s.id AND cz.cooperativa_id = :cooperativaId AND cz.zona_id = :zona AND cz.eliminado_el IS NULL))`;
  const replacements = { cooperativaId: requireCooperativaId(), zona: zona ?? null, despuesDe: cursor ?? 0, limite: limit + 1, ...busqueda.params };

  // Paginación por cursor: se pide una fila de más para saber si hay página siguiente.
  const [filas, conteo] = await Promise.all([
    sequelize.query<{ id: number; numero: number; nombre: string; tipo_doc: string; nro_doc: string; estado: 'activo' | 'baja' }>(
      `SELECT s.id, s.numero, s.nombre, s.tipo_doc, s.nro_doc, s.estado FROM socios s
       WHERE ${filtros} AND s.numero > :despuesDe ORDER BY s.numero LIMIT :limite`,
      { replacements, type: QueryTypes.SELECT },
    ),
    sequelize.query<{ total: string }>(`SELECT count(*) AS total FROM socios s WHERE ${filtros}`, { replacements, type: QueryTypes.SELECT }),
  ]);
  const pagina = filas.slice(0, limit);

  const conexiones = pagina.length
    ? await Conexion.findAll({
        where: { socioId: pagina.map((f) => f.id) },
        include: [
          { model: Zona, as: 'zona', attributes: ['nombre'] },
          { model: ServicioConexionModel, as: 'servicios', attributes: ['servicio', 'estado'] },
        ],
        order: [['numero', 'ASC']],
      })
    : [];
  const porSocio = new Map<number, Conexion[]>();
  for (const c of conexiones) porSocio.set(c.socioId, [...(porSocio.get(c.socioId) ?? []), c]);

  const items: SocioListado[] = pagina.map((f) => {
    const propias = porSocio.get(f.id) ?? [];
    const activos = new Set(propias.flatMap((c) => (c.servicios ?? []).filter((s) => s.estado !== 'baja').map((s) => s.servicio)));
    return {
      id: f.id,
      numero: f.numero,
      nombre: f.nombre,
      tipoDoc: f.tipo_doc,
      nroDoc: f.nro_doc,
      estado: f.estado,
      conexiones: propias.length,
      direccion: propias[0]?.direccion ?? null,
      zona: propias[0]?.zona?.nombre ?? null,
      servicios: SERVICIOS_CONEXION.filter((s) => activos.has(s)),
    };
  });
  const body: Page<SocioListado> = {
    items,
    nextCursor: filas.length > limit ? String(pagina[pagina.length - 1]!.numero) : null,
    total: Number(conteo[0]?.total ?? 0),
  };
  ok(res, body);
});

/* ───────────────────────── Fichas ───────────────────────── */

export const CON_SERVICIOS = [
  { model: Zona, as: 'zona' },
  { model: Ruta, as: 'ruta' },
  {
    model: ServicioConexionModel,
    as: 'servicios',
    include: [
      { model: Plan, as: 'plan' },
      { model: Medidor, as: 'medidores' },
    ],
  },
];

export function toConexionDetalle(c: Conexion): ConexionDetalle {
  return {
    id: c.id,
    numero: c.numero,
    direccion: c.direccion,
    zona: c.zona?.nombre ?? null,
    tipoZona: c.zona?.tipo ?? null,
    ruta: c.ruta?.nombre ?? null,
    ordenRuta: c.ordenRuta,
    lat: c.lat != null ? Number(c.lat) : null,
    lng: c.lng != null ? Number(c.lng) : null,
    servicios: ordenarServicios(c.servicios ?? []).map((s) => ({
      id: s.id,
      servicio: s.servicio,
      categoria: s.categoria,
      plan: s.plan?.nombre ?? null,
      estado: s.estado,
      fechaAlta: s.fechaAlta,
      fechaBaja: s.fechaBaja,
      tieneSubsidio: s.tieneSubsidio,
      // Primero el medidor colocado; después los retirados, del más nuevo al más viejo.
      medidores: [...(s.medidores ?? [])]
        .sort((a, b) => (a.retiradoEl ? 1 : 0) - (b.retiradoEl ? 1 : 0) || b.instaladoEl.localeCompare(a.instaladoEl))
        .map((m) => ({ id: m.id, numero: m.numero, tipo: m.tipo, factorMult: m.factorMult, instaladoEl: m.instaladoEl, retiradoEl: m.retiradoEl })),
    })),
  };
}

/** Ficha completa de un socio: datos, conexiones con sus servicios y medidores, y adherentes de sepelio. */
export async function detalleSocio(id: number): Promise<(SocioDetalle & { facturaDigital: boolean }) | null> {
  const socio = await Socio.findByPk(id, {
    include: [
      { model: Conexion, as: 'conexiones', include: CON_SERVICIOS },
      { model: BeneficiarioSepelio, as: 'beneficiarios' },
    ],
  });
  if (!socio) return null;
  return {
    id: socio.id,
    numero: socio.numero,
    nombre: socio.nombre,
    tipoDoc: socio.tipoDoc,
    nroDoc: socio.nroDoc,
    condicionIva: socio.condicionIva,
    email: socio.email,
    telefono: socio.telefono,
    estado: socio.estado,
    conexiones: [...(socio.conexiones ?? [])].sort((a, b) => a.numero - b.numero).map(toConexionDetalle),
    beneficiarios: [...(socio.beneficiarios ?? [])]
      .sort((a, b) => a.altaEl.localeCompare(b.altaEl))
      .map((b) => ({ id: b.id, nombre: b.nombre, nroDoc: b.nroDoc, parentesco: b.parentesco, altaEl: b.altaEl })),
    facturaDigital: socio.facturaDigital,
  };
}

padronRouter.get('/socios/:id', async (req, res) => {
  const body = await detalleSocio(idParam(req));
  if (!body) throw notFound('No encontramos ese socio');
  ok(res, body);
});

/** Ficha corta de una conexión (la abre el mapa al tocar una casa). */
padronRouter.get('/conexiones/:id', async (req, res) => {
  const conexion = await Conexion.findByPk(idParam(req), {
    include: [...CON_SERVICIOS, { model: Socio, as: 'socio', attributes: ['id', 'numero', 'nombre'] }],
  });
  if (!conexion || !conexion.socio) throw notFound('No encontramos esa conexión');
  const body: ConexionFicha = {
    ...toConexionDetalle(conexion),
    socio: { id: conexion.socio.id, numero: conexion.socio.numero, nombre: conexion.socio.nombre },
  };
  ok(res, body);
});
