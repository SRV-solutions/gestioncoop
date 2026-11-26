import type { Request, Response } from 'express';
import { ZodError, type ZodType } from 'zod';
import type { ApiResponse } from '../shared';

/**
 * Error que se le puede mostrar al usuario: lleva un mensaje humano y un código estable.
 * Cualquier otro error sale como "error interno" genérico y el detalle va al log.
 */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, fields?: Record<string, string>) => new HttpError(400, msg, 'bad_request', fields);
export const unauthorized = (msg = 'Ingresá para continuar', code = 'unauthorized') => new HttpError(401, msg, code);
export const forbidden = (msg = 'No tenés permiso para hacer esto') => new HttpError(403, msg, 'forbidden');
export const notFound = (msg = 'No encontramos lo que buscabas') => new HttpError(404, msg, 'not_found');
export const conflict = (msg: string) => new HttpError(409, msg, 'conflict');
/** Un superadmin quiso usar un módulo sin haber elegido en qué cooperativa trabajar. */
export const noCooperativa = () => new HttpError(400, 'Elegí una cooperativa para continuar', 'no_cooperativa');

/** Convierte errores de Zod en { campo: mensaje }. */
export function zodFieldErrors(err: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join('.') || '_';
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

/** Valida y devuelve los datos; si no son válidos, responde 400 con el detalle por campo. */
export function parse<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) throw badRequest('Revisá los datos marcados', zodFieldErrors(result.error));
  return result.data;
}

/** Respuesta exitosa con la forma única `{ data, error }`. */
export function ok<T>(res: Response, data: T, status = 200): void {
  const body: ApiResponse<T> = { data, error: null };
  res.status(status).json(body);
}

/** Lee un id numérico de la ruta; si no es un entero positivo responde 404 (no revela nada). */
export function idParam(req: Request, name = 'id'): number {
  const raw = req.params[name];
  if (typeof raw !== 'string' || !/^[1-9]\d{0,8}$/.test(raw)) throw notFound();
  return Number(raw);
}
