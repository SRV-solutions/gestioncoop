import * as Dropdown from '@radix-ui/react-dropdown-menu';
import { ChevronDown, GraduationCap, LogOut, Monitor, Moon, Sun, Users, type LucideIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { initials, ROL_ETIQUETA, ROL_RUTA, type Rol } from '@shared';
import { useAuth } from '../lib/auth';
import { cn } from '../lib/cn';
import { useTema, type PreferenciaTema } from '../lib/theme';
import { tutorialesPara } from '../features/tutoriales/catalogo';
import { abrirTutoriales } from '../features/tutoriales/estado';

const TEMAS: { valor: PreferenciaTema; nombre: string; icono: LucideIcon }[] = [
  { valor: 'light', nombre: 'Claro', icono: Sun },
  { valor: 'dark', nombre: 'Oscuro', icono: Moon },
  { valor: 'system', nombre: 'Auto', icono: Monitor },
];

interface Props {
  /** Sobre barras oscuras (operario, lateral del personal). */
  onDark?: boolean;
  /** Solo el avatar, sin nombre (barras angostas). */
  compact?: boolean;
  className?: string;
}

const item =
  'flex min-h-11 cursor-pointer select-none items-center gap-3 rounded-lg px-3 text-[0.9375rem] font-medium text-tinta outline-none data-[highlighted]:bg-marca-tenue data-[highlighted]:text-marca-texto';

function MenuItem({ icon: Icon, onSelect, children }: { icon?: LucideIcon; onSelect: () => void; children: string }) {
  return (
    <Dropdown.Item className={item} onSelect={onSelect}>
      {Icon && <Icon className="size-4 shrink-0" aria-hidden />}
      {children}
    </Dropdown.Item>
  );
}

/** Menú del usuario: quién es, cambio de área si tiene varios roles, y salir. */
export function UserMenu({ onDark, compact, className }: Props) {
  const { me, logout } = useAuth();
  const navigate = useNavigate();
  const { preferencia, elegir } = useTema();
  if (!me) return null;

  // Quien tiene más de un rol puede saltar de un área a otra (por ejemplo, de Caja a su portal de socio).
  const areas: Rol[] = me.user.roles.filter((r) => r !== 'superadmin');
  const showAreas = areas.length > 1;
  const soloSocio = me.user.roles.every((r) => r === 'socio');

  return (
    <Dropdown.Root>
      <Dropdown.Trigger
        aria-label={`Menú de ${me.user.nombre}`}
        className={cn(
          'flex min-h-11 items-center gap-2.5 rounded-xl px-1.5 text-left transition-colors duration-150',
          onDark ? 'sobre-oscuro text-white hover:bg-white/10' : 'text-tinta hover:bg-marca-tenue',
          className,
        )}
      >
        <span
          aria-hidden
          className={cn(
            'grid size-9 shrink-0 place-items-center rounded-full text-sm font-bold',
            onDark ? 'bg-white/15 text-white' : 'bg-marca-tenue text-marca-texto',
          )}
        >
          {initials(me.user.nombre)}
        </span>
        {!compact && (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold leading-tight">{me.user.nombre}</span>
            <span className={cn('block truncate text-xs leading-tight', onDark ? 'text-white/70' : 'text-tinta-suave')}>
              {me.user.roles.map((r) => ROL_ETIQUETA[r]).join(' · ')}
            </span>
          </span>
        )}
        <ChevronDown className={cn('size-4 shrink-0', onDark ? 'text-white/70' : 'text-tinta-suave')} aria-hidden />
      </Dropdown.Trigger>

      <Dropdown.Portal>
        <Dropdown.Content
          align="end"
          sideOffset={8}
          className="z-50 w-64 animate-aparecer rounded-2xl border border-linea bg-superficie p-1.5 shadow-xl shadow-black/10"
        >
          <div className="px-3 py-2">
            <p className="truncate text-sm font-bold text-tinta">{me.user.nombre}</p>
            <p className="truncate text-xs text-tinta-suave">{me.user.email ?? 'Entrás con los datos de tu factura'}</p>
          </div>
          {showAreas && (
            <>
              <Dropdown.Separator className="my-1 h-px bg-linea" />
              <Dropdown.Label className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-tinta-suave">
                Ir a
              </Dropdown.Label>
              {areas.map((rol) => (
                <MenuItem key={rol} onSelect={() => navigate(ROL_RUTA[rol])}>
                  {ROL_ETIQUETA[rol]}
                </MenuItem>
              ))}
            </>
          )}
          <Dropdown.Separator className="my-1 h-px bg-linea" />
          {/* El tema se elige acá y solo acá: muestra cuál está puesto y no cierra el menú al cambiarlo. */}
          <Dropdown.Label className="px-3 pb-1.5 pt-2 text-xs font-semibold uppercase tracking-wide text-tinta-suave">Apariencia</Dropdown.Label>
          <Dropdown.RadioGroup
            value={preferencia}
            onValueChange={(v) => elegir(v as PreferenciaTema)}
            className="mx-1.5 mb-1.5 grid grid-cols-3 gap-1 rounded-xl bg-fondo p-1"
          >
            {TEMAS.map((t) => (
              <Dropdown.RadioItem
                key={t.valor}
                value={t.valor}
                onSelect={(e) => e.preventDefault()}
                className={cn(
                  'flex min-h-11 cursor-pointer select-none flex-col items-center justify-center gap-0.5 rounded-lg text-xs font-semibold text-tinta-suave outline-none transition-colors duration-150',
                  'data-[highlighted]:text-tinta data-[state=checked]:bg-superficie data-[state=checked]:text-marca-texto data-[state=checked]:shadow-sm',
                  'focus-visible:ring-2 focus-visible:ring-marca',
                )}
              >
                <t.icono className="size-4" aria-hidden />
                {t.nombre}
              </Dropdown.RadioItem>
            ))}
          </Dropdown.RadioGroup>
          <Dropdown.Separator className="my-1 h-px bg-linea" />
          {tutorialesPara(me).length > 0 && (
            <MenuItem icon={GraduationCap} onSelect={abrirTutoriales}>
              Tutoriales
            </MenuItem>
          )}
          {/* El socio puede mirar otra cuenta (la de un familiar, la del local) desde el mismo dispositivo. */}
          {soloSocio && (
            <MenuItem icon={Users} onSelect={() => void logout().then(() => navigate('/login'))}>
              Ver otra cuenta
            </MenuItem>
          )}
          <MenuItem icon={LogOut} onSelect={() => void logout()}>
            Salir
          </MenuItem>
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
