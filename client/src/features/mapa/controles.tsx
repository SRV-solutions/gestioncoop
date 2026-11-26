// Controles del mapa (abajo a la izquierda): qué se mira, qué servicio, la leyenda —que también
// filtra—, las capas y los filtros. Son piezas sin lógica propia: el estado vive en MapaPage.
import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, Radio, type LucideIcon } from 'lucide-react';
import { CATEGORIA_ETIQUETA, CATEGORIAS, formatMoney, formatNumber, nombreDeMes, type MapaConexiones, type MapaLecturas } from '@shared';
import { cn } from '../../lib/cn';
import { SERVICIO_CORTO, SERVICIO_ICON } from '../../components/servicios';
import { Check } from '../../components/ui';
import { FILTROS_SERVICIO, SIN_SERVICIO, type Calor, type Filtros, type Leyenda, type Modo } from './vista';

export const tarjeta = 'rounded-2xl border border-linea bg-superficie/95 shadow-lg shadow-black/10 backdrop-blur';

export function BotonCapa({ activo, onClick, icon: Icon, children, cuenta }: { activo: boolean; onClick: () => void; icon: LucideIcon; children: string; cuenta?: number }) {
  return (
    <button
      type="button"
      aria-pressed={activo}
      onClick={onClick}
      className={cn(
        'relative flex min-h-11 items-center gap-2 rounded-xl border px-3.5 text-sm font-semibold shadow-lg shadow-black/10 backdrop-blur transition-colors duration-150',
        // En el celular: ícono arriba y nombre abajo, así entran los cuatro en una fila.
        'max-sm:min-h-12 max-sm:flex-col max-sm:justify-center max-sm:gap-0.5 max-sm:px-2 max-sm:text-xs max-sm:leading-none',
        activo ? 'border-marca bg-marca text-white' : 'border-linea bg-superficie/95 text-tinta hover:border-marca',
      )}
    >
      <Icon className="size-4" aria-hidden />
      {children}
      {cuenta ? <span className={cn('grid min-w-5 place-items-center rounded-full px-1 text-xs tabular-nums max-sm:absolute max-sm:-right-1.5 max-sm:-top-1.5 max-sm:h-5', activo ? 'bg-white/25 max-sm:bg-acento max-sm:text-sobre-acento' : 'bg-marca text-white')}>{cuenta}</span> : null}
    </button>
  );
}

/* ───────────────────────── Capas ───────────────────────── */

export interface Capas {
  relieve: boolean;
  zonas: boolean;
  rutas: boolean;
  reclamos: boolean;
  cortes: boolean;
}

const CALORES: { valor: Calor; texto: string }[] = [
  { valor: 'no', texto: 'Ninguno' },
  { valor: 'deuda', texto: 'Deuda' },
  { valor: 'consumo', texto: 'Consumo' },
];

export function PanelCapas({ capas, cambiar, calor, setCalor, reclamos, cortes }: { capas: Capas; cambiar: (clave: keyof Capas) => void; calor: Calor; setCalor: (c: Calor) => void; reclamos: number; cortes: number }) {
  const fila = (clave: keyof Capas, texto: ReactNode) => <Check key={clave} label={texto} checked={capas[clave]} onChange={() => cambiar(clave)} />;
  return (
    <section aria-label="Capas del mapa" className={cn(tarjeta, 'w-72 max-w-full p-3')}>
      <h2 className="mb-1 text-xs font-bold uppercase tracking-wide text-tinta-suave">Capas</h2>
      {fila('reclamos', <>Reclamos abiertos <span className="text-tinta-suave">({reclamos})</span></>)}
      {fila('cortes', <>Cortes programados <span className="text-tinta-suave">({cortes})</span></>)}
      {fila('rutas', 'Rutas de lectura')}
      {fila('zonas', 'Zonas')}
      {fila('relieve', 'Relieve')}
      <fieldset className="mt-2 border-t border-linea pt-2">
        <legend className="float-left mb-1.5 text-xs font-bold uppercase tracking-wide text-tinta-suave">Mapa de calor</legend>
        <div className="clear-both flex gap-1">
          {CALORES.map((c) => (
            <button
              key={c.valor}
              type="button"
              aria-pressed={calor === c.valor}
              onClick={() => setCalor(c.valor)}
              className={cn('min-h-11 flex-1 rounded-lg px-2 text-sm font-semibold transition-colors duration-150', calor === c.valor ? 'bg-marca text-white' : 'text-tinta-suave hover:bg-marca-tenue hover:text-marca-texto')}
            >
              {c.texto}
            </button>
          ))}
        </div>
      </fieldset>
    </section>
  );
}

/* ───────────────────────── Filtros ───────────────────────── */

const campo = 'block min-h-11 w-full rounded-xl border border-linea bg-superficie px-3 text-[0.9375rem] text-tinta hover:border-marca-claro focus:border-marca';

export function filtrosActivos(f: Filtros): number {
  return (f.zona !== null ? 1 : 0) + (f.categoria !== null ? 1 : 0) + (f.consumoMin !== null || f.consumoMax !== null ? 1 : 0);
}

export function PanelFiltros({ mapa, filtros, cambiar, periodoConsumo }: { mapa: MapaConexiones; filtros: Filtros; cambiar: (cambios: Partial<Filtros>) => void; periodoConsumo: { anio: number; mes: number } | null }) {
  const categorias = [...new Set(mapa.categoria.filter((c) => c >= 0))].sort((a, b) => a - b);
  const unidad = filtros.servicio === 'agua' ? 'm³' : 'kWh';
  const numero = (texto: string) => (texto.trim() === '' || !Number.isFinite(Number(texto)) || Number(texto) < 0 ? null : Number(texto));
  return (
    <section aria-label="Filtros del mapa" className={cn(tarjeta, 'w-72 max-w-full space-y-3 p-3')}>
      <h2 className="text-xs font-bold uppercase tracking-wide text-tinta-suave">Filtros</h2>
      <label className="block space-y-1 text-sm font-semibold text-tinta">
        Zona
        <select className={campo} value={filtros.zona ?? ''} onChange={(e) => cambiar({ zona: e.target.value === '' ? null : Number(e.target.value) })}>
          <option value="">Todas</option>
          {mapa.zonas.map((z, i) => (
            <option key={z.id} value={i}>
              {z.nombre}
            </option>
          ))}
        </select>
      </label>
      <label className="block space-y-1 text-sm font-semibold text-tinta">
        Categoría de energía
        <select className={campo} value={filtros.categoria ?? ''} onChange={(e) => cambiar({ categoria: e.target.value === '' ? null : Number(e.target.value) })}>
          <option value="">Todas</option>
          {categorias.map((c) => (
            <option key={c} value={c}>
              {CATEGORIA_ETIQUETA[CATEGORIAS[c]!]}
            </option>
          ))}
        </select>
      </label>
      <fieldset>
        <legend className="mb-1 text-sm font-semibold text-tinta">
          Consumo de {filtros.servicio === 'agua' ? 'agua' : 'energía'} ({unidad})
        </legend>
        <div className="flex items-center gap-2">
          <input type="number" min={0} inputMode="numeric" placeholder="Desde" aria-label={`Consumo desde, en ${unidad}`} className={campo} value={filtros.consumoMin ?? ''} onChange={(e) => cambiar({ consumoMin: numero(e.target.value) })} />
          <span className="text-tinta-suave">a</span>
          <input type="number" min={0} inputMode="numeric" placeholder="Hasta" aria-label={`Consumo hasta, en ${unidad}`} className={campo} value={filtros.consumoMax ?? ''} onChange={(e) => cambiar({ consumoMax: numero(e.target.value) })} />
        </div>
        <p className="mt-1 text-xs text-tinta-suave">{periodoConsumo ? `Lo facturado en ${nombreDeMes(periodoConsumo.anio, periodoConsumo.mes)}.` : 'Todavía no hay consumo facturado.'}</p>
      </fieldset>
      {filtrosActivos(filtros) > 0 && (
        <button type="button" onClick={() => cambiar({ zona: null, categoria: null, consumoMin: null, consumoMax: null })} className="min-h-11 text-sm font-semibold text-marca-texto hover:underline">
          Quitar estos filtros
        </button>
      )}
    </section>
  );
}

/* ───────────────────────── Qué se mira, servicio y leyenda ───────────────────────── */

interface LeyendaProps {
  modo: Modo;
  setModo: (m: Modo) => void;
  filtros: Filtros;
  cambiar: (cambios: Partial<Filtros>) => void;
  leyenda: Leyenda[];
  conteo: number[];
  /** Color (ya resuelto para la hora del día) de cada posición de COLORES. */
  colores: string[];
  visibles: number;
  deuda: number;
  lecturas: MapaLecturas | undefined;
  calor: Calor;
}

export function TarjetaLeyenda({ modo, setModo, filtros, cambiar, leyenda, conteo, colores, visibles, deuda, lecturas, calor }: LeyendaProps) {
  const alternar = (color: number) => {
    const ocultos = new Set(filtros.ocultos);
    if (ocultos.has(color)) ocultos.delete(color);
    else ocultos.add(color);
    cambiar({ ocultos });
  };
  // En el celular la tarjeta arranca plegada (qué se mira y el resumen): entera tapa medio mapa.
  const [abierta, setAbierta] = useState(false);
  const plegable = !abierta && 'max-sm:hidden';
  return (
    <section aria-label="Conexiones en el mapa" className={cn(tarjeta, 'max-w-full p-2.5')}>
      <div className="mb-2 flex items-center justify-between gap-2 max-sm:mb-1">
      <div role="group" aria-label="Qué mostrar" className="inline-flex rounded-xl border border-linea p-0.5">
        {(
          [
            ['situacion', 'Deuda'],
            ['lecturas', 'Lecturas en vivo'],
          ] as const
        ).map(([valor, texto]) => (
          <button
            key={valor}
            type="button"
            aria-pressed={modo === valor}
            onClick={() => setModo(valor)}
            className={cn('flex min-h-11 items-center gap-1.5 rounded-[0.625rem] px-3 text-sm font-semibold transition-colors duration-150', modo === valor ? 'bg-marca text-white' : 'text-tinta-suave hover:text-tinta')}
          >
            {valor === 'lecturas' && <Radio className="size-4" aria-hidden />}
            {texto}
          </button>
        ))}
      </div>
        <button
          type="button"
          aria-expanded={abierta}
          aria-label={abierta ? 'Ocultar los servicios y los colores' : 'Ver los servicios y los colores'}
          onClick={() => setAbierta((v) => !v)}
          className="grid size-11 shrink-0 place-items-center rounded-xl border border-linea text-tinta-suave hover:border-marca hover:text-marca-texto sm:hidden"
        >
          {abierta ? <ChevronDown className="size-5" aria-hidden /> : <ChevronUp className="size-5" aria-hidden />}
        </button>
      </div>

      <div role="group" aria-label="Servicio" className={cn('flex flex-wrap gap-1', plegable)}>
        {FILTROS_SERVICIO.map((s) => {
          const Icon = s === 'todos' ? null : SERVICIO_ICON[s];
          return (
            <button
              key={s}
              type="button"
              aria-pressed={filtros.servicio === s}
              onClick={() => cambiar({ servicio: s })}
              className={cn(
                'flex min-h-11 items-center gap-1.5 rounded-lg px-2.5 text-sm font-semibold transition-colors duration-150',
                filtros.servicio === s ? 'bg-marca text-white' : 'text-tinta-suave hover:bg-marca-tenue hover:text-marca-texto',
              )}
            >
              {Icon && <Icon className="size-4" aria-hidden />}
              {s === 'todos' ? 'Todas' : SERVICIO_CORTO[s]}
            </button>
          );
        })}
      </div>

      {/* La leyenda también filtra: tocar un color lo apaga o lo vuelve a prender. */}
      <ul className={cn('mt-2 flex flex-wrap gap-1', plegable)}>
        {leyenda
          .filter((l) => l.color !== SIN_SERVICIO || (conteo[l.color] ?? 0) > 0)
          .map((l) => {
          const oculto = filtros.ocultos.has(l.color);
          return (
            <li key={l.color}>
              <button
                type="button"
                aria-pressed={!oculto}
                title={`${l.ayuda} Tocá para ${oculto ? 'mostrarlas' : 'ocultarlas'}.`}
                onClick={() => alternar(l.color)}
                className={cn('flex min-h-11 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition-colors duration-150', oculto ? 'border-dashed border-linea text-tinta-suave line-through' : 'border-linea text-tinta hover:border-marca')}
              >
                <span aria-hidden className={cn('size-3 rounded-full ring-1 ring-black/10 transition-colors duration-500', oculto && 'opacity-30')} style={{ backgroundColor: colores[l.color] }} />
                {l.nombre}
                <span className="tabular-nums text-tinta-suave">{formatNumber(conteo[l.color] ?? 0)}</span>
              </button>
            </li>
          );
        })}
      </ul>

      <p className="mt-2 px-1 text-xs text-tinta-suave" aria-live="polite">
        {modo === 'lecturas' ? (
          lecturas?.periodo ? (
            <>
              Lecturas de {nombreDeMes(lecturas.periodo.anio, lecturas.periodo.mes).split(' ')[0]}:{' '}
              <strong className="tabular-nums text-tinta">
                {formatNumber(lecturas.leidos)} de {formatNumber(lecturas.total)}
              </strong>{' '}
              medidores ({lecturas.total ? Math.round((lecturas.leidos / lecturas.total) * 100) : 0} %). Se actualiza solo.
            </>
          ) : lecturas ? (
            'No hay ningún mes en lectura en este momento.'
          ) : (
            'Buscando las lecturas…'
          )
        ) : (
          <>
            Se ven <strong className="tabular-nums text-tinta">{formatNumber(visibles)}</strong> {visibles === 1 ? 'casa' : 'casas'}
            {deuda > 0 && (
              <>
                {' '}
                · deben <strong className="tabular-nums text-tinta">{formatMoney(deuda, { cents: false })}</strong>
              </>
            )}
          </>
        )}
      </p>

      {calor !== 'no' && (
        <p className="mt-2 flex items-center gap-2 px-1 text-xs text-tinta-suave">
          Menos
          <span
            aria-hidden
            className="h-2.5 flex-1 rounded-full"
            style={{ background: calor === 'deuda' ? 'linear-gradient(to right, rgba(250,196,140,0.5), rgb(240,128,74), rgb(214,69,69), rgb(140,22,22))' : 'linear-gradient(to right, rgba(158,197,244,0.5), rgb(85,152,231), rgb(37,106,191), rgb(13,54,107))' }}
          />
          Más {calor === 'deuda' ? 'deuda' : 'consumo'}
        </p>
      )}
    </section>
  );
}
