// Datos iniciales. Corre en cada `npm run dev` (y en cada deploy) y solo agrega lo que falta:
// - las dos cooperativas de la demo (Dos de Mayo, completa, y una segunda mínima para mostrar el aislamiento),
// - los usuarios de prueba de cada una (1 por rol + 3 operarios + 2 cajeros en Dos de Mayo),
// - el padrón de prueba de cada una, si todavía no tiene socios (2.000 hogares en Dos de Mayo),
// - las tarifas de cada una, si todavía no tiene ninguna (las de Dos de Mayo salen de sus facturas),
// - las lecturas de cada una, si todavía no tiene períodos (12 meses de historial y el mes actual a medio leer),
// - las facturas de ese historial y sus pagos (con las cajas de cada día), y los productos del mostrador,
// - reclamos con su historial y cortes programados,
// - la energía que entró a la red en cada mes facturado (para el balance del tablero),
// - la comisión de SRV (0,8 % por factura) y los logos de la cooperativa,
// - el superadmin del proveedor, si no existe.
// Nada de lo que ya existe se pisa: lo que se edite desde la app queda como está.
// Todos los nombres de personas son inventados (SPEC: ningún dato de socios o empleados reales).
import { COMISION_INICIAL, type ConfigCooperativa, type Rol, type TemaCooperativa } from './shared';
import { sequelize } from './db';
import { ComisionSrv, Cooperativa, RolUsuario, Socio, Usuario } from './models';
import { runInCooperativa, runUnscoped } from './lib/context';
import { hashPassword, randomToken, verifyPassword } from './lib/security';
import { callesInventadas } from './seed/calles-inventadas';
import { hoy } from './lib/tarifas';
import { cargarBalance } from './seed/cargar-balance';
import { cargarPagos, cargarProductos, type ProductoSeed } from './seed/cargar-caja';
import { cargarFacturas } from './seed/cargar-facturas';
import { cargarLecturas } from './seed/cargar-lecturas';
import { cargarMarcas, type MarcasSeed } from './seed/cargar-marcas';
import { cargarPadron } from './seed/cargar-padron';
import { cargarReclamos } from './seed/cargar-reclamos';
import { cargarTarifas } from './seed/cargar-tarifas';
import callesDosDeMayo from './seed/data/dosdemayo.json';
import { generarPadron, PLANES, type DatosCalles, type OpcionesPadron } from './seed/generar-padron';
import { TARIFAS_ARROYO_DEL_MONTE, TARIFAS_DOS_DE_MAYO, type TarifasSeed } from './seed/tarifas';

const created: string[] = [];

interface CooperativaSeed {
  subdominio: string;
  nombre: string;
  nombreCorto: string;
  cuit: string;
  tema: TemaCooperativa;
  config: ConfigCooperativa;
  usuarios: { nombre: string; usuario: string; roles: Rol[] }[];
  /** Padrón de prueba: se genera una sola vez, cuando la cooperativa todavía no tiene socios. */
  padron: {
    calles: DatosCalles;
    opciones: OpcionesPadron;
    planes: { servicio: 'internet' | 'tv'; nombre: string; precio: string }[];
    sinUbicacion?: boolean;
  };
  /** Cuadros, conceptos y parámetros: se cargan una sola vez, cuando la cooperativa no tiene ninguno. */
  tarifas: TarifasSeed;
  /** Parte de cada ruta que ya se leyó este mes (en orden de ruta). En total da cerca del 85 % (SPEC sección 9). */
  avanceLecturas: number[];
  /** Lo que se vende en el mostrador además de cobrar facturas. */
  productos: ProductoSeed[];
  /** Reclamos de prueba (SPEC sección 9: 60 en Dos de Mayo, la cuarta parte abiertos). */
  reclamos: number;
  /** Logos (archivos de `src/seed/data/marcas`). */
  marcas?: MarcasSeed;
}

const COOPERATIVAS: CooperativaSeed[] = [
  {
    subdominio: 'dosdemayo',
    // El logo es el que publica la cooperativa en coopaye.coop.ar.
    marcas: { isotipo: 'dosdemayo-isotipo.png', factura: 'dosdemayo-factura.png' },
    nombre: 'Cooperativa de Agua, Energía y Otros Servicios Comunitarios de Dos de Mayo Ltda.',
    nombreCorto: 'Cooperativa AyE Dos de Mayo',
    cuit: '30610990890',
    tema: {
      colores: { primario: '#2d6a4f', primarioOscuro: '#1b4332', primarioClaro: '#52b788', acento: '#f4a261', fondo: '#f8f5f0' },
      iniciales: 'AyE',
      lema: 'Desde siempre, para todos',
    },
    config: {
      // Encabezado de sus facturas (08/2026).
      domicilio: 'Martín Miguel de Güemes 102',
      localidad: 'Dos de Mayo',
      provincia: 'Misiones',
      codigoPostal: '3337',
      condicionIva: 'Responsable Inscripto',
      telefonos: ['3755-398005', '3755-650558'],
      guardias: [
        { servicio: 'energia', telefono: '3755-221550' },
        { servicio: 'agua', telefono: '3755-616204' },
      ],
      servicios: ['energia', 'agua', 'internet', 'tv', 'sepelio', 'gas'],
      puntoVenta: 6,
      // Le compra a EMSA y genera una parte en la usina del arroyo El Saltito (SPEC 6.9). Las cantidades de la demo son inventadas.
      energia: { mayorista: 'EMSA', generacion: 'El Saltito' },
    },
    usuarios: [
      { nombre: 'Marta Benítez', usuario: 'socio', roles: ['socio'] },
      { nombre: 'Ramón Sosa', usuario: 'operario', roles: ['operario'] },
      { nombre: 'Diego Krause', usuario: 'operario2', roles: ['operario'] },
      { nombre: 'Luis Ferreyra', usuario: 'operario3', roles: ['operario'] },
      { nombre: 'Claudia Wagner', usuario: 'caja', roles: ['cajero'] },
      { nombre: 'Noelia Duarte', usuario: 'caja2', roles: ['cajero'] },
      { nombre: 'Silvia Rojas', usuario: 'facturacion', roles: ['facturacion'] },
      { nombre: 'Carlos Giménez', usuario: 'gerencia', roles: ['gerencia'] },
      { nombre: 'Andrea Lukoski', usuario: 'admin', roles: ['admin'] },
    ],
    padron: {
      // Calles reales de OpenStreetMap (ver scripts/osm-import.mjs); personas y datos, inventados.
      calles: callesDosDeMayo as unknown as DatosCalles,
      opciones: {
        hogares: 2000,
        semilla: 20261120,
        socioDemo: { nombre: 'Benítez, Marta', email: 'socio@dosdemayo.example' },
      },
      planes: [
        // Precios publicados en su sitio web (11/2026).
        { servicio: 'internet', nombre: PLANES.internet50, precio: '26716.00' },
        { servicio: 'internet', nombre: PLANES.internet100, precio: '33119.00' },
        // El sitio no publica el precio de la TV: valor ilustrativo, a confirmar con la cooperativa.
        { servicio: 'tv', nombre: PLANES.tv, precio: '19900.00' },
      ],
    },
    tarifas: TARIFAS_DOS_DE_MAYO,
    // La ruta 4 (del operario de la demo) queda empezada: 37 de 160 casas. La 10, sin empezar.
    avanceLecturas: [1, 1, 1, 0.23, 1, 1, 1, 0.6, 0.5, 0],
    // La cooperativa vende gas envasado. Precios ilustrativos, a confirmar con ellos.
    productos: [
      { nombre: 'Garrafa de 10 kg', precio: '18500.00', stock: 40 },
      { nombre: 'Cilindro de 45 kg', precio: '82000.00', stock: 12 },
      { nombre: 'Reconexión del servicio', precio: '12000.00', stock: null },
    ],
    reclamos: 60,
  },
  {
    // Cooperativa inventada: existe solo para mostrar que cada cooperativa ve su marca y sus datos.
    subdominio: 'arroyodelmonte',
    nombre: 'Cooperativa de Servicios Públicos Arroyo del Monte Ltda.',
    nombreCorto: 'Cooperativa Arroyo del Monte',
    cuit: '30000000007',
    tema: {
      colores: { primario: '#1d4e89', primarioOscuro: '#12305a', primarioClaro: '#5fa8d3', acento: '#f2b134', fondo: '#f4f7fb' },
      iniciales: 'AM',
      lema: 'Servicios de la comunidad',
    },
    config: {
      domicilio: 'Av. San Martín 450',
      localidad: 'Arroyo del Monte',
      provincia: 'Misiones',
      codigoPostal: '3300',
      condicionIva: 'Responsable Inscripto',
      telefonos: ['3700-000000'],
      guardias: [{ servicio: 'energia', telefono: '3700-000001' }],
      servicios: ['energia', 'agua'],
      puntoVenta: 1,
      energia: { mayorista: 'EMSA', generacion: null },
    },
    usuarios: [
      { nombre: 'Hugo Ayala', usuario: 'socio', roles: ['socio'] },
      { nombre: 'Pablo Villalba', usuario: 'operario', roles: ['operario'] },
      { nombre: 'Rosa Medina', usuario: 'caja', roles: ['cajero'] },
      { nombre: 'Elena Franco', usuario: 'facturacion', roles: ['facturacion'] },
      { nombre: 'Julio Acosta', usuario: 'gerencia', roles: ['gerencia'] },
      { nombre: 'Mirta Cabral', usuario: 'admin', roles: ['admin'] },
    ],
    padron: {
      calles: callesInventadas(),
      opciones: { hogares: 40, semilla: 7, proporcionUrbana: 0.75, socioDemo: { nombre: 'Ayala, Hugo', email: 'socio@arroyodelmonte.example' } },
      planes: [],
      // Muestra el caso de una cooperativa que tiene direcciones pero no el padrón georreferenciado.
      sinUbicacion: true,
    },
    tarifas: TARIFAS_ARROYO_DEL_MONTE,
    avanceLecturas: [1, 0.4],
    productos: [],
    reclamos: 8,
  },
];

async function createUser(data: { cooperativaId: number | null; email: string; nombre: string; password: string; roles: Rol[]; esDemo: boolean }) {
  const user = await Usuario.create({
    cooperativaId: data.cooperativaId,
    email: data.email,
    nombre: data.nombre,
    hash: await hashPassword(data.password),
    esDemo: data.esDemo,
  });
  await RolUsuario.bulkCreate(data.roles.map((rol) => ({ usuarioId: user.id, rol })));
  return user;
}

async function main() {
  await sequelize.authenticate();
  // Sin DEMO_PASSWORD, los usuarios de prueba quedan con una clave que nadie conoce:
  // igual se puede entrar con los botones del modo demo.
  const claveElegida = process.env.DEMO_PASSWORD?.trim() || null;
  const demoPassword = claveElegida ?? randomToken();

  for (const seed of COOPERATIVAS) {
    const [coop, isNew] = await Cooperativa.findOrCreate({
      where: { subdominio: seed.subdominio },
      defaults: {
        subdominio: seed.subdominio,
        nombre: seed.nombre,
        nombreCorto: seed.nombreCorto,
        cuit: seed.cuit,
        temaJson: seed.tema,
        configJson: seed.config,
      },
    });
    if (isNew) created.push(`cooperativa ${seed.nombreCorto}`);
    // Dato que se sumó después: se agrega a las cooperativas que ya existían, sin tocar lo demás.
    if (coop.configJson.energia === undefined && seed.config.energia) {
      await coop.update({ configJson: { ...coop.configJson, energia: seed.config.energia } });
      created.push(`origen de la energía de ${seed.nombreCorto}`);
    }
    // Comisión de SRV: la propuesta inicial (0,8 % de cada factura), desde antes del historial de la demo.
    if ((await runInCooperativa(coop.id, () => ComisionSrv.count())) === 0) {
      await runInCooperativa(coop.id, () =>
        ComisionSrv.create({ cooperativaId: coop.id, desde: '2025-01-01', porcentaje: COMISION_INICIAL.porcentaje, fijoPorFactura: COMISION_INICIAL.fijoPorFactura, nota: 'Propuesta inicial' }),
      );
      created.push(`comisión de SRV de ${seed.nombreCorto}`);
    }
    if (seed.marcas) created.push(...(await cargarMarcas(coop, seed.marcas)));

    for (const u of seed.usuarios) {
      // Dominio .example: reservado, nunca corresponde a una casilla real.
      const email = `${u.usuario}@${seed.subdominio}.example`;
      const existente = await Usuario.findOne({ where: { email } });
      if (existente) {
        // Si se cambió DEMO_PASSWORD, los usuarios de prueba que ya estaban pasan a la clave nueva.
        if (claveElegida && existente.esDemo && !(await verifyPassword(claveElegida, existente.hash))) {
          await existente.update({ hash: await hashPassword(claveElegida) });
          created.push(`clave nueva para ${email}`);
        }
        continue;
      }
      await createUser({ cooperativaId: coop.id, email, nombre: u.nombre, password: demoPassword, roles: u.roles, esDemo: true });
      created.push(`usuario de prueba ${email}`);
    }

    if ((await runInCooperativa(coop.id, () => Socio.count({ paranoid: false }))) === 0) {
      const padron = generarPadron(seed.padron.calles, seed.padron.opciones);
      const r = await cargarPadron(padron, {
        cooperativaId: coop.id,
        planes: seed.padron.planes,
        sinUbicacion: seed.padron.sinUbicacion,
        emailSocioDemo: seed.padron.opciones.socioDemo?.email,
      });
      created.push(`padrón de ${seed.nombreCorto} (${r.socios} socios, ${r.conexiones} conexiones)`);
    }

    const tarifas = await cargarTarifas(coop.id, seed.tarifas);
    if (tarifas) created.push(`tarifas de ${seed.nombreCorto} (${tarifas.cuadros} cuadros, ${tarifas.conceptos} conceptos)`);

    const lecturas = await cargarLecturas(coop.id, { hoy: hoy(), semilla: seed.padron.opciones.semilla, avance: seed.avanceLecturas });
    if (lecturas) created.push(`lecturas de ${seed.nombreCorto} (${lecturas.periodos} períodos, ${lecturas.lecturas} lecturas)`);

    const facturas = await cargarFacturas(coop.id, { semilla: seed.padron.opciones.semilla });
    if (facturas) created.push(`facturas de ${seed.nombreCorto} (${facturas.meses} meses, ${facturas.facturas} facturas, ${facturas.impagas} impagas)`);

    const productos = await cargarProductos(coop.id, seed.productos);
    if (productos) created.push(`productos de ${seed.nombreCorto} (${productos})`);

    const pagos = await cargarPagos(coop.id, { semilla: seed.padron.opciones.semilla });
    if (pagos) created.push(`pagos de ${seed.nombreCorto} (${pagos.pagos} pagos en ${pagos.cajas} cajas)`);

    const reclamos = await cargarReclamos(coop.id, { semilla: seed.padron.opciones.semilla, hoy: hoy(), cantidad: seed.reclamos });
    if (reclamos) created.push(`reclamos de ${seed.nombreCorto} (${reclamos.reclamos} reclamos, ${reclamos.cortes} cortes programados)`);

    const balance = await cargarBalance(coop.id, { semilla: seed.padron.opciones.semilla, generacionPropia: seed.config.energia?.generacion != null });
    if (balance) created.push(`balance de energía de ${seed.nombreCorto} (${balance} meses)`);
  }

  // El historial se arma mes por mes (borrador → emitida → paga): cada paso deja una versión vieja
  // de la fila. Se compacta una vez, al terminar, para que la base no quede con el triple de tamaño.
  if (created.some((c) => c.startsWith('facturas'))) await sequelize.query('VACUUM (FULL, ANALYZE) comprobantes');

  const email = process.env.SUPERADMIN_EMAIL?.trim().toLowerCase();
  if (!email) {
    console.log('· Sin SUPERADMIN_EMAIL en .env: no se crea el superadmin.');
  } else if (!(await Usuario.findOne({ where: { email } }))) {
    const fromEnv = process.env.SUPERADMIN_PASSWORD?.trim();
    const password = fromEnv || randomToken(12);
    await createUser({
      cooperativaId: null,
      email,
      nombre: process.env.SUPERADMIN_NAME?.trim() || 'Superadmin',
      password,
      roles: ['superadmin'],
      esDemo: false,
    });
    created.push(`superadmin ${email}`);
    if (!fromEnv) console.log(`  Contraseña del superadmin (se muestra una sola vez): ${password}`);
  }

  console.log(created.length ? `✓ Seed: se creó ${created.join(', ')}` : '✓ Seed: no faltaba nada');
}

// El seed ve y escribe en todas las cooperativas.
runUnscoped(main)
  .then(() => sequelize.close())
  .catch((err) => {
    console.error('Seed falló:', err);
    process.exit(1);
  });
