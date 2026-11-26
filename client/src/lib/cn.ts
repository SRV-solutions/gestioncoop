import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Une clases de Tailwind; si dos chocan, gana la última. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
