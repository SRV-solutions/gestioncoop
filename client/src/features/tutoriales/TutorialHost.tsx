// Motor de los tutoriales de Solvix. Se monta una sola vez, en App.
//  - La primera vez que alguien entra, Solvix se presenta solo (si no lo hizo ni lo omitió antes).
//  - Cada paso lleva a su pantalla, ilumina el elemento y Solvix lo explica. Se puede omitir siempre.
//  - Al terminar, ofrece el siguiente tutorial de ese rol: se aprende de a poco.
//  - La lista completa se abre desde el menú del usuario → Tutoriales.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { CirclePlay, RotateCcw } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { Modal } from '../../components/Modal';
import { Badge, Button } from '../../components/ui';
import { Solvix } from './Solvix';
import { tutorialesPara, type Destino, type Tutorial } from './catalogo';
import { cerrarTutorial, cerrarTutoriales, hayTutorialAbierto, iniciarTutorial, irAlPaso, useAvance, useTutoriales } from './estado';

/* ───────────── Ubicar el elemento a señalar ───────────── */

const aLaVista = (el: HTMLElement) => {
  if (el.closest('.tour-globo')) return false;
  const r = el.getBoundingClientRect();
  // Con tamaño y dentro de la pantalla a lo ancho (el menú del celular, cerrado, queda afuera).
  return r.width > 0 && r.height > 0 && r.right > 0 && r.left < window.innerWidth && getComputedStyle(el).visibility !== 'hidden';
};

function buscar(destino: Destino | undefined): HTMLElement | null {
  if (!destino) return null;
  let lista: HTMLElement[];
  try {
    lista = [...document.querySelectorAll<HTMLElement>(destino.selector)].filter(aLaVista);
  } catch {
    return null;
  }
  if (destino.texto) lista = lista.filter((el) => (el.textContent ?? '').includes(destino.texto!));
  // Gana el más específico (el de texto más corto): «Pagar» antes que «Pagar todo lo vencido».
  return lista.sort((a, b) => (a.textContent?.length ?? 0) - (b.textContent?.length ?? 0))[0] ?? null;
}

const MARGEN = 6;
const ANCHO = 380;
/** Alto que se le reserva al globo para decidir si entra arriba o abajo del elemento. */
const ALTO = 270;

/** Dónde va el globo: junto al elemento si entra; si no, donde no lo tape. */
function ubicar(rect: DOMRect | null): CSSProperties {
  const { innerWidth: vw, innerHeight: vh } = window;
  if (vw < 700) {
    // Celular: ocupa el ancho. Va abajo, salvo que el elemento esté en la mitad de abajo.
    const abajo = !rect || rect.top + rect.height / 2 < vh / 2;
    return abajo ? { left: 12, right: 12, bottom: 'calc(env(safe-area-inset-bottom) + 76px)' } : { left: 12, right: 12, top: 12 };
  }
  const ancho = Math.min(ANCHO, vw - 24);
  if (!rect) return { left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: ancho };
  // Elemento alto (el menú lateral): el globo va al costado.
  if (rect.height > vh * 0.5) {
    const derecha = rect.right + ancho + 32 < vw;
    return { top: Math.max(12, Math.min(rect.top + 40, vh - ALTO - 12)), width: ancho, ...(derecha ? { left: rect.right + MARGEN + 14 } : { right: 16 }) };
  }
  const left = Math.min(Math.max(12, rect.left + rect.width / 2 - ancho / 2), vw - ancho - 12);
  if (vh - rect.bottom > ALTO) return { top: rect.bottom + MARGEN + 14, left, width: ancho };
  if (rect.top > ALTO) return { bottom: vh - rect.top + MARGEN + 14, left, width: ancho };
  return { bottom: 16, left, width: ancho };
}

/* ───────────── Un paso ───────────── */

interface PasoProps {
  tutorial: Tutorial;
  indice: number;
  siguiente: Tutorial | null;
  onOmitir: () => void;
  onTerminar: () => void;
  onSeguir: () => void;
}

/** Se monta de nuevo en cada paso (va con `key`): así arranca limpio, sin el foco del paso anterior. */
function Paso({ tutorial, indice, siguiente, onOmitir, onTerminar, onSeguir }: PasoProps) {
  const paso = tutorial.pasos[indice]!;
  const ultimo = indice === tutorial.pasos.length - 1;
  const navigate = useNavigate();
  const location = useLocation();
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [buscando, setBuscando] = useState(!!paso.destino);
  const principal = useRef<HTMLButtonElement>(null);

  // Ir a la pantalla del paso.
  useEffect(() => {
    if (paso.ruta && location.pathname !== paso.ruta) navigate(paso.ruta);
    // Solo al entrar al paso: si después la persona navega, no se la trae de vuelta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // El foco va al botón principal: se puede seguir el tutorial entero con Enter.
  useEffect(() => {
    principal.current?.focus({ preventScroll: true });
  }, []);

  // Buscar el elemento (la pantalla puede tardar en cargar) y seguirlo si se mueve.
  useEffect(() => {
    if (!paso.destino) return;
    let el: HTMLElement | null = null;
    let intentos = 0;
    let espera: ReturnType<typeof setTimeout> | undefined;
    const medir = () => {
      // Si la pantalla se redibujó y el elemento ya no es el mismo, se lo busca de nuevo.
      if (el && !document.contains(el)) el = buscar(paso.destino);
      setRect(el ? el.getBoundingClientRect() : null);
    };
    const busqueda = setInterval(() => {
      // Mientras no cargó la pantalla del paso no se busca: se encontraría algo de la anterior.
      const enSuPantalla = !paso.ruta || window.location.pathname === paso.ruta;
      el = enSuPantalla ? buscar(paso.destino) : null;
      if (!el && ++intentos <= 25) return;
      clearInterval(busqueda);
      setBuscando(false);
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        espera = setTimeout(medir, 350);
      }
    }, 160);
    const seguimiento = setInterval(medir, 600);
    window.addEventListener('resize', medir);
    window.addEventListener('scroll', medir, true);
    return () => {
      clearInterval(busqueda);
      clearInterval(seguimiento);
      clearTimeout(espera);
      window.removeEventListener('resize', medir);
      window.removeEventListener('scroll', medir, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const celular = window.innerWidth < 700;
  const noEsta = paso.destino && !paso.destino.opcional && !rect && !buscando;

  return (
    <div className="tour-capa" aria-live="polite">
      {rect ? (
        <div className="tour-foco" style={{ top: rect.top - MARGEN, left: rect.left - MARGEN, width: rect.width + MARGEN * 2, height: rect.height + MARGEN * 2 }} />
      ) : (
        <div className="tour-velo" />
      )}
      <div className="tour-globo" style={ubicar(rect)} role="dialog" aria-label={`Tutorial: ${tutorial.titulo}`}>
        <div className="flex items-start gap-3">
          <div className="-mt-1 shrink-0">
            <Solvix pose={paso.pose ?? 'quieto'} size={celular ? 60 : 76} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-tinta-suave">
              {tutorial.titulo} · {indice + 1} de {tutorial.pasos.length}
            </p>
            <p className="mt-1 text-base font-bold leading-snug text-tinta">{paso.titulo}</p>
            <p className="mt-1 text-[0.9375rem] leading-relaxed text-tinta">{paso.texto}</p>
            {noEsta && <p className="mt-2 text-sm text-tinta-suave">No lo veo en esta pantalla: puede estar más abajo.</p>}
          </div>
        </div>
        <div className="tour-puntos" aria-hidden>
          {tutorial.pasos.map((_p, i) => (
            <span key={i} className={i === indice ? 'activo' : undefined} />
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {!ultimo && (
            <Button variant="ghost" className="mr-auto" onClick={onOmitir}>
              Omitir
            </Button>
          )}
          {indice > 0 && (
            <Button variant="ghost" onClick={() => irAlPaso(indice - 1)}>
              Atrás
            </Button>
          )}
          {!ultimo && (
            <Button ref={principal} onClick={() => irAlPaso(indice + 1)}>
              Siguiente
            </Button>
          )}
          {ultimo && (
            <Button ref={siguiente ? undefined : principal} variant={siguiente ? 'ghost' : 'primary'} onClick={onTerminar}>
              Terminar
            </Button>
          )}
          {ultimo && siguiente && (
            <Button ref={principal} onClick={onSeguir}>
              Seguir: {siguiente.titulo}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ───────────── La lista (menú del usuario → Tutoriales) ───────────── */

function Lista({ lista, onCerrar }: { lista: Tutorial[]; onCerrar: () => void }) {
  const { avance, reiniciar } = useAvance();
  const hechos = lista.filter((t) => avance.hechos.includes(t.id)).length;
  return (
    <Modal title="Tutoriales con Solvix" onClose={onCerrar}>
      <div className="flex items-center gap-4">
        <Solvix pose="saluda" size={64} />
        <div className="min-w-0 flex-1">
          <p className="text-tinta">Te muestro dónde tocar para hacer cada cosa.</p>
          <p className="mt-0.5 text-sm text-tinta-suave">
            Hiciste {hechos} de {lista.length}.
          </p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-fondo" role="progressbar" aria-valuemin={0} aria-valuemax={lista.length} aria-valuenow={hechos} aria-label="Tutoriales hechos">
            <div className="h-full rounded-full bg-marca transition-[width] duration-200" style={{ width: `${(hechos / Math.max(1, lista.length)) * 100}%` }} />
          </div>
        </div>
      </div>
      <ul className="mt-5 divide-y divide-linea rounded-2xl border border-linea">
        {lista.map((t) => {
          const hecho = avance.hechos.includes(t.id);
          const omitido = !hecho && avance.omitidos.includes(t.id);
          return (
            <li key={t.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-bold text-tinta">
                  {t.titulo}
                  {hecho ? <Badge tone="exito">Hecho</Badge> : omitido ? <Badge>Omitido</Badge> : <Badge tone="marca">Nuevo</Badge>}
                </p>
                <p className="text-sm text-tinta-suave">{t.descripcion}</p>
              </div>
              <Button variant="secondary" icon={CirclePlay} onClick={() => iniciarTutorial(t.id)} aria-label={`${hecho ? 'Repasar' : 'Ver'}: ${t.titulo}`}>
                {hecho ? 'Repasar' : 'Ver'}
              </Button>
            </li>
          );
        })}
      </ul>
      {(avance.hechos.length > 0 || avance.omitidos.length > 0) && (
        <Button variant="ghost" icon={RotateCcw} className="mt-3" onClick={reiniciar}>
          Empezar de cero
        </Button>
      )}
    </Modal>
  );
}

/* ───────────── Anfitrión ───────────── */

/** Pantallas donde Solvix no se presenta solo: la persona está en medio de un pago. */
const SIN_PRESENTACION = /^\/(login|pagar|pasarela|socio\/pagar|socio\/pago)(\/|$)/;

export function TutorialHost() {
  const { me } = useAuth();
  const { actual, lista } = useTutoriales();
  const { cargado, avance, marcar } = useAvance();
  const location = useLocation();
  const navigate = useNavigate();
  const presentado = useRef<number | null>(null);
  const mios = tutorialesPara(me);
  const userId = me?.user.id ?? null;
  const tieneBienvenida = mios.some((t) => t.id === 'bienvenida');
  const yaLaVio = avance.hechos.includes('bienvenida') || avance.omitidos.includes('bienvenida');

  // Un enlace con ?tutorial=id abre ese tutorial y limpia la dirección.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const id = params.get('tutorial');
    if (!id || userId === null) return;
    params.delete('tutorial');
    navigate(`${location.pathname}${params.size ? `?${params}` : ''}`, { replace: true });
    iniciarTutorial(id);
  }, [location.search, location.pathname, navigate, userId]);

  // Primera vez: Solvix se presenta solo, un momento después de que cargó la pantalla.
  useEffect(() => {
    if (userId === null || !cargado || !tieneBienvenida || presentado.current === userId) return;
    if (SIN_PRESENTACION.test(location.pathname)) return;
    presentado.current = userId;
    if (yaLaVio) return;
    const espera = setTimeout(() => !hayTutorialAbierto() && iniciarTutorial('bienvenida'), 1200);
    return () => clearTimeout(espera);
  }, [userId, cargado, tieneBienvenida, yaLaVio, location.pathname]);

  // Al salir de la cuenta, nada queda abierto para quien entre después.
  useEffect(() => {
    if (userId === null) {
      cerrarTutorial();
      cerrarTutoriales();
    }
  }, [userId]);

  if (!me || mios.length === 0) return null;
  const tutorial = actual ? mios.find((t) => t.id === actual.id) : undefined;

  if (tutorial && actual) {
    const indice = Math.min(actual.paso, tutorial.pasos.length - 1);
    const siguiente = mios.find((t) => t.id !== tutorial.id && !avance.hechos.includes(t.id) && !avance.omitidos.includes(t.id)) ?? null;
    return (
      <Paso
        key={`${tutorial.id}:${indice}`}
        tutorial={tutorial}
        indice={indice}
        siguiente={siguiente}
        onOmitir={() => {
          marcar(tutorial.id, 'omitido');
          cerrarTutorial();
        }}
        onTerminar={() => {
          marcar(tutorial.id, 'hecho');
          cerrarTutorial();
        }}
        onSeguir={() => {
          marcar(tutorial.id, 'hecho');
          if (siguiente) iniciarTutorial(siguiente.id);
        }}
      />
    );
  }
  return lista ? <Lista lista={mios} onCerrar={cerrarTutoriales} /> : null;
}
