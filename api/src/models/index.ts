import { scopeByCooperativa } from '../lib/tenant';
import { Caja, Pago, PagoAplicacion, PagoItem, Producto } from './caja';
import { Auditoria, ComisionSrv, CooperativaImagen, Usuario } from './core';
import { BeneficiarioSepelio, Conexion, Medidor, Plan, Ruta, ServicioConexionModel, Socio, Zona } from './padron';
import { Comprobante, ComprobanteRenglon, Notificacion, Numerador, ProcesoFacturacionModel } from './facturacion';
import { Lectura, LecturaFoto, Periodo } from './lecturas';
import { CorteProgramadoModel, IntentoPago, PasarelaSimulada, Reclamo, ReclamoEvento, ReclamoFoto } from './portal';
import { Alerta, ConfigFiscal, IntentoAccesoSocio, VerificacionIntegridad } from './seguridad';
import { BalanceEnergia } from './tablero';
import { Concepto, CuadroTarifario, Escalon } from './tarifas';

export * from './core';
export * from './padron';
export * from './tarifas';
export * from './lecturas';
export * from './facturacion';
export * from './caja';
export * from './portal';
export * from './tablero';
export * from './seguridad';

/* ───────────────────────── Aislamiento por cooperativa ─────────────────────────
 * Todo modelo de negocio nuevo (con cooperativa_id) se agrega a esta lista.
 * tests/isolation.test.ts falla si alguno queda afuera. */
export const SCOPED_MODELS = [
  Usuario,
  Auditoria,
  Socio,
  Zona,
  Ruta,
  Conexion,
  Plan,
  ServicioConexionModel,
  Medidor,
  BeneficiarioSepelio,
  CuadroTarifario,
  Escalon,
  Concepto,
  Periodo,
  Lectura,
  LecturaFoto,
  Comprobante,
  ComprobanteRenglon,
  Numerador,
  ProcesoFacturacionModel,
  Notificacion,
  Caja,
  Producto,
  Pago,
  PagoAplicacion,
  PagoItem,
  IntentoPago,
  PasarelaSimulada,
  Reclamo,
  ReclamoFoto,
  ReclamoEvento,
  CorteProgramadoModel,
  BalanceEnergia,
  CooperativaImagen,
  ComisionSrv,
  ConfigFiscal,
  VerificacionIntegridad,
  Alerta,
  IntentoAccesoSocio,
] as const;
for (const model of SCOPED_MODELS) scopeByCooperativa(model);
