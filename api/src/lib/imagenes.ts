// Imágenes que sube la gente (isotipo y logo de la factura): se mira el contenido, no solo lo que dice ser.
import { createHash } from 'node:crypto';

/** ¿Los bytes son de verdad una imagen de ese tipo? No alcanza con lo que dice el encabezado. */
export function esImagen(mime: string, b: Buffer): boolean {
  if (mime === 'image/jpeg') return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (mime === 'image/png') return b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mime === 'image/webp') return b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP';
  return false;
}

/** Lo que el PDF puede dibujar: PNG o JPEG. */
export const sirveParaPdf = (b: Buffer | null | undefined): b is Buffer => !!b && (esImagen('image/png', b) || esImagen('image/jpeg', b));

/** Marca corta del contenido: va en la dirección de la imagen, así cambia cuando cambia la imagen. */
export const marcaDe = (contenido: Buffer) => createHash('sha256').update(contenido).digest('hex').slice(0, 12);
