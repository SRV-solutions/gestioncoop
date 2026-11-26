import 'dotenv/config';

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Falta la variable de entorno ${name}`);
  return value;
}

const isProd = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

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
};
