// Balance de energía de prueba (SPEC 6.9): por cada mes ya facturado, cuánta energía entró a la red
// —comprada al mayorista y, si la cooperativa genera, de su propia usina—. Se arma al revés: a lo
// facturado se le suman pérdidas creíbles (entre 9 y 14 %, algo más en verano).
// Se carga una sola vez, cuando la cooperativa no tiene ningún mes cargado. Todo es inventado.
import { QueryTypes } from 'sequelize';
import { sequelize } from '../db';
import { runInCooperativa } from '../lib/context';
import { BalanceEnergia } from '../models';
import { crearAzar } from './cargar-lecturas';

export async function cargarBalance(cooperativaId: number, o: { semilla: number; generacionPropia: boolean }): Promise<number | null> {
  return runInCooperativa(cooperativaId, async () => {
    if ((await BalanceEnergia.count()) > 0) return null;
    const meses = await sequelize.query<{ anio: number; mes: number; kwh: string }>(
      `SELECT anio, mes, sum(consumo) AS kwh FROM comprobantes
       WHERE cooperativa_id = :cooperativaId AND tipo = 'factura' AND estado IN ('emitido', 'pagado') AND servicio = 'energia'
       GROUP BY anio, mes HAVING sum(consumo) > 0 ORDER BY anio, mes`,
      { replacements: { cooperativaId }, type: QueryTypes.SELECT },
    );
    if (meses.length === 0) return null;
    const azar = crearAzar(o.semilla + 707);
    await BalanceEnergia.bulkCreate(
      meses.map((m) => {
        const verano = [12, 1, 2, 3].includes(m.mes) ? 0.015 : 0;
        const perdida = azar.entre(0.09, 0.125) + verano;
        const entrada = Math.round(Number(m.kwh) / (1 - perdida));
        // La generación propia cubre una parte chica y variable (depende del agua del arroyo).
        const generada = o.generacionPropia ? Math.round(entrada * azar.entre(0.11, 0.19)) : 0;
        return { anio: m.anio, mes: m.mes, compradaKwh: String(entrada - generada), generadaKwh: String(generada), nota: 'Dato ilustrativo de la demo' };
      }),
    );
    return meses.length;
  });
}
