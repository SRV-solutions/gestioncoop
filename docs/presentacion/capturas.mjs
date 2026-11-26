// Capturas para la presentación y las imágenes del mail: tema claro, escritorio y celular.
// Uso (con la API y el cliente corriendo):  node docs/presentacion/capturas.mjs
// Antes de cada usuario se marca como vista la bienvenida de Solvix (para que no tape la pantalla) y al
// terminar se deja como estaba, así quien entre después la ve igual.
import { join } from 'node:path';
import { abrirChrome, DEMO, esperar, SALIDA } from './cdp.mjs';

const DESTINO = join(SALIDA, 'capturas');
const solo = process.argv.slice(2);
const toca = (grupo) => solo.length === 0 || solo.includes(grupo);

/** Escribe en un campo de React (dispara el evento que React escucha). */
const escribirEn = (selector, texto) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  const set = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set;
  set.call(el, ${JSON.stringify(texto)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
})()`;
const tocarTexto = (texto, selector = 'button, a') => `(() => {
  const el = [...document.querySelectorAll(${JSON.stringify(selector)})].filter((e) => e.offsetParent !== null).find((e) => e.textContent.trim().includes(${JSON.stringify(texto)}));
  if (!el) throw new Error('No encontré: ' + ${JSON.stringify(texto)});
  el.click();
})()`;

async function conTema(chrome) {
  await chrome.ir('/login', 200);
  await chrome.evaluar(`localStorage.setItem('coopgestion-tema', 'light'); localStorage.setItem('coopgestion-ingreso', 'socio')`);
}

async function sinBienvenida(chrome) {
  await chrome.api('PUT', '/auth/tutoriales', { hechos: ['bienvenida'], omitidos: [] });
}
async function restaurar(chrome) {
  await chrome.api('PUT', '/auth/tutoriales', { hechos: [], omitidos: [] });
  await chrome.api('POST', '/auth/logout', {});
}

/* ───────────────────────── Escritorio ───────────────────────── */

async function escritorio() {
  const chrome = await abrirChrome({ ancho: 1440, alto: 900, escala: 1.5 });
  try {
    await conTema(chrome);
    await chrome.ir('/login', 1500);
    await chrome.captura(join(DESTINO, 'pc-ingreso.png'));

    // Gerencia: tablero, informe de deuda y mapa.
    await chrome.entrar({ email: `gerencia@${DEMO.dominio}`, password: DEMO.clave });
    await sinBienvenida(chrome);
    await chrome.ir('/gerencia', 3500);
    await chrome.captura(join(DESTINO, 'pc-tablero.png'));
    await chrome.evaluar(`window.scrollTo(0, 820)`);
    await esperar(800);
    await chrome.captura(join(DESTINO, 'pc-tablero-graficos.png'));
    await chrome.ir('/informes/deuda', 3000);
    await chrome.captura(join(DESTINO, 'pc-informe-deuda.png'));
    // El mapa baja calles y relieve: hay que darle tiempo (y otro tanto al pasar de noche a día).
    await chrome.ir('/mapa', 16_000);
    // De día, para que se vean bien las calles.
    await chrome.evaluar(`(() => {
      const r = document.querySelector('input[type=range][aria-label="Hora del día"]');
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      set.call(r, '13');
      r.dispatchEvent(new Event('input', { bubbles: true }));
      r.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await esperar(12_000);
    await chrome.captura(join(DESTINO, 'pc-mapa.png'));
    await chrome.evaluar(`(() => {
      const r = document.querySelector('input[type=range][aria-label="Hora del día"]');
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      set.call(r, '21.5');
      r.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await esperar(12_000);
    await chrome.captura(join(DESTINO, 'pc-mapa-noche.png'));
    await restaurar(chrome);

    // Facturación y lecturas.
    await chrome.entrar({ email: `facturacion@${DEMO.dominio}`, password: DEMO.clave });
    await sinBienvenida(chrome);
    await chrome.ir('/facturacion', 3000);
    await chrome.captura(join(DESTINO, 'pc-facturacion.png'));
    await chrome.ir('/lecturas', 3000);
    await chrome.captura(join(DESTINO, 'pc-lecturas.png'));
    await chrome.ir('/tarifas', 2500);
    await chrome.captura(join(DESTINO, 'pc-tarifas.png'));
    await restaurar(chrome);

    // Administración: reclamos. (Las cajas no: pueden mostrar cajas de prueba de personas reales.)
    await chrome.entrar({ email: `admin@${DEMO.dominio}`, password: DEMO.clave });
    await sinBienvenida(chrome);
    await chrome.ir('/reclamos', 3000);
    await chrome.captura(join(DESTINO, 'pc-reclamos.png'));
    await restaurar(chrome);
  } finally {
    await chrome.cerrar();
  }
}

/* ───────────────────────── Celular: socio ───────────────────────── */

async function socio() {
  const chrome = await abrirChrome({ ancho: 390, alto: 844, escala: 2, movil: true });
  try {
    await conTema(chrome);
    await chrome.ir('/login', 1500);
    await chrome.evaluar(escribirEn('input[inputmode=numeric]', DEMO.socio.socio));
    await chrome.captura(join(DESTINO, 'cel-ingreso.png'));
    await chrome.entrar(DEMO.socio);
    await sinBienvenida(chrome);
    await chrome.ir('/socio', 3000);
    await chrome.captura(join(DESTINO, 'cel-inicio.png'));
    const facturas = await chrome.api('GET', '/socio/facturas');
    const energia = facturas.cuerpo.data.filas.find((f) => f.servicio === 'energia');
    await chrome.ir(`/socio/facturas/${energia.id}`, 3000);
    await chrome.evaluar(`(() => { const h = [...document.querySelectorAll('h2')].find((x) => x.textContent.includes('Por qué')); window.scrollTo(0, h.getBoundingClientRect().top + window.scrollY - 70); })()`);
    await esperar(800);
    await chrome.captura(join(DESTINO, 'cel-por-que.png'));
    await chrome.ir('/socio/pagar', 2500);
    await chrome.captura(join(DESTINO, 'cel-pagar.png'));
    await chrome.ir('/socio/consumo', 3000);
    await chrome.captura(join(DESTINO, 'cel-consumo.png'));
    await chrome.ir('/socio/mas/reclamos/nuevo', 2500);
    await chrome.captura(join(DESTINO, 'cel-reclamo.png'));
    await restaurar(chrome);
  } finally {
    await chrome.cerrar();
  }
}

/* ───────────────────────── Celular: operario ───────────────────────── */

async function operario() {
  const chrome = await abrirChrome({ ancho: 390, alto: 844, escala: 2, movil: true });
  try {
    await conTema(chrome);
    await chrome.entrar({ email: `operario@${DEMO.dominio}`, password: DEMO.clave });
    await sinBienvenida(chrome);
    await chrome.ir('/operario', 3500);
    await chrome.captura(join(DESTINO, 'cel-operario-rutas.png'));
    await chrome.ir('/operario/ruta/10', 3000);
    // El recorrido lo arma la app saliendo de una calle (queda solo en este teléfono de prueba).
    await chrome.evaluar(tocarTexto('Recorrido'));
    await esperar(700);
    await chrome.evaluar(tocarTexto('Colonia 2 de Mayo', '[role=dialog] button'));
    await esperar(800);
    await chrome.captura(join(DESTINO, 'cel-operario-propuesta.png'));
    await chrome.evaluar(tocarTexto('Usar este recorrido', '[role=dialog] button'));
    await esperar(800);
    await chrome.captura(join(DESTINO, 'cel-operario-ruta.png'));
    await chrome.evaluar(tocarTexto('Mapa'));
    await esperar(9000);
    await chrome.captura(join(DESTINO, 'cel-operario-mapa.png'));
    await chrome.evaluar(tocarTexto('Empezar por'));
    await esperar(2500);
    for (const d of '4521') {
      await chrome.evaluar(tocarTexto(d, 'button'));
      await esperar(150);
    }
    await esperar(500);
    await chrome.captura(join(DESTINO, 'cel-operario-casa.png'));
    await restaurar(chrome);
  } finally {
    await chrome.cerrar();
  }
}

if (toca('escritorio')) await escritorio();
if (toca('socio')) await socio();
if (toca('operario')) await operario();
console.log(`Capturas en ${DESTINO}`);
