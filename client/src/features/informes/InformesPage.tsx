// Informes exportables (SPEC 6.9): se elige el informe, se filtra, se mira en pantalla y se baja
// en Excel, CSV o PDF. En pantalla van las primeras filas; el archivo las trae todas.
import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ChevronRight, FileSpreadsheet, FileText, FileType, Inbox, type LucideIcon } from 'lucide-react';
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatNumber,
  LOCALE,
  nombreDeMes,
  SERVICIO_ETIQUETA,
  type CatalogoInformes,
  type CeldaInforme,
  type ColumnaInforme,
  type FormatoInforme,
  type InformeDatos,
  type InformeDef,
} from '@shared';
import { api, descargar, errorMessage, qs } from '../../lib/api';
import { cn } from '../../lib/cn';
import { Button, Card, Empty, ErrorState, FormAlert, PageHeader, SelectField, Skeleton } from '../../components/ui';

const mayuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const decimales = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2 });
const esNumerica = (c: ColumnaInforme) => c.tipo === 'dinero' || c.tipo === 'entero' || c.tipo === 'numero';

function celda(v: CeldaInforme, c: ColumnaInforme): string {
  if (v === null || v === '') return '';
  if (c.tipo === 'dinero') return formatMoney(v);
  if (c.tipo === 'entero') return formatNumber(v);
  if (c.tipo === 'numero') return decimales.format(Number(v));
  if (c.tipo === 'fecha') return formatDate(String(v));
  if (c.tipo === 'fechahora') return formatDateTime(String(v));
  return String(v);
}

export function InformesPage() {
  const { clave } = useParams();
  const catalogo = useQuery({ queryKey: ['informes'], queryFn: () => api.get<CatalogoInformes>('/informes') });

  if (catalogo.isPending) {
    return (
      <>
        <PageHeader title="Informes" />
        <Skeleton className="h-96 rounded-2xl" />
      </>
    );
  }
  if (catalogo.isError || !catalogo.data) {
    return (
      <>
        <PageHeader title="Informes" />
        <Card>
          <ErrorState message={errorMessage(catalogo.error)} onRetry={() => void catalogo.refetch()} />
        </Card>
      </>
    );
  }
  const def = clave ? catalogo.data.informes.find((i) => i.clave === clave) : undefined;
  if (clave && !def) {
    return (
      <>
        <PageHeader title="Informes" />
        <Card>
          <Empty icon={Inbox} title="Ese informe no existe" action={<Link to="/informes" className="inline-flex min-h-11 items-center rounded-lg bg-marca px-4 font-semibold text-white hover:bg-marca-fuerte">Ver los informes</Link>}>
            Puede que la dirección esté mal escrita.
          </Empty>
        </Card>
      </>
    );
  }
  return def ? <Informe key={def.clave} def={def} catalogo={catalogo.data} /> : <Lista informes={catalogo.data.informes} />;
}

/* ───────────────────────── Lista ───────────────────────── */

function Lista({ informes }: { informes: InformeDef[] }) {
  return (
    <>
      <PageHeader title="Informes" description="Para mirar en pantalla o bajar en Excel, CSV o PDF." />
      <Card className="divide-y divide-linea">
        {informes.map((i) => (
          <Link key={i.clave} to={`/informes/${i.clave}`} className="group flex items-center gap-4 px-5 py-4 transition-colors duration-150 first:rounded-t-2xl last:rounded-b-2xl hover:bg-marca-tenue">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-marca-tenue text-marca-texto group-hover:bg-superficie">
              <FileText className="size-5" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-bold text-tinta">{i.titulo}</span>
              <span className="block text-sm text-tinta-suave">{i.descripcion}</span>
            </span>
            <ChevronRight className="size-5 shrink-0 text-tinta-suave" aria-hidden />
          </Link>
        ))}
      </Card>
    </>
  );
}

/* ───────────────────────── Un informe ───────────────────────── */

const FORMATOS: { formato: Exclude<FormatoInforme, 'json'>; texto: string; icon: LucideIcon }[] = [
  { formato: 'xlsx', texto: 'Excel', icon: FileSpreadsheet },
  { formato: 'csv', texto: 'CSV', icon: FileType },
  { formato: 'pdf', texto: 'PDF', icon: FileText },
];

function Informe({ def, catalogo }: { def: InformeDef; catalogo: CatalogoInformes }) {
  const [params, setParams] = useSearchParams();
  const usa = (f: InformeDef['filtros'][number]) => def.filtros.includes(f);
  // Solo viajan los filtros que este informe entiende.
  const filtros = {
    anio: usa('periodo') ? params.get('anio') : null,
    mes: usa('periodo') ? params.get('mes') : null,
    servicio: usa('servicio') ? params.get('servicio') : null,
    zona: usa('zona') ? params.get('zona') : null,
  };
  const consulta = useQuery({
    queryKey: ['informe', def.clave, filtros.anio, filtros.mes, filtros.servicio, filtros.zona],
    queryFn: () => api.get<InformeDatos>(`/informes/${def.clave}${qs(filtros)}`),
    placeholderData: keepPreviousData,
  });
  const [bajando, setBajando] = useState<FormatoInforme | null>(null);
  const [error, setError] = useState<string | null>(null);
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
  const bajar = async (formato: Exclude<FormatoInforme, 'json'>) => {
    setBajando(formato);
    setError(null);
    try {
      await descargar(`/informes/${def.clave}${qs({ ...filtros, formato })}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBajando(null);
    }
  };

  return (
    <>
      <Link to="/informes" className="mb-3 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-marca-texto hover:underline">
        <ArrowLeft className="size-4" aria-hidden />
        Todos los informes
      </Link>
      <PageHeader title={def.titulo} description={def.descripcion} />

      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="grid flex-1 gap-3 sm:grid-cols-[repeat(3,minmax(0,13rem))]">
          {usa('periodo') && (
            <SelectField label="Mes" value={d?.periodo ? `${d.periodo.anio}-${d.periodo.mes}` : `${filtros.anio ?? ''}-${filtros.mes ?? ''}`} onChange={(e) => cambiar('periodo', e.target.value)}>
              {catalogo.periodos.map((p) => (
                <option key={`${p.anio}-${p.mes}`} value={`${p.anio}-${p.mes}`}>
                  {mayuscula(nombreDeMes(p.anio, p.mes))}
                </option>
              ))}
            </SelectField>
          )}
          {usa('servicio') && (
            <SelectField label="Servicio" value={filtros.servicio ?? ''} onChange={(e) => cambiar('servicio', e.target.value)}>
              <option value="">Todos</option>
              {catalogo.servicios.map((s) => (
                <option key={s} value={s}>
                  {SERVICIO_ETIQUETA[s]}
                </option>
              ))}
            </SelectField>
          )}
          {usa('zona') && (
            <SelectField label="Zona" value={filtros.zona ?? ''} onChange={(e) => cambiar('zona', e.target.value)}>
              <option value="">Todas</option>
              {catalogo.zonas.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.nombre}
                </option>
              ))}
            </SelectField>
          )}
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Exportar">
          {FORMATOS.map((f, i) => (
            <Button key={f.formato} variant={i === 0 ? 'primary' : 'secondary'} size="lg" icon={f.icon} loading={bajando === f.formato} disabled={bajando !== null || !d} onClick={() => void bajar(f.formato)}>
              {f.texto}
            </Button>
          ))}
        </div>
      </div>
      {error && (
        <div className="mb-4">
          <FormAlert>{error}</FormAlert>
        </div>
      )}

      <Card className="overflow-hidden">
        {consulta.isPending ? (
          <Skeleton className="m-5 h-80 rounded-xl" />
        ) : consulta.isError || !d ? (
          <ErrorState message={errorMessage(consulta.error)} onRetry={() => void consulta.refetch()} />
        ) : d.total === 0 ? (
          <Empty icon={Inbox} title="No hay nada para mostrar">
            Con estos filtros el informe queda vacío. Probá con otro mes, otro servicio u otra zona.
          </Empty>
        ) : (
          <Vista d={d} apagada={consulta.isPlaceholderData} />
        )}
      </Card>
    </>
  );
}

function Vista({ d, apagada }: { d: InformeDatos; apagada: boolean }) {
  return (
    <div className={cn('transition-opacity duration-150', apagada && 'opacity-60')}>
      <p className="border-b border-linea px-5 py-3 text-sm text-tinta-suave">
        <strong className="text-tinta">{d.subtitulo}</strong> · {formatNumber(d.total)} {d.total === 1 ? 'fila' : 'filas'}
        {d.filas.length < d.total && ` · acá van las primeras ${formatNumber(d.filas.length)}; el archivo las trae todas`}
      </p>
      <div className="max-h-[65vh] overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              {d.columnas.map((c) => (
                <th key={c.clave} scope="col" className={cn('sticky top-0 z-10 whitespace-nowrap border-b border-linea bg-fondo px-3 py-2.5 font-semibold text-tinta-suave first:pl-5 last:pr-5', esNumerica(c) ? 'text-right' : 'text-left')}>
                  {c.titulo}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {d.filas.map((f, i) => (
              <tr key={i} className="hover:bg-fondo">
                {f.map((v, j) => {
                  const c = d.columnas[j]!;
                  return (
                    <td key={c.clave} className={cn('max-w-72 truncate border-b border-linea/70 px-3 py-2 text-tinta first:pl-5 last:pr-5', esNumerica(c) ? 'whitespace-nowrap text-right tabular-nums' : 'text-left', (c.tipo === 'fecha' || c.tipo === 'fechahora') && 'whitespace-nowrap tabular-nums')} title={c.tipo === 'texto' && v ? String(v) : undefined}>
                      {celda(v, c)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          {d.totales && (
            <tfoot>
              <tr>
                {d.totales.map((v, j) => {
                  const c = d.columnas[j]!;
                  return (
                    <td key={c.clave} className={cn('sticky bottom-0 whitespace-nowrap border-t-2 border-tinta/30 bg-superficie px-3 py-2.5 font-bold text-tinta first:pl-5 last:pr-5', esNumerica(c) && j > 0 ? 'text-right tabular-nums' : 'text-left')}>
                      {j === 0 && typeof v === 'string' ? `${v}${d.filas.length < d.total ? ' del informe' : ''}` : celda(v, c)}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {d.nota && <p className="border-t border-linea px-5 py-3 text-sm text-tinta-suave">{d.nota}</p>}
    </div>
  );
}
