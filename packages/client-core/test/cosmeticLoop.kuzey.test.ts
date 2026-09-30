import { describe, expect, it } from 'vitest';
import { COSMETIC_LOOP_SECONDS, COSMETIC_LOOP_SHADERS, COSMETIC_SHADERS, KUZEY_LOOP } from '../src/cosmeticShaders';
import { isWhole, sha256, timeTerms } from './cosmeticLoop.timeTerms';

const TAU = Math.PI * 2;

/** Canlıda zamana bağlı satırlar (döngü biçiminde yerlerine başkaları gelir) */
const LIVE_TIME_LINES = [
  '    float edge=.62-fi*.14+.44*(fbm3(vec2(x*.9-t*.05*(1.+fi*.4),fi*4.))-.5)+.04*sin(x*2.3+t*.35+fi*2.);',
  '    float str=.45+.55*vn(vec2(x*26.,t*.5+fi*9.));',
  '    str*=.5+.5*smoothstep(.2,.8,fbm3(vec2(x*2.2-t*.12,fi*2.+t*.03)));',
  '    float edge=.05+.12*fbm3(dir*1.6+vec2(t*.12,-t*.07));',
  '    float cur=dy>0.?exp(-dy/(.3+.25*fbm3(dir*2.3-t*.1))):exp(-sq(dy/.035));',
  '    float str=.45+.55*vn(dir*13.+vec2(t*.5,0.));',
  '    str*=.35+.65*smoothstep(.25,.75,fbm3(dir*2.+vec2(-t*.15,t*.05)));',
];

describe('kuzey ışıkları döngü biçimi', () => {
  it('canlı gölgelendirici döngü çalışmasından önceki hâliyle harfi harfine aynı', async () => {
    // Canlı gölgelendirici bilerek değiştirilirse bu özet de güncellenir
    expect(await sha256(COSMETIC_SHADERS.kuzey)).toBe('b4fcd8758b184ed6e1c48fb28ada486735ffe56b07ec09572b6d0e19e228dbb3');
    for (const line of LIVE_TIME_LINES) expect(COSMETIC_SHADERS.kuzey.split('\n')).toContain(line);
    expect(COSMETIC_SHADERS.kuzey).not.toContain('fract(t/');
    expect(COSMETIC_SHADERS.kuzey).not.toContain('lmix');
    // sınıflandırıcı canlıdaki terimleri görüyor: hiçbiri döngüye sığmaz
    const terms = timeTerms(COSMETIC_SHADERS.kuzey);
    expect(terms.rates).toEqual([0.05, 0.35, 0.5, 0.12, 0.03, 0.12, 0.07, 0.1, 0.5, 0.15, 0.05]);
    expect(terms.fractions).toEqual([]);
    expect(terms.rates.some((r) => isWhole((r * 6) / TAU))).toBe(false);
  });

  it('süre tek parametre; canlıdaki sonsuz kaymalar kalmaz, gerisi canlıyla aynı (5, 6, 7 sn)', () => {
    const make = COSMETIC_LOOP_SHADERS.kuzey;
    expect(make).toBeDefined();
    const live = COSMETIC_SHADERS.kuzey.split('\n');
    for (const P of [5, COSMETIC_LOOP_SECONDS, 7]) {
      const lines = make!(P).split('\n');
      const kept = live.filter((line) => !LIVE_TIME_LINES.includes(line));
      expect(kept.length).toBe(live.length - LIVE_TIME_LINES.length);
      let at = -1;
      for (const line of kept) {
        const next = lines.indexOf(line, at + 1);
        expect(next, line).toBeGreaterThan(at);
        at = next;
      }
      for (const line of LIVE_TIME_LINES) expect(lines).not.toContain(line);
      // düz kayan gürültü terimleri zamanı doğrudan kullanmaz (iki kopyanın zamanı L / M üzerinden)
      for (const gone of ['-t*.05', 't*.35', '-t*.12', '+t*.03', 't*.12,-t*.07', '-t*.1)', '-t*.15', 't*.05)']) expect(make!(P)).not.toContain(gone);
    }
  });

  it('zaman yalnızca döngüye sığan biçimlerde geçer', () => {
    for (const P of [5, COSMETIC_LOOP_SECONDS, 7]) {
      const src = COSMETIC_LOOP_SHADERS.kuzey!(P);
      const terms = timeTerms(src);
      expect(terms.other).toEqual([]);
      expect(terms.rounded).toEqual([]);
      // döngünün kesri: perdenin katman başına iki kopyası, dekorasyonda iki ayrı geçiş
      expect(terms.fractions).toEqual([P, P, P]);
      // sabit hızlar: kenardaki dalga (tam tur), ışın çizgilerinin zaman ekseni (perde ve dekorasyon: tam hücre)
      expect(terms.rates.length).toBe(3);
      const [ripple, rays, decoRays] = terms.rates as [number, number, number];
      expect(isWhole((ripple * P) / TAU)).toBe(true);
      expect(rays).toBe(decoRays);
      expect(isWhole(rays * P)).toBe(true);
      // gürültünün zaman ekseni tam o kadar hücrede sarılır (canlıdaki hıza en yakın: saniyede ~.5 hücre)
      const cells = Math.round(rays * P);
      expect(cells).toBe(Math.max(1, Math.round(0.5 * P)));
      expect(src).toContain(`vnp(vec2(x*26.,t*${String(rays).replace(/^0\./, '0.')}+fi*9.),vec2(4096.,${cells}.))`);
      expect(src).toContain(`vec2(${KUZEY_LOOP.decoRayCells}.,${cells}.))`);
      // dekorasyonda ışınlar açıya göre dizilir: halka tam sayıda hücreyle kapanır (atan'ın ±π ek yeri görünmez)
      expect(Number.isInteger(KUZEY_LOOP.decoRayCells)).toBe(true);
    }
    // 6 sn'de: dalga tek tur, ışınlar 3 hücre
    const six = timeTerms(COSMETIC_LOOP_SHADERS.kuzey!(6));
    expect((six.rates[0]! * 6) / TAU).toBeCloseTo(1, 4);
    expect(six.rates[1]).toBe(0.5);
  });

  it('iki kopyanın karışımı: ağırlıklar ve kontrast düzeltmesi', () => {
    // gölgelendiricideki lmix ile aynı: a, b ortalaması .5 olan gürültüler, rho ilintileri
    const lmix = (a: number, b: number, z: number, w: number, rho: number): number => 0.5 + ((a - 0.5) * z + (b - 0.5) * w) / Math.sqrt(z * z + w * w + 2 * rho * z * w);
    for (const rho of [KUZEY_LOOP.edgeRho, KUZEY_LOOP.swellRho, KUZEY_LOOP.decoEdgeRho, KUZEY_LOOP.decoWidthRho, KUZEY_LOOP.decoSwellRho]) {
      expect(rho).toBeGreaterThan(0);
      expect(rho).toBeLessThan(1);
      // tek kopya görünürken değer olduğu gibi geçer
      expect(lmix(0.8, 0.1, 1, 0, rho)).toBeCloseTo(0.8, 12);
      expect(lmix(0.8, 0.1, 0, 1, rho)).toBeCloseTo(0.1, 12);
      // karışımın ortasında: ilintisi rho olan iki kopyanın ortalamasının sapması 1'e geri ölçeklenir
      const mid = Math.sqrt(0.25 + 0.25 + 2 * rho * 0.25);
      expect(lmix(0.7, 0.7, 0.5, 0.5, rho)).toBeCloseTo(0.5 + 0.2 / mid, 12);
      // düzeltme sınırlı: en çok √2 katı (ilinti 0 iken)
      expect(1 / mid).toBeLessThan(Math.SQRT2);
    }
    for (const P of [5, COSMETIC_LOOP_SECONDS, 7]) {
      const src = COSMETIC_LOOP_SHADERS.kuzey!(P);
      expect(src).toContain('float lmix(float a,float b,vec4 k,float rho){return .5+((a-.5)*k.z+(b-.5)*k.w)/sqrt(k.z*k.z+k.w*k.w+2.*rho*k.z*k.w);}');
      expect(src).toContain(`vec4 lp2(float s){return vec4((s-.5)*${P}.,(fract(s+.5)-.5)*${P}.,.5-.5*cos(TAU*s),.5+.5*cos(TAU*s));}`);
      // üç katmanın geçişleri üçte bir döngü kaydırılır
      expect(src).toContain(`vec4 L=lp2(fract(t/${P}.+fi/3.));`);
    }
  });
});
