import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    globalSetup: ['tests/global-setup.ts'],
    // Todos los archivos comparten la base de tests: de a uno.
    fileParallelism: false,
    env: { NODE_ENV: 'test', DEMO_MODE: 'true', DEMO_ACCESO_RAPIDO: 'true', COOPERATIVA_POR_DEFECTO: 'coop-a', DOMINIO_BASE: 'coopgestion.test' },
    // Cobertura del motor de cálculo (SPEC sección 12: 95 % o más). Corre con `npm run test:motor`.
    coverage: {
      provider: 'v8',
      include: ['src/motor/**'],
      reporter: ['text'],
      thresholds: { lines: 95, statements: 95, functions: 95, branches: 95 },
    },
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
