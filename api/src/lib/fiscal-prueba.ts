// Facturas de prueba en homologación: pide a ARCA el CAE de unas pocas facturas reales de la
// cooperativa, con su mismo detalle (importes, IVA, tributos, receptor), para ver qué contesta ARCA
// antes de emitir un mes entero. No toca las facturas de la app. Los números que ARCA autoriza se
// descuentan del talonario, así GestiónCoop y ARCA siguen yendo por el mismo número.
import { QueryTypes } from 'sequelize';
import { referenciaComprobante, type CondicionIva, type EmisionPruebaArca, type FacturaPruebaArca, type ServicioConexion } from '../shared';
import { sequelize } from '../db';
import { sumarDias } from '../motor';
import { Cooperativa, ProcesoFacturacionModel } from '../models';
import { ErrorArca } from './arca/transporte';
import { writeAudit } from './audit';
import { conflict } from './errors';
import { reservarNumeros } from './facturacion';
import { conArca, proveedorArca } from './fiscal';
import { cargarParametros, hoy } from './tarifas';
import { requireCooperativaId } from './tenant';

const MUESTRA = 10;

interface FilaMuestra {
  id: number;
  letra: string;
  punto_venta: number;
  numero: number;
  servicio: ServicioConexion;
  total: string;
  condicion_iva: CondicionIva | null;
  socio_numero: number;
  socio_nombre: string;
}

/** Para deshacer la reserva del número cuando ARCA no autoriza la factura. */
class NoAutorizada extends Error {}

export async function emitirFacturasDePrueba(): Promise<EmisionPruebaArca> {
  const { cfg, cuit, ambiente } = await conArca();
  if (ambiente !== 'homologacion') throw conflict('Las facturas de prueba son solo para homologación: en producción tendrían validez fiscal.');
  if (await ProcesoFacturacionModel.count({ where: { estado: 'en_curso' } })) throw conflict('Hay un trabajo de facturación en marcha. Esperá a que termine.');
  const cooperativaId = requireCooperativaId();
  const [coop, parametros] = await Promise.all([Cooperativa.findByPk(cooperativaId), cargarParametros()]);
  const puntoVenta = coop!.configJson.puntoVenta;

  // Del último mes emitido, una factura por cada letra, servicio y condición frente al IVA del socio:
  // así se prueban todas las formas en que la cooperativa le factura a ARCA.
  const muestra = await sequelize.query<FilaMuestra>(
    `SELECT * FROM (
       SELECT DISTINCT ON (c.letra, c.servicio, c.snapshot_json->'titular'->>'condicionIva')
              c.id, c.letra, c.punto_venta, c.numero, c.servicio, c.total::text AS total, c.orden,
              c.snapshot_json->'titular'->>'condicionIva' AS condicion_iva, s.numero AS socio_numero, s.nombre AS socio_nombre
       FROM comprobantes c JOIN socios s ON s.id = c.socio_id
       WHERE c.cooperativa_id = $cooperativaId AND c.tipo = 'factura' AND c.estado IN ('emitido', 'pagado') AND c.total > 0 AND c.numero IS NOT NULL
         AND c.anio * 12 + c.mes = (SELECT max(anio * 12 + mes) FROM comprobantes
                                    WHERE cooperativa_id = $cooperativaId AND tipo = 'factura' AND estado IN ('emitido', 'pagado'))
       ORDER BY c.letra, c.servicio, c.snapshot_json->'titular'->>'condicionIva', c.orden, c.id
     ) m ORDER BY letra, servicio, condicion_iva LIMIT ${MUESTRA}`,
    { bind: { cooperativaId }, type: QueryTypes.SELECT },
  );
  if (muestra.length === 0) throw conflict('Esta cooperativa todavía no emitió facturas para usar de muestra.');

  const fecha = hoy();
  const venceEl = sumarDias(fecha, parametros.diasVencimiento);
  const proveedor = proveedorArca(cfg, cuit, ambiente);
  const facturas: FacturaPruebaArca[] = [];

  // Una por una, cada una en su transacción: si ARCA rechaza una, su número vuelve al talonario y las demás siguen.
  for (const m of muestra) {
    const base = {
      muestraId: m.id,
      muestra: referenciaComprobante({ tipo: 'factura', letra: m.letra, puntoVenta: m.punto_venta, numero: m.numero }),
      socio: { numero: m.socio_numero, nombre: m.socio_nombre },
      servicio: m.servicio,
      condicionIva: m.condicion_iva,
      letra: m.letra,
      total: m.total,
    };
    try {
      const r = await sequelize.transaction(async (transaction) => {
        const numero = await reservarNumeros({ tipo: 'factura', letra: m.letra, puntoVenta }, 1, transaction);
        const { autorizados, rechazo } = await proveedor.autorizar([{ id: m.id, tipo: 'factura', letra: m.letra, puntoVenta, numero, total: m.total, fecha, venceEl }], transaction);
        const a = autorizados.get(m.id);
        if (!a) throw new NoAutorizada(rechazo?.motivo ?? 'ARCA no la autorizó.');
        return { referencia: referenciaComprobante({ tipo: 'factura', letra: m.letra, puntoVenta, numero }), cae: a.cae, caeVence: a.caeVence, motivo: null };
      });
      facturas.push({ ...base, ...r });
    } catch (err) {
      if (!(err instanceof NoAutorizada) && !(err instanceof ErrorArca)) throw err;
      facturas.push({ ...base, referencia: null, cae: null, caeVence: null, motivo: err.message });
      // Sin conexión o con la numeración desalineada, las que siguen fallarían igual.
      if (err instanceof ErrorArca) break;
    }
  }

  const autorizadas = facturas.filter((f) => f.cae).length;
  await writeAudit({
    accion: 'facturas_prueba_arca',
    entidad: 'config_fiscal',
    entidadId: cooperativaId,
    despues: { ambiente, puntoVenta, fecha, autorizadas, facturas: facturas.map((f) => ({ muestra: f.muestraId, referencia: f.referencia, cae: f.cae, motivo: f.motivo })) },
  });
  return { fecha, puntoVenta, autorizadas, facturas };
}
