import { describe, expect, it } from 'vitest';
import { BUZ_LOOP, buzLoopG, COSMETIC_LOOP_SECONDS, COSMETIC_LOOP_SHADERS } from '../src/cosmeticLoops';
import { COSMETIC_SHADERS } from '../src/index';

describe('kozmetik döngü biçimi: buz', () => {
  it('canlı gölgelendirici canlı zamanlamayı kullanır (döngü biçimi uygulamanın çizdiği kaynağa karışmaz)', () => {
    const live = COSMETIC_SHADERS.buz;
    expect(live).toContain('float iceG(float t){float s=mod(t,14.)/14.; if(s<.45)return 1.-pow(1.-s/.45,3.); if(s<.84)return 1.;');
    expect(live).toContain('float sweepPos=mod(t*.22,1.6)-.3;');
    expect(live).toContain('float G=iceG(t);');
    expect(live).not.toContain('fract(t/');
    expect(live).not.toContain('icePh');
  });

  it('büyüme eğrisi: boş an yok, sıçrama yok, yumuşak başlar ve biter, döngü süresinde aynen yinelenir', () => {
    // paylar döngüyü tam doldurur: erime biter bitmez büyüme başlar
    expect(BUZ_LOOP.grow + BUZ_LOOP.hold + BUZ_LOOP.melt).toBeCloseTo(1, 12);
    expect(BUZ_LOOP.floor).toBeGreaterThan(0.1);
    for (const T of [5, COSMETIC_LOOP_SECONDS, 7]) {
      expect(buzLoopG(0, T)).toBe(0);
      expect(buzLoopG(T * (BUZ_LOOP.grow + BUZ_LOOP.hold / 2), T)).toBe(1);
      const n = 180;
      let prev = buzLoopG(0, T);
      let maxStep = 0;
      for (let i = 1; i <= n; i++) {
        const t = (i / n) * T;
        const g = buzLoopG(t, T);
        expect(g).toBeGreaterThanOrEqual(0);
        expect(g).toBeLessThanOrEqual(1);
        maxStep = Math.max(maxStep, Math.abs(g - prev));
        prev = g;
        expect(buzLoopG(t + T, T)).toBeCloseTo(g, 9);
        expect(buzLoopG(t - T, T)).toBeCloseTo(g, 9);
        // evre kayması zamanı kaydırmakla aynı şey
        expect(buzLoopG(t, T, 0.25)).toBeCloseTo(buzLoopG(t - 0.25 * T, T), 9);
      }
      // 30 kare/sn'de bir karede en çok ~%2.5 değişir (eski eğri ilk karede %6 sıçrıyordu)
      expect(maxStep).toBeLessThan(0.03);
      // başlangıç ve bitiş yumuşak: sıfırın hemen yanında eğim de sıfıra yakın
      expect(buzLoopG(T / n, T)).toBeLessThan(0.005);
      expect(buzLoopG(T - T / n, T)).toBeLessThan(0.005);
    }
  });

  it('evreler kaydırılınca her an bir yer büyümüş durumda (döngü hiç "boş" görünmez)', () => {
    const T = COSMETIC_LOOP_SECONDS;
    for (let i = 0; i < 180; i++) {
      const t = (i / 180) * T;
      // plakanın üstü ile altı (evre 0 ve platePhase) ve halkanın karşılıklı iki noktası (evre 0 ve 0.5)
      expect(Math.max(buzLoopG(t, T, 0), buzLoopG(t, T, BUZ_LOOP.platePhase))).toBeGreaterThan(0.45);
      expect(Math.max(buzLoopG(t, T, 0), buzLoopG(t, T, 0.5))).toBeGreaterThan(0.45);
    }
  });

  it('döngü gölgelendiricisi: süre tek parametre, canlıdaki süreler kalmaz, gerisi canlıyla aynı', () => {
    const make = COSMETIC_LOOP_SHADERS.buz;
    expect(make).toBeDefined();
    const live = COSMETIC_SHADERS.buz.split('\n');
    for (const T of [5, 6, 7]) {
      const src = make!(T);
      expect(src).toContain(`iceL(t/${T}.-icePh(p))`);
      expect(src).not.toContain('mod(t,14.)');
      expect(src).not.toContain('mod(t*.22,1.6)');
      // kırağı hiç sıfıra inmez: kalınlık floor'dan başlar
      expect(src).toContain(`return ${BUZ_LOOP.floor}+${1 - BUZ_LOOP.floor}*iceL(`);
      // eğrinin tanımı (canlıda tek satır, döngüde üç), eğrinin çağrısı ve süpürme dışında kaynak canlıyla aynı
      const lines = src.split('\n');
      expect(lines.length).toBe(live.length + 2);
      const rest = lines.filter((l) => !/^float ice[LG]\(|^float icePh\(/.test(l));
      const liveRest = live.filter((l) => !l.startsWith('float iceG('));
      expect(rest.length).toBe(liveRest.length);
      const changed = rest.filter((line, i) => line !== liveRest[i]);
      expect(changed.length).toBe(2);
      expect(changed[0]).toContain('float sweepPos=');
      expect(changed[1]).toContain('float G=iceG(t,p);');
    }
    // 6 sn'de tek süpürme; canlıdaki hız korunarak 14 sn'de iki
    expect(make!(6)).toContain('*1.+.5)*1.6-.3');
    expect(make!(14)).toContain('*2.+.5)*1.6-.3');
  });
});
