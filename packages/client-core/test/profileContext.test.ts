import { describe, expect, it } from 'vitest';
import type { DmChannel, Role } from '@diskort/shared';
import {
  activeGuildContext,
  canMessageIn,
  channelMemberColorOf,
  contextOfChannel,
  DM_CONTEXT,
  memberColorIn,
  showsGuildInfo,
  type MemberUser,
} from '../src';

const dm = (id: string, participantIds: string[], group = participantIds.length > 2): DmChannel => ({
  id,
  participantIds,
  group,
  name: null,
  ownerId: null,
  createdAt: 1,
  lastMessageId: null,
  lastActivityAt: 1,
});

const role = (id: string, position: number, color: string | null): Role => ({
  id,
  name: id,
  color,
  position,
  hoist: false,
  permissions: 0,
});

const user = (id: string, roles: string[]): MemberUser => ({
  id,
  username: id,
  displayName: id,
  avatarColor: '#000000',
  isAdmin: false,
  roles,
  removed: false,
});

// Seçili sunucu g1; ali orada "kırmızı" rolde. d1: ben–ali bire bir, d2: grup
const state = {
  activeGuildId: 'g1',
  guild: { id: 'g1', name: 'Sunucu', ownerId: 'ben' },
  roles: { g1: role('g1', 0, null), kirmizi: role('kirmizi', 2, '#ff0000') },
  users: { ben: user('ben', []), ali: user('ali', ['kirmizi']), veli: user('veli', []) },
  dms: { d1: dm('d1', ['ben', 'ali']), d2: dm('d2', ['ben', 'ali', 'veli']) },
  channelGuild: { genel: 'g1', baska: 'g2' },
  reachable: { ali: true, ben: true } as Record<string, true>,
};

describe('profil bağlamı', () => {
  it('kanalın bağlamı: DM → dm, sunucu kanalı → o sunucu, bilinmeyen → dm', () => {
    expect(contextOfChannel(state, 'd1')).toEqual({ kind: 'dm', channelId: 'd1' });
    expect(contextOfChannel(state, 'genel')).toEqual({ kind: 'guild', guildId: 'g1' });
    expect(contextOfChannel(state, 'baska')).toEqual({ kind: 'guild', guildId: 'g2' });
    expect(contextOfChannel(state, 'kapali-dm')).toEqual({ kind: 'dm', channelId: 'kapali-dm' });
    expect(contextOfChannel(state, null)).toEqual(DM_CONTEXT);
  });

  it('seçili sunucunun bağlamı; sunucu yoksa dm', () => {
    expect(activeGuildContext(state)).toEqual({ kind: 'guild', guildId: 'g1' });
    expect(activeGuildContext({ activeGuildId: null })).toEqual(DM_CONTEXT);
  });

  it('sunucu bilgisi yalnızca seçili sunucunun bağlamında', () => {
    expect(showsGuildInfo(state, { kind: 'guild', guildId: 'g1' })).toBe(true);
    expect(showsGuildInfo(state, { kind: 'guild', guildId: 'g2' })).toBe(false);
    expect(showsGuildInfo(state, DM_CONTEXT)).toBe(false);
  });

  it('ad rengi: sunucuda rol rengi, DM’de varsayılan', () => {
    expect(memberColorIn(state, 'ali', { kind: 'guild', guildId: 'g1' })).toBe('#ff0000');
    expect(memberColorIn(state, 'ali', DM_CONTEXT)).toBeNull();
    expect(channelMemberColorOf(state, 'ali', 'genel')).toBe('#ff0000');
    expect(channelMemberColorOf(state, 'ali', 'd1')).toBeNull();
    expect(channelMemberColorOf(state, 'ali', 'd2')).toBeNull();
    // Başka sunucunun kanalı: seçili sunucunun rolleri orada geçerli değil
    expect(channelMemberColorOf(state, 'ali', 'baska')).toBeNull();
  });

  it('"Mesaj gönder": kendine ve ortak sunucusu olmayana yok, bire bir konuşmadaki kişiye yok', () => {
    expect(canMessageIn(state, { kind: 'guild', guildId: 'g1' }, 'ali', 'ben')).toBe(true);
    expect(canMessageIn(state, DM_CONTEXT, 'ali', 'ben')).toBe(true);
    expect(canMessageIn(state, { kind: 'dm', channelId: 'd1' }, 'ali', 'ben')).toBe(false);
    // Grupta bire bir konuşma açılabilir
    expect(canMessageIn(state, { kind: 'dm', channelId: 'd2' }, 'ali', 'ben')).toBe(true);
    expect(canMessageIn(state, { kind: 'dm', channelId: 'd2' }, 'veli', 'ben')).toBe(false);
    expect(canMessageIn(state, DM_CONTEXT, 'ben', 'ben')).toBe(false);
  });
});
