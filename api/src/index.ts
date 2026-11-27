// Arranque de la API. Con `WEB_CONCURRENCY` > 1, un proceso principal hace lo que tiene que pasar una
// sola vez (cerrar trabajos que quedaron colgados, la verificación diaria) y reparte los pedidos entre
// varios trabajadores, uno por núcleo. Si un trabajador se cae, lo reemplaza.
import cluster from 'node:cluster';
import { config } from './config';
import { sequelize } from './db';
import { createApp } from './app';
import { cerrarProcesosHuerfanos } from './lib/facturacion';
import { cerrarVerificacionesHuerfanas, programarVerificacionDiaria, proximaVerificacion } from './lib/integridad';
import { proveedorCorreo } from './proveedores/correo';

/** Lo que corre una sola vez, en el proceso principal. */
async function tareasUnicas() {
  await sequelize.authenticate();
  await cerrarProcesosHuerfanos();
  await cerrarVerificacionesHuerfanas();
  programarVerificacionDiaria();
  // Un trabajo que murió con un trabajador que se cayó no tiene que quedar «en curso».
  setInterval(() => {
    void Promise.all([cerrarProcesosHuerfanos(), cerrarVerificacionesHuerfanas()]).catch((err) => console.error('[ARRANQUE] limpieza de trabajos', err));
  }, 60_000).unref();
}

function avisarArranque() {
  const procesos = config.trabajadores > 1 ? ` · ${config.trabajadores} procesos` : '';
  console.log(`✓ API de GestiónCoop en http://localhost:${config.port}/api/v1${config.demoMode ? '  (modo demo)' : ''}${procesos}`);
  const proxima = proximaVerificacion();
  if (proxima) console.log(`  Verificación de integridad diaria: próxima ${proxima.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}`);
  console.log(`  Mails: ${proveedorCorreo.real ? `Resend (desde ${config.correoRemitente})` : 'simulados (sin RESEND_API_KEY no sale ninguno)'}`);
}

function atender(alListo?: () => void) {
  createApp().listen(config.port, alListo);
}

async function main() {
  if (cluster.isWorker) {
    await sequelize.authenticate();
    atender();
    return;
  }
  await tareasUnicas();
  if (config.trabajadores === 1) {
    atender(avisarArranque);
    return;
  }
  let listos = 0;
  const lanzar = () =>
    cluster.fork().once('listening', () => {
      if (++listos === config.trabajadores) avisarArranque();
    });
  for (let i = 0; i < config.trabajadores; i++) lanzar();
  cluster.on('exit', (_trabajador, codigo, senal) => {
    console.error(`[ARRANQUE] se cayó un proceso (${senal ?? codigo}): se reemplaza`);
    setTimeout(lanzar, 1000);
  });
}

main().catch((err) => {
  console.error('No se pudo iniciar la API:', err.message ?? err);
  process.exit(1);
});
