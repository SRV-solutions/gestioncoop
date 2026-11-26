// Lo mínimo de XML para hablar con ARCA: armar el pedido escapando los valores y leer las respuestas,
// que son chicas y siempre tienen la misma forma (sin CDATA ni atributos que importen).

export function escapar(valor: string | number): string {
  return String(valor).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export function desescapar(texto: string): string {
  return texto
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Un elemento con hijos: `{ Nombre: valor }` en ese orden (el orden importa para ARCA). `null`/`undefined` no se escribe. */
export type NodoXml = string | number | boolean | null | undefined | NodoXml[] | { [nombre: string]: NodoXml };

/** Arma XML con el prefijo de espacio de nombres dado (`ar:Nombre`). Un arreglo repite el elemento. */
export function armar(nodo: NodoXml, prefijo = ''): string {
  if (nodo === null || nodo === undefined) return '';
  if (typeof nodo !== 'object') return escapar(typeof nodo === 'boolean' ? (nodo ? 'true' : 'false') : nodo);
  if (Array.isArray(nodo)) return nodo.map((n) => armar(n, prefijo)).join('');
  let out = '';
  for (const [nombre, valor] of Object.entries(nodo)) {
    if (valor === null || valor === undefined) continue;
    const etiqueta = `${prefijo}${nombre}`;
    const valores = Array.isArray(valor) ? valor : [valor];
    for (const v of valores) out += `<${etiqueta}>${armar(v, prefijo)}</${etiqueta}>`;
  }
  return out;
}

const patron = (nombre: string) => new RegExp(`<(?:[\\w-]+:)?${nombre}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${nombre}>`, 'g');

/** Contenido (sin desescapar) de cada aparición del elemento, sin importar el prefijo. */
export function todos(xml: string, nombre: string): string[] {
  return [...xml.matchAll(patron(nombre))].map((m) => m[1]!);
}

/** Primera aparición del elemento, ya desescapada; `null` si no está. */
export function texto(xml: string, nombre: string): string | null {
  const [primero] = todos(xml, nombre);
  return primero === undefined ? null : desescapar(primero.trim());
}

/** Primera aparición del elemento, como XML crudo (para seguir buscando adentro). */
export function bloque(xml: string, nombre: string): string | null {
  return todos(xml, nombre)[0] ?? null;
}

/** Los pares código/mensaje de una lista de errores u observaciones de ARCA (`Err`, `Obs`, `Evt`). */
export function mensajes(xml: string | null, elemento: string): { codigo: string; mensaje: string }[] {
  if (!xml) return [];
  return todos(xml, elemento).map((e) => ({ codigo: texto(e, 'Code') ?? '', mensaje: texto(e, 'Msg') ?? '' }));
}
