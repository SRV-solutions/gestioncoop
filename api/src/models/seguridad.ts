// Factura electrónica (configuración de ARCA por cooperativa), integridad de los datos, alertas al
// personal y fallos en el ingreso del socio.
import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes, type NonAttribute } from 'sequelize';
import type { AmbienteFiscal, EstadoCorreoAlerta, EstadoVerificacion, ProblemaIntegridad, ResumenIntegridad, TratamientoConcepto } from '../shared';
import { sequelize } from '../db';
import { Cooperativa, Usuario } from './core';

/** Con qué se conecta la cooperativa a ARCA. La clave privada y el permiso de acceso van cifrados. */
export class ConfigFiscal extends Model<InferAttributes<ConfigFiscal>, InferCreationAttributes<ConfigFiscal>> {
  declare cooperativaId: number;
  declare ambiente: CreationOptional<AmbienteFiscal>;
  declare cuit: CreationOptional<string | null>;
  declare certificado: CreationOptional<string | null>;
  declare claveCifrada: CreationOptional<string | null>;
  declare certificadoTitular: CreationOptional<string | null>;
  declare certificadoVence: CreationOptional<string | null>;
  declare tratamientosJson: CreationOptional<Record<string, TratamientoConcepto>>;
  declare taCifrado: CreationOptional<string | null>;
  declare taVence: CreationOptional<Date | null>;
  declare taAmbiente: CreationOptional<AmbienteFiscal | null>;
  declare ultimaPruebaEl: CreationOptional<Date | null>;
  declare ultimaPruebaOk: CreationOptional<boolean | null>;
  declare ultimaPruebaDetalle: CreationOptional<string | null>;
  declare actualizadoPor: CreationOptional<number | null>;
  declare creadoEl: CreationOptional<Date>;
  declare actualizadoEl: CreationOptional<Date>;
}

ConfigFiscal.init(
  {
    cooperativaId: { type: DataTypes.INTEGER, primaryKey: true },
    ambiente: { type: DataTypes.STRING(14), allowNull: false, defaultValue: 'simulado' },
    cuit: { type: DataTypes.STRING(11), allowNull: true },
    certificado: { type: DataTypes.TEXT, allowNull: true },
    claveCifrada: { type: DataTypes.TEXT, allowNull: true },
    certificadoTitular: { type: DataTypes.STRING(200), allowNull: true },
    certificadoVence: { type: DataTypes.DATEONLY, allowNull: true },
    tratamientosJson: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    taCifrado: { type: DataTypes.TEXT, allowNull: true },
    taVence: { type: DataTypes.DATE, allowNull: true },
    taAmbiente: { type: DataTypes.STRING(14), allowNull: true },
    ultimaPruebaEl: { type: DataTypes.DATE, allowNull: true },
    ultimaPruebaOk: { type: DataTypes.BOOLEAN, allowNull: true },
    ultimaPruebaDetalle: { type: DataTypes.STRING(500), allowNull: true },
    actualizadoPor: { type: DataTypes.INTEGER, allowNull: true },
    creadoEl: DataTypes.DATE,
    actualizadoEl: DataTypes.DATE,
  },
  { sequelize, tableName: 'config_fiscal' },
);

/** Una revisión de la cadena de integridad, manual o automática. */
export class VerificacionIntegridad extends Model<InferAttributes<VerificacionIntegridad>, InferCreationAttributes<VerificacionIntegridad>> {
  declare id: CreationOptional<number>;
  declare cooperativaId: CreationOptional<number>;
  declare origen: 'manual' | 'automatica';
  declare estado: CreationOptional<EstadoVerificacion>;
  declare usuarioId: CreationOptional<number | null>;
  declare resumenJson: CreationOptional<ResumenIntegridad | null>;
  declare problemasJson: CreationOptional<{ total: number; lista: ProblemaIntegridad[] } | null>;
  declare error: CreationOptional<string | null>;
  declare iniciadaEl: CreationOptional<Date>;
  declare terminadaEl: CreationOptional<Date | null>;

  declare usuario?: NonAttribute<Usuario | null>;
}

VerificacionIntegridad.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    cooperativaId: { type: DataTypes.INTEGER, allowNull: false },
    origen: { type: DataTypes.STRING(10), allowNull: false },
    estado: { type: DataTypes.STRING(14), allowNull: false, defaultValue: 'en_curso' },
    usuarioId: { type: DataTypes.INTEGER, allowNull: true },
    resumenJson: { type: DataTypes.JSONB, allowNull: true },
    problemasJson: { type: DataTypes.JSONB, allowNull: true },
    error: { type: DataTypes.STRING(300), allowNull: true },
    iniciadaEl: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    terminadaEl: { type: DataTypes.DATE, allowNull: true },
  },
  { sequelize, tableName: 'verificaciones_integridad', timestamps: false },
);

/** Aviso a una persona del personal o de SRV: campana de la app + mail. */
export class Alerta extends Model<InferAttributes<Alerta>, InferCreationAttributes<Alerta>> {
  declare id: CreationOptional<number>;
  /** La cooperativa de la que habla. */
  declare cooperativaId: number;
  declare usuarioId: number;
  declare tipo: string;
  declare titulo: string;
  declare cuerpo: string;
  declare enlace: CreationOptional<string | null>;
  declare leidaEl: CreationOptional<Date | null>;
  declare correoDestino: CreationOptional<string | null>;
  declare correoEstado: EstadoCorreoAlerta;
  declare correoError: CreationOptional<string | null>;
  declare creadoEl: CreationOptional<Date>;

  declare cooperativa?: NonAttribute<Cooperativa>;
}

Alerta.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    cooperativaId: { type: DataTypes.INTEGER, allowNull: false },
    usuarioId: { type: DataTypes.INTEGER, allowNull: false },
    tipo: { type: DataTypes.STRING(30), allowNull: false },
    titulo: { type: DataTypes.STRING(160), allowNull: false },
    cuerpo: { type: DataTypes.TEXT, allowNull: false },
    enlace: { type: DataTypes.STRING(200), allowNull: true },
    leidaEl: { type: DataTypes.DATE, allowNull: true },
    correoDestino: { type: DataTypes.STRING(200), allowNull: true },
    correoEstado: { type: DataTypes.STRING(12), allowNull: false },
    correoError: { type: DataTypes.STRING(300), allowNull: true },
    creadoEl: DataTypes.DATE,
  },
  { sequelize, tableName: 'alertas', updatedAt: false },
);

/** Fallos seguidos en el ingreso del socio con un mismo código de socio. */
export class IntentoAccesoSocio extends Model<InferAttributes<IntentoAccesoSocio>, InferCreationAttributes<IntentoAccesoSocio>> {
  declare cooperativaId: CreationOptional<number>;
  declare clave: string;
  declare fallidos: CreationOptional<number>;
  declare primerFalloEl: CreationOptional<Date>;
  declare bloqueadoHasta: CreationOptional<Date | null>;
}

IntentoAccesoSocio.init(
  {
    cooperativaId: { type: DataTypes.INTEGER, primaryKey: true },
    clave: { type: DataTypes.STRING(40), primaryKey: true },
    fallidos: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    primerFalloEl: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    bloqueadoHasta: { type: DataTypes.DATE, allowNull: true },
  },
  { sequelize, tableName: 'intentos_acceso_socio', timestamps: false },
);

VerificacionIntegridad.belongsTo(Usuario, { foreignKey: 'usuarioId', as: 'usuario' });
Alerta.belongsTo(Cooperativa, { foreignKey: 'cooperativaId', as: 'cooperativa' });
