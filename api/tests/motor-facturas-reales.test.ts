// El motor, con las tarifas del seed de Dos de Mayo, tiene que dar los mismos importes que las dos
// facturas reales de la cooperativa, renglón por renglón y al centavo.
// De las facturas se usa solo la estructura y los importes: ningún dato del titular.
import { describe, expect, it } from 'vitest';
import type { EntradaFactura, FacturaCalculada } from '../src/shared';
import { calcularFactura } from '../src/motor';
import { TARIFAS_DOS_DE_MAYO } from '../src/seed/tarifas';

const { cuadros, conceptos, parametros } = TARIFAS_DOS_DE_MAYO;

const renglon = (f: FacturaCalculada, codigo: string) => f.renglones.find((r) => r.codigo === codigo)!;

describe('factura de agua potable 08/2026 (residencial, 66 m³)', () => {
  const entrada: EntradaFactura = {
    servicio: 'agua',
    // Lectura anterior 14/07, actual 14/08: 31 días facturados.
    periodo: { anio: 2026, mes: 8, desde: '2026-07-15', hasta: '2026-08-14' },
    condicionIva: 'consumidor_final',
    suministro: { categoria: 'residencial', tieneSubsidio: false, fechaAlta: '2015-03-01', fechaBaja: null },
    lecturas: [{ anterior: '2166', actual: '2232', factor: '1' }],
    cuadros,
    conceptos,
    // La factura trae el interés ya calculado: no dice la tasa ni los días.
    cargosParticulares: [{ codigo: 'MORA', descripcion: 'Int. por mora factura anterior', importe: '9559.85', grupo: 'recargo' }],
    parametros,
  };
  const f = calcularFactura(entrada);

  it('factura 31 días y 66 m³', () => {
    expect(f.dias).toBe(31);
    expect(f.consumo).toMatchObject({ unidad: 'm³', medido: '66', facturado: '66' });
  });

  it('cuota fija y escalones', () => {
    const basico = f.renglones.filter((r) => r.grupo === 'basico').map((r) => [r.descripcion, r.cantidad, r.unitario, r.importe]);
    expect(basico).toEqual([
      ['Cuota fija agua potable', '1', '866.2', '866.20'],
      ['Primeros 5 m³', '5', '2606.1688', '13030.84'],
      ['Siguientes 5 m³', '5', '2708.9944', '13544.97'],
      ['Siguientes 10 m³', '10', '2860.7666', '28607.67'],
      ['Siguientes 10 m³', '10', '4007.6976', '40076.98'],
      ['Excedente de 30 m³', '36', '5339.4216', '192219.18'],
    ]);
    expect(f.totales.subtotal).toBe('288345.84');
  });

  it('gravámenes, con las mismas bases que imprime la factura', () => {
    // 3,31 % sobre 274.800,87 = subtotal menos el segundo escalón (13.544,97).
    expect(renglon(f, 'DGR_AP')).toMatchObject({ porcentaje: '3.31', base: '274800.87', importe: '9095.91' });
    expect(renglon(f, 'IVA_AP')).toMatchObject({ porcentaje: '21', base: '288345.84', importe: '60552.63' });
    expect(f.totales.gravamenes).toBe('69648.54');
    expect(f.totales.servicio).toBe('357994.38');
  });

  it('adicionales por mora y total', () => {
    expect(renglon(f, 'IVA_RECARGOS')).toMatchObject({ grupo: 'recargo', base: '9559.85', importe: '2007.57' });
    expect(f.totales.recargos).toBe('11567.42');
    expect(f.totales.total).toBe('369561.80');
  });
});

describe('factura de energía eléctrica 06/2026 (residencial con subsidio, 1.176 kWh)', () => {
  const entrada: EntradaFactura = {
    servicio: 'energia',
    // Lectura anterior 17/05, actual 17/06: 31 días facturados.
    periodo: { anio: 2026, mes: 6, desde: '2026-05-18', hasta: '2026-06-17' },
    condicionIva: 'consumidor_final',
    suministro: { categoria: 'residencial', tieneSubsidio: true, fechaAlta: '2015-03-01', fechaBaja: null },
    lecturas: [{ anterior: '23933', actual: '25109', factor: '1' }],
    cuadros,
    conceptos,
    cargosParticulares: [
      // Cargo propio de esa conexión: entra en el subtotal (paga IVA) pero no en la base de las tasas.
      { codigo: 'PRG_ACOMP', descripcion: 'Prg. acomp. energ. transitorio', importe: '27506.60', grupo: 'cargo' },
      { codigo: 'MORA', descripcion: 'Int. por mora factura anterior', importe: '6492.82', grupo: 'recargo' },
    ],
    parametros,
  };
  const f = calcularFactura(entrada);

  it('factura 1.176 kWh', () => {
    expect(f.dias).toBe(31);
    expect(f.consumo).toMatchObject({ unidad: 'kWh', medido: '1176', facturado: '1176' });
  });

  it('cuota fija y escalones', () => {
    const basico = f.renglones.filter((r) => r.grupo === 'basico').map((r) => [r.descripcion, r.cantidad, r.unitario, r.importe]);
    expect(basico).toEqual([
      ['Cuota fija energía eléctrica', '1', '2640.9', '2640.90'],
      ['Primeros 30 kWh', '30', '104.534', '3136.02'],
      ['Siguientes 90 kWh', '90', '104.534', '9408.06'],
      ['Siguientes 250 kWh', '250', '196.943', '49235.75'],
      ['Siguientes 150 kWh', '150', '268.641', '40296.15'],
      ['Siguientes 80 kWh', '80', '109.025', '8722.00'],
      ['Siguientes 100 kWh', '100', '109.025', '10902.50'],
      ['Excedente de 700 kWh', '476', '268.641', '127873.12'],
    ]);
    expect(f.totales.basico).toBe('252214.50');
    expect(f.totales.subtotal).toBe('279721.10');
  });

  it('gravámenes, con las mismas bases que imprime la factura', () => {
    expect(renglon(f, 'CAP_ACCIONES')).toMatchObject({ base: '252214.50', importe: '25221.45' });
    expect(renglon(f, 'LEY_2620')).toMatchObject({ base: '252214.50', importe: '7566.44' }); // 7.566,435 → medio hacia arriba
    expect(renglon(f, 'ALUMBRADO').importe).toBe('9000.00');
    expect(renglon(f, 'LEY_3195')).toMatchObject({ base: '252214.50', importe: '8348.30' });
    expect(renglon(f, 'IVA_EE')).toMatchObject({ base: '279721.10', importe: '58741.43' });
    expect(renglon(f, 'LEY_25957').importe).toBe('2677.71');
    expect(f.renglones.some((r) => r.codigo === 'IVA_EE_27')).toBe(false);
    expect(f.totales.gravamenes).toBe('111555.33');
    expect(f.totales.servicio).toBe('391276.43');
  });

  it('adicionales y total', () => {
    expect(renglon(f, 'BOMBEROS')).toMatchObject({ grupo: 'adicional', importe: '2252.00' });
    expect(renglon(f, 'IVA_RECARGOS')).toMatchObject({ base: '6492.82', importe: '1363.49' });
    expect(f.totales.adicionales).toBe('2252.00');
    expect(f.totales.recargos).toBe('7856.31');
    expect(f.totales.total).toBe('401384.74');
  });
});
