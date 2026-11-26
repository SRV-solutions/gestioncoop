import { Sequelize } from 'sequelize';
import { config } from './config';

export const sequelize = new Sequelize(config.databaseUrl, {
  dialect: 'postgres',
  logging: false,
  timezone: '+00:00',
  dialectOptions: config.databaseSsl ? { ssl: { require: true, rejectUnauthorized: false } } : {},
  define: {
    underscored: true,
    timestamps: true,
    // Los nombres de columnas siguen el modelo de datos del SPEC (creado_el, emitido_el, tomada_el...).
    createdAt: 'creadoEl',
    updatedAt: 'actualizadoEl',
    freezeTableName: true,
  },
});
