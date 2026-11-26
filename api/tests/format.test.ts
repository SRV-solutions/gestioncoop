import { describe, expect, it } from 'vitest';
import { formatComprobante, formatCuit, formatDate, formatDateTime, formatDni, formatMoney, formatNumber, formatPeriodo, initials, sortRoles } from '../src/shared';

describe('formato es-AR', () => {
  it('dinero con punto de miles y coma decimal', () => {
    expect(formatMoney(161724.49)).toBe('$ 161.724,49');
    expect(formatMoney('369561.80')).toBe('$ 369.561,80');
    expect(formatMoney(0)).toBe('$ 0,00');
    expect(formatMoney(26716, { cents: false })).toBe('$ 26.716');
  });

  it('números', () => {
    expect(formatNumber(1176)).toBe('1.176');
    expect(formatNumber(2606.1688, 4)).toBe('2.606,1688');
    expect(formatDni('20123456')).toBe('20.123.456');
  });

  it('fechas como dd/mm/aaaa en hora argentina', () => {
    expect(formatDate('2026-09-07')).toBe('07/09/2026');
    // 02:30 UTC del 1/12 todavía es 30/11 en Argentina
    expect(formatDate('2026-12-01T02:30:00Z')).toBe('30/11/2026');
    expect(formatDateTime('2026-12-01T02:30:00Z')).toBe('30/11/2026 23:30');
  });

  it('períodos, comprobantes y CUIT', () => {
    expect(formatPeriodo(8, 2026)).toBe('08/2026');
    expect(formatComprobante('B', 6, 2043619)).toBe('B 0006-02043619');
    expect(formatCuit('30610990890')).toBe('30-61099089-0');
  });

  it('iniciales y orden de roles', () => {
    expect(initials('Ana María Pérez')).toBe('AP');
    expect(initials('Gerencia')).toBe('G');
    expect(sortRoles(['socio', 'admin', 'cajero'])).toEqual(['admin', 'cajero', 'socio']);
  });
});
