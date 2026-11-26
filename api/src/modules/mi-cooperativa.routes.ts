// La cooperativa vista por su propia gente: hoy, la imagen (logo o foto) con la que aparece en la
// pantalla de ingreso y arriba de cada pantalla. La cambian gerencia y administración.
import { Router } from 'express';
import type { Transaction } from 'sequelize';
import { imagenCooperativaSchema, leerImagen, type CooperativaPublica } from '../shared';
import { sequelize } from '../db';
import { Cooperativa, CooperativaImagen } from '../models';
import { writeAudit } from '../lib/audit';
import { runInCooperativa } from '../lib/context';
import { clearCooperativaCache, toCooperativaPublica } from '../lib/cooperativas';
import { esImagen, marcaDe } from '../lib/imagenes';
import { badRequest, notFound, ok, parse } from '../lib/errors';
import { requireCooperativaId } from '../lib/tenant';
import { requireRole } from '../middlewares/auth';

export const miCooperativaRouter = Router();
miCooperativaRouter.use(requireRole('gerencia', 'admin'));

/** Guarda la dirección de la imagen en el tema (o la quita) y devuelve la cooperativa como la ve la app. */
async function guardarTema(cooperativaId: number, logoUrl: string | null, guardarImagen: (transaction: Transaction) => Promise<void>): Promise<CooperativaPublica> {
  const publica = await sequelize.transaction(async (transaction) => {
    const coop = await Cooperativa.findByPk(cooperativaId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!coop) throw notFound('No encontramos esa cooperativa');
    const anterior = coop.temaJson.logoUrl ?? null;
    await guardarImagen(transaction);
    await coop.update({ temaJson: { ...coop.temaJson, logoUrl } }, { transaction });
    await writeAudit({
      accion: logoUrl ? 'cambiar_imagen_cooperativa' : 'quitar_imagen_cooperativa',
      entidad: 'cooperativa',
      entidadId: coop.id,
      antes: { logoUrl: anterior },
      despues: { logoUrl },
      transaction,
    });
    return toCooperativaPublica(coop);
  });
  // La cooperativa está en memoria por unos segundos: que el cambio se vea ya.
  clearCooperativaCache();
  return publica;
}

miCooperativaRouter.put('/imagen', async (req, res) => {
  const { imagen } = parse(imagenCooperativaSchema, req.body);
  const leida = leerImagen(imagen);
  const contenido = leida ? Buffer.from(leida.base64, 'base64') : null;
  if (!leida || !contenido || !esImagen(leida.mime, contenido)) throw badRequest('Ese archivo no es una imagen que podamos usar. Probá con una foto en JPG o PNG.');

  const cooperativaId = requireCooperativaId();
  // La dirección lleva una marca del contenido: si la imagen cambia, cambia la dirección y nadie ve la vieja.
  const version = marcaDe(contenido);
  const publica = await guardarTema(cooperativaId, `/api/v1/publico/cooperativas/${cooperativaId}/imagen?v=${version}`, async (transaction) => {
    const actual = await CooperativaImagen.findOne({ where: { tipo: 'isotipo' }, transaction });
    if (actual) await actual.update({ mime: leida.mime, contenido }, { transaction });
    else await CooperativaImagen.create({ cooperativaId, tipo: 'isotipo', mime: leida.mime, contenido }, { transaction });
  });
  ok(res, publica);
});

miCooperativaRouter.delete('/imagen', async (_req, res) => {
  const cooperativaId = requireCooperativaId();
  const publica = await guardarTema(cooperativaId, null, async (transaction) => {
    await CooperativaImagen.destroy({ where: { cooperativaId, tipo: 'isotipo' }, transaction });
  });
  ok(res, publica);
});

/**
 * La imagen en sí. Sin sesión, porque se muestra en la pantalla de ingreso; no es un dato reservado.
 * Va montada en /publico. La dirección cambia con cada imagen, así que se puede guardar mucho tiempo.
 */
export const imagenCooperativaPublica = Router();
imagenCooperativaPublica.get('/cooperativas/:id/imagen', async (req, res) => {
  const id = Number(req.params.id);
  const imagen = Number.isSafeInteger(id) && id > 0 ? await runInCooperativa(id, () => CooperativaImagen.findOne({ where: { tipo: 'isotipo' } })) : null;
  if (!imagen) throw notFound('Esa cooperativa no tiene imagen');
  res.setHeader('Content-Type', imagen.mime);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.send(imagen.contenido);
});
