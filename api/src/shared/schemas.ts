import { z } from 'zod';
import { ROLES } from './constants';

export const subdominioSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,40}[a-z0-9])?$/, 'Subdominio inválido');

export const rolSchema = z.enum(ROLES);

/**
 * El personal entra con su email. El socio, con su DNI (o CUIT) o su número de socio: por eso el
 * campo se llama `email` pero acepta cualquiera de las tres cosas. Con el DNI hace falta saber de qué
 * cooperativa es: sale de la dirección o, en el modo demo, de `cooperativa`.
 */
export const loginSchema = z.object({
  email: z.string({ error: 'Escribí tu email' }).trim().min(1, 'Escribí tu email').max(200, 'Es demasiado largo'),
  password: z.string({ error: 'Escribí tu contraseña' }).min(1, 'Escribí tu contraseña').max(200, 'Es demasiado larga'),
  cooperativa: subdominioSchema.optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

/** Ingreso con un usuario de prueba (solo con DEMO_MODE). El superadmin nunca entra por acá. */
export const demoLoginSchema = z.object({
  rol: rolSchema.exclude(['superadmin']),
  cooperativa: subdominioSchema.optional(),
});
export type DemoLoginInput = z.infer<typeof demoLoginSchema>;

export const cooperativaActivaSchema = z.object({
  cooperativaId: z.number().int().positive().nullable(),
});

/* ───────────────────────── Imagen de la cooperativa ───────────────────────── */

const IMAGEN = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;

/**
 * Logo o foto de la cooperativa. La pantalla la manda ya recortada en cuadrado y achicada, así que
 * pesa poco; el tope es para lo que no venga de la pantalla.
 */
export const imagenCooperativaSchema = z.object({
  imagen: z.string({ error: 'Elegí una imagen' }).max(600_000, 'La imagen es demasiado grande').regex(IMAGEN, 'Esa imagen no es válida'),
});

/** Separa el tipo y el contenido de una imagen que viajó como texto. */
export function leerImagen(dataUrl: string): { mime: string; base64: string } | null {
  const partes = IMAGEN.exec(dataUrl);
  return partes ? { mime: partes[1]!, base64: partes[2]! } : null;
}
