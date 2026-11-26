// Una casa por pantalla (SPEC 5): ver la casa → tipear la lectura → confirmar → pasa sola a la siguiente.
// Teclado numérico propio y enorme (una mano, sol, guantes). La lectura se guarda en el teléfono en el instante.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Camera, Check, ChevronLeft, ChevronRight, CircleCheck, Delete, Pencil, TriangleAlert, X } from 'lucide-react';
import {
  ANOMALIA_ETIQUETA,
  evaluarLectura,
  formatDate,
  formatNumber,
  MOTIVO_ETIQUETA,
  NOVEDAD_ETIQUETA,
  NOVEDADES,
  NOVEDADES_CON_LECTURA,
  UNIDAD_SERVICIO,
  type Anomalia,
  type CasaRuta,
  type MedidorRuta,
  type MotivoLecturaMenor,
  type Novedad,
  type RutaDetalle,
} from '@shared';
import { errorMessage } from '../../lib/api';
import { cn } from '../../lib/cn';
import { Modal } from '../../components/Modal';
import { SERVICIO_CORTO, SERVICIO_ICON } from '../../components/servicios';
import { Button, ErrorState, Skeleton } from '../../components/ui';
import { guardarLectura, type DatosLectura } from './almacen';
import { achicarFoto, etiquetaMedidor, siguientePendiente, useGps, useRuta } from './ruta';

export function CasaPage() {
  const params = useParams();
  const rutaId = Number(params.rutaId);
  const conexionId = Number(params.conexionId);
  const consulta = useRuta(rutaId);

  if (consulta.isPending) return <Skeleton className="h-[70dvh] rounded-2xl" />;
  if (consulta.isError || !consulta.data) return <ErrorState message={errorMessage(consulta.error)} onRetry={() => void consulta.refetch()} />;
  const ruta = consulta.data;
  const casa = ruta.lista.find((c) => c.conexionId === conexionId);
  if (!casa) return <ErrorState message="Esa casa no está en esta ruta." />;
  // `key`: al pasar a otra casa todo arranca de cero (lo tipeado, la foto, las hojas abiertas).
  return <Casa key={conexionId} ruta={ruta} casa={casa} actualizar={consulta.actualizar} />;
}

type Hoja =
  | { tipo: 'menor'; valor: number }
  | { tipo: 'confirmar'; valor: number; anomalia: Exclude<Anomalia, 'lectura_menor'>; consumo: number }
  | { tipo: 'novedad' };

function Casa({ ruta, casa, actualizar }: { ruta: RutaDetalle; casa: CasaRuta; actualizar: (r: RutaDetalle) => void }) {
  const navigate = useNavigate();
  const gps = useGps();
  const indice = ruta.lista.findIndex((c) => c.conexionId === casa.conexionId);
  const primeroSinLeer = casa.medidores.findIndex((m) => m.lectura === null);
  const [activo, setActivo] = useState(Math.max(0, primeroSinLeer));
  const [texto, setTexto] = useState('');
  const [corrigiendo, setCorrigiendo] = useState(false);
  const [hoja, setHoja] = useState<Hoja | null>(null);
  const [guardada, setGuardada] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ocupado = useRef(false);

  const medidor = casa.medidores[activo]!;
  const unidad = UNIDAD_SERVICIO[medidor.servicio];
  const anterior = medidor.anterior?.valor ?? null;
  const cargando = medidor.lectura === null || corrigiendo;
  const vivo = texto === '' ? null : evaluarLectura({ valor: Number(texto), anterior, promedio: medidor.promedio, digitos: medidor.digitos, factor: medidor.factor });

  const ir = (c: CasaRuta | undefined) => c && navigate(`/operario/ruta/${ruta.id}/casa/${c.conexionId}`, { replace: true });

  const guardar = async (datos: Partial<DatosLectura>) => {
    if (ocupado.current) return;
    ocupado.current = true;
    setError(null);
    try {
      const p = gps.actual();
      const nueva = await guardarLectura(ruta, casa.conexionId, medidor.medidorId, medidor.periodoId, {
        valor: null,
        motivo: null,
        novedad: null,
        nota: null,
        foto: null,
        ...datos,
        lat: p?.lat ?? null,
        lng: p?.lng ?? null,
        precision: p?.precision ?? null,
      });
      actualizar(nueva);
      navigator.vibrate?.(30);
      setHoja(null);
      setTexto('');
      setCorrigiendo(false);
      setGuardada(true);
      // Un instante para ver el "Guardada" y sigue sola: otro medidor de la casa, o la próxima casa del recorrido.
      window.setTimeout(() => {
        setGuardada(false);
        ocupado.current = false;
        const casaNueva = nueva.lista[indice]!;
        const otro = casaNueva.medidores.findIndex((m) => m.lectura === null);
        if (otro >= 0) return setActivo(otro);
        const proxima = siguientePendiente(nueva, casa.conexionId);
        if (proxima) ir(proxima);
        else navigate(`/operario/ruta/${ruta.id}`, { replace: true });
      }, 650);
    } catch {
      ocupado.current = false;
      setError('No se pudo guardar en el teléfono. Probá de nuevo; si sigue, anotala en papel y avisá a la oficina.');
    }
  };

  const confirmar = () => {
    if (texto === '' || !vivo) return;
    const valor = Number(texto);
    if (vivo.faltaMotivo) return setHoja({ tipo: 'menor', valor });
    if (vivo.anomalia && vivo.anomalia !== 'lectura_menor') return setHoja({ tipo: 'confirmar', valor, anomalia: vivo.anomalia, consumo: vivo.consumo ?? 0 });
    void guardar({ valor });
  };

  const tecla = useCallback(
    (t: string) => {
      navigator.vibrate?.(8);
      setError(null);
      if (t === 'borrar') return setTexto((v) => v.slice(0, -1));
      setTexto((v) => (v.length >= medidor.digitos ? v : v === '0' ? t : v + t));
    },
    [medidor.digitos],
  );

  // En la compu (o con teclado bluetooth) también se puede tipear.
  const alConfirmar = useRef(confirmar);
  useEffect(() => {
    alConfirmar.current = confirmar;
  });
  useEffect(() => {
    if (!cargando || hoja) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
      if (/^\d$/.test(e.key)) tecla(e.key);
      else if (e.key === 'Backspace') tecla('borrar');
      else if (e.key === 'Enter') alConfirmar.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cargando, hoja, tecla]);

  const elegirMedidor = (i: number) => {
    setActivo(i);
    setTexto('');
    setCorrigiendo(false);
    setError(null);
  };

  return (
    <div className="flex min-h-[calc(100dvh-9.5rem)] flex-col">
      <div className="flex items-center gap-1">
        <Link to={`/operario/ruta/${ruta.id}`} className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-[0.9375rem] font-semibold text-marca-texto">
          <ArrowLeft className="size-4" aria-hidden />
          Lista
        </Link>
        <p className="flex-1 text-center text-[0.9375rem] font-bold text-tinta-suave">
          Casa {indice + 1} de {ruta.lista.length}
        </p>
        <button type="button" aria-label="Casa anterior" disabled={indice === 0} onClick={() => ir(ruta.lista[indice - 1])} className="grid size-11 place-items-center rounded-xl text-tinta disabled:opacity-30">
          <ChevronLeft className="size-6" aria-hidden />
        </button>
        <button type="button" aria-label="Casa siguiente" disabled={indice === ruta.lista.length - 1} onClick={() => ir(ruta.lista[indice + 1])} className="grid size-11 place-items-center rounded-xl text-tinta disabled:opacity-30">
          <ChevronRight className="size-6" aria-hidden />
        </button>
      </div>

      <div className="mt-1">
        <h1 className="text-2xl font-black leading-tight tracking-tight text-tinta bajo:text-xl">{casa.direccion}</h1>
        <p className="text-tinta-suave">
          {casa.titular} · Conexión {casa.numero}
        </p>
      </div>

      {casa.medidores.length > 1 && (
        <div role="tablist" aria-label="Medidores de la casa" className="mt-3 grid grid-cols-2 gap-2 bajo:mt-2">
          {casa.medidores.map((m, i) => {
            const Icon = SERVICIO_ICON[m.servicio];
            return (
              <button
                key={`${m.periodoId}-${m.medidorId}`}
                type="button"
                role="tab"
                aria-selected={i === activo}
                onClick={() => elegirMedidor(i)}
                className={cn(
                  'flex min-h-12 items-center justify-center gap-2 rounded-xl border-2 text-[0.9375rem] font-bold transition-colors duration-150 bajo:min-h-11',
                  i === activo ? 'border-marca bg-marca text-white' : 'border-linea bg-superficie text-tinta',
                )}
              >
                <Icon className="size-5" aria-hidden />
                {SERVICIO_CORTO[m.servicio]}
                {m.lectura && <Check className="size-5" aria-label="cargado" />}
              </button>
            );
          })}
        </div>
      )}

      <dl className="mt-3 grid grid-cols-3 gap-2 text-center bajo:mt-2">
        <Dato etiqueta={`Medidor${casa.medidores.length === 1 ? ` · ${SERVICIO_CORTO[medidor.servicio]}` : ''}`} valor={etiquetaMedidor(medidor)} />
        <Dato etiqueta={medidor.anterior ? `Anterior · ${formatDate(medidor.anterior.fecha).slice(0, 5)}` : 'Anterior'} valor={anterior === null ? 'Sin dato' : formatNumber(anterior)} destacado />
        <Dato etiqueta="Promedio" valor={medidor.promedio === null ? 'Sin dato' : `${formatNumber(Math.round(medidor.promedio))} ${unidad}`} />
      </dl>

      {guardada ? (
        <div role="status" className="mt-4 flex flex-1 flex-col items-center justify-center gap-2 rounded-2xl bg-exito-tenue py-10 text-exito">
          <CircleCheck className="size-16" aria-hidden />
          <p className="text-2xl font-black">Guardada</p>
        </div>
      ) : cargando ? (
        // El visor va pegado al teclado: en un celular chico la casa se desliza por debajo, pero el número
        // que se está tipeando y las teclas quedan siempre a la vista.
        <div className="sticky bottom-0 -mx-4 mt-auto bg-fondo px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 bajo:pt-2">
          <div className={cn('rounded-2xl border-2 bg-superficie px-4 py-2.5 text-right bajo:py-1.5 chico:py-1', error ? 'border-peligro' : 'border-tinta')}>
            <p aria-live="polite" aria-label="Lectura actual" className={cn('min-h-14 text-5xl font-black tabular-nums tracking-tight bajo:min-h-10 bajo:text-4xl', texto ? 'text-tinta' : 'text-tinta-suave/40')}>
              {texto ? formatNumber(Number(texto)) : '0'}
            </p>
            <p className={cn('min-h-6 text-[0.9375rem] font-bold', !vivo ? 'text-tinta-suave' : vivo.anomalia ? (vivo.anomalia === 'lectura_menor' ? 'text-peligro' : 'text-alerta') : 'text-exito')}>
              {!vivo
                ? `Tipeá la lectura (${unidad})`
                : vivo.anomalia === 'lectura_menor'
                  ? 'Menor a la anterior'
                  : vivo.consumo === null
                    ? 'Primera lectura de este medidor'
                    : `Consumo: ${formatNumber(vivo.consumo)} ${unidad}${vivo.anomalia ? ` · ${ANOMALIA_ETIQUETA[vivo.anomalia].toLowerCase()}` : ''}`}
            </p>
          </div>
          {error && (
            <p role="alert" className="mt-2 text-sm font-semibold text-peligro">
              {error}
            </p>
          )}

          <div className="mt-2">
            <div className="grid grid-cols-3 gap-2 chico:gap-1.5">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((n) => (
                <Tecla key={n} onClick={() => tecla(n)}>
                  {n}
                </Tecla>
              ))}
              <Tecla onClick={() => tecla('borrar')} aria-label="Borrar el último número" className="text-tinta-suave">
                <Delete className="size-8" aria-hidden />
              </Tecla>
              <Tecla onClick={() => tecla('0')}>0</Tecla>
              <button
                type="button"
                onClick={confirmar}
                disabled={texto === ''}
                aria-label="Confirmar la lectura"
                className="grid min-h-16 place-items-center rounded-2xl bg-marca text-white transition-colors duration-100 active:bg-marca-fuerte disabled:opacity-40 bajo:min-h-[3.25rem] chico:min-h-11"
              >
                <Check className="size-9" strokeWidth={3} aria-hidden />
              </button>
            </div>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => setHoja({ tipo: 'novedad' })}
                className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl border-2 border-linea bg-superficie text-[0.9375rem] font-bold text-tinta active:bg-acento-tenue bajo:min-h-11"
              >
                <TriangleAlert className="size-5 text-alerta" aria-hidden />
                No pude leer / novedad
              </button>
              {corrigiendo && (
                <button type="button" onClick={() => (setCorrigiendo(false), setTexto(''))} className="min-h-12 rounded-xl border-2 border-linea bg-superficie px-4 text-[0.9375rem] font-bold text-tinta">
                  Cancelar
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <Cargada medidor={medidor} unidad={unidad} alCorregir={() => setCorrigiendo(true)} alSeguir={() => ir(siguientePendiente(ruta, casa.conexionId) ?? undefined)} haySiguiente={siguientePendiente(ruta, casa.conexionId) !== null} />
      )}

      {hoja?.tipo === 'menor' && (
        <Modal
          title="La lectura es menor a la anterior"
          description={`Tipeaste ${formatNumber(hoja.valor)} y la anterior fue ${formatNumber(anterior ?? 0)}. ¿Qué pasó?`}
          onClose={() => setHoja(null)}
        >
          <div className="space-y-2.5">
            {(['vuelta_contador', 'cambio_medidor'] as MotivoLecturaMenor[]).map((motivo) => {
              const consumo = evaluarLectura({ valor: hoja.valor, anterior, promedio: null, digitos: medidor.digitos, factor: medidor.factor, motivo }).consumo ?? 0;
              return (
                <Opcion key={motivo} onClick={() => void guardar({ valor: hoja.valor, motivo })}>
                  <span className="block text-lg font-bold">{MOTIVO_ETIQUETA[motivo]}</span>
                  <span className="block text-sm text-tinta-suave">
                    {motivo === 'vuelta_contador' ? 'El contador llegó al tope y volvió a cero' : 'Hay un medidor nuevo, que arrancó de cero'} · consumo {formatNumber(consumo)} {unidad}
                  </span>
                </Opcion>
              );
            })}
            <Opcion onClick={() => setHoja(null)}>
              <span className="flex items-center gap-2 text-lg font-bold">
                <Pencil className="size-5" aria-hidden />
                Me equivoqué: corregir
              </span>
            </Opcion>
          </div>
        </Modal>
      )}

      {hoja?.tipo === 'confirmar' && <Confirmacion hoja={hoja} medidor={medidor} unidad={unidad} alGuardar={(foto) => void guardar({ valor: hoja.valor, foto })} alCerrar={() => setHoja(null)} />}

      {hoja?.tipo === 'novedad' && <HojaNovedad lectura={texto === '' ? null : Number(texto)} alGuardar={(d) => void guardar(d)} alCerrar={() => setHoja(null)} />}
    </div>
  );
}

function Dato({ etiqueta, valor, destacado }: { etiqueta: string; valor: string; destacado?: boolean }) {
  return (
    <div className={cn('rounded-xl border px-1.5 py-2 bajo:py-1', destacado ? 'border-marca bg-marca-tenue' : 'border-linea bg-superficie')}>
      <dt className="truncate text-xs font-semibold text-tinta-suave">{etiqueta}</dt>
      <dd className={cn('truncate font-black tabular-nums text-tinta', destacado ? 'text-xl' : 'text-[0.9375rem] leading-7')}>{valor}</dd>
    </div>
  );
}

function Tecla({ className, children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        'grid min-h-16 select-none place-items-center rounded-2xl border-2 border-linea bg-superficie text-3xl font-black tabular-nums text-tinta transition-colors duration-100 active:border-marca active:bg-marca-tenue bajo:min-h-[3.25rem] bajo:text-2xl chico:min-h-11',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

function Opcion({ className, children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={cn('block min-h-16 w-full rounded-2xl border-2 border-linea bg-superficie px-4 py-3 text-left text-tinta active:border-marca active:bg-marca-tenue', className)} {...rest}>
      {children}
    </button>
  );
}

/** Medidor que ya tiene lectura: se muestra lo cargado y se puede corregir. */
function Cargada({ medidor, unidad, alCorregir, alSeguir, haySiguiente }: { medidor: MedidorRuta; unidad: string; alCorregir: () => void; alSeguir: () => void; haySiguiente: boolean }) {
  const l = medidor.lectura!;
  return (
    <div className="mt-4 flex flex-1 flex-col">
      <div className={cn('rounded-2xl border-2 px-4 py-4', l.novedad ? 'border-alerta bg-alerta-tenue' : 'border-exito bg-exito-tenue')}>
        <p className={cn('flex items-center gap-2 font-bold', l.novedad ? 'text-alerta' : 'text-exito')}>
          {l.novedad ? <TriangleAlert className="size-5" aria-hidden /> : <CircleCheck className="size-5" aria-hidden />}
          {l.novedad ? NOVEDAD_ETIQUETA[l.novedad] : l.tipo === 'estimada' ? 'Estimada por la oficina' : 'Lectura cargada'}
        </p>
        {l.valor !== null && <p className="mt-1 text-4xl font-black tabular-nums text-tinta">{formatNumber(l.valor)}</p>}
        <p className="mt-1 text-[0.9375rem] text-tinta">
          {l.consumo !== null && `Consumo: ${formatNumber(l.consumo)} ${unidad}`}
          {l.anomalia && ` · ${ANOMALIA_ETIQUETA[l.anomalia]}`}
          {l.motivo && ` (${MOTIVO_ETIQUETA[l.motivo].toLowerCase()})`}
        </p>
        {l.nota && <p className="mt-1 text-sm text-tinta-suave">“{l.nota}”</p>}
        {l.tieneFoto && (
          <p className="mt-1 flex items-center gap-1.5 text-sm text-tinta-suave">
            <Camera className="size-4" aria-hidden />
            Con foto
          </p>
        )}
      </div>
      <div className="mt-auto grid gap-2 pb-3 pt-4">
        {haySiguiente && (
          <Button size="xl" onClick={alSeguir}>
            Siguiente casa
          </Button>
        )}
        <Button size="lg" variant="secondary" icon={Pencil} onClick={alCorregir}>
          Corregir esta lectura
        </Button>
      </div>
    </div>
  );
}

/** Botón de cámara: abre la cámara trasera del teléfono (o el selector de archivos en la compu). */
function Foto({ foto, alCambiar }: { foto: string | null; alCambiar: (f: string | null) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [procesando, setProcesando] = useState(false);
  const elegir = async (archivo: File | undefined) => {
    if (!archivo) return;
    setError(null);
    setProcesando(true);
    try {
      alCambiar(await achicarFoto(archivo));
    } catch {
      setError('No se pudo usar esa foto. Probá sacarla de nuevo.');
    } finally {
      setProcesando(false);
    }
  };
  return (
    <div>
      {foto ? (
        <div className="relative overflow-hidden rounded-2xl border-2 border-linea">
          <img src={foto} alt="Foto del medidor" className="max-h-52 w-full object-cover" />
          <button type="button" aria-label="Quitar la foto" onClick={() => alCambiar(null)} className="absolute right-2 top-2 grid size-11 place-items-center rounded-full bg-black/70 text-white">
            <X className="size-5" aria-hidden />
          </button>
        </div>
      ) : (
        <label className={cn('flex min-h-14 cursor-pointer items-center justify-center gap-2.5 rounded-2xl border-2 border-dashed border-marca-claro bg-marca-tenue text-[1.0625rem] font-bold text-marca-texto', procesando && 'animate-latido')}>
          <Camera className="size-6" aria-hidden />
          {procesando ? 'Preparando la foto…' : 'Sacar foto del medidor'}
          <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => void elegir(e.target.files?.[0])} />
        </label>
      )}
      {error && (
        <p role="alert" className="mt-1.5 text-sm font-semibold text-peligro">
          {error}
        </p>
      )}
    </div>
  );
}

function Confirmacion({
  hoja,
  medidor,
  unidad,
  alGuardar,
  alCerrar,
}: {
  hoja: Extract<Hoja, { tipo: 'confirmar' }>;
  medidor: MedidorRuta;
  unidad: string;
  alGuardar: (foto: string | null) => void;
  alCerrar: () => void;
}) {
  const [foto, setFoto] = useState<string | null>(null);
  const sinConsumo = hoja.anomalia === 'sin_consumo';
  const promedio = medidor.promedio === null ? '' : formatNumber(Math.round(medidor.promedio));
  return (
    <Modal
      title={sinConsumo ? 'Igual a la anterior' : ANOMALIA_ETIQUETA[hoja.anomalia]}
      description={
        sinConsumo
          ? `La lectura es ${formatNumber(hoja.valor)}, la misma del mes pasado. ¿La casa está sin consumo?`
          : `Con ${formatNumber(hoja.valor)} el consumo da ${formatNumber(hoja.consumo)} ${unidad}; el promedio de esta casa es ${promedio} ${unidad}. Mirá bien el medidor.`
      }
      onClose={alCerrar}
    >
      <div className="space-y-3">
        {!sinConsumo && <Foto foto={foto} alCambiar={setFoto} />}
        <Button size="xl" className="w-full" icon={Check} onClick={() => alGuardar(foto)}>
          {sinConsumo ? 'Sí, sin consumo' : foto ? 'Está bien: guardar' : 'Está bien: guardar sin foto'}
        </Button>
        <Button size="lg" variant="secondary" className="w-full" icon={Pencil} onClick={alCerrar}>
          Corregir el número
        </Button>
      </div>
    </Modal>
  );
}

function HojaNovedad({ lectura, alGuardar, alCerrar }: { lectura: number | null; alGuardar: (d: Partial<DatosLectura>) => void; alCerrar: () => void }) {
  const [novedad, setNovedad] = useState<Novedad | null>(null);
  const [nota, setNota] = useState('');
  const [foto, setFoto] = useState<string | null>(null);
  // "Posible fraude" y "pérdida visible" pueden ir con la lectura que ya se tipeó; el resto es "no pude leer".
  const conLectura = novedad !== null && NOVEDADES_CON_LECTURA.includes(novedad) && lectura !== null;
  return (
    <Modal title="¿Qué pasó en esta casa?" description="Elegí la novedad. Si podés, sumá una foto y una nota para la oficina." onClose={alCerrar}>
      <div className="space-y-4">
        <div role="radiogroup" aria-label="Novedad" className="grid grid-cols-2 gap-2">
          {NOVEDADES.map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={novedad === n}
              onClick={() => setNovedad(n)}
              className={cn(
                'min-h-14 rounded-xl border-2 px-2 text-[0.9375rem] font-bold leading-tight transition-colors duration-150',
                novedad === n ? 'border-marca bg-marca text-white' : 'border-linea bg-superficie text-tinta',
              )}
            >
              {NOVEDAD_ETIQUETA[n]}
            </button>
          ))}
        </div>
        <Foto foto={foto} alCambiar={setFoto} />
        <label className="block text-sm font-semibold text-tinta">
          Nota (opcional)
          <textarea
            rows={2}
            maxLength={300}
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            placeholder="Ej.: portón con candado, vuelvo el jueves"
            className="mt-1.5 block w-full rounded-xl border-2 border-linea bg-superficie px-3.5 py-2.5 text-base font-normal text-tinta placeholder:text-tinta-suave/80 focus:border-marca"
          />
        </label>
        <Button size="xl" className="w-full" disabled={novedad === null} onClick={() => alGuardar({ novedad, nota: nota.trim() || null, foto, valor: conLectura ? lectura : null })}>
          {conLectura ? `Guardar con la lectura ${formatNumber(lectura)}` : 'Guardar sin lectura'}
        </Button>
      </div>
    </Modal>
  );
}
