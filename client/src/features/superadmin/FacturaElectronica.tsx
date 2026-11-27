// Panel de SRV: la factura electrónica de una cooperativa. Ambiente (simulada, homologación,
// producción), CUIT y punto de venta, el certificado de ARCA, cómo se informa cada concepto de la
// tarifa, la prueba de conexión y la alineación de la numeración con ARCA.
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, CircleX, FileKey, FlaskConical, PlugZap, RefreshCw, Save, Trash2 } from 'lucide-react';
import {
  AMBIENTE_FISCAL_ETIQUETA,
  AMBIENTES_FISCALES,
  CONDICION_IVA_ETIQUETA,
  formatCuit,
  formatDate,
  formatDateTime,
  formatMoney,
  SERVICIO_ETIQUETA,
  TRATAMIENTO_FISCAL_ETIQUETA,
  TRATAMIENTOS_FISCALES,
  TRIBUTOS_ARCA,
  type AmbienteFiscal,
  type ConfigFiscalVista,
  type EmisionPruebaArca,
  type NumeracionArca,
  type PruebaArca,
  type TratamientoConcepto,
} from '@shared';
import { api, ApiError, errorMessage } from '../../lib/api';
import { Modal } from '../../components/Modal';
import { Badge, Button, Card, Check, ErrorState, Field, FormAlert, SelectField, Skeleton } from '../../components/ui';

const TONO: Record<AmbienteFiscal, 'neutral' | 'alerta' | 'exito'> = { simulado: 'neutral', homologacion: 'alerta', produccion: 'exito' };
const CORTO: Record<AmbienteFiscal, string> = { simulado: 'Simulada', homologacion: 'Homologación', produccion: 'Producción' };

export function FacturaElectronica({ cooperativaId }: { cooperativaId: number }) {
  const clave = ['srv', 'fiscal', cooperativaId];
  const consulta = useQuery({ queryKey: clave, queryFn: () => api.get<ConfigFiscalVista>(`/cooperativas/${cooperativaId}/fiscal`) });
  // Acá y no en la configuración: al terminar la prueba se recarga la vista y la configuración se rearma.
  const [prueba, setPrueba] = useState<PruebaArca | null>(null);
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-tinta">Factura electrónica (ARCA)</h2>
        {consulta.data && <Badge tone={TONO[consulta.data.ambiente]}>{CORTO[consulta.data.ambiente]}</Badge>}
      </div>
      <p className="mt-1 text-tinta-suave">
        Las facturas salen con el CUIT de la cooperativa y su certificado. Para probar sin la cooperativa, usá un certificado de homologación con tu propio CUIT.
      </p>
      {consulta.isPending ? (
        <Skeleton className="mt-5 h-72 rounded-xl" />
      ) : consulta.isError || !consulta.data ? (
        <ErrorState message={errorMessage(consulta.error)} onRetry={() => void consulta.refetch()} />
      ) : (
        <Configuracion key={consulta.dataUpdatedAt} cooperativaId={cooperativaId} vista={consulta.data} prueba={prueba} onPrueba={setPrueba} />
      )}
    </Card>
  );
}

function Configuracion({
  cooperativaId,
  vista,
  prueba,
  onPrueba,
}: {
  cooperativaId: number;
  vista: ConfigFiscalVista;
  prueba: PruebaArca | null;
  onPrueba: (p: PruebaArca) => void;
}) {
  const qc = useQueryClient();
  const base = `/cooperativas/${cooperativaId}/fiscal`;
  const [ambiente, setAmbiente] = useState<AmbienteFiscal>(vista.ambiente);
  const [cuit, setCuit] = useState(vista.cuitPropio ?? '');
  const [puntoVenta, setPuntoVenta] = useState(String(vista.puntoVenta));
  const [confirmar, setConfirmar] = useState(false);
  const [tratamientos, setTratamientos] = useState<Record<string, TratamientoConcepto>>(vista.tratamientos);
  const [campos, setCampos] = useState<Record<string, string>>({});
  const [sincronizar, setSincronizar] = useState(false);
  const adoptar = (v: ConfigFiscalVista) => qc.setQueryData(['srv', 'fiscal', cooperativaId], v);

  const guardar = useMutation({
    mutationFn: () =>
      api.put<ConfigFiscalVista>(base, { ambiente, cuit: cuit.trim() || null, puntoVenta: Number(puntoVenta), tratamientos, confirmarProduccion: confirmar || undefined }),
    onSuccess: (v) => {
      setCampos({});
      adoptar(v);
    },
    onError: (e) => setCampos(e instanceof ApiError && e.fields ? e.fields : {}),
  });
  const probar = useMutation({
    mutationFn: () => api.post<PruebaArca>(`${base}/probar`),
    onSuccess: (p) => {
      onPrueba(p);
      void qc.invalidateQueries({ queryKey: ['srv', 'fiscal', cooperativaId] });
    },
  });
  const pasaAProduccion = ambiente === 'produccion' && vista.ambiente !== 'produccion';
  const cambios =
    ambiente !== vista.ambiente || (cuit.trim() || null) !== vista.cuitPropio || Number(puntoVenta) !== vista.puntoVenta || JSON.stringify(tratamientos) !== JSON.stringify(vista.tratamientos);
  const tratamientoDe = (codigo: string, sugerido: TratamientoConcepto) => tratamientos[codigo] ?? sugerido;

  return (
    <div className="mt-5 space-y-6">
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          guardar.mutate();
        }}
        className="space-y-4"
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <SelectField label="Ambiente" value={ambiente} onChange={(e) => setAmbiente(e.target.value as AmbienteFiscal)} error={campos.ambiente}>
            {AMBIENTES_FISCALES.map((a) => (
              <option key={a} value={a}>
                {AMBIENTE_FISCAL_ETIQUETA[a]}
              </option>
            ))}
          </SelectField>
          <Field
            label="CUIT con el que factura"
            inputMode="numeric"
            value={cuit}
            onChange={(e) => setCuit(e.target.value)}
            placeholder={formatCuit(vista.cuit)}
            hint="Vacío = el de la cooperativa."
            error={campos.cuit}
          />
          <Field
            label="Punto de venta"
            inputMode="numeric"
            value={puntoVenta}
            onChange={(e) => setPuntoVenta(e.target.value.replace(/\D/g, ''))}
            hint="El habilitado para web services en ARCA."
            error={campos.puntoVenta}
          />
        </div>
        {vista.borradoresPendientes > 0 && (
          <p className="text-sm text-tinta-suave">Hay {vista.borradoresPendientes} pre-facturas sin emitir: hasta emitirlas no se puede cambiar el punto de venta.</p>
        )}
        {pasaAProduccion && (
          <div className="rounded-xl bg-alerta-tenue px-4 py-3">
            <Check
              checked={confirmar}
              onChange={(e) => setConfirmar(e.target.checked)}
              label="Confirmo que desde ahora cada factura que se emita tiene validez fiscal ante ARCA."
            />
          </div>
        )}

        {vista.conceptos.length > 0 && (
          <div>
            <p className="text-sm font-semibold text-tinta">Cómo va a ARCA cada concepto (lo define el contador)</p>
            <p className="text-sm text-tinta-suave">El IVA y lo que forma el neto se informan solos. Esto es para los impuestos, tasas y adicionales.</p>
            <div className="mt-2 divide-y divide-linea rounded-xl border border-linea">
              {vista.conceptos.map((c) => {
                const t = tratamientoDe(c.codigo, c.sugerido);
                const cambiar = (nuevo: Partial<TratamientoConcepto>) => {
                  const siguiente = { ...t, ...nuevo };
                  if (siguiente.tratamiento !== 'tributo') siguiente.tributoId = null;
                  else siguiente.tributoId ??= 99;
                  setTratamientos((x) => ({ ...x, [c.codigo]: siguiente }));
                };
                return (
                  <div key={c.codigo} className="grid gap-2 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_12rem_12rem] sm:items-center">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-tinta">{c.nombre}</p>
                      <p className="font-mono text-xs text-tinta-suave">{c.codigo}</p>
                    </div>
                    <select
                      aria-label={`Tratamiento de ${c.nombre}`}
                      value={t.tratamiento}
                      onChange={(e) => cambiar({ tratamiento: e.target.value as TratamientoConcepto['tratamiento'] })}
                      className="min-h-11 rounded-xl border border-linea bg-superficie px-3 text-[0.9375rem] text-tinta"
                    >
                      {TRATAMIENTOS_FISCALES.map((x) => (
                        <option key={x} value={x}>
                          {TRATAMIENTO_FISCAL_ETIQUETA[x]}
                        </option>
                      ))}
                    </select>
                    {t.tratamiento === 'tributo' ? (
                      <select
                        aria-label={`Tipo de tributo de ${c.nombre}`}
                        value={t.tributoId ?? 99}
                        onChange={(e) => cambiar({ tributoId: Number(e.target.value) })}
                        className="min-h-11 rounded-xl border border-linea bg-superficie px-3 text-[0.9375rem] text-tinta"
                      >
                        {TRIBUTOS_ARCA.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.nombre}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="hidden sm:block" />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {guardar.isError && !Object.keys(campos).length && <FormAlert>{errorMessage(guardar.error)}</FormAlert>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" icon={Save} loading={guardar.isPending} disabled={!cambios || (pasaAProduccion && !confirmar)}>
            Guardar
          </Button>
        </div>
      </form>

      <Certificado cooperativaId={cooperativaId} vista={vista} onCambio={adoptar} />

      <div className="space-y-3 border-t border-linea pt-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-semibold text-tinta">Probar la conexión</p>
            <p className="text-sm text-tinta-suave">
              {vista.ultimaPrueba ? `Última prueba: ${formatDateTime(vista.ultimaPrueba.el)} · ${vista.ultimaPrueba.ok ? 'todo bien' : 'con problemas'}` : 'Todavía no se probó.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" icon={PlugZap} loading={probar.isPending} disabled={vista.ambiente === 'simulado' || !vista.certificado} onClick={() => probar.mutate()}>
              Probar con ARCA
            </Button>
            <Button variant="secondary" icon={RefreshCw} disabled={vista.ambiente === 'simulado' || !vista.certificado} onClick={() => setSincronizar(true)}>
              Sincronizar numeración
            </Button>
          </div>
        </div>
        {probar.isError && <FormAlert>{errorMessage(probar.error)}</FormAlert>}
        {prueba && <ResultadoPrueba prueba={prueba} />}
      </div>

      {vista.ambiente === 'homologacion' && vista.certificado && <FacturasDePrueba cooperativaId={cooperativaId} />}

      <Ayuda />
      {sincronizar && <Sincronizar cooperativaId={cooperativaId} puntoVenta={vista.puntoVenta} onClose={() => setSincronizar(false)} />}
    </div>
  );
}

/** Lee un archivo de texto (.crt, .pem, .key). */
const leerTexto = (f: File) => f.text();

function Certificado({ cooperativaId, vista, onCambio }: { cooperativaId: number; vista: ConfigFiscalVista; onCambio: (v: ConfigFiscalVista) => void }) {
  const [certificado, setCertificado] = useState<{ nombre: string; texto: string } | null>(null);
  const [clave, setClave] = useState<{ nombre: string; texto: string } | null>(null);
  const crt = useRef<HTMLInputElement>(null);
  const key = useRef<HTMLInputElement>(null);
  const base = `/cooperativas/${cooperativaId}/fiscal/certificado`;
  const subir = useMutation({
    mutationFn: () => api.put<ConfigFiscalVista>(base, { certificado: certificado!.texto, clave: clave!.texto }),
    onSuccess: (v) => {
      setCertificado(null);
      setClave(null);
      onCambio(v);
    },
  });
  const borrar = useMutation({ mutationFn: () => api.del<ConfigFiscalVista>(base), onSuccess: onCambio });
  // Lo leído del disco no queda dando vueltas en la memoria de la página más de lo necesario.
  useEffect(() => () => (setCertificado(null), setClave(null)), []);

  const elegir = (set: typeof setCertificado) => async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) set({ nombre: f.name, texto: await leerTexto(f) });
  };
  const c = vista.certificado;

  return (
    <div className="space-y-3 border-t border-linea pt-5">
      <p className="font-semibold text-tinta">Certificado de ARCA</p>
      {c ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-linea bg-fondo px-4 py-3">
          <div className="min-w-0">
            <p className="break-words text-sm font-medium text-tinta">{c.titular}</p>
            <p className="text-sm text-tinta-suave">
              Vence el {formatDate(c.vence)} {c.vencido && <Badge tone="peligro">Vencido</Badge>}
            </p>
          </div>
          <Button variant="ghost" icon={Trash2} loading={borrar.isPending} onClick={() => borrar.mutate()}>
            Borrar
          </Button>
        </div>
      ) : (
        <p className="text-sm text-tinta-suave">No hay certificado cargado: la factura electrónica queda simulada.</p>
      )}
      {borrar.isError && <FormAlert>{errorMessage(borrar.error)}</FormAlert>}
      <div className="flex flex-wrap items-center gap-2">
        <input ref={crt} type="file" accept=".crt,.pem,.cer" className="hidden" onChange={(e) => void elegir(setCertificado)(e)} />
        <input ref={key} type="file" accept=".key,.pem" className="hidden" onChange={(e) => void elegir(setClave)(e)} />
        <Button variant="secondary" icon={FileKey} onClick={() => crt.current?.click()}>
          {certificado ? certificado.nombre : 'Elegir certificado (.crt)'}
        </Button>
        <Button variant="secondary" icon={FileKey} onClick={() => key.current?.click()}>
          {clave ? clave.nombre : 'Elegir clave privada (.key)'}
        </Button>
        <Button loading={subir.isPending} disabled={!certificado || !clave} onClick={() => subir.mutate()}>
          {c ? 'Reemplazar' : 'Cargar'}
        </Button>
      </div>
      <p className="text-xs text-tinta-suave">La clave privada se guarda cifrada y nunca vuelve a mostrarse ni a descargarse.</p>
      {subir.isError && <FormAlert>{errorMessage(subir.error)}</FormAlert>}
    </div>
  );
}

function ResultadoPrueba({ prueba }: { prueba: PruebaArca }) {
  return (
    <div className="rounded-xl border border-linea">
      <ul className="divide-y divide-linea">
        {prueba.pasos.map((p) => (
          <li key={p.nombre} className="flex items-start gap-3 px-4 py-2.5">
            {p.ok ? <CircleCheck className="mt-0.5 size-5 shrink-0 text-exito" aria-hidden /> : <CircleX className="mt-0.5 size-5 shrink-0 text-peligro" aria-hidden />}
            <div className="min-w-0">
              <p className="font-medium text-tinta">{p.nombre}</p>
              <p className="text-sm text-tinta-suave">{p.detalle}</p>
            </div>
          </li>
        ))}
      </ul>
      <p className={prueba.ok ? 'px-4 py-2.5 text-sm font-semibold text-exito' : 'px-4 py-2.5 text-sm font-semibold text-peligro'}>
        {prueba.ok ? 'Todo listo para facturar con ARCA.' : 'Hay algo para resolver antes de facturar.'}
      </p>
    </div>
  );
}

/** Solo en homologación: unas pocas facturas reales mandadas a ARCA con su mismo detalle, para ver el CAE. */
function FacturasDePrueba({ cooperativaId }: { cooperativaId: number }) {
  // Sin volver a pedir la configuración: eso rearma el panel y el resultado se perdería.
  const emitir = useMutation({ mutationFn: () => api.post<EmisionPruebaArca>(`/cooperativas/${cooperativaId}/fiscal/facturas-prueba`) });
  const e = emitir.data;
  return (
    <div className="space-y-3 border-t border-linea pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 max-w-prose">
          <p className="font-semibold text-tinta">Facturas de prueba</p>
          <p className="text-sm text-tinta-suave">
            Manda a ARCA una factura de cada tipo del último mes (por letra, servicio y condición frente al IVA), con su mismo detalle y la fecha de hoy. Las facturas de la cooperativa
            no cambian; los números que autorice ARCA se descuentan del talonario.
          </p>
        </div>
        <Button variant="secondary" icon={FlaskConical} loading={emitir.isPending} onClick={() => emitir.mutate()}>
          Emitir facturas de prueba
        </Button>
      </div>
      {emitir.isError && <FormAlert>{errorMessage(emitir.error)}</FormAlert>}
      {e && (
        <div className="rounded-xl border border-linea">
          <ul className="divide-y divide-linea">
            {e.facturas.map((f) => (
              <li key={f.muestraId} className="flex items-start gap-3 px-4 py-2.5">
                {f.cae ? <CircleCheck className="mt-0.5 size-5 shrink-0 text-exito" aria-hidden /> : <CircleX className="mt-0.5 size-5 shrink-0 text-peligro" aria-hidden />}
                <div className="min-w-0">
                  <p className="font-medium text-tinta">
                    Factura {f.letra} · {SERVICIO_ETIQUETA[f.servicio]} · {f.condicionIva ? CONDICION_IVA_ETIQUETA[f.condicionIva] : 'Consumidor final'} · {formatMoney(f.total)}
                  </p>
                  <p className="text-sm text-tinta-suave">
                    Socio {f.socio.numero} · {f.socio.nombre} · copia de {f.muestra}
                  </p>
                  {f.cae ? (
                    <p className="break-words font-mono text-sm text-tinta">
                      {f.referencia} · CAE {f.cae} · vence {formatDate(f.caeVence!)}
                    </p>
                  ) : (
                    <p className="break-words text-sm text-peligro">{f.motivo}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <p className={e.autorizadas === e.facturas.length ? 'px-4 py-2.5 text-sm font-semibold text-exito' : 'px-4 py-2.5 text-sm font-semibold text-peligro'}>
            ARCA autorizó {e.autorizadas} de {e.facturas.length} · punto de venta {e.puntoVenta} · {formatDate(e.fecha)}
          </p>
        </div>
      )}
    </div>
  );
}

const etiquetaTalonario = (n: NumeracionArca) => `${n.tipo === 'factura' ? 'Factura' : 'Nota de crédito'} ${n.letra}`;

function Sincronizar({ cooperativaId, puntoVenta, onClose }: { cooperativaId: number; puntoVenta: number; onClose: () => void }) {
  const qc = useQueryClient();
  const hacer = useMutation({
    mutationFn: () => api.post<NumeracionArca[]>(`/cooperativas/${cooperativaId}/fiscal/sincronizar`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['srv', 'fiscal', cooperativaId] }),
  });
  return (
    <Modal
      title="Sincronizar la numeración con ARCA"
      description={`Punto de venta ${puntoVenta}`}
      onClose={onClose}
      footer={
        hacer.isSuccess ? (
          <Button onClick={onClose}>Listo</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button icon={RefreshCw} loading={hacer.isPending} onClick={() => hacer.mutate()}>
              Sincronizar
            </Button>
          </>
        )
      }
    >
      {hacer.isSuccess ? (
        <ul className="space-y-1.5">
          {hacer.data.map((n) => (
            <li key={`${n.tipo}${n.letra}`} className="flex justify-between gap-3 text-tinta">
              <span>{etiquetaTalonario(n)}</span>
              <span className="font-mono">sigue desde el n.º {(n.enArca ?? n.enApp) + 1}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="space-y-3 text-tinta-suave">
          <p>
            Lleva la numeración de GestiónCoop hasta el último número que ya autorizó ARCA en este punto de venta. Sirve cuando la cooperativa ya facturaba con otro sistema en ese punto
            de venta.
          </p>
          <p>Nunca la hace retroceder: si GestiónCoop ya usó números que ARCA no tiene, hay que usar un punto de venta nuevo.</p>
          {hacer.isError && <FormAlert>{errorMessage(hacer.error)}</FormAlert>}
        </div>
      )}
    </Modal>
  );
}

function Ayuda() {
  return (
    <details className="rounded-xl border border-linea bg-fondo px-4 py-3">
      <summary className="cursor-pointer font-semibold text-tinta">Cómo conseguir el certificado</summary>
      <div className="mt-3 space-y-3 text-sm text-tinta-suave">
        <div>
          <p className="font-semibold text-tinta">Para probar (homologación), con tu propio CUIT</p>
          <ol className="mt-1 list-decimal space-y-1 pl-5">
            <li>Generá una clave privada y un pedido de certificado (CSR) en tu computadora.</li>
            <li>Entrá a ARCA con tu clave fiscal y habilitá el servicio «WSASS - Autogestión Certificados Homologación».</li>
            <li>En WSASS, pegá el CSR: te devuelve el certificado (.crt).</li>
            <li>Ahí mismo, creá la autorización del certificado para el servicio «wsfe».</li>
            <li>Cargá acá el .crt y la .key, elegí «Homologación» y probá.</li>
          </ol>
        </div>
        <div>
          <p className="font-semibold text-tinta">Para facturar de verdad (producción), con el CUIT de la cooperativa</p>
          <ol className="mt-1 list-decimal space-y-1 pl-5">
            <li>Quien administra la clave fiscal de la cooperativa entra a «Administración de Certificados Digitales» y crea el certificado con el CSR.</li>
            <li>En «Administrador de Relaciones de Clave Fiscal» lo asocia al servicio «Facturación electrónica (wsfe)».</li>
            <li>En «ABM de puntos de venta» da de alta un punto de venta para web services.</li>
            <li>Cargá acá el certificado, el punto de venta nuevo, elegí «Producción», confirmá y probá.</li>
          </ol>
        </div>
      </div>
    </details>
  );
}
