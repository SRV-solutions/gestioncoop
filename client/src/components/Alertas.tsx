// La campana: alertas para la administración, la gerencia y SRV (por ejemplo, la verificación de
// integridad que encontró problemas). Se consulta sola cada minuto. A SRV le llegan las de todas las
// cooperativas: al abrir una, entra a esa cooperativa.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck, Mail } from 'lucide-react';
import { formatDateTime, type AlertaVista, type BandejaAlertas } from '@shared';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { cn } from '../lib/cn';
import { Modal } from './Modal';
import { Button, Empty } from './ui';

const CORREO: Record<AlertaVista['correo'], string | null> = {
  enviado: 'También te llegó por mail.',
  simulado: 'Mail simulado (la demo no envía mails).',
  fallido: 'No se pudo mandar el mail.',
  sin_correo: null,
};

export function Alertas({ onDark, className }: { onDark?: boolean; className?: string }) {
  const { me, hasRole, setCooperativa } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [abierta, setAbierta] = useState(false);
  const habilitada = hasRole('superadmin') || hasRole('admin') || hasRole('gerencia');
  const bandeja = useQuery({
    queryKey: ['alertas'],
    queryFn: () => api.get<BandejaAlertas>('/alertas'),
    enabled: habilitada,
    refetchInterval: 60_000,
  });
  const refrescar = () => void qc.invalidateQueries({ queryKey: ['alertas'] });
  const leer = useMutation({ mutationFn: (id: number) => api.post(`/alertas/${id}/leida`), onSettled: refrescar });
  const leerTodas = useMutation({ mutationFn: () => api.post('/alertas/leer-todas'), onSettled: refrescar });

  if (!habilitada) return null;
  const sinLeer = bandeja.data?.sinLeer ?? 0;

  const abrir = async (a: AlertaVista) => {
    if (!a.leida) leer.mutate(a.id);
    if (!a.enlace) return;
    // SRV entra primero a la cooperativa de la alerta.
    if (hasRole('superadmin') && me?.cooperativa?.id !== a.cooperativa.id) await setCooperativa(a.cooperativa.id);
    setAbierta(false);
    navigate(a.enlace);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierta(true)}
        aria-label={sinLeer ? `Alertas: ${sinLeer} sin leer` : 'Alertas'}
        className={cn('relative grid size-11 shrink-0 place-items-center rounded-xl', onDark ? 'hover:bg-white/10' : 'hover:bg-marca-tenue', className)}
      >
        <Bell className="size-5" aria-hidden />
        {sinLeer > 0 && (
          <span className="absolute right-1.5 top-1.5 grid min-w-5 place-items-center rounded-full bg-peligro px-1 text-[0.6875rem] font-bold leading-5 text-sobre-estado">
            {sinLeer > 9 ? '9+' : sinLeer}
          </span>
        )}
      </button>
      {abierta && (
        <Modal
          title="Alertas"
          description="Avisos importantes sobre los datos de la cooperativa."
          onClose={() => setAbierta(false)}
          footer={
            sinLeer > 0 ? (
              <Button variant="secondary" icon={CheckCheck} loading={leerTodas.isPending} onClick={() => leerTodas.mutate()}>
                Marcar todas como leídas
              </Button>
            ) : undefined
          }
        >
          {bandeja.data && bandeja.data.alertas.length === 0 ? (
            <Empty icon={Bell} title="No hay alertas">
              Cuando pase algo que tengas que mirar, te avisamos acá y por mail.
            </Empty>
          ) : (
            <ul className="-mx-1 space-y-2">
              {bandeja.data?.alertas.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => void abrir(a)}
                    className={cn('w-full rounded-xl border px-4 py-3 text-left transition-colors', a.leida ? 'border-linea bg-superficie' : 'border-peligro/40 bg-peligro-tenue')}
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-semibold text-tinta">{a.titulo}</p>
                      <p className="text-xs text-tinta-suave">{formatDateTime(a.creadaEl)}</p>
                    </div>
                    {hasRole('superadmin') && <p className="text-sm font-semibold text-marca-texto">{a.cooperativa.nombreCorto}</p>}
                    {/* El resumen: los dos primeros párrafos; el detalle está en la pantalla a la que lleva. */}
                    <p className="mt-1 line-clamp-3 text-sm text-tinta-suave">{a.cuerpo.split('\n\n').slice(0, 2).join(' ')}</p>
                    {CORREO[a.correo] && (
                      <p className="mt-1.5 flex items-center gap-1.5 text-xs text-tinta-suave">
                        <Mail className="size-3.5" aria-hidden />
                        {CORREO[a.correo]}
                      </p>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}
    </>
  );
}
