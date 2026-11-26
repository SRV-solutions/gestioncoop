import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Banknote,
  Droplets,
  Eye,
  EyeOff,
  FileText,
  Flame,
  HardHat,
  HeartHandshake,
  LayoutDashboard,
  Settings,
  Tv,
  User,
  Wifi,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import {
  accesoSocioSchema,
  APP_LEMA,
  loginSchema,
  ROL_ETIQUETA,
  SERVICIO_ETIQUETA,
  type LoginContext,
  type LoginInput,
  type Me,
  type Rol,
  type Servicio,
} from '@shared';
import { api, ApiError, errorMessage, qs } from '../../lib/api';
import { homeFor, useAuth } from '../../lib/auth';
import { cn } from '../../lib/cn';
import { cuentasRecordadas, olvidarCuenta, recordarCuenta, type CuentaRecordada } from '../../lib/cuentas';
import { BotonTema, CoopMark, NombreProducto, PoweredBy } from '../../components/Logo';
import { Button, ErrorState, Field, FormAlert, Skeleton } from '../../components/ui';

const SERVICIO_ICON: Record<Servicio, LucideIcon> = {
  energia: Zap,
  agua: Droplets,
  internet: Wifi,
  tv: Tv,
  sepelio: HeartHandshake,
  gas: Flame,
};

const ROL_ICON: Partial<Record<Rol, LucideIcon>> = {
  socio: User,
  operario: HardHat,
  cajero: Banknote,
  facturacion: FileText,
  gerencia: LayoutDashboard,
  admin: Settings,
};

/** Anillos decorativos del panel de marca: evocan el dial de un medidor. */
function Rings() {
  return (
    <svg aria-hidden viewBox="0 0 600 600" className="pointer-events-none absolute -right-40 -top-40 size-[38rem] max-lg:-right-56 max-lg:-top-72">
      {[110, 170, 230, 290].map((r) => (
        <circle key={r} cx="300" cy="300" r={r} fill="none" stroke="white" strokeOpacity="0.08" strokeWidth="1.5" />
      ))}
      {/* Solo se ve el cuadrante inferior izquierdo: los arcos van ahí. En el celular se ocultan para no cruzar el nombre. */}
      <path className="max-lg:hidden" d="M130 300 A170 170 0 0 0 300 470" fill="none" stroke="var(--acento)" strokeWidth="5" strokeLinecap="round" />
      {/* Sobre el anillo de radio 230: de los 150° a los 120° (el naranja va sobre el de 170). */}
      <path className="max-lg:hidden" d="M100.8 415 A230 230 0 0 0 185 499.2" fill="none" stroke="var(--marca-claro)" strokeWidth="5" strokeLinecap="round" strokeOpacity="0.8" />
    </svg>
  );
}

/* Con qué formulario abre la pantalla: el que usó la última vez en este dispositivo. */
type Modo = 'socio' | 'personal';
const CLAVE_MODO = 'coopgestion-ingreso';
function modoGuardado(): Modo {
  try {
    return localStorage.getItem(CLAVE_MODO) === 'personal' ? 'personal' : 'socio';
  } catch {
    return 'socio';
  }
}
function guardarModo(modo: Modo): void {
  try {
    localStorage.setItem(CLAVE_MODO, modo);
  } catch {
    /* almacenamiento no disponible */
  }
}

const VACIO = { socio: '', conexion: '', documento: '' };
type CampoSocio = keyof typeof VACIO;

/**
 * Ingreso del socio: código de socio, número de conexión y documento, los tres de su factura.
 * No tiene usuario ni contraseña. Las cuentas que ya se abrieron en este dispositivo quedan a un
 * toque (falta escribir solo el documento).
 */
function IngresoSocio({ subdominio, bloqueado, onEntrar }: { subdominio: string | undefined; bloqueado: boolean; onEntrar: (me: Me) => void }) {
  const { accesoSocio } = useAuth();
  const [datos, setDatos] = useState(VACIO);
  const [campos, setCampos] = useState<Partial<Record<CampoSocio, string>>>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [recordadas, setRecordadas] = useState<CuentaRecordada[] | null>(null);
  const documento = useRef<HTMLInputElement>(null);
  const cuentas = recordadas ?? cuentasRecordadas(subdominio);

  const campo = (nombre: CampoSocio) => ({
    value: datos[nombre],
    error: campos[nombre],
    onChange: (e: ChangeEvent<HTMLInputElement>) => {
      setDatos((d) => ({ ...d, [nombre]: e.target.value }));
      setCampos((c) => ({ ...c, [nombre]: undefined }));
    },
  });

  const elegir = (c: CuentaRecordada) => {
    setDatos({ socio: String(c.socio), conexion: String(c.conexion), documento: '' });
    setCampos({});
    setGeneral(null);
    documento.current?.focus();
  };

  const olvidar = (c: CuentaRecordada) => {
    olvidarCuenta(c);
    setRecordadas(cuentasRecordadas(subdominio));
  };

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setGeneral(null);
    const leido = accesoSocioSchema.safeParse({ ...datos, cooperativa: subdominio });
    if (!leido.success) {
      const errores: Partial<Record<CampoSocio, string>> = {};
      for (const i of leido.error.issues) {
        const nombre = i.path[0] as CampoSocio;
        if (nombre in VACIO && !errores[nombre]) errores[nombre] = i.message;
      }
      setCampos(errores);
      return;
    }
    setEnviando(true);
    try {
      const me = await accesoSocio({ ...datos, cooperativa: subdominio });
      if (me.cooperativa) recordarCuenta({ coop: me.cooperativa.subdominio, nombre: me.user.nombre, socio: leido.data.socio, conexion: leido.data.conexion });
      onEntrar(me);
    } catch (err) {
      if (err instanceof ApiError && err.fields) setCampos(err.fields as Partial<Record<CampoSocio, string>>);
      else setGeneral(errorMessage(err));
      setEnviando(false);
    }
  };

  return (
    <>
      {cuentas.length > 0 && (
        <section aria-labelledby="cuentas-titulo" className="mt-6">
          <h2 id="cuentas-titulo" className="text-sm font-semibold text-tinta-suave">
            Cuentas que abriste en este dispositivo
          </h2>
          <ul className="mt-2 space-y-2">
            {cuentas.map((c) => {
              const elegida = datos.socio === String(c.socio) && datos.conexion === String(c.conexion);
              return (
                <li key={c.socio} className={cn('flex items-stretch rounded-xl border bg-superficie transition-colors duration-150', elegida ? 'border-marca' : 'border-linea hover:border-marca-claro')}>
                  <button type="button" onClick={() => elegir(c)} aria-pressed={elegida} className="flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-l-xl px-3 text-left">
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-marca-tenue text-marca-texto">
                      <User className="size-5" aria-hidden />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-bold text-tinta">{c.nombre}</span>
                      <span className="block truncate text-xs text-tinta-suave">
                        Socio {c.socio} · Conexión {c.conexion}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => olvidar(c)}
                    aria-label={`Quitar la cuenta de ${c.nombre} de este dispositivo`}
                    title="Quitar de este dispositivo"
                    className="grid w-11 shrink-0 place-items-center rounded-r-xl text-tinta-suave hover:bg-marca-tenue hover:text-marca-texto"
                  >
                    <X className="size-4" aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <form onSubmit={(e) => void enviar(e)} noValidate className="mt-6 space-y-4" data-tour="ingreso-socio">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Código de socio" inputMode="numeric" autoComplete="off" autoFocus={cuentas.length === 0} {...campo('socio')} />
          <Field label="Número de conexión" inputMode="numeric" autoComplete="off" {...campo('conexion')} />
        </div>
        <p className="!mt-2 text-sm text-tinta-suave">En tu factura figuran como «Socio N°» y «Conexión N°», debajo de tu nombre.</p>
        <Field ref={documento} label="DNI, CUIT o CUIL" inputMode="numeric" autoComplete="off" hint="El del titular de la cuenta." {...campo('documento')} />
        {general && <FormAlert>{general}</FormAlert>}
        <Button type="submit" size="lg" loading={enviando} disabled={bloqueado} className="w-full">
          Ver mi cuenta
        </Button>
        <p className="text-sm text-tinta-suave">
          La cuenta queda abierta en este dispositivo por 3 meses. Si lo compartís con otras personas, salí cuando termines.
        </p>
      </form>
    </>
  );
}

/** Ingreso del personal de la cooperativa: email y contraseña. */
function IngresoPersonal({ subdominio, bloqueado, onEntrar }: { subdominio: string | undefined; bloqueado: boolean; onEntrar: (me: Me) => void }) {
  const { login } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<LoginInput>({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      onEntrar(await login({ ...values, cooperativa: subdominio }));
    } catch (e) {
      if (e instanceof ApiError && e.fields) {
        for (const [name, message] of Object.entries(e.fields)) {
          if (name === 'email' || name === 'password') form.setError(name, { message });
        }
      }
      setFormError(errorMessage(e));
      form.setFocus('password');
    }
  });

  return (
    <form onSubmit={(e) => void onSubmit(e)} noValidate className="mt-6 space-y-4">
      <Field
        label="Email"
        type="email"
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        autoFocus
        error={errors.email?.message}
        {...form.register('email')}
      />
      <Field
        label="Contraseña"
        type={showPassword ? 'text' : 'password'}
        autoComplete="current-password"
        error={errors.password?.message}
        trailing={
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            aria-pressed={showPassword}
            className="grid size-10 place-items-center rounded-lg text-tinta-suave hover:bg-marca-tenue hover:text-marca-texto"
          >
            {showPassword ? <EyeOff className="size-5" aria-hidden /> : <Eye className="size-5" aria-hidden />}
          </button>
        }
        {...form.register('password')}
      />
      {formError && <FormAlert>{formError}</FormAlert>}
      <Button type="submit" size="lg" loading={isSubmitting} disabled={bloqueado} className="w-full">
        Ingresar
      </Button>
    </form>
  );
}

const MODOS: { valor: Modo; nombre: string; ayuda: string }[] = [
  { valor: 'socio', nombre: 'Soy socio', ayuda: 'Con tres datos de tu factura. Sin usuario ni contraseña.' },
  { valor: 'personal', nombre: 'Trabajo en la cooperativa', ayuda: 'Con tu email y tu contraseña.' },
];

export function LoginPage() {
  const { me, demoLogin } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const coop = params.get('coop') ?? undefined;

  const context = useQuery({
    queryKey: ['login-context', coop ?? ''],
    queryFn: () => api.get<LoginContext>(`/auth/context${qs({ coop })}`),
    staleTime: 5 * 60_000,
    placeholderData: (previous) => previous,
  });
  const data = context.data;

  const [modo, setModo] = useState<Modo>(modoGuardado);
  const [formError, setFormError] = useState<string | null>(null);
  const [demoBusy, setDemoBusy] = useState<Rol | null>(null);

  if (me) return <Navigate to={homeFor(me)} replace />;

  const entrar = (nuevo: Me) => navigate(homeFor(nuevo), { replace: true });

  const cambiarModo = (nuevo: Modo) => {
    setModo(nuevo);
    guardarModo(nuevo);
  };

  const enterDemo = async (rol: Exclude<Rol, 'superadmin'>) => {
    setFormError(null);
    setDemoBusy(rol);
    try {
      entrar(await demoLogin({ rol, cooperativa: data?.cooperativa.subdominio }));
    } catch (e) {
      setFormError(errorMessage(e));
    } finally {
      setDemoBusy(null);
    }
  };

  if (context.isError && !data) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <ErrorState message={errorMessage(context.error)} onRetry={() => void context.refetch()} />
      </div>
    );
  }

  const cooperativa = data?.cooperativa ?? null;
  const busy = demoBusy !== null;
  const subdominio = data?.cooperativa.subdominio;

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      {/* Panel de marca */}
      <aside className="sobre-oscuro relative flex flex-col overflow-hidden border-barra-borde bg-barra px-5 py-6 text-white max-lg:border-b lg:border-r lg:px-12 lg:py-10">
        <Rings />
        <div className="relative flex items-center gap-3">
          <CoopMark cooperativa={cooperativa} />
          <div className="min-w-0">
            {cooperativa ? (
              <>
                <p className="truncate font-bold leading-tight">{cooperativa.nombreCorto}</p>
                <p className="truncate text-sm text-white/70">{cooperativa.localidad}</p>
              </>
            ) : (
              <Skeleton className="h-9 w-48 bg-white/15" />
            )}
          </div>
        </div>

        <div className="relative mt-auto hidden pt-16 lg:block">
          <NombreProducto className="text-lg font-black tracking-tight" />
          <p className="mt-3 max-w-md text-balance text-4xl font-black leading-[1.1] tracking-tight">
            {cooperativa?.tema.lema ?? APP_LEMA}
          </p>
          {cooperativa && (
            <ul className="mt-8 flex max-w-md flex-wrap gap-2">
              {cooperativa.servicios.map((s) => {
                const Icon = SERVICIO_ICON[s];
                return (
                  <li key={s} className="flex items-center gap-2 rounded-full bg-white/10 px-3.5 py-2 text-sm font-medium">
                    <Icon className="size-4 text-marca-claro" aria-hidden />
                    {SERVICIO_ETIQUETA[s]}
                  </li>
                );
              })}
            </ul>
          )}
          <PoweredBy onDark className="mt-12" />
        </div>
      </aside>

      {/* Ingreso */}
      <main className="relative flex justify-center px-5 py-8 lg:items-center lg:px-12 lg:py-10">
        <BotonTema className="absolute right-3 top-3" />
        <div className="w-full max-w-md animate-aparecer">
          <h1 className="text-3xl font-black tracking-tight">Ingresá</h1>

          <div role="group" aria-label="Quién ingresa" className="mt-5 grid grid-cols-2 gap-1 rounded-xl border border-linea bg-superficie p-1">
            {MODOS.map((m) => (
              <button
                key={m.valor}
                type="button"
                aria-pressed={modo === m.valor}
                onClick={() => cambiarModo(m.valor)}
                className={cn(
                  'min-h-11 rounded-lg px-2 text-sm font-semibold leading-tight transition-colors duration-150',
                  modo === m.valor ? 'bg-marca text-white' : 'text-tinta-suave hover:bg-marca-tenue hover:text-marca-texto',
                )}
              >
                {m.nombre}
              </button>
            ))}
          </div>
          <p className="mt-3 text-tinta-suave">{MODOS.find((m) => m.valor === modo)!.ayuda}</p>

          {/* La clave hace que, al cambiar de cooperativa en la demo, el formulario arranque limpio. */}
          {modo === 'socio' ? (
            <IngresoSocio key={subdominio ?? ''} subdominio={subdominio} bloqueado={busy} onEntrar={entrar} />
          ) : (
            <IngresoPersonal subdominio={subdominio} bloqueado={busy} onEntrar={entrar} />
          )}
          {formError && (
            <div className="mt-4">
              <FormAlert>{formError}</FormAlert>
            </div>
          )}

          {data?.demo.activo && (
            <section aria-labelledby="demo-titulo" className="mt-9 rounded-2xl border border-dashed border-marca-claro bg-marca-tenue/60 p-4 sm:p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h2 id="demo-titulo" className="font-bold text-marca-texto">
                  Modo demo
                </h2>
                <p className="text-sm text-tinta-suave">Entrá con un usuario de prueba, sin contraseña.</p>
              </div>

              {data.demo.cooperativas.length > 1 && (
                <div role="group" aria-label="Cooperativa de la demo" className="mt-4 grid grid-cols-2 gap-1 rounded-xl bg-superficie p-1">
                  {data.demo.cooperativas.map((c) => {
                    const selected = c.subdominio === data.cooperativa.subdominio;
                    return (
                      <button
                        key={c.subdominio}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => setParams({ coop: c.subdominio }, { replace: true })}
                        className={cn(
                          'min-h-11 rounded-lg px-2 text-sm font-semibold leading-tight transition-colors duration-150',
                          selected ? 'bg-marca text-white' : 'text-tinta-suave hover:bg-marca-tenue hover:text-marca-texto',
                        )}
                      >
                        {c.nombreCorto.replace(/^Cooperativa\s+/i, '')}
                      </button>
                    );
                  })}
                </div>
              )}

              <ul className={cn('mt-3 grid grid-cols-2 gap-2 transition-opacity duration-150', context.isPlaceholderData && 'opacity-50')}>
                {data.demo.opciones.map((o) => {
                  const Icon = ROL_ICON[o.rol] ?? User;
                  return (
                    <li key={o.rol}>
                      <button
                        type="button"
                        disabled={busy || context.isPlaceholderData}
                        onClick={() => void enterDemo(o.rol as Exclude<Rol, 'superadmin'>)}
                        aria-busy={demoBusy === o.rol || undefined}
                        className={cn(
                          'flex min-h-16 w-full items-center gap-3 rounded-xl border border-linea bg-superficie px-3 text-left transition-colors duration-150',
                          'hover:border-marca disabled:cursor-not-allowed disabled:opacity-60',
                        )}
                      >
                        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-marca-tenue text-marca-texto">
                          <Icon className={cn('size-5', demoBusy === o.rol && 'animate-latido')} aria-hidden />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-bold text-tinta">{ROL_ETIQUETA[o.rol]}</span>
                          <span className="block truncate text-xs text-tinta-suave">{o.nombre}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <div className="mt-8 flex justify-center lg:hidden">
            <PoweredBy />
          </div>
        </div>
      </main>
    </div>
  );
}
