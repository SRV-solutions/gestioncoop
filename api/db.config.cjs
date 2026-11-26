// Configuración de sequelize-cli (migraciones). La app usa src/db.ts.
require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });

const ssl = process.env.DATABASE_SSL === 'true' ? { ssl: { require: true, rejectUnauthorized: false } } : {};
const base = { dialect: 'postgres', logging: false, migrationStorageTableName: 'migraciones' };

module.exports = {
  development: { ...base, use_env_variable: 'DATABASE_URL' },
  // Los tests corren contra su propia base (ver tests/global-setup.ts).
  test: { ...base, use_env_variable: 'TEST_DATABASE_URL' },
  production: { ...base, use_env_variable: 'DATABASE_URL', dialectOptions: ssl },
};
