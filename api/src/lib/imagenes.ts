// Imágenes que sube la gente (isotipo y logo de la factura): se mira el contenido, no solo lo que dice ser.
import { createHash } from 'node:crypto';
import { PNG, type ImagenPng } from 'pngjs';

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

/* ───────────────────────── El logo para el PDF ───────────────────────── */

// En la factura el logo ocupa 92 × 70 puntos: a unos 300 ppp alcanza con esto.
const LOGO_ANCHO = 384;
const LOGO_ALTO = 292;
const logos = new Map<string, Buffer>();

/**
 * El logo listo para el PDF: achicado a lo que se imprime y sobre fondo blanco (sin transparencia).
 * Un PNG con transparencia obliga al PDF a procesarlo píxel por píxel en cada factura; uno así lo
 * copia tal cual. Se prepara una vez por imagen y queda en memoria (no se guarda en ningún lado).
 * Un JPEG o algo que no se pueda leer vuelve como vino.
 */
export function logoParaPdf(b: Buffer): Buffer {
  if (!esImagen('image/png', b)) return b;
  const clave = createHash('sha256').update(b).digest('hex');
  const hecho = logos.get(clave);
  if (hecho) return hecho;
  let listo = b;
  try {
    listo = achicarSobreBlanco(PNG.sync.read(b));
  } catch {
    // Si no se puede leer, el PDF lo intenta con el original (y si tampoco puede, sale sin logo).
  }
  if (logos.size >= 20) logos.delete(logos.keys().next().value!);
  logos.set(clave, listo);
  return listo;
}

function achicarSobreBlanco(img: ImagenPng): Buffer {
  const escala = Math.min(1, LOGO_ANCHO / img.width, LOGO_ALTO / img.height);
  const ancho = Math.max(1, Math.round(img.width * escala));
  const alto = Math.max(1, Math.round(img.height * escala));
  const salida = new PNG({ width: ancho, height: alto });
  // Cada píxel nuevo es el promedio de los que cubre en el original (pesados por su opacidad).
  for (let y = 0; y < alto; y++) {
    const y0 = Math.floor((y * img.height) / alto);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * img.height) / alto));
    for (let x = 0; x < ancho; x++) {
      const x0 = Math.floor((x * img.width) / ancho);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * img.width) / ancho));
      let r = 0;
      let g = 0;
      let bl = 0;
      let n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * img.width + xx) * 4;
          const a = img.data[i + 3]! / 255;
          r += img.data[i]! * a + 255 * (1 - a);
          g += img.data[i + 1]! * a + 255 * (1 - a);
          bl += img.data[i + 2]! * a + 255 * (1 - a);
          n++;
        }
      }
      const o = (y * ancho + x) * 4;
      salida.data[o] = Math.round(r / n);
      salida.data[o + 1] = Math.round(g / n);
      salida.data[o + 2] = Math.round(bl / n);
      salida.data[o + 3] = 255;
    }
  }
  return PNG.sync.write(salida, { colorType: 2, deflateLevel: 9 });
}
