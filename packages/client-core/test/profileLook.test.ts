import { describe, expect, it } from 'vitest';
import {
  animatedDecorationSet,
  ANIMATED_DECORATIONS,
  COSMETIC_ID,
  COSMETIC_SETS,
  LEGACY_PROFILE_EFFECTS,
  PROFILE_EFFECTS,
  userProfileEffect,
  type ProfileEffect,
} from '@diskort/shared';
import { effectParticles } from '../src';

describe('profil efektleri ve hareketli setler', () => {
  it('eski efektlerin parçacıkları var; set efekti ve tanınmayan kimlik boş liste verir, çökmez', () => {
    for (const effect of LEGACY_PROFILE_EFFECTS) expect(effectParticles(effect).length).toBeGreaterThan(0);
    for (const set of COSMETIC_SETS) expect(effectParticles(set)).toEqual([]);
    expect(effectParticles('gelecekteki-efekt' as ProfileEffect)).toEqual([]);
  });

  it('efektler eski üç efekti ve altı seti içerir', () => {
    expect(PROFILE_EFFECTS).toEqual([...LEGACY_PROFILE_EFFECTS, ...COSMETIC_SETS]);
  });

  it('kartın efekti: set efekti önce gelir, bilinmeyenler yok sayılır', () => {
    expect(userProfileEffect({ profileEffect: 'snow', animatedEffect: null })).toBe('snow');
    expect(userProfileEffect({ profileEffect: null, animatedEffect: 'neon' })).toBe('neon');
    expect(userProfileEffect({})).toBeNull();
    expect(userProfileEffect({ profileEffect: 'yok' as never, animatedEffect: 'yok' as never })).toBeNull();
  });

  it('hareketli dekorasyon kimlikleri katalog kimlikleriyle çakışmaz', () => {
    expect(ANIMATED_DECORATIONS).toEqual(COSMETIC_SETS.map((s) => `anim:${s}`));
    for (const id of ANIMATED_DECORATIONS) expect(COSMETIC_ID.test(id)).toBe(false);
    expect(animatedDecorationSet('anim:karadelik')).toBe('karadelik');
    expect(animatedDecorationSet('anim:olmayan')).toBeNull();
    expect(animatedDecorationSet('karadelik')).toBeNull();
    expect(animatedDecorationSet(null)).toBeNull();
  });
});
