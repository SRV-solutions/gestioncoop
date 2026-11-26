// Código QR de ARCA (RG 4892): va en todo comprobante electrónico. Lleva a la página de ARCA que
// confirma que el comprobante existe, con sus datos en JSON y en base64.
import { cbteTipo, docTipo } from './codigos';

export interface DatosQrFiscal {
  fecha: string;
  cuit: string;
  puntoVenta: number;
  tipo: 'factura' | 'nota_credito' | 'nota_debito';
  letra: string;
  numero: number;
  total: string;
  tipoDoc: string | null;
  nroDoc: string | null;
  cae: string;
}

export function urlQrFiscal(d: DatosQrFiscal): string {
  const tipoDocRec = docTipo(d.tipoDoc);
  const datos = {
    ver: 1,
    fecha: d.fecha.slice(0, 10),
    cuit: Number(d.cuit),
    ptoVta: d.puntoVenta,
    tipoCmp: cbteTipo(d.tipo, d.letra),
    nroCmp: d.numero,
    importe: Number(d.total),
    moneda: 'PES',
    ctz: 1,
    ...(tipoDocRec !== 99 && d.nroDoc ? { tipoDocRec, nroDocRec: Number(d.nroDoc.replace(/\D/g, '')) } : {}),
    tipoCodAut: 'E',
    codAut: Number(d.cae),
  };
  return `https://www.afip.gob.ar/fe/qr/?p=${Buffer.from(JSON.stringify(datos)).toString('base64')}`;
}
