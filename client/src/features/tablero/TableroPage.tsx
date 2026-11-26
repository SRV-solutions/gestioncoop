// Tablero de gerencia (SPEC 6.9 y 5): seis indicadores arriba y los gráficos abajo, todo filtrable
// por mes, servicio y zona. Cada número lleva a su detalle y cada gráfico se puede exportar.
// Qué cuenta cada indicador está definido en shared/tablero.ts; acá solo se muestra.
import { useState, type FormEvent, type ReactNode } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowUpRight, Download, LoaderCircle, PencilLine, Radio, RefreshCw } from 'lucide-react';
import {
  formatMoney,
  formatNumber,
  LOCALE,
  leerImporte,
  MEDIO_PAGO_ETIQUETA,
  nombreDeMes,
  SERVICIO_ETIQUETA,
  SERVICIO_RECLAMO_ETIQUETA,
  TIMEZONE,
  TRAMO_ANTIGUEDAD_ETIQUETA,
  type MesBalance,
  type ServicioMedido,
  type Tablero,
} from '@shared';
import { api, ApiError, errorMessage, qs } from '../../lib/api';
import { cn } from '../../lib/cn';
import { descargarCsv } from '../../lib/csv';
import { Modal } from '../../components/Modal';
import { SERVICIO_CORTO } from '../../components/servicios';
import { Button, Card, ErrorState, Field, FormAlert, PageHeader, SelectField, Skeleton } from '../../components/ui';
import { Barras, Columnas, Leyenda, Medidor, type FilaBarra } from './graficos';

const MES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const mayuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const mesLargo = (m: { anio: number; mes: number }) => mayuscula(nombreDeMes(m.anio, m.mes));
const soloMes = (m: { anio: number; mes: number }) => nombreDeMes(m.anio, m.mes).split(' ')[0]!;
const plata = (v: string | number) => formatMoney(v, { cents: false });
const compacto = new Intl.NumberFormat(LOCALE, { notation: 'compact', maximumFractionDigits: 1 });
const hora = new Intl.DateTimeFormat(LOCALE, { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const porciento = (v: number) => `${new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 }).format(v)} %`;
const SERIE_1 = 'var(--serie-1)';
const SERIE_2 = 'var(--serie-2)';

/** «+1,4 % contra septiembre»; `null` si no hay contra qué comparar. */
function variacion(actual: number, anterior: number, contra: string): string | null {
  // Un mes sin nada todavía (no se facturó) no «bajó 100 %»: no hay qué comparar.
  if (anterior <= 0 || actual <= 0) return null;
  const v = ((actual - anterior) / anterior) * 100;
  if (Math.abs(v) < 0.05) return `Igual que en ${contra}`;
  return `${v > 0 ? '+' : '−'}${new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 }).format(Math.abs(v))} % contra ${contra}`;
}

/** Horas en palabras: «6 h», «1 día y medio», «4 días». */
function duracion(horas: number): string {
  if (horas < 1) return 'menos de 1 h';
  if (horas < 36) return `${formatNumber(Math.round(horas))} h`;
  const dias = horas / 24;
  return `${new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 }).format(dias)} días`;
}

export function TableroPage() {
  const [params, setParams] = useSearchParams();
  const filtros = { anio: params.get('anio'), mes: params.get('mes'), servicio: params.get('servicio'), zona: params.get('zona') };
  const consulta = useQuery({
    queryKey: ['tablero', filtros.anio, filtros.mes, filtros.servicio, filtros.zona],
    queryFn: () => api.get<Tablero>(`/tablero${qs(filtros)}`),
    placeholderData: keepPreviousData,
    // «En vivo»: lo que cobra la caja o carga un operario aparece solo, sin recargar la página.
    refetchInterval: 20_000,
  });
  const d = consulta.data;
  const cambiar = (clave: string, valor: string) => {
    const p = new URLSearchParams(params);
    if (clave === 'periodo') {
      const [anio, mes] = valor.split('-');
      p.set('anio', anio!);
      p.set('mes', mes!);
    } else if (valor) p.set(clave, valor);
    else p.delete(clave);
    setParams(p, { replace: true });
  };

  if (consulta.isPending) {
    return (
      <>
        <PageHeader title="Tablero" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-32 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="mt-4 h-80 rounded-2xl" />
      </>
    );
  }
  if (!d) {
    // Un filtro que ya no vale (una zona que se borró) deja volver al tablero sin filtros.
    const filtroMalo = consulta.error instanceof ApiError && consulta.error.status === 400;
    return (
      <>
        <PageHeader title="Tablero" />
        <Card>
          <ErrorState message={filtroMalo ? 'Ese filtro ya no existe. Volvé a elegir.' : errorMessage(consulta.error)} onRetry={() => (filtroMalo ? setParams({}, { replace: true }) : void consulta.refetch())} />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Tablero" description={`${mesLargo(d.periodo)}${d.filtros.servicio ? ` · ${SERVICIO_ETIQUETA[d.filtros.servicio]}` : ''}${d.filtros.zona ? ` · ${d.filtros.zona.nombre}` : ''}`} />

      {/* Filtros: una sola fila, arriba de todo lo que filtran. */}
      <div data-tour="filtros" className="mb-5 grid items-end gap-3 max-sm:grid-cols-2 max-sm:[&>*:first-child]:col-span-2 max-sm:[&>*:last-child]:col-span-2 sm:grid-cols-3 lg:grid-cols-[minmax(0,17rem)_repeat(2,minmax(0,13rem))_1fr]">
        <SelectField label="Mes" value={`${d.periodo.anio}-${d.periodo.mes}`} onChange={(e) => cambiar('periodo', e.target.value)}>
          {d.periodos.map((p) => (
            <option key={`${p.anio}-${p.mes}`} value={`${p.anio}-${p.mes}`}>
              {mesLargo(p)}
              {p.estado === 'en_lectura' ? ' (en lectura)' : p.estado === 'sin_emitir' ? ' (sin facturar)' : ''}
            </option>
          ))}
        </SelectField>
        <SelectField label="Servicio" value={d.filtros.servicio ?? ''} onChange={(e) => cambiar('servicio', e.target.value)}>
          <option value="">Todos</option>
          {d.servicios.map((s) => (
            <option key={s} value={s}>
              {SERVICIO_ETIQUETA[s]}
            </option>
          ))}
        </SelectField>
        <SelectField label="Zona" value={d.filtros.zona?.id ?? ''} onChange={(e) => cambiar('zona', e.target.value)}>
          <option value="">Todas</option>
          {d.zonas.map((z) => (
            <option key={z.id} value={z.id}>
              {z.nombre}
            </option>
          ))}
        </SelectField>
        <p className="flex min-h-12 items-center gap-2 text-sm text-tinta-suave max-sm:min-h-0 sm:col-span-3 lg:col-span-1 lg:justify-end" aria-live="off">
          {consulta.isFetching ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <RefreshCw className="size-4" aria-hidden />}
          {consulta.isError ? 'Sin conexión: se muestra lo último que llegó' : `Actualizado a las ${hora.format(new Date(d.generadoEl))}`}
        </p>
      </div>

      {d.periodo.estado !== 'emitido' && (
        <p className="mb-5 rounded-2xl bg-acento-tenue px-4 py-3 text-sm font-medium text-tinta">
          {mesLargo(d.periodo)} todavía no se facturó: lo facturado, lo cobrado y el consumo van en cero. La deuda, los reclamos, las lecturas y la recaudación sí son de hoy.
        </p>
      )}

      <Indicadores d={d} />

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <FacturadoCobrado d={d} />
        <Antiguedad d={d} />
        <Escalones d={d} />
        <Recaudacion d={d} />
        <ConsumoPorZona d={d} />
        <Lecturas d={d} />
        <Reclamos d={d} />
        <Balance d={d} />
      </div>
    </>
  );
}

/* ───────────────────────── Enlaces al detalle ───────────────────────── */

/** Dirección de un informe con los mismos filtros que tiene puestos el tablero. */
function aInforme(d: Tablero, clave: string, conMes = true): string {
  return `/informes/${clave}${qs({ anio: conMes ? d.periodo.anio : null, mes: conMes ? d.periodo.mes : null, servicio: d.filtros.servicio, zona: d.filtros.zona?.id })}`;
}

/* ───────────────────────── Indicadores ───────────────────────── */

function Indicador({ titulo, to, detalle, children }: { titulo: string; to: string; detalle: ReactNode; children: ReactNode }) {
  return (
    <Link to={to} className="group flex flex-col rounded-2xl border border-linea bg-superficie p-5 transition-colors duration-150 hover:border-marca">
      <span className="flex items-center justify-between gap-2 text-sm font-semibold text-tinta-suave">
        {titulo}
        <ArrowUpRight className="size-4 shrink-0 transition-colors duration-150 group-hover:text-marca-texto" aria-hidden />
      </span>
      <span className="mt-2 block text-[1.75rem] font-black leading-tight tracking-tight text-tinta">{children}</span>
      <span className="mt-1.5 block text-sm text-tinta-suave">{detalle}</span>
      <span className="sr-only">Ver el detalle</span>
    </Link>
  );
}

function Indicadores({ d }: { d: Tablero }) {
  const i = d.indicadores;
  const anterior = d.porMes.at(-2);
  const contra = anterior ? soloMes(anterior) : '';
  const cobrabilidadAnterior = anterior && Number(anterior.facturado) > 0 ? (Number(anterior.cobrado) / Number(anterior.facturado)) * 100 : null;
  const faltaCobrar = Number(i.facturado) - Number(i.cobrado);
  const mes = soloMes(d.periodo);
  const medidos: { servicio: ServicioMedido; valor: string | null; unidad: string }[] = [
    { servicio: 'energia', valor: i.consumo.energia, unidad: 'kWh' },
    { servicio: 'agua', valor: i.consumo.agua, unidad: 'm³' },
  ];
  const consumos = medidos.filter((m) => m.valor !== null);
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <Indicador
        titulo={`Facturado en ${mes}`}
        to={aInforme(d, 'libro-ventas')}
        detalle={
          i.facturas === 0 ? (
            'Todavía no hay facturas de este mes'
          ) : (
          <>
            {formatNumber(i.facturas)} {i.facturas === 1 ? 'factura' : 'facturas'}
            {anterior && variacion(Number(i.facturado), Number(anterior.facturado), contra) && ` · ${variacion(Number(i.facturado), Number(anterior.facturado), contra)}`}
          </>
          )
        }
      >
        {plata(i.facturado)}
      </Indicador>
      <Indicador titulo="Cobrado de esas facturas" to={aInforme(d, 'recaudacion')} detalle={faltaCobrar > 0 ? `Falta cobrar ${plata(faltaCobrar)}` : Number(i.facturado) > 0 ? 'Está todo cobrado' : 'Sin facturas en el mes'}>
        {plata(i.cobrado)}
      </Indicador>
      <Indicador
        titulo="Cobrabilidad"
        to={aInforme(d, 'deuda', false)}
        detalle={
          <>
            <Medidor valor={i.cobrabilidad ?? 0} total={100} className="mb-2 mt-1" />
            {cobrabilidadAnterior !== null ? `En ${contra}: ${porciento(cobrabilidadAnterior)}` : 'De cada $ 100 facturados, cuánto ya se cobró'}
          </>
        }
      >
        {i.cobrabilidad === null ? '—' : porciento(i.cobrabilidad)}
      </Indicador>
      <Indicador
        titulo="Deuda total, a hoy"
        to={aInforme(d, 'deuda', false)}
        detalle={
          i.sociosConDeuda === 0
            ? 'Nadie debe nada'
            : `${formatNumber(i.morosos)} ${i.morosos === 1 ? 'socio' : 'socios'} en mora · ${i.deudaVencida === i.deuda ? 'toda vencida' : `${plata(i.deudaVencida)} ya vencido`}`
        }
      >
        {plata(i.deuda)}
      </Indicador>
      <Indicador
        titulo={`Consumo de ${mes}`}
        to={aInforme(d, 'consumos-zona')}
        detalle={
          consumos.length === 0
            ? 'Este servicio no se mide'
            : (anterior && i.consumo.energia !== null && variacion(Number(i.consumo.energia), Number(anterior.energia), contra) && `Energía: ${variacion(Number(i.consumo.energia), Number(anterior.energia), contra)}`) ||
              (anterior && i.consumo.agua !== null && variacion(Number(i.consumo.agua), Number(anterior.agua), contra) && `Agua: ${variacion(Number(i.consumo.agua), Number(anterior.agua), contra)}`) ||
              'Lo que se facturó en el mes'
        }
      >
        {consumos.length === 0 ? (
          '—'
        ) : (
          <span className={cn('flex flex-col', consumos.length > 1 && 'text-[1.375rem] leading-snug')}>
            {consumos.map((c) => (
              <span key={c.servicio}>
                {formatNumber(Math.round(Number(c.valor)))} <span className="text-base font-bold text-tinta-suave">{c.unidad}</span>
              </span>
            ))}
          </span>
        )}
      </Indicador>
      <Indicador
        titulo="Reclamos abiertos"
        to="/reclamos"
        detalle={i.reclamosAbiertos === 0 ? 'No hay ninguno sin resolver' : i.reclamosUrgentes > 0 ? `${formatNumber(i.reclamosUrgentes)} ${i.reclamosUrgentes === 1 ? 'urgente' : 'urgentes'}` : 'Ninguno urgente'}
      >
        {formatNumber(i.reclamosAbiertos)}
      </Indicador>
    </div>
  );
}

/* ───────────────────────── Tarjeta de un gráfico ───────────────────────── */

interface TarjetaProps {
  titulo: string;
  descripcion?: ReactNode;
  /** Baja los datos del gráfico en CSV. */
  exportar?: () => void;
  /** Informe o pantalla donde está el detalle. */
  detalle?: { to: string; texto: string };
  ancha?: boolean;
  acciones?: ReactNode;
  children: ReactNode;
}

function Tarjeta({ titulo, descripcion, exportar, detalle, ancha, acciones, children }: TarjetaProps) {
  return (
    <Card className={cn('flex min-w-0 flex-col p-5', ancha && 'lg:col-span-2')}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-bold text-tinta">{titulo}</h2>
          {descripcion && <p className="mt-0.5 text-sm text-tinta-suave">{descripcion}</p>}
        </div>
        <div className="-mr-2 -mt-2 flex shrink-0 items-center">
          {acciones}
          {exportar && (
            <button type="button" onClick={exportar} title="Exportar estos datos (CSV)" aria-label={`Exportar «${titulo}» en CSV`} className="grid size-11 place-items-center rounded-xl text-tinta-suave transition-colors duration-150 hover:bg-marca-tenue hover:text-marca-texto">
              <Download className="size-5" aria-hidden />
            </button>
          )}
        </div>
      </div>
      <div className="min-w-0 flex-1">{children}</div>
      {detalle && (
        <Link to={detalle.to} className="mt-3 inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-semibold text-marca-texto hover:underline">
          {detalle.texto}
          <ArrowUpRight className="size-4" aria-hidden />
        </Link>
      )}
    </Card>
  );
}

/** La misma serie en tabla, para quien prefiere los números o no distingue los colores. */
function Tabla({ encabezados, filas }: { encabezados: string[]; filas: (string | number)[][] }) {
  return (
    <details className="mt-2">
      <summary className="min-h-11 cursor-pointer py-2.5 text-sm font-semibold text-marca-texto">Ver como tabla</summary>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-tinta-suave">
              {encabezados.map((e, i) => (
                <th key={e} className={cn('whitespace-nowrap py-1 font-semibold', i === 0 ? 'text-left' : 'pl-4 text-right')}>
                  {e}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {filas.map((f) => (
              <tr key={String(f[0])} className="border-t border-linea">
                {f.map((c, i) => (
                  <td key={i} className={cn('whitespace-nowrap py-1.5', i === 0 ? 'text-left' : 'pl-4 text-right')}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/** Pestañas para elegir entre energía y agua dentro de una tarjeta. */
function Pestanas<T extends string>({ opciones, valor, onChange, nombre }: { opciones: { valor: T; texto: string }[]; valor: T; onChange: (v: T) => void; nombre: string }) {
  if (opciones.length < 2) return null;
  return (
    <div role="tablist" aria-label={nombre} className="mb-2 inline-flex rounded-xl border border-linea p-0.5">
      {opciones.map((o) => (
        <button
          key={o.valor}
          type="button"
          role="tab"
          aria-selected={valor === o.valor}
          onClick={() => onChange(o.valor)}
          className={cn('min-h-11 rounded-[0.625rem] px-3.5 text-sm font-semibold transition-colors duration-150', valor === o.valor ? 'bg-marca text-white' : 'text-tinta-suave hover:text-tinta')}
        >
          {o.texto}
        </button>
      ))}
    </div>
  );
}

const archivo = (d: Tablero, nombre: string) => `${nombre}-${d.periodo.anio}-${String(d.periodo.mes).padStart(2, '0')}`;

/* ───────────────────────── Facturado y cobrado ───────────────────────── */

function FacturadoCobrado({ d }: { d: Tablero }) {
  const meses = d.porMes;
  const cobrabilidad = (i: number) => (Number(meses[i]!.facturado) > 0 ? (Number(meses[i]!.cobrado) / Number(meses[i]!.facturado)) * 100 : null);
  return (
    <Tarjeta
      ancha
      titulo="Facturado y cobrado, mes a mes"
      descripcion="De lo facturado cada mes, cuánto ya se cobró. Los meses más nuevos tienen más por cobrar."
      exportar={() =>
        descargarCsv(
          archivo(d, 'facturado-y-cobrado'),
          ['Mes', 'Facturado', 'Cobrado', 'Cobrabilidad (%)'],
          meses.map((m, i) => [mesLargo(m), Number(m.facturado), Number(m.cobrado), cobrabilidad(i) === null ? null : Math.round(cobrabilidad(i)! * 10) / 10]),
        )
      }
      detalle={{ to: aInforme(d, 'libro-ventas'), texto: `Ver el libro de ventas de ${soloMes(d.periodo)}` }}
    >
      <Leyenda
        items={[
          { nombre: 'Facturado', color: SERIE_1 },
          { nombre: 'Cobrado de esas facturas', color: SERIE_2 },
        ]}
      />
      <div className="mt-2">
        <Columnas
          titulo="Facturado y cobrado de los últimos 12 meses"
          etiquetas={meses.map((m, i) => `${MES_CORTO[m.mes - 1]}${m.mes === 1 || i === 0 ? ` ${String(m.anio).slice(2)}` : ''}`)}
          nombres={meses.map(mesLargo)}
          series={[
            { nombre: 'Facturado', color: SERIE_1, valores: meses.map((m) => Number(m.facturado)) },
            { nombre: 'Cobrado', color: SERIE_2, valores: meses.map((m) => Number(m.cobrado)) },
          ]}
          formato={plata}
          eje={(v) => (v === 0 ? '0' : `$ ${compacto.format(v)}`)}
          elegida={meses.length - 1}
          extra={(i) => cobrabilidad(i) !== null && <p className="mt-1 border-t border-linea pt-1 text-tinta-suave">Cobrabilidad: {porciento(Math.round(cobrabilidad(i)! * 10) / 10)}</p>}
        />
      </div>
      <Tabla
        encabezados={['Mes', 'Facturado', 'Cobrado', 'Cobrabilidad']}
        filas={[...meses].reverse().map((m) => [mesLargo(m), plata(m.facturado), plata(m.cobrado), Number(m.facturado) > 0 ? porciento(Math.round((Number(m.cobrado) / Number(m.facturado)) * 1000) / 10) : '—'])}
      />
    </Tarjeta>
  );
}

/* ───────────────────────── Deuda por antigüedad ───────────────────────── */

function Antiguedad({ d }: { d: Tablero }) {
  const filas: FilaBarra[] = d.antiguedad.map((t) => ({
    clave: t.tramo,
    etiqueta: TRAMO_ANTIGUEDAD_ETIQUETA[t.tramo],
    valor: Number(t.importe),
    texto: plata(t.importe),
    nota: `${formatNumber(t.facturas)} fact.`,
  }));
  return (
    <Tarjeta
      titulo="Deuda por antigüedad"
      descripcion="Cuánto hace que venció lo que se debe hoy."
      exportar={() =>
        descargarCsv(
          'deuda-por-antiguedad',
          ['Vencida hace', 'Importe', 'Facturas', 'Socios'],
          d.antiguedad.map((t) => [TRAMO_ANTIGUEDAD_ETIQUETA[t.tramo], Number(t.importe), t.facturas, t.socios]),
        )
      }
      detalle={{ to: aInforme(d, 'deuda', false), texto: 'Ver quién debe' }}
    >
      {Number(d.indicadores.deuda) === 0 ? <p className="py-8 text-center text-tinta-suave">No hay deuda: está todo pago.</p> : <Barras filas={filas} />}
    </Tarjeta>
  );
}

/* ───────────────────────── Recaudación ───────────────────────── */

function Recaudacion({ d }: { d: Tablero }) {
  const r = d.recaudacion;
  return (
    <Tarjeta
      titulo={`Recaudación de ${soloMes(d.periodo)}`}
      descripcion={r.soloFacturas ? 'Lo que entró en el mes para facturas de este filtro, sin ventas de mostrador.' : 'Lo que entró en el mes, por fecha de cobro: facturas de cualquier mes y ventas de mostrador.'}
      exportar={() =>
        descargarCsv(archivo(d, 'recaudacion'), ['Grupo', 'Nombre', 'Cobros', 'Importe'], [
          ...r.porMedio.map((m) => ['Medio de pago', MEDIO_PAGO_ETIQUETA[m.medio], m.cobros, Number(m.total)]),
          ...r.porCajero.map((c) => ['Cajero', c.nombre, c.cobros, Number(c.total)]),
        ])
      }
      detalle={{ to: `/informes/recaudacion${qs({ anio: d.periodo.anio, mes: d.periodo.mes })}`, texto: 'Ver día por día' }}
    >
      <p className="text-2xl font-black tracking-tight text-tinta">
        {plata(r.total)} <span className="text-sm font-semibold text-tinta-suave">en {formatNumber(r.cobros)} {r.cobros === 1 ? 'cobro' : 'cobros'}</span>
      </p>
      {r.cobros === 0 ? (
        <p className="py-6 text-center text-sm text-tinta-suave">Todavía no entró ningún cobro en {soloMes(d.periodo)}.</p>
      ) : (
        <>
          <h3 className="mt-4 text-xs font-bold uppercase tracking-wide text-tinta-suave">Por medio de pago</h3>
          <Barras filas={r.porMedio.map((m) => ({ clave: m.medio, etiqueta: MEDIO_PAGO_ETIQUETA[m.medio], valor: Number(m.total), texto: plata(m.total), nota: `${formatNumber(m.cobros)}` }))} />
          <h3 className="mt-4 text-xs font-bold uppercase tracking-wide text-tinta-suave">Por cajero</h3>
          <Barras filas={r.porCajero.map((c) => ({ clave: String(c.cajeroId), etiqueta: c.nombre, valor: Number(c.total), texto: plata(c.total), nota: `${formatNumber(c.cobros)}` }))} />
          <p className="mt-2 text-xs text-tinta-suave">El número chico es la cantidad de cobros.</p>
        </>
      )}
    </Tarjeta>
  );
}

/* ───────────────────────── Consumo ───────────────────────── */

const UNIDAD: Record<ServicioMedido, string> = { energia: 'kWh', agua: 'm³' };

function useServicioMedido(disponibles: ServicioMedido[]) {
  const [elegido, setElegido] = useState<ServicioMedido>('energia');
  const servicio = disponibles.includes(elegido) ? elegido : (disponibles[0] ?? 'energia');
  const pestanas = <Pestanas nombre="Servicio" valor={servicio} onChange={setElegido} opciones={disponibles.map((s) => ({ valor: s, texto: SERVICIO_CORTO[s] }))} />;
  return [servicio, pestanas] as const;
}

function ConsumoPorZona({ d }: { d: Tablero }) {
  const disponibles = (['energia', 'agua'] as const).filter((s) => d.indicadores.consumo[s] !== null);
  const [servicio, pestanas] = useServicioMedido([...disponibles]);
  const conexiones = (z: Tablero['consumoPorZona'][number]) => (servicio === 'energia' ? z.conexionesEnergia : z.conexionesAgua);
  const filas: FilaBarra[] = d.consumoPorZona
    .filter((z) => conexiones(z) > 0)
    .map((z) => ({ clave: String(z.zona?.id ?? 0), etiqueta: z.zona?.nombre ?? 'Sin zona', valor: Number(z[servicio]), texto: `${formatNumber(Math.round(Number(z[servicio])))} ${UNIDAD[servicio]}`, nota: `${formatNumber(conexiones(z))} con.` }))
    .sort((a, b) => b.valor - a.valor);
  return (
    <Tarjeta
      titulo={`Consumo por zona en ${soloMes(d.periodo)}`}
      descripcion="Lo facturado en cada barrio o paraje, y cuántas conexiones tiene."
      exportar={() =>
        descargarCsv(
          archivo(d, 'consumo-por-zona'),
          ['Zona', 'Energía (kWh)', 'Conexiones de energía', 'Agua (m³)', 'Conexiones de agua'],
          d.consumoPorZona.map((z) => [z.zona?.nombre ?? 'Sin zona', Number(z.energia), z.conexionesEnergia, Number(z.agua), z.conexionesAgua]),
        )
      }
      detalle={{ to: aInforme(d, 'consumos-zona'), texto: 'Ver el informe de consumos' }}
    >
      {disponibles.length === 0 ? (
        <p className="py-8 text-center text-tinta-suave">{SERVICIO_ETIQUETA[d.filtros.servicio!]} no se mide: no hay consumo que mostrar.</p>
      ) : (
        <>
          {pestanas}
          <Barras filas={filas} vacio={`No hay consumo facturado en ${soloMes(d.periodo)}.`} />
        </>
      )}
    </Tarjeta>
  );
}

function Escalones({ d }: { d: Tablero }) {
  const disponibles = d.escalones.map((e) => e.servicio);
  const [servicio, pestanas] = useServicioMedido(disponibles);
  const e = d.escalones.find((x) => x.servicio === servicio);
  const total = e?.bandas.reduce((t, b) => t + b.conexiones, 0) ?? 0;
  const nombre = (b: { desde: number; hasta: number | null }, unidad: string) =>
    b.hasta === null ? `Más de ${formatNumber(b.desde)} ${unidad}` : b.desde === 0 ? `Hasta ${formatNumber(b.hasta)} ${unidad}` : `${formatNumber(b.desde + 1)} a ${formatNumber(b.hasta)} ${unidad}`;
  return (
    <Tarjeta
      titulo="Conexiones por escalón de consumo"
      descripcion="Cuántas cayeron en cada escalón de la tarifa residencial."
      exportar={() =>
        descargarCsv(
          archivo(d, 'conexiones-por-escalon'),
          ['Servicio', 'Escalón', 'Conexiones', 'Consumo'],
          d.escalones.flatMap((x) => x.bandas.map((b) => [SERVICIO_CORTO[x.servicio], nombre(b, x.unidad), b.conexiones, Number(b.consumo)])),
        )
      }
    >
      {!e ? (
        <p className="py-8 text-center text-tinta-suave">Este servicio no tiene escalones de consumo.</p>
      ) : (
        <>
          {pestanas}
          <Barras
            vacio={`No hay consumo facturado en ${soloMes(d.periodo)}.`}
            filas={
              total === 0
                ? []
                : e.bandas.map((b) => ({ clave: String(b.desde), etiqueta: nombre(b, e.unidad), valor: b.conexiones, texto: formatNumber(b.conexiones), nota: porciento(Math.round((b.conexiones / total) * 1000) / 10) }))
            }
          />
        </>
      )}
    </Tarjeta>
  );
}

/* ───────────────────────── Lecturas en vivo ───────────────────────── */

function Lecturas({ d }: { d: Tablero }) {
  const l = d.lecturas;
  const avance = l.total > 0 ? Math.round((l.leidos / l.total) * 100) : 0;
  return (
    <Tarjeta
      titulo={l.periodo ? `Lecturas de ${soloMes(l.periodo)}` : 'Lecturas'}
      descripcion="Los medidores que ya cargó la cuadrilla. Se actualiza solo."
      acciones={
        l.periodo && (
          <span className="mr-1 inline-flex items-center gap-1.5 rounded-full bg-marca-tenue px-2.5 py-1 text-xs font-bold text-marca-texto">
            <Radio className="size-3.5" aria-hidden />
            En vivo
          </span>
        )
      }
      exportar={l.total > 0 ? () => descargarCsv('avance-de-lecturas', ['Ruta', 'Zona', 'Medidores', 'Leídos'], l.rutas.map((r) => [r.nombre, r.zona, r.medidores, r.leidos])) : undefined}
      detalle={{ to: '/lecturas', texto: 'Ir a Lecturas' }}
    >
      {!l.periodo ? (
        <p className="py-8 text-center text-tinta-suave">No hay ningún mes en lectura en este momento.</p>
      ) : l.total === 0 ? (
        <p className="py-8 text-center text-tinta-suave">Con este filtro no hay medidores para leer.</p>
      ) : (
        <>
          <p className="text-2xl font-black tracking-tight text-tinta">
            {avance} % <span className="text-sm font-semibold text-tinta-suave">· {formatNumber(l.leidos)} de {formatNumber(l.total)} medidores</span>
          </p>
          <Medidor valor={l.leidos} total={l.total} className="mb-3 mt-2 h-3" />
          <ul className="divide-y divide-linea/70">
            {l.rutas.map((r) => (
              <li key={r.id} className="grid grid-cols-[minmax(0,1fr)_5.5rem_auto] items-center gap-3 py-2">
                <span className="truncate text-sm font-medium text-tinta" title={r.nombre}>
                  {r.nombre}
                </span>
                <Medidor valor={r.leidos} total={r.medidores} />
                <span className="w-20 whitespace-nowrap text-right text-sm tabular-nums text-tinta">
                  {formatNumber(r.leidos)}/{formatNumber(r.medidores)}
                </span>
              </li>
            ))}
          </ul>
          {l.estimados > 0 && <p className="mt-2 text-xs text-tinta-suave">{formatNumber(l.estimados)} de las cargadas son estimadas.</p>}
        </>
      )}
    </Tarjeta>
  );
}

/* ───────────────────────── Reclamos ───────────────────────── */

function Reclamos({ d }: { d: Tablero }) {
  const r = d.reclamos;
  return (
    <Tarjeta
      titulo={`Reclamos que entraron en ${soloMes(d.periodo)}`}
      descripcion={
        r.total === 0
          ? undefined
          : `${formatNumber(r.total)} ${r.total === 1 ? 'reclamo' : 'reclamos'}${r.horasResolucion !== null ? ` · se resuelven en ${duracion(r.horasResolucion)} en promedio` : ''}`
      }
      exportar={
        r.total > 0
          ? () =>
              descargarCsv(
                archivo(d, 'reclamos-por-tipo'),
                ['Servicio', 'Tipo', 'Reclamos', 'Sin resolver', 'Horas hasta resolver (promedio)'],
                r.porTipo.map((t) => [SERVICIO_RECLAMO_ETIQUETA[t.servicio], t.nombre, t.cantidad, t.abiertos, t.horasResolucion]),
              )
          : undefined
      }
      detalle={{ to: '/reclamos', texto: 'Ir a Reclamos' }}
    >
      <Barras
        nombresLargos
        vacio={`No entró ningún reclamo en ${soloMes(d.periodo)}.`}
        filas={r.porTipo.map((t) => ({
          clave: `${t.servicio}-${t.tipo}`,
          etiqueta: t.nombre,
          valor: t.cantidad,
          texto: formatNumber(t.cantidad),
          nota: t.horasResolucion !== null ? duracion(t.horasResolucion) : 'sin resolver',
        }))}
      />
      {r.total > 0 && <p className="mt-2 text-xs text-tinta-suave">Al lado de cada cantidad, cuánto se tarda en resolverlos.</p>}
    </Tarjeta>
  );
}

/* ───────────────────────── Balance de energía ───────────────────────── */

const kwh = (v: string | number) => `${formatNumber(Math.round(Number(v)))} kWh`;

function Balance({ d }: { d: Tablero }) {
  const [cargando, setCargando] = useState(false);
  const meses = d.balance;
  const mes = meses.at(-1)!;
  const origen = d.energia;
  const datos: { nombre: string; valor: string }[] = mes.comprada === null
    ? []
    : [
        { nombre: `Comprada a ${origen.mayorista}`, valor: kwh(mes.comprada) },
        ...(origen.generacion ? [{ nombre: `Generada en ${origen.generacion}`, valor: kwh(mes.generada ?? 0) }] : []),
        { nombre: 'Facturada a los socios', valor: kwh(mes.facturada) },
        { nombre: 'Pérdidas', valor: mes.perdidas === null ? 'Cuando se facture el mes' : `${kwh(mes.perdidas)}${mes.porcentaje !== null ? ` (${porciento(mes.porcentaje)})` : ''}` },
      ];
  return (
    <Tarjeta
      ancha
      titulo="Balance de energía"
      descripcion={`La energía que entró a la red contra la que se facturó. La diferencia son las pérdidas: técnicas, medidores que fallan y conexiones irregulares.${d.filtros.servicio || d.filtros.zona ? ' Es de toda la cooperativa: no depende de los filtros.' : ''}`}
      exportar={() =>
        descargarCsv(
          archivo(d, 'balance-de-energia'),
          ['Mes', `Comprada a ${origen.mayorista} (kWh)`, 'Generada (kWh)', 'Facturada (kWh)', 'Pérdidas (kWh)', 'Pérdidas (%)'],
          meses.map((m) => [mesLargo(m), m.comprada === null ? null : Number(m.comprada), m.generada === null ? null : Number(m.generada), Number(m.facturada), m.perdidas === null ? null : Number(m.perdidas), m.porcentaje]),
        )
      }
      acciones={
        d.puedeCargarBalance && (
          <Button variant="ghost" icon={PencilLine} onClick={() => setCargando(true)} className="mr-1">
            {mes.comprada === null ? 'Cargar' : 'Corregir'}
          </Button>
        )
      }
    >
      {mes.comprada === null ? (
        <p className="mb-3 rounded-xl bg-acento-tenue px-4 py-3 text-sm font-medium text-tinta">
          Falta cargar cuánta energía entró a la red en {soloMes(mes)}.{d.puedeCargarBalance ? '' : ' La carga administración.'}
        </p>
      ) : (
        <dl className="mb-3 grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
          {datos.map((x) => (
            <div key={x.nombre}>
              <dt className="text-sm text-tinta-suave">{x.nombre}</dt>
              <dd className="text-lg font-black tracking-tight text-tinta">{x.valor}</dd>
            </div>
          ))}
        </dl>
      )}
      <Leyenda
        items={[
          { nombre: 'Facturada', color: SERIE_1 },
          { nombre: 'Pérdidas', color: SERIE_2 },
        ]}
      />
      <div className="mt-2">
        <Columnas
          apiladas
          titulo="Energía facturada y pérdidas de los últimos 12 meses, en kWh"
          etiquetas={meses.map((m, i) => `${MES_CORTO[m.mes - 1]}${m.mes === 1 || i === 0 ? ` ${String(m.anio).slice(2)}` : ''}`)}
          nombres={meses.map(mesLargo)}
          series={[
            { nombre: 'Facturada', color: SERIE_1, valores: meses.map((m) => Number(m.facturada)) },
            { nombre: 'Pérdidas', color: SERIE_2, valores: meses.map((m) => (m.perdidas === null ? null : Number(m.perdidas))) },
          ]}
          formato={kwh}
          eje={(v) => (v === 0 ? '0' : compacto.format(v))}
          elegida={meses.length - 1}
          extra={(i) => meses[i]!.porcentaje !== null && <p className="mt-1 border-t border-linea pt-1 text-tinta-suave">Pérdidas: {porciento(meses[i]!.porcentaje!)} de lo que entró</p>}
        />
      </div>
      <Tabla
        encabezados={['Mes', 'Entró a la red', 'Facturada', 'Pérdidas', '%']}
        filas={[...meses].reverse().map((m) => [
          mesLargo(m),
          m.comprada === null ? 'Sin cargar' : kwh(Number(m.comprada) + Number(m.generada ?? 0)),
          kwh(m.facturada),
          m.perdidas === null ? '—' : kwh(m.perdidas),
          m.porcentaje === null ? '—' : porciento(m.porcentaje),
        ])}
      />
      {mes.nota && <p className="mt-2 text-xs text-tinta-suave">{mes.nota}.</p>}
      {cargando && <CargarBalance d={d} mes={mes} onClose={() => setCargando(false)} />}
    </Tarjeta>
  );
}

/** «665784» o «665.784» → `"665784.00"`; `null` si no es un número. */
const leerKwh = (texto: string) => leerImporte(texto.replace(/kwh/i, ''));

function CargarBalance({ d, mes, onClose }: { d: Tablero; mes: MesBalance; onClose: () => void }) {
  const cliente = useQueryClient();
  const sinDecimales = (v: string | null) => (v === null ? '' : formatNumber(Math.round(Number(v))));
  const [comprada, setComprada] = useState(sinDecimales(mes.comprada));
  const [generada, setGenerada] = useState(sinDecimales(mes.generada));
  const [intento, setIntento] = useState(false);
  const leidaComprada = leerKwh(comprada);
  const leidaGenerada = d.energia.generacion ? (generada.trim() ? leerKwh(generada) : '0.00') : '0.00';
  const guardar = useMutation({
    mutationFn: () => api.put('/tablero/balance', { anio: mes.anio, mes: mes.mes, compradaKwh: leidaComprada, generadaKwh: leidaGenerada }),
    onSuccess: async () => {
      await cliente.invalidateQueries({ queryKey: ['tablero'] });
      onClose();
    },
  });
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    setIntento(true);
    if (leidaComprada && leidaGenerada) guardar.mutate();
  };
  const entrada = leidaComprada && leidaGenerada ? Number(leidaComprada) + Number(leidaGenerada) : null;
  return (
    <Modal
      title={`Energía de ${nombreDeMes(mes.anio, mes.mes)}`}
      description="Cuánta energía entró a la red ese mes. Sale de la factura del mayorista y del registro de la usina."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="balance" loading={guardar.isPending}>
            Guardar
          </Button>
        </>
      }
    >
      <form id="balance" onSubmit={enviar} className="space-y-4" noValidate>
        {guardar.isError && <FormAlert>{errorMessage(guardar.error)}</FormAlert>}
        <Field label={`Comprada a ${d.energia.mayorista} (kWh)`} inputMode="decimal" autoFocus value={comprada} onChange={(e) => setComprada(e.target.value)} error={intento && !leidaComprada ? 'Escribí los kWh comprados' : undefined} />
        {d.energia.generacion && (
          <Field label={`Generada en ${d.energia.generacion} (kWh)`} inputMode="decimal" value={generada} onChange={(e) => setGenerada(e.target.value)} hint="Si ese mes no generó, dejalo vacío." error={intento && !leidaGenerada ? 'Escribí los kWh generados' : undefined} />
        )}
        {entrada !== null && Number(mes.facturada) === 0 && (
          <p className="rounded-xl bg-fondo px-4 py-3 text-sm text-tinta">
            Entraron <strong>{kwh(entrada)}</strong>. Las pérdidas se van a ver cuando se facture ese mes.
          </p>
        )}
        {entrada !== null && Number(mes.facturada) > 0 && (
          <p className="rounded-xl bg-fondo px-4 py-3 text-sm text-tinta">
            Entraron <strong>{kwh(entrada)}</strong> y se facturaron <strong>{kwh(mes.facturada)}</strong>
            {entrada > 0 && (
              <>
                : las pérdidas dan <strong>{porciento(Math.round(((entrada - Number(mes.facturada)) / entrada) * 1000) / 10)}</strong>
              </>
            )}
            .
          </p>
        )}
      </form>
    </Modal>
  );
}
