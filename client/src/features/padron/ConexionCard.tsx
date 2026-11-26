import { Gauge, MapPin, Route } from 'lucide-react';
import { CATEGORIA_ETIQUETA, formatDate, SERVICIO_ETIQUETA, type ConexionDetalle, type ServicioDetalle } from '@shared';
import { EstadoServicioBadge, SERVICIO_ICON } from '../../components/servicios';
import { Badge } from '../../components/ui';

function Servicio({ s }: { s: ServicioDetalle }) {
  const Icon = SERVICIO_ICON[s.servicio];
  const [colocado, ...anteriores] = s.medidores;
  const detalle = [s.categoria ? CATEGORIA_ETIQUETA[s.categoria] : null, s.plan].filter(Boolean).join(' · ');
  return (
    <li className="flex items-start gap-3 py-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-marca-tenue text-marca-texto">
        <Icon className="size-[1.1rem]" aria-hidden />
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="font-semibold text-tinta">{SERVICIO_ETIQUETA[s.servicio]}</p>
          <EstadoServicioBadge estado={s.estado} />
          {s.tieneSubsidio && <Badge tone="marca">Con subsidio</Badge>}
        </div>
        <p className="text-sm text-tinta-suave">
          {detalle && <>{detalle} · </>}Desde el {formatDate(s.fechaAlta)}
          {s.fechaBaja && <> · Baja el {formatDate(s.fechaBaja)}</>}
        </p>
        {colocado && (
          <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-tinta">
            <Gauge className="size-4 shrink-0 text-tinta-suave" aria-hidden />
            Medidor <span className="font-semibold tabular-nums">{colocado.numero}</span>
            <span className="text-tinta-suave">
              · {colocado.tipo}
              {Number(colocado.factorMult) !== 1 && <> · multiplica por {Number(colocado.factorMult)}</>}
            </span>
          </p>
        )}
        {anteriores.map((m) => (
          <p key={m.id} className="pl-[1.375rem] text-xs text-tinta-suave">
            Antes: <span className="tabular-nums">{m.numero}</span>, retirado el {m.retiradoEl ? formatDate(m.retiradoEl) : '—'}
          </p>
        ))}
      </div>
    </li>
  );
}

/** Una conexión con sus servicios y medidores. Se usa en la ficha del socio y en el panel del mapa. */
export function ConexionCard({ conexion, compact }: { conexion: ConexionDetalle; compact?: boolean }) {
  return (
    <section className={compact ? '' : 'rounded-2xl border border-linea bg-superficie'}>
      <header className={compact ? 'pb-1' : 'border-b border-linea px-4 py-3'}>
        <p className="flex items-start gap-2 font-semibold text-tinta">
          <MapPin className="mt-0.5 size-4 shrink-0 text-marca-texto" aria-hidden />
          {conexion.direccion}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 pl-6 text-sm text-tinta-suave">
          <span>
            Conexión <span className="tabular-nums">{conexion.numero}</span>
          </span>
          {conexion.zona && <span>{conexion.zona}</span>}
          {conexion.ruta && (
            <span className="flex items-center gap-1">
              <Route className="size-3.5" aria-hidden />
              Parada {conexion.ordenRuta}
            </span>
          )}
        </p>
      </header>
      <ul className={compact ? 'divide-y divide-linea' : 'divide-y divide-linea px-4'}>
        {conexion.servicios.map((s) => (
          <Servicio key={s.id} s={s} />
        ))}
      </ul>
    </section>
  );
}
