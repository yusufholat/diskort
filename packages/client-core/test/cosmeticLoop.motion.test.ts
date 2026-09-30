import { describe, expect, it } from 'vitest';
import { loopPhase, loopTrackPhase, loopWindow } from '../src/index';
import { loopDriftGlsl } from '../src/cosmeticShaders/loopMotion';

const PERIODS = [5, 6, 7];

describe('kozmetik döngü biçimi: hareket yardımcıları', () => {
  it('döngü evresi [0,1) aralığında, döngü süresinde yinelenir', () => {
    for (const T of PERIODS) {
      for (const off of [0, 0.13, 0.87]) {
        for (let i = 0; i <= 200; i++) {
          const t = (i / 200) * T * 2 - T * 0.5;
          const u = loopPhase(t, T, off);
          expect(u).toBeGreaterThanOrEqual(0);
          expect(u).toBeLessThan(1);
          const d = Math.abs(loopPhase(t + T, T, off) - u);
          expect(Math.min(d, 1 - d)).toBeLessThan(1e-9);
        }
      }
      expect(loopPhase(T / 4, T)).toBeCloseTo(0.25, 12);
    }
  });

  it('ray: bir döngü sonra her parçacık bir öndekinin yerinde (kare aynı), parçacıklar hızlanmaz', () => {
    const near = (a: number, b: number): boolean => {
      const d = Math.abs(a - b);
      return Math.min(d, 1 - d) < 1e-9;
    };
    for (const T of PERIODS) {
      for (const span of [1, 2, 3, 4, 5]) {
        for (const off of [0, 0.31, 0.77]) {
          for (let i = 0; i < 60; i++) {
            const t = (i / 60) * T * span;
            const now = Array.from({ length: span }, (_, j) => loopTrackPhase(t, T, span, j, off));
            const later = Array.from({ length: span }, (_, j) => loopTrackPhase(t + T, T, span, j, off));
            for (const u of now) {
              expect(u).toBeGreaterThanOrEqual(0);
              expect(u).toBeLessThan(1);
            }
            // j'inci parçacık bir döngü sonra (j+1)'incinin yerinde
            for (let j = 0; j < span; j++) expect(near(later[j]!, now[(j + 1) % span]!)).toBe(true);
            // parçacıklar yola eşit aralıklarla dizilir
            for (let j = 1; j < span; j++) expect(near(now[j]!, now[0]! + j / span)).toBe(true);
            // yol span döngüde geçilir: bir döngüde yolun 1/span'ı
            const moved = loopTrackPhase(t + T / 10, T, span, 0, off) - now[0]!;
            expect(near(moved, 1 / (10 * span))).toBe(true);
          }
        }
      }
    }
  });

  it('pencere: iki ucu 0, ortası 1; eşit aralıklı kopyalarda toplam ve kareler toplamı sabit (kontrast değişmez)', () => {
    expect(loopWindow(0)).toBe(0);
    expect(loopWindow(0.5)).toBeCloseTo(1, 12);
    expect(loopWindow(1)).toBeCloseTo(0, 12);
    // uçlarda eğim de 0: parçacık görünmezken başa döner, belirişi ani olmaz
    expect(loopWindow(0.01)).toBeLessThan(0.001);
    for (const n of [3, 4, 5]) {
      for (let i = 0; i < 50; i++) {
        const u = i / 50;
        let sum = 0;
        let squares = 0;
        for (let k = 0; k < n; k++) {
          const w = loopWindow((u + k / n) % 1);
          sum += w;
          squares += w * w;
        }
        expect(sum).toBeCloseTo(n / 2, 9);
        expect(squares).toBeCloseTo((3 * n) / 8, 9);
      }
    }
  });

  it('süzülen gürültü: süre tek parametre, kopyalar eşit aralıklı, kontrast payı kopya sayısına göre', () => {
    for (const T of PERIODS) {
      const src = loopDriftGlsl('drift', 'fbm3', T);
      expect(src).toContain('float drift(vec2 q,vec2 v,float t){');
      expect(src).toContain(`fract(t/${T}.+fk/3.)`);
      expect(src).toContain(`v*((u-.5)*${T}.)`);
      expect(src).toContain('for(int k=0;k<3;k++)');
      expect(src).toContain('sq(sin(PI*u))*(fbm3(');
      expect(src).toContain('return .5+s/1.06066;');
      // zaman yalnızca döngünün evresi olarak kullanılır
      expect(src.match(/\bt\b/g)?.length).toBe(2);
    }
    expect(loopDriftGlsl('d4', 'fbm', 6, 4)).toContain('fract(t/6.+fk/4.)');
    expect(loopDriftGlsl('d4', 'fbm', 6, 4)).toContain('return .5+s/1.224745;');
    // iki kopyada kareler toplamı sabit kalmaz (döngünün ortasında desen solar)
    expect(() => loopDriftGlsl('d2', 'fbm3', 6, 2)).toThrow();
  });
});
