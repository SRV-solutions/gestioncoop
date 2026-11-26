import { useQuery } from '@tanstack/react-query';
import { Users } from 'lucide-react';
import { formatDateTime, initials, ROL_ETIQUETA, type UsuarioListado } from '@shared';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Badge, Card, Empty, ErrorState, PageHeader, Skeleton } from '../../components/ui';

function Avatar({ nombre }: { nombre: string }) {
  return (
    <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-marca-tenue text-sm font-bold text-marca-texto">
      {initials(nombre)}
    </span>
  );
}

function Estado({ u }: { u: UsuarioListado }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      <Badge tone={u.activo ? 'exito' : 'neutral'}>{u.activo ? 'Activo' : 'Desactivado'}</Badge>
      {u.esDemo && <Badge tone="alerta">De prueba</Badge>}
    </span>
  );
}

export function UsersPage() {
  const { me } = useAuth();
  const query = useQuery({ queryKey: ['users'], queryFn: () => api.get<UsuarioListado[]>('/users') });
  const users = query.data;

  return (
    <>
      <PageHeader
        title="Usuarios"
        description={`Quiénes pueden entrar al sistema de ${me?.cooperativa?.nombreCorto ?? 'la cooperativa'} y con qué rol.`}
      />
      <Card className="overflow-hidden">
        {query.isPending ? (
          <ul aria-label="Cargando usuarios" className="divide-y divide-linea">
            {[0, 1, 2, 3, 4].map((i) => (
              <li key={i} className="flex items-center gap-4 px-5 py-4">
                <Skeleton className="size-10 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-44" />
                  <Skeleton className="h-3 w-60" />
                </div>
              </li>
            ))}
          </ul>
        ) : query.isError ? (
          <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
        ) : !users || users.length === 0 ? (
          <Empty icon={Users} title="Todavía no hay usuarios">
            Los usuarios de la cooperativa van a aparecer acá.
          </Empty>
        ) : (
          <>
            {/* Escritorio: tabla */}
            <table className="hidden w-full text-left md:table">
              <thead className="border-b border-linea bg-fondo/60 text-xs font-semibold uppercase tracking-wide text-tinta-suave">
                <tr>
                  <th scope="col" className="px-5 py-3">Persona</th>
                  <th scope="col" className="px-5 py-3">Rol</th>
                  <th scope="col" className="px-5 py-3">Estado</th>
                  <th scope="col" className="px-5 py-3">Último ingreso</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-linea">
                {users.map((u) => (
                  <tr key={u.id}>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <Avatar nombre={u.nombre} />
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-tinta">{u.nombre}</p>
                          <p className="truncate text-sm text-tinta-suave">{u.email ?? 'Socio: entra con los datos de su factura'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="flex flex-wrap gap-1.5">
                        {u.roles.map((r) => (
                          <Badge key={r} tone="marca">{ROL_ETIQUETA[r]}</Badge>
                        ))}
                      </span>
                    </td>
                    <td className="px-5 py-3.5"><Estado u={u} /></td>
                    <td className="px-5 py-3.5 text-sm tabular-nums text-tinta-suave">
                      {u.ultimoIngresoEl ? formatDateTime(u.ultimoIngresoEl) : 'Nunca entró'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Celular: una tarjeta por persona */}
            <ul className="divide-y divide-linea md:hidden">
              {users.map((u) => (
                <li key={u.id} className="flex items-start gap-3 px-4 py-4">
                  <Avatar nombre={u.nombre} />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div>
                      <p className="truncate font-semibold text-tinta">{u.nombre}</p>
                      <p className="truncate text-sm text-tinta-suave">{u.email ?? 'Socio: entra con los datos de su factura'}</p>
                    </div>
                    <span className="flex flex-wrap gap-1.5">
                      {u.roles.map((r) => (
                        <Badge key={r} tone="marca">{ROL_ETIQUETA[r]}</Badge>
                      ))}
                      <Estado u={u} />
                    </span>
                    <p className="text-xs tabular-nums text-tinta-suave">
                      {u.ultimoIngresoEl ? `Último ingreso: ${formatDateTime(u.ultimoIngresoEl)}` : 'Nunca entró'}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
      {users && users.length > 0 && (
        <p className="mt-3 text-sm text-tinta-suave">
          {users.length} {users.length === 1 ? 'usuario' : 'usuarios'}
        </p>
      )}
    </>
  );
}
