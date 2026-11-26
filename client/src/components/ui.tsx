// Piezas básicas de interfaz que usa toda la app. Estados siempre resueltos (SPEC 5):
// cargando → Skeleton, vacío → Empty (con explicación y acción), error → ErrorState (con reintento).
import { forwardRef, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { LoaderCircle, RefreshCw, TriangleAlert, type LucideIcon } from 'lucide-react';
import { cn } from '../lib/cn';

/* ───────────────────────── Botón ───────────────────────── */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'md' | 'lg' | 'xl';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Muestra el giro de "trabajando" y bloquea el botón para que no se apriete dos veces. */
  loading?: boolean;
  icon?: LucideIcon;
}

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-marca text-white hover:bg-marca-fuerte active:bg-marca-fuerte shadow-sm',
  secondary: 'bg-superficie text-tinta border border-linea hover:border-marca hover:text-marca-texto',
  ghost: 'text-tinta-suave hover:bg-marca-tenue hover:text-marca-texto',
  danger: 'bg-peligro text-sobre-estado hover:brightness-95',
};
// Todos cumplen el mínimo táctil de 44 px.
const BUTTON_SIZE: Record<ButtonSize, string> = {
  md: 'min-h-11 px-4 text-[0.9375rem] gap-2 rounded-lg',
  lg: 'min-h-12 px-5 text-base gap-2 rounded-xl',
  xl: 'min-h-16 px-6 text-xl gap-3 rounded-2xl',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, icon: Icon, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex select-none items-center justify-center font-semibold transition-colors duration-150',
        'disabled:cursor-not-allowed disabled:opacity-60',
        BUTTON_VARIANT[variant],
        BUTTON_SIZE[size],
        className,
      )}
      {...rest}
    >
      {loading ? (
        <LoaderCircle className="size-[1.15em] animate-spin" aria-hidden />
      ) : (
        Icon && <Icon className="size-[1.15em] shrink-0" aria-hidden />
      )}
      {children}
    </button>
  );
});

/* ───────────────────────── Campo de formulario ───────────────────────── */

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  hint?: string;
  /** Elemento a la derecha, dentro del campo (por ejemplo, el botón de ver la contraseña). */
  trailing?: ReactNode;
}

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, error, hint, trailing, className, id, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;
  return (
    <div className="space-y-1.5">
      <label htmlFor={inputId} className="block text-sm font-semibold text-tinta">
        {label}
      </label>
      <div className="relative">
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            'block min-h-12 w-full rounded-xl border bg-superficie px-4 text-base text-tinta placeholder:text-tinta-suave/80',
            'transition-colors duration-150',
            error ? 'border-peligro' : 'border-linea hover:border-marca-claro focus:border-marca',
            trailing && 'pr-12',
            className,
          )}
          {...rest}
        />
        {trailing && <div className="absolute inset-y-0 right-1 flex items-center">{trailing}</div>}
      </div>
      {error ? (
        <p id={`${inputId}-error`} className="text-sm font-medium text-peligro">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${inputId}-hint`} className="text-sm text-tinta-suave">
            {hint}
          </p>
        )
      )}
    </div>
  );
});

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  error?: string;
  hint?: string;
}

/** Lista desplegable con la misma forma que `Field`. Las opciones van como hijos. */
export function SelectField({ label, error, hint, className, id, children, ...rest }: SelectFieldProps) {
  const autoId = useId();
  const selectId = id ?? autoId;
  return (
    <div className="space-y-1.5">
      <label htmlFor={selectId} className="block text-sm font-semibold text-tinta">
        {label}
      </label>
      <select
        id={selectId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${selectId}-error` : hint ? `${selectId}-hint` : undefined}
        className={cn(
          'block min-h-12 w-full rounded-xl border bg-superficie px-3.5 text-base text-tinta transition-colors duration-150',
          error ? 'border-peligro' : 'border-linea hover:border-marca-claro focus:border-marca',
          className,
        )}
        {...rest}
      >
        {children}
      </select>
      {error ? (
        <p id={`${selectId}-error`} className="text-sm font-medium text-peligro">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${selectId}-hint`} className="text-sm text-tinta-suave">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

/** Casilla con su texto al lado; toda la fila es tocable. */
export function Check({ label, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className={cn('flex min-h-11 cursor-pointer items-center gap-3 text-[0.9375rem] font-medium text-tinta', className)}>
      <input type="checkbox" className="size-5 shrink-0 rounded accent-(--marca)" {...rest} />
      <span>{label}</span>
    </label>
  );
}

/* ───────────────────────── Contenedores ───────────────────────── */

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('rounded-2xl border border-linea bg-superficie', className)}>{children}</div>;
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight text-tinta">{title}</h1>
        {description && <p className="mt-1 text-tinta-suave">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

type Tone = 'neutral' | 'marca' | 'exito' | 'alerta' | 'peligro';
const TONE: Record<Tone, string> = {
  neutral: 'bg-fondo text-tinta-suave border-linea',
  marca: 'bg-marca-tenue text-marca-texto border-transparent',
  exito: 'bg-exito-tenue text-exito border-transparent',
  alerta: 'bg-alerta-tenue text-alerta border-transparent',
  peligro: 'bg-peligro-tenue text-peligro border-transparent',
};

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold', TONE[tone])}>
      {children}
    </span>
  );
}

/* ───────────────────────── Estados: cargando, vacío, error ───────────────────────── */

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-latido rounded-lg bg-linea/70', className)} />;
}

/** Pantalla completa mientras se averigua si hay sesión. */
export function LoadingScreen() {
  return (
    <div role="status" className="grid min-h-dvh place-items-center bg-fondo">
      <LoaderCircle className="size-8 animate-spin text-marca-texto" aria-hidden />
      <span className="sr-only">Cargando…</span>
    </div>
  );
}

interface EmptyProps {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}

/** Estado vacío: siempre explica por qué no hay nada y, si se puede, qué hacer. */
export function Empty({ icon: Icon, title, children, action, className }: EmptyProps) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-12 text-center', className)}>
      <div className="grid size-14 place-items-center rounded-2xl bg-marca-tenue text-marca-texto">
        <Icon className="size-7" aria-hidden />
      </div>
      <h2 className="mt-4 text-lg font-bold text-tinta">{title}</h2>
      {children && <div className="mt-1.5 max-w-md text-tinta-suave">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Error de carga: mensaje humano y botón para reintentar. El detalle técnico nunca se muestra. */
export function ErrorState({ message, onRetry, className }: { message?: string; onRetry?: () => void; className?: string }) {
  return (
    <div role="alert" className={cn('flex flex-col items-center px-6 py-12 text-center', className)}>
      <div className="grid size-14 place-items-center rounded-2xl bg-peligro-tenue text-peligro">
        <TriangleAlert className="size-7" aria-hidden />
      </div>
      <h2 className="mt-4 text-lg font-bold text-tinta">No pudimos cargar esto</h2>
      <p className="mt-1.5 max-w-md text-tinta-suave">{message ?? 'Revisá tu conexión y probá de nuevo.'}</p>
      {onRetry && (
        <Button variant="secondary" icon={RefreshCw} onClick={onRetry} className="mt-5">
          Reintentar
        </Button>
      )}
    </div>
  );
}

/** Aviso corto dentro de un formulario (por ejemplo, credenciales incorrectas). */
export function FormAlert({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="flex items-start gap-2.5 rounded-xl bg-peligro-tenue px-4 py-3 text-sm font-medium text-peligro">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </div>
  );
}
