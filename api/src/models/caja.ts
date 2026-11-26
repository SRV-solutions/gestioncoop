// Caja y cobranza (Fase 5): cajas con arqueo, pagos (cada uno es un recibo numerado), a qué
// comprobantes se aplican y los productos que se venden en el mostrador.
import { DataTypes, Model, type CreationOptional, type ForeignKey, type InferAttributes, type InferCreationAttributes, type NonAttribute } from 'sequelize';
import type { EstadoPago, MedioPago, OrigenPago, TitularRecibo } from '../shared';
import { sequelize } from '../db';
import { Usuario } from './core';
import { Comprobante } from './facturacion';
import { Socio } from './padron';

const id = { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true } as const;
const cooperativaId = { type: DataTypes.INTEGER, allowNull: false } as const;

/** Turno de un cajero: abre con un fondo, cobra y cierra contando el efectivo. */
export class Caja extends Model<InferAttributes<Caja>, InferCreationAttributes<Caja>> {
  declare id: CreationOptional<number>;
  declare cooperativaId: CreationOptional<number>;
  declare cajeroId: ForeignKey<Usuario['id']>;
  declare abiertaEl: CreationOptional<Date>;
  declare cerradaEl: CreationOptional<Date | null>;
  /** DECIMAL: Postgres lo devuelve como texto. */
  declare fondoInicial: string;
  declare totalEsperado: CreationOptional<string | null>;
  declare totalContado: CreationOptional<string | null>;
  declare nota: CreationOptional<string | null>;
  declare creadoEl: CreationOptional<Date>;
  declare actualizadoEl: CreationOptional<Date>;
}

Caja.init(
  {
    id,
    cooperativaId,
    cajeroId: { type: DataTypes.INTEGER, allowNull: false },
    abiertaEl: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    cerradaEl: { type: DataTypes.DATE, allowNull: true },
    fondoInicial: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
    totalEsperado: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
    totalContado: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
    nota: { type: DataTypes.STRING(200), allowNull: true },
    creadoEl: DataTypes.DATE,
    actualizadoEl: DataTypes.DATE,
  },
  { sequelize, tableName: 'cajas' },
);

/** Gas envasado y otros conceptos que se venden en el mostrador. */
export class Producto extends Model<InferAttributes<Producto>, InferCreationAttributes<Producto>> {
  declare id: CreationOptional<number>;
  declare cooperativaId: CreationOptional<number>;
  declare nombre: string;
  declare precio: string;
  /** `null` = no lleva control de stock. */
  declare stock: CreationOptional<number | null>;
  declare activo: CreationOptional<boolean>;
  declare creadoEl: CreationOptional<Date>;
  declare actualizadoEl: CreationOptional<Date>;
}

Producto.init(
  {
    id,
    cooperativaId,
    nombre: { type: DataTypes.STRING(80), allowNull: false },
    precio: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
    stock: { type: DataTypes.INTEGER, allowNull: true },
    activo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    creadoEl: DataTypes.DATE,
    actualizadoEl: DataTypes.DATE,
  },
  { sequelize, tableName: 'productos' },
);

/** Lo que el recibo tiene que poder imprimir siempre igual, aunque después cambie el padrón. */
export interface SnapshotPago {
  titular: TitularRecibo | null;
}

/** Un cobro, con su número de recibo. No se edita ni se borra: se anula. */
export class Pago extends Model<InferAttributes<Pago>, InferCreationAttributes<Pago>> {
  declare id: CreationOptional<number>;
  declare cooperativaId: CreationOptional<number>;
  declare cajaId: CreationOptional<ForeignKey<Caja['id']> | null>;
  declare cajeroId: CreationOptional<ForeignKey<Usuario['id']> | null>;
  declare socioId: CreationOptional<ForeignKey<Socio['id']> | null>;
  declare letra: string;
  declare puntoVenta: number;
  declare numero: number;
  declare medio: MedioPago;
  declare origen: CreationOptional<OrigenPago>;
  declare estado: CreationOptional<EstadoPago>;
  declare importe: string;
  declare recibido: CreationOptional<string | null>;
  declare vuelto: CreationOptional<string | null>;
  declare cobradoEl: CreationOptional<Date>;
  declare refExterna: CreationOptional<string | null>;
  declare clave: CreationOptional<string | null>;
  /** El intento de pago online del que salió (solo pagos online). */
  declare intentoId: CreationOptional<string | null>;
  /** Lo que se cobró de más (una factura ya estaba paga): queda a favor del socio. */
  declare aFavor: CreationOptional<string>;
  declare snapshotJson: SnapshotPago;
  declare anuladoEl: CreationOptional<Date | null>;
  declare anuladoPor: CreationOptional<number | null>;
  declare motivoAnulacion: CreationOptional<string | null>;
  /** Eslabón de la cadena de integridad de su talonario de recibos (ver lib/integridad). */
  declare huella: CreationOptional<string | null>;
  declare creadoEl: CreationOptional<Date>;
  declare actualizadoEl: CreationOptional<Date>;

  declare aplicaciones?: NonAttribute<PagoAplicacion[]>;
  declare items?: NonAttribute<PagoItem[]>;
}

Pago.init(
  {
    id,
    cooperativaId,
    cajaId: { type: DataTypes.INTEGER, allowNull: true },
    cajeroId: { type: DataTypes.INTEGER, allowNull: true },
    socioId: { type: DataTypes.INTEGER, allowNull: true },
    letra: { type: DataTypes.STRING(1), allowNull: false },
    puntoVenta: { type: DataTypes.INTEGER, allowNull: false },
    numero: { type: DataTypes.INTEGER, allowNull: false },
    medio: { type: DataTypes.STRING(14), allowNull: false },
    origen: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'mostrador' },
    estado: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'acreditado' },
    importe: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
    recibido: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
    vuelto: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
    cobradoEl: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    refExterna: { type: DataTypes.STRING(60), allowNull: true },
    clave: { type: DataTypes.UUID, allowNull: true },
    intentoId: { type: DataTypes.UUID, allowNull: true },
    aFavor: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: '0' },
    snapshotJson: { type: DataTypes.JSONB, allowNull: false },
    anuladoEl: { type: DataTypes.DATE, allowNull: true },
    anuladoPor: { type: DataTypes.INTEGER, allowNull: true },
    motivoAnulacion: { type: DataTypes.STRING(200), allowNull: true },
    huella: { type: DataTypes.CHAR(64), allowNull: true },
    creadoEl: DataTypes.DATE,
    actualizadoEl: DataTypes.DATE,
  },
  { sequelize, tableName: 'pagos' },
);

export class PagoAplicacion extends Model<InferAttributes<PagoAplicacion>, InferCreationAttributes<PagoAplicacion>> {
  declare id: CreationOptional<number>;
  declare cooperativaId: CreationOptional<number>;
  declare pagoId: ForeignKey<Pago['id']>;
  declare comprobanteId: ForeignKey<Comprobante['id']>;
  declare importe: string;
  declare saldoDespues: string;
}

PagoAplicacion.init(
  {
    id,
    cooperativaId,
    pagoId: { type: DataTypes.INTEGER, allowNull: false },
    comprobanteId: { type: DataTypes.INTEGER, allowNull: false },
    importe: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
    saldoDespues: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
  },
  // Una aplicación nunca cambia: las fechas son las del pago.
  { sequelize, tableName: 'pago_aplicaciones', timestamps: false },
);

export class PagoItem extends Model<InferAttributes<PagoItem>, InferCreationAttributes<PagoItem>> {
  declare id: CreationOptional<number>;
  declare cooperativaId: CreationOptional<number>;
  declare pagoId: ForeignKey<Pago['id']>;
  declare productoId: CreationOptional<ForeignKey<Producto['id']> | null>;
  declare descripcion: string;
  declare cantidad: number;
  declare unitario: string;
  declare importe: string;
}

PagoItem.init(
  {
    id,
    cooperativaId,
    pagoId: { type: DataTypes.INTEGER, allowNull: false },
    productoId: { type: DataTypes.INTEGER, allowNull: true },
    descripcion: { type: DataTypes.STRING(120), allowNull: false },
    cantidad: { type: DataTypes.INTEGER, allowNull: false },
    unitario: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
    importe: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
  },
  { sequelize, tableName: 'pago_items', timestamps: false },
);

Caja.belongsTo(Usuario, { foreignKey: 'cajeroId', as: 'cajero' });
Caja.hasMany(Pago, { foreignKey: 'cajaId', as: 'pagos' });
Pago.belongsTo(Caja, { foreignKey: 'cajaId', as: 'caja' });
Pago.belongsTo(Socio, { foreignKey: 'socioId', as: 'socio' });
Pago.hasMany(PagoAplicacion, { foreignKey: 'pagoId', as: 'aplicaciones', onDelete: 'CASCADE' });
Pago.hasMany(PagoItem, { foreignKey: 'pagoId', as: 'items', onDelete: 'CASCADE' });
PagoAplicacion.belongsTo(Pago, { foreignKey: 'pagoId', as: 'pago' });
PagoAplicacion.belongsTo(Comprobante, { foreignKey: 'comprobanteId', as: 'comprobante' });
PagoItem.belongsTo(Pago, { foreignKey: 'pagoId', as: 'pago' });
PagoItem.belongsTo(Producto, { foreignKey: 'productoId', as: 'producto' });
