import { useEffect } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { ChartColumn, Ellipsis, House, Receipt, type LucideIcon } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { cn } from '../lib/cn';
import { CONTENIDO, SaltarAlContenido } from '../lib/pagina';
import { CoopMark } from './Logo';
import { UserMenu } from './UserMenu';

// SPEC 5: barra inferior de 4 ítems y como máximo 2 niveles de navegación.
const TABS: { to: string; label: string; icon: LucideIcon; end?: boolean }[] = [
  { to: '/socio', label: 'Inicio', icon: House, end: true },
  { to: '/socio/facturas', label: 'Facturas', icon: Receipt },
  { to: '/socio/consumo', label: 'Consumo', icon: ChartColumn },
  { to: '/socio/mas', label: 'Más', icon: Ellipsis },
];

/** Portal del socio: pensado primero para el celular y para gente mayor. */
export function SocioLayout() {
  const { me } = useAuth();
  const location = useLocation();

  // Letra base de 18 px solo en esta área.
  useEffect(() => {
    document.documentElement.classList.add('letra-grande');
    return () => document.documentElement.classList.remove('letra-grande');
  }, []);

  if (!me) return null;
  const firstName = me.user.nombre.split(' ')[0];

  return (
    <div className="flex min-h-dvh flex-col">
      <SaltarAlContenido />
      <header className="sobre-oscuro bg-barra text-white">
        <div className="mx-auto flex h-16 w-full max-w-xl items-center gap-3 px-4">
          <CoopMark cooperativa={me.cooperativa} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs text-white/70">{me.cooperativa?.nombreCorto}</p>
            <p className="truncate font-bold leading-tight">Hola, {firstName}</p>
          </div>
          <UserMenu onDark compact />
        </div>
      </header>

      <main id={CONTENIDO} tabIndex={-1} key={location.pathname} className="mx-auto w-full max-w-xl flex-1 animate-aparecer px-4 pb-28 pt-5 outline-none">
        <Outlet />
      </main>

      <nav
        aria-label="Secciones"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-linea bg-superficie pb-[env(safe-area-inset-bottom)]"
      >
        <ul className="mx-auto grid max-w-xl grid-cols-4">
          {TABS.map((t) => (
            <li key={t.to}>
              <NavLink
                to={t.to}
                end={t.end}
                className={({ isActive }) =>
                  cn(
                    'flex min-h-16 flex-col items-center justify-center gap-1 text-xs font-semibold transition-colors duration-150',
                    isActive ? 'text-marca-texto' : 'text-tinta-suave hover:text-tinta',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span className={cn('grid h-8 w-14 place-items-center rounded-full transition-colors duration-150', isActive && 'bg-marca-tenue')}>
                      <t.icon className="size-5" aria-hidden />
                    </span>
                    {t.label}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
