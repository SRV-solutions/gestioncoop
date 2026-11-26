import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowRight, Building2, Settings2 } from 'lucide-react';
import { formatCuit, formatMoney, formatPorcentaje, nombreDeMes, SERVICIO_ETIQUETA, type CooperativaResumen, type LiquidacionPlataforma } from '@shared';
import { api, errorMessage, qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { CoopMark } from '../../components/Logo';
import { Badge, Button, Card, Empty, ErrorState, FormAlert, PageHeader, SelectField, Skeleton } from '../../components/ui';

const mayuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Lo que SRV le cobra a cada cooperativa en un mes: un porcentaje de lo que facturó. */
function Liquidacion() {
  const [mes, setMes] = useState<string>('');
  const [anio, numero] = mes ? mes.split('-').map(Number) : [undefined, undefined];
  const consulta = useQuery({
    queryKey: ['srv', 'liquidacion', mes],
    queryFn: () => api.get<LiquidacionPlataforma>(`/cooperativas/liquidacion${qs({ anio, mes: numero })}`),
    placeholderData: keepPreviousData,
  });
  const l = consulta.data;
  if (consulta.isError) return <ErrorState message={errorMessage(consulta.error)} onRetry={() => void consulta.refetch()} />;
  if (!l) return <Skeleton className="h-48 rounded-2xl" />;
  return (
    <Card className="mb-6 p-5 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-tinta">Para cobrar</h2>
          <p className="mt-0.5 text-tinta-suave">La comisión de SRV por las facturas que emitió cada cooperativa en el mes.</p>
        </div>
        <div className="w-56">
          <SelectField label="Mes" value={`${l.anio}-${l.mes}`} onChange={(e) => setMes(e.target.value)}>
            {(l.meses.length ? l.meses : [{ anio: l.anio, mes: l.mes }]).map((m) => (
              <option key={`${m.anio}-${m.mes}`} value={`${m.anio}-${m.mes}`}>
                {mayuscula(nombreDeMes(m.anio, m.mes))}
              </option>
            ))}
          </SelectField>
        </div>
      </div>
      <div className="mt-4 overflow-x-auto rounded-xl border border-linea">
        <table className="w-full min-w-[36rem] text-[0.9375rem]">
          <thead className="bg-fondo text-left text-sm text-tinta-suave">
            <tr>
              <th className="px-4 py-2.5 font-semibold">Cooperativa</th>
              <th className="px-4 py-2.5 text-right font-semibold">Facturas</th>
              <th className="px-4 py-2.5 text-right font-semibold">Facturado neto</th>
              <th className="px-4 py-2.5 text-right font-semibold">Comisión</th>
              <th className="px-4 py-2.5 text-right font-semibold">Para SRV</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-linea">
            {l.filas.map((f) => (
              <tr key={f.cooperativa.id}>
                <td className="px-4 py-2.5">
                  <Link to={`/superadmin/cooperativas/${f.cooperativa.id}`} className="font-semibold text-marca-texto hover:underline">
                    {f.cooperativa.nombreCorto}
                  </Link>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{f.facturas.toLocaleString('es-AR')}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(f.neto, { cents: false })}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-tinta-suave">
                  {f.porcentaje === null ? 'Sin cargar' : `${formatPorcentaje(f.porcentaje)}${Number(f.fijoPorFactura) > 0 ? ` + ${formatMoney(f.fijoPorFactura!)}` : ''}`}
                </td>
                <td className="px-4 py-2.5 text-right font-bold tabular-nums text-tinta">{formatMoney(f.comision)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-linea bg-fondo">
            <tr>
              <td className="px-4 py-2.5 font-bold text-tinta" colSpan={4}>
                Total de {nombreDeMes(l.anio, l.mes)}
              </td>
              <td className="px-4 py-2.5 text-right text-lg font-black tabular-nums text-tinta">{formatMoney(l.total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="mt-2 text-sm text-tinta-suave">Cada factura paga la comisión que regía el día en que se emitió. Las notas de crédito descuentan el porcentaje de lo que acreditan.</p>
    </Card>
  );
}

/** Panel del proveedor: lo que se cobra, las cooperativas de la plataforma y la entrada a cada una. */
export function CooperativasPage() {
  const { me, setCooperativa } = useAuth();
  const navigate = useNavigate();
  const query = useQuery({ queryKey: ['cooperativas'], queryFn: () => api.get<CooperativaResumen[]>('/cooperativas') });
  const [entering, setEntering] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const enter = async (id: number) => {
    setError(null);
    setEntering(id);
    try {
      await setCooperativa(id);
      navigate('/gerencia');
    } catch (e) {
      setError(errorMessage(e));
      setEntering(null);
    }
  };

  return (
    <>
      <PageHeader title="Cooperativas" description="Cada cooperativa tiene su marca, sus usuarios y sus datos, separados de las demás." />
      <Liquidacion />
      {error && (
        <div className="mb-4">
          <FormAlert>{error}</FormAlert>
        </div>
      )}

      {query.isPending ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-52 rounded-2xl" />
          ))}
        </div>
      ) : query.isError ? (
        <Card>
          <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
        </Card>
      ) : query.data.length === 0 ? (
        <Card>
          <Empty icon={Building2} title="Todavía no hay cooperativas">
            Las cooperativas que se den de alta van a aparecer acá.
          </Empty>
        </Card>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {query.data.map((c) => {
            const current = me?.cooperativa?.id === c.id;
            return (
              <li key={c.id}>
                <Card className="flex h-full flex-col overflow-hidden">
                  {/* Franja con los colores propios de esa cooperativa */}
                  <div className="flex items-center gap-3 px-5 py-4 text-white" style={{ backgroundColor: c.tema.colores.primarioOscuro }}>
                    <CoopMark cooperativa={c} className="ring-2 ring-white/70" />
                    <div className="min-w-0">
                      <h2 className="truncate font-bold leading-tight">{c.nombreCorto}</h2>
                      <p className="truncate text-sm text-white/75">{c.localidad}</p>
                    </div>
                  </div>
                  <div className="flex flex-1 flex-col gap-4 p-5">
                    <p className="text-sm text-tinta-suave">{c.nombre}</p>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                      <div>
                        <dt className="text-tinta-suave">CUIT</dt>
                        <dd className="font-semibold tabular-nums">{formatCuit(c.cuit)}</dd>
                      </div>
                      <div>
                        <dt className="text-tinta-suave">Usuarios</dt>
                        <dd className="font-semibold tabular-nums">{c.usuarios}</dd>
                      </div>
                      <div className="col-span-2">
                        <dt className="text-tinta-suave">Comisión de SRV</dt>
                        <dd className="font-semibold">
                          {c.comision ? `${formatPorcentaje(c.comision.porcentaje)} de cada factura${Number(c.comision.fijoPorFactura) > 0 ? ` + ${formatMoney(c.comision.fijoPorFactura)}` : ''}` : 'Sin cargar'}
                        </dd>
                      </div>
                      <div className="col-span-2">
                        <dt className="text-tinta-suave">Servicios</dt>
                        <dd className="mt-1 flex flex-wrap gap-1.5">
                          {c.servicios.map((s) => (
                            <Badge key={s}>{SERVICIO_ETIQUETA[s]}</Badge>
                          ))}
                        </dd>
                      </div>
                    </dl>
                    <div className="mt-auto flex items-center justify-between gap-3 pt-1">
                      <Badge tone={c.activa ? 'exito' : 'neutral'}>{c.activa ? 'Activa' : 'Desactivada'}</Badge>
                      <Link
                        to={`/superadmin/cooperativas/${c.id}`}
                        className="ml-auto inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-[0.9375rem] font-semibold text-marca-texto hover:bg-marca-tenue"
                      >
                        <Settings2 className="size-4" aria-hidden />
                        Comisión y factura
                      </Link>
                      <Button
                        variant={current ? 'secondary' : 'primary'}
                        icon={ArrowRight}
                        loading={entering === c.id}
                        disabled={entering !== null}
                        onClick={() => void enter(c.id)}
                      >
                        {current ? 'Seguir en esta' : 'Entrar'}
                      </Button>
                    </div>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
