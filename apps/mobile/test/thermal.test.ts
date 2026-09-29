// Telefonun ısı durumu (src/voice/thermal.ts): Android'in sayıları adlara çevrilir, ısınma payı yuvarlanır;
// eski APK'da (yerel işlev yok), Android 10 öncesinde ya da okuma hata verirse alanlar null olur.

import { describe, expect, it } from 'vitest';
import { readThermal, thermalHeadroom, thermalName } from '../src/voice/thermal';

describe('ısı durumu', () => {
  it('Android THERMAL_STATUS_* sayıları adlara çevrilir', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(thermalName)).toEqual([
      'none',
      'light',
      'moderate',
      'severe',
      'critical',
      'emergency',
      'shutdown',
    ]);
    // -1: Android 10 öncesi; tanınmayan ya da geçersiz değerler
    expect(thermalName(-1)).toBeNull();
    expect(thermalName(7)).toBeNull();
    expect(thermalName(2.5)).toBeNull();
    expect(thermalName(null)).toBeNull();
    expect(thermalName(undefined)).toBeNull();
  });

  it('ısınma payı iki basamağa yuvarlanır; NaN ve negatif null', () => {
    expect(thermalHeadroom(0.8249)).toBe(0.82);
    expect(thermalHeadroom(1.006)).toBe(1.01);
    expect(thermalHeadroom(0)).toBe(0);
    expect(thermalHeadroom(Number.NaN)).toBeNull();
    expect(thermalHeadroom(-1)).toBeNull();
    expect(thermalHeadroom(null)).toBeNull();
  });

  it('yerel işlev yoksa ya da hata verirse alanlar null (fırlatmaz)', () => {
    expect(readThermal(undefined)).toEqual({ thermal: null, thermalHeadroom: null });
    expect(
      readThermal(() => {
        throw new Error('yok');
      }),
    ).toEqual({ thermal: null, thermalHeadroom: null });
    expect(readThermal(() => ({ status: 3, headroom: 1.004 }))).toEqual({ thermal: 'severe', thermalHeadroom: 1 });
    expect(readThermal(() => ({ status: -1, headroom: null }))).toEqual({ thermal: null, thermalHeadroom: null });
  });
});
