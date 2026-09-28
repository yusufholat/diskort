import { describe, expect, it } from 'vitest';
import { animatedDecorationSet, ANIMATED_DECORATIONS, COSMETIC_SETS, PROFILE_EFFECTS, userProfileEffect } from '@diskort/shared';

describe('profil efektleri ve hareketli setler', () => {
  it('efektler yalnızca altı set', () => {
    expect(PROFILE_EFFECTS).toEqual(COSMETIC_SETS);
  });

  it('kartın efekti animatedEffect\'ten okunur; bilinmeyenler ve eski alan yok sayılır', () => {
    expect(userProfileEffect({ animatedEffect: 'neon' })).toBe('neon');
    expect(userProfileEffect({ animatedEffect: null })).toBeNull();
    expect(userProfileEffect({})).toBeNull();
    expect(userProfileEffect({ animatedEffect: 'yok' as never })).toBeNull();
    expect(userProfileEffect({ profileEffect: 'snow', animatedEffect: null } as never)).toBeNull();
  });

  it('hareketli dekorasyon kimlikleri: anim:<set>; başka kimlikler set değildir', () => {
    expect(ANIMATED_DECORATIONS).toEqual(COSMETIC_SETS.map((s) => `anim:${s}`));
    expect(animatedDecorationSet('anim:karadelik')).toBe('karadelik');
    expect(animatedDecorationSet('anim:olmayan')).toBeNull();
    expect(animatedDecorationSet('karadelik')).toBeNull();
    expect(animatedDecorationSet('crown')).toBeNull();
    expect(animatedDecorationSet(null)).toBeNull();
  });
});
