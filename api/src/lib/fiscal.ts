// Factura electrónica con ARCA, por cooperativa: qué proveedor usa cada una, el permiso de acceso
// (guardado y reutilizado mientras dure), la autorización de cada lote con recuperación si algo se
// cortó, la prueba de conexión y la alineación de la numeración.
import type { Transaction } from 'sequelize';
import { QueryTypes } from 'sequelize';
import {
  type AmbienteFiscal,
  type CertificadoFiscalInput,
  type ConceptoFiscal,
  type ConfigFiscalDatos,
  type ConfigFiscalVista,
  type CondicionIva,
  type GrupoRenglon,
  type NumeracionArca,
  type PruebaArca,
  type TipoComprobante,
  type TratamientoConcepto,
} from '../shared';
import { sequelize } from '../db';
import { mesCompleto } from '../motor';
import { ConfigFiscal, Cooperativa } from '../models';
import { fiscalSimulado, type Autorizacion, type ComprobanteAAutorizar, type ProveedorFiscal, type ResultadoAutorizacion } from '../proveedores/fiscal';
import { CONCEPTO_SERVICIOS, CONDICION_IVA_RECEPTOR, cbteTipo, docTipo, fechaArca, type AmbienteArca } from './arca/codigos';
import { importesArca, ImportesNoCierran, tratamientoSugerido, type RenglonFiscal } from './arca/importes';
import { ErrorArca, transporteHttps, type Transporte } from './arca/transporte';
import { leerCertificado, pedirAcceso } from './arca/wsaa';
import { consultarComprobante, estadoServicio, solicitarCae, ultimoAutorizado, type ClienteWsfe, type Credenciales, type DetalleCae } from './arca/wsfe';
import { writeAudit } from './audit';
import { cifrar, descifrar } from './cifrado';
import { clearCooperativaCache } from './cooperativas';
import { badRequest, conflict } from './errors';
import { requireCooperativaId } from './tenant';

let transporte: Transporte = transporteHttps;
/** Los tests reemplazan a ARCA por uno de mentira. `null` vuelve al real. */
export function usarTransporteArca(t: Transporte | null): void {
  transporte = t ?? transporteHttps;
}

const esArca = (a: AmbienteFiscal): a is AmbienteArca => a === 'homologacion' || a === 'produccion';

/* ───────────────────────── Permiso de acceso (TA) ───────────────────────── */

const pidiendo = new Map<number, Promise<Credenciales>>();

/** Las credenciales de la cooperativa: las guardadas si les queda tiempo, o unas nuevas. */
async function credenciales(cfg: ConfigFiscal, cuit: string, ambiente: AmbienteArca, renovar = false): Promise<Credenciales> {
  const quedan = cfg.taVence ? cfg.taVence.getTime() - Date.now() : 0;
  const guardadas = cfg.taCifrado && cfg.taAmbiente === ambiente && quedan > 0 ? { ...(JSON.parse(descifrar(cfg.taCifrado)) as { token: string; sign: string }), cuit } : null;
  // Se usan hasta el final: si vencen en medio de una emisión, ARCA contesta 600 y ahí se renuevan.
  if (!renovar && guardadas && quedan > 60_000) return guardadas;
  // Dos pedidos a la vez piden un solo permiso: ARCA no entrega otro mientras el primero siga vigente.
  const enCurso = pidiendo.get(cfg.cooperativaId);
  if (enCurso) return enCurso;
  const pedido = (async () => {
    let ticket;
    try {
      ticket = await pedirAcceso({ transporte, ambiente, certificado: cfg.certificado!, clave: descifrar(cfg.claveCifrada!) });
    } catch (err) {
      // En el último minuto, ARCA todavía no entrega otro: se sigue con el guardado.
      if (!renovar && guardadas && err instanceof ErrorArca && /alreadyauthenticated/i.test(err.codigo ?? '')) return guardadas;
      throw err;
    }
    const datos = { taCifrado: cifrar(JSON.stringify({ token: ticket.token, sign: ticket.sign })), taVence: ticket.vence, taAmbiente: ambiente };
    await ConfigFiscal.update(datos, { where: { cooperativaId: cfg.cooperativaId } });
    Object.assign(cfg, datos);
    return { token: ticket.token, sign: ticket.sign, cuit };
  })();
  pidiendo.set(cfg.cooperativaId, pedido);
  try {
    return await pedido;
  } finally {
    pidiendo.delete(cfg.cooperativaId);
  }
}

/** Corre `fn` con credenciales; si ARCA dice que el permiso ya no vale (600), lo renueva y reintenta una vez. */
async function conCredenciales<T>(cfg: ConfigFiscal, cuit: string, ambiente: AmbienteArca, fn: (c: Credenciales) => Promise<T>): Promise<T> {
  try {
    return await fn(await credenciales(cfg, cuit, ambiente));
  } catch (err) {
    if (err instanceof ErrorArca && err.codigo === '600') return fn(await credenciales(cfg, cuit, ambiente, true));
    throw err;
  }
}

/* ───────────────────────── El proveedor de ARCA ───────────────────────── */

interface FilaFiscal {
  id: number;
  tipo: TipoComprobante;
  letra: string;
  punto_venta: number;
  anio: number;
  mes: number;
  tipo_doc: string | null;
  nro_doc: string | null;
  condicion_iva: CondicionIva | null;
  origen_tipo: TipoComprobante | null;
  origen_letra: string | null;
  origen_pv: number | null;
  origen_numero: number | null;
  origen_fecha: string | null;
  renglones: RenglonFiscal[] | null;
}

/** Lo que ARCA necesita de cada comprobante y no viaja en el lote: receptor, detalle y comprobante asociado. */
async function datosFiscales(ids: number[], transaction?: Transaction): Promise<Map<number, FilaFiscal>> {
  const filas = await sequelize.query<FilaFiscal>(
    `SELECT c.id, c.tipo, c.letra, c.punto_venta, c.anio, c.mes,
            c.snapshot_json->'titular'->>'tipoDoc' AS tipo_doc, c.snapshot_json->'titular'->>'nroDoc' AS nro_doc,
            c.snapshot_json->'titular'->>'condicionIva' AS condicion_iva,
            o.tipo AS origen_tipo, o.letra AS origen_letra, o.punto_venta AS origen_pv, o.numero AS origen_numero,
            to_char(o.emitido_el, 'YYYY-MM-DD') AS origen_fecha,
            (SELECT json_agg(json_build_object('grupo', r.grupo, 'codigo', r.codigo, 'descripcion', r.descripcion, 'porcentaje', r.porcentaje::text,
                      'base', r.base::text, 'importe', r.importe::text) ORDER BY r.orden, r.id)
             FROM comprobante_renglones r WHERE r.comprobante_id = c.id) AS renglones
     FROM comprobantes c LEFT JOIN comprobantes o ON o.id = c.origen_id
     WHERE c.cooperativa_id = $cooperativaId AND c.id = ANY($ids)`,
    { bind: { cooperativaId: requireCooperativaId(), ids }, type: QueryTypes.SELECT, transaction },
  );
  return new Map(filas.map((f) => [f.id, f]));
}

/** El pedido de CAE de un comprobante. Falla con ImportesNoCierran si el detalle no se puede informar. */
function detalleCae(c: ComprobanteAAutorizar, f: FilaFiscal, cuit: string, tratamientos: Record<string, TratamientoConcepto>): DetalleCae {
  const importes = importesArca(f.renglones ?? [], c.letra, tratamientos);
  const periodo = mesCompleto(f.anio, f.mes);
  const tipoDoc = docTipo(f.tipo_doc);
  const nroDoc = tipoDoc === 99 ? '0' : (f.nro_doc ?? '').replace(/\D/g, '') || '0';
  const condicion = f.condicion_iva ? CONDICION_IVA_RECEPTOR[f.condicion_iva] : CONDICION_IVA_RECEPTOR.consumidor_final;
  // El orden de las claves es el que exige ARCA.
  return {
    Concepto: CONCEPTO_SERVICIOS,
    DocTipo: tipoDoc === 99 || nroDoc === '0' ? 99 : tipoDoc,
    DocNro: nroDoc,
    CbteDesde: c.numero,
    CbteHasta: c.numero,
    CbteFch: fechaArca(c.fecha),
    ImpTotal: importes.ImpTotal,
    ImpTotConc: importes.ImpTotConc,
    ImpNeto: importes.ImpNeto,
    ImpOpEx: importes.ImpOpEx,
    ImpTrib: importes.ImpTrib,
    ImpIVA: importes.ImpIVA,
    FchServDesde: fechaArca(periodo.desde),
    FchServHasta: fechaArca(periodo.hasta),
    FchVtoPago: fechaArca(c.venceEl && c.venceEl >= c.fecha ? c.venceEl : c.fecha),
    MonId: 'PES',
    MonCotiz: 1,
    CondicionIVAReceptorId: condicion,
    ...(f.origen_numero !== null && f.origen_tipo && f.origen_letra && f.origen_pv !== null && f.origen_fecha
      ? { CbtesAsoc: { CbteAsoc: [{ Tipo: cbteTipo(f.origen_tipo, f.origen_letra), PtoVta: f.origen_pv, Nro: f.origen_numero, Cuit: cuit, CbteFch: fechaArca(f.origen_fecha) }] } }
      : {}),
    ...(importes.tributos.length ? { Tributos: { Tributo: importes.tributos } } : {}),
    ...(importes.iva.length ? { Iva: { AlicIva: importes.iva } } : {}),
  };
}

const LOTE_ARCA = 100;

export function proveedorArca(cfg: ConfigFiscal, cuit: string, ambiente: AmbienteArca): ProveedorFiscal {
  const cliente: ClienteWsfe = { transporte, ambiente };
  return {
    nombre: `ARCA (${ambiente === 'produccion' ? 'producción' : 'homologación'})`,
    ambiente,
    simulado: ambiente !== 'produccion',
    async autorizar(comprobantes, transaction): Promise<ResultadoAutorizacion> {
      const autorizados = new Map<number, Autorizacion>();
      if (comprobantes.length === 0) return { autorizados, rechazo: null };
      const datos = await datosFiscales(
        comprobantes.map((c) => c.id),
        transaction,
      );
      const tratamientos = cfg.tratamientosJson ?? {};

      // Un talonario de ARCA por punto de venta y tipo de comprobante, en orden de número.
      const talonarios = new Map<string, ComprobanteAAutorizar[]>();
      for (const c of [...comprobantes].sort((a, b) => a.numero - b.numero)) {
        const clave = `${c.puntoVenta}|${cbteTipo(c.tipo, c.letra)}`;
        talonarios.set(clave, [...(talonarios.get(clave) ?? []), c]);
      }

      for (const [clave, grupo] of talonarios) {
        const [pv, tipo] = clave.split('|').map(Number) as [number, number];
        const ultimo = await conCredenciales(cfg, cuit, ambiente, (cred) => ultimoAutorizado(cliente, cred, pv, tipo));

        // Si ARCA ya autorizó alguno de estos números (un intento anterior que se cortó después de
        // autorizar), se recupera su CAE en vez de pedirlo de nuevo, comprobando que sea el mismo comprobante.
        const yaAutorizados = grupo.filter((c) => c.numero <= ultimo);
        for (const c of yaAutorizados) {
          const enArca = await conCredenciales(cfg, cuit, ambiente, (cred) => consultarComprobante(cliente, cred, pv, tipo, c.numero));
          const f = datos.get(c.id);
          const nroDoc = (f?.nro_doc ?? '').replace(/\D/g, '');
          const mismo = enArca && Math.abs(Number(enArca.total) - Number(c.total)) < 0.005 && enArca.fecha === c.fecha && (enArca.docNro === nroDoc || enArca.docNro === '0');
          if (!enArca || !mismo) {
            throw new ErrorArca(
              `ARCA ya tiene autorizado el número ${c.numero} del punto de venta ${pv} con otros datos. La numeración de GestiónCoop no coincide con la de ARCA: revisala desde el Panel de SRV antes de seguir.`,
            );
          }
          autorizados.set(c.id, { cae: enArca.cae, caeVence: enArca.caeVence, ambiente });
        }
        const pendientes = grupo.filter((c) => c.numero > ultimo);
        if (pendientes.length === 0) continue;
        if (pendientes[0]!.numero !== ultimo + 1) {
          throw new ErrorArca(
            `La numeración no coincide con ARCA: en el punto de venta ${pv} ARCA autorizó hasta el ${ultimo} y GestiónCoop iba a usar el ${pendientes[0]!.numero}. Sincronizá la numeración desde el Panel de SRV.`,
          );
        }

        for (let i = 0; i < pendientes.length; i += LOTE_ARCA) {
          const tanda = pendientes.slice(i, i + LOTE_ARCA);
          const detalles: DetalleCae[] = [];
          let rechazoLocal: { id: number; motivo: string } | null = null;
          for (const c of tanda) {
            try {
              detalles.push(detalleCae(c, datos.get(c.id)!, cuit, tratamientos));
            } catch (err) {
              if (!(err instanceof ImportesNoCierran)) throw err;
              rechazoLocal = { id: c.id, motivo: `No se pudo informar a ARCA: ${err.message}` };
              break;
            }
          }
          if (detalles.length) {
            const resultados = await conCredenciales(cfg, cuit, ambiente, (cred) => solicitarCae(cliente, cred, pv, tipo, detalles));
            const porNumero = new Map(resultados.map((r) => [r.numero, r]));
            for (const c of tanda.slice(0, detalles.length)) {
              const r = porNumero.get(c.numero);
              if (!r || !r.aprobado || !r.cae || !r.caeVence) {
                const motivo = r?.observaciones.length ? r.observaciones.map((o) => `${o.codigo} ${o.mensaje}`).join(' · ') : 'ARCA no lo autorizó.';
                return { autorizados, rechazo: { id: c.id, motivo: `ARCA lo rechazó: ${motivo}`.slice(0, 300) } };
              }
              autorizados.set(c.id, { cae: r.cae, caeVence: r.caeVence, ambiente });
            }
          }
          if (rechazoLocal) return { autorizados, rechazo: { ...rechazoLocal, motivo: rechazoLocal.motivo.slice(0, 300) } };
        }
      }
      return { autorizados, rechazo: null };
    },
  };
}

/** Configuración fiscal de la cooperativa en curso (o `null` si nunca se cargó). */
export const configFiscalActual = (transaction?: Transaction) => ConfigFiscal.findByPk(requireCooperativaId(), { transaction });

/** El proveedor fiscal de la cooperativa en curso: ARCA si tiene certificado y ambiente; si no, el simulado. */
export async function proveedorFiscalActual(transaction?: Transaction): Promise<ProveedorFiscal> {
  const cfg = await configFiscalActual(transaction);
  if (!cfg || !esArca(cfg.ambiente) || !cfg.certificado || !cfg.claveCifrada) return fiscalSimulado;
  const coop = await Cooperativa.findByPk(requireCooperativaId(), { transaction });
  return proveedorArca(cfg, cfg.cuit ?? coop!.cuit, cfg.ambiente);
}

/* ───────────────────────── Panel de SRV ───────────────────────── */

const CONCEPTOS_FIJOS: Omit<ConceptoFiscal, 'sugerido'>[] = [
  { codigo: 'SEPELIO_TITULAR', nombre: 'Sepelio (titular)', grupo: 'adicional' },
  { codigo: 'SEPELIO_ADHERENTES', nombre: 'Sepelio (adherentes)', grupo: 'adicional' },
];

export async function vistaConfigFiscal(): Promise<ConfigFiscalVista> {
  const cooperativaId = requireCooperativaId();
  const [coop, cfg, conceptos, [pendientes]] = await Promise.all([
    Cooperativa.findByPk(cooperativaId),
    configFiscalActual(),
    sequelize.query<{ codigo: string; nombre: string; grupo: string }>(
      `SELECT DISTINCT ON (codigo) codigo, nombre, grupo FROM conceptos
       WHERE cooperativa_id = $cooperativaId AND upper(codigo) NOT LIKE 'IVA%' AND grupo <> 'cargo'
       ORDER BY codigo, vigente_desde DESC`,
      { bind: { cooperativaId }, type: QueryTypes.SELECT },
    ),
    sequelize.query<{ n: string }>(`SELECT count(*) AS n FROM comprobantes WHERE cooperativa_id = $cooperativaId AND estado = 'borrador'`, {
      bind: { cooperativaId },
      type: QueryTypes.SELECT,
    }),
  ]);
  const vence = cfg?.certificadoVence ?? null;
  const lista = [...conceptos, ...CONCEPTOS_FIJOS.filter((f) => !conceptos.some((c) => c.codigo === f.codigo))];
  return {
    ambiente: cfg?.ambiente ?? 'simulado',
    cuit: cfg?.cuit ?? coop!.cuit,
    cuitPropio: cfg?.cuit ?? null,
    puntoVenta: coop!.configJson.puntoVenta,
    certificado: cfg?.certificado && vence ? { titular: cfg.certificadoTitular ?? '', vence, vencido: vence < new Date().toISOString().slice(0, 10) } : null,
    tratamientos: cfg?.tratamientosJson ?? {},
    conceptos: lista.map((c) => ({ ...c, sugerido: tratamientoSugerido(c.grupo as GrupoRenglon) })),
    ultimaPrueba: cfg?.ultimaPruebaEl ? { el: cfg.ultimaPruebaEl.toISOString(), ok: Boolean(cfg.ultimaPruebaOk), detalle: cfg.ultimaPruebaDetalle ?? '' } : null,
    borradoresPendientes: Number(pendientes?.n ?? 0),
  };
}

async function asegurarConfig(): Promise<ConfigFiscal> {
  const cooperativaId = requireCooperativaId();
  return (await configFiscalActual()) ?? ConfigFiscal.create({ cooperativaId });
}

export async function guardarConfigFiscal(datos: ConfigFiscalDatos, usuarioId: number): Promise<void> {
  const cooperativaId = requireCooperativaId();
  const vista = await vistaConfigFiscal();
  if (esArca(datos.ambiente) && !vista.certificado) throw conflict('Primero cargá el certificado y la clave de ARCA.');
  if (datos.ambiente === 'produccion' && vista.ambiente !== 'produccion' && !datos.confirmarProduccion) {
    throw conflict('Para pasar a producción hay que confirmarlo: desde ahí cada factura tiene validez fiscal.');
  }
  if (datos.puntoVenta !== vista.puntoVenta && vista.borradoresPendientes > 0) {
    throw conflict(`Hay ${vista.borradoresPendientes} pre-facturas sin emitir con el punto de venta ${vista.puntoVenta}. Emitilas o descartalas antes de cambiarlo.`);
  }
  await sequelize.transaction(async (transaction) => {
    const cfg = (await configFiscalActual(transaction)) ?? (await ConfigFiscal.create({ cooperativaId }, { transaction }));
    const antes = { ambiente: cfg.ambiente, cuit: cfg.cuit, puntoVenta: vista.puntoVenta, tratamientos: cfg.tratamientosJson };
    // Cambiar de ambiente invalida el permiso de acceso guardado (es de otro servidor de ARCA).
    const cambiaAmbiente = cfg.ambiente !== datos.ambiente;
    await cfg.update(
      {
        ambiente: datos.ambiente,
        cuit: datos.cuit,
        tratamientosJson: datos.tratamientos,
        actualizadoPor: usuarioId,
        ...(cambiaAmbiente ? { taCifrado: null, taVence: null, taAmbiente: null } : {}),
      },
      { transaction },
    );
    if (datos.puntoVenta !== vista.puntoVenta) {
      const coop = await Cooperativa.findByPk(cooperativaId, { transaction, lock: transaction.LOCK.UPDATE });
      await coop!.update({ configJson: { ...coop!.configJson, puntoVenta: datos.puntoVenta } }, { transaction });
    }
    await writeAudit({
      accion: 'configurar_factura_electronica',
      entidad: 'config_fiscal',
      entidadId: cooperativaId,
      antes,
      despues: { ambiente: datos.ambiente, cuit: datos.cuit, puntoVenta: datos.puntoVenta, tratamientos: datos.tratamientos },
      transaction,
    });
  });
  clearCooperativaCache();
}

export async function guardarCertificado(datos: CertificadoFiscalInput, usuarioId: number): Promise<void> {
  let leido;
  try {
    leido = leerCertificado(datos.certificado, datos.clave);
  } catch (err) {
    if (err instanceof ErrorArca) throw badRequest(err.message);
    throw err;
  }
  const cfg = await asegurarConfig();
  await cfg.update({
    certificado: datos.certificado.trim(),
    claveCifrada: cifrar(datos.clave.trim()),
    certificadoTitular: leido.titular,
    certificadoVence: leido.vence,
    taCifrado: null,
    taVence: null,
    taAmbiente: null,
    actualizadoPor: usuarioId,
  });
  // En el registro queda quién lo cargó y a quién pertenece; nunca la clave.
  await writeAudit({ accion: 'cargar_certificado_arca', entidad: 'config_fiscal', entidadId: cfg.cooperativaId, despues: { titular: leido.titular, vence: leido.vence } });
}

export async function borrarCertificado(usuarioId: number): Promise<void> {
  const cfg = await configFiscalActual();
  if (!cfg?.certificado) return;
  if (esArca(cfg.ambiente)) throw conflict('Pasá la factura electrónica a «Simulada» antes de borrar el certificado.');
  await cfg.update({ certificado: null, claveCifrada: null, certificadoTitular: null, certificadoVence: null, taCifrado: null, taVence: null, taAmbiente: null, actualizadoPor: usuarioId });
  await writeAudit({ accion: 'borrar_certificado_arca', entidad: 'config_fiscal', entidadId: cfg.cooperativaId });
}

/** Talonarios que la cooperativa usa (o va a usar) con ARCA: facturas y notas de crédito, A y B, en su punto de venta. */
async function talonariosFiscales(): Promise<{ tipo: 'factura' | 'nota_credito'; letra: string; puntoVenta: number; enApp: number }[]> {
  const cooperativaId = requireCooperativaId();
  const coop = await Cooperativa.findByPk(cooperativaId);
  const puntoVenta = coop!.configJson.puntoVenta;
  const usados = await sequelize.query<{ tipo: string; letra: string; ultimo: number }>(
    `SELECT tipo, letra, ultimo FROM numeradores WHERE cooperativa_id = $cooperativaId AND punto_venta = $puntoVenta AND tipo IN ('factura', 'nota_credito')`,
    { bind: { cooperativaId, puntoVenta }, type: QueryTypes.SELECT },
  );
  const lista: { tipo: 'factura' | 'nota_credito'; letra: string; puntoVenta: number; enApp: number }[] = [];
  for (const tipo of ['factura', 'nota_credito'] as const) {
    for (const letra of ['A', 'B']) {
      lista.push({ tipo, letra, puntoVenta, enApp: usados.find((u) => u.tipo === tipo && u.letra === letra)?.ultimo ?? 0 });
    }
  }
  return lista;
}

export async function conArca(): Promise<{ cfg: ConfigFiscal; cuit: string; ambiente: AmbienteArca }> {
  const cfg = await configFiscalActual();
  if (!cfg || !esArca(cfg.ambiente)) throw conflict('Elegí el ambiente de ARCA (homologación o producción) y guardá antes de probar.');
  if (!cfg.certificado || !cfg.claveCifrada) throw conflict('Primero cargá el certificado y la clave de ARCA.');
  const coop = await Cooperativa.findByPk(cfg.cooperativaId);
  return { cfg, cuit: cfg.cuit ?? coop!.cuit, ambiente: cfg.ambiente };
}

/** Prueba de punta a punta: servidores de ARCA, permiso de acceso y numeración de cada talonario. */
export async function probarConexion(): Promise<PruebaArca> {
  const { cfg, cuit, ambiente } = await conArca();
  const cliente: ClienteWsfe = { transporte, ambiente };
  const pasos: PruebaArca['pasos'] = [];
  const numeracion: NumeracionArca[] = [];
  const paso = async (nombre: string, fn: () => Promise<string>) => {
    try {
      pasos.push({ nombre, ok: true, detalle: await fn() });
      return true;
    } catch (err) {
      pasos.push({ nombre, ok: false, detalle: err instanceof Error ? err.message : String(err) });
      return false;
    }
  };

  const servidores = await paso('Servidores de ARCA', async () => {
    const e = await estadoServicio(cliente);
    if ([e.app, e.base, e.auth].some((x) => x !== 'OK')) throw new ErrorArca(`ARCA informa problemas: aplicación ${e.app}, base ${e.base}, autenticación ${e.auth}.`);
    return 'Funcionando';
  });
  const acceso = servidores && (await paso('Permiso de acceso (certificado)', async () => {
    await credenciales(cfg, cuit, ambiente);
    return `Permiso vigente hasta ${cfg.taVence?.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' }) ?? '—'}`;
  }));
  if (acceso) {
    for (const t of await talonariosFiscales()) {
      let enArca: number | null = null;
      await paso(`Numeración ${t.tipo === 'factura' ? 'Factura' : 'Nota de crédito'} ${t.letra} · punto de venta ${t.puntoVenta}`, async () => {
        enArca = await conCredenciales(cfg, cuit, ambiente, (cred) => ultimoAutorizado(cliente, cred, t.puntoVenta, cbteTipo(t.tipo, t.letra)));
        return enArca === t.enApp ? `Alineada: último n.º ${enArca}` : `ARCA va por el ${enArca} y GestiónCoop por el ${t.enApp}`;
      });
      numeracion.push({ tipo: t.tipo, letra: t.letra, puntoVenta: t.puntoVenta, enArca, enApp: t.enApp });
    }
  }
  const ok = pasos.every((p) => p.ok) && numeracion.every((n) => n.enArca === n.enApp);
  const resumen = pasos.map((p) => `${p.ok ? '✓' : '✗'} ${p.nombre}: ${p.detalle}`).join(' | ');
  await cfg.update({ ultimaPruebaEl: new Date(), ultimaPruebaOk: ok, ultimaPruebaDetalle: resumen.slice(0, 500) });
  return { ok, pasos, numeracion };
}

/**
 * Lleva la numeración de GestiónCoop hasta el último número que autorizó ARCA (cuando la cooperativa ya
 * facturaba con otro sistema en ese punto de venta). Nunca la hace retroceder: si GestiónCoop ya va más
 * adelante que ARCA, hay que usar otro punto de venta.
 */
export async function sincronizarNumeracion(): Promise<NumeracionArca[]> {
  const { cfg, cuit, ambiente } = await conArca();
  const vista = await vistaConfigFiscal();
  if (vista.borradoresPendientes > 0) throw conflict('Hay pre-facturas sin emitir. Emitilas o descartalas antes de sincronizar la numeración.');
  const cliente: ClienteWsfe = { transporte, ambiente };
  const cooperativaId = requireCooperativaId();
  const resultado: NumeracionArca[] = [];
  const atrasados: string[] = [];
  for (const t of await talonariosFiscales()) {
    const enArca = await conCredenciales(cfg, cuit, ambiente, (cred) => ultimoAutorizado(cliente, cred, t.puntoVenta, cbteTipo(t.tipo, t.letra)));
    if (enArca < t.enApp) atrasados.push(`${t.tipo === 'factura' ? 'Factura' : 'Nota de crédito'} ${t.letra}: ARCA va por el ${enArca} y GestiónCoop por el ${t.enApp}`);
    resultado.push({ tipo: t.tipo, letra: t.letra, puntoVenta: t.puntoVenta, enArca, enApp: t.enApp });
  }
  if (atrasados.length) {
    throw conflict(`En el punto de venta ${vista.puntoVenta}, GestiónCoop ya usó números que ARCA no tiene (${atrasados.join('; ')}). Usá un punto de venta habilitado para web services que no se haya usado en GestiónCoop.`);
  }
  await sequelize.transaction(async (transaction) => {
    for (const n of resultado) {
      if (n.enArca === n.enApp) continue;
      await sequelize.query(
        `INSERT INTO numeradores (cooperativa_id, tipo, letra, punto_venta, ultimo) VALUES ($cooperativaId, $tipo, $letra, $puntoVenta, $ultimo)
         ON CONFLICT (cooperativa_id, tipo, letra, punto_venta) DO UPDATE SET ultimo = EXCLUDED.ultimo, actualizado_el = now()`,
        { bind: { cooperativaId, tipo: n.tipo, letra: n.letra, puntoVenta: n.puntoVenta, ultimo: n.enArca }, transaction },
      );
    }
    await writeAudit({
      accion: 'sincronizar_numeracion_arca',
      entidad: 'numeradores',
      entidadId: vista.puntoVenta,
      antes: resultado.map((n) => ({ tipo: n.tipo, letra: n.letra, ultimo: n.enApp })),
      despues: resultado.map((n) => ({ tipo: n.tipo, letra: n.letra, ultimo: n.enArca })),
      transaction,
    });
  });
  return resultado.map((n) => ({ ...n, enApp: n.enArca ?? n.enApp }));
}
