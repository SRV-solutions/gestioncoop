// Lista de comprobantes (pre-facturas o emitidos) y la ficha de uno: de dónde sale cada peso,
// contra qué se compara, la lectura con su foto, el PDF y la nota de crédito.
import { useState, type ReactNode } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownRight, ArrowUpRight, Ban, Camera, CircleCheck, FileDown, SearchX, TriangleAlert } from 'lucide-react';
import {
  ANOMALIA_ETIQUETA,
  CATEGORIA_ETIQUETA,
  formatCantidad,
  formatDate,
  formatDateTime,
  formatMoney,
  formatNumber,
  MEDIO_PAGO_ETIQUETA,
  MOTIVO_ETIQUETA,
  nombreDeMes,
  NOVEDAD_ETIQUETA,
  RARA_ETIQUETA,
  SERVICIO_ETIQUETA,
  UNIDAD_SERVICIO,
  type ComprobanteDetalle,
  type ComprobanteListado,
  type PaginaComprobantes,
  type ServicioConCuadro,
} from '@shared';
import { abrirPdf, api, ApiError, errorMessage, qs } from '../../lib/api';
import { cn } from '../../lib/cn';
import { Modal } from '../../components/Modal';
import { SERVICIO_CORTO, SERVICIO_ICON } from '../../components/servicios';
import { Badge, Button, Card, Empty, ErrorState, FormAlert, Skeleton } from '../../components/ui';
import { FacturaVista } from '../tarifas/FacturaVista';

/* ───────────────────────── Piezas chicas ───────────────────────── */

export function EstadoBadge({ c, hoy }: { c: Pick<ComprobanteListado, 'tipo' | 'estado' | 'venceEl'>; hoy: string }) {
  if (c.estado === 'borrador') return <Badge tone="marca">Pre-factura</Badge>;
  if (c.estado === 'anulado') return <Badge>Anulada</Badge>;
  if (c.tipo !== 'factura') return <Badge tone="marca">Emitida</Badge>;
  if (c.estado === 'pagado') return <Badge tone="exito">Pagada</Badge>;
  return c.venceEl && c.venceEl < hoy ? <Badge tone="peligro">Vencida</Badge> : <Badge tone="alerta">Sin pagar</Badge>;
}

/** Cuánto cambió contra el mes anterior: «+180 %». */
function Variacion({ valor }: { valor: number }) {
  const sube = valor > 0;
  const Icon = sube ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-sm font-bold tabular-nums', Math.abs(valor) > 50 ? 'text-alerta' : 'text-tinta-suave')}>
      <Icon className="size-4" aria-hidden />
      {sube ? '+' : ''}
      {formatNumber(valor, Math.abs(valor) < 10 ? 1 : 0)} %
    </span>
  );
}

function PdfBoton({ id, children = 'Ver PDF', variant = 'secondary' }: { id: number; children?: ReactNode; variant?: 'secondary' | 'ghost' }) {
  const abrir = useMutation({ mutationFn: () => abrirPdf(`/facturacion/comprobantes/${id}/pdf`) });
  return (
    <span className="inline-flex flex-col items-end">
      <Button variant={variant} icon={FileDown} loading={abrir.isPending} onClick={() => abrir.mutate()}>
        {children}
      </Button>
      {abrir.isError && <span className="mt-1 text-sm font-medium text-peligro">{errorMessage(abrir.error)}</span>}
    </span>
  );
}

/* ───────────────────────── Lista ───────────────────────── */

export interface FiltroComprobantes {
  anio?: number;
  mes?: number;
  vista?: 'todas' | 'por_revisar' | 'raras' | 'errores';
  servicio?: string;
  estado?: string;
  q?: string;
}

interface ListaProps {
  filtro: FiltroComprobantes;
  hoy: string;
  /** Cambia cuando se recalcula o se emite: la lista se vuelve a pedir. */
  version?: string;
  vacio: { titulo: string; texto: string };
  puedeOperar: boolean;
  /** Muestra el mes en cada fila (para la búsqueda en todos los meses). */
  conMes?: boolean;
}

export function ListaComprobantes({ filtro, hoy, version, vacio, puedeOperar, conMes }: ListaProps) {
  const qc = useQueryClient();
  const [pagina, setPagina] = useState(1);
  const [abierto, setAbierto] = useState<number | null>(null);
  // Si cambia el filtro, se vuelve a la primera página.
  const clave = JSON.stringify(filtro);
  const [claveVista, setClaveVista] = useState(clave);
  if (clave !== claveVista) {
    setClaveVista(clave);
    setPagina(1);
  }

  const consulta = useQuery({
    queryKey: ['facturacion', 'comprobantes', clave, pagina, version],
    queryFn: () => api.get<PaginaComprobantes>(`/facturacion/comprobantes${qs({ ...filtro, pagina })}`),
    placeholderData: keepPreviousData,
  });
  const datos = consulta.data;
  const paginas = datos ? Math.max(1, Math.ceil(datos.total / datos.porPagina)) : 1;
  const refrescar = () => void qc.invalidateQueries({ queryKey: ['facturacion'] });

  /** Después de revisar una, se abre la siguiente de la lista (revisar de a una, sin volver atrás). */
  const siguienteDe = (id: number): number | null => {
    const filas = datos?.filas ?? [];
    const i = filas.findIndex((f) => f.id === id);
    return filas[i + 1]?.id ?? null;
  };

  return (
    <>
      <Card className={cn('overflow-hidden transition-opacity duration-150', consulta.isPlaceholderData && 'opacity-60')}>
        {consulta.isPending ? (
          <div className="space-y-3 p-5">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : consulta.isError ? (
          <ErrorState message={errorMessage(consulta.error)} onRetry={() => void consulta.refetch()} />
        ) : !datos || datos.filas.length === 0 ? (
          <Empty icon={filtro.q ? SearchX : CircleCheck} title={vacio.titulo}>
            {vacio.texto}
          </Empty>
        ) : (
          <ul className="divide-y divide-linea">
            {datos.filas.map((f) => (
              <Fila key={f.id} c={f} hoy={hoy} conMes={conMes} alAbrir={() => setAbierto(f.id)} />
            ))}
          </ul>
        )}
      </Card>

      {datos && paginas > 1 && (
        <nav aria-label="Páginas" className="mt-3 flex items-center justify-between gap-3">
          <Button variant="secondary" disabled={pagina === 1} onClick={() => setPagina((p) => p - 1)}>
            Anteriores
          </Button>
          <p className="text-sm text-tinta-suave">
            Página {pagina} de {formatNumber(paginas)} · {formatNumber(datos.total)} en total
          </p>
          <Button variant="secondary" disabled={pagina >= paginas} onClick={() => setPagina((p) => p + 1)}>
            Siguientes
          </Button>
        </nav>
      )}

      {abierto !== null && (
        <ComprobanteModal
          key={abierto}
          id={abierto}
          hoy={hoy}
          puedeOperar={puedeOperar}
          siguiente={filtro.vista === 'por_revisar' ? siguienteDe(abierto) : null}
          alIr={setAbierto}
          alCambiar={refrescar}
          onClose={() => setAbierto(null)}
        />
      )}
    </>
  );
}

function Fila({ c, hoy, conMes, alAbrir }: { c: ComprobanteListado; hoy: string; conMes?: boolean; alAbrir: () => void }) {
  const Icon = SERVICIO_ICON[c.servicio];
  const unidad = UNIDAD_SERVICIO[c.servicio as ServicioConCuadro];
  return (
    <li>
      <button
        type="button"
        onClick={alAbrir}
        className="grid w-full items-center gap-x-5 gap-y-1.5 px-5 py-3 text-left transition-colors duration-150 hover:bg-marca-tenue/50 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_auto]"
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-marca-tenue text-marca-texto">
            <Icon className="size-5" aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="block truncate font-semibold text-tinta">{c.socio.nombre}</span>
            <span className="block truncate text-sm text-tinta-suave">
              Socio {c.socio.numero}
              {c.direccion && ` · ${c.direccion}`}
            </span>
          </span>
        </span>

        <span className="min-w-0 text-sm text-tinta-suave">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-semibold tabular-nums text-tinta">{c.numero !== null ? c.referencia : SERVICIO_CORTO[c.servicio]}</span>
            <EstadoBadge c={c} hoy={hoy} />
            {c.rara && <Badge tone={c.revisada ? 'neutral' : 'alerta'}>{RARA_ETIQUETA[c.rara]}</Badge>}
            {c.estimada && <Badge>Estimada</Badge>}
            {c.error && <Badge tone="peligro">No se pudo calcular</Badge>}
          </span>
          <span className="mt-0.5 block truncate">
            {c.error ??
              [
                c.numero !== null ? SERVICIO_CORTO[c.servicio] : null,
                conMes ? nombreDeMes(c.anio, c.mes) : null,
                c.consumo !== null && unidad ? `${formatCantidad(c.consumo)} ${unidad}` : null,
                c.venceEl ? `vence ${formatDate(c.venceEl)}` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
          </span>
        </span>

        <span className="flex items-center justify-between gap-4 md:flex-col md:items-end md:gap-0">
          <span className="text-lg font-bold tabular-nums text-tinta">{formatMoney(c.total)}</span>
          {c.variacion !== null && c.estado === 'borrador' ? (
            <Variacion valor={c.variacion} />
          ) : (
            c.estado === 'emitido' && c.tipo === 'factura' && c.saldo !== c.total && <span className="text-sm text-tinta-suave">debe {formatMoney(c.saldo)}</span>
          )}
        </span>
      </button>
    </li>
  );
}

/* ───────────────────────── Ficha de un comprobante ───────────────────────── */

interface ModalProps {
  id: number;
  hoy: string;
  puedeOperar: boolean;
  /** La próxima pre-factura por revisar, si se está revisando de a una. */
  siguiente: number | null;
  alIr: (id: number) => void;
  alCambiar: () => void;
  onClose: () => void;
}

function ComprobanteModal({ id, hoy, puedeOperar, siguiente, alIr, alCambiar, onClose }: ModalProps) {
  const consulta = useQuery({ queryKey: ['facturacion', 'comprobante', id], queryFn: () => api.get<ComprobanteDetalle>(`/facturacion/comprobantes/${id}`) });
  const [anulando, setAnulando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [foto, setFoto] = useState<number | null>(null);

  const revisar = useMutation({
    mutationFn: () => api.post(`/facturacion/comprobantes/${id}/revisar`),
    onSuccess: () => {
      alCambiar();
      if (siguiente !== null) alIr(siguiente);
      else onClose();
    },
  });
  const anular = useMutation({
    mutationFn: () => api.post<{ id: number }>(`/facturacion/comprobantes/${id}/nota-credito`, { motivo }),
    onSuccess: () => {
      setAnulando(false);
      alCambiar();
    },
  });

  const c = consulta.data;
  const titulo = c ? (c.numero !== null ? c.referencia : `Pre-factura de ${SERVICIO_ETIQUETA[c.servicio].toLowerCase()}`) : 'Comprobante';
  const anulable = c?.tipo === 'factura' && c.estado === 'emitido' && c.saldo === c.total;

  return (
    <Modal
      wide
      title={titulo}
      description={c ? `${c.titular.nombre} · socio ${c.titular.numero} · ${nombreDeMes(c.anio, c.mes)}` : undefined}
      onClose={onClose}
      footer={
        c && !anulando ? (
          <>
            {puedeOperar && anulable && (
              <Button variant="ghost" icon={Ban} className="mr-auto" onClick={() => (anular.reset(), setMotivo(''), setAnulando(true))}>
                Anular con nota de crédito
              </Button>
            )}
            {!c.error && <PdfBoton id={c.id}>{c.estado === 'borrador' ? 'Ver cómo quedaría el PDF' : 'Ver PDF'}</PdfBoton>}
            {puedeOperar && c.estado === 'borrador' && c.rara && !c.revisada ? (
              <Button icon={CircleCheck} loading={revisar.isPending} onClick={() => revisar.mutate()}>
                {siguiente !== null ? 'Está bien, ver la siguiente' : 'Está bien'}
              </Button>
            ) : (
              <Button variant="secondary" onClick={onClose}>
                Cerrar
              </Button>
            )}
          </>
        ) : undefined
      }
    >
      {consulta.isPending ? (
        <div className="space-y-3">
          <Skeleton className="h-20" />
          <Skeleton className="h-72" />
        </div>
      ) : consulta.isError || !c ? (
        <ErrorState message={errorMessage(consulta.error)} onRetry={() => void consulta.refetch()} />
      ) : anulando ? (
        <form
          id="form-anular"
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            anular.mutate();
          }}
        >
          <p className="text-tinta">
            Se emite una nota de crédito por <strong className="tabular-nums">{formatMoney(c.total)}</strong> y la factura queda anulada: deja de figurar como deuda del socio. No se puede deshacer.
          </p>
          <div className="space-y-1.5">
            <label htmlFor="motivo-anular" className="block text-sm font-semibold text-tinta">
              ¿Por qué se anula?
            </label>
            <textarea
              id="motivo-anular"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={3}
              maxLength={200}
              autoFocus
              placeholder="Por ejemplo: lectura mal tomada, medidor 100021"
              className="block w-full rounded-xl border border-linea bg-superficie px-4 py-3 text-base text-tinta placeholder:text-tinta-suave/80 hover:border-marca-claro focus:border-marca"
            />
            <p className="text-sm text-tinta-suave">Queda impreso en la nota de crédito y en la auditoría.</p>
          </div>
          {anular.isError && <FormAlert>{anular.error instanceof ApiError && anular.error.fields?.motivo ? anular.error.fields.motivo : errorMessage(anular.error)}</FormAlert>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => setAnulando(false)}>
              Volver
            </Button>
            <Button type="submit" variant="danger" loading={anular.isPending}>
              Anular la factura
            </Button>
          </div>
        </form>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <EstadoBadge c={c} hoy={hoy} />
            {c.estimada && <Badge>Estimada</Badge>}
            {c.rara && <Badge tone={c.revisada ? 'neutral' : 'alerta'}>{c.revisada ? `${RARA_ETIQUETA[c.rara]} · revisada` : RARA_ETIQUETA[c.rara]}</Badge>}
            <span className="text-sm text-tinta-suave">
              {c.conexion.direccion}
              {c.conexion.zona && ` · ${c.conexion.zona}`}
              {c.categoria && ` · ${CATEGORIA_ETIQUETA[c.categoria]}${c.tieneSubsidio ? ' con subsidio' : ''}`}
              {c.plan && ` · ${c.plan}`}
            </span>
          </div>

          {c.error && (
            <FormAlert>
              No se pudo calcular: {c.error}. Corregilo y volvé a calcular las pre-facturas.
            </FormAlert>
          )}
          {c.motivo && (
            <p className="rounded-xl bg-fondo px-4 py-3 text-sm text-tinta">
              <strong>Motivo:</strong> {c.motivo}
            </p>
          )}
          {c.relacionado && (
            <p className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-fondo px-4 py-3 text-sm text-tinta">
              {c.tipo === 'nota_credito' ? 'Anula la factura' : 'Anulada por la nota de crédito'} <strong className="tabular-nums">{c.relacionado.referencia}</strong>
              <Button variant="secondary" onClick={() => alIr(c.relacionado!.id)}>
                Verla
              </Button>
            </p>
          )}

          {c.rara && c.estado === 'borrador' && <PorQueEsRara c={c} />}

          {c.lecturas.length > 0 && (
            <ul className="divide-y divide-linea rounded-2xl border border-linea">
              {c.lecturas.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
                  <span className="text-tinta-suave">Medidor {Number(l.medidor) || l.medidor}</span>
                  <span className="font-bold tabular-nums text-tinta">{l.valor !== null ? formatNumber(l.valor) : 'Sin lectura'}</span>
                  {l.anterior !== null && <span className="tabular-nums text-tinta-suave">anterior {formatNumber(l.anterior)}</span>}
                  {l.tipo === 'estimada' && <Badge tone="marca">Estimada</Badge>}
                  {l.motivo ? <Badge tone="alerta">{MOTIVO_ETIQUETA[l.motivo]}</Badge> : l.anomalia && <Badge tone="alerta">{ANOMALIA_ETIQUETA[l.anomalia]}</Badge>}
                  {l.novedad && <Badge tone="peligro">{NOVEDAD_ETIQUETA[l.novedad]}</Badge>}
                  {l.nota && <span className="text-tinta">“{l.nota}”</span>}
                  {l.tieneFoto && (
                    <Button variant="ghost" icon={Camera} className="ml-auto" onClick={() => setFoto(foto === l.id ? null : l.id)}>
                      {foto === l.id ? 'Ocultar la foto' : 'Ver la foto'}
                    </Button>
                  )}
                  {foto === l.id && <img src={`/api/v1/lecturas/${l.id}/foto`} alt="Foto que sacó el operario" className="mx-auto mt-2 max-h-80 w-full rounded-xl object-contain" />}
                </li>
              ))}
            </ul>
          )}

          {c.pagos.length > 0 && (
            <div className="rounded-2xl border border-linea">
              <p className="border-b border-linea px-4 py-2.5 text-sm font-bold text-tinta">
                Pagos{c.estado === 'emitido' && c.saldo !== c.total && <span className="font-normal text-tinta-suave"> · todavía debe {formatMoney(c.saldo)}</span>}
              </p>
              <ul className="divide-y divide-linea text-sm">
                {c.pagos.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                    <span className="tabular-nums text-tinta-suave">{formatDateTime(p.cobradoEl)}</span>
                    <span className="font-semibold tabular-nums text-tinta">{p.referencia}</span>
                    <span className="text-tinta-suave">{MEDIO_PAGO_ETIQUETA[p.medio]}</span>
                    {p.estado === 'anulado' && <Badge tone="peligro">Anulado</Badge>}
                    <span className={cn('ml-auto font-bold tabular-nums', p.estado === 'anulado' ? 'text-tinta-suave line-through' : 'text-tinta')}>{formatMoney(p.importe)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {c.calculo && <FacturaVista factura={c.calculo} />}
          {revisar.isError && <FormAlert>{errorMessage(revisar.error)}</FormAlert>}
        </div>
      )}
    </Modal>
  );
}

/** Explica, en una frase, por qué el sistema separó esta pre-factura. */
function PorQueEsRara({ c }: { c: ComprobanteDetalle }) {
  let texto: ReactNode;
  if (c.rara === 'variacion' && c.totalAnterior !== null && c.variacion !== null && c.calculo) {
    texto = (
      <>
        El mes pasado el servicio fue de <strong className="tabular-nums">{formatMoney(c.totalAnterior)}</strong> y este mes es de{' '}
        <strong className="tabular-nums">{formatMoney(c.calculo.totales.servicio)}</strong>: {c.variacion > 0 ? 'subió' : 'bajó'} un{' '}
        <strong className="tabular-nums">{formatNumber(Math.abs(c.variacion))} %</strong>. Mirá la lectura antes de emitir.
      </>
    );
  } else if (c.rara === 'importe_cero') {
    texto = 'El total da cero. Puede estar bien (un crédito a favor), pero conviene mirarlo.';
  } else if (c.rara === 'sin_lectura') {
    texto = 'El medidor no tiene lectura ni historial para estimar: se cobran solo los cargos fijos, sin consumo.';
  } else return null;
  return (
    <p className="flex items-start gap-2.5 rounded-xl bg-acento-tenue px-4 py-3 text-sm text-tinta">
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-alerta" aria-hidden />
      <span>{texto}</span>
    </p>
  );
}
