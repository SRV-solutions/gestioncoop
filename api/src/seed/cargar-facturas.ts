// Facturas de prueba (SPEC sección 9): 12 meses de historial, emitidos con el mismo código que usa
// la facturación de verdad —el motor, la numeración, la mora—, mes por mes y en orden. Después de
// cada mes se marca qué quedó pago, para llegar a una morosidad parecida a la real: cerca del 18 %
// de los socios con deuda y el 5 % con tres meses o más.
// Se cargan una sola vez, cuando la cooperativa todavía no tiene comprobantes. Todo es inventado.
import { QueryTypes } from 'sequelize';
import { sequelize } from '../db';
import { runInCooperativa } from '../lib/context';
import { calcularPrefacturas, emitirBorradores } from '../lib/facturacion';
import { parametrosDe } from '../lib/tarifas';
import { Comprobante, Cooperativa, Periodo } from '../models';
import { crearAzar } from './cargar-lecturas';

export interface OpcionesFacturas {
  semilla: number;
  /** Día del mes en que se emitía la facturación de cada mes del historial. */
  diaEmision?: number;
}

export async function cargarFacturas(cooperativaId: number, opciones: OpcionesFacturas): Promise<{ meses: number; facturas: number; impagas: number } | null> {
  return runInCooperativa(cooperativaId, async () => {
    if ((await Comprobante.count()) > 0) return null;
    const meses = await Periodo.findAll({ where: { estado: 'cerrado', servicio: 'energia' }, order: [['anio', 'ASC'], ['mes', 'ASC']] });
    if (meses.length === 0) return null;
    const coop = await Cooperativa.findByPk(cooperativaId);
    const { diasVencimiento } = parametrosDe(coop!.configJson);

    // Cuántos de los últimos meses debe cada socio. El socio de la demo (el que tiene usuario) debe
    // solo el último mes: tiene algo para pagar desde el portal, sin intereses de meses anteriores.
    const socios = await sequelize.query<{ id: number; usuario_id: number | null }>(`SELECT id, usuario_id FROM socios WHERE cooperativa_id = :cooperativaId ORDER BY id`, {
      replacements: { cooperativaId },
      type: QueryTypes.SELECT,
    });
    const azar = crearAzar(opciones.semilla + 404);
    const mesesQueDebe = new Map<number, number>();
    for (const s of socios) {
      const suerte = azar.next();
      const debe = suerte < 0.05 ? 3 + Math.floor(azar.next() * 4) : suerte < 0.18 ? 1 + Math.floor(azar.next() * 2) : 0;
      if (s.usuario_id !== null) mesesQueDebe.set(s.id, 1);
      else if (debe > 0) mesesQueDebe.set(s.id, debe);
    }

    let facturas = 0;
    for (const [i, p] of meses.entries()) {
      const { anio, mes } = p;
      const fechaEmision = `${anio}-${String(mes).padStart(2, '0')}-${String(opciones.diaEmision ?? 18).padStart(2, '0')}`;
      await calcularPrefacturas({ anio, mes, fechaEmision, historial: true });
      const { emitidas } = await emitirBorradores({ anio, mes, fechaEmision, diasVencimiento });
      facturas += emitidas;
      // Lo que no se pudo calcular en un mes viejo (un servicio sin tarifa cargada todavía) no se arrastra.
      await Comprobante.destroy({ where: { anio, mes, estado: 'borrador' } });

      // Se paga todo, menos lo de quienes deben este mes: los que deben más meses que los que faltan hasta hoy.
      const faltan = meses.length - 1 - i;
      const deudores = [...mesesQueDebe].filter(([, debe]) => debe > faltan).map(([id]) => id);
      await sequelize.query(
        `UPDATE comprobantes SET estado = 'pagado', saldo = 0, actualizado_el = now()
         WHERE cooperativa_id = :cooperativaId AND anio = :anio AND mes = :mes AND tipo = 'factura' AND estado = 'emitido'
           ${deudores.length ? 'AND socio_id NOT IN (:deudores)' : ''}`,
        { replacements: { cooperativaId, anio, mes, deudores } },
      );
    }
    const impagas = await Comprobante.count({ where: { tipo: 'factura', estado: 'emitido' } });
    return { meses: meses.length, facturas, impagas };
  });
}
