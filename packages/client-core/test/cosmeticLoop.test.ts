import { describe, expect, it } from 'vitest';
import { cosmeticShaderMain, loopRate } from '../src/cosmeticLoops';
import { COSMETIC_SHADER_MAIN } from '../src/index';
import { glslFloat } from '../src/cosmeticLoops/loop';

// Döngü biçimlerinin ORTAK kuralları. Setlerin kendi testleri ayrı dosyalarda: cosmeticLoop.<set>.test.ts

describe('kozmetik döngü biçimi: ortak', () => {
  it('canlı giriş noktası her karede değişen gürültüyü kullanır (döngü biçimi canlı kaynağa karışmaz)', () => {
    expect(COSMETIC_SHADER_MAIN).toContain('c.rgb=clamp(c.rgb+(h21(fc+fract(u_time))-.5)/255.,0.,1.);');
    expect(cosmeticShaderMain('frame')).toBe(COSMETIC_SHADER_MAIN);
  });

  it('gürültü biçimleri: sabit ve kapalı olanlar zamana bağlı değil', () => {
    expect(COSMETIC_SHADER_MAIN).toContain('fract(u_time)');
    expect(cosmeticShaderMain('static')).not.toContain('u_time');
    expect(cosmeticShaderMain('static')).toContain('h21(fc)');
    expect(cosmeticShaderMain('off')).not.toContain('h21');
  });

  it('GLSL sabitleri ondalık yazılır', () => {
    expect(glslFloat(6)).toBe('6.');
    expect(glslFloat(0.5)).toBe('0.5');
    expect(glslFloat(0.1 + 0.2)).toBe('0.3');
    expect(() => glslFloat(Number.NaN)).toThrow();
  });

  it('hız döngüye tam sayıda tur sığacak biçimde yuvarlanır (en az bir tur, yön korunur)', () => {
    const TAU = Math.PI * 2;
    for (const rate of [0.05, 0.22, 1.2, 1.7, 3, -0.6]) {
      for (const period of [5, 6, 7]) {
        const r = loopRate(rate, period);
        const turns = (r * period) / TAU;
        expect(Math.abs(turns - Math.round(turns))).toBeLessThan(1e-9);
        expect(Math.abs(turns)).toBeGreaterThanOrEqual(1);
        expect(Math.sign(r)).toBe(Math.sign(rate));
        expect(Math.sin(0 * r + 1.3)).toBeCloseTo(Math.sin(period * r + 1.3), 9);
      }
    }
    // 6 sn'de saniyede 1.2 radyan → tek tur (2π/6)
    expect(loopRate(1.2, 6)).toBeCloseTo(TAU / 6, 12);
    // başka birimle: 1.6 birimlik yolu saniyede .22 birimle geçen süpürme 6 sn'ye bir kez sığar
    expect(loopRate(0.22, 6, 1.6)).toBeCloseTo(1.6 / 6, 12);
  });
});
