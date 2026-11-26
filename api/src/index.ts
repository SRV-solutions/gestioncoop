import { config } from './config';
import { sequelize } from './db';
import { createApp } from './app';
import { cerrarProcesosHuerfanos } from './lib/facturacion';

async function main() {
  await sequelize.authenticate();
  await cerrarProcesosHuerfanos();
  const app = createApp();
  app.listen(config.port, () => {
    console.log(`✓ API de GestiónCoop en http://localhost:${config.port}/api/v1${config.demoMode ? '  (modo demo)' : ''}`);
  });
}

main().catch((err) => {
  console.error('No se pudo iniciar la API:', err.message ?? err);
  process.exit(1);
});
