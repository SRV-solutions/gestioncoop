import { config } from './config';
import { sequelize } from './db';
import { createApp } from './app';
import { cerrarProcesosHuerfanos } from './lib/facturacion';
import { cerrarVerificacionesHuerfanas, programarVerificacionDiaria, proximaVerificacion } from './lib/integridad';
import { proveedorCorreo } from './proveedores/correo';

async function main() {
  await sequelize.authenticate();
  await cerrarProcesosHuerfanos();
  await cerrarVerificacionesHuerfanas();
  programarVerificacionDiaria();
  const app = createApp();
  app.listen(config.port, () => {
    console.log(`✓ API de GestiónCoop en http://localhost:${config.port}/api/v1${config.demoMode ? '  (modo demo)' : ''}`);
    const proxima = proximaVerificacion();
    if (proxima) console.log(`  Verificación de integridad diaria: próxima ${proxima.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}`);
    console.log(`  Mails: ${proveedorCorreo.real ? `Resend (desde ${config.correoRemitente})` : 'simulados (sin RESEND_API_KEY no sale ninguno)'}`);
  });
}

main().catch((err) => {
  console.error('No se pudo iniciar la API:', err.message ?? err);
  process.exit(1);
});
