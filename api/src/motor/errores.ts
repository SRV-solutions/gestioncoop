export type CodigoErrorDeCalculo =
  | 'dato_invalido'
  | 'periodo_invalido'
  | 'sin_servicio'
  | 'sin_lecturas'
  | 'lectura_menor'
  | 'sin_cuadro'
  | 'cuadros_superpuestos'
  | 'cuadro_incompleto'
  | 'sin_plan'
  | 'sin_fecha_emision'
  | 'concepto_duplicado';

/**
 * La factura no se puede calcular con los datos recibidos. El mensaje está escrito para la
 * persona de facturación: dice qué falta o qué hay que revisar.
 */
export class ErrorDeCalculo extends Error {
  constructor(
    public codigo: CodigoErrorDeCalculo,
    message: string,
  ) {
    super(message);
    this.name = 'ErrorDeCalculo';
  }
}
