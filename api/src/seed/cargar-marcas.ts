// Logos de la cooperativa para la demo (isotipo de la app y logo de la factura), desde
// `src/seed/data/marcas`. Solo si la cooperativa todavía no tiene uno: lo que se cargue desde la app no se pisa.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Cooperativa } from '../models';
import { CooperativaImagen } from '../models';
import { runInCooperativa } from '../lib/context';
import { esImagen, marcaDe } from '../lib/imagenes';

export interface MarcasSeed {
  isotipo?: string;
  factura?: string;
}

// Desde la carpeta de la API (así anda igual con `tsx src/seed.ts` y con el seed compilado).
const CARPETA = join(process.cwd(), 'src', 'seed', 'data', 'marcas');

function leer(archivo: string): Buffer | null {
  const ruta = join(CARPETA, archivo);
  if (!existsSync(ruta)) return null;
  const contenido = readFileSync(ruta);
  return esImagen('image/png', contenido) ? contenido : null;
}

/** Devuelve qué cargó, para el resumen del seed. */
export async function cargarMarcas(coop: Cooperativa, marcas: MarcasSeed): Promise<string[]> {
  const cargado: string[] = [];
  const existentes = await runInCooperativa(coop.id, () => CooperativaImagen.findAll({ attributes: ['tipo'] }));
  const tiene = (tipo: string) => existentes.some((e) => e.tipo === tipo);

  const isotipo = marcas.isotipo && !tiene('isotipo') ? leer(marcas.isotipo) : null;
  if (isotipo) {
    await runInCooperativa(coop.id, () => CooperativaImagen.create({ cooperativaId: coop.id, tipo: 'isotipo', mime: 'image/png', contenido: isotipo }));
    await coop.update({ temaJson: { ...coop.temaJson, logoUrl: `/api/v1/publico/cooperativas/${coop.id}/imagen?v=${marcaDe(isotipo)}` } });
    cargado.push(`isotipo de ${coop.nombreCorto}`);
  }
  const factura = marcas.factura && !tiene('factura') ? leer(marcas.factura) : null;
  if (factura) {
    await runInCooperativa(coop.id, () => CooperativaImagen.create({ cooperativaId: coop.id, tipo: 'factura', mime: 'image/png', contenido: factura }));
    cargado.push(`logo de factura de ${coop.nombreCorto}`);
  }
  return cargado;
}
