// Portal del socio (Fase 6): intentos de pago online y la pasarela simulada, reclamos con su foto e
// historial, y cortes programados.
import { DataTypes, Model, type CreationOptional, type ForeignKey, type InferAttributes, type InferCreationAttributes, type NonAttribute } from 'sequelize';
import type { EstadoIntento, EstadoReclamo, ItemIntento, MedioPago, OrigenReclamo, Prioridad, ServicioCorte, ServicioReclamo } from '../shared';
import { sequelize } from '../db';
import { Pago } from './caja';
import { Usuario } from './core';
import { Conexion, Socio, Zona } from './padron';

const cooperativaId = { type: DataTypes.INTEGER, allowNull: false } as const;

/** Un pago online desde que el socio elige qué paga hasta que el banco lo confirma (o no). */
export class IntentoPago extends Model<InferAttributes<IntentoPago>, InferCreationAttributes<IntentoPago>> {
  /** UUID: es el «TransaccionComercioId» que viaja al proveedor. */
  declare id: string;
  declare cooperativaId: CreationOptional<number>;
  declare socioId: ForeignKey<Socio['id']>;
  declare origen: 'portal' | 'qr';
  declare proveedor: string;
  declare estado: CreationOptional<EstadoIntento>;
  /** DECIMAL: Postgres lo devuelve como texto. */
  declare total: string;
  declare itemsJson: ItemIntento[];
  declare medio: CreationOptional<MedioPago | null>;
  declare refExterna: CreationOptional<string | null>;
  declare motivo: CreationOptional<string | null>;
  declare pagoId: CreationOptional<ForeignKey<Pago['id']> | null>;
  declare venceEl: Date;
  declare resueltoEl: CreationOptional<Date | null>;
  declare creadoPor: CreationOptional<number | null>;
  declare creadoEl: CreationOptional<Date>;
  declare actualizadoEl: CreationOptional<Date>;
}

IntentoPago.init(
  {
    id: { type: DataTypes.UUID, primaryKey: true },
    cooperativaId,
    socioId: { type: DataTypes.INTEGER, allowNull: false },
    origen: { type: DataTypes.STRING(10), allowNull: false },
    proveedor: { type: DataTypes.STRING(20), allowNull: false },
    estado: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'pendiente' },
    total: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
    itemsJson: { type: DataTypes.JSONB, allowNull: false },
    medio: { type: DataTypes.STRING(14), allowNull: true },
    refExterna: { type: DataTypes.STRING(60), allowNull: true },
    motivo: { type: DataTypes.STRING(200), allowNull: true },
    pagoId: { type: DataTypes.INTEGER, allowNull: true },
    venceEl: { type: DataTypes.DATE, allowNull: false },
    resueltoEl: { type: DataTypes.DATE, allowNull: true },
    creadoPor: { type: DataTypes.INTEGER, allowNull: true },
    creadoEl: DataTypes.DATE,
    actualizadoEl: DataTypes.DATE,
  },
  { sequelize, modelName: 'IntentoPago', tableName: 'intentos_pago' },
);

/** Lo que el «banco» de la demo sabe de cada operación. Solo lo usa el proveedor simulado. */
export class PasarelaSimulada extends Model<InferAttributes<PasarelaSimulada>, InferCreationAttributes<PasarelaSimulada>> {
  declare intentoId: string;
  declare cooperativaId: CreationOptional<number>;
  declare estado: 'pendiente' | 'aprobado' | 'rechazado' | 'cancelado';
  declare medio: CreationOptional<'debito' | 'credito' | null>;
  declare referencia: CreationOptional<string | null>;
  declare importe: string;
  declare motivo: CreationOptional<string | null>;
  declare creadoEl: CreationOptional<Date>;
  declare actualizadoEl: CreationOptional<Date>;
}

PasarelaSimulada.init(
  {
    intentoId: { type: DataTypes.UUID, primaryKey: true },
    cooperativaId,
    estado: { type: DataTypes.STRING(10), allowNull: false },
    medio: { type: DataTypes.STRING(14), allowNull: true },
    referencia: { type: DataTypes.STRING(40), allowNull: true },
    importe: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
    motivo: { type: DataTypes.STRING(200), allowNull: true },
    creadoEl: DataTypes.DATE,
    actualizadoEl: DataTypes.DATE,
  },
  { sequelize, modelName: 'PasarelaSimulada', tableName: 'pasarela_simulada' },
);

export class Reclamo extends Model<InferAttributes<Reclamo>, InferCreationAttributes<Reclamo>> {
  declare id: CreationOptional<number>;
  declare cooperativaId: CreationOptional<number>;
  declare numero: number;
  declare socioId: CreationOptional<ForeignKey<Socio['id']> | null>;
  declare conexionId: CreationOptional<ForeignKey<Conexion['id']> | null>;
  declare servicio: ServicioReclamo;
  declare tipo: string;
  declare descripcion: CreationOptional<string | null>;
  declare prioridad: Prioridad;
  declare estado: CreationOptional<EstadoReclamo>;
  declare origen: OrigenReclamo;
  declare cuadrilla: CreationOptional<string | null>;
  declare direccion: CreationOptional<string | null>;
  declare lat: CreationOptional<string | null>;
  declare lng: CreationOptional<string | null>;
  declare contacto: CreationOptional<string | null>;
  declare tieneFoto: CreationOptional<boolean>;
  declare asignadoEl: CreationOptional<Date | null>;
  declare iniciadoEl: CreationOptional<Date | null>;
  declare resueltoEl: CreationOptional<Date | null>;
  declare resolucion: CreationOptional<string | null>;
  declare creadoPor: CreationOptional<number | null>;
  declare creadoEl: CreationOptional<Date>;
  declare actualizadoEl: CreationOptional<Date>;

  declare eventos?: NonAttribute<ReclamoEvento[]>;
}

Reclamo.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    cooperativaId,
    numero: { type: DataTypes.INTEGER, allowNull: false },
    socioId: { type: DataTypes.INTEGER, allowNull: true },
    conexionId: { type: DataTypes.INTEGER, allowNull: true },
    servicio: { type: DataTypes.STRING(16), allowNull: false },
    tipo: { type: DataTypes.STRING(24), allowNull: false },
    descripcion: { type: DataTypes.STRING(500), allowNull: true },
    prioridad: { type: DataTypes.STRING(8), allowNull: false },
    estado: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'nuevo' },
    origen: { type: DataTypes.STRING(10), allowNull: false },
    cuadrilla: { type: DataTypes.STRING(60), allowNull: true },
    direccion: { type: DataTypes.STRING(200), allowNull: true },
    lat: { type: DataTypes.DECIMAL(9, 6), allowNull: true },
    lng: { type: DataTypes.DECIMAL(9, 6), allowNull: true },
    contacto: { type: DataTypes.STRING(40), allowNull: true },
    tieneFoto: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    asignadoEl: { type: DataTypes.DATE, allowNull: true },
    iniciadoEl: { type: DataTypes.DATE, allowNull: true },
    resueltoEl: { type: DataTypes.DATE, allowNull: true },
    resolucion: { type: DataTypes.STRING(500), allowNull: true },
    creadoPor: { type: DataTypes.INTEGER, allowNull: true },
    creadoEl: DataTypes.DATE,
    actualizadoEl: DataTypes.DATE,
  },
  { sequelize, tableName: 'reclamos' },
);

export class ReclamoFoto extends Model<InferAttributes<ReclamoFoto>, InferCreationAttributes<ReclamoFoto>> {
  declare reclamoId: ForeignKey<Reclamo['id']>;
  declare cooperativaId: CreationOptional<number>;
  declare mime: string;
  declare contenido: Buffer;
  declare creadoEl: CreationOptional<Date>;
  declare actualizadoEl: CreationOptional<Date>;
}

ReclamoFoto.init(
  {
    reclamoId: { type: DataTypes.INTEGER, primaryKey: true },
    cooperativaId,
    mime: { type: DataTypes.STRING(40), allowNull: false },
    contenido: { type: DataTypes.BLOB, allowNull: false },
    creadoEl: DataTypes.DATE,
    actualizadoEl: DataTypes.DATE,
  },
  { sequelize, tableName: 'reclamo_fotos' },
);

export class ReclamoEvento extends Model<InferAttributes<ReclamoEvento>, InferCreationAttributes<ReclamoEvento>> {
  declare id: CreationOptional<number>;
  declare cooperativaId: CreationOptional<number>;
  declare reclamoId: ForeignKey<Reclamo['id']>;
  declare estado: CreationOptional<EstadoReclamo | null>;
  declare nota: CreationOptional<string | null>;
  declare visibleSocio: CreationOptional<boolean>;
  declare usuarioId: CreationOptional<ForeignKey<Usuario['id']> | null>;
  declare creadoEl: CreationOptional<Date>;
}

ReclamoEvento.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    cooperativaId,
    reclamoId: { type: DataTypes.INTEGER, allowNull: false },
    estado: { type: DataTypes.STRING(10), allowNull: true },
    nota: { type: DataTypes.TEXT, allowNull: true },
    visibleSocio: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    usuarioId: { type: DataTypes.INTEGER, allowNull: true },
    creadoEl: DataTypes.DATE,
  },
  { sequelize, tableName: 'reclamo_eventos', updatedAt: false },
);

export class CorteProgramadoModel extends Model<InferAttributes<CorteProgramadoModel>, InferCreationAttributes<CorteProgramadoModel>> {
  declare id: CreationOptional<number>;
  declare cooperativaId: CreationOptional<number>;
  declare zonaId: CreationOptional<ForeignKey<Zona['id']> | null>;
  declare servicio: ServicioCorte;
  declare desde: Date;
  declare hasta: Date;
  declare motivo: string;
  declare avisados: CreationOptional<number>;
  declare canceladoEl: CreationOptional<Date | null>;
  declare creadoPor: CreationOptional<number | null>;
  declare creadoEl: CreationOptional<Date>;
  declare actualizadoEl: CreationOptional<Date>;

  declare zona?: NonAttribute<Zona | null>;
}

CorteProgramadoModel.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    cooperativaId,
    zonaId: { type: DataTypes.INTEGER, allowNull: true },
    servicio: { type: DataTypes.STRING(12), allowNull: false },
    desde: { type: DataTypes.DATE, allowNull: false },
    hasta: { type: DataTypes.DATE, allowNull: false },
    motivo: { type: DataTypes.STRING(200), allowNull: false },
    avisados: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    canceladoEl: { type: DataTypes.DATE, allowNull: true },
    creadoPor: { type: DataTypes.INTEGER, allowNull: true },
    creadoEl: DataTypes.DATE,
    actualizadoEl: DataTypes.DATE,
  },
  { sequelize, modelName: 'CorteProgramado', tableName: 'cortes_programados' },
);

IntentoPago.belongsTo(Socio, { foreignKey: 'socioId', as: 'socio' });
IntentoPago.belongsTo(Pago, { foreignKey: 'pagoId', as: 'pago' });
Reclamo.belongsTo(Socio, { foreignKey: 'socioId', as: 'socio' });
Reclamo.belongsTo(Conexion, { foreignKey: 'conexionId', as: 'conexion' });
Reclamo.hasMany(ReclamoEvento, { foreignKey: 'reclamoId', as: 'eventos', onDelete: 'CASCADE' });
Reclamo.hasOne(ReclamoFoto, { foreignKey: 'reclamoId', as: 'foto', onDelete: 'CASCADE' });
ReclamoEvento.belongsTo(Reclamo, { foreignKey: 'reclamoId', as: 'reclamo' });
CorteProgramadoModel.belongsTo(Zona, { foreignKey: 'zonaId', as: 'zona' });
