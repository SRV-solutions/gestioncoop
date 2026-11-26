// Planes de internet y TV (abono fijo) y reglas de vencimiento, mora y corte.
import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Wifi } from 'lucide-react';
import {
  formatMoney,
  formatNumber,
  formatPorcentaje,
  type ParametrosFacturacion,
  type PlanDetalle,
  type TarifasResumen,
} from '@shared';
import { api, ApiError, errorMessage } from '../../lib/api';
import { Modal } from '../../components/Modal';
import { SERVICIO_CORTO, SERVICIO_ICON } from '../../components/servicios';
import { Button, Card, Check, Empty, Field, FormAlert } from '../../components/ui';

interface Props {
  datos: TarifasResumen;
  puedeEditar: boolean;
  alCambiar: () => void;
}

export function PlanesYMora({ datos, puedeEditar, alCambiar }: Props) {
  const [plan, setPlan] = useState<PlanDetalle | null>(null);
  return (
    <div className="grid items-start gap-6 xl:grid-cols-2">
      <section aria-labelledby="titulo-planes">
        <h3 id="titulo-planes" className="mb-2 text-sm font-semibold uppercase tracking-wide text-tinta-suave">
          Planes de internet y TV
        </h3>
        <Card className="overflow-hidden">
          {datos.planes.length === 0 ? (
            <Empty icon={Wifi} title="No hay planes cargados">
              Los planes son los abonos fijos de internet y TV. Si la cooperativa no presta esos servicios, no hace falta ninguno.
            </Empty>
          ) : (
            <ul className="divide-y divide-linea">
              {datos.planes.map((p) => {
                const Icon = SERVICIO_ICON[p.servicio];
                return (
                  <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-marca-tenue text-marca-texto">
                      <Icon className="size-5" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-tinta">{p.nombre}</p>
                      <p className="text-sm text-tinta-suave">
                        {SERVICIO_CORTO[p.servicio]} · {formatNumber(p.conexiones)} {p.conexiones === 1 ? 'conexión' : 'conexiones'}
                      </p>
                    </div>
                    <p className="text-right">
                      <span className="text-lg font-bold tabular-nums text-tinta">{formatMoney(p.precio)}</span>
                      <span className="block text-xs text-tinta-suave">por mes</span>
                    </p>
                    {puedeEditar && (
                      <Button variant="secondary" onClick={() => setPlan(p)}>
                        Cambiar precio
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <p className="mt-2 text-sm text-tinta-suave">Si una conexión se da de alta o de baja a mitad de mes, paga la parte proporcional a los días.</p>
      </section>

      <section aria-labelledby="titulo-mora">
        <h3 id="titulo-mora" className="mb-2 text-sm font-semibold uppercase tracking-wide text-tinta-suave">
          Vencimientos, mora y cortes
        </h3>
        <Card className="px-5 py-5">{puedeEditar ? <FormParametros actuales={datos.parametros} alCambiar={alCambiar} /> : <ParametrosLectura p={datos.parametros} />}</Card>
      </section>

      {plan && (
        <PrecioDialog
          plan={plan}
          onClose={() => setPlan(null)}
          onSaved={() => {
            setPlan(null);
            alCambiar();
          }}
        />
      )}
    </div>
  );
}

function ParametrosLectura({ p }: { p: ParametrosFacturacion }) {
  const filas: [string, string][] = [
    ['Interés por mora', `${formatPorcentaje(p.moraTasaDiaria)} por día de atraso`],
    ['Vencimiento', `${p.diasVencimiento} días después de la emisión`],
    ['Segundo vencimiento', p.segundoVencimientoDias ? `${p.segundoVencimientoDias} días después, con ${formatPorcentaje(p.recargoSegundoVencimiento)} de recargo` : 'No se usa'],
    ['Corte sugerido', `Con ${p.facturasParaCorte} ${p.facturasParaCorte === 1 ? 'factura impaga' : 'facturas impagas'}`],
  ];
  return (
    <dl className="divide-y divide-linea/70">
      {filas.map(([etiqueta, valor]) => (
        <div key={etiqueta} className="flex flex-wrap justify-between gap-x-4 py-2.5">
          <dt className="text-tinta-suave">{etiqueta}</dt>
          <dd className="font-semibold text-tinta">{valor}</dd>
        </div>
      ))}
    </dl>
  );
}

function FormParametros({ actuales, alCambiar }: { actuales: ParametrosFacturacion; alCambiar: () => void }) {
  const [tasa, setTasa] = useState(actuales.moraTasaDiaria);
  const [dias, setDias] = useState(String(actuales.diasVencimiento));
  const [segundo, setSegundo] = useState(actuales.segundoVencimientoDias !== null);
  const [segundoDias, setSegundoDias] = useState(String(actuales.segundoVencimientoDias ?? 7));
  const [recargo, setRecargo] = useState(actuales.recargoSegundoVencimiento);
  const [corte, setCorte] = useState(String(actuales.facturasParaCorte));
  const [errores, setErrores] = useState<Record<string, string>>({});

  const guardar = useMutation({
    mutationFn: (body: ParametrosFacturacion) => api.put<ParametrosFacturacion>('/tarifas/parametros', body),
    onSuccess: alCambiar,
    onError: (err) => setErrores(err instanceof ApiError && err.fields ? err.fields : {}),
  });

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    setErrores({});
    guardar.mutate({
      moraTasaDiaria: tasa.trim(),
      diasVencimiento: Number(dias),
      segundoVencimientoDias: segundo ? Number(segundoDias) : null,
      recargoSegundoVencimiento: segundo ? recargo.trim() : '0',
      facturasParaCorte: Number(corte),
    });
  };

  const tasaNumero = Number(tasa.trim().replace(',', '.'));
  const porMes = Number.isFinite(tasaNumero) && tasa.trim() !== '' ? `Equivale a ${formatPorcentaje((tasaNumero * 30).toFixed(4))} cada 30 días.` : undefined;
  const cambio = guardar.isSuccess && !guardar.isPending;

  return (
    <form onSubmit={enviar} className="space-y-5" noValidate onChange={() => guardar.isSuccess && guardar.reset()}>
      {guardar.isError && !Object.keys(errores).length && <FormAlert>{errorMessage(guardar.error)}</FormAlert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Interés por mora (% por día)" inputMode="decimal" value={tasa} onChange={(e) => setTasa(e.target.value)} error={errores.moraTasaDiaria} hint={porMes} />
        <Field
          label="Días hasta el vencimiento"
          inputMode="numeric"
          value={dias}
          onChange={(e) => setDias(e.target.value)}
          error={errores.diasVencimiento}
          hint="Contados desde la emisión."
        />
      </div>

      <div className="space-y-3">
        <Check label="Usar segundo vencimiento" checked={segundo} onChange={(e) => setSegundo(e.target.checked)} />
        {segundo && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Días después del primero"
              inputMode="numeric"
              value={segundoDias}
              onChange={(e) => setSegundoDias(e.target.value)}
              error={errores.segundoVencimientoDias}
            />
            <Field label="Recargo (%)" inputMode="decimal" value={recargo} onChange={(e) => setRecargo(e.target.value)} error={errores.recargoSegundoVencimiento} />
          </div>
        )}
      </div>

      <Field
        label="Facturas impagas para sugerir el corte"
        inputMode="numeric"
        value={corte}
        onChange={(e) => setCorte(e.target.value)}
        error={errores.facturasParaCorte}
        hint="El sistema nunca corta solo: arma una lista de cortes sugeridos para que alguien decida."
      />

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={guardar.isPending}>
          Guardar
        </Button>
        {cambio && (
          <p role="status" className="text-sm font-semibold text-exito">
            Guardado
          </p>
        )}
      </div>
    </form>
  );
}

function PrecioDialog({ plan, onClose, onSaved }: { plan: PlanDetalle; onClose: () => void; onSaved: () => void }) {
  const [precio, setPrecio] = useState(plan.precio);
  const guardar = useMutation({
    mutationFn: () => api.put<PlanDetalle>(`/tarifas/planes/${plan.id}`, { precio: precio.trim() }),
    onSuccess: onSaved,
  });
  const error = guardar.error instanceof ApiError ? (guardar.error.fields?.precio ?? guardar.error.message) : guardar.isError ? errorMessage(guardar.error) : undefined;

  return (
    <Modal
      title={`Cambiar precio · ${plan.nombre}`}
      description={`Hoy cuesta ${formatMoney(plan.precio)} por mes y lo tienen ${formatNumber(plan.conexiones)} ${plan.conexiones === 1 ? 'conexión' : 'conexiones'}. El precio nuevo se usa desde la próxima facturación.`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="form-precio" loading={guardar.isPending}>
            Guardar
          </Button>
        </>
      }
    >
      <form
        id="form-precio"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          guardar.mutate();
        }}
      >
        <Field label="Precio por mes ($)" inputMode="decimal" autoFocus value={precio} onChange={(e) => setPrecio(e.target.value)} error={error} />
      </form>
    </Modal>
  );
}
