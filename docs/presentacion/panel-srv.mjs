// Capturas del panel de SRV (para revisarlo; no van al material de la cooperativa).
// Entra como superadmin con los datos de api/.env, sin mostrarlos.
import { join } from 'node:path';
import { abrirChrome, esperar, SALIDA, variableDeEntorno } from './cdp.mjs';

const DESTINO = join(SALIDA, '..', 'GestionCoop - panel SRV (interno)');
const email = variableDeEntorno('SUPERADMIN_EMAIL');
const password = variableDeEntorno('SUPERADMIN_PASSWORD');
if (!email || !password) throw new Error('Faltan SUPERADMIN_EMAIL o SUPERADMIN_PASSWORD en api/.env');

const chrome = await abrirChrome({ ancho: 1440, alto: 900, escala: 1 });
let antes = null;
try {
  await chrome.ir('/login', 200);
  await chrome.evaluar(`localStorage.setItem('coopgestion-tema', 'light')`);
  await chrome.entrar({ email, password });
  // Es una cuenta real: se guarda su avance de tutoriales y se deja igual al terminar.
  const r = await chrome.api('GET', '/auth/tutoriales');
  if (r.estado !== 200) throw new Error(`Tutoriales: ${r.estado} ${r.cuerpo?.error?.code ?? ''}`);
  antes = r.cuerpo.data;
  await chrome.api('PUT', '/auth/tutoriales', { hechos: [...new Set([...antes.hechos, 'bienvenida'])], omitidos: antes.omitidos });
  await chrome.ir('/superadmin', 3000);
  await chrome.captura(join(DESTINO, 'panel-lista.png'));
  await chrome.evaluar(`window.scrollTo(0, 650)`);
  await esperar(600);
  await chrome.captura(join(DESTINO, 'panel-lista-tarjetas.png'));
  const lista = await chrome.api('GET', '/cooperativas');
  const dos = lista.cuerpo.data.find((c) => c.subdominio === 'dosdemayo');
  await chrome.ir(`/superadmin/cooperativas/${dos.id}`, 3000);
  await chrome.captura(join(DESTINO, 'panel-comision.png'));
  await chrome.evaluar(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Ver cómo queda')).click()`);
  await esperar(4000);
  await chrome.evaluar(`document.querySelector('iframe[title="Vista previa de la factura"]')?.scrollIntoView({ block: 'start' })`);
  await esperar(1500);
  await chrome.captura(join(DESTINO, 'panel-factura.png'));
  const errores = await chrome.evaluar(`[...document.querySelectorAll('[role=alert]')].map((e) => e.textContent)`);
  console.log('Avisos de error en pantalla:', JSON.stringify(errores));
  // La muestra, también como archivo, para mirarla.
  const pdf = await chrome.evaluar(`fetch('/api/v1/cooperativas/${dos.id}/factura/muestra', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(async (r) => { const b = new Uint8Array(await r.arrayBuffer()); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return { estado: r.status, b64: btoa(s) }; })`);
  const { writeFileSync, mkdirSync } = await import('node:fs');
  mkdirSync(DESTINO, { recursive: true });
  writeFileSync(join(DESTINO, 'muestra-factura.pdf'), Buffer.from(pdf.b64, 'base64'));
  console.log('Muestra', pdf.estado);
} finally {
  if (antes) await chrome.api('PUT', '/auth/tutoriales', antes).catch(() => {});
  await chrome.api('POST', '/auth/logout', {}).catch(() => {});
  await chrome.cerrar();
}
console.log(`Capturas en ${DESTINO}`);
