import { describe, expect, it } from 'vitest';
import { COSMETIC_SHADER_COMMON, COSMETIC_SHADER_MAIN, cosmeticShaderCommon } from '../src/cosmeticShaders';
import { isWhole, sha256, timeTerms } from './cosmeticLoop.timeTerms';

const TAU = Math.PI * 2;

describe('ortak kısmın döngü biçimi (yıldız parıltısı)', () => {
  it('canlı metinler döngü çalışmasından önceki hâliyle harfi harfine aynı', async () => {
    // Uygulamanın (masaüstü ve telefon) derlediği metinler. Canlı gölgelendirici bilerek değiştirilirse bu
    // özetler de güncellenir; döngü biçimi üzerinde çalışırken değişmemeleri gerekir.
    expect(await sha256(COSMETIC_SHADER_COMMON)).toBe('a469fb8be15b437d55ce039da99a3dc3a88bb567a0cec90cc4b07dda932eef7a');
    expect(await sha256(COSMETIC_SHADER_MAIN)).toBe('804615bdd118ee5ec5c546962634b8245951b2048a444afe609dfb4e7cf0e796');
    expect(COSMETIC_SHADER_COMMON).toContain('float tw=.6+.4*sin(t*(.8+2.6*h21(id+9.1))+r*50.);');
  });

  it('döngü biçimi canlıdan yalnızca parıltı satırında ayrılır (5, 6, 7 sn)', () => {
    const live = COSMETIC_SHADER_COMMON.split('\n');
    for (const P of [5, 6, 7]) {
      const loop = cosmeticShaderCommon(P).split('\n');
      expect(loop.length).toBe(live.length);
      const changed = loop.filter((line, i) => line !== live[i]);
      expect(changed.length).toBe(1);
      expect(changed[0]).toContain('float tw=.6+.4*sin(t*max(1.,floor(');
      expect(cosmeticShaderCommon(P)).not.toContain('sin(t*(.8+2.6*');
    }
    expect(() => cosmeticShaderCommon(0)).toThrow();
    expect(() => cosmeticShaderCommon(Number.NaN)).toThrow();
  });

  it('her yıldızın parıltısı döngüye tam sayıda sığar (en az bir tur), canlıdaki hıza en yakın olanla', () => {
    for (const P of [5, 6, 7]) {
      const terms = timeTerms(cosmeticShaderCommon(P));
      expect(terms.other).toEqual([]);
      expect(terms.rates).toEqual([]);
      expect(terms.rounded.length).toBe(1);
      const [perRate, perTurn] = terms.rounded[0]!;
      // tur sayısı = canlı hız × P / 2π (yuvarlanır); hız = tur × 2π / P
      expect(perRate).toBeCloseTo(P / TAU, 5);
      expect(perTurn).toBeCloseTo(TAU / P, 5);
      for (let i = 0; i <= 100; i++) {
        const live = 0.8 + 2.6 * (i / 100);
        const turns = Math.max(1, Math.floor(live * perRate + 0.5));
        const rate = turns * perTurn;
        expect(turns).toBeGreaterThanOrEqual(1);
        expect(isWhole((rate * P) / TAU)).toBe(true);
        // canlı hıza en yakın tam tur (yarım turdan fazla sapmaz; tek tura yuvarlanan en yavaşlar dışında)
        expect(Math.abs(turns - (live * P) / TAU)).toBeLessThanOrEqual(0.5 + 1e-6);
        // t = 0 ile t = P aynı parlaklık (kesirli sabitlerin yuvarlanması dahil)
        expect(Math.sin(P * rate + 1.3)).toBeCloseTo(Math.sin(1.3), 4);
      }
    }
  });
});
