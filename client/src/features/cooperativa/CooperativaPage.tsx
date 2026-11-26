// La cooperativa vista por su gerencia: la imagen (logo o foto) con la que aparece en la pantalla
// de ingreso y arriba de cada pantalla, para socios y personal.
import { useRef, useState, type ChangeEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ImageUp, Trash2 } from 'lucide-react';
import type { CooperativaPublica, Me } from '@shared';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { recortarEnCuadrado } from '../../lib/foto';
import { CoopMark } from '../../components/Logo';
import { Button, Card, FormAlert, PageHeader } from '../../components/ui';

export function CooperativaPage() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const archivo = useRef<HTMLInputElement>(null);
  /** Imagen elegida y ya recortada, todavía sin guardar. */
  const [nueva, setNueva] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // La imagen nueva se ve enseguida en toda la app, y también en la pantalla de ingreso.
  const adoptar = (cooperativa: CooperativaPublica) => {
    qc.setQueryData<Me | null>(['me'], (actual) => (actual ? { ...actual, cooperativa } : actual));
    void qc.invalidateQueries({ queryKey: ['login-context'] });
    setNueva(null);
    setError(null);
  };
  const guardar = useMutation({
    mutationFn: (imagen: string) => api.put<CooperativaPublica>('/mi-cooperativa/imagen', { imagen }),
    onSuccess: adoptar,
    onError: (e) => setError(errorMessage(e)),
  });
  const quitar = useMutation({
    mutationFn: () => api.del<CooperativaPublica>('/mi-cooperativa/imagen'),
    onSuccess: adoptar,
    onError: (e) => setError(errorMessage(e)),
  });

  const cooperativa = me?.cooperativa;
  if (!cooperativa) return null;
  const tieneImagen = !!cooperativa.tema.logoUrl;
  const ocupado = guardar.isPending || quitar.isPending;

  const elegir = async (e: ChangeEvent<HTMLInputElement>) => {
    const elegido = e.target.files?.[0];
    // Para poder volver a elegir el mismo archivo.
    e.target.value = '';
    if (!elegido) return;
    setError(null);
    try {
      setNueva(await recortarEnCuadrado(elegido));
    } catch {
      setError('No pudimos abrir ese archivo. Probá con una foto en JPG o PNG.');
    }
  };

  return (
    <>
      <PageHeader title="Cooperativa" description="Cómo ven a la cooperativa los socios y el personal." />
      <Card className="p-5 sm:p-6">
        <h2 className="font-bold text-tinta">Imagen</h2>
        <p className="mt-1 text-tinta-suave">
          El logo o una foto de la cooperativa. Aparece en la pantalla de ingreso y arriba de cada pantalla. Se recorta en cuadrado, tomando el centro.
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-5">
          {nueva ? (
            <img src={nueva} alt="Vista previa de la imagen nueva" className="size-28 rounded-2xl border border-linea object-cover" />
          ) : (
            <CoopMark cooperativa={cooperativa} size="lg" className="!size-28 !rounded-2xl !text-3xl" />
          )}
          <div className="min-w-0 flex-1">
            <p className="font-bold text-tinta">{cooperativa.nombreCorto}</p>
            <p className="text-sm text-tinta-suave">
              {nueva ? 'Así va a quedar. Todavía no se guardó.' : tieneImagen ? 'Es la imagen que se ve hoy.' : `Hoy se ven las iniciales «${cooperativa.tema.iniciales}».`}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {nueva ? (
                <>
                  <Button loading={guardar.isPending} onClick={() => guardar.mutate(nueva)}>
                    Guardar
                  </Button>
                  <Button variant="ghost" disabled={ocupado} onClick={() => setNueva(null)}>
                    Cancelar
                  </Button>
                </>
              ) : (
                <>
                  <Button icon={ImageUp} disabled={ocupado} onClick={() => archivo.current?.click()}>
                    {tieneImagen ? 'Cambiar imagen' : 'Subir imagen'}
                  </Button>
                  {tieneImagen && (
                    <Button variant="secondary" icon={Trash2} loading={quitar.isPending} onClick={() => quitar.mutate()}>
                      Quitar
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
        <input ref={archivo} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1} aria-label="Elegir una imagen" onChange={(e) => void elegir(e)} />
        {error && (
          <div className="mt-4">
            <FormAlert>{error}</FormAlert>
          </div>
        )}
      </Card>
    </>
  );
}
