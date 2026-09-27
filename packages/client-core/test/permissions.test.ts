import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_EVERYONE_PERMISSIONS,
  hasPermission,
  Permission as P,
  type Channel,
  type GatewayServerMessage,
  type ReadyPayload,
  type Role,
  type User,
} from '@diskort/shared';
import {
  can,
  channelPermissionInfos,
  configureClient,
  gateway,
  isMentioned,
  memberActions,
  memberColorOf,
  memberGroups,
  moveTargets,
  overwriteState,
  permissionsOf,
  setOverwriteState,
  useGuild,
  useSession,
} from '../src';

const role = (id: string, position: number, permissions: number, extra: Partial<Role> = {}): Role => ({
  id,
  name: id,
  color: null,
  position,
  hoist: false,
  permissions,
  ...extra,
});

const user = (id: string, roles: string[] = [], extra: Partial<User> = {}): User => ({
  id,
  username: id,
  displayName: id.toUpperCase(),
  avatarColor: '#fff',
  isAdmin: false,
  roles,
  removed: false,
  ...extra,
});

const channel = (id: string, type: 'text' | 'voice', overwrites: Channel['overwrites'] = []): Channel => ({
  id,
  guildId: 'g',
  name: id,
  type,
  position: 0,
  overwrites,
});

const ready = (): ReadyPayload => ({
  user: user('mod', ['mod']),
  guild: { id: 'g', name: 'Test', ownerId: 'sahip' },
  channels: [
    channel('genel', 'text'),
    channel('duyuru', 'text', [{ roleId: 'g', allow: 0, deny: P.SEND_MESSAGES }]),
    channel('ses', 'voice'),
    channel('oyun', 'voice', [{ roleId: 'g', allow: 0, deny: P.CONNECT }]),
  ],
  users: [
    user('sahip', ['admin']),
    user('mod', ['mod']),
    user('ali', ['dj']),
    user('veli'),
    user('eski', [], { removed: true }),
  ],
  roles: [
    role('admin', 3, P.ADMINISTRATOR, { color: '#e67e22', hoist: true }),
    role('mod', 2, P.KICK_MEMBERS | P.MUTE_MEMBERS | P.MOVE_MEMBERS | P.MANAGE_ROLES, { color: '#3498db', hoist: true }),
    role('dj', 1, 0, { color: '#2ecc71' }),
    role('g', 0, DEFAULT_EVERYONE_PERMISSIONS),
  ],
  voiceStates: [
    { userId: 'ali', channelId: 'ses', selfMute: false, selfDeaf: false, serverMute: false, serverDeaf: false, streaming: false, joinedAt: 1 },
  ],
  online: ['sahip', 'mod', 'ali'],
  lastMessageIds: {},
  readStates: {},
  mentionCounts: {},
  attachmentMaxBytes: 1,
});

const receive = (msg: GatewayServerMessage): void =>
  (gateway as unknown as { handle: (m: GatewayServerMessage, t: string) => void }).handle(msg, 'jeton');

beforeEach(async () => {
  const memory = new Map<string, string>();
  await configureClient({
    platform: 'desktop',
    version: '9.9.9',
    storage: {
      getItem: (k) => memory.get(k) ?? null,
      setItem: (k, v) => void memory.set(k, v),
      removeItem: (k) => void memory.delete(k),
    },
    serverUrl: () => 'http://sunucu.test',
    notifyError: () => undefined,
  });
  useSession.getState().setSession('jeton', user('mod', ['mod']));
  receive({ t: 'READY', d: ready() });
});

describe('yetkiler', () => {
  it('sunucudakiyle aynı kurallarla hesaplanır', () => {
    const s = useGuild.getState();
    expect(can(s, 'mod', P.KICK_MEMBERS)).toBe(true);
    expect(can(s, 'mod', P.BAN_MEMBERS)).toBe(false);
    expect(can(s, 'veli', P.SEND_MESSAGES, 'duyuru')).toBe(false);
    expect(can(s, 'veli', P.ADD_REACTIONS, 'duyuru')).toBe(true);
    expect(can(s, 'veli', P.SPEAK, 'oyun')).toBe(false);
    expect(can(s, 'sahip', P.SEND_MESSAGES, 'duyuru')).toBe(true);
    // Görünmeyen kanal ve atılan üye: hiçbir yetki
    expect(permissionsOf(s, 'veli', 'yok')).toBe(0);
    expect(permissionsOf(s, 'eski')).toBe(0);
  });

  it('rol ve sunucu olaylarıyla canlı güncellenir', () => {
    receive({ t: 'USER_UPDATE', d: user('veli', ['mod']) });
    expect(can(useGuild.getState(), 'veli', P.KICK_MEMBERS)).toBe(true);
    const roles = ready().roles.map((r) => (r.id === 'mod' ? { ...r, permissions: 0 } : r));
    receive({ t: 'ROLES_UPDATE', d: { roles } });
    expect(can(useGuild.getState(), 'veli', P.KICK_MEMBERS)).toBe(false);
    receive({ t: 'GUILD_UPDATE', d: { id: 'g', name: 'Test', ownerId: 'veli' } });
    expect(can(useGuild.getState(), 'veli', P.BAN_MEMBERS)).toBe(true);
  });

  it('kanal görünmez olunca oradaki ses durumları da gider', () => {
    receive({ t: 'CHANNEL_DELETE', d: { id: 'ses' } });
    expect(useGuild.getState().voiceStates).toEqual({});
  });

  it('rolleri olmayan (eski) sunucuda yöneticilik bayrağına göre tahmin edilir', () => {
    receive({ t: 'READY', d: { ...ready(), roles: [], users: [user('mod', [], { isAdmin: true }), user('veli')] } });
    const s = useGuild.getState();
    expect(can(s, 'mod', P.BAN_MEMBERS)).toBe(true);
    expect(can(s, 'veli', P.SEND_MESSAGES)).toBe(true);
    expect(can(s, 'veli', P.MANAGE_MESSAGES)).toBe(false);
  });
});

describe('görünüm', () => {
  it('üye listesi ayrı gösterilen rollere göre gruplanır; atılanlar görünmez', () => {
    const groups = memberGroups(useGuild.getState());
    expect(groups.map((g) => [g.title, g.members.map((m) => m.id)])).toEqual([
      ['admin', ['sahip']],
      ['mod', ['mod']],
      ['Çevrimiçi', ['ali']],
      ['Çevrimdışı', ['veli']],
    ]);
    expect(memberColorOf(useGuild.getState(), 'ali')).toBe('#2ecc71');
    expect(memberColorOf(useGuild.getState(), 'veli')).toBeNull();
  });

  it('@everyone bahsetmesi herkesi, kendi mesajı kimseyi ilgilendirmez', () => {
    const me = { id: 'mod', username: 'mod' };
    expect(isMentioned({ content: 'selam @everyone', mentionEveryone: true, authorId: 'ali' }, me)).toBe(true);
    expect(isMentioned({ content: '@everyone', mentionEveryone: false, authorId: 'ali' }, me)).toBe(false);
    expect(isMentioned({ content: '@mod bak', mentionEveryone: false, authorId: 'ali' }, me)).toBe(true);
    expect(isMentioned({ content: '@everyone', mentionEveryone: true, authorId: 'mod' }, me)).toBe(false);
  });
});

describe('üye yönetimi', () => {
  it('yetkiye ve hiyerarşiye göre yapılabilecekler', () => {
    const ali = memberActions('ali');
    expect(ali).toMatchObject({ kick: true, ban: false, mute: true, deafen: false, move: true });
    expect(ali.roles.map((r) => r.id)).toEqual(['dj']);
    // Üstündeki sahibe hiçbir şey yapamaz
    expect(memberActions('sahip')).toMatchObject({ kick: false, mute: false, move: false, roles: [] });
    // Kendini atamaz ama sesteyse kendini yönetebilir
    expect(memberActions('mod').kick).toBe(false);
    // Taşıma hedefleri: bulunduğu kanal ve üyenin bağlanamadığı kanal hariç
    expect(moveTargets(user('ali', ['dj'])).map((c) => c.id)).toEqual([]);
    receive({ t: 'CHANNEL_CREATE', d: channel('muzik', 'voice') });
    expect(moveTargets(user('ali', ['dj'])).map((c) => c.id)).toEqual(['muzik']);
  });

  it('kanal izni düzenleme yardımcıları', () => {
    let list = setOverwriteState([], 'g', P.VIEW_CHANNEL, 'deny');
    list = setOverwriteState(list, 'dj', P.VIEW_CHANNEL, 'allow');
    expect(overwriteState(list.find((o) => o.roleId === 'g'), P.VIEW_CHANNEL)).toBe('deny');
    expect(overwriteState(list.find((o) => o.roleId === 'dj'), P.VIEW_CHANNEL)).toBe('allow');
    expect(overwriteState(undefined, P.VIEW_CHANNEL)).toBe('inherit');
    list = setOverwriteState(list, 'g', P.VIEW_CHANNEL, 'inherit');
    expect(list.map((o) => o.roleId)).toEqual(['dj']);
    expect(channelPermissionInfos('voice').map((p) => p.name)).toEqual([
      'VIEW_CHANNEL',
      'CONNECT',
      'SPEAK',
      'STREAM',
      'MUTE_MEMBERS',
      'DEAFEN_MEMBERS',
      'MOVE_MEMBERS',
    ]);
    const text = channelPermissionInfos('text');
    expect(text.map((p) => p.name)).toEqual([
      'VIEW_CHANNEL',
      'SEND_MESSAGES',
      'ATTACH_FILES',
      'ADD_REACTIONS',
      'MANAGE_MESSAGES',
      'MENTION_EVERYONE',
    ]);
    expect(text.every((p) => !hasPermission(p.flag, P.CONNECT))).toBe(true);
  });
});
