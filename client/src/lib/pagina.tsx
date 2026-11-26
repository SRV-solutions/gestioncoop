// Accesibilidad de la navegación (SPEC 5: AA). Una app de una sola página no «carga» pantallas, así
// que hay que avisar a mano lo que un sitio común avisa solo:
// - el título de la pestaña dice en qué pantalla estás (sirve al lector de pantalla y al historial);
// - al cambiar de pantalla, el foco va al contenido nuevo en lugar de quedar en el menú;
// - el primer Tab de cada pantalla ofrece saltar el menú e ir derecho al contenido.
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { APP_NOMBRE } from '@shared';

/** Id del contenido principal de cada marco. */
export const CONTENIDO = 'contenido';

// De la más específica a la más general: gana la primera que coincide.
const TITULOS: [RegExp, string][] = [
  [/^\/login/, 'Ingresar'],
  [/^\/cooperativa/, 'Cooperativa'],
  [/^\/superadmin\/cooperativas\//, 'Comisión y factura'],
  [/^\/pagar\/resultado/, 'Resultado del pago'],
  [/^\/pagar/, 'Pagar una factura'],
  [/^\/pasarela/, 'Pago de prueba'],
  [/^\/socio\/facturas\/./, 'Tu factura'],
  [/^\/socio\/facturas/, 'Tus facturas'],
  [/^\/socio\/pagar/, 'Pagar'],
  [/^\/socio\/pago/, 'Tu pago'],
  [/^\/socio\/consumo/, 'Tu consumo'],
  [/^\/socio\/mas\/reclamos\/nuevo/, 'Nuevo reclamo'],
  [/^\/socio\/mas\/reclamos/, 'Tus reclamos'],
  [/^\/socio\/mas\/conexiones/, 'Tus conexiones'],
  [/^\/socio\/mas\/sepelio/, 'Sepelio'],
  [/^\/socio\/mas\/datos/, 'Tus datos'],
  [/^\/socio\/mas\/pagos/, 'Tus pagos'],
  [/^\/socio\/mas/, 'Más'],
  [/^\/socio/, 'Inicio'],
  [/^\/operario\/ruta\/[^/]+\/casa/, 'Cargar lectura'],
  [/^\/operario\/ruta/, 'Ruta de lectura'],
  [/^\/operario/, 'Lecturas'],
  [/^\/gerencia/, 'Tablero'],
  [/^\/mapa/, 'Mapa'],
  [/^\/padron/, 'Padrón'],
  [/^\/tarifas/, 'Tarifas'],
  [/^\/lecturas/, 'Lecturas'],
  [/^\/facturacion/, 'Facturación'],
  [/^\/caja/, 'Caja'],
  [/^\/reclamos/, 'Reclamos'],
  [/^\/informes/, 'Informes'],
  [/^\/admin/, 'Usuarios'],
  [/^\/superadmin/, 'Cooperativas'],
];

export function tituloDe(ruta: string): string {
  const nombre = TITULOS.find(([forma]) => forma.test(ruta))?.[1];
  return nombre ? `${nombre} · ${APP_NOMBRE}` : APP_NOMBRE;
}

/** Va una sola vez, arriba de las rutas. */
export function usePagina(): void {
  const { pathname } = useLocation();
  const anterior = useRef(pathname);
  useEffect(() => {
    document.title = tituloDe(pathname);
    if (anterior.current === pathname) return;
    anterior.current = pathname;
    // Si la pantalla nueva ya puso el foco en algo suyo (el buscador de la caja, un diálogo), se respeta.
    const activo = document.activeElement;
    const contenido = document.getElementById(CONTENIDO);
    if (contenido && (!activo || activo === document.body || !contenido.contains(activo))) contenido.focus({ preventScroll: true });
  }, [pathname]);
}

/** Primer elemento de cada marco: invisible hasta que recibe el foco con el teclado. */
export function SaltarAlContenido() {
  return (
    <a
      href={`#${CONTENIDO}`}
      onClick={(e) => {
        e.preventDefault();
        document.getElementById(CONTENIDO)?.focus();
      }}
      className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:left-3 focus-visible:top-3 focus-visible:z-[70] focus-visible:rounded-xl focus-visible:bg-marca focus-visible:px-4 focus-visible:py-3 focus-visible:font-semibold focus-visible:text-white"
    >
      Saltar al contenido
    </a>
  );
}
