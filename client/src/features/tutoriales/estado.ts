// Estado de los tutoriales. Sin contexto de React: cualquier pantalla puede abrir uno con
// iniciarTutorial(id), o la lista con abrirTutoriales().
import { useSyncExternalStore } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SIN_TUTORIALES, type AvanceTutoriales } from '@shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';

interface Estado {
  /** Tutorial que se está mostrando y en qué paso. */
  actual: { id: string; paso: number } | null;
  /** La lista de tutoriales (se abre desde el menú del usuario). */
  lista: boolean;
}

let estado: Estado = { actual: null, lista: false };
const oyentes = new Set<() => void>();
const cambiar = (nuevo: Partial<Estado>) => {
  estado = { ...estado, ...nuevo };
  oyentes.forEach((o) => o());
};
const suscribir = (o: () => void) => {
  oyentes.add(o);
  return () => void oyentes.delete(o);
};

export const iniciarTutorial = (id: string) => cambiar({ actual: { id, paso: 0 }, lista: false });
export const irAlPaso = (paso: number) => estado.actual && cambiar({ actual: { ...estado.actual, paso } });
export const cerrarTutorial = () => cambiar({ actual: null });
export const abrirTutoriales = () => cambiar({ lista: true, actual: null });
export const cerrarTutoriales = () => cambiar({ lista: false });
export const hayTutorialAbierto = () => estado.actual !== null;

export const useTutoriales = () => useSyncExternalStore(suscribir, () => estado);

/** Qué tutoriales hizo u omitió quien está usando la app. Se guarda en su cuenta. */
export function useAvance() {
  const qc = useQueryClient();
  const { me } = useAuth();
  const consulta = useQuery({
    queryKey: ['tutoriales'],
    queryFn: () => api.get<AvanceTutoriales>('/auth/tutoriales'),
    enabled: !!me,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const guardar = useMutation({
    mutationFn: (a: AvanceTutoriales) => api.put<AvanceTutoriales>('/auth/tutoriales', a),
    // Se muestra enseguida; si no se pudo guardar (sin señal), vale igual para esta visita.
    onMutate: (a) => qc.setQueryData(['tutoriales'], a),
  });
  const avance = consulta.data ?? SIN_TUTORIALES;
  const sin = (lista: string[], id: string) => lista.filter((x) => x !== id);

  return {
    cargado: consulta.isSuccess,
    avance,
    marcar: (id: string, como: 'hecho' | 'omitido') =>
      guardar.mutate({
        hechos: como === 'hecho' ? [...sin(avance.hechos, id), id] : avance.hechos,
        omitidos: como === 'omitido' ? [...sin(avance.omitidos, id), id] : sin(avance.omitidos, id),
      }),
    reiniciar: () => guardar.mutate(SIN_TUTORIALES),
  };
}
