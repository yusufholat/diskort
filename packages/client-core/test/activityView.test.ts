import { describe, expect, it } from 'vitest';
import type { Activity, CustomStatus } from '@diskort/shared';
import { activityLabel, activityTitle, formatElapsed, sublineActivity } from '../src/activityView';

const game: Activity = { type: 'game', name: 'Satranç', icon: null, startedAt: 1_000 };
const custom: CustomStatus = { text: 'Molada', emoji: '☕' };

describe('etkinlik gösterimi', () => {
  it('geçen süre: dakika:saniye, bir saati geçince saat:dakika:saniye', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(28_000)).toBe('0:28');
    expect(formatElapsed(255_900)).toBe('4:15');
    expect(formatElapsed(3_599_000)).toBe('59:59');
    expect(formatElapsed(3_855_000)).toBe('1:04:15');
    expect(formatElapsed(36_000_000)).toBe('10:00:00');
  });

  it('saat farkından (sunucu saati ileride) eksiye düşmez', () => {
    expect(formatElapsed(-5_000)).toBe('0:00');
  });

  it('başlık türden gelir', () => {
    expect(activityTitle(game)).toBe('Oynuyor');
    expect(activityLabel(game)).toBe('Oynuyor: Satranç');
  });

  it('adın altındaki satırda özel durum önceliklidir', () => {
    expect(sublineActivity(null, game)).toBe(game);
    expect(sublineActivity(undefined, game)).toBe(game);
    expect(sublineActivity(custom, game)).toBeNull();
    expect(sublineActivity(custom, null)).toBeNull();
    expect(sublineActivity(null, null)).toBeNull();
    expect(sublineActivity(null, undefined)).toBeNull();
  });
});
