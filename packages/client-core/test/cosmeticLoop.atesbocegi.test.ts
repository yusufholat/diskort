import { describe, expect, it } from 'vitest';
import { ATESBOCEGI_LOOP, atesbocegiLoopBlink, atesbocegiLoopBlinks, COSMETIC_LOOP_SHADERS, loopTrackPhase } from '../src/cosmeticLoops';
import { COSMETIC_SHADERS } from '../src/index';
import { glslFloat } from '../src/cosmeticLoops/loop';

const PERIODS = [5, 6, 7];
const TAU = Math.PI * 2;
const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** Kaynakta zamanın (t) çarpan olarak geçtiği hızlar ve bölen olarak geçtiği süreler */
function timeTerms(source: string): { rates: number[]; divisors: number[]; other: boolean } {
  // açıklamalar dışında
  const src = source.replace(/\/\/.*$/gm, '');
  const rates = [...src.matchAll(/\bt\*([0-9.]+)/g)].map((m) => Number(m[1]));
  const divisors = [...src.matchAll(/\bt\/([0-9.]+)/g)].map((m) => Number(m[1]));
  // bunların, tanımların ve işlevlere aktarmanın dışında t kalmamalı
  const rest = src
    .replace(/float t\b/g, '')
    .replace(/\bt\*[0-9.]+/g, '')
    .replace(/\bt\/[0-9.]+/g, '')
    .replace(/,t(?=[,)])/g, '');
  return { rates, divisors, other: /\bt\b/.test(rest) };
}

describe('kozmetik döngü biçimi: ateşböceği', () => {
  it('canlı gölgelendirici canlı zamanlamayı kullanır (döngü biçimi uygulamanın çizdiği kaynağa karışmaz)', () => {
    const live = COSMETIC_SHADERS.atesbocegi;
    expect(live.startsWith('\n// Çam silüeti: her hücrede bir ağaç;')).toBe(true);
    expect(live).toContain('float x=uv.x+t*.004*(fi+1.);');
    expect(live).toContain('float fog=fbm3(vec2(x*2.2-t*.03*(fi+1.),uv.y*4.+fi*3.));');
    expect(live).toContain('float w=fbm3(dir*2.+vec2(t*.1,0.)+h*1.5);');
    expect(live).toContain('exp(-sq((r-R*1.06)/(R*.1)))*(.22+.1*sin(t*1.7));');
    expect(live).toContain('float fog=fbm3(vec2(p.x/90.-t*.05,p.y/40.+t*.02));');
    expect(live).toContain('float fb=smoothstep(.55,1.,fog)*smoothstep(bh*.8,u_res.y,p.y)*.3;');
    expect(live).not.toContain('fract(t/');
    expect(live).not.toContain('ffDrift');
  });

  it('döngü gölgelendiricisi: süre tek parametre, zamana bağlı her terim döngüde tam tur atar', () => {
    const make = COSMETIC_LOOP_SHADERS.atesbocegi;
    expect(make).toBeDefined();
    for (const T of PERIODS) {
      const src = make!(T);
      const terms = timeTerms(src);
      expect(terms.other).toBe(false);
      expect(terms.divisors.length).toBeGreaterThan(0);
      for (const d of terms.divisors) expect(d).toBe(T);
      // iki hız: katmanların salınımı (tek tur) ve halkanın nabzı
      expect(terms.rates.length).toBe(2);
      for (const rate of terms.rates) {
        const turns = (rate * T) / TAU;
        expect(Math.abs(turns - Math.round(turns))).toBeLessThan(1e-5);
        expect(Math.round(turns)).toBeGreaterThanOrEqual(1);
      }
      for (const gone of ['t*.004', 't*.03', 't*.1,', 'sin(t*1.7)', 't*.05', 't*.02']) expect(src).not.toContain(gone);
      // ağaç katmanları kaymaz, aynı evreyle salınır; en büyük hız canlıdaki kaymanın swaySpeed katı
      const w = TAU / T;
      const amp = (0.004 * ATESBOCEGI_LOOP.swaySpeed) / w;
      expect(src).toContain(`float x=uv.x+${glslFloat(amp)}*(fi+1.)*sin(t*${glslFloat(w)});`);
      expect(amp * w).toBeCloseTo(0.004 * ATESBOCEGI_LOOP.swaySpeed, 12);
      // sisler canlıdaki hızlarıyla süzülür
      expect(src).toContain('float fog=ffDrift(vec2(x*2.2,uv.y*4.+fi*3.),vec2(-.03*(fi+1.),0.),t);');
      expect(src).toContain('float w=ffDrift(dir*2.+h*1.5,vec2(.1,0.),t);');
      expect(src).toContain('float fog=ffDrift(vec2(p.x/90.,p.y/40.),vec2(-.05,.02),t);');
      // kartta sis alt kenara bağlı değil: afişe göre yerleşir
      expect(src).not.toContain('smoothstep(bh*.8,u_res.y,p.y)');
      expect(src).toContain('smoothstep(bh*.8,bh*1.4,p.y)*smoothstep(bh*3.4,bh*1.6,p.y)*.3;');
    }
    // 6 sn'de halkanın nabzı iki tur (canlıda 1.7 rad/sn: 3.7 sn)
    expect(make!(6)).toContain('sin(t*2.094395)');
  });

  it('döngü gölgelendiricisi: zamana ve alt kenara bağlı satırlar dışında canlıyla aynı', () => {
    const live = COSMETIC_SHADERS.atesbocegi.split('\n');
    const loop = new Set(COSMETIC_LOOP_SHADERS.atesbocegi!(6).split('\n'));
    const changed = live.filter((line) => !loop.has(line));
    expect(changed.length).toBe(6);
    for (const line of changed.slice(0, 5)) expect(/\bt\*/.test(line), line).toBe(true);
    expect(changed[5]).toContain('smoothstep(bh*.8,u_res.y,p.y)');
  });

  it('yanıp sönme sayıları: canlıdaki tempoda (3-9 sn), raydaki böcekler aynı anda yanmaz', () => {
    for (const T of PERIODS) {
      for (const span of [1, 2, 3, 4, 5]) {
        const options = atesbocegiLoopBlinks(span, T);
        expect(options.length).toBeGreaterThan(0);
        for (const n of options) {
          expect(Number.isInteger(n)).toBe(true);
          expect(gcd(n, span)).toBe(1);
          const seconds = (span * T) / n;
          expect(seconds).toBeLessThanOrEqual(9 + 1e-9);
          // aralıkta aralarında asal sayı yoksa en yakın (daha hızlı) sayı seçilir
          expect(seconds).toBeGreaterThan(2);
        }
      }
    }
    expect(atesbocegiLoopBlinks(3, 6)).toEqual([2, 4, 5]);
    expect(atesbocegiLoopBlinks(4, 6)).toEqual([3, 5, 7]);
    expect(atesbocegiLoopBlinks(1, 6)).toEqual([1, 2]);
  });

  it('raydaki böceklerin parlaklığı döngü süresinde aynen yinelenir ve sıçramaz', () => {
    for (const T of PERIODS) {
      for (const span of [1, 2, 3, 4]) {
        for (const n of atesbocegiLoopBlinks(span, T)) {
          const at = (t: number): number[] =>
            Array.from({ length: span }, (_, j) => atesbocegiLoopBlink(loopTrackPhase(t, T, span, j, 0.37), n, 1.1));
          let prev = at(-1 / 30);
          for (let i = 0; i <= T * 30; i++) {
            const t = i / 30;
            const now = at(t);
            const later = at(t + T);
            for (let j = 0; j < span; j++) {
              expect(now[j]).toBeGreaterThanOrEqual(0.15 - 1e-12);
              expect(now[j]).toBeLessThanOrEqual(1 + 1e-12);
              // bir döngü sonra j'inci böcek (j+1)'incinin yerinde ve onun parlaklığında
              expect(later[j]).toBeCloseTo(now[(j + 1) % span]!, 9);
              // kare başına değişim küçük
              expect(Math.abs(now[j]! - prev[j]!)).toBeLessThan(0.2);
            }
            prev = now;
          }
          // raydaki böcekler farklı anlarda parlar
          if (span > 1) {
            const b = at(0.4);
            expect(Math.max(...b) - Math.min(...b)).toBeGreaterThan(0);
          }
        }
      }
    }
  });
});
