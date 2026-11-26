import cookieParser from 'cookie-parser';
import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import { ZodError } from 'zod';
import type { ApiResponse } from './shared';
import { config } from './config';
import { requestContext } from './lib/context';
import { HttpError, notFound, ok, zodFieldErrors } from './lib/errors';
import { TenantIsolationError } from './lib/tenant';
import { authenticate, checkOrigin } from './middlewares/auth';
import { ErrorDeCalculo } from './motor';
import { authRouter } from './modules/auth.routes';
import { cajaRouter } from './modules/caja.routes';
import { cooperativasRouter } from './modules/cooperativas.routes';
import { imagenCooperativaPublica, miCooperativaRouter } from './modules/mi-cooperativa.routes';
import { facturacionRouter } from './modules/facturacion.routes';
import { lecturasRouter } from './modules/lecturas.routes';
import { mapaRouter } from './modules/mapa.routes';
import { padronRouter } from './modules/padron.routes';
import { notificacionesPagoRouter, publicoRouter } from './modules/publico.routes';
import { cortesRouter, reclamosRouter } from './modules/reclamos.routes';
import { socioRouter } from './modules/socio.routes';
import { informesRouter, tableroRouter } from './modules/tablero.routes';
import { tarifasRouter } from './modules/tarifas.routes';
import { usersRouter } from './modules/users.routes';

export function createApp() {
  const app = express();
  // Proxies delante de la API (Vite en desarrollo; Netlify + Railway en producción = 2 saltos).
  // Sirve para que el límite de intentos de login vea la IP real de cada persona.
  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());
  app.use(checkOrigin);
  // Cada pedido arranca sin usuario ni cooperativa; `authenticate` los completa.
  app.use((req, _res, next) =>
    requestContext.run(
      { userId: null, ip: (req.ip ?? '').slice(0, 64) || null, roles: [], cooperativaId: null, unscoped: false },
      () => next(),
    ),
  );

  const api = express.Router();
  // Las respuestas de la API nunca se guardan en cachés intermedios.
  api.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  api.get('/health', (_req, res) => ok(res, { ok: true }));
  api.use('/auth', authRouter);
  // Sin sesión: pagar con el QR de la factura, la pasarela de prueba y el aviso del banco.
  api.use('/publico', publicoRouter);
  api.use('/publico', imagenCooperativaPublica);
  api.use('/pagos', notificacionesPagoRouter);
  api.use(authenticate);
  api.use('/users', usersRouter);
  api.use('/cooperativas', cooperativasRouter);
  api.use('/mi-cooperativa', miCooperativaRouter);
  api.use('/padron', padronRouter);
  api.use('/mapa', mapaRouter);
  api.use('/tarifas', tarifasRouter);
  api.use('/lecturas', lecturasRouter);
  api.use('/facturacion', facturacionRouter);
  api.use('/caja', cajaRouter);
  api.use('/socio', socioRouter);
  api.use('/reclamos', reclamosRouter);
  api.use('/cortes', cortesRouter);
  api.use('/tablero', tableroRouter);
  api.use('/informes', informesRouter);
  api.use(() => {
    throw notFound('Esa dirección no existe');
  });
  app.use('/api/v1', api);

  app.use(() => {
    throw notFound('Esa dirección no existe');
  });

  // Todo error sale con la forma única { data: null, error }. Solo los HttpError muestran su
  // mensaje; el resto se registra en el log y al usuario le llega un texto genérico.
  const onError: ErrorRequestHandler = (err, req, res, _next) => {
    let out: HttpError;
    if (err instanceof HttpError) out = err;
    // El motor explica por qué no pudo calcular (falta un cuadro, una lectura...): ese texto sí se muestra.
    else if (err instanceof ErrorDeCalculo) out = new HttpError(422, err.message, `calculo_${err.codigo}`);
    else if (err instanceof ZodError) out = new HttpError(400, 'Revisá los datos marcados', 'bad_request', zodFieldErrors(err));
    else if (err?.type === 'entity.too.large') out = new HttpError(413, 'El archivo es demasiado grande', 'too_large');
    else if (err?.type === 'entity.parse.failed') out = new HttpError(400, 'No pudimos leer el pedido', 'bad_request');
    else {
      const tag = err instanceof TenantIsolationError ? 'AISLAMIENTO' : 'ERROR';
      if (!config.isTest) console.error(`[${tag}] ${req.method} ${req.originalUrl}`, err);
      out = new HttpError(500, 'Algo salió mal de nuestro lado. Probá de nuevo en un momento.', 'internal');
    }
    const body: ApiResponse<never> = { data: null, error: { code: out.code, message: out.message, fields: out.fields } };
    res.status(out.status).json(body);
  };
  app.use(onError);

  return app;
}
