// Impuestos, tasas y cargos que se suman a cada factura. Cambiar un valor no pisa el anterior:
// se guarda desde qué fecha rige el nuevo, y el historial queda.
import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { CalendarClock, History, Percent, Plus, Trash2 } from 'lucide-react';
import {
  BASE_CONCEPTO_ETIQUETA,
  BASES_CONCEPTO,
  CATEGORIA_ETIQUETA,
  CATEGORIAS,
  CONDICION_IVA_ETIQUETA,
  CONDICIONES_IVA,
  formatDate,
  formatMoney,
  formatPorcentaje,
  formatPrecio,
  GRUPO_CONCEPTO_ETIQUETA,
  GRUPOS_CONCEPTO,
  SERVICIO_ETIQUETA,
  SERVICIOS_CONEXION,
  TIPO_CONCEPTO_ETIQUETA,
  TIPOS_CONCEPTO,
  UNIDAD_SERVICIO,
  type BaseConcepto,
  type Categoria,
  type ConceptoDetalle,
  type CondicionIva,
  type GrupoConcepto,
  type ServicioConexion,
  type TarifasResumen,
  type TipoConcepto,
} from '@shared';
import { api, ApiError, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Confirm, Modal } from '../../components/Modal';
import { Badge, Button, Card, Check, Empty, Field, FormAlert, SelectField } from '../../components/ui';

interface Props {
  datos: TarifasResumen;
  puedeEditar: boolean;
  alCambiar: () => void;
}

interface Familia {
  codigo: string;
  /** El valor que rige hoy; si no hay, el más reciente (ya terminado o todavía por empezar). */
  actual: ConceptoDetalle;
  vigente: boolean;
  futuros: ConceptoDetalle[];
  anteriores: ConceptoDetalle[];
}

/** Junta los valores de cada concepto por código. La API ya los manda del más nuevo al más viejo. */
function agrupar(conceptos: ConceptoDetalle[], hoy: string): Familia[] {
  const porCodigo = new Map<string, ConceptoDetalle[]>();
  for (const c of conceptos) porCodigo.set(c.codigo, [...(porCodigo.get(c.codigo) ?? []), c]);
  return [...porCodigo.entries()].map(([codigo, versiones]) => {
    const rige = versiones.find((c) => !c.futuro && (c.vigenteHasta === null || c.vigenteHasta >= hoy));
    const futuros = versiones.filter((c) => c.futuro).reverse();
    const actual = rige ?? versiones.find((c) => !c.futuro) ?? versiones[0]!;
    return { codigo, actual, vigente: Boolean(rige), futuros, anteriores: versiones.filter((c) => c !== actual && !c.futuro) };
  });
}

/** «21 % sobre el subtotal del servicio», «$ 9.000,00 fijos», «$ 2,276962 por kWh». */
function valorLegible(c: Pick<ConceptoDetalle, 'tipo' | 'valor' | 'base' | 'servicio'>): string {
  if (c.tipo === 'porcentaje') return `${formatPorcentaje(c.valor)} sobre ${c.base ? BASE_CONCEPTO_ETIQUETA[c.base].toLowerCase() : 'el servicio'}`;
  if (c.tipo === 'fijo') return `${formatMoney(c.valor)} por factura`;
  const unidad = c.servicio === 'energia' || c.servicio === 'agua' ? UNIDAD_SERVICIO[c.servicio] : 'unidad';
  return `${formatPrecio(c.valor, 6)} por ${unidad}`;
}

const GRUPO_CORTO: Record<GrupoConcepto, string> = { cargo: 'Cargo del servicio', gravamen: 'Gravamen', adicional: 'Adicional' };

type Dialogo = { tipo: 'nuevo' } | { tipo: 'valor'; base: ConceptoDetalle } | { tipo: 'fin'; concepto: ConceptoDetalle };

export function Conceptos({ datos, puedeEditar, alCambiar }: Props) {
  const [dialogo, setDialogo] = useState<Dialogo | null>(null);
  const [aBorrar, setABorrar] = useState<ConceptoDetalle | null>(null);
  const familias = agrupar(datos.conceptos, datos.hoy);
  const secciones: { servicio: ServicioConexion | null; titulo: string }[] = [
    ...SERVICIOS_CONEXION.map((s) => ({ servicio: s as ServicioConexion | null, titulo: SERVICIO_ETIQUETA[s] })),
    { servicio: null, titulo: 'En todas las facturas' },
  ];
  const cerrar = () => setDialogo(null);
  const guardado = () => {
    setDialogo(null);
    alCambiar();
  };

  const borrar = useMutation({
    mutationFn: (id: number) => api.del(`/tarifas/conceptos/${id}`),
    onSuccess: () => {
      setABorrar(null);
      alCambiar();
    },
  });

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-tinta-suave">
          Lo que se suma a la cuota fija y al consumo: impuestos, tasas y cargos. Se aplican solos según el servicio, la categoría y la condición frente al IVA
          de cada socio.
        </p>
        {puedeEditar && (
          <Button icon={Plus} onClick={() => setDialogo({ tipo: 'nuevo' })}>
            Nuevo concepto
          </Button>
        )}
      </div>

      {familias.length === 0 ? (
        <Card>
          <Empty icon={Percent} title="Todavía no hay impuestos ni cargos">
            Sin conceptos, las facturas llevan solo la cuota fija y el consumo.
          </Empty>
        </Card>
      ) : (
        <div className="space-y-6">
          {secciones.map(({ servicio, titulo }) => {
            const deEsta = familias.filter((f) => f.actual.servicio === servicio);
            if (!deEsta.length) return null;
            return (
              <section key={servicio ?? 'todos'} aria-label={titulo}>
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-tinta-suave">{titulo}</h3>
                <Card className="divide-y divide-linea overflow-hidden">
                  {deEsta.map((f) => (
                    <FilaConcepto
                      key={f.codigo}
                      familia={f}
                      puedeEditar={puedeEditar}
                      alCambiarValor={() => setDialogo({ tipo: 'valor', base: f.futuros.at(-1) ?? f.actual })}
                      alFinalizar={() => setDialogo({ tipo: 'fin', concepto: f.actual })}
                      alBorrar={setABorrar}
                    />
                  ))}
                </Card>
              </section>
            );
          })}
        </div>
      )}

      {dialogo?.tipo === 'nuevo' && <ConceptoDialog base={null} hoy={datos.hoy} codigos={familias.map((f) => f.codigo)} onClose={cerrar} onSaved={guardado} />}
      {dialogo?.tipo === 'valor' && <ConceptoDialog base={dialogo.base} hoy={datos.hoy} codigos={[]} onClose={cerrar} onSaved={guardado} />}
      {dialogo?.tipo === 'fin' && <FinDialog concepto={dialogo.concepto} hoy={datos.hoy} onClose={cerrar} onSaved={guardado} />}

      {aBorrar && (
        <Confirm
          title="¿Borrar este valor?"
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
            «{aBorrar.nombre}» iba a pasar a <strong>{valorLegible(aBorrar)}</strong> desde el {formatDate(aBorrar.vigenteDesde)}. Como todavía no rige, se
            puede borrar y queda el valor actual.
          </p>
        </Confirm>
      )}
    </>
  );
}

/* ───────────────────────── Un concepto ───────────────────────── */

interface FilaProps {
  familia: Familia;
  puedeEditar: boolean;
  alCambiarValor: () => void;
  alFinalizar: () => void;
  alBorrar: (c: ConceptoDetalle) => void;
}

function FilaConcepto({ familia: f, puedeEditar, alCambiarValor, alFinalizar, alBorrar }: FilaProps) {
  const [verHistorial, setVerHistorial] = useState(false);
  const c = f.actual;
  return (
    <div className="px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <p className="font-semibold text-tinta">{c.nombre}</p>
          <p className="mt-0.5 tabular-nums text-tinta">{valorLegible(c)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {f.vigente ? (
            <Badge tone="exito">Rige desde el {formatDate(c.vigenteDesde)}</Badge>
          ) : c.futuro ? (
            <Badge tone="alerta">Empieza el {formatDate(c.vigenteDesde)}</Badge>
          ) : (
            <Badge>Dejó de cobrarse el {c.vigenteHasta ? formatDate(c.vigenteHasta) : '—'}</Badge>
          )}
          {f.vigente && c.vigenteHasta && <Badge tone="alerta">Hasta el {formatDate(c.vigenteHasta)}</Badge>}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        <Badge tone="marca">{GRUPO_CORTO[c.grupo]}</Badge>
        {c.categorias?.map((cat) => <Badge key={cat}>{CATEGORIA_ETIQUETA[cat]}</Badge>)}
        {c.condicionesIva?.map((iva) => <Badge key={iva}>{CONDICION_IVA_ETIQUETA[iva]}</Badge>)}
        <span className="self-center font-mono text-xs text-tinta-suave">{c.codigo}</span>
      </div>

      {f.futuros.map((futuro) =>
        futuro === c ? null : (
          <div key={futuro.id} className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-acento-tenue/50 px-3 py-2">
            <p className="flex items-center gap-2 text-sm text-tinta">
              <CalendarClock className="size-4 shrink-0 text-alerta" aria-hidden />
              <span>
                Desde el {formatDate(futuro.vigenteDesde)}: <strong className="tabular-nums">{valorLegible(futuro)}</strong>
              </span>
            </p>
            {puedeEditar && (
              <Button variant="ghost" icon={Trash2} onClick={() => alBorrar(futuro)}>
                Borrar
              </Button>
            )}
          </div>
        ),
      )}

      {verHistorial && (
        <ul className="mt-3 space-y-1 rounded-xl bg-fondo px-3 py-2 text-sm text-tinta-suave">
          {f.anteriores.map((a) => (
            <li key={a.id} className="flex flex-wrap justify-between gap-x-4">
              <span>
                Del {formatDate(a.vigenteDesde)} al {a.vigenteHasta ? formatDate(a.vigenteHasta) : '—'}
              </span>
              <span className="tabular-nums">{valorLegible(a)}</span>
            </li>
          ))}
        </ul>
      )}

      {(puedeEditar || f.anteriores.length > 0) && (
        <div className="-mx-2 mt-2 flex flex-wrap items-center gap-1">
          {puedeEditar && (
            <Button variant="ghost" onClick={alCambiarValor}>
              Cambiar valor
            </Button>
          )}
          {puedeEditar && f.vigente && c.vigenteHasta === null && f.futuros.length === 0 && (
            <Button variant="ghost" onClick={alFinalizar}>
              Dejar de cobrar
            </Button>
          )}
          {puedeEditar && c.futuro && (
            <Button variant="ghost" icon={Trash2} onClick={() => alBorrar(c)}>
              Borrar
            </Button>
          )}
          {f.anteriores.length > 0 && (
            <Button variant="ghost" icon={History} aria-expanded={verHistorial} onClick={() => setVerHistorial((v) => !v)}>
              {verHistorial ? 'Ocultar historial' : `Historial (${f.anteriores.length})`}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── Nuevo concepto o nuevo valor ───────────────────────── */

const diaSiguiente = (fecha: string) => new Date(new Date(`${fecha}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);

interface DialogProps {
  /** Con base = solo cambia el valor desde una fecha; sin base = concepto nuevo. */
  base: ConceptoDetalle | null;
  hoy: string;
  codigos: string[];
  onClose: () => void;
  onSaved: () => void;
}

function ConceptoDialog({ base, hoy, codigos, onClose, onSaved }: DialogProps) {
  const { me } = useAuth();
  const servicios = SERVICIOS_CONEXION.filter((s) => me?.cooperativa?.servicios.includes(s));
  const minimo = base ? diaSiguiente(base.vigenteDesde) : undefined;

  const [codigo, setCodigo] = useState(base?.codigo ?? '');
  const [nombre, setNombre] = useState(base?.nombre ?? '');
  const [tipo, setTipo] = useState<TipoConcepto>(base?.tipo ?? 'porcentaje');
  const [valor, setValor] = useState(base?.valor ?? '');
  const [baseCalculo, setBaseCalculo] = useState<BaseConcepto>(base?.base ?? 'subtotal');
  const [grupo, setGrupo] = useState<GrupoConcepto>(base?.grupo ?? 'gravamen');
  const [servicio, setServicio] = useState<ServicioConexion | ''>(base ? (base.servicio ?? '') : (servicios[0] ?? ''));
  const [categorias, setCategorias] = useState<Categoria[]>(base?.categorias ?? []);
  const [condiciones, setCondiciones] = useState<CondicionIva[]>(base?.condicionesIva ?? []);
  const [vigenteDesde, setVigenteDesde] = useState(minimo && minimo > hoy ? minimo : hoy);
  const [errores, setErrores] = useState<Record<string, string>>({});

  const guardar = useMutation({
    mutationFn: (body: unknown) => api.post<ConceptoDetalle>('/tarifas/conceptos', body),
    onSuccess: onSaved,
    onError: (err) => setErrores(err instanceof ApiError && err.fields ? err.fields : {}),
  });

  const codigoLimpio = codigo.trim().toUpperCase();
  const repetido = !base && codigos.includes(codigoLimpio);

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    setErrores({});
    guardar.mutate({
      codigo: codigoLimpio,
      nombre,
      tipo,
      valor: valor.trim(),
      base: tipo === 'porcentaje' ? baseCalculo : null,
      grupo,
      servicio: servicio || null,
      categorias: categorias.length ? categorias : null,
      condicionesIva: condiciones.length ? condiciones : null,
      orden: base?.orden ?? 100,
      vigenteDesde,
    });
  };

  const alternar = <T,>(lista: T[], item: T) => (lista.includes(item) ? lista.filter((x) => x !== item) : [...lista, item]);
  const etiquetaValor = tipo === 'porcentaje' ? 'Porcentaje (%)' : tipo === 'fijo' ? 'Importe por factura ($)' : 'Importe por unidad consumida ($)';
  const errorGeneral = guardar.isError && !Object.keys(errores).length ? errorMessage(guardar.error) : null;

  return (
    <Modal
      wide={!base}
      title={base ? `Cambiar valor · ${base.nombre}` : 'Nuevo concepto'}
      description={
        base ? `Hoy: ${valorLegible(base)}. El valor nuevo rige desde la fecha que elijas; el anterior queda en el historial.` : 'Un impuesto, una tasa o un cargo que se suma a las facturas.'
      }
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="form-concepto" loading={guardar.isPending} disabled={repetido}>
            Guardar
          </Button>
        </>
      }
    >
      <form id="form-concepto" onSubmit={enviar} className="space-y-5" noValidate>
        {errorGeneral && <FormAlert>{errorGeneral}</FormAlert>}

        {!base && (
          <>
            <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
              <Field label="Nombre, como sale en la factura" value={nombre} onChange={(e) => setNombre(e.target.value)} error={errores.nombre} maxLength={80} />
              <Field
                label="Código"
                placeholder="TASA_MUNI"
                value={codigo}
                onChange={(e) => setCodigo(e.target.value.toUpperCase())}
                error={repetido ? 'Ya existe: usá «Cambiar valor»' : errores.codigo}
                maxLength={24}
                className="font-mono"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField label="Cómo se calcula" value={tipo} onChange={(e) => setTipo(e.target.value as TipoConcepto)}>
                {TIPOS_CONCEPTO.map((t) => (
                  <option key={t} value={t}>
                    {TIPO_CONCEPTO_ETIQUETA[t]}
                  </option>
                ))}
              </SelectField>
              {tipo === 'porcentaje' && (
                <SelectField label="Sobre qué" value={baseCalculo} onChange={(e) => setBaseCalculo(e.target.value as BaseConcepto)} error={errores.base}>
                  {BASES_CONCEPTO.map((b) => (
                    <option key={b} value={b}>
                      {BASE_CONCEPTO_ETIQUETA[b]}
                    </option>
                  ))}
                </SelectField>
              )}
            </div>
          </>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={etiquetaValor} inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} error={errores.valor} />
          <Field
            label="Rige desde"
            type="date"
            min={minimo}
            value={vigenteDesde}
            onChange={(e) => setVigenteDesde(e.target.value)}
            error={errores.vigenteDesde}
            hint={base ? `Tiene que ser posterior al ${formatDate(base.vigenteDesde)}.` : undefined}
          />
        </div>

        {!base && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField label="En qué facturas" value={servicio} onChange={(e) => setServicio(e.target.value as ServicioConexion | '')}>
                {servicios.map((s) => (
                  <option key={s} value={s}>
                    {SERVICIO_ETIQUETA[s]}
                  </option>
                ))}
                <option value="">En todas</option>
              </SelectField>
              <SelectField label="Dónde se imprime" value={grupo} onChange={(e) => setGrupo(e.target.value as GrupoConcepto)}>
                {GRUPOS_CONCEPTO.map((g) => (
                  <option key={g} value={g}>
                    {GRUPO_CONCEPTO_ETIQUETA[g]}
                  </option>
                ))}
              </SelectField>
            </div>
            <fieldset>
              <legend className="text-sm font-semibold text-tinta">Solo para estas categorías</legend>
              <p className="text-sm text-tinta-suave">Sin marcar ninguna, se cobra a todas.</p>
              <div className="mt-1 grid grid-cols-2 gap-x-4 sm:grid-cols-3">
                {CATEGORIAS.map((c) => (
                  <Check key={c} label={CATEGORIA_ETIQUETA[c]} checked={categorias.includes(c)} onChange={() => setCategorias((l) => alternar(l, c))} />
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="text-sm font-semibold text-tinta">Solo para estas condiciones frente al IVA</legend>
              <p className="text-sm text-tinta-suave">Sin marcar ninguna, se cobra a todas.</p>
              <div className="mt-1 grid grid-cols-2 gap-x-4">
                {CONDICIONES_IVA.map((c) => (
                  <Check key={c} label={CONDICION_IVA_ETIQUETA[c]} checked={condiciones.includes(c)} onChange={() => setCondiciones((l) => alternar(l, c))} />
                ))}
              </div>
            </fieldset>
          </>
        )}
      </form>
    </Modal>
  );
}

function FinDialog({ concepto, hoy, onClose, onSaved }: { concepto: ConceptoDetalle; hoy: string; onClose: () => void; onSaved: () => void }) {
  const [vigenteHasta, setVigenteHasta] = useState(hoy);
  const guardar = useMutation({
    mutationFn: () => api.post(`/tarifas/conceptos/${concepto.id}/fin`, { vigenteHasta }),
    onSuccess: onSaved,
  });
  const error = guardar.error instanceof ApiError ? (guardar.error.fields?.vigenteHasta ?? guardar.error.message) : guardar.isError ? errorMessage(guardar.error) : undefined;

  return (
    <Modal
      title={`Dejar de cobrar · ${concepto.nombre}`}
      description="Las facturas de los períodos que cierren después de esa fecha ya no lo van a llevar. El historial queda guardado."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="form-fin" variant="danger" loading={guardar.isPending}>
            Dejar de cobrar
          </Button>
        </>
      }
    >
      <form
        id="form-fin"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          guardar.mutate();
        }}
      >
        <Field label="Último día en que se cobra" type="date" min={concepto.vigenteDesde} value={vigenteHasta} onChange={(e) => setVigenteHasta(e.target.value)} error={error} />
      </form>
    </Modal>
  );
}
