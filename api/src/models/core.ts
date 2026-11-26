import {
  DataTypes,
  Model,
  type CreationOptional,
  type ForeignKey,
  type InferAttributes,
  type InferCreationAttributes,
  type NonAttribute,
} from 'sequelize';
import type { AvanceTutoriales, ConfigCooperativa, Rol, TemaCooperativa } from '../shared';
import { sequelize } from '../db';

/* ───────────────────────── Cooperativa (el "tenant") ───────────────────────── */

export class Cooperativa extends Model<InferAttributes<Cooperativa>, InferCreationAttributes<Cooperativa>> {
  declare id: CreationOptional<number>;
  declare nombre: string;
  declare nombreCorto: string;
  declare cuit: string;
  declare subdominio: string;
  declare temaJson: TemaCooperativa;
  declare configJson: ConfigCooperativa;
  declare activa: CreationOptional<boolean>;
  declare creadoEl: CreationOptional<Date>;
  declare actualizadoEl: CreationOptional<Date>;
}

Cooperativa.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    nombre: { type: DataTypes.STRING(200), allowNull: false },
    nombreCorto: { type: DataTypes.STRING(80), allowNull: false },
    cuit: { type: DataTypes.STRING(11), allowNull: false },
    subdominio: { type: DataTypes.STRING(60), allowNull: false, unique: true },
    temaJson: { type: DataTypes.JSONB, allowNull: false },
    configJson: { type: DataTypes.JSONB, allowNull: false },
    activa: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    creadoEl: DataTypes.DATE,
    actualizadoEl: DataTypes.DATE,
  },
  { sequelize, tableName: 'cooperativas' },
);

/* ───────────────────────── Usuario y roles ───────────────────────── */

export class Usuario extends Model<InferAttributes<Usuario>, InferCreationAttributes<Usuario>> {
  declare id: CreationOptional<number>;
  /** `null` solo para el superadmin (usuario del proveedor, no pertenece a ninguna cooperativa). */
  declare cooperativaId: ForeignKey<Cooperativa['id']> | null;
  /** `null` en los socios: entran con los datos de su factura, sin email ni contraseña. */
  declare email: string | null;
  declare hash: string;
  declare nombre: string;
  declare activo: CreationOptional<boolean>;
  /** Usuario de prueba: solo puede entrar con DEMO_MODE=true. */
  declare esDemo: CreationOptional<boolean>;
  declare ultimoIngresoEl: CreationOptional<Date | null>;
  /** Tutoriales que hizo u omitió. `null` hasta que toca el primero. */
  declare tutorialesJson: CreationOptional<AvanceTutoriales | null>;
  declare creadoEl: CreationOptional<Date>;
  declare actualizadoEl: CreationOptional<Date>;

  declare roles?: NonAttribute<RolUsuario[]>;

  get rolesList(): NonAttribute<Rol[]> {
    return (this.roles ?? []).map((r) => r.rol);
  }
}

Usuario.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    cooperativaId: { type: DataTypes.INTEGER, allowNull: true },
    email: {
      type: DataTypes.STRING(200),
      allowNull: true,
      set(value: string | null) {
        this.setDataValue('email', value === null ? null : value.trim().toLowerCase());
      },
    },
    hash: { type: DataTypes.STRING(255), allowNull: false },
    nombre: { type: DataTypes.STRING(160), allowNull: false },
    activo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    esDemo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    ultimoIngresoEl: { type: DataTypes.DATE, allowNull: true },
    tutorialesJson: { type: DataTypes.JSONB, allowNull: true },
    creadoEl: DataTypes.DATE,
    actualizadoEl: DataTypes.DATE,
  },
  { sequelize, tableName: 'usuarios' },
);

export class RolUsuario extends Model<InferAttributes<RolUsuario>, InferCreationAttributes<RolUsuario>> {
  declare usuarioId: ForeignKey<Usuario['id']>;
  declare rol: Rol;
}

RolUsuario.init(
  {
    usuarioId: { type: DataTypes.INTEGER, primaryKey: true },
    rol: { type: DataTypes.STRING(20), primaryKey: true },
  },
  { sequelize, tableName: 'roles_usuario', timestamps: false },
);

/* ───────────────────────── Sesión (token de renovación) ───────────────────────── */

export class Sesion extends Model<InferAttributes<Sesion>, InferCreationAttributes<Sesion>> {
  declare id: CreationOptional<string>;
  declare usuarioId: ForeignKey<Usuario['id']>;
  /** SHA-256 del token de renovación. El token en claro solo vive en la cookie del navegador. */
  declare tokenHash: string;
  /** Para el superadmin: la cooperativa en la que eligió trabajar. */
  declare cooperativaActivaId: CreationOptional<number | null>;
  declare expiraEl: Date;
  declare revocadaEl: CreationOptional<Date | null>;
  declare usadoEl: CreationOptional<Date | null>;
  declare userAgent: CreationOptional<string | null>;
  declare ip: CreationOptional<string | null>;
  declare creadoEl: CreationOptional<Date>;
}

Sesion.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    usuarioId: { type: DataTypes.INTEGER, allowNull: false },
    tokenHash: { type: DataTypes.STRING(64), allowNull: false },
    cooperativaActivaId: { type: DataTypes.INTEGER, allowNull: true },
    expiraEl: { type: DataTypes.DATE, allowNull: false },
    revocadaEl: { type: DataTypes.DATE, allowNull: true },
    usadoEl: { type: DataTypes.DATE, allowNull: true },
    userAgent: { type: DataTypes.STRING(300), allowNull: true },
    ip: { type: DataTypes.STRING(64), allowNull: true },
    creadoEl: DataTypes.DATE,
  },
  { sequelize, tableName: 'sesiones', updatedAt: false },
);

/* ───────────────────────── Auditoría ───────────────────────── */

export class Auditoria extends Model<InferAttributes<Auditoria>, InferCreationAttributes<Auditoria>> {
  declare id: CreationOptional<number>;
  declare cooperativaId: number | null;
  declare usuarioId: number | null;
  declare accion: string;
  declare entidad: string;
  declare entidadId: string | null;
  declare antesJson: unknown;
  declare despuesJson: unknown;
  declare ip: string | null;
  declare creadoEl: CreationOptional<Date>;
}

Auditoria.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    cooperativaId: { type: DataTypes.INTEGER, allowNull: true },
    usuarioId: { type: DataTypes.INTEGER, allowNull: true },
    accion: { type: DataTypes.STRING(80), allowNull: false },
    entidad: { type: DataTypes.STRING(80), allowNull: false },
    entidadId: { type: DataTypes.STRING(80), allowNull: true },
    antesJson: { type: DataTypes.JSONB, allowNull: true },
    despuesJson: { type: DataTypes.JSONB, allowNull: true },
    ip: { type: DataTypes.STRING(64), allowNull: true },
    creadoEl: DataTypes.DATE,
  },
  { sequelize, tableName: 'auditoria', updatedAt: false },
);

/* ───────────────────────── Imagen de la cooperativa ───────────────────────── */

/** Logo o foto que carga la propia cooperativa. Una por cooperativa. */
export const TIPOS_IMAGEN = ['isotipo', 'factura'] as const;
export type TipoImagen = (typeof TIPOS_IMAGEN)[number];

/** Imágenes de la cooperativa: el isotipo cuadrado (app) y el logo de la factura (con sus proporciones). */
export class CooperativaImagen extends Model<InferAttributes<CooperativaImagen>, InferCreationAttributes<CooperativaImagen>> {
  declare cooperativaId: number;
  declare tipo: TipoImagen;
  declare mime: string;
  declare contenido: Buffer;
  declare creadoEl: CreationOptional<Date>;
  declare actualizadoEl: CreationOptional<Date>;
}

CooperativaImagen.init(
  {
    cooperativaId: { type: DataTypes.INTEGER, primaryKey: true },
    tipo: { type: DataTypes.STRING(20), primaryKey: true },
    mime: { type: DataTypes.STRING(40), allowNull: false },
    contenido: { type: DataTypes.BLOB, allowNull: false },
    creadoEl: DataTypes.DATE,
    actualizadoEl: DataTypes.DATE,
  },
  { sequelize, tableName: 'cooperativa_imagenes' },
);

/* ───────────────────────── Comisión de SRV ───────────────────────── */

/** Lo que SRV cobra por cada factura que emite la cooperativa, desde una fecha. */
export class ComisionSrv extends Model<InferAttributes<ComisionSrv>, InferCreationAttributes<ComisionSrv>> {
  declare id: CreationOptional<number>;
  declare cooperativaId: number;
  declare desde: string;
  declare porcentaje: string;
  declare fijoPorFactura: CreationOptional<string>;
  declare nota: CreationOptional<string | null>;
  declare cargadoPor: CreationOptional<number | null>;
  declare creadoEl: CreationOptional<Date>;
  declare actualizadoEl: CreationOptional<Date>;
}

ComisionSrv.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    cooperativaId: { type: DataTypes.INTEGER, allowNull: false },
    desde: { type: DataTypes.DATEONLY, allowNull: false },
    porcentaje: { type: DataTypes.DECIMAL(6, 3), allowNull: false },
    fijoPorFactura: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    nota: { type: DataTypes.STRING(200), allowNull: true },
    cargadoPor: { type: DataTypes.INTEGER, allowNull: true },
    creadoEl: DataTypes.DATE,
    actualizadoEl: DataTypes.DATE,
  },
  { sequelize, tableName: 'comisiones_srv' },
);

/* ───────────────────────── Relaciones ───────────────────────── */

Cooperativa.hasMany(Usuario, { foreignKey: 'cooperativaId', as: 'usuarios' });
Usuario.belongsTo(Cooperativa, { foreignKey: 'cooperativaId', as: 'cooperativa' });
Usuario.hasMany(RolUsuario, { foreignKey: 'usuarioId', as: 'roles', onDelete: 'CASCADE' });
RolUsuario.belongsTo(Usuario, { foreignKey: 'usuarioId', as: 'usuario' });
Usuario.hasMany(Sesion, { foreignKey: 'usuarioId', as: 'sesiones', onDelete: 'CASCADE' });
Sesion.belongsTo(Usuario, { foreignKey: 'usuarioId', as: 'usuario' });
ComisionSrv.belongsTo(Usuario, { foreignKey: 'cargadoPor', as: 'cargador' });
