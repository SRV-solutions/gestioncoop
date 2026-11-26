import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// El código compartido con la API (roles, validaciones, formato, tipos) vive en api/src/shared
// y se importa como '@shared'. Así no hay copias que mantener sincronizadas.
const SHARED = here('../api/src/shared');

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@shared': SHARED },
    // zod se toma siempre de client/node_modules, aunque lo importe un archivo de api/src/shared
    dedupe: ['zod'],
  },
  server: {
    port: 5180,
    strictPort: true,
    fs: { allow: [here('.'), SHARED] },
    // En desarrollo, /api va a la API local (igual que Netlify en producción):
    // el navegador ve un solo dominio y las cookies funcionan sin CORS.
    proxy: {
      '/api': { target: 'http://localhost:4100', changeOrigin: false },
    },
  },
});
