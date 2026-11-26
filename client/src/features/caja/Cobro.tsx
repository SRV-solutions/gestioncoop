// Cobrar en el mostrador (SPEC 5 y 6.6): todo con el teclado y en tres pasos.
//   1. Buscar: un solo campo —nombre, documento, socio, medidor o el código de barras de la factura—.
//   2. Cobrar: llega todo lo que debe ya elegido; se tipea con cuánto paga y Enter.
//   3. Recibo: el vuelto bien grande, imprimir, y al socio siguiente.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowLeft, ArrowUp, CircleCheck, Flame, Minus, Plus, ScanBarcode, SearchX, ShoppingBasket, UserRound } from 'lucide-react';
import {
  aCentavos,
  deCentavos,
  formatDate,
  formatDateTime,
  formatMoney,
  leerImporte,
  MEDIO_PAGO_ETIQUETA,
  MEDIO_PAGO_TECLA,
  MEDIOS_PAGO,
  nombreDeMes,
  repartirPago,
  SERVICIO_ETIQUETA,
  type CuentaSocio,
  type MedioPago,
  type ProductoVenta,
  type ReciboDetalle,
  type ResultadoBusqueda,
} from '@shared';
import { api, errorMessage, qs } from '../../lib/api';
import { cn } from '../../lib/cn';
import { SERVICIO_CORTO, SERVICIO_ICON } from '../../components/servicios';
import { Badge, Button, Card, Empty, ErrorState, FormAlert, Skeleton } from '../../components/ui';
import { BotonesRecibo, CampoImporte, documento, Kbd, plural, useDemorado } from './piezas';

type Fase = { paso: 'buscar' } | { paso: 'cuenta'; socioId: number | null; comprobanteId: number | null } | { paso: 'recibo'; recibo: ReciboDetalle };

/** Hay una ventana abierta encima (cerrar caja, un recibo): las teclas son de ella. */
const hayDialogo = () => document.querySelector('[role="dialog"]') !== null;
/** Lleva el foco ya mismo si el campo existe, y otra vez después del redibujo por si recién aparece. */
function enfocar(campo: () => HTMLElement | null) {
  campo()?.focus();
  requestAnimationFrame(() => campo()?.focus());
}

export function Cobro({ socioInicial }: { socioInicial: number | null }) {
  const [fase, setFase] = useState<Fase>(() => (socioInicial !== null ? { paso: 'cuenta', socioId: socioInicial, comprobanteId: null } : { paso: 'buscar' }));

  if (fase.paso === 'recibo') return <Cobrado recibo={fase.recibo} alSeguir={() => setFase({ paso: 'buscar' })} />;
  if (fase.paso === 'cuenta') {
    return (
      <Cuenta
        key={`${fase.socioId}-${fase.comprobanteId}`}
        socioId={fase.socioId}
        comprobanteId={fase.comprobanteId}
        alCobrar={(recibo) => setFase({ paso: 'recibo', recibo })}
        alCancelar={() => setFase({ paso: 'buscar' })}
      />
    );
  }
  return (
    <Buscar
      alElegir={(socioId, comprobanteId) => setFase({ paso: 'cuenta', socioId, comprobanteId })}
      alVender={() => setFase({ paso: 'cuenta', socioId: null, comprobanteId: null })}
    />
  );
}

/* ───────────────────────── 1. Buscar ───────────────────────── */

function Buscar({ alElegir, alVender }: { alElegir: (socioId: number, comprobanteId: number | null) => void; alVender: () => void }) {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [marcado, setMarcado] = useState(0);
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const texto = q.trim();
  const termino = useDemorado(texto, 180);
  const pedir = (t: string) => ({ queryKey: ['caja', 'buscar', t], queryFn: () => api.get<ResultadoBusqueda>(`/caja/buscar${qs({ q: t })}`), staleTime: 10_000 });
  const consulta = useQuery({ ...pedir(termino), enabled: termino.length >= 2, placeholderData: keepPreviousData });
  const visible = texto.length >= 2 ? consulta.data : undefined;
  /** Lo que se ve es el resultado de lo que está escrito ahora (y no el de hace un instante). */
  const alDia = visible !== undefined && termino === texto && !consulta.isPlaceholderData;
  const socios = visible?.socios ?? [];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'F4' || e.altKey || hayDialogo()) return;
      e.preventDefault();
      alVender();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [alVender]);

  /**
   * Enter: si lo escrito da un solo socio (o es un código de barras), lo abre aunque la lista
   * todavía no se haya dibujado —el lector tipea y manda Enter en un instante—. Con varios a la
   * vista, abre el que está marcado.
   */
  const alEnter = async () => {
    if (texto.length < 2 || buscando) return;
    setError(null);
    try {
      const aLaVista = alDia ? visible : undefined;
      if (!aLaVista) setBuscando(true);
      const r: ResultadoBusqueda = aLaVista ?? (await qc.fetchQuery<ResultadoBusqueda>(pedir(texto)));
      const elegido = r.comprobanteId !== null || r.socios.length === 1 ? r.socios[0] : aLaVista ? r.socios[marcado] : undefined;
      if (elegido) alElegir(elegido.id, r.comprobanteId);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBuscando(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <label htmlFor="buscar-socio" className="sr-only">
        Buscar socio o factura
      </label>
      <div className="relative">
        <ScanBarcode aria-hidden className="pointer-events-none absolute left-5 top-1/2 size-7 -translate-y-1/2 text-tinta-suave" />
        <input
          id="buscar-socio"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-expanded={socios.length > 0}
          aria-controls="resultados-socios"
          aria-activedescendant={socios[marcado] ? `socio-${socios[marcado].id}` : undefined}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setMarcado(0);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setMarcado((m) => Math.min(m + 1, Math.max(socios.length - 1, 0)));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setMarcado((m) => Math.max(m - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              void alEnter();
            } else if (e.key === 'Escape') {
              setQ('');
            }
          }}
          placeholder="Nombre, DNI, socio, medidor o código de barras"
          className="block min-h-[4.5rem] w-full rounded-2xl border-2 border-linea bg-superficie pl-16 pr-5 text-2xl font-semibold text-tinta shadow-sm transition-colors duration-150 placeholder:text-lg placeholder:font-normal placeholder:text-tinta-suave/80 hover:border-marca-claro focus:border-marca"
        />
      </div>

      <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-tinta-suave">
        <span className="inline-flex items-center gap-1.5">
          <Kbd>F2</Kbd> buscar
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Kbd>
            <ArrowUp className="size-3.5" aria-label="Flecha arriba" />
          </Kbd>
          <Kbd>
            <ArrowDown className="size-3.5" aria-label="Flecha abajo" />
          </Kbd>{' '}
          elegir
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Kbd>Enter</Kbd> abrir
        </span>
        <button type="button" onClick={alVender} className="inline-flex items-center gap-1.5 rounded-md font-semibold text-marca-texto hover:underline">
          <Kbd>F4</Kbd> venta de mostrador, sin socio
        </button>
      </p>

      <div className="mt-5" aria-live="polite">
        {error ? (
          <FormAlert>{error}</FormAlert>
        ) : texto.length < 2 ? (
          <Card>
            <Empty icon={ScanBarcode} title="Pasá el lector o empezá a escribir">
              Un solo campo sirve para todo: el apellido, el documento, el número de socio o de medidor, o el código de barras de la factura.
            </Empty>
          </Card>
        ) : consulta.isError ? (
          <Card>
            <ErrorState message={errorMessage(consulta.error)} onRetry={() => void consulta.refetch()} />
          </Card>
        ) : visible === undefined ? (
          <Card className="space-y-3 p-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </Card>
        ) : (
          <>
            {visible.aviso && (
              <p role="alert" className="mb-3 rounded-xl bg-alerta-tenue px-4 py-3 text-sm font-semibold text-alerta">
                {visible.aviso}
              </p>
            )}
            {socios.length === 0 ? (
              !visible.aviso && (
                <Card>
                  <Empty icon={SearchX} title="No encontramos a nadie">
                    Probá con el apellido solo, el documento sin puntos o el número de socio.
                  </Empty>
                </Card>
              )
            ) : (
              <Card className={cn('overflow-hidden transition-opacity duration-150', !alDia && 'opacity-60')}>
                <ul id="resultados-socios" role="listbox" aria-label="Socios encontrados" className="divide-y divide-linea">
                  {socios.map((s, i) => (
                    <li key={s.id} id={`socio-${s.id}`} role="option" aria-selected={i === marcado}>
                      <button
                        type="button"
                        tabIndex={-1}
                        onMouseEnter={() => setMarcado(i)}
                        onClick={() => alElegir(s.id, visible.comprobanteId)}
                        className={cn('flex w-full items-center gap-4 px-5 py-3 text-left transition-colors duration-100', i === marcado ? 'bg-marca-tenue' : 'hover:bg-marca-tenue/50')}
                      >
                        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-marca-tenue text-marca-texto">
                          <UserRound className="size-5" aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-lg font-bold text-tinta">{s.nombre}</span>
                          <span className="block truncate text-sm text-tinta-suave">
                            Socio {s.numero} · {documento(s.tipoDoc, s.nroDoc)}
                            {s.direccion && ` · ${s.direccion}`}
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          {s.pendientes === 0 ? (
                            <Badge tone="exito">Al día</Badge>
                          ) : (
                            <>
                              <span className={cn('block text-lg font-bold tabular-nums', s.vencidas > 0 ? 'text-peligro' : 'text-tinta')}>{formatMoney(s.deuda)}</span>
                              <span className="block text-xs text-tinta-suave">
                                {plural(s.pendientes, 'factura', 'facturas')}
                                {s.vencidas > 0 && ` · ${s.vencidas === s.pendientes ? 'vencidas' : `${s.vencidas} vencidas`}`}
                              </span>
                            </>
                          )}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ───────────────────────── 2. Cobrar ───────────────────────── */

interface CuentaProps {
  /** `null` = venta de mostrador a alguien que no es socio. */
  socioId: number | null;
  /** Si se llegó leyendo el código de barras de una factura: se cobra esa. */
  comprobanteId: number | null;
  alCobrar: (recibo: ReciboDetalle) => void;
  alCancelar: () => void;
}

function Cuenta({ socioId, comprobanteId, alCobrar, alCancelar }: CuentaProps) {
  // Sin caché: cada vez que se abre un socio se pregunta de nuevo cuánto debe.
  const cuenta = useQuery({ queryKey: ['caja', 'socio', socioId], queryFn: () => api.get<CuentaSocio>(`/caja/socios/${socioId}`), enabled: socioId !== null, gcTime: 0 });
  const productos = useQuery({ queryKey: ['caja', 'productos'], queryFn: () => api.get<ProductoVenta[]>('/caja/productos') });

  if ((socioId !== null && cuenta.isPending) || productos.isPending) {
    return (
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Skeleton className="h-80 rounded-2xl" />
        <Skeleton className="h-80 rounded-2xl" />
      </div>
    );
  }
  if (cuenta.isError || productos.isError) {
    return (
      <Card>
        <ErrorState message={errorMessage(cuenta.error ?? productos.error)} onRetry={() => void Promise.all([cuenta.refetch(), productos.refetch()])} />
        <p className="pb-8 text-center">
          <Button variant="ghost" icon={ArrowLeft} onClick={alCancelar}>
            Volver a buscar
          </Button>
        </p>
      </Card>
    );
  }
  return <Formulario cuenta={socioId === null ? null : (cuenta.data ?? null)} productos={productos.data ?? []} comprobanteId={comprobanteId} alCobrar={alCobrar} alCancelar={alCancelar} />;
}

interface FormularioProps {
  cuenta: CuentaSocio | null;
  productos: ProductoVenta[];
  comprobanteId: number | null;
  alCobrar: (recibo: ReciboDetalle) => void;
  alCancelar: () => void;
}

function Formulario({ cuenta, productos, comprobanteId, alCobrar, alCancelar }: FormularioProps) {
  const qc = useQueryClient();
  const pendientes = cuenta?.pendientes ?? [];
  const [elegidas, setElegidas] = useState<Set<number>>(
    () => new Set(comprobanteId !== null && pendientes.some((p) => p.id === comprobanteId) ? [comprobanteId] : pendientes.map((p) => p.id)),
  );
  // Vacío = se cobra todo lo elegido. Con un importe menor, es un pago parcial.
  const [importe, setImporte] = useState('');
  const [medio, setMedio] = useState<MedioPago>('efectivo');
  const [recibido, setRecibido] = useState('');
  const [referencia, setReferencia] = useState('');
  const [cantidades, setCantidades] = useState<Record<number, number>>({});
  const [conProductos, setConProductos] = useState(pendientes.length === 0);
  // Una clave por cobro: si el pedido sale dos veces, el servidor cobra una sola.
  const [clave] = useState(() => crypto.randomUUID());
  const form = useRef<HTMLFormElement>(null);
  const campoRecibido = useRef<HTMLInputElement>(null);
  const botonCobrar = useRef<HTMLButtonElement>(null);

  /* Las cuentas van en centavos (enteros): nada de decimales flotantes con la plata. */
  const aCobrar = pendientes.filter((p) => elegidas.has(p.id));
  const totalElegido = aCobrar.reduce((t, p) => t + aCentavos(p.saldo), 0);
  const importeLeido = importe.trim() ? leerImporte(importe) : null;
  const parcial = importe.trim() !== '';
  const paraFacturas = parcial ? (importeLeido !== null ? aCentavos(importeLeido) : 0) : totalElegido;
  const errorImporte = !parcial
    ? null
    : importeLeido === null
      ? 'Escribí un importe, por ejemplo 15000'
      : paraFacturas > totalElegido
        ? `Lo elegido suma ${formatMoney(deCentavos(totalElegido))}: no se puede cobrar más`
        : paraFacturas === 0
          ? 'Tiene que ser mayor a cero'
          : null;
  const reparto = new Map(repartirPago(paraFacturas, aCobrar.map((p) => ({ id: p.id, saldo: aCentavos(p.saldo) }))).map((a) => [a.comprobanteId, a.importe]));
  const quedaDebiendo = totalElegido - paraFacturas;

  const items = productos.filter((p) => (cantidades[p.id] ?? 0) > 0).map((p) => ({ producto: p, cantidad: cantidades[p.id]! }));
  const totalProductos = items.reduce((t, i) => t + aCentavos(i.producto.precio) * i.cantidad, 0);
  const total = paraFacturas + totalProductos;

  const recibidoLeido = recibido.trim() ? leerImporte(recibido) : null;
  const vuelto = recibidoLeido !== null ? aCentavos(recibidoLeido) - total : null;
  const errorRecibido = medio !== 'efectivo' || !recibido.trim() ? null : recibidoLeido === null ? 'Escribí un importe, por ejemplo 50000' : vuelto! < 0 ? `No alcanza: faltan ${formatMoney(deCentavos(-vuelto!))}` : null;
  const puede = total > 0 && !errorImporte && !errorRecibido;

  const cobrar = useMutation({
    mutationFn: () =>
      api.post<ReciboDetalle>('/caja/cobros', {
        clave,
        socioId: cuenta?.socio.id ?? null,
        aplicaciones: [...reparto].map(([comprobanteId, centavos]) => ({ comprobanteId, importe: deCentavos(centavos) })),
        items: items.map((i) => ({ productoId: i.producto.id, cantidad: i.cantidad })),
        medio,
        recibido: medio === 'efectivo' && recibidoLeido !== null ? recibidoLeido : undefined,
        referencia: medio !== 'efectivo' && referencia.trim() ? referencia.trim() : undefined,
      }),
    onSuccess: (recibo) => {
      void qc.invalidateQueries({ queryKey: ['caja'] });
      alCobrar(recibo);
    },
    // Si algo cambió mientras tanto (otro cajero cobró esa factura), se vuelve a traer la cuenta.
    onError: () => void qc.invalidateQueries({ queryKey: ['caja', 'socio'] }),
  });
  const enviando = cobrar.isPending;

  const elegirMedio = (m: MedioPago) => {
    setMedio(m);
    // En efectivo, el foco va a «con cuánto paga». Con los demás, al botón: Enter cobra y las letras siguen cambiando el medio.
    enfocar(() => (m === 'efectivo' ? campoRecibido.current : botonCobrar.current));
  };
  const elegir = (id: number, si: boolean) => {
    setElegidas((actual) => {
      const nuevo = new Set(actual);
      if (si) nuevo.add(id);
      else nuevo.delete(id);
      return nuevo;
    });
    setImporte('');
  };
  const cantidad = (p: ProductoVenta, n: number) => setCantidades((c) => ({ ...c, [p.id]: Math.max(0, Math.min(n, p.stock ?? 99, 99)) }));

  // Teclas de la pantalla de cobro: Esc cancela, Enter cobra, una letra elige el medio de pago.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || hayDialogo()) return;
      const el = e.target instanceof HTMLElement ? e.target : null;
      if (e.key === 'Escape') {
        e.preventDefault();
        if (!enviando) alCancelar();
        return;
      }
      if (e.key === 'Enter') {
        // En un campo de texto o sobre un botón, Enter ya hace lo suyo. Desde una casilla o desde la página, cobra.
        const propio = el instanceof HTMLButtonElement || el instanceof HTMLAnchorElement || (el instanceof HTMLInputElement && el.type !== 'checkbox' && el.type !== 'radio');
        if (propio) return;
        e.preventDefault();
        form.current?.requestSubmit();
        return;
      }
      if (e.key.length !== 1 || (el instanceof HTMLInputElement && el.dataset.letras !== undefined)) return;
      const letra = e.key.toUpperCase();
      const m = MEDIOS_PAGO.find((x) => MEDIO_PAGO_TECLA[x] === letra);
      if (m) {
        e.preventDefault();
        setMedio(m);
        enfocar(() => (m === 'efectivo' ? campoRecibido.current : botonCobrar.current));
      } else if (letra === 'G' && productos.length > 0) {
        e.preventDefault();
        setConProductos((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [alCancelar, enviando, productos.length]);

  const alEnviar = (e: FormEvent) => {
    e.preventDefault();
    if (puede && !enviando) cobrar.mutate();
  };

  const variasDirecciones = new Set(pendientes.map((p) => p.direccion)).size > 1;
  const hayVencidas = aCobrar.some((p) => p.diasAtraso > 0);
  const ultimoPago = cuenta?.ultimosPagos.find((p) => p.estado === 'acreditado');

  return (
    <form ref={form} onSubmit={alEnviar} noValidate className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="space-y-4">
        {/* ── Quién paga ── */}
        <Card className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-marca-tenue text-marca-texto">{cuenta ? <UserRound className="size-6" aria-hidden /> : <ShoppingBasket className="size-6" aria-hidden />}</span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-xl font-bold leading-tight text-tinta">{cuenta ? cuenta.socio.nombre : 'Venta de mostrador'}</h2>
            <p className="truncate text-sm text-tinta-suave">
              {cuenta
                ? [`Socio ${cuenta.socio.numero}`, documento(cuenta.socio.tipoDoc, cuenta.socio.nroDoc), cuenta.socio.direccion, cuenta.socio.telefono].filter(Boolean).join(' · ')
                : 'A alguien que no es socio: el recibo sale sin nombre.'}
            </p>
            {ultimoPago && (
              <p className="mt-0.5 truncate text-sm text-tinta-suave">
                Último pago: {formatDateTime(ultimoPago.cobradoEl)} · {formatMoney(ultimoPago.importe)} · {MEDIO_PAGO_ETIQUETA[ultimoPago.medio].toLowerCase()}
              </p>
            )}
          </div>
          {cuenta && pendientes.length > 0 && (
            <div className="text-right">
              <p className="text-xs font-semibold uppercase tracking-wide text-tinta-suave">Debe en total</p>
              <p className="text-xl font-bold tabular-nums text-tinta">{formatMoney(cuenta.deuda)}</p>
            </div>
          )}
        </Card>

        {/* ── Qué paga ── */}
        {cuenta && (
          <Card className="overflow-hidden">
            {pendientes.length === 0 ? (
              <Empty icon={CircleCheck} title="Está al día" className="py-8">
                No tiene facturas pendientes.{productos.length > 0 && ' Si viene a comprar algo, cargalo acá abajo.'}
              </Empty>
            ) : (
              <>
                <div className="flex items-center justify-between gap-3 border-b border-linea px-4 py-2.5">
                  <label className="flex min-h-9 cursor-pointer items-center gap-3 text-sm font-semibold text-tinta">
                    <input
                      type="checkbox"
                      className="size-5 shrink-0 rounded accent-(--marca)"
                      checked={aCobrar.length === pendientes.length}
                      ref={(el) => {
                        if (el) el.indeterminate = aCobrar.length > 0 && aCobrar.length < pendientes.length;
                      }}
                      onChange={(e) => {
                        setElegidas(new Set(e.target.checked ? pendientes.map((p) => p.id) : []));
                        setImporte('');
                      }}
                    />
                    {aCobrar.length === pendientes.length ? `Paga las ${pendientes.length === 1 ? 'única' : pendientes.length}` : `Paga ${aCobrar.length} de ${pendientes.length}`}
                  </label>
                  <span className="hidden items-center gap-1.5 text-xs text-tinta-suave sm:inline-flex">
                    <Kbd>Tab</Kbd> moverse <Kbd>Espacio</Kbd> marcar
                  </span>
                </div>
                <ul className="divide-y divide-linea">
                  {pendientes.map((p) => {
                    const Icon = SERVICIO_ICON[p.servicio];
                    const elegida = elegidas.has(p.id);
                    const seCobra = reparto.get(p.id) ?? 0;
                    return (
                      <li key={p.id}>
                        <label className={cn('flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors duration-100', elegida ? 'bg-marca-tenue/45' : 'hover:bg-marca-tenue/30')}>
                          <input type="checkbox" className="size-5 shrink-0 rounded accent-(--marca)" checked={elegida} onChange={(e) => elegir(p.id, e.target.checked)} />
                          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-marca-tenue text-marca-texto">
                            <Icon className="size-[1.125rem]" aria-hidden />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                              <span className="font-semibold text-tinta">
                                {SERVICIO_CORTO[p.servicio]} · {nombreDeMes(p.anio, p.mes)}
                              </span>
                              {p.diasAtraso > 0 ? <Badge tone="peligro">Vencida hace {plural(p.diasAtraso, 'día', 'días')}</Badge> : <Badge tone="alerta">Vence el {formatDate(p.venceEl)}</Badge>}
                            </span>
                            <span className="block truncate text-sm text-tinta-suave">
                              {p.referencia}
                              {variasDirecciones && p.direccion && ` · ${p.direccion}`}
                              {p.saldo !== p.total && ` · ya pagó ${formatMoney(deCentavos(aCentavos(p.total) - aCentavos(p.saldo)))}`}
                            </span>
                          </span>
                          <span className="shrink-0 text-right">
                            <span className={cn('block text-lg font-bold tabular-nums', elegida ? 'text-tinta' : 'text-tinta-suave')}>{formatMoney(p.saldo)}</span>
                            {elegida && parcial && !errorImporte && seCobra < aCentavos(p.saldo) && (
                              <span className="block text-xs font-semibold text-alerta">{seCobra === 0 ? 'no llega' : `se cobran ${formatMoney(deCentavos(seCobra))}`}</span>
                            )}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
                <div className="grid gap-x-5 gap-y-2 border-t border-linea px-4 py-3.5 sm:grid-cols-[minmax(0,14rem)_1fr] sm:items-center">
                  <CampoImporte
                    label="¿Paga solo una parte?"
                    value={importe}
                    onChange={setImporte}
                    error={errorImporte}
                    placeholder={aCobrar.length ? formatMoney(deCentavos(totalElegido)).replace('$ ', '') : '0'}
                    disabled={aCobrar.length === 0}
                  />
                  <p className="text-sm text-tinta-suave sm:pt-6">
                    {parcial && !errorImporte
                      ? `Pago parcial: de lo elegido queda debiendo ${formatMoney(deCentavos(quedaDebiendo))}.`
                      : 'Dejalo vacío para cobrar todo lo marcado. Si escribís menos, se aplica desde la factura más vieja.'}
                    {hayVencidas && ' Lo vencido suma su recargo en la próxima factura.'}
                  </p>
                </div>
              </>
            )}
          </Card>
        )}

        {/* ── Gas y otros conceptos ── */}
        {productos.length > 0 && (
          <Card className="overflow-hidden">
            <button
              type="button"
              aria-expanded={conProductos}
              onClick={() => setConProductos((v) => !v)}
              className="flex min-h-12 w-full items-center gap-3 px-4 text-left font-semibold text-tinta transition-colors duration-100 hover:bg-marca-tenue/30"
            >
              <Flame className="size-5 shrink-0 text-marca-texto" aria-hidden />
              <span className="flex-1">Gas y otros conceptos{totalProductos > 0 && <span className="ml-2 font-bold tabular-nums text-marca-texto">{formatMoney(deCentavos(totalProductos))}</span>}</span>
              <Kbd>G</Kbd>
            </button>
            {conProductos && (
              <ul className="divide-y divide-linea border-t border-linea">
                {productos.map((p, i) => {
                  const n = cantidades[p.id] ?? 0;
                  const agotado = p.stock === 0;
                  return (
                    <li key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold text-tinta">{p.nombre}</span>
                        <span className="block text-sm text-tinta-suave">
                          {formatMoney(p.precio)}
                          {p.stock !== null && (agotado ? ' · sin stock' : ` · quedan ${p.stock}`)}
                        </span>
                      </span>
                      <span className="flex items-center gap-1.5">
                        <button
                          type="button"
                          tabIndex={-1}
                          aria-label={`Quitar una unidad de ${p.nombre}`}
                          disabled={n === 0}
                          onClick={() => cantidad(p, n - 1)}
                          className="grid size-10 place-items-center rounded-lg border border-linea text-tinta-suave hover:border-marca hover:text-marca-texto disabled:opacity-40"
                        >
                          <Minus className="size-4" aria-hidden />
                        </button>
                        <input
                          type="number"
                          min={0}
                          max={p.stock ?? 99}
                          aria-label={`Cantidad de ${p.nombre}`}
                          autoFocus={i === 0 && pendientes.length === 0}
                          disabled={agotado}
                          value={n === 0 ? '' : n}
                          placeholder="0"
                          onChange={(e) => cantidad(p, Math.floor(Number(e.target.value) || 0))}
                          className="min-h-10 w-16 rounded-lg border border-linea bg-superficie px-2 text-center text-lg font-bold tabular-nums text-tinta hover:border-marca-claro focus:border-marca disabled:opacity-50"
                        />
                        <button
                          type="button"
                          tabIndex={-1}
                          aria-label={`Agregar una unidad de ${p.nombre}`}
                          disabled={agotado || n >= (p.stock ?? 99)}
                          onClick={() => cantidad(p, n + 1)}
                          className="grid size-10 place-items-center rounded-lg border border-linea text-tinta-suave hover:border-marca hover:text-marca-texto disabled:opacity-40"
                        >
                          <Plus className="size-4" aria-hidden />
                        </button>
                      </span>
                      <span className="w-28 shrink-0 text-right text-lg font-bold tabular-nums text-tinta">{n > 0 ? formatMoney(deCentavos(aCentavos(p.precio) * n)) : ''}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        )}
      </div>

      {/* ── Cuánto y cómo ── */}
      <Card className="space-y-5 p-5 lg:sticky lg:top-6">
        <div>
          <p className="text-sm font-semibold text-tinta-suave">Total a cobrar</p>
          <p className="text-4xl font-bold tabular-nums tracking-tight text-tinta">{formatMoney(deCentavos(total))}</p>
          <p className="mt-0.5 text-sm text-tinta-suave">
            {[reparto.size > 0 ? plural(reparto.size, 'factura', 'facturas') : null, items.length > 0 ? plural(items.reduce((n, i) => n + i.cantidad, 0), 'producto', 'productos') : null].filter(Boolean).join(' + ') ||
              'Marcá una factura o cargá un producto'}
          </p>
        </div>

        <fieldset>
          <legend className="mb-1.5 text-sm font-semibold text-tinta">Medio de pago</legend>
          <div className="grid grid-cols-2 gap-1.5">
            {MEDIOS_PAGO.map((m) => (
              <label
                key={m}
                className={cn(
                  'flex min-h-11 cursor-pointer items-center justify-between gap-2 rounded-xl border px-3 text-[0.9375rem] font-semibold transition-colors duration-100',
                  'has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-marca-claro',
                  m === 'efectivo' && 'col-span-2',
                  medio === m ? 'border-marca bg-marca-tenue text-marca-texto' : 'border-linea text-tinta hover:border-marca-claro',
                )}
              >
                <input type="radio" name="medio" value={m} checked={medio === m} onChange={() => elegirMedio(m)} className="sr-only" />
                {MEDIO_PAGO_ETIQUETA[m]}
                <Kbd>{MEDIO_PAGO_TECLA[m]}</Kbd>
              </label>
            ))}
          </div>
        </fieldset>

        {medio === 'efectivo' ? (
          <>
            <CampoImporte
              ref={campoRecibido}
              grande
              label="¿Con cuánto paga?"
              value={recibido}
              onChange={setRecibido}
              error={errorRecibido}
              hint="Vacío = paga justo."
              autoFocus={pendientes.length > 0}
              placeholder={total > 0 ? formatMoney(deCentavos(total)).replace('$ ', '') : '0'}
            />
            <div className={cn('rounded-2xl px-4 py-3', vuelto !== null && vuelto > 0 ? 'bg-exito-tenue' : 'bg-fondo')} aria-live="polite">
              <p className="text-sm font-semibold text-tinta-suave">Vuelto</p>
              <p className={cn('text-3xl font-bold tabular-nums', vuelto !== null && vuelto > 0 ? 'text-exito' : 'text-tinta-suave')}>{formatMoney(deCentavos(Math.max(vuelto ?? 0, 0)))}</p>
            </div>
          </>
        ) : (
          <div className="space-y-1.5">
            <label htmlFor="referencia-pago" className="block text-sm font-semibold text-tinta">
              N° de operación o cupón <span className="font-normal text-tinta-suave">(opcional)</span>
            </label>
            <input
              id="referencia-pago"
              data-letras
              autoComplete="off"
              maxLength={60}
              value={referencia}
              onChange={(e) => setReferencia(e.target.value)}
              className="block min-h-12 w-full rounded-xl border border-linea bg-superficie px-4 text-base text-tinta hover:border-marca-claro focus:border-marca"
            />
            <p className="text-sm text-tinta-suave">Sale impreso en el recibo. No va al cajón: no cuenta para el arqueo.</p>
          </div>
        )}

        {cobrar.isError && <FormAlert>{errorMessage(cobrar.error)}</FormAlert>}

        <div className="space-y-2">
          <Button ref={botonCobrar} type="submit" size="xl" loading={enviando} disabled={!puede} className="w-full">
            Cobrar {total > 0 && formatMoney(deCentavos(total))}
            <Kbd className="border-white/30 bg-white/15 text-white">Enter</Kbd>
          </Button>
          <Button variant="ghost" className="w-full" disabled={enviando} onClick={alCancelar}>
            Cancelar <Kbd>Esc</Kbd>
          </Button>
        </div>
      </Card>
    </form>
  );
}

/* ───────────────────────── 3. Recibo ───────────────────────── */

function Cobrado({ recibo: r, alSeguir }: { recibo: ReciboDetalle; alSeguir: () => void }) {
  // T y A imprimen; Enter (o F2, que maneja la página) pasa al socio siguiente.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || hayDialogo()) return;
      const letra = e.key.toUpperCase();
      if (letra === 'T' || letra === 'A') {
        e.preventDefault();
        document.querySelector<HTMLButtonElement>(`[data-recibo="${letra === 'T' ? 'ticket' : 'a4'}"]`)?.click();
      } else if (e.key === 'Escape' || (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement))) {
        e.preventDefault();
        alSeguir();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [alSeguir]);

  const vuelto = r.vuelto !== null && Number(r.vuelto) > 0 ? r.vuelto : null;
  return (
    <Card className="mx-auto max-w-2xl px-6 py-8 text-center">
      <div role="status" aria-live="polite">
        <div className="mx-auto grid size-16 place-items-center rounded-full bg-exito-tenue text-exito">
          <CircleCheck className="size-9" aria-hidden />
        </div>
        <h2 className="mt-4 text-2xl font-bold text-tinta">Cobrado {formatMoney(r.importe)}</h2>
        <p className="mt-1 text-tinta-suave">
          {r.titular ? r.titular.nombre : 'Venta de mostrador'} · {MEDIO_PAGO_ETIQUETA[r.medio].toLowerCase()} · <span className="font-semibold tabular-nums text-tinta">{r.referencia}</span>
        </p>
        {vuelto && (
          <div className="mx-auto mt-5 max-w-sm rounded-2xl bg-acento-tenue px-5 py-4">
            <p className="text-sm font-semibold uppercase tracking-wide text-tinta-suave">Dale de vuelto</p>
            <p className="text-5xl font-bold tabular-nums tracking-tight text-tinta">{formatMoney(vuelto)}</p>
            <p className="mt-1 text-sm text-tinta-suave">Pagó con {formatMoney(r.recibido!)}</p>
          </div>
        )}
      </div>

      <ul className="mx-auto mt-6 max-w-md divide-y divide-linea rounded-2xl border border-linea text-left text-sm">
        {r.aplicaciones.map((a) => (
          <li key={a.comprobanteId} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <span className="min-w-0">
              <span className="block font-semibold text-tinta">
                {SERVICIO_ETIQUETA[a.servicio]} · {nombreDeMes(a.anio, a.mes)}
              </span>
              <span className="block text-tinta-suave">
                {a.referencia}
                {Number(a.saldoDespues) > 0 && ` · pago parcial, resta ${formatMoney(a.saldoDespues)}`}
              </span>
            </span>
            <span className="shrink-0 font-bold tabular-nums text-tinta">{formatMoney(a.importe)}</span>
          </li>
        ))}
        {r.items.map((i) => (
          <li key={i.descripcion} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <span className="font-semibold text-tinta">
              {i.cantidad > 1 && `${i.cantidad} × `}
              {i.descripcion}
            </span>
            <span className="shrink-0 font-bold tabular-nums text-tinta">{formatMoney(i.importe)}</span>
          </li>
        ))}
      </ul>

      <div className="mt-7 flex flex-wrap items-start justify-center gap-3">
        <BotonesRecibo id={r.id} principal />
        <Button size="lg" autoFocus onClick={alSeguir}>
          Otro cobro <Kbd className="border-white/30 bg-white/15 text-white">Enter</Kbd>
        </Button>
      </div>
    </Card>
  );
}
