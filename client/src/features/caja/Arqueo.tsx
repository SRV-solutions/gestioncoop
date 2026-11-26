// Abrir la caja con su fondo y cerrarla con arqueo (SPEC 6.6): lo que tiene que haber en efectivo
// contra lo que se contó. Si no coincide, hay que contar qué pasó.
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Calculator, CircleCheck, Wallet } from 'lucide-react';
import { aCentavos, deCentavos, formatMoney, leerImporte, MEDIO_PAGO_ETIQUETA, type CajaResumen } from '@shared';
import { api, ApiError, errorMessage } from '../../lib/api';
import { cn } from '../../lib/cn';
import { Modal } from '../../components/Modal';
import { Button, Card, FormAlert } from '../../components/ui';
import { CampoImporte, hora, Kbd, plural } from './piezas';

/* ───────────────────────── Abrir ───────────────────────── */

export function AbrirCaja() {
  const qc = useQueryClient();
  const [fondo, setFondo] = useState('');
  // Hay que escribirlo siempre (aunque sea 0): un Enter de más no abre una caja.
  const leido = fondo.trim() ? leerImporte(fondo) : null;
  const abrir = useMutation({
    mutationFn: () => api.post<CajaResumen>('/caja/abrir', { fondoInicial: leido }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['caja'] }),
  });
  return (
    <Card className="mx-auto max-w-lg px-6 py-8">
      <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-marca-tenue text-marca-texto">
        <Wallet className="size-7" aria-hidden />
      </div>
      <h2 className="mt-4 text-center text-xl font-bold text-tinta">Abrí la caja para empezar a cobrar</h2>
      <p className="mt-1.5 text-center text-tinta-suave">Contá el efectivo que hay en el cajón para dar vuelto. Al cerrar, el sistema te dice cuánto tiene que haber.</p>
      <form
        className="mt-6 space-y-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (leido !== null && !abrir.isPending) abrir.mutate();
        }}
      >
        <CampoImporte
          grande
          autoFocus
          label="Fondo inicial"
          value={fondo}
          onChange={setFondo}
          placeholder="20.000"
          error={fondo.trim() && leido === null ? 'Escribí un importe, por ejemplo 20000' : null}
          hint="Si arranca sin efectivo, escribí 0."
        />
        {abrir.isError && <FormAlert>{abrir.error instanceof ApiError && abrir.error.fields?.fondoInicial ? abrir.error.fields.fondoInicial : errorMessage(abrir.error)}</FormAlert>}
        <Button type="submit" size="lg" className="w-full" loading={abrir.isPending} disabled={leido === null}>
          Abrir la caja <Kbd className="border-white/30 bg-white/15 text-white">Enter</Kbd>
        </Button>
      </form>
    </Card>
  );
}

/* ───────────────────────── Cerrar con arqueo ───────────────────────── */

// Billetes en circulación, del más grande al más chico (en pesos).
const BILLETES = [20000, 10000, 2000, 1000, 500, 200, 100];

export function CerrarCaja({ caja, onClose }: { caja: CajaResumen; onClose: () => void }) {
  const qc = useQueryClient();
  const [contado, setContado] = useState('');
  const [nota, setNota] = useState('');
  const [porBilletes, setPorBilletes] = useState(false);
  const [billetes, setBilletes] = useState<Record<number, number>>({});
  const [monedas, setMonedas] = useState('');
  const [cerrada, setCerrada] = useState<CajaResumen | null>(null);

  const esperado = aCentavos(caja.efectivoEsperado);
  const monedasLeidas = monedas.trim() ? leerImporte(monedas) : '0.00';
  const sumaBilletes = BILLETES.reduce((t, b) => t + b * 100 * (billetes[b] ?? 0), 0) + (monedasLeidas ? aCentavos(monedasLeidas) : 0);
  const contadoLeido = porBilletes ? deCentavos(sumaBilletes) : contado.trim() ? leerImporte(contado) : null;
  const diferencia = contadoLeido !== null ? aCentavos(contadoLeido) - esperado : null;
  const faltaNota = diferencia !== null && diferencia !== 0 && nota.trim().length < 5;
  const listo = contadoLeido !== null && (porBilletes || contado.trim() !== '') && !faltaNota && (!porBilletes || monedasLeidas !== null);

  const cerrar = useMutation({
    mutationFn: () => api.post<CajaResumen>('/caja/cerrar', { contado: contadoLeido, nota: nota.trim() || undefined }),
    onSuccess: (r) => {
      setCerrada(r);
      void qc.invalidateQueries({ queryKey: ['caja'] });
    },
  });
  const efectivo = caja.porMedio.find((m) => m.medio === 'efectivo')!;
  const otros = caja.porMedio.filter((m) => m.medio !== 'efectivo' && m.cantidad > 0);

  if (cerrada) {
    const d = Number(cerrada.diferencia ?? 0);
    return (
      <Modal
        title="Caja cerrada"
        onClose={onClose}
        footer={
          // Con `key`: es un botón nuevo y no el «Seguir cobrando» reciclado, así toma el foco al aparecer.
          <Button key="listo" autoFocus onClick={onClose}>
            Listo
          </Button>
        }
      >
        <div className="text-center" role="status">
          <div className={cn('mx-auto grid size-14 place-items-center rounded-full', d === 0 ? 'bg-exito-tenue text-exito' : 'bg-alerta-tenue text-alerta')}>
            <CircleCheck className="size-8" aria-hidden />
          </div>
          <p className="mt-3 text-xl font-bold text-tinta">{d === 0 ? 'El arqueo cerró justo' : d < 0 ? `Faltaron ${formatMoney(-d)}` : `Sobraron ${formatMoney(d)}`}</p>
          <p className="mt-1 text-tinta-suave">
            {plural(cerrada.cobros, 'cobro', 'cobros')} por {formatMoney(cerrada.total)} · se contaron {formatMoney(cerrada.contado ?? 0)} en efectivo.
          </p>
          {d !== 0 && <p className="mt-2 text-sm text-tinta-suave">La diferencia y tu explicación quedan a la vista de administración.</p>}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title="Cerrar la caja"
      description={`Abierta a las ${hora(caja.abiertaEl)} · ${plural(caja.cobros, 'cobro', 'cobros')} por ${formatMoney(caja.total)}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Seguir cobrando
          </Button>
          <Button type="submit" form="form-cerrar-caja" loading={cerrar.isPending} disabled={!listo}>
            Cerrar la caja
          </Button>
        </>
      }
    >
      <form
        id="form-cerrar-caja"
        className="space-y-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (listo && !cerrar.isPending) cerrar.mutate();
        }}
      >
        <ul className="divide-y divide-linea rounded-2xl border border-linea text-sm">
          <li className="flex items-center justify-between gap-3 px-4 py-2">
            <span>Fondo inicial</span>
            <span className="font-semibold tabular-nums">{formatMoney(caja.fondoInicial)}</span>
          </li>
          <li className="flex items-center justify-between gap-3 px-4 py-2">
            <span>
              Cobrado en efectivo <span className="text-tinta-suave">· {efectivo.cantidad}</span>
            </span>
            <span className="font-semibold tabular-nums">{formatMoney(efectivo.total)}</span>
          </li>
          <li className="flex items-center justify-between gap-3 bg-fondo px-4 py-2.5 text-base font-bold text-tinta">
            <span>Tiene que haber en el cajón</span>
            <span className="tabular-nums">{formatMoney(caja.efectivoEsperado)}</span>
          </li>
        </ul>
        {otros.length > 0 && (
          <p className="text-sm text-tinta-suave">
            Aparte, sin pasar por el cajón: {otros.map((m) => `${MEDIO_PAGO_ETIQUETA[m.medio].toLowerCase()} ${formatMoney(m.total)}`).join(' · ')}.
          </p>
        )}

        {porBilletes ? (
          <fieldset className="rounded-2xl border border-linea p-4">
            <legend className="px-1 text-sm font-semibold text-tinta">¿Cuántos billetes de cada uno?</legend>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
              {BILLETES.map((b, i) => (
                <label key={b} className="block text-sm font-medium text-tinta-suave">
                  {formatMoney(b, { cents: false })}
                  <input
                    type="number"
                    min={0}
                    max={9999}
                    autoFocus={i === 0}
                    value={billetes[b] || ''}
                    placeholder="0"
                    onChange={(e) => setBilletes((actual) => ({ ...actual, [b]: Math.max(0, Math.min(9999, Math.floor(Number(e.target.value) || 0))) }))}
                    className="mt-1 block min-h-11 w-full rounded-lg border border-linea bg-superficie px-3 text-center text-lg font-bold tabular-nums text-tinta hover:border-marca-claro focus:border-marca"
                  />
                </label>
              ))}
              <div className="col-span-2 sm:col-span-1">
                <CampoImporte label="Monedas y otros" value={monedas} onChange={setMonedas} error={monedasLeidas === null ? 'No es un importe' : null} placeholder="0" className="min-h-11" />
              </div>
            </div>
            <p className="mt-3 flex items-center justify-between gap-3 border-t border-linea pt-3 font-bold text-tinta">
              <span>Contado</span>
              <span className="text-2xl tabular-nums">{formatMoney(deCentavos(sumaBilletes))}</span>
            </p>
          </fieldset>
        ) : (
          <CampoImporte
            grande
            autoFocus
            label="¿Cuánto efectivo contaste?"
            value={contado}
            onChange={setContado}
            error={contado.trim() && contadoLeido === null ? 'Escribí un importe, por ejemplo 85000' : null}
            placeholder="0"
          />
        )}
        <Button variant="ghost" icon={Calculator} onClick={() => setPorBilletes((v) => !v)}>
          {porBilletes ? 'Escribir el total directamente' : 'Contar por billetes'}
        </Button>

        {diferencia !== null && (porBilletes || contado.trim() !== '') && (
          <div aria-live="polite" className={cn('flex items-center justify-between gap-3 rounded-2xl px-4 py-3', diferencia === 0 ? 'bg-exito-tenue' : diferencia < 0 ? 'bg-peligro-tenue' : 'bg-alerta-tenue')}>
            <span className={cn('font-bold', diferencia === 0 ? 'text-exito' : diferencia < 0 ? 'text-peligro' : 'text-alerta')}>{diferencia === 0 ? 'Cierra justo' : diferencia < 0 ? 'Falta' : 'Sobra'}</span>
            <span className={cn('text-2xl font-bold tabular-nums', diferencia === 0 ? 'text-exito' : diferencia < 0 ? 'text-peligro' : 'text-alerta')}>{formatMoney(deCentavos(Math.abs(diferencia)))}</span>
          </div>
        )}

        {diferencia !== null && diferencia !== 0 && (
          <div className="space-y-1.5">
            <label htmlFor="nota-cierre" className="block text-sm font-semibold text-tinta">
              ¿Qué pasó con la diferencia?
            </label>
            <textarea
              id="nota-cierre"
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              rows={2}
              maxLength={200}
              placeholder="Por ejemplo: di mal un vuelto"
              className="block w-full rounded-xl border border-linea bg-superficie px-4 py-3 text-base text-tinta placeholder:text-tinta-suave/80 hover:border-marca-claro focus:border-marca"
            />
            <p className="text-sm text-tinta-suave">Antes de cerrar, volvé a contar. Si igual no coincide, la explicación queda para administración.</p>
          </div>
        )}
        {cerrar.isError && <FormAlert>{cerrar.error instanceof ApiError && cerrar.error.fields?.nota ? cerrar.error.fields.nota : errorMessage(cerrar.error)}</FormAlert>}
      </form>
    </Modal>
  );
}
