// Búsqueda de socios en un solo campo: la usan el padrón y la caja.
import { normalizeText } from '../shared';

/**
 * Arma la condición de búsqueda. Un solo campo sirve para todo (SPEC 5, cajero): nombre, DNI/CUIT,
 * número de socio, número de conexión, medidor o dirección. Las palabras se buscan sin acentos.
 * Es SQL crudo, así que el filtro por cooperativa va escrito a mano en cada subconsulta.
 */
export function condicionDeBusqueda(q: string | undefined): { sql: string; params: Record<string, unknown> } {
  const texto = normalizeText(q ?? '');
  if (!texto) return { sql: 'TRUE', params: {} };

  const soloDigitos = texto.replace(/ /g, '');
  if (/^\d+$/.test(soloDigitos)) {
    return {
      sql: `(
        s.numero = :numero
        OR s.nro_doc LIKE :documento
        OR EXISTS (SELECT 1 FROM conexiones c
                   WHERE c.socio_id = s.id AND c.cooperativa_id = :cooperativaId AND c.eliminado_el IS NULL
                     AND (c.numero = :numero OR c.direccion_norm LIKE :contiene))
        OR EXISTS (SELECT 1 FROM medidores m
                   JOIN servicios_conexion sc ON sc.id = m.servicio_conexion_id
                   JOIN conexiones c ON c.id = sc.conexion_id
                   WHERE c.socio_id = s.id AND m.cooperativa_id = :cooperativaId AND m.numero LIKE :medidor)
      )`,
      params: {
        // Un número más largo que un entero no puede ser número de socio ni de conexión.
        numero: soloDigitos.length <= 9 ? Number(soloDigitos) : -1,
        documento: `${soloDigitos}%`,
        medidor: `%${soloDigitos}`,
        contiene: `% ${soloDigitos}%`,
      },
    };
  }

  // normalizeText deja solo letras, números y espacios: no hay comodines de LIKE que escapar.
  const palabras = texto.split(' ').slice(0, 6);
  const params: Record<string, unknown> = {};
  palabras.forEach((p, i) => (params[`p${i}`] = `%${p}%`));
  const todas = (columna: string) => palabras.map((_, i) => `${columna} LIKE :p${i}`).join(' AND ');
  return {
    sql: `(
      (${todas('s.nombre_norm')})
      OR EXISTS (SELECT 1 FROM conexiones c
                 WHERE c.socio_id = s.id AND c.cooperativa_id = :cooperativaId AND c.eliminado_el IS NULL
                   AND ${todas('c.direccion_norm')})
    )`,
    params,
  };
}
