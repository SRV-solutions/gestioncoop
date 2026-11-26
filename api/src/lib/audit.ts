import type { Transaction } from 'sequelize';
import { Auditoria } from '../models';
import { currentContext, runUnscoped } from './context';
import { sellarAuditoria } from './integridad';

interface AuditEntry {
  /** Qué pasó: `ingresar`, `crear`, `anular_cobro`... */
  accion: string;
  entidad: string;
  entidadId?: string | number | null;
  antes?: unknown;
  despues?: unknown;
  /** Por defecto se toman del pedido en curso. */
  cooperativaId?: number | null;
  usuarioId?: number | null;
  /** Pasarla siempre que haya una: el registro tiene que viajar con el cambio. */
  transaction?: Transaction;
}

/**
 * Deja constancia de quién hizo qué y cuándo. Obligatorio en todo lo que toca dinero,
 * tarifas o padrón (SPEC 6.11). Apenas se confirma la operación, el registro se encadena con el
 * anterior (ver lib/integridad): si después alguien lo cambia o lo borra en la base, se detecta.
 */
export async function writeAudit(entry: AuditEntry): Promise<void> {
  const ctx = currentContext();
  const fila = await runUnscoped(() =>
    Auditoria.create(
      {
        cooperativaId: entry.cooperativaId !== undefined ? entry.cooperativaId : (ctx?.cooperativaId ?? null),
        usuarioId: entry.usuarioId !== undefined ? entry.usuarioId : (ctx?.userId ?? null),
        accion: entry.accion,
        entidad: entry.entidad,
        entidadId: entry.entidadId != null ? String(entry.entidadId) : null,
        antesJson: entry.antes ?? null,
        despuesJson: entry.despues ?? null,
        ip: ctx?.ip ?? null,
      },
      { transaction: entry.transaction },
    ),
  );
  // Si falla el sellado, la operación ya está hecha: queda sin sellar y la verificación lo va a marcar.
  const sellar = () => sellarAuditoria(fila.id, fila.cooperativaId).catch((err: unknown) => console.error(`[INTEGRIDAD] no se pudo sellar el registro ${fila.id}`, err));
  if (entry.transaction) entry.transaction.afterCommit(() => sellar());
  else await sellar();
}
