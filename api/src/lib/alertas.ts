// Alertas al personal y a SRV: una fila por persona (la campana de la app) y un mail a cada una.
import { QueryTypes } from 'sequelize';
import type { Rol } from '../shared';
import { config } from '../config';
import { sequelize } from '../db';
import { Alerta, Cooperativa } from '../models';
import { esDireccionDePrueba, proveedorCorreo, type ResultadoCorreo } from '../proveedores/correo';
import { runInCooperativa } from './context';

export interface NuevaAlerta {
  /** `integridad`, `integridad_fallida`, `arca`… */
  tipo: string;
  titulo: string;
  cuerpo: string;
  /** Pantalla de la app donde se ve el detalle (`/integridad`). */
  enlace?: string | null;
}

export interface Destinatarios {
  /** Personal de la cooperativa con alguno de estos roles. */
  roles: Rol[];
  /** También la gente de SRV (todos los superadmin). */
  srv: boolean;
}

/** Deja la alerta en la campana de cada destinatario y le manda un mail. Devuelve a cuántas personas llegó. */
export async function alertar(cooperativaId: number, destinatarios: Destinatarios, alerta: NuevaAlerta): Promise<number> {
  const personas = await sequelize.query<{ id: number; email: string | null; es_demo: boolean }>(
    `SELECT u.id, u.email, u.es_demo FROM usuarios u
     WHERE u.activo AND (
       (u.cooperativa_id = $cooperativaId AND EXISTS (SELECT 1 FROM roles_usuario r WHERE r.usuario_id = u.id AND r.rol = ANY($roles)))
       OR ($srv AND u.cooperativa_id IS NULL AND EXISTS (SELECT 1 FROM roles_usuario r WHERE r.usuario_id = u.id AND r.rol = 'superadmin'))
     )
     ORDER BY u.id`,
    { bind: { cooperativaId, roles: destinatarios.roles, srv: destinatarios.srv }, type: QueryTypes.SELECT },
  );
  if (personas.length === 0) return 0;

  const coop = await Cooperativa.findByPk(cooperativaId, { attributes: ['nombreCorto'] });
  const enlace = alerta.enlace ? `${config.appUrl}${alerta.enlace}` : null;
  const texto = [alerta.cuerpo, enlace ? `Ver el detalle: ${enlace}` : null, '—\nGestiónCoop · aviso automático'].filter(Boolean).join('\n\n');
  // A los usuarios de prueba y a las direcciones inventadas no se les manda nada.
  const conCorreo = personas.filter((p) => p.email && !p.es_demo && !esDireccionDePrueba(p.email));
  const resultados = await proveedorCorreo.enviarLote(
    conCorreo.map((p) => ({ para: p.email!, asunto: `[GestiónCoop] ${alerta.titulo} · ${coop?.nombreCorto ?? 'Cooperativa'}`, texto })),
  );
  const resultadoDe = new Map<number, ResultadoCorreo>(conCorreo.map((p, i) => [p.id, resultados[i]!]));

  await runInCooperativa(cooperativaId, () =>
    Alerta.bulkCreate(
      personas.map((p) => {
        const r = resultadoDe.get(p.id);
        return {
          cooperativaId,
          usuarioId: p.id,
          tipo: alerta.tipo,
          titulo: alerta.titulo.slice(0, 160),
          cuerpo: alerta.cuerpo,
          enlace: alerta.enlace ?? null,
          correoDestino: r ? p.email : null,
          correoEstado: r ? r.estado : 'sin_correo',
          correoError: r?.error ?? null,
        };
      }),
    ),
  );
  return personas.length;
}
