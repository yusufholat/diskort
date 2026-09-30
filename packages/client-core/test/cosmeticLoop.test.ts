import { describe, expect, it } from 'vitest';
import {
  BUZ_LOOP,
  buzLoopG,
  COSMETIC_LOOP_SECONDS,
  COSMETIC_LOOP_SHADERS,
  COSMETIC_SHADER_MAIN,
  COSMETIC_SHADERS,
  cosmeticShaderMain,
  loopRate,
} from '../src/index';
import { glslFloat } from '../src/cosmeticShaders/loop';

describe('kozmetik döngü biçimi', () => {
  it('canlı gölgelendiriciler canlı zamanlamayı kullanır (döngü biçimi uygulamanın çizdiği kaynağa karışmaz)', () => {
    const live = COSMETIC_SHADERS.buz;
    expect(live).toContain('float iceG(float t){float s=mod(t,14.)/14.; if(s<.45)return 1.-pow(1.-s/.45,3.); if(s<.84)return 1.;');
    expect(live).toContain('float sweepPos=mod(t*.22,1.6)-.3;');
    expect(live).not.toContain('fract(t/');
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

  it('buz büyüme eğrisi: boş başlar, dolar, erir ve döngü süresinde aynen yinelenir', () => {
    expect(BUZ_LOOP.grow + BUZ_LOOP.hold + BUZ_LOOP.melt).toBeLessThanOrEqual(1);
    for (const T of [5, COSMETIC_LOOP_SECONDS, 7]) {
      expect(buzLoopG(0, T)).toBe(0);
      expect(buzLoopG(T * (BUZ_LOOP.grow + BUZ_LOOP.hold / 2), T)).toBe(1);
      // döngünün sonunda buz tümüyle erimiş: dikiş boş karede
      expect(buzLoopG(T * 0.995, T)).toBe(0);
      let prev = buzLoopG(0, T);
      for (let i = 1; i <= 600; i++) {
        const t = (i / 600) * T;
        const g = buzLoopG(t, T);
        expect(g).toBeGreaterThanOrEqual(0);
        expect(g).toBeLessThanOrEqual(1);
        // sıçrama yok: art arda örnekler arasında küçük fark
        expect(Math.abs(g - prev)).toBeLessThan(0.02);
        prev = g;
        expect(buzLoopG(t + T, T)).toBeCloseTo(g, 9);
        expect(buzLoopG(t - T, T)).toBeCloseTo(g, 9);
      }
    }
  });

  it('buz döngü gölgelendiricisi: süre tek parametre, canlıdaki süreler kalmaz, gerisi canlıyla aynı', () => {
    const make = COSMETIC_LOOP_SHADERS.buz;
    expect(make).toBeDefined();
    const live = COSMETIC_SHADERS.buz;
    for (const T of [5, 6, 7]) {
      const src = make!(T);
      expect(src).toContain(`fract(t/${T}.)`);
      expect(src).not.toContain('mod(t,14.)');
      expect(src).not.toContain('mod(t*.22,1.6)');
      // zamana bağlı iki satır dışında kaynak canlıyla aynı
      const a = src.split('\n');
      const b = live.split('\n');
      expect(a.length).toBe(b.length);
      const changed = a.filter((line, i) => line !== b[i]);
      expect(changed.length).toBe(2);
      expect(changed[0]).toContain('float iceG(float t)');
      expect(changed[1]).toContain('float sweepPos=');
    }
    // 6 sn'de tek süpürme; canlıdaki hız korunarak 14 sn'de iki
    expect(make!(6)).toContain('*1.+.5)*1.6-.3');
    expect(make!(14)).toContain('*2.+.5)*1.6-.3');
  });
});
