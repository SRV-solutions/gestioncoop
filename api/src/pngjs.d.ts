// pngjs no trae tipos: solo lo que usa GestiónCoop (leer y escribir un PNG de una vez).
declare module 'pngjs' {
  export interface ImagenPng {
    width: number;
    height: number;
    /** RGBA, 4 bytes por píxel, fila por fila. */
    data: Buffer;
  }
  export const PNG: {
    new (o: { width: number; height: number; colorType?: 0 | 2 | 4 | 6; inputColorType?: 0 | 2 | 4 | 6; inputHasAlpha?: boolean }): ImagenPng;
    sync: {
      read(b: Buffer): ImagenPng;
      write(png: ImagenPng, o?: { colorType?: 0 | 2 | 4 | 6; inputColorType?: 0 | 2 | 4 | 6; inputHasAlpha?: boolean; deflateLevel?: number }): Buffer;
    };
  };
}
