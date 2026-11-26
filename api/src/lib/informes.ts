// Informes exportables (SPEC 6.9): padrón, deuda por socio, libro de ventas, recaudación diaria,
// lecturas del mes, cortes sugeridos y consumos por zona. Cada uno es una consulta que devuelve una
// tabla (columnas + filas + totales); lib/exportar.ts la pasa a Excel, CSV o PDF.
// Usan las mismas definiciones que el tablero: el total del informe de deuda es la deuda del tablero.
import Decimal from 'decimal.js';
import { QueryTypes } from 'sequelize';
import {
  ANOMALIA_ETIQUETA,
  CATEGORIA_ETIQUETA,
  CONDICION_IVA_ETIQUETA,
  ESTADO_COMPROBANTE_ETIQUETA,
  ESTADO_SERVICIO_ETIQUETA,
  INFORMES_DEF,
  MEDIOS_PAGO,
  MEDIO_PAGO_ETIQUETA,
  nombreDeMes,
  NOVEDAD_ETIQUETA,
  referenciaComprobante,
  SERVICIO_ETIQUETA,
  TIMEZONE,
  UNIDAD_SERVICIO,
  type Anomalia,
  type Categoria,
  type CeldaInforme,
  type ClaveInforme,
  type ColumnaInforme,
  type CondicionIva,
  type EstadoComprobante,
  type EstadoServicio,
  type InformeDatos,
  type MedioPago,
  type Novedad,
  type ServicioConexion,
  type ServicioMedido,
  type TipoComprobante,
  type TipoColumna,
} from '../shared';
import { sequelize } from '../db';
import { mesCompleto } from '../motor';
import { entreDias, FACTURAS_VALIDAS, filtroFacturas, type Seleccion } from './tablero';
import { cargarParametros } from './tarifas';
import { requireCooperativaId } from './tenant';

type Fila = CeldaInforme[];
interface Tabla {
  columnas: ColumnaInforme[];
  filas: Fila[];
  nota: string | null;
}

const col = (clave: string, titulo: string, tipo: TipoColumna, ancho: number, suma = false): ColumnaInforme => ({ clave, titulo, tipo, ancho, ...(suma ? { suma } : {}) });
const dinero = (v: string | number | null | undefined) => new Decimal(v ?? 0).toFixed(2);
const numero = (v: string | number | null) => (v === null ? null : new Decimal(v).toDecimalPlaces(2).toNumber());
const mayuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

function consulta<T extends object>(sql: string, replacements: Record<string, unknown>): Promise<T[]> {
  return sequelize.query<T>(sql, { replacements, type: QueryTypes.SELECT });
}

/* ───────────────────────── Deuda por socio ───────────────────────── */

async function deudaPorSocio(s: Seleccion): Promise<Tabla> {
  const filas = await consulta<{
    numero: number;
    nombre: string;
    tipo_doc: string;
    nro_doc: string;
    direccion: string | null;
    zona: string | null;
    telefono: string | null;
    facturas: string;
    vencidas: string;
    deuda: string;
    vencida: string | null;
    mas_vieja: string;
    dias: number;
  }>(
    `SELECT s.numero, s.nombre, s.tipo_doc, s.nro_doc, s.telefono,
            min(cx.direccion) AS direccion, string_agg(DISTINCT z.nombre, ', ') AS zona,
            count(*) AS facturas, count(*) FILTER (WHERE c.vence_el < CAST(:hoy AS date)) AS vencidas,
            sum(c.saldo) AS deuda, sum(c.saldo) FILTER (WHERE c.vence_el < CAST(:hoy AS date)) AS vencida,
            to_char(min(c.vence_el), 'YYYY-MM-DD') AS mas_vieja, GREATEST(CAST(:hoy AS date) - min(c.vence_el), 0) AS dias
     FROM comprobantes c
     JOIN socios s ON s.id = c.socio_id
     LEFT JOIN conexiones cx ON cx.id = c.conexion_id
     LEFT JOIN zonas z ON z.id = cx.zona_id
     WHERE c.cooperativa_id = :cooperativaId AND c.tipo = 'factura' AND c.estado = 'emitido' AND c.saldo > 0${filtroFacturas(s.datos)}
     GROUP BY s.id
     ORDER BY sum(c.saldo) DESC, s.numero`,
    { cooperativaId: requireCooperativaId(), hoy: s.hoy, servicio: s.datos.servicio, zonaId: s.datos.zonaId },
  );
  return {
    columnas: [
      // Primero quién y cuánto; los datos para ubicarlo y llamarlo, después.
      col('socio', 'Socio', 'entero', 6),
      col('nombre', 'Titular', 'texto', 22),
      col('deuda', 'Debe', 'dinero', 13, true),
      col('vencida', 'De eso, vencido', 'dinero', 13, true),
      col('facturas', 'Facturas sin pagar', 'entero', 8, true),
      col('vencidas', 'Vencidas', 'entero', 8, true),
      col('dias', 'Días de atraso', 'entero', 7),
      col('masVieja', 'Vence la más vieja', 'fecha', 10),
      col('telefono', 'Teléfono', 'texto', 12),
      col('direccion', 'Domicilio', 'texto', 22),
      col('zona', 'Zona', 'texto', 14),
      col('documento', 'Documento', 'texto', 14),
    ],
    filas: filas.map((f) => [f.numero, f.nombre, dinero(f.deuda), dinero(f.vencida), Number(f.facturas), Number(f.vencidas), f.dias, f.mas_vieja, f.telefono, f.direccion, f.zona, `${f.tipo_doc} ${f.nro_doc}`]),
    nota: 'Deuda al día de hoy: el saldo de cada factura emitida que todavía no se pagó entera. «Vencido» es lo que ya pasó su fecha de vencimiento.',
  };
}

/* ───────────────────────── Cortes sugeridos ───────────────────────── */

async function cortesSugeridos(s: Seleccion): Promise<Tabla> {
  const { facturasParaCorte } = await cargarParametros();
  const filas = await consulta<{
    numero: number;
    nombre: string;
    telefono: string | null;
    conexion: number;
    direccion: string;
    zona: string | null;
    servicio: ServicioConexion;
    estado: EstadoServicio;
    vencidas: string;
    deuda: string;
    mas_vieja: string;
    dias: number;
  }>(
    `SELECT s.numero, s.nombre, s.telefono, cx.numero AS conexion, cx.direccion, z.nombre AS zona, c.servicio, sc.estado,
            count(*) AS vencidas, sum(c.saldo) AS deuda, to_char(min(c.vence_el), 'YYYY-MM-DD') AS mas_vieja, CAST(:hoy AS date) - min(c.vence_el) AS dias
     FROM comprobantes c
     JOIN servicios_conexion sc ON sc.id = c.servicio_conexion_id
     JOIN conexiones cx ON cx.id = c.conexion_id
     JOIN socios s ON s.id = c.socio_id
     LEFT JOIN zonas z ON z.id = cx.zona_id
     WHERE c.cooperativa_id = :cooperativaId AND c.tipo = 'factura' AND c.estado = 'emitido' AND c.saldo > 0 AND c.vence_el < CAST(:hoy AS date)
       -- lo que ya está cortado o de baja no se sugiere de nuevo
       AND sc.estado IN ('activo', 'suspendido')${filtroFacturas(s.datos)}
     GROUP BY s.id, cx.id, z.nombre, c.servicio, sc.id
     HAVING count(*) >= :minimo
     ORDER BY count(*) DESC, sum(c.saldo) DESC, s.numero`,
    { cooperativaId: requireCooperativaId(), hoy: s.hoy, minimo: facturasParaCorte, servicio: s.datos.servicio, zonaId: s.datos.zonaId },
  );
  return {
    columnas: [
      col('socio', 'Socio', 'entero', 6),
      col('nombre', 'Titular', 'texto', 22),
      col('servicio', 'Servicio', 'texto', 13),
      col('vencidas', 'Facturas vencidas', 'entero', 8, true),
      col('deuda', 'Deuda vencida', 'dinero', 13, true),
      col('dias', 'Días de atraso', 'entero', 7),
      col('masVieja', 'Vence la más vieja', 'fecha', 10),
      col('estado', 'Estado del servicio', 'texto', 10),
      col('conexion', 'Conexión', 'entero', 7),
      col('direccion', 'Domicilio', 'texto', 22),
      col('zona', 'Zona', 'texto', 14),
      col('telefono', 'Teléfono', 'texto', 12),
    ],
    filas: filas.map((f) => [f.numero, f.nombre, SERVICIO_ETIQUETA[f.servicio], Number(f.vencidas), dinero(f.deuda), f.dias, f.mas_vieja, ESTADO_SERVICIO_ETIQUETA[f.estado], f.conexion, f.direccion, f.zona, f.telefono]),
    nota: `Servicios con ${facturasParaCorte} o más facturas vencidas sin pagar (la cantidad la fija la cooperativa en Tarifas). Es una lista para decidir: el sistema nunca corta solo.`,
  };
}

/* ───────────────────────── Libro de ventas ───────────────────────── */

async function libroDeVentas(s: Seleccion): Promise<Tabla> {
  const filas = await consulta<{
    fecha: string;
    tipo: TipoComprobante;
    letra: string;
    punto_venta: number;
    numero: number;
    estado: EstadoComprobante;
    servicio: ServicioConexion;
    socio: string | null;
    nombre: string | null;
    tipo_doc: string | null;
    nro_doc: string | null;
    condicion_iva: CondicionIva | null;
    total: string;
    neto: string;
    iva: string;
    tributos: string;
    adicionales: string;
    recargos: string;
  }>(
    `SELECT to_char(c.emitido_el, 'YYYY-MM-DD') AS fecha, c.tipo, c.letra, c.punto_venta, c.numero, c.estado, c.servicio,
            c.snapshot_json->'titular'->>'numero' AS socio, c.snapshot_json->'titular'->>'nombre' AS nombre,
            c.snapshot_json->'titular'->>'tipoDoc' AS tipo_doc, c.snapshot_json->'titular'->>'nroDoc' AS nro_doc,
            c.snapshot_json->'titular'->>'condicionIva' AS condicion_iva,
            c.total, r.neto, r.iva, r.tributos, r.adicionales, r.recargos
     FROM comprobantes c
     LEFT JOIN conexiones cx ON cx.id = c.conexion_id
     LEFT JOIN LATERAL (
       SELECT COALESCE(sum(x.importe) FILTER (WHERE x.grupo IN ('basico', 'cargo')), 0) AS neto,
              COALESCE(sum(x.importe) FILTER (WHERE x.codigo LIKE 'IVA%'), 0) AS iva,
              COALESCE(sum(x.importe) FILTER (WHERE x.grupo = 'gravamen' AND x.codigo NOT LIKE 'IVA%'), 0) AS tributos,
              COALESCE(sum(x.importe) FILTER (WHERE x.grupo = 'adicional'), 0) AS adicionales,
              COALESCE(sum(x.importe) FILTER (WHERE x.grupo = 'recargo' AND x.codigo NOT LIKE 'IVA%'), 0) AS recargos
       FROM comprobante_renglones x WHERE x.comprobante_id = c.id
     ) r ON TRUE
     WHERE c.cooperativa_id = :cooperativaId AND c.tipo IN ('factura', 'nota_credito', 'nota_debito') AND c.estado <> 'borrador'
       AND c.emitido_el BETWEEN CAST(:desde AS date) AND CAST(:hasta AS date)${filtroFacturas(s.datos)}
     ORDER BY c.emitido_el, c.tipo, c.letra, c.punto_venta, c.numero`,
    { cooperativaId: requireCooperativaId(), ...mesCompleto(s.periodo.anio, s.periodo.mes), servicio: s.datos.servicio, zonaId: s.datos.zonaId },
  );
  return {
    columnas: [
      col('fecha', 'Fecha', 'fecha', 9),
      col('comprobante', 'Comprobante', 'texto', 17),
      col('socio', 'Socio', 'entero', 6),
      col('nombre', 'Titular', 'texto', 20),
      col('documento', 'Documento', 'texto', 14),
      col('iva', 'Condición IVA', 'texto', 13),
      col('servicio', 'Servicio', 'texto', 12),
      col('estado', 'Estado', 'texto', 8),
      col('neto', 'Neto', 'dinero', 11, true),
      col('ivaImporte', 'IVA', 'dinero', 10, true),
      col('tributos', 'Otros tributos', 'dinero', 10, true),
      col('adicionales', 'Adicionales', 'dinero', 10, true),
      col('recargos', 'Recargos', 'dinero', 9, true),
      col('total', 'Total', 'dinero', 12, true),
    ],
    filas: filas.map((f) => {
      // Una nota de crédito resta: guarda los mismos importes que la factura que anula.
      const signo = f.tipo === 'nota_credito' ? -1 : 1;
      const con = (v: string) => new Decimal(v).mul(signo).toFixed(2);
      return [
        f.fecha,
        referenciaComprobante({ tipo: f.tipo, letra: f.letra, puntoVenta: f.punto_venta, numero: f.numero }),
        f.socio === null ? null : Number(f.socio),
        f.nombre,
        f.tipo_doc && f.nro_doc ? `${f.tipo_doc} ${f.nro_doc}` : null,
        f.condicion_iva ? CONDICION_IVA_ETIQUETA[f.condicion_iva] : null,
        SERVICIO_ETIQUETA[f.servicio],
        f.tipo === 'factura' ? ESTADO_COMPROBANTE_ETIQUETA[f.estado] : 'Emitida',
        con(f.neto),
        con(f.iva),
        con(f.tributos),
        con(f.adicionales),
        con(f.recargos),
        con(f.total),
      ];
    }),
    nota: 'Comprobantes con fecha de emisión dentro del mes. Una factura anulada figura con su nota de crédito, que resta. «IVA» suma los conceptos cuyo código empieza con IVA. Sin validez fiscal mientras la facturación electrónica esté simulada.',
  };
}

/* ───────────────────────── Recaudación diaria ───────────────────────── */

async function recaudacionDiaria(s: Seleccion): Promise<Tabla> {
  const medios = MEDIOS_PAGO.map((m) => `COALESCE(sum(p.importe) FILTER (WHERE p.estado = 'acreditado' AND p.medio = '${m}'), 0) AS ${m}`).join(', ');
  const filas = await consulta<{ dia: string; cobros: string; online: string; anulados: string; total: string } & Record<MedioPago, string>>(
    `SELECT to_char(p.cobrado_el AT TIME ZONE '${TIMEZONE}', 'YYYY-MM-DD') AS dia,
            count(*) FILTER (WHERE p.estado = 'acreditado') AS cobros, ${medios},
            COALESCE(sum(p.importe) FILTER (WHERE p.estado = 'acreditado' AND p.origen = 'online'), 0) AS online,
            count(*) FILTER (WHERE p.estado = 'anulado') AS anulados,
            COALESCE(sum(p.importe) FILTER (WHERE p.estado = 'acreditado'), 0) AS total
     FROM pagos p
     WHERE p.cooperativa_id = :cooperativaId AND ${entreDias('p.cobrado_el')}
     GROUP BY 1 ORDER BY 1`,
    { cooperativaId: requireCooperativaId(), ...mesCompleto(s.periodo.anio, s.periodo.mes) },
  );
  return {
    columnas: [
      col('dia', 'Día', 'fecha', 10),
      col('cobros', 'Cobros', 'entero', 8, true),
      ...MEDIOS_PAGO.map((m) => col(m, MEDIO_PAGO_ETIQUETA[m], 'dinero', 13, true)),
      col('total', 'Total del día', 'dinero', 14, true),
      col('online', 'De eso, pago online', 'dinero', 13, true),
      col('anulados', 'Cobros anulados', 'entero', 8, true),
    ],
    filas: filas.map((f) => [f.dia, Number(f.cobros), ...MEDIOS_PAGO.map((m) => dinero(f[m])), dinero(f.total), dinero(f.online), Number(f.anulados)]),
    nota: 'Lo que entró cada día por fecha de cobro: facturas de cualquier mes y ventas de mostrador. Los cobros anulados no suman.',
  };
}

/* ───────────────────────── Lecturas del mes ───────────────────────── */

async function lecturasDelMes(s: Seleccion): Promise<Tabla> {
  const f = s.datos;
  const filas = await consulta<{
    ruta: string | null;
    orden: number | null;
    conexion: number;
    direccion: string;
    titular: string;
    servicio: ServicioMedido;
    medidor: string;
    anterior: string | null;
    valor: string | null;
    consumo: string | null;
    tipo: 'real' | 'estimada';
    novedad: Novedad | null;
    anomalia: Anomalia | null;
    operario: string | null;
    tomada_el: Date;
  }>(
    `SELECT r.nombre AS ruta, cx.orden_ruta AS orden, cx.numero AS conexion, cx.direccion, s.nombre AS titular, sc.servicio, m.numero AS medidor,
            l.anterior, l.valor, l.consumo, l.tipo, l.novedad, l.anomalia, u.nombre AS operario, l.tomada_el
     FROM lecturas l
     JOIN periodos p ON p.id = l.periodo_id
     JOIN medidores m ON m.id = l.medidor_id
     JOIN servicios_conexion sc ON sc.id = m.servicio_conexion_id
     JOIN conexiones cx ON cx.id = sc.conexion_id
     JOIN socios s ON s.id = cx.socio_id
     LEFT JOIN rutas r ON r.id = cx.ruta_id
     LEFT JOIN usuarios u ON u.id = l.operario_id
     WHERE l.cooperativa_id = :cooperativaId AND p.anio = :anio AND p.mes = :mes${f.servicio ? ' AND sc.servicio = :servicio' : ''}${f.zonaId ? ' AND cx.zona_id = :zonaId' : ''}
     ORDER BY r.id NULLS LAST, cx.orden_ruta NULLS LAST, cx.id, sc.servicio`,
    { cooperativaId: requireCooperativaId(), anio: s.periodo.anio, mes: s.periodo.mes, servicio: f.servicio, zonaId: f.zonaId },
  );
  return {
    columnas: [
      col('ruta', 'Ruta', 'texto', 12),
      col('orden', 'Orden', 'entero', 5),
      col('conexion', 'Conexión', 'entero', 7),
      col('direccion', 'Domicilio', 'texto', 20),
      col('titular', 'Titular', 'texto', 18),
      col('servicio', 'Servicio', 'texto', 9),
      col('medidor', 'Medidor', 'texto', 9),
      col('anterior', 'Anterior', 'numero', 8),
      col('actual', 'Actual', 'numero', 8),
      col('consumo', 'Consumo', 'numero', 8, true),
      col('tipo', 'Lectura', 'texto', 7),
      col('novedad', 'Novedad', 'texto', 13),
      col('operario', 'Quién leyó', 'texto', 12),
      col('fecha', 'Cuándo', 'fechahora', 12),
    ],
    filas: filas.map((x) => [
      x.ruta,
      x.orden,
      x.conexion,
      x.direccion,
      x.titular,
      x.servicio === 'energia' ? 'Energía' : 'Agua',
      x.medidor,
      numero(x.anterior),
      numero(x.valor),
      numero(x.consumo),
      x.tipo === 'estimada' ? 'Estimada' : 'Real',
      [x.novedad ? NOVEDAD_ETIQUETA[x.novedad] : null, x.anomalia ? ANOMALIA_ETIQUETA[x.anomalia] : null].filter(Boolean).join(' · ') || null,
      x.operario,
      x.tomada_el.toISOString(),
    ]),
    nota: 'Lecturas cargadas del mes, en orden de ruta. Los medidores que todavía no se leyeron no figuran. El consumo suma kWh y m³ juntos: filtrá por servicio para un total con sentido.',
  };
}

/* ───────────────────────── Consumos por zona ───────────────────────── */

async function consumosPorZona(s: Seleccion): Promise<Tabla> {
  const medidos = s.datos.servicio === null ? '' : ' AND c.servicio = :servicio';
  const filas = await consulta<{ zona: string | null; tipo: string | null; servicio: ServicioMedido; conexiones: string; consumo: string; promedio: string; facturado: string }>(
    `SELECT z.nombre AS zona, z.tipo, c.servicio, count(*) AS conexiones, COALESCE(sum(c.consumo), 0) AS consumo,
            COALESCE(round(avg(c.consumo), 1), 0) AS promedio, sum(c.total) AS facturado
     FROM comprobantes c
     LEFT JOIN conexiones cx ON cx.id = c.conexion_id
     LEFT JOIN zonas z ON z.id = cx.zona_id
     WHERE c.cooperativa_id = :cooperativaId AND ${FACTURAS_VALIDAS} AND c.anio = :anio AND c.mes = :mes AND c.servicio IN ('energia', 'agua')${medidos}${s.datos.zonaId ? ' AND cx.zona_id = :zonaId' : ''}
     GROUP BY z.id, z.nombre, z.tipo, c.servicio
     ORDER BY c.servicio DESC, z.nombre NULLS LAST`,
    { cooperativaId: requireCooperativaId(), anio: s.periodo.anio, mes: s.periodo.mes, servicio: s.datos.servicio, zonaId: s.datos.zonaId },
  );
  return {
    columnas: [
      col('zona', 'Zona', 'texto', 22),
      col('tipo', 'Tipo', 'texto', 9),
      col('servicio', 'Servicio', 'texto', 14),
      col('unidad', 'Unidad', 'texto', 7),
      col('conexiones', 'Conexiones facturadas', 'entero', 11, true),
      col('consumo', 'Consumo', 'numero', 13),
      col('promedio', 'Promedio por conexión', 'numero', 12),
      col('facturado', 'Facturado', 'dinero', 15, true),
    ],
    filas: filas.map((x) => [x.zona ?? 'Sin zona', x.tipo === 'rural' ? 'Rural' : x.tipo === 'urbana' ? 'Urbana' : null, SERVICIO_ETIQUETA[x.servicio], UNIDAD_SERVICIO[x.servicio], Number(x.conexiones), numero(x.consumo), numero(x.promedio), dinero(x.facturado)]),
    nota: 'Consumo facturado en el mes (kWh de energía y m³ de agua). «Facturado» es el total de esas facturas, con impuestos y adicionales.',
  };
}

/* ───────────────────────── Padrón ───────────────────────── */

async function padron(s: Seleccion): Promise<Tabla> {
  const f = s.datos;
  const filas = await consulta<{
    numero: number;
    nombre: string;
    tipo_doc: string;
    nro_doc: string;
    condicion_iva: CondicionIva;
    telefono: string | null;
    email: string | null;
    conexion: number;
    direccion: string;
    zona: string | null;
    servicios: { servicio: ServicioConexion; estado: EstadoServicio; categoria: Categoria | null; subsidio: boolean }[] | null;
  }>(
    `SELECT s.numero, s.nombre, s.tipo_doc, s.nro_doc, s.condicion_iva, s.telefono, s.email, cx.numero AS conexion, cx.direccion, z.nombre AS zona,
            (SELECT json_agg(json_build_object('servicio', sc.servicio, 'estado', sc.estado, 'categoria', sc.categoria, 'subsidio', sc.tiene_subsidio) ORDER BY sc.id)
             FROM servicios_conexion sc WHERE sc.conexion_id = cx.id AND sc.estado <> 'baja') AS servicios
     FROM conexiones cx
     JOIN socios s ON s.id = cx.socio_id AND s.eliminado_el IS NULL
     LEFT JOIN zonas z ON z.id = cx.zona_id
     WHERE cx.cooperativa_id = :cooperativaId AND cx.eliminado_el IS NULL${f.zonaId ? ' AND cx.zona_id = :zonaId' : ''}
       ${f.servicio ? `AND EXISTS (SELECT 1 FROM servicios_conexion sc WHERE sc.conexion_id = cx.id AND sc.servicio = :servicio AND sc.estado <> 'baja')` : ''}
     ORDER BY s.numero, cx.numero`,
    { cooperativaId: requireCooperativaId(), servicio: f.servicio, zonaId: f.zonaId },
  );
  const ORDEN: ServicioConexion[] = ['energia', 'agua', 'internet', 'tv', 'sepelio'];
  return {
    columnas: [
      col('socio', 'Socio', 'entero', 6),
      col('nombre', 'Titular', 'texto', 22),
      col('documento', 'Documento', 'texto', 14),
      col('iva', 'Condición IVA', 'texto', 13),
      col('conexion', 'Conexión', 'entero', 7),
      col('direccion', 'Domicilio', 'texto', 22),
      col('zona', 'Zona', 'texto', 14),
      col('servicios', 'Servicios', 'texto', 24),
      col('categoria', 'Categoría de energía', 'texto', 14),
      col('telefono', 'Teléfono', 'texto', 12),
      col('email', 'Email', 'texto', 18),
    ],
    filas: filas.map((x) => {
      const servicios = [...(x.servicios ?? [])].sort((a, b) => ORDEN.indexOf(a.servicio) - ORDEN.indexOf(b.servicio));
      const energia = servicios.find((v) => v.servicio === 'energia');
      return [
        x.numero,
        x.nombre,
        `${x.tipo_doc} ${x.nro_doc}`,
        CONDICION_IVA_ETIQUETA[x.condicion_iva],
        x.conexion,
        x.direccion,
        x.zona,
        servicios.map((v) => `${SERVICIO_ETIQUETA[v.servicio]}${v.estado === 'activo' ? '' : ` (${ESTADO_SERVICIO_ETIQUETA[v.estado].toLowerCase()})`}`).join(', ') || null,
        energia?.categoria ? `${CATEGORIA_ETIQUETA[energia.categoria]}${energia.subsidio ? ' con subsidio' : ''}` : null,
        x.telefono,
        x.email,
      ];
    }),
    nota: 'Una fila por conexión. Tiene datos personales: usalo solo para la gestión de la cooperativa.',
  };
}

/* ───────────────────────── Armado ───────────────────────── */

const ARMAR: Record<ClaveInforme, (s: Seleccion) => Promise<Tabla>> = {
  deuda: deudaPorSocio,
  cortes: cortesSugeridos,
  'libro-ventas': libroDeVentas,
  recaudacion: recaudacionDiaria,
  lecturas: lecturasDelMes,
  'consumos-zona': consumosPorZona,
  padron,
};

/** Fila de totales: suma las columnas marcadas (la plata, con decimales exactos). */
function totalesDe(columnas: ColumnaInforme[], filas: Fila[]): CeldaInforme[] | null {
  if (!columnas.some((c) => c.suma) || filas.length === 0) return null;
  return columnas.map((c, i) => {
    if (!c.suma) return i === 0 ? 'Total' : null;
    const suma = filas.reduce((t, f) => t.plus(f[i] ?? 0), new Decimal(0));
    return c.tipo === 'dinero' ? suma.toFixed(2) : suma.toDecimalPlaces(2).toNumber();
  });
}

/** El informe completo, con todas sus filas. Quien lo muestra en pantalla recorta. */
export async function armarInforme(clave: ClaveInforme, s: Seleccion): Promise<InformeDatos> {
  const def = INFORMES_DEF.find((d) => d.clave === clave)!;
  const tabla = await ARMAR[clave](s);
  const usaPeriodo = def.filtros.includes('periodo');
  const partes = [
    usaPeriodo ? mayuscula(nombreDeMes(s.periodo.anio, s.periodo.mes)) : null,
    def.filtros.includes('servicio') && s.filtros.servicio ? SERVICIO_ETIQUETA[s.filtros.servicio] : null,
    def.filtros.includes('zona') && s.filtros.zona ? s.filtros.zona.nombre : null,
  ].filter(Boolean);
  return {
    clave,
    titulo: def.titulo,
    subtitulo: partes.join(' · ') || 'Toda la cooperativa',
    columnas: tabla.columnas,
    filas: tabla.filas,
    total: tabla.filas.length,
    totales: totalesDe(tabla.columnas, tabla.filas),
    nota: tabla.nota,
    periodo: usaPeriodo ? { anio: s.periodo.anio, mes: s.periodo.mes } : null,
    generadoEl: new Date().toISOString(),
  };
}
