import { describe, expect, it } from 'vitest';
import type { Activity, CustomStatus } from '@diskort/shared';
import { activityLabel, activityTitle, customStatusText, formatElapsed, presenceSubline, voiceLabel } from '../src/activityView';

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

  it('adın altındaki satır: simgeler durumdan, yazı önceliğe göre (özel durum, oyun, ses)', () => {
    // Hiçbir şey yok: simge de yazı da yok (yerin kendi yazısı kalır, ör. @kullanıcı adı)
    expect(presenceSubline({ custom: null, activity: null })).toEqual({ showGame: false, showVoice: false, text: null });
    expect(presenceSubline({ custom: undefined, activity: undefined, inVoice: false })).toEqual({
      showGame: false,
      showVoice: false,
      text: null,
    });
    // Yalnızca oynuyor: oyun simgesi ve oyunun adı
    expect(presenceSubline({ custom: null, activity: game })).toEqual({ showGame: true, showVoice: false, text: 'activity' });
    // Oynuyor ve özel durumu var: oyun simgesi, yazıda özel durum
    expect(presenceSubline({ custom, activity: game })).toEqual({ showGame: true, showVoice: false, text: 'custom' });
    // Yalnızca seste
    expect(presenceSubline({ custom: null, activity: null, inVoice: true })).toEqual({
      showGame: false,
      showVoice: true,
      text: 'voice',
    });
    // Seste ve özel durumu var: ses simgesi, yazıda özel durum
    expect(presenceSubline({ custom, activity: null, inVoice: true })).toEqual({ showGame: false, showVoice: true, text: 'custom' });
    // Seste oynuyor: iki simge, yazıda oyunun adı
    expect(presenceSubline({ custom: null, activity: game, inVoice: true })).toEqual({
      showGame: true,
      showVoice: true,
      text: 'activity',
    });
    // Üçü birden: iki simge, yazıda özel durum
    expect(presenceSubline({ custom, activity: game, inVoice: true })).toEqual({ showGame: true, showVoice: true, text: 'custom' });
    // Yalnızca özel durum: simge yok
    expect(presenceSubline({ custom, activity: null })).toEqual({ showGame: false, showVoice: false, text: 'custom' });
  });

  it('özel durumun yazısı ve ses simgesinin ipucu', () => {
    expect(customStatusText(custom)).toBe('☕ Molada');
    expect(customStatusText({ text: 'Molada', emoji: null })).toBe('Molada');
    expect(customStatusText({ text: null, emoji: '☕' })).toBe('☕');
    expect(voiceLabel('Genel')).toBe('Sesli sohbette: Genel');
    expect(voiceLabel(null)).toBe('Sesli sohbette');
    expect(voiceLabel()).toBe('Sesli sohbette');
  });
});
