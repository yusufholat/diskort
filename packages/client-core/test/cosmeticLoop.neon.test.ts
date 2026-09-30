import { describe, expect, it } from 'vitest';
import { COSMETIC_LOOP_SHADERS } from '../src/cosmeticLoops';
import { COSMETIC_SHADERS } from '../src/index';
import { neonLoopShader } from '../src/cosmeticLoops/neon';

/** Canlı kaynaktaki zamana bağlı terimler (hepsi döngü biçiminde değişmiş olmalı) */
const LIVE_TERMS = [
  'h21(vec2(floor(t*13.),fi))',
  'fract(q.y-t*spd*(.75+.5*r)+r2*10.)',
  'float ph=fract(t*.7+r);',
  'sin(an+t*.8)',
  'sin(an*2.-t*.6)',
  'h21(vec2(floor(t*9.),1.))',
  'fract(an/TAU*8.+t*.04)',
  'sin(p.y*.8+t*3.)',
  'sin(p.x*.02-t*1.5)',
  'h21(vec2(floor(t*12.),4.))',
];

describe('kozmetik döngü biçimi: neon', () => {
  it('canlı gölgelendirici canlı zamanlamayı ve kartın eski dalını kullanır (döngü biçimi karışmaz)', () => {
    const live = COSMETIC_SHADERS.neon;
    for (const term of LIVE_TERMS) expect(live).toContain(term);
    expect(live).toContain('float fl=.72+.28*step(.07,');
    expect(live).toContain('float fl=1.-.55*step(.94,');
    expect(live).toContain('float fl=.8+.2*step(.1,');
    // kartın dibindeki su halkaları ve pembe parıltı canlıda duruyor
    expect(live).toContain('float bz=smoothstep(u_res.y-46.,u_res.y,p.y);');
    expect(live).toContain('return vec4(c*mix(.3,1.,hole),bm*.35*hole);');
    expect(live).not.toContain('fract(t/');
  });

  it('döngü gölgelendiricisi: canlıdaki hiçbir zaman terimi kalmaz, süre tek parametre', () => {
    expect(COSMETIC_LOOP_SHADERS.neon).toBe(neonLoopShader);
    for (const T of [5, 6, 7]) {
      const src = neonLoopShader(T);
      for (const term of LIVE_TERMS) expect(src).not.toContain(term);
      // zaman yalnızca döngüye bölünerek ya da döngüye yuvarlanmış hızlarla geçer
      const timeUses = src.match(/\bt[*/][^,;)]*/g) ?? [];
      expect(timeUses.length).toBeGreaterThan(8);
      for (const use of timeUses) {
        if (use.startsWith(`t/${T}.`)) continue;
        const rate = Number(/^t\*([\d.]+)/.exec(use)?.[1]);
        expect(Number.isFinite(rate), use).toBe(true);
        // açısal hız: döngüde tam tur; kesik çizgi kayması (birimi 1): döngüde tam adım
        const turns = (rate * T) / (Math.PI * 2);
        const steps = rate * T;
        expect(Math.min(Math.abs(turns - Math.round(turns)), Math.abs(steps - Math.round(steps))), use).toBeLessThan(1e-4);
      }
    }
  });

  it('titreme adımları döngüye tam sığar ve adım numarası döngü içinde sayılır (6 sn: 78, 72, 54)', () => {
    const src = neonLoopShader(6);
    expect(src).toContain('h21(vec2(mod(floor(fract(t/6.)*78.+.001),78.),fi))');
    expect(src).toContain('h21(vec2(mod(floor(fract(t/6.)*72.+.001),72.),4.))');
    expect(src).toContain('h21(vec2(mod(floor(fract(t/6.)*54.+.001),54.),1.))');
    // yağmur: sütun hızı döngüde tam tura yuvarlanır; su halkaları: döngüde dört halka
    expect(src).toContain('fract(q.y-t/6.*max(1.,floor(spd*(.75+.5*r)*6.+.5))+r2*10.)');
    expect(src).toContain('float ph=fract(t/6.*4.+r);');
  });

  it('kart standart tuvale göre: alt kenara bağlı hiçbir şey yok, su halkaları afişin ıslak zemininde', () => {
    const src = neonLoopShader(6);
    const card = src.slice(src.lastIndexOf('float bh=u_a.x;'));
    expect(card).not.toContain('u_res.y-46.');
    expect(card).not.toContain('bz');
    expect(card).toContain('ripples(');
    expect(card).toContain('float hy=.56;');
  });

  it('titreme kapatılabilir (kesintisizlik denetimi için): adımlar kaynakta kalır ama gücü sıfırdır', () => {
    const off = neonLoopShader(6, { flicker: false });
    expect(off).toContain('float fl=(1.-0.)+0.*step(.07,');
    expect(off).toContain('float fl=1.-0.*step(.94,');
    expect(off).toContain('float fl=(1.-0.)+0.*step(.1,');
    expect(off).toContain('float fl=1.;');
    const on = neonLoopShader(6);
    expect(on).toContain('float fl=.72+.28*step(.07,');
    expect(on).toContain('float fl=1.-.55*step(.94,');
    expect(on).toContain('float fl=.8+.2*step(.1,');
  });
});
