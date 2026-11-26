import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ROL_RUTA, type AccesoSocioInput, type DemoLoginInput, type LoginInput, type Me, type Rol } from '@shared';
import { api, ApiError, refreshSession, setSessionLostHandler } from './api';

interface AuthValue {
  me: Me | null;
  loading: boolean;
  /** No se pudo saber si hay sesión (sin conexión o servidor caído). */
  failed: boolean;
  retry: () => void;
  hasRole: (rol: Rol) => boolean;
  /** Pantalla de inicio que le corresponde según su rol principal. */
  home: string;
  /** El personal: email y contraseña. */
  login: (input: LoginInput) => Promise<Me>;
  /** El socio: código de socio, conexión y documento. Sin contraseña. */
  accesoSocio: (input: AccesoSocioInput) => Promise<Me>;
  demoLogin: (input: DemoLoginInput) => Promise<Me>;
  /** Solo superadmin: entra a una cooperativa, o sale con `null`. */
  setCooperativa: (cooperativaId: number | null) => Promise<Me>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

/* Última sesión conocida (solo quién es y de qué cooperativa: ninguna credencial). Sirve únicamente
 * para que el área del operario abra sin señal. */
const CLAVE_SESION = 'coopgestion-sesion';
function recordar<T extends Me | null>(me: T): T {
  try {
    if (me?.user.roles.includes('operario')) localStorage.setItem(CLAVE_SESION, JSON.stringify(me));
    else localStorage.removeItem(CLAVE_SESION);
  } catch {
    /* almacenamiento no disponible */
  }
  return me;
}
function recordada(): Me | null {
  try {
    return JSON.parse(localStorage.getItem(CLAVE_SESION) ?? 'null') as Me | null;
  } catch {
    return null;
  }
}

/** Adónde va cada uno al entrar. El superadmin sin cooperativa elegida solo tiene su panel. */
export function homeFor(me: Me | null): string {
  const first = me?.user.roles[0];
  if (!me || !first) return '/login';
  if (first === 'superadmin') return me.cooperativa ? ROL_RUTA.gerencia : ROL_RUTA.superadmin;
  return ROL_RUTA[first];
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return recordar(await api.get<Me>('/auth/me'));
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          // Intenta renovar la sesión una vez antes de mandar al ingreso
          if (await refreshSession()) return recordar(await api.get<Me>('/auth/me'));
          return recordar(null);
        }
        // Sin señal: el operario tiene que poder abrir la app en la calle. Se usa la última sesión
        // conocida de este teléfono; el servidor igual valida cada envío cuando vuelve la conexión.
        if (e instanceof ApiError && e.code === 'offline') {
          const guardada = recordada();
          if (guardada) return guardada;
        }
        throw e;
      }
    },
    staleTime: 60_000,
    retry: false,
    // Sin señal también tiene que correr: es la que recupera la sesión guardada.
    networkMode: 'always',
  });

  useEffect(() => {
    setSessionLostHandler(() => qc.setQueryData(['me'], null));
  }, [qc]);

  const me = query.data ?? null;

  /**
   * Cambió quién usa la app o en qué cooperativa: nada de lo que estaba en memoria sirve.
   * Primero se actualiza 'me' (así se enteran las pantallas) y después se descarta todo lo demás;
   * con qc.clear() se borraría también 'me' y nadie se enteraría del cambio.
   */
  const adopt = <T extends Me | null>(next: T): T => {
    qc.setQueryData(['me'], recordar(next));
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
    return next;
  };

  const value: AuthValue = {
    me,
    loading: query.isLoading,
    failed: query.isError,
    retry: () => void query.refetch(),
    hasRole: (rol) => me?.user.roles.includes(rol) ?? false,
    home: homeFor(me),
    login: async (input) => adopt(await api.post<Me>('/auth/login', input)),
    accesoSocio: async (input) => adopt(await api.post<Me>('/auth/acceso-socio', input)),
    demoLogin: async (input) => adopt(await api.post<Me>('/auth/demo', input)),
    setCooperativa: async (cooperativaId) => adopt(await api.post<Me>('/auth/cooperativa', { cooperativaId })),
    logout: async () => {
      await api.post('/auth/logout').catch(() => undefined);
      adopt(null);
    },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth fuera de AuthProvider');
  return ctx;
}
