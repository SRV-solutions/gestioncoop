import { lazy, Suspense, type ReactNode } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Compass } from 'lucide-react';
import { subdominioSchema, type LoginContext, type Rol } from '@shared';
import { api, qs } from './lib/api';
import { useAuth } from './lib/auth';
import { elegirCooperativa } from './lib/cooperativa-elegida';
import { usePagina } from './lib/pagina';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Empty, ErrorState, LoadingScreen } from './components/ui';
import { LoginPage } from './features/auth/LoginPage';
import { TutorialHost } from './features/tutoriales/TutorialHost';

// Cada área se descarga recién cuando se entra: el socio en el celular no baja las pantallas
// de gerencia, ni el cajero las del operario.
const SocioLayout = lazy(() => import('./components/SocioLayout').then((m) => ({ default: m.SocioLayout })));
const InicioPage = lazy(() => import('./features/socio/inicio').then((m) => ({ default: m.InicioPage })));
const FacturasPage = lazy(() => import('./features/socio/facturas').then((m) => ({ default: m.FacturasPage })));
const FacturaPage = lazy(() => import('./features/socio/facturas').then((m) => ({ default: m.FacturaPage })));
const PagarPage = lazy(() => import('./features/socio/pago').then((m) => ({ default: m.PagarPage })));
const PagoResultadoPage = lazy(() => import('./features/socio/pago').then((m) => ({ default: m.PagoResultadoPage })));
const ConsumoPage = lazy(() => import('./features/socio/consumo').then((m) => ({ default: m.ConsumoPage })));
const MasPage = lazy(() => import('./features/socio/mas').then((m) => ({ default: m.MasPage })));
const ConexionesPage = lazy(() => import('./features/socio/mas').then((m) => ({ default: m.ConexionesPage })));
const SepelioPage = lazy(() => import('./features/socio/mas').then((m) => ({ default: m.SepelioPage })));
const DatosPage = lazy(() => import('./features/socio/mas').then((m) => ({ default: m.DatosPage })));
const PagosSocioPage = lazy(() => import('./features/socio/mas').then((m) => ({ default: m.PagosSocioPage })));
const ReclamosSocioPage = lazy(() => import('./features/socio/reclamos').then((m) => ({ default: m.ReclamosSocioPage })));
const NuevoReclamoPage = lazy(() => import('./features/socio/reclamos').then((m) => ({ default: m.NuevoReclamoPage })));
const PasarelaPage = lazy(() => import('./features/publico/PasarelaPage').then((m) => ({ default: m.PasarelaPage })));
const PagarCodigoPage = lazy(() => import('./features/publico/PagarCodigoPage').then((m) => ({ default: m.PagarCodigoPage })));
const ResultadoPublicoPage = lazy(() => import('./features/publico/PagarCodigoPage').then((m) => ({ default: m.ResultadoPublicoPage })));
const ReclamosPage = lazy(() => import('./features/reclamos/ReclamosPage').then((m) => ({ default: m.ReclamosPage })));
const OperarioLayout = lazy(() => import('./components/OperarioLayout').then((m) => ({ default: m.OperarioLayout })));
const OperarioHomePage = lazy(() => import('./features/operario/OperarioHomePage').then((m) => ({ default: m.OperarioHomePage })));
const RutaPage = lazy(() => import('./features/operario/RutaPage').then((m) => ({ default: m.RutaPage })));
const CasaPage = lazy(() => import('./features/operario/CasaPage').then((m) => ({ default: m.CasaPage })));
const LecturasPage = lazy(() => import('./features/lecturas/LecturasPage').then((m) => ({ default: m.LecturasPage })));
const StaffLayout = lazy(() => import('./components/StaffLayout').then((m) => ({ default: m.StaffLayout })));
const TableroPage = lazy(() => import('./features/tablero/TableroPage').then((m) => ({ default: m.TableroPage })));
const InformesPage = lazy(() => import('./features/informes/InformesPage').then((m) => ({ default: m.InformesPage })));
const FacturacionPage = lazy(() => import('./features/facturacion/FacturacionPage').then((m) => ({ default: m.FacturacionPage })));
const CajaPage = lazy(() => import('./features/caja/CajaPage').then((m) => ({ default: m.CajaPage })));
const UsersPage = lazy(() => import('./features/admin/UsersPage').then((m) => ({ default: m.UsersPage })));
const PadronPage = lazy(() => import('./features/padron/PadronPage').then((m) => ({ default: m.PadronPage })));
const TarifasPage = lazy(() => import('./features/tarifas/TarifasPage').then((m) => ({ default: m.TarifasPage })));
const MapaPage = lazy(() => import('./features/mapa/MapaPage').then((m) => ({ default: m.MapaPage })));
const CooperativaPage = lazy(() => import('./features/cooperativa/CooperativaPage').then((m) => ({ default: m.CooperativaPage })));
const CooperativaSrvPage = lazy(() => import('./features/superadmin/CooperativaSrvPage').then((m) => ({ default: m.CooperativaSrvPage })));
const IntegridadPage = lazy(() => import('./features/integridad/IntegridadPage').then((m) => ({ default: m.IntegridadPage })));
const CooperativasPage = lazy(() => import('./features/superadmin/CooperativasPage').then((m) => ({ default: m.CooperativasPage })));

/** Sin sesión, al ingreso. Mientras se averigua, pantalla de carga (nunca un parpadeo del login). */
function RequireAuth({ children }: { children: ReactNode }) {
  const { me, loading, failed, retry } = useAuth();
  const location = useLocation();
  if (loading) return <LoadingScreen />;
  if (failed) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <ErrorState onRetry={retry} />
      </div>
    );
  }
  if (!me) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

/**
 * Deja ver el área solo a quien tiene alguno de los roles; al resto lo lleva a su inicio.
 * Es comodidad de navegación: el permiso de verdad lo valida la API en cada pedido.
 */
function RequireRole({ roles, children }: { roles: Rol[]; children: ReactNode }) {
  const { me, hasRole, home } = useAuth();
  // El superadmin entra a las áreas de una cooperativa solo después de elegirla.
  const allowed = roles.some(hasRole) || (hasRole('superadmin') && me?.cooperativa != null);
  if (!allowed) return <Navigate to={home} replace />;
  return <>{children}</>;
}

function HomeRedirect() {
  const { home } = useAuth();
  return <Navigate to={home} replace />;
}

function NotFoundPage() {
  const { home } = useAuth();
  return (
    <div className="grid min-h-dvh place-items-center">
      <Empty
        icon={Compass}
        title="Esa página no existe"
        action={
          <Link to={home} className="inline-flex min-h-11 items-center rounded-lg bg-marca px-4 font-semibold text-white hover:bg-marca-fuerte">
            Ir al inicio
          </Link>
        }
      >
        Puede que la dirección esté mal escrita o que la página se haya movido.
      </Empty>
    </div>
  );
}

/**
 * El link de cada cooperativa: gestioncoop.wearesrv.com/dosdemayo abre el ingreso con su nombre y su
 * logo, y el dispositivo la recuerda. Si no es una cooperativa, es una página que no existe.
 */
function EntradaCooperativa() {
  const { cooperativa = '' } = useParams();
  const valida = subdominioSchema.safeParse(cooperativa);
  const consulta = useQuery({
    queryKey: ['entrada-cooperativa', cooperativa],
    queryFn: async () => {
      const c = await api.get<LoginContext>(`/auth/context${qs({ coop: cooperativa })}`);
      elegirCooperativa(c.cooperativa.subdominio);
      return c;
    },
    enabled: valida.success,
    retry: false,
  });
  if (!valida.success || consulta.isError) {
    return (
      <RequireAuth>
        <NotFoundPage />
      </RequireAuth>
    );
  }
  if (!consulta.data) return <LoadingScreen />;
  return <Navigate to={`/login${qs({ coop: consulta.data.cooperativa.subdominio })}`} replace />;
}

const area = (roles: Rol[], page: ReactNode) => <RequireRole roles={roles}>{page}</RequireRole>;

export function App() {
  const location = useLocation();
  usePagina();
  return (
    // Si una pantalla se rompe, se muestra un mensaje y cómo seguir; al navegar, se vuelve a intentar.
    <ErrorBoundary pantalla={location.pathname}>
    <Suspense fallback={<LoadingScreen />}>
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      {/* El socio ya no crea una cuenta: entra con los datos de su factura. Los enlaces viejos van al ingreso. */}
      <Route path="/registro" element={<Navigate to="/login" replace />} />
      {/* Sin sesión: pagar con el QR de la factura y la pasarela de prueba. */}
      <Route path="/pagar/resultado/:id" element={<ResultadoPublicoPage />} />
      <Route path="/pagar/:codigo" element={<PagarCodigoPage />} />
      <Route path="/pasarela/:id" element={<PasarelaPage />} />

      <Route path="/" element={<RequireAuth><HomeRedirect /></RequireAuth>} />

      {/* Socio: celular primero */}
      <Route path="/socio" element={<RequireAuth><RequireRole roles={['socio']}><SocioLayout /></RequireRole></RequireAuth>}>
        <Route index element={<InicioPage />} />
        <Route path="facturas" element={<FacturasPage />} />
        <Route path="facturas/:id" element={<FacturaPage />} />
        <Route path="pagar" element={<PagarPage />} />
        <Route path="pago/:id" element={<PagoResultadoPage />} />
        <Route path="consumo" element={<ConsumoPage />} />
        <Route path="mas" element={<MasPage />} />
        <Route path="mas/conexiones" element={<ConexionesPage />} />
        <Route path="mas/sepelio" element={<SepelioPage />} />
        <Route path="mas/datos" element={<DatosPage />} />
        <Route path="mas/pagos" element={<PagosSocioPage />} />
        <Route path="mas/reclamos" element={<ReclamosSocioPage />} />
        <Route path="mas/reclamos/nuevo" element={<NuevoReclamoPage />} />
      </Route>

      {/* Operario: en la calle */}
      <Route path="/operario" element={<RequireAuth><RequireRole roles={['operario']}><OperarioLayout /></RequireRole></RequireAuth>}>
        <Route index element={<OperarioHomePage />} />
        <Route path="ruta/:rutaId" element={<RutaPage />} />
        <Route path="ruta/:rutaId/casa/:conexionId" element={<CasaPage />} />
      </Route>

      {/* Personal de escritorio y proveedor */}
      <Route element={<RequireAuth><StaffLayout /></RequireAuth>}>
        <Route path="/gerencia" element={area(['gerencia', 'admin'], <TableroPage />)} />
        <Route path="/informes" element={area(['gerencia', 'admin', 'facturacion'], <InformesPage />)} />
        <Route path="/informes/:clave" element={area(['gerencia', 'admin', 'facturacion'], <InformesPage />)} />
        <Route path="/mapa" element={area(['gerencia', 'admin', 'facturacion'], <MapaPage />)} />
        <Route path="/padron" element={area(['admin', 'gerencia', 'facturacion', 'cajero'], <PadronPage />)} />
        <Route path="/tarifas" element={area(['admin', 'gerencia', 'facturacion'], <TarifasPage />)} />
        <Route path="/lecturas" element={area(['admin', 'gerencia', 'facturacion'], <LecturasPage />)} />
        <Route path="/facturacion" element={area(['facturacion', 'admin', 'gerencia'], <FacturacionPage />)} />
        <Route path="/caja" element={area(['cajero', 'admin', 'gerencia'], <CajaPage />)} />
        <Route path="/reclamos" element={area(['admin', 'gerencia'], <ReclamosPage />)} />
        <Route path="/admin" element={<Navigate to="/admin/usuarios" replace />} />
        <Route path="/admin/usuarios" element={area(['admin'], <UsersPage />)} />
        <Route path="/cooperativa" element={area(['gerencia', 'admin'], <CooperativaPage />)} />
        <Route path="/integridad" element={area(['admin', 'gerencia'], <IntegridadPage />)} />
        <Route path="/superadmin" element={area(['superadmin'], <CooperativasPage />)} />
        <Route path="/superadmin/cooperativas/:id" element={area(['superadmin'], <CooperativaSrvPage />)} />
      </Route>

      <Route path="/:cooperativa" element={<EntradaCooperativa />} />
      <Route path="*" element={<RequireAuth><NotFoundPage /></RequireAuth>} />
    </Routes>
    </Suspense>
    {/* Solvix: se presenta la primera vez y guía los tutoriales sobre cualquier pantalla. */}
    <TutorialHost />
    </ErrorBoundary>
  );
}
