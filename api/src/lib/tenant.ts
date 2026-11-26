import { Op, type Model, type ModelStatic } from 'sequelize';
import { currentContext } from './context';
import { noCooperativa } from './errors';

/**
 * Aislamiento entre cooperativas a nivel de modelo.
 *
 * Todo modelo de negocio (los que tienen `cooperativa_id`) se registra con `scopeByCooperativa`.
 * Desde ahí, cualquier lectura o escritura sobre ese modelo:
 *   - se filtra sola por la cooperativa del pedido en curso;
 *   - falla si no hay contexto (falla cerrado: mejor un error que una fuga de datos);
 *   - falla si intenta escribir una fila de otra cooperativa.
 *
 * Límites conocidos (reglas para quien escriba código nuevo):
 *   - `sequelize.query()` crudo NO pasa por acá: usar siempre `:cooperativaId` en el SQL.
 *   - Un modelo traído con `include` no dispara su propio filtro; queda protegido porque su padre
 *     sí está filtrado y las claves foráneas nunca cruzan cooperativas.
 *   - No usar `{ hooks: false }` sobre estos modelos.
 */
export class TenantIsolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantIsolationError';
  }
}

type WithWhere = { where?: unknown };
type TenantRow = Model & { cooperativaId: number | null };

/** Cooperativa a aplicar, o `null` si el contexto corre sin restricción. */
function requiredCooperativa(modelName: string): number | null {
  const ctx = currentContext();
  if (!ctx) {
    throw new TenantIsolationError(`Acceso a "${modelName}" fuera de un contexto de cooperativa. Usá runInCooperativa() o runUnscoped().`);
  }
  if (ctx.unscoped) return null;
  if (ctx.cooperativaId == null) throw noCooperativa();
  return ctx.cooperativaId;
}

/**
 * Cooperativa del pedido en curso, para las consultas en SQL crudo (que no pasan por el filtro
 * automático): `WHERE cooperativa_id = :cooperativaId`. Falla si el pedido no tiene cooperativa.
 */
export function requireCooperativaId(): number {
  const ctx = currentContext();
  if (!ctx) throw new TenantIsolationError('Consulta fuera de un contexto de cooperativa.');
  if (ctx.cooperativaId == null) throw noCooperativa();
  return ctx.cooperativaId;
}

/**
 * Agrega el filtro por cooperativa. Va con el nombre de la COLUMNA y no el del atributo: en los
 * borrados masivos Sequelize ya tradujo los nombres antes de llamar al hook y no vuelve a hacerlo.
 */
function restrict(options: WithWhere, column: string, cooperativaId: number): void {
  const filter = { [column]: cooperativaId };
  options.where = options.where ? { [Op.and]: [options.where, filter] } : filter;
}

function checkRow(modelName: string, row: TenantRow, cooperativaId: number): void {
  if (row.isNewRecord && row.cooperativaId == null) {
    row.cooperativaId = cooperativaId;
    return;
  }
  const moved = !row.isNewRecord && row.changed('cooperativaId' as never);
  if (row.cooperativaId !== cooperativaId || moved) {
    throw new TenantIsolationError(`Intento de escribir en "${modelName}" una fila de otra cooperativa.`);
  }
}

export function scopeByCooperativa(model: ModelStatic<Model>): void {
  const name = model.name;
  const column = (model.getAttributes() as Record<string, { field?: string }>).cooperativaId?.field;
  if (!column) throw new Error(`El modelo "${name}" no tiene cooperativaId y no se puede aislar.`);

  const onRead = (options: WithWhere) => {
    const id = requiredCooperativa(name);
    if (id != null) restrict(options, column, id);
  };
  const onWriteRow = (row: Model) => {
    const id = requiredCooperativa(name);
    if (id != null) checkRow(name, row as TenantRow, id);
  };

  model.addHook('beforeFind', 'tenant', onRead);
  model.addHook('beforeCount', 'tenant', onRead);
  model.addHook('beforeBulkDestroy', 'tenant', onRead);
  model.addHook('beforeBulkRestore', 'tenant', onRead);
  model.addHook('beforeBulkUpdate', 'tenant', (options) => {
    const id = requiredCooperativa(name);
    if (id == null) return;
    const values = (options as { attributes?: Record<string, unknown> }).attributes;
    if (values && 'cooperativaId' in values && values.cooperativaId !== id) {
      throw new TenantIsolationError(`Intento de mover filas de "${name}" a otra cooperativa.`);
    }
    restrict(options, column, id);
  });

  model.addHook('beforeValidate', 'tenant', onWriteRow);
  model.addHook('beforeSave', 'tenant', onWriteRow);
  model.addHook('beforeDestroy', 'tenant', onWriteRow);
  model.addHook('beforeBulkCreate', 'tenant', (rows) => {
    const id = requiredCooperativa(name);
    if (id != null) for (const row of rows) checkRow(name, row as TenantRow, id);
  });
  model.addHook('beforeUpsert', 'tenant', (attributes: unknown) => {
    const values = attributes as Record<string, unknown>;
    const id = requiredCooperativa(name);
    if (id == null) return;
    if (values.cooperativaId == null) values.cooperativaId = id;
    else if (values.cooperativaId !== id) {
      throw new TenantIsolationError(`Intento de escribir en "${name}" una fila de otra cooperativa.`);
    }
  });

  // sum/min/max no disparan beforeFind: se cubren envolviendo aggregate().
  type Aggregate = (field: unknown, fn: unknown, options?: WithWhere) => unknown;
  const target = model as unknown as { aggregate: Aggregate };
  const originalAggregate = target.aggregate.bind(model);
  target.aggregate = (field, fn, options = {}) => {
    const id = requiredCooperativa(name);
    if (id != null) restrict(options, column, id);
    return originalAggregate(field, fn, options);
  };
}
