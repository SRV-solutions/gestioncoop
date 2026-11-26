import { Moon, Sun } from 'lucide-react';
import { APP_NOMBRE, type CooperativaPublica } from '@shared';
import { cn } from '../lib/cn';
import { useTema } from '../lib/theme';

type MarkSize = 'sm' | 'md' | 'lg';
const SIZE: Record<MarkSize, string> = {
  sm: 'size-9 rounded-xl text-sm',
  md: 'size-11 rounded-xl text-base',
  lg: 'size-16 rounded-2xl text-2xl',
};
const LOGO_PX: Record<MarkSize, number> = { sm: 24, md: 30, lg: 44 };

const HEX = /^#[0-9a-f]{6}$/i;

interface CoopMarkProps {
  cooperativa: Pick<CooperativaPublica, 'nombreCorto' | 'tema'> | null;
  size?: MarkSize;
  className?: string;
}

/**
 * Isotipo de la cooperativa: su logo si lo cargó; si no, sus iniciales sobre su color.
 * Es lo único que lleva el color de la cooperativa: el resto de la app usa la marca de la plataforma.
 * Sin cooperativa (panel del proveedor) va el logo de SRV.
 */
export function CoopMark({ cooperativa, size = 'md', className }: CoopMarkProps) {
  const base = cn('grid shrink-0 place-items-center font-extrabold tracking-tight', SIZE[size], className);
  if (!cooperativa) {
    return (
      <span aria-hidden className={cn(base, 'bg-white')}>
        <SrvLogo size={LOGO_PX[size]} />
      </span>
    );
  }
  const logo = cooperativa.tema.logoUrl;
  if (logo) {
    // La imagen que carga la cooperativa ya viene recortada en cuadrado.
    return <img src={logo} alt="" className={cn(base, 'bg-white object-cover')} />;
  }
  // El color viene de la base: solo se acepta hexadecimal.
  const color = cooperativa.tema.colores.primario;
  return (
    <span aria-hidden className={cn(base, 'bg-marca text-white')} style={HEX.test(color) ? { backgroundColor: color } : undefined}>
      {cooperativa.tema.iniciales}
    </span>
  );
}

export function SrvLogo({ size = 22 }: { size?: number }) {
  return <img src="/brand/srv-logo-64.png" srcSet="/brand/srv-logo-64.png 1x, /brand/srv-logo-128.png 2x" alt="" width={size} height={size} />;
}

/** Nombre del producto con el punto naranja de SRV: "GestiónCoop." */
export function NombreProducto({ className }: { className?: string }) {
  return (
    <span className={className}>
      {APP_NOMBRE}
      <span className="punto-marca">.</span>
    </span>
  );
}

/**
 * Crédito de quien hizo la plataforma: "Powered by SRV" con el logo, enlazado a wearesrv.com.
 * `onDark` para barras negras (menú lateral, panel del ingreso).
 */
export function PoweredBy({ onDark, className }: { onDark?: boolean; className?: string }) {
  return (
    <a
      href="https://wearesrv.com"
      target="_blank"
      rel="noopener noreferrer"
      title="Creada y desarrollada por SRV · wearesrv.com"
      className={cn(
        'inline-flex min-h-11 items-center gap-2.5 rounded-full border py-1 pl-1.5 pr-4 transition-colors duration-150',
        onDark
          ? 'sobre-oscuro border-white/15 bg-white/10 text-white hover:bg-white/15'
          : 'border-linea bg-superficie text-tinta hover:border-marca',
        className,
      )}
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-white shadow-sm">
        <SrvLogo />
      </span>
      <span className="flex flex-col text-left leading-tight">
        <span className="text-[0.8125rem] font-medium">
          Powered by <strong className={cn('font-extrabold', onDark ? 'text-acento' : 'text-marca-texto')}>SRV</strong>
        </span>
        <span className={cn('text-[0.6875rem]', onDark ? 'text-white/65' : 'text-tinta-suave')}>wearesrv.com</span>
      </span>
    </a>
  );
}

/** Botón de sol / luna para pasar de modo claro a oscuro. */
export function BotonTema({ onDark, className }: { onDark?: boolean; className?: string }) {
  const { tema, alternar } = useTema();
  const oscuro = tema === 'dark';
  return (
    <button
      type="button"
      onClick={alternar}
      aria-label={oscuro ? 'Pasar a modo claro' : 'Pasar a modo oscuro'}
      title={oscuro ? 'Modo claro' : 'Modo oscuro'}
      className={cn(
        'grid size-11 shrink-0 place-items-center rounded-xl transition-colors duration-150',
        onDark ? 'sobre-oscuro text-white/80 hover:bg-white/10 hover:text-white' : 'text-tinta-suave hover:bg-marca-tenue hover:text-marca-texto',
        className,
      )}
    >
      {oscuro ? <Sun className="size-5" aria-hidden /> : <Moon className="size-5" aria-hidden />}
    </button>
  );
}
