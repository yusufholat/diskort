import { describe, expect, it } from 'vitest';
import { COSMETIC_LOOP_SECONDS, COSMETIC_LOOP_SHADERS, COSMETIC_SHADERS, KARADELIK_LOOP } from '../src/cosmeticShaders';
import { isWhole, sha256, timeTerms } from './cosmeticLoop.timeTerms';

const TAU = Math.PI * 2;

/** Canlıda zamana bağlı satırlar (döngü biçiminde yerlerine başkaları gelir) */
const LIVE_TIME_LINES = [
  '    vec2 sp=src+vec2(t*3.,t*.8);',
  '    col=stars(sp,t)*mag;',
  '    col+=vec3(.16,.07,.24)*sq(fbm(sp/110.))*1.6+vec3(.03,.07,.15)*fbm(sp/48.+7.);',
  '  float a=ang+t*om;',
  '  float nz=fbm(vec2(rd/RS*5.5,0.)+2.*vec2(cos(a),sin(a)));',
  '  float a2=atan(n.y,n.x)+t*1.3;',
];

describe('karadelik döngü biçimi', () => {
  it('canlı gölgelendirici döngü çalışmasından önceki hâliyle harfi harfine aynı', async () => {
    // Canlı gölgelendirici bilerek değiştirilirse bu özet de güncellenir
    expect(await sha256(COSMETIC_SHADERS.karadelik)).toBe('376b484564789bc8e03833c1c3d102f4bd9733c453184981ca2b278a9b3f158f');
    for (const line of LIVE_TIME_LINES) expect(COSMETIC_SHADERS.karadelik.split('\n')).toContain(line);
    expect(COSMETIC_SHADERS.karadelik).not.toContain('fract(t/');
    expect(COSMETIC_SHADERS.karadelik).not.toContain('starsL');
    // sınıflandırıcı canlıdaki terimleri görüyor: döngüye sığmayan hızlar ve yarıçapla değişen dönüş (t*om)
    const terms = timeTerms(COSMETIC_SHADERS.karadelik);
    expect(terms.rates).toEqual([3, 0.8, 1.3]);
    expect(terms.other.length).toBe(1);
    expect(terms.other[0]).toContain('ang+t*om');
    expect(terms.fractions).toEqual([]);
  });

  it('süre tek parametre; canlıdaki sonsuz kaymalar kalmaz, gerisi canlıyla aynı (5, 6, 7 sn)', () => {
    const make = COSMETIC_LOOP_SHADERS.karadelik;
    expect(make).toBeDefined();
    const live = COSMETIC_SHADERS.karadelik.split('\n');
    for (const P of [5, COSMETIC_LOOP_SECONDS, 7]) {
      const src = make!(P);
      const lines = src.split('\n');
      // canlının zamana bağlı olmayan her satırı döngüde de var, aynı sırayla
      const kept = live.filter((line) => !LIVE_TIME_LINES.includes(line));
      expect(kept.length).toBe(live.length - LIVE_TIME_LINES.length);
      let at = -1;
      for (const line of kept) {
        const next = lines.indexOf(line, at + 1);
        expect(next, line).toBeGreaterThan(at);
        at = next;
      }
      for (const line of LIVE_TIME_LINES) expect(lines).not.toContain(line);
      expect(src).not.toContain('t*3.');
      expect(src).not.toContain('ang+t*om');
      expect(src).not.toContain('stars(');
    }
  });

  it('zaman yalnızca döngüye sığan biçimlerde geçer', () => {
    for (const P of [5, COSMETIC_LOOP_SECONDS, 7]) {
      const terms = timeTerms(COSMETIC_LOOP_SHADERS.karadelik!(P));
      expect(terms.other).toEqual([]);
      // döngünün kesri: yıldızın ömrü, bulutsunun ve diskin iki kopyası
      expect(terms.fractions).toEqual([P, P, P]);
      // sabit hız: yalnızca yayın dönüşü, döngüde tam tur (canlıda saniyede 1.3 radyan → 5-7 sn'de bir tur)
      expect(terms.rates.length).toBe(1);
      expect((terms.rates[0]! * P) / TAU).toBeCloseTo(1, 4);
      // yıldız parıltısı: yıldız başına tam tura yuvarlanır
      expect(terms.rounded.length).toBe(1);
      expect(terms.rounded[0]![0]).toBeCloseTo(P / TAU, 5);
      expect(terms.rounded[0]![1]).toBeCloseTo(TAU / P, 5);
      expect(isWhole((terms.rounded[0]![1] * P) / TAU)).toBe(true);
    }
  });

  it('iki kopyanın zamanı ve ağırlığı: kopya yalnızca ağırlığı sıfırken başa döner, ağırlıkların toplamı 1', () => {
    // gölgelendiricideki lp2(s) ile aynı
    const lp2 = (s: number, P: number): [number, number, number, number] => {
      const f = (x: number): number => x - Math.floor(x);
      return [(s - 0.5) * P, (f(s + 0.5) - 0.5) * P, 0.5 - 0.5 * Math.cos(TAU * s), 0.5 + 0.5 * Math.cos(TAU * s)];
    };
    for (const P of [5, COSMETIC_LOOP_SECONDS, 7]) {
      expect(COSMETIC_LOOP_SHADERS.karadelik!(P)).toContain(
        `vec4 lp2(float s){return vec4((s-.5)*${P}.,(fract(s+.5)-.5)*${P}.,.5-.5*cos(TAU*s),.5+.5*cos(TAU*s));}`,
      );
      const N = 2000;
      let prev = lp2(0, P);
      for (let i = 1; i <= N; i++) {
        const cur = lp2((i % N) / N, P);
        expect(cur[2] + cur[3]).toBeCloseTo(1, 12);
        // kopyanın görünür katkısı (ağırlık × zaman) sürekli: zaman sıçrarken ağırlık sıfır
        expect(Math.abs(cur[0] * cur[2] - prev[0] * prev[2])).toBeLessThan(0.02);
        expect(Math.abs(cur[1] * cur[3] - prev[1] * prev[3])).toBeLessThan(0.02);
        expect(Math.abs(cur[2] - prev[2])).toBeLessThan(0.01);
        prev = cur;
      }
      // her kopya ömrü boyunca tam bir döngü süresi kadar ilerler (-P/2 → P/2)
      expect(lp2(0, P)[0]).toBeCloseTo(-P / 2, 12);
      expect(lp2(0.5, P)[1]).toBeCloseTo(-P / 2, 12);
    }
  });

  it('ayarlar: disk hep aynı yönde sarılı, yıldızın yanıp sönme payları ömre sığar', () => {
    expect(KARADELIK_LOOP.windFrom).toBeGreaterThan(0);
    expect(KARADELIK_LOOP.starFade).toBeGreaterThan(0);
    expect(KARADELIK_LOOP.starFade).toBeLessThan(0.5);
    // yıldız bir ömürde canlıdaki hızla kayar: komşu hücreden uzağa taşmaz (en küçük hücre 11 px, 3×3 komşuluk)
    for (const P of [5, COSMETIC_LOOP_SECONDS, 7]) {
      const half = (Math.hypot(KARADELIK_LOOP.drift[0], KARADELIK_LOOP.drift[1]) * P) / 2;
      expect(0.8 * 11 + half).toBeLessThan(2 * 11);
      expect(0.2 * 11 - half).toBeGreaterThan(-11);
    }
  });
});
