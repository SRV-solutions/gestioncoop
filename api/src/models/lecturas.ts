// Lecturas en campo (Fase 3): períodos, lecturas y sus fotos.
import { DataTypes, Model, type CreationOptional, type ForeignKey, type InferAttributes, type InferCreationAttributes, type NonAttribute } from 'sequelize';
import type { Anomalia, EstadoPeriodo, MotivoLecturaMenor, Novedad, ServicioMedido } from '../shared';
import { sequelize } from '../db';
import { Usuario } from './core';
import { Medidor } from './padron';

const id = { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true } as const;
const cooperativaId = { type: DataTypes.INTEGER, allowNull: false } as const;

/** Un mes de un servicio. Avanza por estado: abierto → en_lectura → prefacturado → emitido → cerrado. */
export class Periodo extends Model<InferAttributes<Periodo>, InferCreationAttributes<Periodo>> {
  declare id: CreationOptional<number>;
  declare cooperativaId: CreationOptional<number>;
  declare servicio: ServicioMedido;
  declare anio: number;
  declare mes: number;
  declare estado: CreationOptional<EstadoPeriodo>;
  declare creadoEl: CreationOptional<Date>;
  declare actualizadoEl: CreationOptional<Date>;
}

Periodo.init(
  {
    id,
    cooperativaId,
    servicio: { type: DataTypes.STRING(12), allowNull: false },
    anio: { type: DataTypes.SMALLINT, allowNull: false },
    mes: { type: DataTypes.SMALLINT, allowNull: false },
    estado: { type: DataTypes.STRING(14), allowNull: false, defaultValue: 'abierto' },
    creadoEl: DataTypes.DATE,
    actualizadoEl: DataTypes.DATE,
  },
  { sequelize, tableName: 'periodos' },
);

export class Lectura extends Model<InferAttributes<Lectura>, InferCreationAttributes<Lectura>> {
  declare id: CreationOptional<number>;
  declare cooperativaId: CreationOptional<number>;
  declare uuidDispositivo: string;
  declare periodoId: ForeignKey<Periodo['id']>;
  declare medidorId: ForeignKey<Medidor['id']>;
  /** DECIMAL: Postgres lo devuelve como texto. `null` = no se pudo leer. */
  declare valor: string | null;
  declare anterior: string | null;
  declare consumo: string | null;
  declare tipo: CreationOptional<'real' | 'estimada'>;
  declare motivo: CreationOptional<MotivoLecturaMenor | null>;
  declare novedad: CreationOptional<Novedad | null>;
  declare anomalia: CreationOptional<Anomalia | null>;
  declare nota: CreationOptional<string | null>;
  declare tieneFoto: CreationOptional<boolean>;
  declare lat: CreationOptional<string | null>;
  declare lng: CreationOptional<string | null>;
  declare precisionM: CreationOptional<number | null>;
  declare tomadaEl: Date;
  declare operarioId: CreationOptional<ForeignKey<Usuario['id']> | null>;
  declare sincronizadaEl: CreationOptional<Date>;
  declare revisadaEl: CreationOptional<Date | null>;
  declare revisadaPor: CreationOptional<ForeignKey<Usuario['id']> | null>;
  declare creadoEl: CreationOptional<Date>;
  declare actualizadoEl: CreationOptional<Date>;

  declare periodo?: NonAttribute<Periodo>;
  declare medidor?: NonAttribute<Medidor>;
}

Lectura.init(
  {
    id,
    cooperativaId,
    uuidDispositivo: { type: DataTypes.UUID, allowNull: false },
    periodoId: { type: DataTypes.INTEGER, allowNull: false },
    medidorId: { type: DataTypes.INTEGER, allowNull: false },
    valor: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
    anterior: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
    consumo: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
    tipo: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'real' },
    motivo: { type: DataTypes.STRING(20), allowNull: true },
    novedad: { type: DataTypes.STRING(20), allowNull: true },
    anomalia: { type: DataTypes.STRING(16), allowNull: true },
    nota: { type: DataTypes.STRING(300), allowNull: true },
    tieneFoto: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    lat: { type: DataTypes.DECIMAL(9, 6), allowNull: true },
    lng: { type: DataTypes.DECIMAL(9, 6), allowNull: true },
    precisionM: { type: DataTypes.INTEGER, allowNull: true },
    tomadaEl: { type: DataTypes.DATE, allowNull: false },
    operarioId: { type: DataTypes.INTEGER, allowNull: true },
    sincronizadaEl: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    revisadaEl: { type: DataTypes.DATE, allowNull: true },
    revisadaPor: { type: DataTypes.INTEGER, allowNull: true },
    creadoEl: DataTypes.DATE,
    actualizadoEl: DataTypes.DATE,
  },
  { sequelize, tableName: 'lecturas' },
);

export class LecturaFoto extends Model<InferAttributes<LecturaFoto>, InferCreationAttributes<LecturaFoto>> {
  declare lecturaId: ForeignKey<Lectura['id']>;
  declare cooperativaId: CreationOptional<number>;
  declare mime: string;
  declare contenido: Buffer;
  declare creadoEl: CreationOptional<Date>;
  declare actualizadoEl: CreationOptional<Date>;
}

LecturaFoto.init(
  {
    lecturaId: { type: DataTypes.INTEGER, primaryKey: true },
    cooperativaId,
    mime: { type: DataTypes.STRING(40), allowNull: false },
    contenido: { type: DataTypes.BLOB, allowNull: false },
    creadoEl: DataTypes.DATE,
    actualizadoEl: DataTypes.DATE,
  },
  { sequelize, tableName: 'lectura_fotos' },
);

Periodo.hasMany(Lectura, { foreignKey: 'periodoId', as: 'lecturas' });
Lectura.belongsTo(Periodo, { foreignKey: 'periodoId', as: 'periodo' });
Lectura.belongsTo(Medidor, { foreignKey: 'medidorId', as: 'medidor' });
Lectura.belongsTo(Usuario, { foreignKey: 'operarioId', as: 'operario' });
Lectura.hasOne(LecturaFoto, { foreignKey: 'lecturaId', as: 'foto' });
