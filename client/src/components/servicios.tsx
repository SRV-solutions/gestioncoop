// Íconos y etiquetas de servicios y estados, para que se vean igual en el padrón, el mapa y el ingreso.
import { Droplets, Flame, HeartHandshake, Tv, Wifi, Zap, type LucideIcon } from 'lucide-react';
import { ESTADO_SERVICIO_ETIQUETA, SERVICIO_ETIQUETA, type EstadoServicio, type Servicio } from '@shared';
import { cn } from '../lib/cn';
import { Badge } from './ui';

export const SERVICIO_ICON: Record<Servicio, LucideIcon> = {
  energia: Zap,
  agua: Droplets,
  internet: Wifi,
  tv: Tv,
  sepelio: HeartHandshake,
  gas: Flame,
};

/** Nombres cortos para chips y filtros. */
export const SERVICIO_CORTO: Record<Servicio, string> = {
  energia: 'Energía',
  agua: 'Agua',
  internet: 'Internet',
  tv: 'TV',
  sepelio: 'Sepelio',
  gas: 'Gas',
};

/** Íconos de los servicios que tiene una conexión o un socio, con su nombre como texto alternativo. */
export function ServicioIcons({ servicios, className }: { servicios: Servicio[]; className?: string }) {
  return (
    <span className={cn('flex items-center gap-1.5', className)}>
      {servicios.map((s) => {
        const Icon = SERVICIO_ICON[s];
        return (
          <span key={s} title={SERVICIO_ETIQUETA[s]} className="grid size-7 place-items-center rounded-lg bg-marca-tenue text-marca-texto">
            <Icon className="size-4" aria-hidden />
            <span className="sr-only">{SERVICIO_ETIQUETA[s]}</span>
          </span>
        );
      })}
    </span>
  );
}

const TONO_ESTADO = { activo: 'exito', suspendido: 'alerta', cortado: 'peligro', baja: 'neutral' } as const;

export function EstadoServicioBadge({ estado }: { estado: EstadoServicio }) {
  return <Badge tone={TONO_ESTADO[estado]}>{ESTADO_SERVICIO_ETIQUETA[estado]}</Badge>;
}
