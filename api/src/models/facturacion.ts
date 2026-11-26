// Facturación (Fase 4): comprobantes y renglones, numeradores, trabajos en segundo plano y avisos al socio.
import { DataTypes, Model, type CreationOptional, type ForeignKey, type InferAttributes, type InferCreationAttributes, type NonAttribute } from 'sequelize';
import type { EstadoComprobante, GrupoRenglon, MotivoRara, ServicioConexion, SnapshotComprobante, TipoComprobante, TipoProceso } from '../shared';
import { sequelize } from '../db';
import { Usuario } from './core';
import { Periodo } from './lecturas';
import { Conexion, ServicioConexionModel, Socio } from './padron';

const id = { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true } as const;
const cooperativaId = { type: DataTypes.INTEGER, allowNull: false } as const;

/** Factura, nota de crédito, nota de débito o recibo. Emitido, no se edita: se corrige con nota de crédito. */
export class Comprobante extends Model<InferAttributes<Comprobante>, InferCreationAttributes<Comprobante>> {
  declare id: CreationOptional<number>;
  declare cooperativaId: CreationOptional<number>;
  declare tipo: TipoComprobante;
  declare letra: string;
  declare puntoVenta: number;
  /** `null` mientras es borrador (pre-factura). */
  declare numero: CreationOptional<number | null>;
  declare socioId: ForeignKey<Socio['id']>;
  declare conexionId: CreationOptional<ForeignKey<Conexion['id']> | null>;
  declare servicioConexionId: CreationOptional<ForeignKey<ServicioConexionModel['id']> | null>;
  declare servicio: ServicioConexion;
  declare anio: number;
  declare mes: number;
  declare periodoId: CreationOptional<ForeignKey<Periodo['id']> | null>;
  declare orden: CreationOptional<number>;
  declare estado: CreationOptional<EstadoComprobante>;
  declare emitidoEl: CreationOptional<string | null>;
  declare venceEl: CreationOptional<string | null>;
  /** DECIMAL: Postgres lo devuelve como texto. */
  declare total: string;
  declare saldo: string;
  declare totalServicio: CreationOptional<string>;
  declare consumo: CreationOptional<string | null>;
  declare aFavor: CreationOptional<string>;
  declare estimada: CreationOptional<boolean>;
  declare rara: CreationOptional<MotivoRara | null>;
  declare totalAnterior: CreationOptional<string | null>;
  declare variacion: CreationOptional<string | null>;
  declare revisadaEl: CreationOptional<Date | null>;
  declare revisadaPor: CreationOptional<ForeignKey<Usuario['id']> | null>;
  declare error: CreationOptional<string | null>;
  declare origenId: CreationOptional<number | null>;
  declare motivo: CreationOptional<string | null>;
  declare cae: CreationOptional<string | null>;
  declare caeVence: CreationOptional<string | null>;
  declare snapshotJson: SnapshotComprobante;
  declare creadoPor: CreationOptional<number | null>;
  declare creadoEl: CreationOptional<Date>;
  declare actualizadoEl: CreationOptional<Date>;

  declare renglones?: NonAttribute<ComprobanteRenglon[]>;
  declare socio?: NonAttribute<Socio>;
}

Comprobante.init(
  {
    id,
    cooperativaId,
    tipo: { type: DataTypes.STRING(14), allowNull: false },
    letra: { type: DataTypes.STRING(1), allowNull: false },
    puntoVenta: { type: DataTypes.INTEGER, allowNull: false },
    numero: { type: DataTypes.INTEGER, allowNull: true },
    socioId: { type: DataTypes.INTEGER, allowNull: false },
    conexionId: { type: DataTypes.INTEGER, allowNull: true },
    servicioConexionId: { type: DataTypes.INTEGER, allowNull: true },
    servicio: { type: DataTypes.STRING(12), allowNull: false },
    anio: { type: DataTypes.SMALLINT, allowNull: false },
    mes: { type: DataTypes.SMALLINT, allowNull: false },
    periodoId: { type: DataTypes.INTEGER, allowNull: true },
    orden: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    estado: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'borrador' },
    emitidoEl: { type: DataTypes.DATEONLY, allowNull: true },
    venceEl: { type: DataTypes.DATEONLY, allowNull: true },
    total: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
    saldo: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
    totalServicio: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: '0' },
    consumo: { type: DataTypes.DECIMAL(14, 4), allowNull: true },
    aFavor: { type: DataTypes.DECIMAL(14, 4), allowNull: false, defaultValue: '0' },
    estimada: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    rara: { type: DataTypes.STRING(16), allowNull: true },
    totalAnterior: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
    variacion: { type: DataTypes.DECIMAL(9, 1), allowNull: true },
    revisadaEl: { type: DataTypes.DATE, allowNull: true },
    revisadaPor: { type: DataTypes.INTEGER, allowNull: true },
    error: { type: DataTypes.STRING(300), allowNull: true },
    origenId: { type: DataTypes.INTEGER, allowNull: true },
    motivo: { type: DataTypes.STRING(200), allowNull: true },
    cae: { type: DataTypes.STRING(20), allowNull: true },
    caeVence: { type: DataTypes.DATEONLY, allowNull: true },
    snapshotJson: { type: DataTypes.JSONB, allowNull: false },
    creadoPor: { type: DataTypes.INTEGER, allowNull: true },
    creadoEl: DataTypes.DATE,
    actualizadoEl: DataTypes.DATE,
  },
  { sequelize, tableName: 'comprobantes' },
);

export class ComprobanteRenglon extends Model<InferAttributes<ComprobanteRenglon>, InferCreationAttributes<ComprobanteRenglon>> {
  declare id: CreationOptional<number>;
  declare cooperativaId: CreationOptional<number>;
  declare comprobanteId: ForeignKey<Comprobante['id']>;
  declare orden: number;
  declare grupo: GrupoRenglon;
  declare codigo: string;
  declare servicio: ServicioConexion;
  declare descripcion: string;
  declare cantidad: CreationOptional<string | null>;
  declare unitario: CreationOptional<string | null>;
  declare porcentaje: CreationOptional<string | null>;
  declare base: CreationOptional<string | null>;
  declare importe: string;
  declare subsidiado: CreationOptional<boolean>;
  declare nota: CreationOptional<string | null>;
}

ComprobanteRenglon.init(
  {
    id,
    cooperativaId,
    comprobanteId: { type: DataTypes.INTEGER, allowNull: false },
    orden: { type: DataTypes.SMALLINT, allowNull: false },
    grupo: { type: DataTypes.STRING(10), allowNull: false },
    codigo: { type: DataTypes.STRING(24), allowNull: false },
    servicio: { type: DataTypes.STRING(12), allowNull: false },
    descripcion: { type: DataTypes.STRING(200), allowNull: false },
    cantidad: { type: DataTypes.DECIMAL(16, 4), allowNull: true },
    unitario: { type: DataTypes.DECIMAL(18, 6), allowNull: true },
    porcentaje: { type: DataTypes.DECIMAL(12, 6), allowNull: true },
    base: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
    importe: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
    subsidiado: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    nota: { type: DataTypes.STRING(200), allowNull: true },
  },
  // Un renglón nunca cambia: no lleva fechas propias (son las del comprobante).
  { sequelize, tableName: 'comprobante_renglones', timestamps: false },
);

/** Último número usado por tipo, letra y punto de venta. */
export class Numerador extends Model<InferAttributes<Numerador>, InferCreationAttributes<Numerador>> {
  declare id: CreationOptional<number>;
  declare cooperativaId: CreationOptional<number>;
  declare tipo: TipoComprobante;
  declare letra: string;
  declare puntoVenta: number;
  declare ultimo: CreationOptional<number>;
  declare creadoEl: CreationOptional<Date>;
  declare actualizadoEl: CreationOptional<Date>;
}

Numerador.init(
  {
    id,
    cooperativaId,
    tipo: { type: DataTypes.STRING(14), allowNull: false },
    letra: { type: DataTypes.STRING(1), allowNull: false },
    puntoVenta: { type: DataTypes.INTEGER, allowNull: false },
    ultimo: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    creadoEl: DataTypes.DATE,
    actualizadoEl: DataTypes.DATE,
  },
  { sequelize, tableName: 'numeradores' },
);

/** Pre-facturación o emisión corriendo en segundo plano. */
export class ProcesoFacturacionModel extends Model<InferAttributes<ProcesoFacturacionModel>, InferCreationAttributes<ProcesoFacturacionModel>> {
  declare id: CreationOptional<number>;
  declare cooperativaId: CreationOptional<number>;
  declare tipo: TipoProceso;
  declare anio: number;
  declare mes: number;
  declare estado: CreationOptional<'en_curso' | 'terminado' | 'fallido'>;
  declare total: CreationOptional<number>;
  declare hechas: CreationOptional<number>;
  declare error: CreationOptional<string | null>;
  declare usuarioId: CreationOptional<number | null>;
  declare terminadoEl: CreationOptional<Date | null>;
  declare creadoEl: CreationOptional<Date>;
  declare actualizadoEl: CreationOptional<Date>;
}

ProcesoFacturacionModel.init(
  {
    id,
    cooperativaId,
    tipo: { type: DataTypes.STRING(12), allowNull: false },
    anio: { type: DataTypes.SMALLINT, allowNull: false },
    mes: { type: DataTypes.SMALLINT, allowNull: false },
    estado: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'en_curso' },
    total: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    hechas: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    error: { type: DataTypes.STRING(300), allowNull: true },
    usuarioId: { type: DataTypes.INTEGER, allowNull: true },
    terminadoEl: { type: DataTypes.DATE, allowNull: true },
    creadoEl: DataTypes.DATE,
    actualizadoEl: DataTypes.DATE,
  },
  { sequelize, modelName: 'ProcesoFacturacion', tableName: 'procesos_facturacion' },
);

/** Aviso al socio. En la demo queda guardado y no se envía (proveedor simulado). */
export class Notificacion extends Model<InferAttributes<Notificacion>, InferCreationAttributes<Notificacion>> {
  declare id: CreationOptional<number>;
  declare cooperativaId: CreationOptional<number>;
  declare socioId: ForeignKey<Socio['id']>;
  declare comprobanteId: CreationOptional<number | null>;
  declare canal: 'email' | 'whatsapp';
  declare destino: string;
  declare asunto: string;
  declare cuerpo: string;
  declare estado: CreationOptional<string>;
  declare creadoEl: CreationOptional<Date>;
}

Notificacion.init(
  {
    id,
    cooperativaId,
    socioId: { type: DataTypes.INTEGER, allowNull: false },
    comprobanteId: { type: DataTypes.INTEGER, allowNull: true },
    canal: { type: DataTypes.STRING(10), allowNull: false },
    destino: { type: DataTypes.STRING(200), allowNull: false },
    asunto: { type: DataTypes.STRING(160), allowNull: false },
    cuerpo: { type: DataTypes.TEXT, allowNull: false },
    estado: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'simulada' },
    creadoEl: DataTypes.DATE,
  },
  { sequelize, tableName: 'notificaciones', updatedAt: false },
);

Comprobante.hasMany(ComprobanteRenglon, { foreignKey: 'comprobanteId', as: 'renglones', onDelete: 'CASCADE' });
ComprobanteRenglon.belongsTo(Comprobante, { foreignKey: 'comprobanteId', as: 'comprobante' });
Comprobante.belongsTo(Socio, { foreignKey: 'socioId', as: 'socio' });
Comprobante.belongsTo(Conexion, { foreignKey: 'conexionId', as: 'conexion' });
Comprobante.belongsTo(Periodo, { foreignKey: 'periodoId', as: 'periodo' });
Comprobante.belongsTo(Comprobante, { foreignKey: 'origenId', as: 'origen' });
