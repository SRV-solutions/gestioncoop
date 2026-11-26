// Integridad de los datos: cada factura, cada cobro y cada registro de auditoría quedan encadenados con
// una huella. La verificación recalcula la cadena y cruza saldos, numeración y anulaciones.

export const ESTADOS_VERIFICACION = ['en_curso', 'ok', 'con_problemas', 'fallida'] as const;
export type EstadoVerificacion = (typeof ESTADOS_VERIFICACION)[number];
export const ESTADO_VERIFICACION_ETIQUETA: Record<EstadoVerificacion, string> = {
  en_curso: 'Verificando…',
  ok: 'Todo en orden',
  con_problemas: 'Encontró problemas',
  fallida: 'No se pudo terminar',
};

export const LIBROS_INTEGRIDAD = ['facturas', 'cobros', 'auditoria'] as const;
export type LibroIntegridad = (typeof LIBROS_INTEGRIDAD)[number];
export const LIBRO_INTEGRIDAD_ETIQUETA: Record<LibroIntegridad, string> = {
  facturas: 'Facturas y notas de crédito',
  cobros: 'Cobros (recibos)',
  auditoria: 'Registro de cambios',
};

export const TIPOS_PROBLEMA = [
  'huella_no_coincide',
  'sin_huella',
  'numeracion_salteada',
  'numero_repetido',
  'total_no_cierra',
  'cobro_no_cierra',
  'saldo_no_cierra',
  'estado_no_cierra',
  'anulada_sin_nota',
  'anulacion_sin_registro',
] as const;
export type TipoProblema = (typeof TIPOS_PROBLEMA)[number];

/** Qué quiere decir cada problema, en palabras de la oficina. */
export const PROBLEMA_ETIQUETA: Record<TipoProblema, { titulo: string; explicacion: string }> = {
  huella_no_coincide: {
    titulo: 'Datos modificados por fuera de la app',
    explicacion: 'La huella guardada no coincide con los datos: alguien cambió este registro (o borró el anterior) directamente en la base.',
  },
  sin_huella: {
    titulo: 'Registro sin huella',
    explicacion: 'Está emitido pero no tiene huella: se cargó directamente en la base, sin pasar por la app.',
  },
  numeracion_salteada: {
    titulo: 'Falta un número',
    explicacion: 'La numeración saltea uno o más números: puede ser un comprobante borrado.',
  },
  numero_repetido: {
    titulo: 'Número repetido',
    explicacion: 'Hay dos comprobantes con el mismo número en el mismo talonario.',
  },
  total_no_cierra: {
    titulo: 'El total no coincide con el detalle',
    explicacion: 'La suma de los renglones de la factura no da su total.',
  },
  cobro_no_cierra: {
    titulo: 'El recibo no coincide con lo que paga',
    explicacion: 'El importe del recibo no es la suma de lo aplicado a cada factura, lo vendido en el mostrador y lo que quedó a favor.',
  },
  saldo_no_cierra: {
    titulo: 'El saldo no coincide con los cobros',
    explicacion: 'Lo que dice que se debe no es el total menos lo cobrado.',
  },
  estado_no_cierra: {
    titulo: 'Estado que no corresponde',
    explicacion: 'Figura como paga con saldo pendiente, o pendiente sin saldo.',
  },
  anulada_sin_nota: {
    titulo: 'Factura anulada sin nota de crédito',
    explicacion: 'Una factura solo se anula con una nota de crédito, y esta no la tiene.',
  },
  anulacion_sin_registro: {
    titulo: 'Anulación sin registro',
    explicacion: 'Figura anulada, pero la anulación no quedó en el registro de cambios: no se hizo desde la app.',
  },
};

export interface ProblemaIntegridad {
  tipo: TipoProblema;
  libro: LibroIntegridad;
  /** «Fact B 0006-02043619», «Rcbo B 0006-00001234», «Registro n.º 512». */
  referencia: string;
  detalle: string;
  entidadId: number | null;
}

export interface ResumenLibro {
  revisados: number;
  problemas: number;
}

export type ResumenIntegridad = Record<LibroIntegridad, ResumenLibro>;

export interface VerificacionVista {
  id: number;
  origen: 'manual' | 'automatica';
  estado: EstadoVerificacion;
  iniciadaEl: string;
  terminadaEl: string | null;
  /** Quién la pidió (`null` = la automática). */
  usuario: string | null;
  resumen: ResumenIntegridad | null;
  totalProblemas: number;
  /** Los primeros que encontró (hasta 200). */
  problemas: ProblemaIntegridad[];
  error: string | null;
}

export interface EstadoIntegridad {
  ultima: VerificacionVista | null;
  /** Las anteriores, sin el detalle de los problemas. */
  historial: Omit<VerificacionVista, 'problemas'>[];
  /** Cuándo corre la próxima verificación automática (`null` = no está programada). */
  proximaAutomatica: string | null;
}
