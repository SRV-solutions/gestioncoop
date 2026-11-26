import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '../lib/cn';
import { Button } from './ui';

interface ModalProps {
  title: string;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** Botones de abajo. El de guardar puede apuntar a un formulario del cuerpo con `form="id"`. */
  footer?: ReactNode;
  wide?: boolean;
}

/**
 * Ventana de diálogo: en el celular sube desde abajo, en la PC va centrada. Escape y el fondo la cierran.
 * Se dibuja en <body> (portal): dentro de la página quedaba encerrada en la columna de contenido
 * —la animación de entrada crea su propio contexto— y el fondo oscuro no tapaba ni el menú ni los márgenes.
 */
export function Modal({ title, description, onClose, children, footer, wide }: ModalProps) {
  const id = useId();
  const caja = useRef<HTMLDivElement>(null);
  // onClose va por referencia: así el foco entra una sola vez, no en cada redibujo.
  const alCerrar = useRef(onClose);
  useEffect(() => {
    alCerrar.current = onClose;
  });
  useEffect(() => {
    const previo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Si adentro ya hay un campo con el foco (autoFocus), se respeta: el teclado arranca ahí.
    if (!caja.current?.contains(document.activeElement)) caja.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && alCerrar.current();
    window.addEventListener('keydown', onKey);
    // El foco no sale de la ventana: si algo de atrás lo toma (un campo que recién aparece), vuelve.
    const onFocus = (e: FocusEvent) => {
      if (caja.current && e.target instanceof Node && !caja.current.contains(e.target)) caja.current.focus();
    };
    document.addEventListener('focusin', onFocus);
    const scroll = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', onFocus);
      document.body.style.overflow = scroll;
      previo?.focus();
    };
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-4">
      <div aria-hidden onClick={onClose} className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" />
      <div
        ref={caja}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        tabIndex={-1}
        className={cn(
          'relative flex max-h-[92dvh] w-full animate-aparecer flex-col rounded-t-3xl border border-linea bg-superficie shadow-2xl outline-none sm:rounded-3xl',
          wide ? 'sm:max-w-3xl' : 'sm:max-w-lg',
        )}
      >
        <header className="flex items-start gap-3 border-b border-linea px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 id={id} className="text-lg font-bold leading-tight text-tinta">
              {title}
            </h2>
            {description && <p className="mt-1 text-sm text-tinta-suave">{description}</p>}
          </div>
          <button
            type="button"
            aria-label="Cerrar"
            onClick={onClose}
            className="-mr-2 -mt-1 grid size-11 shrink-0 place-items-center rounded-xl text-tinta-suave hover:bg-marca-tenue hover:text-marca-texto"
          >
            <X className="size-5" aria-hidden />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-linea px-5 py-4">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

interface ConfirmProps {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  /** `danger` (por defecto) para lo que no se puede deshacer; `primary` para una confirmación común. */
  variant?: 'danger' | 'primary';
  loading?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onClose: () => void;
}

/** Pregunta antes de una acción que no se puede deshacer. */
export function Confirm({ title, children, confirmLabel, variant = 'danger', loading, error, onConfirm, onClose }: ConfirmProps) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant={variant} loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-tinta">{children}</div>
      {error && (
        <p role="alert" className="mt-4 rounded-xl bg-peligro-tenue px-4 py-3 text-sm font-medium text-peligro">
          {error}
        </p>
      )}
    </Modal>
  );
}
