import { z } from 'zod';

// Tutoriales con Solvix. El catálogo (qué dice cada paso) vive en el cliente; acá solo se guarda
// cuáles hizo y cuáles omitió cada persona.

const ids = z
  .array(z.string().regex(/^[a-z0-9-]{1,40}$/, 'Ese tutorial no existe'), { error: 'Falta la lista de tutoriales' })
  .max(60, 'Son demasiados tutoriales')
  .transform((lista) => [...new Set(lista)]);

export const avanceTutorialesSchema = z.object({ hechos: ids, omitidos: ids });

export interface AvanceTutoriales {
  hechos: string[];
  omitidos: string[];
}

export const SIN_TUTORIALES: AvanceTutoriales = { hechos: [], omitidos: [] };
