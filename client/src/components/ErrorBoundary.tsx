// Red de contención: si una pantalla se rompe por un error nuestro, la persona ve un mensaje humano
// y cómo seguir, nunca una pantalla en blanco ni un texto técnico (SPEC 5 y 12). El detalle va a la consola.
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { RefreshCw, TriangleAlert } from 'lucide-react';

interface Props {
  /** Cambia con cada pantalla: al navegar, el error se olvida y se vuelve a intentar. */
  pantalla: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
  pantalla: string;
}

/** Después de publicar una versión nueva, una pestaña vieja pide archivos que ya no existen. */
const esVersionVieja = (e: Error) => /dynamically imported module|Importing a module script failed|Failed to fetch/i.test(e.message);

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, pantalla: this.props.pantalla };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.pantalla === state.pantalla ? null : { error: null, pantalla: props.pantalla };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[pantalla rota]', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const vieja = esVersionVieja(error);
    return (
      <div role="alert" className="grid min-h-dvh place-items-center bg-fondo px-6 py-12">
        <div className="flex max-w-md flex-col items-center text-center">
          <div className="grid size-14 place-items-center rounded-2xl bg-peligro-tenue text-peligro">
            <TriangleAlert className="size-7" aria-hidden />
          </div>
          <h1 className="mt-4 text-xl font-bold text-tinta">{vieja ? 'Hay una versión nueva' : 'Esta pantalla tuvo un problema'}</h1>
          <p className="mt-2 text-tinta-suave">
            {vieja ? 'Volvé a cargar la página para seguir con la versión actualizada.' : 'No es algo que hayas hecho vos, y lo que ya guardaste no se perdió. Volvé a cargar la página; si sigue pasando, avisale a la cooperativa.'}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button type="button" onClick={() => window.location.reload()} className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-marca px-5 font-semibold text-white hover:bg-marca-fuerte">
              <RefreshCw className="size-4" aria-hidden />
              Volver a cargar
            </button>
            <a href="/" className="inline-flex min-h-12 items-center rounded-xl border border-linea bg-superficie px-5 font-semibold text-tinta hover:border-marca">
              Ir al inicio
            </a>
          </div>
        </div>
      </div>
    );
  }
}
