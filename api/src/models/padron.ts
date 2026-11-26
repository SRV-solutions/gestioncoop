// Padrón (Fase 1): socios, zonas, rutas, conexiones, planes, servicios por conexión, medidores y sepelio.
import {
  DataTypes,
  Model,
  type CreationOptional,
  type ForeignKey,
  type InferAttributes,
  type InferCreationAttributes,
  type NonAttribute,
} from 'sequelize';
import { normalizeText, type Categoria, type CondicionIva, type EstadoServicio, type ServicioConexion, type TipoZona } from '../shared';
import { sequelize } from '../db';
import { Usuario } from './core';

const id = { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true } as const;
const cooperativaId = { type: DataTypes.INTEGER, allowNull: false } as const;

/* ───────────────────────── Socio ───────────────────────── */

export class Socio extends Model<InferAttributes<Socio>, InferCreationAttributes<Socio>> {
  declare id: CreationOptional<number>;
  declare cooperativaId: CreationOptional<number>;
  declare numero: number;
  declare tipoDoc: 'DNI' | 'CUIT';
  declare nroDoc: string;
  /** "Apellido, Nombres" para personas; razón social para empresas y entidades. */
  declare nombre: string;
  declare nombreNorm: CreationOptional<string>;
  declare condicionIva: CondicionIva;
  declare email: CreationOptional<string | null>;
  declare telefono: CreationOptional<string | null>;
  declare estado: CreationOptional<'activo' | 'baja'>;
  declare usuarioId: CreationOptional<ForeignKey<Usuario['id']> | null>;
  /** Adherido a la factura digital: deja de recibirla en papel. */
  declare facturaDigital: CreationOptional<boolean>;
  declare creadoEl: CreationOptional<Date>;
  declare actualizadoEl: CreationOptional<Date>;
  declare eliminadoEl: CreationOptional<Date | null>;

  declare conexiones?: NonAttribute<Conexion[]>;
  declare beneficiarios?: NonAttribute<BeneficiarioSepelio[]>;
}

Socio.init(
  {
    id,
    cooperativaId,
    numero: { type: DataTypes.INTEGER, allowNull: false },
    tipoDoc: { type: DataTypes.STRING(4), allowNull: false },
    nroDoc: { type: DataTypes.STRING(11), allowNull: false },
    nombre: {
      type: DataTypes.STRING(160),
      allowNull: false,
      set(value: string) {
        this.setDataValue('nombre', value.trim());
        this.setDataValue('nombreNorm', normalizeText(value));
      },
    },
    nombreNorm: { type: DataTypes.STRING(160), allowNull: false },
    condicionIva: { type: DataTypes.STRING(24), allowNull: false },
    email: { type: DataTypes.STRING(200), allowNull: true },
    telefono: { type: DataTypes.STRING(40), allowNull: true },
    estado: { type: DataTypes.STRING(12), allowNull: false, defaultValue: 'activo' },
    usuarioId: { type: DataTypes.INTEGER, allowNull: true },
    facturaDigital: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    creadoEl: DataTypes.DATE,
    actualizadoEl: DataTypes.DATE,
    eliminadoEl: DataTypes.DATE,
  },
  // Borrado lógico: en el padrón nada se borra de verdad (SPEC sección 8).
  { sequelize, tableName: 'socios', paranoid: true, deletedAt: 'eliminadoEl' },
);

/* ───────────────────────── Zona y ruta de lectura ───────────────────────── */

export class Zona extends Model<InferAttributes<Zona>, InferCreationAttributes<Zona>> {
  declare id: CreationOptional<number>;
  declare cooperativaId: CreationOptional<number>;
  declare nombre: string;
  declare tipo: TipoZona;
  declare poligonoGeojson: CreationOptional<object | null>;
  declare creadoEl: CreationOptional<Date>;
  declare actualizadoEl: CreationOptional<Date>;
}

Zona.init(
  {
    id,
    cooperativaId,
    nombre: { type: DataTypes.STRING(80), allowNull: false },
    tipo: { type: DataTypes.STRING(8), allowNull: false },
    poligonoGeojson: { type: DataTypes.JSONB, allowNull: true },
    creadoEl: DataTypes.DATE,
    actualizadoEl: DataTypes.DATE,
  },
  { sequelize, tableName: 'zonas' },
);

export class Ruta extends Model<InferAttributes<Ruta>, InferCreationAttributes<Ruta>> {
  declare id: CreationOptional<number>;
  declare cooperativaId: CreationOptional<number>;
  declare zonaId: ForeignKey<Zona['id']>;
  declare nombre: string;
  declare operarioId: CreationOptional<ForeignKey<Usuario['id']> | null>;
  declare creadoEl: CreationOptional<Date>;
  declare actualizadoEl: CreationOptional<Date>;
}

Ruta.init(
  {
    id,
    cooperativaId,
    zonaId: { type: DataTypes.INTEGER, allowNull: false },
    nombre: { type: DataTypes.STRING(80), allowNull: false },
    operarioId: { type: DataTypes.INTEGER, allowNull: true },
    creadoEl: DataTypes.DATE,
    actualizadoEl: DataTypes.DATE,
  },
  { sequelize, tableName: 'rutas' },
);

/* ───────────────────────── Conexión (suministro) ───────────────────────── */

export class Conexion extends Model<InferAttributes<Conexion>, InferCreationAttributes<Conexion>> {
  declare id: CreationOptional<number>;
  declare cooperativaId: CreationOptional<number>;
  declare socioId: ForeignKey<Socio['id']>;
  declare numero: number;
  declare direccion: string;
  declare direccionNorm: CreationOptional<string>;
  declare zonaId: CreationOptional<ForeignKey<Zona['id']> | null>;
  declare rutaId: CreationOptional<ForeignKey<Ruta['id']> | null>;
  declare ordenRuta: CreationOptional<number | null>;
  /** DECIMAL: Postgres lo devuelve como texto. */
  declare lat: CreationOptional<string | null>;
  declare lng: CreationOptional<string | null>;
  declare orientacion: CreationOptional<number | null>;
  declare creadoEl: CreationOptional<Date>;
  declare actualizadoEl: CreationOptional<Date>;
  declare eliminadoEl: CreationOptional<Date | null>;

  declare socio?: NonAttribute<Socio>;
  declare zona?: NonAttribute<Zona | null>;
  declare ruta?: NonAttribute<Ruta | null>;
  declare servicios?: NonAttribute<ServicioConexionModel[]>;
}

Conexion.init(
  {
    id,
    cooperativaId,
    socioId: { type: DataTypes.INTEGER, allowNull: false },
    numero: { type: DataTypes.INTEGER, allowNull: false },
    direccion: {
      type: DataTypes.STRING(200),
      allowNull: false,
      set(value: string) {
        this.setDataValue('direccion', value.trim());
        this.setDataValue('direccionNorm', normalizeText(value));
      },
    },
    direccionNorm: { type: DataTypes.STRING(200), allowNull: false },
    zonaId: { type: DataTypes.INTEGER, allowNull: true },
    rutaId: { type: DataTypes.INTEGER, allowNull: true },
    ordenRuta: { type: DataTypes.INTEGER, allowNull: true },
    lat: { type: DataTypes.DECIMAL(9, 6), allowNull: true },
    lng: { type: DataTypes.DECIMAL(9, 6), allowNull: true },
    orientacion: { type: DataTypes.SMALLINT, allowNull: true },
    creadoEl: DataTypes.DATE,
    actualizadoEl: DataTypes.DATE,
    eliminadoEl: DataTypes.DATE,
  },
  { sequelize, tableName: 'conexiones', paranoid: true, deletedAt: 'eliminadoEl' },
);

/* ───────────────────────── Planes (internet y TV) ───────────────────────── */

export class Plan extends Model<InferAttributes<Plan>, InferCreationAttributes<Plan>> {
  declare id: CreationOptional<number>;
  declare cooperativaId: CreationOptional<number>;
  declare servicio: ServicioConexion;
  declare nombre: string;
  declare precio: string;
  declare activo: CreationOptional<boolean>;
  declare creadoEl: CreationOptional<Date>;
  declare actualizadoEl: CreationOptional<Date>;
}

Plan.init(
  {
    id,
    cooperativaId,
    servicio: { type: DataTypes.STRING(12), allowNull: false },
    nombre: { type: DataTypes.STRING(80), allowNull: false },
    precio: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
    activo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    creadoEl: DataTypes.DATE,
    actualizadoEl: DataTypes.DATE,
  },
  { sequelize, tableName: 'planes' },
);

/* ───────────────────────── Servicio de una conexión y su medidor ───────────────────────── */

export class ServicioConexionModel extends Model<
  InferAttributes<ServicioConexionModel>,
  InferCreationAttributes<ServicioConexionModel>
> {
  declare id: CreationOptional<number>;
  declare cooperativaId: CreationOptional<number>;
  declare conexionId: ForeignKey<Conexion['id']>;
  declare servicio: ServicioConexion;
  declare categoria: CreationOptional<Categoria | null>;
  declare planId: CreationOptional<ForeignKey<Plan['id']> | null>;
  declare estado: CreationOptional<EstadoServicio>;
  declare fechaAlta: string;
  declare fechaBaja: CreationOptional<string | null>;
  declare tieneSubsidio: CreationOptional<boolean>;
  declare creadoEl: CreationOptional<Date>;
  declare actualizadoEl: CreationOptional<Date>;

  declare plan?: NonAttribute<Plan | null>;
  declare medidores?: NonAttribute<Medidor[]>;
}

ServicioConexionModel.init(
  {
    id,
    cooperativaId,
    conexionId: { type: DataTypes.INTEGER, allowNull: false },
    servicio: { type: DataTypes.STRING(12), allowNull: false },
    categoria: { type: DataTypes.STRING(16), allowNull: true },
    planId: { type: DataTypes.INTEGER, allowNull: true },
    estado: { type: DataTypes.STRING(12), allowNull: false, defaultValue: 'activo' },
    fechaAlta: { type: DataTypes.DATEONLY, allowNull: false },
    fechaBaja: { type: DataTypes.DATEONLY, allowNull: true },
    tieneSubsidio: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    creadoEl: DataTypes.DATE,
    actualizadoEl: DataTypes.DATE,
  },
  { sequelize, modelName: 'ServicioConexion', tableName: 'servicios_conexion' },
);

export class Medidor extends Model<InferAttributes<Medidor>, InferCreationAttributes<Medidor>> {
  declare id: CreationOptional<number>;
  declare cooperativaId: CreationOptional<number>;
  declare servicioConexionId: ForeignKey<ServicioConexionModel['id']>;
  declare numero: string;
  declare tipo: string;
  declare factorMult: CreationOptional<string>;
  /** Dígitos del contador (para la vuelta de contador). */
  declare digitos: CreationOptional<number>;
  declare instaladoEl: string;
  /** Con fecha = ya no está colocado (queda como historial de cambios de medidor). */
  declare retiradoEl: CreationOptional<string | null>;
  declare creadoEl: CreationOptional<Date>;
  declare actualizadoEl: CreationOptional<Date>;
}

Medidor.init(
  {
    id,
    cooperativaId,
    servicioConexionId: { type: DataTypes.INTEGER, allowNull: false },
    numero: { type: DataTypes.STRING(20), allowNull: false },
    tipo: { type: DataTypes.STRING(40), allowNull: false },
    factorMult: { type: DataTypes.DECIMAL(8, 2), allowNull: false, defaultValue: '1' },
    digitos: { type: DataTypes.SMALLINT, allowNull: false, defaultValue: 5 },
    instaladoEl: { type: DataTypes.DATEONLY, allowNull: false },
    retiradoEl: { type: DataTypes.DATEONLY, allowNull: true },
    creadoEl: DataTypes.DATE,
    actualizadoEl: DataTypes.DATE,
  },
  { sequelize, tableName: 'medidores' },
);

/* ───────────────────────── Sepelio ───────────────────────── */

export class BeneficiarioSepelio extends Model<
  InferAttributes<BeneficiarioSepelio>,
  InferCreationAttributes<BeneficiarioSepelio>
> {
  declare id: CreationOptional<number>;
  declare cooperativaId: CreationOptional<number>;
  declare socioId: ForeignKey<Socio['id']>;
  declare nombre: string;
  declare nroDoc: string;
  declare parentesco: string;
  declare altaEl: string;
  declare creadoEl: CreationOptional<Date>;
  declare actualizadoEl: CreationOptional<Date>;
}

BeneficiarioSepelio.init(
  {
    id,
    cooperativaId,
    socioId: { type: DataTypes.INTEGER, allowNull: false },
    nombre: { type: DataTypes.STRING(160), allowNull: false },
    nroDoc: { type: DataTypes.STRING(11), allowNull: false },
    parentesco: { type: DataTypes.STRING(24), allowNull: false },
    altaEl: { type: DataTypes.DATEONLY, allowNull: false },
    creadoEl: DataTypes.DATE,
    actualizadoEl: DataTypes.DATE,
  },
  { sequelize, tableName: 'beneficiarios_sepelio' },
);

/* ───────────────────────── Relaciones ───────────────────────── */

Socio.hasMany(Conexion, { foreignKey: 'socioId', as: 'conexiones' });
Conexion.belongsTo(Socio, { foreignKey: 'socioId', as: 'socio' });
Socio.hasMany(BeneficiarioSepelio, { foreignKey: 'socioId', as: 'beneficiarios' });
Socio.belongsTo(Usuario, { foreignKey: 'usuarioId', as: 'usuario' });

Zona.hasMany(Ruta, { foreignKey: 'zonaId', as: 'rutas' });
Ruta.belongsTo(Zona, { foreignKey: 'zonaId', as: 'zona' });
Ruta.belongsTo(Usuario, { foreignKey: 'operarioId', as: 'operario' });
Conexion.belongsTo(Zona, { foreignKey: 'zonaId', as: 'zona' });
Conexion.belongsTo(Ruta, { foreignKey: 'rutaId', as: 'ruta' });

Conexion.hasMany(ServicioConexionModel, { foreignKey: 'conexionId', as: 'servicios' });
ServicioConexionModel.belongsTo(Conexion, { foreignKey: 'conexionId', as: 'conexion' });
ServicioConexionModel.belongsTo(Plan, { foreignKey: 'planId', as: 'plan' });
ServicioConexionModel.hasMany(Medidor, { foreignKey: 'servicioConexionId', as: 'medidores' });
Medidor.belongsTo(ServicioConexionModel, { foreignKey: 'servicioConexionId', as: 'servicio' });
