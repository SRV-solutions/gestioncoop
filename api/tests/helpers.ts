import { QueryTypes } from 'sequelize';
import request from 'supertest';
import type { ConfigCooperativa, Rol, TemaCooperativa } from '../src/shared';
import { createApp } from '../src/app';
import { sequelize } from '../src/db';
import { clearCooperativaCache } from '../src/lib/cooperativas';
import { runUnscoped } from '../src/lib/context';
import { hashPassword } from '../src/lib/security';
import { Cooperativa, RolUsuario, Usuario } from '../src/models';

export const PASSWORD = 'clave-de-prueba-123';
let passwordHash: string | null = null;

const tema: TemaCooperativa = {
  colores: { primario: '#2d6a4f', primarioOscuro: '#1b4332', primarioClaro: '#52b788', acento: '#f4a261', fondo: '#f8f5f0' },
  iniciales: 'T',
};
const configBase: ConfigCooperativa = {
  domicilio: 'Calle 1',
  localidad: 'Pueblo',
  provincia: 'Misiones',
  codigoPostal: '3300',
  condicionIva: 'Responsable Inscripto',
  telefonos: [],
  guardias: [],
  servicios: ['energia', 'agua'],
  puntoVenta: 1,
};

export async function createCooperativa(subdominio: string, activa = true): Promise<Cooperativa> {
  return Cooperativa.create({
    subdominio,
    nombre: `Cooperativa ${subdominio}`,
    nombreCorto: `Coop ${subdominio}`,
    cuit: '30000000007',
    temaJson: tema,
    configJson: configBase,
    activa,
  });
}

export async function createUser(opts: {
  cooperativaId: number | null;
  email: string;
  roles: Rol[];
  esDemo?: boolean;
  activo?: boolean;
}): Promise<Usuario> {
  passwordHash ??= await hashPassword(PASSWORD);
  return runUnscoped(async () => {
    const user = await Usuario.create({
      cooperativaId: opts.cooperativaId,
      email: opts.email,
      nombre: `Persona ${opts.email.split('@')[0]}`,
      hash: passwordHash!,
      esDemo: opts.esDemo ?? false,
      activo: opts.activo ?? true,
    });
    await RolUsuario.bulkCreate(opts.roles.map((rol) => ({ usuarioId: user.id, rol })));
    return user;
  });
}

/** Deja la base vacía y crea dos cooperativas con su gente, más un superadmin. */
export async function resetWorld() {
  const tablas = await sequelize.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'migraciones'",
    { type: QueryTypes.SELECT },
  );
  await sequelize.query(`TRUNCATE ${tablas.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  clearCooperativaCache();
  const a = await createCooperativa('coop-a');
  const b = await createCooperativa('coop-b');
  const adminA = await createUser({ cooperativaId: a.id, email: 'admin@a.test', roles: ['admin'] });
  const cajeroA = await createUser({ cooperativaId: a.id, email: 'caja@a.test', roles: ['cajero'] });
  const demoA = await createUser({ cooperativaId: a.id, email: 'demo@a.test', roles: ['gerencia'], esDemo: true });
  const adminB = await createUser({ cooperativaId: b.id, email: 'admin@b.test', roles: ['admin'] });
  const socioB = await createUser({ cooperativaId: b.id, email: 'socio@b.test', roles: ['socio'] });
  const superadmin = await createUser({ cooperativaId: null, email: 'super@proveedor.test', roles: ['superadmin'] });
  return { a, b, adminA, cajeroA, demoA, adminB, socioB, superadmin };
}

export const app = createApp();

/** Navegador de mentira que guarda las cookies entre pedidos. */
export async function loginAs(email: string, password = PASSWORD) {
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`No se pudo ingresar como ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return agent;
}

export { request };
