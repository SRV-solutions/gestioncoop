import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Banknote, BookUser, Building2, ChartColumn, Coins, FileText, Gauge, LayoutDashboard, Map as MapIcon, Menu, MessageSquareWarning, Users, X, type LucideIcon } from 'lucide-react';
import type { Rol } from '@shared';
import { useAuth } from '../lib/auth';
import { cn } from '../lib/cn';
import { CONTENIDO, SaltarAlContenido } from '../lib/pagina';
import { CoopMark, NombreProducto, PoweredBy } from './Logo';
import { Button } from './ui';
import { UserMenu } from './UserMenu';

interface NavItem {
  /** Roles que habilitan la entrada. El superadmin, dentro de una cooperativa, las ve todas. */
  roles: Rol[];
  to: string;
  label: string;
  icon: LucideIcon;
}

// Cada fase suma sus pantallas acá.
const NAV: NavItem[] = [
  { roles: ['gerencia', 'admin'], to: '/gerencia', label: 'Tablero', icon: LayoutDashboard },
  { roles: ['gerencia', 'admin', 'facturacion'], to: '/mapa', label: 'Mapa', icon: MapIcon },
  { roles: ['admin', 'gerencia', 'facturacion', 'cajero'], to: '/padron', label: 'Padrón', icon: BookUser },
  { roles: ['admin', 'gerencia', 'facturacion'], to: '/tarifas', label: 'Tarifas', icon: Coins },
  { roles: ['admin', 'gerencia', 'facturacion'], to: '/lecturas', label: 'Lecturas', icon: Gauge },
  { roles: ['facturacion', 'admin', 'gerencia'], to: '/facturacion', label: 'Facturación', icon: FileText },
  { roles: ['cajero', 'admin', 'gerencia'], to: '/caja', label: 'Caja', icon: Banknote },
  { roles: ['admin', 'gerencia'], to: '/reclamos', label: 'Reclamos', icon: MessageSquareWarning },
  { roles: ['gerencia', 'admin', 'facturacion'], to: '/informes', label: 'Informes', icon: ChartColumn },
  { roles: ['admin'], to: '/admin/usuarios', label: 'Usuarios', icon: Users },
  { roles: ['gerencia', 'admin'], to: '/cooperativa', label: 'Cooperativa', icon: Building2 },
];

/** Marco de las áreas de escritorio: gerencia, facturación, caja, administración y proveedor. */
export function StaffLayout() {
  const { me, hasRole, setCooperativa } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);

  // En pantallas chicas el menú es un panel que se cierra al elegir una opción o con Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!me) return null;
  const cooperativa = me.cooperativa;
  const isSuperadmin = hasRole('superadmin');
  const items = cooperativa ? NAV.filter((i) => isSuperadmin || i.roles.some(hasRole)) : [];
  // El mapa ocupa toda la pantalla; el resto de las páginas va en una columna con márgenes.
  const fullBleed = location.pathname === '/mapa';
  // Un informe es una tabla de muchas columnas: usa todo el ancho en lugar de la columna angosta.
  const ancha = location.pathname.startsWith('/informes/');

  const leaveCooperativa = async () => {
    setLeaving(true);
    try {
      await setCooperativa(null);
      navigate('/superadmin');
    } finally {
      setLeaving(false);
    }
  };

  const link = ({ isActive }: { isActive: boolean }) =>
    cn(
      'flex min-h-11 items-center gap-3 rounded-xl px-3 text-[0.9375rem] font-semibold transition-colors duration-150',
      isActive ? 'bg-marca text-white' : 'text-white/80 hover:bg-white/10 hover:text-white',
    );

  return (
    <div className="min-h-dvh lg:pl-64">
      <SaltarAlContenido />
      {/* Barra superior: solo en pantallas chicas */}
      <div className="sobre-oscuro sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-barra-borde bg-barra px-3 text-white lg:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Abrir menú"
          aria-expanded={open}
          className="grid size-11 place-items-center rounded-xl hover:bg-white/10"
        >
          <Menu className="size-6" aria-hidden />
        </button>
        <span className="min-w-0 flex-1 truncate font-bold">{cooperativa?.nombreCorto ?? <NombreProducto />}</span>
        <UserMenu onDark compact />
      </div>

      {open && <div aria-hidden onClick={() => setOpen(false)} className="fixed inset-0 z-40 bg-black/50 lg:hidden" />}

      <aside
        className={cn(
          'sobre-oscuro fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-barra-borde bg-barra text-white transition-transform duration-200',
          'max-lg:shadow-2xl lg:translate-x-0',
          open ? 'translate-x-0' : 'max-lg:invisible max-lg:-translate-x-full',
        )}
      >
        <div className="flex items-center gap-3 px-4 pb-4 pt-5">
          <CoopMark cooperativa={cooperativa} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-bold leading-tight">{cooperativa?.nombreCorto ?? <NombreProducto />}</p>
            <p className="truncate text-xs text-white/65">{cooperativa?.localidad ?? 'Panel del proveedor'}</p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Cerrar menú"
            className="grid size-11 place-items-center rounded-xl hover:bg-white/10 lg:hidden"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>

        <nav aria-label="Principal" className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
          {items.map((i) => (
            <NavLink key={i.to} to={i.to} className={link} onClick={() => setOpen(false)}>
              <i.icon className="size-5 shrink-0" aria-hidden />
              {i.label}
            </NavLink>
          ))}
          {isSuperadmin && (
            <>
              {items.length > 0 && <div className="mx-3 my-3 h-px bg-white/15" />}
              <NavLink to="/superadmin" className={link} onClick={() => setOpen(false)}>
                <Building2 className="size-5 shrink-0" aria-hidden />
                Cooperativas
              </NavLink>
            </>
          )}
        </nav>

        <div className="space-y-3 border-t border-white/15 p-3">
          <UserMenu onDark className="hidden w-full lg:flex" />
          <PoweredBy onDark className="w-full" />
        </div>
      </aside>

      {fullBleed ? (
        <main id={CONTENIDO} tabIndex={-1} className="h-[calc(100dvh-3.5rem)] outline-none lg:h-dvh">
          <Outlet />
        </main>
      ) : (
        <div className={cn('w-full px-4 py-6 sm:px-6 lg:px-10 lg:py-9', ancha ? 'max-w-[110rem]' : 'max-w-6xl')}>
          {isSuperadmin && cooperativa && (
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-acento-tenue px-4 py-3">
              <p className="text-sm font-medium text-tinta">
                Estás viendo <strong>{cooperativa.nombreCorto}</strong> como soporte.
              </p>
              <Button variant="secondary" loading={leaving} onClick={() => void leaveCooperativa()}>
                Volver a cooperativas
              </Button>
            </div>
          )}
          <main id={CONTENIDO} tabIndex={-1} key={location.pathname} className="animate-aparecer outline-none">
            <Outlet />
          </main>
        </div>
      )}
    </div>
  );
}
