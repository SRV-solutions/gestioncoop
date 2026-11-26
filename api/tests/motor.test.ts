// Motor de cálculo: casos borde del SPEC (sección 12) con una tarifa de números redondos,
// para que cada resultado se pueda verificar a mano.
import { describe, expect, it } from 'vitest';
import type { ConceptoTarifa, CuadroTarifa, EntradaFactura, FacturaCalculada } from '../src/shared';
import { calcularFactura, calcularInteresMora, diasEntre, ErrorDeCalculo, interseccion, mesCompleto, numeroDeDia, redondear, sumarDias } from '../src/motor';
import { TARIFAS_DOS_DE_MAYO } from '../src/seed/tarifas';

/* ───────────────────────── Tarifa de prueba ───────────────────────── */

const escalonesSimples = (p1: string, p2: string, p3: string): CuadroTarifa['escalones'] => [
  { desde: '0', hasta: '100', precio: p1, subsidiado: false, exentoDe: [] },
  { desde: '100', hasta: '300', precio: p2, subsidiado: false, exentoDe: [] },
  { desde: '300', hasta: null, precio: p3, subsidiado: false, exentoDe: [] },
];

/** Energía residencial: $ 1.000 fijos; 100 kWh a $ 10, 200 a $ 20 y el resto a $ 30. */
const CUADRO: CuadroTarifa = {
  servicio: 'energia',
  categoria: 'residencial',
  conSubsidio: false,
  vigenteDesde: '2026-01-01',
  vigenteHasta: null,
  cargoFijo: '1000.00',
  escalones: escalonesSimples('10', '20', '30'),
};
const SEPELIO: CuadroTarifa = {
  servicio: 'sepelio',
  categoria: null,
  conSubsidio: false,
  vigenteDesde: '2026-01-01',
  vigenteHasta: null,
  cargoFijo: '4800.00',
  escalones: [{ desde: '0', hasta: null, precio: '2400', subsidiado: false, exentoDe: [] }],
};

const concepto = (c: Partial<ConceptoTarifa> & Pick<ConceptoTarifa, 'codigo' | 'tipo' | 'valor'>): ConceptoTarifa => ({
  nombre: c.codigo,
  base: c.tipo === 'porcentaje' ? 'subtotal' : null,
  grupo: 'gravamen',
  servicio: null,
  categorias: null,
  condicionesIva: null,
  orden: 100,
  vigenteDesde: '2026-01-01',
  vigenteHasta: null,
  ...c,
});
const IVA = concepto({ codigo: 'IVA', tipo: 'porcentaje', valor: '21', orden: 50 });
const ALUMBRADO = concepto({ codigo: 'ALUMBRADO', tipo: 'fijo', valor: '500', orden: 10 });
const IVA_RECARGOS = concepto({ codigo: 'IVA_RECARGOS', tipo: 'porcentaje', valor: '21', base: 'recargos', grupo: 'adicional', orden: 90 });

/** Noviembre de 2026 completo, con medidor de 1.000 a 1.000 + `kwh`. */
function entrada(kwh: number | null, cambios: Partial<EntradaFactura> = {}): EntradaFactura {
  return {
    servicio: 'energia',
    periodo: { anio: 2026, mes: 11, desde: '2026-11-01', hasta: '2026-11-30' },
    condicionIva: 'consumidor_final',
    suministro: { categoria: 'residencial', tieneSubsidio: false, fechaAlta: '2020-01-01', fechaBaja: null },
    lecturas: kwh === null ? undefined : [{ anterior: '1000', actual: String(1000 + kwh) }],
    cuadros: [CUADRO, SEPELIO],
    conceptos: [],
    parametros: { moraTasaDiaria: '0.1' },
    ...cambios,
  };
}

const renglon = (f: FacturaCalculada, codigo: string) => f.renglones.find((r) => r.codigo === codigo);
const escalones = (f: FacturaCalculada) => f.renglones.filter((r) => r.codigo === 'ESCALON').map((r) => [r.descripcion, r.cantidad, r.importe]);
const avisos = (f: FacturaCalculada) => f.avisos.map((a) => a.codigo);
const sumaDeRenglones = (f: FacturaCalculada) => f.renglones.reduce((t, r) => t + Math.round(Number(r.importe) * 100), 0);
const centavos = (importe: string) => Math.round(Number(importe) * 100);

function errorDe(fn: () => unknown): ErrorDeCalculo {
  try {
    fn();
  } catch (e) {
    if (e instanceof ErrorDeCalculo) return e;
    throw e;
  }
  throw new Error('Se esperaba un ErrorDeCalculo y no falló');
}

/* ───────────────────────── Escalones ───────────────────────── */

describe('consumo por escalones', () => {
  it('reparte el consumo entre los escalones', () => {
    const f = calcularFactura(entrada(350));
    expect(escalones(f)).toEqual([
      ['Primeros 100 kWh', '100', '1000.00'],
      ['Siguientes 200 kWh', '200', '4000.00'],
      ['Excedente de 300 kWh', '50', '1500.00'],
    ]);
    expect(f.totales).toMatchObject({ basico: '7500.00', subtotal: '7500.00', total: '7500.00' });
  });

  it('justo en el límite de un escalón no abre el siguiente', () => {
    expect(escalones(calcularFactura(entrada(100)))).toEqual([['Primeros 100 kWh', '100', '1000.00']]);
    expect(escalones(calcularFactura(entrada(101)))).toEqual([
      ['Primeros 100 kWh', '100', '1000.00'],
      ['Siguientes 200 kWh', '1', '20.00'],
    ]);
  });

  it('consumo cero: solo la cuota fija y lo que no depende del consumo', () => {
    const f = calcularFactura(entrada(0, { conceptos: [IVA, ALUMBRADO, concepto({ codigo: 'POR_KWH', tipo: 'por_unidad', valor: '2' })] }));
    expect(f.renglones.map((r) => [r.codigo, r.importe])).toEqual([
      ['CARGO_FIJO', '1000.00'],
      ['ALUMBRADO', '500.00'],
      ['IVA', '210.00'],
    ]);
    expect(f.consumo?.facturado).toBe('0');
    expect(avisos(f)).toEqual(['consumo_cero']);
    expect(f.totales.total).toBe('1710.00');
  });

  it('un cuadro con un solo escalón sin tope cobra todo al mismo precio', () => {
    const plano: CuadroTarifa = { ...CUADRO, cargoFijo: '0', escalones: [{ desde: '0', hasta: null, precio: '25.5', subsidiado: true, exentoDe: [] }] };
    const f = calcularFactura(entrada(40, { cuadros: [plano] }));
    // Sin cuota fija no hay renglón de cuota fija.
    expect(f.renglones).toHaveLength(1);
    expect(f.renglones[0]).toMatchObject({ descripcion: 'Consumo', cantidad: '40', importe: '1020.00', subsidiado: true });
  });

  it('acepta lecturas con decimales', () => {
    const f = calcularFactura(entrada(null, { lecturas: [{ anterior: '10.5', actual: '22.75' }] }));
    expect(f.consumo?.facturado).toBe('12.25');
    expect(escalones(f)).toEqual([['Primeros 100 kWh', '12.25', '122.50']]);
  });
});

/* ───────────────────────── Lecturas ───────────────────────── */

describe('lecturas', () => {
  it('aplica el factor multiplicador del medidor', () => {
    const f = calcularFactura(entrada(null, { lecturas: [{ medidor: 'M-1', anterior: '10', actual: '15', factor: '40' }] }));
    expect(f.consumo).toMatchObject({ medido: '200', facturado: '200' });
    expect(f.consumo?.tramos).toEqual([{ medidor: 'M-1', anterior: '10', actual: '15', factor: '40', consumo: '200', estimada: false }]);
  });

  it('vuelta de contador: suma lo que faltaba para el tope más lo nuevo', () => {
    const f = calcularFactura(entrada(null, { lecturas: [{ anterior: '99950', actual: '30', vueltaDeContador: true, digitos: 5 }] }));
    expect(f.consumo?.facturado).toBe('80');
    expect(avisos(f)).toContain('vuelta_contador');
  });

  it('vuelta de contador sin saber las cifras del medidor, o con una lectura que no entra: no calcula', () => {
    expect(errorDe(() => calcularFactura(entrada(null, { lecturas: [{ anterior: '99950', actual: '30', vueltaDeContador: true }] }))).codigo).toBe('dato_invalido');
    expect(errorDe(() => calcularFactura(entrada(null, { lecturas: [{ anterior: '99950', actual: '30', vueltaDeContador: true, digitos: 4 }] }))).codigo).toBe('dato_invalido');
  });

  it('lectura menor que la anterior sin motivo: no calcula y pide el motivo', () => {
    const e = errorDe(() => calcularFactura(entrada(null, { lecturas: [{ anterior: '500', actual: '480' }] })));
    expect(e.codigo).toBe('lectura_menor');
    expect(e.message).toMatch(/cambio de medidor o vuelta de contador/);
  });

  it('cambio de medidor a mitad de período: suma lo que marcó cada uno, con su factor', () => {
    const f = calcularFactura(
      entrada(null, {
        lecturas: [
          { medidor: 'viejo', anterior: '5000', actual: '5120' },
          { medidor: 'nuevo', anterior: '0', actual: '30', factor: '2' },
        ],
      }),
    );
    expect(f.consumo?.facturado).toBe('180');
    expect(f.consumo?.tramos.map((t) => t.consumo)).toEqual(['120', '60']);
    expect(avisos(f)).toContain('cambio_medidor');
    expect(f.totales.basico).toBe('3600.00'); // 1000 + 100×10 + 80×20
  });

  it('sin lecturas no calcula', () => {
    expect(errorDe(() => calcularFactura(entrada(null))).codigo).toBe('sin_lecturas');
    expect(errorDe(() => calcularFactura(entrada(null, { lecturas: [] }))).codigo).toBe('sin_lecturas');
  });
});

/* ───────────────────────── Estimación y ajuste ───────────────────────── */

describe('lectura estimada y su ajuste posterior', () => {
  it('una lectura estimada marca la factura', () => {
    const f = calcularFactura(entrada(null, { lecturas: [{ anterior: '1000', actual: '1150', tipo: 'estimada' }] }));
    expect(f.estimada).toBe(true);
    expect(f.consumo?.tramos[0]?.estimada).toBe(true);
    expect(avisos(f)).toContain('estimada');
  });

  it('si después la lectura real es mayor, se cobra la diferencia', () => {
    const f = calcularFactura(entrada(null, { lecturas: [{ anterior: '1150', actual: '1400', anteriorEstimada: true }] }));
    expect(f.estimada).toBe(false);
    expect(f.consumo).toMatchObject({ facturado: '250', aFavorPendiente: '0' });
  });

  it('si se había estimado de más, lo cobrado en exceso queda a favor y se descuenta del período siguiente', () => {
    // Se estimó hasta 1.150 y el medidor en realidad marca 1.100: 50 kWh cobrados de más.
    const ajuste = calcularFactura(entrada(null, { lecturas: [{ anterior: '1150', actual: '1100', anteriorEstimada: true }] }));
    expect(ajuste.consumo).toMatchObject({ medido: '0', facturado: '0', aFavorPendiente: '50' });
    expect(avisos(ajuste)).toEqual(['ajuste_estimacion', 'consumo_cero']);

    const siguiente = calcularFactura(entrada(null, { lecturas: [{ anterior: '1100', actual: '1300' }], consumoAFavor: ajuste.consumo!.aFavorPendiente }));
    expect(siguiente.consumo).toMatchObject({ medido: '200', aFavorAplicado: '50', facturado: '150', aFavorPendiente: '0' });
    expect(avisos(siguiente)).toEqual(['consumo_a_favor']);
  });

  it('entre la estimación y los ajustes se cobra exactamente el consumo real', () => {
    // Real: de 1.000 a 1.300 en tres períodos = 300 kWh.
    const estimado = calcularFactura(entrada(null, { lecturas: [{ anterior: '1000', actual: '1150', tipo: 'estimada' }] }));
    const ajuste = calcularFactura(entrada(null, { lecturas: [{ anterior: '1150', actual: '1100', anteriorEstimada: true }] }));
    const siguiente = calcularFactura(entrada(null, { lecturas: [{ anterior: '1100', actual: '1300' }], consumoAFavor: ajuste.consumo!.aFavorPendiente }));
    const facturado = [estimado, ajuste, siguiente].reduce((t, f) => t + Number(f.consumo!.facturado), 0);
    expect(facturado).toBe(300);
  });

  it('un saldo a favor mayor que el consumo del mes sigue pasando al siguiente', () => {
    const f = calcularFactura(entrada(30, { consumoAFavor: '80' }));
    expect(f.consumo).toMatchObject({ medido: '30', aFavorAplicado: '30', facturado: '0', aFavorPendiente: '50' });
    expect(avisos(f)).toEqual(['consumo_a_favor', 'ajuste_estimacion', 'consumo_cero']);
  });
});

/* ───────────────────────── Cambio de tarifa ───────────────────────── */

describe('cambio de tarifa a mitad de período', () => {
  const viejo: CuadroTarifa = { ...CUADRO, vigenteHasta: '2026-07-31' };
  const nuevo: CuadroTarifa = { ...CUADRO, vigenteDesde: '2026-08-01', cargoFijo: '1240.00', escalones: escalonesSimples('12', '24', '36') };
  // Del 15/07 al 14/08: 17 días con el cuadro viejo y 14 con el nuevo.
  const periodo = { anio: 2026, mes: 8, desde: '2026-07-15', hasta: '2026-08-14' };
  const f = calcularFactura(entrada(310, { periodo, cuadros: [nuevo, viejo] }));

  it('reparte el consumo por días entre los dos cuadros', () => {
    expect(avisos(f)).toContain('cambio_tarifa');
    const cantidades = f.renglones.filter((r) => r.codigo === 'ESCALON').map((r) => Number(r.cantidad));
    // 310 kWh × 17/31 = 170 con la tarifa vieja; los otros 140 con la nueva.
    expect(cantidades.slice(0, 3).reduce((a, b) => a + b, 0)).toBeCloseTo(170, 3);
    expect(cantidades.slice(3).reduce((a, b) => a + b, 0)).toBeCloseTo(140, 3);
  });

  it('achica los escalones y la cuota fija en la misma proporción', () => {
    expect(f.renglones.filter((r) => r.grupo === 'basico').map((r) => [r.codigo, r.cantidad, r.unitario, r.importe])).toEqual([
      ['CARGO_FIJO', '0.5484', '1000', '548.39'], // 1.000 × 17/31
      ['ESCALON', '54.8387', '10', '548.39'], // 100 × 17/31 kWh
      ['ESCALON', '109.6774', '20', '2193.55'],
      ['ESCALON', '5.4839', '30', '164.52'],
      ['CARGO_FIJO', '0.4516', '1240', '560.00'], // 1.240 × 14/31
      ['ESCALON', '45.1613', '12', '541.94'],
      ['ESCALON', '90.3226', '24', '2167.74'],
      ['ESCALON', '4.5161', '36', '162.58'],
    ]);
    expect(f.renglones[0]?.nota).toBe('Tarifa del 15/07/2026 al 31/07/2026 (17 de 31 días)');
    expect(f.renglones[4]?.nota).toBe('Tarifa del 01/08/2026 al 14/08/2026 (14 de 31 días)');
  });

  it('guarda los dos cuadros en el snapshot y el total sigue siendo la suma de los renglones', () => {
    expect(f.snapshot.cuadros.map((c) => c.vigenteDesde)).toEqual(['2026-01-01', '2026-08-01']);
    expect(sumaDeRenglones(f)).toBe(centavos(f.totales.total));
  });

  it('si queda un día sin cuadro vigente, no calcula y dice cuál', () => {
    const conHueco: CuadroTarifa = { ...nuevo, vigenteDesde: '2026-08-03' };
    const e = errorDe(() => calcularFactura(entrada(310, { periodo, cuadros: [viejo, conHueco] })));
    expect(e.codigo).toBe('sin_cuadro');
    expect(e.message).toContain('01/08/2026');
  });

  it('si dos cuadros rigen el mismo día, no calcula', () => {
    const pisado: CuadroTarifa = { ...nuevo, vigenteDesde: '2026-07-20' };
    expect(errorDe(() => calcularFactura(entrada(310, { periodo, cuadros: [viejo, pisado] }))).codigo).toBe('cuadros_superpuestos');
  });

  it('un cuadro que ya no rige no participa', () => {
    const terminado: CuadroTarifa = { ...CUADRO, vigenteDesde: '2025-01-01', vigenteHasta: '2025-12-31', cargoFijo: '1.00' };
    const g = calcularFactura(entrada(50, { cuadros: [terminado, CUADRO] }));
    expect(renglon(g, 'CARGO_FIJO')?.importe).toBe('1000.00');
    expect(g.snapshot.cuadros).toHaveLength(1);
  });
});

/* ───────────────────────── Qué cuadro corresponde ───────────────────────── */

describe('elección del cuadro', () => {
  const subsidiado: CuadroTarifa = { ...CUADRO, conSubsidio: true, escalones: escalonesSimples('4', '20', '30').map((e, i) => ({ ...e, subsidiado: i === 0 })) };

  it('con subsidio usa el cuadro subsidiado y marca los renglones', () => {
    const f = calcularFactura(entrada(150, { suministro: { ...entrada(0).suministro, tieneSubsidio: true }, cuadros: [CUADRO, subsidiado] }));
    expect(f.renglones.filter((r) => r.codigo === 'ESCALON').map((r) => [r.importe, r.subsidiado ?? false])).toEqual([
      ['400.00', true],
      ['1000.00', false],
    ]);
  });

  it('sin subsidio no toca el cuadro subsidiado', () => {
    expect(calcularFactura(entrada(150, { cuadros: [CUADRO, subsidiado] })).totales.basico).toBe('3000.00');
  });

  it('si la categoría no tiene cuadro con subsidio, factura con el común', () => {
    const f = calcularFactura(entrada(150, { suministro: { ...entrada(0).suministro, tieneSubsidio: true } }));
    expect(f.totales.basico).toBe('3000.00');
  });

  it('sin cuadro para la categoría no calcula', () => {
    const e = errorDe(() => calcularFactura(entrada(150, { suministro: { ...entrada(0).suministro, categoria: 'industrial' } })));
    expect(e.codigo).toBe('sin_cuadro');
    expect(e.message).toContain('industrial');
  });

  it('un cuadro mal armado no se usa', () => {
    const roto: CuadroTarifa = { ...CUADRO, escalones: CUADRO.escalones.slice(0, 2) };
    expect(errorDe(() => calcularFactura(entrada(150, { cuadros: [roto] }))).codigo).toBe('cuadro_incompleto');
  });
});

/* ───────────────────────── Altas y bajas ───────────────────────── */

describe('alta y baja a mitad de mes', () => {
  const internet = (suministro: Partial<EntradaFactura['suministro']>) =>
    entrada(null, {
      servicio: 'internet',
      suministro: { categoria: null, tieneSubsidio: false, fechaAlta: '2020-01-01', fechaBaja: null, ...suministro },
      plan: { nombre: 'Internet 50 Mbps', precio: '26716.00' },
    });

  it('el mes completo paga el abono entero', () => {
    const f = calcularFactura(internet({}));
    expect(f.renglones).toEqual([
      expect.objectContaining({ codigo: 'ABONO', descripcion: 'Abono Internet 50 Mbps', cantidad: '1', unitario: '26716', importe: '26716.00' }),
    ]);
    expect(f.consumo).toBeNull();
    expect(f.avisos).toEqual([]);
  });

  it('alta el día 13: paga 18 de 30 días', () => {
    const f = calcularFactura(internet({ fechaAlta: '2026-11-13' }));
    expect(f.diasActivos).toBe(18);
    expect(renglon(f, 'ABONO')).toMatchObject({ cantidad: '0.6', importe: '16029.60', nota: 'Proporcional: 18 de 30 días' });
    expect(avisos(f)).toEqual(['prorrateo']);
  });

  it('baja el día 10 (último día con servicio): paga 10 de 30 días', () => {
    const f = calcularFactura(internet({ fechaBaja: '2026-11-10' }));
    expect(renglon(f, 'ABONO')?.importe).toBe('8905.33'); // 26.716 / 3
  });

  it('alta y baja el mismo día: paga un día', () => {
    expect(calcularFactura(internet({ fechaAlta: '2026-11-05', fechaBaja: '2026-11-05' })).diasActivos).toBe(1);
  });

  it('sin plan asignado no calcula', () => {
    expect(errorDe(() => calcularFactura({ ...internet({}), plan: undefined })).codigo).toBe('sin_plan');
  });

  it('con medidor: la cuota fija va en proporción y los escalones quedan enteros', () => {
    const f = calcularFactura(entrada(150, { suministro: { ...entrada(0).suministro, fechaAlta: '2026-11-13' } }));
    expect(renglon(f, 'CARGO_FIJO')).toMatchObject({ cantidad: '0.6', importe: '600.00', nota: 'Proporcional: 18 de 30 días' });
    expect(escalones(f)).toEqual([
      ['Primeros 100 kWh', '100', '1000.00'],
      ['Siguientes 200 kWh', '50', '1000.00'],
    ]);
  });

  it('si no tuvo el servicio ningún día del período, no hay factura', () => {
    expect(errorDe(() => calcularFactura(internet({ fechaAlta: '2026-12-01' }))).codigo).toBe('sin_servicio');
    expect(errorDe(() => calcularFactura(internet({ fechaBaja: '2026-10-31' }))).codigo).toBe('sin_servicio');
  });
});

/* ───────────────────────── Conceptos ───────────────────────── */

describe('conceptos configurables', () => {
  it('porcentaje sobre el básico o sobre el subtotal; un cargo entra en el subtotal', () => {
    const cargo = concepto({ codigo: 'FONDO', tipo: 'porcentaje', valor: '10', base: 'basico', grupo: 'cargo', orden: 99 });
    const tasa = concepto({ codigo: 'TASA', tipo: 'porcentaje', valor: '5', base: 'basico', orden: 1 });
    const f = calcularFactura(entrada(100, { conceptos: [IVA, tasa, cargo] }));
    // Básico 2.000 → cargo 200 → subtotal 2.200. El cargo se calcula primero aunque su orden sea el último.
    expect(renglon(f, 'FONDO')).toMatchObject({ grupo: 'cargo', base: '2000.00', importe: '200.00' });
    expect(renglon(f, 'TASA')).toMatchObject({ base: '2000.00', importe: '100.00' });
    expect(renglon(f, 'IVA')).toMatchObject({ base: '2200.00', importe: '462.00', porcentaje: '21' });
    expect(f.totales).toMatchObject({ basico: '2000.00', subtotal: '2200.00', gravamenes: '562.00', servicio: '2762.00', total: '2762.00' });
    expect(f.renglones.map((r) => r.codigo)).toEqual(['CARGO_FIJO', 'ESCALON', 'FONDO', 'TASA', 'IVA']);
  });

  it('monto fijo y monto por unidad consumida', () => {
    const f = calcularFactura(entrada(100, { conceptos: [ALUMBRADO, concepto({ codigo: 'POR_KWH', tipo: 'por_unidad', valor: '2.276962' })] }));
    expect(renglon(f, 'ALUMBRADO')).toMatchObject({ cantidad: '1', unitario: '500', importe: '500.00' });
    expect(renglon(f, 'POR_KWH')).toMatchObject({ cantidad: '100', unitario: '2.276962', importe: '227.70' });
  });

  it('un escalón puede quedar exento de un concepto', () => {
    const cuadro: CuadroTarifa = { ...CUADRO, escalones: CUADRO.escalones.map((e, i) => (i === 1 ? { ...e, exentoDe: ['TASA'] } : e)) };
    const tasa = concepto({ codigo: 'TASA', tipo: 'porcentaje', valor: '10', base: 'basico' });
    const f = calcularFactura(entrada(350, { cuadros: [cuadro], conceptos: [tasa, IVA] }));
    expect(renglon(f, 'TASA')).toMatchObject({ base: '3500.00', importe: '350.00' }); // 7.500 − 4.000 del escalón exento
    expect(renglon(f, 'IVA')?.base).toBe('7500.00');
  });

  it('según la condición frente al IVA', () => {
    const iva21 = { ...IVA, condicionesIva: ['consumidor_final', 'exento'] as ConceptoTarifa['condicionesIva'] };
    const iva27 = concepto({ codigo: 'IVA_27', tipo: 'porcentaje', valor: '27', condicionesIva: ['responsable_inscripto', 'monotributo'] });
    const final = calcularFactura(entrada(100, { conceptos: [iva21, iva27] }));
    const inscripto = calcularFactura(entrada(100, { conceptos: [iva21, iva27], condicionIva: 'responsable_inscripto' }));
    expect(final.renglones.map((r) => r.codigo)).toContain('IVA');
    expect(final.renglones.map((r) => r.codigo)).not.toContain('IVA_27');
    expect(renglon(inscripto, 'IVA_27')?.importe).toBe('540.00');
    expect(renglon(inscripto, 'IVA')).toBeUndefined();
  });

  it('según el servicio y la categoría', () => {
    const soloAgua = concepto({ codigo: 'SOLO_AGUA', tipo: 'fijo', valor: '10', servicio: 'agua' });
    const soloComercial = concepto({ codigo: 'SOLO_COMERCIAL', tipo: 'fijo', valor: '10', categorias: ['comercial'] });
    const residencial = concepto({ codigo: 'RESIDENCIAL', tipo: 'fijo', valor: '10', categorias: ['residencial'], servicio: 'energia' });
    const f = calcularFactura(entrada(100, { conceptos: [soloAgua, soloComercial, residencial] }));
    expect(f.renglones.filter((r) => r.grupo === 'gravamen').map((r) => r.codigo)).toEqual(['RESIDENCIAL']);
    // Un servicio sin categoría (internet) no recibe conceptos atados a una categoría.
    const internet = calcularFactura(
      entrada(null, { servicio: 'internet', suministro: { ...entrada(0).suministro, categoria: null }, plan: { nombre: 'X', precio: '100' }, conceptos: [soloComercial] }),
    );
    expect(internet.renglones).toHaveLength(1);
  });

  it('usa el valor vigente al cierre del período', () => {
    const viejo = { ...ALUMBRADO, valor: '300', vigenteHasta: '2026-11-15' };
    const nuevo = { ...ALUMBRADO, valor: '700', vigenteDesde: '2026-11-16' };
    const futuro = concepto({ codigo: 'FUTURO', tipo: 'fijo', valor: '1', vigenteDesde: '2026-12-01' });
    const f = calcularFactura(entrada(100, { conceptos: [viejo, nuevo, futuro] }));
    expect(renglon(f, 'ALUMBRADO')?.importe).toBe('700.00');
    expect(renglon(f, 'FUTURO')).toBeUndefined();
    expect(f.snapshot.conceptos.map((c) => c.valor)).toEqual(['700']);
  });

  it('dos valores vigentes para el mismo concepto: no calcula', () => {
    expect(errorDe(() => calcularFactura(entrada(100, { conceptos: [ALUMBRADO, { ...ALUMBRADO, valor: '700' }] }))).codigo).toBe('concepto_duplicado');
  });

  it('respeta el orden y, a igual orden, el código', () => {
    const b = concepto({ codigo: 'B', tipo: 'fijo', valor: '1', orden: 5 });
    const a = concepto({ codigo: 'A', tipo: 'fijo', valor: '1', orden: 5 });
    const z = concepto({ codigo: 'Z', tipo: 'fijo', valor: '1', orden: 1 });
    expect(calcularFactura(entrada(0, { conceptos: [b, a, z] })).renglones.slice(1).map((r) => r.codigo)).toEqual(['Z', 'A', 'B']);
  });

  it('un concepto que da cero no genera renglón', () => {
    const f = calcularFactura(entrada(100, { conceptos: [concepto({ codigo: 'CERO', tipo: 'fijo', valor: '0' }), concepto({ codigo: 'NADA', tipo: 'porcentaje', valor: '0' }), IVA_RECARGOS] }));
    expect(f.renglones.map((r) => r.codigo)).toEqual(['CARGO_FIJO', 'ESCALON']);
  });
});

/* ───────────────────────── Cargos particulares ───────────────────────── */

describe('cargos propios de una conexión', () => {
  it('van al grupo indicado; un descuento resta', () => {
    const f = calcularFactura(
      entrada(100, {
        conceptos: [IVA],
        cargosParticulares: [
          { codigo: 'PROGRAMA', descripcion: 'Programa transitorio', importe: '500', grupo: 'cargo' },
          { descripcion: 'Bonificación', importe: '-200.005', grupo: 'adicional' },
          { descripcion: 'Nada', importe: '0', grupo: 'adicional' },
        ],
      }),
    );
    expect(renglon(f, 'PROGRAMA')).toMatchObject({ grupo: 'cargo', importe: '500.00' });
    expect(renglon(f, 'PARTICULAR')).toMatchObject({ grupo: 'adicional', importe: '-200.01' });
    expect(renglon(f, 'IVA')?.base).toBe('2500.00');
    expect(f.totales).toMatchObject({ subtotal: '2500.00', adicionales: '-200.01', total: '2824.99' });
    expect(f.renglones.some((r) => r.descripcion === 'Nada')).toBe(false);
  });
});

/* ───────────────────────── Mora ───────────────────────── */

describe('intereses por mora', () => {
  const deuda = { referencia: 'B 0001-00000042', saldo: '100000.00', venceEl: '2026-10-10' };

  it('interés simple por día de atraso, con su IVA', () => {
    // Del 10/10 al 20/11 hay 41 días: 100.000 × 0,1 % × 41 = 4.100.
    const f = calcularFactura(entrada(100, { conceptos: [IVA, IVA_RECARGOS], deudaVencida: [deuda], fechaEmision: '2026-11-20' }));
    expect(renglon(f, 'MORA')).toMatchObject({
      grupo: 'recargo',
      descripcion: 'Interés por mora B 0001-00000042 (venció el 10/10/2026)',
      cantidad: '41',
      porcentaje: '0.1',
      base: '100000.00',
      importe: '4100.00',
    });
    // El IVA de recargos sale en el grupo de recargos y no toca el IVA del servicio.
    expect(renglon(f, 'IVA_RECARGOS')).toMatchObject({ grupo: 'recargo', base: '4100.00', importe: '861.00' });
    expect(renglon(f, 'IVA')?.base).toBe('2000.00');
    expect(f.totales).toMatchObject({ servicio: '2420.00', recargos: '4961.00', total: '7381.00' });
  });

  it('una factura que todavía no venció no genera interés', () => {
    const f = calcularFactura(entrada(100, { deudaVencida: [{ ...deuda, venceEl: '2026-11-20' }, { ...deuda, venceEl: '2026-11-25' }], fechaEmision: '2026-11-20' }));
    expect(renglon(f, 'MORA')).toBeUndefined();
    expect(f.totales.recargos).toBe('0.00');
  });

  it('varias facturas vencidas: un renglón por cada una', () => {
    const f = calcularFactura(entrada(100, { deudaVencida: [deuda, { ...deuda, referencia: 'B 0001-00000043', saldo: '50000', venceEl: '2026-11-10' }], fechaEmision: '2026-11-20' }));
    expect(f.renglones.filter((r) => r.codigo === 'MORA').map((r) => r.importe)).toEqual(['4100.00', '500.00']);
  });

  it('si una factura anterior ya cobró intereses, cuenta solo los días desde esa factura', () => {
    // Venció el 10/10 y la factura del 18/10 ya cobró esos 8 días: ahora van del 18/10 al 20/11 = 33 días.
    const f = calcularFactura(entrada(100, { deudaVencida: [{ ...deuda, interesDesde: '2026-10-18' }], fechaEmision: '2026-11-20' }));
    expect(renglon(f, 'MORA')).toMatchObject({
      descripcion: 'Interés por mora B 0001-00000042 (venció el 10/10/2026)',
      cantidad: '33',
      importe: '3300.00',
      nota: '0,1 % por día × 33 días (desde el 18/10/2026)',
    });
    // Una fecha anterior al vencimiento no adelanta los intereses.
    const g = calcularFactura(entrada(100, { deudaVencida: [{ ...deuda, interesDesde: '2026-09-18' }], fechaEmision: '2026-11-20' }));
    expect(renglon(g, 'MORA')).toMatchObject({ cantidad: '41', nota: '0,1 % por día × 41 días de atraso' });
  });

  it('lo que se pagó fuera de término suma interés solo hasta el día del pago', () => {
    // Venció el 10/10 y se pagó el 25/10: 15 días, aunque la factura nueva salga el 20/11.
    const f = calcularFactura(entrada(100, { deudaVencida: [{ ...deuda, interesHasta: '2026-10-25' }], fechaEmision: '2026-11-20' }));
    expect(renglon(f, 'MORA')).toMatchObject({
      descripcion: 'Recargo por pago fuera de término B 0001-00000042 (venció el 10/10/2026)',
      cantidad: '15',
      importe: '1500.00',
      nota: '0,1 % por día × 15 días de atraso · se pagó el 25/10/2026',
    });
    // Si la factura anterior ya cobró hasta el 18/10, quedan 7 días.
    const g = calcularFactura(entrada(100, { deudaVencida: [{ ...deuda, interesDesde: '2026-10-18', interesHasta: '2026-10-25' }], fechaEmision: '2026-11-20' }));
    expect(renglon(g, 'MORA')).toMatchObject({ cantidad: '7', importe: '700.00', nota: '0,1 % por día × 7 días (desde el 18/10/2026) · se pagó el 25/10/2026' });
    // Pagada en término (o antes de lo ya cobrado): nada.
    const h = calcularFactura(entrada(100, { deudaVencida: [{ ...deuda, interesHasta: '2026-10-10' }], fechaEmision: '2026-11-20' }));
    expect(renglon(h, 'MORA')).toBeUndefined();
    // Una fecha de pago posterior a la emisión no cuenta: sigue siendo deuda al emitir.
    const i = calcularFactura(entrada(100, { deudaVencida: [{ ...deuda, interesHasta: '2026-11-25' }], fechaEmision: '2026-11-20' }));
    expect(renglon(i, 'MORA')).toMatchObject({ descripcion: 'Interés por mora B 0001-00000042 (venció el 10/10/2026)', cantidad: '41' });
  });

  it('sin fecha de emisión no puede calcular intereses', () => {
    expect(errorDe(() => calcularFactura(entrada(100, { deudaVencida: [deuda] }))).codigo).toBe('sin_fecha_emision');
  });

  it('calcularInteresMora da lo mismo que la factura', () => {
    expect(calcularInteresMora('100000.00', '2026-10-10', '2026-11-20', '0.1')).toBe('4100.00');
    expect(calcularInteresMora('100000.00', '2026-11-25', '2026-11-20', '0.1')).toBe('0.00');
    expect(calcularInteresMora('33333.33', '2026-11-19', '2026-11-20', '0.15')).toBe('50.00'); // 49,999995
  });
});

/* ───────────────────────── Sepelio ───────────────────────── */

describe('sepelio', () => {
  it('dentro de la factura de energía: titular + adherentes, como adicionales', () => {
    const f = calcularFactura(entrada(100, { conceptos: [IVA], sepelio: { adherentes: 3 } }));
    expect(f.renglones.filter((r) => r.servicio === 'sepelio').map((r) => [r.grupo, r.descripcion, r.cantidad, r.importe])).toEqual([
      ['adicional', 'Sepelio · cuota del titular', '1', '4800.00'],
      ['adicional', 'Sepelio · 3 adherentes', '3', '7200.00'],
    ]);
    // No entra en la base del IVA de la energía.
    expect(renglon(f, 'IVA')?.base).toBe('2000.00');
    expect(f.totales).toMatchObject({ adicionales: '12000.00', total: '14420.00' });
    expect(f.snapshot.cuadros.map((c) => c.servicio)).toEqual(['energia', 'sepelio']);
  });

  it('sin adherentes cobra solo al titular; con uno, en singular', () => {
    expect(calcularFactura(entrada(0, { sepelio: { adherentes: 0 } })).renglones.map((r) => r.codigo)).toEqual(['CARGO_FIJO', 'SEPELIO_TITULAR']);
    expect(renglon(calcularFactura(entrada(0, { sepelio: { adherentes: 1 } })), 'SEPELIO_ADHERENTES')?.descripcion).toBe('Sepelio · 1 adherente');
  });

  it('con alta de sepelio a mitad de mes va en proporción, aunque la energía sea de todo el mes', () => {
    const f = calcularFactura(entrada(0, { sepelio: { adherentes: 2, fechaAlta: '2026-11-16' } }));
    expect(renglon(f, 'SEPELIO_TITULAR')).toMatchObject({ importe: '2400.00', nota: 'Proporcional: 15 de 30 días' });
    expect(renglon(f, 'SEPELIO_ADHERENTES')?.importe).toBe('2400.00');
    expect(renglon(f, 'CARGO_FIJO')?.importe).toBe('1000.00');
  });

  it('si el sepelio ya estaba dado de baja antes del período, no se cobra', () => {
    const f = calcularFactura(entrada(0, { sepelio: { adherentes: 2, fechaAlta: '2020-01-01', fechaBaja: '2026-10-31' } }));
    expect(f.renglones.map((r) => r.codigo)).toEqual(['CARGO_FIJO']);
  });

  it('como factura propia', () => {
    const f = calcularFactura(entrada(null, { servicio: 'sepelio', suministro: { ...entrada(0).suministro, categoria: null }, sepelio: { adherentes: 2 }, conceptos: [IVA] }));
    expect(f.renglones.map((r) => [r.grupo, r.codigo, r.importe])).toEqual([
      ['basico', 'SEPELIO_TITULAR', '4800.00'],
      ['basico', 'SEPELIO_ADHERENTES', '4800.00'],
      ['gravamen', 'IVA', '2016.00'],
    ]);
    expect(f.consumo).toBeNull();
  });

  it('datos que faltan o no sirven', () => {
    const base = { servicio: 'sepelio' as const, suministro: { ...entrada(0).suministro, categoria: null } };
    expect(errorDe(() => calcularFactura(entrada(null, base))).codigo).toBe('dato_invalido');
    expect(errorDe(() => calcularFactura(entrada(null, { ...base, sepelio: { adherentes: -1 } }))).codigo).toBe('dato_invalido');
    expect(errorDe(() => calcularFactura(entrada(null, { ...base, sepelio: { adherentes: 1.5 } }))).codigo).toBe('dato_invalido');
    expect(errorDe(() => calcularFactura(entrada(0, { cuadros: [CUADRO], sepelio: { adherentes: 1 } }))).codigo).toBe('sin_cuadro');
  });
});

/* ───────────────────────── Redondeo e invariantes ───────────────────────── */

describe('redondeo', () => {
  it('2 decimales, medio hacia arriba, sin los errores del punto flotante', () => {
    expect(redondear('1.005').toFixed(2)).toBe('1.01'); // en float, 1.005 es 1.00499999...
    expect(redondear('2.675').toFixed(2)).toBe('2.68');
    expect(redondear('0.125').toFixed(2)).toBe('0.13');
    expect(redondear('0.124').toFixed(2)).toBe('0.12');
    expect(redondear('-1.005').toFixed(2)).toBe('-1.01');
  });

  it('cada renglón se redondea por separado', () => {
    // 3 kWh a $ 0,335 = 1,005 → 1,01.
    const cuadro: CuadroTarifa = { ...CUADRO, cargoFijo: '0', escalones: [{ desde: '0', hasta: null, precio: '0.335', subsidiado: false, exentoDe: [] }] };
    expect(calcularFactura(entrada(3, { cuadros: [cuadro] })).totales.total).toBe('1.01');
  });
});

describe('invariantes', () => {
  const { cuadros, conceptos, parametros } = TARIFAS_DOS_DE_MAYO;
  const casos: [EntradaFactura['servicio'], string, boolean, EntradaFactura['condicionIva']][] = [
    ['energia', 'residencial', true, 'consumidor_final'],
    ['energia', 'residencial', false, 'monotributo'],
    ['energia', 'comercial', false, 'responsable_inscripto'],
    ['energia', 'industrial', false, 'responsable_inscripto'],
    ['energia', 'rural', false, 'consumidor_final'],
    ['agua', 'residencial', false, 'consumidor_final'],
    ['agua', 'comercial', false, 'exento'],
  ];

  it('la suma de los renglones siempre es igual al total, con las tarifas reales y cualquier consumo', () => {
    for (const [servicio, categoria, tieneSubsidio, condicionIva] of casos) {
      for (const consumo of [0, 1, 4.5, 5, 29.99, 66, 119, 120, 121, 333.33, 700, 1176, 2500.75, 98765]) {
        const f = calcularFactura({
          servicio,
          // Con alta a mitad de período, sepelio y deuda vencida: todos los grupos de renglones a la vez.
          periodo: { anio: 2026, mes: 11, desde: '2026-10-18', hasta: '2026-11-17' },
          condicionIva,
          suministro: { categoria: categoria as never, tieneSubsidio, fechaAlta: '2026-10-25', fechaBaja: null },
          lecturas: [{ anterior: '0', actual: String(consumo) }],
          cuadros,
          conceptos,
          sepelio: servicio === 'energia' ? { adherentes: 2 } : undefined,
          deudaVencida: [{ referencia: 'B 0006-00000001', saldo: '12345.67', venceEl: '2026-09-30' }],
          fechaEmision: '2026-11-20',
          parametros,
        });
        const t = f.totales;
        expect(sumaDeRenglones(f), `${servicio} ${categoria} ${consumo}`).toBe(centavos(t.total));
        expect(centavos(t.subtotal) + centavos(t.gravamenes)).toBe(centavos(t.servicio));
        expect(centavos(t.servicio) + centavos(t.adicionales) + centavos(t.recargos)).toBe(centavos(t.total));
        // Lo cobrado por escalones corresponde exactamente al consumo facturado.
        const cobrado = f.renglones.filter((r) => r.codigo === 'ESCALON').reduce((s, r) => s + Number(r.cantidad), 0);
        expect(cobrado).toBeCloseTo(consumo, 6);
        for (const r of f.renglones) expect(r.importe).toMatch(/^-?\d+\.\d{2}$/);
      }
    }
  });

  it('más consumo nunca da una factura más barata', () => {
    let anterior = 0;
    for (let kwh = 0; kwh <= 1500; kwh += 37) {
      const total = centavos(calcularFactura(entrada(kwh, { cuadros, conceptos, suministro: { ...entrada(0).suministro, tieneSubsidio: true } })).totales.total);
      expect(total).toBeGreaterThanOrEqual(anterior);
      anterior = total;
    }
  });

  it('es una función pura: no cambia lo que recibe y repite el resultado', () => {
    const congelar = <T>(o: T): T => {
      if (o && typeof o === 'object') {
        Object.values(o).forEach(congelar);
        Object.freeze(o);
      }
      return o;
    };
    const e = congelar(entrada(350, { conceptos: [IVA, ALUMBRADO], sepelio: { adherentes: 1 } }));
    expect(calcularFactura(e)).toEqual(calcularFactura(e));
  });
});

/* ───────────────────────── Datos inválidos y fechas ───────────────────────── */

describe('datos inválidos', () => {
  it('período al revés', () => {
    expect(errorDe(() => calcularFactura(entrada(10, { periodo: { anio: 2026, mes: 11, desde: '2026-11-30', hasta: '2026-11-01' } }))).codigo).toBe('periodo_invalido');
  });

  it('números que no son números, negativos o un factor en cero', () => {
    const con = (lectura: Partial<NonNullable<EntradaFactura['lecturas']>[number]>) => () =>
      calcularFactura(entrada(null, { lecturas: [{ anterior: '10', actual: '20', ...lectura }] }));
    expect(errorDe(con({ actual: 'veinte' })).codigo).toBe('dato_invalido');
    expect(errorDe(con({ actual: 'Infinity' })).codigo).toBe('dato_invalido');
    expect(errorDe(con({ anterior: '-5' })).codigo).toBe('dato_invalido');
    expect(errorDe(con({ factor: '0' })).codigo).toBe('dato_invalido');
    expect(errorDe(() => calcularFactura(entrada(10, { consumoAFavor: '-1' }))).codigo).toBe('dato_invalido');
    expect(errorDe(() => calcularFactura(entrada(10, { cargosParticulares: [{ descripcion: 'X', importe: undefined as never, grupo: 'cargo' }] }))).codigo).toBe('dato_invalido');
  });

  it('fechas que no existen', () => {
    expect(errorDe(() => calcularFactura(entrada(10, { periodo: { anio: 2026, mes: 2, desde: '2026-02-01', hasta: '2026-02-30' } }))).codigo).toBe('dato_invalido');
    expect(errorDe(() => numeroDeDia('20/11/2026')).codigo).toBe('dato_invalido');
  });
});

describe('fechas', () => {
  it('cuenta días con las dos puntas incluidas', () => {
    expect(diasEntre('2026-11-01', '2026-11-30')).toBe(30);
    expect(diasEntre('2026-07-15', '2026-08-14')).toBe(31);
    expect(diasEntre('2026-11-05', '2026-11-05')).toBe(1);
    expect(diasEntre('2026-12-31', '2027-01-01')).toBe(2);
  });

  it('suma días cruzando meses y años', () => {
    expect(sumarDias('2026-12-31', 1)).toBe('2027-01-01');
    expect(sumarDias('2026-03-01', -1)).toBe('2026-02-28');
    expect(sumarDias('2028-03-01', -1)).toBe('2028-02-29');
  });

  it('primer y último día del mes', () => {
    expect(mesCompleto(2026, 11)).toEqual({ desde: '2026-11-01', hasta: '2026-11-30' });
    expect(mesCompleto(2026, 2)).toEqual({ desde: '2026-02-01', hasta: '2026-02-28' });
    expect(mesCompleto(2028, 2).hasta).toBe('2028-02-29');
    expect(mesCompleto(2026, 12).hasta).toBe('2026-12-31');
  });

  it('intersección de rangos', () => {
    expect(interseccion({ desde: '2026-11-01', hasta: '2026-11-30' }, { desde: '2026-11-13', hasta: null })).toEqual({ desde: '2026-11-13', hasta: '2026-11-30' });
    expect(interseccion({ desde: '2026-11-01', hasta: null }, { desde: '2026-10-01', hasta: '2026-11-10' })).toEqual({ desde: '2026-11-01', hasta: '2026-11-10' });
    expect(interseccion({ desde: '2026-11-01', hasta: '2026-11-30' }, { desde: '2026-12-01', hasta: null })).toBeNull();
    expect(errorDe(() => interseccion({ desde: '2026-11-01', hasta: null }, { desde: '2026-11-01', hasta: null })).codigo).toBe('dato_invalido');
  });
});
