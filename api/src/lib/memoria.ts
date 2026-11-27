// Resultados que cuestan calcular y cambian poco (el promedio de consumo de un barrio, por ejemplo),
// guardados unos minutos en la memoria de este proceso. No se guarda nada en disco ni en la base.
// Se guarda la promesa: si llegan cien pedidos juntos, se calcula una sola vez.
const guardados = new Map<string, { vence: number; valor: Promise<unknown> }>();
const MAXIMO = 5000;

export function recordar<T>(clave: string, ms: number, calcular: () => Promise<T>): Promise<T> {
  const ahora = Date.now();
  const guardado = guardados.get(clave);
  if (guardado && guardado.vence > ahora) return guardado.valor as Promise<T>;
  const valor = calcular();
  guardados.set(clave, { vence: ahora + ms, valor });
  // Un error no se recuerda: el próximo pedido lo vuelve a intentar.
  valor.catch(() => guardados.delete(clave));
  if (guardados.size > MAXIMO) {
    for (const [k, g] of guardados) if (g.vence <= ahora) guardados.delete(k);
    // Si siguen sobrando, se van los más viejos.
    for (const k of guardados.keys()) {
      if (guardados.size <= MAXIMO) break;
      guardados.delete(k);
    }
  }
  return valor;
}

/** Para los tests: olvida todo. */
export function olvidarTodo(): void {
  guardados.clear();
}
