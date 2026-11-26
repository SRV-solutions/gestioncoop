// Fotos sacadas con el teléfono: se achican antes de mandarlas, para que viajen con poca señal.

/** Achica una foto sacada con el teléfono (lado mayor 1280 px, JPEG) para que entre en la cola y viaje con poca señal. */
export async function achicarFoto(archivo: File): Promise<string> {
  const imagen = await createImageBitmap(archivo);
  const escala = Math.min(1, 1280 / Math.max(imagen.width, imagen.height));
  const lienzo = document.createElement('canvas');
  lienzo.width = Math.round(imagen.width * escala);
  lienzo.height = Math.round(imagen.height * escala);
  lienzo.getContext('2d')!.drawImage(imagen, 0, 0, lienzo.width, lienzo.height);
  imagen.close();
  for (const calidad of [0.72, 0.55, 0.4]) {
    const url = lienzo.toDataURL('image/jpeg', calidad);
    if (url.length < 900_000) return url;
  }
  throw new Error('La foto es demasiado grande');
}

/**
 * Deja una imagen en un cuadrado de 512 px tomando el centro (para el logo o la foto de la
 * cooperativa). Va sobre blanco, así un logo con fondo transparente no queda negro al pasar a JPEG.
 */
export async function recortarEnCuadrado(archivo: File, lado = 512): Promise<string> {
  const imagen = await createImageBitmap(archivo);
  const corte = Math.min(imagen.width, imagen.height);
  const lienzo = document.createElement('canvas');
  lienzo.width = lado;
  lienzo.height = lado;
  const ctx = lienzo.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, lado, lado);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(imagen, (imagen.width - corte) / 2, (imagen.height - corte) / 2, corte, corte, 0, 0, lado, lado);
  imagen.close();
  return lienzo.toDataURL('image/jpeg', 0.88);
}

/**
 * Logo para la factura: con sus proporciones (no se recorta), lado mayor de 1000 px como mucho y en
 * PNG, que conserva el fondo transparente y es lo que el PDF sabe dibujar.
 */
export async function achicarLogo(archivo: File): Promise<string> {
  const imagen = await createImageBitmap(archivo);
  const escala = Math.min(1, 1000 / Math.max(imagen.width, imagen.height));
  const lienzo = document.createElement('canvas');
  lienzo.width = Math.max(1, Math.round(imagen.width * escala));
  lienzo.height = Math.max(1, Math.round(imagen.height * escala));
  const ctx = lienzo.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(imagen, 0, 0, lienzo.width, lienzo.height);
  imagen.close();
  const png = lienzo.toDataURL('image/png');
  // Una foto grande pesa mucho en PNG: entonces va en JPEG.
  return png.length < 850_000 ? png : lienzo.toDataURL('image/jpeg', 0.85);
}
