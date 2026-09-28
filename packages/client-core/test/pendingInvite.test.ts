import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseInviteDeepLink, type InvitePreview } from '@diskort/shared';
import {
  api,
  clearPendingInvite,
  keepIfGuildInvite,
  pendingInviteNotice,
  setPendingInvite,
  takePendingInvite,
  usePendingInvite,
} from '../src';

const guildPreview = (code: string): InvitePreview => ({
  code,
  guild: { id: 'g1', name: 'Oyun Gecesi', iconUrl: null },
  memberCount: 3,
  expiresAt: null,
});

describe('parseInviteDeepLink', () => {
  it('diskort://davet/<kod> bağlantısından kodu alır', () => {
    expect(parseInviteDeepLink('diskort://davet/ab12cd34')).toBe('AB12CD34');
    expect(parseInviteDeepLink('diskort://davet/AB12CD34/')).toBe('AB12CD34');
    expect(parseInviteDeepLink('DISKORT://davet/AB12CD34?x=1')).toBe('AB12CD34');
    expect(parseInviteDeepLink('diskort:///davet/AB12CD34')).toBe('AB12CD34');
    expect(parseInviteDeepLink('  diskort://davet/AB12CD34  ')).toBe('AB12CD34');
  });

  it('telefon yönlendiricisinin verdiği yolu da tanır', () => {
    expect(parseInviteDeepLink('/davet/AB12CD34')).toBe('AB12CD34');
    expect(parseInviteDeepLink('davet/AB12CD34')).toBe('AB12CD34');
  });

  it('başka her şeyi yok sayar', () => {
    expect(parseInviteDeepLink('diskort://ayarlar')).toBeNull();
    expect(parseInviteDeepLink('diskort://davet/')).toBeNull();
    expect(parseInviteDeepLink('diskort://davet/AB')).toBeNull(); // çok kısa
    expect(parseInviteDeepLink('diskort://davet/AB12CD34/baska')).toBeNull();
    expect(parseInviteDeepLink('diskort://davet/AB-12')).toBeNull();
    expect(parseInviteDeepLink('https://diskort.ziroo.net/davet/AB12CD34')).toBeNull();
    expect(parseInviteDeepLink('javascript://davet/AB12CD34')).toBeNull();
    expect(parseInviteDeepLink('--inspect')).toBeNull();
    expect(parseInviteDeepLink('')).toBeNull();
  });
});

describe('bekleyen davet', () => {
  const preview = vi.spyOn(api, 'previewInvite');

  beforeEach(() => {
    clearPendingInvite();
    preview.mockReset();
    preview.mockRejectedValue(new Error('çevrimdışı'));
  });

  it('geçerli kodu bekletir, alınca temizler', () => {
    expect(setPendingInvite('ab12cd34', 1_000)).toBe(true);
    expect(usePendingInvite.getState().code).toBe('AB12CD34');
    expect(takePendingInvite(2_000)).toBe('AB12CD34');
    expect(usePendingInvite.getState().code).toBeNull();
    expect(takePendingInvite(2_100)).toBeNull();
  });

  it('bağlantı yapıştırılsa da kodu alır, geçersizi yok sayar', () => {
    expect(setPendingInvite('https://diskort.ziroo.net/davet/QWER1234', 1_000)).toBe(true);
    expect(usePendingInvite.getState().code).toBe('QWER1234');
    expect(setPendingInvite('?!', 1_000)).toBe(false);
    expect(usePendingInvite.getState().code).toBe('QWER1234');
  });

  it('az önce işlenen bağlantı ikinci kez açılmaz, bir süre sonra açılır', () => {
    setPendingInvite('ZXCV1234', 10_000);
    expect(takePendingInvite(10_000)).toBe('ZXCV1234');
    expect(setPendingInvite('ZXCV1234', 11_000)).toBe(false);
    expect(usePendingInvite.getState().code).toBeNull();
    expect(setPendingInvite('ZXCV1234', 20_000)).toBe(true);
    expect(usePendingInvite.getState().code).toBe('ZXCV1234');
  });

  it('sunucu adını önizlemeden alır ve notta gösterir', async () => {
    preview.mockResolvedValue(guildPreview('ASDF1234'));
    setPendingInvite('ASDF1234', 1_000);
    expect(pendingInviteNotice(usePendingInvite.getState())).toContain('ASDF1234');
    await vi.waitFor(() => expect(usePendingInvite.getState().preview).not.toBeNull());
    expect(pendingInviteNotice(usePendingInvite.getState())).toBe('Giriş yapınca "Oyun Gecesi" sunucusuna katılabileceksin.');
  });

  it('hesap davetini katılma ekranına göndermez', async () => {
    preview.mockResolvedValue({ code: 'HESAP123', guild: null, memberCount: 0, expiresAt: null });
    setPendingInvite('HESAP123', 1_000);
    await vi.waitFor(() => expect(usePendingInvite.getState().preview).not.toBeNull());
    expect(pendingInviteNotice(usePendingInvite.getState())).toContain('hesap daveti');
    expect(takePendingInvite(2_000)).toBeNull();
    expect(usePendingInvite.getState().code).toBeNull();
  });

  it('kayda yazılan sunucu davetini bekletir, hesap davetini bekletmez', async () => {
    preview.mockResolvedValueOnce(guildPreview('SNC12345'));
    expect(await keepIfGuildInvite('https://diskort.ziroo.net/davet/snc12345')).toBe(true);
    expect(usePendingInvite.getState().code).toBe('SNC12345');
    clearPendingInvite();
    preview.mockResolvedValueOnce({ code: 'HSP12345', guild: null, memberCount: 0, expiresAt: null });
    expect(await keepIfGuildInvite('HSP12345')).toBe(false);
    expect(await keepIfGuildInvite('??')).toBe(false);
    expect(usePendingInvite.getState().code).toBeNull();
  });

  it('bekleyen davet yokken not yok', () => {
    expect(pendingInviteNotice(usePendingInvite.getState())).toBeNull();
  });
});
