// Datos de prueba de la caja (SPEC sección 9: «12 meses de lecturas, facturas y pagos»).
// - Productos del mostrador (gas envasado y otros conceptos).
// - Los pagos de las facturas del historial que ya figuran pagas: un pago por socio y por mes, con
//   su recibo numerado, repartidos entre los cajeros (cada día de cobro es una caja cerrada con su
//   arqueo) y una parte por el pago online. Así «saldo = total − pagos aplicados» vale desde el día uno.
// Se cargan una sola vez. Todo es inventado.
import { QueryTypes } from 'sequelize';
import type { MedioPago, OrigenPago } from '../shared';
import { sequelize } from '../db';
import { runInCooperativa } from '../lib/context';
import { Cooperativa, Pago, Producto } from '../models';
import { crearAzar } from './cargar-lecturas';

export interface ProductoSeed {
  nombre: string;
  precio: string;
  stock: number | null;
}

export async function cargarProductos(cooperativaId: number, productos: ProductoSeed[]): Promise<number | null> {
  return runInCooperativa(cooperativaId, async () => {
    if (productos.length === 0 || (await Producto.count()) > 0) return null;
    await Producto.bulkCreate(productos);
    return productos.length;
  });
}

const FONDO = '20000.00';
const LOTE = 2000;
const sumarDias = (fecha: string, dias: number) => new Date(Date.parse(`${fecha}T12:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);
const esDomingo = (fecha: string) => new Date(`${fecha}T12:00:00Z`).getUTCDay() === 0;
const dos = (n: number) => String(n).padStart(2, '0');

interface FilaPagada {
  socio_id: number;
  numero: number;
  nombre: string;
  tipo_doc: string;
  nro_doc: string;
  direccion: string | null;
  letra: string;
  emitido_el: string;
  vence_el: string;
  comprobantes: { id: number; total: string }[];
  centavos: string;
}

interface PagoSeed {
  id: number;
  caja_id: number | null;
  cajero_id: number | null;
  socio_id: number;
  letra: string;
  numero: number;
  medio: MedioPago;
  origen: OrigenPago;
  importe: string;
  recibido: string | null;
  vuelto: string | null;
  cobrado_el: string;
  ref_externa: string | null;
  snapshot: unknown;
  comprobantes: { id: number; total: string }[];
}

const deCentavos = (c: number) => `${Math.floor(c / 100)}.${dos(c % 100)}`;

export async function cargarPagos(cooperativaId: number, opciones: { semilla: number }): Promise<{ pagos: number; cajas: number } | null> {
  return runInCooperativa(cooperativaId, async () => {
    if ((await Pago.count()) > 0) return null;
    // Un pago por socio, mes y letra: paga juntas todas sus facturas de ese mes.
    const filas = await sequelize.query<FilaPagada>(
      `SELECT c.socio_id, s.numero, s.nombre, s.tipo_doc, s.nro_doc,
              (SELECT x.direccion FROM conexiones x WHERE x.socio_id = s.id AND x.cooperativa_id = :cooperativaId ORDER BY x.numero LIMIT 1) AS direccion,
              c.letra, to_char(min(c.emitido_el), 'YYYY-MM-DD') AS emitido_el, to_char(min(c.vence_el), 'YYYY-MM-DD') AS vence_el,
              json_agg(json_build_object('id', c.id, 'total', c.total) ORDER BY c.id) AS comprobantes,
              sum(round(c.total * 100)) AS centavos
       FROM comprobantes c JOIN socios s ON s.id = c.socio_id
       WHERE c.cooperativa_id = :cooperativaId AND c.tipo = 'factura' AND c.estado = 'pagado' AND c.total > 0
       GROUP BY c.socio_id, s.id, c.anio, c.mes, c.letra
       ORDER BY c.anio, c.mes, c.socio_id, c.letra`,
      { replacements: { cooperativaId }, type: QueryTypes.SELECT },
    );
    if (filas.length === 0) return null;

    const coop = await Cooperativa.findByPk(cooperativaId);
    const puntoVenta = coop!.configJson.puntoVenta;
    const cajeros = (
      await sequelize.query<{ id: number }>(
        `SELECT u.id FROM usuarios u JOIN roles_usuario r ON r.usuario_id = u.id AND r.rol = 'cajero' WHERE u.cooperativa_id = :cooperativaId ORDER BY u.id`,
        { replacements: { cooperativaId }, type: QueryTypes.SELECT },
      )
    ).map((u) => u.id);

    const azar = crearAzar(opciones.semilla + 505);
    const pagos: Omit<PagoSeed, 'id' | 'numero' | 'caja_id'>[] = filas.map((f) => {
      // Paga entre el día siguiente a la emisión y el vencimiento (por eso no tiene recargo). Los domingos no se atiende.
      const plazo = Math.max(Math.round((Date.parse(f.vence_el) - Date.parse(f.emitido_el)) / 86_400_000), 1);
      const online = cajeros.length === 0 || azar.next() < 0.15;
      let fecha = sumarDias(f.emitido_el, 1 + Math.floor(azar.next() * plazo));
      if (!online && esDomingo(fecha)) fecha = sumarDias(fecha, -1);
      const centavos = Number(f.centavos);
      const importe = deCentavos(centavos);
      const suerte = azar.next();
      const medio: MedioPago = online
        ? suerte < 0.6 ? 'debito' : 'credito'
        : suerte < 0.62 ? 'efectivo' : suerte < 0.76 ? 'debito' : suerte < 0.88 ? 'transferencia' : suerte < 0.96 ? 'qr' : 'credito';
      // En efectivo casi nadie paga justo: redondea para arriba al billete de mil.
      const recibido = medio === 'efectivo' ? deCentavos(azar.next() < 0.25 ? centavos : Math.ceil(centavos / 100_000) * 100_000) : null;
      const hora = online ? 6 + Math.floor(azar.next() * 17) : 7 + Math.floor(azar.next() * 6);
      return {
        cajero_id: online ? null : cajeros[Math.floor(azar.next() * cajeros.length)]!,
        socio_id: f.socio_id,
        letra: f.letra,
        medio,
        origen: online ? 'online' : 'mostrador',
        importe,
        recibido,
        vuelto: recibido === null ? null : deCentavos(Math.round(Number(recibido) * 100) - centavos),
        cobrado_el: `${fecha}T${dos(hora)}:${dos(Math.floor(azar.next() * 60))}:${dos(Math.floor(azar.next() * 60))}-03:00`,
        ref_externa: online ? `MCP-${String(100000 + Math.floor(azar.next() * 900000))}` : null,
        snapshot: { titular: { numero: f.numero, nombre: f.nombre, tipoDoc: f.tipo_doc, nroDoc: f.nro_doc, direccion: f.direccion } },
        comprobantes: f.comprobantes,
      };
    });
    // Los recibos se numeran en el orden en que se cobraron.
    pagos.sort((a, b) => (a.cobrado_el < b.cobrado_el ? -1 : a.cobrado_el > b.cobrado_el ? 1 : a.socio_id - b.socio_id));

    // Cada cajero, cada día que cobró: una caja que abrió a la mañana y cerró con su arqueo.
    const cajas = new Map<string, { cajero_id: number; fecha: string; efectivo: number }>();
    for (const p of pagos) {
      if (p.cajero_id === null) continue;
      const fecha = p.cobrado_el.slice(0, 10);
      const clave = `${p.cajero_id}|${fecha}`;
      const caja = cajas.get(clave) ?? { cajero_id: p.cajero_id, fecha, efectivo: 0 };
      if (p.medio === 'efectivo') caja.efectivo += Math.round(Number(p.importe) * 100);
      cajas.set(clave, caja);
    }
    const listaCajas = [...cajas.entries()].sort(([, a], [, b]) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.cajero_id - b.cajero_id));

    await sequelize.transaction(async (transaction) => {
      const reservar = async (tabla: 'cajas' | 'pagos', n: number) =>
        (
          await sequelize.query<{ id: string }>(`SELECT nextval(pg_get_serial_sequence('${tabla}', 'id')) AS id FROM generate_series(1, CAST($n AS int))`, {
            bind: { n },
            type: QueryTypes.SELECT,
            transaction,
          })
        ).map((r) => Number(r.id));

      const idsCajas = await reservar('cajas', listaCajas.length);
      const cajaDe = new Map(listaCajas.map(([clave], i) => [clave, idsCajas[i]!]));
      if (listaCajas.length) {
        const datos = listaCajas.map(([, c], i) => {
          const esperado = Math.round(Number(FONDO) * 100) + c.efectivo;
          // De vez en cuando el arqueo no cierra justo: sobran o faltan unos pesos.
          const suerte = azar.next();
          const diferencia = suerte < 0.06 ? (Math.floor(azar.next() * 5) + 1) * 10_000 * (azar.next() < 0.6 ? -1 : 1) : 0;
          return {
            id: idsCajas[i]!,
            cajero_id: c.cajero_id,
            abierta_el: `${c.fecha}T06:${dos(45 + Math.floor(azar.next() * 14))}:00-03:00`,
            cerrada_el: `${c.fecha}T13:${dos(5 + Math.floor(azar.next() * 40))}:00-03:00`,
            esperado: deCentavos(esperado),
            contado: deCentavos(esperado + diferencia),
            nota: diferencia === 0 ? null : diferencia < 0 ? 'Faltante: se revisó y no apareció. Queda informado a administración.' : 'Sobrante: probable vuelto mal dado. Queda en caja.',
          };
        });
        await sequelize.query(
          `INSERT INTO cajas (id, cooperativa_id, cajero_id, abierta_el, cerrada_el, fondo_inicial, total_esperado, total_contado, nota, creado_el, actualizado_el)
           SELECT x.id, CAST($cooperativaId AS int), x.cajero_id, CAST(x.abierta_el AS timestamptz), CAST(x.cerrada_el AS timestamptz), CAST($fondo AS numeric), x.esperado, x.contado, x.nota,
                  CAST(x.abierta_el AS timestamptz), CAST(x.cerrada_el AS timestamptz)
           FROM jsonb_to_recordset(CAST($datos AS jsonb)) AS x(id int, cajero_id int, abierta_el text, cerrada_el text, esperado numeric, contado numeric, nota text)`,
          { bind: { cooperativaId, fondo: FONDO, datos: JSON.stringify(datos) }, type: QueryTypes.RAW, transaction },
        );
      }

      const ids = await reservar('pagos', pagos.length);
      const ultimo = new Map<string, number>();
      const completos: PagoSeed[] = pagos.map((p, i) => {
        const numero = (ultimo.get(p.letra) ?? 0) + 1;
        ultimo.set(p.letra, numero);
        return { ...p, id: ids[i]!, numero, caja_id: p.cajero_id === null ? null : cajaDe.get(`${p.cajero_id}|${p.cobrado_el.slice(0, 10)}`)! };
      });

      for (let i = 0; i < completos.length; i += LOTE) {
        const lote = completos.slice(i, i + LOTE);
        await sequelize.query(
          `INSERT INTO pagos (id, cooperativa_id, caja_id, cajero_id, socio_id, letra, punto_venta, numero, medio, origen, estado, importe, recibido, vuelto,
                              cobrado_el, ref_externa, snapshot_json, creado_el, actualizado_el)
           SELECT x.id, CAST($cooperativaId AS int), x.caja_id, x.cajero_id, x.socio_id, x.letra, CAST($puntoVenta AS int), x.numero, x.medio, x.origen, 'acreditado',
                  x.importe, x.recibido, x.vuelto, CAST(x.cobrado_el AS timestamptz), x.ref_externa, x.snapshot, CAST(x.cobrado_el AS timestamptz), CAST(x.cobrado_el AS timestamptz)
           FROM jsonb_to_recordset(CAST($datos AS jsonb)) AS x(
             id int, caja_id int, cajero_id int, socio_id int, letra text, numero int, medio text, origen text, importe numeric, recibido numeric, vuelto numeric,
             cobrado_el text, ref_externa text, snapshot jsonb)`,
          { bind: { cooperativaId, puntoVenta, datos: JSON.stringify(lote.map(({ comprobantes: _c, ...p }) => p)) }, type: QueryTypes.RAW, transaction },
        );
        await sequelize.query(
          `INSERT INTO pago_aplicaciones (cooperativa_id, pago_id, comprobante_id, importe, saldo_despues)
           SELECT CAST($cooperativaId AS int), x.pago_id, x.comprobante_id, x.importe, 0
           FROM jsonb_to_recordset(CAST($datos AS jsonb)) AS x(pago_id int, comprobante_id int, importe numeric)`,
          {
            bind: { cooperativaId, datos: JSON.stringify(lote.flatMap((p) => p.comprobantes.map((c) => ({ pago_id: p.id, comprobante_id: c.id, importe: c.total })))) },
            type: QueryTypes.RAW,
            transaction,
          },
        );
      }

      // La numeración de recibos sigue desde el último del historial.
      for (const [letra, numero] of ultimo) {
        await sequelize.query(
          `INSERT INTO numeradores (cooperativa_id, tipo, letra, punto_venta, ultimo) VALUES (CAST($cooperativaId AS int), 'recibo', $letra, CAST($puntoVenta AS int), CAST($numero AS int))
           ON CONFLICT (cooperativa_id, tipo, letra, punto_venta) DO UPDATE SET ultimo = GREATEST(numeradores.ultimo, EXCLUDED.ultimo), actualizado_el = now()`,
          { bind: { cooperativaId, letra, puntoVenta, numero }, type: QueryTypes.RAW, transaction },
        );
      }
    });

    return { pagos: pagos.length, cajas: listaCajas.length };
  });
}
