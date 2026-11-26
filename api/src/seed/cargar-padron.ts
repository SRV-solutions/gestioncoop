// Guarda en la base un padrón generado con generar-padron.ts. Todo en una sola transacción:
// o queda el padrón completo o no queda nada.
import type { Transaction } from 'sequelize';
import { sequelize } from '../db';
import { runInCooperativa } from '../lib/context';
import { BeneficiarioSepelio, Conexion, Medidor, Plan, RolUsuario, Ruta, ServicioConexionModel, Socio, Usuario, Zona } from '../models';
import { PLANES, type PadronGenerado } from './generar-padron';

interface Opciones {
  cooperativaId: number;
  /** Precio de cada plan de internet y TV. Solo se crean los planes listados. */
  planes: { servicio: 'internet' | 'tv'; nombre: string; precio: string }[];
  /** Cooperativa sin padrón georreferenciado: se guardan las direcciones pero no las coordenadas. */
  sinUbicacion?: boolean;
  /** Email del usuario de prueba que queda vinculado al socio demo. */
  emailSocioDemo?: string;
}

const LOTE = 500;
async function enLotes<T>(filas: T[], guardar: (lote: T[]) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < filas.length; i += LOTE) await guardar(filas.slice(i, i + LOTE));
}

export async function cargarPadron(padron: PadronGenerado, opciones: Opciones): Promise<{ socios: number; conexiones: number }> {
  return runInCooperativa(opciones.cooperativaId, () =>
    sequelize.transaction(async (transaction: Transaction) => {
      const tx = { transaction };

      const planes = await Plan.bulkCreate(opciones.planes, { ...tx, returning: true });
      const planPorNombre = new Map(planes.map((p) => [p.nombre, p.id]));

      // Zonas y una ruta de lectura por zona, repartidas entre los operarios que haya.
      const operarios = await Usuario.findAll({
        include: [{ model: RolUsuario, as: 'roles', where: { rol: 'operario' }, required: true }],
        order: [['id', 'ASC']],
        ...tx,
      });
      const zonaIds: number[] = [];
      const rutaIds: number[] = [];
      for (const [i, z] of padron.zonas.entries()) {
        const zona = await Zona.create({ nombre: z.nombre, tipo: z.tipo, poligonoGeojson: opciones.sinUbicacion ? null : z.poligono }, tx);
        const ruta = await Ruta.create(
          {
            zonaId: zona.id,
            nombre: `Ruta ${i + 1} · ${z.nombre}`,
            operarioId: operarios.length ? operarios[i % operarios.length]!.id : null,
          },
          tx,
        );
        zonaIds.push(zona.id);
        rutaIds.push(ruta.id);
      }

      // Socios
      const usuarioDemo = opciones.emailSocioDemo ? await Usuario.findOne({ where: { email: opciones.emailSocioDemo }, ...tx }) : null;
      await enLotes(
        padron.socios.map((s, i) => ({
          numero: s.numero,
          tipoDoc: s.tipoDoc,
          nroDoc: s.nroDoc,
          nombre: s.nombre,
          condicionIva: s.condicionIva,
          email: s.email,
          telefono: s.telefono,
          estado: s.estado,
          usuarioId: i === padron.socioDemo ? (usuarioDemo?.id ?? null) : null,
        })),
        (lote) => Socio.bulkCreate(lote, tx),
      );
      // Los ids se leen de la base por su clave natural: no se depende del orden en que los devuelve el INSERT.
      const socioIds = new Map((await Socio.findAll({ attributes: ['id', 'numero'], ...tx })).map((s) => [s.numero, s.id]));
      const idDeSocio = (index: number) => socioIds.get(padron.socios[index]!.numero)!;

      await enLotes(
        padron.socios.flatMap((s, i) => s.beneficiarios.map((b) => ({ socioId: idDeSocio(i), ...b }))),
        (lote) => BeneficiarioSepelio.bulkCreate(lote, tx),
      );

      // Conexiones
      await enLotes(
        padron.conexiones.map((c) => ({
          socioId: idDeSocio(c.socio),
          numero: c.numero,
          direccion: c.direccion,
          zonaId: zonaIds[c.zona]!,
          rutaId: rutaIds[c.zona]!,
          ordenRuta: c.ordenRuta,
          lat: opciones.sinUbicacion ? null : String(c.lat),
          lng: opciones.sinUbicacion ? null : String(c.lng),
          orientacion: opciones.sinUbicacion ? null : c.orientacion,
        })),
        (lote) => Conexion.bulkCreate(lote, tx),
      );
      const conexionIds = new Map((await Conexion.findAll({ attributes: ['id', 'numero'], ...tx })).map((c) => [c.numero, c.id]));

      // Servicios de cada conexión
      await enLotes(
        padron.conexiones.flatMap((c) =>
          c.servicios.map((s) => ({
            conexionId: conexionIds.get(c.numero)!,
            servicio: s.servicio,
            categoria: s.categoria,
            planId: s.plan ? (planPorNombre.get(s.plan) ?? null) : null,
            estado: s.estado,
            fechaAlta: s.fechaAlta,
            fechaBaja: s.fechaBaja,
            tieneSubsidio: s.tieneSubsidio,
          })),
        ),
        (lote) => ServicioConexionModel.bulkCreate(lote, tx),
      );
      const servicioIds = new Map(
        (await ServicioConexionModel.findAll({ attributes: ['id', 'conexionId', 'servicio'], ...tx })).map((s) => [`${s.conexionId}:${s.servicio}`, s.id]),
      );

      // Medidores (incluye los retirados, como historial)
      await enLotes(
        padron.conexiones.flatMap((c) =>
          c.servicios.flatMap((s) =>
            s.medidores.map((m) => ({
              servicioConexionId: servicioIds.get(`${conexionIds.get(c.numero)}:${s.servicio}`)!,
              numero: m.numero,
              tipo: m.tipo,
              factorMult: String(m.factorMult),
              instaladoEl: m.instaladoEl,
              retiradoEl: m.retiradoEl,
            })),
          ),
        ),
        (lote) => Medidor.bulkCreate(lote, tx),
      );

      return { socios: padron.socios.length, conexiones: padron.conexiones.length };
    }),
  );
}

export { PLANES };
