// Mapa interactivo (SPEC 6.10). Las casas van por un lado (cambian poco) y lo que se pinta encima
// —deuda, reclamos, cortes, lecturas— por otro, para poder volver a pedirlo seguido sin traer todo.
import { Router } from 'express';
import { QueryTypes } from 'sequelize';
import { areaSchema, CATEGORIAS, type Categoria, type MapaConexiones } from '../shared';
import { sequelize } from '../db';
import { Cooperativa, Ruta, Usuario, Zona } from '../models';
import { writeAudit } from '../lib/audit';
import { idParam, notFound, ok, parse } from '../lib/errors';
import { exportarInforme } from '../lib/exportar';
import { capasDelMapa, fichaDelMapa, lecturasDelMapa, resumirArea } from '../lib/mapa';
import { hoy } from '../lib/tarifas';
import { requireCooperativaId } from '../lib/tenant';
import { requireRole } from '../middlewares/auth';

export const mapaRouter = Router();
mapaRouter.use(requireRole('gerencia', 'admin', 'facturacion'));

interface Fila {
  id: number;
  lng: string;
  lat: string;
  zona_id: number | null;
  ruta_id: number | null;
  orden_ruta: number | null;
  orientacion: number | null;
  servicios: number;
  estado: number;
  estados: number;
  categoria: Categoria | null;
}

/**
 * Todas las conexiones ubicadas, en columnas paralelas para que pesen poco (SPEC 6.10: el mapa
 * tiene que andar fluido con 10.000 puntos). Una sola consulta agrupada; SQL crudo, con el filtro
 * por cooperativa escrito a mano.
 */
mapaRouter.get('/conexiones', async (_req, res) => {
  const cooperativaId = requireCooperativaId();
  const [filas, sinUbicacion, zonas, rutas] = await Promise.all([
    sequelize.query<Fila>(
      `SELECT c.id, c.lng, c.lat, c.zona_id, c.ruta_id, c.orden_ruta, c.orientacion,
              -- bits en el orden de SERVICIOS_CONEXION, solo los servicios activos
              COALESCE(bit_or(CASE sc.servicio WHEN 'energia' THEN 1 WHEN 'agua' THEN 2 WHEN 'internet' THEN 4
                                               WHEN 'tv' THEN 8 WHEN 'sepelio' THEN 16 END)
                       FILTER (WHERE sc.estado = 'activo'), 0)::int AS servicios,
              -- estado del punto: el peor entre energía y agua (índice de ESTADOS_SERVICIO); 3 = todo de baja
              COALESCE(max(CASE sc.estado WHEN 'activo' THEN 0 WHEN 'suspendido' THEN 1 WHEN 'cortado' THEN 2 END)
                       FILTER (WHERE sc.servicio IN ('energia', 'agua') AND sc.estado <> 'baja'), 3)::int AS estado,
              -- estado de cada servicio: 2 bits por servicio (ver empaquetarEstados en shared/mapa.ts)
              COALESCE(bit_or((CASE sc.estado WHEN 'activo' THEN 1 WHEN 'suspendido' THEN 2 WHEN 'cortado' THEN 3 ELSE 0 END)
                              << (CASE sc.servicio WHEN 'energia' THEN 0 WHEN 'agua' THEN 2 WHEN 'internet' THEN 4 WHEN 'tv' THEN 6 ELSE 8 END)), 0)::int AS estados,
              max(sc.categoria) FILTER (WHERE sc.servicio = 'energia' AND sc.estado <> 'baja') AS categoria
       FROM conexiones c
       LEFT JOIN servicios_conexion sc ON sc.conexion_id = c.id AND sc.cooperativa_id = :cooperativaId
       WHERE c.cooperativa_id = :cooperativaId AND c.eliminado_el IS NULL AND c.lat IS NOT NULL AND c.lng IS NOT NULL
       GROUP BY c.id
       ORDER BY c.id`,
      { replacements: { cooperativaId }, type: QueryTypes.SELECT },
    ),
    sequelize.query<{ n: string }>(
      `SELECT count(*) AS n FROM conexiones
       WHERE cooperativa_id = :cooperativaId AND eliminado_el IS NULL AND (lat IS NULL OR lng IS NULL)`,
      { replacements: { cooperativaId }, type: QueryTypes.SELECT },
    ),
    Zona.findAll({ order: [['id', 'ASC']] }),
    Ruta.findAll({ order: [['id', 'ASC']] }),
  ]);

  const indiceDeZona = new Map(zonas.map((z, i) => [z.id, i]));
  const indiceDeRuta = new Map(rutas.map((r, i) => [r.id, i]));
  const body: MapaConexiones = {
    ids: filas.map((f) => f.id),
    lng: filas.map((f) => Number(f.lng)),
    lat: filas.map((f) => Number(f.lat)),
    zona: filas.map((f) => (f.zona_id != null ? (indiceDeZona.get(f.zona_id) ?? -1) : -1)),
    estado: filas.map((f) => f.estado),
    servicios: filas.map((f) => f.servicios),
    orientacion: filas.map((f) => f.orientacion ?? 0),
    estados: filas.map((f) => f.estados),
    categoria: filas.map((f) => (f.categoria ? CATEGORIAS.indexOf(f.categoria) : -1)),
    ruta: filas.map((f) => (f.ruta_id != null ? (indiceDeRuta.get(f.ruta_id) ?? -1) : -1)),
    orden: filas.map((f) => f.orden_ruta ?? 0),
    zonas: zonas.map((z) => ({ id: z.id, nombre: z.nombre, tipo: z.tipo, poligono: z.poligonoGeojson })),
    rutas: rutas.map((r) => ({ id: r.id, nombre: r.nombre })),
    sinUbicacion: Number(sinUbicacion[0]?.n ?? 0),
  };
  ok(res, body);
});

/** Deuda y consumo por casa, reclamos abiertos y cortes programados. */
mapaRouter.get('/capas', async (_req, res) => {
  ok(res, await capasDelMapa());
});

/** Avance de la lectura del mes, casa por casa: el modo «Lecturas en vivo» lo pide cada pocos segundos. */
mapaRouter.get('/lecturas', async (_req, res) => {
  ok(res, await lecturasDelMapa());
});

/** Ficha de una casa: titular, servicios, última lectura, consumo, deuda y reclamos. */
mapaRouter.get('/conexiones/:id', async (req, res) => {
  const ficha = await fichaDelMapa(idParam(req));
  if (!ficha) throw notFound('No encontramos esa conexión');
  ok(res, ficha);
});

/** Resumen de las casas que quedaron dentro del área dibujada, y su lista para exportar. */
mapaRouter.post('/area', async (req, res) => {
  const { ids, servicio, formato } = parse(areaSchema, req.body);
  const { resumen, tabla } = await resumirArea(ids, servicio ?? null);
  if (formato === 'json') return ok(res, resumen);

  const [coop, usuario] = await Promise.all([Cooperativa.findByPk(requireCooperativaId()), Usuario.findByPk(req.auth!.userId, { attributes: ['nombre'] })]);
  const archivo = await exportarInforme(tabla, formato, { cooperativa: coop?.nombre ?? '', usuario: usuario?.nombre ?? null }, hoy());
  await writeAudit({ accion: 'exportar_area_mapa', entidad: 'mapa', despues: { formato, conexiones: resumen.conexiones, servicio: servicio ?? null } });
  res.setHeader('Content-Type', archivo.mime);
  res.setHeader('Content-Disposition', `attachment; filename="${archivo.nombre}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(archivo.contenido);
});
