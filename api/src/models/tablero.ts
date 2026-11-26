// Tablero de gerencia (Fase 7): la energía que entra a la red cada mes, para el balance contra lo facturado.
import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes } from 'sequelize';
import { sequelize } from '../db';

/** kWh comprados al distribuidor mayorista y generados por la cooperativa en un mes. Lo carga administración. */
export class BalanceEnergia extends Model<InferAttributes<BalanceEnergia>, InferCreationAttributes<BalanceEnergia>> {
  declare id: CreationOptional<number>;
  declare cooperativaId: CreationOptional<number>;
  declare anio: number;
  declare mes: number;
  /** DECIMAL: Postgres lo devuelve como texto. */
  declare compradaKwh: string;
  declare generadaKwh: CreationOptional<string>;
  declare nota: CreationOptional<string | null>;
  declare cargadoPor: CreationOptional<number | null>;
  declare creadoEl: CreationOptional<Date>;
  declare actualizadoEl: CreationOptional<Date>;
}

BalanceEnergia.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    cooperativaId: { type: DataTypes.INTEGER, allowNull: false },
    anio: { type: DataTypes.SMALLINT, allowNull: false },
    mes: { type: DataTypes.SMALLINT, allowNull: false },
    compradaKwh: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
    generadaKwh: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: '0' },
    nota: { type: DataTypes.STRING(200), allowNull: true },
    cargadoPor: { type: DataTypes.INTEGER, allowNull: true },
    creadoEl: DataTypes.DATE,
    actualizadoEl: DataTypes.DATE,
  },
  { sequelize, tableName: 'balance_energia' },
);
