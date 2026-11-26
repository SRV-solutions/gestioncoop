// Pago online del socio (SPEC 6.6 y 6.6.1): el intento, la vuelta del banco y la acreditación.
// Se acredita solo con el aviso del banco (servidor a servidor) o consultándole el estado; nunca
// porque el navegador volvió a la página de «pago aprobado». Acreditar dos veces el mismo intento
// es imposible: se bloquea la fila del intento y el pago guarda su id (único).
import { randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';
import {
  formatMoney,
  formatPeriodo,
  letraDe,
  referenciaComprobante,
  SERVICIO_ETIQUETA,
  type EstadoPagoOnline,
  type IntentoCreado,
  type ItemIntento,
} from '../shared';
import { sequelize } from '../db';
import { Comprobante, Cooperativa, IntentoPago, Pago, PagoAplicacion, Socio } from '../models';
import { proveedorNotificaciones } from '../proveedores/notificaciones';
import { proveedorPagos, type ResultadoPago } from '../proveedores/pagos';
import { config } from '../config';
import { writeAudit } from './audit';
import { referenciaRecibo, titularDe } from './caja';
import { runInCooperativa, runUnscoped } from './context';
import { conflict, notFound } from './errors';
import { reservarNumeros } from './facturacion';
import { requireCooperativaId } from './tenant';

/** Cuánto tiempo tiene el socio para pagar en la pasarela antes de que el intento venza. */
export const VIGENCIA_INTENTO_MIN = 30;
const dinero = (v: Decimal.Value) => new Decimal(v).toFixed(2);

/* ───────────────────────── Crear el intento ───────────────────────── */

export async function crearIntentoPago(o: { socio: Socio; comprobanteIds: number[]; origen: 'portal' | 'qr'; usuarioId: number | null }): Promise<IntentoCreado> {
  const facturas = await Comprobante.findAll({ where: { id: o.comprobanteIds, socioId: o.socio.id }, order: [['venceEl', 'ASC'], ['anio', 'ASC'], ['mes', 'ASC'], ['id', 'ASC']] });
  if (facturas.length !== o.comprobanteIds.length) throw notFound('No encontramos una de esas facturas');
  for (const f of facturas) {
    if (f.tipo !== 'factura' || f.estado !== 'emitido' || new Decimal(f.saldo).lte(0)) {
      throw conflict(f.estado === 'pagado' ? `${referenciaComprobante(f)} ya está pagada. Actualizá la pantalla.` : `${referenciaComprobante(f)} no se puede pagar`);
    }
  }
  // Un ítem por factura (SPEC 6.6.1): el socio y la conciliación ven qué se pagó.
  const items: ItemIntento[] = facturas.map((f) => ({
    comprobanteId: f.id,
    descripcion: `${SERVICIO_ETIQUETA[f.servicio]} ${formatPeriodo(f.mes, f.anio)} · ${referenciaComprobante(f)}`,
    importe: dinero(f.saldo),
  }));
  const total = dinero(items.reduce((t, i) => t.plus(i.importe), new Decimal(0)));
  const id = randomUUID();
  const vuelta = o.origen === 'portal' ? `${config.appUrl}/socio/pago/${id}` : `${config.appUrl}/pagar/resultado/${id}`;

  await IntentoPago.create({
    id,
    socioId: o.socio.id,
    origen: o.origen,
    proveedor: proveedorPagos.nombre,
    total,
    itemsJson: items,
    venceEl: new Date(Date.now() + VIGENCIA_INTENTO_MIN * 60_000),
    creadoPor: o.usuarioId,
  });
  const { redireccion } = await proveedorPagos.crearIntento({
    cooperativaId: requireCooperativaId(),
    socioId: o.socio.id,
    intentoId: id,
    items,
    total,
    retorno: { exito: vuelta, cancelado: `${vuelta}?cancelado=1` },
    notificacion: `${config.appUrl}/api/v1/pagos/notificacion/${proveedorPagos.nombre}`,
  });
  await writeAudit({ accion: 'iniciar_pago_online', entidad: 'intento_pago', entidadId: id, despues: { socioId: o.socio.id, origen: o.origen, total, facturas: o.comprobanteIds } });
  return { intentoId: id, total, redireccion };
}

/* ───────────────────────── Lo que dice el banco ───────────────────────── */

/** Aplica lo que respondió el proveedor. Corre en la cooperativa del intento. */
export async function aplicarResultado(r: ResultadoPago): Promise<void> {
  if (r.estado === 'aprobado') {
    await acreditar(r);
  } else if (r.estado === 'rechazado' || r.estado === 'cancelado') {
    await IntentoPago.update(
      { estado: r.estado, motivo: r.motivo?.slice(0, 200) ?? null, medio: r.medio ?? null, resueltoEl: new Date() },
      { where: { id: r.intentoId, estado: 'pendiente' } },
    );
  }
}

/**
 * Registra el cobro de un intento aprobado: recibo numerado, facturas pagadas y aviso al socio.
 * Si el banco aprobó, la plata se cobró: se acredita aunque el intento haya vencido. Si una factura
 * se pagó por otro lado mientras tanto, lo que sobra queda a favor del socio.
 */
async function acreditar(r: ResultadoPago): Promise<number> {
  return sequelize.transaction(async (transaction) => {
    const intento = await IntentoPago.findByPk(r.intentoId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!intento) throw notFound('No encontramos ese pago');
    if (intento.estado === 'aprobado') return intento.pagoId!;

    const socio = (await Socio.findByPk(intento.socioId, { transaction }))!;
    const coop = (await Cooperativa.findByPk(intento.cooperativaId, { transaction }))!;
    const cobrado = new Decimal(r.importe ?? intento.total);
    const ids = intento.itemsJson.map((i) => i.comprobanteId);
    const facturas = await Comprobante.findAll({ where: { id: ids }, order: [['id', 'ASC']], transaction, lock: transaction.LOCK.UPDATE });
    const facturaPorId = new Map(facturas.map((f) => [f.id, f]));

    // Se aplica a cada factura lo que se pidió pagar de ella, sin pasar lo que debe hoy.
    let resto = cobrado;
    const aplicaciones: { factura: Comprobante; importe: Decimal; saldoDespues: Decimal }[] = [];
    for (const item of intento.itemsJson) {
      const f = facturaPorId.get(item.comprobanteId);
      if (!f || f.estado !== 'emitido' || resto.lte(0)) continue;
      const importe = Decimal.min(new Decimal(item.importe), new Decimal(f.saldo), resto);
      if (importe.lte(0)) continue;
      aplicaciones.push({ factura: f, importe, saldoDespues: new Decimal(f.saldo).minus(importe) });
      resto = resto.minus(importe);
    }

    const numeracion = { letra: letraDe(socio.condicionIva), puntoVenta: coop.configJson.puntoVenta };
    const numero = await reservarNumeros({ tipo: 'recibo', ...numeracion }, 1, transaction);
    const pago = await Pago.create(
      {
        cajaId: null,
        cajeroId: null,
        socioId: socio.id,
        ...numeracion,
        numero,
        medio: r.medio ?? 'debito',
        origen: 'online',
        importe: dinero(cobrado),
        refExterna: r.referencia?.slice(0, 60) ?? null,
        intentoId: intento.id,
        aFavor: dinero(resto),
        snapshotJson: { titular: await titularDe(socio, transaction) },
      },
      { transaction },
    );
    await PagoAplicacion.bulkCreate(
      aplicaciones.map((a) => ({ pagoId: pago.id, comprobanteId: a.factura.id, importe: dinero(a.importe), saldoDespues: dinero(a.saldoDespues) })),
      { transaction },
    );
    for (const a of aplicaciones) {
      await a.factura.update({ saldo: dinero(a.saldoDespues), estado: a.saldoDespues.isZero() ? 'pagado' : 'emitido' }, { transaction });
    }
    await intento.update({ estado: 'aprobado', pagoId: pago.id, medio: r.medio ?? 'debito', refExterna: r.referencia?.slice(0, 60) ?? null, resueltoEl: new Date() }, { transaction });
    await writeAudit({
      accion: 'cobro_online',
      entidad: 'pago',
      entidadId: pago.id,
      despues: { recibo: referenciaRecibo(pago), intento: intento.id, importe: dinero(cobrado), aFavor: dinero(resto), comprobantes: aplicaciones.map((a) => a.factura.id) },
      transaction,
    });
    if (socio.email) {
      await proveedorNotificaciones.enviar(
        [
          {
            socioId: socio.id,
            canal: 'email',
            destino: socio.email,
            asunto: `Recibimos tu pago de ${formatMoney(dinero(cobrado))}`,
            cuerpo: `Hola. Recibimos tu pago de ${formatMoney(dinero(cobrado))}. Tu recibo es el ${referenciaRecibo(pago)}: lo podés ver y descargar desde la app.`,
          },
        ],
        transaction,
      );
    }
    return pago.id;
  });
}

/**
 * Aviso servidor a servidor del proveedor (POST /pagos/notificacion/:proveedor). La cooperativa sale
 * del intento: el aviso no viene con sesión de nadie.
 */
export async function recibirNotificacion(payload: unknown, firma: string | undefined): Promise<void> {
  const r = await proveedorPagos.procesarNotificacion(payload, firma);
  const intento = await runUnscoped(() => IntentoPago.findByPk(r.intentoId, { attributes: ['id', 'cooperativaId'] }));
  if (!intento) throw notFound('No encontramos ese pago');
  await runInCooperativa(intento.cooperativaId, () => aplicarResultado(r));
}

/* ───────────────────────── Cómo quedó ───────────────────────── */

/**
 * Estado de un intento. Si sigue pendiente, le pregunta al proveedor (por si el aviso no llegó) y,
 * si pasó su vigencia sin respuesta, queda vencido.
 */
export async function estadoIntento(intento: IntentoPago): Promise<Omit<EstadoPagoOnline, 'deudaRestante'>> {
  if (intento.estado === 'pendiente') {
    const r = await proveedorPagos.consultarEstado(intento.id);
    if (r.estado !== 'pendiente') await aplicarResultado(r);
    await intento.reload();
    if (intento.estado === 'pendiente' && intento.venceEl.getTime() < Date.now()) {
      await IntentoPago.update({ estado: 'vencido', resueltoEl: new Date() }, { where: { id: intento.id, estado: 'pendiente' } });
      await intento.reload();
    }
  }
  const pago = intento.pagoId ? await Pago.findByPk(intento.pagoId) : null;
  return {
    id: intento.id,
    estado: intento.estado,
    total: dinero(intento.total),
    items: intento.itemsJson,
    medio: intento.medio,
    creadoEl: intento.creadoEl.toISOString(),
    resueltoEl: intento.resueltoEl ? intento.resueltoEl.toISOString() : null,
    motivo: intento.motivo,
    recibo: pago ? { id: pago.id, referencia: referenciaRecibo(pago) } : null,
    aFavor: pago && new Decimal(pago.aFavor).gt(0) ? dinero(pago.aFavor) : null,
  };
}
