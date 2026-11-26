// Piezas chicas que comparten las pantallas de la caja.
import { forwardRef, useEffect, useId, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Printer, ReceiptText } from 'lucide-react';
import { formatCuit, formatMoney, formatNumber, LOCALE, MEDIO_PAGO_ETIQUETA, TIMEZONE, type CajaResumen, type MedioPago } from '@shared';
import { abrirPdf, errorMessage } from '../../lib/api';
import { cn } from '../../lib/cn';
import { Badge, Button } from '../../components/ui';

const horaFmt = new Intl.DateTimeFormat(LOCALE, { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false });
const diaFmt = new Intl.DateTimeFormat(LOCALE, { timeZone: TIMEZONE, weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
/** `07:02` en hora de Argentina. */
export const hora = (iso: string) => horaFmt.format(new Date(iso));
/** `mié, 28/10/2026`. */
export const dia = (iso: string) => diaFmt.format(new Date(iso)).replace('.', '');
export const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;
/** «DNI 99.758.144», «CUIT 30-61099089-0». */
export const documento = (tipo: string, numero: string) => `${tipo} ${tipo === 'DNI' ? formatNumber(numero) : formatCuit(numero)}`;

/** Tecla, como se la nombra en la pantalla: «F2», «Enter». */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd className={cn('inline-flex min-w-6 items-center justify-center rounded-md border border-linea bg-fondo px-1.5 py-0.5 font-sans text-xs font-bold text-tinta-suave', className)}>
      {children}
    </kbd>
  );
}

/** El valor, con un rato de demora: para no buscar en cada tecla. */
export function useDemorado<T>(valor: T, ms: number): T {
  const [demorado, setDemorado] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setDemorado(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return demorado;
}

interface CampoImporteProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'size'> {
  label: string;
  value: string;
  onChange: (valor: string) => void;
  error?: string | null;
  hint?: ReactNode;
  /** `grande` para lo que el cajero mira de lejos (con cuánto paga). */
  grande?: boolean;
}

/** Campo de plata: se tipea como sale —«50000», «50.000», «1500,50»— y se lee con `leerImporte`. */
export const CampoImporte = forwardRef<HTMLInputElement, CampoImporteProps>(function CampoImporte({ label, value, onChange, error, hint, grande, className, id, ...rest }, ref) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className="space-y-1.5">
      <label htmlFor={inputId} className="block text-sm font-semibold text-tinta">
        {label}
      </label>
      <div className="relative">
        <span aria-hidden className={cn('pointer-events-none absolute inset-y-0 left-4 flex items-center font-semibold text-tinta-suave', grande ? 'text-2xl' : 'text-base')}>
          $
        </span>
        <input
          ref={ref}
          id={inputId}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^\d.,\s]/g, ''))}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
          className={cn(
            'block w-full rounded-xl border bg-superficie pr-4 font-bold tabular-nums text-tinta placeholder:font-normal placeholder:text-tinta-suave/80 transition-colors duration-150',
            grande ? 'min-h-16 pl-11 text-3xl' : 'min-h-12 pl-9 text-lg',
            error ? 'border-peligro' : 'border-linea hover:border-marca-claro focus:border-marca',
            className,
          )}
          {...rest}
        />
      </div>
      {error ? (
        <p id={`${inputId}-error`} role="alert" className="text-sm font-medium text-peligro">
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

const TONO_MEDIO: Record<MedioPago, 'exito' | 'marca' | 'neutral'> = { efectivo: 'exito', transferencia: 'marca', debito: 'marca', credito: 'marca', qr: 'neutral' };
export function MedioBadge({ medio }: { medio: MedioPago }) {
  return <Badge tone={TONO_MEDIO[medio]}>{MEDIO_PAGO_ETIQUETA[medio]}</Badge>;
}

/** Cómo cerró el arqueo de una caja. */
export function ArqueoBadge({ caja }: { caja: Pick<CajaResumen, 'cerradaEl' | 'diferencia'> }) {
  if (caja.cerradaEl === null || caja.diferencia === null) return <Badge tone="marca">Abierta</Badge>;
  const d = Number(caja.diferencia);
  if (d === 0) return <Badge tone="exito">Cerró justo</Badge>;
  return <Badge tone={d < 0 ? 'peligro' : 'alerta'}>{d < 0 ? `Faltaron ${formatMoney(-d)}` : `Sobraron ${formatMoney(d)}`}</Badge>;
}

/** Los dos tamaños del recibo. El PDF se abre en otra pestaña, listo para imprimir. */
export function BotonesRecibo({ id, principal }: { id: number; principal?: boolean }) {
  const imprimir = useMutation({ mutationFn: (formato: 'ticket' | 'a4') => abrirPdf(`/caja/cobros/${id}/recibo?formato=${formato}`) });
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <span className="flex flex-wrap justify-end gap-2">
        <Button
          variant="secondary"
          size={principal ? 'lg' : 'md'}
          icon={Printer}
          loading={imprimir.isPending && imprimir.variables === 'ticket'}
          onClick={() => imprimir.mutate('ticket')}
          data-recibo="ticket"
        >
          Ticket {principal && <Kbd>T</Kbd>}
        </Button>
        <Button
          variant="secondary"
          size={principal ? 'lg' : 'md'}
          icon={ReceiptText}
          loading={imprimir.isPending && imprimir.variables === 'a4'}
          onClick={() => imprimir.mutate('a4')}
          data-recibo="a4"
        >
          Recibo A4 {principal && <Kbd>A</Kbd>}
        </Button>
      </span>
      {imprimir.isError && <span className="text-sm font-medium text-peligro">{errorMessage(imprimir.error)}</span>}
    </span>
  );
}
