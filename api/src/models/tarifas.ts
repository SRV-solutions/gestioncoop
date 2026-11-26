// Tarifas (Fase 2): cuadros tarifarios versionados, escalones y conceptos configurables.
import {
  DataTypes,
  Model,
  type CreationOptional,
  type ForeignKey,
  type InferAttributes,
  type InferCreationAttributes,
  type NonAttribute,
} from 'sequelize';
import type { BaseConcepto, Categoria, CondicionIva, GrupoConcepto, ServicioConCuadro, ServicioConexion, TipoConcepto } from '../shared';
import { sequelize } from '../db';

const id = { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true } as const;
const cooperativaId = { type: DataTypes.INTEGER, allowNull: false } as const;

/** Cuota fija + escalones de un servicio y una categoría, entre dos fechas. No se edita: se versiona. */
export class CuadroTarifario extends Model<InferAttributes<CuadroTarifario>, InferCreationAttributes<CuadroTarifario>> {
  declare id: CreationOptional<number>;
  declare cooperativaId: CreationOptional<number>;
  declare servicio: ServicioConCuadro;
  declare categoria: CreationOptional<Categoria | null>;
  declare conSubsidio: CreationOptional<boolean>;
  declare vigenteDesde: string;
  /** Último día en que rige. */
  declare vigenteHasta: CreationOptional<string | null>;
  /** DECIMAL: Postgres lo devuelve como texto. */
  declare cargoFijo: string;
  declare nota: CreationOptional<string | null>;
  declare creadoPor: CreationOptional<number | null>;
  declare creadoEl: CreationOptional<Date>;
  declare actualizadoEl: CreationOptional<Date>;

  declare escalones?: NonAttribute<Escalon[]>;
}

CuadroTarifario.init(
  {
    id,
    cooperativaId,
    servicio: { type: DataTypes.STRING(12), allowNull: false },
    categoria: { type: DataTypes.STRING(16), allowNull: true },
    conSubsidio: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    vigenteDesde: { type: DataTypes.DATEONLY, allowNull: false },
    vigenteHasta: { type: DataTypes.DATEONLY, allowNull: true },
    cargoFijo: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
    nota: { type: DataTypes.STRING(200), allowNull: true },
    creadoPor: { type: DataTypes.INTEGER, allowNull: true },
    creadoEl: DataTypes.DATE,
    actualizadoEl: DataTypes.DATE,
  },
  { sequelize, tableName: 'cuadros_tarifarios' },
);

export class Escalon extends Model<InferAttributes<Escalon>, InferCreationAttributes<Escalon>> {
  declare id: CreationOptional<number>;
  declare cooperativaId: CreationOptional<number>;
  declare cuadroId: ForeignKey<CuadroTarifario['id']>;
  declare desde: string;
  declare hasta: CreationOptional<string | null>;
  declare precioUnitario: string;
  declare subsidiado: CreationOptional<boolean>;
  declare exentoDe: CreationOptional<string[]>;
  declare creadoEl: CreationOptional<Date>;
  declare actualizadoEl: CreationOptional<Date>;
}

Escalon.init(
  {
    id,
    cooperativaId,
    cuadroId: { type: DataTypes.INTEGER, allowNull: false },
    desde: { type: DataTypes.DECIMAL(12, 4), allowNull: false },
    hasta: { type: DataTypes.DECIMAL(12, 4), allowNull: true },
    precioUnitario: { type: DataTypes.DECIMAL(14, 4), allowNull: false },
    subsidiado: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    exentoDe: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    creadoEl: DataTypes.DATE,
    actualizadoEl: DataTypes.DATE,
  },
  { sequelize, tableName: 'escalones' },
);

/** Impuesto, tasa o cargo. Cambiar el valor = otra fila con el mismo código y otra vigencia. */
export class Concepto extends Model<InferAttributes<Concepto>, InferCreationAttributes<Concepto>> {
  declare id: CreationOptional<number>;
  declare cooperativaId: CreationOptional<number>;
  declare codigo: string;
  declare nombre: string;
  declare tipo: TipoConcepto;
  declare valor: string;
  declare base: CreationOptional<BaseConcepto | null>;
  declare grupo: GrupoConcepto;
  declare aplicaA: CreationOptional<ServicioConexion | null>;
  declare categorias: CreationOptional<Categoria[] | null>;
  declare condicionesIva: CreationOptional<CondicionIva[] | null>;
  declare orden: CreationOptional<number>;
  declare vigenteDesde: string;
  declare vigenteHasta: CreationOptional<string | null>;
  declare creadoPor: CreationOptional<number | null>;
  declare creadoEl: CreationOptional<Date>;
  declare actualizadoEl: CreationOptional<Date>;
}

Concepto.init(
  {
    id,
    cooperativaId,
    codigo: { type: DataTypes.STRING(24), allowNull: false },
    nombre: { type: DataTypes.STRING(80), allowNull: false },
    tipo: { type: DataTypes.STRING(12), allowNull: false },
    valor: { type: DataTypes.DECIMAL(16, 6), allowNull: false },
    base: { type: DataTypes.STRING(12), allowNull: true },
    grupo: { type: DataTypes.STRING(12), allowNull: false },
    aplicaA: { type: DataTypes.STRING(12), allowNull: true },
    categorias: { type: DataTypes.JSONB, allowNull: true },
    condicionesIva: { type: DataTypes.JSONB, allowNull: true },
    orden: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 100 },
    vigenteDesde: { type: DataTypes.DATEONLY, allowNull: false },
    vigenteHasta: { type: DataTypes.DATEONLY, allowNull: true },
    creadoPor: { type: DataTypes.INTEGER, allowNull: true },
    creadoEl: DataTypes.DATE,
    actualizadoEl: DataTypes.DATE,
  },
  { sequelize, tableName: 'conceptos' },
);

CuadroTarifario.hasMany(Escalon, { foreignKey: 'cuadroId', as: 'escalones', onDelete: 'CASCADE' });
Escalon.belongsTo(CuadroTarifario, { foreignKey: 'cuadroId', as: 'cuadro' });
