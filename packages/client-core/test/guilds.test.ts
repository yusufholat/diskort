import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_EVERYONE_PERMISSIONS,
  parseInviteCode,
  Permission as P,
  type Channel,
  type GatewayServerMessage,
  type GuildData,
  type ReadyPayload,
  type User,
} from '@diskort/shared';
import {
  channelById,
  configureClient,
  dmBlockedReason,
  gateway,
  guildInitials,
  inviteLink,
  isGuildUnread,
  permissionsOf,
  useGuild,
  useSession,
} from '../src';

const user = (id: string): User => ({ id, username: id, displayName: id.toUpperCase(), avatarColor: '#fff', isAdmin: false });

const channel = (id: string, guildId: string, type: 'text' | 'voice'): Channel => ({
  id,
  guildId,
  name: id,
  type,
  position: 0,
  overwrites: [],
});

const guild = (id: string, ownerId: string, memberIds: string[], channels: Channel[]): GuildData => ({
  guild: { id, name: `Sunucu ${id}`, ownerId, iconUrl: null },
  channels,
  roles: [{ id, name: '@everyone', color: null, position: 0, hoist: false, permissions: DEFAULT_EVERYONE_PERMISSIONS }],
  members: memberIds.map((userId) => ({ userId, roles: [], joinedAt: 1, removed: false })),
});

const ready = (): ReadyPayload => ({
  user: user('ben'),
  guilds: [
    guild('a', 'ben', ['ben', 'ali'], [channel('a-yazi', 'a', 'text'), channel('a-ses', 'a', 'voice')]),
    guild('b', 'veli', ['ben', 'veli'], [channel('b-yazi', 'b', 'text')]),
  ],
  users: [user('ben'), user('ali'), user('veli')],
  voiceStates: [],
  online: [],
  primaryGuildId: 'a',
  lastMessageIds: { 'b-yazi': '9' },
  readStates: {},
  mentionCounts: {},
  attachmentMaxBytes: 1,
  dms: [
    {
      id: 'dm-ali',
      participantIds: ['ben', 'ali'],
      group: false,
      name: null,
      ownerId: null,
      createdAt: 1,
      lastMessageId: null,
      lastActivityAt: 1,
    },
  ],
});

const receive = (msg: GatewayServerMessage): void =>
  (gateway as unknown as { handle: (m: GatewayServerMessage, t: string) => void }).handle(msg, 'jeton');

const memory = new Map<string, string>();

beforeEach(async () => {
  memory.clear();
  useGuild.getState().reset();
  await configureClient({
    platform: 'desktop',
    version: '9.9.9',
    storage: {
      getItem: (k) => memory.get(k) ?? null,
      setItem: (k, v) => void memory.set(k, v),
      removeItem: (k) => void memory.delete(k),
    },
    serverUrl: () => 'sunucu.test/',
    notifyError: () => undefined,
  });
  useSession.getState().setSession('jeton', user('ben'));
  receive({ t: 'READY', d: ready() });
});

describe('sunucular', () => {
  it('READY tüm sunucuları getirir; ilk sunucu seçilir ve görünüm ona göre hesaplanır', () => {
    const s = useGuild.getState();
    expect(s.guildOrder).toEqual(['a', 'b']);
    expect(s.activeGuildId).toBe('a');
    expect(s.guild?.id).toBe('a');
    expect(s.channels.map((c) => c.id)).toEqual(['a-ses', 'a-yazi']);
    // Seçili sunucunun üyesi olmayan tanıdık "removed" görünür (üye listesinde yok)
    expect(s.users.veli).toMatchObject({ removed: true, roles: [] });
    expect(s.users.ali).toMatchObject({ removed: false });
    expect(s.channelGuild).toEqual({ 'a-yazi': 'a', 'a-ses': 'a', 'b-yazi': 'b' });
    expect(isGuildUnread(s, 'b')).toBe(true);
    expect(isGuildUnread(s, 'a')).toBe(false);
  });

  it('sunucu değiştirilince görünüm değişir, seçim hatırlanır; değişmeyen parçalar aynı nesne kalır', () => {
    const before = useGuild.getState();
    useGuild.getState().selectGuild('b');
    const s = useGuild.getState();
    expect(s.guild?.id).toBe('b');
    expect(s.channels.map((c) => c.id)).toEqual(['b-yazi']);
    expect(s.users.ali!.removed).toBe(true);
    expect(s.users.veli!.removed).toBe(false);
    expect(memory.get('diskort-active-guild')).toBe('b');
    // Başka sunucudaki olay seçili görünümü yeniden hesaplatmaz
    receive({ t: 'PRESENCE_UPDATE', d: { userId: 'ali', online: true } });
    receive({ t: 'GUILD_UPDATE', d: { ...before.guilds.a!.guild, name: 'Yeni' } });
    expect(useGuild.getState().channels).toBe(s.channels);
    expect(useGuild.getState().users).toBe(s.users);
    // Yeniden bağlanınca seçim korunur
    receive({ t: 'READY', d: ready() });
    expect(useGuild.getState().activeGuildId).toBe('b');
  });

  it('yetkiler kanalın kendi sunucusuna göre hesaplanır (seçili olmasa da)', () => {
    useGuild.getState().selectGuild('b');
    const s = useGuild.getState();
    // a'nın sahibi: a'nın ses kanalında her yetki, b'de yalnızca @everyone
    expect(permissionsOf(s, 'ben', 'a-ses') & P.MOVE_MEMBERS).toBe(P.MOVE_MEMBERS);
    expect(permissionsOf(s, 'ben') & P.MANAGE_CHANNELS).toBe(0);
    expect(channelById(s, 'a-ses')?.guildId).toBe('a');
    // Üye olmadığı sunucunun kanalında yetki yok
    expect(permissionsOf(s, 'ali', 'b-yazi')).toBe(0);
  });

  it('katılma, üye olayları, ayrılma: DM yazma izni ortak sunucuya bağlıdır', () => {
    receive({ t: 'GUILD_MEMBER_REMOVE', d: { guildId: 'a', userId: 'ali' } });
    let s = useGuild.getState();
    expect(s.users.ali!.removed).toBe(true);
    expect(s.reachable.ali).toBeUndefined();
    expect(permissionsOf(s, 'ben', 'dm-ali')).toBe(P.VIEW_CHANNEL);
    expect(dmBlockedReason(s.dms['dm-ali']!, s.users, 'ben', s.reachable)).toContain('ortak bir sunucunuz yok');

    receive({
      t: 'GUILD_CREATE',
      d: {
        ...guild('c', 'ali', ['ali', 'ben'], [channel('c-yazi', 'c', 'text')]),
        users: [user('ali'), user('ben')],
        voiceStates: [],
        online: ['ali'],
        lastMessageIds: {},
        readStates: {},
        mentionCounts: {},
      },
    });
    s = useGuild.getState();
    expect(s.guildOrder).toEqual(['a', 'b', 'c']);
    expect(s.activeGuildId).toBe('a');
    expect(s.reachable.ali).toBe(true);
    expect(dmBlockedReason(s.dms['dm-ali']!, s.users, 'ben', s.reachable)).toBeNull();
    expect(s.online.ali).toBe(true);

    // Seçili sunucudan çıkılınca sıradaki seçilir, kanalları ve ses durumları gider
    receive({ t: 'VOICE_STATE_UPDATE', d: { userId: 'ali', channelId: 'a-ses', selfMute: false, selfDeaf: false, serverMute: false, serverDeaf: false, streaming: false, joinedAt: 1 } });
    receive({ t: 'GUILD_DELETE', d: { id: 'a' } });
    s = useGuild.getState();
    expect(s.guildOrder).toEqual(['b', 'c']);
    expect(s.activeGuildId).toBe('b');
    expect(s.voiceStates).toEqual({});
    expect(s.channelGuild['a-yazi']).toBeUndefined();
  });

  it('davet kodu bağlantıdan ya da koddan ayrıştırılır; baş harfler ve bağlantı', () => {
    expect(parseInviteCode('https://diskort.ziroo.net/davet/ABCD2345')).toBe('ABCD2345');
    expect(parseInviteCode('  abcd2345 ')).toBe('ABCD2345');
    expect(parseInviteCode('diskort://davet/xy23ab45')).toBe('XY23AB45');
    expect(parseInviteCode('geçersiz kod!')).toBeNull();
    expect(inviteLink('ABCD2345')).toBe('http://sunucu.test/davet/ABCD2345');
    expect(guildInitials('hafta sonu ekibi')).toBe('HSE');
    expect(guildInitials('İzmir')).toBe('İ');
  });
});
