// Caja (SPEC 6.6): cobrar, anular y cerrar con arqueo. Todo lo que mueve plata corre en una sola
// transacción y bloquea las filas que toca —la caja, las facturas, el stock—: dos cobros a la vez
// sobre la misma factura nunca la cobran dos veces. El SQL crudo lleva su filtro por cooperativa.
import Decimal from 'decimal.js';
import { QueryTypes, type Transaction } from 'sequelize';
import {
  formatMoney,
  letraDe,
  MEDIOS_PAGO,
  referenciaComprobante,
  type CajaResumen,
  type CobroInput,
  type EstadoPago,
  type MedioPago,
  type OrigenPago,
  type PagoListado,
  type ReciboDetalle,
  type ServicioConexion,
  type TipoComprobante,
  type TitularRecibo,
} from '../shared';
import { sequelize } from '../db';
import { Caja, Comprobante, Conexion, Cooperativa, Pago, PagoAplicacion, PagoItem, Producto, Socio, Usuario } from '../models';
import { writeAudit } from './audit';
import { runUnscoped } from './context';
import { badRequest, conflict, notFound } from './errors';
import { reservarNumeros } from './facturacion';
import { requireCooperativaId } from './tenant';

const dinero = (v: Decimal.Value) => new Decimal(v).toFixed(2);
const CERO = new Decimal(0);
// Los campos uno por uno: con `...p`, un modelo de Sequelize no copia sus atributos (y salía «Rcbo undefined»).
export const referenciaRecibo = (p: { letra: string; puntoVenta: number; numero: number }) =>
  referenciaComprobante({ tipo: 'recibo', letra: p.letra, puntoVenta: p.puntoVenta, numero: p.numero });

/* ───────────────────────── Cajas ───────────────────────── */

export function cajaAbiertaDe(usuarioId: number, transaction?: Transaction): Promise<Caja | null> {
  return Caja.findOne({ where: { cajeroId: usuarioId, cerradaEl: null }, transaction, lock: transaction ? transaction.LOCK.UPDATE : undefined });
}

/** Cada caja con lo que cobró, por medio de pago. */
export async function resumirCajas(cajas: Caja[]): Promise<CajaResumen[]> {
  if (cajas.length === 0) return [];
  const [totales, cajeros] = await Promise.all([
    sequelize.query<{ caja_id: number; medio: MedioPago; estado: EstadoPago; n: string; total: string }>(
      `SELECT caja_id, medio, estado, count(*) AS n, sum(importe) AS total FROM pagos
       WHERE cooperativa_id = :cooperativaId AND caja_id IN (:ids) GROUP BY caja_id, medio, estado`,
      { replacements: { cooperativaId: requireCooperativaId(), ids: cajas.map((c) => c.id) }, type: QueryTypes.SELECT },
    ),
    // Sin filtro de cooperativa: el cajero puede ser alguien de soporte (superadmin), que no pertenece a ninguna.
    runUnscoped(() => Usuario.findAll({ where: { id: [...new Set(cajas.map((c) => c.cajeroId))] }, attributes: ['id', 'nombre'] })),
  ]);
  const nombreDe = new Map(cajeros.map((u) => [u.id, u.nombre]));

  return cajas.map((c) => {
    const propias = totales.filter((t) => t.caja_id === c.id);
    const acreditados = propias.filter((t) => t.estado === 'acreditado');
    const porMedio = MEDIOS_PAGO.map((medio) => {
      const t = acreditados.find((x) => x.medio === medio);
      return { medio, cantidad: Number(t?.n ?? 0), total: dinero(t?.total ?? 0) };
    });
    const efectivo = porMedio.find((m) => m.medio === 'efectivo')!.total;
    const esperado = c.totalEsperado ?? new Decimal(c.fondoInicial).plus(efectivo);
    return {
      id: c.id,
      cajero: { id: c.cajeroId, nombre: nombreDe.get(c.cajeroId) ?? 'Soporte' },
      abiertaEl: c.abiertaEl.toISOString(),
      cerradaEl: c.cerradaEl ? c.cerradaEl.toISOString() : null,
      fondoInicial: dinero(c.fondoInicial),
      cobros: porMedio.reduce((n, m) => n + m.cantidad, 0),
      total: dinero(porMedio.reduce((t, m) => t.plus(m.total), CERO)),
      anulados: propias.filter((t) => t.estado === 'anulado').reduce((n, t) => n + Number(t.n), 0),
      porMedio,
      efectivoEsperado: dinero(esperado),
      contado: c.totalContado === null ? null : dinero(c.totalContado),
      diferencia: c.totalContado === null ? null : dinero(new Decimal(c.totalContado).minus(esperado)),
      nota: c.nota,
    };
  });
}

/** Cierra la caja abierta del usuario con el efectivo que contó. La diferencia queda guardada. */
export async function cerrarCaja(usuarioId: number, datos: { contado: string; nota?: string }): Promise<Caja> {
  return sequelize.transaction(async (transaction) => {
    const caja = await cajaAbiertaDe(usuarioId, transaction);
    if (!caja) throw conflict('No tenés ninguna caja abierta');
    const [fila] = await sequelize.query<{ efectivo: string | null }>(
      `SELECT sum(importe) AS efectivo FROM pagos WHERE cooperativa_id = :cooperativaId AND caja_id = :cajaId AND medio = 'efectivo' AND estado = 'acreditado'`,
      { replacements: { cooperativaId: requireCooperativaId(), cajaId: caja.id }, type: QueryTypes.SELECT, transaction },
    );
    const esperado = new Decimal(caja.fondoInicial).plus(fila?.efectivo ?? 0);
    const contado = new Decimal(datos.contado);
    const diferencia = contado.minus(esperado);
    const nota = datos.nota?.trim() || null;
    if (!diferencia.isZero() && (nota?.length ?? 0) < 5) {
      throw badRequest('Revisá los datos marcados', { nota: `${diferencia.gt(0) ? 'Sobran' : 'Faltan'} ${formatMoney(diferencia.abs().toFixed(2))}: contá qué pasó` });
    }
    await caja.update({ cerradaEl: new Date(), totalEsperado: dinero(esperado), totalContado: dinero(contado), nota }, { transaction });
    await writeAudit({
      accion: 'cerrar_caja',
      entidad: 'caja',
      entidadId: caja.id,
      despues: { esperado: dinero(esperado), contado: dinero(contado), diferencia: dinero(diferencia), nota },
      transaction,
    });
    return caja;
  });
}

/* ───────────────────────── Cobrar ───────────────────────── */

export async function titularDe(socio: Socio, transaction: Transaction): Promise<TitularRecibo> {
  const conexion = await Conexion.findOne({ where: { socioId: socio.id }, order: [['numero', 'ASC']], attributes: ['direccion'], transaction });
  return { numero: socio.numero, nombre: socio.nombre, tipoDoc: socio.tipoDoc, nroDoc: socio.nroDoc, direccion: conexion?.direccion ?? null };
}

/**
 * Registra un cobro del mostrador: aplica el pago a las facturas elegidas (entero o en parte),
 * descuenta el stock de lo vendido y le da al recibo su número. Con la misma `clave` no cobra dos veces.
 */
export async function registrarCobro(input: CobroInput, usuarioId: number): Promise<{ id: number; repetido: boolean }> {
  const cooperativaId = requireCooperativaId();
  const previo = await Pago.findOne({ where: { clave: input.clave }, attributes: ['id'] });
  if (previo) return { id: previo.id, repetido: true };

  try {
    return await sequelize.transaction(async (transaction) => {
      // Bloquea la caja: no se puede cerrar mientras entra este cobro, y los cobros de un cajero van de a uno.
      const caja = await cajaAbiertaDe(usuarioId, transaction);
      if (!caja) throw conflict('Primero abrí la caja');
      // El mismo pedido mandado dos veces seguidas: el segundo esperó acá y ahora encuentra el cobro hecho.
      const repetido = await Pago.findOne({ where: { clave: input.clave }, attributes: ['id'], transaction });
      if (repetido) return { id: repetido.id, repetido: true };
      const coop = await Cooperativa.findByPk(cooperativaId, { transaction });
      const socio = input.socioId === null ? null : await Socio.findByPk(input.socioId, { transaction });
      if (input.socioId !== null && !socio) throw notFound('No encontramos ese socio');

      let total = CERO;

      const idsFacturas = input.aplicaciones.map((a) => a.comprobanteId);
      const facturas = idsFacturas.length
        ? await Comprobante.findAll({ where: { id: idsFacturas }, order: [['id', 'ASC']], transaction, lock: transaction.LOCK.UPDATE })
        : [];
      const facturaPorId = new Map(facturas.map((f) => [f.id, f]));
      const aplicaciones = input.aplicaciones.map((a) => {
        const f = facturaPorId.get(a.comprobanteId);
        if (!f || f.tipo !== 'factura' || f.socioId !== input.socioId) throw conflict('Una de las facturas no es de este socio. Volvé a buscarlo.');
        const ref = referenciaComprobante(f);
        if (f.estado === 'pagado') throw conflict(`${ref} ya está pagada. Volvé a buscar al socio para ver lo que debe ahora.`);
        if (f.estado !== 'emitido') throw conflict(`${ref} no se puede cobrar`);
        const importe = new Decimal(a.importe);
        if (importe.lte(0)) throw conflict(`${ref}: el importe tiene que ser mayor a cero`);
        if (importe.gt(f.saldo)) throw conflict(`${ref}: se debe ${formatMoney(f.saldo)}, no se puede cobrar ${formatMoney(importe.toFixed(2))}`);
        total = total.plus(importe);
        return { factura: f, importe, saldoDespues: new Decimal(f.saldo).minus(importe) };
      });

      const idsProductos = input.items.map((i) => i.productoId);
      const productos = idsProductos.length
        ? await Producto.findAll({ where: { id: idsProductos }, order: [['id', 'ASC']], transaction, lock: transaction.LOCK.UPDATE })
        : [];
      const productoPorId = new Map(productos.map((p) => [p.id, p]));
      const items = input.items.map((i) => {
        const p = productoPorId.get(i.productoId);
        if (!p || !p.activo) throw conflict('Uno de los productos ya no está a la venta');
        if (p.stock !== null && p.stock < i.cantidad) throw conflict(p.stock === 0 ? `No queda stock de ${p.nombre}` : `De ${p.nombre} quedan ${p.stock}, no ${i.cantidad}`);
        const importe = new Decimal(p.precio).mul(i.cantidad);
        total = total.plus(importe);
        return { producto: p, cantidad: i.cantidad, importe };
      });
      if (total.lte(0)) throw conflict('No hay nada para cobrar');

      // En efectivo, sin decir con cuánto paga, se toma como pago justo.
      let recibido: Decimal | null = null;
      if (input.medio === 'efectivo') {
        recibido = input.recibido === undefined ? total : new Decimal(input.recibido);
        if (recibido.lt(total)) throw conflict(`Con ${formatMoney(recibido.toFixed(2))} no alcanza: son ${formatMoney(total.toFixed(2))}`);
      }

      const numeracion = { letra: socio ? letraDe(socio.condicionIva) : 'B', puntoVenta: coop!.configJson.puntoVenta };
      const numero = await reservarNumeros({ tipo: 'recibo' satisfies TipoComprobante, ...numeracion }, 1, transaction);
      const pago = await Pago.create(
        {
          cajaId: caja.id,
          cajeroId: usuarioId,
          socioId: socio?.id ?? null,
          ...numeracion,
          numero,
          medio: input.medio,
          origen: 'mostrador',
          importe: dinero(total),
          recibido: recibido ? dinero(recibido) : null,
          vuelto: recibido ? dinero(recibido.minus(total)) : null,
          refExterna: input.medio === 'efectivo' ? null : input.referencia || null,
          clave: input.clave,
          snapshotJson: { titular: socio ? await titularDe(socio, transaction) : null },
        },
        { transaction },
      );
      await PagoAplicacion.bulkCreate(
        aplicaciones.map((a) => ({ pagoId: pago.id, comprobanteId: a.factura.id, importe: dinero(a.importe), saldoDespues: dinero(a.saldoDespues) })),
        { transaction },
      );
      await PagoItem.bulkCreate(
        items.map((i) => ({ pagoId: pago.id, productoId: i.producto.id, descripcion: i.producto.nombre, cantidad: i.cantidad, unitario: dinero(i.producto.precio), importe: dinero(i.importe) })),
        { transaction },
      );
      for (const a of aplicaciones) {
        await a.factura.update({ saldo: dinero(a.saldoDespues), estado: a.saldoDespues.isZero() ? 'pagado' : 'emitido' }, { transaction });
      }
      for (const i of items) {
        if (i.producto.stock !== null) await i.producto.update({ stock: i.producto.stock - i.cantidad }, { transaction });
      }
      await writeAudit({
        accion: 'cobrar',
        entidad: 'pago',
        entidadId: pago.id,
        despues: {
          recibo: referenciaRecibo(pago),
          cajaId: caja.id,
          socioId: socio?.id ?? null,
          medio: input.medio,
          importe: dinero(total),
          comprobantes: aplicaciones.map((a) => ({ id: a.factura.id, importe: dinero(a.importe) })),
          productos: items.map((i) => ({ id: i.producto.id, cantidad: i.cantidad })),
        },
        transaction,
      });
      return { id: pago.id, repetido: false };
    });
  } catch (err) {
    // Dos pedidos iguales al mismo tiempo: el segundo choca con la clave y devuelve el cobro del primero.
    if ((err as { name?: string }).name === 'SequelizeUniqueConstraintError') {
      const ya = await Pago.findOne({ where: { clave: input.clave }, attributes: ['id'] });
      if (ya) return { id: ya.id, repetido: true };
    }
    throw err;
  }
}

/**
 * Anula un cobro: las facturas vuelven a deberse y el stock vuelve al depósito. El recibo no se
 * borra: queda anulado, con quién lo anuló y por qué. El arqueo de una caja ya cerrada no cambia.
 */
export async function anularCobro(id: number, motivo: string, usuarioId: number): Promise<void> {
  await sequelize.transaction(async (transaction) => {
    const pago = await Pago.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!pago) throw notFound('No encontramos ese cobro');
    if (pago.estado === 'anulado') throw conflict('Ese cobro ya está anulado');

    const aplicaciones = await PagoAplicacion.findAll({ where: { pagoId: id }, transaction });
    const facturas = aplicaciones.length
      ? await Comprobante.findAll({ where: { id: aplicaciones.map((a) => a.comprobanteId) }, order: [['id', 'ASC']], transaction, lock: transaction.LOCK.UPDATE })
      : [];
    const importeDe = new Map(aplicaciones.map((a) => [a.comprobanteId, a.importe]));
    for (const f of facturas) {
      if (f.estado === 'anulado') throw conflict(`${referenciaComprobante(f)} está anulada: este cobro no se puede anular`);
      const saldo = new Decimal(f.saldo).plus(importeDe.get(f.id)!);
      await f.update({ saldo: dinero(saldo), estado: 'emitido' }, { transaction });
    }

    const items = await PagoItem.findAll({ where: { pagoId: id }, transaction });
    for (const i of items) {
      if (i.productoId == null) continue;
      const producto = await Producto.findByPk(i.productoId, { transaction, lock: transaction.LOCK.UPDATE });
      if (producto && producto.stock !== null) await producto.update({ stock: producto.stock + i.cantidad }, { transaction });
    }

    await pago.update({ estado: 'anulado', anuladoEl: new Date(), anuladoPor: usuarioId, motivoAnulacion: motivo }, { transaction });
    await writeAudit({
      accion: 'anular_cobro',
      entidad: 'pago',
      entidadId: pago.id,
      antes: { estado: 'acreditado', importe: pago.importe, medio: pago.medio, cajaId: pago.cajaId },
      despues: { estado: 'anulado', motivo, recibo: referenciaRecibo(pago), comprobantes: facturas.map((f) => f.id) },
      transaction,
    });
  });
}

/* ───────────────────────── Consultas ───────────────────────── */

interface FilaPago {
  id: number;
  letra: string;
  punto_venta: number;
  numero: number;
  cobrado_el: Date;
  medio: MedioPago;
  origen: OrigenPago;
  importe: string;
  estado: EstadoPago;
  socio_id: number | null;
  socio_numero: number | null;
  socio_nombre: string | null;
  cajero: string | null;
  facturas: string;
  productos: string | null;
}

// Condiciones fijas: nunca se arman con texto del pedido.
const FILTRO_PAGOS = {
  caja: 'p.caja_id = :valor',
  socio: 'p.socio_id = :valor',
  pago: 'p.id = :valor',
} as const;

/** Cobros de una caja, de un socio o uno solo, del más nuevo al más viejo. */
export async function listarPagos(filtro: keyof typeof FILTRO_PAGOS, valor: number, limite = 500): Promise<PagoListado[]> {
  const filas = await sequelize.query<FilaPago>(
    `SELECT p.id, p.letra, p.punto_venta, p.numero, p.cobrado_el, p.medio, p.origen, p.importe, p.estado, p.socio_id,
            CAST(p.snapshot_json->'titular'->>'numero' AS int) AS socio_numero, p.snapshot_json->'titular'->>'nombre' AS socio_nombre, u.nombre AS cajero,
            (SELECT count(*) FROM pago_aplicaciones a WHERE a.pago_id = p.id) AS facturas,
            (SELECT string_agg(CASE WHEN i.cantidad > 1 THEN i.cantidad || ' × ' ELSE '' END || i.descripcion, ', ' ORDER BY i.id) FROM pago_items i WHERE i.pago_id = p.id) AS productos
     FROM pagos p LEFT JOIN usuarios u ON u.id = p.cajero_id
     WHERE p.cooperativa_id = :cooperativaId AND ${FILTRO_PAGOS[filtro]}
     ORDER BY p.cobrado_el DESC, p.id DESC LIMIT :limite`,
    { replacements: { cooperativaId: requireCooperativaId(), valor, limite }, type: QueryTypes.SELECT },
  );
  return filas.map((f) => {
    const n = Number(f.facturas);
    const concepto = [n > 0 ? `${n} ${n === 1 ? 'factura' : 'facturas'}` : null, f.productos].filter(Boolean).join(' + ');
    return {
      id: f.id,
      referencia: referenciaRecibo({ letra: f.letra, puntoVenta: f.punto_venta, numero: f.numero }),
      cobradoEl: f.cobrado_el.toISOString(),
      socio: f.socio_id !== null && f.socio_numero !== null ? { id: f.socio_id, numero: f.socio_numero, nombre: f.socio_nombre ?? '' } : null,
      medio: f.medio,
      origen: f.origen,
      importe: dinero(f.importe),
      estado: f.estado,
      cajero: f.cajero,
      concepto,
    };
  });
}

/** Todo lo que lleva impreso un recibo. */
export async function detalleRecibo(id: number): Promise<ReciboDetalle | null> {
  const [listado] = await listarPagos('pago', id, 1);
  if (!listado) return null;
  const cooperativaId = requireCooperativaId();
  const [pago, aplicaciones, items] = await Promise.all([
    Pago.findByPk(id),
    sequelize.query<{ comprobante_id: number; tipo: TipoComprobante; letra: string; punto_venta: number; numero: number; servicio: ServicioConexion; anio: number; mes: number; importe: string; saldo_despues: string }>(
      `SELECT a.comprobante_id, c.tipo, c.letra, c.punto_venta, c.numero, c.servicio, c.anio, c.mes, a.importe, a.saldo_despues
       FROM pago_aplicaciones a JOIN comprobantes c ON c.id = a.comprobante_id
       WHERE a.cooperativa_id = :cooperativaId AND a.pago_id = :id ORDER BY c.anio, c.mes, c.id`,
      { replacements: { cooperativaId, id }, type: QueryTypes.SELECT },
    ),
    PagoItem.findAll({ where: { pagoId: id }, order: [['id', 'ASC']] }),
  ]);
  if (!pago) return null;
  const anuladoPor = pago.anuladoPor == null ? null : await runUnscoped(() => Usuario.findByPk(pago.anuladoPor!, { attributes: ['nombre'] }));
  return {
    ...listado,
    letra: pago.letra,
    puntoVenta: pago.puntoVenta,
    numero: pago.numero,
    cajaId: pago.cajaId,
    titular: pago.snapshotJson.titular,
    recibido: pago.recibido == null ? null : dinero(pago.recibido),
    vuelto: pago.vuelto == null ? null : dinero(pago.vuelto),
    referenciaPago: pago.refExterna,
    aplicaciones: aplicaciones.map((a) => ({
      comprobanteId: a.comprobante_id,
      referencia: referenciaComprobante({ tipo: a.tipo, letra: a.letra, puntoVenta: a.punto_venta, numero: a.numero }),
      servicio: a.servicio,
      anio: a.anio,
      mes: a.mes,
      importe: dinero(a.importe),
      saldoDespues: dinero(a.saldo_despues),
    })),
    items: items.map((i) => ({ descripcion: i.descripcion, cantidad: i.cantidad, unitario: dinero(i.unitario), importe: dinero(i.importe) })),
    aFavor: new Decimal(pago.aFavor).gt(0) ? dinero(pago.aFavor) : null,
    anulacion: pago.estado === 'anulado' ? { motivo: pago.motivoAnulacion ?? '', fecha: pago.anuladoEl!.toISOString(), por: anuladoPor?.nombre ?? null } : null,
  };
}
