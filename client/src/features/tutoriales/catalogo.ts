// Tutoriales de Solvix: qué ve cada rol y en qué orden. Cada paso puede llevar a una pantalla (ruta)
// y señalar un elemento (destino: selector CSS y, si hace falta, un texto que tiene que contener).
// Si el elemento no está a la vista (por ejemplo, el menú en el celular), Solvix lo explica igual.
//
// El orden de la lista es el recorrido sugerido: al terminar uno, Solvix ofrece el siguiente que le
// corresponde a esa persona.
import type { Me, Rol } from '@shared';
import type { PoseSolvix } from './Solvix';

export interface Destino {
  selector: string;
  /** Texto que tiene que contener (para botones y enlaces). */
  texto?: string;
  /** Puede no estar (depende del estado de la pantalla): si falta, no se avisa. */
  opcional?: boolean;
}

export interface PasoTutorial {
  titulo: string;
  texto: string;
  /** Pantalla a la que lleva antes de mostrar el paso. */
  ruta?: string;
  destino?: Destino;
  pose?: PoseSolvix;
  /** El paso es solo para estos roles (sin esto, para todos los del tutorial). */
  roles?: Rol[];
}

export interface Tutorial {
  id: string;
  titulo: string;
  descripcion: string;
  roles: Rol[];
  pasos: PasoTutorial[];
}

const PERSONAL: Rol[] = ['cajero', 'facturacion', 'gerencia', 'admin'];
const TODOS: Rol[] = ['socio', 'operario', ...PERSONAL];

const enlace = (ruta: string, opcional = false): Destino => ({ selector: `a[href="${ruta}"]`, opcional });
const boton = (texto: string, opcional = false): Destino => ({ selector: 'button, a', texto, opcional });
const USUARIO: Destino = { selector: 'button[aria-label^="Menú de "]' };

export const TUTORIALES: Tutorial[] = [
  {
    id: 'bienvenida',
    titulo: 'Primeros pasos',
    descripcion: 'El menú, tu usuario y dónde volver a ver estos tutoriales.',
    roles: TODOS,
    pasos: [
      {
        pose: 'saluda',
        titulo: '¡Hola! Soy Solvix',
        texto: 'Soy el astronauta de SRV y te voy a mostrar dónde tocar para hacer cada cosa. Podés omitirme cuando quieras: los tutoriales quedan en el menú de tu usuario.',
      },
      {
        roles: ['socio'],
        pose: 'senala',
        destino: { selector: 'nav[aria-label="Secciones"]' },
        titulo: 'Las cuatro secciones',
        texto: 'Inicio te dice cuánto debés. Facturas las tiene todas. Consumo muestra cuánto gastaste mes a mes. En Más están los reclamos, tus pagos y tus datos.',
      },
      {
        roles: ['operario'],
        pose: 'senala',
        destino: { selector: 'header [role="status"]' },
        titulo: 'La barra de señal',
        texto: 'Te dice si hay señal y cuántas lecturas faltan enviar. Sin señal podés seguir trabajando: se guardan en el teléfono.',
      },
      {
        roles: PERSONAL,
        pose: 'senala',
        destino: { selector: 'nav[aria-label="Principal"]', opcional: true },
        titulo: 'El menú',
        texto: 'Desde acá vas a cada sección. Solo ves las que corresponden a tu trabajo. En el celular se abre con el botón de las tres rayas.',
      },
      {
        pose: 'senala',
        destino: USUARIO,
        titulo: 'Tu usuario',
        texto: 'Tocando acá elegís el modo claro u oscuro, abrís los tutoriales y salís de tu cuenta.',
      },
      {
        pose: 'festeja',
        titulo: '¡Listo!',
        texto: 'Eso es lo básico. Si querés, sigo con lo que más vas a usar.',
      },
    ],
  },

  /* ───────────── Socio ───────────── */
  {
    id: 'socio-facturas',
    titulo: 'Ver y pagar tus facturas',
    descripcion: 'Cuánto debés, por qué pagás lo que pagás y cómo pagar desde el celular.',
    roles: ['socio'],
    pasos: [
      {
        ruta: '/socio',
        destino: { selector: '[data-tour="deuda"]' },
        pose: 'senala',
        titulo: 'Cuánto debés hoy',
        texto: 'Es lo primero que ves al entrar: el total que debés, o que estás al día. Si hay un corte programado en tu zona, aparece acá abajo.',
      },
      {
        ruta: '/socio/facturas',
        destino: enlace('/socio/facturas'),
        pose: 'senala',
        titulo: 'Todas tus facturas',
        texto: 'Acá están las que faltan pagar y las ya pagadas, de todos tus servicios. Tocá una para abrirla y bajar el PDF.',
      },
      {
        pose: 'piensa',
        titulo: '¿Por qué pago esto?',
        texto: 'Dentro de cada factura hay una explicación en palabras simples: en qué se va la plata, cuánto consumiste y hasta dónde llega el subsidio.',
      },
      {
        ruta: '/socio',
        destino: enlace('/socio/pagar', true),
        pose: 'senala',
        titulo: 'Pagar',
        texto: 'Tocá Pagar, elegí qué facturas querés pagar y confirmá. Antes de pagar ves el total exacto, y al terminar te queda el recibo.',
      },
      { pose: 'festeja', titulo: 'Eso es todo', texto: 'Los recibos de lo que pagaste quedan en Más, en «Mis pagos», para bajarlos cuando quieras.' },
    ],
  },
  {
    id: 'socio-mas',
    titulo: 'Consumo, reclamos y otras cuentas',
    descripcion: 'Cuánto consumís, cómo avisar un problema y cómo mirar la cuenta de un familiar.',
    roles: ['socio'],
    pasos: [
      {
        ruta: '/socio/consumo',
        destino: enlace('/socio/consumo'),
        pose: 'senala',
        titulo: 'Tu consumo',
        texto: 'Los últimos 12 meses de cada servicio con medidor, mes por mes. Sirve para ver si un mes gastaste más de lo habitual.',
      },
      {
        ruta: '/socio/mas',
        destino: enlace('/socio/mas/reclamos'),
        pose: 'senala',
        titulo: 'Reclamos',
        texto: '¿Te quedaste sin luz o hay una pérdida de agua? Avisá desde acá y seguí cómo va, sin llamar ni ir a la oficina.',
      },
      {
        destino: enlace('/socio/mas/datos'),
        pose: 'senala',
        titulo: 'Tus datos',
        texto: 'Dejá tu email y tu celular para que la cooperativa te avise, y elegí si querés la factura digital.',
      },
      {
        destino: USUARIO,
        pose: 'senala',
        titulo: 'Ver otra cuenta',
        texto: '¿Querés mirar la cuenta de un familiar o la del negocio? Tocá acá y elegí «Ver otra cuenta». Se entra con los tres datos de esa factura.',
      },
    ],
  },

  /* ───────────── Operario ───────────── */
  {
    id: 'operario-lecturas',
    titulo: 'Cargar lecturas en la calle',
    descripcion: 'Tus rutas, el recorrido que te arma la app, el teclado grande y qué pasa sin señal.',
    roles: ['operario'],
    pasos: [
      {
        ruta: '/operario',
        destino: { selector: '#contenido a[href^="/operario/ruta/"]', opcional: true },
        pose: 'senala',
        titulo: 'Tus rutas de hoy',
        texto: 'Cada ruta muestra cuántos medidores llevás y cuántos te faltan: son las mismas cuentas que ve la oficina. Tocá una para empezar o para seguir donde quedaste.',
      },
      {
        pose: 'piensa',
        titulo: 'El recorrido lo armo yo',
        texto: 'Dentro de la ruta, tocá «Recorrido» y decime de dónde salís: de donde estás parado, de una calle o de una casa. Ordeno las casas que faltan para que camines menos, y el mapa te lo dibuja con el número de cada paso.',
      },
      {
        pose: 'piensa',
        titulo: 'Una casa por pantalla',
        texto: 'Ves el domicilio, el medidor y la lectura anterior. Escribí la lectura con el teclado grande y confirmá: pasa sola a la casa siguiente.',
      },
      {
        pose: 'piensa',
        titulo: 'Si algo no cierra',
        texto: 'Si el consumo da muy distinto a lo habitual, te aviso antes de guardar. Y si no pudiste leer el medidor, tocá «No pude leer / novedad» y elegí el motivo.',
      },
      {
        destino: { selector: 'header [role="status"]' },
        pose: 'senala',
        titulo: 'Sin señal no se pierde nada',
        texto: 'Las lecturas se guardan en el teléfono y se envían solas cuando vuelve la señal. Acá ves cuántas faltan enviar; tocando, las mandás en el momento.',
      },
    ],
  },

  /* ───────────── Caja ───────────── */
  {
    id: 'caja-cobrar',
    titulo: 'Cobrar en el mostrador',
    descripcion: 'Abrir la caja, buscar al socio, cobrar, dar el vuelto y cerrar con el arqueo.',
    roles: ['cajero'],
    pasos: [
      {
        ruta: '/caja',
        pose: 'piensa',
        titulo: 'Abrir la caja',
        texto: 'El turno empieza con el fondo inicial: escribí con cuánto efectivo arrancás y apretá Enter. Todo se puede hacer con el teclado.',
      },
      {
        destino: { selector: '[role="tablist"][aria-label="Secciones de la caja"]', opcional: true },
        pose: 'senala',
        titulo: 'Las secciones',
        texto: '«Cobrar» es el mostrador. «Cobros de esta caja» lista lo que cobraste en el turno. «Cajas anteriores» guarda los turnos cerrados.',
      },
      {
        pose: 'piensa',
        titulo: 'Buscar al socio',
        texto: 'Con F2 vas al buscador. Sirve el apellido, el número de socio o pasar el código de barras de la factura con el lector. Aparecen sus facturas, de la más vieja a la más nueva.',
      },
      {
        pose: 'piensa',
        titulo: 'Cobrar y dar el vuelto',
        texto: 'Elegí el medio de pago y escribí con cuánto paga: te digo cuánto dar de vuelto. Con Enter se registra el cobro y sale el recibo.',
      },
      {
        destino: boton('Cerrar la caja', true),
        pose: 'senala',
        titulo: 'Cerrar con el arqueo',
        texto: 'Al terminar, contá el efectivo y escribilo. El sistema lo compara con lo que tenía que haber y te muestra la diferencia.',
      },
    ],
  },

  /* ───────────── Administración ───────────── */
  {
    id: 'administracion',
    titulo: 'Padrón, usuarios y reclamos',
    descripcion: 'Dónde está cada socio, quién entra al sistema y cómo se atienden los reclamos.',
    roles: ['admin'],
    pasos: [
      {
        ruta: '/padron',
        destino: { selector: 'input[aria-label="Buscar en el padrón"]', opcional: true },
        pose: 'senala',
        titulo: 'El padrón',
        texto: 'Socios, conexiones y servicios. Buscá por nombre, DNI, número de socio, medidor o dirección, y abrí la ficha para ver o corregir sus datos.',
      },
      {
        ruta: '/admin/usuarios',
        destino: { selector: '#contenido h1' },
        pose: 'senala',
        titulo: 'Usuarios',
        texto: 'Acá ves quién puede entrar al sistema y con qué rol. Los socios no tienen usuario ni contraseña: entran con los datos de su factura.',
      },
      {
        ruta: '/reclamos',
        destino: enlace('/reclamos', true),
        pose: 'senala',
        titulo: 'Reclamos y cortes',
        texto: 'Los reclamos de los vecinos llegan acá: se asignan, se siguen y se cierran. También se cargan los cortes programados, que el socio ve en su inicio.',
      },
    ],
  },

  /* ───────────── Gerencia ───────────── */
  {
    id: 'tablero',
    titulo: 'El tablero y los informes',
    descripcion: 'Los números del mes, el balance de energía y cómo bajar un informe a Excel.',
    roles: ['gerencia', 'admin'],
    pasos: [
      {
        ruta: '/gerencia',
        destino: { selector: '[data-tour="filtros"]', opcional: true },
        pose: 'senala',
        titulo: 'Qué estás mirando',
        texto: 'El tablero muestra un mes. Cambiá el mes, el servicio o la zona y todo lo de abajo se recalcula.',
      },
      {
        pose: 'piensa',
        titulo: 'Los números del mes',
        texto: 'Facturado, cobrado, cobrabilidad y deuda. Más abajo, la recaudación día por día y el balance de energía: lo que entró a la red contra lo que se facturó. La diferencia son las pérdidas.',
      },
      {
        ruta: '/informes',
        destino: enlace('/informes/deuda', true),
        pose: 'senala',
        titulo: 'Informes',
        texto: 'Cada informe se mira en pantalla y se baja en Excel, CSV o PDF. Este dice quién debe, cuánto y desde cuándo.',
      },
    ],
  },

  /* ───────────── Facturación ───────────── */
  {
    id: 'facturacion-mes',
    titulo: 'Facturar el mes',
    descripcion: 'De la lectura a la emisión, en cuatro pasos y sin emitir nada a ciegas.',
    roles: ['facturacion', 'admin', 'gerencia'],
    pasos: [
      {
        ruta: '/lecturas',
        destino: enlace('/lecturas', true),
        pose: 'senala',
        titulo: 'Primero, la lectura',
        texto: 'Acá se abre la lectura del mes y se sigue el avance de cada ruta. Las lecturas que cargan los operarios llegan solas.',
      },
      {
        ruta: '/facturacion',
        destino: { selector: '#contenido ol', opcional: true },
        pose: 'senala',
        titulo: 'Cuatro pasos',
        texto: 'Abrir la lectura, controlar lecturas, pre-facturar y revisar, y emitir. El asistente te lleva en orden y no deja saltear ninguno.',
      },
      {
        pose: 'piensa',
        titulo: 'Lo que falta leer',
        texto: 'Los medidores sin lectura se pueden estimar con el promedio de los últimos seis meses. Quedan marcados como estimados en la factura.',
      },
      {
        pose: 'piensa',
        titulo: 'Revisar lo raro',
        texto: 'Antes de emitir, el sistema separa las facturas que cambiaron mucho, las de importe cero y las que no tienen lectura. Las abrís, mirás el cálculo renglón por renglón y decidís.',
      },
      {
        pose: 'festeja',
        titulo: 'Emitir',
        texto: 'Al emitir, cada factura toma su número y no se edita más. Si alguna estuvo mal, se corrige con una nota de crédito y queda registrado quién lo hizo.',
      },
    ],
  },

  /* ───────────── Mapa ───────────── */
  {
    id: 'mapa',
    titulo: 'El mapa',
    descripcion: 'Deuda por casa, lecturas en vivo y el resumen de un barrio dibujándolo.',
    roles: ['gerencia', 'admin', 'facturacion'],
    pasos: [
      {
        ruta: '/mapa',
        destino: { selector: 'section[aria-label="Conexiones en el mapa"]', opcional: true },
        pose: 'senala',
        titulo: 'Qué mostrar',
        texto: '«Deuda» pinta cada casa según cómo está con ese servicio: al día, con deuda, en mora o cortada. «Lecturas en vivo» muestra por dónde va la cuadrilla.',
      },
      {
        destino: { selector: 'section[aria-label="Hora del día"]', opcional: true },
        pose: 'senala',
        titulo: 'De día y de noche',
        texto: 'El mapa sigue la hora real de Dos de Mayo. Moviendo la hora lo ves de noche, con las casas iluminadas.',
      },
      {
        pose: 'piensa',
        titulo: 'La ficha de cada casa',
        texto: 'Tocá una casa y se abre su ficha: quién es el titular, qué servicios tiene, cuánto debe y su última lectura.',
      },
      {
        destino: boton('Dibujar área', true),
        pose: 'senala',
        titulo: 'Dibujar un área',
        texto: 'Marcá un barrio con unos clics y cerralo con doble clic. Te digo cuántas conexiones hay, cuánto deben y cuánto consumen, y podés bajar la lista.',
      },
    ],
  },
];

/** Roles con los que se arman los tutoriales. El superadmin, dentro de una cooperativa, ve los del personal. */
export function rolesDe(me: Me | null): Rol[] {
  if (!me) return [];
  if (me.user.roles.includes('superadmin')) return me.cooperativa ? PERSONAL : [];
  return me.user.roles;
}

/** Los tutoriales que le corresponden, en orden, con los pasos de su rol. */
export function tutorialesPara(me: Me | null): Tutorial[] {
  const roles = rolesDe(me);
  const tiene = (lista: Rol[] | undefined) => !lista || lista.some((r) => roles.includes(r));
  return TUTORIALES.filter((t) => tiene(t.roles)).map((t) => ({ ...t, pasos: t.pasos.filter((p) => tiene(p.roles)) }));
}
