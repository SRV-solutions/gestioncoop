import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { CloudUpload, RefreshCw, TriangleAlert, Wifi, WifiOff } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { cn } from '../lib/cn';
import { CONTENIDO, SaltarAlContenido } from '../lib/pagina';
import { useOnline } from '../lib/useOnline';
import { iniciarAlmacen, sincronizar, useCola } from '../features/operario/almacen';
import { UserMenu } from './UserMenu';

/**
 * Área del operario: se usa en la calle, con una mano y al sol. Alto contraste, botones enormes
 * e indicador permanente de conexión y de lecturas pendientes de enviar (SPEC 5).
 */
export function OperarioLayout() {
  const { me } = useAuth();
  const online = useOnline();
  const location = useLocation();
  const cola = useCola();
  const userId = me?.user.id;

  // Abre lo guardado en este teléfono para esta persona y manda lo que haya quedado pendiente.
  useEffect(() => {
    if (userId != null) void iniciarAlmacen(userId);
  }, [userId]);

  if (!me) return null;

  const nada = cola.pendientes === 0;
  return (
    <div className="flex min-h-dvh flex-col bg-fondo">
      <SaltarAlContenido />
      <header className="sobre-oscuro sticky top-0 z-30 bg-barra text-white">
        <div className="mx-auto flex h-14 w-full max-w-xl items-center gap-3 px-4">
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs text-white/70">{me.cooperativa?.nombreCorto}</p>
            <p className="truncate text-lg font-bold leading-tight">Lecturas</p>
          </div>
          <UserMenu onDark compact />
        </div>
        <div
          role="status"
          className={cn(
            'flex min-h-11 items-center justify-center gap-4 px-4 text-sm font-bold',
            online ? (nada ? 'bg-exito text-sobre-estado' : 'bg-marca text-white') : 'bg-acento text-sobre-acento',
          )}
        >
          <span className="flex items-center gap-2">
            {online ? <Wifi className="size-4" aria-hidden /> : <WifiOff className="size-4" aria-hidden />}
            {online ? 'Con señal' : 'Sin señal: se guarda en el teléfono'}
          </span>
          {/* Con algo por enviar, tocar acá fuerza el envío. */}
          <button type="button" disabled={nada || !online || cola.enviando} onClick={() => void sincronizar()} className="flex min-h-11 items-center gap-2 disabled:cursor-default">
            {cola.enviando ? <RefreshCw className="size-4 animate-spin" aria-hidden /> : <CloudUpload className="size-4" aria-hidden />}
            {cola.enviando ? 'Enviando…' : nada ? 'Todo enviado' : `${cola.pendientes} por enviar`}
          </button>
          {cola.rechazadas > 0 && (
            <span className="flex items-center gap-1.5">
              <TriangleAlert className="size-4" aria-hidden />
              {cola.rechazadas}
            </span>
          )}
        </div>
      </header>

      {/* `animate-entrar` solo cambia la opacidad: con movimiento, las barras fijas de adentro quedarían mal ubicadas. */}
      <main id={CONTENIDO} tabIndex={-1} key={location.pathname} className="mx-auto w-full max-w-xl flex-1 animate-entrar px-4 py-4 outline-none">
        <Outlet />
      </main>
    </div>
  );
}
