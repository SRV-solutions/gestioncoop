// Antes de los tests: prende la base local si hace falta, vacía la base de tests y le aplica las migraciones.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { Client } from 'pg';

const API_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export default async function setup() {
  loadEnv({ path: path.join(API_DIR, '.env'), quiet: true });
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('Falta TEST_DATABASE_URL en api/.env');
  // Esta base se borra entera: nunca aceptar una que no sea claramente de tests.
  if (!/_test(\?|$)/.test(new URL(url).pathname)) {
    throw new Error('TEST_DATABASE_URL tiene que apuntar a una base cuyo nombre termine en _test');
  }

  execFileSync(process.execPath, [path.join(API_DIR, 'scripts', 'db.mjs'), 'start'], { cwd: API_DIR, stdio: 'pipe' });

  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  await client.end();

  const cli = createRequire(import.meta.url).resolve('sequelize-cli/lib/sequelize');
  execFileSync(process.execPath, [cli, 'db:migrate'], {
    cwd: API_DIR,
    stdio: 'pipe',
    env: { ...process.env, NODE_ENV: 'test' },
  });
}
