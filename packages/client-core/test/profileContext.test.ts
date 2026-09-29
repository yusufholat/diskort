import { describe, expect, it } from 'vitest';
import type { DmChannel, Role, VoiceState } from '@diskort/shared';
import {
  activeGuildContext,
  canMessageIn,
  channelMemberColorOf,
  contextOfChannel,
  DM_CONTEXT,
  memberColorIn,
  showsGuildInfo,
  showsStreamInfo,
  voiceMemberColorOf,
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

const voiceIn = (userId: string, channelId: string): VoiceState => ({
  userId,
  channelId,
  selfMute: false,
  selfDeaf: false,
  serverMute: false,
  serverDeaf: false,
  streaming: true,
  joinedAt: 1,
});

// Seçili sunucu g1; ali ve veli orada "kırmızı" rolde. d1: ben–ali bire bir, d2: grup
const state = {
  activeGuildId: 'g1',
  guild: { id: 'g1', name: 'Sunucu', ownerId: 'ben' },
  roles: { g1: role('g1', 0, null), kirmizi: role('kirmizi', 2, '#ff0000') },
  users: { ben: user('ben', []), ali: user('ali', ['kirmizi']), veli: user('veli', ['kirmizi']) },
  dms: { d1: dm('d1', ['ben', 'ali']), d2: dm('d2', ['ben', 'ali', 'veli']) },
  channelGuild: { genel: 'g1', baska: 'g2', ses1: 'g1', ses2: 'g2' },
  reachable: { ali: true, ben: true } as Record<string, true>,
  // ali seçili sunucunun, veli başka sunucunun ses kanalında
  voiceStates: { ali: voiceIn('ali', 'ses1'), veli: voiceIn('veli', 'ses2') },
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

  it('yayın her sunucu bağlamında (seçili olmasa da), roller/yönetim yalnızca seçili sunucuda, DM’de hiçbiri', () => {
    const other = { kind: 'guild', guildId: 'g2' } as const;
    expect(showsStreamInfo({ kind: 'guild', guildId: 'g1' })).toBe(true);
    expect(showsStreamInfo(other)).toBe(true);
    expect(showsGuildInfo(state, other)).toBe(false);
    expect(showsStreamInfo(DM_CONTEXT)).toBe(false);
    expect(showsStreamInfo({ kind: 'dm', channelId: 'd1' })).toBe(false);
  });

  it('sesteki adın rengi: ses kanalının sunucusu seçiliyse onun rol rengi, değilse varsayılan', () => {
    expect(voiceMemberColorOf(state, 'ali')).toBe('#ff0000');
    // veli başka sunucunun ses kanalında: seçili sunucunun rengi ona uygulanmaz
    expect(voiceMemberColorOf(state, 'veli')).toBeNull();
    expect(voiceMemberColorOf(state, 'ben')).toBeNull();
    expect(channelMemberColorOf(state, 'veli', 'ses2')).toBeNull();
    expect(channelMemberColorOf(state, 'veli', 'ses1')).toBe('#ff0000');
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
