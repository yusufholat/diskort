import { describe, expect, it } from 'vitest';
import { AVATAR_COLORS } from '@diskort/shared';
import { avatarInk } from '../src/profileLook';

describe('avatarInk', () => {
  it('hazır avatar renklerinde yazı beyaz kalır', () => {
    for (const color of AVATAR_COLORS) expect(avatarInk(color)).toBe('#ffffff');
  });

  it('açık zeminde koyu, koyu zeminde beyaz yazı', () => {
    expect(avatarInk('#ffffff')).toBe('#1e1f22');
    expect(avatarInk('#fde68a')).toBe('#1e1f22');
    expect(avatarInk('#0f172a')).toBe('#ffffff');
    expect(avatarInk('#5C0F0F')).toBe('#ffffff');
  });

  it('renk yoksa ya da tanınmıyorsa beyaz', () => {
    expect(avatarInk(undefined)).toBe('#ffffff');
    expect(avatarInk('linear-gradient(red, blue)')).toBe('#ffffff');
  });
});
