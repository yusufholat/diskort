import { describe, expect, it } from 'vitest';
import { COSMETIC_LOOP_SHADERS, COSMETIC_SHADERS, SAKURA_LOOP, sakuraLoopBloom, sakuraLoopShed } from '../src/index';

const PERIODS = [5, 6, 7];
const TAU = Math.PI * 2;

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

describe('kozmetik döngü biçimi: sakura', () => {
  it('canlı gölgelendirici canlı zamanlamayı kullanır (döngü biçimi uygulamanın çizdiği kaynağa karışmaz)', () => {
    const live = COSMETIC_SHADERS.sakura;
    expect(live.startsWith('\nvec3 bokeh(vec2 p,float t,float cell,float seed,float dens){\n')).toBe(true);
    expect(live).toContain('vec2 q=p/cell+vec2(seed,seed*.7)+vec2(t*.03,-t*.05);');
    expect(live).toContain('float on=step(1.-dens,r)*(.55+.45*sin(t*.6+r*40.));');
    expect(live).toContain('halo*(.26+.08*sin(t*1.3))+bokeh(p,t,14.,2.,.35)');
    expect(live).toContain('float rays=pow(.5+.5*sin(an*22.+fbm3(vec2(an*5.,t*.12))*7.),3.)*.65+.35*fbm3(vec2(an*11.,t*.09+3.));');
    expect(live).toContain('    c+=vec3(.9,.42,.6)*.1*smoothstep(u_res.y*.55,u_res.y,p.y);\n    // afişe koyu pembe');
    expect(live).toContain('bg+=vec3(.3,.1,.2)*fbm(p/60.+vec2(t*.05,0.))*.35*(1.-uv.y*.3);');
    expect(live).not.toContain('fract(t/');
    expect(live).not.toContain('skDrift');
  });

  it('döngü gölgelendiricisi: süre tek parametre, zamana bağlı her terim döngüde tam tur atar', () => {
    const make = COSMETIC_LOOP_SHADERS.sakura;
    expect(make).toBeDefined();
    for (const T of PERIODS) {
      const src = make!(T);
      const terms = timeTerms(src);
      expect(terms.other).toBe(false);
      // zaman ya döngünün evresi olarak (t/T) ya da döngüye tam sayıda sığan bir hızla geçer
      expect(terms.divisors.length).toBeGreaterThan(0);
      for (const d of terms.divisors) expect(d).toBe(T);
      expect(terms.rates.length).toBe(1);
      for (const rate of terms.rates) {
        const turns = (rate * T) / TAU;
        expect(Math.abs(turns - Math.round(turns))).toBeLessThan(1e-5);
        expect(Math.round(turns)).toBeGreaterThanOrEqual(1);
      }
      // canlıdaki süresiz terimler kalmaz
      for (const gone of ['t*.03', 't*.05', 't*.12', 't*.09', 't*.5+', 't*.4+', 't*.6+', 'sin(t*1.3)']) expect(src).not.toContain(gone);
      // kartın alt kenarına bağlı ışıma yok (standart kart tuvalinde alt kenara bir şey bağlanmaz)
      expect(src).not.toContain('smoothstep(u_res.y*.55,u_res.y,p.y)');
      // huzme ve zemin gürültüleri canlıdaki hızlarıyla süzülür
      expect(src).toContain('skDrift3(vec2(an*5.,0.),vec2(0.,.12),t)');
      expect(src).toContain('skDrift3(vec2(an*11.,3.),vec2(0.,.09),t)');
      expect(src).toContain('skDrift5(p/60.,vec2(.05,0.),t)');
      // bokeh: bir döngülük ömür, canlıdaki kayma hızı
      expect(src).toContain(`float u=fract(t/${T}.+h21(id+seed+7.7));`);
      expect(src).toContain('vec2(-.03,.05)');
      expect(src).toContain('float on=step(1.-dens,r)*sq(sin(PI*u));');
    }
    // 6 sn'de halenin nabzı tek tur (canlıda 1.3 rad/sn: 4.8 sn)
    expect(make!(6)).toContain('sin(t*1.047198)');
  });

  it('döngü gölgelendiricisi: zamana ve alt kenara bağlı satırlar dışında canlıyla aynı', () => {
    const live = COSMETIC_SHADERS.sakura.split('\n');
    const loop = new Set(COSMETIC_LOOP_SHADERS.sakura!(6).split('\n'));
    const changed = live.filter((line) => !loop.has(line));
    // bokeh'in gövdesi (yeniden yazıldı), hale, huzmeler, gövde ışıması, zemin gürültüsü
    for (const line of changed) {
      const inBokeh = /^ {2}(vec2 q=|vec2 id=|float r=|vec2 o=|float dd=|float rad=|float disc=|float on=|\/\/ doygun|return mix)/.test(line);
      const timed = /\bt\*/.test(line) || line.includes('u_res.y*.55');
      expect(inBokeh || timed, line).toBe(true);
    }
    expect(changed.length).toBeLessThanOrEqual(14);
  });

  it('açıp dökülen çiçek: döngüde bir tur, görünen her şey sürekli (bir karede belirme ya da kaybolma yok)', () => {
    const { budUntil, openFor, detachAt, detachFor } = SAKURA_LOOP;
    expect(budUntil + openFor).toBeLessThan(detachAt);
    expect(detachAt + detachFor).toBeLessThan(1);
    // tomurcuk → açık → dökülmüş
    const start = sakuraLoopBloom(0);
    expect(start.open).toBeCloseTo(0, 12);
    expect(start.flower).toBe(0);
    expect(start.bud).toBe(1);
    const mid = sakuraLoopBloom((budUntil + openFor + detachAt) / 2);
    expect(mid.open).toBeCloseTo(1, 9);
    expect(mid.flower).toBe(1);
    expect(mid.bud).toBe(0);
    const end = sakuraLoopBloom(0.97);
    expect(end.flower).toBe(0);
    expect(end.bud).toBe(1);
    // 30 kare/sn'de en kısa döngü (5 sn) 150 kare: kare başına değişim küçük kalmalı
    const N = 150;
    let prev = sakuraLoopBloom(-1 / N);
    for (let i = 0; i <= N; i++) {
      const s = i / N;
      const st = sakuraLoopBloom(s);
      expect(st.flower).toBeGreaterThanOrEqual(0);
      expect(st.flower).toBeLessThanOrEqual(1);
      expect(st.bud).toBeGreaterThanOrEqual(0);
      expect(st.bud).toBeLessThanOrEqual(1);
      expect(Math.abs(st.flower - prev.flower)).toBeLessThan(0.3);
      expect(Math.abs(st.bud - prev.bud)).toBeLessThan(0.2);
      // çiçeğin ekrandaki büyüklüğü: görünürken açıklık sıçramaz
      expect(Math.abs(st.flower * st.open - prev.flower * prev.open)).toBeLessThan(0.3);
      // döngüsel
      const again = sakuraLoopBloom(s + 1);
      expect(again.open).toBeCloseTo(st.open, 9);
      expect(again.flower).toBeCloseTo(st.flower, 9);
      expect(again.bud).toBeCloseTo(st.bud, 9);
      prev = st;
    }
    // çiçek belirirken küçüktür (tomurcuğun içinden açar), tam görünür olduğunda açılmaya devam eder
    expect(sakuraLoopBloom(budUntil + 0.004).flower).toBeLessThan(0.05);
    expect(sakuraLoopBloom(budUntil + 0.05).open).toBeLessThan(0.7);
  });

  it('kopan yaprak: çiçeğin üstünde belirir, süzülürken söner; görünmezken başa döner', () => {
    expect(sakuraLoopShed(0)).toBe(0);
    expect(sakuraLoopShed(0.3)).toBe(1);
    expect(sakuraLoopShed(0.95)).toBe(0);
    expect(sakuraLoopShed(0.999)).toBe(0);
    const N = 150;
    let prev = sakuraLoopShed(-1 / N);
    for (let i = 0; i <= N; i++) {
      const a = sakuraLoopShed(i / N);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(1);
      expect(Math.abs(a - prev)).toBeLessThan(0.25);
      expect(sakuraLoopShed(i / N + 1)).toBeCloseTo(a, 9);
      prev = a;
    }
    // çiçek sönerken yapraklar belirmiş olur (arada boş kare kalmaz)
    expect(sakuraLoopShed(0.05)).toBe(1);
    expect(sakuraLoopBloom(SAKURA_LOOP.detachAt + 0.05).flower).toBeGreaterThan(0);
  });
});
