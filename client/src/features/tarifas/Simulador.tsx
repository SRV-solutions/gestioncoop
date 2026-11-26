// «¿Cuánto pagaría una conexión así?» Calcula una factura con las tarifas cargadas, sin guardar nada.
import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Calculator, TriangleAlert } from 'lucide-react';
import {
  CATEGORIA_ETIQUETA,
  CATEGORIAS,
  CONDICION_IVA_ETIQUETA,
  CONDICIONES_IVA,
  formatMoney,
  SERVICIOS_CONEXION,
  UNIDAD_SERVICIO,
  type Categoria,
  type CondicionIva,
  type FacturaCalculada,
  type ServicioConexion,
  type SimulacionInput,
  type TarifasResumen,
} from '@shared';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { cn } from '../../lib/cn';
import { SERVICIO_CORTO, SERVICIO_ICON } from '../../components/servicios';
import { Check, Empty, Field, SelectField, Skeleton } from '../../components/ui';
import { FacturaVista } from './FacturaVista';

interface Form {
  servicio: ServicioConexion;
  categoria: Categoria;
  tieneSubsidio: boolean;
  condicionIva: CondicionIva;
  consumo: string;
  planId: number | null;
  conSepelio: boolean;
  adherentes: string;
  periodo: string;
  conDeuda: boolean;
  saldo: string;
  dias: string;
}

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

/** Los últimos 12 meses y los 2 que vienen, para probar tarifas que ya rigieron o que todavía no. */
function mesesCercanos(hoy: string): { valor: string; etiqueta: string }[] {
  const anio = Number(hoy.slice(0, 4));
  const mes = Number(hoy.slice(5, 7));
  return Array.from({ length: 14 }, (_, i) => {
    const d = new Date(Date.UTC(anio, mes - 1 + 2 - i, 1));
    return { valor: d.toISOString().slice(0, 7), etiqueta: `${MESES[d.getUTCMonth()]} ${d.getUTCFullYear()}` };
  });
}

const esNumero = (v: string, decimales = 2) => new RegExp(`^\\d{1,9}([.,]\\d{1,${decimales}})?$`).test(v.trim());
const esEntero = (v: string) => /^\d{1,4}$/.test(v.trim());

/** Arma el pedido; devuelve `null` mientras falte algún dato (así no se consulta a medias). */
function pedido(f: Form, medido: boolean): SimulacionInput | null {
  const body: SimulacionInput = { servicio: f.servicio, condicionIva: f.condicionIva, periodo: f.periodo };
  if (medido) {
    if (!esNumero(f.consumo)) return null;
    Object.assign(body, { categoria: f.categoria, tieneSubsidio: f.tieneSubsidio, consumo: f.consumo.trim() });
  } else if (f.servicio !== 'sepelio') {
    if (!f.planId) return null;
    body.planId = f.planId;
  }
  if (f.servicio === 'sepelio' || (f.servicio === 'energia' && f.conSepelio)) {
    if (!esEntero(f.adherentes)) return null;
    body.adherentes = Number(f.adherentes);
  }
  if (f.conDeuda) {
    if (!esNumero(f.saldo) || !esEntero(f.dias) || Number(f.dias) < 1) return null;
    body.deuda = { saldo: f.saldo.trim(), dias: Number(f.dias) };
  }
  return body;
}

export function Simulador({ datos }: { datos: TarifasResumen }) {
  const { me } = useAuth();
  const servicios = SERVICIOS_CONEXION.filter((s) => me?.cooperativa?.servicios.includes(s));
  const haySepelio = datos.cuadros.some((c) => c.servicio === 'sepelio');

  const [form, setForm] = useState<Form>(() => ({
    servicio: servicios[0] ?? 'energia',
    categoria: 'residencial',
    tieneSubsidio: true,
    condicionIva: 'consumidor_final',
    consumo: '300',
    planId: null,
    conSepelio: false,
    adherentes: '2',
    periodo: datos.hoy.slice(0, 7),
    conDeuda: false,
    saldo: '50000',
    dias: '15',
  }));
  const set = <K extends keyof Form>(campo: K, valor: Form[K]) => setForm((f) => ({ ...f, [campo]: valor }));

  const medido = form.servicio === 'energia' || form.servicio === 'agua';
  const unidad = medido ? UNIDAD_SERVICIO[form.servicio as 'energia' | 'agua'] : '';
  const planes = datos.planes.filter((p) => p.servicio === form.servicio && p.activo);
  // Solo las categorías que tienen cuadro cargado para ese servicio.
  const categorias = useMemo(
    () => CATEGORIAS.filter((c) => datos.cuadros.some((q) => q.servicio === form.servicio && q.categoria === c)),
    [datos.cuadros, form.servicio],
  );
  const admiteSubsidio = datos.cuadros.some((q) => q.servicio === form.servicio && q.categoria === form.categoria && q.conSubsidio);

  const elegirServicio = (servicio: ServicioConexion) => {
    const deEse = datos.planes.filter((p) => p.servicio === servicio && p.activo);
    setForm((f) => ({ ...f, servicio, consumo: servicio === 'agua' ? '20' : '300', planId: deEse[0]?.id ?? null, categoria: 'residencial' }));
  };

  // El formulario responde al instante; el cálculo espera a que se deje de tipear.
  const actual = pedido({ ...form, tieneSubsidio: form.tieneSubsidio && admiteSubsidio }, medido);
  const clave = JSON.stringify(actual);
  const [quieto, setQuieto] = useState(clave);
  useEffect(() => {
    const t = setTimeout(() => setQuieto(clave), 250);
    return () => clearTimeout(t);
  }, [clave]);

  const consulta = useQuery({
    queryKey: ['simulacion', quieto],
    queryFn: () => api.post<FacturaCalculada>('/tarifas/simular', JSON.parse(quieto)),
    enabled: quieto !== 'null',
    placeholderData: keepPreviousData,
    retry: false,
  });

  const ejemplo = (cambios: Partial<Form>) => setForm((f) => ({ ...f, conSepelio: false, conDeuda: false, condicionIva: 'consumidor_final', categoria: 'residencial', ...cambios }));

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <div className="space-y-5">
        <div>
          <p className="mb-1.5 text-sm font-semibold text-tinta">Servicio</p>
          <div className="flex flex-wrap gap-2">
            {servicios.map((s) => {
              const Icon = SERVICIO_ICON[s];
              const activo = form.servicio === s;
              return (
                <button
                  key={s}
                  type="button"
                  aria-pressed={activo}
                  onClick={() => elegirServicio(s)}
                  className={cn(
                    'inline-flex min-h-11 items-center gap-2 rounded-xl border px-3.5 text-[0.9375rem] font-semibold transition-colors duration-150',
                    activo ? 'border-marca bg-marca text-white' : 'border-linea bg-superficie text-tinta hover:border-marca hover:text-marca-texto',
                  )}
                >
                  <Icon className="size-4" aria-hidden />
                  {SERVICIO_CORTO[s]}
                </button>
              );
            })}
          </div>
        </div>

        {medido && (
          <>
            <Field
              label={`Consumo del mes (${unidad})`}
              inputMode="decimal"
              value={form.consumo}
              onChange={(e) => set('consumo', e.target.value)}
              error={form.consumo.trim() !== '' && !esNumero(form.consumo) ? 'Escribí un número, por ejemplo 250' : undefined}
            />
            <SelectField label="Categoría" value={form.categoria} onChange={(e) => set('categoria', e.target.value as Categoria)}>
              {categorias.map((c) => (
                <option key={c} value={c}>
                  {CATEGORIA_ETIQUETA[c]}
                </option>
              ))}
            </SelectField>
            {admiteSubsidio && <Check label="Tiene subsidio" checked={form.tieneSubsidio} onChange={(e) => set('tieneSubsidio', e.target.checked)} />}
          </>
        )}

        {(form.servicio === 'internet' || form.servicio === 'tv') &&
          (planes.length ? (
            <SelectField label="Plan" value={form.planId ?? ''} onChange={(e) => set('planId', Number(e.target.value) || null)}>
              {planes.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre} · {formatMoney(p.precio)}
                </option>
              ))}
            </SelectField>
          ) : (
            <p className="rounded-xl bg-alerta-tenue px-4 py-3 text-sm font-medium text-alerta">Todavía no hay planes cargados para este servicio.</p>
          ))}

        {form.servicio === 'energia' && haySepelio && (
          <Check label="Sumar el servicio de sepelio a la factura" checked={form.conSepelio} onChange={(e) => set('conSepelio', e.target.checked)} />
        )}
        {(form.servicio === 'sepelio' || (form.servicio === 'energia' && form.conSepelio)) && (
          <Field
            label="Adherentes de sepelio"
            hint="Sin contar al titular."
            inputMode="numeric"
            value={form.adherentes}
            onChange={(e) => set('adherentes', e.target.value)}
            error={form.adherentes.trim() !== '' && !esEntero(form.adherentes) ? 'Escribí un número entero' : undefined}
          />
        )}

        <SelectField label="Condición frente al IVA" value={form.condicionIva} onChange={(e) => set('condicionIva', e.target.value as CondicionIva)}>
          {CONDICIONES_IVA.map((c) => (
            <option key={c} value={c}>
              {CONDICION_IVA_ETIQUETA[c]}
            </option>
          ))}
        </SelectField>

        <SelectField label="Mes que se factura" hint="Cada mes usa la tarifa que regía en ese momento." value={form.periodo} onChange={(e) => set('periodo', e.target.value)}>
          {mesesCercanos(datos.hoy).map((m) => (
            <option key={m.valor} value={m.valor}>
              {m.etiqueta}
            </option>
          ))}
        </SelectField>

        <div className="space-y-3 rounded-2xl border border-linea bg-superficie px-4 py-3">
          <Check label="Tiene una factura anterior vencida" checked={form.conDeuda} onChange={(e) => set('conDeuda', e.target.checked)} />
          {form.conDeuda && (
            <div className="grid grid-cols-2 gap-3 pb-1">
              <Field label="Saldo vencido ($)" inputMode="decimal" value={form.saldo} onChange={(e) => set('saldo', e.target.value)} />
              <Field label="Días de atraso" inputMode="numeric" value={form.dias} onChange={(e) => set('dias', e.target.value)} />
            </div>
          )}
        </div>

        {(servicios.includes('agua') || servicios.includes('energia')) && (
          <div>
            <p className="mb-1.5 text-sm font-semibold text-tinta-suave">Probar con</p>
            <div className="flex flex-wrap gap-2">
              {servicios.includes('agua') && (
                <BotonEjemplo onClick={() => ejemplo({ servicio: 'agua', consumo: '66' })}>66 m³ de agua</BotonEjemplo>
              )}
              {servicios.includes('energia') && (
                <BotonEjemplo onClick={() => ejemplo({ servicio: 'energia', consumo: '1176', tieneSubsidio: true })}>1.176 kWh con subsidio</BotonEjemplo>
              )}
              {servicios.includes('energia') && <BotonEjemplo onClick={() => ejemplo({ servicio: 'energia', consumo: '0' })}>Sin consumo</BotonEjemplo>}
            </div>
          </div>
        )}
      </div>

      <div aria-live="polite" className="min-w-0">
        {consulta.isError ? (
          <div role="alert" className="flex items-start gap-3 rounded-2xl border border-linea bg-superficie px-5 py-5">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-alerta-tenue text-alerta">
              <TriangleAlert className="size-5" aria-hidden />
            </span>
            <div>
              <p className="font-bold text-tinta">No se puede calcular esta factura</p>
              <p className="mt-0.5 text-tinta-suave">{errorMessage(consulta.error)}</p>
            </div>
          </div>
        ) : consulta.data ? (
          <FacturaVista factura={consulta.data} className={cn('transition-opacity duration-150', (consulta.isPlaceholderData || clave !== quieto) && 'opacity-60')} />
        ) : actual === null ? (
          <div className="rounded-2xl border border-linea bg-superficie">
            <Empty icon={Calculator} title="Completá los datos">
              Con el servicio y el consumo alcanza: la factura se arma sola a medida que escribís.
            </Empty>
          </div>
        ) : (
          <Skeleton className="h-96 w-full rounded-2xl" />
        )}
      </div>
    </div>
  );
}

function BotonEjemplo({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-10 rounded-full border border-linea bg-superficie px-3.5 text-sm font-semibold text-tinta hover:border-marca hover:text-marca-texto"
    >
      {children}
    </button>
  );
}
