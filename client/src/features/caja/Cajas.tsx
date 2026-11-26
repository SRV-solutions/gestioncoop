// Lo cobrado: los movimientos de una caja, las cajas anteriores con su arqueo y la ficha de un
// recibo (reimprimirlo o, con permiso y motivo, anularlo).
import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Ban, Inbox, Wallet } from 'lucide-react';
import { formatDateTime, formatMoney, formatNumber, MEDIO_PAGO_ETIQUETA, nombreDeMes, SERVICIO_ETIQUETA, type CajaDetalle, type CajaResumen, type PaginaCajas, type PagoListado, type ReciboDetalle } from '@shared';
import { api, ApiError, errorMessage } from '../../lib/api';
import { cn } from '../../lib/cn';
import { Modal } from '../../components/Modal';
import { Badge, Button, Card, Empty, ErrorState, FormAlert, Skeleton } from '../../components/ui';
import { ArqueoBadge, BotonesRecibo, dia, documento, hora, MedioBadge, plural } from './piezas';

/* ───────────────────────── Lista de cobros ───────────────────────── */

export function ListaPagos({ pagos, alAbrir, conFecha }: { pagos: PagoListado[]; alAbrir: (id: number) => void; conFecha?: boolean }) {
  return (
    <ul className="divide-y divide-linea">
      {pagos.map((p) => (
        <li key={p.id}>
          <button
            type="button"
            onClick={() => alAbrir(p.id)}
            className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-4 px-5 py-2.5 text-left transition-colors duration-100 hover:bg-marca-tenue/50"
          >
            <span className="w-12 text-sm font-semibold tabular-nums text-tinta-suave">{conFecha ? formatDateTime(p.cobradoEl).slice(0, 5) : hora(p.cobradoEl)}</span>
            <span className="min-w-0">
              <span className={cn('block truncate font-semibold', p.estado === 'anulado' ? 'text-tinta-suave line-through' : 'text-tinta')}>{p.socio ? p.socio.nombre : 'Venta de mostrador'}</span>
              <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-tinta-suave">
                <span className="tabular-nums">{p.referencia}</span>
                <span>· {p.concepto}</span>
                <MedioBadge medio={p.medio} />
                {p.origen === 'online' && <Badge>Online</Badge>}
                {p.estado === 'anulado' && <Badge tone="peligro">Anulado</Badge>}
              </span>
            </span>
            <span className={cn('text-lg font-bold tabular-nums', p.estado === 'anulado' ? 'text-tinta-suave line-through' : 'text-tinta')}>{formatMoney(p.importe)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/* ───────────────────────── Ficha de un recibo ───────────────────────── */

interface ReciboModalProps {
  id: number;
  puedeAnular: boolean;
  onClose: () => void;
  /** Para volver a la caja desde la que se abrió. */
  volver?: string;
}

export function ReciboModal({ id, puedeAnular, onClose, volver }: ReciboModalProps) {
  const qc = useQueryClient();
  const consulta = useQuery({ queryKey: ['caja', 'cobro', id], queryFn: () => api.get<ReciboDetalle>(`/caja/cobros/${id}`) });
  const [anulando, setAnulando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const anular = useMutation({
    mutationFn: () => api.post<ReciboDetalle>(`/caja/cobros/${id}/anular`, { motivo }),
    onSuccess: (recibo) => {
      qc.setQueryData(['caja', 'cobro', id], recibo);
      void qc.invalidateQueries({ queryKey: ['caja'] });
      // La factura vuelve a figurar como deuda en facturación.
      void qc.invalidateQueries({ queryKey: ['facturacion'] });
      setAnulando(false);
    },
  });
  const r = consulta.data;

  return (
    <Modal
      title={r ? r.referencia : 'Recibo'}
      description={r ? `${formatDateTime(r.cobradoEl)}${r.cajero ? ` · atendió ${r.cajero}` : r.origen === 'online' ? ' · pago online' : ''}` : undefined}
      onClose={onClose}
      footer={
        r && !anulando ? (
          <>
            <BotonesRecibo id={r.id} />
            <Button variant="secondary" icon={volver ? ArrowLeft : undefined} onClick={onClose}>
              {volver ?? 'Cerrar'}
            </Button>
          </>
        ) : undefined
      }
    >
      {consulta.isPending ? (
        <div className="space-y-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-40" />
        </div>
      ) : consulta.isError || !r ? (
        <ErrorState message={errorMessage(consulta.error)} onRetry={() => void consulta.refetch()} />
      ) : anulando ? (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            anular.mutate();
          }}
        >
          <p className="text-tinta">
            Se anula el cobro de <strong className="tabular-nums">{formatMoney(r.importe)}</strong>
            {r.aplicaciones.length > 0 && <>: {r.aplicaciones.length === 1 ? 'la factura vuelve' : `las ${r.aplicaciones.length} facturas vuelven`} a figurar como deuda</>}
            {r.items.length > 0 && <>{r.aplicaciones.length > 0 ? ' y' : ':'} lo vendido vuelve al stock</>}. El recibo queda anulado, no se borra. No se puede deshacer.
          </p>
          <div className="space-y-1.5">
            <label htmlFor="motivo-anular-cobro" className="block text-sm font-semibold text-tinta">
              ¿Por qué se anula?
            </label>
            <textarea
              id="motivo-anular-cobro"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={3}
              maxLength={200}
              autoFocus
              placeholder="Por ejemplo: se cobró al socio equivocado"
              className="block w-full rounded-xl border border-linea bg-superficie px-4 py-3 text-base text-tinta placeholder:text-tinta-suave/80 hover:border-marca-claro focus:border-marca"
            />
            <p className="text-sm text-tinta-suave">Queda en el recibo y en la auditoría, con tu nombre.</p>
          </div>
          {anular.isError && <FormAlert>{anular.error instanceof ApiError && anular.error.fields?.motivo ? anular.error.fields.motivo : errorMessage(anular.error)}</FormAlert>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => setAnulando(false)}>
              Volver
            </Button>
            <Button type="submit" variant="danger" loading={anular.isPending}>
              Anular el cobro
            </Button>
          </div>
        </form>
      ) : (
        <div className="space-y-4">
          {r.anulacion && (
            <div role="alert" className="rounded-xl bg-peligro-tenue px-4 py-3 text-sm text-tinta">
              <p className="font-bold text-peligro">Cobro anulado</p>
              <p className="mt-0.5">
                {r.anulacion.motivo} — {r.anulacion.por ?? 'Administración'}, {formatDateTime(r.anulacion.fecha)}
              </p>
            </div>
          )}
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-lg font-bold text-tinta">{r.titular ? r.titular.nombre : 'Venta de mostrador'}</p>
              {r.titular && (
                <p className="truncate text-sm text-tinta-suave">
                  Socio {r.titular.numero} · {documento(r.titular.tipoDoc, r.titular.nroDoc)}
                  {r.titular.direccion && ` · ${r.titular.direccion}`}
                </p>
              )}
            </div>
            <p className={cn('text-3xl font-bold tabular-nums', r.estado === 'anulado' ? 'text-tinta-suave line-through' : 'text-tinta')}>{formatMoney(r.importe)}</p>
          </div>

          <ul className="divide-y divide-linea rounded-2xl border border-linea text-sm">
            {r.aplicaciones.map((a) => (
              <li key={a.comprobanteId} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="min-w-0">
                  <span className="block font-semibold text-tinta">
                    {SERVICIO_ETIQUETA[a.servicio]} · {nombreDeMes(a.anio, a.mes)}
                  </span>
                  <span className="block text-tinta-suave">
                    {a.referencia}
                    {Number(a.saldoDespues) > 0 && ` · pago parcial, quedó debiendo ${formatMoney(a.saldoDespues)}`}
                  </span>
                </span>
                <span className="shrink-0 font-bold tabular-nums text-tinta">{formatMoney(a.importe)}</span>
              </li>
            ))}
            {r.items.map((i) => (
              <li key={i.descripcion} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="min-w-0">
                  <span className="block font-semibold text-tinta">{i.descripcion}</span>
                  <span className="block text-tinta-suave">
                    {i.cantidad} × {formatMoney(i.unitario)}
                  </span>
                </span>
                <span className="shrink-0 font-bold tabular-nums text-tinta">{formatMoney(i.importe)}</span>
              </li>
            ))}
          </ul>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-tinta-suave">Medio</dt>
              <dd className="font-semibold text-tinta">{MEDIO_PAGO_ETIQUETA[r.medio]}</dd>
            </div>
            {r.recibido !== null && r.vuelto !== null && (
              <>
                <div>
                  <dt className="text-tinta-suave">Pagó con</dt>
                  <dd className="font-semibold tabular-nums text-tinta">{formatMoney(r.recibido)}</dd>
                </div>
                <div>
                  <dt className="text-tinta-suave">Vuelto</dt>
                  <dd className="font-semibold tabular-nums text-tinta">{formatMoney(r.vuelto)}</dd>
                </div>
              </>
            )}
            {r.referenciaPago && (
              <div className="col-span-2">
                <dt className="text-tinta-suave">Operación</dt>
                <dd className="truncate font-semibold text-tinta">{r.referenciaPago}</dd>
              </div>
            )}
          </dl>

          {puedeAnular && r.estado === 'acreditado' && (
            <p className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-linea pt-3 text-sm text-tinta-suave">
              ¿Se cobró mal? Solo administración puede anularlo.
              <Button variant="ghost" icon={Ban} onClick={() => (anular.reset(), setMotivo(''), setAnulando(true))}>
                Anular el cobro
              </Button>
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}

/* ───────────────────────── Resumen de una caja ───────────────────────── */

/** Lo cobrado por medio de pago y la cuenta del efectivo: fondo + cobrado = lo que tiene que haber. */
export function ResumenCaja({ caja }: { caja: CajaResumen }) {
  const efectivo = caja.porMedio.find((m) => m.medio === 'efectivo')!;
  const cerrada = caja.contado !== null && caja.diferencia !== null;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="overflow-hidden rounded-2xl border border-linea">
        <p className="border-b border-linea px-4 py-2.5 text-sm font-bold text-tinta">Cobrado por medio de pago</p>
        <ul className="divide-y divide-linea text-sm">
          {caja.porMedio.map((m) => (
            <li key={m.medio} className={cn('flex items-center justify-between gap-3 px-4 py-2', m.cantidad === 0 && 'text-tinta-suave')}>
              <span>
                {MEDIO_PAGO_ETIQUETA[m.medio]} <span className="text-tinta-suave">· {m.cantidad}</span>
              </span>
              <span className="font-semibold tabular-nums">{formatMoney(m.total)}</span>
            </li>
          ))}
          <li className="flex items-center justify-between gap-3 bg-fondo px-4 py-2.5 font-bold text-tinta">
            <span>
              Total <span className="font-normal text-tinta-suave">· {plural(caja.cobros, 'cobro', 'cobros')}</span>
            </span>
            <span className="tabular-nums">{formatMoney(caja.total)}</span>
          </li>
        </ul>
      </div>
      <div className="overflow-hidden rounded-2xl border border-linea">
        <p className="border-b border-linea px-4 py-2.5 text-sm font-bold text-tinta">Efectivo en el cajón</p>
        <ul className="divide-y divide-linea text-sm">
          <li className="flex items-center justify-between gap-3 px-4 py-2">
            <span>Fondo inicial</span>
            <span className="font-semibold tabular-nums">{formatMoney(caja.fondoInicial)}</span>
          </li>
          <li className="flex items-center justify-between gap-3 px-4 py-2">
            <span>Cobrado en efectivo</span>
            <span className="font-semibold tabular-nums">{formatMoney(efectivo.total)}</span>
          </li>
          <li className="flex items-center justify-between gap-3 bg-fondo px-4 py-2.5 font-bold text-tinta">
            <span>Tiene que haber</span>
            <span className="tabular-nums">{formatMoney(caja.efectivoEsperado)}</span>
          </li>
          {cerrada && (
            <>
              <li className="flex items-center justify-between gap-3 px-4 py-2">
                <span>Se contó</span>
                <span className="font-semibold tabular-nums">{formatMoney(caja.contado!)}</span>
              </li>
              <li className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span>Arqueo</span>
                <ArqueoBadge caja={caja} />
              </li>
            </>
          )}
        </ul>
        {caja.nota && <p className="border-t border-linea px-4 py-2.5 text-sm text-tinta">“{caja.nota}”</p>}
      </div>
    </div>
  );
}

/* ───────────────────────── Movimientos de la caja abierta ───────────────────────── */

export function Movimientos({ cajaId, puedeAnular }: { cajaId: number; puedeAnular: boolean }) {
  const consulta = useQuery({ queryKey: ['caja', 'detalle', cajaId], queryFn: () => api.get<CajaDetalle>(`/caja/cajas/${cajaId}`) });
  const [recibo, setRecibo] = useState<number | null>(null);
  const c = consulta.data;
  if (consulta.isPending) return <Skeleton className="h-72 rounded-2xl" />;
  if (consulta.isError || !c) {
    return (
      <Card>
        <ErrorState message={errorMessage(consulta.error)} onRetry={() => void consulta.refetch()} />
      </Card>
    );
  }
  return (
    <div className="space-y-5">
      <ResumenCaja caja={c} />
      <Card className="overflow-hidden">
        {c.pagos.length === 0 ? (
          <Empty icon={Inbox} title="Todavía no hay cobros en esta caja">
            Cada cobro que hagas aparece acá, para volver a imprimir el recibo.
          </Empty>
        ) : (
          <ListaPagos pagos={c.pagos} alAbrir={setRecibo} />
        )}
      </Card>
      {recibo !== null && <ReciboModal key={recibo} id={recibo} puedeAnular={puedeAnular} onClose={() => setRecibo(null)} />}
    </div>
  );
}

/* ───────────────────────── Cajas anteriores ───────────────────────── */

export function Cajas({ puedeAnular, propias }: { puedeAnular: boolean; propias: boolean }) {
  const [pagina, setPagina] = useState(1);
  const [abierta, setAbierta] = useState<number | null>(null);
  const consulta = useQuery({ queryKey: ['caja', 'cajas', pagina], queryFn: () => api.get<PaginaCajas>(`/caja/cajas?pagina=${pagina}`), placeholderData: keepPreviousData });
  const datos = consulta.data;
  const paginas = datos ? Math.max(1, Math.ceil(datos.total / datos.porPagina)) : 1;

  return (
    <>
      <Card className={cn('overflow-hidden transition-opacity duration-150', consulta.isPlaceholderData && 'opacity-60')}>
        {consulta.isPending ? (
          <div className="space-y-3 p-5">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : consulta.isError || !datos ? (
          <ErrorState message={errorMessage(consulta.error)} onRetry={() => void consulta.refetch()} />
        ) : datos.filas.length === 0 ? (
          <Empty icon={Wallet} title={propias ? 'Todavía no abriste ninguna caja' : 'Todavía no hay cajas'}>
            Cada turno de un cajero —desde que abre hasta que cierra con su arqueo— queda acá, con todo lo que cobró.
          </Empty>
        ) : (
          <ul className="divide-y divide-linea">
            {datos.filas.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setAbierta(c.id)}
                  className="grid w-full items-center gap-x-5 gap-y-1 px-5 py-3 text-left transition-colors duration-100 hover:bg-marca-tenue/50 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto]"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold capitalize text-tinta">{dia(c.abiertaEl)}</span>
                    <span className="block truncate text-sm text-tinta-suave">
                      {c.cajero.nombre} · {hora(c.abiertaEl)} a {c.cerradaEl ? hora(c.cerradaEl) : 'ahora'}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-tinta-suave">
                    <ArqueoBadge caja={c} />
                    <span>{plural(c.cobros, 'cobro', 'cobros')}</span>
                    {c.anulados > 0 && <span>· {plural(c.anulados, 'anulado', 'anulados')}</span>}
                  </span>
                  <span className="text-lg font-bold tabular-nums text-tinta">{formatMoney(c.total)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {datos && paginas > 1 && (
        <nav aria-label="Páginas" className="mt-3 flex items-center justify-between gap-3">
          <Button variant="secondary" disabled={pagina === 1} onClick={() => setPagina((p) => p - 1)}>
            Más nuevas
          </Button>
          <p className="text-sm text-tinta-suave">
            Página {pagina} de {formatNumber(paginas)} · {formatNumber(datos.total)} cajas
          </p>
          <Button variant="secondary" disabled={pagina >= paginas} onClick={() => setPagina((p) => p + 1)}>
            Más viejas
          </Button>
        </nav>
      )}

      {abierta !== null && <CajaModal key={abierta} id={abierta} puedeAnular={puedeAnular} onClose={() => setAbierta(null)} />}
    </>
  );
}

function CajaModal({ id, puedeAnular, onClose }: { id: number; puedeAnular: boolean; onClose: () => void }) {
  const consulta = useQuery({ queryKey: ['caja', 'detalle', id], queryFn: () => api.get<CajaDetalle>(`/caja/cajas/${id}`) });
  const [recibo, setRecibo] = useState<number | null>(null);
  const c = consulta.data;
  // Un recibo abierto reemplaza a la caja; al cerrarlo se vuelve a ella.
  if (recibo !== null) return <ReciboModal key={recibo} id={recibo} puedeAnular={puedeAnular} volver="Volver a la caja" onClose={() => setRecibo(null)} />;
  return (
    <Modal
      wide
      title={c ? `Caja del ${dia(c.abiertaEl)}` : 'Caja'}
      description={c ? `${c.cajero.nombre} · ${hora(c.abiertaEl)} a ${c.cerradaEl ? hora(c.cerradaEl) : 'ahora (sigue abierta)'}` : undefined}
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Cerrar
        </Button>
      }
    >
      {consulta.isPending ? (
        <div className="space-y-3">
          <Skeleton className="h-40" />
          <Skeleton className="h-52" />
        </div>
      ) : consulta.isError || !c ? (
        <ErrorState message={errorMessage(consulta.error)} onRetry={() => void consulta.refetch()} />
      ) : (
        <div className="space-y-5">
          <ResumenCaja caja={c} />
          {c.pagos.length > 0 && (
            <div className="overflow-hidden rounded-2xl border border-linea">
              <ListaPagos pagos={c.pagos} alAbrir={setRecibo} />
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
