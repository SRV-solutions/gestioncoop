// Base PostgreSQL local para desarrollo, propia del proyecto (no toca otras instalaciones).
// Usa los programas de PostgreSQL instalados en la PC y guarda los datos en api/.data/pg.
// Se ejecuta solo al hacer `npm run dev`. Uso manual: node scripts/db.mjs start | stop | status
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const API_DIR = resolve(import.meta.dirname, '..');
const DATA_DIR = join(API_DIR, '.data', 'pg');
const LOG_FILE = join(API_DIR, '.data', 'pg.log');
const PORT = '5440';
const USER = 'coopgestion';
const PASSWORD = 'coopgestion_dev';
// La segunda es la base de los tests (npm test): se vacía en cada corrida.
const DATABASES = ['coopgestion', 'coopgestion_test'];

/** Si .env apunta a otra base (Docker, Railway, etc.), este script no hace nada. */
function usesLocalDb() {
  const envFile = join(API_DIR, '.env');
  const url = process.env.DATABASE_URL ?? (existsSync(envFile) ? readFileSync(envFile, 'utf8').match(/^DATABASE_URL=(.*)$/m)?.[1] : '');
  return !url || new RegExp(`@(localhost|127\\.0\\.0\\.1):${PORT}/`).test(url);
}

function findBin() {
  if (process.env.PG_BIN) return process.env.PG_BIN;
  const base = 'C:\\Program Files\\PostgreSQL';
  if (process.platform === 'win32' && existsSync(base)) {
    const versions = readdirSync(base)
      .filter((v) => existsSync(join(base, v, 'bin', 'pg_ctl.exe')))
      .sort((a, b) => Number(b) - Number(a));
    if (versions.length) return join(base, versions[0], 'bin');
  }
  return ''; // confiar en el PATH
}

const BIN = findBin();
const exe = (name) => (BIN ? join(BIN, process.platform === 'win32' ? `${name}.exe` : name) : name);

function run(name, args, opts = {}) {
  const r = spawnSync(exe(name), args, {
    // 'ignore' para pg_ctl start: el servidor hereda la salida y, si fuera un pipe, spawnSync esperaría para siempre.
    stdio: opts.detached ? 'ignore' : opts.quiet ? 'pipe' : 'inherit',
    env: { ...process.env, PGPASSWORD: PASSWORD },
    encoding: 'utf8',
  });
  if (r.error) {
    if (r.error.code === 'ENOENT') {
      console.error('✗ No encontré los programas de PostgreSQL. Instalalo o definí PG_BIN con la carpeta "bin".');
      process.exit(1);
    }
    throw r.error;
  }
  return r;
}

const portInUse = () =>
  new Promise((ok) => {
    const s = createConnection({ host: '127.0.0.1', port: Number(PORT) });
    s.once('connect', () => (s.destroy(), ok(true)));
    s.once('error', () => ok(false));
  });

function isRunning() {
  if (!existsSync(join(DATA_DIR, 'PG_VERSION'))) return false;
  return run('pg_ctl', ['-D', DATA_DIR, 'status'], { quiet: true }).status === 0;
}

function init() {
  if (existsSync(join(DATA_DIR, 'PG_VERSION'))) return false;
  console.log(`→ Creando la base local en ${DATA_DIR}`);
  mkdirSync(DATA_DIR, { recursive: true });
  const pwfile = join(tmpdir(), `coopgestion-pw-${process.pid}.txt`);
  writeFileSync(pwfile, PASSWORD);
  try {
    const r = run('initdb', ['-D', DATA_DIR, '-U', USER, '--auth=scram-sha-256', `--pwfile=${pwfile}`, '-E', 'UTF8', '--no-locale'], { quiet: true });
    if (r.status !== 0) throw new Error(`initdb falló:\n${r.stderr}`);
  } finally {
    rmSync(pwfile, { force: true });
  }
  return true;
}

function ensureDatabases() {
  for (const db of DATABASES) {
    const exists = run('psql', ['-h', 'localhost', '-p', PORT, '-U', USER, '-d', 'postgres', '-tAc', `SELECT 1 FROM pg_database WHERE datname='${db}'`], { quiet: true });
    if (String(exists.stdout).trim().startsWith('1')) continue;
    console.log(`→ Creando la base de datos "${db}"`);
    if (run('createdb', ['-h', 'localhost', '-p', PORT, '-U', USER, db]).status !== 0) process.exit(1);
  }
}

async function start() {
  if (!usesLocalDb()) return console.log('· DATABASE_URL apunta a otra base: no se inicia la base local');
  if (isRunning()) {
    ensureDatabases();
    return console.log(`✓ Base local corriendo (puerto ${PORT})`);
  }
  if (await portInUse()) return console.log(`✓ Ya hay una base escuchando en el puerto ${PORT} (por ejemplo, Docker)`);
  init();
  console.log(`→ Iniciando la base local (puerto ${PORT})`);
  const r = run('pg_ctl', ['-D', DATA_DIR, '-l', LOG_FILE, '-o', `-p ${PORT} -c listen_addresses=localhost`, '-w', 'start'], { detached: true });
  if (r.status !== 0) {
    console.error(`✗ No se pudo iniciar PostgreSQL. Revisá ${LOG_FILE}`);
    process.exit(1);
  }
  ensureDatabases();
  console.log(`✓ Base local corriendo (puerto ${PORT})`);
}

function stop() {
  if (!isRunning()) return console.log('La base local no está corriendo');
  run('pg_ctl', ['-D', DATA_DIR, '-m', 'fast', 'stop']);
}

const cmd = process.argv[2];
if (cmd === 'start') await start();
else if (cmd === 'stop') stop();
else if (cmd === 'status') console.log(isRunning() ? `corriendo (puerto ${PORT})` : 'detenida');
else {
  console.log('Uso: node scripts/db.mjs start | stop | status');
  process.exit(1);
}
