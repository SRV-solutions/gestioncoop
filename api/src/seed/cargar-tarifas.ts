// Guarda las tarifas iniciales de una cooperativa (seed/tarifas.ts). Solo si todavía no tiene
// ninguna: lo que se haya cargado desde la app no se pisa.
import { sequelize } from '../db';
import { runInCooperativa } from '../lib/context';
import { Concepto, Cooperativa, CuadroTarifario, Escalon } from '../models';
import type { TarifasSeed } from './tarifas';

export async function cargarTarifas(cooperativaId: number, tarifas: TarifasSeed): Promise<{ cuadros: number; conceptos: number } | null> {
  return runInCooperativa(cooperativaId, () =>
    sequelize.transaction(async (transaction) => {
      const tx = { transaction };
      if ((await CuadroTarifario.count(tx)) > 0 || (await Concepto.count(tx)) > 0) return null;

      for (const c of tarifas.cuadros) {
        const cuadro = await CuadroTarifario.create(
          {
            servicio: c.servicio,
            categoria: c.categoria,
            conSubsidio: c.conSubsidio,
            vigenteDesde: c.vigenteDesde,
            vigenteHasta: c.vigenteHasta,
            cargoFijo: c.cargoFijo,
            nota: 'Carga inicial',
          },
          tx,
        );
        await Escalon.bulkCreate(
          c.escalones.map((e) => ({
            cuadroId: cuadro.id,
            desde: e.desde,
            hasta: e.hasta,
            precioUnitario: e.precio,
            subsidiado: e.subsidiado,
            exentoDe: e.exentoDe,
          })),
          tx,
        );
      }
      await Concepto.bulkCreate(
        tarifas.conceptos.map((c) => ({
          codigo: c.codigo,
          nombre: c.nombre,
          tipo: c.tipo,
          valor: c.valor,
          base: c.base,
          grupo: c.grupo,
          aplicaA: c.servicio,
          categorias: c.categorias,
          condicionesIva: c.condicionesIva,
          orden: c.orden,
          vigenteDesde: c.vigenteDesde,
          vigenteHasta: c.vigenteHasta,
        })),
        tx,
      );

      const coop = await Cooperativa.findByPk(cooperativaId, tx);
      if (coop && !coop.configJson.facturacion) {
        coop.configJson = { ...coop.configJson, facturacion: tarifas.parametros };
        await coop.save(tx);
      }
      return { cuadros: tarifas.cuadros.length, conceptos: tarifas.conceptos.length };
    }),
  );
}
