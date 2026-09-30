// Kozmetik oynatıcısının hata bildirimi seyrek tutulur: aynı hata oturumda bir kez, toplamda birkaç farklı hata.

import { describe, expect, it, vi } from 'vitest';

const sent = vi.hoisted(() => [] as { message: string; where: string }[]);
vi.mock('@diskort/client-core', () => ({
  reportClientError: (error: Error, where: string) => void sent.push({ message: error.message, where }),
}));

import { createReportLimiter, reportCosmeticError } from '../src/components/cosmetics/report';

describe('createReportLimiter', () => {
  it('aynı anahtarı bir kez, toplamda en çok `max` anahtarı geçirir', () => {
    const allow = createReportLimiter(2);
    expect(allow('a')).toBe(true);
    expect(allow('a')).toBe(false);
    expect(allow('b')).toBe(true);
    expect(allow('c')).toBe(false);
    expect(allow('b')).toBe(false);
  });
});

describe('reportCosmeticError', () => {
  it('hatayı yeriyle birlikte bir kez bildirir; hiçbir durumda fırlatmaz', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    reportCosmeticError('video', new Error('kare gelmedi'));
    reportCosmeticError('video', new Error('kare gelmedi'));
    reportCosmeticError('yüzey', 'düz metin');
    expect(sent).toEqual([
      { message: 'video: kare gelmedi', where: 'kozmetik' },
      { message: 'yüzey: düz metin', where: 'kozmetik' },
    ]);
    for (let i = 0; i < 20; i++) reportCosmeticError('resim', new Error(`hata ${i}`));
    expect(sent.length).toBeLessThanOrEqual(6);
    expect(() => reportCosmeticError('x', undefined)).not.toThrow();
    warn.mockRestore();
  });
});
