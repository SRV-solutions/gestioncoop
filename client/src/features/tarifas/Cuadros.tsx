// Cuadros tarifarios: qué se cobra por cada servicio y categoría, desde cuándo, y su historial.
// Un cuadro no se edita: «Nueva versión» crea otro que rige desde una fecha y cierra el anterior.
import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { CalendarClock, History, Layers, Plus, Trash2 } from 'lucide-react';
import {
  CATEGORIA_ETIQUETA,
  CATEGORIAS,
  etiquetaEscalon,
  formatDate,
  formatMoney,
  formatPrecio,
  SERVICIOS_CON_CUADRO,
  UNIDAD_SERVICIO,
  type Categoria,
  type CuadroDetalle,
  type CuadroNuevoInput,
  type ServicioConCuadro,
  type TarifasResumen,
} from '@shared';
import { api, ApiError, errorMessage } from '../../lib/api';
import { cn } from '../../lib/cn';
import { Confirm, Modal } from '../../components/Modal';
import { SERVICIO_CORTO, SERVICIO_ICON } from '../../components/servicios';
import { Badge, Button, Card, Check, Empty, Field, FormAlert, SelectField } from '../../components/ui';

interface Props {
  datos: TarifasResumen;
  puedeEditar: boolean;
  /** Vuelve a pedir las tarifas después de un cambio. */
  alCambiar: () => void;
}

interface Grupo {
  clave: string;
  categoria: Categoria | null;
  conSubsidio: boolean;
  vigente: CuadroDetalle | null;
  futuros: CuadroDetalle[];
  anteriores: CuadroDetalle[];
}

/** Junta las versiones de cada categoría: la que rige hoy, las que vienen y las que ya pasaron. */
function agrupar(cuadros: CuadroDetalle[], hoy: string): Grupo[] {
  const grupos = new Map<string, Grupo>();
  for (const c of cuadros) {
    const clave = `${c.categoria ?? ''}|${c.conSubsidio}`;
    const g = grupos.get(clave) ?? { clave, categoria: c.categoria, conSubsidio: c.conSubsidio, vigente: null, futuros: [], anteriores: [] };
    if (c.futuro) g.futuros.push(c);
    else if (c.vigenteHasta === null || c.vigenteHasta >= hoy) g.vigente = c;
    else g.anteriores.push(c);
    grupos.set(clave, g);
  }
  const orden = (g: Grupo) => (g.categoria ? CATEGORIAS.indexOf(g.categoria) : 0) * 2 + (g.conSubsidio ? 0 : 1);
  return [...grupos.values()]
    .map((g) => ({ ...g, futuros: g.futuros.sort((a, b) => a.vigenteDesde.localeCompare(b.vigenteDesde)) }))
    .sort((a, b) => orden(a) - orden(b));
}

function nombreDe(g: Pick<Grupo, 'categoria' | 'conSubsidio'>, servicio: ServicioConCuadro, hayAmbos: boolean): string {
  if (!g.categoria) return SERVICIO_CORTO[servicio];
  const base = CATEGORIA_ETIQUETA[g.categoria];
  return g.conSubsidio ? `${base} con subsidio` : hayAmbos ? `${base} sin subsidio` : base;
}

interface Opcion {
  clave: string;
  categoria: Categoria;
  conSubsidio: boolean;
}

/** Categorías que todavía no tienen cuadro en ese servicio (en energía, cada una con y sin subsidio). */
function categoriasLibres(servicio: ServicioConCuadro, usadas: string[]): Opcion[] {
  return CATEGORIAS.flatMap((categoria) => (servicio === 'energia' && categoria === 'residencial' ? [true, false] : [false]).map((conSubsidio) => ({ clave: `${categoria}|${conSubsidio}`, categoria, conSubsidio }))).filter(
    (o) => !usadas.includes(o.clave),
  );
}

export function Cuadros({ datos, puedeEditar, alCambiar }: Props) {
  const conCuadros = SERVICIOS_CON_CUADRO.filter((s) => datos.cuadros.some((c) => c.servicio === s));
  const [servicio, setServicio] = useState<ServicioConCuadro>(conCuadros[0] ?? 'energia');
  const [dialogo, setDialogo] = useState<{ base: CuadroDetalle | null; grupo: Grupo | null } | null>(null);
  const [aBorrar, setABorrar] = useState<CuadroDetalle | null>(null);

  const grupos = agrupar(datos.cuadros.filter((c) => c.servicio === servicio), datos.hoy);
  const nombreConcepto = (codigo: string) => datos.conceptos.find((c) => c.codigo === codigo)?.nombre ?? codigo;
  const libres = categoriasLibres(servicio, grupos.map((g) => g.clave));

  const borrar = useMutation({
    mutationFn: (id: number) => api.del(`/tarifas/cuadros/${id}`),
    onSuccess: () => {
      setABorrar(null);
      alCambiar();
    },
  });

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Servicio" className="flex flex-wrap gap-2">
          {(conCuadros.length ? conCuadros : SERVICIOS_CON_CUADRO).map((s) => {
            const Icon = SERVICIO_ICON[s];
            return (
              <button
                key={s}
                type="button"
                aria-pressed={servicio === s}
                onClick={() => setServicio(s)}
                className={cn(
                  'inline-flex min-h-11 items-center gap-2 rounded-xl border px-3.5 text-[0.9375rem] font-semibold transition-colors duration-150',
                  servicio === s ? 'border-marca bg-marca text-white' : 'border-linea bg-superficie text-tinta hover:border-marca hover:text-marca-texto',
                )}
              >
                <Icon className="size-4" aria-hidden />
                {SERVICIO_CORTO[s]}
              </button>
            );
          })}
        </div>
        {puedeEditar && servicio !== 'sepelio' && libres.length > 0 && (
          <Button variant="secondary" icon={Plus} onClick={() => setDialogo({ base: null, grupo: null })}>
            Agregar categoría
          </Button>
        )}
      </div>

      {grupos.length === 0 ? (
        <Card>
          <Empty
            icon={Layers}
            title="Todavía no hay cuadros para este servicio"
            action={
              puedeEditar ? (
                <Button icon={Plus} onClick={() => setDialogo({ base: null, grupo: null })}>
                  Cargar el primero
                </Button>
              ) : undefined
            }
          >
            Un cuadro define la cuota fija y el precio de cada escalón de consumo.
          </Empty>
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {grupos.map((g) => (
            <TarjetaGrupo
              key={g.clave}
              grupo={g}
              servicio={servicio}
              titulo={nombreDe(g, servicio, grupos.some((o) => o.categoria === g.categoria && o.conSubsidio !== g.conSubsidio))}
              puedeEditar={puedeEditar}
              nombreConcepto={nombreConcepto}
              alVersionar={() => setDialogo({ base: g.futuros.at(-1) ?? g.vigente ?? g.anteriores[0] ?? null, grupo: g })}
              alBorrar={setABorrar}
            />
          ))}
        </div>
      )}

      {dialogo && (
        <CuadroDialog
          servicio={servicio}
          base={dialogo.base}
          hoy={datos.hoy}
          libres={libres}
          onClose={() => setDialogo(null)}
          onSaved={() => {
            setDialogo(null);
            alCambiar();
          }}
        />
      )}

      {aBorrar && (
        <Confirm
          title="¿Borrar esta versión?"
          confirmLabel="Borrar"
          loading={borrar.isPending}
          error={borrar.isError ? errorMessage(borrar.error) : null}
          onConfirm={() => borrar.mutate(aBorrar.id)}
          onClose={() => {
            setABorrar(null);
            borrar.reset();
          }}
        >
          <p>
            Es la tarifa que iba a regir desde el <strong>{formatDate(aBorrar.vigenteDesde)}</strong>. Como todavía no entró en vigencia, se puede borrar: la
            tarifa actual sigue rigiendo sin fecha de fin.
          </p>
        </Confirm>
      )}
    </>
  );
}

/* ───────────────────────── Una categoría ───────────────────────── */

interface TarjetaProps {
  grupo: Grupo;
  servicio: ServicioConCuadro;
  titulo: string;
  puedeEditar: boolean;
  nombreConcepto: (codigo: string) => string;
  alVersionar: () => void;
  alBorrar: (c: CuadroDetalle) => void;
}

function TarjetaGrupo({ grupo: g, servicio, titulo, puedeEditar, nombreConcepto, alVersionar, alBorrar }: TarjetaProps) {
  const [verHistorial, setVerHistorial] = useState(false);
  return (
    <Card className="flex flex-col overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-linea px-5 py-3.5">
        <h3 className="text-lg font-bold text-tinta">{titulo}</h3>
        {g.vigente ? <Badge tone="exito">Rige desde el {formatDate(g.vigente.vigenteDesde)}</Badge> : <Badge tone="alerta">Sin tarifa vigente hoy</Badge>}
      </header>

      {g.vigente && <TablaCuadro cuadro={g.vigente} servicio={servicio} nombreConcepto={nombreConcepto} />}

      {g.futuros.map((c) => (
        <div key={c.id} className="border-t border-linea bg-acento-tenue/40">
          <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-tinta">
              <CalendarClock className="size-4 text-alerta" aria-hidden />
              Desde el {formatDate(c.vigenteDesde)} va a regir:
            </p>
            {puedeEditar && (
              <Button variant="ghost" icon={Trash2} onClick={() => alBorrar(c)}>
                Borrar
              </Button>
            )}
          </div>
          <TablaCuadro cuadro={c} servicio={servicio} nombreConcepto={nombreConcepto} />
        </div>
      ))}

      {verHistorial &&
        g.anteriores.map((c) => (
          <div key={c.id} className="border-t border-linea bg-fondo/60">
            <p className="px-5 pt-3 text-sm font-semibold text-tinta-suave">
              Del {formatDate(c.vigenteDesde)} al {c.vigenteHasta ? formatDate(c.vigenteHasta) : '—'}
            </p>
            <TablaCuadro cuadro={c} servicio={servicio} nombreConcepto={nombreConcepto} apagado />
          </div>
        ))}

      <footer className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-linea px-3 py-2">
        {g.anteriores.length > 0 ? (
          <Button variant="ghost" icon={History} aria-expanded={verHistorial} onClick={() => setVerHistorial((v) => !v)}>
            {verHistorial ? 'Ocultar versiones anteriores' : `Versiones anteriores (${g.anteriores.length})`}
          </Button>
        ) : (
          <span />
        )}
        {puedeEditar && (
          <Button variant="secondary" icon={Plus} onClick={alVersionar}>
            Nueva versión
          </Button>
        )}
      </footer>
    </Card>
  );
}

function TablaCuadro({
  cuadro: c,
  servicio,
  nombreConcepto,
  apagado,
}: {
  cuadro: CuadroDetalle;
  servicio: ServicioConCuadro;
  nombreConcepto: (codigo: string) => string;
  apagado?: boolean;
}) {
  const unidad = UNIDAD_SERVICIO[servicio];
  const esSepelio = servicio === 'sepelio';
  return (
    <dl className={cn('divide-y divide-linea/70 px-5 py-2', apagado && 'text-tinta-suave')}>
      <div className="flex items-baseline justify-between gap-4 py-2">
        <dt>{esSepelio ? 'Cuota del titular' : 'Cuota fija'}</dt>
        <dd className="font-semibold tabular-nums">{formatMoney(c.cargoFijo)}</dd>
      </div>
      {c.escalones.map((e) => (
        <div key={e.desde} className="flex items-baseline justify-between gap-4 py-2">
          <dt className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {esSepelio ? 'Por cada adherente' : etiquetaEscalon(e, unidad)}
            {e.subsidiado && <Badge tone="exito">Subsidiado</Badge>}
            {e.exentoDe.map((codigo) => (
              <Badge key={codigo} tone="alerta">
                No paga {nombreConcepto(codigo)}
              </Badge>
            ))}
          </dt>
          <dd className="shrink-0 font-semibold tabular-nums">
            {formatPrecio(e.precio)}
            {!esSepelio && <span className="font-normal text-tinta-suave"> / {unidad}</span>}
          </dd>
        </div>
      ))}
      {c.nota && c.nota !== 'Carga inicial' && <p className="py-2 text-sm text-tinta-suave">Nota: {c.nota}</p>}
    </dl>
  );
}

/* ───────────────────────── Nueva versión ───────────────────────── */

interface Fila {
  hasta: string;
  precio: string;
  subsidiado: boolean;
  exentoDe: string[];
}

const aNumero = (v: string) => Number(v.trim().replace(',', '.'));
/** Primer día del mes que viene. */
function mesQueViene(hoy: string): string {
  const d = new Date(Date.UTC(Number(hoy.slice(0, 4)), Number(hoy.slice(5, 7)), 1));
  return d.toISOString().slice(0, 10);
}
const diaSiguiente = (fecha: string) => new Date(new Date(`${fecha}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);

interface DialogProps {
  servicio: ServicioConCuadro;
  /** Versión de la que se parte; `null` = categoría nueva. */
  base: CuadroDetalle | null;
  hoy: string;
  /** Categorías que todavía no tienen cuadro: las únicas que se pueden agregar. */
  libres: Opcion[];
  onClose: () => void;
  onSaved: () => void;
}

function CuadroDialog({ servicio, base, hoy, libres, onClose, onSaved }: DialogProps) {
  const unidad = UNIDAD_SERVICIO[servicio];
  const esSepelio = servicio === 'sepelio';
  const minimo = base ? diaSiguiente(base.vigenteDesde) : undefined;
  const sugerida = mesQueViene(hoy);

  // Categoría nueva: arranca en la primera libre, así el formulario nunca abre con un error.
  const [elegida, setElegida] = useState(libres[0]?.clave ?? '');
  const opcion = libres.find((o) => o.clave === elegida) ?? libres[0];
  const categoria: Categoria = base?.categoria ?? opcion?.categoria ?? 'residencial';
  const conSubsidio = base?.conSubsidio ?? opcion?.conSubsidio ?? false;
  const [vigenteDesde, setVigenteDesde] = useState(minimo && minimo > sugerida ? minimo : sugerida);
  const [cargoFijo, setCargoFijo] = useState(base?.cargoFijo ?? '');
  const [filas, setFilas] = useState<Fila[]>(
    base?.escalones.map((e) => ({ hasta: e.hasta ?? '', precio: e.precio, subsidiado: e.subsidiado, exentoDe: e.exentoDe })) ?? [
      { hasta: '', precio: '', subsidiado: false, exentoDe: [] },
    ],
  );
  const [aumento, setAumento] = useState('');
  const [nota, setNota] = useState('');
  const [errores, setErrores] = useState<Record<string, string>>({});

  const setFila = (i: number, cambios: Partial<Fila>) => setFilas((fs) => fs.map((f, j) => (j === i ? { ...f, ...cambios } : f)));
  const agregar = () =>
    setFilas((fs) => {
      const ultima = fs.at(-1)!;
      // La que era el excedente pasa a tener tope, y la nueva queda como excedente.
      return [...fs.slice(0, -1), { ...ultima, hasta: '' }, { hasta: '', precio: ultima.precio, subsidiado: false, exentoDe: [] }];
    });
  const quitar = (i: number) => setFilas((fs) => fs.filter((_, j) => j !== i).map((f, j, todas) => (j === todas.length - 1 ? { ...f, hasta: '' } : f)));

  const aplicarAumento = () => {
    const pct = aNumero(aumento);
    if (!base || !Number.isFinite(pct)) return;
    const subir = (v: string, decimales: number) => (aNumero(v) * (1 + pct / 100)).toFixed(decimales);
    setCargoFijo(subir(base.cargoFijo, 2));
    setFilas((fs) => fs.map((f, i) => (base.escalones[i] ? { ...f, precio: subir(base.escalones[i]!.precio, 4) } : f)));
  };

  const guardar = useMutation({
    mutationFn: (body: CuadroNuevoInput) => api.post<CuadroDetalle>('/tarifas/cuadros', body),
    onSuccess: onSaved,
    onError: (err) => setErrores(err instanceof ApiError && err.fields ? err.fields : {}),
  });

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    setErrores({});
    let desde = '0';
    const escalones = filas.map((f, i) => {
      const ultimo = i === filas.length - 1;
      const escalon = { desde, hasta: ultimo ? null : f.hasta.trim(), precio: f.precio.trim(), subsidiado: f.subsidiado, exentoDe: f.exentoDe };
      desde = f.hasta.trim();
      return escalon;
    });
    guardar.mutate({
      servicio,
      categoria: esSepelio ? null : categoria,
      conSubsidio: servicio === 'energia' && conSubsidio,
      vigenteDesde,
      cargoFijo: cargoFijo.trim(),
      escalones,
      nota: nota.trim() || null,
    });
  };

  // Mismas columnas en el encabezado y en cada fila, para que todo quede alineado.
  const columnas = esSepelio
    ? 'sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]'
    : servicio === 'energia'
      ? 'sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_8rem_2.75rem]'
      : 'sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_2.75rem]';
  const entrada =
    'block min-h-11 w-full min-w-0 rounded-lg border border-linea bg-superficie px-3 text-base tabular-nums text-tinta placeholder:text-tinta-suave/60 hover:border-marca-claro focus:border-marca';

  // Errores de escalones: la API los devuelve como `escalones` o `escalones.2.precio`.
  const errorEscalones = Object.entries(errores).find(([campo]) => campo.startsWith('escalones'))?.[1];
  const errorGeneral = guardar.isError && !Object.keys(errores).length ? errorMessage(guardar.error) : null;
  const titulo = base ? `Nueva versión · ${nombreDe({ categoria: base.categoria, conSubsidio: base.conSubsidio }, servicio, false)}` : `Agregar categoría · ${SERVICIO_CORTO[servicio]}`;

  return (
    <Modal
      wide
      title={titulo}
      description={
        base
          ? `La tarifa actual queda cerrada el día anterior a la fecha que elijas. Las facturas ya emitidas no cambian.`
          : 'Definí la cuota fija y los escalones de la categoría nueva.'
      }
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="form-cuadro" loading={guardar.isPending}>
            Guardar
          </Button>
        </>
      }
    >
      <form id="form-cuadro" onSubmit={enviar} className="space-y-5" noValidate>
        {errorGeneral && <FormAlert>{errorGeneral}</FormAlert>}

        <div className="grid items-start gap-4 sm:grid-cols-2">
          {!base && !esSepelio && (
            <SelectField
              label="Categoría"
              value={elegida}
              onChange={(e) => setElegida(e.target.value)}
              error={errores.categoria}
              hint="Solo aparecen las que todavía no tienen cuadro."
            >
              {libres.map((o) => (
                <option key={o.clave} value={o.clave}>
                  {nombreDe(o, servicio, servicio === 'energia' && o.categoria === 'residencial')}
                </option>
              ))}
            </SelectField>
          )}
          <Field
            label="Rige desde"
            type="date"
            min={minimo}
            value={vigenteDesde}
            onChange={(e) => setVigenteDesde(e.target.value)}
            error={errores.vigenteDesde}
            hint={base ? `Tiene que ser posterior al ${formatDate(base.vigenteDesde)}.` : undefined}
          />
          {base && (
            <Field
              label="Aumento sobre la tarifa actual (%)"
              inputMode="decimal"
              placeholder="Ej.: 8,5"
              value={aumento}
              onChange={(e) => setAumento(e.target.value)}
              hint="Recalcula la cuota fija y todos los precios."
              trailing={
                <Button variant="ghost" onClick={aplicarAumento} disabled={aumento.trim() === '' || !Number.isFinite(aNumero(aumento))}>
                  Aplicar
                </Button>
              }
              className="pr-24"
            />
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={esSepelio ? 'Cuota del titular ($)' : 'Cuota fija ($)'}
            inputMode="decimal"
            placeholder="0,00"
            value={cargoFijo}
            onChange={(e) => setCargoFijo(e.target.value)}
            error={errores.cargoFijo}
            hint={esSepelio ? undefined : 'Se cobra todos los meses, haya o no consumo.'}
          />
        </div>

        <fieldset>
          <legend className="mb-2 text-sm font-semibold text-tinta">{esSepelio ? 'Cuota por adherente' : 'Escalones de consumo'}</legend>
          <div className="overflow-hidden rounded-xl border border-linea">
            {/* Encabezado de columnas: solo en pantallas anchas; en el celular cada campo lleva su etiqueta. */}
            <div aria-hidden className={cn('hidden gap-3 border-b border-linea bg-fondo px-3 py-2 text-xs font-semibold uppercase tracking-wide text-tinta-suave sm:grid', columnas)}>
              <span>{esSepelio ? 'Quién' : 'Tramo de consumo'}</span>
              <span>Precio{esSepelio ? '' : ` por ${unidad}`} ($)</span>
              {servicio === 'energia' && <span>Subsidio</span>}
              {!esSepelio && <span />}
            </div>
            <ul className="divide-y divide-linea">
              {filas.map((f, i) => {
                const ultimo = i === filas.length - 1;
                const desde = i === 0 ? '0' : filas[i - 1]!.hasta || '…';
                return (
                  <li key={i} className={cn('grid grid-cols-[minmax(0,1fr)_2.75rem] items-center gap-x-3 gap-y-2 px-3 py-3 sm:gap-3', columnas)}>
                    {esSepelio ? (
                      <p className="text-[0.9375rem] font-medium text-tinta max-sm:col-span-2">Cada adherente</p>
                    ) : ultimo ? (
                      <p className="text-[0.9375rem] font-medium leading-tight text-tinta max-sm:col-span-2">
                        {filas.length === 1 ? 'Todo el consumo' : `Más de ${desde} ${unidad}`}
                        <span className="block text-xs font-normal text-tinta-suave">{filas.length === 1 ? 'Un solo precio, sin escalones' : 'Excedente, sin tope'}</span>
                      </p>
                    ) : (
                      <label className="flex items-center gap-2 text-[0.9375rem] font-medium text-tinta max-sm:col-span-2">
                        <span className="shrink-0">De {desde} a</span>
                        <input
                          inputMode="decimal"
                          aria-label={`Escalón ${i + 1}: hasta cuántos ${unidad}`}
                          value={f.hasta}
                          onChange={(e) => setFila(i, { hasta: e.target.value })}
                          className={entrada}
                        />
                        <span className="shrink-0 text-tinta-suave">{unidad}</span>
                      </label>
                    )}
                    <label className="block max-sm:col-span-2">
                      <span className="mb-1 block text-sm font-medium text-tinta sm:sr-only">Precio{esSepelio ? '' : ` por ${unidad}`} ($)</span>
                      <input
                        inputMode="decimal"
                        placeholder="0,0000"
                        aria-label={`Escalón ${i + 1}: precio`}
                        value={f.precio}
                        onChange={(e) => setFila(i, { precio: e.target.value })}
                        className={entrada}
                      />
                    </label>
                    {servicio === 'energia' && <Check label="Subsidiado" checked={f.subsidiado} onChange={(e) => setFila(i, { subsidiado: e.target.checked })} />}
                    {!esSepelio && (
                      <button
                        type="button"
                        aria-label={`Quitar el escalón ${i + 1}`}
                        title={filas.length === 1 ? 'Tiene que quedar al menos un escalón' : 'Quitar este escalón'}
                        disabled={filas.length === 1}
                        onClick={() => quitar(i)}
                        className="grid size-11 place-items-center justify-self-end rounded-lg text-tinta-suave hover:bg-peligro-tenue hover:text-peligro disabled:invisible"
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
          {errorEscalones && <p className="mt-2 text-sm font-medium text-peligro">{errorEscalones}</p>}
          {!esSepelio && filas.length < 20 && (
            <Button variant="ghost" icon={Plus} className="mt-2" onClick={agregar}>
              Agregar escalón
            </Button>
          )}
        </fieldset>

        <Field label="Nota (opcional)" placeholder="Ej.: Resolución 123/26" maxLength={200} value={nota} onChange={(e) => setNota(e.target.value)} />
      </form>
    </Modal>
  );
}
