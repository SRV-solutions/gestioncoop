import { createHash } from 'node:crypto';
import 'dotenv/config';

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Falta la variable de entorno ${name}`);
  return value;
}

const isProd = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

/**
 * Clave secreta propia de cada uso. En producción tiene que estar cargada (32 caracteres o más) y no
 * cambiar nunca: con otra clave, la cadena de integridad no cierra y el certificado de ARCA no se
 * puede leer. En desarrollo y en los tests se deriva de JWT_SECRET para no tener que cargar nada.
 */
function claveSecreta(name: string, uso: string): string {
  const valor = process.env[name];
  if (valor) {
    if (isProd && valor.length < 32) throw new Error(`${name} debe tener al menos 32 caracteres en producción`);
    return valor;
  }
  if (isProd) throw new Error(`Falta la variable de entorno ${name}`);
  return createHash('sha256').update(`${uso}|${required('JWT_SECRET')}`).digest('hex');
}

export const config = {
  isProd,
  isTest,
  port: Number(process.env.PORT ?? 4100),
  /** Cantidad de proxies delante de la API (1 en local con Vite; 2 en Railway detrás de Netlify). */
  trustProxy: Number(process.env.TRUST_PROXY ?? 1),
  appUrl: (process.env.APP_URL ?? 'http://localhost:5180').replace(/\/$/, ''),
  /** Dominio base para resolver la cooperativa por subdominio (dosdemayo.<dominioBase>). */
  dominioBase: (process.env.DOMINIO_BASE ?? '').trim().toLowerCase() || null,
  // Los tests usan su propia base, que se vacía en cada corrida.
  databaseUrl: isTest ? required('TEST_DATABASE_URL') : required('DATABASE_URL'),
  databaseSsl: process.env.DATABASE_SSL === 'true',
  jwtSecret: (() => {
    const s = required('JWT_SECRET');
    if (isProd && s.length < 32) throw new Error('JWT_SECRET debe tener al menos 32 caracteres en producción');
    return s;
  })(),
  /** Corto a propósito: si se desactiva un usuario o se le cambian los roles, rige en minutos. */
  accessTokenMinutes: 15,
  refreshTokenDays: 30,
  /** El socio entra desde su celular y no tiene contraseña que recordar: la sesión le dura 3 meses. */
  refreshTokenDaysSocio: 90,
  /** Muestra los botones "Entrar como..." y habilita los usuarios de prueba. */
  demoMode: process.env.DEMO_MODE === 'true',
  /** Botones de «Modo demo» en la pantalla de ingreso (entrar sin contraseña). Apagados salvo que se pidan. */
  demoAccesoRapido: process.env.DEMO_ACCESO_RAPIDO === 'true',
  /** Cooperativa que se muestra cuando la dirección no trae subdominio. */
  cooperativaPorDefecto: (process.env.COOPERATIVA_POR_DEFECTO ?? 'dosdemayo').trim().toLowerCase(),

  /** Cifra el certificado de ARCA de cada cooperativa (su clave privada) y el permiso de acceso que entrega ARCA. */
  claveCifrado: claveSecreta('CLAVE_CIFRADO', 'cifrado'),
  /** Firma la cadena de integridad. No está en la base: con acceso solo a la base no se puede rehacer la cadena. */
  claveIntegridad: claveSecreta('CLAVE_INTEGRIDAD', 'integridad'),
  /** Hora del día (Argentina) en que corre la verificación automática de integridad. `null` = no corre sola. */
  horaVerificacion: (() => {
    if (isTest || process.env.VERIFICACION_DIARIA === 'false') return null;
    const [h, m] = (process.env.VERIFICACION_HORA ?? '03:30').split(':').map(Number);
    return { hora: h ?? 3, minuto: m ?? 30 };
  })(),

  /** Mails con Resend. Sin clave, quedan guardados como simulados y no sale nada. */
  resendApiKey: isTest ? null : process.env.RESEND_API_KEY?.trim() || null,
  /** Remitente verificado en Resend. `onboarding@resend.dev` solo le llega al dueño de la cuenta de Resend. */
  correoRemitente: process.env.CORREO_REMITENTE?.trim() || 'GestiónCoop <onboarding@resend.dev>',
  /** Los avisos de factura a los socios salen por mail de verdad (además de quedar en la bandeja). */
  avisosSociosPorCorreo: process.env.AVISOS_SOCIOS_POR_CORREO === 'true',

  /**
   * Algunos servidores de ARCA usan cifrados viejos que Node rechaza por defecto. Solo si aparece el
   * error «dh key too small» o similar: baja el nivel de seguridad de TLS para las direcciones de ARCA.
   */
  arcaTlsLegacy: process.env.ARCA_TLS_LEGACY === 'true',
};
