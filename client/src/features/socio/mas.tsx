// «Más» del portal: mis conexiones, sepelio, mis datos (con la factura digital), mis pagos y reclamos.
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, CircleUser, FileDown, HeartHandshake, MapPin, MessageSquareWarning, Phone, Receipt, Wallet, type LucideIcon } from 'lucide-react';
import { formatDate, formatMoney, formatNumber, MEDIO_PAGO_ETIQUETA, type ContactoInput, type CuentaPortal, type PagoListado } from '@shared';
import { abrirPdf, api, ApiError, errorMessage } from '../../lib/api';
import { Button, Card, Check, Empty, ErrorState, Field, FormAlert, Skeleton } from '../../components/ui';
import { ConexionCard } from '../padron/ConexionCard';
import { SubPagina, Titulo } from './piezas';

const useCuenta = () => useQuery({ queryKey: ['socio', 'cuenta'], queryFn: () => api.get<CuentaPortal>('/socio/cuenta') });

const OPCIONES: { to: string; titulo: string; texto: string; icon: LucideIcon }[] = [
  { to: '/socio/mas/reclamos', titulo: 'Reclamos', texto: 'Avisá un problema y seguí cómo va.', icon: MessageSquareWarning },
  { to: '/socio/mas/pagos', titulo: 'Mis pagos', texto: 'Tus recibos, para descargar.', icon: Wallet },
  { to: '/socio/mas/conexiones', titulo: 'Mis conexiones', texto: 'Tus domicilios, servicios y medidores.', icon: MapPin },
  { to: '/socio/mas/sepelio', titulo: 'Sepelio', texto: 'Las personas adheridas a tu servicio.', icon: HeartHandshake },
  { to: '/socio/mas/datos', titulo: 'Mis datos', texto: 'Tu email, tu celular y la factura digital.', icon: CircleUser },
];

export function MasPage() {
  return (
    <>
      <Titulo>Más</Titulo>
      <Card className="overflow-hidden">
        <ul className="divide-y divide-linea">
          {OPCIONES.map((o) => (
            <li key={o.to}>
              <Link to={o.to} className="flex min-h-20 items-center gap-4 px-4 py-3 transition-colors duration-100 hover:bg-marca-tenue/40">
                <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-marca-tenue text-marca-texto">
                  <o.icon className="size-5" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-bold text-tinta">{o.titulo}</span>
                  <span className="block text-tinta-suave">{o.texto}</span>
                </span>
                <ChevronRight className="size-5 shrink-0 text-tinta-suave" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

const volverMas = { to: '/socio/mas', texto: 'Más' };

export function ConexionesPage() {
  const consulta = useCuenta();
  const c = consulta.data;
  return (
    <SubPagina titulo="Mis conexiones" volver={volverMas}>
      {consulta.isPending ? (
        <Skeleton className="h-72 rounded-2xl" />
      ) : consulta.isError || !c ? (
        <ErrorState message={errorMessage(consulta.error)} onRetry={() => void consulta.refetch()} />
      ) : (
        <div className="space-y-3">
          <p className="text-tinta-suave">
            Socio N° <strong className="text-tinta">{c.numero}</strong> · {c.tipoDoc} {c.tipoDoc === 'DNI' ? formatNumber(c.nroDoc) : c.nroDoc}
          </p>
          {c.conexiones.map((x) => (
            <ConexionCard key={x.id} conexion={x} />
          ))}
          <p className="text-sm text-tinta-suave">Para dar de alta o de baja un servicio, acercate a la cooperativa.</p>
        </div>
      )}
    </SubPagina>
  );
}

export function SepelioPage() {
  const consulta = useCuenta();
  const c = consulta.data;
  return (
    <SubPagina titulo="Sepelio" volver={volverMas}>
      {consulta.isPending ? (
        <Skeleton className="h-60 rounded-2xl" />
      ) : consulta.isError || !c ? (
        <ErrorState message={errorMessage(consulta.error)} onRetry={() => void consulta.refetch()} />
      ) : c.beneficiarios.length === 0 ? (
        <Card>
          <Empty icon={HeartHandshake} title="No tenés personas adheridas">
            Si querés sumar a alguien de tu familia al servicio de sepelio, acercate a la cooperativa.
          </Empty>
        </Card>
      ) : (
        <>
          <Card className="overflow-hidden">
            <ul className="divide-y divide-linea">
              {c.beneficiarios.map((b) => (
                <li key={b.id} className="flex items-center gap-3 px-4 py-3.5">
                  <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-marca-tenue text-marca-texto">
                    <HeartHandshake className="size-5" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-bold text-tinta">{b.nombre}</span>
                    <span className="block text-tinta-suave">
                      {b.parentesco} · DNI {formatNumber(b.nroDoc)} · desde el {formatDate(b.altaEl)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
          <p className="mt-3 text-sm text-tinta-suave">Para sumar o quitar a alguien, acercate a la cooperativa con su DNI.</p>
        </>
      )}
    </SubPagina>
  );
}

export function DatosPage() {
  const consulta = useCuenta();
  return (
    <SubPagina titulo="Mis datos" volver={volverMas}>
      {consulta.isPending ? (
        <Skeleton className="h-72 rounded-2xl" />
      ) : consulta.isError || !consulta.data ? (
        <ErrorState message={errorMessage(consulta.error)} onRetry={() => void consulta.refetch()} />
      ) : (
        <FormDatos cuenta={consulta.data} />
      )}
    </SubPagina>
  );
}

function FormDatos({ cuenta }: { cuenta: CuentaPortal }) {
  const qc = useQueryClient();
  const [datos, setDatos] = useState<ContactoInput>({ email: cuenta.email ?? '', telefono: cuenta.telefono ?? '', facturaDigital: cuenta.facturaDigital });
  const [guardado, setGuardado] = useState(false);
  const guardar = useMutation({
    mutationFn: () => api.put<CuentaPortal>('/socio/contacto', datos),
    onSuccess: (c) => {
      qc.setQueryData(['socio', 'cuenta'], c);
      setGuardado(true);
    },
  });
  const campos = guardar.error instanceof ApiError ? (guardar.error.fields ?? {}) : {};
  const cambiar = (d: Partial<ContactoInput>) => {
    setDatos((x) => ({ ...x, ...d }));
    setGuardado(false);
  };
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    guardar.mutate();
  };

  return (
    <form onSubmit={enviar} noValidate className="space-y-4">
      <Card className="space-y-4 px-5 py-5">
        <p className="text-tinta-suave">
          <strong className="text-tinta">{cuenta.nombre}</strong> · socio N° {cuenta.numero}
        </p>
        <Field label="Email" type="email" inputMode="email" autoComplete="email" value={datos.email ?? ''} onChange={(e) => cambiar({ email: e.target.value })} error={campos.email} />
        <Field
          label="Celular"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={datos.telefono ?? ''}
          onChange={(e) => cambiar({ telefono: e.target.value })}
          error={campos.telefono}
          hint="Para avisarte de cortes y de tus reclamos."
          trailing={<Phone className="mr-3 size-5 text-tinta-suave" aria-hidden />}
        />
      </Card>
      <Card className="px-5 py-4">
        <Check
          label={
            <span>
              <span className="block font-bold">Factura digital</span>
              <span className="block font-normal text-tinta-suave">Te llega por email y dejás de recibirla en papel.</span>
            </span>
          }
          checked={datos.facturaDigital ?? false}
          onChange={(e) => cambiar({ facturaDigital: e.target.checked })}
        />
      </Card>
      {guardar.isError && !Object.keys(campos).length && <FormAlert>{errorMessage(guardar.error)}</FormAlert>}
      <Button type="submit" size="lg" className="w-full" loading={guardar.isPending}>
        Guardar
      </Button>
      {guardado && (
        <p role="status" className="text-center font-semibold text-exito">
          Listo, guardamos tus datos.
        </p>
      )}
    </form>
  );
}

export function PagosSocioPage() {
  const consulta = useQuery({ queryKey: ['socio', 'pagos'], queryFn: () => api.get<PagoListado[]>('/socio/pagos') });
  const recibo = useMutation({ mutationFn: (id: number) => abrirPdf(`/socio/pagos/${id}/recibo`) });
  const pagos = consulta.data;
  return (
    <SubPagina titulo="Mis pagos" volver={volverMas}>
      {consulta.isPending ? (
        <Skeleton className="h-72 rounded-2xl" />
      ) : consulta.isError || !pagos ? (
        <ErrorState message={errorMessage(consulta.error)} onRetry={() => void consulta.refetch()} />
      ) : pagos.length === 0 ? (
        <Card>
          <Empty icon={Receipt} title="Todavía no hay pagos">
            Cuando pagues una factura, en la caja o desde acá, vas a tener el recibo en esta pantalla.
          </Empty>
        </Card>
      ) : (
        <>
          <Card className="overflow-hidden">
            <ul className="divide-y divide-linea">
              {pagos.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => recibo.mutate(p.id)}
                    className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors duration-100 hover:bg-marca-tenue/40"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block font-bold text-tinta">{formatDate(p.cobradoEl)}</span>
                      <span className="block text-sm text-tinta-suave">
                        {p.origen === 'online' ? 'Online' : 'En la caja'} · {MEDIO_PAGO_ETIQUETA[p.medio]} · {p.concepto}
                      </span>
                    </span>
                    <span className="shrink-0 text-lg font-bold tabular-nums text-tinta">{formatMoney(p.importe)}</span>
                    <FileDown className="size-5 shrink-0 text-marca-texto" aria-label="Descargar el recibo" />
                  </button>
                </li>
              ))}
            </ul>
          </Card>
          {recibo.isError && <p className="mt-2 text-sm font-medium text-peligro">{errorMessage(recibo.error)}</p>}
          <p className="mt-3 text-sm text-tinta-suave">Tocá un pago para descargar el recibo.</p>
        </>
      )}
    </SubPagina>
  );
}
