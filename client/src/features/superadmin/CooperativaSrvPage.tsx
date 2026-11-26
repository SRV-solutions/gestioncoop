// Una cooperativa vista desde el panel de SRV: lo que se le cobra por cada factura que emite y el
// diseño de su factura (logo, color, membrete, aviso y pie), con la vista previa en el momento.
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Eye, ImageUp, Percent, Save, Trash2 } from 'lucide-react';
import {
  comisionDeEjemplo,
  formatDate,
  formatMoney,
  formatPorcentaje,
  MODELO_FACTURA_BASE,
  nombreDeMes,
  type ComisionCooperativa,
  type CooperativaSrv,
  type DisenoFactura,
  type ModeloFactura,
} from '@shared';
import { api, ApiError, errorMessage, pedirArchivo } from '../../lib/api';
import { cn } from '../../lib/cn';
import { achicarLogo } from '../../lib/foto';
import { Badge, Button, Card, Check, ErrorState, Field, FormAlert, PageHeader, Skeleton } from '../../components/ui';
import { FacturaElectronica } from './FacturaElectronica';

const hoyLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const mayuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const EJEMPLO = 50_000;

export function CooperativaSrvPage() {
  const id = Number(useParams().id);
  const consulta = useQuery({ queryKey: ['srv', 'cooperativa', id], queryFn: () => api.get<CooperativaSrv>(`/cooperativas/${id}`) });
  const d = consulta.data;

  return (
    <>
      <Link to="/superadmin" className="-ml-2 mb-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-[0.9375rem] font-semibold text-marca-texto">
        <ArrowLeft className="size-4" aria-hidden />
        Cooperativas
      </Link>
      <PageHeader title={d?.nombreCorto ?? 'Cooperativa'} description={d?.nombre} />
      {consulta.isPending ? (
        <div className="space-y-4">
          <Skeleton className="h-64 rounded-2xl" />
          <Skeleton className="h-96 rounded-2xl" />
        </div>
      ) : consulta.isError || !d ? (
        <Card>
          <ErrorState message={errorMessage(consulta.error)} onRetry={() => void consulta.refetch()} />
        </Card>
      ) : (
        <div className="space-y-6">
          <Comision cooperativaId={d.id} comision={d.comision} />
          <Factura cooperativaId={d.id} diseno={d.factura} />
          <FacturaElectronica cooperativaId={d.id} />
        </div>
      )}
    </>
  );
}

/* ───────────────────────── Comisión ───────────────────────── */

function Comision({ cooperativaId, comision }: { cooperativaId: number; comision: ComisionCooperativa }) {
  const qc = useQueryClient();
  const v = comision.vigente;
  const [datos, setDatos] = useState({ porcentaje: v ? v.porcentaje.replace('.', ',') : '0,8', fijo: '0', desde: hoyLocal(), nota: '' });
  const [campos, setCampos] = useState<Record<string, string>>({});

  const actualizar = (nueva: ComisionCooperativa) => {
    qc.setQueryData<CooperativaSrv>(['srv', 'cooperativa', cooperativaId], (c) => (c ? { ...c, comision: nueva } : c));
    void qc.invalidateQueries({ queryKey: ['srv', 'liquidacion'] });
    void qc.invalidateQueries({ queryKey: ['cooperativas'] });
  };
  const cargar = useMutation({
    mutationFn: () =>
      api.post<ComisionCooperativa>(`/cooperativas/${cooperativaId}/comisiones`, {
        porcentaje: datos.porcentaje.replace(',', '.'),
        fijoPorFactura: datos.fijo.replace(/\./g, '').replace(',', '.') || '0',
        desde: datos.desde,
        nota: datos.nota,
      }),
    onSuccess: (nueva) => {
      setCampos({});
      setDatos((x) => ({ ...x, nota: '' }));
      actualizar(nueva);
    },
    onError: (e) => setCampos(e instanceof ApiError && e.fields ? e.fields : {}),
  });
  const borrar = useMutation({ mutationFn: (comisionId: number) => api.del<ComisionCooperativa>(`/cooperativas/${cooperativaId}/comisiones/${comisionId}`), onSuccess: actualizar });

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    cargar.mutate();
  };
  const porcentajeEscrito = Number(datos.porcentaje.replace(',', '.')) || 0;
  const fijoEscrito = Number(datos.fijo.replace(/\./g, '').replace(',', '.')) || 0;

  return (
    <Card className="p-5 sm:p-6">
      <h2 className="flex items-center gap-2 text-lg font-bold text-tinta">
        <Percent className="size-5 text-marca-texto" aria-hidden />
        Comisión de SRV
      </h2>
      <p className="mt-1 text-tinta-suave">Lo que SRV le cobra a la cooperativa por cada factura que emite desde la plataforma. Un cambio rige desde la fecha que se elige: lo ya facturado conserva la comisión de su día.</p>

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="rounded-2xl bg-marca-tenue px-5 py-4">
          <p className="text-sm font-semibold text-marca-texto">Rige hoy</p>
          {v ? (
            <>
              <p className="mt-1 text-3xl font-black tabular-nums text-tinta">{formatPorcentaje(v.porcentaje)}</p>
              <p className="text-tinta">
                de cada factura{Number(v.fijoPorFactura) > 0 && <> más {formatMoney(v.fijoPorFactura)} por factura</>}
              </p>
              <p className="mt-2 text-sm text-tinta-suave">
                Una factura de {formatMoney(EJEMPLO, { cents: false })} le deja a SRV {formatMoney(comisionDeEjemplo(EJEMPLO, Number(v.porcentaje), Number(v.fijoPorFactura)))}. Desde el {formatDate(v.desde)}.
              </p>
            </>
          ) : (
            <p className="mt-1 text-lg font-bold text-tinta">Todavía no se cargó ninguna: no se cobra nada.</p>
          )}
          {comision.proxima && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-superficie px-3 py-2">
              <p className="text-sm text-tinta">
                Desde el <strong>{formatDate(comision.proxima.desde)}</strong>: {formatPorcentaje(comision.proxima.porcentaje)}
                {Number(comision.proxima.fijoPorFactura) > 0 && ` + ${formatMoney(comision.proxima.fijoPorFactura)}`}
              </p>
              <Button variant="ghost" icon={Trash2} loading={borrar.isPending} onClick={() => borrar.mutate(comision.proxima!.id)}>
                Borrar
              </Button>
            </div>
          )}
        </div>

        <form onSubmit={enviar} noValidate className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Porcentaje" inputMode="decimal" value={datos.porcentaje} onChange={(e) => setDatos({ ...datos, porcentaje: e.target.value })} error={campos.porcentaje} trailing={<span className="pr-3 text-tinta-suave">%</span>} />
            <Field label="Fijo por factura" inputMode="decimal" value={datos.fijo} onChange={(e) => setDatos({ ...datos, fijo: e.target.value })} error={campos.fijoPorFactura} hint="En pesos. 0 si no hay." />
            <Field label="Desde" type="date" min={hoyLocal()} value={datos.desde} onChange={(e) => setDatos({ ...datos, desde: e.target.value })} error={campos.desde} />
          </div>
          <Field label="Nota (opcional)" value={datos.nota} maxLength={200} onChange={(e) => setDatos({ ...datos, nota: e.target.value })} placeholder="Por ejemplo: acuerdo firmado el 1/12" />
          <p className="text-sm text-tinta-suave">
            Con {formatPorcentaje(porcentajeEscrito)}
            {fijoEscrito > 0 && ` y ${formatMoney(fijoEscrito)} fijos`}, una factura de {formatMoney(EJEMPLO, { cents: false })} le deja a SRV {formatMoney(comisionDeEjemplo(EJEMPLO, porcentajeEscrito, fijoEscrito))}.
          </p>
          {cargar.isError && !Object.keys(campos).length && <FormAlert>{errorMessage(cargar.error)}</FormAlert>}
          <Button type="submit" loading={cargar.isPending}>
            Cargar comisión
          </Button>
        </form>
      </div>

      <h3 className="mb-2 mt-7 text-sm font-semibold uppercase tracking-wide text-tinta-suave">Últimos meses</h3>
      {comision.meses.length === 0 ? (
        <p className="text-tinta-suave">Todavía no emitió facturas.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-linea">
          <table className="w-full min-w-[34rem] text-[0.9375rem]">
            <thead className="bg-fondo text-left text-sm text-tinta-suave">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Mes</th>
                <th className="px-4 py-2.5 text-right font-semibold">Facturas</th>
                <th className="px-4 py-2.5 text-right font-semibold">Notas de crédito</th>
                <th className="px-4 py-2.5 text-right font-semibold">Facturado neto</th>
                <th className="px-4 py-2.5 text-right font-semibold">Para SRV</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-linea">
              {comision.meses.map((m) => (
                <tr key={`${m.anio}-${m.mes}`}>
                  <td className="px-4 py-2.5 text-tinta">{mayuscula(nombreDeMes(m.anio, m.mes))}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{m.facturas.toLocaleString('es-AR')}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{m.notasCredito.toLocaleString('es-AR')}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(m.neto, { cents: false })}</td>
                  <td className="px-4 py-2.5 text-right font-bold tabular-nums text-tinta">{formatMoney(m.comision)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {comision.historial.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-semibold text-marca-texto">Historial de comisiones ({comision.historial.length})</summary>
          <ul className="mt-2 space-y-1.5 text-sm text-tinta">
            {comision.historial.map((h) => (
              <li key={h.id}>
                Desde el {formatDate(h.desde)}: <strong>{formatPorcentaje(h.porcentaje)}</strong>
                {Number(h.fijoPorFactura) > 0 && ` + ${formatMoney(h.fijoPorFactura)} por factura`}
                {h.nota && <span className="text-tinta-suave"> · {h.nota}</span>}
                {h.cargadoPor && <span className="text-tinta-suave"> · cargó {h.cargadoPor}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}

/* ───────────────────────── Diseño de la factura ───────────────────────── */

const area = 'block w-full rounded-xl border border-linea bg-superficie px-4 py-3 text-base text-tinta placeholder:text-tinta-suave/80 hover:border-marca-claro focus:border-marca';

function Factura({ cooperativaId, diseno }: { cooperativaId: number; diseno: DisenoFactura }) {
  const qc = useQueryClient();
  const [modelo, setModelo] = useState<ModeloFactura>({ ...MODELO_FACTURA_BASE, ...diseno.modelo });
  const [membrete, setMembrete] = useState<string[]>([0, 1, 2].map((i) => diseno.modelo.membrete[i] ?? ''));
  const [campos, setCampos] = useState<Record<string, string>>({});
  const [vista, setVista] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const archivo = useRef<HTMLInputElement>(null);
  const borrador: ModeloFactura = { ...modelo, membrete: membrete.map((m) => m.trim()).filter(Boolean) };

  // La vista previa se libera al cambiarla o al salir.
  useEffect(() => () => void (vista && URL.revokeObjectURL(vista)), [vista]);

  const adoptar = (nuevo: DisenoFactura) => {
    qc.setQueryData<CooperativaSrv>(['srv', 'cooperativa', cooperativaId], (c) => (c ? { ...c, factura: nuevo } : c));
    setVersion((n) => n + 1);
  };
  const ver = useMutation({
    mutationFn: () => pedirArchivo(`/cooperativas/${cooperativaId}/factura/muestra`, borrador),
    onSuccess: ({ contenido }) => setVista(URL.createObjectURL(contenido)),
  });
  const guardar = useMutation({
    mutationFn: () => api.put<DisenoFactura>(`/cooperativas/${cooperativaId}/factura`, borrador),
    onSuccess: (nuevo) => {
      setCampos({});
      adoptar(nuevo);
      if (diseno.hayMuestra) ver.mutate();
    },
    onError: (e) => setCampos(e instanceof ApiError && e.fields ? e.fields : {}),
  });
  const subirLogo = useMutation({
    mutationFn: async (f: File) => api.put<DisenoFactura>(`/cooperativas/${cooperativaId}/factura/logo`, { imagen: await achicarLogo(f) }),
    onSuccess: adoptar,
  });
  const quitarLogo = useMutation({ mutationFn: () => api.del<DisenoFactura>(`/cooperativas/${cooperativaId}/factura/logo`), onSuccess: adoptar });

  const elegir = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) subirLogo.mutate(f);
  };
  const color = modelo.color ?? diseno.colorMarca;

  return (
    <Card className="p-5 sm:p-6">
      <h2 className="text-lg font-bold text-tinta">Diseño de la factura</h2>
      <p className="mt-1 text-tinta-suave">Lo que se ve en el PDF que recibe cada socio. Probá los cambios con «Ver cómo queda» antes de guardar: se arma con la última factura emitida.</p>

      <div className="mt-5 grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            guardar.mutate();
          }}
          className="space-y-4"
        >
          <div>
            <p className="text-sm font-semibold text-tinta">Logo</p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <div className="grid h-20 w-36 place-items-center overflow-hidden rounded-xl border border-linea bg-white p-2">
                {diseno.logoFactura ? (
                  <img key={version} src={`/api/v1/cooperativas/${cooperativaId}/factura/logo?v=${version}`} alt="Logo de la factura" className="max-h-full max-w-full object-contain" />
                ) : (
                  <span className="text-center text-xs text-[#6b7280]">{diseno.isotipo ? 'Se usa el isotipo de la app' : 'Sin logo'}</span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" icon={ImageUp} loading={subirLogo.isPending} onClick={() => archivo.current?.click()}>
                  {diseno.logoFactura ? 'Cambiar' : 'Subir logo'}
                </Button>
                {diseno.logoFactura && (
                  <Button variant="ghost" icon={Trash2} loading={quitarLogo.isPending} onClick={() => quitarLogo.mutate()}>
                    Quitar
                  </Button>
                )}
              </div>
            </div>
            <input ref={archivo} type="file" accept="image/png,image/jpeg" className="sr-only" tabIndex={-1} aria-label="Elegir el logo de la factura" onChange={elegir} />
            {(subirLogo.isError || quitarLogo.isError) && (
              <div className="mt-2">
                <FormAlert>{errorMessage(subirLogo.error ?? quitarLogo.error)}</FormAlert>
              </div>
            )}
            <div className="mt-3">
              <Check label="Mostrar el logo en la factura" checked={modelo.conLogo} onChange={(e) => setModelo({ ...modelo, conLogo: e.target.checked })} />
            </div>
          </div>

          <div>
            <label htmlFor="color-factura" className="block text-sm font-semibold text-tinta">
              Color
            </label>
            <div className="mt-1.5 flex flex-wrap items-center gap-3">
              <input id="color-factura" type="color" value={color} onChange={(e) => setModelo({ ...modelo, color: e.target.value })} className="h-12 w-16 cursor-pointer rounded-lg border border-linea bg-superficie p-1" />
              <span className="font-mono text-sm text-tinta-suave">{color}</span>
              {modelo.color && (
                <Button variant="ghost" onClick={() => setModelo({ ...modelo, color: null })}>
                  Usar el de la marca
                </Button>
              )}
            </div>
            {campos.color && <p className="mt-1 text-sm font-medium text-peligro">{campos.color}</p>}
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold text-tinta">Renglones extra del encabezado</legend>
            <p className="text-sm text-tinta-suave">Debajo del CUIT, el domicilio y los teléfonos. Por ejemplo, ingresos brutos o inicio de actividades.</p>
            {membrete.map((m, i) => (
              <input
                key={i}
                aria-label={`Renglón ${i + 1} del encabezado`}
                value={m}
                maxLength={90}
                placeholder={['Ingresos brutos: …', 'Inicio de actividades: …', 'www.… · mail@…'][i]}
                onChange={(e) => setMembrete(membrete.map((x, j) => (j === i ? e.target.value : x)))}
                className={cn(area, 'min-h-11 py-2')}
              />
            ))}
            {campos.membrete && <p className="text-sm font-medium text-peligro">{campos.membrete}</p>}
          </fieldset>

          <div className="space-y-1.5">
            <label htmlFor="mensaje-factura" className="block text-sm font-semibold text-tinta">
              Aviso para todos los socios
            </label>
            <textarea id="mensaje-factura" rows={2} maxLength={160} value={modelo.mensaje ?? ''} onChange={(e) => setModelo({ ...modelo, mensaje: e.target.value || null })} placeholder="Por ejemplo: ya podés pagar tu factura desde el celular" className={area} />
            <p className="text-sm text-tinta-suave">Va destacado debajo del encabezado. Hasta 160 letras.</p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="pie-factura" className="block text-sm font-semibold text-tinta">
              Texto al pie
            </label>
            <textarea id="pie-factura" rows={3} maxLength={300} value={modelo.pie ?? ''} onChange={(e) => setModelo({ ...modelo, pie: e.target.value || null })} placeholder="Ente regulador, defensa del consumidor, leyendas legales" className={area} />
          </div>

          {guardar.isError && !Object.keys(campos).length && <FormAlert>{errorMessage(guardar.error)}</FormAlert>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" icon={Save} loading={guardar.isPending}>
              Guardar
            </Button>
            <Button variant="secondary" icon={Eye} loading={ver.isPending} disabled={!diseno.hayMuestra} onClick={() => ver.mutate()}>
              Ver cómo queda
            </Button>
          </div>
          {!diseno.hayMuestra && <p className="text-sm text-tinta-suave">La vista previa aparece cuando la cooperativa emita su primera factura.</p>}
          {guardar.isSuccess && (
            <p className="text-sm font-semibold text-exito" role="status">
              Guardado. Las facturas que se abran desde ahora salen con este diseño.
            </p>
          )}
        </form>

        <div className="min-h-[24rem]">
          {ver.isError ? (
            <FormAlert>{errorMessage(ver.error)}</FormAlert>
          ) : vista ? (
            <iframe title="Vista previa de la factura" src={vista} className="h-[42rem] w-full rounded-xl border border-linea bg-white" />
          ) : (
            <div className={cn('grid h-full min-h-[24rem] place-items-center rounded-xl border border-dashed border-linea px-6 text-center text-tinta-suave')}>
              <div>
                <Badge>Vista previa</Badge>
                <p className="mt-2">Tocá «Ver cómo queda» para armar la factura de muestra con estos cambios.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
